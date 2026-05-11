import { supabase } from "@/integrations/supabase/client";

/**
 * Recompute Two-Way Player (TWP) Status
 *
 * Scans Hitter Master + Pitching Master for the given season and writes both
 * `players.is_twp` (boolean flag) and `players.position` (primary side).
 *
 * ─── New architecture ─────────────────────────────────────────────────────
 * Replaces the prior "position = 'TWP'" overload, which destroyed the hitter
 * Pos so a TWP-SS could not be filtered as SS in the hitter dashboard.
 *
 *   * `is_twp = true` marks the player as a two-way player.
 *   * `position` always holds the PRIMARY side:
 *       - hitter Pos (e.g. SS, C, RF) for hitter-primary TWPs (PA >= paThreshold)
 *       - 'P'                          for pitcher-primary TWPs (no hitter activity meeting threshold)
 *
 * A TWP appears in BOTH the hitter and pitcher dashboards. The Team Builder
 * seeds the same source_player_id into both pools (one slot each side). The
 * display pattern is "<primary_pos> · TWP" — primary dominant, TWP muted.
 *
 * ─── Promotion rule ──────────────────────────────────────────────────────
 *   PA >= paThreshold AND IP >= ipThreshold  ->  is_twp = true
 *     position = hitter Pos (if valid) else 'P'
 *
 * ─── Demotion / non-TWP rules ────────────────────────────────────────────
 * For players who are currently flagged (is_twp = true OR legacy position = 'TWP')
 * but no longer meet the promotion threshold, restore via this ladder:
 *
 *   1. PA >= paThreshold AND hitter Pos valid  ->  is_twp=false, position = hitter Pos
 *   2. IP >= ipThreshold                       ->  is_twp=false, position = 'P'
 *   3. PA > 0 AND IP == 0                      ->  is_twp=false, position = hitter Pos (else NULL)
 *   4. IP > 0 AND PA == 0                      ->  is_twp=false, position = 'P'
 *   5. Both > 0 below threshold + Pos invalid  ->  leave alone (manual data fix needed)
 *   6. No 2026 data                            ->  is_twp=false, position = NULL (alumni)
 *
 * Defaults match the 2026-05-01 one-time SQL flagging convention:
 *   PA >= 30 AND IP >= 5.
 */

export interface TwpRecomputeReport {
  scanned: number;
  paThreshold: number;
  ipThreshold: number;
  /** Newly-flagged TWPs (is_twp went false->true). */
  newTwps: Array<{ source_player_id: string; name: string; primaryPos: string; pa: number; ip: number }>;
  /** Already flagged TWPs whose state didn't change. */
  unchangedTwps: number;
  /** Was TWP, demoted to hitter primary (is_twp -> false, position -> hitter Pos). */
  demotedToHitter: Array<{ source_player_id: string; name: string; newPos: string; pa: number; ip: number }>;
  /** Was TWP, demoted to pitcher (is_twp -> false, position -> 'P'). */
  demotedToPitcher: Array<{ source_player_id: string; name: string; pa: number; ip: number }>;
  /** Was TWP, no 2026 activity (likely alumni). is_twp -> false, position -> NULL. */
  clearedToNull: Array<{ source_player_id: string; name: string; reason: string }>;
  /** Was flagged via legacy position='TWP' but is_twp=false; restored to a real primary. */
  legacyMigrated: number;
  /** Both PA and IP > 0 but below threshold + invalid hitter Pos. Manual data fix needed. */
  leftAlone: number;
  errors: string[];
}

interface PlayerRow {
  id: string;
  source_player_id: string | null;
  position: string | null;
  is_twp: boolean | null;
  first_name: string | null;
  last_name: string | null;
}

interface HitterRow {
  source_player_id: string | null;
  playerFullName: string | null;
  pa: number | null;
  Pos: string | null;
}

interface PitcherRow {
  source_player_id: string | null;
  playerFullName: string | null;
  IP: number | null;
}

