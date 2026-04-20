/**
 * Multi-season blended stats helpers.
 *
 * Players with small current-season samples (e.g., injured, transferred mid-year,
 * lost playing time) get noisy projections. This module looks back at prior
 * seasons by source_player_id and AB/IP-weighted blends the raw stats + scouting
 * metrics until we hit a target sample size, OR run out of seasons.
 *
 * Usage: call from the projection engine BEFORE running power rating math.
 *
 * Decision:
 * - Hitter threshold: 75 AB
 * - Pitcher threshold: 25 IP
 * - Power rating weight bumps from 0.7 → 0.9 for low-sample players
 * - If a player qualifies on their own, no blending happens — current season only
 * - If a player has no prior history (true freshman, JUCO transfer), use what's
 *   available — no error
 */

import { supabase } from "@/integrations/supabase/client";

export const HITTER_AB_THRESHOLD = 75;
export const HITTER_AB_NOISE_FLOOR = 15; // Below this, current season is pure noise — skip entirely
export const PITCHER_IP_THRESHOLD = 25;
export const PITCHER_IP_NOISE_FLOOR = 5; // Same concept for pitchers

// All numeric columns we want to blend on the hitter side
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

export type CombinedHitterResult = {
  combined: boolean; // true if multi-year blend was applied
  totalAb: number;
  seasonsUsed: number[]; // newest first
  // Blended numeric values (or current-season values if no blend)
  values: Record<string, number | null>;
};

export type CombinedPitcherResult = {
  combined: boolean;
  totalIp: number;
  seasonsUsed: number[];
  values: Record<string, number | null>;
};

/**
 * AB-weighted blend across multiple Hitter Master season rows.
 * Each row's contribution = (row.ab / totalAb) * row.value
 * Null values are dropped from the weighting (column-by-column).
 */
function blendHitter(rows: Array<Record<string, any>>): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const col of HITTER_BLEND_COLS) {
    let sumWeighted = 0;
    let sumWeight = 0;
    for (const r of rows) {
      const v = r[col];
      const w = Number(r.ab) || 0;
      if (v != null && Number.isFinite(Number(v)) && w > 0) {
        sumWeighted += Number(v) * w;
        sumWeight += w;
      }
    }
    out[col] = sumWeight > 0 ? sumWeighted / sumWeight : null;
  }
  return out;
}

function blendPitcher(rows: Array<Record<string, any>>): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const col of PITCHER_BLEND_COLS) {
    let sumWeighted = 0;
    let sumWeight = 0;
    for (const r of rows) {
      const v = r[col];
      const w = Number(r.IP) || 0;
      if (v != null && Number.isFinite(Number(v)) && w > 0) {
        sumWeighted += Number(v) * w;
        sumWeight += w;
      }
    }
    out[col] = sumWeight > 0 ? sumWeighted / sumWeight : null;
  }
  return out;
}

/**
 * Fetch and blend hitter stats for a player who is below the AB threshold.
 * Returns the combined stats (or unchanged current-season stats if not below threshold,
 * or no source_player_id, or no prior history available).
 */
export async function getBlendedHitterStats(
  sourcePlayerId: string | null,
  currentSeason: number,
  currentRow: Record<string, any>,
): Promise<CombinedHitterResult> {
  const currentAb = Number(currentRow?.ab) || 0;
  const passthrough = (combined: boolean): CombinedHitterResult => ({
    combined,
    totalAb: currentAb,
    seasonsUsed: [currentSeason],
    values: HITTER_BLEND_COLS.reduce((acc, col) => {
      acc[col] = currentRow?.[col] ?? null;
      return acc;
    }, {} as Record<string, number | null>),
  });

  if (!sourcePlayerId || currentAb >= HITTER_AB_THRESHOLD) {
    return passthrough(false);
  }

  // Look back through prior seasons in descending order
  const { data: priorSeasons, error } = await supabase
    .from("Hitter Master")
    .select("Season, ab, AVG, OBP, SLG, ISO, contact, line_drive, avg_exit_velo, pop_up, bb, chase, barrel, ev90, pull, la_10_30, gb")
    .eq("source_player_id", sourcePlayerId)
    .lt("Season", currentSeason)
    .order("Season", { ascending: false });

  if (error || !priorSeasons || priorSeasons.length === 0) {
    return passthrough(false);
  }

  // If current season is below noise floor, skip it entirely — use prior seasons only
  const belowNoiseFloor = currentAb < HITTER_AB_NOISE_FLOOR;
  const collected: any[] = belowNoiseFloor ? [] : [currentRow];
  let totalAb = belowNoiseFloor ? 0 : currentAb;

  for (const ps of priorSeasons) {
    const ab = Number((ps as any).ab) || 0;
    if (ab <= 0) continue;
    collected.push(ps);
    totalAb += ab;
    if (totalAb >= HITTER_AB_THRESHOLD) break;
  }

  if (collected.length === 0) {
    return passthrough(false);
  }

  // If we only have prior seasons (noise floor case), use straight blend of those
  if (collected.length === 1 && !belowNoiseFloor) {
    return passthrough(false);
  }

  const values = blendHitter(collected);
  return {
    combined: true,
    totalAb,
    seasonsUsed: collected.map((c) => Number(c.Season)).sort((a, b) => b - a),
    values,
  };
}

