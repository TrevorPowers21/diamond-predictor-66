import { useMemo, useState } from "react";
import { DEMO_SCHOOL } from "@/lib/demoSchool";
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
import { resolveMetricParkFactor } from "@/lib/parkFactors";
import { useParkFactors } from "@/hooks/useParkFactors";
import { computeHitterPowerRatings } from "@/lib/powerRatings";
import { useTeamsTable } from "@/hooks/useTeamsTable";
import { readPitchingWeights } from "@/lib/pitchingEquations";
import { useConferenceStats } from "@/hooks/useConferenceStats";
import { usePitchingSeedData } from "@/hooks/usePitchingSeedData";
import { useTargetBoard } from "@/hooks/useTargetBoard";
import { assessHitterRisk } from "@/lib/playerRisk";
import { RiskAssessmentCardRSTR } from "@/components/RiskAssessmentCard";
import { TRANSFER_WEIGHT_DEFAULTS } from "@/lib/transferWeightDefaults";

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

export default function TransferPortal() {
  const location = useLocation();
  const { toast } = useToast();
  const { hasRole } = useAuth();
  const { hitterStats, powerRatings } = useHitterSeedData();
  const { addPlayer: addToSupabaseBoard, isOnBoard: isOnSupabaseBoard } = useTargetBoard();
  const isAdmin = hasRole("admin");
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>("");
  const [playerSearch, setPlayerSearch] = useState<string>("");
  const [selectedDestinationTeam, setSelectedDestinationTeam] = useState<string>(DEMO_SCHOOL.name);
  const [teamSearch, setTeamSearch] = useState<string>(DEMO_SCHOOL.name);
  const [simType, setSimType] = useState<"hitting" | "pitching">("hitting");
  const [selectedPitcherId, setSelectedPitcherId] = useState<string>("");
  const [pitcherSearch, setPitcherSearch] = useState<string>("");
  const [pitchingRoleOverride, setPitchingRoleOverride] = useState<"SP" | "RP">("RP");
  const pitchingEqForTiers = useMemo(() => readPitchingWeights(), []);
  const { conferenceStats: newConfStats } = useConferenceStats(2025);

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

  const { teams } = useTeamsTable();

  const conferenceStats: ConferenceRow[] = useMemo(() => {
    const byConf = new Map<string, { row: ConferenceRow; score: number }>();
    for (const raw of newConfStats) {
      const key = normalizeKey(raw.conference);
      if (!key) continue;
      const row: ConferenceRow = {
        conference: raw.conference,
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
      };
    }).filter((r) => !!r.player_name);
  }, [pitchingMasterRows]);

  const selectedPitcher = useMemo(
    () => pitchingPlayers.find((p) => p.id === selectedPitcherId) || null,
    [pitchingPlayers, selectedPitcherId],
  );

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
      const snapshot: PitchingPowerSnapshot = {
        eraPrPlus: eraPr,
        fipPrPlus: fipPr,
        whipPrPlus: whipPr,
        k9PrPlus: k9Pr,
        hr9PrPlus: hr9Pr,
        bb9PrPlus: bb9Pr,
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

  // PA lookup by player UUID for risk assessment sample size
  const { data: hitterPaMap = new Map<string, number>() } = useQuery({
    queryKey: ["transfer-portal-pa-lookup"],
    queryFn: async () => {
      const map = new Map<string, number>();
      const { data: hmRows } = await (supabase as any)
        .from("Hitter Master")
        .select("source_player_id, pa, ab")
        .eq("Season", 2025)
        .gt("ab", 0);
      const sourceIdToPa = new Map<string, number>();
      for (const r of (hmRows || [])) {
        const pa = r.pa ?? r.ab ?? null;
        if (pa != null && r.source_player_id) sourceIdToPa.set(r.source_player_id, pa);
      }
      const { data: playerRows } = await supabase
        .from("players")
        .select("id, source_player_id");
      for (const p of (playerRows || [])) {
        if (p.source_player_id && sourceIdToPa.has(p.source_player_id)) {
          map.set(p.id, sourceIdToPa.get(p.source_player_id)!);
        }
      }
      return map;
    },
    staleTime: 30 * 60 * 1000,
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
  const fromTeamRow = resolveTeamRowFromCandidates([fromTeam], teamByKey, teams);
  const toTeamRow = resolveTeamRowFromCandidates([selectedDestinationTeam], teamByKey, teams);

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

  const resolvePitchingConferenceStats = (conference: string | null | undefined, conferenceId?: string | null) => {
    // UUID lookup first
    const byId = (pitchingConfByKey as any)?._byId as Map<string, any> | undefined;
    if (conferenceId && byId?.has(conferenceId)) return byId.get(conferenceId)!;
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
    if (!selectedPlayer || !toTeamRow) return null;

    const missingInputs: string[] = [];
    const lastAvg = selectedPlayer.from_avg;
    const lastObp = selectedPlayer.from_obp;
    const lastSlg = selectedPlayer.from_slg;
    if (lastAvg == null) missingInputs.push("Last AVG");
    if (lastObp == null) missingInputs.push("Last OBP");
    if (lastSlg == null) missingInputs.push("Last SLG");

    // Use stat-specific power rating+ from internals first, then compute from seed data
    let baPR = internals?.avg_power_rating ?? null;
    let obpPR = internals?.obp_power_rating ?? null;
    let isoPR = internals?.slg_power_rating ?? null;

    if (baPR == null || obpPR == null || isoPR == null) {
      const fullName = `${selectedPlayer.first_name} ${selectedPlayer.last_name}`;
      const nameTeamKey = `${normalizeKey(fullName)}|${normalizeKey(fromTeam)}`;
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

    const fromParkAvgRaw = resolveMetricParkFactor(fromTeamRow?.id, "avg", teamParkComponents, fromTeamRow?.name);
    const toParkAvgRaw = resolveMetricParkFactor(toTeamRow?.id, "avg", teamParkComponents, toTeamRow?.name);
    const fromParkObpRaw = resolveMetricParkFactor(fromTeamRow?.id, "obp", teamParkComponents, fromTeamRow?.name);
    const toParkObpRaw = resolveMetricParkFactor(toTeamRow?.id, "obp", teamParkComponents, toTeamRow?.name);
    const fromParkIsoRaw = resolveMetricParkFactor(fromTeamRow?.id, "iso", teamParkComponents, fromTeamRow?.name);
    const toParkIsoRaw = resolveMetricParkFactor(toTeamRow?.id, "iso", teamParkComponents, toTeamRow?.name);
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

    const baConferenceWeight = toWeight(readLocalNum("t_ba_conference_weight", TRANSFER_WEIGHT_DEFAULTS.t_ba_conference_weight, remoteEquationValues));
    const obpConferenceWeight = toWeight(readLocalNum("t_obp_conference_weight", TRANSFER_WEIGHT_DEFAULTS.t_obp_conference_weight, remoteEquationValues));
    const isoConferenceWeight = toWeight(readLocalNum("t_iso_conference_weight", TRANSFER_WEIGHT_DEFAULTS.t_iso_conference_weight, remoteEquationValues));

    const baPitchingWeight = toWeight(readLocalNum("t_ba_pitching_weight", TRANSFER_WEIGHT_DEFAULTS.t_ba_pitching_weight, remoteEquationValues));
    const obpPitchingWeight = toWeight(readLocalNum("t_obp_pitching_weight", TRANSFER_WEIGHT_DEFAULTS.t_obp_pitching_weight, remoteEquationValues));
    const isoPitchingWeight = toWeight(readLocalNum("t_iso_pitching_weight", TRANSFER_WEIGHT_DEFAULTS.t_iso_pitching_weight, remoteEquationValues));

    const baParkWeight = toWeight(readLocalNum("t_ba_park_weight", TRANSFER_WEIGHT_DEFAULTS.t_ba_park_weight, remoteEquationValues));
    const obpParkWeight = toWeight(readLocalNum("t_obp_park_weight", TRANSFER_WEIGHT_DEFAULTS.t_obp_park_weight, remoteEquationValues));
    const isoParkWeight = toWeight(readLocalNum("t_iso_park_weight", TRANSFER_WEIGHT_DEFAULTS.t_iso_park_weight, remoteEquationValues));

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
  }, [selectedPlayer, toTeamRow, internals, fromConfStats, toConfStats, fromTeamRow, toConference, remoteEquationValues, teamParkComponents, powerByNameTeam]);

  const pitchingSimulation = useMemo<PitchingSim | null>(() => {
    if (!selectedPitcher || !selectedDestinationTeam) return null;
    const eq = readPitchingWeights();
    const toPitchTeamRow = resolveTeamRowFromCandidates([selectedDestinationTeam], teamByKey, teams);
    if (!toPitchTeamRow) return null;
    // Resolve from-team by UUID first, then name fallback
    const fromPitchTeamRow = selectedPitcher.teamId
      ? (teams.find((t) => t.id === selectedPitcher.teamId) ?? resolveTeamRowFromCandidates([selectedPitcher.team], teamByKey, teams))
      : resolveTeamRowFromCandidates([selectedPitcher.team], teamByKey, teams);
    const fromPitchConference = selectedPitcher.conference || fromPitchTeamRow?.conference || null;
    const toPitchConference = toPitchTeamRow?.conference || null;
    const fromPitchConfStats = resolvePitchingConferenceStats(fromPitchConference, selectedPitcher.conferenceId);
    const toPitchConfStats = resolvePitchingConferenceStats(toPitchConference, toPitchTeamRow?.conference_id);


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
    const fromEraParkRaw = resolveParkFactorFromCandidates(fromPitchTeamRow?.id, [selectedPitcher.team, fromPitchTeamRow?.name], "era", teamParkComponents);
    const toEraParkRaw = resolveParkFactorFromCandidates(toPitchTeamRow?.id, [selectedDestinationTeam, toPitchTeamRow?.name], "era", teamParkComponents);
    const fromWhipParkRaw = resolveParkFactorFromCandidates(fromPitchTeamRow?.id, [selectedPitcher.team, fromPitchTeamRow?.name], "whip", teamParkComponents);
    const toWhipParkRaw = resolveParkFactorFromCandidates(toPitchTeamRow?.id, [selectedDestinationTeam, toPitchTeamRow?.name], "whip", teamParkComponents);
    const fromHr9ParkRaw = resolveParkFactorFromCandidates(fromPitchTeamRow?.id, [selectedPitcher.team, fromPitchTeamRow?.name], "hr9", teamParkComponents);
    const toHr9ParkRaw = resolveParkFactorFromCandidates(toPitchTeamRow?.id, [selectedDestinationTeam, toPitchTeamRow?.name], "hr9", teamParkComponents);
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

  const addPitcherToTargetBoard = () => {
    if (!selectedPitcher || !selectedDestinationTeam || pitchingSimulation?.blocked) return;
    const playerId = selectedPitcher.id;
    if (playerId && !isOnSupabaseBoard(playerId)) {
      addToSupabaseBoard({ playerId });
    }
    toast({
      title: "Added to Target Board",
      description: `${selectedPitcher.player_name} -> ${selectedDestinationTeam}`,
      });
    } catch (e: any) {
      toast({
        title: "Could not add target",
        description: e?.message || "Local storage write failed.",
        variant: "destructive",
      });
    }
  };

  const [playerDropdownOpen, setPlayerDropdownOpen] = useState(false);
  const [teamDropdownOpen, setTeamDropdownOpen] = useState(false);
  const [pitcherDropdownOpen, setPitcherDropdownOpen] = useState(false);

  return (
    <DashboardLayout>
      <div className="space-y-4 max-w-[1400px] mx-auto">
        {/* ─── Header ─── */}
        <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Transfer Portal</h2>
            <p className="text-muted-foreground text-sm">Simulate player projections at a new school.</p>
          </div>
          <div className="flex gap-1 rounded-lg border bg-muted p-1">
            <button className={`px-4 py-1.5 text-sm rounded-md font-medium transition-colors ${simType === "hitting" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`} onClick={() => setSimType("hitting")}>Hitting</button>
            <button className={`px-4 py-1.5 text-sm rounded-md font-medium transition-colors ${simType === "pitching" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`} onClick={() => setSimType("pitching")}>Pitching</button>
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
                    <Input placeholder={playersLoading ? "Loading..." : "Search hitter..."} value={playerSearch} onChange={(e) => { setPlayerSearch(e.target.value); setPlayerDropdownOpen(true); }} onFocus={() => setPlayerDropdownOpen(true)} onBlur={() => setTimeout(() => setPlayerDropdownOpen(false), 150)} />
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
              const sp = powerByNameTeam.get(spKey) ?? powerByNameTeam.get(normalizeKey(fullName)) ?? null;
              const toConfRow = toConference ? confByKey.get(toConference.toLowerCase().trim()) ?? null : null;

              const resolvedPa = selectedPlayer?.player_id ? (hitterPaMap.get(selectedPlayer.player_id) ?? null) : null;

              const risk = assessHitterRisk({
                conference: toConference,
                projectedWrcPlus: simulation.pWrcPlus,
                confStuffPlus: toConfRow?.stuff_plus ?? null,
                pa: resolvedPa,
                chase: sp?.chase, contact: sp?.contact,
                barrel: sp?.barrel, lineDrive: sp?.lineDrive,
                avgEv: sp?.avgExitVelo, ev90: sp?.ev90,
                pull: sp?.pull, gb: sp?.gb, bb: sp?.bb,
              });

              return <RiskAssessmentCardRSTR risk={risk} />;
            })()}

            {/* ─── Context (collapsible) ─── */}
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wide text-muted-foreground">Context + Multipliers</summary>
              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1.5 text-xs">
                <div><span className="text-muted-foreground">From:</span> {fromTeam || "-"}</div>
                <div><span className="text-muted-foreground">To:</span> {selectedDestinationTeam || "-"}</div>
                <div><span className="text-muted-foreground">From Conf:</span> {fromConference || "-"}</div>
                <div><span className="text-muted-foreground">To Conf:</span> {toConference || "-"}</div>
                <div><span className="text-muted-foreground">Park (AVG):</span> {simulation ? `${formatPark(simulation.fromParkRaw)} → ${formatPark(simulation.toParkRaw)}` : "-"}</div>
                <div><span className="text-muted-foreground">Park (OBP):</span> {simulation ? `${formatPark(simulation.fromObpParkRaw)} → ${formatPark(simulation.toObpParkRaw)}` : "-"}</div>
                <div><span className="text-muted-foreground">Park (ISO):</span> {simulation ? `${formatPark(simulation.fromIsoParkRaw)} → ${formatPark(simulation.toIsoParkRaw)}` : "-"}</div>
                <div><span className="text-muted-foreground">Stuff+:</span> {simulation ? `${whole(simulation.fromStuff)} → ${whole(simulation.toStuff)}` : "-"}</div>
                <div><span className="text-muted-foreground">AVG+:</span> {simulation ? `${whole(simulation.fromAvgPlus)} → ${whole(simulation.toAvgPlus)}` : "-"}</div>
                <div><span className="text-muted-foreground">OBP+:</span> {simulation ? `${whole(simulation.fromObpPlus)} → ${whole(simulation.toObpPlus)}` : "-"}</div>
                <div><span className="text-muted-foreground">ISO+:</span> {simulation ? `${whole(simulation.fromIsoPlus)} → ${whole(simulation.toIsoPlus)}` : "-"}</div>
                <div><span className="text-muted-foreground">NIL PTM/PVM:</span> {simulation && simulation.ptm != null && simulation.pvm != null ? `${simulation.ptm.toFixed(2)} / ${simulation.pvm.toFixed(2)}` : "-"}</div>
              </div>
            </details>

            {/* ─── Show Work (admin) ─── */}
            {isAdmin && (
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wide text-muted-foreground">Show Work</summary>
                <div className="mt-3 space-y-2 text-sm font-mono">
                  {!simulation || simulation.blocked || !simulation.baWork ? (
                    <div className="text-muted-foreground">Select player + destination with all required inputs.</div>
                  ) : (
                    <>
                      <div className="font-semibold">pAVG</div>
                      <div>LastStat = {stat(simulation.baWork.lastStat)}</div>
                      <div>PowerAdj = {stat(simulation.baWork.ncaaAvgBA)} + ((({stat(simulation.baWork.baPR, 2)} - 100) / {stat(simulation.baWork.baStdPower, 3)}) x {stat(simulation.baWork.baStdNcaa, 5)}) = {stat(simulation.baWork.powerAdj)}</div>
                      <div>Blended = ({stat(simulation.baWork.lastStat)} x (1 - {stat(simulation.baWork.baPowerWeight, 2)})) + ({stat(simulation.baWork.powerAdj)} x {stat(simulation.baWork.baPowerWeight, 2)}) = {stat(simulation.baWork.blended)}</div>
                      <div>Multiplier = {stat(simulation.baWork.multiplier, 4)}</div>
                      <div className="font-semibold">ProjectedBA = {stat(simulation.baWork.blended)} x {stat(simulation.baWork.multiplier, 4)} = {stat(simulation.pAvg)}</div>
                      <div className="pt-2 font-semibold">pOBP</div>
                      <div>PowerAdj = {stat(simulation.obpWork.powerAdj)} | Blended = {stat(simulation.obpWork.blended)} | Mult = {stat(simulation.obpWork.multiplier, 4)}</div>
                      <div className="font-semibold">ProjectedOBP = {stat(simulation.pObp)}</div>
                      <div className="pt-2 font-semibold">pISO</div>
                      <div>RatingZ = {stat(simulation.isoWork.ratingZ, 4)} | PowerAdj = {stat(simulation.isoWork.powerAdj)} | Blended = {stat(simulation.isoWork.blended)} | Mult = {stat(simulation.isoWork.multiplier, 4)}</div>
                      <div className="font-semibold">ProjectedISO = {stat(simulation.pIso)}</div>
                    </>
                  )}
                </div>
              </details>
            )}
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
                    <Input placeholder="Search pitcher..." value={pitcherSearch} onChange={(e) => { setPitcherSearch(e.target.value); setPitcherDropdownOpen(true); }} onFocus={() => setPitcherDropdownOpen(true)} onBlur={() => setTimeout(() => setPitcherDropdownOpen(false), 150)} />
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
                    <span className="font-mono tabular-nums">2025: {stat(selectedPitcher.era, 2)} ERA · {stat(selectedPitcher.fip, 2)} FIP · {stat(selectedPitcher.whip, 2)} WHIP · {stat(selectedPitcher.k9, 1)} K/9</span>
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

            {/* ─── Context (collapsible) ─── */}
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wide text-muted-foreground">Context + Multipliers</summary>
              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1.5 text-xs">
                <div><span className="text-muted-foreground">From:</span> {selectedPitcher?.team || "-"}</div>
                <div><span className="text-muted-foreground">To:</span> {selectedDestinationTeam || "-"}</div>
                <div><span className="text-muted-foreground">From Conf:</span> {pitchingSimulation?.fromConference || "-"}</div>
                <div><span className="text-muted-foreground">To Conf:</span> {pitchingSimulation?.toConference || "-"}</div>
                <div><span className="text-muted-foreground">Park (R/G):</span> {pitchingSimulation ? `${formatPark(pitchingSimulation.fromEraParkRaw)} → ${formatPark(pitchingSimulation.toEraParkRaw)}` : "-"}</div>
                <div><span className="text-muted-foreground">Park (WHIP):</span> {pitchingSimulation ? `${formatPark(pitchingSimulation.fromWhipParkRaw)} → ${formatPark(pitchingSimulation.toWhipParkRaw)}` : "-"}</div>
                <div><span className="text-muted-foreground">Park (HR/9):</span> {pitchingSimulation ? `${formatPark(pitchingSimulation.fromHr9ParkRaw)} → ${formatPark(pitchingSimulation.toHr9ParkRaw)}` : "-"}</div>
                <div><span className="text-muted-foreground">Hitter Talent+:</span> {pitchingSimulation ? `${stat(pitchingSimulation.fromHitterTalent, 1)} → ${stat(pitchingSimulation.toHitterTalent, 1)}` : "-"}</div>
                <div><span className="text-muted-foreground">ERA+:</span> {pitchingSimulation ? `${whole(pitchingSimulation.fromEraPlus)} → ${whole(pitchingSimulation.toEraPlus)}` : "-"}</div>
                <div><span className="text-muted-foreground">FIP+:</span> {pitchingSimulation ? `${whole(pitchingSimulation.fromFipPlus)} → ${whole(pitchingSimulation.toFipPlus)}` : "-"}</div>
                <div><span className="text-muted-foreground">K/9+:</span> {pitchingSimulation ? `${whole(pitchingSimulation.fromK9Plus)} → ${whole(pitchingSimulation.toK9Plus)}` : "-"}</div>
                <div><span className="text-muted-foreground">BB/9+:</span> {pitchingSimulation ? `${whole(pitchingSimulation.fromBb9Plus)} → ${whole(pitchingSimulation.toBb9Plus)}` : "-"}</div>
              </div>
            </details>

            {/* ─── Show Work (admin) ─── */}
            {isAdmin && pitchingSimulation?.showWork && (
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wide text-muted-foreground">Show Work (Pitching)</summary>
                <div className="mt-3 rounded-md bg-muted/20 p-3 font-mono text-sm space-y-4">
                  {(["era", "fip", "whip", "k9", "bb9", "hr9"] as const).map((key) => {
                    const w = pitchingSimulation.showWork?.[key];
                    if (!w) return null;
                    const labels: Record<string, string> = { era: "pERA", fip: "pFIP", whip: "pWHIP", k9: "pK/9", bb9: "pBB/9", hr9: "pHR/9" };
                    const lower = key !== "k9";
                    return (
                      <div key={key} className="space-y-1">
                        <div className="font-semibold">{labels[key]}</div>
                        <div>Last = {stat(w.last, 2)} | PowerAdj = {stat(w.powerAdj, 2)} | Blended = {stat(w.blended, 2)} | Mult = {stat(w.mult, 4)}</div>
                        <div className="font-semibold">Projected = {stat(w.projected, 2)} | RoleAdj = {stat(w.roleAdjusted, 2)}</div>
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
