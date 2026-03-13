import { useState, useMemo, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GitCompare, Plus, X } from "lucide-react";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from "recharts";
import { Link } from "react-router-dom";
import { computeTransferProjection } from "@/lib/transferProjection";
import {
  getProgramTierMultiplierByConference,
  getPositionValueMultiplier,
  DEFAULT_NIL_TIER_MULTIPLIERS,
} from "@/lib/nilProgramSpecific";
import { getConferenceAliases } from "@/lib/conferenceMapping";
import storage2025Seed from "@/data/storage_2025_seed.json";

/* ── shared helpers ──────────────────────────────────────────── */

type TeamRow = { name: string; conference: string | null; park_factor: number | null };
type ConferenceRow = { conference: string; season?: number | null; avg_plus: number | null; obp_plus: number | null; iso_plus: number | null; stuff_plus: number | null };
type SeedRow = { playerName: string; team: string | null; avg: number | null; obp: number | null; slg: number | null };

const normalizeName = (value: string | null | undefined) =>
  (value || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

const normalizeKey = (value: string | null | undefined) =>
  (value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const statKey = (v: number | null | undefined) => (v == null ? "na" : round3(v).toFixed(3));

const toRate = (n: number) => (Math.abs(n) > 1 ? n / 100 : n);
const toWeight = (n: number) => (Math.abs(n) >= 10 ? n / 100 : n);
const normalizeParkToIndex = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return 100;
  return Math.abs(n) <= 3 ? n * 100 : n;
};

const conferenceKeyAliases = getConferenceAliases;

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

const selectTransferPortalPreferredPrediction = (predictions: any[] | null | undefined) => {
  const list = (predictions || []).filter(Boolean);
  if (!list.length) return null;
  const rank = (row: any) => {
    const hasFrom = row.from_avg != null || row.from_obp != null || row.from_slg != null;
    const hasPower = row.power_rating_plus != null;
    const statusBoost = row.status === "active" ? 2 : row.status === "departed" ? 1 : 0;
    const modelMatchBoost = row.model_type === "transfer" ? 4 : 0;
    const variantBoost = row.variant === "regular" ? 3 : 0;
    return modelMatchBoost + variantBoost + (row.model_type === "transfer" ? 3 : 1) + (hasFrom ? 2 : 0) + (hasPower ? 1 : 0) + statusBoost;
  };
  return [...list].sort((a, b) => {
    const diff = rank(b) - rank(a);
    if (diff !== 0) return diff;
    const tsA = new Date(a.updated_at || 0).getTime();
    const tsB = new Date(b.updated_at || 0).getTime();
    return tsB - tsA;
  })[0] ?? null;
};

/* ── stat comparison helpers ─────────────────────────────────── */

interface ComparePlayer {
  id: string;
  player_id: string;
  label: string;
  team: string | null;
  position: string | null;
  class_year: string | null;
  model_type: string;
  variant: string;
  p_avg: number | null;
  p_obp: number | null;
  p_slg: number | null;
  p_ops: number | null;
  p_iso: number | null;
  p_wrc_plus: number | null;
  power_rating_plus: number | null;
  ev_score: number | null;
  barrel_score: number | null;
  whiff_score: number | null;
  chase_score: number | null;
}

const COLORS = [
  "hsl(210, 100%, 55%)",
  "hsl(38, 100%, 55%)",
  "hsl(142, 76%, 36%)",
  "hsl(0, 72%, 51%)",
  "hsl(280, 70%, 55%)",
];

const statFormat = (v: number | null | undefined, decimals = 3) => {
  if (v == null) return "—";
  return v >= 1 && decimals === 3 ? v.toFixed(3) : v.toFixed(decimals);
};

const pctFormat = (v: number | null | undefined) => {
  if (v == null) return "—";
  return Math.round(v).toString();
};

/* ── component ───────────────────────────────────────────────── */

export default function PlayerComparison() {
  /* ── Stat Comparison state ── */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [modelFilter, setModelFilter] = useState<"all" | "returner" | "transfer">("all");

  /* ── Transfer Sim state ── */
  const [compareAPlayerId, setCompareAPlayerId] = useState<string>("");
  const [compareAPlayerSearch, setCompareAPlayerSearch] = useState("");
  const [compareAPlayerOpen, setCompareAPlayerOpen] = useState(false);
  const [compareADestinationTeam, setCompareADestinationTeam] = useState<string>("");
  const [compareATeamSearch, setCompareATeamSearch] = useState("");
  const [compareATeamOpen, setCompareATeamOpen] = useState(false);
  const [compareBPlayerId, setCompareBPlayerId] = useState<string>("");
  const [compareBPlayerSearch, setCompareBPlayerSearch] = useState("");
  const [compareBPlayerOpen, setCompareBPlayerOpen] = useState(false);
  const [compareBDestinationTeam, setCompareBDestinationTeam] = useState<string>("");
  const [compareBTeamSearch, setCompareBTeamSearch] = useState("");
  const [compareBTeamOpen, setCompareBTeamOpen] = useState(false);

  /* ── Shared data queries ── */

  const { data: allPredictions = [] } = useQuery({
    queryKey: ["compare-predictions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_predictions")
        .select(`*, players!inner(id, first_name, last_name, team, position, class_year)`)
        .eq("variant", "regular");
      if (error) throw error;
      return (data || []).map((row: any) => ({
        id: row.id,
        player_id: row.player_id,
        label: `${row.players.first_name} ${row.players.last_name}`,
        team: row.players.team,
        position: row.players.position,
        class_year: row.players.class_year,
        model_type: row.model_type,
        variant: row.variant,
        p_avg: row.p_avg,
        p_obp: row.p_obp,
        p_slg: row.p_slg,
        p_ops: row.p_ops,
        p_iso: row.p_iso,
        p_wrc_plus: row.p_wrc_plus,
        power_rating_plus: row.power_rating_plus,
        ev_score: row.ev_score,
        barrel_score: row.barrel_score,
        whiff_score: row.whiff_score,
        chase_score: row.chase_score,
      })) as ComparePlayer[];
    },
  });

  const { data: teams = [] } = useQuery({
    queryKey: ["teams-list"],
    queryFn: async () => {
      const { data } = await supabase.from("teams").select("name, conference, park_factor").order("name");
      return (data ?? []) as TeamRow[];
    },
  });

  const { data: allPlayersForSearch = [] } = useQuery({
    queryKey: ["compare-all-players-search"],
    queryFn: async () => {
      let all: any[] = [];
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("players")
          .select("id, first_name, last_name, position, team, from_team, conference, player_predictions(id, p_avg, p_obp, p_slg, p_ops, p_wrc_plus, power_rating_plus, class_transition, dev_aggressiveness, model_type, status, variant, from_avg, from_obp, from_slg, updated_at)")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        all = all.concat(data || []);
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }
      return all.filter((p) => p.first_name && p.last_name);
    },
  });

  const { data: conferenceStats = [] } = useQuery({
    queryKey: ["conference-stats-for-compare"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conference_stats")
        .select("conference, season, avg_plus, obp_plus, iso_plus, stuff_plus")
        .order("season", { ascending: false });
      if (error) throw error;
      const byConf = new Map<string, { row: ConferenceRow; score: number }>();
      for (const row of (data || []) as ConferenceRow[]) {
        const key = normalizeKey(row.conference);
        if (!key) continue;
        const score =
          (row.avg_plus != null ? 1 : 0) +
          (row.obp_plus != null ? 1 : 0) +
          (row.iso_plus != null ? 1 : 0) +
          (row.stuff_plus != null ? 1 : 0) +
          (row.season === 2025 ? 2 : 0);
        const existing = byConf.get(key);
        if (!existing || score > existing.score) byConf.set(key, { row, score });
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

  const eqNum = (key: string, fallback: number) => readLocalNum(key, fallback, remoteEquationValues);

  /* ── Derived lookups ── */

  const allPlayersById = useMemo(() => {
    const map = new Map<string, any>();
    for (const p of allPlayersForSearch) map.set(p.id, p);
    return map;
  }, [allPlayersForSearch]);

  const teamByKey = useMemo(() => {
    const map = new Map<string, TeamRow>();
    for (const t of teams as TeamRow[]) map.set(normalizeKey(t.name), t);
    return map;
  }, [teams]);

  const confByKey = useMemo(() => {
    const map = new Map<string, ConferenceRow>();
    for (const c of conferenceStats as ConferenceRow[]) map.set(normalizeKey(c.conference), c);
    return map;
  }, [conferenceStats]);

  const seedByName = useMemo(() => {
    const map = new Map<string, SeedRow[]>();
    for (const row of storage2025Seed as SeedRow[]) {
      const nameKey = normalizeKey(row.playerName);
      if (!nameKey || !row.team) continue;
      const list = map.get(nameKey) || [];
      list.push(row);
      map.set(nameKey, list);
    }
    return map;
  }, []);

  /* ── Transfer sim helpers ── */

  const filterPlayersForCompare = useCallback((q: string) => {
    const nq = normalizeName(q);
    if (!nq) return [] as any[];
    return allPlayersForSearch
      .filter((p) =>
        normalizeName(`${p.first_name} ${p.last_name} ${p.team || ""} ${p.position || ""}`).includes(nq),
      )
      .slice(0, 25);
  }, [allPlayersForSearch]);

  const filterTeamsForCompare = useCallback((q: string) => {
    const nq = normalizeName(q);
    if (!nq) return [] as TeamRow[];
    return (teams as TeamRow[])
      .filter((t) => normalizeName(`${t.name} ${t.conference || ""}`).includes(nq))
      .slice(0, 30);
  }, [teams]);

  const filteredCompareAPlayers = useMemo(() => filterPlayersForCompare(compareAPlayerSearch), [compareAPlayerSearch, filterPlayersForCompare]);
  const filteredCompareBPlayers = useMemo(() => filterPlayersForCompare(compareBPlayerSearch), [compareBPlayerSearch, filterPlayersForCompare]);
  const filteredCompareATeams = useMemo(() => filterTeamsForCompare(compareATeamSearch), [compareATeamSearch, filterTeamsForCompare]);
  const filteredCompareBTeams = useMemo(() => filterTeamsForCompare(compareBTeamSearch), [compareBTeamSearch, filterTeamsForCompare]);

  const resolveConferenceStats = useCallback((conference: string | null | undefined): ConferenceRow | null => {
    const aliases = conferenceKeyAliases(conference);
    let best: ConferenceRow | null = null;
    let bestScore = -1;
    const score = (row: ConferenceRow) =>
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
  }, [confByKey]);

  const inferFromTeamForPrediction = useCallback((
    firstName: string | null | undefined,
    lastName: string | null | undefined,
    fromAvg: number | null | undefined,
    fromObp: number | null | undefined,
    fromSlg: number | null | undefined,
  ): string | null => {
    const fullName = `${firstName || ""} ${lastName || ""}`.trim();
    const candidates = seedByName.get(normalizeKey(fullName)) || [];
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0].team;
    const key = `${statKey(fromAvg ?? null)}|${statKey(fromObp ?? null)}|${statKey(fromSlg ?? null)}`;
    const exact = candidates.find((r) => `${statKey(r.avg)}|${statKey(r.obp)}|${statKey(r.slg)}` === key);
    return exact?.team || candidates[0].team;
  }, [seedByName]);

  const compareAPlayer = useMemo(() => allPlayersById.get(compareAPlayerId) || null, [allPlayersById, compareAPlayerId]);
  const compareBPlayer = useMemo(() => allPlayersById.get(compareBPlayerId) || null, [allPlayersById, compareBPlayerId]);

  const compareAPrediction = useMemo(
    () => selectTransferPortalPreferredPrediction((compareAPlayer?.player_predictions || []).filter((pr: any) => pr.variant === "regular")),
    [compareAPlayer],
  );
  const compareBPrediction = useMemo(
    () => selectTransferPortalPreferredPrediction((compareBPlayer?.player_predictions || []).filter((pr: any) => pr.variant === "regular")),
    [compareBPlayer],
  );

  const { data: compareAInternals } = useQuery({
    queryKey: ["compare-internals-a", compareAPrediction?.id],
    enabled: !!compareAPrediction?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_prediction_internals")
        .select("avg_power_rating, obp_power_rating, slg_power_rating")
        .eq("prediction_id", compareAPrediction!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: compareBInternals } = useQuery({
    queryKey: ["compare-internals-b", compareBPrediction?.id],
    enabled: !!compareBPrediction?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_prediction_internals")
        .select("avg_power_rating, obp_power_rating, slg_power_rating")
        .eq("prediction_id", compareBPrediction!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const computeCompareSimulation = useCallback((
    player: any | null,
    prediction: any | null,
    internals: { avg_power_rating: number | null; obp_power_rating: number | null; slg_power_rating: number | null } | null | undefined,
    destinationTeam: string,
  ) => {
    if (!player || !prediction || !destinationTeam) return null;

    const baPR = internals?.avg_power_rating ?? null;
    const obpPR = internals?.obp_power_rating ?? null;
    const isoPR = internals?.slg_power_rating ?? null;
    const lastAvg = prediction.from_avg ?? null;
    const lastObp = prediction.from_obp ?? null;
    const lastSlg = prediction.from_slg ?? null;
    if (baPR == null || obpPR == null || isoPR == null || lastAvg == null || lastObp == null || lastSlg == null) return null;

    const inferredFromTeam = inferFromTeamForPrediction(player.first_name, player.last_name, lastAvg, lastObp, lastSlg);
    const fromTeamName = player.from_team || inferredFromTeam || player.team || null;
    const fromTeamRow = fromTeamName ? teamByKey.get(normalizeKey(fromTeamName)) || null : null;
    const toTeamRow = teamByKey.get(normalizeKey(destinationTeam)) || null;
    if (!toTeamRow) return null;

    const fromConference = fromTeamRow?.conference || player.conference || null;
    const fromConfStats = resolveConferenceStats(fromConference);
    const toConfStats = resolveConferenceStats(toTeamRow.conference || null);
    if (
      !fromConfStats || !toConfStats ||
      fromConfStats.avg_plus == null || toConfStats.avg_plus == null ||
      fromConfStats.obp_plus == null || toConfStats.obp_plus == null ||
      fromConfStats.iso_plus == null || toConfStats.iso_plus == null ||
      fromConfStats.stuff_plus == null || toConfStats.stuff_plus == null ||
      fromTeamRow?.park_factor == null || toTeamRow.park_factor == null
    ) return null;

    const projected = computeTransferProjection({
      lastAvg, lastObp, lastSlg, baPR, obpPR, isoPR,
      fromAvgPlus: fromConfStats.avg_plus, toAvgPlus: toConfStats.avg_plus,
      fromObpPlus: fromConfStats.obp_plus, toObpPlus: toConfStats.obp_plus,
      fromIsoPlus: fromConfStats.iso_plus, toIsoPlus: toConfStats.iso_plus,
      fromStuff: fromConfStats.stuff_plus, toStuff: toConfStats.stuff_plus,
      fromPark: normalizeParkToIndex(fromTeamRow?.park_factor), toPark: normalizeParkToIndex(toTeamRow.park_factor),
      ncaaAvgBA: toRate(eqNum("t_ba_ncaa_avg", 0.280)),
      ncaaAvgOBP: toRate(eqNum("t_obp_ncaa_avg", 0.385)),
      ncaaAvgISO: toRate(eqNum("t_iso_ncaa_avg", 0.162)),
      ncaaAvgWrc: toRate(eqNum("t_wrc_ncaa_avg", 0.364)),
      baPowerWeight: toRate(eqNum("t_ba_power_weight", 0.70)),
      obpPowerWeight: toRate(eqNum("t_obp_power_weight", 0.70)),
      baConferenceWeight: toWeight(eqNum("t_ba_conference_weight", 1.0)),
      obpConferenceWeight: toWeight(eqNum("t_obp_conference_weight", 1.0)),
      isoConferenceWeight: toWeight(eqNum("t_iso_conference_weight", 1.0)),
      baPitchingWeight: toWeight(eqNum("t_ba_pitching_weight", 1.0)),
      obpPitchingWeight: toWeight(eqNum("t_obp_pitching_weight", 1.0)),
      isoPitchingWeight: toWeight(eqNum("t_iso_pitching_weight", 1.0)),
      baParkWeight: toWeight(eqNum("t_ba_park_weight", 1.0)),
      obpParkWeight: toWeight(eqNum("t_obp_park_weight", 1.0)),
      isoParkWeight: toWeight(eqNum("t_iso_park_weight", 1.0)),
      isoStdPower: eqNum("r_iso_std_pr", 45.423),
      isoStdNcaa: toRate(eqNum("r_iso_std_ncaa", 0.07849797197)),
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
      fromPark: fromTeamRow?.park_factor ?? null,
      toPark: toTeamRow.park_factor,
      fromAvgPlus: fromConfStats.avg_plus,
      toAvgPlus: toConfStats.avg_plus,
      fromObpPlus: fromConfStats.obp_plus,
      toObpPlus: toConfStats.obp_plus,
      fromIsoPlus: fromConfStats.iso_plus,
      toIsoPlus: toConfStats.iso_plus,
      fromStuff: fromConfStats.stuff_plus,
      toStuff: toConfStats.stuff_plus,
      nilValuation,
      ...projected,
    };
  }, [eqNum, inferFromTeamForPrediction, resolveConferenceStats, teamByKey]);

  const compareASimulation = useMemo(
    () => computeCompareSimulation(compareAPlayer, compareAPrediction, compareAInternals, compareADestinationTeam),
    [compareAPlayer, compareAPrediction, compareAInternals, compareADestinationTeam, computeCompareSimulation],
  );
  const compareBSimulation = useMemo(
    () => computeCompareSimulation(compareBPlayer, compareBPrediction, compareBInternals, compareBDestinationTeam),
    [compareBPlayer, compareBPrediction, compareBInternals, compareBDestinationTeam, computeCompareSimulation],
  );

  /* ── Stat Comparison logic ── */

  const availablePlayers = useMemo(() => {
    let list = allPredictions;
    if (modelFilter !== "all") list = list.filter((p) => p.model_type === modelFilter);
    return list.sort((a, b) => a.label.localeCompare(b.label));
  }, [allPredictions, modelFilter]);

  const selected = useMemo(
    () => selectedIds.map((id) => allPredictions.find((p) => p.id === id)).filter(Boolean) as ComparePlayer[],
    [selectedIds, allPredictions]
  );

  const addPlayer = (id: string) => {
    if (!selectedIds.includes(id) && selectedIds.length < 5) setSelectedIds([...selectedIds, id]);
  };

  const removePlayer = (id: string) => setSelectedIds(selectedIds.filter((s) => s !== id));

  const radarData = useMemo(() => {
    if (selected.length === 0) return [];
    const stats = [
      { key: "p_avg", label: "AVG", max: 0.400 },
      { key: "p_obp", label: "OBP", max: 0.550 },
      { key: "p_slg", label: "SLG", max: 0.800 },
      { key: "p_iso", label: "ISO", max: 0.350 },
      { key: "p_wrc_plus", label: "wRC+", max: 180 },
      { key: "power_rating_plus", label: "PWR+", max: 160 },
    ];
    return stats.map((s) => {
      const point: Record<string, any> = { stat: s.label };
      selected.forEach((p, i) => {
        const raw = (p as any)[s.key] ?? 0;
        point[`player${i}`] = Math.min(100, (raw / s.max) * 100);
        point[`player${i}Raw`] = raw;
      });
      return point;
    });
  }, [selected]);

  const chartConfig = useMemo(() => {
    const config: Record<string, { label: string; color: string }> = {};
    selected.forEach((p, i) => { config[`player${i}`] = { label: p.label, color: COLORS[i] }; });
    return config;
  }, [selected]);

  const statRows = [
    { label: "pAVG", key: "p_avg", fmt: statFormat },
    { label: "pOBP", key: "p_obp", fmt: statFormat },
    { label: "pSLG", key: "p_slg", fmt: statFormat },
    { label: "pOPS", key: "p_ops", fmt: statFormat },
    { label: "pISO", key: "p_iso", fmt: statFormat },
    { label: "wRC+", key: "p_wrc_plus", fmt: pctFormat },
    { label: "PWR+", key: "power_rating_plus", fmt: pctFormat },
    { label: "EV Score", key: "ev_score", fmt: pctFormat },
    { label: "Barrel Score", key: "barrel_score", fmt: pctFormat },
    { label: "Whiff Score", key: "whiff_score", fmt: pctFormat },
    { label: "Chase Score", key: "chase_score", fmt: pctFormat },
  ];

  /* ── Render helper for a single compare panel ── */

  const renderComparePanel = (
    label: string,
    description: string,
    playerSearch: string,
    setPlayerSearch: (v: string) => void,
    playerOpen: boolean,
    setPlayerOpen: (v: boolean) => void,
    filteredPlayers: any[],
    setPlayerId: (v: string) => void,
    teamSearch: string,
    setTeamSearch: (v: string) => void,
    teamOpen: boolean,
    setTeamOpen: (v: boolean) => void,
    filteredTeams: TeamRow[],
    setDestTeam: (v: string) => void,
    player: any | null,
    simulation: any | null,
  ) => (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{label}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <Label className="text-xs mb-1 block">Player</Label>
          <Input
            placeholder="Search player by name, team, or position…"
            value={playerSearch}
            onChange={(e) => { setPlayerSearch(e.target.value); setPlayerOpen(true); }}
            onFocus={() => setPlayerOpen(true)}
            onBlur={() => setTimeout(() => setPlayerOpen(false), 150)}
          />
          {playerOpen && filteredPlayers.length > 0 && (
            <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-72 overflow-auto">
              {filteredPlayers.map((p: any) => (
                <div
                  key={`panel-${label}-${p.id}`}
                  className="px-3 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground flex justify-between items-center gap-2"
                  onMouseDown={() => {
                    setPlayerId(p.id);
                    setPlayerSearch(`${p.first_name} ${p.last_name}`);
                    setPlayerOpen(false);
                  }}
                >
                  <span className="font-medium">{p.first_name} {p.last_name}</span>
                  <span className="text-muted-foreground text-xs">{p.team || "—"} · {p.position || "—"}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="relative">
          <Label className="text-xs mb-1 block">To Team</Label>
          <Input
            placeholder="Search destination team…"
            value={teamSearch}
            onChange={(e) => { setTeamSearch(e.target.value); setTeamOpen(true); }}
            onFocus={() => setTeamOpen(true)}
            onBlur={() => setTimeout(() => setTeamOpen(false), 150)}
          />
          {teamOpen && filteredTeams.length > 0 && (
            <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-72 overflow-auto">
              {filteredTeams.map((t) => (
                <div
                  key={`panel-${label}-team-${t.name}`}
                  className="px-3 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground"
                  onMouseDown={() => {
                    setDestTeam(t.name);
                    setTeamSearch(t.name);
                    setTeamOpen(false);
                  }}
                >
                  {t.name} {t.conference ? `· ${t.conference}` : ""}
                </div>
              ))}
            </div>
          )}
        </div>

        {player?.id && (
          <div className="text-xs text-muted-foreground">
            Selected:{" "}
            <Link className="underline underline-offset-2 text-primary" to={`/dashboard/player/${player.id}`}>
              {player.first_name} {player.last_name}
            </Link>
          </div>
        )}

        {simulation ? (
          <div className="space-y-3">
            <div className="rounded-md border p-3 bg-muted/20">
              <p className="text-xs font-medium mb-2">Context + Multipliers Used</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div>From Team</div><div className="font-mono text-right">{simulation.fromTeam || "—"}</div>
                <div>From Conference</div><div className="font-mono text-right">{simulation.fromConference || "—"}</div>
                <div>To Conference</div><div className="font-mono text-right">{simulation.toConference || "—"}</div>
                <div>From Park Factor</div><div className="font-mono text-right">{simulation.fromPark ?? "—"}</div>
                <div>To Park Factor</div><div className="font-mono text-right">{simulation.toPark ?? "—"}</div>
                <div>AVG+ Delta</div><div className="font-mono text-right">{simulation.fromAvgPlus} → {simulation.toAvgPlus}</div>
                <div>OBP+ Delta</div><div className="font-mono text-right">{simulation.fromObpPlus} → {simulation.toObpPlus}</div>
                <div>ISO+ Delta</div><div className="font-mono text-right">{simulation.fromIsoPlus} → {simulation.toIsoPlus}</div>
                <div>Stuff+ Delta</div><div className="font-mono text-right">{simulation.fromStuff} → {simulation.toStuff}</div>
              </div>
            </div>

            <div className="rounded-md border p-3">
              <p className="text-xs font-medium mb-2">Projected Outcomes</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div>pAVG / pOBP / pSLG</div>
                <div className="font-mono text-right">
                  {simulation.pAvg?.toFixed(3) ?? "—"} / {simulation.pObp?.toFixed(3) ?? "—"} / {simulation.pSlg?.toFixed(3) ?? "—"}
                </div>
                <div>pOPS</div><div className="font-mono text-right">{simulation.pOps?.toFixed(3) ?? "—"}</div>
                <div>pISO</div><div className="font-mono text-right">{simulation.pIso?.toFixed(3) ?? "—"}</div>
                <div>pWRC+</div><div className="font-mono text-right">{simulation.pWrcPlus?.toFixed(0) ?? "—"}</div>
                <div>oWAR</div><div className="font-mono text-right">{simulation.owar?.toFixed(2) ?? "—"}</div>
                <div>Projected NIL</div><div className="font-mono text-right">{simulation.nilValuation != null ? `$${Math.round(simulation.nilValuation).toLocaleString()}` : "—"}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            Select player and destination team to run comparison panel {label.replace("Compare ", "")}.
          </div>
        )}
      </CardContent>
    </Card>
  );

  /* ── JSX ── */

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Compare</h2>
          <p className="text-muted-foreground text-sm">Transfer simulations and side-by-side stat comparison</p>
        </div>

        <Tabs defaultValue="transfer-sim">
          <TabsList>
            <TabsTrigger value="transfer-sim">Transfer Simulation</TabsTrigger>
            <TabsTrigger value="stat-compare">Stat Comparison</TabsTrigger>
          </TabsList>

          {/* ── Transfer Simulation (moved from Team Builder) ── */}
          <TabsContent value="transfer-sim" className="space-y-6">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {renderComparePanel(
                "Compare A",
                "Run Transfer Portal simulation inputs in a standalone panel.",
                compareAPlayerSearch, setCompareAPlayerSearch,
                compareAPlayerOpen, setCompareAPlayerOpen,
                filteredCompareAPlayers, setCompareAPlayerId,
                compareATeamSearch, setCompareATeamSearch,
                compareATeamOpen, setCompareATeamOpen,
                filteredCompareATeams, setCompareADestinationTeam,
                compareAPlayer, compareASimulation,
              )}
              {renderComparePanel(
                "Compare B",
                "Independent panel. You can select the same player as Compare A.",
                compareBPlayerSearch, setCompareBPlayerSearch,
                compareBPlayerOpen, setCompareBPlayerOpen,
                filteredCompareBPlayers, setCompareBPlayerId,
                compareBTeamSearch, setCompareBTeamSearch,
                compareBTeamOpen, setCompareBTeamOpen,
                filteredCompareBTeams, setCompareBDestinationTeam,
                compareBPlayer, compareBSimulation,
              )}
            </div>
          </TabsContent>

          {/* ── Stat Comparison (original) ── */}
          <TabsContent value="stat-compare" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <GitCompare className="h-4 w-4" />
                  Select Players (up to 5)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-3 flex-wrap items-center">
                  <Select value={modelFilter} onValueChange={(v) => setModelFilter(v as any)}>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Models</SelectItem>
                      <SelectItem value="returner">Returning</SelectItem>
                      <SelectItem value="transfer">Transfer Portal</SelectItem>
                    </SelectContent>
                  </Select>

                  {selectedIds.length < 5 && (
                    <Select value="" onValueChange={addPlayer}>
                      <SelectTrigger className="w-64">
                        <SelectValue placeholder="Add a player..." />
                      </SelectTrigger>
                      <SelectContent>
                        {availablePlayers
                          .filter((p) => !selectedIds.includes(p.id))
                          .map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.label} ({p.model_type === "returner" ? "RET" : "TP"})
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {selected.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {selected.map((p, i) => (
                      <Badge
                        key={p.id}
                        variant="secondary"
                        className="gap-1 py-1.5 pl-3 pr-1.5"
                        style={{ borderLeft: `3px solid ${COLORS[i]}` }}
                      >
                        {p.label}
                        <span className="text-[10px] text-muted-foreground ml-1">
                          {p.model_type === "returner" ? "RET" : "TP"}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-4 w-4 p-0 ml-1 hover:bg-destructive/20"
                          onClick={() => removePlayer(p.id)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {selected.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <GitCompare className="h-10 w-10 mb-3 opacity-40" />
                  <p>Select at least two players to compare</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {selected.length >= 2 && radarData.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Radar Comparison</CardTitle>
                      <CardDescription>Stats normalized to 0–100 scale for visual comparison</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ChartContainer config={chartConfig} className="h-[350px]">
                        <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="75%">
                          <PolarGrid stroke="hsl(var(--border))" />
                          <PolarAngleAxis dataKey="stat" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                          <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                          {selected.map((_, i) => (
                            <Radar
                              key={i}
                              name={selected[i].label}
                              dataKey={`player${i}`}
                              stroke={COLORS[i]}
                              fill={COLORS[i]}
                              fillOpacity={0.1}
                              strokeWidth={2}
                            />
                          ))}
                          <ChartTooltip content={<ChartTooltipContent />} />
                        </RadarChart>
                      </ChartContainer>
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Stat Comparison</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left p-3 font-medium text-muted-foreground">Stat</th>
                            {selected.map((p, i) => (
                              <th key={p.id} className="text-right p-3 font-medium" style={{ color: COLORS[i] }}>
                                {p.label.split(" ").pop()}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {statRows.map((row) => {
                            const values = selected.map((p) => (p as any)[row.key] as number | null);
                            const best = Math.max(...values.filter((v): v is number => v != null));
                            return (
                              <tr key={row.key} className="border-b border-border/50">
                                <td className="p-3 text-muted-foreground font-medium">{row.label}</td>
                                {selected.map((p, i) => {
                                  const val = (p as any)[row.key] as number | null;
                                  const isBest = val != null && val === best && selected.length > 1;
                                  return (
                                    <td
                                      key={p.id}
                                      className={`p-3 text-right font-mono ${isBest ? "font-bold text-[hsl(var(--success))]" : ""}`}
                                    >
                                      {row.fmt(val)}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                          <tr className="border-b border-border/50">
                            <td className="p-3 text-muted-foreground font-medium">Model</td>
                            {selected.map((p) => (
                              <td key={p.id} className="p-3 text-right">
                                <Badge variant="secondary" className="text-[10px]">
                                  {p.model_type === "returner" ? "Returning" : "Transfer"}
                                </Badge>
                              </td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
