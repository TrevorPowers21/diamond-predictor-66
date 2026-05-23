// Canonical depth-role math + WAR/market-value formulas.
//
// Replaces duplicated inline implementations that lived in TeamBuilder.tsx,
// PitcherProfile.tsx, ReturningPlayers.tsx, PitchingStatsStorageTable.tsx,
// pitcherProjection.ts, and transferPitcherProjection.ts. Every site now
// imports from here so the math can only change in one place.
//
// Hitter depth role → multiplier on oWAR (scales playing-time contribution).
// Pitcher depth role → expected IP fed into the pWAR formula.

import type { PitchingEquationWeights } from "@/lib/pitchingEquations";

// ── Types ────────────────────────────────────────────────────────────────────

export type HitterDepthRole =
  | "cornerstone"
  | "everyday_starter"
  | "platoon_starter"
  | "utility"
  | "bench"
  | "starter"; // legacy

export type PitcherDepthRole =
  | "weekend_starter"
  | "weekday_starter"
  | "swing_starter"
  | "workhorse_reliever"
  | "high_leverage_reliever"
  | "mid_leverage_reliever"
  | "low_impact_reliever"
  | "specialist_reliever";

export type AnyDepthRole = HitterDepthRole | PitcherDepthRole | null | undefined;

export type ProjectedPitcherRole = "SP" | "RP" | "SM";

// ── Hitter depth role multiplier on oWAR ────────────────────────────────────
//
// Scales the base oWAR (from wRC+ × PA) by playing-time tier. Quality is
// already baked into wRC+; this just allocates how much of the season the
// player is on the field.

export function hitterDepthRoleMultiplier(role: AnyDepthRole): number {
  switch (role) {
    case "cornerstone":      return 1.15;
    case "everyday_starter": return 1.0;
    case "platoon_starter":  return 0.7;
    case "utility":          return 0.4;
    case "bench":            return 0.15;
    // starter (legacy) + pitcher roles + nullish → 1.0 (neutral fallback)
    default:                 return 1.0;
  }
}

// ── Pitcher depth role → expected IP ────────────────────────────────────────
//
// Drives the IP term inside the pWAR formula. SP roles use equation-weight
// constants; RP/SM tiers are tuned to typical D1 usage.

export function pitcherExpectedIp(
  depthRole: AnyDepthRole,
  eq: Pick<PitchingEquationWeights, "pwar_ip_sp" | "pwar_ip_sm" | "pwar_ip_rp">,
): number {
  switch (depthRole) {
    case "weekend_starter":        return eq.pwar_ip_sp;  // ~80 IP — Fri/Sat/Sun
    case "weekday_starter":        return eq.pwar_ip_sm;  // ~50 IP — midweek SP
    case "swing_starter":          return 30;             // long relief / spot start
    case "workhorse_reliever":     return 50;             // closer/setup workhorse
    case "high_leverage_reliever": return 33;             // primary setup
    case "mid_leverage_reliever":  return 20;             // middle relief
    case "low_impact_reliever":    return 12;             // mop-up
    case "specialist_reliever":    return 6;              // LOOGY/situational
    default:                       return eq.pwar_ip_rp;  // RP fallback
  }
}

// Pitcher depth roles bucket into one of three projected-role categories
// (SP / RP / SM) used by other parts of the engine (role transition math,
// market-value PVF lookup, etc.). Default → RP when unknown.
export function pitcherRoleFromDepthRole(depthRole: AnyDepthRole): ProjectedPitcherRole {
  switch (depthRole) {
    case "weekend_starter":
    case "weekday_starter":
      return "SP";
    case "swing_starter":
      return "SM";
    case "workhorse_reliever":
    case "high_leverage_reliever":
    case "mid_leverage_reliever":
    case "low_impact_reliever":
    case "specialist_reliever":
      return "RP";
    default:
      return "RP";
  }
}

// ── pWAR — single canonical formula ─────────────────────────────────────────
//
// pitcherValue   = (pRV+ − 100) / 100
// pWAR           = ((pitcherValue × IP/9 × r_per_9) + (IP/9 × replacement_runs))
//                  / runs_per_win
//
// Returns null when inputs are missing/invalid so callers can keep them out
// of leaderboards instead of showing 0.

export function computePitcherWar(
  pRvPlus: number | null | undefined,
  projectedIp: number | null | undefined,
  eq: Pick<PitchingEquationWeights, "pwar_r_per_9" | "pwar_replacement_runs_per_9" | "pwar_runs_per_win">,
): number | null {
  if (pRvPlus == null || !Number.isFinite(pRvPlus)) return null;
  if (projectedIp == null || !Number.isFinite(projectedIp) || projectedIp <= 0) return null;
  if (!eq.pwar_runs_per_win || eq.pwar_runs_per_win === 0) return null;
  const pitcherValue = (pRvPlus - 100) / 100;
  const innings = projectedIp / 9;
  return (
    ((pitcherValue * innings * eq.pwar_r_per_9) + (innings * eq.pwar_replacement_runs_per_9))
    / eq.pwar_runs_per_win
  );
}

// ── Market value — single canonical formula ─────────────────────────────────
//
// market_value = pWAR × $/WAR × program_tier_mult × position_value_mult
// Floors at $0 (negative WAR shouldn't produce negative dollars).
// Returns null when ineligible (e.g., missing team/conference) so callers
// can show "—" instead of $0 (which means a different thing).

import { getProgramTierMultiplierByConference } from "@/lib/nilProgramSpecific";

// Local mirror of the eligibility check that lives privately in
// pitcherProjection.ts + transferPitcherProjection.ts. Independent conference
// has no NIL valuation (no portal market), except Oregon State which is the
// canonical Independent program.
const canShowPitchingMarketValue = (team: string | null | undefined, conference: string | null | undefined) => {
  const conf = String(conference || "").trim().toLowerCase();
  const tm = String(team || "").trim().toLowerCase();
  if (!conf) return false;
  const isIndependent = conf === "independent" || conf.includes("independent");
  if (!isIndependent) return true;
  return tm === "oregon state" || tm.includes("oregon state");
};

// pitcher PVF lookup (Position-Value Factor) — RP gets reliever weight,
// SM (swingman) gets weekday-SP weight, SP gets weekend-SP weight
const getPitchingPvfForRole = (
  role: ProjectedPitcherRole,
  eq: PitchingEquationWeights,
) => (role === "RP" ? eq.market_pvf_reliever : role === "SM" ? eq.market_pvf_weekday_sp : eq.market_pvf_weekend_sp);

export function computePitcherMarketValue(
  pWar: number | null | undefined,
  ctx: {
    conference: string | null;
    role: ProjectedPitcherRole;
    team: string | null;
  },
  eq: PitchingEquationWeights,
): number | null {
  if (pWar == null || !Number.isFinite(pWar)) return null;
  if (!canShowPitchingMarketValue(ctx.team, ctx.conference)) return null;
  const tiers = {
    sec: eq.market_tier_sec,
    p4: eq.market_tier_acc_big12,
    bigTen: eq.market_tier_big_ten,
    strongMid: eq.market_tier_strong_mid,
    lowMajor: eq.market_tier_low_major,
  };
  const ptm = getProgramTierMultiplierByConference(ctx.conference, tiers);
  const pvm = getPitchingPvfForRole(ctx.role, eq);
  const raw = pWar * eq.market_dollars_per_war * ptm * pvm;
  return Math.max(0, raw);
}
