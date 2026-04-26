import { supabase } from "@/integrations/supabase/client";
import {
  computeHitterPowerRatings,
  computePitchingPowerRatings,
  type HitterBaselines,
  type PitchingBaselines,
} from "@/lib/powerRatings";
import {
  getBlendedHitterStats,
  getBlendedPitcherStats,
  HITTER_AB_THRESHOLD,
  HITTER_AB_NOISE_FLOOR,
  PITCHER_IP_THRESHOLD,
  PITCHER_IP_NOISE_FLOOR,
} from "@/lib/combinedStats";

const round2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);

// Hitter columns we read for blending — must match HITTER_BLEND_COLS in combinedStats.ts
const HITTER_PRIOR_SELECT = "source_player_id, Season, ab, Team, TeamID, AVG, OBP, SLG, ISO, contact, line_drive, avg_exit_velo, pop_up, bb, chase, barrel, ev90, pull, la_10_30, gb";
const PITCHER_PRIOR_SELECT = `source_player_id, Season, IP, Team, TeamID, ERA, FIP, WHIP, K9, BB9, HR9, miss_pct, bb_pct, hard_hit_pct, in_zone_whiff_pct, chase_pct, barrel_pct, line_pct, exit_vel, ground_pct, in_zone_pct, h_pull_pct, la_10_30_pct, stuff_plus, "90th_vel"`;

const HITTER_BLEND_COLS = [
  "AVG", "OBP", "SLG", "ISO",
  "contact", "line_drive", "avg_exit_velo", "pop_up", "bb",
  "chase", "barrel", "ev90", "pull", "la_10_30", "gb",
] as const;
const PITCHER_BLEND_COLS = [
  "ERA", "FIP", "WHIP", "K9", "BB9", "HR9",
  "miss_pct", "bb_pct", "hard_hit_pct", "in_zone_whiff_pct", "chase_pct",
  "barrel_pct", "line_pct", "exit_vel", "ground_pct", "in_zone_pct",
  "h_pull_pct", "la_10_30_pct", "stuff_plus", "90th_vel",
] as const;

/**
 * Synchronous blend using a pre-fetched prior-seasons map.
 * Replaces the per-row Supabase query in getBlendedHitterStats.
 * Weights by AB (at-bats), not PA.
 */
function blendHitterSync(
  sourcePlayerId: string | null,
  currentRow: any,
  priorMap: Map<string, any[]>,
) {
  const currentAb = Number(currentRow?.ab) || 0;
  const passthroughValues = HITTER_BLEND_COLS.reduce((acc, col) => {
    acc[col] = currentRow?.[col] ?? null;
    return acc;
  }, {} as Record<string, number | null>);
  if (!sourcePlayerId || currentAb >= HITTER_AB_THRESHOLD) {
    return { combined: false, totalAb: currentAb, seasonsUsed: [Number(currentRow?.Season)], values: passthroughValues };
  }
  const priors = priorMap.get(sourcePlayerId) || [];
  if (priors.length === 0) {
    return { combined: false, totalAb: currentAb, seasonsUsed: [Number(currentRow?.Season)], values: passthroughValues };
  }
  // If current season is below noise floor, skip it entirely — use prior seasons only
  const belowNoiseFloor = currentAb < HITTER_AB_NOISE_FLOOR;
  const collected: any[] = belowNoiseFloor ? [] : [currentRow];
  let totalAb = belowNoiseFloor ? 0 : currentAb;
  for (const ps of priors) {
    const ab = Number(ps.ab) || 0;
    if (ab <= 0) continue;
    collected.push(ps);
    totalAb += ab;
    if (totalAb >= HITTER_AB_THRESHOLD) break;
  }
  if (collected.length === 0) {
    return { combined: false, totalAb: currentAb, seasonsUsed: [Number(currentRow?.Season)], values: passthroughValues };
  }
  if (collected.length === 1 && !belowNoiseFloor) {
    return { combined: false, totalAb: currentAb, seasonsUsed: [Number(currentRow?.Season)], values: passthroughValues };
  }
  const out: Record<string, number | null> = {};
  for (const col of HITTER_BLEND_COLS) {
    let sw = 0, ww = 0;
    for (const r of collected) {
      const v = r[col]; const w = Number(r.ab) || 0;
      if (v != null && Number.isFinite(Number(v)) && w > 0) { sw += Number(v) * w; ww += w; }
    }
    out[col] = ww > 0 ? sw / ww : null;
  }
  // Determine the dominant team — the team with the most AB in the blend
  let dominantTeam: string | null = null;
  let dominantTeamId: string | null = null;
  let maxAb = 0;
  for (const r of collected) {
    const ab = Number(r.ab) || 0;
    if (ab > maxAb && r.Team) { maxAb = ab; dominantTeam = r.Team; dominantTeamId = r.TeamID ?? null; }
  }
  return {
    combined: true,
    totalAb,
    seasonsUsed: collected.map((c) => Number(c.Season)).sort((a, b) => b - a),
    values: out,
    dominantTeam,
    dominantTeamId,
  };
}