/**
 * Fetch and blend pitcher stats for a player who is below the IP threshold.
 */
export async function getBlendedPitcherStats(
  sourcePlayerId: string | null,
  currentSeason: number,
  currentRow: Record<string, any>,
): Promise<CombinedPitcherResult> {
  const currentIp = Number(currentRow?.IP) || 0;
  const passthrough = (combined: boolean): CombinedPitcherResult => ({
    combined,
    totalIp: currentIp,
    seasonsUsed: [currentSeason],
    values: PITCHER_BLEND_COLS.reduce((acc, col) => {
      acc[col] = currentRow?.[col] ?? null;
      return acc;
    }, {} as Record<string, number | null>),
  });

  if (!sourcePlayerId || currentIp >= PITCHER_IP_THRESHOLD) {
    return passthrough(false);
  }

  const { data: priorSeasons, error } = await supabase
    .from("Pitching Master")
    .select(`Season, IP, ERA, FIP, WHIP, K9, BB9, HR9,
             miss_pct, bb_pct, hard_hit_pct, in_zone_whiff_pct, chase_pct,
             barrel_pct, line_pct, exit_vel, ground_pct, in_zone_pct,
             h_pull_pct, la_10_30_pct, stuff_plus, "90th_vel"`)
    .eq("source_player_id", sourcePlayerId)
    .lt("Season", currentSeason)
    .order("Season", { ascending: false });

  if (error || !priorSeasons || priorSeasons.length === 0) {
    return passthrough(false);
  }

  const collected: any[] = [currentRow];
  let totalIp = currentIp;
  for (const ps of priorSeasons) {
    const ip = Number((ps as any).IP) || 0;
    if (ip <= 0) continue;
    collected.push(ps);
    totalIp += ip;
    if (totalIp >= PITCHER_IP_THRESHOLD) break;
  }

  if (collected.length === 1) {
    return passthrough(false);
  }

  const values = blendPitcher(collected);
  return {
    combined: true,
    totalIp,
    seasonsUsed: collected.map((c) => Number(c.Season)).sort((a, b) => b - a),
    values,
  };
}

/**
 * Power rating weight to use given combined-stats result.
 * Standard players: 0.7 (scouting is 70%, actuals 30%)
 * Low-sample players (combined was applied): 0.9 (scouting is 90%, actuals 10%)
 *
 * Rationale: when actual stats come from a tiny sample, they're noisy. Lean
 * harder on the more stable underlying scouting/power ratings.
 */
export function powerWeightForResult(combined: boolean): number {
  return combined ? 0.9 : 0.7;
}

/**
 * Infer a class transition (FS/SJ/JS/GR) from how many years a player has
 * been in the system. We use *span from first season to current* (not distinct
 * season count) so a year-out gap still counts. This is a smart default;
 * coaches can manually override on the player profile.
 *
 * Examples assuming current season = 2025:
 *   - First seen 2025 only → 1 year span → FS (FR→SO)
 *   - First seen 2024     → 2 year span → SJ (SO→JR)
 *   - First seen 2023     → 3 year span → JS (JR→SR)
 *   - First seen 2022     → 4 year span → GR (Graduate, redshirt senior, etc.)
 *
 * Edge cases:
 *   - JUCO transfers / international players showing first D1 year will look
 *     like freshmen even if they're juniors. No way to detect from data alone;
 *     coaches must override manually.
 *   - True walk-ons or grayshirts who appear briefly years ago and then come
 *     back will look "older" than they are.
 */
export type InferredClass = "FS" | "SJ" | "JS" | "GR";

export async function inferClassTransition(
  sourcePlayerId: string | null,
  currentSeason: number,
): Promise<InferredClass | null> {
  if (!sourcePlayerId) return null;

  // Look for the earliest season this source_player_id appears in across BOTH
  // Hitter Master and Pitching Master (covers two-way players too).
  const [hitterRes, pitcherRes] = await Promise.all([
    supabase
      .from("Hitter Master")
      .select("Season")
      .eq("source_player_id", sourcePlayerId)
      .order("Season", { ascending: true })
      .limit(1),
    supabase
      .from("Pitching Master")
      .select("Season")
      .eq("source_player_id", sourcePlayerId)
      .order("Season", { ascending: true })
      .limit(1),
  ]);

  const candidates: number[] = [];
  if (hitterRes.data?.[0]?.Season != null) candidates.push(Number(hitterRes.data[0].Season));
  if (pitcherRes.data?.[0]?.Season != null) candidates.push(Number(pitcherRes.data[0].Season));
  if (candidates.length === 0) return null;

  const firstSeason = Math.min(...candidates);
  const span = currentSeason - firstSeason + 1; // 2025 - 2024 + 1 = 2

  if (span <= 1) return "FS";
  if (span === 2) return "SJ";
  if (span === 3) return "JS";
  return "GR";
}
