import { useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
import { getConferenceAliases } from "@/lib/conferenceMapping";
import { profileRouteFor } from "@/lib/profileRoutes";
import { readTeamParkFactorComponents, resolveMetricParkFactor } from "@/lib/parkFactors";
import { readPitchingWeights } from "@/lib/pitchingEquations";

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
  from_avg: number | null;
  from_obp: number | null;
  from_slg: number | null;
  power_rating_plus: number | null;
  class_transition: string | null;
  dev_aggressiveness: number | null;
};

type ConferenceRow = {
  conference: string;
  season?: number | null;
  avg_plus: number | null;
  obp_plus: number | null;
  iso_plus: number | null;
  stuff_plus: number | null;
  wrc_plus?: number | null;
  offensive_power_rating?: number | null;
};

type TeamRow = {
  name: string;
  conference: string | null;
  park_factor: number | null;
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
  names: Array<string | null | undefined>,
  fallbackParkFactor: number | null | undefined,
  metric: "avg" | "obp" | "iso" | "era" | "whip" | "hr9",
  map: Record<string, any>,
) => {
  for (const name of names) {
    const v = resolveMetricParkFactor(name, null, metric, map);
    if (v != null && Number.isFinite(v)) return v;
  }
  return resolveMetricParkFactor(names[0] || null, fallbackParkFactor ?? null, metric, map);
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
const TARGET_BOARD_STORAGE_KEY = "team_builder_target_board_v1";
const PITCHING_CONFERENCE_STATS_STORAGE_KEY = "pitching_conference_stats_rows_v1";

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

// TODO: Hardcoded conference power ratings — migrate to Supabase or derive from conference_stats.
const OVERALL_HITTER_POWER_RATING_BY_CONFERENCE_CANONICAL: Record<string, number> = {
  "atlantic 10": 105,
  "american athletic conference": 95,
  acc: 110,
  "american east": 82,
  "atlantic sun conference": 89,
  "big east conference": 104,
  "big south conference": 102,
  "big ten": 110,
  "big 12": 112,
  "big west": 96,
  "coastal athletic association": 91,
  "conference usa": 102,
  "horizon league": 103,
  "ivy league": 88,
  "metro atlantic athletic conference": 86,
  "mid american conference": 98,
  "mountain west": 100,
  "missouri valley conference": 107,
  "northeast conference": 78,
  "ohio valley conference": 87,
  "patriot league": 94,
  "southern conference": 106,
  sec: 108,
  "southland conference": 83,
  "southwestern athletic conference": 93,
  "summit league": 82,
  "sun belt": 97,
  "west coast conference": 89,
  "western athletic conference": 103,
};

const getOverallHitterPowerForPitching = (conference: string | null | undefined) => {
  const key = canonicalConferencePitching(conference);
  if (!key) return null;
  return OVERALL_HITTER_POWER_RATING_BY_CONFERENCE_CANONICAL[key] ?? null;
};


type TargetBoardEntry = {
  playerId: string;
  playerName: string;
  destinationTeam: string;
  fromTeam: string | null;
  fromConference: string | null;
  pitcherRole?: "SP" | "RP" | null;
  pAvg: number | null;
  pObp: number | null;
  pSlg: number | null;
  pWrcPlus: number | null;
  pEra?: number | null;
  pFip?: number | null;
  pWhip?: number | null;
  pK9?: number | null;
  pBb9?: number | null;
  pHr9?: number | null;
  pRvPlus?: number | null;
  pWar?: number | null;
  owar: number | null;
  nilValuation: number | null;
  createdAt: string;
};

function readLocalNum(key: string, fallback: number, remoteValues?: Record<string, number>): number {
  const remote = remoteValues?.[key];
  if (Number.isFinite(remote)) return Number(remote);
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem("admin_dashboard_equation_values_v1");
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Record<string, string>;
    const num = Number(parsed[key]);
    return Number.isFinite(num) ? num : fallback;
  } catch {
    return fallback;
  }
}