async function fetchAllPlayers(): Promise<PlayerRow[]> {
  const PAGE = 1000;
  const all: PlayerRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("players")
      .select("id, source_player_id, position, is_twp, first_name, last_name")
      .not("source_player_id", "is", null)
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`players fetch: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as PlayerRow[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

async function fetchAllHitterMaster(season: number): Promise<HitterRow[]> {
  const PAGE = 1000;
  const all: HitterRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await (supabase as any)
      .from("Hitter Master")
      .select("source_player_id, playerFullName, pa, Pos")
      .eq("Season", season)
      .not("source_player_id", "is", null)
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`Hitter Master fetch: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as HitterRow[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

async function fetchAllPitchingMaster(season: number): Promise<PitcherRow[]> {
  const PAGE = 1000;
  const all: PitcherRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await (supabase as any)
      .from("Pitching Master")
      .select("source_player_id, playerFullName, IP")
      .eq("Season", season)
      .not("source_player_id", "is", null)
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`Pitching Master fetch: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as PitcherRow[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

const validHitterPos = (pos: string | null | undefined): string | null => {
  if (!pos) return null;
  const trimmed = pos.trim();
  if (!trimmed) return null;
  // Reject any legacy "TWP" marker from Hitter Master; we want a real position.
  if (trimmed.toUpperCase() === "TWP") return null;
  return trimmed;
};

export async function recomputeTwpStatus(
  season = 2026,
  paThreshold = 30,
  ipThreshold = 5,
): Promise<TwpRecomputeReport> {
  console.time("[TWPRecompute] TOTAL");
  const report: TwpRecomputeReport = {
    scanned: 0,
    paThreshold,
    ipThreshold,
    newTwps: [],
    unchangedTwps: 0,
    demotedToHitter: [],
    demotedToPitcher: [],
    clearedToNull: [],
    legacyMigrated: 0,
    leftAlone: 0,
    errors: [],
  };

  console.time("[TWPRecompute] 1. fetch all three tables");
  const [players, hitters, pitchers] = await Promise.all([
    fetchAllPlayers(),
    fetchAllHitterMaster(season),
    fetchAllPitchingMaster(season),
  ]);
  console.timeEnd("[TWPRecompute] 1. fetch all three tables");
  console.log(`[TWPRecompute] ${players.length} players, ${hitters.length} hitters, ${pitchers.length} pitchers`);

  const hitterBySid = new Map<string, HitterRow>();
  for (const h of hitters) if (h.source_player_id) hitterBySid.set(h.source_player_id, h);

  const pitcherBySid = new Map<string, PitcherRow>();
  for (const p of pitchers) if (p.source_player_id) pitcherBySid.set(p.source_player_id, p);

  type UpdateKind = "newTwp" | "demoteToHitter" | "demoteToPitcher" | "clearToNull" | "legacyMigrate";
  const updates: Array<{
    id: string;
    sid: string;
    name: string;
    newIsTwp: boolean;
    newPos: string | null;
    oldIsTwp: boolean;
    oldPos: string | null;
    pa: number;
    ip: number;
    kind: UpdateKind;
    reason?: string;
  }> = [];

  console.time("[TWPRecompute] 2. compute desired state");
  for (const player of players) {
    if (!player.source_player_id) continue;
    report.scanned += 1;

    const hitter = hitterBySid.get(player.source_player_id);
    const pitcher = pitcherBySid.get(player.source_player_id);
    const pa = Number(hitter?.pa) || 0;
    const ip = Number(pitcher?.IP) || 0;
    const currentPos = player.position;
    const currentIsTwp = !!player.is_twp;
    const isLegacyTwpPos = currentPos === "TWP";
    const hPos = validHitterPos(hitter?.Pos);
    const name = `${player.first_name ?? ""} ${player.last_name ?? ""}`.trim() || player.source_player_id;

    const meetsTwp = pa >= paThreshold && ip >= ipThreshold;

    if (meetsTwp) {
      // Promotion / migration path. Primary position = hitter Pos if valid, else 'P'.
      const primaryPos = hPos ?? "P";
      const noChange = currentIsTwp && currentPos === primaryPos;
      if (noChange) {
        report.unchangedTwps += 1;
        continue;
      }
      // Either net-new TWP (was not flagged) or legacy TWP-pos that needs primary restored.
      const kind: UpdateKind = currentIsTwp || isLegacyTwpPos ? "legacyMigrate" : "newTwp";
      updates.push({
        id: player.id,
        sid: player.source_player_id,
        name,
        newIsTwp: true,
        newPos: primaryPos,
        oldIsTwp: currentIsTwp,
        oldPos: currentPos,
        pa,
        ip,
        kind,
      });
      continue;
    }

    // Doesn't meet TWP. Only act if currently flagged (is_twp true) or legacy position='TWP'.
    if (!currentIsTwp && !isLegacyTwpPos) continue;

    // Rule 6: no data at all -> clear flag, NULL position.
    if (pa === 0 && ip === 0) {
      updates.push({
        id: player.id, sid: player.source_player_id, name,
        newIsTwp: false, newPos: null, oldIsTwp: currentIsTwp, oldPos: currentPos,
        pa, ip, kind: "clearToNull", reason: "no 2026 data",
      });
      continue;
    }

    // Rule 4: pitching only -> P.
    if (pa === 0 && ip > 0) {
      updates.push({
        id: player.id, sid: player.source_player_id, name,
        newIsTwp: false, newPos: "P", oldIsTwp: currentIsTwp, oldPos: currentPos,
        pa, ip, kind: "demoteToPitcher",
      });
      continue;
    }

    // Rule 3: hitting only -> hitter Pos (else NULL).
    if (pa > 0 && ip === 0) {
      if (hPos) {
        updates.push({
          id: player.id, sid: player.source_player_id, name,
          newIsTwp: false, newPos: hPos, oldIsTwp: currentIsTwp, oldPos: currentPos,
          pa, ip, kind: "demoteToHitter",
        });
      } else {
        updates.push({
          id: player.id, sid: player.source_player_id, name,
          newIsTwp: false, newPos: null, oldIsTwp: currentIsTwp, oldPos: currentPos,
          pa, ip, kind: "clearToNull", reason: "hitter only but Hitter Master Pos invalid",
        });
      }
      continue;
    }

    // Both > 0 but below TWP thresholds.
    // Rule 1: PA side meets + hitter Pos valid -> revert to hitter Pos.
    if (pa >= paThreshold && hPos) {
      updates.push({
        id: player.id, sid: player.source_player_id, name,
        newIsTwp: false, newPos: hPos, oldIsTwp: currentIsTwp, oldPos: currentPos,
        pa, ip, kind: "demoteToHitter",
      });
      continue;
    }
    // Rule 2: IP side meets -> P.
    if (ip >= ipThreshold) {
      updates.push({
        id: player.id, sid: player.source_player_id, name,
        newIsTwp: false, newPos: "P", oldIsTwp: currentIsTwp, oldPos: currentPos,
        pa, ip, kind: "demoteToPitcher",
      });
      continue;
    }

    // Rule 5: mixed tiny + invalid hitter Pos. Clear the flag but leave position alone.
    if (currentIsTwp) {
      updates.push({
        id: player.id, sid: player.source_player_id, name,
        newIsTwp: false, newPos: currentPos, oldIsTwp: currentIsTwp, oldPos: currentPos,
        pa, ip, kind: "clearToNull", reason: "mixed tiny activity, hitter Pos invalid — flag cleared, position untouched",
      });
    }
    report.leftAlone += 1;
  }
  console.timeEnd("[TWPRecompute] 2. compute desired state");
  console.log(`[TWPRecompute] ${updates.length} updates to apply`);

  console.time("[TWPRecompute] 3. apply updates");
  const BATCH = 50;
  for (let i = 0; i < updates.length; i += BATCH) {
    const chunk = updates.slice(i, i + BATCH);
    await Promise.all(chunk.map(async (u) => {
      const patch: Record<string, any> = { is_twp: u.newIsTwp };
      // Only rewrite position when the new value differs OR we're explicitly
      // clearing a legacy "TWP" string. Skip the position write when the
      // demotion ladder said "leave position alone" (newPos === oldPos).
      if (u.newPos !== u.oldPos) patch.position = u.newPos;
      const { error } = await supabase
        .from("players")
        .update(patch)
        .eq("id", u.id);
      if (error) {
        report.errors.push(`${u.name} (${u.sid}): ${error.message}`);
        return;
      }
      if (u.kind === "newTwp") {
        report.newTwps.push({ source_player_id: u.sid, name: u.name, primaryPos: u.newPos ?? "", pa: u.pa, ip: u.ip });
      } else if (u.kind === "legacyMigrate") {
        report.legacyMigrated += 1;
      } else if (u.kind === "demoteToHitter") {
        report.demotedToHitter.push({ source_player_id: u.sid, name: u.name, newPos: u.newPos ?? "", pa: u.pa, ip: u.ip });
      } else if (u.kind === "demoteToPitcher") {
        report.demotedToPitcher.push({ source_player_id: u.sid, name: u.name, pa: u.pa, ip: u.ip });
      } else if (u.kind === "clearToNull") {
        report.clearedToNull.push({ source_player_id: u.sid, name: u.name, reason: u.reason ?? "" });
      }
    }));
  }
  console.timeEnd("[TWPRecompute] 3. apply updates");

  console.timeEnd("[TWPRecompute] TOTAL");
  console.log(`[TWPRecompute] ${report.newTwps.length} new, ${report.legacyMigrated} legacy-migrated, ${report.unchangedTwps} unchanged, ${report.demotedToHitter.length} → hitter, ${report.demotedToPitcher.length} → pitcher, ${report.clearedToNull.length} cleared, ${report.leftAlone} left alone`);

  return report;
}
