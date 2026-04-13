import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Target, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { readPitchingWeights } from "@/lib/pitchingEquations";
import { readPlayerOverrides } from "@/lib/playerOverrides";
import { getProgramTierMultiplierByConference } from "@/lib/nilProgramSpecific";
import { resolveMetricParkFactor } from "@/lib/parkFactors";
import { useParkFactors } from "@/hooks/useParkFactors";
import { useTeamsTable } from "@/hooks/useTeamsTable";
import { usePitchingSeedData } from "@/hooks/usePitchingSeedData";
import { useTargetBoard } from "@/hooks/useTargetBoard";
import { useConferenceStats } from "@/hooks/useConferenceStats";

const fmt = (v: number | null | undefined, digits = 3) => (v == null ? "—" : Number(v).toFixed(digits));
const fmtWhole = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toString());
const normalize = (v: string | null | undefined) =>
  (v || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const parkToIndex = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return 100;
  return Math.abs(v) <= 3 ? v * 100 : v;
};
const PITCHER_TEAM_ALIASES: Record<string, string> = {
  "unc charlotte": "Charlotte",
  "louisiana state university": "Louisiana State",
  "university of mississippi": "Ole Miss",
  "florida international university": "Florida International",
  "florida internation": "Florida International",
  "university of hawaii manoa": "University of Hawaii",
  "university of hawaii, manoa": "University of Hawaii",
  "university of california": "California",
  ucla: "University of California Los Angeles",
  "samford university": "Samford",
};
const normalizePitcherTeamName = (team: string | null | undefined) => {
  const raw = String(team || "").trim();
  if (!raw) return "";
  const alias = PITCHER_TEAM_ALIASES[normalize(raw)];
  return alias || raw;
};
const isUuid = (v: string | undefined) =>
  !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const STORAGE_PREFIX = "storage__";
const parseBaseballInnings = (v: string | null | undefined) => {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const whole = Math.trunc(n);
  const frac = Math.round((n - whole) * 10);
  if (frac === 1) return whole + (1 / 3);
  if (frac === 2) return whole + (2 / 3);
  return n;
};

const PITCHING_EQ_DEFAULTS: Record<string, number> = {
  p_ncaa_avg_stuff_plus: 100,
  p_ncaa_avg_whiff_pct: 22.9,
  p_ncaa_avg_bb_pct: 11.3,
  p_ncaa_avg_hh_pct: 36,
  p_ncaa_avg_in_zone_whiff_pct: 16.4,
  p_ncaa_avg_chase_pct: 23.1,
  p_ncaa_avg_barrel_pct: 17.3,
  p_ncaa_avg_ld_pct: 20.9,
  p_ncaa_avg_avg_ev: 86.2,
  p_ncaa_avg_gb_pct: 43.2,
  p_ncaa_avg_in_zone_pct: 47.2,
  p_ncaa_avg_ev90: 103.1,
  p_ncaa_avg_pull_pct: 36.5,
  p_ncaa_avg_la_10_30_pct: 29,
  p_sd_stuff_plus: 3.967566764,
  p_sd_whiff_pct: 5.476169924,
  p_sd_bb_pct: 2.92040411,
  p_sd_hh_pct: 6.474203457,
  p_sd_in_zone_whiff_pct: 4.299203457,
  p_sd_chase_pct: 4.619392309,
  p_sd_barrel_pct: 4.988140199,
  p_sd_ld_pct: 3.580670928,
  p_sd_avg_ev: 2.362900608,
  p_sd_gb_pct: 6.958760046,
  p_sd_in_zone_pct: 3.325412065,
  p_sd_ev90: 1.767350585,
  p_sd_pull_pct: 5.356686254,
  p_sd_la_10_30_pct: 5.773803471,
  p_era_ncaa_avg_power_rating: 50,
  p_ncaa_avg_whip_power_rating: 50,
  p_ncaa_avg_k9_power_rating: 50,
  p_ncaa_avg_bb9_power_rating: 50,
  p_ncaa_avg_hr9_power_rating: 50,
  p_era_stuff_plus_weight: 0.21,
  p_era_whiff_pct_weight: 0.23,
  p_era_bb_pct_weight: 0.17,
  p_era_hh_pct_weight: 0.07,
  p_era_in_zone_whiff_pct_weight: 0.12,
  p_era_chase_pct_weight: 0.08,
  p_era_barrel_pct_weight: 0.12,
  p_fip_hr9_power_rating_plus_weight: 0.45,
  p_fip_bb9_power_rating_plus_weight: 0.3,
  p_fip_k9_power_rating_plus_weight: 0.25,
  p_whip_bb_pct_weight: 0.25,
  p_whip_ld_pct_weight: 0.2,
  p_whip_avg_ev_weight: 0.15,
  p_whip_whiff_pct_weight: 0.25,
  p_whip_gb_pct_weight: 0.1,
  p_whip_chase_pct_weight: 0.05,
  p_k9_whiff_pct_weight: 0.35,
  p_k9_stuff_plus_weight: 0.3,
  p_k9_in_zone_whiff_pct_weight: 0.25,
  p_k9_chase_pct_weight: 0.1,
  p_bb9_bb_pct_weight: 0.55,
  p_bb9_in_zone_pct_weight: 0.3,
  p_bb9_chase_pct_weight: 0.15,
  p_hr9_barrel_pct_weight: 0.32,
  p_hr9_ev90_weight: 0.24,
  p_hr9_gb_pct_weight: 0.18,
  p_hr9_pull_pct_weight: 0.14,
  p_hr9_la_10_30_pct_weight: 0.12,
};

const nilFormat = (v: number | null | undefined) => {
  if (v == null) return "—";
  return `$${Math.round(v).toLocaleString()}`;
};

const OVERALL_PITCHER_POWER_WEIGHTS = {
  era: 0.15,
  fip: 0.25,
  whip: 0.1,
  k9: 0.2,
  bb9: 0.15,
  hr9: 0.15,
} as const;

type PitchArsenalRow = {
  season: number | null;
  source_player_id: string | null;
  player_name: string | null;
  hand: string | null;
  pitch_type: string | null;
  stuff_plus: number | null;
  usage_pct: number | null;
  whiff_pct: number | null;
  total_pitches: number | null;
  total_pitches_all: number | null;
  overall_stuff_plus: number | null;
};

const PITCH_TYPE_LABELS: Record<string, string> = {
  "4S": "4-Seam FB",
  "4S FB": "4-Seam FB",
  "FOUR-SEAM": "4-Seam FB",
  "FF": "4-Seam FB",
  SI: "Sinker",
  SINKER: "Sinker",
  Sinker: "Sinker",
  SL: "Slider",
  SLIDER: "Slider",
  Slider: "Slider",
  SWP: "Sweeper",
  SWEEPER: "Sweeper",
  Sweeper: "Sweeper",
  "GYRO SLIDER": "Gyro Slider",
  "Gyro Slider": "Gyro Slider",
  CB: "Curveball",
  CURVEBALL: "Curveball",
  Curveball: "Curveball",
  CU: "Curveball",
  CT: "Cutter",
  CUTTER: "Cutter",
  Cutter: "Cutter",
  FC: "Cutter",
  CH: "Changeup",
  "CHANGE-UP": "Changeup",
  "Change-up": "Changeup",
  CHANGEUP: "Changeup",
  SP: "Splitter",
  SPLITTER: "Splitter",
  Splitter: "Splitter",
  FS: "Splitter",
};

const PITCH_DISPLAY_ORDER = ["4S", "4S FB", "SI", "SINKER", "Sinker", "CT", "CUTTER", "Cutter", "GYRO SLIDER", "Gyro Slider", "SL", "SLIDER", "Slider", "SWP", "SWEEPER", "Sweeper", "CB", "CURVEBALL", "Curveball", "CH", "CHANGE-UP", "Change-up", "SP", "SPLITTER", "Splitter"] as const;

const PITCHING_POWER_RATING_WEIGHT = 0.7;
const PITCHING_DEV_FACTOR = 0.06;
const PITCHER_PROFILE_STORAGE_OVERRIDE_KEY = "pitcher_profile_projection_overrides_v1";
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
const toPitchingRole = (raw: string | null | undefined): "SP" | "RP" | "SM" | null => {
  const v = String(raw || "").trim().toUpperCase();
  if (v === "SP" || v === "RP" || v === "SM") return v;
  return null;
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

  // Extra RP->SP penalty curve so elite reliever lines do not stay unrealistically low as starters.
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
    // Keep K/9 and other higher-is-better metrics at the base role-change impact.
    return 1.0;
  })();

  // Role change direction controls up/down; admin % is treated as magnitude.
  const pctMagnitude = Math.abs(pct);
  const factor = 1 + ((pctMagnitude / 100) * (Math.abs(step) / 2) * starterRegressionBoost);
  if (!Number.isFinite(factor) || factor <= 0) return value;
  if (lowerIsBetter) {
    return step > 0 ? value / factor : value * factor;
  }
  return step > 0 ? value * factor : value / factor;
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

const dampFactorForProjected = (projected: number, thresholds: number[], impacts: number[]) => {
  for (let i = 0; i < thresholds.length; i++) {
    if (projected < thresholds[i]) return impacts[i] ?? 1;
  }
  return impacts[thresholds.length] ?? impacts[impacts.length - 1] ?? 1;
};

