// Shared pitcher-transfer input builder.
//
// Mirrors src/lib/buildTransferProjectionInputs.ts (hitter version) so the
// interactive TransferPortal / TeamBuilder pages and the eager pre-compute
// script (scripts/precompute-pitchers.ts) never drift on equation inputs,
// JUCO district overrides, park resolution, conference resolution, or
// class transition + dev aggressiveness post-processing.
//
// Pure: no React, no Supabase, no localStorage. Caller supplies resolver
// callbacks + already-loaded equation values + already-loaded pitching
// master / power-rating rows for the player.

import type { PitchingEquationWeights } from "@/lib/pitchingEquations";
import {
  JUCO_PITCHING_TRANSFER_WEIGHTS,
  JUCO_DISTRICT_HTP_OVERRIDE,
  JUCO_DISTRICT_CONFERENCE_ID,
  jucoDistrictNameFromConference,
} from "@/lib/transferWeightDefaults";
import {
  computeTransferPitcherProjection,
  type TransferPitcherInput,
  type TransferPitcherResult,
} from "@/lib/transferPitcherProjection";
import {
  computePitcherWar,
  computePitcherMarketValue,
  pitcherExpectedIp,
} from "@/lib/depthRoles";

// ---------- shapes ----------

export type PitcherTransferPlayer = {
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  conference?: string | null;
  division?: string | null;
  team?: string | null;
  team_id?: string | null;
  source_player_id?: string | null;
  class_transition?: string | null;
  dev_aggressiveness?: number | null;
};

export type PitcherTeamRow = {
  id: string;
  name: string;
  conference?: string | null;
  conference_id?: string | null;
};

// Stats expected from Pitching Master (post-blend per usePitchingSeedData)
export type PitcherStatsRow = {
  role: string | null;
  g: number | null;
  gs: number | null;
  ip: number | null;
  era: number | null;
  fip: number | null;
  whip: number | null;
  k9: number | null;
  bb9: number | null;
  hr9: number | null;
  teamId?: string | null;
};

// Stored PR+ values (Pitching Master.*_pr_plus columns)
export type PitcherPowerRow = {
  eraPrPlus: number | null;
  fipPrPlus: number | null;
  whipPrPlus: number | null;
  k9PrPlus: number | null;
  bb9PrPlus: number | null;
  hr9PrPlus: number | null;
} | null;

export type PitchingConfStats = {
  conference?: string | null;
  era_plus: number | null;
  fip_plus: number | null;
  whip_plus: number | null;
  k9_plus: number | null;
  bb9_plus: number | null;
  hr9_plus: number | null;
  hitter_talent_plus: number | null;
} | null;

export type BuildPitcherInputsArgs = {
  player: PitcherTransferPlayer;

  fromTeam: PitcherTeamRow | null;
  toTeam: PitcherTeamRow;
  fromConference: string | null;
  fromConferenceId?: string | null;
  toConference: string | null;
  toConferenceId?: string | null;

  pitchingStats: PitcherStatsRow | null;
  pitcherPowerRatings: PitcherPowerRow;

  // Caller wires these to its data source. lookupPitchingConfStats should
  // implement the same multi-alias + conference_id fallback TB uses.
  resolvePitchingConfStats: (conf: string | null, confId?: string | null) => PitchingConfStats;
  resolveParkFactor: (
    teamId: string | null | undefined,
    names: Array<string | null | undefined>,
    metric: "era" | "whip" | "hr9",
  ) => number | null;

  pitchingEq: PitchingEquationWeights;
};

export type BuildPitcherInputsResult =
  | { blocked: true; blockedReason: "no_stats" | "no_power" | "no_from_conf" | "no_to_conf"; missingInputs?: string[] }
  | {
      blocked: false;
      input: TransferPitcherInput;
      ctx: { eq: PitchingEquationWeights };
      effEq: PitchingEquationWeights;
      baseRole: "SP" | "RP" | "SM" | null;
      isJucoSource: boolean;
    };

// ---------- helpers ----------

const toPitchingRoleSafe = (raw: string | null | undefined): "SP" | "RP" | "SM" | null => {
  const v = String(raw || "").trim().toUpperCase();
  if (v === "SP" || v === "RP" || v === "SM") return v;
  return null;
};

const deriveBaseRole = (stats: PitcherStatsRow): "SP" | "RP" | "SM" | null => {
  const r = toPitchingRoleSafe(stats.role);
  if (r) return r;
  const g = Number(stats.g) || 0;
  const gs = Number(stats.gs) || 0;
  if (g > 0 && gs != null) return (gs / g) < 0.5 ? "RP" : "SP";
  return null;
};

