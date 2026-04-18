import { useCallback, useMemo, useState } from "react";
import { DEMO_SCHOOL } from "@/lib/demoSchool";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { computeTransferProjection } from "@/lib/transferProjection";
import {
  DEFAULT_NIL_TIER_MULTIPLIERS,
  getPositionValueMultiplier,
  getProgramTierMultiplierByConference,
} from "@/lib/nilProgramSpecific";
import { getConferenceAliases } from "@/lib/conferenceMapping";
import { profileRouteFor } from "@/lib/profileRoutes";
import { useHitterSeedData } from "@/hooks/useHitterSeedData";
import { resolveMetricParkFactor, type ParkFactorsMap } from "@/lib/parkFactors";
import { useParkFactors } from "@/hooks/useParkFactors";
import { useTeamsTable } from "@/hooks/useTeamsTable";
import { useConferenceStats } from "@/hooks/useConferenceStats";
import { usePitchingSeedData } from "@/hooks/usePitchingSeedData";
import { readPitchingWeights } from "@/lib/pitchingEquations";
import { computeHitterPowerRatings } from "@/lib/powerRatings";
import { TRANSFER_WEIGHT_DEFAULTS } from "@/lib/transferWeightDefaults";

/* ─── shared types ─── */
type TeamRow = { id?: string; name: string; conference: string | null; conference_id?: string | null; park_factor: number | null; source_team_id?: string | null };
type HitterConfRow = { conference: string; season: number | null; avg_plus: number | null; obp_plus: number | null; iso_plus: number | null; stuff_plus: number | null };
type SeedRow = { playerName: string; team: string | null; avg: number | null; obp: number | null; slg: number | null };
type PredictionInternal = { prediction_id: string; avg_power_rating: number | null; obp_power_rating: number | null; slg_power_rating: number | null };

type PlayerLite = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  team: string | null;
  from_team: string | null;
  conference: string | null;
  player_predictions: Array<{
    id: string;
    from_avg: number | null;
    from_obp: number | null;
    from_slg: number | null;
    model_type: string | null;
    variant: string | null;
    status: string | null;
    updated_at: string | null;
  }>;
};

type PitchingStorageRow = {
  id: string;
  player_name: string;
  team: string | null;
  teamId: string | null;
  conference: string | null;
  conferenceId: string | null;
  handedness: string | null;
  role: "SP" | "RP" | "SM" | null;
  era: number | null;
  fip: number | null;
  whip: number | null;
  k9: number | null;
  bb9: number | null;
  hr9: number | null;
};

type PitchingPowerSnapshot = {
  eraPrPlus: number | null;
  fipPrPlus: number | null;
  whipPrPlus: number | null;
  k9PrPlus: number | null;
  hr9PrPlus: number | null;
  bb9PrPlus: number | null;
};

type PitchingConfEntry = {
  conference: string;
  era_plus: number | null;
  fip_plus: number | null;
  whip_plus: number | null;
  k9_plus: number | null;
  bb9_plus: number | null;
  hr9_plus: number | null;
  hitter_talent_plus: number | null;
};

