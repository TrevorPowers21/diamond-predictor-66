import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowUpDown,
  Search,
  Pencil,
  Save,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { recalculatePredictionById } from "@/lib/predictionEngine";
import { useHitterSeedData } from "@/hooks/useHitterSeedData";
import {
  DEFAULT_NIL_TIER_MULTIPLIERS,
  getProgramTierMultiplierByConference,
  getPositionValueMultiplier,
} from "@/lib/nilProgramSpecific";
import { readPitchingWeights } from "@/lib/pitchingEquations";
import { profileRouteFor } from "@/lib/profileRoutes";
import { readPlayerOverrides } from "@/lib/playerOverrides";
import { readTeamParkFactorComponents, resolveMetricParkFactor } from "@/lib/parkFactors";

type SortKey =
  | "name"
  | "p_avg"
  | "p_obp"
  | "p_slg"
  | "p_ops"
  | "p_iso"
  | "p_wrc_plus"
  | "p_war"
  | "p_nil";
type SortDir = "asc" | "desc";
const FAST_DB_SORT_KEYS: SortKey[] = ["p_avg", "p_obp", "p_slg", "p_ops", "p_iso", "p_wrc_plus", "p_war"];

interface ReturnerPlayer {
  id: string;
  prediction_id: string;
  first_name: string;
  last_name: string;
  team: string | null;
  conference: string | null;
  position: string | null;
  class_year: string | null;
  transfer_portal?: boolean | null;
  model_type: "returner" | "transfer";
  status: "active" | "departed" | "archived";
  nil_value: number | null;
  prediction: {
    from_avg: number | null;
    from_obp: number | null;
    from_slg: number | null;
    class_transition: string | null;
    dev_aggressiveness: number | null;
    p_avg: number | null;
    p_obp: number | null;
    p_slg: number | null;
    p_ops: number | null;
    p_iso: number | null;
    p_wrc_plus: number | null;
    power_rating_plus: number | null;
    ev_score: number | null;
    barrel_score: number | null;
    contact_score: number | null;
    chase_score: number | null;
  };
}

interface PitchingDashboardRow {
  id: string;
  playerName: string;
  team: string | null;
  conference: string | null;
  handedness: string | null;
  stuff_score: number | null;
  whiff_score: number | null;
  bb_score: number | null;
  barrel_score: number | null;
  era: number | null;
  fip: number | null;
  whip: number | null;
  k9: number | null;
  bb9: number | null;
  hr9: number | null;
  class_transition: "FS" | "SJ" | "JS" | "GR";
  dev_aggressiveness: number;
  era_pr_plus: number | null;
  fip_pr_plus: number | null;
  whip_pr_plus: number | null;
  k9_pr_plus: number | null;
  bb9_pr_plus: number | null;
  hr9_pr_plus: number | null;
  p_era: number | null;
  p_fip: number | null;
  p_whip: number | null;
  p_k9: number | null;
  p_bb9: number | null;
  p_hr9: number | null;
  p_rv_plus: number | null;
  p_war: number | null;
  market_value: number | null;
}

interface PitchingDashboardFallbackRow {
  player_id: string;
  first_name: string | null;
  last_name: string | null;
  team: string | null;
  conference: string | null;
  position: string | null;
  handedness: string | null;
  class_transition: string | null;
  dev_aggressiveness: number | null;
  p_era: number | null;
  p_fip: number | null;
  p_whip: number | null;
  p_k9: number | null;
  p_bb9: number | null;
  p_hr9: number | null;
  p_rv_plus: number | null;
  p_war: number | null;
}

interface PitchingSeasonFallbackRow {
  player_id: string;
  first_name: string | null;
  last_name: string | null;
  team: string | null;
  conference: string | null;
  position: string | null;
  handedness: string | null;
  era: number | null;
  whip: number | null;
  innings_pitched: number | null;
  pitch_strikeouts: number | null;
  pitch_walks: number | null;
}

const statFormat = (v: number | null | undefined, decimals = 3) => {
  if (v == null) return "—";
  return v >= 1 && decimals === 3 ? v.toFixed(3) : v.toFixed(decimals);
};

const pctFormat = (v: number | null | undefined) => {
  if (v == null) return "—";
  return Math.round(v).toString();
};
const compactDollar = new Intl.NumberFormat("en-US", {
  notation: "compact",
  compactDisplay: "short",
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 1,
});

const moneyFormat = (v: number | null | undefined) => {
  if (v == null) return "—";
  return compactDollar.format(v).replace("k", "K").replace("m", "M").replace("b", "B");
};
const csvEscape = (v: string | number | null | undefined) => {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};
const toNum = (v: string | null | undefined) => {
  if (v == null) return null;
  const n = Number(String(v).replace(/[%,$]/g, "").trim());
  return Number.isFinite(n) ? n : null;
};

const PITCHING_POWER_RATING_WEIGHT = 0.7;
const PITCHING_DEV_FACTOR = 0.06;
const DEFAULT_PITCHING_CLASS_TRANSITION: "FS" | "SJ" | "JS" | "GR" = "SJ";
const DEFAULT_PITCHING_DEV_AGGRESSIVENESS = 0;
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
const parkToIndex = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return 100;
  return Math.abs(v) <= 3 ? v * 100 : v;
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
  // Legacy layout:
  // [0 Name,1 Team,2 Hand,3 ERA,4 FIP,5 WHIP,6 K9,7 BB9,8 HR9,9 G,10 GS,11 IP,12 Role]
  // New layout:
  // [0 Name,1 Team,2 Hand,3 Role,4 IP,5 G,6 GS,7 ERA,8 FIP,9 WHIP,10 K9,11 BB9,12 HR9]
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