const detectJucoPitcherSource = (player: PitcherTransferPlayer): boolean => {
  if (player.division === "NJCAA_D1") return true;
  if (/^NJCAA D1/i.test(String(player.conference || ""))) return true;
  return false;
};

// ---------- main entry ----------

export function buildTransferPitcherInputs(args: BuildPitcherInputsArgs): BuildPitcherInputsResult {
  const {
    player,
    fromTeam,
    toTeam,
    fromConference,
    fromConferenceId,
    toConference,
    toConferenceId,
    pitchingStats,
    pitcherPowerRatings,
    resolvePitchingConfStats,
    resolveParkFactor,
    pitchingEq,
  } = args;

  const isJucoSource = detectJucoPitcherSource(player);

  if (!pitchingStats) {
    return { blocked: true, blockedReason: "no_stats" };
  }
  // JUCO source: PR+ isn't used (power weights = 0), so null is OK.
  if (!pitcherPowerRatings && !isJucoSource) {
    return { blocked: true, blockedReason: "no_power" };
  }

  const baseRole = deriveBaseRole(pitchingStats);

  // JUCO source: resolve from-conference via hardcoded district → conference_id
  // map so we hit the UUID-indexed conference entry directly.
  const jucoFromConfId = isJucoSource
    ? (JUCO_DISTRICT_CONFERENCE_ID[jucoDistrictNameFromConference(fromConference) ?? ""] ?? null)
    : null;

  const fromPC = resolvePitchingConfStats(fromConference, fromConferenceId ?? jucoFromConfId);
  const toPC = resolvePitchingConfStats(toConference, toConferenceId ?? null);
  if (!fromPC) return { blocked: true, blockedReason: "no_from_conf" };
  if (!toPC) return { blocked: true, blockedReason: "no_to_conf" };

  // JUCO source: swap weight set + override hitter_talent_plus per district.
  const effEq: PitchingEquationWeights = isJucoSource
    ? { ...pitchingEq, ...JUCO_PITCHING_TRANSFER_WEIGHTS }
    : pitchingEq;
  const jucoDistrict = isJucoSource
    ? (fromConference ?? "").replace(/^NJCAA D1 /, "").replace(/ District$/, "")
    : null;
  const effFromHitterTalent = isJucoSource
    ? (JUCO_DISTRICT_HTP_OVERRIDE[jucoDistrict ?? ""] ?? null)
    : (fromPC.hitter_talent_plus ?? null);

  const input: TransferPitcherInput = {
    era: pitchingStats.era ?? null,
    fip: pitchingStats.fip ?? null,
    whip: pitchingStats.whip ?? null,
    k9: pitchingStats.k9 ?? null,
    bb9: pitchingStats.bb9 ?? null,
    hr9: pitchingStats.hr9 ?? null,
    storedPrPlus: {
      era: pitcherPowerRatings?.eraPrPlus ?? null,
      fip: pitcherPowerRatings?.fipPrPlus ?? null,
      whip: pitcherPowerRatings?.whipPrPlus ?? null,
      k9: pitcherPowerRatings?.k9PrPlus ?? null,
      bb9: pitcherPowerRatings?.bb9PrPlus ?? null,
      hr9: pitcherPowerRatings?.hr9PrPlus ?? null,
    },
    baseRole,
    fromEraPlus: fromPC.era_plus ?? null,
    toEraPlus: toPC.era_plus ?? null,
    fromFipPlus: fromPC.fip_plus ?? null,
    toFipPlus: toPC.fip_plus ?? null,
    fromWhipPlus: fromPC.whip_plus ?? null,
    toWhipPlus: toPC.whip_plus ?? null,
    fromK9Plus: fromPC.k9_plus ?? null,
    toK9Plus: toPC.k9_plus ?? null,
    fromBb9Plus: fromPC.bb9_plus ?? null,
    toBb9Plus: toPC.bb9_plus ?? null,
    fromHr9Plus: fromPC.hr9_plus ?? null,
    toHr9Plus: toPC.hr9_plus ?? null,
    fromHitterTalent: effFromHitterTalent,
    toHitterTalent: toPC.hitter_talent_plus ?? null,
    fromEraParkRaw: resolveParkFactor(fromTeam?.id, [player.team, fromTeam?.name], "era"),
    toEraParkRaw: resolveParkFactor(toTeam.id, [toTeam.name], "era"),
    fromWhipParkRaw: resolveParkFactor(fromTeam?.id, [player.team, fromTeam?.name], "whip"),
    toWhipParkRaw: resolveParkFactor(toTeam.id, [toTeam.name], "whip"),
    fromHr9ParkRaw: resolveParkFactor(fromTeam?.id, [player.team, fromTeam?.name], "hr9"),
    toHr9ParkRaw: resolveParkFactor(toTeam.id, [toTeam.name], "hr9"),
    toTeam: toTeam.name,
    toConference,
  };

  return {
    blocked: false,
    input,
    ctx: { eq: effEq },
    effEq,
    baseRole,
    isJucoSource,
  };
}

