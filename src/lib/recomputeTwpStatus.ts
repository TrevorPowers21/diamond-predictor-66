import { supabase } from "@/integrations/supabase/client";

/**
 * Recompute Two-Way Player (TWP) Status
 *
 * Scans Hitter Master + Pitching Master for the given season, and updates
 * `players.position` based on PA + IP thresholds:
 *
 *   - PA ≥ paThreshold AND IP ≥ ipThreshold  →  position = 'TWP'
 *   - Currently TWP but doesn't meet:
 *       · PA ≥ paThreshold (but IP < ipThreshold)  →  revert to Hitter Master Pos
 *       · IP ≥ ipThreshold (but PA < paThreshold)  →  set to 'P'
 *       · neither  →  leave alone (rare edge case)
 *
 * Defaults match the 2026-05-01 one-time SQL flagging convention:
 *   PA ≥ 30 AND IP ≥ 5.
 *
 * Does NOT touch player_predictions — those keep tracking whichever side
 * the projection engine derives. Future work: when a real two-way mode
 * lands, mirror the prediction-side data structure.
 */

export interface TwpRecomputeReport {
  scanned: number;
  paThreshold: number;
  ipThreshold: number;
  newTwps: Array<{ source_player_id: string; name: string; pa: number; ip: number }>;
  unchangedTwps: number;
  demotedToHitter: Array<{ source_player_id: string; name: string; newPos: string; pa: number; ip: number }>;
  demotedToPitcher: Array<{ source_player_id: string; name: string; pa: number; ip: number }>;
  leftAlone: number;
  errors: string[];
}

interface PlayerRow {
  id: string;
  source_player_id: string | null;
  position: string | null;
  first_name: string | null;
  last_name: string | null;
}

interface HitterRow {
  source_player_id: string | null;
  playerFullName: string | null;
  PA: number | null;
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
      .select("id, source_player_id, position, first_name, last_name")
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
      .select("source_player_id, playerFullName, PA, Pos")
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

  // Index hitter/pitcher data by source_player_id
  const hitterBySid = new Map<string, HitterRow>();
  for (const h of hitters) if (h.source_player_id) hitterBySid.set(h.source_player_id, h);

  const pitcherBySid = new Map<string, PitcherRow>();
  for (const p of pitchers) if (p.source_player_id) pitcherBySid.set(p.source_player_id, p);

  // Compute desired position for each player
  const updates: Array<{ id: string; sid: string; name: string; newPos: string; oldPos: string | null; pa: number; ip: number; kind: "newTwp" | "demoteToHitter" | "demoteToPitcher" }> = [];

  console.time("[TWPRecompute] 2. compute desired positions");
  for (const player of players) {
    if (!player.source_player_id) continue;
    report.scanned += 1;

    const hitter = hitterBySid.get(player.source_player_id);
    const pitcher = pitcherBySid.get(player.source_player_id);
    const pa = Number(hitter?.PA) || 0;
    const ip = Number(pitcher?.IP) || 0;
    const currentPos = player.position;
    const name = `${player.first_name ?? ""} ${player.last_name ?? ""}`.trim() || player.source_player_id;

    const meetsTwp = pa >= paThreshold && ip >= ipThreshold;
    const isCurrentlyTwp = currentPos === "TWP";

    if (meetsTwp) {
      if (isCurrentlyTwp) {
        report.unchangedTwps += 1;
      } else {
        updates.push({ id: player.id, sid: player.source_player_id, name, newPos: "TWP", oldPos: currentPos, pa, ip, kind: "newTwp" });
      }
      continue;
    }

    // Not a TWP. If currently flagged, revert.
    if (isCurrentlyTwp) {
      // Prefer Hitter Master Pos if they have hitter activity above threshold
      if (pa >= paThreshold && hitter?.Pos) {
        updates.push({ id: player.id, sid: player.source_player_id, name, newPos: hitter.Pos, oldPos: currentPos, pa, ip, kind: "demoteToHitter" });
      } else if (ip >= ipThreshold) {
        updates.push({ id: player.id, sid: player.source_player_id, name, newPos: "P", oldPos: currentPos, pa, ip, kind: "demoteToPitcher" });
      } else {
        // Neither side meets threshold but currently TWP — leave alone.
        // This is rare; a previous TWP flag without supporting data shouldn't
        // be silently demoted to nothing useful.
        report.leftAlone += 1;
      }
    }
    // Not TWP and not flagged — nothing to do.
  }
  console.timeEnd("[TWPRecompute] 2. compute desired positions");
  console.log(`[TWPRecompute] ${updates.length} updates to apply`);

  // Apply updates in batches
  console.time("[TWPRecompute] 3. apply position updates");
  const BATCH = 50;
  for (let i = 0; i < updates.length; i += BATCH) {
    const chunk = updates.slice(i, i + BATCH);
    await Promise.all(chunk.map(async (u) => {
      const { error } = await supabase
        .from("players")
        .update({ position: u.newPos })
        .eq("id", u.id);
      if (error) {
        report.errors.push(`${u.name} (${u.sid}): ${error.message}`);
        return;
      }
      if (u.kind === "newTwp") report.newTwps.push({ source_player_id: u.sid, name: u.name, pa: u.pa, ip: u.ip });
      else if (u.kind === "demoteToHitter") report.demotedToHitter.push({ source_player_id: u.sid, name: u.name, newPos: u.newPos, pa: u.pa, ip: u.ip });
      else if (u.kind === "demoteToPitcher") report.demotedToPitcher.push({ source_player_id: u.sid, name: u.name, pa: u.pa, ip: u.ip });
    }));
  }
  console.timeEnd("[TWPRecompute] 3. apply position updates");

  console.timeEnd("[TWPRecompute] TOTAL");
  console.log(`[TWPRecompute] ${report.newTwps.length} new TWPs, ${report.unchangedTwps} unchanged, ${report.demotedToHitter.length} → hitter, ${report.demotedToPitcher.length} → pitcher, ${report.leftAlone} left alone`);

  return report;
}