const projectPitchingRate = ({
  lastStat,
  prPlus,
  ncaaAvg,
  ncaaSd,
  prSd,
  classAdjustment,
  devAggressiveness,
  thresholds,
  impacts,
  lowerIsBetter,
}: {
  lastStat: number | null;
  prPlus: number | null;
  ncaaAvg: number;
  ncaaSd: number;
  prSd: number;
  classAdjustment: number;
  devAggressiveness: number;
  thresholds: number[];
  impacts: number[];
  lowerIsBetter: boolean;
}) => {
  if (
    lastStat == null ||
    prPlus == null ||
    !Number.isFinite(lastStat) ||
    !Number.isFinite(prPlus) ||
    !Number.isFinite(ncaaAvg) ||
    !Number.isFinite(ncaaSd) ||
    !Number.isFinite(prSd) ||
    prSd === 0
  ) {
    return null;
  }
  const zShift = ((prPlus - 100) / prSd) * ncaaSd;
  const powerAdjusted = lowerIsBetter ? (ncaaAvg - zShift) : (ncaaAvg + zShift);
  const blended = (lastStat * (1 - PITCHING_POWER_RATING_WEIGHT)) + (powerAdjusted * PITCHING_POWER_RATING_WEIGHT);
  const mult = lowerIsBetter
    ? (1 - classAdjustment - (devAggressiveness * PITCHING_DEV_FACTOR))
    : (1 + classAdjustment + (devAggressiveness * PITCHING_DEV_FACTOR));
  const projected = blended * mult;
  const delta = projected - lastStat;
  const dampFactor = dampFactorForProjected(projected, thresholds, impacts);
  return lastStat + (delta * dampFactor);
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

const normalizedWeightedSum = (items: Array<{ value: number; weight: number }>) => {
  const weighted = items.reduce((sum, item) => sum + (item.value * item.weight), 0);
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return null;
  return weighted / totalWeight;
};

function MetricCard({ title, value, subtitle }: { title: string; value: string; subtitle?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold tracking-tight">{value}</div>
        {subtitle ? <p className="text-xs text-muted-foreground mt-1">{subtitle}</p> : null}
      </CardContent>
    </Card>
  );
}

function ScoutGrade({ value, fullLabel }: { value: number | null; fullLabel: string }) {
  if (value == null) return null;
  const tier =
    value >= 90 ? "bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))] border-[hsl(var(--success)/0.3)]" :
    value >= 75 ? "bg-[hsl(142,71%,45%,0.12)] text-[hsl(142,71%,35%)] border-[hsl(142,71%,45%,0.25)]" :
    value >= 60 ? "bg-[hsl(200,80%,50%,0.12)] text-[hsl(200,80%,35%)] border-[hsl(200,80%,50%,0.25)]" :
    value >= 45 ? "bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))] border-[hsl(var(--warning)/0.3)]" :
    value >= 35 ? "bg-[hsl(25,90%,50%,0.12)] text-[hsl(25,90%,38%)] border-[hsl(25,90%,50%,0.25)]" :
    "bg-destructive/15 text-destructive border-destructive/30";
  const grade =
    value >= 90 ? "Elite" :
    value >= 75 ? "Plus-Plus" :
    value >= 60 ? "Plus" :
    value >= 45 ? "Average" :
    value >= 35 ? "Below Avg" : "Poor";
  return (
    <div className={`rounded-lg border p-3 ${tier}`}>
      <div className="text-xs font-medium opacity-80">{fullLabel}</div>
      <div className="text-2xl font-bold mt-1">{Math.round(value)}</div>
      <div className="text-xs font-semibold mt-0.5">{grade}</div>
    </div>
  );
}


export default function PitcherProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const queryClient = useQueryClient();
  const { isOnBoard, addPlayer: addToBoard, removePlayer: removeFromBoard } = useTargetBoard();

  const updatePortalStatus = useMutation({
    mutationFn: async ({ playerId, value }: { playerId: string; value: string }) => {
      const { error } = await supabase
        .from("players")
        .update({ portal_status: value, transfer_portal: value === "IN PORTAL" } as any)
        .eq("id", playerId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pitcher-profile"] });
      queryClient.invalidateQueries({ queryKey: ["target-board"] });
      toast.success("Portal status updated");
    },
    onError: (e: any) => toast.error(`Portal status update failed: ${e.message}`),
  });
  const isStorageRoute = !!id && id.startsWith(STORAGE_PREFIX);
  const isDbRoute = isUuid(id);
  const storageRef = useMemo(() => {
    if (!isStorageRoute || !id) return null;
    const raw = id.slice(STORAGE_PREFIX.length);
    const [nameEnc = "", teamEnc = ""] = raw.split("__");
    const playerName = decodeURIComponent(nameEnc || "");
    const teamName = decodeURIComponent(teamEnc || "");
    return { playerName, teamName };
  }, [id, isStorageRoute]);

  const { data: player, isLoading } = useQuery({
    queryKey: ["pitcher-profile-player", id],
    enabled: !!id && (isDbRoute || /^\d+$/.test(id || "")),
    queryFn: async () => {
      // Try by UUID first
      if (isDbRoute) {
        const { data } = await supabase
          .from("players")
          .select("*")
          .eq("id", id!)
          .maybeSingle();
        if (data) return data;
      }
      // Fallback: look up by source_player_id
      const { data: bySource } = await supabase
        .from("players")
        .select("*")
        .eq("source_player_id", id!)
        .maybeSingle();
      if (bySource) return bySource;
      return null;
    },
  });

  const { data: seasonStats = [] } = useQuery({
    queryKey: ["pitcher-profile-season-stats", id],
    enabled: !!id && isDbRoute,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("season_stats")
        .select("*")
        .eq("player_id", id!)
        .order("season", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch all Pitching Master rows across seasons (linked by source_player_id).
  // Falls back to the URL `id` for cases where the player record is missing
  // but the URL itself is a numeric source_player_id (historical-only pitchers
  // who have no row in the `players` table).
  const { data: pitcherMasterSeasons = [] } = useQuery({
    queryKey: ["pitcher-profile-master-seasons", id, (player as any)?.source_player_id],
    queryFn: async () => {
      const sourceId = (player as any)?.source_player_id || (id && /^\d+$/.test(id) ? id : null);
      if (!sourceId) return [];
      const { data, error } = await supabase
        .from("Pitching Master")
        .select("*")
        .eq("source_player_id", sourceId)
        .order("Season", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!id,
  });

  // Detect two-way: does this pitcher also have meaningful at-bats?
  const { data: hasHittingData = false } = useQuery({
    queryKey: ["pitcher-has-hitting", id, (player as any)?.source_player_id],
    queryFn: async () => {
      const sourceId = (player as any)?.source_player_id || (id && /^\d+$/.test(id) ? id : null);
      if (!sourceId) return false;
      const { data } = await supabase
        .from("Hitter Master")
        .select("ab")
        .eq("source_player_id", sourceId)
        .gte("ab", 1)
        .limit(1);
      return (data?.length || 0) > 0;
    },
    enabled: !!id,
  });

  const availableSeasons = useMemo(() => {
    const set = new Set<number>();
    for (const r of pitcherMasterSeasons) if ((r as any).Season != null) set.add(Number((r as any).Season));
    for (const s of seasonStats) if ((s as any).season != null) set.add(Number((s as any).season));
    return [...set].sort((a, b) => b - a);
  }, [pitcherMasterSeasons, seasonStats]);

  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const defaultSeason = availableSeasons.includes(2025) ? 2025 : (availableSeasons[0] ?? 2025);
  const effectiveSeason = selectedSeason ?? defaultSeason;
  const isHistoricalView = effectiveSeason !== 2025;
  const historicalRow = useMemo(() => {
    return (pitcherMasterSeasons as any[]).find((r) => Number(r.Season) === effectiveSeason) || null;
  }, [pitcherMasterSeasons, effectiveSeason]);

  const currentPitcherRow = useMemo(() => {
    return (pitcherMasterSeasons as any[]).find((r) => Number(r.Season) === 2025) || null;
  }, [pitcherMasterSeasons]);
  const combinedUsed = !isHistoricalView && !!(currentPitcherRow as any)?.combined_used;
  const combinedIp = (currentPitcherRow as any)?.combined_ip as number | null | undefined;
  const combinedSeasonsLabel = (currentPitcherRow as any)?.combined_seasons as string | null | undefined;

  const { data: predictions = [] } = useQuery({
    queryKey: ["pitcher-profile-predictions", id],
    enabled: !!id && isDbRoute,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_predictions")
        .select("*")
        .eq("player_id", id!)
        .eq("status", "active");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: nilValuation } = useQuery({
    queryKey: ["pitcher-profile-nil", id],
    enabled: !!id && isDbRoute,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nil_valuations")
        .select("*")
        .eq("player_id", id!)
        .order("season", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const { teams: teamDirectory } = useTeamsTable();
  const { conferenceStatsByKey } = useConferenceStats(2025);
  const lookupPlayerName = useMemo(() => {
    if (storageRef?.playerName) return storageRef.playerName;
    const fullName = `${player?.first_name || ""} ${player?.last_name || ""}`.trim();
    return fullName || "";
  }, [player?.first_name, player?.last_name, storageRef?.playerName]);
  const lookupTeamName = useMemo(() => {
    if (storageRef?.teamName) return storageRef.teamName;
    return normalizePitcherTeamName(player?.team || "");
  }, [player?.team, storageRef?.teamName]);
  const { data: pitchArsenalRows = [] } = useQuery({
    queryKey: ["pitcher-profile-pitch-arsenal", id, lookupPlayerName, (player as any)?.source_player_id],
    enabled: !!lookupPlayerName || !!(player as any)?.source_player_id,
    queryFn: async () => {
      const sourceId = (player as any)?.source_player_id;

      // Primary: pull from pitcher_stuff_plus_inputs (has calculated Stuff+ scores)
      if (sourceId) {
        const { data: stuffRows } = await (supabase as any)
          .from("pitcher_stuff_plus_inputs")
          .select("season, source_player_id, hand, pitch_type, pitches, whiff_pct, stuff_plus")
          .eq("source_player_id", sourceId)
          .eq("season", 2025)
          .gte("pitches", 5)
          .order("pitches", { ascending: false });

        if (stuffRows && stuffRows.length > 0) {
          const totalPitchesAll = stuffRows.reduce((s: number, r: any) => s + (r.pitches ?? 0), 0);
          return stuffRows.map((r: any) => ({
            season: r.season,
            source_player_id: r.source_player_id,
            player_name: null,
            hand: r.hand,
            pitch_type: r.pitch_type,
            stuff_plus: r.stuff_plus,
            usage_pct: null,
            whiff_pct: r.whiff_pct,
            total_pitches: r.pitches,
            total_pitches_all: totalPitchesAll,
            overall_stuff_plus: null,
          })) as PitchArsenalRow[];
        }
      }

      // Fallback: legacy Pitch Arsenal table
      const bySourceId = async () => {
        if (!sourceId) return [];
        const { data, error } = await supabase
          .from("Pitch Arsenal")
          .select("season, source_player_id, player_name, hand, pitch_type, stuff_plus, whiff_pct, total_pitches, total_pitches_all, overall_stuff_plus")
          .eq("source_player_id", sourceId)
          .eq("season", 2025)
          .order("total_pitches", { ascending: false });
        if (error) throw error;
        return (data || []).map((r: any) => ({ ...r, usage_pct: null })) as PitchArsenalRow[];
      };
      const byPlayerName = async () => {
        if (!lookupPlayerName) return [];
        const { data, error } = await supabase
          .from("Pitch Arsenal")
          .select("season, source_player_id, player_name, hand, pitch_type, stuff_plus, whiff_pct, total_pitches, total_pitches_all, overall_stuff_plus")
          .eq("player_name", lookupPlayerName)
          .eq("season", 2025)
          .order("total_pitches", { ascending: false });
        if (error) throw error;
        return (data || []).map((r: any) => ({ ...r, usage_pct: null })) as PitchArsenalRow[];
      };
      const firstPass = await bySourceId();
      if (firstPass.length > 0) return firstPass;
      return byPlayerName();
    },
  });
  // ── Pitching Master ──
  // Pull from the unfiltered profile-scoped query (pitcherMasterSeasons) so
  // low-IP pitchers (e.g. two-way players) still load. The shared
  // usePitchingSeedData hook applies an IP >= 20 dashboard filter that would
  // hide them from individual profile pages.
  const { pitchers: pitchingMasterRows } = usePitchingSeedData();
  const masterRow = useMemo(() => {
    // Prefer the unfiltered pitcher seasons row for the current selected season
    const fromSeasons = (pitcherMasterSeasons as any[]).find((r) => Number(r.Season) === effectiveSeason)
      ?? (pitcherMasterSeasons as any[])[0];
    if (fromSeasons) {
      // Map raw DB shape into the seed-data shape downstream code expects
      return {
        source_player_id: fromSeasons.source_player_id ?? null,
        playerName: fromSeasons.playerFullName ?? "",
        team: fromSeasons.Team ?? null,
        teamId: fromSeasons.TeamID ?? null,
        conference: fromSeasons.Conference ?? null,
        conferenceId: fromSeasons.conference_id ?? null,
        throwHand: fromSeasons.ThrowHand ?? null,
        role: fromSeasons.Role ?? null,
        ip: fromSeasons.IP ?? null,
        g: fromSeasons.G ?? null,
        gs: fromSeasons.GS ?? null,
        era: fromSeasons.ERA ?? null,
        fip: fromSeasons.FIP ?? null,
        whip: fromSeasons.WHIP ?? null,
        k9: fromSeasons.K9 ?? null,
        bb9: fromSeasons.BB9 ?? null,
        hr9: fromSeasons.HR9 ?? null,
        miss_pct: fromSeasons.miss_pct ?? null,
        bb_pct: fromSeasons.bb_pct ?? null,
        hard_hit_pct: fromSeasons.hard_hit_pct ?? null,
        in_zone_whiff_pct: fromSeasons.in_zone_whiff_pct ?? null,
        chase_pct: fromSeasons.chase_pct ?? null,
        barrel_pct: fromSeasons.barrel_pct ?? null,
        line_pct: fromSeasons.line_pct ?? null,
        exit_vel: fromSeasons.exit_vel ?? null,
        ground_pct: fromSeasons.ground_pct ?? null,
        in_zone_pct: fromSeasons.in_zone_pct ?? null,
        vel_90th: fromSeasons["90th_vel"] ?? null,
        h_pull_pct: fromSeasons.h_pull_pct ?? null,
        la_10_30_pct: fromSeasons.la_10_30_pct ?? null,
        stuffPlus: fromSeasons.stuff_plus ?? null,
      } as any;
    }
    // Fallback: legacy hook lookup (kept so name-only routes still resolve)
    if (!lookupPlayerName && !id) return null;
    if (isDbRoute && id) {
      const byId = pitchingMasterRows.find((r) => r.source_player_id === id);
      if (byId) return byId;
    }
    const normName = normalize(lookupPlayerName);
    if (!normName) return null;
    const byName = pitchingMasterRows.filter((r) => normalize(r.playerName) === normName);
    if (byName.length === 0) return null;
    if (byName.length === 1) return byName[0];
    const normTeam = normalize(lookupTeamName);
    const exactTeam = byName.find((r) => normalize(r.team) === normTeam);
    return exactTeam || byName[0];
  }, [pitcherMasterSeasons, effectiveSeason, pitchingMasterRows, id, isDbRoute, lookupPlayerName, lookupTeamName]);

  const storageRow = useMemo(() => {
    if (!masterRow) return null;
    const m = masterRow;
    // Build the same shape the downstream code expects:
    // [0]=name, [1]=team, [2]=hand, [3]=role, [4]=ip, [5]=g, [6]=gs,
    // [7]=era, [8]=fip, [9]=whip, [10]=k9, [11]=bb9, [12]=hr9
    return [
      m.playerName || "", m.team || "", m.throwHand || "", m.role || "",
      String(m.ip ?? ""), String(m.g ?? ""), String(m.gs ?? ""),
      String(m.era ?? ""), String(m.fip ?? ""), String(m.whip ?? ""),
      String(m.k9 ?? ""), String(m.bb9 ?? ""), String(m.hr9 ?? ""),
    ] as string[];
  }, [masterRow]);
  const powerRatingsRow = useMemo(() => {
    if (!masterRow) return null;
    const m = masterRow;
    // [0]=name, [1]=team,
    // [2..15] = raw metrics
    // [16..29] = stored scores (not in master, so all "")
    return [
      m.playerName || "", m.team || "",
      String(m.stuffPlus ?? ""), String(m.miss_pct ?? ""), String(m.bb_pct ?? ""), String(m.hard_hit_pct ?? ""),
      String(m.in_zone_whiff_pct ?? ""), String(m.chase_pct ?? ""), String(m.barrel_pct ?? ""), String(m.line_pct ?? ""),
      String(m.exit_vel ?? ""), String(m.ground_pct ?? ""), String(m.in_zone_pct ?? ""), String(m.vel_90th ?? ""),
      String(m.h_pull_pct ?? ""), String(m.la_10_30_pct ?? ""),
      /* scores 16-29: not stored in master */ "", "", "", "", "", "", "", "", "", "", "", "", "", "",
    ] as string[];
  }, [masterRow]);

  const pitchingEq = useMemo(() => {
    const merged = { ...PITCHING_EQ_DEFAULTS };
    try {
      const raw = localStorage.getItem("admin_dashboard_pitching_power_equation_values_v1");
      if (!raw) return merged;
      const parsed = JSON.parse(raw) as Record<string, string | number>;
      for (const key of Object.keys(PITCHING_EQ_DEFAULTS) as Array<keyof typeof PITCHING_EQ_DEFAULTS>) {
        const n = Number(parsed[key]);
        if (Number.isFinite(n)) merged[key] = n;
      }
    } catch {
      // ignore invalid local storage payload
    }
    // Locked constant: Chase% contribution in WHIP PR is fixed at 5%.
    merged.p_whip_chase_pct_weight = 0.05;
    return merged;
  }, []);

  const parseNum = (v: string | undefined) => {
    const s = (v || "").replace(/[%,$]/g, "").trim();
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  const normalCdf = (x: number) => {
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x) / Math.sqrt(2);
    const t = 1 / (1 + 0.3275911 * ax);
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const erf = sign * (1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-ax * ax));
    return 0.5 * (1 + erf);
  };
  const scoreFromMetric = (value: number | null, avg: number, sd: number, lowerIsBetter = false) => {
    if (value == null || !Number.isFinite(sd) || sd <= 0) return null;
    const pct = normalCdf((value - avg) / sd) * 100;
    return lowerIsBetter ? 100 - pct : pct;
  };
  const safe = (v: number | null | undefined) => (v == null ? null : Number(v));

  const internalPowerRatings = useMemo(() => {
    if (!powerRatingsRow) return null;
    const metrics = {
      stuff: parseNum(powerRatingsRow[2]),
      whiff: parseNum(powerRatingsRow[3]),
      bb: parseNum(powerRatingsRow[4]),
      hh: parseNum(powerRatingsRow[5]),
      izWhiff: parseNum(powerRatingsRow[6]),
      chase: parseNum(powerRatingsRow[7]),
      barrel: parseNum(powerRatingsRow[8]),
      ld: parseNum(powerRatingsRow[9]),
      avgEv: parseNum(powerRatingsRow[10]),
      gb: parseNum(powerRatingsRow[11]),
      iz: parseNum(powerRatingsRow[12]),
      ev90: parseNum(powerRatingsRow[13]),
      pull: parseNum(powerRatingsRow[14]),
      la1030: parseNum(powerRatingsRow[15]),
    };
    const storedScores = {
      stuff: parseNum(powerRatingsRow[16]),
      whiff: parseNum(powerRatingsRow[17]),
      bb: parseNum(powerRatingsRow[18]),
      hh: parseNum(powerRatingsRow[19]),
      izWhiff: parseNum(powerRatingsRow[20]),
      chase: parseNum(powerRatingsRow[21]),
      barrel: parseNum(powerRatingsRow[22]),
      ld: parseNum(powerRatingsRow[23]),
      avgEv: parseNum(powerRatingsRow[24]),
      gb: parseNum(powerRatingsRow[25]),
      iz: parseNum(powerRatingsRow[26]),
      ev90: parseNum(powerRatingsRow[27]),
      pull: parseNum(powerRatingsRow[28]),
      la1030: parseNum(powerRatingsRow[29]),
    };
    const scores = {
      stuff: storedScores.stuff ?? scoreFromMetric(metrics.stuff, pitchingEq.p_ncaa_avg_stuff_plus, pitchingEq.p_sd_stuff_plus),
      whiff: storedScores.whiff ?? scoreFromMetric(metrics.whiff, pitchingEq.p_ncaa_avg_whiff_pct, pitchingEq.p_sd_whiff_pct),
      bb: storedScores.bb ?? scoreFromMetric(metrics.bb, pitchingEq.p_ncaa_avg_bb_pct, pitchingEq.p_sd_bb_pct, true),
      hh: storedScores.hh ?? scoreFromMetric(metrics.hh, pitchingEq.p_ncaa_avg_hh_pct, pitchingEq.p_sd_hh_pct, true),
      izWhiff: storedScores.izWhiff ?? scoreFromMetric(metrics.izWhiff, pitchingEq.p_ncaa_avg_in_zone_whiff_pct, pitchingEq.p_sd_in_zone_whiff_pct),
      chase: storedScores.chase ?? scoreFromMetric(metrics.chase, pitchingEq.p_ncaa_avg_chase_pct, pitchingEq.p_sd_chase_pct),
      barrel: storedScores.barrel ?? scoreFromMetric(metrics.barrel, pitchingEq.p_ncaa_avg_barrel_pct, pitchingEq.p_sd_barrel_pct, true),
      ld: storedScores.ld ?? scoreFromMetric(metrics.ld, pitchingEq.p_ncaa_avg_ld_pct, pitchingEq.p_sd_ld_pct, true),
      avgEv: storedScores.avgEv ?? scoreFromMetric(metrics.avgEv, pitchingEq.p_ncaa_avg_avg_ev, pitchingEq.p_sd_avg_ev, true),
      gb: storedScores.gb ?? scoreFromMetric(metrics.gb, pitchingEq.p_ncaa_avg_gb_pct, pitchingEq.p_sd_gb_pct),
      iz: storedScores.iz ?? scoreFromMetric(metrics.iz, pitchingEq.p_ncaa_avg_in_zone_pct, pitchingEq.p_sd_in_zone_pct),
      ev90: storedScores.ev90 ?? scoreFromMetric(metrics.ev90, pitchingEq.p_ncaa_avg_ev90, pitchingEq.p_sd_ev90, true),
      pull: storedScores.pull ?? scoreFromMetric(metrics.pull, pitchingEq.p_ncaa_avg_pull_pct, pitchingEq.p_sd_pull_pct, true),
      la1030: storedScores.la1030 ?? scoreFromMetric(metrics.la1030, pitchingEq.p_ncaa_avg_la_10_30_pct, pitchingEq.p_sd_la_10_30_pct, true),
    };

    const hasEraInputs = [scores.stuff, scores.whiff, scores.bb, scores.hh, scores.izWhiff, scores.chase, scores.barrel].every((v) => v != null);
    const hasWhipInputs = [scores.bb, scores.ld, scores.avgEv, scores.whiff, scores.gb, scores.chase].every((v) => v != null);
    const hasK9Inputs = [scores.whiff, scores.stuff, scores.izWhiff, scores.chase].every((v) => v != null);
    const hasBb9Inputs = [scores.bb, scores.iz, scores.chase].every((v) => v != null);
    const hasHr9Inputs = [scores.barrel, scores.ev90, scores.gb, scores.pull, scores.la1030].every((v) => v != null);

    const era = hasEraInputs
      ? (safe(scores.stuff)! * pitchingEq.p_era_stuff_plus_weight) +
        (safe(scores.whiff)! * pitchingEq.p_era_whiff_pct_weight) +
        (safe(scores.bb)! * pitchingEq.p_era_bb_pct_weight) +
        (safe(scores.hh)! * pitchingEq.p_era_hh_pct_weight) +
        (safe(scores.izWhiff)! * pitchingEq.p_era_in_zone_whiff_pct_weight) +
        (safe(scores.chase)! * pitchingEq.p_era_chase_pct_weight) +
        (safe(scores.barrel)! * pitchingEq.p_era_barrel_pct_weight)
      : null;
    const whip = hasWhipInputs
      ? normalizedWeightedSum([
          { value: safe(scores.bb)!, weight: pitchingEq.p_whip_bb_pct_weight },
          { value: safe(scores.ld)!, weight: pitchingEq.p_whip_ld_pct_weight },
          { value: safe(scores.avgEv)!, weight: pitchingEq.p_whip_avg_ev_weight },
          { value: safe(scores.whiff)!, weight: pitchingEq.p_whip_whiff_pct_weight },
          { value: safe(scores.gb)!, weight: pitchingEq.p_whip_gb_pct_weight },
          { value: safe(scores.chase)!, weight: pitchingEq.p_whip_chase_pct_weight },
        ])
      : null;
    const k9 = hasK9Inputs
      ? (safe(scores.whiff)! * pitchingEq.p_k9_whiff_pct_weight) +
        (safe(scores.stuff)! * pitchingEq.p_k9_stuff_plus_weight) +
        (safe(scores.izWhiff)! * pitchingEq.p_k9_in_zone_whiff_pct_weight) +
        (safe(scores.chase)! * pitchingEq.p_k9_chase_pct_weight)
      : null;
    const bb9 = hasBb9Inputs
      ? (safe(scores.bb ?? storedScores.bb)! * pitchingEq.p_bb9_bb_pct_weight) +
        (safe(scores.iz ?? storedScores.iz)! * pitchingEq.p_bb9_in_zone_pct_weight) +
        (safe(scores.chase ?? storedScores.chase)! * pitchingEq.p_bb9_chase_pct_weight)
      : null;
    const hr9 = hasHr9Inputs
      ? (safe(scores.barrel ?? storedScores.barrel)! * pitchingEq.p_hr9_barrel_pct_weight) +
        (safe(scores.ev90 ?? storedScores.ev90)! * pitchingEq.p_hr9_ev90_weight) +
        (safe(scores.gb ?? storedScores.gb)! * pitchingEq.p_hr9_gb_pct_weight) +
        (safe(scores.pull ?? storedScores.pull)! * pitchingEq.p_hr9_pull_pct_weight) +
        (safe(scores.la1030 ?? storedScores.la1030)! * pitchingEq.p_hr9_la_10_30_pct_weight)
      : null;

    const eraPlus = era == null ? null : (era / pitchingEq.p_era_ncaa_avg_power_rating) * 100;
    const whipPlus = whip == null ? null : (whip / pitchingEq.p_ncaa_avg_whip_power_rating) * 100;
    const k9Plus = k9 == null ? null : (k9 / pitchingEq.p_ncaa_avg_k9_power_rating) * 100;
    const bb9Plus = bb9 == null ? null : (bb9 / pitchingEq.p_ncaa_avg_bb9_power_rating) * 100;
    const hr9Plus = hr9 == null ? null : (hr9 / pitchingEq.p_ncaa_avg_hr9_power_rating) * 100;
    const fipPlus = hr9Plus == null || bb9Plus == null || k9Plus == null
      ? null
      : (hr9Plus * pitchingEq.p_fip_hr9_power_rating_plus_weight) +
        (bb9Plus * pitchingEq.p_fip_bb9_power_rating_plus_weight) +
        (k9Plus * pitchingEq.p_fip_k9_power_rating_plus_weight);
    const overallPlus =
      eraPlus == null || fipPlus == null || whipPlus == null || k9Plus == null || bb9Plus == null || hr9Plus == null
        ? null
        : (OVERALL_PITCHER_POWER_WEIGHTS.era * eraPlus) +
          (OVERALL_PITCHER_POWER_WEIGHTS.fip * fipPlus) +
          (OVERALL_PITCHER_POWER_WEIGHTS.whip * whipPlus) +
          (OVERALL_PITCHER_POWER_WEIGHTS.k9 * k9Plus) +
          (OVERALL_PITCHER_POWER_WEIGHTS.bb9 * bb9Plus) +
          (OVERALL_PITCHER_POWER_WEIGHTS.hr9 * hr9Plus);

    return { metrics, scores, eraPlus, whipPlus, k9Plus, bb9Plus, hr9Plus, fipPlus, overallPlus };
  }, [pitchingEq, powerRatingsRow]);

  const latestStats = useMemo(() => seasonStats[0] || null, [seasonStats]);
  const activePrediction = useMemo(() => predictions[0] || null, [predictions]);
  const conferenceByTeam = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of teamDirectory as Array<{ name: string | null; conference: string | null; park_factor: number | null }>) {
      const key = normalize(row.name);
      if (!key || !row.conference) continue;
      if (!map.has(key)) map.set(key, row.conference);
    }
    return map;
  }, [teamDirectory]);
  const teamByName = useMemo(() => {
    const map = new Map<string, { name: string; conference: string | null; park_factor: number | null }>();
    for (const row of teamDirectory as Array<{ name: string | null; conference: string | null; park_factor: number | null }>) {
      const key = normalize(row.name);
      if (!key || !row.name) continue;
      if (!map.has(key)) map.set(key, { name: row.name, conference: row.conference, park_factor: row.park_factor });
    }
    return map;
  }, [teamDirectory]);
  const { parkMap: teamParkComponents } = useParkFactors();
  // Look up the most recent Pitching Master row by source_player_id as fallback
  const anyPitcherMasterRow = (pitcherMasterSeasons as any[])[0] || null;
  const fullName =
    `${player?.first_name || ""} ${player?.last_name || ""}`.trim() ||
    anyPitcherMasterRow?.playerFullName ||
    storageRef?.playerName ||
    "Pitcher";
  const displayTeam = normalizePitcherTeamName(player?.team || masterRow?.team || anyPitcherMasterRow?.Team || storageRef?.teamName || "") || "—";
  const playerOverride = useMemo(
    () => (isDbRoute && id ? readPlayerOverrides()[id] : undefined),
    [id, isDbRoute],
  );
  const storageOverrideKey = useMemo(
    () => `${normalize(lookupPlayerName)}|${normalize(displayTeam)}`,
    [lookupPlayerName, displayTeam],
  );
  const storageProjectionOverride = useMemo(() => {
    if (isDbRoute) return undefined;
    try {
      const raw = localStorage.getItem(PITCHER_PROFILE_STORAGE_OVERRIDE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, { pitcher_role?: "SP" | "RP" | "SM"; class_transition?: "FS" | "SJ" | "JS" | "GR"; dev_aggressiveness?: number }>) : {};
      return parsed?.[storageOverrideKey];
    } catch {
      return undefined;
    }
  }, [isDbRoute, storageOverrideKey]);
  // Resolve conference: use conference_id from masterRow/team → conference stats lookup, or fall back to player.conference
  const displayConference = (() => {
    // Try masterRow conference_id → Conference Stats (returns abbreviation)
    const confId = masterRow?.conferenceId;
    if (confId && conferenceStatsByKey.get(confId)) {
      return conferenceStatsByKey.get(confId)!.conference;
    }
    // Try team's conference_id
    const teamRow = teamByName.get(normalize(displayTeam));
    if (teamRow && (teamRow as any).conference_id && conferenceStatsByKey.get((teamRow as any).conference_id)) {
      return conferenceStatsByKey.get((teamRow as any).conference_id)!.conference;
    }
    // Fall back to player conference, team conference, or any master row
    return player?.conference || masterRow?.conference || (anyPitcherMasterRow as any)?.Conference || conferenceByTeam.get(normalize(displayTeam)) || "—";
  })();
  const displayHandedness = player?.handedness || masterRow?.throwHand || (anyPitcherMasterRow as any)?.ThrowHand || storageRow?.[2] || "—";
  // Read pitching stats directly from masterRow (no intermediate parse needed)
  const storageEra = masterRow?.era ?? null;
  const storageFip = masterRow?.fip ?? null;
  const storageWhip = masterRow?.whip ?? null;
  const storageK9 = masterRow?.k9 ?? null;
  const storageBb9 = masterRow?.bb9 ?? null;
  const storageHr9 = masterRow?.hr9 ?? null;
  const storageIp = parseBaseballInnings(masterRow?.ip != null ? String(masterRow.ip) : null);
  const storageGames = masterRow?.g ?? null;
  const storageGamesStarted = masterRow?.gs ?? null;
  const derivedRole = (() => {
    const roleRaw = toPitchingRole(masterRow?.role);
    if (roleRaw) return roleRaw;
    if (storageGames != null && storageGames > 0 && storageGamesStarted != null) {
      return (storageGamesStarted / storageGames) < 0.5 ? "RP" : "SP";
    }
    return null;
  })();
  const initialProjectedRole = playerOverride?.pitcher_role || storageProjectionOverride?.pitcher_role || derivedRole || "SM";
  const effectiveRoleDisplay = playerOverride?.pitcher_role || derivedRole;
  const initialProjectedClassTransition = (() => {
    const raw = String(playerOverride?.class_transition || storageProjectionOverride?.class_transition || activePrediction?.class_transition || "SJ").toUpperCase();
    return raw === "FS" || raw === "SJ" || raw === "JS" || raw === "GR" ? raw : "SJ";
  })();
  const initialProjectedDevAggressiveness = Number.isFinite(Number(playerOverride?.dev_aggressiveness ?? storageProjectionOverride?.dev_aggressiveness))
    ? Number(playerOverride?.dev_aggressiveness ?? storageProjectionOverride?.dev_aggressiveness)
    : (Number.isFinite(Number(activePrediction?.dev_aggressiveness)) ? Number(activePrediction?.dev_aggressiveness) : 0);
  const [projectedRole, setProjectedRole] = useState<"SP" | "RP" | "SM">(initialProjectedRole as "SP" | "RP" | "SM");
  const [projectedClassTransition, setProjectedClassTransition] = useState<"FS" | "SJ" | "JS" | "GR">(initialProjectedClassTransition as "FS" | "SJ" | "JS" | "GR");
  const [projectedDevAggressiveness, setProjectedDevAggressiveness] = useState<number>(initialProjectedDevAggressiveness);
  useEffect(() => {
    setProjectedRole(initialProjectedRole as "SP" | "RP" | "SM");
    setProjectedClassTransition(initialProjectedClassTransition as "FS" | "SJ" | "JS" | "GR");
    setProjectedDevAggressiveness(initialProjectedDevAggressiveness);
  }, [initialProjectedRole, initialProjectedClassTransition, initialProjectedDevAggressiveness]);
  const updateProjectedInputs = (updates: { pitcher_role?: "SP" | "RP" | "SM"; class_transition?: "FS" | "SJ" | "JS" | "GR"; dev_aggressiveness?: number }) => {
    if (updates.pitcher_role) setProjectedRole(updates.pitcher_role);
    if (updates.class_transition) setProjectedClassTransition(updates.class_transition);
    if (Number.isFinite(Number(updates.dev_aggressiveness))) setProjectedDevAggressiveness(Number(updates.dev_aggressiveness));
    if (isDbRoute && id) {
      const next = {
        ...(playerOverride || {}),
        ...updates,
      };
      const all = readPlayerOverrides();
      all[id] = next;
      try {
        localStorage.setItem("team_builder_player_overrides_v1", JSON.stringify(all));
      } catch {
        // ignore local storage failures
      }
      return;
    }
    // Storage-backed profile editing fallback.
    try {
      const raw = localStorage.getItem(PITCHER_PROFILE_STORAGE_OVERRIDE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, { pitcher_role?: "SP" | "RP" | "SM"; class_transition?: "FS" | "SJ" | "JS" | "GR"; dev_aggressiveness?: number }>) : {};
      const prev = parsed[storageOverrideKey] || {};
      parsed[storageOverrideKey] = { ...prev, ...updates };
      localStorage.setItem(PITCHER_PROFILE_STORAGE_OVERRIDE_KEY, JSON.stringify(parsed));
    } catch {
      // ignore local storage failures
    }
  };
  const projectedPitching = useMemo(() => {
    const eq = readPitchingWeights();
    const classTransitionRaw = String(projectedClassTransition || "SJ").toUpperCase();
    const classTransition: "FS" | "SJ" | "JS" | "GR" =
      classTransitionRaw === "FS" || classTransitionRaw === "SJ" || classTransitionRaw === "JS" || classTransitionRaw === "GR"
        ? classTransitionRaw
        : "SJ";
    const devAggressiveness = projectedDevAggressiveness;

    const eraPrPlus = internalPowerRatings?.eraPlus ?? parseNum(powerRatingsRow?.[30]);
    const fipPrPlus = internalPowerRatings?.fipPlus ?? parseNum(powerRatingsRow?.[31]);
    const whipPrPlus = internalPowerRatings?.whipPlus ?? parseNum(powerRatingsRow?.[32]);
    const k9PrPlus = internalPowerRatings?.k9Plus ?? parseNum(powerRatingsRow?.[33]);
    const hr9PrPlus = internalPowerRatings?.hr9Plus ?? parseNum(powerRatingsRow?.[34]);
    const bb9PrPlus = internalPowerRatings?.bb9Plus ?? parseNum(powerRatingsRow?.[35]);

    const classEraAdj = toPitchingClassAdj(classTransition, eq.class_era_fs, eq.class_era_sj, eq.class_era_js, eq.class_era_gr);
    const classFipAdj = toPitchingClassAdj(classTransition, eq.class_fip_fs, eq.class_fip_sj, eq.class_fip_js, eq.class_fip_gr);
    const classWhipAdj = toPitchingClassAdj(classTransition, eq.class_whip_fs, eq.class_whip_sj, eq.class_whip_js, eq.class_whip_gr);
    const classK9Adj = toPitchingClassAdj(classTransition, eq.class_k9_fs, eq.class_k9_sj, eq.class_k9_js, eq.class_k9_gr);
    const classBb9Adj = toPitchingClassAdj(classTransition, eq.class_bb9_fs, eq.class_bb9_sj, eq.class_bb9_js, eq.class_bb9_gr);
    const classHr9Adj = toPitchingClassAdj(classTransition, eq.class_hr9_fs, eq.class_hr9_sj, eq.class_hr9_js, eq.class_hr9_gr);

    const pEra = projectPitchingRate({
      lastStat: storageEra,
      prPlus: eraPrPlus,
      ncaaAvg: eq.era_plus_ncaa_avg,
      ncaaSd: eq.era_plus_ncaa_sd,
      prSd: eq.era_pr_sd,
      classAdjustment: classEraAdj,
      devAggressiveness,
      thresholds: eq.era_damp_thresholds,
      impacts: eq.era_damp_impacts,
      lowerIsBetter: true,
    });
    const pFip = projectPitchingRate({
      lastStat: storageFip,
      prPlus: fipPrPlus,
      ncaaAvg: eq.fip_plus_ncaa_avg,
      ncaaSd: eq.fip_plus_ncaa_sd,
      prSd: eq.fip_pr_sd,
      classAdjustment: classFipAdj,
      devAggressiveness,
      thresholds: eq.fip_damp_thresholds,
      impacts: eq.fip_damp_impacts,
      lowerIsBetter: true,
    });
    const pWhip = projectPitchingRate({
      lastStat: storageWhip,
      prPlus: whipPrPlus,
      ncaaAvg: eq.whip_plus_ncaa_avg,
      ncaaSd: eq.whip_plus_ncaa_sd,
      prSd: eq.whip_pr_sd,
      classAdjustment: classWhipAdj,
      devAggressiveness,
      thresholds: eq.whip_damp_thresholds,
      impacts: eq.whip_damp_impacts,
      lowerIsBetter: true,
    });
    const pK9 = projectPitchingRate({
      lastStat: storageK9,
      prPlus: k9PrPlus,
      ncaaAvg: eq.k9_plus_ncaa_avg,
      ncaaSd: eq.k9_plus_ncaa_sd,
      prSd: eq.k9_pr_sd,
      classAdjustment: classK9Adj,
      devAggressiveness,
      thresholds: eq.k9_damp_thresholds,
      impacts: eq.k9_damp_impacts,
      lowerIsBetter: false,
    });
    const pBb9 = projectPitchingRate({
      lastStat: storageBb9,
      prPlus: bb9PrPlus,
      ncaaAvg: eq.bb9_plus_ncaa_avg,
      ncaaSd: eq.bb9_plus_ncaa_sd,
      prSd: eq.bb9_pr_sd,
      classAdjustment: classBb9Adj,
      devAggressiveness,
      thresholds: eq.bb9_damp_thresholds,
      impacts: eq.bb9_damp_impacts,
      lowerIsBetter: true,
    });
    const pHr9 = projectPitchingRate({
      lastStat: storageHr9,
      prPlus: hr9PrPlus,
      ncaaAvg: eq.hr9_plus_ncaa_avg,
      ncaaSd: eq.hr9_plus_ncaa_sd,
      prSd: eq.hr9_pr_sd,
      classAdjustment: classHr9Adj,
      devAggressiveness,
      thresholds: eq.hr9_damp_thresholds,
      impacts: eq.hr9_damp_impacts,
      lowerIsBetter: true,
    });
    const teamMatch = teamByName.get(normalize(displayTeam));
    const teamNameForPark = teamMatch?.name || displayTeam || null;
    const fallbackPark = teamMatch?.park_factor ?? null;
    const avgPark = parkToIndex(resolveMetricParkFactor(teamMatch?.id, "avg", teamParkComponents, teamNameForPark, fallbackPark));
    const obpPark = parkToIndex(resolveMetricParkFactor(teamMatch?.id, "obp", teamParkComponents, teamNameForPark, fallbackPark));
    const isoPark = parkToIndex(resolveMetricParkFactor(teamMatch?.id, "iso", teamParkComponents, teamNameForPark, fallbackPark));
    const eraParkRaw = resolveMetricParkFactor(teamMatch?.id, "era", teamParkComponents, teamNameForPark);
    const whipParkRaw = resolveMetricParkFactor(teamMatch?.id, "whip", teamParkComponents, teamNameForPark);
    const hr9ParkRaw = resolveMetricParkFactor(teamMatch?.id, "hr9", teamParkComponents, teamNameForPark);
    const eraParkFactor = (parkToIndex(eraParkRaw ?? avgPark)) / 100;
    const whipParkFactor = (parkToIndex(whipParkRaw ?? ((0.7 * avgPark) + (0.3 * obpPark)))) / 100;
    const hr9ParkFactor = (parkToIndex(hr9ParkRaw ?? isoPark)) / 100;
    const parkAdjustedEra = pEra == null ? null : pEra * eraParkFactor;
    const parkAdjustedWhip = pWhip == null ? null : pWhip * whipParkFactor;
    const parkAdjustedHr9 = pHr9 == null ? null : pHr9 * hr9ParkFactor;
    const roleCurve = {
      tier1Max: eq.rp_to_sp_low_better_tier1_max,
      tier2Max: eq.rp_to_sp_low_better_tier2_max,
      tier3Max: eq.rp_to_sp_low_better_tier3_max,
      tier1Mult: eq.rp_to_sp_low_better_tier1_mult,
      tier2Mult: eq.rp_to_sp_low_better_tier2_mult,
      tier3Mult: eq.rp_to_sp_low_better_tier3_mult,
    };
    const roleAdjustedEra = applyRoleTransitionAdjustment(parkAdjustedEra, eq.sp_to_rp_reg_era_pct, derivedRole, projectedRole, true, roleCurve);
    const roleAdjustedFip = applyRoleTransitionAdjustment(pFip, eq.sp_to_rp_reg_fip_pct, derivedRole, projectedRole, true, roleCurve);
    const roleAdjustedWhip = applyRoleTransitionAdjustment(parkAdjustedWhip, eq.sp_to_rp_reg_whip_pct, derivedRole, projectedRole, true, roleCurve);
    const roleAdjustedK9 = applyRoleTransitionAdjustment(pK9, eq.sp_to_rp_reg_k9_pct, derivedRole, projectedRole, false, roleCurve);
    const roleAdjustedBb9 = applyRoleTransitionAdjustment(pBb9, eq.sp_to_rp_reg_bb9_pct, derivedRole, projectedRole, true, roleCurve);
    const roleAdjustedHr9 = applyRoleTransitionAdjustment(parkAdjustedHr9, eq.sp_to_rp_reg_hr9_pct, derivedRole, projectedRole, true, roleCurve);

    const eraPlus = calcPitchingPlus(roleAdjustedEra, eq.era_plus_ncaa_avg, eq.era_plus_ncaa_sd, eq.era_plus_scale);
    const fipPlus = calcPitchingPlus(roleAdjustedFip, eq.fip_plus_ncaa_avg, eq.fip_plus_ncaa_sd, eq.fip_plus_scale);
    const whipPlus = calcPitchingPlus(roleAdjustedWhip, eq.whip_plus_ncaa_avg, eq.whip_plus_ncaa_sd, eq.whip_plus_scale);
    const k9Plus = calcPitchingPlus(roleAdjustedK9, eq.k9_plus_ncaa_avg, eq.k9_plus_ncaa_sd, eq.k9_plus_scale, true);
    const bb9Plus = calcPitchingPlus(roleAdjustedBb9, eq.bb9_plus_ncaa_avg, eq.bb9_plus_ncaa_sd, eq.bb9_plus_scale);
    const hr9Plus = calcPitchingPlus(roleAdjustedHr9, eq.hr9_plus_ncaa_avg, eq.hr9_plus_ncaa_sd, eq.hr9_plus_scale);
    const pRvPlus = [eraPlus, fipPlus, whipPlus, k9Plus, bb9Plus, hr9Plus].every((v) => v != null)
      ? (Number(eraPlus) * eq.era_plus_weight) +
        (Number(fipPlus) * eq.fip_plus_weight) +
        (Number(whipPlus) * eq.whip_plus_weight) +
        (Number(k9Plus) * eq.k9_plus_weight) +
        (Number(bb9Plus) * eq.bb9_plus_weight) +
        (Number(hr9Plus) * eq.hr9_plus_weight)
      : null;
    const projectedIp = projectedRole === "SP" ? eq.pwar_ip_sp : projectedRole === "RP" ? eq.pwar_ip_rp : eq.pwar_ip_sm;
    const pitcherValue = pRvPlus == null ? null : ((pRvPlus - 100) / 100);
    const pWar = pitcherValue == null || eq.pwar_runs_per_win === 0
      ? null
      : ((((pitcherValue * (projectedIp / 9) * eq.pwar_r_per_9) + ((projectedIp / 9) * eq.pwar_replacement_runs_per_9)) / eq.pwar_runs_per_win));
    const pitchingTierMultipliers = {
      sec: eq.market_tier_sec,
      p4: eq.market_tier_acc_big12,
      bigTen: eq.market_tier_big_ten,
      strongMid: eq.market_tier_strong_mid,
      lowMajor: eq.market_tier_low_major,
    };
    const teamForMarket = displayTeam || null;
    const conferenceForMarket = displayConference === "—" ? null : displayConference;
    const ptm = getProgramTierMultiplierByConference(conferenceForMarket, pitchingTierMultipliers);
    const pvm = getPitchingPvfForRole(projectedRole, eq);
    const marketEligible = canShowPitchingMarketValue(teamForMarket, conferenceForMarket);
    const marketValue = !marketEligible || pWar == null ? null : pWar * eq.market_dollars_per_war * ptm * pvm;

    return {
      pEra: roleAdjustedEra,
      pFip: roleAdjustedFip,
      pWhip: roleAdjustedWhip,
      pK9: roleAdjustedK9,
      pBb9: roleAdjustedBb9,
      pHr9: roleAdjustedHr9,
      pRvPlus,
      pWar,
      marketValue,
      projectedIp,
    };
  }, [
    projectedClassTransition,
    projectedDevAggressiveness,
    internalPowerRatings?.bb9Plus,
    internalPowerRatings?.eraPlus,
    internalPowerRatings?.fipPlus,
    internalPowerRatings?.hr9Plus,
    internalPowerRatings?.k9Plus,
    internalPowerRatings?.whipPlus,
    latestStats?.era,
    latestStats?.whip,
    powerRatingsRow,
    storageBb9,
    storageEra,
    storageFip,
    storageHr9,
    storageK9,
    storageIp,
    storageWhip,
    displayConference,
    derivedRole,
    projectedRole,
    storageProjectionOverride?.class_transition,
    storageProjectionOverride?.dev_aggressiveness,
    storageProjectionOverride?.pitcher_role,
    displayTeam,
    teamByName,
    teamParkComponents,
  ]);

  const pitching2025 = useMemo(() => {
    const eq = readPitchingWeights();
    const era2025 = latestStats?.era ?? storageEra;
    const fip2025 = storageFip;
    const whip2025 = latestStats?.whip ?? storageWhip;
    const k92025 = storageK9;
    const bb92025 = storageBb9;
    const hr92025 = storageHr9;

    const eraPlus = calcPitchingPlus(era2025, eq.era_plus_ncaa_avg, eq.era_plus_ncaa_sd, eq.era_plus_scale);
    const fipPlus = calcPitchingPlus(fip2025, eq.fip_plus_ncaa_avg, eq.fip_plus_ncaa_sd, eq.fip_plus_scale);
    const whipPlus = calcPitchingPlus(whip2025, eq.whip_plus_ncaa_avg, eq.whip_plus_ncaa_sd, eq.whip_plus_scale);
    const k9Plus = calcPitchingPlus(k92025, eq.k9_plus_ncaa_avg, eq.k9_plus_ncaa_sd, eq.k9_plus_scale, true);
    const bb9Plus = calcPitchingPlus(bb92025, eq.bb9_plus_ncaa_avg, eq.bb9_plus_ncaa_sd, eq.bb9_plus_scale);
    const hr9Plus = calcPitchingPlus(hr92025, eq.hr9_plus_ncaa_avg, eq.hr9_plus_ncaa_sd, eq.hr9_plus_scale);
    const pRvPlus2025 = [eraPlus, fipPlus, whipPlus, k9Plus, bb9Plus, hr9Plus].every((v) => v != null)
      ? (Number(eraPlus) * eq.era_plus_weight) +
        (Number(fipPlus) * eq.fip_plus_weight) +
        (Number(whipPlus) * eq.whip_plus_weight) +
        (Number(k9Plus) * eq.k9_plus_weight) +
        (Number(bb9Plus) * eq.bb9_plus_weight) +
        (Number(hr9Plus) * eq.hr9_plus_weight)
      : null;
    const pWar2025 = pRvPlus2025 == null || storageIp == null || eq.pwar_runs_per_win === 0
      ? null
      : (((((pRvPlus2025 - 100) / 100) * (storageIp / 9) * eq.pwar_r_per_9) + ((storageIp / 9) * eq.pwar_replacement_runs_per_9)) / eq.pwar_runs_per_win);

    return { pRvPlus2025, pWar2025 };
  }, [
    latestStats?.era,
    latestStats?.whip,
    storageBb9,
    storageEra,
    storageFip,
    storageHr9,
    storageK9,
    storageWhip,
  ]);
  const pitchArsenal = useMemo(() => {
    const sourceRows = pitchArsenalRows || [];

    const normalized = sourceRows
      .map((row) => {
        const totalAll = row.total_pitches_all == null ? null : Number(row.total_pitches_all);
        const pitchCount = row.total_pitches == null ? null : Number(row.total_pitches);
        const usagePct = pitchCount != null && totalAll != null && totalAll > 0 ? (pitchCount / totalAll) * 100 : null;
        return {
          pitchType: String(row.pitch_type || "").trim().toUpperCase(),
          hand: row.hand ?? null,
          stuffPlus: row.stuff_plus == null ? null : Number(row.stuff_plus),
          usagePct,
          whiffPct: row.whiff_pct == null ? null : Number(row.whiff_pct),
          pitchCount,
          totalPitches: totalAll,
          overallStuffPlus: row.overall_stuff_plus == null ? null : Number(row.overall_stuff_plus),
        };
      })
      .filter((r) => r.pitchType.length > 0 && (r.pitchCount == null || r.pitchCount >= 5));

    const byPitch = new Map<string, typeof normalized[number]>();
    for (const row of normalized) byPitch.set(row.pitchType, row);
    const sorted = Array.from(byPitch.values()).sort((a, b) => {
      const ai = PITCH_DISPLAY_ORDER.indexOf(a.pitchType as any);
      const bi = PITCH_DISPLAY_ORDER.indexOf(b.pitchType as any);
      const aOrder = ai === -1 ? 999 : ai;
      const bOrder = bi === -1 ? 999 : bi;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return (b.pitchCount || 0) - (a.pitchCount || 0);
    });

    const maxTotalPitches = sorted.reduce<number | null>((acc, row) => {
      if (row.totalPitches == null || !Number.isFinite(row.totalPitches)) return acc;
      if (acc == null) return row.totalPitches;
      return Math.max(acc, row.totalPitches);
    }, null);
    const overallStuffPlus =
      sorted.find((r) => r.overallStuffPlus != null)?.overallStuffPlus ??
      (() => {
        const valid = sorted.filter((r) => r.stuffPlus != null && r.usagePct != null);
        if (valid.length === 0) return null;
        const weighted = valid.reduce((sum, row) => sum + Number(row.stuffPlus) * Number(row.usagePct), 0);
        const usage = valid.reduce((sum, row) => sum + Number(row.usagePct), 0);
        if (!Number.isFinite(usage) || usage <= 0) return null;
        return weighted / usage;
      })();
    const usageTotal = sorted.reduce((sum, row) => sum + (row.usagePct || 0), 0);
    const overallWhiffPct = (() => {
      const valid = sorted.filter((r) => r.whiffPct != null && r.usagePct != null);
      if (valid.length === 0) return null;
      const weighted = valid.reduce((sum, row) => sum + Number(row.whiffPct) * Number(row.usagePct), 0);
      const usage = valid.reduce((sum, row) => sum + Number(row.usagePct), 0);
      if (!Number.isFinite(usage) || usage <= 0) return null;
      return weighted / usage;
    })();

    return { rows: sorted, overallStuffPlus, usageTotal: usageTotal > 0 ? usageTotal : null, overallWhiffPct, totalPitches: maxTotalPitches };
  }, [pitchArsenalRows]);

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="p-6 text-muted-foreground">Loading pitcher profile…</div>
      </DashboardLayout>
    );
  }

  const activePitcherRow = isHistoricalView ? historicalRow : currentPitcherRow;
  const activeIp = (activePitcherRow as any)?.IP;
  if (activePitcherRow != null && (activeIp == null || Number(activeIp) === 0)) {
    return (
      <DashboardLayout>
        <div className="p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h2 className="text-2xl font-bold tracking-tight">
              {player?.first_name} {player?.last_name}
            </h2>
          </div>
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No pitching stats for the {effectiveSeason} season.
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              const returnTo = (location.state as { returnTo?: string } | null)?.returnTo;
              if (returnTo) {
                navigate(returnTo);
                return;
              }
              navigate(-1);
            }}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h2 className="text-2xl font-bold tracking-tight">{fullName}</h2>
            {hasHittingData && (
              <Button
                variant="outline"
                size="sm"
                className="mt-1 mb-1"
                onClick={() => navigate(`/dashboard/player/${id}`)}
              >
                View Hitting Profile →
              </Button>
            )}
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge variant="outline">{displayTeam}</Badge>
              <Badge variant="outline" className="text-muted-foreground">{displayConference}</Badge>
              <Badge variant="secondary">{displayHandedness === "R" ? "RHP" : displayHandedness === "L" ? "LHP" : displayHandedness}</Badge>
              {player && (() => {
                const ps = (player as any).portal_status || "NOT IN PORTAL";
                const cfg: Record<string, { bg: string; text: string; label: string }> = {
                  "NOT IN PORTAL": { bg: "bg-muted", text: "text-muted-foreground", label: "Not In Portal" },
                  "WATCHING": { bg: "bg-[#D4AF37]/10", text: "text-[#D4AF37]", label: "Watching" },
                  "IN PORTAL": { bg: "bg-emerald-500/10", text: "text-emerald-600", label: "In Portal" },
                  "COMMITTED": { bg: "bg-blue-500/10", text: "text-blue-600", label: "Committed" },
                };
                const c = cfg[ps] || cfg["NOT IN PORTAL"];
                if (isAdmin) {
                  return (
                    <Select value={ps} onValueChange={(v) => updatePortalStatus.mutate({ playerId: player.id, value: v })}>
                      <SelectTrigger className={`h-auto w-auto gap-1 border-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${c.bg} ${c.text} focus:ring-0 focus:ring-offset-0`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="start" className="min-w-[140px]">
                        <SelectItem value="NOT IN PORTAL"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-muted-foreground/40" />Not In Portal</span></SelectItem>
                        <SelectItem value="WATCHING"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#D4AF37]" />Watching</span></SelectItem>
                        <SelectItem value="IN PORTAL"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-500" />In Portal</span></SelectItem>
                        <SelectItem value="COMMITTED"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-blue-500" />Committed</span></SelectItem>
                      </SelectContent>
                    </Select>
                  );
                }
                if (ps === "NOT IN PORTAL") return null;
                return <Badge className={`${c.bg} ${c.text} border-0`}>{c.label}</Badge>;
              })()}
              {combinedUsed && (
                <Badge
                  variant="outline"
                  className="text-[10px] font-semibold uppercase tracking-wider"
                  title={`Projection blends ${combinedSeasonsLabel} (${combinedIp} IP total)`}
                >
                  Combined: {combinedSeasonsLabel} ({combinedIp} IP)
                </Badge>
              )}
            </div>
          </div>
          {availableSeasons.length > 1 && (
            <Select value={String(effectiveSeason)} onValueChange={(v) => setSelectedSeason(Number(v))}>
              <SelectTrigger className="h-9 w-[80px] text-sm font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableSeasons.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {isHistoricalView && (
            <Badge className="bg-muted text-muted-foreground border-0 uppercase tracking-wider text-[10px] font-semibold">
              Historical
            </Badge>
          )}
          {!isHistoricalView && player && (
            <Button
              variant={isOnBoard(player.id) ? "default" : "outline"}
              size="sm"
              onClick={() => {
                if (isOnBoard(player.id)) {
                  removeFromBoard(player.id);
                } else {
                  addToBoard({ playerId: player.id });
                }
              }}
            >
              <Target className="mr-2 h-3.5 w-3.5" />
              {isOnBoard(player.id) ? "On Board" : "Target Board"}
            </Button>
          )}
        </div>

        {isHistoricalView ? (
          <HistoricalPitcherView
            row={historicalRow}
            season={effectiveSeason}
            isAdmin={isAdmin}
          />
        ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-1 space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Pitcher Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Team</span><span>{displayTeam}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Conference</span><span>{displayConference}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Class</span><span>{player?.class_year || "—"}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Role</span><span>{effectiveRoleDisplay || "—"}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Throws</span><span>{player?.throws_hand || displayHandedness || "—"}</span></div>
              </CardContent>
            </Card>

            {pitchArsenal.rows.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Stuff+ Overview</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    {(() => {
                      const sp = pitchArsenal.overallStuffPlus;
                      const stuffColor = sp == null ? "border-border" : sp >= 103 ? "border-green-500 bg-green-500/10" : sp >= 98 ? "border-blue-500 bg-blue-500/10" : sp >= 93 ? "border-yellow-500 bg-yellow-500/10" : "border-red-500 bg-red-500/10";
                      const stuffText = sp == null ? "text-muted-foreground" : sp >= 103 ? "text-green-600" : sp >= 98 ? "text-blue-600" : sp >= 93 ? "text-yellow-600" : "text-red-600";
                      return (
                        <div className={`rounded-lg border-2 p-4 text-center ${stuffColor}`}>
                          <div className="text-muted-foreground text-xs uppercase tracking-wide">Stuff+</div>
                          <div className={`text-3xl font-bold tracking-tight mt-1 ${stuffText}`}>{fmtWhole(sp)}</div>
                          <div className="text-[10px] text-muted-foreground mt-1">Avg: 100</div>
                        </div>
                      );
                    })()}
                    {(() => {
                      const wp = pitchArsenal.overallWhiffPct;
                      const whiffColor = wp == null ? "border-border" : wp >= 27 ? "border-green-500 bg-green-500/10" : wp >= 21 ? "border-blue-500 bg-blue-500/10" : wp >= 16 ? "border-yellow-500 bg-yellow-500/10" : "border-red-500 bg-red-500/10";
                      const whiffText = wp == null ? "text-muted-foreground" : wp >= 27 ? "text-green-600" : wp >= 21 ? "text-blue-600" : wp >= 16 ? "text-yellow-600" : "text-red-600";
                      return (
                        <div className={`rounded-lg border-2 p-4 text-center ${whiffColor}`}>
                          <div className="text-muted-foreground text-xs uppercase tracking-wide">Whiff%</div>
                          <div className={`text-3xl font-bold tracking-tight mt-1 ${whiffText}`}>{wp == null ? "—" : `${wp.toFixed(1)}%`}</div>
                          <div className="text-[10px] text-muted-foreground mt-1">Avg: 22.9%</div>
                        </div>
                      );
                    })()}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">2025 Stats</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">IP</div><div className="font-semibold">{fmt(storageIp ?? latestStats?.innings_pitched ?? null, 1)}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">ERA</div><div className="font-semibold">{fmt(latestStats?.era ?? storageEra, 2)}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">WHIP</div><div className="font-semibold">{fmt(latestStats?.whip ?? storageWhip, 2)}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">FIP</div><div className="font-semibold">{fmt(storageFip, 2)}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">K/9</div><div className="font-semibold">{fmt(storageK9, 2)}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">BB/9</div><div className="font-semibold">{fmt(storageBb9, 2)}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">HR/9</div><div className="font-semibold">{fmt(storageHr9, 2)}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">2025 pWAR</div><div className="font-semibold">{fmt(pitching2025.pWar2025, 2)}</div></div>
                </div>
              </CardContent>
            </Card>

          </div>

          <div className="lg:col-span-2 space-y-4">
            <div className="grid gap-3 grid-cols-3">
              <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-4 text-center">
                <div className="text-muted-foreground text-xs uppercase tracking-wide">pWAR</div>
                <div className="text-3xl font-bold tracking-tight mt-1">{fmt(projectedPitching.pWar, 2)}</div>
              </div>
              <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-4 text-center">
                <div className="text-muted-foreground text-xs uppercase tracking-wide">Market Value</div>
                <div className="text-2xl font-bold tracking-tight mt-1">{nilFormat(projectedPitching.marketValue ?? nilValuation?.projected_value ?? null)}</div>
              </div>
              <div className="rounded-lg border p-4 text-center">
                <div className="text-muted-foreground text-xs uppercase tracking-wide">Power Rating</div>
                <div className="text-3xl font-bold tracking-tight mt-1">{fmtWhole(internalPowerRatings?.overallPlus)}</div>
              </div>
            </div>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4" />Projected Stats</CardTitle>
                  <div className="flex items-center gap-1.5">
                    <Select value={projectedRole} onValueChange={(v) => updateProjectedInputs({ pitcher_role: v as "SP" | "RP" | "SM" })}>
                      <SelectTrigger className="h-7 w-[65px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="SP">SP</SelectItem>
                        <SelectItem value="RP">RP</SelectItem>
                        <SelectItem value="SM">SM</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={projectedClassTransition} onValueChange={(v) => updateProjectedInputs({ class_transition: v as "FS" | "SJ" | "JS" | "GR" })}>
                      <SelectTrigger className="h-7 w-[65px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="FS">FS</SelectItem>
                        <SelectItem value="SJ">SJ</SelectItem>
                        <SelectItem value="JS">JS</SelectItem>
                        <SelectItem value="GR">GR</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={String(projectedDevAggressiveness)} onValueChange={(v) => updateProjectedInputs({ dev_aggressiveness: Number(v) })}>
                      <SelectTrigger className="h-7 w-[65px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">0.0</SelectItem>
                        <SelectItem value="0.5">0.5</SelectItem>
                        <SelectItem value="1">1.0</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                  <div className="rounded-lg border bg-background/70 p-3 text-center">
                    <div className="text-muted-foreground text-[10px] uppercase tracking-wide">ERA</div>
                    <div className="text-xl font-bold mt-0.5">{fmt(projectedPitching.pEra, 2)}</div>
                  </div>
                  <div className="rounded-lg border bg-background/70 p-3 text-center">
                    <div className="text-muted-foreground text-[10px] uppercase tracking-wide">FIP</div>
                    <div className="text-xl font-bold mt-0.5">{fmt(projectedPitching.pFip, 2)}</div>
                  </div>
                  <div className="rounded-lg border bg-background/70 p-3 text-center">
                    <div className="text-muted-foreground text-[10px] uppercase tracking-wide">WHIP</div>
                    <div className="text-xl font-bold mt-0.5">{fmt(projectedPitching.pWhip, 2)}</div>
                  </div>
                  <div className="rounded-lg border bg-background/70 p-3 text-center">
                    <div className="text-muted-foreground text-[10px] uppercase tracking-wide">K/9</div>
                    <div className="text-xl font-bold mt-0.5">{fmt(projectedPitching.pK9, 2)}</div>
                  </div>
                  <div className="rounded-lg border bg-background/70 p-3 text-center">
                    <div className="text-muted-foreground text-[10px] uppercase tracking-wide">BB/9</div>
                    <div className="text-xl font-bold mt-0.5">{fmt(projectedPitching.pBb9, 2)}</div>
                  </div>
                  <div className="rounded-lg border bg-background/70 p-3 text-center">
                    <div className="text-muted-foreground text-[10px] uppercase tracking-wide">HR/9</div>
                    <div className="text-xl font-bold mt-0.5">{fmt(projectedPitching.pHr9, 2)}</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Scouting Grades</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 gap-2">
                  <ScoutGrade value={internalPowerRatings?.scores?.stuff ?? null} fullLabel="Stuff+" />
                  <ScoutGrade value={internalPowerRatings?.scores?.whiff ?? null} fullLabel="Whiff%" />
                  <ScoutGrade value={internalPowerRatings?.scores?.bb ?? null} fullLabel="BB%" />
                  <ScoutGrade value={internalPowerRatings?.scores?.barrel ?? null} fullLabel="Barrel%" />
                </div>
              </CardContent>
            </Card>

            {pitchArsenal.rows.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Pitch Arsenal</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium">Pitch</th>
                          <th className="text-right py-2 px-2 text-xs text-muted-foreground font-medium">Usage</th>
                          <th className="text-right py-2 px-2 text-xs text-muted-foreground font-medium">Whiff%</th>
                          <th className="text-right py-2 pl-2 text-xs text-muted-foreground font-medium">Stuff+</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pitchArsenal.rows.map((row) => {
                          const wp = row.whiffPct;
                          const pt = row.pitchType;
                          const isFB = pt === "4S FB" || pt === "SINKER" || pt === "4-SEAM" || pt === "FOUR-SEAM" || pt === "SI" || pt === "FF";
                          const isCutter = pt === "CUTTER" || pt === "FC" || pt === "CT";
                          const isBreaking = pt === "SLIDER" || pt === "CURVEBALL" || pt === "SWEEPER" || pt === "SL" || pt === "CB" || pt === "CU" || pt === "SW";
                          const isOffspeed = pt === "CHANGE-UP" || pt === "SPLITTER" || pt === "CH" || pt === "FS" || pt === "CHANGEUP";
                          const [wGreen, wBlue, wYellow] = isFB ? [22, 15, 10] : isCutter ? [30, 20, 14] : isBreaking ? [38, 28, 20] : isOffspeed ? [40, 30, 20] : [35, 25, 18];
                          const whiffColor = wp == null ? "" : wp >= wGreen ? "text-green-600" : wp >= wBlue ? "text-blue-600" : wp >= wYellow ? "text-yellow-600" : "text-red-600";
                          const sp = row.stuffPlus;
                          const stuffColor = sp == null ? "" : sp >= 103 ? "text-green-600" : sp >= 98 ? "text-blue-600" : sp >= 93 ? "text-yellow-600" : "text-red-600";
                          return (
                            <tr key={`arsenal-${row.pitchType}`} className="border-b last:border-0">
                              <td className="py-2 pr-4 font-medium">{PITCH_TYPE_LABELS[row.pitchType] || row.pitchType}</td>
                              <td className="py-2 px-2 text-right text-muted-foreground">{row.usagePct == null ? "—" : `${row.usagePct.toFixed(1)}%`}</td>
                              <td className={`py-2 px-2 text-right font-bold ${whiffColor}`}>{wp == null ? "—" : `${wp.toFixed(1)}%`}</td>
                              <td className={`py-2 pl-2 text-right font-bold ${stuffColor}`}>{fmtWhole(sp)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {isAdmin ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    Internal Power Ratings
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wide">Admin Only</Badge>
                  </CardTitle>
                  <CardDescription>Pitching power rating+ outputs and source metrics.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                    <div className="rounded-lg border bg-background/70 p-3"><div className="text-muted-foreground text-xs">Overall Pitcher Power Rating</div><div className="text-3xl font-bold tracking-tight mt-1">{fmtWhole(internalPowerRatings?.overallPlus)}</div></div>
                    <div className="rounded-lg border bg-background/70 p-3"><div className="text-muted-foreground text-xs">ERA Power Rating+</div><div className="text-3xl font-bold tracking-tight mt-1">{fmtWhole(internalPowerRatings?.eraPlus)}</div></div>
                    <div className="rounded-lg border bg-background/70 p-3"><div className="text-muted-foreground text-xs">WHIP Power Rating+</div><div className="text-3xl font-bold tracking-tight mt-1">{fmtWhole(internalPowerRatings?.whipPlus)}</div></div>
                    <div className="rounded-lg border bg-background/70 p-3"><div className="text-muted-foreground text-xs">K/9 Power Rating+</div><div className="text-3xl font-bold tracking-tight mt-1">{fmtWhole(internalPowerRatings?.k9Plus)}</div></div>
                    <div className="rounded-lg border bg-background/70 p-3"><div className="text-muted-foreground text-xs">BB/9 Power Rating+</div><div className="text-3xl font-bold tracking-tight mt-1">{fmtWhole(internalPowerRatings?.bb9Plus)}</div></div>
                    <div className="rounded-lg border bg-background/70 p-3"><div className="text-muted-foreground text-xs">HR/9 Power Rating+</div><div className="text-3xl font-bold tracking-tight mt-1">{fmtWhole(internalPowerRatings?.hr9Plus)}</div></div>
                    <div className="rounded-lg border bg-background/70 p-3"><div className="text-muted-foreground text-xs">FIP Power Rating+</div><div className="text-3xl font-bold tracking-tight mt-1">{fmtWhole(internalPowerRatings?.fipPlus)}</div></div>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">2025 Input Metrics</p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                      <div className="rounded-lg border bg-background/70 p-3"><div className="text-muted-foreground text-xs">Stuff+</div><div className="font-semibold text-2xl mt-1">{fmt(internalPowerRatings?.metrics.stuff, 1)}</div></div>
                      <div className="rounded-lg border bg-background/70 p-3"><div className="text-muted-foreground text-xs">Whiff%</div><div className="font-semibold text-2xl mt-1">{fmt(internalPowerRatings?.metrics.whiff, 1)}</div></div>
                      <div className="rounded-lg border bg-background/70 p-3"><div className="text-muted-foreground text-xs">BB%</div><div className="font-semibold text-2xl mt-1">{fmt(internalPowerRatings?.metrics.bb, 1)}</div></div>
                      <div className="rounded-lg border bg-background/70 p-3"><div className="text-muted-foreground text-xs">HH%</div><div className="font-semibold text-2xl mt-1">{fmt(internalPowerRatings?.metrics.hh, 1)}</div></div>
                      <div className="rounded-lg border bg-background/70 p-3"><div className="text-muted-foreground text-xs">IZ Whiff%</div><div className="font-semibold text-2xl mt-1">{fmt(internalPowerRatings?.metrics.izWhiff, 1)}</div></div>
                      <div className="rounded-lg border bg-background/70 p-3"><div className="text-muted-foreground text-xs">Chase%</div><div className="font-semibold text-2xl mt-1">{fmt(internalPowerRatings?.metrics.chase, 1)}</div></div>
                      <div className="rounded-lg border bg-background/70 p-3"><div className="text-muted-foreground text-xs">Barrel%</div><div className="font-semibold text-2xl mt-1">{fmt(internalPowerRatings?.metrics.barrel, 1)}</div></div>
                      <div className="rounded-lg border bg-background/70 p-3"><div className="text-muted-foreground text-xs">LD%</div><div className="font-semibold text-2xl mt-1">{fmt(internalPowerRatings?.metrics.ld, 1)}</div></div>
                      <div className="rounded-lg border bg-background/70 p-3"><div className="text-muted-foreground text-xs">Avg EV</div><div className="font-semibold text-2xl mt-1">{fmt(internalPowerRatings?.metrics.avgEv, 1)}</div></div>
                      <div className="rounded-lg border bg-background/70 p-3"><div className="text-muted-foreground text-xs">GB%</div><div className="font-semibold text-2xl mt-1">{fmt(internalPowerRatings?.metrics.gb, 1)}</div></div>
                      <div className="rounded-lg border bg-background/70 p-3"><div className="text-muted-foreground text-xs">IZ%</div><div className="font-semibold text-2xl mt-1">{fmt(internalPowerRatings?.metrics.iz, 1)}</div></div>
                      <div className="rounded-lg border bg-background/70 p-3"><div className="text-muted-foreground text-xs">EV90</div><div className="font-semibold text-2xl mt-1">{fmt(internalPowerRatings?.metrics.ev90, 1)}</div></div>
                      <div className="rounded-lg border bg-background/70 p-3"><div className="text-muted-foreground text-xs">Pull%</div><div className="font-semibold text-2xl mt-1">{fmt(internalPowerRatings?.metrics.pull, 1)}</div></div>
                      <div className="rounded-lg border bg-background/70 p-3"><div className="text-muted-foreground text-xs">LA 10-30%</div><div className="font-semibold text-2xl mt-1">{fmt(internalPowerRatings?.metrics.la1030, 1)}</div></div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
        )}
      </div>
    </DashboardLayout>
  );
}

// ─── Historical Pitcher View ─────────────────────────────────────────
function HistoricalPitcherView({
  row, season, isAdmin,
}: {
  row: any | null;
  season: number;
  isAdmin: boolean;
}) {
  if (!row) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No {season} season data available for this pitcher.
        </CardContent>
      </Card>
    );
  }
  const fmt = (v: number | null | undefined, d = 2) => v == null ? "—" : Number(v).toFixed(d);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Left: pitcher info */}
      <div className="lg:col-span-1 space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{season} Season</CardTitle>
            <CardDescription className="text-xs">Actual stats and scouting grades</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Team</span><span className="text-sm font-semibold">{row.Team || "—"}</span></div>
            <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Conference</span><span className="text-sm font-semibold">{row.Conference || "—"}</span></div>
            <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Throws</span><span className="text-sm font-semibold">{row.ThrowHand || "—"}</span></div>
            <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">IP</span><span className="text-sm font-semibold tabular-nums">{row.IP == null ? "—" : Number(row.IP).toFixed(1)}</span></div>
            <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">G</span><span className="text-sm font-semibold tabular-nums">{row.G ?? "—"}</span></div>
            <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">GS</span><span className="text-sm font-semibold tabular-nums">{row.GS ?? "—"}</span></div>
          </CardContent>
        </Card>
      </div>

      {/* Middle + right: stats and scouting */}
      <div className="lg:col-span-2 space-y-4">
        {/* Headline pitching stats */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{season} Pitching Stats</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">ERA</div>
                <div className="text-2xl font-bold mt-1 tabular-nums">{fmt(row.ERA)}</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">FIP</div>
                <div className="text-2xl font-bold mt-1 tabular-nums">{fmt(row.FIP)}</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">WHIP</div>
                <div className="text-2xl font-bold mt-1 tabular-nums">{fmt(row.WHIP)}</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">K/9</div>
                <div className="text-2xl font-bold mt-1 tabular-nums">{fmt(row.K9)}</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">BB/9</div>
                <div className="text-2xl font-bold mt-1 tabular-nums">{fmt(row.BB9)}</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">HR/9</div>
                <div className="text-2xl font-bold mt-1 tabular-nums">{fmt(row.HR9)}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Scouting grades — public 4 + admin extras (mirrors hitter profile) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{season} Scouting Grades</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <HistoricalPitcherGrade value={row.whiff_score} fullLabel="Whiff%" />
              <HistoricalPitcherGrade value={row.bb_score} fullLabel="BB%" />
              <HistoricalPitcherGrade value={row.barrel_score} fullLabel="Barrel%" />
              <HistoricalPitcherGrade value={row.hh_score} fullLabel="Hard Hit%" />
            </div>
            {isAdmin && (
              <>
                <Separator className="my-4" />
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm font-semibold text-primary">Internal Power Ratings</span>
                  <Badge variant="outline" className="text-xs">Admin Only</Badge>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                  <div className="rounded-lg border border-border bg-muted/50 p-3">
                    <div className="text-xs font-medium text-muted-foreground">Overall PR+</div>
                    <div className="text-2xl font-bold font-mono mt-1">{row.overall_pr_plus != null ? Math.round(row.overall_pr_plus) : "—"}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/50 p-3">
                    <div className="text-xs font-medium text-muted-foreground">ERA PR+</div>
                    <div className="text-2xl font-bold font-mono mt-1">{row.era_pr_plus != null ? Math.round(row.era_pr_plus) : "—"}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/50 p-3">
                    <div className="text-xs font-medium text-muted-foreground">FIP PR+</div>
                    <div className="text-2xl font-bold font-mono mt-1">{row.fip_pr_plus != null ? Math.round(row.fip_pr_plus) : "—"}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/50 p-3">
                    <div className="text-xs font-medium text-muted-foreground">WHIP PR+</div>
                    <div className="text-2xl font-bold font-mono mt-1">{row.whip_pr_plus != null ? Math.round(row.whip_pr_plus) : "—"}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/50 p-3">
                    <div className="text-xs font-medium text-muted-foreground">K/9 PR+</div>
                    <div className="text-2xl font-bold font-mono mt-1">{row.k9_pr_plus != null ? Math.round(row.k9_pr_plus) : "—"}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/50 p-3">
                    <div className="text-xs font-medium text-muted-foreground">BB/9 PR+</div>
                    <div className="text-2xl font-bold font-mono mt-1">{row.bb9_pr_plus != null ? Math.round(row.bb9_pr_plus) : "—"}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/50 p-3">
                    <div className="text-xs font-medium text-muted-foreground">HR/9 PR+</div>
                    <div className="text-2xl font-bold font-mono mt-1">{row.hr9_pr_plus != null ? Math.round(row.hr9_pr_plus) : "—"}</div>
                  </div>
                </div>
                <Separator className="my-4" />
                <div className="text-xs font-medium text-muted-foreground mb-3">{season} Input Metrics</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                  <PitchInputMetric label="Whiff %" value={row.miss_pct} suffix="%" />
                  <PitchInputMetric label="Chase %" value={row.chase_pct} suffix="%" />
                  <PitchInputMetric label="In-Zone Whiff %" value={row.in_zone_whiff_pct} suffix="%" />
                  <PitchInputMetric label="BB %" value={row.bb_pct} suffix="%" />
                  <PitchInputMetric label="Barrel %" value={row.barrel_pct} suffix="%" />
                  <PitchInputMetric label="Hard Hit %" value={row.hard_hit_pct} suffix="%" />
                  <PitchInputMetric label="Avg Exit Velo" value={row.exit_vel} suffix=" mph" />
                  <PitchInputMetric label="EV90 Against" value={row["90th_vel"]} suffix=" mph" />
                  <PitchInputMetric label="GB %" value={row.ground_pct} suffix="%" />
                  <PitchInputMetric label="In-Zone %" value={row.in_zone_pct} suffix="%" />
                  <PitchInputMetric label="Pull % Against" value={row.h_pull_pct} suffix="%" />
                  <PitchInputMetric label="LA 10-30 %" value={row.la_10_30_pct} suffix="%" />
                  <PitchInputMetric label="Line Drive %" value={row.line_pct} suffix="%" />
                  <PitchInputMetric label="Stuff+" value={row.stuff_plus} />
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function HistoricalPitcherGrade({ value, fullLabel }: { value: number | null; fullLabel: string }) {
  if (value == null) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-3" title={fullLabel}>
        <div className="text-xs font-medium opacity-80">{fullLabel}</div>
        <div className="text-2xl font-bold mt-1 text-muted-foreground">—</div>
        <div className="text-xs font-semibold mt-0.5 text-muted-foreground">No Data</div>
      </div>
    );
  }
  const tier =
    value >= 90 ? "bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))] border-[hsl(var(--success)/0.3)]" :
    value >= 75 ? "bg-[hsl(142,71%,45%,0.12)] text-[hsl(142,71%,35%)] border-[hsl(142,71%,45%,0.25)]" :
    value >= 60 ? "bg-[hsl(200,80%,50%,0.12)] text-[hsl(200,80%,35%)] border-[hsl(200,80%,50%,0.25)]" :
    value >= 45 ? "bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))] border-[hsl(var(--warning)/0.3)]" :
    value >= 35 ? "bg-[hsl(25,90%,50%,0.12)] text-[hsl(25,90%,38%)] border-[hsl(25,90%,50%,0.25)]" :
    "bg-destructive/15 text-destructive border-destructive/30";
  const grade =
    value >= 90 ? "Elite" :
    value >= 75 ? "Plus-Plus" :
    value >= 60 ? "Plus" :
    value >= 45 ? "Average" :
    value >= 35 ? "Below Avg" : "Poor";
  return (
    <div className={`rounded-lg border p-3 ${tier}`}>
      <div className="text-xs font-medium opacity-80">{fullLabel}</div>
      <div className="text-2xl font-bold mt-1">{Math.round(value)}</div>
      <div className="text-xs font-semibold mt-0.5">{grade}</div>
    </div>
  );
}

function PitchInputMetric({ label, value, suffix }: { label: string; value: number | null | undefined; suffix?: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/50 p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-xl font-bold font-mono mt-1">
        {value == null ? "—" : `${Number(value).toFixed(1)}${suffix || ""}`}
      </div>
    </div>
  );
}
