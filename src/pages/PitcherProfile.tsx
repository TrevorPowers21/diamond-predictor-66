import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, TrendingUp } from "lucide-react";
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
import { readTeamParkFactorComponents, resolveMetricParkFactor } from "@/lib/parkFactors";

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
const hasAnyNumericValue = (values: string[] | undefined, indexes: number[]) =>
  indexes.some((idx) => {
    const n = Number((values?.[idx] || "").replace(/[%,$]/g, "").trim());
    return Number.isFinite(n);
  });

const pickBestNameTeamRow = (
  rows: Array<{ values?: string[] }>,
  playerName: string,
  teamName: string,
  numericSignalIndexes: number[],
) => {
  const normName = normalize(playerName);
  const normTeam = normalize(teamName);
  if (!normName) return null;

  const byName = rows.filter((r) => normalize(r.values?.[0]) === normName);
  if (byName.length === 0) return null;

  const exactTeam = byName.find((r) => normalize(r.values?.[1]) === normTeam);
  if (exactTeam) return exactTeam;

  const withSignal = byName.find((r) => hasAnyNumericValue(r.values, numericSignalIndexes));
  if (withSignal) return withSignal;

  return byName[0] || null;
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

const resolvePitchingStatsView = (values: string[]) => {
  const toNum = (v: string | undefined) => {
    const n = Number((v || "").replace(/[%,$]/g, "").trim());
    return Number.isFinite(n) ? n : null;
  };
  const legacyEra = toNum(values[3]);
  const isLegacy = legacyEra != null;
  if (isLegacy) {
    return {
      role: values[12] || "",
      g: values[9] || "",
      gs: values[10] || "",
      era: values[3] || "",
      fip: values[4] || "",
      whip: values[5] || "",
      k9: values[6] || "",
      bb9: values[7] || "",
      hr9: values[8] || "",
      ip: values[11] || "",
    };
  }
  return {
    role: values[3] || "",
    g: values[5] || "",
    gs: values[6] || "",
    era: values[7] || "",
    fip: values[8] || "",
    whip: values[9] || "",
    k9: values[10] || "",
    bb9: values[11] || "",
    hr9: values[12] || "",
    ip: values[4] || "",
  };
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
  player_id: string | null;
  player_name: string | null;
  hand: string | null;
  pitch_type: string | null;
  stuff_plus: number | null;
  usage_pct: number | null;
  whiff_pct: number | null;
  pitch_count: number | null;
  total_pitches: number | null;
  overall_stuff_plus: number | null;
};

const PITCH_TYPE_LABELS: Record<string, string> = {
  "4S": "4-Seam",
  SI: "Sinker",
  SL: "Slider",
  SWP: "Sweeper",
  CB: "Curveball",
  CT: "Cutter",
  CH: "Changeup",
  SP: "Splitter",
};

const PITCH_DISPLAY_ORDER = ["4S", "SI", "SL", "SWP", "CB", "CT", "CH", "SP"] as const;

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
    value >= 80 ? "bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))] border-[hsl(var(--success)/0.3)]" :
    value >= 50 ? "bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))] border-[hsl(var(--warning)/0.3)]" :
    "bg-destructive/15 text-destructive border-destructive/30";
  const grade =
    value >= 80 ? "Elite" :
    value >= 70 ? "Plus-Plus" :
    value >= 60 ? "Plus" :
    value >= 50 ? "Average" :
    value >= 40 ? "Below Avg" : "Poor";
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
    enabled: !!id && isDbRoute,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("players")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
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
  const { data: teamDirectory = [] } = useQuery({
    queryKey: ["pitcher-profile-team-directory"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("name, conference, park_factor");
      if (error) throw error;
      return data || [];
    },
  });
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
    queryKey: ["pitcher-profile-pitch-arsenal", id, lookupPlayerName],
    enabled: !!lookupPlayerName,
    queryFn: async () => {
      const byPlayerId = async () => {
        if (!isDbRoute || !id) return [];
        const { data, error } = await supabase
          .from("pitch_arsenal" as any)
          .select("season, player_id, player_name, hand, pitch_type, stuff_plus, usage_pct, whiff_pct, pitch_count, total_pitches, overall_stuff_plus")
          .eq("player_id", id)
          .eq("season", 2025)
          .order("pitch_count", { ascending: false });
        if (error) throw error;
        return (data || []) as PitchArsenalRow[];
      };
      const byPlayerName = async () => {
        if (!lookupPlayerName) return [];
        const { data, error } = await supabase
          .from("pitch_arsenal" as any)
          .select("season, player_id, player_name, hand, pitch_type, stuff_plus, usage_pct, whiff_pct, pitch_count, total_pitches, overall_stuff_plus")
          .eq("player_name", lookupPlayerName)
          .eq("season", 2025)
          .order("pitch_count", { ascending: false });
        if (error) throw error;
        return (data || []) as PitchArsenalRow[];
      };
      const firstPass = await byPlayerId();
      if (firstPass.length > 0) return firstPass;
      return byPlayerName();
    },
  });
  const storageRow = useMemo(() => {
    if (!lookupPlayerName) return null;
    const keys = ["pitching_stats_storage_2025_v1", "pitching_stats_storage_2026_v1"];
    for (const key of keys) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as { rows?: Array<{ values?: string[] }> };
        const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
        const best = pickBestNameTeamRow(rows, lookupPlayerName, lookupTeamName, [7, 8, 9, 10, 11, 12]);
        if (best && Array.isArray(best.values)) return best.values;
      } catch {
        // ignore parse/storage errors
      }
    }
    return null;
  }, [lookupPlayerName, lookupTeamName]);
  const powerRatingsRow = useMemo(() => {
    if (!lookupPlayerName) return null;
    const keys = ["pitching_power_ratings_storage_2025_v1", "pitching_power_ratings_storage_2026_v1"];
    for (const key of keys) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as { rows?: Array<{ values?: string[] }> };
        const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
        const best = pickBestNameTeamRow(rows, lookupPlayerName, lookupTeamName, [16, 17, 18, 22, 30, 31, 32, 33, 34, 35]);
        if (best && Array.isArray(best.values)) return best.values;
      } catch {
        // ignore storage parse errors
      }
    }
    return null;
  }, [lookupPlayerName, lookupTeamName]);

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
    const n = Number((v || "").replace(/[%,$]/g, "").trim());
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
  const teamParkComponents = useMemo(() => readTeamParkFactorComponents(), [teamDirectory]);
  const fullName =
    `${player?.first_name || ""} ${player?.last_name || ""}`.trim() ||
    storageRef?.playerName ||
    "Pitcher";
  const displayTeam = normalizePitcherTeamName(player?.team || storageRow?.[1] || storageRef?.teamName || "") || "—";
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
  const displayConference = player?.conference || conferenceByTeam.get(normalize(displayTeam)) || "—";
  const displayHandedness = player?.handedness || storageRow?.[2] || "—";
  const storageStats = useMemo(() => resolvePitchingStatsView(storageRow || []), [storageRow]);
  const storageEra = storageStats.era ? Number(storageStats.era) : null;
  const storageFip = storageStats.fip ? Number(storageStats.fip) : null;
  const storageWhip = storageStats.whip ? Number(storageStats.whip) : null;
  const storageK9 = storageStats.k9 ? Number(storageStats.k9) : null;
  const storageBb9 = storageStats.bb9 ? Number(storageStats.bb9) : null;
  const storageHr9 = storageStats.hr9 ? Number(storageStats.hr9) : null;
  const storageIp = parseBaseballInnings(storageStats.ip);
  const storageGames = storageStats.g ? Number(storageStats.g) : null;
  const storageGamesStarted = storageStats.gs ? Number(storageStats.gs) : null;
  const derivedRole = (() => {
    const roleRaw = toPitchingRole(storageStats.role);
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
    const avgPark = parkToIndex(resolveMetricParkFactor(teamNameForPark, fallbackPark, "avg", teamParkComponents));
    const obpPark = parkToIndex(resolveMetricParkFactor(teamNameForPark, fallbackPark, "obp", teamParkComponents));
    const isoPark = parkToIndex(resolveMetricParkFactor(teamNameForPark, fallbackPark, "iso", teamParkComponents));
    const eraParkRaw = resolveMetricParkFactor(teamNameForPark, null, "era", teamParkComponents);
    const whipParkRaw = resolveMetricParkFactor(teamNameForPark, null, "whip", teamParkComponents);
    const hr9ParkRaw = resolveMetricParkFactor(teamNameForPark, null, "hr9", teamParkComponents);
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
    let sourceRows = pitchArsenalRows || [];
    if (sourceRows.length === 0) {
      try {
        const raw = localStorage.getItem("pitching_stuff_plus_storage_2025_v1");
        const parsed = raw ? (JSON.parse(raw) as { rows?: Array<Record<string, unknown>> }) : null;
        const localRows = Array.isArray(parsed?.rows) ? parsed.rows : [];
        sourceRows = localRows
          .filter((row) => normalize(String(row.playerName || "")) === normalize(lookupPlayerName))
          .map((row) => ({
            season: 2025,
            player_id: null,
            player_name: String(row.playerName || ""),
            hand: String(row.hand || "") || null,
            pitch_type: String(row.pitchType || "") || null,
            stuff_plus: row.stuffPlus == null ? null : Number(row.stuffPlus),
            usage_pct: row.usagePct == null ? null : Number(row.usagePct),
            whiff_pct: row.whiffPct == null ? null : Number(row.whiffPct),
            pitch_count: row.pitchCount == null ? null : Number(row.pitchCount),
            total_pitches: row.totalPitches == null ? null : Number(row.totalPitches),
            overall_stuff_plus: row.overallStuffPlus == null ? null : Number(row.overallStuffPlus),
          })) as PitchArsenalRow[];
      } catch {
        sourceRows = [];
      }
    }

    const normalized = sourceRows
      .map((row) => ({
        pitchType: String(row.pitch_type || "").trim().toUpperCase(),
        stuffPlus: row.stuff_plus == null ? null : Number(row.stuff_plus),
        usagePct: row.usage_pct == null ? null : Number(row.usage_pct),
        whiffPct: row.whiff_pct == null ? null : Number(row.whiff_pct),
        pitchCount: row.pitch_count == null ? null : Number(row.pitch_count),
        totalPitches: row.total_pitches == null ? null : Number(row.total_pitches),
        overallStuffPlus: row.overall_stuff_plus == null ? null : Number(row.overall_stuff_plus),
      }))
      .filter((r) => r.pitchType.length > 0);

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
  }, [pitchArsenalRows, lookupPlayerName]);

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="p-6 text-muted-foreground">Loading pitcher profile…</div>
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
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge variant="outline">{displayTeam}</Badge>
              <Badge variant="outline" className="text-muted-foreground">{displayConference}</Badge>
              <Badge variant="secondary">{displayHandedness}</Badge>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-1 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Pitcher Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Team</span><span>{displayTeam}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Conference</span><span>{displayConference}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Class</span><span>{player?.class_year || "—"}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Role</span><span>{effectiveRoleDisplay || "—"}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Throws</span><span>{player?.throws_hand || displayHandedness || "—"}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Bats</span><span>{player?.bats_hand || "—"}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Height</span><span>{player?.height_inches ? `${player.height_inches}"` : "—"}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Weight</span><span>{player?.weight ? `${player.weight} lbs` : "—"}</span></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">2025 Pitching Stats</CardTitle>
                <CardDescription>Storage-backed pitching metrics for 2025.</CardDescription>
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
            <div className="grid gap-3 md:grid-cols-3">
              <MetricCard title="Market Value" value={nilFormat(projectedPitching.marketValue ?? nilValuation?.projected_value ?? null)} />
              <MetricCard title="Projected pWAR" value={fmt(projectedPitching.pWar, 2)} />
              <MetricCard
                title="Overall Pitcher Power Rating"
                value={fmtWhole(internalPowerRatings?.overallPlus)}
                subtitle="Weighted blend of ERA+/FIP+/WHIP+/K/9+/BB/9+/HR/9+"
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4" />Projected Outcomes</CardTitle>
                <CardDescription>
                  Independent pitcher projection template. We will add pitcher equations and weighted outputs next.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-md border bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                  Applied Inputs: Role {projectedRole} · Class {projectedClassTransition} · Dev {projectedDevAggressiveness.toFixed(1)}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Role Change</div>
                    <Select
                      value={projectedRole}
                      onValueChange={(v) => updateProjectedInputs({ pitcher_role: v as "SP" | "RP" | "SM" })}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="SP">SP</SelectItem>
                        <SelectItem value="RP">RP</SelectItem>
                        <SelectItem value="SM">SM</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Class Adjustment</div>
                    <Select
                      value={projectedClassTransition}
                      onValueChange={(v) => updateProjectedInputs({ class_transition: v as "FS" | "SJ" | "JS" | "GR" })}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="FS">FS</SelectItem>
                        <SelectItem value="SJ">SJ</SelectItem>
                        <SelectItem value="JS">JS</SelectItem>
                        <SelectItem value="GR">GR</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Dev Aggressiveness</div>
                    <Select
                      value={String(projectedDevAggressiveness)}
                      onValueChange={(v) => updateProjectedInputs({ dev_aggressiveness: Number(v) })}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">0.0</SelectItem>
                        <SelectItem value="0.5">0.5</SelectItem>
                        <SelectItem value="1">1.0</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-7 gap-2 text-sm">
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">pERA</div><div className="font-semibold">{fmt(projectedPitching.pEra, 2)}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">pFIP</div><div className="font-semibold">{fmt(projectedPitching.pFip, 2)}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">pWHIP</div><div className="font-semibold">{fmt(projectedPitching.pWhip, 2)}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">pK/9</div><div className="font-semibold">{fmt(projectedPitching.pK9, 2)}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">pBB/9</div><div className="font-semibold">{fmt(projectedPitching.pBb9, 2)}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">pHR/9</div><div className="font-semibold">{fmt(projectedPitching.pHr9, 2)}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">pRV+</div><div className="font-semibold">{fmtWhole(projectedPitching.pRvPlus)}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">pWAR</div><div className="font-semibold">{fmt(projectedPitching.pWar, 2)}</div></div>
                </div>
                <Separator />
                <p className="text-xs text-muted-foreground">
                  This page is intentionally separate from hitter profile logic so pitcher-specific adjustments can be implemented safely.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Scouting Grades</CardTitle>
                <CardDescription>2025 percentile scores (color-coded)</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <ScoutGrade value={internalPowerRatings?.scores?.stuff ?? null} fullLabel="Stuff+ Score" />
                  <ScoutGrade value={internalPowerRatings?.scores?.whiff ?? null} fullLabel="Whiff% Score" />
                  <ScoutGrade value={internalPowerRatings?.scores?.bb ?? null} fullLabel="BB% Score" />
                  <ScoutGrade value={internalPowerRatings?.scores?.barrel ?? null} fullLabel="Barrel% Score" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Pitch Arsenal</CardTitle>
                <CardDescription>Per-pitch pitch count, usage%, whiff%, and Stuff+ shown horizontally by pitch.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                  <div className="rounded border p-2">
                    <div className="text-muted-foreground text-xs">Overall Stuff+</div>
                    <div className="font-semibold">{fmtWhole(pitchArsenal.overallStuffPlus)}</div>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-muted-foreground text-xs">Overall Usage%</div>
                    <div className="font-semibold">{pitchArsenal.usageTotal == null ? "—" : `${pitchArsenal.usageTotal.toFixed(1)}%`}</div>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-muted-foreground text-xs">Overall Whiff%</div>
                    <div className="font-semibold">{pitchArsenal.overallWhiffPct == null ? "—" : `${pitchArsenal.overallWhiffPct.toFixed(1)}%`}</div>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-muted-foreground text-xs">Total Pitches</div>
                    <div className="font-semibold">{pitchArsenal.totalPitches == null ? "—" : Math.round(pitchArsenal.totalPitches).toString()}</div>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  {pitchArsenal.rows.length === 0 ? (
                    <div className="rounded-lg border px-3 py-3 text-sm text-muted-foreground">No pitch arsenal rows found yet.</div>
                  ) : (
                    <div className="flex gap-2 min-w-max">
                      {pitchArsenal.rows.map((row) => (
                        <div
                          key={`arsenal-${row.pitchType}`}
                          className="w-[150px] rounded-lg border bg-background/70 p-3 space-y-2"
                        >
                          <div className="border-b pb-2">
                            <div className="text-sm font-semibold">{PITCH_TYPE_LABELS[row.pitchType] || row.pitchType}</div>
                          </div>
                          <div className="space-y-1.5 text-sm">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-muted-foreground text-xs">Pitch Count</span>
                              <span className="font-medium">{row.pitchCount == null ? "—" : Math.round(row.pitchCount).toString()}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-muted-foreground text-xs">Usage%</span>
                              <span className="font-medium">{row.usagePct == null ? "—" : `${row.usagePct.toFixed(1)}%`}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-muted-foreground text-xs">Whiff%</span>
                              <span className="font-medium">{row.whiffPct == null ? "—" : `${row.whiffPct.toFixed(1)}%`}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-muted-foreground text-xs">Stuff+</span>
                              <span className="font-medium">{fmtWhole(row.stuffPlus)}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

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
      </div>
    </DashboardLayout>
  );
}