function blendPitcherSync(
  sourcePlayerId: string | null,
  currentRow: any,
  priorMap: Map<string, any[]>,
) {
  const currentIp = Number(currentRow?.IP) || 0;
  const passthroughValues = PITCHER_BLEND_COLS.reduce((acc, col) => {
    acc[col] = currentRow?.[col] ?? null;
    return acc;
  }, {} as Record<string, number | null>);
  if (!sourcePlayerId || currentIp >= PITCHER_IP_THRESHOLD) {
    return { combined: false, totalIp: currentIp, seasonsUsed: [Number(currentRow?.Season)], values: passthroughValues };
  }
  const priors = priorMap.get(sourcePlayerId) || [];
  if (priors.length === 0) {
    return { combined: false, totalIp: currentIp, seasonsUsed: [Number(currentRow?.Season)], values: passthroughValues };
  }
  // If current season is below noise floor, skip it entirely — use prior seasons only
  const belowNoiseFloor = currentIp < PITCHER_IP_NOISE_FLOOR;
  const collected: any[] = belowNoiseFloor ? [] : [currentRow];
  let totalIp = belowNoiseFloor ? 0 : currentIp;
  for (const ps of priors) {
    const ip = Number(ps.IP) || 0;
    if (ip <= 0) continue;
    collected.push(ps);
    totalIp += ip;
    if (totalIp >= PITCHER_IP_THRESHOLD) break;
  }
  if (collected.length === 0) {
    return { combined: false, totalIp: currentIp, seasonsUsed: [Number(currentRow?.Season)], values: passthroughValues };
  }
  if (collected.length === 1 && !belowNoiseFloor) {
    return { combined: false, totalIp: currentIp, seasonsUsed: [Number(currentRow?.Season)], values: passthroughValues };
  }
  const out: Record<string, number | null> = {};
  for (const col of PITCHER_BLEND_COLS) {
    let sw = 0, ww = 0;
    for (const r of collected) {
      const v = r[col]; const w = Number(r.IP) || 0;
      if (v != null && Number.isFinite(Number(v)) && w > 0) { sw += Number(v) * w; ww += w; }
    }
    out[col] = ww > 0 ? sw / ww : null;
  }
  // Determine the dominant team — the team with the most IP in the blend
  let dominantTeam: string | null = null;
  let dominantTeamId: string | null = null;
  let maxIp = 0;
  for (const r of collected) {
    const ip = Number(r.IP) || 0;
    if (ip > maxIp && r.Team) { maxIp = ip; dominantTeam = r.Team; dominantTeamId = r.TeamID ?? null; }
  }
  return {
    combined: true,
    totalIp,
    seasonsUsed: collected.map((c) => Number(c.Season)).sort((a, b) => b - a),
    values: out,
    dominantTeam,
    dominantTeamId,
  };
}