// ---------- postprocess: class adj + dev aggressiveness ----------
//
// Mirrors TeamBuilder.tsx pitcher branch (lines ~3346-3404) — applies class
// transition + dev aggressiveness multipliers to the projected rates and
// recomputes pRV+ from the adjusted rates.

const toPitchingClassAdj = (
  classTransition: "FS" | "SJ" | "JS" | "GR",
  fs: number,
  sj: number,
  js: number,
  gr: number,
) => {
  const pct = classTransition === "FS" ? fs : classTransition === "SJ" ? sj : classTransition === "JS" ? js : gr;
  return Number.isFinite(pct) ? pct / 100 : 0;
};

const calcPitchingPlus = (
  value: number | null,
  ncaaAvg: number,
  ncaaSd: number,
  scale: number,
  higherIsBetter = false,
) => {
  if (value == null || !Number.isFinite(value) || !Number.isFinite(ncaaAvg) || !Number.isFinite(ncaaSd) || ncaaSd === 0) return null;
  const core = higherIsBetter ? ((value - ncaaAvg) / ncaaSd) : ((ncaaAvg - value) / ncaaSd);
  const raw = 100 + (core * scale);
  return Number.isFinite(raw) ? raw : null;
};

export type PitcherTransferFinal = {
  p_era: number | null;
  p_fip: number | null;
  p_whip: number | null;
  p_k9: number | null;
  p_bb9: number | null;
  p_hr9: number | null;
  p_rv_plus: number | null;
  p_war: number | null;
  market_value: number | null;
  pitcher_role: "SP" | "RP" | "SM";
};