export default function TransferPortal() {
  const location = useLocation();
  const { toast } = useToast();
  const { hasRole } = useAuth();
  const { hitterStats } = useHitterSeedData();
  const isAdmin = hasRole("admin");
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>("");
  const [playerSearch, setPlayerSearch] = useState<string>("");
  const [selectedDestinationTeam, setSelectedDestinationTeam] = useState<string>("Penn State");
  const [teamSearch, setTeamSearch] = useState<string>("Penn State");
  const [simType, setSimType] = useState<"hitting" | "pitching">("hitting");
  const [selectedPitcherId, setSelectedPitcherId] = useState<string>("");
  const [pitcherSearch, setPitcherSearch] = useState<string>("");
  const [pitchingRoleOverride, setPitchingRoleOverride] = useState<"SP" | "RP">("RP");
  const pitchingEqForTiers = useMemo(() => readPitchingWeights(), []);

  const { data: players = [], isLoading: playersLoading } = useQuery({
    queryKey: ["transfer-sim-players"],
    queryFn: async () => {
      let allPlayers: any[] = [];
      let from = 0;
      const PAGE_SIZE = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("players")
          .select("id, first_name, last_name, position, team, from_team, conference, transfer_portal")
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
          .in("model_type", ["returner", "transfer"])
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

  const { data: teams = [] } = useQuery({
    queryKey: ["transfer-sim-teams"],
    queryFn: async () => {
      const { data, error } = await supabase.from("teams").select("name, conference, park_factor").order("name");
      if (error) throw error;
      return (data || []) as TeamRow[];
    },
  });

  const { data: conferenceStats = [] } = useQuery({
    queryKey: ["transfer-sim-conference-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conference_stats")
        .select("conference, season, avg_plus, obp_plus, iso_plus, stuff_plus, wrc_plus, offensive_power_rating")
        .eq("season", 2025);
      if (error) throw error;
      // keep best row per conference key inside 2025 only.
      const byConf = new Map<string, { row: ConferenceRow; score: number }>();
      for (const row of (data || []) as ConferenceRow[]) {
        const key = normalizeKey(row.conference);
        if (!key) continue;
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
    },
  });

  const { data: remoteEquationValues = {} } = useQuery({
    queryKey: ["admin-ui-equation-values"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("model_config")
        .select("config_key, config_value")
        .eq("model_type", "admin_ui")
        .eq("season", 2025);
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const row of data || []) map[row.config_key] = Number(row.config_value);
      return map;
    },
  });

  const selectedPlayer = useMemo(
    () => players.find((p) => p.player_id === selectedPlayerId) || null,
    [players, selectedPlayerId],
  );

  const filteredPlayers = useMemo(() => {
    const isPitcher = (pos: string | null | undefined) => /^(SP|RP|CL|P|LHP|RHP|TWP)/i.test(String(pos || ""));
    const q = normalizeKey(playerSearch);
    const pool = (q
      ? players.filter((p) =>
          normalizeKey(`${p.first_name} ${p.last_name} ${(p.from_team || p.team || "")} ${(p.position || "")}`).includes(q),
        )
      : players
    ).filter((p) => !isPitcher(p.position));
    return pool.slice(0, 25);
  }, [players, playerSearch]);

  const filteredTeams = useMemo(() => {
    const q = normalizeKey(teamSearch);
    const pool = q
      ? teams.filter((t) =>
          `${t.name} ${t.conference || ""}`.toLowerCase().includes(q),
        )
      : teams;
    return pool.slice(0, 30);
  }, [teams, teamSearch]);
  const teamParkComponents = readTeamParkFactorComponents();

  const pitchingPlayers = useMemo<PitchingStorageRow[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem("pitching_stats_storage_2025_v1");
      if (!raw) return [];
      const parsed = JSON.parse(raw) as { rows?: Array<{ id?: string; values?: string[] }> };
      const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
      return rows.map((r, idx) => {
        const values = Array.isArray(r.values) ? r.values : [];
        const stats = resolvePitchingStatsView(values);
        return {
          id: r.id || `pitching-transfer-${idx}`,
          player_name: (values[0] || "").trim(),
          team: (values[1] || "").trim() || null,
          handedness: (values[2] || "").trim() || null,
          role: toPitchingRole(stats.role),
          era: parseNum(stats.era),
          fip: parseNum(stats.fip),
          whip: parseNum(stats.whip),
          k9: parseNum(stats.k9),
          bb9: parseNum(stats.bb9),
          hr9: parseNum(stats.hr9),
        };
      }).filter((r) => !!r.player_name);
    } catch {
      return [];
    }
  }, []);

  const selectedPitcher = useMemo(
    () => pitchingPlayers.find((p) => p.id === selectedPitcherId) || null,
    [pitchingPlayers, selectedPitcherId],
  );

  const pitchingPowerByKey = useMemo(() => {
    const byNameTeam = new Map<string, PitchingPowerSnapshot>();
    const byName = new Map<string, PitchingPowerSnapshot>();
    if (typeof window === "undefined") return { byNameTeam, byName };
    try {
      const raw = window.localStorage.getItem("pitching_power_ratings_storage_2025_v1");
      if (!raw) return { byNameTeam, byName };
      const parsed = JSON.parse(raw) as { rows?: Array<{ values?: string[] }> };
      const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
      for (const row of rows) {
        const values = Array.isArray(row?.values) ? row.values : [];
        const name = (values[0] || "").trim();
        const team = (values[1] || "").trim();
        if (!name) continue;
        const snapshot: PitchingPowerSnapshot = {
          eraPrPlus: parseNum(values[30]),
          fipPrPlus: parseNum(values[31]),
          whipPrPlus: parseNum(values[32]),
          k9PrPlus: parseNum(values[33]),
          hr9PrPlus: parseNum(values[34]),
          bb9PrPlus: parseNum(values[35]),
        };
        const nameKey = normalizeKey(name);
        const teamKey = normalizeKey(team);
        if (nameKey && !byName.has(nameKey)) byName.set(nameKey, snapshot);
        if (nameKey && teamKey && !byNameTeam.has(`${nameKey}|${teamKey}`)) {
          byNameTeam.set(`${nameKey}|${teamKey}`, snapshot);
        }
      }
    } catch {
      // ignore parse/storage errors
    }
    return { byNameTeam, byName };
  }, []);

  const selectedPitcherPower = useMemo<PitchingPowerSnapshot | null>(() => {
    if (!selectedPitcher) return null;
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
    const pool = q
      ? pitchingPlayers.filter((p) => normalizeKey(`${p.player_name} ${p.team || ""} ${p.handedness || ""}`).includes(q))
      : pitchingPlayers;
    return pool.slice(0, 25);
  }, [pitchingPlayers, pitcherSearch]);

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

  const teamByKey = useMemo(() => {
    const map = new Map<string, TeamRow>();
    for (const t of teams) map.set(normalizeKey(t.name), t);
    return map;
  }, [teams]);

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
    if (typeof window === "undefined") return map;
    try {
      const raw = window.localStorage.getItem(PITCHING_CONFERENCE_STATS_STORAGE_KEY);
      if (!raw) return map;
      const parsed = JSON.parse(raw) as Array<{
        conference: string;
        era: number | null;
        fip: number | null;
        whip: number | null;
        k9: number | null;
        bb9: number | null;
        hr9: number | null;
        hitter_talent_plus?: number | null;
      }>;
      const eq = readPitchingWeights();
      const hittingByCanonical = new Map<string, ConferenceRow>();
      for (const c of conferenceStats) {
        const k = canonicalConferencePitching(c.conference);
        if (k) hittingByCanonical.set(k, c);
      }
      const rows = Array.isArray(parsed) ? parsed : [];
      for (const row of rows) {
        const directKey = normalizeKey(row.conference);
        const canonicalKey = canonicalConferencePitching(row.conference);
        if (!directKey) continue;
        const eraPlus = calcPitchingPlus(row.era, eq.era_plus_ncaa_avg, eq.era_plus_ncaa_sd, eq.era_plus_scale, false);
        const fipPlus = calcPitchingPlus(row.fip, eq.fip_plus_ncaa_avg, eq.fip_plus_ncaa_sd, eq.fip_plus_scale, false);
        const whipPlus = calcPitchingPlus(row.whip, eq.whip_plus_ncaa_avg, eq.whip_plus_ncaa_sd, eq.whip_plus_scale, false);
        const k9Plus = calcPitchingPlus(row.k9, eq.k9_plus_ncaa_avg, eq.k9_plus_ncaa_sd, eq.k9_plus_scale, true);
        const bb9Plus = calcPitchingPlus(row.bb9, eq.bb9_plus_ncaa_avg, eq.bb9_plus_ncaa_sd, eq.bb9_plus_scale, false);
        const hr9Plus = calcPitchingPlus(row.hr9, eq.hr9_plus_ncaa_avg, eq.hr9_plus_ncaa_sd, eq.hr9_plus_scale, false);
        const matchingHittingConference = canonicalKey ? hittingByCanonical.get(canonicalKey) : null;
        const rawManualHitterTalent = (() => {
          const n = Number(row.hitter_talent_plus);
          return Number.isFinite(n) ? n : null;
        })();
        const hitterTalentFromEquation = calcHitterTalentPlusFromConference(
          matchingHittingConference?.offensive_power_rating ??
            getOverallHitterPowerForPitching(canonicalKey),
          matchingHittingConference?.stuff_plus ?? null,
          matchingHittingConference?.wrc_plus ?? null,
        );
        const hitterTalentPlusNum = (() => {
          if (hitterTalentFromEquation != null) return hitterTalentFromEquation;
          if (rawManualHitterTalent != null) return rawManualHitterTalent;
          return null;
        })();
        const nextRow = {
          conference: row.conference,
          era_plus: eraPlus,
          fip_plus: fipPlus,
          whip_plus: whipPlus,
          k9_plus: k9Plus,
          bb9_plus: bb9Plus,
          hr9_plus: hr9Plus,
          hitter_talent_plus: hitterTalentPlusNum,
        };
        map.set(directKey, nextRow);
        if (canonicalKey) map.set(canonicalKey, nextRow);
      }
    } catch {
      // ignore malformed storage
    }
    return map;
  }, [conferenceStats]);

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
  const fromTeamRow = fromTeam ? teamByKey.get(normalizeKey(fromTeam)) || null : null;
  const toTeamRow = selectedDestinationTeam ? teamByKey.get(normalizeKey(selectedDestinationTeam)) || null : null;

  const fromConference = fromTeamRow?.conference || selectedPlayer?.conference || null;
  const toConference = toTeamRow?.conference || null;

  const resolveConferenceStats = (conference: string | null | undefined): ConferenceRow | null => {
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

  const fromConfStats = resolveConferenceStats(fromConference);
  const toConfStats = resolveConferenceStats(toConference);

  const resolvePitchingConferenceStats = (conference: string | null | undefined) => {
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
    if (!selectedPlayer || !toTeamRow) return null;

    const missingInputs: string[] = [];
    const lastAvg = selectedPlayer.from_avg;
    const lastObp = selectedPlayer.from_obp;
    const lastSlg = selectedPlayer.from_slg;
    if (lastAvg == null) missingInputs.push("Last AVG");
    if (lastObp == null) missingInputs.push("Last OBP");
    if (lastSlg == null) missingInputs.push("Last SLG");

    // Use stat-specific power rating+ only (no fallback to overall power_rating_plus).
    const baPR = internals?.avg_power_rating ?? null;
    const obpPR = internals?.obp_power_rating ?? null;
    const isoPR = internals?.slg_power_rating ?? null;

    if (baPR == null) missingInputs.push("BA Power Rating+");
    if (obpPR == null) missingInputs.push("OBP Power Rating+");
    if (isoPR == null) missingInputs.push("ISO Power Rating+");

    const fromAvgPlus = fromConfStats?.avg_plus ?? null;
    const toAvgPlus = toConfStats?.avg_plus ?? null;
    const fromObpPlus = fromConfStats?.obp_plus ?? null;
    const toObpPlus = toConfStats?.obp_plus ?? null;
    const fromIsoPlus = fromConfStats?.iso_plus ?? null;
    const toIsoPlus = toConfStats?.iso_plus ?? null;

    const fromStuff = fromConfStats?.stuff_plus ?? null;
    const toStuff = toConfStats?.stuff_plus ?? null;

    const fromParkAvgRaw = resolveMetricParkFactor(fromTeamRow?.name, fromTeamRow?.park_factor ?? null, "avg", teamParkComponents);
    const toParkAvgRaw = resolveMetricParkFactor(toTeamRow?.name, toTeamRow?.park_factor ?? null, "avg", teamParkComponents);
    const fromParkObpRaw = resolveMetricParkFactor(fromTeamRow?.name, fromTeamRow?.park_factor ?? null, "obp", teamParkComponents);
    const toParkObpRaw = resolveMetricParkFactor(toTeamRow?.name, toTeamRow?.park_factor ?? null, "obp", teamParkComponents);
    const fromParkIsoRaw = resolveMetricParkFactor(fromTeamRow?.name, fromTeamRow?.park_factor ?? null, "iso", teamParkComponents);
    const toParkIsoRaw = resolveMetricParkFactor(toTeamRow?.name, toTeamRow?.park_factor ?? null, "iso", teamParkComponents);
    if (fromAvgPlus == null) missingInputs.push("From AVG+");
    if (toAvgPlus == null) missingInputs.push("To AVG+");
    if (fromObpPlus == null) missingInputs.push("From OBP+");
    if (toObpPlus == null) missingInputs.push("To OBP+");
    if (fromIsoPlus == null) missingInputs.push("From ISO+");
    if (toIsoPlus == null) missingInputs.push("To ISO+");
    if (fromStuff == null) missingInputs.push("From Stuff+");
    if (toStuff == null) missingInputs.push("To Stuff+");
    if (fromParkAvgRaw == null) missingInputs.push("From AVG Park Factor");
    if (toParkAvgRaw == null) missingInputs.push("To AVG Park Factor");
    if (fromParkObpRaw == null) missingInputs.push("From OBP Park Factor");
    if (toParkObpRaw == null) missingInputs.push("To OBP Park Factor");
    if (fromParkIsoRaw == null) missingInputs.push("From ISO Park Factor");
    if (toParkIsoRaw == null) missingInputs.push("To ISO Park Factor");
    if (missingInputs.length > 0) {
      return {
        blocked: true as const,
        missingInputs,
        pAvg: null,
        pObp: null,
        pSlg: null,
        pOps: null,
        pIso: null,
        pWrc: null,
        pWrcPlus: null,
        owar: null,
        nilValuation: null,
        fromAvgPlus,
        toAvgPlus,
        fromObpPlus,
        toObpPlus,
        fromIsoPlus,
        toIsoPlus,
        fromStuff,
        toStuff,
        fromPark: null,
        toPark: null,
        fromParkRaw: fromParkAvgRaw,
        toParkRaw: toParkAvgRaw,
        fromObpParkRaw: fromParkObpRaw,
        toObpParkRaw: toParkObpRaw,
        fromIsoParkRaw: fromParkIsoRaw,
        toIsoParkRaw: toParkIsoRaw,
        ptm: null,
        pvm: null,
      };
    }
    const fromBaPark = normalizeParkToIndex(fromParkAvgRaw);
    const toBaPark = normalizeParkToIndex(toParkAvgRaw);
    const fromObpPark = normalizeParkToIndex(fromParkObpRaw);
    const toObpPark = normalizeParkToIndex(toParkObpRaw);
    const fromIsoPark = normalizeParkToIndex(fromParkIsoRaw);
    const toIsoPark = normalizeParkToIndex(toParkIsoRaw);

    const ncaaAvgBA = toRate(readLocalNum("t_ba_ncaa_avg", 0.280, remoteEquationValues));
    const ncaaAvgOBP = toRate(readLocalNum("t_obp_ncaa_avg", 0.385, remoteEquationValues));
    const ncaaAvgISO = toRate(readLocalNum("t_iso_ncaa_avg", 0.162, remoteEquationValues));
    const ncaaAvgWrc = toRate(readLocalNum("t_wrc_ncaa_avg", 0.364, remoteEquationValues));
    const baStdPower = readLocalNum("t_ba_std_pr", 31.297, remoteEquationValues);
    const baStdNcaa = toRate(readLocalNum("t_ba_std_ncaa", 0.043455, remoteEquationValues));
    const obpStdPower = readLocalNum("t_obp_std_pr", 28.889, remoteEquationValues);
    const obpStdNcaa = toRate(readLocalNum("t_obp_std_ncaa", 0.046781, remoteEquationValues));

    const baPowerWeight = toRate(readLocalNum("t_ba_power_weight", 0.70, remoteEquationValues));
    const obpPowerWeight = toRate(readLocalNum("t_obp_power_weight", 0.70, remoteEquationValues));

    const baConferenceWeight = toWeight(readLocalNum("t_ba_conference_weight", 1.0, remoteEquationValues));
    const obpConferenceWeight = toWeight(readLocalNum("t_obp_conference_weight", 1.0, remoteEquationValues));
    const isoConferenceWeight = toWeight(readLocalNum("t_iso_conference_weight", 0.25, remoteEquationValues));

    const baPitchingWeight = toWeight(readLocalNum("t_ba_pitching_weight", 1.0, remoteEquationValues));
    const obpPitchingWeight = toWeight(readLocalNum("t_obp_pitching_weight", 1.0, remoteEquationValues));
    const isoPitchingWeight = toWeight(readLocalNum("t_iso_pitching_weight", 1.0, remoteEquationValues));

    const baParkWeight = toWeight(readLocalNum("t_ba_park_weight", 1.0, remoteEquationValues));
    const obpParkWeight = toWeight(readLocalNum("t_obp_park_weight", 1.0, remoteEquationValues));
    const isoParkWeight = toWeight(readLocalNum("t_iso_park_weight", 0.05, remoteEquationValues));

    const isoStdPower = readLocalNum("t_iso_std_power", 45.423, remoteEquationValues);
    const isoStdNcaa = toRate(readLocalNum("t_iso_std_ncaa", 0.07849797197, remoteEquationValues));

    const wObp = toRate(readLocalNum("r_w_obp", 0.45, remoteEquationValues));
    const wSlg = toRate(readLocalNum("r_w_slg", 0.30, remoteEquationValues));
    const wAvg = toRate(readLocalNum("r_w_avg", 0.15, remoteEquationValues));
    const wIso = toRate(readLocalNum("r_w_iso", 0.10, remoteEquationValues));

    const projected = computeTransferProjection({
      lastAvg,
      lastObp,
      lastSlg,
      baPR,
      obpPR,
      isoPR,
      fromAvgPlus,
      toAvgPlus,
      fromObpPlus,
      toObpPlus,
      fromIsoPlus,
      toIsoPlus,
      fromStuff,
      toStuff,
      fromPark: fromBaPark,
      toPark: toBaPark,
      fromBaPark,
      toBaPark,
      fromObpPark,
      toObpPark,
      fromIsoPark,
      toIsoPark,
      ncaaAvgBA,
      ncaaAvgOBP,
      ncaaAvgISO,
      ncaaAvgWrc,
      baStdPower,
      baStdNcaa,
      obpStdPower,
      obpStdNcaa,
      baPowerWeight,
      obpPowerWeight,
      baConferenceWeight,
      obpConferenceWeight,
      isoConferenceWeight,
      baPitchingWeight,
      obpPitchingWeight,
      isoPitchingWeight,
      baParkWeight,
      obpParkWeight,
      isoParkWeight,
      isoStdPower,
      isoStdNcaa,
      wObp,
      wSlg,
      wAvg,
      wIso,
    });

    const classKey = String(selectedPlayer.class_transition || "SJ").toUpperCase();
    const classAdj =
      classKey === "FS" ? 0.03 :
      classKey === "SJ" ? 0.02 :
      classKey === "JS" ? 0.015 :
      classKey === "GR" ? 0.01 : 0.02;
    const devAgg = Number.isFinite(Number(selectedPlayer.dev_aggressiveness))
      ? Number(selectedPlayer.dev_aggressiveness)
      : 0;
    const transferMult = 1 + classAdj + (devAgg * 0.06);
    const pAvgAdj = projected.pAvg * transferMult;
    const pObpAdj = projected.pObp * transferMult;
    const pIsoAdj = projected.pIso * transferMult;
    const pSlgAdj = pAvgAdj + pIsoAdj;
    const pOpsAdj = pObpAdj + pSlgAdj;
    const pWrcAdj = (wObp * pObpAdj) + (wSlg * pSlgAdj) + (wAvg * pAvgAdj) + (wIso * pIsoAdj);
    const pWrcPlusAdj = ncaaAvgWrc === 0 ? null : Math.round((pWrcAdj / ncaaAvgWrc) * 100);
    const offValueAdj = pWrcPlusAdj == null ? null : (pWrcPlusAdj - 100) / 100;
    const pa = 260;
    const runsPerPa = 0.13;
    const replacementRuns = (pa / 600) * 25;
    const raaAdj = offValueAdj == null ? null : offValueAdj * pa * runsPerPa;
    const rarAdj = raaAdj == null ? null : raaAdj + replacementRuns;
    const owarAdj = rarAdj == null ? null : rarAdj / 10;

    const basePerOwar = readLocalNum("nil_base_per_owar", 25000, remoteEquationValues);
    const ptm = getProgramTierMultiplierByConference(toConference, DEFAULT_NIL_TIER_MULTIPLIERS);
    const pvm = getPositionValueMultiplier(selectedPlayer.position);
    const nilValuation = owarAdj == null ? null : owarAdj * basePerOwar * ptm * pvm;
    const safeBaStdPower = baStdPower === 0 ? 1 : baStdPower;
    const baScaled = ncaaAvgBA + (((baPR - 100) / safeBaStdPower) * baStdNcaa);
    const baBlended = (lastAvg * (1 - baPowerWeight)) + (baScaled * baPowerWeight);
    const baConfTerm = baConferenceWeight * ((toAvgPlus - fromAvgPlus) / 100);
    const baPitchTerm = baPitchingWeight * ((toStuff - fromStuff) / 100);
    const baParkTerm = baParkWeight * ((toBaPark - fromBaPark) / 100);
    const baMultiplier = 1 + baConfTerm - baPitchTerm + baParkTerm;
    const safeObpStdPower = obpStdPower === 0 ? 1 : obpStdPower;
    const obpScaled = ncaaAvgOBP + (((obpPR - 100) / safeObpStdPower) * obpStdNcaa);
    const obpBlended = (lastObp * (1 - obpPowerWeight)) + (obpScaled * obpPowerWeight);
    const obpConfTerm = obpConferenceWeight * ((toObpPlus - fromObpPlus) / 100);
    const obpPitchTerm = obpPitchingWeight * ((toStuff - fromStuff) / 100);
    const obpParkTerm = obpParkWeight * ((toObpPark - fromObpPark) / 100);
    const obpMultiplier = 1 + obpConfTerm - obpPitchTerm + obpParkTerm;
    const lastIso = lastSlg - lastAvg;
    const isoRatingZ = isoStdPower > 0 ? (isoPR - 100) / isoStdPower : 0;
    const isoScaled = ncaaAvgISO + (isoRatingZ * isoStdNcaa);
    const isoBlended = (lastIso * (1 - 0.3)) + (isoScaled * 0.3);
    const isoConfTerm = isoConferenceWeight * ((toIsoPlus - fromIsoPlus) / 100);
    const isoPitchTerm = isoPitchingWeight * ((toStuff - fromStuff) / 100);
    const isoParkTerm = isoParkWeight * ((toIsoPark - fromIsoPark) / 100);
    const isoMultiplier = 1 + isoConfTerm - isoPitchTerm + isoParkTerm;

    return {
      blocked: false as const,
      missingInputs: [] as string[],
      pAvg: pAvgAdj,
      pObp: pObpAdj,
      pSlg: pSlgAdj,
      pOps: pOpsAdj,
      pIso: pIsoAdj,
      pWrc: pWrcAdj,
      pWrcPlus: pWrcPlusAdj,
      owar: owarAdj,
      nilValuation,
      fromAvgPlus,
      toAvgPlus,
      fromObpPlus,
      toObpPlus,
      fromIsoPlus,
      toIsoPlus,
      fromStuff,
      toStuff,
      fromPark: fromBaPark,
      toPark: toBaPark,
      fromParkRaw: fromParkAvgRaw,
      toParkRaw: toParkAvgRaw,
      fromObpParkRaw: fromParkObpRaw,
      toObpParkRaw: toParkObpRaw,
      fromIsoParkRaw: fromParkIsoRaw,
      toIsoParkRaw: toParkIsoRaw,
      ptm,
      pvm,
      baWork: {
        lastStat: lastAvg,
        baPR,
        ncaaAvgBA,
        baStdPower,
        baStdNcaa,
        baPowerWeight,
        baConferenceWeight,
        baPitchingWeight,
        baParkWeight,
        fromAvgPlus,
        toAvgPlus,
        fromStuff,
        toStuff,
        fromPark: fromBaPark,
        toPark: toBaPark,
        powerAdj: baScaled,
        blended: baBlended,
        confTerm: baConfTerm,
        pitchTerm: baPitchTerm,
        parkTerm: baParkTerm,
        multiplier: baMultiplier,
      },
      obpWork: {
        lastStat: lastObp,
        obpPR,
        ncaaAvgOBP,
        obpStdPower,
        obpStdNcaa,
        obpPowerWeight,
        obpConferenceWeight,
        obpPitchingWeight,
        obpParkWeight,
        fromObpPlus,
        toObpPlus,
        fromStuff,
        toStuff,
        fromPark: fromObpPark,
        toPark: toObpPark,
        powerAdj: obpScaled,
        blended: obpBlended,
        confTerm: obpConfTerm,
        pitchTerm: obpPitchTerm,
        parkTerm: obpParkTerm,
        multiplier: obpMultiplier,
      },
      isoWork: {
        lastIso,
        isoPR,
        ncaaAvgISO,
        isoStdPower,
        isoStdNcaa,
        isoPowerWeight: 0.3,
        isoConferenceWeight,
        isoPitchingWeight,
        isoParkWeight,
        fromIsoPlus,
        toIsoPlus,
        fromStuff,
        toStuff,
        fromPark: fromIsoPark,
        toPark: toIsoPark,
        ratingZ: isoRatingZ,
        powerAdj: isoScaled,
        blended: isoBlended,
        confTerm: isoConfTerm,
        pitchTerm: isoPitchTerm,
        parkTerm: isoParkTerm,
        multiplier: isoMultiplier,
      },
    };
  }, [selectedPlayer, toTeamRow, internals, fromConfStats, toConfStats, fromTeamRow, toConference, remoteEquationValues, teamParkComponents]);

  const pitchingSimulation = useMemo<PitchingSim | null>(() => {
    if (!selectedPitcher || !selectedDestinationTeam) return null;
    const eq = readPitchingWeights();
    const toPitchTeamRow = resolveTeamRowFromCandidates([selectedDestinationTeam], teamByKey, teams);
    if (!toPitchTeamRow) return null;
    const fromPitchTeam = selectedPitcher.team;
    const fromPitchTeamRow = resolveTeamRowFromCandidates([fromPitchTeam], teamByKey, teams);
    const fromPitchConference = fromPitchTeamRow?.conference || null;
    const toPitchConference = toPitchTeamRow?.conference || null;
    const fromPitchConfStats = resolvePitchingConferenceStats(fromPitchConference);
    const toPitchConfStats = resolvePitchingConferenceStats(toPitchConference);

    const missing: string[] = [];
    const requireNum = (label: string, value: number | null | undefined) => {
      if (value == null || !Number.isFinite(value)) missing.push(label);
    };

    requireNum("Last ERA", selectedPitcher.era);
    requireNum("Last FIP", selectedPitcher.fip);
    requireNum("Last WHIP", selectedPitcher.whip);
    requireNum("Last K/9", selectedPitcher.k9);
    requireNum("Last BB/9", selectedPitcher.bb9);
    requireNum("Last HR/9", selectedPitcher.hr9);

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

    // Pitching transfer must use pitching-specific park factors only (R/G, WHIP, HR/9).
    // Do not fallback to generic park_factor so bad mappings are exposed instead of silently masked.
    const fromEraParkRaw = resolveParkFactorFromCandidates([selectedPitcher.team, fromPitchTeamRow?.name], null, "era", teamParkComponents);
    const toEraParkRaw = resolveParkFactorFromCandidates([selectedDestinationTeam, toPitchTeamRow?.name], null, "era", teamParkComponents);
    const fromWhipParkRaw = resolveParkFactorFromCandidates([selectedPitcher.team, fromPitchTeamRow?.name], null, "whip", teamParkComponents);
    const toWhipParkRaw = resolveParkFactorFromCandidates([selectedDestinationTeam, toPitchTeamRow?.name], null, "whip", teamParkComponents);
    const fromHr9ParkRaw = resolveParkFactorFromCandidates([selectedPitcher.team, fromPitchTeamRow?.name], null, "hr9", teamParkComponents);
    const toHr9ParkRaw = resolveParkFactorFromCandidates([selectedDestinationTeam, toPitchTeamRow?.name], null, "hr9", teamParkComponents);
    requireNum("From R/G Park Factor", fromEraParkRaw);
    requireNum("To R/G Park Factor", toEraParkRaw);
    requireNum("From WHIP Park Factor", fromWhipParkRaw);
    requireNum("To WHIP Park Factor", toWhipParkRaw);
    requireNum("From HR/9 Park Factor", fromHr9ParkRaw);
    requireNum("To HR/9 Park Factor", toHr9ParkRaw);

    if (missing.length > 0) {
      return {
        blocked: true,
        missingInputs: missing,
        pEra: null, pFip: null, pWhip: null, pK9: null, pBb9: null, pHr9: null, pRvPlus: null, pWar: null, marketValue: null, projectedRole: "RP", showWork: null,
        fromConference: fromPitchConference, toConference: toPitchConference,
        fromEraPlus, toEraPlus, fromFipPlus, toFipPlus, fromWhipPlus, toWhipPlus,
        fromK9Plus, toK9Plus, fromBb9Plus, toBb9Plus, fromHr9Plus, toHr9Plus,
        fromHitterTalent, toHitterTalent,
        fromEraParkRaw, toEraParkRaw, fromWhipParkRaw, toWhipParkRaw, fromHr9ParkRaw, toHr9ParkRaw,
        weights: null,
      };
    }

    const toParkIdx = (n: number | null) => normalizeParkToIndex(n);
    const fromRg = toParkIdx(fromEraParkRaw);
    const toRg = toParkIdx(toEraParkRaw);
    const fromWhipPf = toParkIdx(fromWhipParkRaw);
    const toWhipPf = toParkIdx(toWhipParkRaw);
    const fromHr9Pf = toParkIdx(fromHr9ParkRaw);
    const toHr9Pf = toParkIdx(toHr9ParkRaw);

    const calcLowerWork = (
      last: number,
      prPlus: number,
      ncaaAvg: number,
      prSd: number,
      ncaaSd: number,
      powerWeight: number,
      confWeight: number,
      fromPlus: number,
      toPlus: number,
      compWeight: number,
      fromTalent: number,
      toTalent: number,
      parkWeight: number | null,
      fromPark: number | null,
      toPark: number | null,
      dampFactor: number = 1,
    ) => {
      const safePrSd = prSd === 0 ? 1 : prSd;
      const powerAdj = ncaaAvg - (((prPlus - 100) / safePrSd) * ncaaSd);
      const blended = (last * (1 - powerWeight)) + (powerAdj * powerWeight);
      const confTerm = confWeight * ((toPlus - fromPlus) / 100);
      const compTerm = compWeight * ((toTalent - fromTalent) / 100);
      const parkTerm = parkWeight != null && fromPark != null && toPark != null ? parkWeight * ((toPark - fromPark) / 100) : 0;
      const mult = 1 - confTerm + compTerm + parkTerm;
      const adjustedMult = 1 + ((mult - 1) * dampFactor);
      return {
        powerAdj: round3(powerAdj),
        blended: round3(blended),
        mult: round3(adjustedMult),
        projected: round3(blended * adjustedMult),
        confTerm: round3(confTerm),
        compTerm: round3(compTerm),
        parkTerm: round3(parkTerm),
      };
    };

    const calcHigherWork = (
      last: number,
      prPlus: number,
      ncaaAvg: number,
      prSd: number,
      ncaaSd: number,
      powerWeight: number,
      confWeight: number,
      fromPlus: number,
      toPlus: number,
      compWeight: number,
      fromTalent: number,
      toTalent: number,
    ) => {
      const safePrSd = prSd === 0 ? 1 : prSd;
      const powerAdj = ncaaAvg + (((prPlus - 100) / safePrSd) * ncaaSd);
      const blended = (last * (1 - powerWeight)) + (powerAdj * powerWeight);
      const confTerm = confWeight * ((toPlus - fromPlus) / 100);
      const compTerm = compWeight * ((toTalent - fromTalent) / 100);
      const mult = 1 + confTerm - compTerm;
      return {
        powerAdj: round3(powerAdj),
        blended: round3(blended),
        mult: round3(mult),
        projected: round3(blended * mult),
        confTerm: round3(confTerm),
        compTerm: round3(compTerm),
        parkTerm: 0,
      };
    };

    const eraPr = selectedPitcherPower?.eraPrPlus ?? null;
    const fipPr = selectedPitcherPower?.fipPrPlus ?? null;
    const whipPr = selectedPitcherPower?.whipPrPlus ?? null;
    const k9Pr = selectedPitcherPower?.k9PrPlus ?? null;
    const bb9Pr = selectedPitcherPower?.bb9PrPlus ?? null;
    const hr9Pr = selectedPitcherPower?.hr9PrPlus ?? null;
    requireNum("ERA Power Rating+", eraPr);
    requireNum("FIP Power Rating+", fipPr);
    requireNum("WHIP Power Rating+", whipPr);
    requireNum("K/9 Power Rating+", k9Pr);
    requireNum("BB/9 Power Rating+", bb9Pr);
    requireNum("HR/9 Power Rating+", hr9Pr);
    if (missing.length > 0) {
      return {
        blocked: true,
        missingInputs: missing,
        pEra: null, pFip: null, pWhip: null, pK9: null, pBb9: null, pHr9: null, pRvPlus: null, pWar: null, marketValue: null, projectedRole: "RP", showWork: null,
        fromConference: fromPitchConference, toConference: toPitchConference,
        fromEraPlus, toEraPlus, fromFipPlus, toFipPlus, fromWhipPlus, toWhipPlus,
        fromK9Plus, toK9Plus, fromBb9Plus, toBb9Plus, fromHr9Plus, toHr9Plus,
        fromHitterTalent, toHitterTalent,
        fromEraParkRaw, toEraParkRaw, fromWhipParkRaw, toWhipParkRaw, fromHr9ParkRaw, toHr9ParkRaw,
        weights: null,
      };
    }

    const eraWork = calcLowerWork(selectedPitcher.era!, eraPr!, eq.era_plus_ncaa_avg, eq.era_pr_sd, eq.era_plus_ncaa_sd, eq.transfer_era_power_weight, eq.transfer_era_conference_weight, fromEraPlus!, toEraPlus!, eq.transfer_era_competition_weight, fromHitterTalent!, toHitterTalent!, eq.transfer_era_park_weight, fromRg, toRg);
    const fipWork = calcLowerWork(selectedPitcher.fip!, fipPr!, eq.fip_plus_ncaa_avg, eq.fip_pr_sd, eq.fip_plus_ncaa_sd, eq.transfer_fip_power_weight, eq.transfer_fip_conference_weight, fromFipPlus!, toFipPlus!, eq.transfer_fip_competition_weight, fromHitterTalent!, toHitterTalent!, eq.transfer_fip_park_weight, fromRg, toRg);
    const whipWork = calcLowerWork(selectedPitcher.whip!, whipPr!, eq.whip_plus_ncaa_avg, eq.whip_pr_sd, eq.whip_plus_ncaa_sd, eq.transfer_whip_power_weight, eq.transfer_whip_conference_weight, fromWhipPlus!, toWhipPlus!, eq.transfer_whip_competition_weight, fromHitterTalent!, toHitterTalent!, eq.transfer_whip_park_weight, fromWhipPf, toWhipPf, 0.75);
    const k9Work = calcHigherWork(selectedPitcher.k9!, k9Pr!, eq.k9_plus_ncaa_avg, eq.k9_pr_sd, eq.k9_plus_ncaa_sd, eq.transfer_k9_power_weight, eq.transfer_k9_conference_weight, fromK9Plus!, toK9Plus!, eq.transfer_k9_competition_weight, fromHitterTalent!, toHitterTalent!);
    const bb9Work = calcLowerWork(selectedPitcher.bb9!, bb9Pr!, eq.bb9_plus_ncaa_avg, eq.bb9_pr_sd, eq.bb9_plus_ncaa_sd, eq.transfer_bb9_power_weight, eq.transfer_bb9_conference_weight, fromBb9Plus!, toBb9Plus!, eq.transfer_bb9_competition_weight, fromHitterTalent!, toHitterTalent!, null, null, null);
    const hr9Work = calcLowerWork(selectedPitcher.hr9!, hr9Pr!, eq.hr9_plus_ncaa_avg, eq.hr9_pr_sd, eq.hr9_plus_ncaa_sd, eq.transfer_hr9_power_weight, eq.transfer_hr9_conference_weight, fromHr9Plus!, toHr9Plus!, eq.transfer_hr9_competition_weight, fromHitterTalent!, toHitterTalent!, eq.transfer_hr9_park_weight, fromHr9Pf, toHr9Pf);
    const pEra = eraWork.projected;
    const pFip = fipWork.projected;
    const pWhip = whipWork.projected;
    const pK9 = k9Work.projected;
    const pBb9 = bb9Work.projected;
    const pHr9 = hr9Work.projected;

    const baseRole: "SP" | "RP" = selectedPitcher.role === "SP" ? "SP" : "RP";
    const projectedRole: "SP" | "RP" = pitchingRoleOverride;
    const roleCurve = {
      tier1Max: eq.rp_to_sp_low_better_tier1_max,
      tier2Max: eq.rp_to_sp_low_better_tier2_max,
      tier3Max: eq.rp_to_sp_low_better_tier3_max,
      tier1Mult: eq.rp_to_sp_low_better_tier1_mult,
      tier2Mult: eq.rp_to_sp_low_better_tier2_mult,
      tier3Mult: eq.rp_to_sp_low_better_tier3_mult,
    };
    const roleAdjustedEra = applyRoleTransitionAdjustment(pEra, eq.sp_to_rp_reg_era_pct, baseRole, projectedRole, true, roleCurve);
    const roleAdjustedFip = applyRoleTransitionAdjustment(pFip, eq.sp_to_rp_reg_fip_pct, baseRole, projectedRole, true, roleCurve);
    const roleAdjustedWhip = applyRoleTransitionAdjustment(pWhip, eq.sp_to_rp_reg_whip_pct, baseRole, projectedRole, true, roleCurve);
    const roleAdjustedK9 = applyRoleTransitionAdjustment(pK9, eq.sp_to_rp_reg_k9_pct, baseRole, projectedRole, false, roleCurve);
    const roleAdjustedBb9 = applyRoleTransitionAdjustment(pBb9, eq.sp_to_rp_reg_bb9_pct, baseRole, projectedRole, true, roleCurve);
    const roleAdjustedHr9 = applyRoleTransitionAdjustment(pHr9, eq.sp_to_rp_reg_hr9_pct, baseRole, projectedRole, true, roleCurve);

    const pEraPlus = calcPitchingPlus(roleAdjustedEra, eq.era_plus_ncaa_avg, eq.era_plus_ncaa_sd, eq.era_plus_scale, false);
    const pFipPlus = calcPitchingPlus(roleAdjustedFip, eq.fip_plus_ncaa_avg, eq.fip_plus_ncaa_sd, eq.fip_plus_scale, false);
    const pWhipPlus = calcPitchingPlus(roleAdjustedWhip, eq.whip_plus_ncaa_avg, eq.whip_plus_ncaa_sd, eq.whip_plus_scale, false);
    const pK9Plus = calcPitchingPlus(roleAdjustedK9, eq.k9_plus_ncaa_avg, eq.k9_plus_ncaa_sd, eq.k9_plus_scale, true);
    const pBb9Plus = calcPitchingPlus(roleAdjustedBb9, eq.bb9_plus_ncaa_avg, eq.bb9_plus_ncaa_sd, eq.bb9_plus_scale, false);
    const pHr9Plus = calcPitchingPlus(roleAdjustedHr9, eq.hr9_plus_ncaa_avg, eq.hr9_plus_ncaa_sd, eq.hr9_plus_scale, false);
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
      sec: eq.market_tier_sec,
      p4: eq.market_tier_acc_big12,
      bigTen: eq.market_tier_big_ten,
      strongMid: eq.market_tier_strong_mid,
      lowMajor: eq.market_tier_low_major,
    };
    const ptm = getProgramTierMultiplierByConference(toPitchConference, pitchingTierMultipliers);
    const pvm = getPitchingPvfForRole(projectedRole, eq);
    const marketEligible = canShowPitchingMarketValue(selectedDestinationTeam || null, toPitchConference);
    const marketValue = !marketEligible || pWar == null ? null : pWar * eq.market_dollars_per_war * ptm * pvm;

    return {
      blocked: false,
      missingInputs: [],
      pEra: roleAdjustedEra, pFip: roleAdjustedFip, pWhip: roleAdjustedWhip, pK9: roleAdjustedK9, pBb9: roleAdjustedBb9, pHr9: roleAdjustedHr9, pRvPlus, pWar, marketValue, projectedRole,
      fromConference: fromPitchConference,
      toConference: toPitchConference,
      fromEraPlus, toEraPlus, fromFipPlus, toFipPlus, fromWhipPlus, toWhipPlus,
      fromK9Plus, toK9Plus, fromBb9Plus, toBb9Plus, fromHr9Plus, toHr9Plus,
      fromHitterTalent, toHitterTalent,
      fromEraParkRaw, toEraParkRaw, fromWhipParkRaw, toWhipParkRaw, fromHr9ParkRaw, toHr9ParkRaw,
      weights: {
        eraPower: eq.transfer_era_power_weight,
        eraConference: eq.transfer_era_conference_weight,
        eraCompetition: eq.transfer_era_competition_weight,
        eraPark: eq.transfer_era_park_weight,
        fipPower: eq.transfer_fip_power_weight,
        fipConference: eq.transfer_fip_conference_weight,
        fipCompetition: eq.transfer_fip_competition_weight,
        fipPark: eq.transfer_fip_park_weight,
        whipPower: eq.transfer_whip_power_weight,
        whipConference: eq.transfer_whip_conference_weight,
        whipCompetition: eq.transfer_whip_competition_weight,
        whipPark: eq.transfer_whip_park_weight,
        k9Power: eq.transfer_k9_power_weight,
        k9Conference: eq.transfer_k9_conference_weight,
        k9Competition: eq.transfer_k9_competition_weight,
        bb9Power: eq.transfer_bb9_power_weight,
        bb9Conference: eq.transfer_bb9_conference_weight,
        bb9Competition: eq.transfer_bb9_competition_weight,
        hr9Power: eq.transfer_hr9_power_weight,
        hr9Conference: eq.transfer_hr9_conference_weight,
        hr9Competition: eq.transfer_hr9_competition_weight,
        hr9Park: eq.transfer_hr9_park_weight,
      },
      showWork: {
        era: { last: selectedPitcher.era!, powerAdj: eraWork.powerAdj, blended: eraWork.blended, mult: eraWork.mult, projected: eraWork.projected, roleAdjusted: roleAdjustedEra, confTerm: eraWork.confTerm, compTerm: eraWork.compTerm, parkTerm: eraWork.parkTerm, powerRatingPlus: eraPr, powerRatingStdDev: eq.era_pr_sd, ncaaStatStdDev: eq.era_plus_ncaa_sd, ncaaAvg: eq.era_plus_ncaa_avg },
        fip: { last: selectedPitcher.fip!, powerAdj: fipWork.powerAdj, blended: fipWork.blended, mult: fipWork.mult, projected: fipWork.projected, roleAdjusted: roleAdjustedFip, confTerm: fipWork.confTerm, compTerm: fipWork.compTerm, parkTerm: fipWork.parkTerm, powerRatingPlus: fipPr, powerRatingStdDev: eq.fip_pr_sd, ncaaStatStdDev: eq.fip_plus_ncaa_sd, ncaaAvg: eq.fip_plus_ncaa_avg },
        whip: { last: selectedPitcher.whip!, powerAdj: whipWork.powerAdj, blended: whipWork.blended, mult: whipWork.mult, projected: whipWork.projected, roleAdjusted: roleAdjustedWhip, confTerm: whipWork.confTerm, compTerm: whipWork.compTerm, parkTerm: whipWork.parkTerm, powerRatingPlus: whipPr, powerRatingStdDev: eq.whip_pr_sd, ncaaStatStdDev: eq.whip_plus_ncaa_sd, ncaaAvg: eq.whip_plus_ncaa_avg },
        k9: { last: selectedPitcher.k9!, powerAdj: k9Work.powerAdj, blended: k9Work.blended, mult: k9Work.mult, projected: k9Work.projected, roleAdjusted: roleAdjustedK9, confTerm: k9Work.confTerm, compTerm: k9Work.compTerm, parkTerm: k9Work.parkTerm, powerRatingPlus: k9Pr, powerRatingStdDev: eq.k9_pr_sd, ncaaStatStdDev: eq.k9_plus_ncaa_sd, ncaaAvg: eq.k9_plus_ncaa_avg },
        bb9: { last: selectedPitcher.bb9!, powerAdj: bb9Work.powerAdj, blended: bb9Work.blended, mult: bb9Work.mult, projected: bb9Work.projected, roleAdjusted: roleAdjustedBb9, confTerm: bb9Work.confTerm, compTerm: bb9Work.compTerm, parkTerm: bb9Work.parkTerm, powerRatingPlus: bb9Pr, powerRatingStdDev: eq.bb9_pr_sd, ncaaStatStdDev: eq.bb9_plus_ncaa_sd, ncaaAvg: eq.bb9_plus_ncaa_avg },
        hr9: { last: selectedPitcher.hr9!, powerAdj: hr9Work.powerAdj, blended: hr9Work.blended, mult: hr9Work.mult, projected: hr9Work.projected, roleAdjusted: roleAdjustedHr9, confTerm: hr9Work.confTerm, compTerm: hr9Work.compTerm, parkTerm: hr9Work.parkTerm, powerRatingPlus: hr9Pr, powerRatingStdDev: eq.hr9_pr_sd, ncaaStatStdDev: eq.hr9_plus_ncaa_sd, ncaaAvg: eq.hr9_plus_ncaa_avg },
      },
    };
  }, [selectedPitcher, selectedPitcherPower, selectedDestinationTeam, teamByKey, teamParkComponents, pitchingConfByKey, pitchingRoleOverride, teams]);

  const addToTargetBoard = () => {
    if (!selectedPlayer || !selectedDestinationTeam) return;
    const entry: TargetBoardEntry = {
      playerId: selectedPlayer.player_id,
      playerName: `${selectedPlayer.first_name} ${selectedPlayer.last_name}`,
      destinationTeam: selectedDestinationTeam,
      fromTeam: fromTeam || null,
      fromConference: fromConference || null,
      pAvg: simulation?.pAvg ?? null,
      pObp: simulation?.pObp ?? null,
      pSlg: simulation?.pSlg ?? null,
      pWrcPlus: simulation?.pWrcPlus ?? null,
      owar: simulation?.owar ?? null,
      nilValuation: simulation?.nilValuation ?? null,
      createdAt: new Date().toISOString(),
    };
    try {
      const raw = localStorage.getItem(TARGET_BOARD_STORAGE_KEY);
      const list = raw ? (JSON.parse(raw) as TargetBoardEntry[]) : [];
      const deduped = list.filter(
        (r) =>
          !(
            r.playerId === entry.playerId &&
            normalizeKey(r.destinationTeam) === normalizeKey(entry.destinationTeam)
          ),
      );
      deduped.push(entry);
      localStorage.setItem(TARGET_BOARD_STORAGE_KEY, JSON.stringify(deduped));
      toast({
        title: "Added to Target Board",
        description: `${entry.playerName} -> ${entry.destinationTeam}`,
      });
    } catch (e: any) {
      toast({
        title: "Could not add target",
        description: e?.message || "Local storage write failed.",
        variant: "destructive",
      });
    }
  };

  const addPitcherToTargetBoard = () => {
    if (!selectedPitcher || !selectedDestinationTeam || pitchingSimulation?.blocked) return;
    const entry: TargetBoardEntry = {
      playerId: selectedPitcher.id,
      playerName: selectedPitcher.player_name,
      destinationTeam: selectedDestinationTeam,
      fromTeam: selectedPitcher.team || null,
      fromConference: pitchingSimulation?.fromConference || null,
      pitcherRole: pitchingSimulation?.projectedRole ?? (selectedPitcher.role === "SP" ? "SP" : "RP"),
      pAvg: null,
      pObp: null,
      pSlg: null,
      pWrcPlus: pitchingSimulation?.pRvPlus ?? null,
      pEra: pitchingSimulation?.pEra ?? null,
      pFip: pitchingSimulation?.pFip ?? null,
      pWhip: pitchingSimulation?.pWhip ?? null,
      pK9: pitchingSimulation?.pK9 ?? null,
      pBb9: pitchingSimulation?.pBb9 ?? null,
      pHr9: pitchingSimulation?.pHr9 ?? null,
      pRvPlus: pitchingSimulation?.pRvPlus ?? null,
      pWar: pitchingSimulation?.pWar ?? null,
      owar: pitchingSimulation?.pWar ?? null,
      nilValuation: pitchingSimulation?.marketValue ?? null,
      createdAt: new Date().toISOString(),
    };
    try {
      const raw = localStorage.getItem(TARGET_BOARD_STORAGE_KEY);
      const list = raw ? (JSON.parse(raw) as TargetBoardEntry[]) : [];
      const deduped = list.filter(
        (r) =>
          !(
            r.playerId === entry.playerId &&
            normalizeKey(r.destinationTeam) === normalizeKey(entry.destinationTeam)
          ),
      );
      deduped.push(entry);
      localStorage.setItem(TARGET_BOARD_STORAGE_KEY, JSON.stringify(deduped));
      toast({
        title: "Added to Target Board",
        description: `${entry.playerName} -> ${entry.destinationTeam}`,
      });
    } catch (e: any) {
      toast({
        title: "Could not add target",
        description: e?.message || "Local storage write failed.",
        variant: "destructive",
      });
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Transfer Portal</h2>
          <div className="mt-3 inline-flex rounded-md border p-1">
            <Button
              size="sm"
              variant={simType === "hitting" ? "default" : "ghost"}
              onClick={() => setSimType("hitting")}
            >
              Hitting
            </Button>
            <Button
              size="sm"
              variant={simType === "pitching" ? "default" : "ghost"}
              onClick={() => setSimType("pitching")}
            >
              Pitching
            </Button>
          </div>
        </div>

        {simType === "hitting" && (
          <>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Transfer Simulator</CardTitle>
            <CardDescription>Select a player and destination school.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Player</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={playerSearch}
                  onChange={(e) => setPlayerSearch(e.target.value)}
                  className="pl-8"
                  placeholder={playersLoading ? "Loading players..." : "Search player by name/team/position"}
                />
              </div>
              <div className="max-h-56 overflow-auto rounded-md border">
                {filteredPlayers.length === 0 ? (
                  <div className="p-2 text-sm text-muted-foreground">No players found.</div>
                ) : (
                  filteredPlayers.map((p) => {
                    const isActive = p.player_id === selectedPlayerId;
                    return (
                      <button
                        key={p.player_id}
                        type="button"
                        onClick={() => {
                          setSelectedPlayerId(p.player_id);
                          setPlayerSearch(`${p.first_name} ${p.last_name}`);
                        }}
                        className={`w-full px-3 py-2 text-left text-sm hover:bg-muted ${
                          isActive ? "bg-muted font-medium" : ""
                        }`}
                      >
                        <div>{p.first_name} {p.last_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {[p.position, p.from_team || p.team].filter(Boolean).join(" · ") || "-"}
                        </div>
                        <div className="text-xs font-mono text-muted-foreground">
                          {`${stat(p.from_avg)}/${stat(p.from_obp)}/${stat(p.from_slg)}`}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Destination School</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={teamSearch}
                  onChange={(e) => setTeamSearch(e.target.value)}
                  className="pl-8"
                  placeholder="Search destination team"
                />
              </div>
              <div className="max-h-56 overflow-auto rounded-md border">
                {filteredTeams.length === 0 ? (
                  <div className="p-2 text-sm text-muted-foreground">No teams found.</div>
                ) : (
                  filteredTeams.map((t) => {
                    const isActive = t.name === selectedDestinationTeam;
                    return (
                      <button
                        key={t.name}
                        type="button"
                        onClick={() => {
                          setSelectedDestinationTeam(t.name);
                          setTeamSearch(t.name);
                        }}
                        className={`w-full px-3 py-2 text-left text-sm hover:bg-muted ${
                          isActive ? "bg-muted font-medium" : ""
                        }`}
                      >
                        <div>{t.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {t.conference || "-"}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
            <div className="md:col-span-2 flex justify-end">
              <Button
                onClick={addToTargetBoard}
                disabled={!selectedPlayer || !selectedDestinationTeam || !!simulation?.blocked}
              >
                Add To Target Board
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base">Projected Outcomes</CardTitle>
              {selectedPlayer && simulation && !simulation.blocked && (
                <Button asChild variant="outline" size="sm">
                  <Link
                    to={profileRouteFor(selectedPlayer.player_id, selectedPlayer.position)}
                    state={{ returnTo: `${location.pathname}${location.search}${location.hash}` }}
                  >
                    View Player Page
                  </Link>
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {simulation?.blocked && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                Equation stopped. Missing inputs: {simulation.missingInputs.join(", ")}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className={`rounded-lg border p-4 shadow-sm ${tierStyle(statTier("avg", simulation?.pAvg))}`}>
                <div className="text-xs font-medium tracking-wide">pAVG</div>
                <div className="mt-1 font-mono text-2xl font-semibold">{simulation ? stat(simulation.pAvg) : "-"}</div>
              </div>
              <div className={`rounded-lg border p-4 shadow-sm ${tierStyle(statTier("obp", simulation?.pObp))}`}>
                <div className="text-xs font-medium tracking-wide">pOBP</div>
                <div className="mt-1 font-mono text-2xl font-semibold">{simulation ? stat(simulation.pObp) : "-"}</div>
              </div>
              <div className={`rounded-lg border p-4 shadow-sm ${tierStyle(statTier("slg", simulation?.pSlg))}`}>
                <div className="text-xs font-medium tracking-wide">pSLG</div>
                <div className="mt-1 font-mono text-2xl font-semibold">{simulation ? stat(simulation.pSlg) : "-"}</div>
              </div>
              <div className={`rounded-lg border p-4 shadow-sm ${tierStyle(statTier("ops", simulation?.pOps))}`}>
                <div className="text-xs font-medium tracking-wide">pOPS</div>
                <div className="mt-1 font-mono text-2xl font-semibold">{simulation ? stat(simulation.pOps) : "-"}</div>
              </div>
              <div className={`rounded-lg border p-4 shadow-sm ${tierStyle(statTier("iso", simulation?.pIso))}`}>
                <div className="text-xs font-medium tracking-wide">pISO</div>
                <div className="mt-1 font-mono text-2xl font-semibold">{simulation ? stat(simulation.pIso) : "-"}</div>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className={`rounded-lg border p-4 shadow-sm ${tierStyle(statTier("wrc_plus", simulation?.pWrcPlus))}`}>
                <div className="text-xs font-medium tracking-wide">pWRC+</div>
                <div className="mt-1 font-mono text-2xl font-semibold">{simulation ? whole(simulation.pWrcPlus) : "-"}</div>
              </div>
              <div className={`rounded-lg border p-4 shadow-sm ${tierStyle(statTier("owar", simulation?.owar))}`}>
                <div className="text-xs font-medium tracking-wide">oWAR</div>
                <div className="mt-1 font-mono text-3xl font-bold">{simulation ? stat(simulation.owar, 2) : "-"}</div>
              </div>
              <div className="rounded-lg border border-accent/40 bg-accent/12 p-4 shadow-sm">
                <div className="text-xs font-medium tracking-wide text-accent-foreground">Market Value</div>
                <div className="mt-1 font-mono text-4xl font-extrabold text-foreground">{simulation ? money(simulation.nilValuation) : "-"}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Context</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 text-sm">
            <div><span className="text-muted-foreground">From Team:</span> {fromTeam || "-"}</div>
            <div><span className="text-muted-foreground">From Conference:</span> {fromConference || "-"}</div>
            <div><span className="text-muted-foreground">To Team:</span> {selectedDestinationTeam || "-"}</div>
            <div><span className="text-muted-foreground">To Conference:</span> {toConference || "-"}</div>
            <div>
              <span className="text-muted-foreground">From Park Factor (AVG/OBP/ISO):</span>{" "}
              {simulation
                ? `${formatPark(simulation.fromParkRaw)} / ${formatPark(simulation.fromObpParkRaw)} / ${formatPark(simulation.fromIsoParkRaw)}`
                : "-"}
            </div>
            <div>
              <span className="text-muted-foreground">To Park Factor (AVG/OBP/ISO):</span>{" "}
              {simulation
                ? `${formatPark(simulation.toParkRaw)} / ${formatPark(simulation.toObpParkRaw)} / ${formatPark(simulation.toIsoParkRaw)}`
                : "-"}
            </div>
            <div><span className="text-muted-foreground">From Stuff+:</span> {simulation ? whole(simulation.fromStuff) : "-"}</div>
            <div><span className="text-muted-foreground">To Stuff+:</span> {simulation ? whole(simulation.toStuff) : "-"}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Multipliers Used</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <div><span className="text-muted-foreground">AVG+ Delta:</span> {simulation ? `${whole(simulation.fromAvgPlus)} -> ${whole(simulation.toAvgPlus)}` : "-"}</div>
            <div><span className="text-muted-foreground">OBP+ Delta:</span> {simulation ? `${whole(simulation.fromObpPlus)} -> ${whole(simulation.toObpPlus)}` : "-"}</div>
            <div><span className="text-muted-foreground">ISO+ Delta:</span> {simulation ? `${whole(simulation.fromIsoPlus)} -> ${whole(simulation.toIsoPlus)}` : "-"}</div>
            <div><span className="text-muted-foreground">NIL PTM/PVM:</span> {simulation && simulation.ptm != null && simulation.pvm != null ? `${simulation.ptm.toFixed(2)} / ${simulation.pvm.toFixed(2)}` : "-"}</div>
          </CardContent>
        </Card>

        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Show Work</CardTitle>
              <CardDescription>Uses the live Context + Multipliers values above for pAVG/pOBP/pISO.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm font-mono">
              {!simulation || simulation.blocked || !simulation.baWork ? (
                <div className="text-muted-foreground">Select player + destination with all required inputs.</div>
              ) : (
                <>
                  <div className="font-semibold">pAVG</div>
                  <div>LastStat = {stat(simulation.baWork.lastStat)}</div>
                  <div>PowerAdj = {stat(simulation.baWork.ncaaAvgBA)} + ((({stat(simulation.baWork.baPR, 2)} - 100) / {stat(simulation.baWork.baStdPower, 3)}) × {stat(simulation.baWork.baStdNcaa, 5)}) = {stat(simulation.baWork.powerAdj)}</div>
                  <div>Blended = ({stat(simulation.baWork.lastStat)} × (1 - {stat(simulation.baWork.baPowerWeight, 2)})) + ({stat(simulation.baWork.powerAdj)} × {stat(simulation.baWork.baPowerWeight, 2)}) = {stat(simulation.baWork.blended)}</div>
                  <div>Multiplier = 1 + ({stat(simulation.baWork.baConferenceWeight, 2)} × (({whole(simulation.baWork.toAvgPlus)} - {whole(simulation.baWork.fromAvgPlus)}) / 100)) - ({stat(simulation.baWork.baPitchingWeight, 2)} × (({whole(simulation.baWork.toStuff)} - {whole(simulation.baWork.fromStuff)}) / 100)) + ({stat(simulation.baWork.baParkWeight, 2)} × ((ToAVGParkFactor {whole(simulation.baWork.toPark)} - FromAVGParkFactor {whole(simulation.baWork.fromPark)}) / 100)) = {stat(simulation.baWork.multiplier, 4)}</div>
                  <div className="font-semibold">ProjectedBA = {stat(simulation.baWork.blended)} × {stat(simulation.baWork.multiplier, 4)} = {stat(simulation.pAvg)}</div>
                  <div className="pt-2 font-semibold">pOBP</div>
                  <div>LastStat = {stat(simulation.obpWork.lastStat)}</div>
                  <div>PowerAdj = {stat(simulation.obpWork.ncaaAvgOBP)} + ((({stat(simulation.obpWork.obpPR, 2)} - 100) / {stat(simulation.obpWork.obpStdPower, 3)}) × {stat(simulation.obpWork.obpStdNcaa, 5)}) = {stat(simulation.obpWork.powerAdj)}</div>
                  <div>Blended = ({stat(simulation.obpWork.lastStat)} × (1 - {stat(simulation.obpWork.obpPowerWeight, 2)})) + ({stat(simulation.obpWork.powerAdj)} × {stat(simulation.obpWork.obpPowerWeight, 2)}) = {stat(simulation.obpWork.blended)}</div>
                  <div>Multiplier = 1 + ({stat(simulation.obpWork.obpConferenceWeight, 2)} × (({whole(simulation.obpWork.toObpPlus)} - {whole(simulation.obpWork.fromObpPlus)}) / 100)) - ({stat(simulation.obpWork.obpPitchingWeight, 2)} × (({whole(simulation.obpWork.toStuff)} - {whole(simulation.obpWork.fromStuff)}) / 100)) + ({stat(simulation.obpWork.obpParkWeight, 2)} × ((ToOBPParkFactor {whole(simulation.obpWork.toPark)} - FromOBPParkFactor {whole(simulation.obpWork.fromPark)}) / 100)) = {stat(simulation.obpWork.multiplier, 4)}</div>
                  <div className="font-semibold">ProjectedOBP = {stat(simulation.obpWork.blended)} × {stat(simulation.obpWork.multiplier, 4)} = {stat(simulation.pObp)}</div>
                  <div className="pt-2 font-semibold">pISO</div>
                  <div>LastISO = {stat(simulation.isoWork.lastIso)}</div>
                  <div>RatingZ = ({stat(simulation.isoWork.isoPR, 2)} - 100) / {stat(simulation.isoWork.isoStdPower, 3)} = {stat(simulation.isoWork.ratingZ, 4)}</div>
                  <div>PowerAdj = {stat(simulation.isoWork.ncaaAvgISO)} + ({stat(simulation.isoWork.ratingZ, 4)} × {stat(simulation.isoWork.isoStdNcaa, 5)}) = {stat(simulation.isoWork.powerAdj)}</div>
                  <div>Blended = ({stat(simulation.isoWork.lastIso)} × (1 - {stat(simulation.isoWork.isoPowerWeight, 2)})) + ({stat(simulation.isoWork.powerAdj)} × {stat(simulation.isoWork.isoPowerWeight, 2)}) = {stat(simulation.isoWork.blended)}</div>
                  <div>Multiplier = 1 + ({stat(simulation.isoWork.isoConferenceWeight, 2)} × (({whole(simulation.isoWork.toIsoPlus)} - {whole(simulation.isoWork.fromIsoPlus)}) / 100)) - ({stat(simulation.isoWork.isoPitchingWeight, 2)} × (({whole(simulation.isoWork.toStuff)} - {whole(simulation.isoWork.fromStuff)}) / 100)) + ({stat(simulation.isoWork.isoParkWeight, 2)} × ((ToISOParkFactor {whole(simulation.isoWork.toPark)} - FromISOParkFactor {whole(simulation.isoWork.fromPark)}) / 100)) = {stat(simulation.isoWork.multiplier, 4)}</div>
                  <div className="font-semibold">ProjectedISO = {stat(simulation.isoWork.blended)} × {stat(simulation.isoWork.multiplier, 4)} = {stat(simulation.pIso)}</div>
                </>
              )}
            </CardContent>
          </Card>
        )}
          </>
        )}

        {simType === "pitching" && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Transfer Simulator</CardTitle>
                <CardDescription>Select a pitcher and destination school.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Pitcher</Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={pitcherSearch}
                      onChange={(e) => setPitcherSearch(e.target.value)}
                      className="pl-8"
                      placeholder="Search pitcher by name/team/handedness"
                    />
                  </div>
                  <div className="max-h-56 overflow-auto rounded-md border">
                    {filteredPitchers.length === 0 ? (
                      <div className="p-2 text-sm text-muted-foreground">No pitchers found.</div>
                    ) : (
                      filteredPitchers.map((p) => {
                        const isActive = p.id === selectedPitcherId;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              setSelectedPitcherId(p.id);
                              setPitcherSearch(p.player_name);
                              setPitchingRoleOverride(p.role === "SP" ? "SP" : "RP");
                            }}
                            className={`w-full px-3 py-1.5 text-left text-sm hover:bg-muted ${isActive ? "bg-muted font-medium" : ""}`}
                          >
                            <div>{p.player_name}</div>
                            <div className="text-[11px] leading-tight text-muted-foreground">
                              {[p.handedness, p.team].filter(Boolean).join(" · ") || "-"}
                            </div>
                            <div className="text-[11px] leading-tight font-mono text-muted-foreground">
                              {`${stat(p.era, 2)} / ${stat(p.fip, 2)} / ${stat(p.whip, 2)} / ${stat(p.k9, 2)} / ${stat(p.bb9, 2)} / ${stat(p.hr9, 2)}`}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Destination School</Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={teamSearch}
                      onChange={(e) => setTeamSearch(e.target.value)}
                      className="pl-8"
                      placeholder="Search destination team"
                    />
                  </div>
                  <div className="max-h-56 overflow-auto rounded-md border">
                    {filteredTeams.length === 0 ? (
                      <div className="p-2 text-sm text-muted-foreground">No teams found.</div>
                    ) : (
                      filteredTeams.map((t) => {
                        const isActive = t.name === selectedDestinationTeam;
                        return (
                          <button
                            key={t.name}
                            type="button"
                            onClick={() => {
                              setSelectedDestinationTeam(t.name);
                              setTeamSearch(t.name);
                            }}
                            className={`w-full px-3 py-2 text-left text-sm hover:bg-muted ${isActive ? "bg-muted font-medium" : ""}`}
                          >
                            <div>{t.name}</div>
                            <div className="text-xs text-muted-foreground">{t.conference || "-"}</div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
                <div className="md:col-span-2 flex justify-end">
                  <Button
                    onClick={addPitcherToTargetBoard}
                    disabled={!selectedPitcher || !selectedDestinationTeam || !!pitchingSimulation?.blocked}
                  >
                    Add To Target Board
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">Projected Outcomes</CardTitle>
                  <div className="flex items-end gap-2">
                    <div className="w-[220px] space-y-1">
                      <Label className="text-xs text-muted-foreground">Role Change</Label>
                      <Select
                        value={pitchingRoleOverride}
                        onValueChange={(v) => setPitchingRoleOverride(v as "SP" | "RP")}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="SP">SP</SelectItem>
                          <SelectItem value="RP">RP</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {selectedPitcher && pitchingSimulation && !pitchingSimulation.blocked && (
                      <Button asChild variant="outline" size="sm">
                        <Link
                          to={storagePitcherRouteFor(selectedPitcher.player_name, selectedPitcher.team)}
                          state={{ returnTo: `${location.pathname}${location.search}${location.hash}` }}
                        >
                          View Player Page
                        </Link>
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {pitchingSimulation?.blocked && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    Equation stopped. Missing inputs: {pitchingSimulation.missingInputs.join(", ")}
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                  <div className={`rounded-lg border p-4 shadow-sm ${tierStyle(pitchingOutcomeTier("era", pitchingSimulation?.pEra, pitchingEqForTiers))}`}>
                    <div className="text-xs font-medium tracking-wide">pERA</div>
                    <div className="mt-1 font-mono text-2xl font-semibold">{pitchingSimulation ? stat(pitchingSimulation.pEra, 2) : "-"}</div>
                  </div>
                  <div className={`rounded-lg border p-4 shadow-sm ${tierStyle(pitchingOutcomeTier("fip", pitchingSimulation?.pFip, pitchingEqForTiers))}`}>
                    <div className="text-xs font-medium tracking-wide">pFIP</div>
                    <div className="mt-1 font-mono text-2xl font-semibold">{pitchingSimulation ? stat(pitchingSimulation.pFip, 2) : "-"}</div>
                  </div>
                  <div className={`rounded-lg border p-4 shadow-sm ${tierStyle(pitchingOutcomeTier("whip", pitchingSimulation?.pWhip, pitchingEqForTiers))}`}>
                    <div className="text-xs font-medium tracking-wide">pWHIP</div>
                    <div className="mt-1 font-mono text-2xl font-semibold">{pitchingSimulation ? stat(pitchingSimulation.pWhip, 2) : "-"}</div>
                  </div>
                  <div className={`rounded-lg border p-4 shadow-sm ${tierStyle(pitchingOutcomeTier("k9", pitchingSimulation?.pK9, pitchingEqForTiers))}`}>
                    <div className="text-xs font-medium tracking-wide">pK/9</div>
                    <div className="mt-1 font-mono text-2xl font-semibold">{pitchingSimulation ? stat(pitchingSimulation.pK9, 2) : "-"}</div>
                  </div>
                  <div className={`rounded-lg border p-4 shadow-sm ${tierStyle(pitchingOutcomeTier("bb9", pitchingSimulation?.pBb9, pitchingEqForTiers))}`}>
                    <div className="text-xs font-medium tracking-wide">pBB/9</div>
                    <div className="mt-1 font-mono text-2xl font-semibold">{pitchingSimulation ? stat(pitchingSimulation.pBb9, 2) : "-"}</div>
                  </div>
                  <div className={`rounded-lg border p-4 shadow-sm ${tierStyle(pitchingOutcomeTier("hr9", pitchingSimulation?.pHr9, pitchingEqForTiers))}`}>
                    <div className="text-xs font-medium tracking-wide">pHR/9</div>
                    <div className="mt-1 font-mono text-2xl font-semibold">{pitchingSimulation ? stat(pitchingSimulation.pHr9, 2) : "-"}</div>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-lg border p-4 shadow-sm">
                    <div className="text-xs font-medium tracking-wide">pRV+</div>
                    <div className="mt-1 font-mono text-3xl font-bold">{pitchingSimulation ? whole(pitchingSimulation.pRvPlus) : "-"}</div>
                  </div>
                  <div className={`rounded-lg border p-4 shadow-sm ${tierStyle(statTier("owar", pitchingSimulation?.pWar))}`}>
                    <div className="text-xs font-medium tracking-wide">pWAR</div>
                    <div className="mt-1 font-mono text-3xl font-bold">{pitchingSimulation ? stat(pitchingSimulation.pWar, 2) : "-"}</div>
                  </div>
                  <div className="rounded-lg border border-accent/40 bg-accent/12 p-4 shadow-sm">
                    <div className="text-xs font-medium tracking-wide">Market Value</div>
                    <div className="mt-1 font-mono text-3xl font-bold">{pitchingSimulation ? money(pitchingSimulation.marketValue) : "-"}</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Context</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 text-sm">
                <div><span className="text-muted-foreground">From Team:</span> {selectedPitcher?.team || "-"}</div>
                <div><span className="text-muted-foreground">From Conference:</span> {pitchingSimulation?.fromConference || "-"}</div>
                <div><span className="text-muted-foreground">To Team:</span> {selectedDestinationTeam || "-"}</div>
                <div><span className="text-muted-foreground">To Conference:</span> {pitchingSimulation?.toConference || "-"}</div>
                <div><span className="text-muted-foreground">From Park Factor (R/G, WHIP, HR/9):</span> {pitchingSimulation ? `${formatPark(pitchingSimulation.fromEraParkRaw)} / ${formatPark(pitchingSimulation.fromWhipParkRaw)} / ${formatPark(pitchingSimulation.fromHr9ParkRaw)}` : "-"}</div>
                <div><span className="text-muted-foreground">To Park Factor (R/G, WHIP, HR/9):</span> {pitchingSimulation ? `${formatPark(pitchingSimulation.toEraParkRaw)} / ${formatPark(pitchingSimulation.toWhipParkRaw)} / ${formatPark(pitchingSimulation.toHr9ParkRaw)}` : "-"}</div>
                <div><span className="text-muted-foreground">From Hitter Talent+:</span> {pitchingSimulation ? stat(pitchingSimulation.fromHitterTalent, 1) : "-"}</div>
                <div><span className="text-muted-foreground">To Hitter Talent+:</span> {pitchingSimulation ? stat(pitchingSimulation.toHitterTalent, 1) : "-"}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Multipliers Used</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  <div><span className="text-muted-foreground">ERA:</span> {pitchingSimulation ? `${whole(pitchingSimulation.fromEraPlus)} -> ${whole(pitchingSimulation.toEraPlus)}` : "-"}</div>
                  <div><span className="text-muted-foreground">FIP:</span> {pitchingSimulation ? `${whole(pitchingSimulation.fromFipPlus)} -> ${whole(pitchingSimulation.toFipPlus)}` : "-"}</div>
                  <div><span className="text-muted-foreground">WHIP:</span> {pitchingSimulation ? `${whole(pitchingSimulation.fromWhipPlus)} -> ${whole(pitchingSimulation.toWhipPlus)}` : "-"}</div>
                  <div><span className="text-muted-foreground">K/9:</span> {pitchingSimulation ? `${whole(pitchingSimulation.fromK9Plus)} -> ${whole(pitchingSimulation.toK9Plus)}` : "-"}</div>
                  <div><span className="text-muted-foreground">BB/9:</span> {pitchingSimulation ? `${whole(pitchingSimulation.fromBb9Plus)} -> ${whole(pitchingSimulation.toBb9Plus)}` : "-"}</div>
                  <div><span className="text-muted-foreground">HR/9:</span> {pitchingSimulation ? `${whole(pitchingSimulation.fromHr9Plus)} -> ${whole(pitchingSimulation.toHr9Plus)}` : "-"}</div>
                </div>
              </CardContent>
            </Card>

            {isAdmin && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Show Work (Pitching)</CardTitle>
                  <CardDescription>Uses the live Context + Multipliers values above.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {!pitchingSimulation?.showWork ? (
                    <div className="text-muted-foreground">No calculation available.</div>
                  ) : (
                    <div className="rounded-md bg-muted/20 p-3 font-mono text-sm space-y-4">
                      {([
                      { label: "pERA", key: "era", ncaaAvg: "NCAAAvgERA", prSd: "StdDevERAPowerRating+", ncaaSd: "StdDevNCAAERA", fromLabel: "ToERA+", toLabel: "FromERA+", parkLabel: "RGParkFactor", projected: "ProjectedERA", finalLabel: "RoleAdjustedERA", lower: true, hasPark: true },
                      { label: "pFIP", key: "fip", ncaaAvg: "NCAAAvgFIP", prSd: "StdDevFIPPowerRating+", ncaaSd: "StdDevNCAAFIP", fromLabel: "ToFIP+", toLabel: "FromFIP+", parkLabel: "RGParkFactor", projected: "ProjectedFIP", finalLabel: "RoleAdjustedFIP", lower: true, hasPark: true },
                      { label: "pWHIP", key: "whip", ncaaAvg: "NCAAAvgWHIP", prSd: "StdDevWHIPPowerRating+", ncaaSd: "StdDevNCAAWHIP", fromLabel: "ToWHIP+", toLabel: "FromWHIP+", parkLabel: "WHIPParkFactor", projected: "ProjectedWHIP", finalLabel: "RoleAdjustedWHIP", lower: true, hasPark: true },
                      { label: "pK/9", key: "k9", ncaaAvg: "NCAAAvgK/9", prSd: "StdDevK/9PowerRating+", ncaaSd: "StdDevNCAAK/9", fromLabel: "ToK/9+", toLabel: "FromK/9+", parkLabel: "", projected: "ProjectedK/9", finalLabel: "RoleAdjustedK/9", lower: false, hasPark: false },
                      { label: "pBB/9", key: "bb9", ncaaAvg: "NCAAAvgBB/9", prSd: "StdDevBB/9PowerRating+", ncaaSd: "StdDevNCAABB/9", fromLabel: "ToBB/9+", toLabel: "FromBB/9+", parkLabel: "", projected: "ProjectedBB/9", finalLabel: "RoleAdjustedBB/9", lower: true, hasPark: false },
                      { label: "pHR/9", key: "hr9", ncaaAvg: "NCAAAvgHR/9", prSd: "StdDevHR/9PowerRating+", ncaaSd: "StdDevNCAAHR/9", fromLabel: "ToHR/9+", toLabel: "FromHR/9+", parkLabel: "HR/9ParkFactor", projected: "ProjectedHR/9", finalLabel: "RoleAdjustedHR/9", lower: true, hasPark: true },
                    ] as const).map((m) => {
                      const w = pitchingSimulation.showWork?.[m.key];
                      if (!w) return null;
                      const multiplierLine = (() => {
                        if (!pitchingSimulation?.weights) return `Multiplier = ${stat(w.mult, 4)}`;
                        if (m.key === "era") {
                          return `Multiplier = 1 - (${stat(pitchingSimulation.weights.eraConference, 3)} × ((${whole(pitchingSimulation.toEraPlus)} - ${whole(pitchingSimulation.fromEraPlus)}) / 100)) + (${stat(pitchingSimulation.weights.eraCompetition, 3)} × ((${whole(pitchingSimulation.toHitterTalent)} - ${whole(pitchingSimulation.fromHitterTalent)}) / 100)) + (${stat(pitchingSimulation.weights.eraPark, 3)} × ((ToRGParkFactor ${formatPark(pitchingSimulation.toEraParkRaw)} - FromRGParkFactor ${formatPark(pitchingSimulation.fromEraParkRaw)}) / 100)) = ${stat(w.mult, 4)}`;
                        }
                        if (m.key === "fip") {
                          return `Multiplier = 1 - (${stat(pitchingSimulation.weights.fipConference, 3)} × ((${whole(pitchingSimulation.toFipPlus)} - ${whole(pitchingSimulation.fromFipPlus)}) / 100)) + (${stat(pitchingSimulation.weights.fipCompetition, 3)} × ((${whole(pitchingSimulation.toHitterTalent)} - ${whole(pitchingSimulation.fromHitterTalent)}) / 100)) + (${stat(pitchingSimulation.weights.fipPark, 3)} × ((ToRGParkFactor ${formatPark(pitchingSimulation.toEraParkRaw)} - FromRGParkFactor ${formatPark(pitchingSimulation.fromEraParkRaw)}) / 100)) = ${stat(w.mult, 4)}`;
                        }
                        if (m.key === "whip") {
                          return `Multiplier = 1 - (${stat(pitchingSimulation.weights.whipConference, 3)} × ((${whole(pitchingSimulation.toWhipPlus)} - ${whole(pitchingSimulation.fromWhipPlus)}) / 100)) + (${stat(pitchingSimulation.weights.whipCompetition, 3)} × ((${whole(pitchingSimulation.toHitterTalent)} - ${whole(pitchingSimulation.fromHitterTalent)}) / 100)) + (${stat(pitchingSimulation.weights.whipPark, 3)} × ((ToWHIPParkFactor ${formatPark(pitchingSimulation.toWhipParkRaw)} - FromWHIPParkFactor ${formatPark(pitchingSimulation.fromWhipParkRaw)}) / 100)) = ${stat(w.mult, 4)}`;
                        }
                        if (m.key === "k9") {
                          return `Multiplier = 1 + (${stat(pitchingSimulation.weights.k9Conference, 3)} × ((${whole(pitchingSimulation.toK9Plus)} - ${whole(pitchingSimulation.fromK9Plus)}) / 100)) - (${stat(pitchingSimulation.weights.k9Competition, 3)} × ((${whole(pitchingSimulation.toHitterTalent)} - ${whole(pitchingSimulation.fromHitterTalent)}) / 100)) = ${stat(w.mult, 4)}`;
                        }
                        if (m.key === "bb9") {
                          return `Multiplier = 1 - (${stat(pitchingSimulation.weights.bb9Conference, 3)} × ((${whole(pitchingSimulation.toBb9Plus)} - ${whole(pitchingSimulation.fromBb9Plus)}) / 100)) + (${stat(pitchingSimulation.weights.bb9Competition, 3)} × ((${whole(pitchingSimulation.toHitterTalent)} - ${whole(pitchingSimulation.fromHitterTalent)}) / 100)) = ${stat(w.mult, 4)}`;
                        }
                        return `Multiplier = 1 - (${stat(pitchingSimulation.weights.hr9Conference, 3)} × ((${whole(pitchingSimulation.toHr9Plus)} - ${whole(pitchingSimulation.fromHr9Plus)}) / 100)) + (${stat(pitchingSimulation.weights.hr9Competition, 3)} × ((${whole(pitchingSimulation.toHitterTalent)} - ${whole(pitchingSimulation.fromHitterTalent)}) / 100)) + (${stat(pitchingSimulation.weights.hr9Park, 3)} × ((ToHR9ParkFactor ${formatPark(pitchingSimulation.toHr9ParkRaw)} - FromHR9ParkFactor ${formatPark(pitchingSimulation.fromHr9ParkRaw)}) / 100)) = ${stat(w.mult, 4)}`;
                      })();
                      return (
                        <div key={m.key} className="space-y-1">
                          <div className="font-semibold">{m.label}</div>
                          <div>{`LastStat = ${stat(w.last, 2)}`}</div>
                          <div>{`PowerAdj = ${stat(w.ncaaAvg, 3)} ${m.lower ? "-" : "+"} (((${stat(w.powerRatingPlus, 2)} - 100) / ${stat(w.powerRatingStdDev, 3)}) × ${stat(w.ncaaStatStdDev, 6)}) = ${stat(w.powerAdj, 2)}`}</div>
                          <div>{`Blended = (LastStat × (1 - PowerRatingWeight)) + (PowerAdj × PowerRatingWeight) = ${stat(w.blended, 2)}`}</div>
                          <div>{multiplierLine}</div>
                          <div className="font-semibold">{`${m.projected} = ${stat(w.blended, 2)} × ${stat(w.mult, 4)} = ${stat(w.projected, 2)}`}</div>
                          <div className="font-semibold">{`${m.finalLabel} = ${stat(w.roleAdjusted, 2)}`}</div>
                        </div>
                      );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}

      </div>
    </DashboardLayout>
  );
}
