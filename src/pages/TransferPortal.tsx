import { useMemo, useState, useEffect, useRef } from "react";
import { CURRENT_SEASON, PRIOR_SEASON, PROJECTION_SEASON } from "@/lib/seasonConstants";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useHitterSeedData } from "@/hooks/useHitterSeedData";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  DEFAULT_NIL_TIER_MULTIPLIERS,
  getPositionValueMultiplier,
  getProgramTierMultiplierByConference,
} from "@/lib/nilProgramSpecific";
import { computeTransferProjection } from "@/lib/transferProjection";
import { computeTransferPitcherProjection } from "@/lib/transferPitcherProjection";
import { getConferenceAliases } from "@/lib/conferenceMapping";
import { profileRouteFor } from "@/lib/profileRoutes";
import { resolveMetricParkFactor, batsHandToHandedness } from "@/lib/parkFactors";
import { useParkFactors } from "@/hooks/useParkFactors";
import { computeHitterPowerRatings } from "@/lib/powerRatings";
import { useTeamsTable } from "@/hooks/useTeamsTable";
import { useEffectiveSchool } from "@/hooks/useEffectiveSchool";
import { readPitchingWeights } from "@/lib/pitchingEquations";
import { useConferenceStats } from "@/hooks/useConferenceStats";
import { usePitchingSeedData } from "@/hooks/usePitchingSeedData";
import { useTargetBoard } from "@/hooks/useTargetBoard";
import { assessHitterRisk, assessPitcherRisk } from "@/lib/playerRisk";
import type { RiskFactor, RiskAssessment } from "@/lib/playerRisk";
import { JucoPitcherRiskCard, JucoHitterRiskCard } from "@/components/JucoRiskCards";
import { RiskAssessmentCardRSTR } from "@/components/RiskAssessmentCard";
import { TRANSFER_WEIGHT_DEFAULTS, transferWeightsForSource, JUCO_PITCHING_TRANSFER_WEIGHTS, JUCO_DISTRICT_HTP_OVERRIDE, JUCO_DISTRICT_CONFERENCE_ID, jucoDistrictNameFromConference, applyJucoOutlierRegression, JUCO_REGRESSION_CONFIG } from "@/lib/transferWeightDefaults";
import { computeDataReliability } from "@/lib/jucoDataReliability";
import { pickPreferredPrediction } from "@/lib/teamScopedPredictions";

type SimPlayer = {
  prediction_id: string | null;
  player_id: string;
  model_type: string | null;
  first_name: string;
  last_name: string;
  position: string | null;
  team: string | null;
  from_team: string | null;
  conference: string | null;
  division: string | null;
  from_avg: number | null;
  from_obp: number | null;
  from_slg: number | null;
  power_rating_plus: number | null;
  class_transition: string | null;
  dev_aggressiveness: number | null;
  team_id: string | null;
  source_team_id: string | null;
  bats_hand: string | null;
};

type ConferenceRow = {
  conference: string;
  conference_id: string | null;
  season?: number | null;
  avg_plus: number | null;
  obp_plus: number | null;
  iso_plus: number | null;
  stuff_plus: number | null;
  wrc_plus?: number | null;
  offensive_power_rating?: number | null;
};

type TeamRow = {
  id?: string;
  name: string;
  conference: string | null;
  conference_id?: string | null;
  park_factor: number | null;
  source_team_id?: string | null;
};

type SeedRow = {
  playerName: string;
  team: string | null;
  avg: number | null;
  obp: number | null;
  slg: number | null;
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
  division: string | null;
  stuffPlus: number | null;
  // JUCO data-reliability inputs + Skillset metric inputs.
  trackmanPitches: number | null;
  bf: number | null;
  missPct: number | null;
  bbPct: number | null;
  hardHitPct: number | null;
  inZoneWhiffPct: number | null;
  chasePct: number | null;
  barrelPct: number | null;
  groundPct: number | null;
};

type PitchingPowerSnapshot = {
  eraPrPlus: number | null;
  fipPrPlus: number | null;
  whipPrPlus: number | null;
  k9PrPlus: number | null;
  hr9PrPlus: number | null;
  bb9PrPlus: number | null;
};

type PitchingSim = {
  blocked: boolean;
  missingInputs: string[];
  pEra: number | null;
  pFip: number | null;
  pWhip: number | null;
  pK9: number | null;
  pBb9: number | null;
  pHr9: number | null;
  pRvPlus: number | null;
  pWar: number | null;
  marketValue: number | null;
  projectedRole: "SP" | "RP";
  fromConference: string | null;
  toConference: string | null;
  fromEraPlus: number | null;
  toEraPlus: number | null;
  fromFipPlus: number | null;
  toFipPlus: number | null;
  fromWhipPlus: number | null;
  toWhipPlus: number | null;
  fromK9Plus: number | null;
  toK9Plus: number | null;
  fromBb9Plus: number | null;
  toBb9Plus: number | null;
  fromHr9Plus: number | null;
  toHr9Plus: number | null;
  fromHitterTalent: number | null;
  toHitterTalent: number | null;
  fromEraParkRaw: number | null;
  toEraParkRaw: number | null;
  fromWhipParkRaw: number | null;
  toWhipParkRaw: number | null;
  fromHr9ParkRaw: number | null;
  toHr9ParkRaw: number | null;
  weights: {
    eraPower: number;
    eraConference: number;
    eraCompetition: number;
    eraPark: number;
    fipPower: number;
    fipConference: number;
    fipCompetition: number;
    fipPark: number;
    whipPower: number;
    whipConference: number;
    whipCompetition: number;
    whipPark: number;
    k9Power: number;
    k9Conference: number;
    k9Competition: number;
    bb9Power: number;
    bb9Conference: number;
    bb9Competition: number;
    hr9Power: number;
    hr9Conference: number;
    hr9Competition: number;
    hr9Park: number;
  } | null;
  showWork: {
    era: { last: number; powerAdj: number; blended: number; mult: number; projected: number; roleAdjusted: number | null; confTerm: number; compTerm: number; parkTerm: number; powerRatingPlus: number | null; powerRatingStdDev: number; ncaaStatStdDev: number; ncaaAvg: number };
    fip: { last: number; powerAdj: number; blended: number; mult: number; projected: number; roleAdjusted: number | null; confTerm: number; compTerm: number; parkTerm: number; powerRatingPlus: number | null; powerRatingStdDev: number; ncaaStatStdDev: number; ncaaAvg: number };
    whip: { last: number; powerAdj: number; blended: number; mult: number; projected: number; roleAdjusted: number | null; confTerm: number; compTerm: number; parkTerm: number; powerRatingPlus: number | null; powerRatingStdDev: number; ncaaStatStdDev: number; ncaaAvg: number };
    k9: { last: number; powerAdj: number; blended: number; mult: number; projected: number; roleAdjusted: number | null; confTerm: number; compTerm: number; parkTerm: number; powerRatingPlus: number | null; powerRatingStdDev: number; ncaaStatStdDev: number; ncaaAvg: number };
    bb9: { last: number; powerAdj: number; blended: number; mult: number; projected: number; roleAdjusted: number | null; confTerm: number; compTerm: number; parkTerm: number; powerRatingPlus: number | null; powerRatingStdDev: number; ncaaStatStdDev: number; ncaaAvg: number };
    hr9: { last: number; powerAdj: number; blended: number; mult: number; projected: number; roleAdjusted: number | null; confTerm: number; compTerm: number; parkTerm: number; powerRatingPlus: number | null; powerRatingStdDev: number; ncaaStatStdDev: number; ncaaAvg: number };
  } | null;
};

const stat = (v: number | null | undefined, d = 3) => (v == null ? "-" : v.toFixed(d));
const whole = (v: number | null | undefined) => (v == null ? "-" : Math.round(v).toString());
const money = (v: number | null | undefined) => (v == null ? "-" : `$${Math.round(v).toLocaleString("en-US")}`);
const formatPark = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "-";
  const scaled = Math.abs(v) <= 3 ? v * 100 : v;
  return Math.round(scaled).toString();
};

