import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { computeTransferProjection } from "@/lib/transferProjection";
import { DEFAULT_NIL_TIER_MULTIPLIERS, getPositionValueMultiplier, getProgramTierMultiplierByConference } from "@/lib/nilProgramSpecific";
import { getConferenceAliases } from "@/lib/conferenceMapping";
import storage2025Seed from "@/data/storage_2025_seed.json";

type TeamRow = { name: string; conference: string | null; park_factor: number | null };
type ConferenceRow = { conference: string; season: number | null; avg_plus: number | null; obp_plus: number | null; iso_plus: number | null; stuff_plus: number | null };
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

type SimPanel = {
  player: PlayerLite | null;
  simulation: ReturnType<typeof simulate> | null;
  previous: {
    avg: number | null;
    obp: number | null;
    slg: number | null;
  } | null;
};
type TargetBoardEntry = {
  playerId: string;
  playerName: string;
  destinationTeam: string;
  fromTeam: string | null;
  fromConference: string | null;
  pAvg: number | null;
  pObp: number | null;
  pSlg: number | null;
  pWrcPlus: number | null;
  owar: number | null;
  nilValuation: number | null;
  createdAt: string;
};
const TARGET_BOARD_STORAGE_KEY = "team_builder_target_board_v1";

const metricTone = (value: number | null | undefined, average: number, good: number) => {
  if (value == null) return "border-muted text-muted-foreground";
  if (value >= good) return "border-emerald-500/40 text-emerald-700";
  if (value >= average) return "border-amber-500/40 text-amber-700";
  return "border-rose-500/40 text-rose-700";
};
const readTargetBoard = (): TargetBoardEntry[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(TARGET_BOARD_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TargetBoardEntry[]) : [];
  } catch {
    return [];
  }
};
const writeTargetBoard = (rows: TargetBoardEntry[]) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TARGET_BOARD_STORAGE_KEY, JSON.stringify(rows));
};

