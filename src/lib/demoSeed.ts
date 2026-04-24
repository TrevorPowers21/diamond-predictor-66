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
    .select("player_id, p_wrc_plus, p_avg, power_rating_plus, model_type, variant, status")
    .eq("status", "active")
    .eq("variant", "regular");
  if (predsErr) throw predsErr;
  const preds = (allPreds || []) as PredRow[];

  const predByPlayerId = new Map<string, PredRow>();
  for (const p of preds) {
    if (p.player_id) predByPlayerId.set(p.player_id, p);
  }

  // ─── Fetch Hitter Master ab/pa for sample-size filtering ────────────────
  const hitterSourceIds = players.filter((p) => p.source_player_id && !isPitcher(p.position)).map((p) => p.source_player_id!);
  const hmRows: any[] = [];
  for (let i = 0; i < hitterSourceIds.length; i += 500) {
    const slice = hitterSourceIds.slice(i, i + 500);
    const { data } = await (supabase as any)
      .from("Hitter Master")
      .select("source_player_id, ab, pa")
      .eq("Season", 2025)
      .in("source_player_id", slice);
    if (data) hmRows.push(...data);
  }
  const hmBySourceId = new Map<string, { ab: number; pa: number }>();
  for (const r of hmRows) {
    if (!r.source_player_id) continue;
    hmBySourceId.set(r.source_player_id, { ab: Number(r.ab) || 0, pa: Number(r.pa) || 0 });
  }
  const HITTER_QUALIFY_AB = 75;
  const PITCHER_QUALIFY_IP = 15;
  const hitterAb = (p: PlayerRow) => (p.source_player_id ? (hmBySourceId.get(p.source_player_id)?.ab ?? 0) : 0);

  // ─── 2. Need pitching master for GS to classify SP vs RP ────────────────
  // Pitching Master has "Role" but we'll derive SP/RP from GS/G to match the
  // Team Builder seeding logic shipped earlier in the session.
  const sourceIds = players.filter((p) => p.source_player_id).map((p) => p.source_player_id!);
  // Batch the .in() query — Supabase rejects giant IN lists
  const pmRows: any[] = [];
  const BATCH = 500;
  for (let i = 0; i < sourceIds.length; i += BATCH) {
    const slice = sourceIds.slice(i, i + BATCH);
    const { data } = await (supabase as any)
      .from("Pitching Master")
      .select("source_player_id, GS, G, IP, overall_pr_plus")
      .eq("Season", 2025)
      .in("source_player_id", slice);
    if (data) pmRows.push(...data);
  }

  const pmBySourceId = new Map<string, { gs: number; g: number; ip: number; overall_pr_plus: number | null }>();
  for (const r of pmRows) {
    if (!r.source_player_id) continue;
    pmBySourceId.set(r.source_player_id, {
      gs: Number(r.GS) || 0,
      g: Number(r.G) || 0,
      ip: Number(r.IP) || 0,
      overall_pr_plus: r.overall_pr_plus != null ? Number(r.overall_pr_plus) : null,
    });
  }

  // ─── 3. Pick top hitter per position (qualified returners only) ─────────
  const returners = players.filter((p) => !p.transfer_portal);

  const pickTopHitter = (filter: (p: PlayerRow) => boolean, exclude: Set<string>): { player: PlayerRow; pred: PredRow } | null => {
    const candidates = returners
      .filter((p) => filter(p) && !exclude.has(p.id) && hitterAb(p) >= HITTER_QUALIFY_AB)
      .map((p) => ({ player: p, pred: predByPlayerId.get(p.id) }))
      .filter((x) => x.pred && x.pred.p_wrc_plus != null) as Array<{ player: PlayerRow; pred: PredRow }>;
    candidates.sort((a, b) => (b.pred.p_wrc_plus ?? 0) - (a.pred.p_wrc_plus ?? 0));
    return candidates[0] ?? null;
  };

  const used = new Set<string>();
  const rosterSlots: Array<{ pos: string; player: PlayerRow; pred: PredRow | null; slot: string }> = [];
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

  // ─── 4. Pick top 5 SP + top 5 RP by Pitching Master overall_pr_plus ─────
  // player_predictions doesn't have a pitcher-specific rating column — use
  // the Pitching Master overall_pr_plus (set by the scoring pipeline) instead.
  const classified = returners
    .filter((p) => isPitcher(p.position))
    .map((p) => {
      const pmInfo = p.source_player_id ? pmBySourceId.get(p.source_player_id) : null;
      return {
        player: p,
        pred: predByPlayerId.get(p.id) ?? null,
        gs: pmInfo?.gs ?? 0,
        g: pmInfo?.g ?? 0,
        ip: pmInfo?.ip ?? 0,
        overallPrPlus: pmInfo?.overall_pr_plus ?? null,
      };
    })
    .filter((x) => x.overallPrPlus != null && x.ip >= PITCHER_QUALIFY_IP) as Array<{ player: PlayerRow; pred: PredRow | null; gs: number; g: number; ip: number; overallPrPlus: number }>;

  const classifiedWithRole = classified.map((x) => {
    const isStarter = x.gs >= 5 && x.g > 0 && (x.gs / x.g) >= 0.5;
    return { ...x, isStarter };
  });

  classifiedWithRole.sort((a, b) => b.overallPrPlus - a.overallPrPlus);

  const topSP = classifiedWithRole.filter((x) => x.isStarter).slice(0, 5);
  const topRP = classifiedWithRole.filter((x) => !x.isStarter).slice(0, 5);

  for (const x of topSP) {
    rosterSlots.push({ pos: "SP", player: x.player, pred: x.pred, slot: "SP" });
    used.add(x.player.id);
  }
  for (const x of topRP) {
    rosterSlots.push({ pos: "RP", player: x.player, pred: x.pred, slot: "RP" });
    used.add(x.player.id);
  }

  // ─── 5. Ensure synthetic Teams Table entry exists (resolves team context) ─
  // The Team Builder resolves build.team against Teams Table to populate
  // conference + park factors. Without a row here, loadBuild sets
  // selectedTeam to the string but downstream math has no context.
  const { data: existingTeam } = await (supabase as any)
    .from("Teams Table")
    .select("id")
    .eq("full_name", ALL_STAR_TEAM)
    .maybeSingle();

  if (!existingTeam) {
    // Look up SEC conference_id for the synthetic team
    const { data: secRow } = await supabase
      .from("Conference Names")
      .select("id")
      .eq("conference abbreviation", "SEC")
      .maybeSingle();

    const { error: teamInsertErr } = await (supabase as any)
      .from("Teams Table")
      .insert({
        full_name: ALL_STAR_TEAM,
        abbreviation: "ALL",
        season: 2025,
        conference: "SEC",
        conference_id: secRow?.id ?? null,
      });
    if (teamInsertErr) {
      // Not fatal — build still gets saved, just without full team context
      console.warn("Could not create synthetic Teams Table row:", teamInsertErr.message);
    }
  }

  // ─── 6. Delete old build (idempotent) ───────────────────────────────────
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

  // ─── 8. Target Board — mix of portal targets + qualified next-tier returners ─────
  // Portal players first (they're the recruiting use case), then next-tier
  // returners to show the "high-follow" flow. All filtered by sample size
  // so we don't surface 4-AB noise.

  // Top 5 portal hitters by wRC+ (qualifying AB)
  const portalHitters = players
    .filter((p) => p.transfer_portal && !isPitcher(p.position) && hitterAb(p) >= HITTER_QUALIFY_AB)
    .map((p) => ({ player: p, pred: predByPlayerId.get(p.id) }))
    .filter((x) => x.pred && x.pred.p_wrc_plus != null) as Array<{ player: PlayerRow; pred: PredRow }>;
  portalHitters.sort((a, b) => (b.pred.p_wrc_plus ?? 0) - (a.pred.p_wrc_plus ?? 0));
  const targetPortalHitters = portalHitters.slice(0, 5);

  // Top 5 portal pitchers by overall_pr_plus (qualifying IP)
  const portalPitchersAll = players
    .filter((p) => p.transfer_portal && isPitcher(p.position))
    .map((p) => {
      const pmInfo = p.source_player_id ? pmBySourceId.get(p.source_player_id) : null;
      return {
        player: p,
        ip: pmInfo?.ip ?? 0,
        overallPrPlus: pmInfo?.overall_pr_plus ?? null,
      };
    })
    .filter((x) => x.overallPrPlus != null && x.ip >= PITCHER_QUALIFY_IP) as Array<{ player: PlayerRow; ip: number; overallPrPlus: number }>;
  portalPitchersAll.sort((a, b) => b.overallPrPlus - a.overallPrPlus);
  const targetPortalPitchers = portalPitchersAll.slice(0, 5);

  // Top 5 qualified next-tier returners (hitters first, mixing a pitcher or two)
  const nextTierReturnerHitters = returners
    .filter((p) => !isPitcher(p.position) && !used.has(p.id) && hitterAb(p) >= HITTER_QUALIFY_AB)
    .map((p) => ({ player: p, pred: predByPlayerId.get(p.id) }))
    .filter((x) => x.pred && x.pred.p_wrc_plus != null) as Array<{ player: PlayerRow; pred: PredRow }>;
  nextTierReturnerHitters.sort((a, b) => (b.pred.p_wrc_plus ?? 0) - (a.pred.p_wrc_plus ?? 0));
  const targetReturnerHitters = nextTierReturnerHitters.slice(0, 5);

  // Clear user's existing target board (idempotent demo seed)
  await (supabase as any).from("target_board").delete().eq("user_id", userId);

  const targetRows = [
    ...targetPortalHitters.map((x) => ({ user_id: userId, player_id: x.player.id })),
    ...targetPortalPitchers.map((x) => ({ user_id: userId, player_id: x.player.id })),
    ...targetReturnerHitters.map((x) => ({ user_id: userId, player_id: x.player.id })),
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