/* ─── helpers ─── */
const normalizeKey = (value: string | null | undefined) =>
  (value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const normalizeCompact = (value: string | null | undefined) =>
  (value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const normalizeName = (value: string | null | undefined) =>
  (value || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const toRate = (n: number) => (Math.abs(n) > 1 ? n / 100 : n);
const toWeight = (n: number) => (Math.abs(n) >= 10 ? n / 100 : n);
const normalizeParkToIndex = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return 100;
  return Math.abs(n) <= 3 ? n * 100 : n;
};
const statKey = (v: number | null | undefined) => (v == null ? "na" : round3(v).toFixed(3));
const stat = (v: number | null | undefined, d = 3) => (v == null ? "-" : v.toFixed(d));
const whole = (v: number | null | undefined) => (v == null ? "-" : Math.round(v).toString());
const money = (v: number | null | undefined) => (v == null ? "-" : `$${Math.round(v).toLocaleString("en-US")}`);

const isPitcherPosition = (pos: string | null | undefined) =>
  /^(SP|RP|CL|P|LHP|RHP|TWP)/i.test(String(pos || ""));

const toPitchingRole = (raw: string | null | undefined): "SP" | "RP" | "SM" | null => {
  const v = String(raw || "").trim().toUpperCase();
  if (v === "SP" || v === "RP" || v === "SM") return v;
  return null;
};

const canonicalConferencePitching = (value: string | null | undefined) => {
  const k = normalizeKey(value);
  if (!k) return "";
  const compact = k.replace(/\s+/g, "");
  if (k === "acc" || k.includes("atlantic coast")) return "acc";
  if (k === "sec" || k.includes("southeastern")) return "sec";
  if (k === "aac" || k.includes("american athletic")) return "american athletic conference";
  if (k === "a 10" || k === "a10" || k === "a-10" || k.includes("atlantic 10") || compact === "atlantic10") return "atlantic 10";
  if (k === "caa" || k.includes("coastal athletic")) return "coastal athletic association";
  if (k === "mwc" || k.includes("mountain west")) return "mountain west";
  if (k === "mac" || k.includes("mid american")) return "mid american conference";
  if (k.includes("america east") || k.includes("american east")) return "american east";
  if (k.includes("big ten") || k === "big 10" || k === "big10") return "big ten";
  if (k.includes("big 12") || k === "big12") return "big 12";
  return k;
};

const selectPreferredPrediction = (predictions: PlayerLite["player_predictions"] | null | undefined) => {
  const list = (predictions || []).filter(Boolean);
  if (!list.length) return null;
  const rank = (row: any) => {
    const hasFrom = row.from_avg != null || row.from_obp != null || row.from_slg != null;
    const statusBoost = row.status === "active" ? 2 : row.status === "departed" ? 1 : 0;
    const modelMatchBoost = row.model_type === "transfer" ? 4 : 0;
    const variantBoost = row.variant === "regular" ? 3 : 0;
    return modelMatchBoost + variantBoost + (row.model_type === "transfer" ? 3 : 1) + (hasFrom ? 2 : 0) + statusBoost;
  };
  return [...list].sort((a, b) => {
    const diff = rank(b) - rank(a);
    if (diff !== 0) return diff;
    return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
  })[0] ?? null;
};

const resolveTeamRowFromCandidates = (
  candidates: Array<string | null | undefined>,
  teamByKey: Map<string, TeamRow>,
  allTeams: TeamRow[],
) => {
  const cleaned = candidates.map((c) => String(c || "").trim()).filter(Boolean);
  for (const c of cleaned) {
    const exact = teamByKey.get(normalizeKey(c));
    if (exact) return exact;
  }
  for (const c of cleaned) {
    const compactCandidate = normalizeCompact(c);
    if (!compactCandidate) continue;
    const found = allTeams.find((t) => normalizeCompact(t.name) === compactCandidate);
    if (found) return found;
  }
  return null;
};

const resolveParkFactorFromCandidates = (
  teamId: string | null | undefined,
  names: Array<string | null | undefined>,
  metric: "avg" | "obp" | "iso" | "era" | "whip" | "hr9",
  map: ParkFactorsMap,
) => {
  if (teamId) {
    const v = resolveMetricParkFactor(teamId, metric, map);
    if (v != null && Number.isFinite(v)) return v;
  }
  for (const name of names) {
    const v = resolveMetricParkFactor(null, metric, map, name);
    if (v != null && Number.isFinite(v)) return v;
  }
  return resolveMetricParkFactor(null, metric, map, names[0] || null);
};

const calcPitchingPlus = (
  statValue: number | null,
  ncaaAvg: number,
  ncaaSd: number,
  scale: number,
  higherIsBetter = false,
) => {
  if (statValue == null || !Number.isFinite(statValue) || !Number.isFinite(ncaaAvg) || !Number.isFinite(ncaaSd) || ncaaSd === 0) return null;
  const z = higherIsBetter ? ((statValue - ncaaAvg) / ncaaSd) : ((ncaaAvg - statValue) / ncaaSd);
  return round3(100 + (z * scale));
};

const calcHitterTalentPlusFromConference = (
  overallHitterPowerRatingPlus: number | null | undefined,
  stuffPlus: number | null | undefined,
  wrcPlus: number | null | undefined,
) => {
  if (overallHitterPowerRatingPlus == null || !Number.isFinite(overallHitterPowerRatingPlus) ||
    stuffPlus == null || !Number.isFinite(stuffPlus) ||
    wrcPlus == null || !Number.isFinite(wrcPlus)) return null;
  const value = overallHitterPowerRatingPlus + (1.25 * (stuffPlus - 100)) + (0.75 * (100 - wrcPlus));
  return Number.isFinite(value) ? Number(value.toFixed(1)) : null;
};

const applyRoleTransitionAdjustment = (
  value: number | null,
  pct: number,
  fromRole: "SP" | "RP" | "SM" | null,
  toRole: "SP" | "RP" | "SM" | null,
  lowerIsBetter: boolean,
  rpToSpLowBetterCurve?: { tier1Max: number; tier2Max: number; tier3Max: number; tier1Mult: number; tier2Mult: number; tier3Mult: number },
) => {
  if (value == null || !Number.isFinite(value)) return null;
  if (!fromRole || !toRole || fromRole === toRole) return value;
  const rank: Record<"SP" | "SM" | "RP", number> = { SP: 0, SM: 1, RP: 2 };
  const step = rank[toRole] - rank[fromRole];
  if (step === 0) return value;
  const movingTowardStarter = rank[toRole] < rank[fromRole];
  const starterRegressionBoost = (() => {
    if (!movingTowardStarter) return 1;
    if (lowerIsBetter) {
      const c = rpToSpLowBetterCurve;
      if (!c) return 1;
      if (value <= c.tier1Max) return c.tier1Mult;
      if (value <= c.tier2Max) return c.tier2Mult;
      if (value <= c.tier3Max) return c.tier3Mult;
      return 1.0;
    }
    return 1.0;
  })();
  const pctMagnitude = Math.abs(pct);
  const factor = 1 + ((pctMagnitude / 100) * (Math.abs(step) / 2) * starterRegressionBoost);
  if (!Number.isFinite(factor) || factor <= 0) return value;
  if (lowerIsBetter) {
    return step > 0 ? value / factor : value * factor;
  }
  return step > 0 ? value * factor : value / factor;
};

const getPitchingPvfForRole = (role: "SP" | "RP" | "SM", eq: ReturnType<typeof readPitchingWeights>) =>
  role === "RP" ? eq.market_pvf_reliever : role === "SM" ? eq.market_pvf_weekday_sp : eq.market_pvf_weekend_sp;

const canShowPitchingMarketValue = (team: string | null | undefined, conference: string | null | undefined) => {
  const conf = String(conference || "").trim().toLowerCase();
  const tm = String(team || "").trim().toLowerCase();
  if (!conf) return false;
  const isIndependent = conf === "independent" || conf.includes("independent");
  if (!isIndependent) return true;
  return tm === "oregon state" || tm.includes("oregon state");
};

function readLocalNum(key: string, fallback: number, remoteValues?: Record<string, number>): number {
  // 1) Supabase model_config is the authority
  const remote = remoteValues?.[key];
  if (Number.isFinite(remote)) return Number(remote);
  // 2) Canonical default from transferWeightDefaults
  const canonical = (TRANSFER_WEIGHT_DEFAULTS as Record<string, number>)[key];
  if (canonical !== undefined) return canonical;
  return fallback;
}

/* ─── tier styling ─── */
const tierStyle = (tier: "good" | "avg" | "bad") => {
  if (tier === "good") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700";
  if (tier === "avg") return "border-amber-500/40 bg-amber-500/10 text-amber-700";
  return "border-rose-500/40 bg-rose-500/10 text-rose-700";
};
const hitterStatTier = (key: "avg" | "obp" | "slg" | "ops" | "iso" | "wrc_plus" | "owar" | "nil", value: number | null | undefined): "good" | "avg" | "bad" => {
  if (value == null) return "avg";
  if (key === "avg") return value >= 0.3 ? "good" : value >= 0.26 ? "avg" : "bad";
  if (key === "obp") return value >= 0.4 ? "good" : value >= 0.34 ? "avg" : "bad";
  if (key === "slg") return value >= 0.5 ? "good" : value >= 0.42 ? "avg" : "bad";
  if (key === "ops") return value >= 0.9 ? "good" : value >= 0.76 ? "avg" : "bad";
  if (key === "iso") return value >= 0.2 ? "good" : value >= 0.14 ? "avg" : "bad";
  if (key === "wrc_plus") return value >= 115 ? "good" : value >= 90 ? "avg" : "bad";
  if (key === "owar") return value > 1.5 ? "good" : value >= 0.5 ? "avg" : "bad";
  return value >= 75000 ? "good" : value >= 25000 ? "avg" : "bad";
};
const tierByNcaaAverage = (value: number | null | undefined, ncaaAvg: number, higherIsBetter: boolean): "good" | "avg" | "bad" => {
  if (value == null || !Number.isFinite(value) || ncaaAvg <= 0) return "avg";
  const goodCut = higherIsBetter ? ncaaAvg * 1.1 : ncaaAvg * 0.9;
  const avgCut = higherIsBetter ? ncaaAvg * 0.9 : ncaaAvg * 1.1;
  if (higherIsBetter) return value >= goodCut ? "good" : value >= avgCut ? "avg" : "bad";
  return value <= goodCut ? "good" : value <= avgCut ? "avg" : "bad";
};

/* ─── hitter simulation (identical to TransferPortal) ─── */
type HitterSimOut = {
  fromTeam: string | null;
  fromConference: string | null;
  toConference: string | null;
  pAvg: number; pObp: number; pSlg: number; pOps: number; pIso: number;
  pWrcPlus: number | null; owar: number | null; nilValuation: number | null;
};

function simulateHitter(args: {
  player: PlayerLite;
  destinationTeam: string;
  prediction: NonNullable<ReturnType<typeof selectPreferredPrediction>>;
  internals: PredictionInternal | null;
  teamByKey: Map<string, TeamRow>;
  confByKey: Map<string, HitterConfRow>;
  seedByPlayerId: Map<string, SeedRow>;
  seedByName: Map<string, SeedRow[]>;
  parkMap: ParkFactorsMap;
  teams: TeamRow[];
  eqNum: (key: string, fallback: number) => number;
  powerByNameTeam: Map<string, any>;
}): HitterSimOut | null {
  const { player, destinationTeam, prediction, internals, teamByKey, confByKey, seedByPlayerId, seedByName, parkMap, teams, eqNum, powerByNameTeam } = args;
  let baPR = internals?.avg_power_rating ?? null;
  let obpPR = internals?.obp_power_rating ?? null;
  let isoPR = internals?.slg_power_rating ?? null;
  const lastAvg = prediction.from_avg;
  const lastObp = prediction.from_obp;
  const lastSlg = prediction.from_slg;
  if (lastAvg == null || lastObp == null || lastSlg == null) return null;

  // Fallback: compute power ratings from seed data if internals are missing
  if (baPR == null || obpPR == null || isoPR == null) {
    const fullName = `${player.first_name || ""} ${player.last_name || ""}`.trim();
    const fromTeamCandidate = player.from_team || player.team || "";
    const nameTeamKey = `${normalizeKey(fullName)}|${normalizeKey(fromTeamCandidate)}`;
    const seedPower = powerByNameTeam.get(nameTeamKey) ?? powerByNameTeam.get(normalizeKey(fullName));
    if (seedPower) {
      const computed = computeHitterPowerRatings({
        contact: seedPower.contact, lineDrive: seedPower.lineDrive,
        avgExitVelo: seedPower.avgExitVelo, popUp: seedPower.popUp,
        bb: seedPower.bb, chase: seedPower.chase,
        barrel: seedPower.barrel, ev90: seedPower.ev90,
        pull: seedPower.pull, la10_30: seedPower.la10_30, gb: seedPower.gb,
      });
      if (baPR == null) baPR = computed.baPlus;
      if (obpPR == null) obpPR = computed.obpPlus;
      if (isoPR == null) isoPR = computed.isoPlus;
    }
  }
  if (baPR == null || obpPR == null || isoPR == null) return null;

  // Resolve from-team by UUID first
  const byId = seedByPlayerId.get(player.id);
  let inferredFromTeam: string | null = byId?.team ?? null;
  if (!inferredFromTeam) {
    const fullName = `${player.first_name || ""} ${player.last_name || ""}`.trim();
    const candidates = seedByName.get(normalizeKey(fullName)) || [];
    if (candidates.length === 1) inferredFromTeam = candidates[0].team;
    else if (candidates.length > 1) {
      const key = `${statKey(lastAvg)}|${statKey(lastObp)}|${statKey(lastSlg)}`;
      const exact = candidates.find((r) => `${statKey(r.avg)}|${statKey(r.obp)}|${statKey(r.slg)}` === key);
      inferredFromTeam = exact?.team || candidates[0].team;
    }
  }

  const fromTeamName = player.from_team || inferredFromTeam || player.team || null;
  const fromTeamRow = resolveTeamRowFromCandidates([fromTeamName], teamByKey, teams);
  const toTeamRow = resolveTeamRowFromCandidates([destinationTeam], teamByKey, teams);
  if (!toTeamRow) return null;

  const resolveConf = (conference: string | null | undefined): HitterConfRow | null => {
    const aliases = getConferenceAliases(conference);
    let best: HitterConfRow | null = null;
    let bestScore = -1;
    const score = (row: HitterConfRow) =>
      (row.avg_plus != null ? 1 : 0) + (row.obp_plus != null ? 1 : 0) + (row.iso_plus != null ? 1 : 0) + (row.stuff_plus != null ? 1 : 0);
    for (const key of aliases) {
      const hit = confByKey.get(key);
      if (!hit) continue;
      const s = score(hit);
      if (s > bestScore) { best = hit; bestScore = s; }
    }
    for (const [k, row] of confByKey.entries()) {
      if (!aliases.some((a) => k.includes(a) || a.includes(k))) continue;
      const s = score(row);
      if (s > bestScore) { best = row; bestScore = s; }
    }
    return best;
  };

  const fromConference = fromTeamRow?.conference || player.conference || null;
  const fromConfStats = resolveConf(fromConference);
  const toConfStats = resolveConf(toTeamRow.conference || null);
  const fromParkAvgRaw = resolveParkFactorFromCandidates(fromTeamRow?.id, [fromTeamName, fromTeamRow?.name], "avg", parkMap);
  const toParkAvgRaw = resolveParkFactorFromCandidates(toTeamRow?.id, [destinationTeam, toTeamRow?.name], "avg", parkMap);
  const fromParkObpRaw = resolveParkFactorFromCandidates(fromTeamRow?.id, [fromTeamName, fromTeamRow?.name], "obp", parkMap);
  const toParkObpRaw = resolveParkFactorFromCandidates(toTeamRow?.id, [destinationTeam, toTeamRow?.name], "obp", parkMap);
  const fromParkIsoRaw = resolveParkFactorFromCandidates(fromTeamRow?.id, [fromTeamName, fromTeamRow?.name], "iso", parkMap);
  const toParkIsoRaw = resolveParkFactorFromCandidates(toTeamRow?.id, [destinationTeam, toTeamRow?.name], "iso", parkMap);
  if (
    !fromConfStats || !toConfStats ||
    fromConfStats.avg_plus == null || toConfStats.avg_plus == null ||
    fromConfStats.obp_plus == null || toConfStats.obp_plus == null ||
    fromConfStats.iso_plus == null || toConfStats.iso_plus == null ||
    fromConfStats.stuff_plus == null || toConfStats.stuff_plus == null ||
    fromParkAvgRaw == null || toParkAvgRaw == null ||
    fromParkObpRaw == null || toParkObpRaw == null ||
    fromParkIsoRaw == null || toParkIsoRaw == null
  ) return null;

  const projected = computeTransferProjection({
    lastAvg, lastObp, lastSlg, baPR, obpPR, isoPR,
    fromAvgPlus: fromConfStats.avg_plus, toAvgPlus: toConfStats.avg_plus,
    fromObpPlus: fromConfStats.obp_plus, toObpPlus: toConfStats.obp_plus,
    fromIsoPlus: fromConfStats.iso_plus, toIsoPlus: toConfStats.iso_plus,
    fromStuff: fromConfStats.stuff_plus, toStuff: toConfStats.stuff_plus,
    fromPark: normalizeParkToIndex(fromParkAvgRaw), toPark: normalizeParkToIndex(toParkAvgRaw),
    fromObpPark: normalizeParkToIndex(fromParkObpRaw), toObpPark: normalizeParkToIndex(toParkObpRaw),
    fromIsoPark: normalizeParkToIndex(fromParkIsoRaw), toIsoPark: normalizeParkToIndex(toParkIsoRaw),
    ncaaAvgBA: toRate(eqNum("t_ba_ncaa_avg", 0.280)),
    ncaaAvgOBP: toRate(eqNum("t_obp_ncaa_avg", 0.385)),
    ncaaAvgISO: toRate(eqNum("t_iso_ncaa_avg", 0.162)),
    ncaaAvgWrc: toRate(eqNum("t_wrc_ncaa_avg", 0.364)),
    baStdPower: eqNum("t_ba_std_pr", 31.297),
    baStdNcaa: toRate(eqNum("t_ba_std_ncaa", 0.043455)),
    obpStdPower: eqNum("t_obp_std_pr", 28.889),
    obpStdNcaa: toRate(eqNum("t_obp_std_ncaa", 0.046781)),
    baPowerWeight: toRate(eqNum("t_ba_power_weight", 0.70)),
    obpPowerWeight: toRate(eqNum("t_obp_power_weight", 0.70)),
    baConferenceWeight: toWeight(eqNum("t_ba_conference_weight", TRANSFER_WEIGHT_DEFAULTS.t_ba_conference_weight)),
    obpConferenceWeight: toWeight(eqNum("t_obp_conference_weight", TRANSFER_WEIGHT_DEFAULTS.t_obp_conference_weight)),
    isoConferenceWeight: toWeight(eqNum("t_iso_conference_weight", TRANSFER_WEIGHT_DEFAULTS.t_iso_conference_weight)),
    baPitchingWeight: toWeight(eqNum("t_ba_pitching_weight", TRANSFER_WEIGHT_DEFAULTS.t_ba_pitching_weight)),
    obpPitchingWeight: toWeight(eqNum("t_obp_pitching_weight", TRANSFER_WEIGHT_DEFAULTS.t_obp_pitching_weight)),
    isoPitchingWeight: toWeight(eqNum("t_iso_pitching_weight", TRANSFER_WEIGHT_DEFAULTS.t_iso_pitching_weight)),
    baParkWeight: toWeight(eqNum("t_ba_park_weight", TRANSFER_WEIGHT_DEFAULTS.t_ba_park_weight)),
    obpParkWeight: toWeight(eqNum("t_obp_park_weight", TRANSFER_WEIGHT_DEFAULTS.t_obp_park_weight)),
    isoParkWeight: toWeight(eqNum("t_iso_park_weight", TRANSFER_WEIGHT_DEFAULTS.t_iso_park_weight)),
    isoStdPower: eqNum("t_iso_std_power", 45.423),
    isoStdNcaa: toRate(eqNum("t_iso_std_ncaa", 0.07849797197)),
    wObp: toRate(eqNum("r_w_obp", 0.45)),
    wSlg: toRate(eqNum("r_w_slg", 0.30)),
    wAvg: toRate(eqNum("r_w_avg", 0.15)),
    wIso: toRate(eqNum("r_w_iso", 0.10)),
  });

  const basePerOwar = eqNum("nil_base_per_owar", 25000);
  const ptm = getProgramTierMultiplierByConference(toTeamRow.conference || null, DEFAULT_NIL_TIER_MULTIPLIERS);
  const pvm = getPositionValueMultiplier(player.position ?? null);
  const nilValuation = projected.owar == null ? null : projected.owar * basePerOwar * ptm * pvm;

  return {
    fromTeam: fromTeamName,
    fromConference,
    toConference: toTeamRow.conference || null,
    pAvg: projected.pAvg, pObp: projected.pObp, pSlg: projected.pSlg, pOps: projected.pOps, pIso: projected.pIso,
    pWrcPlus: projected.pWrcPlus, owar: projected.owar, nilValuation,
  };
}

/* ─── pitching simulation (identical to TransferPortal) ─── */
type PitchingSimOut = {
  blocked: boolean;
  missingInputs: string[];
  pEra: number | null; pFip: number | null; pWhip: number | null;
  pK9: number | null; pBb9: number | null; pHr9: number | null;
  pRvPlus: number | null; pWar: number | null; marketValue: number | null;
  projectedRole: "SP" | "RP";
  fromConference: string | null; toConference: string | null;
};

function simulatePitcher(args: {
  pitcher: PitchingStorageRow;
  pitcherPower: PitchingPowerSnapshot | null;
  destinationTeam: string;
  roleOverride: "SP" | "RP";
  teamByKey: Map<string, TeamRow>;
  teams: TeamRow[];
  pitchingConfByKey: Map<string, PitchingConfEntry>;
  parkMap: ParkFactorsMap;
  resolvePitchingConf: (conference: string | null | undefined, conferenceId?: string | null) => PitchingConfEntry | null;
}): PitchingSimOut {
  const { pitcher, pitcherPower, destinationTeam, roleOverride, teamByKey, teams, parkMap, resolvePitchingConf } = args;
  const eq = readPitchingWeights();
  const toPitchTeamRow = resolveTeamRowFromCandidates([destinationTeam], teamByKey, teams);

  const missing: string[] = [];
  const requireNum = (label: string, value: number | null | undefined) => {
    if (value == null || !Number.isFinite(value)) missing.push(label);
  };

  if (!toPitchTeamRow) {
    return { blocked: true, missingInputs: ["Destination Team not found"], pEra: null, pFip: null, pWhip: null, pK9: null, pBb9: null, pHr9: null, pRvPlus: null, pWar: null, marketValue: null, projectedRole: roleOverride, fromConference: null, toConference: null };
  }

  // Resolve from-team by UUID first, then name fallback
  const fromPitchTeamRow = pitcher.teamId
    ? (teams.find((t) => t.id === pitcher.teamId) ?? resolveTeamRowFromCandidates([pitcher.team], teamByKey, teams))
    : resolveTeamRowFromCandidates([pitcher.team], teamByKey, teams);
  const fromPitchConference = pitcher.conference || fromPitchTeamRow?.conference || null;
  const toPitchConference = toPitchTeamRow?.conference || null;
  const fromPitchConfStats = resolvePitchingConf(fromPitchConference, pitcher.conferenceId);
  const toPitchConfStats = resolvePitchingConf(toPitchConference, toPitchTeamRow?.conference_id);

  requireNum("Last ERA", pitcher.era);
  requireNum("Last FIP", pitcher.fip);
  requireNum("Last WHIP", pitcher.whip);
  requireNum("Last K/9", pitcher.k9);
  requireNum("Last BB/9", pitcher.bb9);
  requireNum("Last HR/9", pitcher.hr9);

  const fromEraPlus = fromPitchConfStats?.era_plus ?? null;
  const toEraPlus = toPitchConfStats?.era_plus ?? null;
  const fromFipPlus = fromPitchConfStats?.fip_plus ?? null;
  const toFipPlus = toPitchConfStats?.fip_plus ?? null;
  const fromWhipPlus = fromPitchConfStats?.whip_plus ?? null;
  const toWhipPlus = toPitchConfStats?.whip_plus ?? null;
  const fromK9Plus = fromPitchConfStats?.k9_plus ?? null;
  const toK9Plus = toPitchConfStats?.k9_plus ?? null;
  const fromBb9Plus = fromPitchConfStats?.bb9_plus ?? null;
  const toBb9Plus = toPitchConfStats?.bb9_plus ?? null;
  const fromHr9Plus = fromPitchConfStats?.hr9_plus ?? null;
  const toHr9Plus = toPitchConfStats?.hr9_plus ?? null;
  const fromHitterTalent = fromPitchConfStats?.hitter_talent_plus ?? null;
  const toHitterTalent = toPitchConfStats?.hitter_talent_plus ?? null;

  requireNum("From ERA+", fromEraPlus);
  requireNum("To ERA+", toEraPlus);
  requireNum("From FIP+", fromFipPlus);
  requireNum("To FIP+", toFipPlus);
  requireNum("From WHIP+", fromWhipPlus);
  requireNum("To WHIP+", toWhipPlus);
  requireNum("From K/9+", fromK9Plus);
  requireNum("To K/9+", toK9Plus);
  requireNum("From BB/9+", fromBb9Plus);
  requireNum("To BB/9+", toBb9Plus);
  requireNum("From HR/9+", fromHr9Plus);
  requireNum("To HR/9+", toHr9Plus);
  requireNum("From Hitter Talent+", fromHitterTalent);
  requireNum("To Hitter Talent+", toHitterTalent);

  const fromEraParkRaw = resolveParkFactorFromCandidates(fromPitchTeamRow?.id, [pitcher.team, fromPitchTeamRow?.name], "era", parkMap);
  const toEraParkRaw = resolveParkFactorFromCandidates(toPitchTeamRow?.id, [destinationTeam, toPitchTeamRow?.name], "era", parkMap);
  const fromWhipParkRaw = resolveParkFactorFromCandidates(fromPitchTeamRow?.id, [pitcher.team, fromPitchTeamRow?.name], "whip", parkMap);
  const toWhipParkRaw = resolveParkFactorFromCandidates(toPitchTeamRow?.id, [destinationTeam, toPitchTeamRow?.name], "whip", parkMap);
  const fromHr9ParkRaw = resolveParkFactorFromCandidates(fromPitchTeamRow?.id, [pitcher.team, fromPitchTeamRow?.name], "hr9", parkMap);
  const toHr9ParkRaw = resolveParkFactorFromCandidates(toPitchTeamRow?.id, [destinationTeam, toPitchTeamRow?.name], "hr9", parkMap);
  requireNum("From R/G Park Factor", fromEraParkRaw);
  requireNum("To R/G Park Factor", toEraParkRaw);
  requireNum("From WHIP Park Factor", fromWhipParkRaw);
  requireNum("To WHIP Park Factor", toWhipParkRaw);
  requireNum("From HR/9 Park Factor", fromHr9ParkRaw);
  requireNum("To HR/9 Park Factor", toHr9ParkRaw);

  const eraPr = pitcherPower?.eraPrPlus ?? null;
  const fipPr = pitcherPower?.fipPrPlus ?? null;
  const whipPr = pitcherPower?.whipPrPlus ?? null;
  const k9Pr = pitcherPower?.k9PrPlus ?? null;
  const bb9Pr = pitcherPower?.bb9PrPlus ?? null;
  const hr9Pr = pitcherPower?.hr9PrPlus ?? null;
  requireNum("ERA Power Rating+", eraPr);
  requireNum("FIP Power Rating+", fipPr);
  requireNum("WHIP Power Rating+", whipPr);
  requireNum("K/9 Power Rating+", k9Pr);
  requireNum("BB/9 Power Rating+", bb9Pr);
  requireNum("HR/9 Power Rating+", hr9Pr);

  if (missing.length > 0) {
    return { blocked: true, missingInputs: missing, pEra: null, pFip: null, pWhip: null, pK9: null, pBb9: null, pHr9: null, pRvPlus: null, pWar: null, marketValue: null, projectedRole: roleOverride, fromConference: fromPitchConference, toConference: toPitchConference };
  }

  const toParkIdx = (n: number | null) => normalizeParkToIndex(n);
  const fromRg = toParkIdx(fromEraParkRaw); const toRg = toParkIdx(toEraParkRaw);
  const fromWhipPf = toParkIdx(fromWhipParkRaw); const toWhipPf = toParkIdx(toWhipParkRaw);
  const fromHr9Pf = toParkIdx(fromHr9ParkRaw); const toHr9Pf = toParkIdx(toHr9ParkRaw);

  const calcLowerWork = (last: number, prPlus: number, ncaaAvg: number, prSd: number, ncaaSd: number, powerWeight: number, confWeight: number, fromPlus: number, toPlus: number, compWeight: number, fromTalent: number, toTalent: number, parkWeight: number | null, fromPark: number | null, toPark: number | null, dampFactor = 1) => {
    const safePrSd = prSd === 0 ? 1 : prSd;
    const powerAdj = ncaaAvg - (((prPlus - 100) / safePrSd) * ncaaSd);
    const blended = (last * (1 - powerWeight)) + (powerAdj * powerWeight);
    const confTerm = confWeight * ((toPlus - fromPlus) / 100);
    const compTerm = compWeight * ((toTalent - fromTalent) / 100);
    const parkTerm = parkWeight != null && fromPark != null && toPark != null ? parkWeight * ((toPark - fromPark) / 100) : 0;
    const mult = 1 - confTerm + compTerm + parkTerm;
    const adjustedMult = 1 + ((mult - 1) * dampFactor);
    return round3(blended * adjustedMult);
  };

  const calcHigherWork = (last: number, prPlus: number, ncaaAvg: number, prSd: number, ncaaSd: number, powerWeight: number, confWeight: number, fromPlus: number, toPlus: number, compWeight: number, fromTalent: number, toTalent: number) => {
    const safePrSd = prSd === 0 ? 1 : prSd;
    const powerAdj = ncaaAvg + (((prPlus - 100) / safePrSd) * ncaaSd);
    const blended = (last * (1 - powerWeight)) + (powerAdj * powerWeight);
    const confTerm = confWeight * ((toPlus - fromPlus) / 100);
    const compTerm = compWeight * ((toTalent - fromTalent) / 100);
    const mult = 1 + confTerm - compTerm;
    return round3(blended * mult);
  };

  const pEraRaw = calcLowerWork(pitcher.era!, eraPr!, eq.era_plus_ncaa_avg, eq.era_pr_sd, eq.era_plus_ncaa_sd, eq.transfer_era_power_weight, eq.transfer_era_conference_weight, fromEraPlus!, toEraPlus!, eq.transfer_era_competition_weight, fromHitterTalent!, toHitterTalent!, eq.transfer_era_park_weight, fromRg, toRg);
  const pFipRaw = calcLowerWork(pitcher.fip!, fipPr!, eq.fip_plus_ncaa_avg, eq.fip_pr_sd, eq.fip_plus_ncaa_sd, eq.transfer_fip_power_weight, eq.transfer_fip_conference_weight, fromFipPlus!, toFipPlus!, eq.transfer_fip_competition_weight, fromHitterTalent!, toHitterTalent!, eq.transfer_fip_park_weight, fromRg, toRg);
  const pWhipRaw = calcLowerWork(pitcher.whip!, whipPr!, eq.whip_plus_ncaa_avg, eq.whip_pr_sd, eq.whip_plus_ncaa_sd, eq.transfer_whip_power_weight, eq.transfer_whip_conference_weight, fromWhipPlus!, toWhipPlus!, eq.transfer_whip_competition_weight, fromHitterTalent!, toHitterTalent!, eq.transfer_whip_park_weight, fromWhipPf, toWhipPf, 0.75);
  const pK9Raw = calcHigherWork(pitcher.k9!, k9Pr!, eq.k9_plus_ncaa_avg, eq.k9_pr_sd, eq.k9_plus_ncaa_sd, eq.transfer_k9_power_weight, eq.transfer_k9_conference_weight, fromK9Plus!, toK9Plus!, eq.transfer_k9_competition_weight, fromHitterTalent!, toHitterTalent!);
  const pBb9Raw = calcLowerWork(pitcher.bb9!, bb9Pr!, eq.bb9_plus_ncaa_avg, eq.bb9_pr_sd, eq.bb9_plus_ncaa_sd, eq.transfer_bb9_power_weight, eq.transfer_bb9_conference_weight, fromBb9Plus!, toBb9Plus!, eq.transfer_bb9_competition_weight, fromHitterTalent!, toHitterTalent!, null, null, null);
  const pHr9Raw = calcLowerWork(pitcher.hr9!, hr9Pr!, eq.hr9_plus_ncaa_avg, eq.hr9_pr_sd, eq.hr9_plus_ncaa_sd, eq.transfer_hr9_power_weight, eq.transfer_hr9_conference_weight, fromHr9Plus!, toHr9Plus!, eq.transfer_hr9_competition_weight, fromHitterTalent!, toHitterTalent!, eq.transfer_hr9_park_weight, fromHr9Pf, toHr9Pf);

  const baseRole: "SP" | "RP" = pitcher.role === "SP" ? "SP" : "RP";
  const projectedRole = roleOverride;
  const roleCurve = {
    tier1Max: eq.rp_to_sp_low_better_tier1_max, tier2Max: eq.rp_to_sp_low_better_tier2_max, tier3Max: eq.rp_to_sp_low_better_tier3_max,
    tier1Mult: eq.rp_to_sp_low_better_tier1_mult, tier2Mult: eq.rp_to_sp_low_better_tier2_mult, tier3Mult: eq.rp_to_sp_low_better_tier3_mult,
  };
  const pEra = applyRoleTransitionAdjustment(pEraRaw, eq.sp_to_rp_reg_era_pct, baseRole, projectedRole, true, roleCurve);
  const pFip = applyRoleTransitionAdjustment(pFipRaw, eq.sp_to_rp_reg_fip_pct, baseRole, projectedRole, true, roleCurve);
  const pWhip = applyRoleTransitionAdjustment(pWhipRaw, eq.sp_to_rp_reg_whip_pct, baseRole, projectedRole, true, roleCurve);
  const pK9 = applyRoleTransitionAdjustment(pK9Raw, eq.sp_to_rp_reg_k9_pct, baseRole, projectedRole, false, roleCurve);
  const pBb9 = applyRoleTransitionAdjustment(pBb9Raw, eq.sp_to_rp_reg_bb9_pct, baseRole, projectedRole, true, roleCurve);
  const pHr9 = applyRoleTransitionAdjustment(pHr9Raw, eq.sp_to_rp_reg_hr9_pct, baseRole, projectedRole, true, roleCurve);

  const pEraPlus = calcPitchingPlus(pEra, eq.era_plus_ncaa_avg, eq.era_plus_ncaa_sd, eq.era_plus_scale, false);
  const pFipPlus = calcPitchingPlus(pFip, eq.fip_plus_ncaa_avg, eq.fip_plus_ncaa_sd, eq.fip_plus_scale, false);
  const pWhipPlus = calcPitchingPlus(pWhip, eq.whip_plus_ncaa_avg, eq.whip_plus_ncaa_sd, eq.whip_plus_scale, false);
  const pK9Plus = calcPitchingPlus(pK9, eq.k9_plus_ncaa_avg, eq.k9_plus_ncaa_sd, eq.k9_plus_scale, true);
  const pBb9Plus = calcPitchingPlus(pBb9, eq.bb9_plus_ncaa_avg, eq.bb9_plus_ncaa_sd, eq.bb9_plus_scale, false);
  const pHr9Plus = calcPitchingPlus(pHr9, eq.hr9_plus_ncaa_avg, eq.hr9_plus_ncaa_sd, eq.hr9_plus_scale, false);
  const pRvPlus = [pEraPlus, pFipPlus, pWhipPlus, pK9Plus, pBb9Plus, pHr9Plus].every((v) => v != null)
    ? round3(
        (eq.era_plus_weight * Number(pEraPlus)) +
        (eq.fip_plus_weight * Number(pFipPlus)) +
        (eq.whip_plus_weight * Number(pWhipPlus)) +
        (eq.k9_plus_weight * Number(pK9Plus)) +
        (eq.bb9_plus_weight * Number(pBb9Plus)) +
        (eq.hr9_plus_weight * Number(pHr9Plus))
      )
    : null;
  const projectedIp = projectedRole === "SP" ? eq.pwar_ip_sp : eq.pwar_ip_rp;
  const pitcherValue = pRvPlus == null ? null : ((pRvPlus - 100) / 100);
  const pWar = pitcherValue == null || eq.pwar_runs_per_win === 0
    ? null
    : round3((((pitcherValue * (projectedIp / 9) * eq.pwar_r_per_9) + ((projectedIp / 9) * eq.pwar_replacement_runs_per_9)) / eq.pwar_runs_per_win));
  const pitchingTierMultipliers = {
    sec: eq.market_tier_sec, p4: eq.market_tier_acc_big12, bigTen: eq.market_tier_big_ten,
    strongMid: eq.market_tier_strong_mid, lowMajor: eq.market_tier_low_major,
  };
  const ptm = getProgramTierMultiplierByConference(toPitchConference, pitchingTierMultipliers);
  const pvm = getPitchingPvfForRole(projectedRole, eq);
  const marketEligible = canShowPitchingMarketValue(destinationTeam, toPitchConference);
  const marketValue = !marketEligible || pWar == null ? null : pWar * eq.market_dollars_per_war * ptm * pvm;

  return { blocked: false, missingInputs: [], pEra, pFip, pWhip, pK9, pBb9, pHr9, pRvPlus, pWar, marketValue, projectedRole, fromConference: fromPitchConference, toConference: toPitchConference };
}

/* ═══════════════════════ COMPONENT ═══════════════════════ */
export default function PlayerComparison() {
  const { toast } = useToast();
  const location = useLocation();
  const { parkMap } = useParkFactors();
  const { hitterStats, powerRatings } = useHitterSeedData();
  const { pitchers: pitchingMasterRows } = usePitchingSeedData();
  const { teams } = useTeamsTable();
  const { conferenceStats: rawConfStats } = useConferenceStats(2025);
  const pitchingEq = useMemo(() => readPitchingWeights(), []);

  const [simType, setSimType] = useState<"hitting" | "pitching">("hitting");

  // ─── Panel A state ───
  const [aPlayerSearch, setAPlayerSearch] = useState("");
  const [aPlayerOpen, setAPlayerOpen] = useState(false);
  const [aPlayerId, setAPlayerId] = useState("");
  const [aTeamSearch, setATeamSearch] = useState(DEMO_SCHOOL.name);
  const [aTeamOpen, setATeamOpen] = useState(false);
  const [aDestTeam, setADestTeam] = useState(DEMO_SCHOOL.name);
  const [aPitcherId, setAPitcherId] = useState("");
  const [aPitcherSearch, setAPitcherSearch] = useState("");
  const [aPitcherOpen, setAPitcherOpen] = useState(false);
  const [aRoleOverride, setARoleOverride] = useState<"SP" | "RP">("RP");

  // ─── Panel B state ───
  const [bPlayerSearch, setBPlayerSearch] = useState("");
  const [bPlayerOpen, setBPlayerOpen] = useState(false);
  const [bPlayerId, setBPlayerId] = useState("");
  const [bTeamSearch, setBTeamSearch] = useState(DEMO_SCHOOL.name);
  const [bTeamOpen, setBTeamOpen] = useState(false);
  const [bDestTeam, setBDestTeam] = useState(DEMO_SCHOOL.name);
  const [bPitcherId, setBPitcherId] = useState("");
  const [bPitcherSearch, setBPitcherSearch] = useState("");
  const [bPitcherOpen, setBPitcherOpen] = useState(false);
  const [bRoleOverride, setBRoleOverride] = useState<"SP" | "RP">("RP");

  /* ─── shared data ─── */
  const conferenceStats: HitterConfRow[] = useMemo(() => {
    const byConf = new Map<string, { row: HitterConfRow; score: number }>();
    for (const raw of rawConfStats) {
      const key = normalizeKey(raw.conference);
      if (!key) continue;
      const row: HitterConfRow = {
        conference: raw.conference,
        season: raw.season,
        avg_plus: raw.avg != null ? Math.round((raw.avg / 0.280) * 100) : null,
        obp_plus: raw.obp != null ? Math.round((raw.obp / 0.385) * 100) : null,
        iso_plus: raw.iso != null ? Math.round((raw.iso / 0.162) * 100) : null,
        stuff_plus: raw.stuff_plus,
      };
      const score = (row.avg_plus != null ? 1 : 0) + (row.obp_plus != null ? 1 : 0) + (row.iso_plus != null ? 1 : 0) + (row.stuff_plus != null ? 1 : 0) + (row.season === 2025 ? 2 : 0);
      const ex = byConf.get(key);
      if (!ex || score > ex.score) byConf.set(key, { row, score });
    }
    return Array.from(byConf.values()).map((v) => v.row);
  }, [rawConfStats]);

  const { data: remoteEquationValues = {} } = useQuery({
    queryKey: ["compare-admin-ui-equation-values"],
    queryFn: async () => {
      const { data, error } = await supabase.from("model_config").select("config_key, config_value").eq("model_type", "admin_ui").eq("season", 2025);
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const row of data || []) map[row.config_key] = Number(row.config_value);
      return map;
    },
  });

  const { data: allPlayers = [] } = useQuery({
    queryKey: ["compare-all-players"],
    queryFn: async () => {
      let all: any[] = [];
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await supabase.from("players").select("id, first_name, last_name, position, team, from_team, conference, player_predictions(id, from_avg, from_obp, from_slg, model_type, variant, status, updated_at)").or("pa.gte.75,ip.gte.20").range(from, from + PAGE - 1);
        if (error) throw error;
        all = all.concat(data || []);
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }
      return all.filter((p) => p.first_name && p.last_name) as PlayerLite[];
    },
  });

  const teamByKey = useMemo(() => new Map((teams || []).map((t) => [normalizeKey(t.name), t as TeamRow])), [teams]);
  const confByKey = useMemo(() => new Map((conferenceStats || []).map((c) => [normalizeKey(c.conference), c])), [conferenceStats]);
  const [seedByName, seedByPlayerId] = useMemo(() => {
    const map = new Map<string, SeedRow[]>();
    const byId = new Map<string, SeedRow>();
    for (const row of hitterStats as SeedRow[]) {
      const key = normalizeKey(row.playerName);
      if (!key || !row.team) continue;
      const list = map.get(key) || [];
      list.push(row);
      map.set(key, list);
      if ((row as any).player_id) byId.set((row as any).player_id, row);
    }
    return [map, byId];
  }, [hitterStats]);
  const powerByNameTeam = useMemo(() => {
    const map = new Map<string, typeof powerRatings[0]>();
    for (const row of powerRatings) {
      const key = `${normalizeKey(row.playerName)}|${normalizeKey(row.team)}`;
      if (key.length > 1) map.set(key, row);
      const nameOnly = normalizeKey(row.playerName);
      if (nameOnly && !map.has(nameOnly)) map.set(nameOnly, row);
    }
    return map;
  }, [powerRatings]);
  const eqNum = useCallback((key: string, fallback: number) => readLocalNum(key, fallback, remoteEquationValues), [remoteEquationValues]);

  /* ─── pitching data ─── */
  const pitchingPlayers = useMemo<PitchingStorageRow[]>(() => {
    return pitchingMasterRows.map((r, idx) => {
      const games = r.g != null ? Number(r.g) : null;
      const starts = r.gs != null ? Number(r.gs) : null;
      const derivedRole = toPitchingRole(r.role) || (games != null && games > 0 && starts != null ? ((starts / games) < 0.5 ? "RP" : "SP") : null);
      return {
        id: r.id || `pitching-cmp-${idx}`,
        player_name: (r.playerName || "").trim(),
        team: (r.team || "").trim() || null,
        teamId: r.teamId ?? null,
        conference: r.conference ?? null,
        conferenceId: r.conferenceId ?? null,
        handedness: (r.throwHand || "").trim() || null,
        role: derivedRole,
        era: r.era != null ? Number(r.era) : null,
        fip: r.fip != null ? Number(r.fip) : null,
        whip: r.whip != null ? Number(r.whip) : null,
        k9: r.k9 != null ? Number(r.k9) : null,
        bb9: r.bb9 != null ? Number(r.bb9) : null,
        hr9: r.hr9 != null ? Number(r.hr9) : null,
      };
    }).filter((r) => !!r.player_name);
  }, [pitchingMasterRows]);

  const pitchingPowerByKey = useMemo(() => {
    const byNameTeam = new Map<string, PitchingPowerSnapshot>();
    const byName = new Map<string, PitchingPowerSnapshot>();
    const normalCdf = (x: number) => { const sign = x < 0 ? -1 : 1; const ax = Math.abs(x) / Math.sqrt(2); const t = 1 / (1 + 0.3275911 * ax); const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-ax * ax)); return 0.5 * (1 + erf); };
    const cs = (v: number | null, avg: number, sd: number, lib = false) => { if (v == null || sd <= 0) return null; const p = normalCdf((v - avg) / sd) * 100; return lib ? 100 - p : p; };
    const s = (v: number | null | undefined) => v == null ? null : Number(v);
    const nws = (items: Array<{ v: number; w: number }>) => { const wt = items.reduce((a, i) => a + (i.v * i.w), 0); const tw = items.reduce((a, i) => a + i.w, 0); return tw > 0 ? wt / tw : null; };
    const EQ = { p_ncaa_avg_stuff_plus: 100, p_ncaa_avg_whiff_pct: 22.9, p_ncaa_avg_bb_pct: 11.3, p_ncaa_avg_hh_pct: 36, p_ncaa_avg_in_zone_whiff_pct: 16.4, p_ncaa_avg_chase_pct: 23.1, p_ncaa_avg_barrel_pct: 17.3, p_ncaa_avg_ld_pct: 20.9, p_ncaa_avg_avg_ev: 86.2, p_ncaa_avg_gb_pct: 43.2, p_ncaa_avg_in_zone_pct: 47.2, p_ncaa_avg_ev90: 103.1, p_ncaa_avg_pull_pct: 36.5, p_ncaa_avg_la_10_30_pct: 29, p_sd_stuff_plus: 3.967566764, p_sd_whiff_pct: 5.476169924, p_sd_bb_pct: 2.92040411, p_sd_hh_pct: 6.474203457, p_sd_in_zone_whiff_pct: 4.299203457, p_sd_chase_pct: 4.619392309, p_sd_barrel_pct: 4.988140199, p_sd_ld_pct: 3.580670928, p_sd_avg_ev: 2.362900608, p_sd_gb_pct: 6.958760046, p_sd_in_zone_pct: 3.325412065, p_sd_ev90: 1.767350585, p_sd_pull_pct: 5.356686254, p_sd_la_10_30_pct: 5.773803471, p_era_stuff_plus_weight: 0.21, p_era_whiff_pct_weight: 0.23, p_era_bb_pct_weight: 0.17, p_era_hh_pct_weight: 0.07, p_era_in_zone_whiff_pct_weight: 0.12, p_era_chase_pct_weight: 0.08, p_era_barrel_pct_weight: 0.12, p_era_ncaa_avg_power_rating: 50, p_ncaa_avg_whip_power_rating: 50, p_ncaa_avg_k9_power_rating: 50, p_ncaa_avg_bb9_power_rating: 50, p_ncaa_avg_hr9_power_rating: 50, p_fip_hr9_power_rating_plus_weight: 0.45, p_fip_bb9_power_rating_plus_weight: 0.3, p_fip_k9_power_rating_plus_weight: 0.25, p_whip_bb_pct_weight: 0.25, p_whip_ld_pct_weight: 0.2, p_whip_avg_ev_weight: 0.15, p_whip_whiff_pct_weight: 0.25, p_whip_gb_pct_weight: 0.1, p_whip_chase_pct_weight: 0.05, p_k9_whiff_pct_weight: 0.35, p_k9_stuff_plus_weight: 0.3, p_k9_in_zone_whiff_pct_weight: 0.25, p_k9_chase_pct_weight: 0.1, p_bb9_bb_pct_weight: 0.55, p_bb9_in_zone_pct_weight: 0.3, p_bb9_chase_pct_weight: 0.15, p_hr9_barrel_pct_weight: 0.32, p_hr9_ev90_weight: 0.24, p_hr9_gb_pct_weight: 0.18, p_hr9_pull_pct_weight: 0.14, p_hr9_la_10_30_pct_weight: 0.12 };

    for (const pr of pitchingMasterRows) {
      const name = (pr.playerName || "").trim();
      const team = (pr.team || "").trim();
      if (!name) continue;
      const stuff = pr.stuffPlus != null ? cs(pr.stuffPlus, EQ.p_ncaa_avg_stuff_plus, EQ.p_sd_stuff_plus) : null;
      const whiff = cs(pr.miss_pct, EQ.p_ncaa_avg_whiff_pct, EQ.p_sd_whiff_pct);
      const bb = cs(pr.bb_pct, EQ.p_ncaa_avg_bb_pct, EQ.p_sd_bb_pct, true);
      const hh = cs(pr.hard_hit_pct, EQ.p_ncaa_avg_hh_pct, EQ.p_sd_hh_pct, true);
      const izWhiff = cs(pr.in_zone_whiff_pct, EQ.p_ncaa_avg_in_zone_whiff_pct, EQ.p_sd_in_zone_whiff_pct);
      const chase = cs(pr.chase_pct, EQ.p_ncaa_avg_chase_pct, EQ.p_sd_chase_pct);
      const barrel = cs(pr.barrel_pct, EQ.p_ncaa_avg_barrel_pct, EQ.p_sd_barrel_pct, true);
      const ld = cs(pr.line_pct, EQ.p_ncaa_avg_ld_pct, EQ.p_sd_ld_pct, true);
      const avgEv = cs(pr.exit_vel, EQ.p_ncaa_avg_avg_ev, EQ.p_sd_avg_ev, true);
      const gb = cs(pr.ground_pct, EQ.p_ncaa_avg_gb_pct, EQ.p_sd_gb_pct);
      const iz = cs(pr.in_zone_pct, EQ.p_ncaa_avg_in_zone_pct, EQ.p_sd_in_zone_pct);
      const ev90 = cs(pr.vel_90th, EQ.p_ncaa_avg_ev90, EQ.p_sd_ev90, true);
      const pull = cs(pr.h_pull_pct, EQ.p_ncaa_avg_pull_pct, EQ.p_sd_pull_pct, true);
      const la1030 = cs(pr.la_10_30_pct, EQ.p_ncaa_avg_la_10_30_pct, EQ.p_sd_la_10_30_pct, true);
      const eraPr = [stuff, whiff, bb, hh, izWhiff, chase, barrel].every((v) => v != null)
        ? ((s(stuff)! * EQ.p_era_stuff_plus_weight) + (s(whiff)! * EQ.p_era_whiff_pct_weight) + (s(bb)! * EQ.p_era_bb_pct_weight) + (s(hh)! * EQ.p_era_hh_pct_weight) + (s(izWhiff)! * EQ.p_era_in_zone_whiff_pct_weight) + (s(chase)! * EQ.p_era_chase_pct_weight) + (s(barrel)! * EQ.p_era_barrel_pct_weight)) / EQ.p_era_ncaa_avg_power_rating * 100
        : null;
      const whipPr = [bb, ld, avgEv, whiff, gb, chase].every((v) => v != null)
        ? (nws([{v:s(bb)!,w:EQ.p_whip_bb_pct_weight},{v:s(ld)!,w:EQ.p_whip_ld_pct_weight},{v:s(avgEv)!,w:EQ.p_whip_avg_ev_weight},{v:s(whiff)!,w:EQ.p_whip_whiff_pct_weight},{v:s(gb)!,w:EQ.p_whip_gb_pct_weight},{v:s(chase)!,w:EQ.p_whip_chase_pct_weight}]) ?? 0) / EQ.p_ncaa_avg_whip_power_rating * 100
        : null;
      const k9Pr = [whiff, stuff, izWhiff, chase].every((v) => v != null)
        ? ((s(whiff)! * EQ.p_k9_whiff_pct_weight) + (s(stuff)! * EQ.p_k9_stuff_plus_weight) + (s(izWhiff)! * EQ.p_k9_in_zone_whiff_pct_weight) + (s(chase)! * EQ.p_k9_chase_pct_weight)) / EQ.p_ncaa_avg_k9_power_rating * 100
        : null;
      const bb9Pr = [bb, iz, chase].every((v) => v != null)
        ? ((s(bb)! * EQ.p_bb9_bb_pct_weight) + (s(iz)! * EQ.p_bb9_in_zone_pct_weight) + (s(chase)! * EQ.p_bb9_chase_pct_weight)) / EQ.p_ncaa_avg_bb9_power_rating * 100
        : null;
      const hr9Pr = [barrel, ev90, gb, pull, la1030].every((v) => v != null)
        ? ((s(barrel)! * EQ.p_hr9_barrel_pct_weight) + (s(ev90)! * EQ.p_hr9_ev90_weight) + (s(gb)! * EQ.p_hr9_gb_pct_weight) + (s(pull)! * EQ.p_hr9_pull_pct_weight) + (s(la1030)! * EQ.p_hr9_la_10_30_pct_weight)) / EQ.p_ncaa_avg_hr9_power_rating * 100
        : null;
      const fipPr = hr9Pr != null && bb9Pr != null && k9Pr != null
        ? (hr9Pr * EQ.p_fip_hr9_power_rating_plus_weight) + (bb9Pr * EQ.p_fip_bb9_power_rating_plus_weight) + (k9Pr * EQ.p_fip_k9_power_rating_plus_weight)
        : null;
      const snapshot: PitchingPowerSnapshot = { eraPrPlus: eraPr, fipPrPlus: fipPr, whipPrPlus: whipPr, k9PrPlus: k9Pr, hr9PrPlus: hr9Pr, bb9PrPlus: bb9Pr };
      const nameKey = normalizeKey(name);
      const teamKey = normalizeKey(team);
      if (nameKey && !byName.has(nameKey)) byName.set(nameKey, snapshot);
      if (nameKey && teamKey && !byNameTeam.has(`${nameKey}|${teamKey}`)) byNameTeam.set(`${nameKey}|${teamKey}`, snapshot);
    }
    return { byNameTeam, byName };
  }, [pitchingMasterRows]);

  const pitchingConfByKey = useMemo(() => {
    const map = new Map<string, PitchingConfEntry>();
    const byId = new Map<string, PitchingConfEntry>();
    if (rawConfStats.length === 0) return map;
    const eq = readPitchingWeights();
    for (const row of rawConfStats) {
      const directKey = normalizeKey(row.conference);
      const canonicalKey = canonicalConferencePitching(row.conference);
      if (!directKey) continue;
      const entry: PitchingConfEntry = {
        conference: row.conference,
        era_plus: calcPitchingPlus(row.era, eq.era_plus_ncaa_avg, eq.era_plus_ncaa_sd, eq.era_plus_scale, false),
        fip_plus: calcPitchingPlus(row.fip, eq.fip_plus_ncaa_avg, eq.fip_plus_ncaa_sd, eq.fip_plus_scale, false),
        whip_plus: calcPitchingPlus(row.whip, eq.whip_plus_ncaa_avg, eq.whip_plus_ncaa_sd, eq.whip_plus_scale, false),
        k9_plus: calcPitchingPlus(row.k9, eq.k9_plus_ncaa_avg, eq.k9_plus_ncaa_sd, eq.k9_plus_scale, true),
        bb9_plus: calcPitchingPlus(row.bb9, eq.bb9_plus_ncaa_avg, eq.bb9_plus_ncaa_sd, eq.bb9_plus_scale, false),
        hr9_plus: calcPitchingPlus(row.hr9, eq.hr9_plus_ncaa_avg, eq.hr9_plus_ncaa_sd, eq.hr9_plus_scale, false),
        hitter_talent_plus: calcHitterTalentPlusFromConference(row.overall_power_rating, row.stuff_plus, row.wrc_plus),
      };
      map.set(directKey, entry);
      if (canonicalKey && !map.has(canonicalKey)) map.set(canonicalKey, entry);
      if (row.conference_id) byId.set(row.conference_id, entry);
    }
    (map as any)._byId = byId;
    return map;
  }, [rawConfStats]);

  const resolvePitchingConf = useCallback((conference: string | null | undefined, conferenceId?: string | null): PitchingConfEntry | null => {
    const byId = (pitchingConfByKey as any)?._byId as Map<string, PitchingConfEntry> | undefined;
    if (conferenceId && byId?.has(conferenceId)) return byId.get(conferenceId)!;
    const directKey = normalizeKey(conference || "");
    const canonicalKey = canonicalConferencePitching(conference || "");
    if (directKey) { const hit = pitchingConfByKey.get(directKey); if (hit) return hit; }
    if (canonicalKey) { const hit = pitchingConfByKey.get(canonicalKey); if (hit) return hit; }
    return null;
  }, [pitchingConfByKey]);

  /* ─── internals for hitter predictions ─── */
  const aPrediction = useMemo(() => {
    const p = allPlayers.find((r) => r.id === aPlayerId);
    return p ? selectPreferredPrediction((p.player_predictions || []).filter((pr) => pr.variant === "regular")) : null;
  }, [allPlayers, aPlayerId]);
  const bPrediction = useMemo(() => {
    const p = allPlayers.find((r) => r.id === bPlayerId);
    return p ? selectPreferredPrediction((p.player_predictions || []).filter((pr) => pr.variant === "regular")) : null;
  }, [allPlayers, bPlayerId]);
  const internalIds = useMemo(() => [aPrediction?.id, bPrediction?.id].filter(Boolean) as string[], [aPrediction?.id, bPrediction?.id]);
  const { data: internals = [] } = useQuery({
    queryKey: ["compare-internals", internalIds],
    enabled: internalIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("player_prediction_internals").select("prediction_id, avg_power_rating, obp_power_rating, slg_power_rating").in("prediction_id", internalIds);
      if (error) throw error;
      return (data || []) as PredictionInternal[];
    },
  });
  const internalsByPrediction = useMemo(() => {
    const map = new Map<string, PredictionInternal>();
    for (const i of internals) map.set(i.prediction_id, i);
    return map;
  }, [internals]);

  /* ─── filters ─── */
  const filterHitters = useCallback((q: string) => {
    const nq = normalizeName(q);
    if (!nq) return [] as PlayerLite[];
    return allPlayers.filter((p) => !isPitcherPosition(p.position) && normalizeName(`${p.first_name} ${p.last_name} ${p.team || ""} ${p.position || ""}`).includes(nq)).slice(0, 25);
  }, [allPlayers]);
  const filterPitchers = useCallback((q: string) => {
    const nq = normalizeKey(q);
    if (!nq) return [] as PitchingStorageRow[];
    return pitchingPlayers.filter((p) => normalizeKey(`${p.player_name} ${p.team || ""} ${p.handedness || ""}`).includes(nq)).slice(0, 25);
  }, [pitchingPlayers]);
  const filterTeams = useCallback((q: string) => {
    const nq = normalizeName(q);
    if (!nq) return [] as TeamRow[];
    return (teams as TeamRow[]).filter((t) => normalizeName(`${t.name} ${t.conference || ""}`).includes(nq)).slice(0, 30);
  }, [teams]);

  /* ─── hitter sim results ─── */
  const aPlayer = useMemo(() => allPlayers.find((p) => p.id === aPlayerId) || null, [allPlayers, aPlayerId]);
  const bPlayer = useMemo(() => allPlayers.find((p) => p.id === bPlayerId) || null, [allPlayers, bPlayerId]);
  const aHitterSim = useMemo(() => {
    if (!aPlayer || !aDestTeam || !aPrediction) return null;
    return simulateHitter({ player: aPlayer, destinationTeam: aDestTeam, prediction: aPrediction, internals: internalsByPrediction.get(aPrediction.id) || null, teamByKey, confByKey, seedByPlayerId, seedByName, parkMap, teams: teams as TeamRow[], eqNum, powerByNameTeam });
  }, [aPlayer, aDestTeam, aPrediction, internalsByPrediction, teamByKey, confByKey, seedByPlayerId, seedByName, parkMap, teams, eqNum, powerByNameTeam]);
  const bHitterSim = useMemo(() => {
    if (!bPlayer || !bDestTeam || !bPrediction) return null;
    return simulateHitter({ player: bPlayer, destinationTeam: bDestTeam, prediction: bPrediction, internals: internalsByPrediction.get(bPrediction.id) || null, teamByKey, confByKey, seedByPlayerId, seedByName, parkMap, teams: teams as TeamRow[], eqNum, powerByNameTeam });
  }, [bPlayer, bDestTeam, bPrediction, internalsByPrediction, teamByKey, confByKey, seedByPlayerId, seedByName, parkMap, teams, eqNum, powerByNameTeam]);

  /* ─── pitcher sim results ─── */
  const aPitcher = useMemo(() => pitchingPlayers.find((p) => p.id === aPitcherId) || null, [pitchingPlayers, aPitcherId]);
  const bPitcher = useMemo(() => pitchingPlayers.find((p) => p.id === bPitcherId) || null, [pitchingPlayers, bPitcherId]);
  const aPitcherPower = useMemo<PitchingPowerSnapshot | null>(() => {
    if (!aPitcher) return null;
    const nameKey = normalizeKey(aPitcher.player_name);
    const teamKey = normalizeKey(aPitcher.team);
    return (teamKey ? pitchingPowerByKey.byNameTeam.get(`${nameKey}|${teamKey}`) : null) || pitchingPowerByKey.byName.get(nameKey) || null;
  }, [pitchingPowerByKey, aPitcher]);
  const bPitcherPower = useMemo<PitchingPowerSnapshot | null>(() => {
    if (!bPitcher) return null;
    const nameKey = normalizeKey(bPitcher.player_name);
    const teamKey = normalizeKey(bPitcher.team);
    return (teamKey ? pitchingPowerByKey.byNameTeam.get(`${nameKey}|${teamKey}`) : null) || pitchingPowerByKey.byName.get(nameKey) || null;
  }, [pitchingPowerByKey, bPitcher]);
  const aPitchingSim = useMemo<PitchingSimOut | null>(() => {
    if (!aPitcher || !aDestTeam) return null;
    return simulatePitcher({ pitcher: aPitcher, pitcherPower: aPitcherPower, destinationTeam: aDestTeam, roleOverride: aRoleOverride, teamByKey, teams: teams as TeamRow[], pitchingConfByKey, parkMap, resolvePitchingConf });
  }, [aPitcher, aPitcherPower, aDestTeam, aRoleOverride, teamByKey, teams, pitchingConfByKey, parkMap, resolvePitchingConf]);
  const bPitchingSim = useMemo<PitchingSimOut | null>(() => {
    if (!bPitcher || !bDestTeam) return null;
    return simulatePitcher({ pitcher: bPitcher, pitcherPower: bPitcherPower, destinationTeam: bDestTeam, roleOverride: bRoleOverride, teamByKey, teams: teams as TeamRow[], pitchingConfByKey, parkMap, resolvePitchingConf });
  }, [bPitcher, bPitcherPower, bDestTeam, bRoleOverride, teamByKey, teams, pitchingConfByKey, parkMap, resolvePitchingConf]);

  /* ─── render helpers ─── */
  const heroColor = (val: number | null | undefined, goodCut: number, avgCut: number) => {
    if (val == null) return "border-border bg-muted/10";
    return val >= goodCut ? "border-emerald-500 bg-emerald-500/10" : val >= avgCut ? "border-blue-500 bg-blue-500/10" : "border-rose-500 bg-rose-500/10";
  };

  const renderHitterPanel = (
    title: string,
    playerSearch: string, setPlayerSearch: (v: string) => void,
    playerOpen: boolean, setPlayerOpen: (v: boolean) => void,
    teamSearch: string, setTeamSearch: (v: string) => void,
    teamOpen: boolean, setTeamOpen: (v: boolean) => void,
    onPickPlayer: (p: PlayerLite) => void,
    onPickTeam: (t: TeamRow) => void,
    player: PlayerLite | null,
    sim: HitterSimOut | null,
    prediction: ReturnType<typeof selectPreferredPrediction>,
    otherSim: HitterSimOut | null,
  ) => (
    <Card className="overflow-visible border-border/70 shadow-sm bg-card">
      <CardHeader className="pb-2 border-b bg-muted/20">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-3">
        {/* Inputs */}
        <div className="grid grid-cols-2 gap-2">
          <div className="relative">
            <Label className="text-xs mb-1 block">Player</Label>
            <Input className="h-8 text-sm" placeholder="Search hitter..." value={playerSearch} onChange={(e) => { setPlayerSearch(e.target.value); setPlayerOpen(true); }} onFocus={() => setPlayerOpen(true)} onBlur={() => setTimeout(() => setPlayerOpen(false), 150)} />
            {playerOpen && filterHitters(playerSearch).length > 0 && (
              <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-64 overflow-auto">
                {filterHitters(playerSearch).map((p) => (
                  <div key={p.id} className="px-3 py-1.5 text-sm cursor-pointer hover:bg-accent flex justify-between" onMouseDown={() => onPickPlayer(p)}>
                    <span className="font-medium">{p.first_name} {p.last_name}</span>
                    <span className="text-muted-foreground text-[11px]">{p.team || "-"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <Label className="text-xs mb-1 block">To Team</Label>
            <Input className="h-8 text-sm" placeholder="Destination..." value={teamSearch} onChange={(e) => { setTeamSearch(e.target.value); setTeamOpen(true); }} onFocus={() => setTeamOpen(true)} onBlur={() => setTimeout(() => setTeamOpen(false), 150)} />
            {teamOpen && filterTeams(teamSearch).length > 0 && (
              <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-64 overflow-auto">
                {filterTeams(teamSearch).map((t) => (
                  <div key={t.name} className="px-3 py-1.5 text-sm cursor-pointer hover:bg-accent" onMouseDown={() => onPickTeam(t)}>
                    {t.name} <span className="text-muted-foreground text-[11px]">{t.conference || ""}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Selected info */}
        {player && (
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <Link className="text-primary font-medium underline-offset-2 hover:underline" to={profileRouteFor(player.id, player.position)} state={{ returnTo: location.pathname }}>
              {player.first_name} {player.last_name}
            </Link>
            <span>{player.position || "-"} · {player.team || "-"}</span>
            {prediction && <span className="font-mono tabular-nums">{prediction.from_avg?.toFixed(3) ?? "-"}/{prediction.from_obp?.toFixed(3) ?? "-"}/{prediction.from_slg?.toFixed(3) ?? "-"}</span>}
          </div>
        )}

        {/* Hero cards */}
        {sim ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              <div className={`rounded-lg border-2 p-3 text-center ${heroColor(sim.pWrcPlus, 115, 90)}`}>
                <div className="text-muted-foreground text-[10px] uppercase tracking-wide">pWRC+</div>
                <div className="text-2xl font-bold tabular-nums">{sim.pWrcPlus?.toFixed(0) ?? "-"}</div>
              </div>
              <div className={`rounded-lg border-2 p-3 text-center ${heroColor(sim.owar, 1.5, 0.5)}`}>
                <div className="text-muted-foreground text-[10px] uppercase tracking-wide">oWAR</div>
                <div className="text-2xl font-bold tabular-nums">{sim.owar?.toFixed(2) ?? "-"}</div>
              </div>
              <div className={`rounded-lg border-2 p-3 text-center ${heroColor(sim.nilValuation, 75000, 25000)}`}>
                <div className="text-muted-foreground text-[10px] uppercase tracking-wide">NIL Value</div>
                <div className="text-xl font-bold tabular-nums">{money(sim.nilValuation)}</div>
              </div>
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {([["AVG", sim.pAvg, "avg"], ["OBP", sim.pObp, "obp"], ["SLG", sim.pSlg, "slg"], ["OPS", sim.pOps, "ops"], ["ISO", sim.pIso, "iso"]] as const).map(([label, val, key]) => (
                <div key={label} className={`rounded border p-2 text-center ${tierStyle(hitterStatTier(key, val))}`}>
                  <div className="text-muted-foreground text-[10px] uppercase tracking-wide">{label}</div>
                  <div className="text-sm font-bold tabular-nums">{val.toFixed(3)}</div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="rounded-md border border-dashed p-4 text-xs text-muted-foreground text-center">
            {player ? "Missing data for simulation." : "Select a hitter and destination."}
          </div>
        )}
      </CardContent>
    </Card>
  );

  const renderPitcherPanel = (
    title: string,
    pitcherSearch: string, setPitcherSearch: (v: string) => void,
    pitcherOpen: boolean, setPitcherOpen: (v: boolean) => void,
    teamSearch: string, setTeamSearch: (v: string) => void,
    teamOpen: boolean, setTeamOpen: (v: boolean) => void,
    roleOverride: "SP" | "RP", setRoleOverride: (v: "SP" | "RP") => void,
    onPickPitcher: (p: PitchingStorageRow) => void,
    onPickTeam: (t: TeamRow) => void,
    pitcher: PitchingStorageRow | null,
    sim: PitchingSimOut | null,
  ) => (
    <Card className="overflow-visible border-border/70 shadow-sm bg-card">
      <CardHeader className="pb-2 border-b bg-muted/20">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-3">
        {/* Inputs */}
        <div className="grid grid-cols-5 gap-2">
          <div className="relative col-span-2">
            <Label className="text-xs mb-1 block">Pitcher</Label>
            <Input className="h-8 text-sm" placeholder="Search pitcher..." value={pitcherSearch} onChange={(e) => { setPitcherSearch(e.target.value); setPitcherOpen(true); }} onFocus={() => setPitcherOpen(true)} onBlur={() => setTimeout(() => setPitcherOpen(false), 150)} />
            {pitcherOpen && filterPitchers(pitcherSearch).length > 0 && (
              <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-64 overflow-auto">
                {filterPitchers(pitcherSearch).map((p) => (
                  <div key={p.id} className="px-3 py-1.5 text-sm cursor-pointer hover:bg-accent flex justify-between" onMouseDown={() => onPickPitcher(p)}>
                    <span className="font-medium">{p.player_name}</span>
                    <span className="text-muted-foreground text-[11px]">{p.team || "-"} · {p.role || "-"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="relative col-span-2">
            <Label className="text-xs mb-1 block">To Team</Label>
            <Input className="h-8 text-sm" placeholder="Destination..." value={teamSearch} onChange={(e) => { setTeamSearch(e.target.value); setTeamOpen(true); }} onFocus={() => setTeamOpen(true)} onBlur={() => setTimeout(() => setTeamOpen(false), 150)} />
            {teamOpen && filterTeams(teamSearch).length > 0 && (
              <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-64 overflow-auto">
                {filterTeams(teamSearch).map((t) => (
                  <div key={t.name} className="px-3 py-1.5 text-sm cursor-pointer hover:bg-accent" onMouseDown={() => onPickTeam(t)}>
                    {t.name} <span className="text-muted-foreground text-[11px]">{t.conference || ""}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <Label className="text-xs mb-1 block">Role</Label>
            <Select value={roleOverride} onValueChange={(v) => setRoleOverride(v as "SP" | "RP")}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="SP">SP</SelectItem>
                <SelectItem value="RP">RP</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Selected info */}
        {pitcher && (
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <span className="font-medium text-foreground">{pitcher.player_name}</span>
            <span>{pitcher.handedness === "R" ? "RHP" : pitcher.handedness === "L" ? "LHP" : "-"} · {pitcher.team || "-"}</span>
            <span className="font-mono tabular-nums">{pitcher.era?.toFixed(2) ?? "-"} ERA · {pitcher.k9?.toFixed(1) ?? "-"} K/9</span>
          </div>
        )}

        {/* Results */}
        {sim ? (
          sim.blocked ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700">
              Missing: {sim.missingInputs.join(", ")}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className={`rounded-lg border-2 p-3 text-center ${heroColor(sim.pRvPlus, 110, 95)}`}>
                  <div className="text-muted-foreground text-[10px] uppercase tracking-wide">pRV+</div>
                  <div className="text-2xl font-bold tabular-nums">{whole(sim.pRvPlus)}</div>
                </div>
                <div className={`rounded-lg border-2 p-3 text-center ${heroColor(sim.pWar, 1.5, 0.5)}`}>
                  <div className="text-muted-foreground text-[10px] uppercase tracking-wide">pWAR</div>
                  <div className="text-2xl font-bold tabular-nums">{sim.pWar?.toFixed(2) ?? "-"}</div>
                </div>
                <div className={`rounded-lg border-2 p-3 text-center ${heroColor(sim.marketValue, 75000, 25000)}`}>
                  <div className="text-muted-foreground text-[10px] uppercase tracking-wide">Market Value</div>
                  <div className="text-xl font-bold tabular-nums">{money(sim.marketValue)}</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {([["ERA", sim.pEra, pitchingEq.era_plus_ncaa_avg, false], ["FIP", sim.pFip, pitchingEq.fip_plus_ncaa_avg, false], ["WHIP", sim.pWhip, pitchingEq.whip_plus_ncaa_avg, false]] as const).map(([label, val, avg, hib]) => (
                  <div key={label} className={`rounded border p-2 text-center ${tierStyle(tierByNcaaAverage(val, avg, hib))}`}>
                    <div className="text-muted-foreground text-[10px] uppercase tracking-wide">{label}</div>
                    <div className="text-sm font-bold tabular-nums">{val?.toFixed(2) ?? "-"}</div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {([["K/9", sim.pK9, pitchingEq.k9_plus_ncaa_avg, true], ["BB/9", sim.pBb9, pitchingEq.bb9_plus_ncaa_avg, false], ["HR/9", sim.pHr9, pitchingEq.hr9_plus_ncaa_avg, false]] as const).map(([label, val, avg, hib]) => (
                  <div key={label} className={`rounded border p-2 text-center ${tierStyle(tierByNcaaAverage(val, avg, hib))}`}>
                    <div className="text-muted-foreground text-[10px] uppercase tracking-wide">{label}</div>
                    <div className="text-sm font-bold tabular-nums">{val?.toFixed(2) ?? "-"}</div>
                  </div>
                ))}
              </div>
            </>
          )
        ) : (
          <div className="rounded-md border border-dashed p-4 text-xs text-muted-foreground text-center">
            {pitcher ? "Select a destination team." : "Select a pitcher and destination."}
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <DashboardLayout>
      <div className="space-y-4 max-w-[1400px] mx-auto">
        <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Compare Dashboard</h2>
            <p className="text-muted-foreground text-sm">Side-by-side player comparison using the transfer simulator engine.</p>
          </div>
          <div className="flex gap-1 rounded-lg border bg-muted p-1">
            <button className={`px-4 py-1.5 text-sm rounded-md font-medium transition-colors ${simType === "hitting" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`} onClick={() => setSimType("hitting")}>Hitting</button>
            <button className={`px-4 py-1.5 text-sm rounded-md font-medium transition-colors ${simType === "pitching" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`} onClick={() => setSimType("pitching")}>Pitching</button>
          </div>
        </div>

        {simType === "hitting" ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {renderHitterPanel(
              "Player A", aPlayerSearch, setAPlayerSearch, aPlayerOpen, setAPlayerOpen, aTeamSearch, setATeamSearch, aTeamOpen, setATeamOpen,
              (p) => { setAPlayerId(p.id); setAPlayerSearch(`${p.first_name} ${p.last_name}`); setAPlayerOpen(false); },
              (t) => { setADestTeam(t.name); setATeamSearch(t.name); setATeamOpen(false); },
              aPlayer, aHitterSim, aPrediction, bHitterSim,
            )}
            {renderHitterPanel(
              "Player B", bPlayerSearch, setBPlayerSearch, bPlayerOpen, setBPlayerOpen, bTeamSearch, setBTeamSearch, bTeamOpen, setBTeamOpen,
              (p) => { setBPlayerId(p.id); setBPlayerSearch(`${p.first_name} ${p.last_name}`); setBPlayerOpen(false); },
              (t) => { setBDestTeam(t.name); setBTeamSearch(t.name); setBTeamOpen(false); },
              bPlayer, bHitterSim, bPrediction, aHitterSim,
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {renderPitcherPanel(
              "Pitcher A", aPitcherSearch, setAPitcherSearch, aPitcherOpen, setAPitcherOpen, aTeamSearch, setATeamSearch, aTeamOpen, setATeamOpen,
              aRoleOverride, setARoleOverride,
              (p) => { setAPitcherId(p.id); setAPitcherSearch(p.player_name); setAPitcherOpen(false); if (p.role === "SP") setARoleOverride("SP"); else setARoleOverride("RP"); },
              (t) => { setADestTeam(t.name); setATeamSearch(t.name); setATeamOpen(false); },
              aPitcher, aPitchingSim,
            )}
            {renderPitcherPanel(
              "Pitcher B", bPitcherSearch, setBPitcherSearch, bPitcherOpen, setBPitcherOpen, bTeamSearch, setBTeamSearch, bTeamOpen, setBTeamOpen,
              bRoleOverride, setBRoleOverride,
              (p) => { setBPitcherId(p.id); setBPitcherSearch(p.player_name); setBPitcherOpen(false); if (p.role === "SP") setBRoleOverride("SP"); else setBRoleOverride("RP"); },
              (t) => { setBDestTeam(t.name); setBTeamSearch(t.name); setBTeamOpen(false); },
              bPitcher, bPitchingSim,
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