const PITCHING_POWER_EQ_DEFAULTS = {
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

const PITCHING_ROLE_OVERRIDE_KEY = "pitching_role_overrides_v1";
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

const readPitchingPowerEqValues = () => {
  const merged = { ...PITCHING_POWER_EQ_DEFAULTS };
  try {
    const raw = localStorage.getItem("admin_dashboard_pitching_power_equation_values_v1");
    if (!raw) return merged;
    const parsed = JSON.parse(raw) as Record<string, string | number>;
    for (const key of Object.keys(PITCHING_POWER_EQ_DEFAULTS) as Array<keyof typeof PITCHING_POWER_EQ_DEFAULTS>) {
      const n = Number(parsed[key]);
      if (Number.isFinite(n)) merged[key] = n;
    }
  } catch {
    // ignore invalid local storage payload
  }
  merged.p_whip_chase_pct_weight = 0.05;
  return merged;
};

const normalizedWeightedSum = (items: Array<{ value: number; weight: number }>) => {
  const weighted = items.reduce((sum, item) => sum + (item.value * item.weight), 0);
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return null;
  return weighted / totalWeight;
};

const computePitchingPrPlusFromScores = (
  scores: {
    stuff: number | null;
    whiff: number | null;
    bb: number | null;
    hh: number | null;
    izWhiff: number | null;
    chase: number | null;
    barrel: number | null;
    ld: number | null;
    avgEv: number | null;
    gb: number | null;
    iz: number | null;
    ev90: number | null;
    pull: number | null;
    la1030: number | null;
  },
  eq: ReturnType<typeof readPitchingPowerEqValues>,
) => {
  const eraPower =
    [scores.stuff, scores.whiff, scores.bb, scores.hh, scores.izWhiff, scores.chase, scores.barrel].every((v) => v != null)
      ? (Number(scores.stuff) * eq.p_era_stuff_plus_weight) +
        (Number(scores.whiff) * eq.p_era_whiff_pct_weight) +
        (Number(scores.bb) * eq.p_era_bb_pct_weight) +
        (Number(scores.hh) * eq.p_era_hh_pct_weight) +
        (Number(scores.izWhiff) * eq.p_era_in_zone_whiff_pct_weight) +
        (Number(scores.chase) * eq.p_era_chase_pct_weight) +
        (Number(scores.barrel) * eq.p_era_barrel_pct_weight)
      : null;
  const whipPower =
    [scores.bb, scores.ld, scores.avgEv, scores.whiff, scores.gb, scores.chase].every((v) => v != null)
      ? normalizedWeightedSum([
          { value: Number(scores.bb), weight: eq.p_whip_bb_pct_weight },
          { value: Number(scores.ld), weight: eq.p_whip_ld_pct_weight },
          { value: Number(scores.avgEv), weight: eq.p_whip_avg_ev_weight },
          { value: Number(scores.whiff), weight: eq.p_whip_whiff_pct_weight },
          { value: Number(scores.gb), weight: eq.p_whip_gb_pct_weight },
          { value: Number(scores.chase), weight: eq.p_whip_chase_pct_weight },
        ])
      : null;
  const k9Power =
    [scores.whiff, scores.stuff, scores.izWhiff, scores.chase].every((v) => v != null)
      ? (Number(scores.whiff) * eq.p_k9_whiff_pct_weight) +
        (Number(scores.stuff) * eq.p_k9_stuff_plus_weight) +
        (Number(scores.izWhiff) * eq.p_k9_in_zone_whiff_pct_weight) +
        (Number(scores.chase) * eq.p_k9_chase_pct_weight)
      : null;
  const bb9Power =
    [scores.bb, scores.iz, scores.chase].every((v) => v != null)
      ? (Number(scores.bb) * eq.p_bb9_bb_pct_weight) +
        (Number(scores.iz) * eq.p_bb9_in_zone_pct_weight) +
        (Number(scores.chase) * eq.p_bb9_chase_pct_weight)
      : null;
  const hr9Power =
    [scores.barrel, scores.ev90, scores.gb, scores.pull, scores.la1030].every((v) => v != null)
      ? (Number(scores.barrel) * eq.p_hr9_barrel_pct_weight) +
        (Number(scores.ev90) * eq.p_hr9_ev90_weight) +
        (Number(scores.gb) * eq.p_hr9_gb_pct_weight) +
        (Number(scores.pull) * eq.p_hr9_pull_pct_weight) +
        (Number(scores.la1030) * eq.p_hr9_la_10_30_pct_weight)
      : null;

  const eraPrPlus = eraPower == null ? null : (eraPower / eq.p_era_ncaa_avg_power_rating) * 100;
  const whipPrPlus = whipPower == null ? null : (whipPower / eq.p_ncaa_avg_whip_power_rating) * 100;
  const k9PrPlus = k9Power == null ? null : (k9Power / eq.p_ncaa_avg_k9_power_rating) * 100;
  const bb9PrPlus = bb9Power == null ? null : (bb9Power / eq.p_ncaa_avg_bb9_power_rating) * 100;
  const hr9PrPlus = hr9Power == null ? null : (hr9Power / eq.p_ncaa_avg_hr9_power_rating) * 100;
  const fipPrPlus =
    hr9PrPlus == null || bb9PrPlus == null || k9PrPlus == null
      ? null
      : (hr9PrPlus * eq.p_fip_hr9_power_rating_plus_weight) +
        (bb9PrPlus * eq.p_fip_bb9_power_rating_plus_weight) +
        (k9PrPlus * eq.p_fip_k9_power_rating_plus_weight);

  return { eraPrPlus, fipPrPlus, whipPrPlus, k9PrPlus, hr9PrPlus, bb9PrPlus };
};

const computeDerived = (avg: number | null, obp: number | null, slg: number | null) => {
  const ncaaAvgWrc = 0.364;
  const ops = obp != null && slg != null ? obp + slg : null;
  const iso = slg != null && avg != null ? slg - avg : null;
  const wrc = avg != null && obp != null && slg != null && iso != null
    ? (0.45 * obp) + (0.3 * slg) + (0.15 * avg) + (0.1 * iso)
    : null;
  const wrcPlus = wrc != null && ncaaAvgWrc !== 0 ? (wrc / ncaaAvgWrc) * 100 : null;
  return { ops, iso, wrcPlus };
};

const computeOWarFromWrcPlus = (wrcPlus: number | null) => {
  if (wrcPlus == null) return null;
  const pa = 260;
  const runsPerPa = 0.13;
  const replacementRuns = (pa / 600) * 25;
  const offValue = (wrcPlus - 100) / 100;
  const raa = offValue * pa * runsPerPa;
  const rar = raa + replacementRuns;
  return rar / 10;
};

const computeNilFallback = ({
  storedNil,
  wrcPlus,
  conference,
  position,
}: {
  storedNil: number | null | undefined;
  wrcPlus: number | null | undefined;
  conference: string | null | undefined;
  position: string | null | undefined;
}) => {
  if (storedNil != null) return storedNil;
  const owar = computeOWarFromWrcPlus(wrcPlus ?? null);
  if (owar == null) return null;
  const ptm = getProgramTierMultiplierByConference(conference, DEFAULT_NIL_TIER_MULTIPLIERS);
  const pvm = getPositionValueMultiplier(position);
  return owar * 25000 * ptm * pvm;
};

const deltaClass = (from: number | null, to: number | null, threshold = 0.001) => {
  if (from == null || to == null) return "text-muted-foreground";
  const diff = to - from;
  if (diff > threshold) return "text-[hsl(var(--success))]";
  if (diff < -threshold) return "text-destructive";
  return "text-muted-foreground";
};

const normalizeName = (value: string | null | undefined) =>
  (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const FIRST_NAME_ALIASES: Record<string, string[]> = {
  christopher: ["chris"],
  matthew: ["matt"],
  michael: ["mike"],
  joseph: ["joe"],
  alexander: ["alex"],
};
const getNameVariants = (fullName: string) => {
  const cleaned = normalizeName(fullName);
  if (!cleaned) return [];
  const parts = cleaned.split(" ").filter(Boolean);
  if (parts.length < 2) return [cleaned];
  const [first, ...rest] = parts;
  const restJoined = rest.join(" ");
  const variants = new Set<string>([cleaned]);
  const aliases = FIRST_NAME_ALIASES[first] || [];
  for (const a of aliases) variants.add(`${a} ${restJoined}`.trim());
  if (first.length > 1) variants.add(`${first[0]} ${restJoined}`.trim());
  return Array.from(variants);
};
const nameTeamKey = (name: string | null | undefined, team: string | null | undefined) =>
  `${normalizeName(name)}|${normalizeName(team)}`;
const erf = (x: number) => {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
};
const scoreFromNormal = (x: number | null, mean: number, sd: number, invert = false) => {
  if (x == null || sd <= 0) return null;
  const cdf = 0.5 * (1 + erf((x - mean) / (sd * Math.SQRT2)));
  const pct = cdf * 100;
  return invert ? 100 - pct : pct;
};
const PITCHING_TEAM_ALIASES: Record<string, string> = {
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
const RETURNING_VIEW_SNAPSHOT_KEY = "returning_players_view_snapshot_v1";

export default function ReturningPlayers() {
  const queryClient = useQueryClient();
  const applyPredictionPatchToCache = useCallback((predictionId: string, patch: Partial<ReturnerPlayer["prediction"]>) => {
    queryClient.setQueryData(
      { queryKey: ["returning-players-2025-unified"] },
      (prev: { rows: ReturnerPlayer[]; total: number } | undefined) => {
        if (!prev) return prev;
        return {
          ...prev,
          rows: prev.rows.map((row) =>
            row.prediction_id === predictionId
              ? {
                  ...row,
                  prediction: {
                    ...row.prediction,
                    ...patch,
                  },
                }
              : row,
          ),
        };
      },
    );
  }, [queryClient]);
  const { hitterStats, powerRatings: powerRatingsData } = useHitterSeedData();
  const seedSource = powerRatingsData.length > 0 && (powerRatingsData[0] as any).source === "supabase" ? "supabase" : "seed";

  const [powerSeedByName, powerSeedByNameTeam] = useMemo(() => {
    const byName = new Map<string, Array<any>>();
    const byNameTeam = new Map<string, any>();
    for (const row of powerRatingsData) {
      const key = normalizeName(row.playerName);
      const arr = byName.get(key) || [];
      arr.push(row);
      byName.set(key, arr);
      const ntKey = nameTeamKey(row.playerName, row.team);
      if (!byNameTeam.has(ntKey)) byNameTeam.set(ntKey, row);
    }
    return [byName, byNameTeam];
  }, [powerRatingsData]);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [positionFilter, setPositionFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(100);
  const [sortKey, setSortKey] = useState<SortKey>("p_wrc_plus");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [bulkEditMode, setBulkEditMode] = useState(false);
  const [editedPlayers, setEditedPlayers] = useState<Record<string, { team?: string | null; position?: string | null }>>({});
  const playerOverrides = useMemo(() => readPlayerOverrides(), []);
  const [showMissingOnly, setShowMissingOnly] = useState(false);
  const [dashboardView, setDashboardView] = useState<"hitting" | "pitching">("hitting");
  const [pitchingSearch, setPitchingSearch] = useState("");
  const [pitchingPage, setPitchingPage] = useState(1);
  const [pitchingPageSize, setPitchingPageSize] = useState<number>(100);
  const skipNextHittingPageResetRef = useRef(false);
  const skipNextPitchingPageResetRef = useRef(false);
  const normalize = (value: string | null | undefined) =>
    (value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 220);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(RETURNING_VIEW_SNAPSHOT_KEY);
      if (!raw) return;
      sessionStorage.removeItem(RETURNING_VIEW_SNAPSHOT_KEY);
      const parsed = JSON.parse(raw) as {
        search?: string;
        positionFilter?: string;
        page?: number;
        pageSize?: number;
        sortKey?: SortKey;
        sortDir?: SortDir;
        showMissingOnly?: boolean;
        dashboardView?: "hitting" | "pitching";
        pitchingSearch?: string;
        pitchingPage?: number;
        pitchingPageSize?: number;
        scrollY?: number;
      };
      if (typeof parsed.search === "string") setSearch(parsed.search);
      if (typeof parsed.positionFilter === "string") setPositionFilter(parsed.positionFilter);
      if (Number.isFinite(parsed.page) && Number(parsed.page) >= 1) setPage(Number(parsed.page));
      if (Number.isFinite(parsed.pageSize) && Number(parsed.pageSize) > 0) setPageSize(Number(parsed.pageSize));
      if (parsed.sortKey) setSortKey(parsed.sortKey);
      if (parsed.sortDir) setSortDir(parsed.sortDir);
      if (typeof parsed.showMissingOnly === "boolean") setShowMissingOnly(parsed.showMissingOnly);
      if (parsed.dashboardView === "hitting" || parsed.dashboardView === "pitching") setDashboardView(parsed.dashboardView);
      if (typeof parsed.pitchingSearch === "string") setPitchingSearch(parsed.pitchingSearch);
      if (Number.isFinite(parsed.pitchingPage) && Number(parsed.pitchingPage) >= 1) setPitchingPage(Number(parsed.pitchingPage));
      if (Number.isFinite(parsed.pitchingPageSize) && Number(parsed.pitchingPageSize) > 0) setPitchingPageSize(Number(parsed.pitchingPageSize));
      skipNextHittingPageResetRef.current = true;
      skipNextPitchingPageResetRef.current = true;
      const y = Number(parsed.scrollY);
      requestAnimationFrame(() => {
        if (Number.isFinite(y) && y >= 0) window.scrollTo({ top: y, behavior: "auto" });
      });
    } catch {
      // ignore malformed snapshot payloads
    }
  }, []);

  const saveViewSnapshot = useCallback(() => {
    try {
      sessionStorage.setItem(
        RETURNING_VIEW_SNAPSHOT_KEY,
        JSON.stringify({
          search,
          positionFilter,
          page,
          pageSize,
          sortKey,
          sortDir,
          showMissingOnly,
          dashboardView,
          pitchingSearch,
          pitchingPage,
          pitchingPageSize,
          scrollY: window.scrollY,
        }),
      );
    } catch {
      // ignore storage write issues
    }
  }, [
    dashboardView,
    page,
    pageSize,
    pitchingPage,
    pitchingPageSize,
    pitchingSearch,
    positionFilter,
    search,
    showMissingOnly,
    sortDir,
    sortKey,
  ]);

  // Fixed scrollbar refs & sync
  const scrollbarRef = useRef<HTMLDivElement>(null);
  const scrollbarInnerRef = useRef<HTMLDivElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const isSyncing = useRef(false);
  const [showFixedScrollbar, setShowFixedScrollbar] = useState(false);
  const [scrollbarPos, setScrollbarPos] = useState({ left: 0, width: 0 });

  // Track table visibility and position
  useEffect(() => {
    const el = tableContainerRef.current;
    if (!el) return;
    const updatePos = () => {
      const rect = el.getBoundingClientRect();
      setScrollbarPos({ left: rect.left, width: rect.width });
    };
    const obs = new IntersectionObserver(
      ([entry]) => {
        setShowFixedScrollbar(entry.isIntersecting);
        if (entry.isIntersecting) updatePos();
      },
      { threshold: 0 },
    );
    obs.observe(el);
    window.addEventListener("resize", updatePos);
    updatePos();
    return () => {
      obs.disconnect();
      window.removeEventListener("resize", updatePos);
    };
  }, []);

  // Sync scrollbar width
  useEffect(() => {
    const table = tableContainerRef.current;
    const inner = scrollbarInnerRef.current;
    if (!table || !inner) return;
    const sync = () => {
      inner.style.width = `${table.scrollWidth}px`;
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(table);
    return () => ro.disconnect();
  }, []);

  const handleScrollbarScroll = useCallback(() => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    if (tableContainerRef.current && scrollbarRef.current) {
      tableContainerRef.current.scrollLeft = scrollbarRef.current.scrollLeft;
    }
    requestAnimationFrame(() => {
      isSyncing.current = false;
    });
  }, []);

  const handleTableScroll = useCallback(() => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    if (scrollbarRef.current && tableContainerRef.current) {
      scrollbarRef.current.scrollLeft = tableContainerRef.current.scrollLeft;
    }
    requestAnimationFrame(() => {
      isSyncing.current = false;
    });
  }, []);

  const { data: playersResult, isLoading } = useQuery({
    queryKey: [
      "returning-players-2025-unified",
      {
        scope: sortKey === "name" || FAST_DB_SORT_KEYS.includes(sortKey) ? "paged" : "global",
        page: sortKey === "name" || FAST_DB_SORT_KEYS.includes(sortKey) ? page : null,
        pageSize: sortKey === "name" || FAST_DB_SORT_KEYS.includes(sortKey) ? pageSize : null,
        positionFilter,
        showMissingOnly,
        debouncedSearch,
        sortKey,
        sortDir,
        seedSource,
      },
    ],
    queryFn: async () => {
      const nameTeamKey = (name: string, team: string | null | undefined) => `${normalize(name)}|${normalize(team || "")}`;
      const statSeedRows = hitterStats as Array<{
        playerName: string;
        team: string | null;
        avg: number | null;
        obp: number | null;
        slg: number | null;
      }>;
      const statsByName = new Map<string, typeof statSeedRows>();
      const statsByNameTeam = new Map<string, (typeof statSeedRows)[number]>();
      for (const row of statSeedRows) {
        const nk = normalize(row.playerName);
        const arr = statsByName.get(nk) || [];
        arr.push(row);
        statsByName.set(nk, arr);
        statsByNameTeam.set(nameTeamKey(row.playerName, row.team), row);
      }

      const toReturnerRow = (
        row: any,
        player: any,
        nilByPlayer: Map<string, number | null>,
      ): ReturnerPlayer => {
        const fullName = `${player.first_name} ${player.last_name}`;
        const seedPowerRow = (() => {
          const direct = powerSeedByNameTeam.get(nameTeamKey(fullName, player.team));
          if (direct) return direct;

          const directByName = powerSeedByName.get(normalizeName(fullName)) || [];
          if (directByName.length === 1) return directByName[0];

          // Fallback for common first-name variants (e.g., Christopher -> Chris).
          const variantCandidates = getNameVariants(fullName)
            .flatMap((v) => powerSeedByName.get(v) || []);
          if (variantCandidates.length === 0) return null;

          const byTeam = variantCandidates.filter(
            (c) => normalizeName(c.team) === normalizeName(player.team),
          );
          if (byTeam.length === 1) return byTeam[0];
          if (variantCandidates.length === 1) return variantCandidates[0];
          return null;
        })();
        const seedEvScore = scoreFromNormal(seedPowerRow?.avgExitVelo ?? null, 86.2, 4.28);
        const seedBarrelScore = scoreFromNormal(seedPowerRow?.barrel ?? null, 17.3, 7.89);
        const seedContactScore = scoreFromNormal(seedPowerRow?.contact ?? null, 77.1, 6.6);
        const seedChaseScore = scoreFromNormal(seedPowerRow?.chase ?? null, 23.1, 5.58, true);
        const candidates = statsByName.get(normalize(fullName)) || [];
        const byTeam = statsByNameTeam.get(nameTeamKey(fullName, player.team));
        const exactByStats = candidates.find((r) =>
          (r.avg == null || row.from_avg == null || Math.round(r.avg * 1000) === Math.round(Number(row.from_avg) * 1000)) &&
          (r.obp == null || row.from_obp == null || Math.round(r.obp * 1000) === Math.round(Number(row.from_obp) * 1000)) &&
          (r.slg == null || row.from_slg == null || Math.round(r.slg * 1000) === Math.round(Number(row.from_slg) * 1000))
        );
        const resolvedTeam2025 = byTeam?.team || exactByStats?.team || (candidates.length === 1 ? candidates[0].team : null) || player.team;

        return {
          id: player.id,
          prediction_id: row.id,
          first_name: player.first_name,
          last_name: player.last_name,
          team: resolvedTeam2025,
          conference: player.conference,
          position: player.position,
          class_year: player.class_year,
          transfer_portal: player.transfer_portal,
          model_type: row.model_type,
          status: row.status,
          nil_value: nilByPlayer.get(player.id) ?? null,
          prediction: {
            from_avg: row.from_avg,
            from_obp: row.from_obp,
            from_slg: row.from_slg,
            class_transition: row.class_transition,
            dev_aggressiveness: row.dev_aggressiveness,
            p_avg: row.p_avg,
            p_obp: row.p_obp,
            p_slg: row.p_slg,
            p_ops: row.p_ops,
            p_iso: row.p_iso,
            p_wrc_plus: row.p_wrc_plus,
            power_rating_plus: row.power_rating_plus,
            ev_score: seedEvScore ?? null,
            barrel_score: seedBarrelScore ?? null,
            contact_score: seedContactScore ?? null,
            chase_score: seedChaseScore ?? null,
          },
        };
      };

      // Fast path: server-side paging for sortable prediction columns when no extra filters are active.
      // This keeps the player dashboard responsive without loading the entire dataset.
      if (
        FAST_DB_SORT_KEYS.includes(sortKey) &&
        positionFilter === "all" &&
        !showMissingOnly &&
        !debouncedSearch
      ) {
        const orderColumn =
          sortKey === "p_war"
            ? "p_wrc_plus" // pWAR is monotonic from pWRC+ in current model
            : sortKey;
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;
        const { data: pageData, error: pageErr, count } = await supabase
          .from("player_predictions")
          .select("*, players!inner(id, first_name, last_name, team, conference, position, class_year, transfer_portal)", { count: "exact" })
          .in("model_type", ["returner", "transfer"])
          .eq("variant", "regular")
          .in("status", ["active", "departed"])
          .order(orderColumn, { ascending: sortDir === "asc", nullsFirst: false })
          .range(from, to);
        if (pageErr) throw pageErr;

        const playerIds = (pageData || []).map((r: any) => r.player_id).filter(Boolean);
        const nilByPlayer = new Map<string, number | null>();
        if (playerIds.length > 0) {
          const NIL_BATCH = 300;
          const nilRowsAll: Array<{ player_id: string; estimated_value: number | null; season: number | null }> = [];
          for (let i = 0; i < playerIds.length; i += NIL_BATCH) {
            const ids = playerIds.slice(i, i + NIL_BATCH);
            const { data: nilRows, error: nilErr } = await supabase
              .from("nil_valuations")
              .select("player_id, estimated_value, season")
              .in("player_id", ids);
            if (nilErr) continue;
            nilRowsAll.push(...((nilRows || []) as Array<{ player_id: string; estimated_value: number | null; season: number | null }>));
          }
          const bySeason = new Map<string, { season: number; value: number | null }>();
          for (const row of nilRowsAll) {
            const curr = bySeason.get(row.player_id);
            const season = Number(row.season) || 0;
            if (!curr || season > curr.season) bySeason.set(row.player_id, { season, value: row.estimated_value });
          }
          for (const [pid, val] of bySeason.entries()) nilByPlayer.set(pid, val.value);
        }

        const rows = (pageData || []).map((row: any) => toReturnerRow(row, row.players, nilByPlayer));
        return { rows, total: count ?? rows.length };
      }

      // For other stat-column sorts, compute sort globally, then page that sorted set.
      if (sortKey !== "name") {
        let allData: any[] = [];
        let predFrom = 0;
        const PRED_PAGE_SIZE = 1000;
        while (true) {
          const { data, error } = await supabase
            .from("player_predictions")
            .select("*, players!inner(id, first_name, last_name, team, conference, position, class_year, transfer_portal)")
            .in("model_type", ["returner", "transfer"])
            .eq("variant", "regular")
            .in("status", ["active", "departed"])
            .range(predFrom, predFrom + PRED_PAGE_SIZE - 1);
          if (error) throw error;
          allData = allData.concat(data || []);
          if (!data || data.length < PRED_PAGE_SIZE) break;
          predFrom += PRED_PAGE_SIZE;
        }

        const byPlayer = new Map<string, any>();
        for (const row of allData || []) {
          const pid = row.players.id;
          const existing = byPlayer.get(pid);
          if (!existing) {
            byPlayer.set(pid, row);
            continue;
          }
          const rowHasFrom = row.from_avg != null || row.from_obp != null || row.from_slg != null;
          const existingHasFrom = existing.from_avg != null || existing.from_obp != null || existing.from_slg != null;
          const rowHasPred =
            row.p_avg != null && row.p_obp != null && row.p_slg != null && row.p_ops != null && row.p_iso != null && row.p_wrc_plus != null;
          const existingHasPred =
            existing.p_avg != null && existing.p_obp != null && existing.p_slg != null && existing.p_ops != null && existing.p_iso != null && existing.p_wrc_plus != null;
          const rowHasScout = row.ev_score != null || row.barrel_score != null || row.whiff_score != null || row.chase_score != null;
          const existingHasScout = existing.ev_score != null || existing.barrel_score != null || existing.whiff_score != null || existing.chase_score != null;
          const rowScore =
            ((row.players.transfer_portal === true && row.model_type === "transfer") ||
              (row.players.transfer_portal !== true && row.model_type === "returner")
              ? 6 : 0) +
            (rowHasPred ? 5 : 0) +
            (rowHasScout ? 2 : 0) +
            (row.model_type === "transfer" ? 3 : 0) +
            (row.status === "active" ? 2 : 0) +
            (rowHasFrom ? 1 : 0);
          const existingScore =
            ((existing.players.transfer_portal === true && existing.model_type === "transfer") ||
              (existing.players.transfer_portal !== true && existing.model_type === "returner")
              ? 6 : 0) +
            (existingHasPred ? 5 : 0) +
            (existingHasScout ? 2 : 0) +
            (existing.model_type === "transfer" ? 3 : 0) +
            (existing.status === "active" ? 2 : 0) +
            (existingHasFrom ? 1 : 0);
          if (rowScore > existingScore) byPlayer.set(pid, row);
          else if (rowScore === existingScore) {
            const rowTs = new Date(row.updated_at || 0).getTime();
            const existingTs = new Date(existing.updated_at || 0).getTime();
            if (rowTs > existingTs) byPlayer.set(pid, row);
          }
        }

        const dedupedRows = Array.from(byPlayer.values());
        const playerIds = dedupedRows.map((r: any) => r.player_id).filter(Boolean);
        const nilByPlayer = new Map<string, number | null>();
        if (playerIds.length > 0) {
          const NIL_BATCH = 300;
          const nilRowsAll: Array<{ player_id: string; estimated_value: number | null; season: number | null }> = [];
          for (let i = 0; i < playerIds.length; i += NIL_BATCH) {
            const ids = playerIds.slice(i, i + NIL_BATCH);
            const { data: nilRows, error: nilErr } = await supabase
              .from("nil_valuations")
              .select("player_id, estimated_value, season")
              .in("player_id", ids);
            if (nilErr) continue;
            nilRowsAll.push(...((nilRows || []) as Array<{ player_id: string; estimated_value: number | null; season: number | null }>));
          }
          const bySeason = new Map<string, { season: number; value: number | null }>();
          for (const row of nilRowsAll) {
            const curr = bySeason.get(row.player_id);
            const season = Number(row.season) || 0;
            if (!curr || season > curr.season) bySeason.set(row.player_id, { season, value: row.estimated_value });
          }
          for (const [pid, val] of bySeason.entries()) nilByPlayer.set(pid, val.value);
        }

        let allRows = dedupedRows.map((row: any) => toReturnerRow(row, row.players, nilByPlayer));
        if (positionFilter !== "all") allRows = allRows.filter((p) => p.position === positionFilter);
        if (showMissingOnly) allRows = allRows.filter((p) => !p.team);
        if (debouncedSearch) {
          const q = debouncedSearch.toLowerCase();
          allRows = allRows.filter(
            (p) =>
              `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) ||
              (p.team || "").toLowerCase().includes(q) ||
              (p.conference || "").toLowerCase().includes(q),
          );
        }

        const metricFor = (p: ReturnerPlayer): number => {
          if (sortKey === "p_avg") return p.prediction.p_avg ?? -999;
          if (sortKey === "p_obp") return p.prediction.p_obp ?? -999;
          if (sortKey === "p_slg") return p.prediction.p_slg ?? -999;
          if (sortKey === "p_ops") return p.prediction.p_ops ?? computeDerived(p.prediction.p_avg, p.prediction.p_obp, p.prediction.p_slg).ops ?? -999;
          if (sortKey === "p_iso") return p.prediction.p_iso ?? computeDerived(p.prediction.p_avg, p.prediction.p_obp, p.prediction.p_slg).iso ?? -999;
          if (sortKey === "p_wrc_plus") return p.prediction.p_wrc_plus ?? -999;
          if (sortKey === "p_war") return computeOWarFromWrcPlus(p.prediction.p_wrc_plus) ?? -999;
          if (sortKey === "p_nil") return computeNilFallback({ storedNil: p.nil_value, wrcPlus: p.prediction.p_wrc_plus, conference: p.conference, position: p.position }) ?? -999;
          return -999;
        };
        allRows.sort((a, b) => {
          const av = metricFor(a);
          const bv = metricFor(b);
          return sortDir === "asc" ? av - bv : bv - av;
        });

        return { rows: allRows, total: allRows.length };
      }

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      let playersQuery = supabase
        .from("players")
        .select("id, first_name, last_name, team, conference, position, class_year, transfer_portal", { count: "exact" })
        .order("last_name", { ascending: true })
        .order("first_name", { ascending: true })
        .range(from, to);
      if (positionFilter !== "all") playersQuery = playersQuery.eq("position", positionFilter);
      if (showMissingOnly) playersQuery = playersQuery.is("team", null);
      if (debouncedSearch) {
        const q = debouncedSearch.replace(/[%]/g, "").trim();
        if (q) {
          playersQuery = playersQuery.or(
            `first_name.ilike.%${q}%,last_name.ilike.%${q}%,team.ilike.%${q}%,conference.ilike.%${q}%`,
          );
        }
      }
      const { data: playerRows, error: playersErr, count } = await playersQuery;
      if (playersErr) throw playersErr;

      const playerIds = (playerRows || []).map((r: any) => r.id).filter(Boolean);
      if (playerIds.length === 0) return { rows: [] as ReturnerPlayer[], total: count ?? 0 };

      const { data: allData, error: predErr } = await supabase
        .from("player_predictions")
        .select("*")
        .in("player_id", playerIds)
        .in("model_type", ["returner", "transfer"])
        .eq("variant", "regular")
        .in("status", ["active", "departed"]);
      if (predErr) throw predErr;

      const nilByPlayer = new Map<string, number | null>();
      if (playerIds.length > 0) {
        // Avoid oversized `in (...)` query strings by fetching NIL in chunks.
        const NIL_BATCH = 300;
        const nilRowsAll: Array<{ player_id: string; estimated_value: number | null; season: number | null }> = [];
        for (let i = 0; i < playerIds.length; i += NIL_BATCH) {
          const ids = playerIds.slice(i, i + NIL_BATCH);
          const { data: nilRows, error: nilErr } = await supabase
            .from("nil_valuations")
            .select("player_id, estimated_value, season")
            .in("player_id", ids);
          if (nilErr) {
            console.warn("NIL query failed for batch; continuing without NIL values for this chunk.", nilErr);
            continue;
          }
          nilRowsAll.push(...((nilRows || []) as Array<{ player_id: string; estimated_value: number | null; season: number | null }>));
        }
        const bySeason = new Map<string, { season: number; value: number | null }>();
        for (const row of nilRowsAll) {
          const curr = bySeason.get(row.player_id);
          const season = Number(row.season) || 0;
          if (!curr || season > curr.season) bySeason.set(row.player_id, { season, value: row.estimated_value });
        }
        for (const [pid, val] of bySeason.entries()) nilByPlayer.set(pid, val.value);
      }

      const playerById = new Map<string, any>();
      for (const p of playerRows || []) playerById.set(p.id, p);
      const byPlayer = new Map<string, any>();
      for (const row of allData || []) {
        const currentPlayer = playerById.get(row.player_id);
        if (!currentPlayer) continue;
        const existing = byPlayer.get(row.player_id);
        if (!existing) {
          byPlayer.set(row.player_id, row);
          continue;
        }
        const rowHasFrom = row.from_avg != null || row.from_obp != null || row.from_slg != null;
        const existingHasFrom = existing.from_avg != null || existing.from_obp != null || existing.from_slg != null;
        const rowHasPred =
          row.p_avg != null &&
          row.p_obp != null &&
          row.p_slg != null &&
          row.p_ops != null &&
          row.p_iso != null &&
          row.p_wrc_plus != null;
        const rowHasScout =
          row.ev_score != null ||
          row.barrel_score != null ||
          row.whiff_score != null ||
          row.chase_score != null;
        const existingHasPred =
          existing.p_avg != null &&
          existing.p_obp != null &&
          existing.p_slg != null &&
          existing.p_ops != null &&
          existing.p_iso != null &&
          existing.p_wrc_plus != null;
        const existingHasScout =
          existing.ev_score != null ||
          existing.barrel_score != null ||
          existing.whiff_score != null ||
          existing.chase_score != null;
        const rowScore =
          ((currentPlayer.transfer_portal === true && row.model_type === "transfer") ||
            (currentPlayer.transfer_portal !== true && row.model_type === "returner")
            ? 6
            : 0) +
          (rowHasPred ? 5 : 0) +
          (rowHasScout ? 2 : 0) +
          (row.model_type === "transfer" ? 3 : 0) +
          (row.status === "active" ? 2 : 0) +
          (rowHasFrom ? 1 : 0);
        const existingScore =
          ((currentPlayer.transfer_portal === true && existing.model_type === "transfer") ||
            (currentPlayer.transfer_portal !== true && existing.model_type === "returner")
            ? 6
            : 0) +
          (existingHasPred ? 5 : 0) +
          (existingHasScout ? 2 : 0) +
          (existing.model_type === "transfer" ? 3 : 0) +
          (existing.status === "active" ? 2 : 0) +
          (existingHasFrom ? 1 : 0);
        if (rowScore > existingScore) {
          byPlayer.set(row.player_id, row);
          continue;
        }
        if (rowScore === existingScore) {
          const rowTs = new Date(row.updated_at || 0).getTime();
          const existingTs = new Date(existing.updated_at || 0).getTime();
          if (rowTs > existingTs) byPlayer.set(row.player_id, row);
        }
      }

      const rows = (playerRows || []).map((player: any) => {
        const row = byPlayer.get(player.id);
        if (!row) return null;
        return toReturnerRow(row, player, nilByPlayer);
      }).filter(Boolean) as ReturnerPlayer[];

      return { rows, total: count ?? 0 };
    },
  });
  const players = playersResult?.rows ?? [];
  const totalCount = playersResult?.total ?? 0;
  const hittingBlankMarketRows = useMemo(() => {
    return players
      .map((p) => {
        const effectivePosition = playerOverrides[p.id]?.position ?? p.position;
        const marketValue = computeNilFallback({
          storedNil: p.nil_value,
          wrcPlus: p.prediction.p_wrc_plus,
          conference: p.conference,
          position: effectivePosition,
        });
        if (marketValue != null) return null;
        return {
          player: `${p.first_name} ${p.last_name}`,
          school: p.team || "",
          conference: p.conference || "",
          source: "Hitting",
        };
      })
      .filter(Boolean) as Array<{ player: string; school: string; conference: string; source: string }>;
  }, [players, playerOverrides]);

  const { data: teamsDirectory = [] } = useQuery({
    queryKey: ["teams-directory-for-player-dashboard-edit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("name, conference, park_factor");
      if (error) throw error;
      return (data || []) as Array<{ name: string; conference: string | null; park_factor: number | null }>;
    },
  });

  const bulkSave = useMutation({
    mutationFn: async () => {
      const entries = Object.entries(editedPlayers);
      if (entries.length === 0) return;
      const teamByNorm = new Map<string, { name: string; conference: string | null }>();
      for (const t of teamsDirectory) {
        const key = normalize(t.name);
        if (!key) continue;
        if (!teamByNorm.has(key)) teamByNorm.set(key, t);
      }

      const invalidTeams = new Set<string>();
      const updates: Array<{ playerId: string; payload: Record<string, string | null> }> = [];
      for (const [playerId, data] of entries) {
        const payload: Record<string, string | null> = {};
        if (Object.prototype.hasOwnProperty.call(data, "position")) {
          payload.position = data.position ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(data, "team")) {
          const rawTeam = (data.team || "").trim();
          if (!rawTeam) {
            payload.team = null;
            payload.conference = null;
          } else {
            const match = teamByNorm.get(normalize(rawTeam));
            if (!match) {
              invalidTeams.add(rawTeam);
            } else {
              payload.team = match.name;
              payload.conference = match.conference ?? null;
            }
          }
        }
        if (Object.keys(payload).length > 0) {
          updates.push({ playerId, payload });
        }
      }

      if (invalidTeams.size > 0) {
        const sample = Array.from(invalidTeams).slice(0, 8).join(", ");
        throw new Error(`Team name(s) not found in Teams dashboard: ${sample}`);
      }

      const results = await Promise.all(
        updates.map(({ playerId, payload }) => supabase.from("players").update(payload).eq("id", playerId)),
      );
      const errors = results.filter((r) => r.error);
      if (errors.length > 0) throw new Error(`${errors.length} updates failed`);
      return updates.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["returning-players-2025-unified"] });
      setEditedPlayers({});
      setBulkEditMode(false);
      toast.success(`Updated ${count} player(s)`);
    },
    onError: (e) => toast.error(`Bulk save failed: ${e.message}`),
  });

  const updateClassTransition = useMutation({
    mutationFn: async ({ predictionId, value }: { predictionId: string; value: string }) => {
      const result = await recalculatePredictionById(predictionId, { class_transition: value });
      return { predictionId, value, result };
    },
    onSuccess: ({ predictionId, value, result }) => {
      applyPredictionPatchToCache(predictionId, {
        class_transition: value,
        ...(result?.prediction || {}),
      } as Partial<ReturnerPlayer["prediction"]>);
      queryClient.invalidateQueries({ queryKey: ["returning-players-2025-unified"] });
      toast.success("Class adjustment updated");
    },
    onError: (e) => toast.error(`Class adjustment failed: ${e.message}`),
  });

  const updateDevAgg = useMutation({
    mutationFn: async ({ predictionId, value }: { predictionId: string; value: number }) => {
      const result = await recalculatePredictionById(predictionId, { dev_aggressiveness: value });
      return { predictionId, value, result };
    },
    onSuccess: ({ predictionId, value, result }) => {
      applyPredictionPatchToCache(predictionId, {
        dev_aggressiveness: value,
        ...(result?.prediction || {}),
      } as Partial<ReturnerPlayer["prediction"]>);
      queryClient.invalidateQueries({ queryKey: ["returning-players-2025-unified"] });
      toast.success("Dev aggressiveness updated");
    },
    onError: (e) => toast.error(`Dev aggressiveness failed: ${e.message}`),
  });

  const applyTemplateDefaults = useMutation({
    mutationFn: async () => {
      const { data: allReturnerPreds, error } = await supabase
        .from("player_predictions")
        .select("id")
        .eq("model_type", "returner")
        .eq("variant", "regular")
        .in("status", ["active", "departed"]);
      if (error) throw error;
      const returnerRows = (allReturnerPreds || []).map((r) => ({ prediction_id: r.id }));
      const BATCH = 40;
      for (let i = 0; i < returnerRows.length; i += BATCH) {
        const batch = returnerRows.slice(i, i + BATCH);
        await Promise.all(
          batch.map(async (p) => {
            await recalculatePredictionById(p.prediction_id, { class_transition: "SJ", dev_aggressiveness: 0.0 });
          }),
        );
      }
      return returnerRows.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["returning-players-2025-unified"] });
      toast.success(`Applied template to ${count} returner rows`);
    },
    onError: (e) => toast.error(`Template apply failed: ${e.message}`),
  });

  const handleEditField = (playerId: string, field: "team" | "position", value: string) => {
    setEditedPlayers((prev) => ({
      ...prev,
      [playerId]: { ...prev[playerId], [field]: value || null },
    }));
  };

  const positions = useMemo(() => {
    const set = new Set(players.map((p) => p.position).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [players]);

  const sortedRows = players;

  useEffect(() => {
    if (skipNextHittingPageResetRef.current) {
      skipNextHittingPageResetRef.current = false;
      return;
    }
    setPage(1);
  }, [search, positionFilter, showMissingOnly, sortKey, sortDir, pageSize]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedPlayers = useMemo(() => {
    if (sortKey === "name" || FAST_DB_SORT_KEYS.includes(sortKey)) return sortedRows;
    const from = (currentPage - 1) * pageSize;
    const to = from + pageSize;
    return sortedRows.slice(from, to);
  }, [sortKey, sortedRows, currentPage, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const visiblePages = useMemo(() => {
    if (totalPages <= 11) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages = new Set<number>([
      1, 2, 3, 4, 5,
      totalPages - 1, totalPages,
      currentPage - 2, currentPage - 1, currentPage, currentPage + 1, currentPage + 2,
    ]);
    return Array.from(pages)
      .filter((p) => p >= 1 && p <= totalPages)
      .sort((a, b) => a - b);
  }, [currentPage, totalPages]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const teamsByNorm = useMemo(() => {
    const map = new Map<string, { name: string; conference: string | null; park_factor: number | null }>();
    for (const t of teamsDirectory) {
      const key = normalize(t.name);
      if (!key) continue;
      if (!map.has(key)) map.set(key, t);
    }
    return map;
  }, [teamsDirectory]);
  const teamParkComponents = useMemo(() => readTeamParkFactorComponents(), [teamsDirectory]);
  const normalizePitchingTeam = useCallback((team: string | null | undefined) => {
    const raw = (team || "").trim();
    if (!raw) return "";
    const alias = PITCHING_TEAM_ALIASES[normalize(raw)];
    return alias || raw;
  }, []);
  const { data: pitchingSupabaseRows = [] } = useQuery({
    queryKey: ["pitching-dashboard-supabase-fallback"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_predictions")
        .select(`
          player_id,
          class_transition,
          dev_aggressiveness,
          p_era,
          p_fip,
          p_whip,
          p_k9,
          p_bb9,
          p_hr9,
          p_rv_plus,
          p_war,
          updated_at,
          players!inner(
            id,
            first_name,
            last_name,
            team,
            conference,
            position,
            handedness
          )
        `)
        .eq("variant", "regular")
        .in("status", ["active", "departed"])
        .or("p_era.not.is.null,p_fip.not.is.null,p_whip.not.is.null,p_k9.not.is.null,p_bb9.not.is.null,p_hr9.not.is.null,p_rv_plus.not.is.null,p_war.not.is.null");
      if (error) throw error;
      const rows = (data || []) as Array<any>;
      const byPlayer = new Map<string, any>();
      const metricCount = (r: any) =>
        [r?.p_era, r?.p_fip, r?.p_whip, r?.p_k9, r?.p_bb9, r?.p_hr9, r?.p_rv_plus, r?.p_war].filter((v) => v != null).length;
      for (const r of rows) {
        const pid = String(r.player_id || "");
        if (!pid) continue;
        const existing = byPlayer.get(pid);
        if (!existing) {
          byPlayer.set(pid, r);
          continue;
        }
        const scoreNew = metricCount(r);
        const scoreOld = metricCount(existing);
        if (scoreNew > scoreOld) {
          byPlayer.set(pid, r);
          continue;
        }
        if (scoreNew === scoreOld) {
          const tsNew = new Date(r.updated_at || 0).getTime();
          const tsOld = new Date(existing.updated_at || 0).getTime();
          if (tsNew > tsOld) byPlayer.set(pid, r);
        }
      }
      return Array.from(byPlayer.values()).map((r) => {
        const p = Array.isArray(r.players) ? r.players[0] : r.players;
        return {
          player_id: String(r.player_id),
          first_name: p?.first_name ?? null,
          last_name: p?.last_name ?? null,
          team: p?.team ?? null,
          conference: p?.conference ?? null,
          position: p?.position ?? null,
          handedness: p?.handedness ?? null,
          class_transition: r.class_transition ?? null,
          dev_aggressiveness: r.dev_aggressiveness ?? null,
          p_era: r.p_era ?? null,
          p_fip: r.p_fip ?? null,
          p_whip: r.p_whip ?? null,
          p_k9: r.p_k9 ?? null,
          p_bb9: r.p_bb9 ?? null,
          p_hr9: r.p_hr9 ?? null,
          p_rv_plus: r.p_rv_plus ?? null,
          p_war: r.p_war ?? null,
        } as PitchingDashboardFallbackRow;
      });
    },
  });
  const { data: pitchingSeasonFallbackRows = [] } = useQuery({
    queryKey: ["pitching-dashboard-season-stats-fallback"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("season_stats")
        .select(`
          player_id,
          era,
          whip,
          innings_pitched,
          pitch_strikeouts,
          pitch_walks,
          players!inner(
            id,
            first_name,
            last_name,
            team,
            conference,
            position,
            handedness
          )
        `)
        .eq("season", 2025)
        .or("era.not.is.null,whip.not.is.null,innings_pitched.not.is.null,pitch_strikeouts.gt.0,pitch_walks.gt.0");
      if (error) throw error;
      return ((data || []) as Array<any>).map((r) => {
        const p = Array.isArray(r.players) ? r.players[0] : r.players;
        return {
          player_id: String(r.player_id),
          first_name: p?.first_name ?? null,
          last_name: p?.last_name ?? null,
          team: p?.team ?? null,
          conference: p?.conference ?? null,
          position: p?.position ?? null,
          handedness: p?.handedness ?? null,
          era: r.era ?? null,
          whip: r.whip ?? null,
          innings_pitched: r.innings_pitched ?? null,
          pitch_strikeouts: r.pitch_strikeouts ?? null,
          pitch_walks: r.pitch_walks ?? null,
        } as PitchingSeasonFallbackRow;
      });
    },
  });
  const pitchingRows = useMemo<PitchingDashboardRow[]>(() => {
    const eq = readPitchingWeights();
    const powerEq = readPitchingPowerEqValues();
    let roleOverrides: Record<string, "SP" | "RP" | "SM"> = {};
    try {
      const rawOverrides = localStorage.getItem(PITCHING_ROLE_OVERRIDE_KEY);
      if (rawOverrides) {
        const parsed = JSON.parse(rawOverrides) as Record<string, "SP" | "RP" | "SM">;
        if (parsed && typeof parsed === "object") roleOverrides = parsed;
      }
    } catch {
      // ignore malformed role overrides
    }
    const scoringByNameTeam = new Map<string, {
      stuff: number | null;
      whiff: number | null;
      bb: number | null;
      barrel: number | null;
      eraPrPlus: number | null;
      fipPrPlus: number | null;
      whipPrPlus: number | null;
      k9PrPlus: number | null;
      hr9PrPlus: number | null;
      bb9PrPlus: number | null;
    }>();
    const scoringByName = new Map<string, Array<{
      stuff: number | null;
      whiff: number | null;
      bb: number | null;
      barrel: number | null;
      eraPrPlus: number | null;
      fipPrPlus: number | null;
      whipPrPlus: number | null;
      k9PrPlus: number | null;
      hr9PrPlus: number | null;
      bb9PrPlus: number | null;
    }>>();
    try {
      const rawPower = localStorage.getItem("pitching_power_ratings_storage_2025_v1");
      if (rawPower) {
        const parsedPower = JSON.parse(rawPower) as { rows?: Array<{ values?: string[] }> };
        const powerRows = Array.isArray(parsedPower.rows) ? parsedPower.rows : [];
        for (const pr of powerRows) {
          const values = Array.isArray(pr.values) ? pr.values : [];
          const name = (values[0] || "").trim();
          const team = normalizePitchingTeam(values[1]);
          if (!name) continue;
          const scoreObj = {
            stuff: toNum(values[16]),
            whiff: toNum(values[17]),
            bb: toNum(values[18]),
            hh: toNum(values[19]),
            izWhiff: toNum(values[20]),
            chase: toNum(values[21]),
            barrel: toNum(values[22]),
            ld: toNum(values[23]),
            avgEv: toNum(values[24]),
            gb: toNum(values[25]),
            iz: toNum(values[26]),
            ev90: toNum(values[27]),
            pull: toNum(values[28]),
            la1030: toNum(values[29]),
            eraPrPlus: null as number | null,
            fipPrPlus: null as number | null,
            whipPrPlus: null as number | null,
            k9PrPlus: null as number | null,
            hr9PrPlus: null as number | null,
            bb9PrPlus: null as number | null,
          };
          const recomputed = computePitchingPrPlusFromScores(scoreObj, powerEq);
          scoreObj.eraPrPlus = recomputed.eraPrPlus ?? toNum(values[30]);
          scoreObj.fipPrPlus = recomputed.fipPrPlus ?? toNum(values[31]);
          scoreObj.whipPrPlus = recomputed.whipPrPlus ?? toNum(values[32]);
          scoreObj.k9PrPlus = recomputed.k9PrPlus ?? toNum(values[33]);
          scoreObj.hr9PrPlus = recomputed.hr9PrPlus ?? toNum(values[34]);
          scoreObj.bb9PrPlus = recomputed.bb9PrPlus ?? toNum(values[35]);
          scoringByNameTeam.set(nameTeamKey(name, team), scoreObj);
          const nameKey = normalizeName(name);
          const bucket = scoringByName.get(nameKey) || [];
          bucket.push(scoreObj);
          scoringByName.set(nameKey, bucket);
        }
      }
    } catch {
      // ignore malformed local storage
    }

    const raw = localStorage.getItem("pitching_stats_storage_2025_v1");
    if (!raw) {
      const rowsFromPredictions = pitchingSupabaseRows
        .map((r, idx) => {
          const playerName = `${r.first_name || ""} ${r.last_name || ""}`.trim();
          if (!playerName) return null;
          const normalizedTeam = normalizePitchingTeam(r.team);
          const teamMatch = teamsByNorm.get(normalize(normalizedTeam));
          const projectedRole = toPitchingRole(r.position) || "SM";
          const pitchingTierMultipliers = {
            sec: eq.market_tier_sec,
            p4: eq.market_tier_acc_big12,
            bigTen: eq.market_tier_big_ten,
            strongMid: eq.market_tier_strong_mid,
            lowMajor: eq.market_tier_low_major,
          };
          const conferenceForMarket = teamMatch?.conference || r.conference || null;
          const ptm = getProgramTierMultiplierByConference(conferenceForMarket, pitchingTierMultipliers);
          const pvm = getPitchingPvfForRole(projectedRole, eq);
          const marketEligible = canShowPitchingMarketValue(normalizedTeam, conferenceForMarket);
          const pWar = r.p_war == null ? null : Number(r.p_war);
          const marketValue = !marketEligible || pWar == null ? null : pWar * eq.market_dollars_per_war * ptm * pvm;
          return {
            id: r.player_id || `pitching-fallback-${idx}`,
            playerName,
            team: normalizedTeam || null,
            conference: conferenceForMarket,
            handedness: (r.handedness || "").trim() || null,
            class_transition: (r.class_transition || DEFAULT_PITCHING_CLASS_TRANSITION).toUpperCase(),
            dev_aggressiveness: Number.isFinite(Number(r.dev_aggressiveness)) ? Number(r.dev_aggressiveness) : DEFAULT_PITCHING_DEV_AGGRESSIVENESS,
            stuff_score: null,
            whiff_score: null,
            bb_score: null,
            barrel_score: null,
            era_pr_plus: null,
            fip_pr_plus: null,
            whip_pr_plus: null,
            k9_pr_plus: null,
            hr9_pr_plus: null,
            bb9_pr_plus: null,
            era: null,
            fip: null,
            whip: null,
            k9: null,
            bb9: null,
            hr9: null,
            p_era: r.p_era,
            p_fip: r.p_fip,
            p_whip: r.p_whip,
            p_k9: r.p_k9,
            p_bb9: r.p_bb9,
            p_hr9: r.p_hr9,
            p_rv_plus: r.p_rv_plus,
            p_war: pWar,
            market_value: marketValue,
          } as PitchingDashboardRow;
        })
        .filter(Boolean) as PitchingDashboardRow[];
      if (rowsFromPredictions.length > 0) return rowsFromPredictions;

      return pitchingSeasonFallbackRows
        .map((r, idx) => {
          const playerName = `${r.first_name || ""} ${r.last_name || ""}`.trim();
          if (!playerName) return null;
          const normalizedTeam = normalizePitchingTeam(r.team);
          const teamMatch = teamsByNorm.get(normalize(normalizedTeam));
          const projectedRole = toPitchingRole(r.position) || "SM";
          const innings = Number(r.innings_pitched);
          const so = Number(r.pitch_strikeouts);
          const bb = Number(r.pitch_walks);
          const k9 = Number.isFinite(innings) && innings > 0 && Number.isFinite(so) ? (so / innings) * 9 : null;
          const bb9 = Number.isFinite(innings) && innings > 0 && Number.isFinite(bb) ? (bb / innings) * 9 : null;
          return {
            id: r.player_id || `pitching-season-fallback-${idx}`,
            playerName,
            team: normalizedTeam || null,
            conference: teamMatch?.conference ?? r.conference ?? null,
            handedness: (r.handedness || "").trim() || null,
            class_transition: DEFAULT_PITCHING_CLASS_TRANSITION,
            dev_aggressiveness: DEFAULT_PITCHING_DEV_AGGRESSIVENESS,
            stuff_score: null,
            whiff_score: null,
            bb_score: null,
            barrel_score: null,
            era_pr_plus: null,
            fip_pr_plus: null,
            whip_pr_plus: null,
            k9_pr_plus: null,
            hr9_pr_plus: null,
            bb9_pr_plus: null,
            era: r.era,
            fip: null,
            whip: r.whip,
            k9,
            bb9,
            hr9: null,
            p_era: r.era,
            p_fip: null,
            p_whip: r.whip,
            p_k9: k9,
            p_bb9: bb9,
            p_hr9: null,
            p_rv_plus: null,
            p_war: null,
            market_value: null,
          } as PitchingDashboardRow;
        })
        .filter(Boolean) as PitchingDashboardRow[];
    }
    try {
      const parsed = JSON.parse(raw) as { rows?: Array<{ id?: string; values?: string[] }> };
      const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
      return rows
        .map((r, idx) => {
          const values = Array.isArray(r.values) ? r.values : [];
          const playerName = (values[0] || "").trim();
          const normalizedTeam = normalizePitchingTeam(values[1]);
          const teamMatch = teamsByNorm.get(normalize(normalizedTeam));
          const statsView = resolvePitchingStatsView(values);
          const era = toNum(statsView.era);
          const fip = toNum(statsView.fip);
          const whip = toNum(statsView.whip);
          const k9 = toNum(statsView.k9);
          const bb9 = toNum(statsView.bb9);
          const hr9 = toNum(statsView.hr9);
          const games = toNum(statsView.g);
          const starts = toNum(statsView.gs);
          const baseRole = toPitchingRole(statsView.role) || (games != null && games > 0 && starts != null ? ((starts / games) < 0.5 ? "RP" : "SP") : null);
          const roleKey = `${normalizeName(playerName)}|${normalize(normalizedTeam)}`;
          const projectedRole = roleOverrides[roleKey] || baseRole || "SM";
          const projectedIp = projectedRole === "SP" ? eq.pwar_ip_sp : projectedRole === "RP" ? eq.pwar_ip_rp : eq.pwar_ip_sm;
          const byNameTeam = scoringByNameTeam.get(nameTeamKey(playerName, normalizedTeam));
          const byNameBucket = scoringByName.get(normalizeName(playerName)) || [];
          const byNameUnique = byNameBucket.length === 1 ? byNameBucket[0] : null;
          const chosenScores = byNameTeam || byNameUnique || null;
          const classTransition = DEFAULT_PITCHING_CLASS_TRANSITION;
          const devAggressiveness = DEFAULT_PITCHING_DEV_AGGRESSIVENESS;

          const classEraAdj = toPitchingClassAdj(classTransition, eq.class_era_fs, eq.class_era_sj, eq.class_era_js, eq.class_era_gr);
          const classFipAdj = toPitchingClassAdj(classTransition, eq.class_fip_fs, eq.class_fip_sj, eq.class_fip_js, eq.class_fip_gr);
          const classWhipAdj = toPitchingClassAdj(classTransition, eq.class_whip_fs, eq.class_whip_sj, eq.class_whip_js, eq.class_whip_gr);
          const classK9Adj = toPitchingClassAdj(classTransition, eq.class_k9_fs, eq.class_k9_sj, eq.class_k9_js, eq.class_k9_gr);
          const classBb9Adj = toPitchingClassAdj(classTransition, eq.class_bb9_fs, eq.class_bb9_sj, eq.class_bb9_js, eq.class_bb9_gr);
          const classHr9Adj = toPitchingClassAdj(classTransition, eq.class_hr9_fs, eq.class_hr9_sj, eq.class_hr9_js, eq.class_hr9_gr);

          const pEra = projectPitchingRate({
            lastStat: era,
            prPlus: chosenScores?.eraPrPlus ?? null,
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
            lastStat: fip,
            prPlus: chosenScores?.fipPrPlus ?? null,
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
            lastStat: whip,
            prPlus: chosenScores?.whipPrPlus ?? null,
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
            lastStat: k9,
            prPlus: chosenScores?.k9PrPlus ?? null,
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
            lastStat: bb9,
            prPlus: chosenScores?.bb9PrPlus ?? null,
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
            lastStat: hr9,
            prPlus: chosenScores?.hr9PrPlus ?? null,
            ncaaAvg: eq.hr9_plus_ncaa_avg,
            ncaaSd: eq.hr9_plus_ncaa_sd,
            prSd: eq.hr9_pr_sd,
            classAdjustment: classHr9Adj,
            devAggressiveness,
            thresholds: eq.hr9_damp_thresholds,
            impacts: eq.hr9_damp_impacts,
            lowerIsBetter: true,
          });
          const teamNameForPark = teamMatch?.name || normalizedTeam || null;
          const fallbackPark = teamMatch?.park_factor ?? null;
          const avgPark = parkToIndex(resolveMetricParkFactor(teamNameForPark, fallbackPark, "avg", teamParkComponents));
          const obpPark = parkToIndex(resolveMetricParkFactor(teamNameForPark, fallbackPark, "obp", teamParkComponents));
          const isoPark = parkToIndex(resolveMetricParkFactor(teamNameForPark, fallbackPark, "iso", teamParkComponents));
          const eraParkRaw = resolveMetricParkFactor(teamNameForPark, null, "era", teamParkComponents);
          const whipParkRaw = resolveMetricParkFactor(teamNameForPark, null, "whip", teamParkComponents);
          const hr9ParkRaw = resolveMetricParkFactor(teamNameForPark, null, "hr9", teamParkComponents);
          // Pitching park-factor model:
          // ERA PF = ERA component (R/G+) when present.
          // WHIP PF = WHIP component when present.
          // HR/9 PF = HR/9 component when present.
          // Fallbacks: ERA -> AVG, WHIP -> 70% AVG + 30% OBP, HR/9 -> ISO.
          // No park factor applied to K/9 or BB/9.
          const eraParkIndex = parkToIndex(eraParkRaw ?? avgPark);
          const whipParkIndex = parkToIndex(whipParkRaw ?? ((0.7 * avgPark) + (0.3 * obpPark)));
          const hr9ParkIndex = parkToIndex(hr9ParkRaw ?? isoPark);
          const eraParkFactor = eraParkIndex / 100;
          const whipParkFactor = whipParkIndex / 100;
          const hr9ParkFactor = hr9ParkIndex / 100;
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
          const roleAdjustedEra = applyRoleTransitionAdjustment(parkAdjustedEra, eq.sp_to_rp_reg_era_pct, baseRole, projectedRole, true, roleCurve);
          const roleAdjustedFip = applyRoleTransitionAdjustment(pFip, eq.sp_to_rp_reg_fip_pct, baseRole, projectedRole, true, roleCurve);
          const roleAdjustedWhip = applyRoleTransitionAdjustment(parkAdjustedWhip, eq.sp_to_rp_reg_whip_pct, baseRole, projectedRole, true, roleCurve);
          const roleAdjustedK9 = applyRoleTransitionAdjustment(pK9, eq.sp_to_rp_reg_k9_pct, baseRole, projectedRole, false, roleCurve);
          const roleAdjustedBb9 = applyRoleTransitionAdjustment(pBb9, eq.sp_to_rp_reg_bb9_pct, baseRole, projectedRole, true, roleCurve);
          const roleAdjustedHr9 = applyRoleTransitionAdjustment(parkAdjustedHr9, eq.sp_to_rp_reg_hr9_pct, baseRole, projectedRole, true, roleCurve);

          const eraPlus = calcPitchingPlus(roleAdjustedEra, eq.era_plus_ncaa_avg, eq.era_plus_ncaa_sd, eq.era_plus_scale, false);
          const fipPlus = calcPitchingPlus(roleAdjustedFip, eq.fip_plus_ncaa_avg, eq.fip_plus_ncaa_sd, eq.fip_plus_scale, false);
          const whipPlus = calcPitchingPlus(roleAdjustedWhip, eq.whip_plus_ncaa_avg, eq.whip_plus_ncaa_sd, eq.whip_plus_scale, false);
          const k9Plus = calcPitchingPlus(roleAdjustedK9, eq.k9_plus_ncaa_avg, eq.k9_plus_ncaa_sd, eq.k9_plus_scale, true);
          const bb9Plus = calcPitchingPlus(roleAdjustedBb9, eq.bb9_plus_ncaa_avg, eq.bb9_plus_ncaa_sd, eq.bb9_plus_scale, false);
          const hr9Plus = calcPitchingPlus(roleAdjustedHr9, eq.hr9_plus_ncaa_avg, eq.hr9_plus_ncaa_sd, eq.hr9_plus_scale, false);
          const pRvPlus = [eraPlus, fipPlus, whipPlus, k9Plus, bb9Plus, hr9Plus].every((v) => v != null)
            ? (Number(eraPlus) * eq.era_plus_weight) +
              (Number(fipPlus) * eq.fip_plus_weight) +
              (Number(whipPlus) * eq.whip_plus_weight) +
              (Number(k9Plus) * eq.k9_plus_weight) +
              (Number(bb9Plus) * eq.bb9_plus_weight) +
              (Number(hr9Plus) * eq.hr9_plus_weight)
            : null;
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
          const conferenceForMarket = teamMatch?.conference || null;
          const ptm = getProgramTierMultiplierByConference(conferenceForMarket, pitchingTierMultipliers);
          const pvm = getPitchingPvfForRole(projectedRole, eq);
          const marketEligible = canShowPitchingMarketValue(normalizedTeam, conferenceForMarket);
          const marketValue = !marketEligible || pWar == null ? null : pWar * eq.market_dollars_per_war * ptm * pvm;

          return {
            id: r.id || `pitching-${idx}`,
            playerName,
            team: normalizedTeam || null,
            conference: teamMatch?.conference ?? null,
            handedness: (values[2] || "").trim() || null,
            class_transition: classTransition,
            dev_aggressiveness: devAggressiveness,
            stuff_score: chosenScores?.stuff ?? null,
            whiff_score: chosenScores?.whiff ?? null,
            bb_score: chosenScores?.bb ?? null,
            barrel_score: chosenScores?.barrel ?? null,
            era_pr_plus: chosenScores?.eraPrPlus ?? null,
            fip_pr_plus: chosenScores?.fipPrPlus ?? null,
            whip_pr_plus: chosenScores?.whipPrPlus ?? null,
            k9_pr_plus: chosenScores?.k9PrPlus ?? null,
            hr9_pr_plus: chosenScores?.hr9PrPlus ?? null,
            bb9_pr_plus: chosenScores?.bb9PrPlus ?? null,
            era,
            fip,
            whip,
            k9,
            bb9,
            hr9,
            p_era: roleAdjustedEra,
            p_fip: roleAdjustedFip,
            p_whip: roleAdjustedWhip,
            p_k9: roleAdjustedK9,
            p_bb9: roleAdjustedBb9,
            p_hr9: roleAdjustedHr9,
            p_rv_plus: pRvPlus,
            p_war: pWar,
            market_value: marketValue,
          };
        })
        .filter((r) => !!r.playerName);
    } catch {
      return [];
    }
  }, [normalizePitchingTeam, pitchingSeasonFallbackRows, pitchingSupabaseRows, teamParkComponents, teamsByNorm]);
  const filteredPitchingRows = useMemo(() => {
    const q = pitchingSearch.trim().toLowerCase();
    if (!q) return pitchingRows;
    return pitchingRows.filter((r) => {
      return (
        r.playerName.toLowerCase().includes(q) ||
        (r.team || "").toLowerCase().includes(q) ||
        (r.conference || "").toLowerCase().includes(q) ||
        (r.handedness || "").toLowerCase().includes(q)
      );
    });
  }, [pitchingRows, pitchingSearch]);
  useEffect(() => {
    if (skipNextPitchingPageResetRef.current) {
      skipNextPitchingPageResetRef.current = false;
      return;
    }
    setPitchingPage(1);
  }, [pitchingSearch, pitchingPageSize]);
  const pitchingTotal = filteredPitchingRows.length;
  const pitchingTotalPages = Math.max(1, Math.ceil(pitchingTotal / pitchingPageSize));
  const pitchingCurrentPage = Math.min(pitchingPage, pitchingTotalPages);
  const pagedPitchingRows = useMemo(() => {
    const from = (pitchingCurrentPage - 1) * pitchingPageSize;
    const to = from + pitchingPageSize;
    return filteredPitchingRows.slice(from, to);
  }, [filteredPitchingRows, pitchingCurrentPage, pitchingPageSize]);
  useEffect(() => {
    if (pitchingPage > pitchingTotalPages) setPitchingPage(pitchingTotalPages);
  }, [pitchingPage, pitchingTotalPages]);
  const pitchingVisiblePages = useMemo(() => {
    if (pitchingTotalPages <= 11) return Array.from({ length: pitchingTotalPages }, (_, i) => i + 1);
    const pages = new Set<number>([
      1, 2, 3, 4, 5,
      pitchingTotalPages - 1, pitchingTotalPages,
      pitchingCurrentPage - 2, pitchingCurrentPage - 1, pitchingCurrentPage, pitchingCurrentPage + 1, pitchingCurrentPage + 2,
    ]);
    return Array.from(pages)
      .filter((p) => p >= 1 && p <= pitchingTotalPages)
      .sort((a, b) => a - b);
  }, [pitchingCurrentPage, pitchingTotalPages]);
  const pitchingMissingTeamCount = useMemo(
    () => pitchingRows.filter((r) => !r.team || !r.team.trim()).length,
    [pitchingRows],
  );
  const pitchingBlankMarketRows = useMemo(
    () =>
      pitchingRows
        .filter((r) => r.market_value == null)
        .map((r) => ({
          player: r.playerName,
          school: r.team || "",
          conference: r.conference || "",
          source: "Pitching",
        })),
    [pitchingRows],
  );
  const exportBlankMarketValues = useCallback((mode: "hitting" | "pitching" | "all") => {
    const rows = mode === "hitting"
      ? hittingBlankMarketRows
      : mode === "pitching"
        ? pitchingBlankMarketRows
        : [...hittingBlankMarketRows, ...pitchingBlankMarketRows];
    if (!rows.length) {
      toast.info("No blank market values found.");
      return;
    }
    const header = ["Player", "School", "Conference", "Source"];
    const lines = rows.map((r) => [csvEscape(r.player), csvEscape(r.school), csvEscape(r.conference), csvEscape(r.source)].join(","));
    const csv = `${header.join(",")}\n${lines.join("\n")}\n`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `blank_market_values_${mode}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} blank market value row(s).`);
  }, [hittingBlankMarketRows, pitchingBlankMarketRows]);
  useEffect(() => {
    const key = "pitching_stats_storage_2025_v1";
    const raw = localStorage.getItem(key);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { headers?: string[]; rows?: Array<{ id?: string; values?: string[] }> };
      const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
      let changed = false;
      const nextRows = rows.map((r) => {
        const values = Array.isArray(r.values) ? [...r.values] : [];
        const before = (values[1] || "").trim();
        const after = normalizePitchingTeam(before);
        if (after !== before) {
          changed = true;
          values[1] = after;
        }
        return { ...r, values };
      });
      if (!changed) return;
      localStorage.setItem(key, JSON.stringify({ headers: parsed.headers, rows: nextRows }));
    } catch {
      // ignore localStorage parse errors
    }
  }, [normalizePitchingTeam]);

  const SortButton = ({ label, sortKeyVal }: { label: string; sortKeyVal: SortKey }) => (
    <Button
      variant="ghost"
      size="sm"
      className="h-auto p-0 font-medium text-muted-foreground hover:text-foreground -ml-1"
      onClick={() => toggleSort(sortKeyVal)}
    >
      {label}
      <ArrowUpDown className="ml-1 h-3 w-3" />
    </Button>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">2025 Player Dashboard</h2>
            <p className="text-muted-foreground">Unified 2025 player dashboard (all players, including transferred and departed)</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              variant={showMissingOnly ? "default" : "outline"}
              className="h-9 text-xs"
              onClick={() => setShowMissingOnly(!showMissingOnly)}
            >
              {showMissingOnly ? "Show All" : "Missing Teams"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-9 text-xs"
              onClick={() => applyTemplateDefaults.mutate()}
              disabled={applyTemplateDefaults.isPending}
            >
              {applyTemplateDefaults.isPending ? "Applying Template…" : "Apply Template: SO→JR, 0.0"}
            </Button>
          </div>
        </div>

        <Tabs value={dashboardView} onValueChange={(v) => setDashboardView(v as "hitting" | "pitching")}>
          <TabsList>
            <TabsTrigger value="hitting">Hitting</TabsTrigger>
            <TabsTrigger value="pitching">Pitching</TabsTrigger>
          </TabsList>
        </Tabs>

        {dashboardView === "hitting" ? (
          <>
        <div className="relative w-full max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search players, teams..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Table */}
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Player Projections</CardTitle>
              <Select value={positionFilter} onValueChange={setPositionFilter}>
                <SelectTrigger className="w-36 h-8">
                  <SelectValue placeholder="Position" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Positions</SelectItem>
                  {positions.map((pos) => (
                    <SelectItem key={pos} value={pos}>
                      {pos}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => exportBlankMarketValues("hitting")}
              >
                Blank Market Value ({hittingBlankMarketRows.length})
              </Button>
              {bulkEditMode ? (
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 text-xs"
                    onClick={() => bulkSave.mutate()}
                    disabled={Object.keys(editedPlayers).length === 0 || bulkSave.isPending}
                  >
                    <Save className="h-3 w-3 mr-1" />
                    Save {Object.keys(editedPlayers).length > 0 ? `(${Object.keys(editedPlayers).length})` : ""}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => {
                      setBulkEditMode(false);
                      setEditedPlayers({});
                    }}
                  >
                    <X className="h-3 w-3 mr-1" />
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setBulkEditMode(true)}>
                  <Pencil className="h-3 w-3 mr-1" />
                  Bulk Edit
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="flex items-center gap-1 overflow-x-auto max-w-[360px]">
                {visiblePages.map((p, i) => {
                  const prev = visiblePages[i - 1];
                  const showGap = i > 0 && prev != null && p - prev > 1;
                  return (
                    <div key={p} className="flex items-center gap-1">
                      {showGap ? <span className="px-1 text-muted-foreground text-xs">...</span> : null}
                      <Button
                        variant={p === currentPage ? "default" : "outline"}
                        size="sm"
                        className="h-6 min-w-6 px-1.5 text-[10px]"
                        onClick={() => setPage(p)}
                      >
                        {p}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">Loading projections…</div>
            ) : pagedPlayers.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">No players found</div>
            ) : (
              <>
                <div
                  ref={tableContainerRef}
                  onScroll={handleTableScroll}
                  className="overflow-x-auto [&::-webkit-scrollbar]:hidden overflow-y-auto max-h-[70vh]"
                  style={{ scrollbarWidth: "none" }}
                >
                  <Table>
                    <TableHeader className="sticky top-0 z-20 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
                      <TableRow>
                        <TableHead className="min-w-[160px] sticky left-0 z-30 bg-background">
                          <SortButton label="Player" sortKeyVal="name" />
                        </TableHead>
                        <TableHead>Prior</TableHead>
                        <TableHead className="min-w-[120px]">Class Adjustment</TableHead>
                        <TableHead className="min-w-[140px]">Dev Aggressiveness</TableHead>
                        <TableHead className="text-right"><SortButton label="pAVG" sortKeyVal="p_avg" /></TableHead>
                        <TableHead className="text-right"><SortButton label="p OBP" sortKeyVal="p_obp" /></TableHead>
                        <TableHead className="text-right"><SortButton label="pSLG" sortKeyVal="p_slg" /></TableHead>
                        <TableHead className="text-right"><SortButton label="p OPS" sortKeyVal="p_ops" /></TableHead>
                        <TableHead className="text-right"><SortButton label="pISO" sortKeyVal="p_iso" /></TableHead>
                        <TableHead className="text-right"><SortButton label="wRC+" sortKeyVal="p_wrc_plus" /></TableHead>
                        <TableHead className="text-right"><SortButton label="oWAR" sortKeyVal="p_war" /></TableHead>
                        <TableHead className="text-right"><SortButton label="Market Value" sortKeyVal="p_nil" /></TableHead>
                        <TableHead className="text-center min-w-[180px]">Scouting</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedPlayers.map((p) => {
                        const pred = p.prediction;
                        const effectivePosition = playerOverrides[p.id]?.position ?? p.position;
                        return (
                          <TableRow key={p.prediction_id}>
                            <TableCell className="font-medium whitespace-nowrap sticky left-0 z-10 bg-background">
                              <Link
                                to={profileRouteFor(p.id, effectivePosition)}
                                onClick={saveViewSnapshot}
                                className="hover:text-primary hover:underline transition-colors"
                              >
                                {p.first_name} {p.last_name}
                              </Link>
                              {bulkEditMode ? (
                                <div className="mt-1 flex items-center gap-1">
                                  <Input
                                    className="h-6 w-[72px] text-[10px]"
                                    defaultValue={editedPlayers[p.id]?.position ?? p.position ?? ""}
                                    placeholder="Pos"
                                    onBlur={(e) => {
                                      const val = e.target.value.trim();
                                      if (val !== (p.position ?? "")) handleEditField(p.id, "position", val);
                                    }}
                                  />
                                  <Input
                                    className="h-6 w-[130px] text-[10px]"
                                    defaultValue={editedPlayers[p.id]?.team ?? p.team ?? ""}
                                    placeholder="Team"
                                    onBlur={(e) => {
                                      const val = e.target.value.trim();
                                      if (val !== (p.team ?? "")) handleEditField(p.id, "team", val);
                                    }}
                                  />
                                </div>
                              ) : (
                                <div className="text-xs text-muted-foreground">
                                  {[effectivePosition, p.team].filter(Boolean).join(" · ") || "—"}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {statFormat(pred.from_avg)}/{statFormat(pred.from_obp)}/{statFormat(pred.from_slg)}
                            </TableCell>
                            <TableCell>
                              {p.model_type === "returner" ? (
                                <ClassAdjustmentSelector
                                  value={pred.class_transition || "SJ"}
                                  onChange={(v) => updateClassTransition.mutate({ predictionId: p.prediction_id, value: v })}
                                />
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {p.model_type === "returner" ? (
                                <DevAggSelector
                                  value={pred.dev_aggressiveness ?? 0.0}
                                  onChange={(v) => updateDevAgg.mutate({ predictionId: p.prediction_id, value: v })}
                                />
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className={`text-right font-mono text-sm font-bold ${deltaClass(pred.from_avg, pred.p_avg, 0.001)}`}>{statFormat(pred.p_avg)}</TableCell>
                            <TableCell className={`text-right font-mono text-sm font-bold ${deltaClass(pred.from_obp, pred.p_obp, 0.001)}`}>{statFormat(pred.p_obp)}</TableCell>
                            <TableCell className={`text-right font-mono text-sm font-bold ${deltaClass(pred.from_slg, pred.p_slg, 0.001)}`}>{statFormat(pred.p_slg)}</TableCell>
                            <TableCell className={`text-right font-mono text-sm font-bold ${deltaClass(computeDerived(pred.from_avg, pred.from_obp, pred.from_slg).ops, pred.p_ops ?? computeDerived(pred.p_avg, pred.p_obp, pred.p_slg).ops, 0.001)}`}>
                              {statFormat(pred.p_ops ?? computeDerived(pred.p_avg, pred.p_obp, pred.p_slg).ops)}
                            </TableCell>
                            <TableCell className={`text-right font-mono text-sm font-bold ${deltaClass(computeDerived(pred.from_avg, pred.from_obp, pred.from_slg).iso, pred.p_iso ?? computeDerived(pred.p_avg, pred.p_obp, pred.p_slg).iso, 0.001)}`}>
                              {statFormat(pred.p_iso ?? computeDerived(pred.p_avg, pred.p_obp, pred.p_slg).iso)}
                            </TableCell>
                            <TableCell className={`text-right font-mono text-sm font-bold ${deltaClass(computeDerived(pred.from_avg, pred.from_obp, pred.from_slg).wrcPlus, pred.p_wrc_plus, 0.5)}`}>
                              {pctFormat(pred.p_wrc_plus)}
                            </TableCell>
                            <TableCell className={`text-right font-mono text-sm font-bold ${deltaClass(computeOWarFromWrcPlus(computeDerived(pred.from_avg, pred.from_obp, pred.from_slg).wrcPlus), computeOWarFromWrcPlus(pred.p_wrc_plus), 0.05)}`}>
                              {statFormat(computeOWarFromWrcPlus(pred.p_wrc_plus), 2)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm font-bold">
                              {moneyFormat(
                                computeNilFallback({
                                  storedNil: p.nil_value,
                                  wrcPlus: p.prediction.p_wrc_plus,
                                  conference: p.conference,
                                  position: effectivePosition,
                                }),
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              {pred.ev_score != null &&
                              pred.barrel_score != null &&
                              pred.contact_score != null &&
                              pred.chase_score != null ? (
                                <div className="flex gap-1 justify-center flex-wrap">
                                  <ScoutMiniBox label="EV" value={pred.ev_score} />
                                  <ScoutMiniBox label="Brl" value={pred.barrel_score} />
                                  <ScoutMiniBox label="Con" value={pred.contact_score} />
                                  <ScoutMiniBox label="Chs" value={pred.chase_score} />
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                {showFixedScrollbar && (
                  <div
                    ref={scrollbarRef}
                    onScroll={handleScrollbarScroll}
                    className="fixed bottom-0 z-50 overflow-x-auto overflow-y-hidden bg-background/95 backdrop-blur border-t border-border"
                    style={{
                      height: 18,
                      left: scrollbarPos.left,
                      width: scrollbarPos.width || "100%",
                    }}
                  >
                    <div ref={scrollbarInnerRef} style={{ height: 1 }} />
                  </div>
                )}
                <div className="flex flex-col gap-2 border-t px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-muted-foreground">
                    Showing{" "}
                    <span className="font-medium text-foreground">
                      {totalCount === 0 ? 0 : ((currentPage - 1) * pageSize) + 1}
                    </span>
                    {" "}-{" "}
                    <span className="font-medium text-foreground">
                      {Math.min(currentPage * pageSize, totalCount)}
                    </span>
                    {" "}of{" "}
                    <span className="font-medium text-foreground">{totalCount}</span>
                    {" "}players
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Rows</span>
                    <Select
                      value={String(pageSize)}
                      onValueChange={(v) => setPageSize(Number(v))}
                    >
                      <SelectTrigger className="h-8 w-[88px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="50">50</SelectItem>
                        <SelectItem value="100">100</SelectItem>
                        <SelectItem value="250">250</SelectItem>
                        <SelectItem value="500">500</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
          </>
        ) : (
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">Pitching Dashboard (2025)</CardTitle>
                <CardDescription>Prior stats with scouting grades from pitching power ratings storage.</CardDescription>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs sm:mr-2"
                onClick={() => exportBlankMarketValues("pitching")}
              >
                Blank Market Value ({pitchingBlankMarketRows.length})
              </Button>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="flex items-center gap-1 overflow-x-auto max-w-[360px]">
                  {pitchingVisiblePages.map((p, i) => {
                    const prev = pitchingVisiblePages[i - 1];
                    const showGap = i > 0 && prev != null && p - prev > 1;
                    return (
                      <div key={p} className="flex items-center gap-1">
                        {showGap ? <span className="px-1 text-muted-foreground text-xs">...</span> : null}
                        <Button
                          variant={p === pitchingCurrentPage ? "default" : "outline"}
                          size="sm"
                          className="h-6 min-w-6 px-1.5 text-[10px]"
                          onClick={() => setPitchingPage(p)}
                        >
                          {p}
                        </Button>
                      </div>
                    );
                  })}
                </div>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search pitchers, teams..."
                    value={pitchingSearch}
                    onChange={(e) => setPitchingSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="px-4 pt-3 pb-2 text-xs text-muted-foreground">
                {pitchingMissingTeamCount === 0 ? (
                  <span>Team check: all pitchers have a team.</span>
                ) : (
                  <span className="text-destructive">Team check: {pitchingMissingTeamCount} pitcher(s) missing a team.</span>
                )}
              </div>
              {pagedPitchingRows.length === 0 ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground">No pitchers found</div>
              ) : (
                <>
                  <div className="overflow-x-auto overflow-y-auto max-h-[70vh]">
                    <Table>
                      <TableHeader className="sticky top-0 z-20 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
                        <TableRow>
                          <TableHead className="min-w-[160px] sticky left-0 z-30 bg-background">Player</TableHead>
                          <TableHead className="text-right">pERA</TableHead>
                          <TableHead className="text-right">pFIP</TableHead>
                          <TableHead className="text-right">pWHIP</TableHead>
                          <TableHead className="text-right">pK/9</TableHead>
                          <TableHead className="text-right">pBB/9</TableHead>
                          <TableHead className="text-right">pHR/9</TableHead>
                          <TableHead className="text-right">pRV+</TableHead>
                          <TableHead className="text-right">pWAR</TableHead>
                          <TableHead className="text-right">Market Value</TableHead>
                          <TableHead className="text-center min-w-[180px]">Scouting</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pagedPitchingRows.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="font-medium whitespace-nowrap sticky left-0 z-10 bg-background">
                              <Link
                                to={`/dashboard/pitcher/storage__${encodeURIComponent(r.playerName)}__${encodeURIComponent(r.team || "")}`}
                                onClick={saveViewSnapshot}
                                className="hover:text-primary hover:underline transition-colors"
                              >
                                {r.playerName}
                              </Link>
                              <div className="text-xs text-muted-foreground">
                                {[r.handedness, r.team].filter(Boolean).join(" · ") || "—"}
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">{statFormat(r.p_era, 2)}</TableCell>
                            <TableCell className="text-right font-mono text-sm">{statFormat(r.p_fip, 2)}</TableCell>
                            <TableCell className="text-right font-mono text-sm">{statFormat(r.p_whip, 2)}</TableCell>
                            <TableCell className="text-right font-mono text-sm">{statFormat(r.p_k9, 2)}</TableCell>
                            <TableCell className="text-right font-mono text-sm">{statFormat(r.p_bb9, 2)}</TableCell>
                            <TableCell className="text-right font-mono text-sm">{statFormat(r.p_hr9, 2)}</TableCell>
                            <TableCell className="text-right font-mono text-sm">{r.p_rv_plus == null ? "—" : Math.round(r.p_rv_plus)}</TableCell>
                            <TableCell className="text-right font-mono text-sm">{r.p_war == null ? "—" : r.p_war.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-mono text-sm">{moneyFormat(r.market_value)}</TableCell>
                            <TableCell className="text-center">
                              {r.stuff_score != null &&
                              r.whiff_score != null &&
                              r.bb_score != null &&
                              r.barrel_score != null ? (
                                <div className="flex gap-1 justify-center flex-wrap">
                                  <ScoutMiniBox label="Stf+" value={r.stuff_score} />
                                  <ScoutMiniBox label="Whf" value={r.whiff_score} />
                                  <ScoutMiniBox label="BB%" value={r.bb_score} />
                                  <ScoutMiniBox label="Brl" value={r.barrel_score} />
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="flex flex-col gap-2 border-t px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-muted-foreground">
                      Showing{" "}
                      <span className="font-medium text-foreground">
                        {pitchingTotal === 0 ? 0 : ((pitchingCurrentPage - 1) * pitchingPageSize) + 1}
                      </span>
                      {" "}-{" "}
                      <span className="font-medium text-foreground">
                        {Math.min(pitchingCurrentPage * pitchingPageSize, pitchingTotal)}
                      </span>
                      {" "}of{" "}
                      <span className="font-medium text-foreground">{pitchingTotal}</span>
                      {" "}pitchers
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Rows</span>
                      <Select
                        value={String(pitchingPageSize)}
                        onValueChange={(v) => setPitchingPageSize(Number(v))}
                      >
                        <SelectTrigger className="h-8 w-[88px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="50">50</SelectItem>
                          <SelectItem value="100">100</SelectItem>
                          <SelectItem value="250">250</SelectItem>
                          <SelectItem value="500">500</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}

function ScoutMiniBox({ label, value }: { label: string; value: number }) {
  const tier =
    value >= 80
      ? "bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]"
      : value >= 50
        ? "bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]"
        : "bg-destructive/15 text-destructive";
  return (
    <div
      className={`inline-flex min-w-[34px] flex-col items-center rounded px-1 py-0.5 leading-tight ${tier}`}
      title={`${label}: ${value}`}
    >
      <span className="text-[9px] font-semibold">{label}</span>
      <span className="text-[10px] font-bold">{Math.round(value)}</span>
    </div>
  );
}

const CLASS_OPTIONS = [
  { value: "FS", label: "FR→SO" },
  { value: "SJ", label: "SO→JR" },
  { value: "JS", label: "JR→SR" },
  { value: "GR", label: "GR" },
] as const;

function ClassAdjustmentSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-7 w-[105px] px-2 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CLASS_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value} className="text-xs">
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const DEV_OPTIONS = [
  { value: 0, label: "0.0" },
  { value: 0.5, label: "0.5" },
  { value: 1, label: "1.0" },
] as const;

function DevAggSelector({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {DEV_OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded px-2 py-1 text-xs font-semibold transition-colors ${
              active
                ? opt.value === 0
                  ? "bg-destructive/15 text-destructive"
                  : opt.value === 0.5
                    ? "bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]"
                    : "bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