const normalizeKey = (value: string | null | undefined) =>
  (value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const normalizeCompact = (value: string | null | undefined) =>
  (value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const normalizeConferencePitching = (value: string | null | undefined) => {
  const k = normalizeKey(value);
  if (!k) return "";
  if (k === "acc" || k.includes("atlantic coast")) return "acc";
  if (k === "sec" || k.includes("southeastern")) return "sec";
  if (k === "aac" || k.includes("american athletic")) return "american athletic conference";
  if (k === "a 10" || k === "a10" || k.includes("atlantic 10")) return "atlantic 10";
  if (k === "caa" || k.includes("coastal athletic")) return "coastal athletic association";
  if (k === "mwc" || k.includes("mountain west")) return "mountain west";
  if (k === "mac" || k.includes("mid american")) return "mid american conference";
  if (k.includes("america east") || k.includes("american east")) return "american east";
  return k;
};
const storagePitcherRouteFor = (playerName: string, teamName: string | null | undefined) => {
  const nameEnc = encodeURIComponent((playerName || "").trim());
  const teamEnc = encodeURIComponent((teamName || "").trim());
  return `/dashboard/pitcher/storage__${nameEnc}__${teamEnc}`;
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

const parseNum = (value: string | undefined) => {
  if (!value) return null;
  const n = Number(String(value).replace(/[%,$]/g, "").trim());
  return Number.isFinite(n) ? n : null;
};

const resolvePitchingStatsView = (values: string[]) => {
  // Legacy layout:
  // [0 Name,1 Team,2 Hand,3 ERA,4 FIP,5 WHIP,6 K9,7 BB9,8 HR9,9 G,10 GS,11 IP,12 Role]
  // New layout:
  // [0 Name,1 Team,2 Hand,3 Role,4 IP,5 G,6 GS,7 ERA,8 FIP,9 WHIP,10 K9,11 BB9,12 HR9]
  const legacyEra = parseNum(values[3]);
  const isLegacy = legacyEra != null;
  if (isLegacy) {
    return {
      role: values[12] || "",
      era: values[3] || "",
      fip: values[4] || "",
      whip: values[5] || "",
      k9: values[6] || "",
      bb9: values[7] || "",
      hr9: values[8] || "",
    };
  }
  return {
    role: values[3] || "",
    era: values[7] || "",
    fip: values[8] || "",
    whip: values[9] || "",
    k9: values[10] || "",
    bb9: values[11] || "",
    hr9: values[12] || "",
  };
};

const toPitchingRole = (raw: string | null | undefined): "SP" | "RP" | "SM" | null => {
  const v = String(raw || "").trim().toUpperCase();
  if (v === "SP" || v === "RP" || v === "SM") return v;
  return null;
};

const getPitchingPvfForRole = (
  role: "SP" | "RP" | "SM",
  eq: ReturnType<typeof readPitchingWeights>,
) => (role === "RP" ? eq.market_pvf_reliever : role === "SM" ? eq.market_pvf_weekday_sp : eq.market_pvf_weekend_sp);

const canShowPitchingMarketValue = (team: string | null | undefined, conference: string | null | undefined) => {
  const conf = String(conference || "").trim().toLowerCase();
  const tm = String(team || "").trim().toLowerCase();
  if (!conf) return false;
  const isIndependent = conf === "independent" || conf.includes("independent");
  if (!isIndependent) return true;
  return tm === "oregon state" || tm.includes("oregon state");
};

const applyRoleTransitionAdjustment = (
  value: number | null,
  pct: number,
  fromRole: "SP" | "RP" | "SM" | null,
  toRole: "SP" | "RP" | "SM" | null,
  lowerIsBetter: boolean,
  rpToSpLowBetterCurve?: {
    tier1Max: number;
    tier2Max: number;
    tier3Max: number;
    tier1Mult: number;
    tier2Mult: number;
    tier3Mult: number;
  },
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

const tierStyle = (tier: "good" | "avg" | "bad") => {
  if (tier === "good") return "border-[hsl(var(--success)/0.35)] bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))]";
  if (tier === "avg") return "border-[hsl(var(--warning)/0.35)] bg-[hsl(var(--warning)/0.12)] text-[hsl(var(--warning))]";
  return "border-destructive/35 bg-destructive/12 text-destructive";
};

const statTier = (
  key: "avg" | "obp" | "slg" | "ops" | "iso" | "wrc_plus" | "owar" | "nil",
  value: number | null | undefined,
): "good" | "avg" | "bad" => {
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

const tierByNcaaAverage = (
  value: number | null | undefined,
  ncaaAvg: number,
  higherIsBetter: boolean,
): "good" | "avg" | "bad" => {
  if (value == null || !Number.isFinite(value) || !Number.isFinite(ncaaAvg) || ncaaAvg <= 0) return "avg";
  const goodCut = higherIsBetter ? ncaaAvg * 1.1 : ncaaAvg * 0.9;
  const avgCut = higherIsBetter ? ncaaAvg * 0.9 : ncaaAvg * 1.1;
  if (higherIsBetter) return value >= goodCut ? "good" : value >= avgCut ? "avg" : "bad";
  return value <= goodCut ? "good" : value <= avgCut ? "avg" : "bad";
};

const pitchingOutcomeTier = (
  key: "era" | "fip" | "whip" | "k9" | "bb9" | "hr9",
  value: number | null | undefined,
  eq: ReturnType<typeof readPitchingWeights>,
): "good" | "avg" | "bad" => {
  if (key === "era") return tierByNcaaAverage(value, eq.era_plus_ncaa_avg, false);
  if (key === "fip") return tierByNcaaAverage(value, eq.fip_plus_ncaa_avg, false);
  if (key === "whip") return tierByNcaaAverage(value, eq.whip_plus_ncaa_avg, false);
  if (key === "k9") return tierByNcaaAverage(value, eq.k9_plus_ncaa_avg, true);
  if (key === "bb9") return tierByNcaaAverage(value, eq.bb9_plus_ncaa_avg, false);
  return tierByNcaaAverage(value, eq.hr9_plus_ncaa_avg, false);
};

const conferenceKeyAliases = getConferenceAliases;

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const toRate = (n: number) => (Math.abs(n) > 1 ? n / 100 : n);
// Weight parser for transfer multipliers:
// - keep small scalar entries as-is (e.g. 2 => 2)
// - still support legacy percent-style entries (e.g. 70 => 0.70, 100 => 1.0)
const toWeight = (n: number) => (Math.abs(n) >= 10 ? n / 100 : n);
const normalizeParkToIndex = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return 100;
  return Math.abs(n) <= 3 ? n * 100 : n;
};
const resolveParkFactorFromCandidates = (
  teamId: string | null | undefined,
  names: Array<string | null | undefined>,
  metric: "avg" | "obp" | "iso" | "era" | "whip" | "hr9",
  map: Record<string, any>,
) => {
  // Try UUID first
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
  // Final soft match: contains either direction on compact keys.
  let best: TeamRow | null = null;
  let bestScore = -1;
  for (const c of cleaned) {
    const compactCandidate = normalizeCompact(c);
    if (!compactCandidate) continue;
    for (const t of allTeams) {
      const compactTeam = normalizeCompact(t.name);
      if (!compactTeam) continue;
      if (!(compactTeam.includes(compactCandidate) || compactCandidate.includes(compactTeam))) continue;
      const score = Math.min(compactTeam.length, compactCandidate.length);
      if (score > bestScore) {
        best = t;
        bestScore = score;
      }
    }
  }
  return best;
};
const statKey = (v: number | null | undefined) => (v == null ? "na" : round3(v).toFixed(3));
const calcPitchingPlus = (
  statValue: number | null,
  ncaaAvg: number,
  ncaaSd: number,
  scale: number,
  higherIsBetter = false,
) => {
  if (statValue == null || !Number.isFinite(statValue) || !Number.isFinite(ncaaAvg) || !Number.isFinite(ncaaSd) || ncaaSd === 0) return null;
  const z = higherIsBetter
    ? ((statValue - ncaaAvg) / ncaaSd)
    : ((ncaaAvg - statValue) / ncaaSd);
  return round3(100 + (z * scale));
};

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

const calcHitterTalentPlusFromConference = (
  overallHitterPowerRatingPlus: number | null | undefined,
  stuffPlus: number | null | undefined,
  wrcPlus: number | null | undefined,
) => {
  if (
    overallHitterPowerRatingPlus == null ||
    !Number.isFinite(overallHitterPowerRatingPlus) ||
    stuffPlus == null ||
    !Number.isFinite(stuffPlus) ||
    wrcPlus == null ||
    !Number.isFinite(wrcPlus)
  ) return null;
  const value = overallHitterPowerRatingPlus + (1.25 * (stuffPlus - 100)) + (0.75 * (100 - wrcPlus));
  return Number.isFinite(value) ? Number(value.toFixed(1)) : null;
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

// JUCO risk cards (pitcher + hitter) live in @/components/JucoRiskCards.

export default function TransferPortal() {
  const location = useLocation();
  const { toast } = useToast();
  const { hasRole, effectiveTeamId, loading: authLoading } = useAuth();
  const { hitterStats, powerRatings } = useHitterSeedData();
  const { addPlayer: addToSupabaseBoard, isOnBoard: isOnSupabaseBoard } = useTargetBoard();
  const isAdmin = hasRole("admin");

  // Persist simulator state across navigation (e.g., clicking a Profile link
  // and using the back button). React Router unmounts TP on route change,
  // destroying useState. sessionStorage survives in-tab navigation so the
  // user lands back on the same player + destination they were inspecting.
  const SESSION_KEY = "rstr.tp.state.v1";
  const initialState = (() => {
    if (typeof window === "undefined") return null;
    try { return JSON.parse(window.sessionStorage.getItem(SESSION_KEY) || "null"); }
    catch { return null; }
  })();

  const [selectedPlayerId, setSelectedPlayerId] = useState<string>(initialState?.selectedPlayerId ?? "");
  const [playerSearch, setPlayerSearch] = useState<string>("");
  const [divisionFilter, setDivisionFilter] = useState<"D1" | "JUCO">(initialState?.divisionFilter ?? "D1");
  const [selectedDestinationTeam, setSelectedDestinationTeam] = useState<string>(initialState?.selectedDestinationTeam ?? "");
  const [teamSearch, setTeamSearch] = useState<string>("");

  // Pre-fill the destination team with the impersonated school. Coaches
  // demoing as their program shouldn't have to retype "Kansas Jayhawks"
  // every time they open the simulator. Replaces the old DEMO_SCHOOL default.
  const { schoolName: effectiveSchoolName, allowAllTeams } = useEffectiveSchool();
  // Always pin destination to the current effective school. Whether you just
  // logged in, switched team via superadmin impersonation, or navigated back
  // to this page, the destination follows your active school. Trade-off:
  // superadmin's manual destination choice doesn't survive a route change
  // (back-from-profile), but that's a smaller cost than leaking another
  // team's destination across impersonations. After mount, the user is free
  // to change destination manually; the ref-equality guard prevents this
  // effect from clobbering it.
  const lastEffectiveSchoolRef = useRef<string | null>(null);
  useEffect(() => {
    if (!effectiveSchoolName) return;
    if (lastEffectiveSchoolRef.current === effectiveSchoolName) return;
    lastEffectiveSchoolRef.current = effectiveSchoolName;
    setSelectedDestinationTeam(effectiveSchoolName);
    setTeamSearch(effectiveSchoolName);
  }, [effectiveSchoolName]);
  const [simType, setSimType] = useState<"hitting" | "pitching">(initialState?.simType ?? "hitting");
  const [selectedPitcherId, setSelectedPitcherId] = useState<string>(initialState?.selectedPitcherId ?? "");
  const [pitcherSearch, setPitcherSearch] = useState<string>("");
  const [pitchingRoleOverride, setPitchingRoleOverride] = useState<"SP" | "RP">(initialState?.pitchingRoleOverride ?? "RP");

  // Mirror state to sessionStorage on every change so the back-from-profile
  // round-trip lands on the same selection.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        selectedPlayerId, selectedDestinationTeam, divisionFilter,
        simType, selectedPitcherId, pitchingRoleOverride,
      }));
    } catch { /* sessionStorage quota / disabled — ignore */ }
  }, [selectedPlayerId, selectedDestinationTeam, divisionFilter, simType, selectedPitcherId, pitchingRoleOverride]);
  const pitchingEqForTiers = useMemo(() => readPitchingWeights(), []);
  const { conferenceStats: newConfStats } = useConferenceStats(2026);

  const { data: players = [], isLoading: playersLoading } = useQuery({
    queryKey: ["transfer-sim-players"],
    // Heavy query: ~32K players + ~100K prediction rows. Cache aggressively
    // — data only changes when an admin imports or a precompute runs, not
    // mid-session. Without this the page re-fetched on every tab focus.
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      let allPlayers: any[] = [];
      let from = 0;
      const PAGE_SIZE = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("players")
          .select("id, first_name, last_name, position, team, from_team, conference, division, transfer_portal, team_id, source_team_id, source_player_id, bats_hand")
          // Stable ORDER BY for deterministic pagination — without it,
          // adjacent .range() calls overlap or skip rows non-determin-
          // istically and the downstream dedup shrinks the player set.
          .order("id", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        allPlayers = allPlayers.concat(data || []);
        if (!data || data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      let allPredRows: any[] = [];
      let predFrom = 0;
      while (true) {
        const { data, error } = await supabase
          .from("player_predictions")
          .select(`
            id,
            player_id,
            model_type,
            variant,
            status,
            updated_at,
            from_avg,
            from_obp,
            from_slg,
            power_rating_plus,
            class_transition,
            dev_aggressiveness
          `)
          .eq("season", PROJECTION_SEASON)
          .in("model_type", ["returner", "transfer"])
          .order("id", { ascending: true })
          .range(predFrom, predFrom + PAGE_SIZE - 1);
        if (error) throw error;
        allPredRows = allPredRows.concat(data || []);
        if (!data || data.length < PAGE_SIZE) break;
        predFrom += PAGE_SIZE;
      }

      const playersById = new Map<string, any>();
      for (const p of allPlayers || []) playersById.set(p.id, p);

      const rank = (row: any) => {
        const hasFrom = row.from_avg != null || row.from_obp != null || row.from_slg != null;
        const hasPower = row.power_rating_plus != null;
        const statusBoost = row.status === "active" ? 2 : row.status === "departed" ? 1 : 0;
        const variantBoost = row.variant === "regular" ? 3 : 0;
        const modelMatchBoost =
          (playersById.get(row.player_id)?.transfer_portal === true && row.model_type === "transfer") ||
          (playersById.get(row.player_id)?.transfer_portal !== true && row.model_type === "returner")
            ? 4
            : 0;
        return modelMatchBoost + variantBoost + statusBoost + (row.model_type === "transfer" ? 3 : 1) + (hasFrom ? 2 : 0) + (hasPower ? 1 : 0);
      };

      const byPlayer = new Map<string, any>();
      for (const row of allPredRows || []) {
        const key = row.player_id as string;
        const existing = byPlayer.get(key);
        if (!existing) {
          byPlayer.set(key, row);
          continue;
        }
        const rowScore = rank(row);
        const existingScore = rank(existing);
        if (rowScore > existingScore) {
          byPlayer.set(key, row);
          continue;
        }
        if (rowScore === existingScore) {
          const rowTs = new Date(row.updated_at || 0).getTime();
          const existingTs = new Date(existing.updated_at || 0).getTime();
          if (rowTs > existingTs) byPlayer.set(key, row);
        }
      }

      return (allPlayers || [])
        .map((p: any) => {
          const row = byPlayer.get(p.id);
          return {
            prediction_id: (row?.id as string | undefined) ?? null,
            player_id: p.id as string,
            model_type: (row?.model_type as string | undefined) ?? null,
            first_name: p.first_name as string,
            last_name: p.last_name as string,
            position: p.position as string | null,
            team: p.team as string | null,
            from_team: p.from_team as string | null,
            conference: p.conference as string | null,
            division: (p.division as string | null) ?? null,
            team_id: (p.team_id as string | null) ?? null,
            source_team_id: (p.source_team_id as string | null) ?? null,
            source_player_id: (p.source_player_id as string | null) ?? null,
            bats_hand: (p.bats_hand as string | null) ?? null,
            from_avg: (row?.from_avg as number | undefined) ?? null,
            from_obp: (row?.from_obp as number | undefined) ?? null,
            from_slg: (row?.from_slg as number | undefined) ?? null,
            power_rating_plus: (row?.power_rating_plus as number | undefined) ?? null,
            class_transition: (row?.class_transition as string | undefined) ?? null,
            dev_aggressiveness: Number.isFinite(Number(row?.dev_aggressiveness))
              ? Number(row?.dev_aggressiveness)
              : null,
          };
        })
        .filter((p) => !!p.first_name && !!p.last_name)
        .sort((a, b) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`)) as SimPlayer[];
    },
  });

  const { teams } = useTeamsTable();

  const conferenceStats: ConferenceRow[] = useMemo(() => {
    const byConf = new Map<string, { row: ConferenceRow; score: number }>();
    for (const raw of newConfStats) {
      const key = normalizeKey(raw.conference);
      if (!key) continue;
      const row: ConferenceRow = {
        conference: raw.conference,
        conference_id: (raw as any).conference_id ?? null,
        season: raw.season,
        avg_plus: raw.avg != null ? Math.round((raw.avg / 0.280) * 100) : null,
        obp_plus: raw.obp != null ? Math.round((raw.obp / 0.385) * 100) : null,
        iso_plus: raw.iso != null ? Math.round((raw.iso / 0.162) * 100) : null,
        stuff_plus: raw.stuff_plus,
        wrc_plus: raw.wrc_plus ?? null,
        offensive_power_rating: raw.overall_power_rating ?? null,
      };
      const score =
        (row.avg_plus != null ? 1 : 0) +
        (row.obp_plus != null ? 1 : 0) +
        (row.iso_plus != null ? 1 : 0) +
        (row.stuff_plus != null ? 1 : 0) +
        (row.wrc_plus != null ? 1 : 0) +
        (row.offensive_power_rating != null ? 1 : 0);
      const existing = byConf.get(key);
      if (!existing || score > existing.score) {
        byConf.set(key, { row, score });
      }
    }
    return Array.from(byConf.values()).map((v) => v.row);
  }, [newConfStats]);

  const { data: remoteEquationValues = {} } = useQuery({
    queryKey: ["admin-ui-equation-values", CURRENT_SEASON, effectiveTeamId],
    // Gate on auth so effectiveTeamId is stable on first fire — same race
    // we killed in ReturningPlayers.
    enabled: !authLoading,
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("model_config")
        .select("config_key, config_value")
        .eq("model_type", "admin_ui")
        .eq("season", CURRENT_SEASON);
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const row of data || []) map[row.config_key] = Number(row.config_value);
      // Per-team override overlay: when a customer team is active (impersonation
      // or coach login), team-specific equation weights win for the live
      // simulator math. Without a team, agents see canonical global numbers.
      if (effectiveTeamId) {
        const { data: overrides } = await (supabase as any)
          .from("customer_team_equation_overrides")
          .select("config_key, config_value")
          .eq("customer_team_id", effectiveTeamId)
          .in("model_type", ["transfer", "global", "admin_ui"]);
        for (const row of overrides || []) map[row.config_key] = Number(row.config_value);
      }
      return map;
    },
  });

  const selectedPlayer = useMemo(
    () => players.find((p) => p.player_id === selectedPlayerId) || null,
    [players, selectedPlayerId],
  );

  const filteredPlayers = useMemo(() => {
    // TWP intentionally NOT treated as pitcher — two-way players default to
    // the hitter side per TeamBuilder convention, so they should appear in
    // the hitter dropdown. They show up in the pitcher dropdown via
    // pitchingMasterRows when their IP qualifies them.
    const isPitcher = (pos: string | null | undefined) => /^(SP|RP|CL|P|LHP|RHP)/i.test(String(pos || ""));
    const matchesDivision = (d: string | null) => {
      if (divisionFilter === "JUCO") return d === "NJCAA_D1";
      // D1 default — exclude JUCO, include null (legacy D1 rows without division)
      return d !== "NJCAA_D1";
    };
    const q = normalizeKey(playerSearch);
    const pool = (q
      ? players.filter((p) =>
          normalizeKey(`${p.first_name} ${p.last_name} ${(p.from_team || p.team || "")} ${(p.position || "")}`).includes(q),
        )
      : players
    ).filter((p) => !isPitcher(p.position) && matchesDivision(p.division));
    return pool.slice(0, 25);
  }, [players, playerSearch, divisionFilter]);

  const filteredTeams = useMemo(() => {
    const q = normalizeKey(teamSearch);
    const pool = q
      ? teams.filter((t) =>
          `${t.name} ${t.conference || ""}`.toLowerCase().includes(q),
        )
      : teams;
    return pool.slice(0, 30);
  }, [teams, teamSearch]);
  const { parkMap: teamParkComponents } = useParkFactors();

  const { pitchers: pitchingMasterRows } = usePitchingSeedData();

  const pitchingPlayers = useMemo<PitchingStorageRow[]>(() => {
    return pitchingMasterRows.map((r, idx) => {
      const games = r.g != null ? Number(r.g) : null;
      const starts = r.gs != null ? Number(r.gs) : null;
      const derivedRole = toPitchingRole(r.role) || (games != null && games > 0 && starts != null ? ((starts / games) < 0.5 ? "RP" : "SP") : null);
      return {
        id: r.id || `pitching-tp-${idx}`,
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
        division: (r as any).division ?? null,
        stuffPlus: (r as any).stuffPlus ?? null,
        trackmanPitches: (r as any).trackman_pitches != null ? Number((r as any).trackman_pitches) : null,
        bf: (r as any).bf != null ? Number((r as any).bf) : null,
        missPct: (r as any).miss_pct != null ? Number((r as any).miss_pct) : null,
        bbPct: (r as any).bb_pct != null ? Number((r as any).bb_pct) : null,
        hardHitPct: (r as any).hard_hit_pct != null ? Number((r as any).hard_hit_pct) : null,
        inZoneWhiffPct: (r as any).in_zone_whiff_pct != null ? Number((r as any).in_zone_whiff_pct) : null,
        chasePct: (r as any).chase_pct != null ? Number((r as any).chase_pct) : null,
        barrelPct: (r as any).barrel_pct != null ? Number((r as any).barrel_pct) : null,
        groundPct: (r as any).ground_pct != null ? Number((r as any).ground_pct) : null,
      };
    }).filter((r) => !!r.player_name);
  }, [pitchingMasterRows]);

  const selectedPitcher = useMemo(
    () => pitchingPlayers.find((p) => p.id === selectedPitcherId) || null,
    [pitchingPlayers, selectedPitcherId],
  );

  useEffect(() => {
    if (!selectedPitcher) return;
    const isJuco = selectedPitcher.division === "NJCAA_D1";
    if ((divisionFilter === "JUCO" && !isJuco) || (divisionFilter === "D1" && isJuco)) {
      setSelectedPitcherId("");
      setPitcherSearch("");
    }
  }, [divisionFilter, selectedPitcher]);

  const pitchingPowerByKey = useMemo(() => {
    const byNameTeam = new Map<string, PitchingPowerSnapshot>();
    const byName = new Map<string, PitchingPowerSnapshot>();
    const bySourceId = new Map<string, PitchingPowerSnapshot>();
    // Score calculation helpers
    const EQ = { p_ncaa_avg_stuff_plus: 100, p_ncaa_avg_whiff_pct: 22.9, p_ncaa_avg_bb_pct: 11.3, p_ncaa_avg_hh_pct: 36, p_ncaa_avg_in_zone_whiff_pct: 16.4, p_ncaa_avg_chase_pct: 23.1, p_ncaa_avg_barrel_pct: 17.3, p_ncaa_avg_ld_pct: 20.9, p_ncaa_avg_avg_ev: 86.2, p_ncaa_avg_gb_pct: 43.2, p_ncaa_avg_in_zone_pct: 47.2, p_ncaa_avg_ev90: 103.1, p_ncaa_avg_pull_pct: 36.5, p_ncaa_avg_la_10_30_pct: 29, p_sd_stuff_plus: 3.967566764, p_sd_whiff_pct: 5.476169924, p_sd_bb_pct: 2.92040411, p_sd_hh_pct: 6.474203457, p_sd_in_zone_whiff_pct: 4.299203457, p_sd_chase_pct: 4.619392309, p_sd_barrel_pct: 4.988140199, p_sd_ld_pct: 3.580670928, p_sd_avg_ev: 2.362900608, p_sd_gb_pct: 6.958760046, p_sd_in_zone_pct: 3.325412065, p_sd_ev90: 1.767350585, p_sd_pull_pct: 5.356686254, p_sd_la_10_30_pct: 5.773803471, p_era_stuff_plus_weight: 0.21, p_era_whiff_pct_weight: 0.23, p_era_bb_pct_weight: 0.17, p_era_hh_pct_weight: 0.07, p_era_in_zone_whiff_pct_weight: 0.12, p_era_chase_pct_weight: 0.08, p_era_barrel_pct_weight: 0.12, p_era_ncaa_avg_power_rating: 50, p_ncaa_avg_whip_power_rating: 50, p_ncaa_avg_k9_power_rating: 50, p_ncaa_avg_bb9_power_rating: 50, p_ncaa_avg_hr9_power_rating: 50, p_fip_hr9_power_rating_plus_weight: 0.45, p_fip_bb9_power_rating_plus_weight: 0.3, p_fip_k9_power_rating_plus_weight: 0.25, p_whip_bb_pct_weight: 0.25, p_whip_ld_pct_weight: 0.2, p_whip_avg_ev_weight: 0.15, p_whip_whiff_pct_weight: 0.25, p_whip_gb_pct_weight: 0.1, p_whip_chase_pct_weight: 0.05, p_k9_whiff_pct_weight: 0.35, p_k9_stuff_plus_weight: 0.3, p_k9_in_zone_whiff_pct_weight: 0.25, p_k9_chase_pct_weight: 0.1, p_bb9_bb_pct_weight: 0.55, p_bb9_in_zone_pct_weight: 0.3, p_bb9_chase_pct_weight: 0.15, p_hr9_barrel_pct_weight: 0.32, p_hr9_ev90_weight: 0.24, p_hr9_gb_pct_weight: 0.18, p_hr9_pull_pct_weight: 0.14, p_hr9_la_10_30_pct_weight: 0.12 };
    const normalCdf = (x: number) => { const sign = x < 0 ? -1 : 1; const ax = Math.abs(x) / Math.sqrt(2); const t = 1 / (1 + 0.3275911 * ax); const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-ax * ax)); return 0.5 * (1 + erf); };
    const cs = (v: number | null, avg: number, sd: number, lib = false) => { if (v == null || sd <= 0) return null; const p = normalCdf((v - avg) / sd) * 100; return lib ? 100 - p : p; };
    const s = (v: number | null | undefined) => v == null ? null : Number(v);
    const nws = (items: Array<{ v: number; w: number }>) => { const wt = items.reduce((a, i) => a + (i.v * i.w), 0); const tw = items.reduce((a, i) => a + i.w, 0); return tw > 0 ? wt / tw : null; };

    for (const pr of pitchingMasterRows) {
      const name = (pr.playerName || "").trim();
      const team = (pr.team || "").trim();
      if (!name) continue;
      // Calculate scores from raw metrics — use stuff_plus from Pitching Master when available
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
      // Calculate PR+ from scores
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
      // Prefer pre-computed PR+ values written by the projection pipeline
      // (Pitching Master.era_pr_plus etc.) — this is what TB reads via
      // pitchingPrByNameTeam (the #9 fix). Live-recomputed values above are
      // a fallback for rows the pipeline hasn't filled yet, but they use
      // hardcoded equation weights from a previous calibration era and will
      // diverge from TB whenever the pipeline runs with newer weights.
      const snapshot: PitchingPowerSnapshot = {
        eraPrPlus: pr.era_pr_plus ?? eraPr,
        fipPrPlus: pr.fip_pr_plus ?? fipPr,
        whipPrPlus: pr.whip_pr_plus ?? whipPr,
        k9PrPlus: pr.k9_pr_plus ?? k9Pr,
        hr9PrPlus: pr.hr9_pr_plus ?? hr9Pr,
        bb9PrPlus: pr.bb9_pr_plus ?? bb9Pr,
      };
      // ID-first: index by source_player_id
      if (pr.source_player_id) bySourceId.set(pr.source_player_id, snapshot);
      // Name fallback
      const nameKey = normalizeKey(name);
      const teamKey = normalizeKey(team);
      if (nameKey && !byName.has(nameKey)) byName.set(nameKey, snapshot);
      if (nameKey && teamKey && !byNameTeam.has(`${nameKey}|${teamKey}`)) {
        byNameTeam.set(`${nameKey}|${teamKey}`, snapshot);
      }
    }
    return { byNameTeam, byName, bySourceId };
  }, [pitchingMasterRows]);

  const selectedPitcherPower = useMemo<PitchingPowerSnapshot | null>(() => {
    if (!selectedPitcher) return null;
    // ID-first: try source_player_id (stored as id on PitchingStorageRow)
    const byId = selectedPitcher.id ? pitchingPowerByKey.bySourceId.get(selectedPitcher.id) : undefined;
    if (byId) return byId;
    // Name fallback
    const nameKey = normalizeKey(selectedPitcher.player_name);
    const teamKey = normalizeKey(selectedPitcher.team);
    if (!nameKey) return null;
    return (
      (teamKey ? pitchingPowerByKey.byNameTeam.get(`${nameKey}|${teamKey}`) : null) ||
      pitchingPowerByKey.byName.get(nameKey) ||
      null
    );
  }, [pitchingPowerByKey, selectedPitcher]);

  const filteredPitchers = useMemo(() => {
    const q = normalizeKey(pitcherSearch);
    const matchesDivision = (d: string | null) => {
      if (divisionFilter === "JUCO") return d === "NJCAA_D1";
      return d !== "NJCAA_D1";
    };
    const divPool = pitchingPlayers.filter((p) => matchesDivision(p.division));
    const pool = q
      ? divPool.filter((p) => normalizeKey(`${p.player_name} ${p.team || ""} ${p.handedness || ""}`).includes(q))
      : divPool;
    return pool.slice(0, 25);
  }, [pitchingPlayers, pitcherSearch, divisionFilter]);

  // Career seasons for the selected HITTER — fuels the trajectory risk
  // factor (PlayerProfile / TeamBuilder already pass this; TPS was missing
  // it, so trajectory always showed "Unknown" here).
  const { data: hitterCareerSeasons = [] } = useQuery({
    queryKey: ["transfer-sim-hitter-career", selectedPlayer?.source_player_id ?? null],
    enabled: !!selectedPlayer?.source_player_id,
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!selectedPlayer?.source_player_id) return [];
      const { data, error } = await (supabase as any)
        .from("Hitter Master")
        .select("*")
        .eq("source_player_id", selectedPlayer.source_player_id)
        .order("Season", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Career seasons for the selected PITCHER. selectedPitcher.id IS the
  // source_player_id (see usePitchingSeedData mapping).
  const { data: pitcherCareerSeasons = [] } = useQuery({
    queryKey: ["transfer-sim-pitcher-career", selectedPitcher?.id ?? null],
    enabled: !!selectedPitcher?.id && !selectedPitcher.id.startsWith("pitching-cmp-") && !selectedPitcher.id.startsWith("pm-"),
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const srcId = selectedPitcher?.id;
      if (!srcId || srcId.startsWith("pitching-cmp-") || srcId.startsWith("pm-")) return [];
      const { data, error } = await (supabase as any)
        .from("Pitching Master")
        .select("*")
        .eq("source_player_id", srcId)
        .order("Season", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: internals } = useQuery({
    queryKey: ["transfer-sim-internals", selectedPlayer?.prediction_id],
    enabled: !!selectedPlayer?.prediction_id,
    queryFn: async () => {
      if (!selectedPlayer?.prediction_id) return null;
      const { data, error } = await supabase
        .from("player_prediction_internals")
        .select("avg_power_rating, obp_power_rating, slg_power_rating")
        .eq("prediction_id", selectedPlayer.prediction_id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Stored prediction rows for the selected hitter. pickPreferredPrediction
  // (called downstream) picks: precomputed transfer row for the active
  // customer team → fallback to global returner. Same shape Compare and
  // PlayerProfile use; numbers across all three surfaces stay in lockstep.
  const { data: selectedHitterPredictions = [] } = useQuery({
    queryKey: ["tps-hitter-pred-rows", selectedPlayer?.player_id ?? null],
    enabled: !!selectedPlayer?.player_id && !authLoading,
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      if (!selectedPlayer?.player_id) return [];
      const { data, error } = await supabase
        .from("player_predictions")
        .select("id, player_id, customer_team_id, variant, model_type, status, p_avg, p_obp, p_slg, p_ops, p_iso, p_wrc_plus, o_war, market_value")
        .eq("player_id", selectedPlayer.player_id)
        .eq("season", PROJECTION_SEASON)
        .in("status", ["active", "departed"])
        .in("variant", ["regular", "precomputed"]);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Stored prediction rows for the selected pitcher. The PitchingStorageRow
  // shape stores source_player_id as the `id` field (line 113 of
  // usePitchingSeedData), so we resolve players.id by that.
  const selectedPitcherPlayerId = useMemo(() => {
    const srcId = selectedPitcher?.id;
    if (!srcId || srcId.startsWith("pitching-cmp-") || srcId.startsWith("pm-")) return null;
    const match = players.find((p) => p.source_player_id === srcId);
    return match?.player_id ?? null;
  }, [selectedPitcher, players]);

  const { data: selectedPitcherPredictions = [] } = useQuery({
    queryKey: ["tps-pitcher-pred-rows", selectedPitcherPlayerId],
    enabled: !!selectedPitcherPlayerId && !authLoading,
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      if (!selectedPitcherPlayerId) return [];
      const { data, error } = await supabase
        .from("player_predictions")
        .select("id, player_id, customer_team_id, variant, model_type, status, p_era, p_fip, p_whip, p_k9, p_bb9, p_hr9, p_rv_plus, p_war, market_value, pitcher_role")
        .eq("player_id", selectedPitcherPlayerId)
        .eq("season", PROJECTION_SEASON)
        .in("status", ["active", "departed"])
        .in("variant", ["regular", "precomputed"]);
      if (error) throw error;
      return data ?? [];
    },
  });

  const teamByKey = useMemo(() => {
    const map = new Map<string, TeamRow>();
    for (const t of teams) {
      // Index by every stable identifier so JUCO full names like
      // "Walters State CC" land the right row instead of fuzzy-matching to
      // another team. (Prior indexing only used t.name = abbreviation, which
      // misses on the full-name path and silently routes to a wrong conf.)
      const ids = [t.name, (t as any).fullName, (t as any).abbreviation, (t as any).source_team_id, t.id];
      for (const id of ids) {
        if (!id) continue;
        const k = normalizeKey(String(id));
        if (k) map.set(k, t);
      }
    }
    return map;
  }, [teams]);

  // PA lookup by player UUID for risk assessment sample size. Uses PRIOR_SEASON
  // because risk is measured against the data the projection was BUILT on; the
  // in-progress current season would falsely flag every player as thin sample.
  const { data: hitterPaMap = new Map<string, number>() } = useQuery({
    queryKey: ["transfer-portal-pa-lookup", PRIOR_SEASON],
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      const map = new Map<string, number>();
      const { data: hmRows } = await (supabase as any)
        .from("Hitter Master")
        .select("source_player_id, pa, ab")
        .eq("Season", PRIOR_SEASON)
        .gt("ab", 0);
      const sourceIdToPa = new Map<string, number>();
      for (const r of (hmRows || [])) {
        const pa = r.pa ?? r.ab ?? null;
        if (pa != null && r.source_player_id) sourceIdToPa.set(r.source_player_id, pa);
      }
      // Paginated: prod has ~32K players, default PostgREST limit truncates
      // at 1000 → risk assessment silently misses ~97% of players.
      const playerRows: Array<{ id: string; source_player_id: string | null }> = [];
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("players")
          .select("id, source_player_id")
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        playerRows.push(...((data ?? []) as any));
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }
      for (const p of playerRows) {
        if (p.source_player_id && sourceIdToPa.has(p.source_player_id)) {
          map.set(p.id, sourceIdToPa.get(p.source_player_id)!);
        }
      }
      return map;
    },
  });

  // JUCO TrackMan-pitch lookup for the data-reliability badge.
  // CURRENT_SEASON (not PRIOR) because reliability describes the data
  // backing THIS season's projection. Keyed by players.id for direct hit.
  const { data: jucoTrackmanMap = new Map<string, { tm: number; pa: number | null }>() } = useQuery({
    queryKey: ["transfer-portal-juco-trackman", CURRENT_SEASON],
    queryFn: async () => {
      const map = new Map<string, { tm: number; pa: number | null }>();
      const { data: hmRows } = await (supabase as any)
        .from("Hitter Master")
        .select("source_player_id, pa, trackman_pitches")
        .eq("Season", CURRENT_SEASON)
        .eq("division", "NJCAA_D1");
      const bySource = new Map<string, { tm: number; pa: number | null }>();
      for (const r of (hmRows || [])) {
        if (!r.source_player_id) continue;
        bySource.set(r.source_player_id, {
          tm: Number(r.trackman_pitches ?? 0),
          pa: r.pa != null ? Number(r.pa) : null,
        });
      }
      // Paginated for the same reason as hitterPaMap above. JUCO subset is
      // smaller (~5K) so usually fits in one page, but keep it safe.
      const playerRows: Array<{ id: string; source_player_id: string | null }> = [];
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("players")
          .select("id, source_player_id")
          .eq("division", "NJCAA_D1")
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        playerRows.push(...((data ?? []) as any));
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }
      for (const p of playerRows) {
        if (p.source_player_id && bySource.has(p.source_player_id)) {
          map.set(p.id, bySource.get(p.source_player_id)!);
        }
      }
      return map;
    },
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const confByKey = useMemo(() => {
    const map = new Map<string, ConferenceRow>();
    for (const c of conferenceStats) {
      map.set(normalizeKey(c.conference), c);
      const canonical = normalizeConferencePitching(c.conference);
      if (canonical) map.set(canonical, c);
    }
    return map;
  }, [conferenceStats]);

  const pitchingConfByKey = useMemo(() => {
    const map = new Map<string, {
      conference: string;
      era_plus: number | null;
      fip_plus: number | null;
      whip_plus: number | null;
      k9_plus: number | null;
      bb9_plus: number | null;
      hr9_plus: number | null;
      hitter_talent_plus: number | null;
    }>();
    // Also index by conference_id for UUID-based lookups
    const byId = new Map<string, typeof map extends Map<string, infer V> ? V : never>();
    if (newConfStats.length === 0) return map;
    const eq = readPitchingWeights();
    for (const row of newConfStats) {
      const directKey = normalizeKey(row.conference);
      const canonicalKey = canonicalConferencePitching(row.conference);
      if (!directKey) continue;
      const eraPlus = calcPitchingPlus(row.era, eq.era_plus_ncaa_avg, eq.era_plus_ncaa_sd, eq.era_plus_scale, false);
      const fipPlus = calcPitchingPlus(row.fip, eq.fip_plus_ncaa_avg, eq.fip_plus_ncaa_sd, eq.fip_plus_scale, false);
      const whipPlus = calcPitchingPlus(row.whip, eq.whip_plus_ncaa_avg, eq.whip_plus_ncaa_sd, eq.whip_plus_scale, false);
      const k9Plus = calcPitchingPlus(row.k9, eq.k9_plus_ncaa_avg, eq.k9_plus_ncaa_sd, eq.k9_plus_scale, true);
      const bb9Plus = calcPitchingPlus(row.bb9, eq.bb9_plus_ncaa_avg, eq.bb9_plus_ncaa_sd, eq.bb9_plus_scale, false);
      const hr9Plus = calcPitchingPlus(row.hr9, eq.hr9_plus_ncaa_avg, eq.hr9_plus_ncaa_sd, eq.hr9_plus_scale, false);
      const hitterTalentPlus = calcHitterTalentPlusFromConference(
        row.overall_power_rating,
        row.stuff_plus,
        row.wrc_plus,
      );
      const entry = {
        conference: row.conference,
        era_plus: eraPlus,
        fip_plus: fipPlus,
        whip_plus: whipPlus,
        k9_plus: k9Plus,
        bb9_plus: bb9Plus,
        hr9_plus: hr9Plus,
        hitter_talent_plus: hitterTalentPlus,
      };
      map.set(directKey, entry);
      if (canonicalKey && !map.has(canonicalKey)) map.set(canonicalKey, entry);
      if (row.conference_id) byId.set(row.conference_id, entry);
    }
    // Attach byId to the map for UUID lookups
    (map as any)._byId = byId;
    return map;
  }, [newConfStats]);

  const [seedByName, seedByPlayerId] = useMemo(() => {
    const map = new Map<string, SeedRow[]>();
    const byId = new Map<string, SeedRow>();
    for (const row of hitterStats as SeedRow[]) {
      const nameKey = normalizeKey(row.playerName);
      if (!nameKey || !row.team) continue;
      const list = map.get(nameKey) || [];
      list.push(row);
      map.set(nameKey, list);
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

  // Same fast-path resolver PlayerProfile uses. Lookup by source_player_id is
  // unambiguous — eliminates the name+team-fuzzy-match drift that was making
  // TPS show different scouting (chase / barrel / EV) than PlayerProfile for
  // players with common names or slightly mismatched team strings.
  const powerByPlayerId = useMemo(() => {
    const map = new Map<string, typeof powerRatings[0]>();
    for (const row of powerRatings) {
      const sid = (row as any).player_id;
      if (sid) map.set(String(sid), row);
    }
    return map;
  }, [powerRatings]);

  const inferredFromTeam = useMemo(() => {
    if (!selectedPlayer) return null;
    // Fast path: UUID match
    const byId = seedByPlayerId.get(selectedPlayer.id);
    if (byId) return byId.team;
    const fullName = `${selectedPlayer.first_name} ${selectedPlayer.last_name}`;
    const candidates = seedByName.get(normalizeKey(fullName)) || [];
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0].team;
    const key = `${statKey(selectedPlayer.from_avg)}|${statKey(selectedPlayer.from_obp)}|${statKey(selectedPlayer.from_slg)}`;
    const exact = candidates.find((r) => `${statKey(r.avg)}|${statKey(r.obp)}|${statKey(r.slg)}` === key);
    return exact?.team || candidates[0].team;
  }, [selectedPlayer, seedByName]);

  const fromTeam = selectedPlayer ? (selectedPlayer.from_team || inferredFromTeam || selectedPlayer.team || null) : null;
  // ID-first team lookup: players.team_id (UUID) wins. Falls back to
  // source_team_id, then to name resolution (which is fuzzy and unsafe
  // for JUCO full names that share words with other teams).
  const fromTeamRow = (
    (selectedPlayer?.team_id && teams.find((t) => t.id === selectedPlayer.team_id)) ||
    (selectedPlayer?.source_team_id && teams.find((t: any) => t.source_team_id === selectedPlayer.source_team_id)) ||
    resolveTeamRowFromCandidates([fromTeam], teamByKey, teams)
  ) as TeamRow | null;
  const toTeamRow = resolveTeamRowFromCandidates([selectedDestinationTeam], teamByKey, teams);

  const fromConference = fromTeamRow?.conference || selectedPlayer?.conference || null;
  const toConference = toTeamRow?.conference || null;
  const fromConferenceId = fromTeamRow?.conference_id ?? null;
  const toConferenceId = toTeamRow?.conference_id ?? null;

  // ID-first lookup (see feedback_link_ids_not_names). JUCO conferences
  // are named "NJCAA D1 X District" — won't match the D1-only alias system.
  // conference_id is the canonical join key, name is display-only fallback.
  const confByConfId = useMemo(() => {
    const m = new Map<string, ConferenceRow>();
    for (const c of conferenceStats || []) {
      if (c.conference_id) m.set(c.conference_id, c);
    }
    return m;
  }, [conferenceStats]);

  const resolveConferenceStats = (
    conference: string | null | undefined,
    conferenceId?: string | null,
  ): ConferenceRow | null => {
    if (conferenceId) {
      const byId = confByConfId.get(conferenceId);
      if (byId) return byId;
    }
    // JUCO district fallback — players.conference is "NJCAA D1 Midwest"
    // (no "District" suffix) but Conference Stats stores "NJCAA D1 Midwest
    // District". Skip the name aliasing dance and resolve via the hardcoded
    // district → UUID map.
    const jucoName = jucoDistrictNameFromConference(conference);
    if (jucoName) {
      const jucoId = JUCO_DISTRICT_CONFERENCE_ID[jucoName];
      if (jucoId) {
        const byJucoId = confByConfId.get(jucoId);
        if (byJucoId) return byJucoId;
      }
    }
    const aliases = conferenceKeyAliases(conference);
    let best: ConferenceRow | null = null;
    let bestScore = -1;
    const score = (row: ConferenceRow) =>
      (row.avg_plus != null ? 1 : 0) +
      (row.obp_plus != null ? 1 : 0) +
      (row.iso_plus != null ? 1 : 0) +
      (row.stuff_plus != null ? 1 : 0);

    for (const key of aliases) {
      const hit = confByKey.get(key);
      if (!hit) continue;
      const s = score(hit);
      if (s > bestScore) {
        best = hit;
        bestScore = s;
      }
    }
    // fallback: loose include match either direction
    for (const [k, row] of confByKey.entries()) {
      if (!aliases.some((a) => k.includes(a) || a.includes(k))) continue;
      const s = score(row);
      if (s > bestScore) {
        best = row;
        bestScore = s;
      }
    }
    return best;
  };

  const fromConfStats = resolveConferenceStats(fromConference, fromConferenceId);
  const toConfStats = resolveConferenceStats(toConference, toConferenceId);

  const resolvePitchingConferenceStats = (conference: string | null | undefined, conferenceId?: string | null) => {
    // UUID lookup first (district ID for JUCO, conference UUID for D1)
    const byId = (pitchingConfByKey as any)?._byId as Map<string, any> | undefined;
    if (conferenceId && byId?.has(conferenceId)) return byId.get(conferenceId)!;
    // JUCO district fallback — players.conference is "NJCAA D1 <District>"
    // (no "District" suffix) but Conference Stats stores "NJCAA D1 <District>
    // District". Resolve via the hardcoded district → UUID map (same pattern
    // as resolveConferenceStats above).
    const jucoName = jucoDistrictNameFromConference(conference);
    if (jucoName) {
      const jucoId = JUCO_DISTRICT_CONFERENCE_ID[jucoName];
      if (jucoId && byId?.has(jucoId)) return byId.get(jucoId)!;
    }
    // Name-based fallback
    const directKey = normalizeKey(conference || "");
    const canonicalKey = canonicalConferencePitching(conference || "");
    if (directKey) {
      const directHit = pitchingConfByKey.get(directKey);
      if (directHit) return directHit;
    }
    if (canonicalKey) {
      const canonicalHit = pitchingConfByKey.get(canonicalKey);
      if (canonicalHit) return canonicalHit;
    }
    return null;
  };

  const simulation = useMemo(() => {
    if (!selectedPlayer) return null;
    // STORED-ROW READ. Same data path as Compare + PlayerProfile:
    // pickPreferredPrediction → precomputed transfer row for the active
    // customer team, fallback to global returner row. No live recompute,
    // no equation drift. If no stored row exists for this player at this
    // team, return a blocked state — the UI shows the "no projection"
    // message instead of guessing with client-side math.
    const row = pickPreferredPrediction(selectedHitterPredictions, effectiveTeamId);
    const ok = row && row.p_wrc_plus != null;
    return {
      blocked: !ok,
      missingInputs: ok ? [] : ["No stored projection for this player at this team"],
      pAvg: row?.p_avg ?? null,
      pObp: row?.p_obp ?? null,
      pSlg: row?.p_slg ?? null,
      pOps: row?.p_ops ?? null,
      pIso: row?.p_iso ?? null,
      pWrc: null,
      pWrcPlus: row?.p_wrc_plus ?? null,
      owar: row?.o_war ?? null,
      nilValuation: row?.market_value ?? null,
      // Live-compute breakdowns dropped (Context+Multipliers + Show Work
      // sections removed). Stored predictions don't carry the per-factor
      // equation breakdown.
      fromAvgPlus: null, toAvgPlus: null,
      fromObpPlus: null, toObpPlus: null,
      fromIsoPlus: null, toIsoPlus: null,
      fromStuff: null, toStuff: null,
      fromPark: null, toPark: null,
      fromParkRaw: null, toParkRaw: null,
      fromObpParkRaw: null, toObpParkRaw: null,
      fromIsoParkRaw: null, toIsoParkRaw: null,
      ptm: null, pvm: null,
      baWork: null, obpWork: null, isoWork: null,
    };
  }, [selectedPlayer, selectedHitterPredictions, effectiveTeamId]);

  const pitchingSimulation = useMemo<PitchingSim | null>(() => {
    if (!selectedPitcher) return null;
    // STORED-ROW READ — mirror of the hitter side. pickPreferredPrediction
    // selects: precomputed transfer row for active customer team → fallback
    // global returner row. No live recompute.
    const row = pickPreferredPrediction(selectedPitcherPredictions, effectiveTeamId);
    const ok = row && row.p_rv_plus != null;
    const role = ((row?.pitcher_role === "SP" || row?.pitcher_role === "RP")
      ? row.pitcher_role
      : pitchingRoleOverride) as "SP" | "RP";
    return {
      blocked: !ok,
      missingInputs: ok ? [] : ["No stored projection for this pitcher at this team"],
      pEra: row?.p_era ?? null,
      pFip: row?.p_fip ?? null,
      pWhip: row?.p_whip ?? null,
      pK9: row?.p_k9 ?? null,
      pBb9: row?.p_bb9 ?? null,
      pHr9: row?.p_hr9 ?? null,
      pRvPlus: row?.p_rv_plus ?? null,
      pWar: row?.p_war ?? null,
      marketValue: row?.market_value ?? null,
      projectedRole: role,
      fromConference: selectedPitcher.conference ?? null,
      toConference: null,
      // Live-compute breakdowns dropped (Context+Multipliers + Show Work
      // removed). Stored predictions don't carry per-factor breakdowns.
      fromEraPlus: null, toEraPlus: null,
      fromFipPlus: null, toFipPlus: null,
      fromWhipPlus: null, toWhipPlus: null,
      fromK9Plus: null, toK9Plus: null,
      fromBb9Plus: null, toBb9Plus: null,
      fromHr9Plus: null, toHr9Plus: null,
      fromHitterTalent: null, toHitterTalent: null,
      fromEraParkRaw: null, toEraParkRaw: null,
      fromWhipParkRaw: null, toWhipParkRaw: null,
      fromHr9ParkRaw: null, toHr9ParkRaw: null,
      weights: null,
    };
  }, [selectedPitcher, selectedPitcherPredictions, effectiveTeamId, pitchingRoleOverride]);

  const addToTargetBoard = () => {
    if (!selectedPlayer || !selectedDestinationTeam) return;
    const playerId = selectedPlayer.player_id;
    const playerName = `${selectedPlayer.first_name} ${selectedPlayer.last_name}`;
    if (playerId && !isOnSupabaseBoard(playerId)) {
      addToSupabaseBoard({ playerId });
    }
    toast({
      title: "Added to Target Board",
      description: `${playerName} -> ${selectedDestinationTeam}`,
    });
  };

  const addPitcherToTargetBoard = async () => {
    if (!selectedPitcher || !selectedDestinationTeam || pitchingSimulation?.blocked) return;
    // selectedPitcher.id is the source_player_id (numeric, e.g. "1254299136")
    // — comes straight from Pitching Master via usePitchingSeedData. The
    // target_board.player_id column is a UUID FK to players.id, so we have
    // to resolve source_player_id → players.id before inserting. Hitter
    // path doesn't need this because its data already carries players.id.
    const sourcePlayerId = selectedPitcher.id;
    if (!sourcePlayerId) return;
    const { data: playerRow, error: lookupErr } = await supabase
      .from("players")
      .select("id")
      .eq("source_player_id", sourcePlayerId)
      .maybeSingle();
    if (lookupErr || !playerRow?.id) {
      toast({
        title: "Failed to add",
        description: "Could not resolve pitcher to a players row. The pitcher may not be synced yet.",
        variant: "destructive",
      });
      return;
    }
    const playerId = playerRow.id;
    if (!isOnSupabaseBoard(playerId)) {
      addToSupabaseBoard({ playerId });
    }
    toast({
      title: "Added to Target Board",
      description: `${selectedPitcher.player_name} -> ${selectedDestinationTeam}`,
    });
  };

  const [playerDropdownOpen, setPlayerDropdownOpen] = useState(false);
  const [teamDropdownOpen, setTeamDropdownOpen] = useState(false);
  const [pitcherDropdownOpen, setPitcherDropdownOpen] = useState(false);

  return (
    <DashboardLayout>
      <div className="space-y-4 max-w-[1400px] mx-auto">
        {/* ─── Header — brand Oswald + gold accent ─── */}
        <div className="rounded-lg border-l-[3px] border-l-[#D4AF37] border-t border-r border-b border-border/60 bg-muted/20 px-4 py-4 flex items-center justify-between gap-4">
          <div>
            <h2
              className="text-2xl font-bold tracking-[0.04em] uppercase leading-none"
              style={{ fontFamily: "'Oswald', sans-serif", color: "#D4AF37" }}
            >
              Transfer Portal
            </h2>
            <p className="text-muted-foreground text-xs mt-1.5 tracking-wide">Simulate player projections at a new school</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex gap-1 rounded-lg border border-border/60 bg-muted/40 p-1">
              <button
                className={`px-5 py-1.5 text-xs font-bold uppercase tracking-[0.1em] rounded-md transition-colors duration-150 cursor-pointer ${simType === "hitting" ? "bg-[#D4AF37]/15 text-[#D4AF37] ring-1 ring-[#D4AF37]/30" : "text-muted-foreground hover:text-foreground"}`}
                style={{ fontFamily: "'Oswald', sans-serif" }}
                onClick={() => setSimType("hitting")}
              >
                Hitting
              </button>
              <button
                className={`px-5 py-1.5 text-xs font-bold uppercase tracking-[0.1em] rounded-md transition-colors duration-150 cursor-pointer ${simType === "pitching" ? "bg-[#D4AF37]/15 text-[#D4AF37] ring-1 ring-[#D4AF37]/30" : "text-muted-foreground hover:text-foreground"}`}
                style={{ fontFamily: "'Oswald', sans-serif" }}
                onClick={() => setSimType("pitching")}
              >
                Pitching
              </button>
            </div>
            <div className="flex gap-1">
              <button
                className={`px-5 py-1.5 text-xs font-bold uppercase tracking-[0.1em] rounded-md transition-colors duration-150 cursor-pointer ${divisionFilter === "D1" ? "bg-[#D4AF37]/15 text-[#D4AF37] ring-1 ring-[#D4AF37]/30" : "text-muted-foreground hover:text-foreground"}`}
                style={{ fontFamily: "'Oswald', sans-serif" }}
                onClick={() => { setDivisionFilter("D1"); setSelectedPlayerId(""); setPlayerSearch(""); }}
              >
                D1
              </button>
              <button
                className={`px-5 py-1.5 text-xs font-bold uppercase tracking-[0.1em] rounded-md transition-colors duration-150 cursor-pointer ${divisionFilter === "JUCO" ? "bg-[#D4AF37]/15 text-[#D4AF37] ring-1 ring-[#D4AF37]/30" : "text-muted-foreground hover:text-foreground"}`}
                style={{ fontFamily: "'Oswald', sans-serif" }}
                onClick={() => { setDivisionFilter("JUCO"); setSelectedPlayerId(""); setPlayerSearch(""); }}
              >
                JUCO
              </button>
            </div>
          </div>
        </div>

        {/* ═══════════ HITTING ═══════════ */}
        {simType === "hitting" && (
          <>
            {/* ─── Input bar ─── */}
            <Card className="overflow-visible">
              <CardContent className="pt-4 pb-3">
                <div className="flex flex-wrap items-end gap-3">
                  {/* Player search */}
                  <div className="relative flex-1 min-w-[200px]">
                    <Label className="text-xs mb-1 block">Player</Label>
                    <Input placeholder={playersLoading ? "Loading..." : (divisionFilter === "JUCO" ? "Search JUCO hitter..." : "Search hitter...")} value={playerSearch} onChange={(e) => { setPlayerSearch(e.target.value); setPlayerDropdownOpen(true); }} onFocus={() => setPlayerDropdownOpen(true)} onBlur={() => setTimeout(() => setPlayerDropdownOpen(false), 150)} />
                    {playerDropdownOpen && filteredPlayers.length > 0 && (
                      <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-72 overflow-auto">
                        {filteredPlayers.map((p) => (
                          <div key={p.player_id} className="px-3 py-2 text-sm cursor-pointer hover:bg-accent flex justify-between" onMouseDown={() => { setSelectedPlayerId(p.player_id); setPlayerSearch(`${p.first_name} ${p.last_name}`); setPlayerDropdownOpen(false); }}>
                            <span className="font-medium">{p.first_name} {p.last_name}</span>
                            <span className="text-muted-foreground text-xs">{p.from_team || p.team || "-"} · {p.position || "-"}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Destination team */}
                  <div className="relative flex-1 min-w-[200px]">
                    <Label className="text-xs mb-1 block">Destination</Label>
                    {allowAllTeams ? (
                      <>
                        <Input placeholder="Search team..." value={teamSearch} onChange={(e) => { setTeamSearch(e.target.value); setTeamDropdownOpen(true); }} onFocus={() => setTeamDropdownOpen(true)} onBlur={() => setTimeout(() => setTeamDropdownOpen(false), 150)} />
                        {teamDropdownOpen && filteredTeams.length > 0 && (
                          <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-72 overflow-auto">
                            {filteredTeams.map((t) => (
                              <div key={t.name} className="px-3 py-2 text-sm cursor-pointer hover:bg-accent" onMouseDown={() => { setSelectedDestinationTeam(t.name); setTeamSearch(t.name); setTeamDropdownOpen(false); }}>
                                {t.name} <span className="text-muted-foreground text-xs">{t.conference || ""}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <Input value={effectiveSchoolName ?? ""} disabled readOnly className="opacity-100 cursor-not-allowed" />
                    )}
                  </div>
                  <div className="flex gap-2">
                    {selectedPlayer && (
                      <Button asChild variant="outline" size="sm">
                        <Link to={profileRouteFor(selectedPlayer.player_id, selectedPlayer.position)} state={{ returnTo: `${location.pathname}${location.search}${location.hash}` }}>Profile</Link>
                      </Button>
                    )}
                    <Button size="sm" onClick={addToTargetBoard} disabled={!selectedPlayer || !selectedDestinationTeam || !!simulation?.blocked}>Add to Board</Button>
                  </div>
                </div>
                {/* Selected player info */}
                {selectedPlayer && (
                  <div className="mt-3 text-xs text-muted-foreground border-t pt-2 flex items-center gap-4">
                    <span className="font-medium text-foreground">{selectedPlayer.first_name} {selectedPlayer.last_name}</span>
                    <span>{selectedPlayer.position || "-"} · {fromTeam || "-"} · {fromConference || "-"}</span>
                    <span className="font-mono tabular-nums">Previous: {stat(selectedPlayer.from_avg)} / {stat(selectedPlayer.from_obp)} / {stat(selectedPlayer.from_slg)}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ─── Missing inputs ─── */}
            {simulation?.blocked && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                Missing inputs: {simulation.missingInputs.join(", ")}
              </div>
            )}

            {/* ─── Hero cards ─── */}
            <div className="grid gap-3 grid-cols-3">
              <div className={`rounded-lg border-2 p-4 text-center ${simulation?.pWrcPlus != null ? (simulation.pWrcPlus >= 115 ? "border-emerald-500 bg-emerald-500/10" : simulation.pWrcPlus >= 90 ? "border-blue-500 bg-blue-500/10" : "border-rose-500 bg-rose-500/10") : "border-border bg-muted/10"}`}>
                <div className="text-muted-foreground text-xs uppercase tracking-wide">pWRC+</div>
                <div className="text-3xl font-bold tracking-tight tabular-nums mt-1">{simulation ? whole(simulation.pWrcPlus) : "-"}</div>
              </div>
              <div className={`rounded-lg border-2 p-4 text-center ${simulation?.owar != null ? (simulation.owar > 1.5 ? "border-emerald-500 bg-emerald-500/10" : simulation.owar >= 0.5 ? "border-blue-500 bg-blue-500/10" : "border-rose-500 bg-rose-500/10") : "border-border bg-muted/10"}`}>
                <div className="text-muted-foreground text-xs uppercase tracking-wide">oWAR</div>
                <div className="text-3xl font-bold tracking-tight tabular-nums mt-1">{simulation ? stat(simulation.owar, 2) : "-"}</div>
              </div>
              <div className={`rounded-lg border-2 p-4 text-center ${simulation?.nilValuation != null ? (simulation.nilValuation >= 75000 ? "border-emerald-500 bg-emerald-500/10" : simulation.nilValuation >= 25000 ? "border-blue-500 bg-blue-500/10" : "border-amber-500 bg-amber-500/10") : "border-border bg-muted/10"}`}>
                <div className="text-muted-foreground text-xs uppercase tracking-wide">Market Value</div>
                <div className="text-3xl font-bold tracking-tight tabular-nums mt-1">{simulation ? money(simulation.nilValuation) : "-"}</div>
              </div>
            </div>

            {/* ─── Projected stats grid ─── */}
            <div className="grid gap-2 grid-cols-5">
              {([["pAVG", simulation?.pAvg, "avg"], ["pOBP", simulation?.pObp, "obp"], ["pSLG", simulation?.pSlg, "slg"], ["pOPS", simulation?.pOps, "ops"], ["pISO", simulation?.pIso, "iso"]] as const).map(([label, val, key]) => (
                <div key={label} className={`rounded-lg border p-3 text-center ${tierStyle(statTier(key, val))}`}>
                  <div className="text-muted-foreground text-xs uppercase tracking-wide">{label}</div>
                  <div className="text-xl font-bold tabular-nums mt-1">{val != null ? val.toFixed(3) : "-"}</div>
                </div>
              ))}
            </div>

            {/* ─── Portal Risk Assessment ─── */}
            {simulation && !simulation.blocked && (() => {
              const fullName = selectedPlayer ? `${selectedPlayer.first_name} ${selectedPlayer.last_name}` : "";
              const spKey = `${normalizeKey(fullName)}|${normalizeKey(fromTeam)}`;
              // Fast path: source_player_id direct lookup (same as
              // PlayerProfile). Falls back to name+team fuzzy match for
              // players whose seed row isn't keyed by source_player_id yet.
              const sp = (
                (selectedPlayer?.source_player_id ? powerByPlayerId.get(String(selectedPlayer.source_player_id)) : null)
                ?? powerByNameTeam.get(spKey)
                ?? powerByNameTeam.get(normalizeKey(fullName))
                ?? null
              );
              const toConfRow = toConference ? confByKey.get(toConference.toLowerCase().trim()) ?? null : null;
              const resolvedPa = selectedPlayer?.player_id ? (hitterPaMap.get(selectedPlayer.player_id) ?? null) : null;
              const isJucoSrc = selectedPlayer?.division === "NJCAA_D1";

              // Scouting fields come from the 2026 Hitter Master row (with
              // blended_* fallbacks for thin samples) — same shape PlayerProfile
              // uses. useHitterSeedData was stripped to identity-only cols so
              // the sp lookup has no scouting; hitterCareerSeasons does select *
              // so it carries the real values.
              const projectionSourceRow = (() => {
                const row = (hitterCareerSeasons as any[]).find((r) => Number(r.Season) === 2026);
                if (!row) return null;
                const cu = !!row.combined_used;
                return {
                  contact: cu ? (row.blended_contact ?? row.contact) : row.contact,
                  line_drive: cu ? (row.blended_line_drive ?? row.line_drive) : row.line_drive,
                  avg_exit_velo: cu ? (row.blended_avg_exit_velo ?? row.avg_exit_velo) : row.avg_exit_velo,
                  bb: cu ? (row.blended_bb ?? row.bb) : row.bb,
                  chase: cu ? (row.blended_chase ?? row.chase) : row.chase,
                  barrel: cu ? (row.blended_barrel ?? row.barrel) : row.barrel,
                  ev90: cu ? (row.blended_ev90 ?? row.ev90) : row.ev90,
                  pull: cu ? (row.blended_pull ?? row.pull) : row.pull,
                  gb: cu ? (row.blended_gb ?? row.gb) : row.gb,
                  pa: row.pa ?? null,
                };
              })();

              if (isJucoSrc) {
                // JUCO hitter sim — slimmed 4-factor panel mirroring the
                // pitcher JUCO card philosophy (Projection / Skillset /
                // Data Reliability / Competition with SOURCE stuff+).
                const tm = selectedPlayer?.player_id ? jucoTrackmanMap.get(selectedPlayer.player_id) : undefined;
                const fromAvg = selectedPlayer?.from_avg ?? null;
                const fromObp = selectedPlayer?.from_obp ?? null;
                const fromSlg = selectedPlayer?.from_slg ?? null;
                const iso = fromAvg != null && fromSlg != null ? fromSlg - fromAvg : null;
                return <JucoHitterRiskCard input={{
                  projectedWrcPlus: simulation.pWrcPlus,
                  chase: projectionSourceRow?.chase ?? sp?.chase ?? null,
                  contact: projectionSourceRow?.contact ?? sp?.contact ?? null,
                  whiff: (sp as any)?.whiff ?? null,
                  barrel: projectionSourceRow?.barrel ?? sp?.barrel ?? null,
                  lineDrive: projectionSourceRow?.line_drive ?? sp?.lineDrive ?? null,
                  avgEv: projectionSourceRow?.avg_exit_velo ?? sp?.avgExitVelo ?? null,
                  ev90: projectionSourceRow?.ev90 ?? sp?.ev90 ?? null,
                  pull: projectionSourceRow?.pull ?? sp?.pull ?? null,
                  gb: projectionSourceRow?.gb ?? sp?.gb ?? null,
                  bb: projectionSourceRow?.bb ?? sp?.bb ?? null,
                  avg: fromAvg, obp: fromObp, iso,
                  trackmanPitches: tm?.tm ?? 0, pa: tm?.pa ?? projectionSourceRow?.pa ?? resolvedPa,
                  sourceConference: fromConference,
                  sourceConfStuffPlus: fromConfStats?.stuff_plus ?? null,
                }} />;
              }

              // D1 sim — match PlayerProfile's risk inputs so the same player
              // shows the same risk grade on both surfaces.
              //
              // PlayerProfile reads scouting fields from projectionSourceRow,
              // a 2026 Hitter Master row with blended-sample handling.
              // useHitterSeedData was stripped to identity-only columns, so
              // the powerByPlayerId/powerByNameTeam path is missing all the
              // scouting fields — that was the skillset divergence.
              //
              // projectionSourceRow already constructed above (used by both
              // JUCO and D1 branches).
              const originConference = selectedPlayer?.conference ?? null;
              const originConfRow = originConference ? confByKey.get(originConference.toLowerCase().trim()) ?? null : null;
              const risk = assessHitterRisk({
                conference: originConference,
                projectedWrcPlus: simulation.pWrcPlus,
                confStuffPlus: originConfRow?.stuff_plus ?? null,
                careerSeasons: hitterCareerSeasons as any[],
                pa: projectionSourceRow?.pa ?? resolvedPa,
                chase: projectionSourceRow?.chase ?? sp?.chase,
                contact: projectionSourceRow?.contact ?? sp?.contact,
                barrel: projectionSourceRow?.barrel ?? sp?.barrel,
                lineDrive: projectionSourceRow?.line_drive ?? sp?.lineDrive,
                avgEv: projectionSourceRow?.avg_exit_velo ?? sp?.avgExitVelo,
                ev90: projectionSourceRow?.ev90 ?? sp?.ev90,
                pull: projectionSourceRow?.pull ?? sp?.pull,
                gb: projectionSourceRow?.gb ?? sp?.gb,
                bb: projectionSourceRow?.bb ?? sp?.bb,
              });
              return <RiskAssessmentCardRSTR risk={risk} />;
            })()}

          </>
        )}

        {/* ═══════════ PITCHING ═══════════ */}
        {simType === "pitching" && (
          <>
            {/* ─── Input bar ─── */}
            <Card className="overflow-visible">
              <CardContent className="pt-4 pb-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="relative flex-1 min-w-[180px]">
                    <Label className="text-xs mb-1 block">Pitcher</Label>
                    <Input placeholder={divisionFilter === "JUCO" ? "Search JUCO pitcher..." : "Search pitcher..."} value={pitcherSearch} onChange={(e) => { setPitcherSearch(e.target.value); setPitcherDropdownOpen(true); }} onFocus={() => setPitcherDropdownOpen(true)} onBlur={() => setTimeout(() => setPitcherDropdownOpen(false), 150)} />
                    {pitcherDropdownOpen && filteredPitchers.length > 0 && (
                      <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-72 overflow-auto">
                        {filteredPitchers.map((p) => (
                          <div key={p.id} className="px-3 py-2 text-sm cursor-pointer hover:bg-accent flex justify-between" onMouseDown={() => { setSelectedPitcherId(p.id); setPitcherSearch(p.player_name); setPitchingRoleOverride(p.role === "SP" ? "SP" : "RP"); setPitcherDropdownOpen(false); }}>
                            <span className="font-medium">{p.player_name}</span>
                            <span className="text-muted-foreground text-xs">{p.team || "-"} · {p.role || "-"} · {p.handedness || "-"}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="relative flex-1 min-w-[180px]">
                    <Label className="text-xs mb-1 block">Destination</Label>
                    {allowAllTeams ? (
                      <>
                        <Input placeholder="Search team..." value={teamSearch} onChange={(e) => { setTeamSearch(e.target.value); setTeamDropdownOpen(true); }} onFocus={() => setTeamDropdownOpen(true)} onBlur={() => setTimeout(() => setTeamDropdownOpen(false), 150)} />
                        {teamDropdownOpen && filteredTeams.length > 0 && (
                          <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-72 overflow-auto">
                            {filteredTeams.map((t) => (
                              <div key={t.name} className="px-3 py-2 text-sm cursor-pointer hover:bg-accent" onMouseDown={() => { setSelectedDestinationTeam(t.name); setTeamSearch(t.name); setTeamDropdownOpen(false); }}>
                                {t.name} <span className="text-muted-foreground text-xs">{t.conference || ""}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <Input value={effectiveSchoolName ?? ""} disabled readOnly className="opacity-100 cursor-not-allowed" />
                    )}
                  </div>
                  <div className="w-[110px]">
                    <Label className="text-xs mb-1 block">Role</Label>
                    <Select value={pitchingRoleOverride} onValueChange={(v) => setPitchingRoleOverride(v as "SP" | "RP")}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="SP">Starter</SelectItem>
                        <SelectItem value="RP">Reliever</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex gap-2">
                    {selectedPitcher && (
                      <Button asChild variant="outline" size="sm">
                        <Link to={storagePitcherRouteFor(selectedPitcher.player_name, selectedPitcher.team)} state={{ returnTo: `${location.pathname}${location.search}${location.hash}` }}>Profile</Link>
                      </Button>
                    )}
                    <Button size="sm" onClick={addPitcherToTargetBoard} disabled={!selectedPitcher || !selectedDestinationTeam || !!pitchingSimulation?.blocked}>Add to Board</Button>
                  </div>
                </div>
                {selectedPitcher && (
                  <div className="mt-3 text-xs text-muted-foreground border-t pt-2 flex items-center gap-4">
                    <span className="font-medium text-foreground">{selectedPitcher.player_name}</span>
                    <span>{selectedPitcher.handedness === "R" ? "RHP" : selectedPitcher.handedness === "L" ? "LHP" : selectedPitcher.handedness || "-"} · {selectedPitcher.team || "-"} · {selectedPitcher.role || "-"}</span>
                    <span className="font-mono tabular-nums">2025: {stat(selectedPitcher.era, 2)} ERA · {stat(selectedPitcher.fip, 2)} FIP · {stat(selectedPitcher.whip, 2)} WHIP · {stat(selectedPitcher.k9, 1)} K/9 · {stat(selectedPitcher.bb9, 2)} BB/9 · {stat(selectedPitcher.hr9, 2)} HR/9</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ─── Missing inputs ─── */}
            {pitchingSimulation?.blocked && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                Missing inputs: {pitchingSimulation.missingInputs.join(", ")}
              </div>
            )}

            {/* ─── Hero cards ─── */}
            <div className="grid gap-3 grid-cols-3">
              <div className={`rounded-lg border-2 p-4 text-center ${pitchingSimulation?.pRvPlus != null ? (pitchingSimulation.pRvPlus >= 110 ? "border-emerald-500 bg-emerald-500/10" : pitchingSimulation.pRvPlus >= 95 ? "border-blue-500 bg-blue-500/10" : "border-rose-500 bg-rose-500/10") : "border-border bg-muted/10"}`}>
                <div className="text-muted-foreground text-xs uppercase tracking-wide">pRV+</div>
                <div className="text-3xl font-bold tracking-tight tabular-nums mt-1">{pitchingSimulation ? whole(pitchingSimulation.pRvPlus) : "-"}</div>
              </div>
              <div className={`rounded-lg border-2 p-4 text-center ${pitchingSimulation?.pWar != null ? (pitchingSimulation.pWar >= 1.5 ? "border-emerald-500 bg-emerald-500/10" : pitchingSimulation.pWar >= 0.5 ? "border-blue-500 bg-blue-500/10" : "border-rose-500 bg-rose-500/10") : "border-border bg-muted/10"}`}>
                <div className="text-muted-foreground text-xs uppercase tracking-wide">pWAR</div>
                <div className="text-3xl font-bold tracking-tight tabular-nums mt-1">{pitchingSimulation ? stat(pitchingSimulation.pWar, 2) : "-"}</div>
              </div>
              <div className={`rounded-lg border-2 p-4 text-center ${pitchingSimulation?.marketValue != null ? (pitchingSimulation.marketValue >= 75000 ? "border-emerald-500 bg-emerald-500/10" : pitchingSimulation.marketValue >= 25000 ? "border-blue-500 bg-blue-500/10" : "border-amber-500 bg-amber-500/10") : "border-border bg-muted/10"}`}>
                <div className="text-muted-foreground text-xs uppercase tracking-wide">Market Value</div>
                <div className="text-3xl font-bold tracking-tight tabular-nums mt-1">{pitchingSimulation ? money(pitchingSimulation.marketValue) : "-"}</div>
              </div>
            </div>

            {/* ─── Pitching stat grid ─── */}
            <div className="grid gap-2 grid-cols-6">
              {([["pERA", pitchingSimulation?.pEra, "era", false], ["pFIP", pitchingSimulation?.pFip, "fip", false], ["pWHIP", pitchingSimulation?.pWhip, "whip", false], ["pK/9", pitchingSimulation?.pK9, "k9", true], ["pBB/9", pitchingSimulation?.pBb9, "bb9", false], ["pHR/9", pitchingSimulation?.pHr9, "hr9", false]] as const).map(([label, val, key, hib]) => (
                <div key={label} className={`rounded-lg border p-3 text-center ${tierStyle(pitchingOutcomeTier(key, val, pitchingEqForTiers))}`}>
                  <div className="text-muted-foreground text-xs uppercase tracking-wide">{label}</div>
                  <div className="text-xl font-bold tabular-nums mt-1">{val != null ? val.toFixed(2) : "-"}</div>
                </div>
              ))}
            </div>

            {/* ─── Pitcher Risk Assessment ─── */}
            {pitchingSimulation && !pitchingSimulation.blocked && selectedPitcher && (() => {
              const isJucoSrc = selectedPitcher.division === "NJCAA_D1";

              // Match PitcherProfile's projectionSourceRow shape — read the
              // 2026 Pitching Master row with blended_* fallbacks for thin-
              // sample pitchers. TPS's selectedPitcher.* fields skip the
              // blended handling, so risk diverged on combined-sample
              // pitchers. pitcherCareerSeasons (select *) carries the
              // blended_* columns.
              const pitcherProjRow = (() => {
                const row = (pitcherCareerSeasons as any[]).find((r) => Number(r.Season) === 2026);
                if (!row) return null;
                const cu = !!row.combined_used;
                return {
                  stuffPlus: cu ? (row.blended_stuff_plus ?? row.stuff_plus) : row.stuff_plus,
                  miss_pct: cu ? (row.blended_miss_pct ?? row.miss_pct) : row.miss_pct,
                  bb_pct: cu ? (row.blended_bb_pct ?? row.bb_pct) : row.bb_pct,
                  chase_pct: cu ? (row.blended_chase_pct ?? row.chase_pct) : row.chase_pct,
                  barrel_pct: cu ? (row.blended_barrel_pct ?? row.barrel_pct) : row.barrel_pct,
                  hard_hit_pct: cu ? (row.blended_hard_hit_pct ?? row.hard_hit_pct) : row.hard_hit_pct,
                  ground_pct: cu ? (row.blended_ground_pct ?? row.ground_pct) : row.ground_pct,
                  in_zone_whiff_pct: cu ? (row.blended_in_zone_whiff_pct ?? row.in_zone_whiff_pct) : row.in_zone_whiff_pct,
                  k9: cu ? (row.blended_k9 ?? row.K9 ?? row.k9) : (row.K9 ?? row.k9),
                  bb9: cu ? (row.blended_bb9 ?? row.BB9 ?? row.bb9) : (row.BB9 ?? row.bb9),
                  hr9: cu ? (row.blended_hr9 ?? row.HR9 ?? row.hr9) : (row.HR9 ?? row.hr9),
                  ip: cu ? (row.combined_ip ?? row.IP) : row.IP,
                  trackman_pitches: row.trackman_pitches ?? 0,
                  bf: row.bf ?? null,
                };
              })();

              if (isJucoSrc) {
                // JUCO sim — slimmed 5-factor panel (Projection / Skillset /
                // Data Reliability / Competition with SOURCE HTP / Stuff+).
                // Same pitcherProjRow source as the D1 path below — gives
                // thin-sample JUCO pitchers their blended values.
                return <JucoPitcherRiskCard input={{
                  projectedPrvPlus: pitchingSimulation.pRvPlus,
                  stuffPlus: pitcherProjRow?.stuffPlus ?? selectedPitcher.stuffPlus,
                  missPct: pitcherProjRow?.miss_pct ?? selectedPitcher.missPct,
                  bbPct: pitcherProjRow?.bb_pct ?? selectedPitcher.bbPct,
                  chasePct: pitcherProjRow?.chase_pct ?? selectedPitcher.chasePct,
                  barrelPct: pitcherProjRow?.barrel_pct ?? selectedPitcher.barrelPct,
                  hardHitPct: pitcherProjRow?.hard_hit_pct ?? selectedPitcher.hardHitPct,
                  groundPct: pitcherProjRow?.ground_pct ?? selectedPitcher.groundPct,
                  inZoneWhiffPct: pitcherProjRow?.in_zone_whiff_pct ?? selectedPitcher.inZoneWhiffPct,
                  k9: pitcherProjRow?.k9 ?? selectedPitcher.k9,
                  bb9: pitcherProjRow?.bb9 ?? selectedPitcher.bb9,
                  hr9: pitcherProjRow?.hr9 ?? selectedPitcher.hr9,
                  trackmanPitches: pitcherProjRow?.trackman_pitches ?? selectedPitcher.trackmanPitches,
                  bf: pitcherProjRow?.bf ?? selectedPitcher.bf,
                  sourceConference: pitchingSimulation.fromConference ?? null,
                  sourceHitterTalentPlus: pitchingSimulation.fromHitterTalent,
                }} />;
              }

              // D1 sim — match PitcherProfile's risk inputs so the same
              // pitcher shows the same grade on both surfaces. Skillset
              // fields come from pitcherProjRow (2026 Pitching Master with
              // blended_* fallback) just like PitcherProfile does.
              const risk = assessPitcherRisk({
                conference: pitchingSimulation.fromConference ?? null,
                projectedPrvPlus: pitchingSimulation.pRvPlus,
                confHitterTalentPlus: pitchingSimulation.fromHitterTalent,
                careerSeasons: pitcherCareerSeasons as any[],
                ip: pitcherProjRow?.ip ?? (selectedPitcher as any).ip ?? null,
                stuffPlus: pitcherProjRow?.stuffPlus ?? selectedPitcher.stuffPlus,
                whiffPct: pitcherProjRow?.miss_pct ?? selectedPitcher.missPct,
                bbPct: pitcherProjRow?.bb_pct ?? selectedPitcher.bbPct,
                chase: pitcherProjRow?.chase_pct ?? selectedPitcher.chasePct,
                barrel: pitcherProjRow?.barrel_pct ?? selectedPitcher.barrelPct,
                hardHit: pitcherProjRow?.hard_hit_pct ?? selectedPitcher.hardHitPct,
                gb: pitcherProjRow?.ground_pct ?? selectedPitcher.groundPct,
                izWhiff: pitcherProjRow?.in_zone_whiff_pct ?? selectedPitcher.inZoneWhiffPct,
                k9: pitcherProjRow?.k9 ?? selectedPitcher.k9,
                bb9: pitcherProjRow?.bb9 ?? selectedPitcher.bb9,
                hr9: pitcherProjRow?.hr9 ?? selectedPitcher.hr9,
              });
              return <RiskAssessmentCardRSTR risk={risk} />;
            })()}

          </>
        )}
      </div>
    </DashboardLayout>
  );
}
