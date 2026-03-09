import { useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Search } from "lucide-react";
import storage2025Seed from "@/data/storage_2025_seed.json";
import {
  DEFAULT_NIL_TIER_MULTIPLIERS,
  getPositionValueMultiplier,
  getProgramTierMultiplierByConference,
} from "@/lib/nilProgramSpecific";

type SimPlayer = {
  prediction_id: string;
  player_id: string;
  model_type: string;
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
};

type ConferenceRow = {
  conference: string;
  season?: number | null;
  avg_plus: number | null;
  obp_plus: number | null;
  iso_plus: number | null;
  stuff_plus: number | null;
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

const conferenceKeyAliases = (conference: string | null | undefined): string[] => {
  const key = normalizeKey(conference);
  if (!key) return [];

  const aliases = new Set<string>([key, key.replace(" conference", "").trim()]);

  if (key === "sec" || key.includes("southeastern")) aliases.add("southeastern conference");
  if (key === "acc" || key.includes("atlantic coast")) aliases.add("atlantic coast conference");
  if (key === "big 12" || key === "big12" || key.includes("big 12")) aliases.add("big 12");
  if (key === "big ten" || key === "big10" || key.includes("big ten")) {
    aliases.add("big ten");
    aliases.add("big10");
  }
  if (key === "aac" || key.includes("american athletic")) aliases.add("american athletic conference");
  if (key === "a 10" || key === "a10" || key.includes("atlantic 10")) aliases.add("atlantic 10");
  if (key === "caa" || key.includes("coastal athletic")) aliases.add("coastal athletic association");
  if (key === "mac" || key.includes("mid american")) aliases.add("mid american conference");
  if (key === "mvc" || key.includes("missouri valley")) aliases.add("missouri valley conference");
  if (key === "nec" || key.includes("northeast")) aliases.add("northeast conference");
  if (key === "wac" || key.includes("western athletic")) aliases.add("western athletic conference");
  if (key === "wcc" || key.includes("west coast")) aliases.add("west coast conference");
  if (key === "cusa" || key.includes("conference usa")) aliases.add("conference usa");
  if (key === "mwc" || key.includes("mountain west")) {
    aliases.add("mountain west");
    aliases.add("mwc");
  }
  if (key === "big west" || key.includes("big west")) aliases.add("big west");
  if (key === "sun belt" || key.includes("sun belt")) aliases.add("sun belt");
  if (key === "asun" || key.includes("atlantic sun")) aliases.add("atlantic sun conference");
  if (key === "a east" || key === "ae" || key === "aec" || key.includes("america east")) aliases.add("america east");
  if (key === "bsc" || key.includes("big south")) aliases.add("big south conference");
  if (key === "be" || key.includes("big east")) aliases.add("big east conference");
  if (key === "maac" || key.includes("metro atlantic")) aliases.add("metro atlantic athletic conference");
  if (key === "patriot" || key.includes("patriot league")) aliases.add("patriot league");
  if (key === "ivy" || key.includes("ivy league")) aliases.add("ivy league");
  if (key === "summit" || key.includes("summit league")) aliases.add("summit league");
  if (key.includes("southland")) aliases.add("southland conference");
  if (key === "socon" || key.includes("southern conference")) aliases.add("southern conference");
  if (key === "ovc" || key.includes("ohio valley")) aliases.add("ohio valley conference");
  if (key === "swac" || key.includes("southwestern athletic")) aliases.add("southwestern athletic conference");

  return Array.from(aliases);
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const toRate = (n: number) => (Math.abs(n) > 1 ? n / 100 : n);
const normalizeParkToIndex = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return 100;
  return Math.abs(n) <= 3 ? n * 100 : n;
};
const statKey = (v: number | null | undefined) => (v == null ? "na" : round3(v).toFixed(3));

function readLocalNum(key: string, fallback: number): number {
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
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>("");
  const [playerSearch, setPlayerSearch] = useState<string>("");
  const [selectedDestinationTeam, setSelectedDestinationTeam] = useState<string>("");
  const [teamSearch, setTeamSearch] = useState<string>("");

  const { data: players = [], isLoading: playersLoading } = useQuery({
    queryKey: ["transfer-sim-players"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_predictions")
        .select(`
          id,
          player_id,
          model_type,
          from_avg,
          from_obp,
          from_slg,
          power_rating_plus,
          players!inner(id, first_name, last_name, position, team, from_team, conference)
        `)
        .eq("variant", "regular")
        .in("status", ["active", "departed"])
        .in("model_type", ["returner", "transfer"]);
      if (error) throw error;

      const rank = (row: any) => {
        const hasFrom = row.from_avg != null || row.from_obp != null || row.from_slg != null;
        const hasPower = row.power_rating_plus != null;
        return (row.model_type === "transfer" ? 3 : 1) + (hasFrom ? 2 : 0) + (hasPower ? 1 : 0);
      };

      const byPlayer = new Map<string, any>();
      for (const row of data || []) {
        const key = row.player_id as string;
        const existing = byPlayer.get(key);
        if (!existing || rank(row) > rank(existing)) byPlayer.set(key, row);
      }

      return Array.from(byPlayer.values())
        .map((row: any) => ({
          prediction_id: row.id as string,
          player_id: row.player_id as string,
          model_type: row.model_type as string,
          first_name: row.players.first_name as string,
          last_name: row.players.last_name as string,
          position: row.players.position as string | null,
          team: row.players.team as string | null,
          from_team: row.players.from_team as string | null,
          conference: row.players.conference as string | null,
          from_avg: row.from_avg as number | null,
          from_obp: row.from_obp as number | null,
          from_slg: row.from_slg as number | null,
          power_rating_plus: row.power_rating_plus as number | null,
        }))
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
        .select("conference, season, avg_plus, obp_plus, iso_plus, stuff_plus")
        .order("season", { ascending: false });
      if (error) throw error;
      // keep best row per conference key: prefer rows with populated plus/stuff values.
      const byConf = new Map<string, { row: ConferenceRow; score: number }>();
      for (const row of (data || []) as ConferenceRow[]) {
        const key = normalizeKey(row.conference);
        if (!key) continue;
        const score =
          (row.avg_plus != null ? 1 : 0) +
          (row.obp_plus != null ? 1 : 0) +
          (row.iso_plus != null ? 1 : 0) +
          (row.stuff_plus != null ? 1 : 0) +
          // prefer 2025 when available for this testing phase
          (row.season === 2025 ? 2 : 0);
        const existing = byConf.get(key);
        if (!existing || score > existing.score) {
          byConf.set(key, { row, score });
        }
      }
      return Array.from(byConf.values()).map((v) => v.row);
    },
  });

  const selectedPlayer = useMemo(
    () => players.find((p) => p.player_id === selectedPlayerId) || null,
    [players, selectedPlayerId],
  );

  const filteredPlayers = useMemo(() => {
    const q = normalizeKey(playerSearch);
    const pool = q
      ? players.filter((p) =>
          `${p.first_name} ${p.last_name} ${(p.from_team || p.team || "")} ${(p.position || "")}`
            .toLowerCase()
            .includes(q),
        )
      : players;
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

  const { data: internals } = useQuery({
    queryKey: ["transfer-sim-internals", selectedPlayer?.prediction_id],
    enabled: !!selectedPlayer?.prediction_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_prediction_internals")
        .select("avg_power_rating, obp_power_rating, slg_power_rating")
        .eq("prediction_id", selectedPlayer!.prediction_id)
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
    for (const c of conferenceStats) map.set(normalizeKey(c.conference), c);
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

  const inferredFromTeam = useMemo(() => {
    if (!selectedPlayer) return null;
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
    for (const key of aliases) {
      const hit = confByKey.get(key);
      if (hit) return hit;
    }
    // fallback: loose include match either direction
    for (const [k, row] of confByKey.entries()) {
      if (aliases.some((a) => k.includes(a) || a.includes(k))) return row;
    }
    return null;
  };

  const fromConfStats = resolveConferenceStats(fromConference);
  const toConfStats = resolveConferenceStats(toConference);

  const simulation = useMemo(() => {
    if (!selectedPlayer || !toTeamRow) return null;

    const lastAvg = selectedPlayer.from_avg;
    const lastObp = selectedPlayer.from_obp;
    const lastSlg = selectedPlayer.from_slg;
    if (lastAvg == null || lastObp == null || lastSlg == null) return null;

    const baPR = internals?.avg_power_rating ?? selectedPlayer.power_rating_plus ?? 100;
    const obpPR = internals?.obp_power_rating ?? selectedPlayer.power_rating_plus ?? 100;
    const isoPR = internals?.slg_power_rating ?? selectedPlayer.power_rating_plus ?? 100;

    const fromAvgPlus = fromConfStats?.avg_plus ?? 100;
    const toAvgPlus = toConfStats?.avg_plus ?? fromAvgPlus;
    const fromObpPlus = fromConfStats?.obp_plus ?? 100;
    const toObpPlus = toConfStats?.obp_plus ?? fromObpPlus;
    const fromIsoPlus = fromConfStats?.iso_plus ?? 100;
    const toIsoPlus = toConfStats?.iso_plus ?? fromIsoPlus;

    const fromStuff = fromConfStats?.stuff_plus ?? 100;
    const toStuff = toConfStats?.stuff_plus ?? fromStuff;

    const fromParkRaw = fromTeamRow?.park_factor ?? 100;
    const toParkRaw = toTeamRow?.park_factor ?? fromParkRaw;
    const fromPark = normalizeParkToIndex(fromParkRaw);
    const toPark = normalizeParkToIndex(toParkRaw);

    const ncaaAvgBA = toRate(readLocalNum("t_ba_ncaa_avg", 0.280));
    const ncaaAvgOBP = toRate(readLocalNum("t_obp_ncaa_avg", 0.385));
    const ncaaAvgISO = toRate(readLocalNum("t_iso_ncaa_avg", 0.162));
    const ncaaAvgWrc = toRate(readLocalNum("t_wrc_ncaa_avg", 0.364));

    const baPowerWeight = toRate(readLocalNum("t_ba_power_weight", 0.70));
    const obpPowerWeight = toRate(readLocalNum("t_obp_power_weight", 0.70));

    const baConferenceWeight = readLocalNum("t_ba_conference_weight", 1.0);
    const obpConferenceWeight = readLocalNum("t_obp_conference_weight", 1.0);
    const isoConferenceWeight = readLocalNum("t_iso_conference_weight", 1.0);

    const baPitchingWeight = readLocalNum("t_ba_pitching_weight", 1.0);
    const obpPitchingWeight = readLocalNum("t_obp_pitching_weight", 1.0);
    const isoPitchingWeight = readLocalNum("t_iso_pitching_weight", 1.0);

    const baParkWeight = readLocalNum("t_ba_park_weight", 1.0);
    const obpParkWeight = readLocalNum("t_obp_park_weight", 1.0);
    const isoParkWeight = readLocalNum("t_iso_park_weight", 1.0);

    const isoStdPower = readLocalNum("r_iso_std_pr", 45.423);
    const isoStdNcaa = toRate(readLocalNum("r_iso_std_ncaa", 0.07849797197));

    const wObp = toRate(readLocalNum("r_w_obp", 0.45));
    const wSlg = toRate(readLocalNum("r_w_slg", 0.30));
    const wAvg = toRate(readLocalNum("r_w_avg", 0.15));
    const wIso = toRate(readLocalNum("r_w_iso", 0.10));

    const baPowerAdj = ncaaAvgBA * (baPR / 100);
    const baBlended = lastAvg * (1 - baPowerWeight) + baPowerAdj * baPowerWeight;
    const baMultiplier =
      1 +
      (baConferenceWeight * ((toAvgPlus - fromAvgPlus) / 100)) -
      (baPitchingWeight * ((toStuff - fromStuff) / 100)) +
      (baParkWeight * ((toPark - fromPark) / 100));
    const pAvg = round3(baBlended * baMultiplier);

    const obpPowerAdj = ncaaAvgOBP * (obpPR / 100);
    const obpBlended = lastObp * (1 - obpPowerWeight) + obpPowerAdj * obpPowerWeight;
    const obpMultiplier =
      1 +
      (obpConferenceWeight * ((toObpPlus - fromObpPlus) / 100)) -
      (obpPitchingWeight * ((toStuff - fromStuff) / 100)) +
      (obpParkWeight * ((toPark - fromPark) / 100));
    const pObp = round3(obpBlended * obpMultiplier);

    const lastIso = lastSlg - lastAvg;
    const ratingZ = isoStdPower > 0 ? (isoPR - 100) / isoStdPower : 0;
    const scaledIso = ncaaAvgISO + (ratingZ * isoStdNcaa);
    const isoBlended = (lastIso * (1 - 0.3)) + (scaledIso * 0.3);
    const isoMultiplier =
      1 +
      (isoConferenceWeight * ((toIsoPlus - fromIsoPlus) / 100)) -
      (isoPitchingWeight * ((toStuff - fromStuff) / 100)) +
      (isoParkWeight * ((toPark - fromPark) / 100));
    const pIso = round3(isoBlended * isoMultiplier);

    const pSlg = round3(pAvg + pIso);
    const pOps = round3(pObp + pSlg);
    const pWrc = round3((wObp * pObp) + (wSlg * pSlg) + (wAvg * pAvg) + (wIso * pIso));
    const pWrcPlus = ncaaAvgWrc === 0 ? null : Math.round((pWrc / ncaaAvgWrc) * 100);

    const offValue = pWrcPlus == null ? null : (pWrcPlus - 100) / 100;
    const pa = 260;
    const runsPerPa = 0.13;
    const replacementRuns = (pa / 600) * 25;
    const raa = offValue == null ? null : offValue * pa * runsPerPa;
    const rar = raa == null ? null : raa + replacementRuns;
    const owar = rar == null ? null : rar / 10;

    const basePerOwar = readLocalNum("nil_base_per_owar", 25000);
    const ptm = getProgramTierMultiplierByConference(toConference, DEFAULT_NIL_TIER_MULTIPLIERS);
    const pvm = getPositionValueMultiplier(selectedPlayer.position);
    const nilValuation = owar == null ? null : owar * basePerOwar * ptm * pvm;

    return {
      pAvg,
      pObp,
      pSlg,
      pOps,
      pIso,
      pWrc,
      pWrcPlus,
      owar,
      nilValuation,
      fromAvgPlus,
      toAvgPlus,
      fromObpPlus,
      toObpPlus,
      fromIsoPlus,
      toIsoPlus,
      fromStuff,
      toStuff,
      fromPark,
      toPark,
      fromParkRaw,
      toParkRaw,
      ptm,
      pvm,
    };
  }, [selectedPlayer, toTeamRow, internals, fromConfStats, toConfStats, fromTeamRow, toConference]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Transfer Portal</h2>
          <p className="text-muted-foreground">
            Move a player to a destination school and simulate transfer outcomes using conference/park/stuff deltas,
            internal power ratings, oWAR, and NIL.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Projected Outcomes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
                <div className="text-xs font-medium tracking-wide text-accent-foreground">NIL Valuation</div>
                <div className="mt-1 font-mono text-4xl font-extrabold text-foreground">{simulation ? money(simulation.nilValuation) : "-"}</div>
              </div>
            </div>
          </CardContent>
        </Card>

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
            <div><span className="text-muted-foreground">From Park Factor:</span> {simulation ? formatPark(simulation.fromParkRaw) : "-"}</div>
            <div><span className="text-muted-foreground">To Park Factor:</span> {simulation ? formatPark(simulation.toParkRaw) : "-"}</div>
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
            <div><span className="text-muted-foreground">NIL PTM/PVM:</span> {simulation ? `${simulation.ptm.toFixed(2)} / ${simulation.pvm.toFixed(2)}` : "-"}</div>
          </CardContent>
        </Card>

      </div>
    </DashboardLayout>
  );
}