export function applyTransferPitcherPostprocess(
  result: TransferPitcherResult,
  args: {
    classTransition: string | null;
    devAggressiveness: number | null;
    isJucoSource: boolean;
    pitchingEq: PitchingEquationWeights;
    // Conference + team needed to re-derive market_value from the postprocessed
    // pRV+. Optional for backward compatibility — callers that don't pass them
    // get the pre-postprocess market_value (legacy behavior).
    toConference?: string | null;
    toTeam?: string | null;
  },
): PitcherTransferFinal {
  const { isJucoSource, pitchingEq } = args;

  const classKey = String(args.classTransition || "SJ").toUpperCase();
  const pitcherClassTransition: "FS" | "SJ" | "JS" | "GR" = isJucoSource
    ? "SJ"
    : (classKey === "FS" || classKey === "SJ" || classKey === "JS" || classKey === "GR"
        ? (classKey as "FS" | "SJ" | "JS" | "GR")
        : "SJ");
  const pitcherDevAgg = isJucoSource
    ? 0
    : (Number.isFinite(Number(args.devAggressiveness)) ? Number(args.devAggressiveness) : 0);

  const classEraAdj = isJucoSource ? 0 : toPitchingClassAdj(pitcherClassTransition, pitchingEq.class_era_fs, pitchingEq.class_era_sj, pitchingEq.class_era_js, pitchingEq.class_era_gr);
  const classFipAdj = isJucoSource ? 0 : toPitchingClassAdj(pitcherClassTransition, pitchingEq.class_fip_fs, pitchingEq.class_fip_sj, pitchingEq.class_fip_js, pitchingEq.class_fip_gr);
  const classWhipAdj = isJucoSource ? 0 : toPitchingClassAdj(pitcherClassTransition, pitchingEq.class_whip_fs, pitchingEq.class_whip_sj, pitchingEq.class_whip_js, pitchingEq.class_whip_gr);
  const classK9Adj = isJucoSource ? 0 : toPitchingClassAdj(pitcherClassTransition, pitchingEq.class_k9_fs, pitchingEq.class_k9_sj, pitchingEq.class_k9_js, pitchingEq.class_k9_gr);
  const classBb9Adj = isJucoSource ? 0 : toPitchingClassAdj(pitcherClassTransition, pitchingEq.class_bb9_fs, pitchingEq.class_bb9_sj, pitchingEq.class_bb9_js, pitchingEq.class_bb9_gr);
  const classHr9Adj = isJucoSource ? 0 : toPitchingClassAdj(pitcherClassTransition, pitchingEq.class_hr9_fs, pitchingEq.class_hr9_sj, pitchingEq.class_hr9_js, pitchingEq.class_hr9_gr);
  const pitcherLowMult = (adj: number) => 1 - adj - (pitcherDevAgg * 0.06);
  const pitcherHighMult = (adj: number) => 1 + adj + (pitcherDevAgg * 0.06);

  const adjEra = result.p_era == null ? null : result.p_era * pitcherLowMult(classEraAdj);
  const adjFip = result.p_fip == null ? null : result.p_fip * pitcherLowMult(classFipAdj);
  const adjWhip = result.p_whip == null ? null : result.p_whip * pitcherLowMult(classWhipAdj);
  const adjK9 = result.p_k9 == null ? null : result.p_k9 * pitcherHighMult(classK9Adj);
  const adjBb9 = result.p_bb9 == null ? null : result.p_bb9 * pitcherLowMult(classBb9Adj);
  const adjHr9 = result.p_hr9 == null ? null : result.p_hr9 * pitcherLowMult(classHr9Adj);

  const eraPlusAdj = calcPitchingPlus(adjEra, pitchingEq.era_plus_ncaa_avg, pitchingEq.era_plus_ncaa_sd, pitchingEq.era_plus_scale, false);
  const fipPlusAdj = calcPitchingPlus(adjFip, pitchingEq.fip_plus_ncaa_avg, pitchingEq.fip_plus_ncaa_sd, pitchingEq.fip_plus_scale, false);
  const whipPlusAdj = calcPitchingPlus(adjWhip, pitchingEq.whip_plus_ncaa_avg, pitchingEq.whip_plus_ncaa_sd, pitchingEq.whip_plus_scale, false);
  const k9PlusAdj = calcPitchingPlus(adjK9, pitchingEq.k9_plus_ncaa_avg, pitchingEq.k9_plus_ncaa_sd, pitchingEq.k9_plus_scale, true);
  const bb9PlusAdj = calcPitchingPlus(adjBb9, pitchingEq.bb9_plus_ncaa_avg, pitchingEq.bb9_plus_ncaa_sd, pitchingEq.bb9_plus_scale, false);
  const hr9PlusAdj = calcPitchingPlus(adjHr9, pitchingEq.hr9_plus_ncaa_avg, pitchingEq.hr9_plus_ncaa_sd, pitchingEq.hr9_plus_scale, false);

  const pRvPlusAdj = [eraPlusAdj, fipPlusAdj, whipPlusAdj, k9PlusAdj, bb9PlusAdj, hr9PlusAdj].every((v) => v != null)
    ? (Number(eraPlusAdj) * pitchingEq.era_plus_weight) +
      (Number(fipPlusAdj) * pitchingEq.fip_plus_weight) +
      (Number(whipPlusAdj) * pitchingEq.whip_plus_weight) +
      (Number(k9PlusAdj) * pitchingEq.k9_plus_weight) +
      (Number(bb9PlusAdj) * pitchingEq.bb9_plus_weight) +
      (Number(hr9PlusAdj) * pitchingEq.hr9_plus_weight)
    : result.p_rv_plus;

  // pRV+ drives pWAR; pWAR drives market value. Re-derive both from the
  // postprocessed pRV+ so the stored (p_rv_plus, p_war, market_value) triple
  // is internally consistent. Falls back to result.p_war / market_value when
  // pRvPlusAdj is null or when caller didn't supply conference/team context.
  const projectedIpForRole =
    result.projected_role === "SP" ? pitchingEq.pwar_ip_sp
      : result.projected_role === "RP" ? pitchingEq.pwar_ip_rp
      : pitchingEq.pwar_ip_sm;
  const recomputedPWar = pRvPlusAdj != null
    ? computePitcherWar(pRvPlusAdj, projectedIpForRole, pitchingEq)
    : result.p_war;
  const recomputedMarketValue = (recomputedPWar != null && args.toConference !== undefined && args.toTeam !== undefined)
    ? computePitcherMarketValue(
        recomputedPWar,
        { conference: args.toConference, role: result.projected_role, team: args.toTeam },
        pitchingEq,
      )
    : result.market_value;

  return {
    p_era: adjEra,
    p_fip: adjFip,
    p_whip: adjWhip,
    p_k9: adjK9,
    p_bb9: adjBb9,
    p_hr9: adjHr9,
    p_rv_plus: pRvPlusAdj,
    p_war: recomputedPWar,
    market_value: recomputedMarketValue,
    pitcher_role: result.projected_role,
  };
}

// Re-export computeTransferPitcherProjection for caller convenience so the
// script needs a single import for the full pipeline.
export { computeTransferPitcherProjection };
