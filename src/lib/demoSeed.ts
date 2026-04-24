import { supabase } from "@/integrations/supabase/client";

/**
 * Seeds the "RSTR IQ All-American" demo data:
 *   - One saved team_builds row with 9 top hitters (by wRC+) and 10 top pitchers
 *     (top 5 starters + top 5 relievers by pRV+/pWRC+)
 *   - Top next-tier players added to the user's target_board for the recruiting flow
 *
 * Idempotent — re-running clears and re-seeds for the same user.
 */

export const ALL_STAR_BUILD_NAME = "RSTR IQ All-American 2026";
export const ALL_STAR_TEAM = "RSTR IQ All-Americans";

type PlayerRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  team: string | null;
  conference: string | null;
  transfer_portal: boolean | null;
  source_player_id: string | null;
};

type PredRow = {
  player_id: string;
  p_wrc_plus: number | null;
  p_rv_plus: number | null;
  p_era: number | null;
  p_avg: number | null;
  power_rating_plus: number | null;
  model_type: string | null;
  variant: string | null;
  status: string | null;
};

const OUTFIELD_POSITIONS = new Set(["OF", "LF", "CF", "RF", "OUTFIELD"]);
const PITCHER_POSITIONS = new Set(["P", "SP", "RP", "LHP", "RHP", "CL"]);

const normalizePos = (pos: string | null | undefined): string => {
  return (pos || "").toUpperCase().trim();
};

const isPitcher = (pos: string | null | undefined) => PITCHER_POSITIONS.has(normalizePos(pos));
const isOutfield = (pos: string | null | undefined) => OUTFIELD_POSITIONS.has(normalizePos(pos));

export type SeedResult = {
  build_id: string;
  roster_count: number;
  target_count: number;
  skipped_positions: string[];
};