const normalizeName = (value: string | null | undefined) =>
  (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
const selectTransferPortalPreferredPrediction = (predictions: PlayerLite["player_predictions"] | null | undefined) => {
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

type SimOut = {
  fromTeam: string | null;
  fromConference: string | null;
  toConference: string | null;
  fromPark: number | null;
  toPark: number | null;
  fromAvgPlus: number;
  toAvgPlus: number;
  fromObpPlus: number;
  toObpPlus: number;
  fromIsoPlus: number;
  toIsoPlus: number;
  fromStuff: number;
  toStuff: number;
  pAvg: number;
  pObp: number;
  pSlg: number;
  pOps: number;
  pIso: number;
  pWrcPlus: number | null;
  owar: number | null;
  nilValuation: number | null;
};

function simulate(args: {
  player: PlayerLite;
  destinationTeam: string;
  prediction: NonNullable<ReturnType<typeof selectTransferPortalPreferredPrediction>>;
  internals: PredictionInternal | null;
  teamByKey: Map<string, TeamRow>;
  confByKey: Map<string, ConferenceRow>;
  seedByName: Map<string, SeedRow[]>;
  eqNum: (key: string, fallback: number) => number;
}): SimOut | null {
  const { player, destinationTeam, prediction, internals, teamByKey, confByKey, seedByName, eqNum } = args;
  const baPR = internals?.avg_power_rating ?? null;
  const obpPR = internals?.obp_power_rating ?? null;
  const isoPR = internals?.slg_power_rating ?? null;
  const lastAvg = prediction.from_avg;
  const lastObp = prediction.from_obp;
  const lastSlg = prediction.from_slg;
  if (baPR == null || obpPR == null || isoPR == null || lastAvg == null || lastObp == null || lastSlg == null) return null;

  const fullName = `${player.first_name || ""} ${player.last_name || ""}`.trim();
  const candidates = seedByName.get(normalizeKey(fullName)) || [];
  let inferredFromTeam: string | null = null;
  if (candidates.length === 1) inferredFromTeam = candidates[0].team;
  else if (candidates.length > 1) {
    const key = `${statKey(lastAvg)}|${statKey(lastObp)}|${statKey(lastSlg)}`;
    const exact = candidates.find((r) => `${statKey(r.avg)}|${statKey(r.obp)}|${statKey(r.slg)}` === key);
    inferredFromTeam = exact?.team || candidates[0].team;
  }

  const fromTeamName = player.from_team || inferredFromTeam || player.team || null;
  const fromTeamRow = fromTeamName ? teamByKey.get(normalizeKey(fromTeamName)) || null : null;
  const toTeamRow = teamByKey.get(normalizeKey(destinationTeam)) || null;
  if (!toTeamRow) return null;

  const resolveConferenceStats = (conference: string | null | undefined): ConferenceRow | null => {
    const aliases = getConferenceAliases(conference);
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
  };

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
    fromPark: normalizeParkToIndex(fromTeamRow.park_factor), toPark: normalizeParkToIndex(toTeamRow.park_factor),
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
    baConferenceWeight: toWeight(eqNum("t_ba_conference_weight", 1.0)),
    obpConferenceWeight: toWeight(eqNum("t_obp_conference_weight", 1.0)),
    isoConferenceWeight: toWeight(eqNum("t_iso_conference_weight", 1.0)),
    baPitchingWeight: toWeight(eqNum("t_ba_pitching_weight", 1.0)),
    obpPitchingWeight: toWeight(eqNum("t_obp_pitching_weight", 1.0)),
    isoPitchingWeight: toWeight(eqNum("t_iso_pitching_weight", 1.0)),
    baParkWeight: toWeight(eqNum("t_ba_park_weight", 1.0)),
    obpParkWeight: toWeight(eqNum("t_obp_park_weight", 1.0)),
    isoParkWeight: toWeight(eqNum("t_iso_park_weight", 1.0)),
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
    fromPark: fromTeamRow.park_factor,
    toPark: toTeamRow.park_factor,
    fromAvgPlus: fromConfStats.avg_plus,
    toAvgPlus: toConfStats.avg_plus,
    fromObpPlus: fromConfStats.obp_plus,
    toObpPlus: toConfStats.obp_plus,
    fromIsoPlus: fromConfStats.iso_plus,
    toIsoPlus: toConfStats.iso_plus,
    fromStuff: fromConfStats.stuff_plus,
    toStuff: toConfStats.stuff_plus,
    pAvg: projected.pAvg,
    pObp: projected.pObp,
    pSlg: projected.pSlg,
    pOps: projected.pOps,
    pIso: projected.pIso,
    pWrcPlus: projected.pWrcPlus,
    owar: projected.owar,
    nilValuation,
  };
}

export default function PlayerComparison() {
  const { toast } = useToast();
  const [compareAPlayerId, setCompareAPlayerId] = useState("");
  const [compareAPlayerSearch, setCompareAPlayerSearch] = useState("");
  const [compareAPlayerOpen, setCompareAPlayerOpen] = useState(false);
  const [compareATeamSearch, setCompareATeamSearch] = useState("");
  const [compareATeamOpen, setCompareATeamOpen] = useState(false);
  const [compareADestinationTeam, setCompareADestinationTeam] = useState("");
  const [compareBPlayerId, setCompareBPlayerId] = useState("");
  const [compareBPlayerSearch, setCompareBPlayerSearch] = useState("");
  const [compareBPlayerOpen, setCompareBPlayerOpen] = useState(false);
  const [compareBTeamSearch, setCompareBTeamSearch] = useState("");
  const [compareBTeamOpen, setCompareBTeamOpen] = useState(false);
  const [compareBDestinationTeam, setCompareBDestinationTeam] = useState("");

  const { data: teams = [] } = useQuery({
    queryKey: ["compare-teams-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("teams").select("name, conference, park_factor").order("name");
      if (error) throw error;
      return (data || []) as TeamRow[];
    },
  });
  const { data: conferenceStats = [] } = useQuery({
    queryKey: ["compare-conference-stats"],
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
        const ex = byConf.get(key);
        if (!ex || score > ex.score) byConf.set(key, { row, score });
      }
      return Array.from(byConf.values()).map((v) => v.row);
    },
  });
  const { data: remoteEquationValues = {} } = useQuery({
    queryKey: ["compare-admin-ui-equation-values"],
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
  const { data: allPlayers = [] } = useQuery({
    queryKey: ["compare-all-players"],
    queryFn: async () => {
      let all: any[] = [];
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("players")
          .select("id, first_name, last_name, position, team, from_team, conference, player_predictions(id, from_avg, from_obp, from_slg, model_type, variant, status, updated_at)")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        all = all.concat(data || []);
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }
      return all.filter((p) => p.first_name && p.last_name) as PlayerLite[];
    },
  });

  const compareAPrediction = useMemo(() => {
    const p = allPlayers.find((r) => r.id === compareAPlayerId);
    return p ? selectTransferPortalPreferredPrediction((p.player_predictions || []).filter((pr) => pr.variant === "regular")) : null;
  }, [allPlayers, compareAPlayerId]);
  const compareBPrediction = useMemo(() => {
    const p = allPlayers.find((r) => r.id === compareBPlayerId);
    return p ? selectTransferPortalPreferredPrediction((p.player_predictions || []).filter((pr) => pr.variant === "regular")) : null;
  }, [allPlayers, compareBPlayerId]);

  const internalIds = useMemo(() => [compareAPrediction?.id, compareBPrediction?.id].filter(Boolean) as string[], [compareAPrediction?.id, compareBPrediction?.id]);
  const { data: internals = [] } = useQuery({
    queryKey: ["compare-internals", internalIds],
    enabled: internalIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_prediction_internals")
        .select("prediction_id, avg_power_rating, obp_power_rating, slg_power_rating")
        .in("prediction_id", internalIds);
      if (error) throw error;
      return (data || []) as PredictionInternal[];
    },
  });

  const internalsByPrediction = useMemo(() => {
    const map = new Map<string, PredictionInternal>();
    for (const i of internals) map.set(i.prediction_id, i);
    return map;
  }, [internals]);
  const teamByKey = useMemo(() => new Map((teams || []).map((t) => [normalizeKey(t.name), t as TeamRow])), [teams]);
  const confByKey = useMemo(() => new Map((conferenceStats || []).map((c) => [normalizeKey(c.conference), c as ConferenceRow])), [conferenceStats]);
  const seedByName = useMemo(() => {
    const map = new Map<string, SeedRow[]>();
    for (const row of storage2025Seed as SeedRow[]) {
      const key = normalizeKey(row.playerName);
      if (!key || !row.team) continue;
      const list = map.get(key) || [];
      list.push(row);
      map.set(key, list);
    }
    return map;
  }, []);
  const eqNum = useCallback((key: string, fallback: number) => readLocalNum(key, fallback, remoteEquationValues), [remoteEquationValues]);

  const filterPlayers = useCallback((q: string) => {
    const nq = normalizeName(q);
    if (!nq) return [] as PlayerLite[];
    return allPlayers.filter((p) => normalizeName(`${p.first_name} ${p.last_name} ${p.team || ""} ${p.position || ""}`).includes(nq)).slice(0, 25);
  }, [allPlayers]);
  const filterTeams = useCallback((q: string) => {
    const nq = normalizeName(q);
    if (!nq) return [] as TeamRow[];
    return (teams as TeamRow[]).filter((t) => normalizeName(`${t.name} ${t.conference || ""}`).includes(nq)).slice(0, 30);
  }, [teams]);
  const filteredAPlayers = useMemo(() => filterPlayers(compareAPlayerSearch), [filterPlayers, compareAPlayerSearch]);
  const filteredBPlayers = useMemo(() => filterPlayers(compareBPlayerSearch), [filterPlayers, compareBPlayerSearch]);
  const filteredATeams = useMemo(() => filterTeams(compareATeamSearch), [filterTeams, compareATeamSearch]);
  const filteredBTeams = useMemo(() => filterTeams(compareBTeamSearch), [filterTeams, compareBTeamSearch]);

  const compareAPlayer = useMemo(() => allPlayers.find((p) => p.id === compareAPlayerId) || null, [allPlayers, compareAPlayerId]);
  const compareBPlayer = useMemo(() => allPlayers.find((p) => p.id === compareBPlayerId) || null, [allPlayers, compareBPlayerId]);

  const panelA: SimPanel = useMemo(() => {
    const previous = compareAPrediction
      ? { avg: compareAPrediction.from_avg, obp: compareAPrediction.from_obp, slg: compareAPrediction.from_slg }
      : null;
    if (!compareAPlayer || !compareADestinationTeam || !compareAPrediction) return { player: compareAPlayer, simulation: null, previous };
    return {
      player: compareAPlayer,
      previous,
      simulation: simulate({
        player: compareAPlayer,
        destinationTeam: compareADestinationTeam,
        prediction: compareAPrediction,
        internals: internalsByPrediction.get(compareAPrediction.id) || null,
        teamByKey,
        confByKey,
        seedByName,
        eqNum,
      }),
    };
  }, [compareAPlayer, compareADestinationTeam, compareAPrediction, internalsByPrediction, teamByKey, confByKey, seedByName, eqNum]);

  const panelB: SimPanel = useMemo(() => {
    const previous = compareBPrediction
      ? { avg: compareBPrediction.from_avg, obp: compareBPrediction.from_obp, slg: compareBPrediction.from_slg }
      : null;
    if (!compareBPlayer || !compareBDestinationTeam || !compareBPrediction) return { player: compareBPlayer, simulation: null, previous };
    return {
      player: compareBPlayer,
      previous,
      simulation: simulate({
        player: compareBPlayer,
        destinationTeam: compareBDestinationTeam,
        prediction: compareBPrediction,
        internals: internalsByPrediction.get(compareBPrediction.id) || null,
        teamByKey,
        confByKey,
        seedByName,
        eqNum,
      }),
    };
  }, [compareBPlayer, compareBDestinationTeam, compareBPrediction, internalsByPrediction, teamByKey, confByKey, seedByName, eqNum]);

  const renderPanel = (
    title: string,
    playerSearch: string,
    setPlayerSearch: (v: string) => void,
    playerOpen: boolean,
    setPlayerOpen: (v: boolean) => void,
    teamSearch: string,
    setTeamSearch: (v: string) => void,
    teamOpen: boolean,
    setTeamOpen: (v: boolean) => void,
    filteredPlayers: PlayerLite[],
    filteredTeams: TeamRow[],
    onPickPlayer: (p: PlayerLite) => void,
    onPickTeam: (t: TeamRow) => void,
    panel: SimPanel,
    onAddToTargetBoard: () => void,
  ) => {
    return (
    <Card className="overflow-hidden border-border/70 shadow-sm bg-card">
      <CardHeader className="pb-3 border-b bg-muted/20">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>Transfer simulation panel</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                {filteredPlayers.map((p) => (
                  <div
                    key={`${title}-player-${p.id}`}
                    className="px-3 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground flex justify-between items-center gap-2"
                    onMouseDown={() => onPickPlayer(p)}
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
                    key={`${title}-team-${t.name}`}
                    className="px-3 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground"
                    onMouseDown={() => onPickTeam(t)}
                  >
                    {t.name} {t.conference ? `· ${t.conference}` : ""}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {panel.player?.id && (
          <div className="text-xs text-muted-foreground rounded-md border bg-muted/30 px-2.5 py-2">
            Selected:{" "}
            <Link className="underline underline-offset-2 text-primary" to={`/dashboard/player/${panel.player.id}`}>
              {panel.player.first_name} {panel.player.last_name}
            </Link>
            <div className="mt-1">
              Previous:{" "}
              <span className="font-mono">
                {panel.previous?.avg != null && panel.previous?.obp != null && panel.previous?.slg != null
                  ? `${panel.previous.avg.toFixed(3)} / ${panel.previous.obp.toFixed(3)} / ${panel.previous.slg.toFixed(3)}`
                  : "—"}
              </span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          {panel.player?.id ? (
            <Button asChild size="sm" variant="outline">
              <Link to={`/dashboard/player/${panel.player.id}`}>View Player Profile</Link>
            </Button>
          ) : null}
          <Button size="sm" onClick={onAddToTargetBoard} disabled={!panel.player || !panel.simulation}>
            Add to Target Board
          </Button>
        </div>

        {panel.simulation ? (
          <div className="space-y-3">
            <div className="rounded-md border p-3">
              <p className="text-xs font-semibold mb-2 uppercase tracking-wide">Projected Outcomes</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="col-span-2 rounded-md border px-2 py-2 bg-muted/20">
                  <div className="text-[11px] text-muted-foreground">pAVG / pOBP / pSLG / pOPS / pISO</div>
                  <div className="font-mono font-semibold">
                    {panel.simulation.pAvg.toFixed(3)} / {panel.simulation.pObp.toFixed(3)} / {panel.simulation.pSlg.toFixed(3)} / {panel.simulation.pOps.toFixed(3)} / {panel.simulation.pIso.toFixed(3)}
                  </div>
                </div>
                <div className={`rounded-md border px-2 py-2 bg-muted/20 ${metricTone(panel.simulation.pWrcPlus, 100, 110)}`}>
                  <div className="text-[12px] font-semibold">pWRC+</div>
                  <div className="font-mono text-xl font-bold leading-none mt-1">{panel.simulation.pWrcPlus?.toFixed(0) ?? "—"}</div>
                </div>
                <div className={`rounded-md border px-2 py-2 bg-muted/20 ${metricTone(panel.simulation.owar, 0.5, 1.5)}`}>
                  <div className="text-[12px] font-semibold">oWAR</div>
                  <div className="font-mono text-xl font-bold leading-none mt-1">{panel.simulation.owar?.toFixed(2) ?? "—"}</div>
                </div>
                <div className="col-span-2 rounded-md border px-2 py-2 bg-muted/20">
                  <div className="text-[12px] font-semibold">Projected NIL</div>
                  <div className="font-mono text-2xl font-bold leading-tight">
                    {panel.simulation.nilValuation != null ? `$${Math.round(panel.simulation.nilValuation).toLocaleString()}` : "—"}
                  </div>
                </div>
              </div>
            </div>
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wide">
                Context + Multipliers Used
              </summary>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div>From Team</div><div className="text-right font-mono">{panel.simulation.fromTeam || "—"}</div>
                <div>From Conference</div><div className="text-right font-mono">{panel.simulation.fromConference || "—"}</div>
                <div>To Conference</div><div className="text-right font-mono">{panel.simulation.toConference || "—"}</div>
                <div>Park (From → To)</div><div className="text-right font-mono">{panel.simulation.fromPark ?? "—"} → {panel.simulation.toPark ?? "—"}</div>
                <div>AVG+ Delta</div><div className="text-right font-mono">{panel.simulation.fromAvgPlus} → {panel.simulation.toAvgPlus}</div>
                <div>OBP+ Delta</div><div className="text-right font-mono">{panel.simulation.fromObpPlus} → {panel.simulation.toObpPlus}</div>
                <div>ISO+ Delta</div><div className="text-right font-mono">{panel.simulation.fromIsoPlus} → {panel.simulation.toIsoPlus}</div>
                <div>Stuff+ Delta</div><div className="text-right font-mono">{panel.simulation.fromStuff} → {panel.simulation.toStuff}</div>
              </div>
            </details>
          </div>
        ) : (
          <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            Select player and destination team to run this panel.
          </div>
        )}
      </CardContent>
    </Card>
  )};

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-[1350px] mx-auto">
        <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-4">
          <h2 className="text-2xl font-bold tracking-tight">Compare Dashboard</h2>
          <p className="text-muted-foreground">Two independent transfer simulation panels side-by-side.</p>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {renderPanel(
            "Player A",
            compareAPlayerSearch,
            setCompareAPlayerSearch,
            compareAPlayerOpen,
            setCompareAPlayerOpen,
            compareATeamSearch,
            setCompareATeamSearch,
            compareATeamOpen,
            setCompareATeamOpen,
            filteredAPlayers,
            filteredATeams,
            (p) => { setCompareAPlayerId(p.id); setCompareAPlayerSearch(`${p.first_name} ${p.last_name}`); setCompareAPlayerOpen(false); },
            (t) => { setCompareADestinationTeam(t.name); setCompareATeamSearch(t.name); setCompareATeamOpen(false); },
            panelA,
            () => {
              if (!panelA.player || !panelA.simulation || !compareADestinationTeam) {
                toast({ title: "Select player + destination", description: "Run a simulation before adding to target board." });
                return;
              }
              const playerName = `${panelA.player.first_name || ""} ${panelA.player.last_name || ""}`.trim();
              const existing = readTargetBoard();
              const deduped = existing.filter(
                (r) => !(r.playerId === panelA.player!.id && normalizeKey(r.destinationTeam) === normalizeKey(compareADestinationTeam)),
              );
              deduped.unshift({
                playerId: panelA.player.id,
                playerName,
                destinationTeam: compareADestinationTeam,
                fromTeam: panelA.simulation.fromTeam,
                fromConference: panelA.simulation.fromConference,
                pAvg: panelA.simulation.pAvg,
                pObp: panelA.simulation.pObp,
                pSlg: panelA.simulation.pSlg,
                pWrcPlus: panelA.simulation.pWrcPlus,
                owar: panelA.simulation.owar,
                nilValuation: panelA.simulation.nilValuation,
                createdAt: new Date().toISOString(),
              });
              writeTargetBoard(deduped);
              toast({ title: "Added to Target Board", description: `${playerName} -> ${compareADestinationTeam}` });
            },
          )}
          {renderPanel(
            "Player B",
            compareBPlayerSearch,
            setCompareBPlayerSearch,
            compareBPlayerOpen,
            setCompareBPlayerOpen,
            compareBTeamSearch,
            setCompareBTeamSearch,
            compareBTeamOpen,
            setCompareBTeamOpen,
            filteredBPlayers,
            filteredBTeams,
            (p) => { setCompareBPlayerId(p.id); setCompareBPlayerSearch(`${p.first_name} ${p.last_name}`); setCompareBPlayerOpen(false); },
            (t) => { setCompareBDestinationTeam(t.name); setCompareBTeamSearch(t.name); setCompareBTeamOpen(false); },
            panelB,
            () => {
              if (!panelB.player || !panelB.simulation || !compareBDestinationTeam) {
                toast({ title: "Select player + destination", description: "Run a simulation before adding to target board." });
                return;
              }
              const playerName = `${panelB.player.first_name || ""} ${panelB.player.last_name || ""}`.trim();
              const existing = readTargetBoard();
              const deduped = existing.filter(
                (r) => !(r.playerId === panelB.player!.id && normalizeKey(r.destinationTeam) === normalizeKey(compareBDestinationTeam)),
              );
              deduped.unshift({
                playerId: panelB.player.id,
                playerName,
                destinationTeam: compareBDestinationTeam,
                fromTeam: panelB.simulation.fromTeam,
                fromConference: panelB.simulation.fromConference,
                pAvg: panelB.simulation.pAvg,
                pObp: panelB.simulation.pObp,
                pSlg: panelB.simulation.pSlg,
                pWrcPlus: panelB.simulation.pWrcPlus,
                owar: panelB.simulation.owar,
                nilValuation: panelB.simulation.nilValuation,
                createdAt: new Date().toISOString(),
              });
              writeTargetBoard(deduped);
              toast({ title: "Added to Target Board", description: `${playerName} -> ${compareBDestinationTeam}` });
            },
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
