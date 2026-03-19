import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, TrendingUp } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/useAuth";
import { readPitchingWeights } from "@/lib/pitchingEquations";

const fmt = (v: number | null | undefined, digits = 3) => (v == null ? "—" : Number(v).toFixed(digits));
const fmtWhole = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toString());
const normalize = (v: string | null | undefined) =>
  (v || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const isUuid = (v: string | undefined) =>
  !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const STORAGE_PREFIX = "storage__";
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

const PITCHING_POWER_RATING_WEIGHT = 0.7;
const PITCHING_DEV_FACTOR = 0.06;

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
        .select("name, conference");
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
    return player?.team || "";
  }, [player?.team, storageRef?.teamName]);
  const storageRow = useMemo(() => {
    if (!lookupPlayerName) return null;
    const keys = ["pitching_stats_storage_2025_v1", "pitching_stats_storage_2026_v1"];
    for (const key of keys) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as { rows?: Array<{ values?: string[] }> };
        const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
        const exactTeamRow = rows.find((r) => {
          const values = Array.isArray(r.values) ? r.values : [];
          return normalize(values[0]) === normalize(lookupPlayerName) && normalize(values[1]) === normalize(lookupTeamName);
        });
        if (exactTeamRow) return Array.isArray(exactTeamRow.values) ? exactTeamRow.values : null;
        const nameOnlyMatches = rows.filter((r) => {
          const values = Array.isArray(r.values) ? r.values : [];
          return normalize(values[0]) === normalize(lookupPlayerName);
        });
        if (nameOnlyMatches.length === 1) {
          const only = nameOnlyMatches[0];
          return Array.isArray(only.values) ? only.values : null;
        }
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
        const exactTeamRow = rows.find((r) => {
          const values = Array.isArray(r.values) ? r.values : [];
          return normalize(values[0]) === normalize(lookupPlayerName) && normalize(values[1]) === normalize(lookupTeamName);
        });
        if (exactTeamRow) return Array.isArray(exactTeamRow.values) ? exactTeamRow.values : null;
        const nameOnlyMatches = rows.filter((r) => {
          const values = Array.isArray(r.values) ? r.values : [];
          return normalize(values[0]) === normalize(lookupPlayerName);
        });
        if (nameOnlyMatches.length === 1) {
          const only = nameOnlyMatches[0];
          return Array.isArray(only.values) ? only.values : null;
        }
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
    for (const row of teamDirectory as Array<{ name: string | null; conference: string | null }>) {
      const key = normalize(row.name);
      if (!key || !row.conference) continue;
      if (!map.has(key)) map.set(key, row.conference);
    }
    return map;
  }, [teamDirectory]);
  const fullName =
    `${player?.first_name || ""} ${player?.last_name || ""}`.trim() ||
    storageRef?.playerName ||
    "Pitcher";
  const displayTeam = player?.team || storageRow?.[1] || storageRef?.teamName || "—";
  const displayConference = player?.conference || conferenceByTeam.get(normalize(displayTeam)) || "—";
  const displayHandedness = player?.handedness || storageRow?.[2] || "—";
  const storageEra = storageRow?.[3] ? Number(storageRow[3]) : null;
  const storageFip = storageRow?.[4] ? Number(storageRow[4]) : null;
  const storageWhip = storageRow?.[5] ? Number(storageRow[5]) : null;
  const storageK9 = storageRow?.[6] ? Number(storageRow[6]) : null;
  const storageBb9 = storageRow?.[7] ? Number(storageRow[7]) : null;
  const storageHr9 = storageRow?.[8] ? Number(storageRow[8]) : null;
  const projectedPitching = useMemo(() => {
    const eq = readPitchingWeights();
    const classTransitionRaw = String(activePrediction?.class_transition || "SJ").toUpperCase();
    const classTransition: "FS" | "SJ" | "JS" | "GR" =
      classTransitionRaw === "FS" || classTransitionRaw === "SJ" || classTransitionRaw === "JS" || classTransitionRaw === "GR"
        ? classTransitionRaw
        : "SJ";
    const devAggressiveness = Number.isFinite(Number(activePrediction?.dev_aggressiveness))
      ? Number(activePrediction?.dev_aggressiveness)
      : 0;

    const eraPrPlus = parseNum(powerRatingsRow?.[30]);
    const fipPrPlus = parseNum(powerRatingsRow?.[31]);
    const whipPrPlus = parseNum(powerRatingsRow?.[32]);
    const k9PrPlus = parseNum(powerRatingsRow?.[33]);
    const hr9PrPlus = parseNum(powerRatingsRow?.[34]);
    const bb9PrPlus = parseNum(powerRatingsRow?.[35]);

    const classEraAdj = toPitchingClassAdj(classTransition, eq.class_era_fs, eq.class_era_sj, eq.class_era_js, eq.class_era_gr);
    const classFipAdj = toPitchingClassAdj(classTransition, eq.class_fip_fs, eq.class_fip_sj, eq.class_fip_js, eq.class_fip_gr);
    const classWhipAdj = toPitchingClassAdj(classTransition, eq.class_whip_fs, eq.class_whip_sj, eq.class_whip_js, eq.class_whip_gr);
    const classK9Adj = toPitchingClassAdj(classTransition, eq.class_k9_fs, eq.class_k9_sj, eq.class_k9_js, eq.class_k9_gr);
    const classBb9Adj = toPitchingClassAdj(classTransition, eq.class_bb9_fs, eq.class_bb9_sj, eq.class_bb9_js, eq.class_bb9_gr);
    const classHr9Adj = toPitchingClassAdj(classTransition, eq.class_hr9_fs, eq.class_hr9_sj, eq.class_hr9_js, eq.class_hr9_gr);

    const pEra = projectPitchingRate({
      lastStat: latestStats?.era ?? storageEra,
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
      lastStat: latestStats?.whip ?? storageWhip,
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

    const eraPlus = calcPitchingPlus(pEra, eq.era_plus_ncaa_avg, eq.era_plus_ncaa_sd, eq.era_plus_scale);
    const fipPlus = calcPitchingPlus(pFip, eq.fip_plus_ncaa_avg, eq.fip_plus_ncaa_sd, eq.fip_plus_scale);
    const whipPlus = calcPitchingPlus(pWhip, eq.whip_plus_ncaa_avg, eq.whip_plus_ncaa_sd, eq.whip_plus_scale);
    const k9Plus = calcPitchingPlus(pK9, eq.k9_plus_ncaa_avg, eq.k9_plus_ncaa_sd, eq.k9_plus_scale, true);
    const bb9Plus = calcPitchingPlus(pBb9, eq.bb9_plus_ncaa_avg, eq.bb9_plus_ncaa_sd, eq.bb9_plus_scale);
    const hr9Plus = calcPitchingPlus(pHr9, eq.hr9_plus_ncaa_avg, eq.hr9_plus_ncaa_sd, eq.hr9_plus_scale);
    const pRvPlus = [eraPlus, fipPlus, whipPlus, k9Plus, bb9Plus, hr9Plus].every((v) => v != null)
      ? (Number(eraPlus) * eq.era_plus_weight) +
        (Number(fipPlus) * eq.fip_plus_weight) +
        (Number(whipPlus) * eq.whip_plus_weight) +
        (Number(k9Plus) * eq.k9_plus_weight) +
        (Number(bb9Plus) * eq.bb9_plus_weight) +
        (Number(hr9Plus) * eq.hr9_plus_weight)
      : null;

    return { pEra, pFip, pWhip, pK9, pBb9, pHr9, pRvPlus };
  }, [
    activePrediction?.class_transition,
    activePrediction?.dev_aggressiveness,
    latestStats?.era,
    latestStats?.whip,
    powerRatingsRow,
    storageBb9,
    storageEra,
    storageFip,
    storageHr9,
    storageK9,
    storageWhip,
  ]);

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
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
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
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">IP</div><div className="font-semibold">{fmt(latestStats?.innings_pitched ?? null, 1)}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">ERA</div><div className="font-semibold">{fmt(latestStats?.era ?? storageEra, 2)}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">WHIP</div><div className="font-semibold">{fmt(latestStats?.whip ?? storageWhip, 2)}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">FIP</div><div className="font-semibold">{fmt(storageFip, 2)}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">K/9</div><div className="font-semibold">{fmt(storageK9, 2)}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">BB/9</div><div className="font-semibold">{fmt(storageBb9, 2)}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">HR/9</div><div className="font-semibold">{fmt(storageHr9, 2)}</div></div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-2 space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <MetricCard title="Market Value" value={nilFormat(nilValuation?.projected_value ?? null)} />
              <MetricCard title="pWAR" value="—" subtitle="Pitching WAR model pending" />
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
                <div className="grid grid-cols-2 md:grid-cols-7 gap-2 text-sm">
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">pERA</div><div className="font-semibold">{fmt(projectedPitching.pEra, 2)}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">pFIP</div><div className="font-semibold">{fmt(projectedPitching.pFip, 2)}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">pWHIP</div><div className="font-semibold">{fmt(projectedPitching.pWhip, 2)}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">pK/9</div><div className="font-semibold">{fmt(projectedPitching.pK9, 2)}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">pBB/9</div><div className="font-semibold">{fmt(projectedPitching.pBb9, 2)}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">pHR/9</div><div className="font-semibold">{fmt(projectedPitching.pHr9, 2)}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground text-xs">pRV+</div><div className="font-semibold">{fmtWhole(projectedPitching.pRvPlus)}</div></div>
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