export async function seedAllStarDemoData(userId: string): Promise<SeedResult> {
  // ─── 1. Fetch players + predictions ─────────────────────────────────────
  const { data: allPlayers, error: playersErr } = await supabase
    .from("players")
    .select("id, first_name, last_name, position, team, conference, transfer_portal, source_player_id");
  if (playersErr) throw playersErr;
  const players = (allPlayers || []) as PlayerRow[];

  const { data: allPreds, error: predsErr } = await supabase
    .from("player_predictions")
    .select("player_id, p_wrc_plus, p_rv_plus, p_era, p_avg, power_rating_plus, model_type, variant, status")
    .eq("status", "active")
    .eq("variant", "regular");
  if (predsErr) throw predsErr;
  const preds = (allPreds || []) as PredRow[];

  const predByPlayerId = new Map<string, PredRow>();
  for (const p of preds) {
    if (p.player_id) predByPlayerId.set(p.player_id, p);
  }

  // ─── 2. Need pitching master for GS to classify SP vs RP ────────────────
  // Pitching Master has "Role" but we'll derive SP/RP from GS/G to match the
  // Team Builder seeding logic shipped earlier in the session.
  const sourceIds = players.filter((p) => p.source_player_id).map((p) => p.source_player_id!);
  const { data: pmRows } = await (supabase as any)
    .from("Pitching Master")
    .select("source_player_id, GS, G")
    .eq("Season", 2025)
    .in("source_player_id", sourceIds);

  const gsBySourceId = new Map<string, { gs: number; g: number }>();
  for (const r of (pmRows || [])) {
    if (!r.source_player_id) continue;
    gsBySourceId.set(r.source_player_id, { gs: Number(r.GS) || 0, g: Number(r.G) || 0 });
  }

  // ─── 3. Pick top hitter per position ────────────────────────────────────
  const returners = players.filter((p) => !p.transfer_portal);

  const pickTopHitter = (filter: (p: PlayerRow) => boolean, exclude: Set<string>): { player: PlayerRow; pred: PredRow } | null => {
    const candidates = returners
      .filter((p) => filter(p) && !exclude.has(p.id))
      .map((p) => ({ player: p, pred: predByPlayerId.get(p.id) }))
      .filter((x) => x.pred && x.pred.p_wrc_plus != null) as Array<{ player: PlayerRow; pred: PredRow }>;
    candidates.sort((a, b) => (b.pred.p_wrc_plus ?? 0) - (a.pred.p_wrc_plus ?? 0));
    return candidates[0] ?? null;
  };

  const used = new Set<string>();
  const rosterSlots: Array<{ pos: string; player: PlayerRow; pred: PredRow; slot: string }> = [];
  const skipped: string[] = [];

  const addIfFound = (slot: string, posLabel: string, match: (p: PlayerRow) => boolean) => {
    const pick = pickTopHitter(match, used);
    if (!pick) {
      skipped.push(slot);
      return;
    }
    used.add(pick.player.id);
    rosterSlots.push({ pos: posLabel, player: pick.player, pred: pick.pred, slot });
  };

  addIfFound("C", "C", (p) => normalizePos(p.position) === "C");
  addIfFound("1B", "1B", (p) => normalizePos(p.position) === "1B");
  addIfFound("2B", "2B", (p) => normalizePos(p.position) === "2B");
  addIfFound("3B", "3B", (p) => normalizePos(p.position) === "3B");
  addIfFound("SS", "SS", (p) => normalizePos(p.position) === "SS");
  addIfFound("LF", "OF", (p) => isOutfield(p.position));
  addIfFound("CF", "OF", (p) => isOutfield(p.position));
  addIfFound("RF", "OF", (p) => isOutfield(p.position));
  addIfFound("DH", "DH", (p) => normalizePos(p.position) === "DH");

  // ─── 4. Pick top 5 SP + top 5 RP by p_rv_plus ───────────────────────────
  const pitcherReturners = returners
    .filter((p) => isPitcher(p.position))
    .map((p) => ({ player: p, pred: predByPlayerId.get(p.id) }))
    .filter((x) => x.pred && x.pred.p_rv_plus != null) as Array<{ player: PlayerRow; pred: PredRow }>;

  const classified = pitcherReturners.map((x) => {
    const gsInfo = x.player.source_player_id ? gsBySourceId.get(x.player.source_player_id) : null;
    const gs = gsInfo?.gs ?? 0;
    const g = gsInfo?.g ?? 0;
    const isStarter = gs >= 5 && g > 0 && (gs / g) >= 0.5;
    return { ...x, isStarter };
  });

  classified.sort((a, b) => (b.pred.p_rv_plus ?? 0) - (a.pred.p_rv_plus ?? 0));

  const topSP = classified.filter((x) => x.isStarter).slice(0, 5);
  const topRP = classified.filter((x) => !x.isStarter).slice(0, 5);

  for (const x of topSP) {
    rosterSlots.push({ pos: "SP", player: x.player, pred: x.pred, slot: "SP" });
    used.add(x.player.id);
  }
  for (const x of topRP) {
    rosterSlots.push({ pos: "RP", player: x.player, pred: x.pred, slot: "RP" });
    used.add(x.player.id);
  }

  // ─── 5. Delete old build (idempotent) ───────────────────────────────────
  const { data: existingBuilds } = await supabase
    .from("team_builds")
    .select("id")
    .eq("user_id", userId)
    .eq("name", ALL_STAR_BUILD_NAME);
  for (const b of (existingBuilds || [])) {
    await supabase.from("team_build_players").delete().eq("build_id", b.id);
    await supabase.from("team_builds").delete().eq("id", b.id);
  }

  // ─── 6. Create team_builds row ──────────────────────────────────────────
  const { data: createdBuild, error: buildErr } = await supabase
    .from("team_builds")
    .insert({
      user_id: userId,
      name: ALL_STAR_BUILD_NAME,
      team: ALL_STAR_TEAM,
      season: 2026,
      total_budget: 1_000_000,
      notes: "Demo roster — top wRC+ hitter per position + top pRV+ starters and relievers.",
    })
    .select("id")
    .single();
  if (buildErr || !createdBuild) throw buildErr || new Error("Failed to create build");

  // ─── 7. Insert roster members ───────────────────────────────────────────
  const memberRows = rosterSlots.map((r, i) => ({
    build_id: createdBuild.id,
    player_id: r.player.id,
    position_slot: r.slot,
    depth_order: i + 1,
    source: "returner" as const,
    nil_value: null,
  }));
  const { error: membersErr } = await supabase.from("team_build_players").insert(memberRows);
  if (membersErr) throw membersErr;

  // ─── 8. Target Board — next-tier players NOT on the roster ──────────────
  const nextTierHitters = returners
    .filter((p) => !isPitcher(p.position) && !used.has(p.id))
    .map((p) => ({ player: p, pred: predByPlayerId.get(p.id) }))
    .filter((x) => x.pred && x.pred.p_wrc_plus != null) as Array<{ player: PlayerRow; pred: PredRow }>;
  nextTierHitters.sort((a, b) => (b.pred.p_wrc_plus ?? 0) - (a.pred.p_wrc_plus ?? 0));
  const targetHitters = nextTierHitters.slice(0, 10);

  const nextTierPitchers = classified.filter((x) => !used.has(x.player.id)).slice(0, 5);

  // Clear user's existing target board (idempotent demo seed)
  await (supabase as any).from("target_board").delete().eq("user_id", userId);

  const targetRows = [
    ...targetHitters.map((x) => ({ user_id: userId, player_id: x.player.id })),
    ...nextTierPitchers.map((x) => ({ user_id: userId, player_id: x.player.id })),
  ];
  if (targetRows.length > 0) {
    const { error: tbErr } = await (supabase as any).from("target_board").insert(targetRows);
    if (tbErr) throw tbErr;
  }

  return {
    build_id: createdBuild.id,
    roster_count: rosterSlots.length,
    target_count: targetRows.length,
    skipped_positions: skipped,
  };
}