/** Fetch all rows from a master table with Season < cutoff, paginated. */
async function fetchAllPrior(table: "Hitter Master" | "Pitching Master", select: string, cutoffSeason: number) {
  const all: any[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .lt("Season", cutoffSeason)
      .order("Season", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

/** Run async tasks with bounded concurrency. */
async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

/**
 * Fetch the per-season NCAA averages from `ncaa_averages` and convert to
 * the HitterBaselines / PitchingBaselines shape expected by powerRatings.
 * Any field that is null in the row falls back to the hardcoded defaults.
 */
async function fetchSeasonBaselines(season: number): Promise<{ hitter: HitterBaselines; pitcher: PitchingBaselines }> {
  const { data, error } = await supabase
    .from("ncaa_averages" as any)
    .select("*")
    .eq("season", season)
    .maybeSingle();

  if (error || !data) {
    console.warn(`[fetchSeasonBaselines] No NCAA averages row for season ${season}, using hardcoded defaults`);
    return { hitter: {}, pitcher: {} };
  }

  const r: any = data;
  // Helper to build a {mean, sd} entry only if both are present
  const m = (mean: number | null, sd: number | null) =>
    mean != null && sd != null && sd > 0 ? { mean, sd } : undefined;

  const hitter: HitterBaselines = {};
  if (m(r.contact_pct, r.contact_pct_sd)) hitter.contact = m(r.contact_pct, r.contact_pct_sd);
  if (m(r.line_drive_pct, r.line_drive_pct_sd)) hitter.lineDrive = m(r.line_drive_pct, r.line_drive_pct_sd);
  if (m(r.exit_velo, r.exit_velo_sd)) hitter.avgExitVelo = m(r.exit_velo, r.exit_velo_sd);
  if (m(r.pop_up_pct, r.pop_up_pct_sd)) hitter.popUp = m(r.pop_up_pct, r.pop_up_pct_sd);
  if (m(r.bb_pct, r.bb_pct_sd)) hitter.bb = m(r.bb_pct, r.bb_pct_sd);
  if (m(r.chase_pct, r.chase_pct_sd)) hitter.chase = m(r.chase_pct, r.chase_pct_sd);
  if (m(r.barrel_pct, r.barrel_pct_sd)) hitter.barrel = m(r.barrel_pct, r.barrel_pct_sd);
  if (m(r.ev90, r.ev90_sd)) hitter.ev90 = m(r.ev90, r.ev90_sd);
  if (m(r.pull_pct, r.pull_pct_sd)) hitter.pull = m(r.pull_pct, r.pull_pct_sd);
  if (m(r.la_10_30_pct, r.la_10_30_pct_sd)) hitter.la10_30 = m(r.la_10_30_pct, r.la_10_30_pct_sd);
  if (m(r.ground_pct, r.ground_pct_sd)) hitter.gb = m(r.ground_pct, r.ground_pct_sd);

  const pitcher: PitchingBaselines = {};
  if (m(r.pitcher_whiff_pct, r.pitcher_whiff_pct_sd)) pitcher.miss_pct = m(r.pitcher_whiff_pct, r.pitcher_whiff_pct_sd);
  if (m(r.pitcher_bb_pct, r.pitcher_bb_pct_sd)) pitcher.bb_pct = m(r.pitcher_bb_pct, r.pitcher_bb_pct_sd);
  if (m(r.pitcher_hard_hit_pct, r.pitcher_hard_hit_pct_sd)) pitcher.hard_hit_pct = m(r.pitcher_hard_hit_pct, r.pitcher_hard_hit_pct_sd);
  if (m(r.pitcher_iz_whiff_pct, r.pitcher_iz_whiff_pct_sd)) pitcher.in_zone_whiff_pct = m(r.pitcher_iz_whiff_pct, r.pitcher_iz_whiff_pct_sd);
  if (m(r.pitcher_chase_pct, r.pitcher_chase_pct_sd)) pitcher.chase_pct = m(r.pitcher_chase_pct, r.pitcher_chase_pct_sd);
  if (m(r.pitcher_barrel_pct, r.pitcher_barrel_pct_sd)) pitcher.barrel_pct = m(r.pitcher_barrel_pct, r.pitcher_barrel_pct_sd);
  if (m(r.pitcher_line_drive_pct, r.pitcher_line_drive_pct_sd)) pitcher.line_pct = m(r.pitcher_line_drive_pct, r.pitcher_line_drive_pct_sd);
  if (m(r.pitcher_exit_velo, r.pitcher_exit_velo_sd)) pitcher.exit_vel = m(r.pitcher_exit_velo, r.pitcher_exit_velo_sd);
  if (m(r.pitcher_ground_pct, r.pitcher_ground_pct_sd)) pitcher.ground_pct = m(r.pitcher_ground_pct, r.pitcher_ground_pct_sd);
  if (m(r.pitcher_in_zone_pct, r.pitcher_in_zone_pct_sd)) pitcher.in_zone_pct = m(r.pitcher_in_zone_pct, r.pitcher_in_zone_pct_sd);
  if (m(r.pitcher_ev90, r.pitcher_ev90_sd)) pitcher.vel_90th = m(r.pitcher_ev90, r.pitcher_ev90_sd);
  if (m(r.pitcher_pull_pct, r.pitcher_pull_pct_sd)) pitcher.h_pull_pct = m(r.pitcher_pull_pct, r.pitcher_pull_pct_sd);
  if (m(r.pitcher_la_10_30_pct, r.pitcher_la_10_30_pct_sd)) pitcher.la_10_30_pct = m(r.pitcher_la_10_30_pct, r.pitcher_la_10_30_pct_sd);
  if (m(r.stuff_plus, r.stuff_plus_sd)) pitcher.stuff_plus = m(r.stuff_plus, r.stuff_plus_sd);

  return { hitter, pitcher };
}

/**
 * Compute and store all hitter power rating scores for a given season.
 * Reads raw sub-metrics from Hitter Master, computes scores, writes back.
 */
export async function computeAndStoreHitterScores(season = 2025): Promise<{ updated: number; errors: number }> {
  let updated = 0;
  let errors = 0;
  console.time("[ComputeHitter] TOTAL");

  console.time("[ComputeHitter] 1. fetch baselines");
  const { hitter: hitterBaselines } = await fetchSeasonBaselines(season);
  console.timeEnd("[ComputeHitter] 1. fetch baselines");
  console.log(`[computeAndStoreHitterScores] Using baselines for ${season}:`, hitterBaselines);

  // Pre-fetch ALL prior-season hitter rows in one paginated pass, then index by source_player_id.
  // Eliminates the per-row Supabase query that getBlendedHitterStats was doing.
  console.time("[ComputeHitter] 2. fetch prior seasons");
  console.log(`[computeAndStoreHitterScores] Pre-fetching prior seasons (< ${season})...`);
  const priorRows = await fetchAllPrior("Hitter Master", HITTER_PRIOR_SELECT, season);
  const priorMap = new Map<string, any[]>();
  for (const r of priorRows) {
    const sid = (r as any).source_player_id;
    if (!sid) continue;
    if (!priorMap.has(sid)) priorMap.set(sid, []);
    priorMap.get(sid)!.push(r);
  }
  // Sort each player's history newest-first (fetch is already sorted, but ensure it)
  for (const arr of priorMap.values()) arr.sort((a, b) => Number(b.Season) - Number(a.Season));
  console.log(`[computeAndStoreHitterScores] Indexed ${priorRows.length} prior rows for ${priorMap.size} players`);
  console.timeEnd("[ComputeHitter] 2. fetch prior seasons");

  // Fetch all current-season rows in pages
  console.time("[ComputeHitter] 3. fetch current season rows");
  console.log(`[computeAndStoreHitterScores] Fetching ${season} rows...`);
  const currentRows: any[] = [];
  let from = 0;
  const readPageSize = 1000;
  while (true) {
    const { data: rows, error } = await supabase
      .from("Hitter Master")
      .select("id, source_player_id, Season, ab, AVG, OBP, SLG, ISO, contact, line_drive, avg_exit_velo, pop_up, bb, chase, barrel, ev90, pull, la_10_30, gb")
      .eq("Season", season)
      .order("id", { ascending: true })
      .range(from, from + readPageSize - 1);
    if (error) throw error;
    if (!rows || rows.length === 0) break;
    currentRows.push(...rows);
    if (rows.length < readPageSize) break;
    from += readPageSize;
  }
  console.timeEnd("[ComputeHitter] 3. fetch current season rows");
  console.log(`[computeAndStoreHitterScores] Computing scores for ${currentRows.length} rows...`);

  // Compute updates in-memory (synchronous, no DB calls)
  console.time("[ComputeHitter] 4. compute scores (in-memory)");
  const updates = currentRows.map((row) => {
    const blended = blendHitterSync((row as any).source_player_id ?? null, row, priorMap);
    const v = blended.values;
    const ratings = computeHitterPowerRatings({
      contact: v.contact,
      lineDrive: v.line_drive,
      avgExitVelo: v.avg_exit_velo,
      popUp: v.pop_up,
      bb: v.bb,
      chase: v.chase,
      barrel: v.barrel,
      ev90: v.ev90,
      pull: v.pull,
      la10_30: v.la_10_30,
      gb: v.gb,
    }, hitterBaselines);
    return {
      id: row.id,
      patch: {
        contact_score: round2(ratings.contactScore),
        line_drive_score: round2(ratings.lineDriveScore),
        avg_ev_score: round2(ratings.avgEVScore),
        pop_up_score: round2(ratings.popUpScore),
        bb_score: round2(ratings.bbScore),
        chase_score: round2(ratings.chaseScore),
        barrel_score: round2(ratings.barrelScore),
        ev90_score: round2(ratings.ev90Score),
        pull_score: round2(ratings.pullScore),
        la_score: round2(ratings.laScore),
        gb_score: round2(ratings.gbScore),
        ba_plus: round2(ratings.baPlus),
        obp_plus: round2(ratings.obpPlus),
        iso_plus: round2(ratings.isoPlus),
        overall_plus: round2(ratings.overallPlus),
        combined_used: blended.combined,
        combined_pa: blended.combined ? blended.totalAb : null,
        combined_seasons: blended.combined ? blended.seasonsUsed.join(",") : null,
        blended_avg: blended.combined ? round2(blended.values.AVG ?? null) : null,
        blended_obp: blended.combined ? round2(blended.values.OBP ?? null) : null,
        blended_slg: blended.combined ? round2(blended.values.SLG ?? null) : null,
        blended_iso: blended.combined ? round2(blended.values.ISO ?? null) : null,
        blended_from_team: blended.combined ? (blended.dominantTeam ?? null) : null,
        blended_from_team_id: blended.combined ? (blended.dominantTeamId ?? null) : null,
        blended_contact: blended.combined ? round2(blended.values.contact ?? null) : null,
        blended_line_drive: blended.combined ? round2(blended.values.line_drive ?? null) : null,
        blended_avg_exit_velo: blended.combined ? round2(blended.values.avg_exit_velo ?? null) : null,
        blended_pop_up: blended.combined ? round2(blended.values.pop_up ?? null) : null,
        blended_bb: blended.combined ? round2(blended.values.bb ?? null) : null,
        blended_chase: blended.combined ? round2(blended.values.chase ?? null) : null,
        blended_barrel: blended.combined ? round2(blended.values.barrel ?? null) : null,
        blended_ev90: blended.combined ? round2(blended.values.ev90 ?? null) : null,
        blended_pull: blended.combined ? round2(blended.values.pull ?? null) : null,
        blended_la_10_30: blended.combined ? round2(blended.values.la_10_30 ?? null) : null,
        blended_gb: blended.combined ? round2(blended.values.gb ?? null) : null,
      } as any,
    };
  });

  console.timeEnd("[ComputeHitter] 4. compute scores (in-memory)");

  // Write updates with bounded concurrency (50 in flight at a time).
  console.time("[ComputeHitter] 5. write updates (50-concurrent)");
  console.log(`[computeAndStoreHitterScores] Writing ${updates.length} updates...`);
  await runWithConcurrency(updates, 50, async (u) => {
    const { error: updateErr } = await supabase
      .from("Hitter Master")
      .update(u.patch)
      .eq("id", u.id);
    if (updateErr) {
      console.error(`Failed to update hitter ${u.id}:`, updateErr);
      errors++;
    } else {
      updated++;
    }
  });
  console.timeEnd("[ComputeHitter] 5. write updates (50-concurrent)");
  console.timeEnd("[ComputeHitter] TOTAL");

  return { updated, errors };
}

/**
 * Compute and store all pitching power rating scores for a given season.
 * Reads raw sub-metrics from Pitching Master, computes scores, writes back.
 */
export async function computeAndStorePitchingScores(season = 2025): Promise<{ updated: number; errors: number }> {
  let updated = 0;
  let errors = 0;
  console.time("[ComputePitching] TOTAL");

  console.time("[ComputePitching] 1. fetch baselines");
  const { pitcher: pitcherBaselines } = await fetchSeasonBaselines(season);
  console.timeEnd("[ComputePitching] 1. fetch baselines");
  console.log(`[computeAndStorePitchingScores] Using baselines for ${season}:`, pitcherBaselines);

  console.time("[ComputePitching] 2. fetch prior seasons");
  console.log(`[computeAndStorePitchingScores] Pre-fetching prior seasons (< ${season})...`);
  const priorRows = await fetchAllPrior("Pitching Master", PITCHER_PRIOR_SELECT, season);
  const priorMap = new Map<string, any[]>();
  for (const r of priorRows) {
    const sid = (r as any).source_player_id;
    if (!sid) continue;
    if (!priorMap.has(sid)) priorMap.set(sid, []);
    priorMap.get(sid)!.push(r);
  }
  for (const arr of priorMap.values()) arr.sort((a, b) => Number(b.Season) - Number(a.Season));
  console.log(`[computeAndStorePitchingScores] Indexed ${priorRows.length} prior rows for ${priorMap.size} players`);
  console.timeEnd("[ComputePitching] 2. fetch prior seasons");

  console.time("[ComputePitching] 3. fetch current season rows");
  console.log(`[computeAndStorePitchingScores] Fetching ${season} rows...`);
  const currentRows: any[] = [];
  let from = 0;
  const readPageSize = 1000;
  while (true) {
    const { data: rows, error } = await supabase
      .from("Pitching Master")
      .select("id, source_player_id, Season, IP, Team, TeamID, ERA, FIP, WHIP, K9, BB9, HR9, miss_pct, bb_pct, hard_hit_pct, in_zone_whiff_pct, chase_pct, barrel_pct, line_pct, exit_vel, ground_pct, in_zone_pct, \"90th_vel\", h_pull_pct, la_10_30_pct, stuff_plus")
      .eq("Season", season)
      .order("id", { ascending: true })
      .range(from, from + readPageSize - 1);
    if (error) throw error;
    if (!rows || rows.length === 0) break;
    currentRows.push(...rows);
    if (rows.length < readPageSize) break;
    from += readPageSize;
  }
  console.timeEnd("[ComputePitching] 3. fetch current season rows");
  console.log(`[computeAndStorePitchingScores] Computing scores for ${currentRows.length} rows...`);

  console.time("[ComputePitching] 4. compute scores (in-memory)");
  const updates = currentRows.map((row) => {
    const blended = blendPitcherSync((row as any).source_player_id ?? null, row, priorMap);
    const v = blended.values;
    const ratings = computePitchingPowerRatings({
      miss_pct: v.miss_pct,
      bb_pct: v.bb_pct,
      hard_hit_pct: v.hard_hit_pct,
      in_zone_whiff_pct: v.in_zone_whiff_pct,
      chase_pct: v.chase_pct,
      barrel_pct: v.barrel_pct,
      line_pct: v.line_pct,
      exit_vel: v.exit_vel,
      ground_pct: v.ground_pct,
      in_zone_pct: v.in_zone_pct,
      vel_90th: (v as any)["90th_vel"],
      h_pull_pct: v.h_pull_pct,
      la_10_30_pct: v.la_10_30_pct,
    }, v.stuff_plus ?? null, pitcherBaselines);
    return {
      id: row.id,
      patch: {
        whiff_score: round2(ratings.whiffScore),
        bb_score: round2(ratings.bbScore),
        hh_score: round2(ratings.hhScore),
        iz_whiff_score: round2(ratings.izWhiffScore),
        chase_score: round2(ratings.chaseScore),
        barrel_score: round2(ratings.barrelScore),
        ld_score: round2(ratings.ldScore),
        ev_score: round2(ratings.evScore),
        gb_score: round2(ratings.gbScore),
        iz_score: round2(ratings.izScore),
        ev90_score: round2(ratings.ev90Score),
        pull_score: round2(ratings.pullScore),
        la_score: round2(ratings.laScore),
        era_pr_plus: round2(ratings.eraPrPlus),
        fip_pr_plus: round2(ratings.fipPrPlus),
        whip_pr_plus: round2(ratings.whipPrPlus),
        k9_pr_plus: round2(ratings.k9PrPlus),
        bb9_pr_plus: round2(ratings.bb9PrPlus),
        hr9_pr_plus: round2(ratings.hr9PrPlus),
        overall_pr_plus: round2(ratings.overallPrPlus),
        combined_used: blended.combined,
        combined_ip: blended.combined ? blended.totalIp : null,
        combined_seasons: blended.combined ? blended.seasonsUsed.join(",") : null,
        blended_era: blended.combined ? round2(blended.values.ERA ?? null) : null,
        blended_fip: blended.combined ? round2(blended.values.FIP ?? null) : null,
        blended_whip: blended.combined ? round2(blended.values.WHIP ?? null) : null,
        blended_k9: blended.combined ? round2(blended.values.K9 ?? null) : null,
        blended_bb9: blended.combined ? round2(blended.values.BB9 ?? null) : null,
        blended_hr9: blended.combined ? round2(blended.values.HR9 ?? null) : null,
        blended_stuff_plus: blended.combined ? round2(blended.values.stuff_plus ?? null) : null,
        blended_from_team: blended.combined ? ((blended as any).dominantTeam ?? null) : null,
        blended_from_team_id: blended.combined ? ((blended as any).dominantTeamId ?? null) : null,
        blended_miss_pct: blended.combined ? round2(blended.values.miss_pct ?? null) : null,
        blended_bb_pct: blended.combined ? round2(blended.values.bb_pct ?? null) : null,
        blended_hard_hit_pct: blended.combined ? round2(blended.values.hard_hit_pct ?? null) : null,
        blended_in_zone_whiff_pct: blended.combined ? round2(blended.values.in_zone_whiff_pct ?? null) : null,
        blended_chase_pct: blended.combined ? round2(blended.values.chase_pct ?? null) : null,
        blended_barrel_pct: blended.combined ? round2(blended.values.barrel_pct ?? null) : null,
        blended_line_pct: blended.combined ? round2(blended.values.line_pct ?? null) : null,
        blended_exit_vel: blended.combined ? round2(blended.values.exit_vel ?? null) : null,
        blended_ground_pct: blended.combined ? round2(blended.values.ground_pct ?? null) : null,
        blended_in_zone_pct: blended.combined ? round2(blended.values.in_zone_pct ?? null) : null,
        blended_h_pull_pct: blended.combined ? round2(blended.values.h_pull_pct ?? null) : null,
        blended_la_10_30_pct: blended.combined ? round2(blended.values.la_10_30_pct ?? null) : null,
        blended_90th_vel: blended.combined ? round2(blended.values["90th_vel"] ?? null) : null,
      } as any,
    };
  });

  console.timeEnd("[ComputePitching] 4. compute scores (in-memory)");

  console.time("[ComputePitching] 5. write updates (50-concurrent)");
  console.log(`[computeAndStorePitchingScores] Writing ${updates.length} updates...`);
  await runWithConcurrency(updates, 50, async (u) => {
    const { error: updateErr } = await supabase
      .from("Pitching Master")
      .update(u.patch)
      .eq("id", u.id);
    if (updateErr) {
      console.error(`Failed to update pitcher ${u.id}:`, updateErr);
      errors++;
    } else {
      updated++;
    }
  });
  console.timeEnd("[ComputePitching] 5. write updates (50-concurrent)");
  console.timeEnd("[ComputePitching] TOTAL");

  return { updated, errors };
}

/** Run both hitter and pitcher score computations */
export async function computeAndStoreAllScores(season = 2025) {
  const hitters = await computeAndStoreHitterScores(season);
  const pitchers = await computeAndStorePitchingScores(season);
  return { hitters, pitchers };
}

// ─── Auto-detect & compute unscored rows ───────────────────────────────

let _autoComputeRunning = false;

/** Check if any hitters/pitchers for a season are missing scores, and compute them if so */
export async function autoComputeUnscoredRows(season = 2025): Promise<void> {
  if (_autoComputeRunning) return;
  _autoComputeRunning = true;
  try {
    // Check for unscored hitters
    const { count: unscoredHitters } = await supabase
      .from("Hitter Master")
      .select("id", { count: "exact", head: true })
      .eq("Season", season)
      .is("ba_plus", null);

    if (unscoredHitters && unscoredHitters > 0) {
      console.log(`[autoCompute] Found ${unscoredHitters} unscored hitters for ${season}, computing...`);
      const result = await computeAndStoreHitterScores(season);
      console.log(`[autoCompute] Hitters done: ${result.updated} updated, ${result.errors} errors`);
    }

    // Check for unscored pitchers
    const { count: unscoredPitchers } = await supabase
      .from("Pitching Master")
      .select("id", { count: "exact", head: true })
      .eq("Season", season)
      .is("era_pr_plus", null);

    if (unscoredPitchers && unscoredPitchers > 0) {
      console.log(`[autoCompute] Found ${unscoredPitchers} unscored pitchers for ${season}, computing...`);
      const result = await computeAndStorePitchingScores(season);
      console.log(`[autoCompute] Pitchers done: ${result.updated} updated, ${result.errors} errors`);
    }
  } catch (err) {
    console.error("[autoCompute] Error:", err);
  } finally {
    _autoComputeRunning = false;
  }
}
