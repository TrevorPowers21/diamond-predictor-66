import { useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Search } from "lucide-react";
import { Link } from "react-router-dom";
import storage2025Seed from "@/data/storage_2025_seed.json";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  DEFAULT_NIL_TIER_MULTIPLIERS,
  getPositionValueMultiplier,
  getProgramTierMultiplierByConference,
} from "@/lib/nilProgramSpecific";
import { computeTransferProjection } from "@/lib/transferProjection";

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
  if (key === "big ten" || key === "big10" || key === "big 10" || key.includes("big ten") || key.includes("big 10")) {
    aliases.add("big ten");
    aliases.add("big10");
    aliases.add("big 10");
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
// Weight parser for transfer multipliers:
// - keep small scalar entries as-is (e.g. 2 => 2)
// - still support legacy percent-style entries (e.g. 70 => 0.70, 100 => 1.0)
const toWeight = (n: number) => (Math.abs(n) >= 10 ? n / 100 : n);
const normalizeParkToIndex = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return 100;
  return Math.abs(n) <= 3 ? n * 100 : n;
};
const statKey = (v: number | null | undefined) => (v == null ? "na" : round3(v).toFixed(3));
const TARGET_BOARD_STORAGE_KEY = "team_builder_target_board_v1";

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
  const { toast } = useToast();
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>("");
  const [playerSearch, setPlayerSearch] = useState<string>("");
  const [selectedDestinationTeam, setSelectedDestinationTeam] = useState<string>("");
  const [teamSearch, setTeamSearch] = useState<string>("");

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
            power_rating_plus
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
    const q = normalizeKey(playerSearch);
    const pool = q
      ? players.filter((p) =>
          normalizeKey(`${p.first_name} ${p.last_name} ${(p.from_team || p.team || "")} ${(p.position || "")}`).includes(q),
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

    const fromParkRaw = fromTeamRow?.park_factor ?? null;
    const toParkRaw = toTeamRow?.park_factor ?? null;
    if (fromAvgPlus == null) missingInputs.push("From AVG+");
    if (toAvgPlus == null) missingInputs.push("To AVG+");
    if (fromObpPlus == null) missingInputs.push("From OBP+");
    if (toObpPlus == null) missingInputs.push("To OBP+");
    if (fromIsoPlus == null) missingInputs.push("From ISO+");
    if (toIsoPlus == null) missingInputs.push("To ISO+");
    if (fromStuff == null) missingInputs.push("From Stuff+");
    if (toStuff == null) missingInputs.push("To Stuff+");
    if (fromParkRaw == null) missingInputs.push("From Park Factor");
    if (toParkRaw == null) missingInputs.push("To Park Factor");
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
        fromParkRaw,
        toParkRaw,
        ptm: null,
        pvm: null,
      };
    }
    const fromPark = normalizeParkToIndex(fromParkRaw);
    const toPark = normalizeParkToIndex(toParkRaw);

    const ncaaAvgBA = toRate(readLocalNum("t_ba_ncaa_avg", 0.280, remoteEquationValues));
    const ncaaAvgOBP = toRate(readLocalNum("t_obp_ncaa_avg", 0.385, remoteEquationValues));
    const ncaaAvgISO = toRate(readLocalNum("t_iso_ncaa_avg", 0.162, remoteEquationValues));
    const ncaaAvgWrc = toRate(readLocalNum("t_wrc_ncaa_avg", 0.364, remoteEquationValues));

    const baPowerWeight = toRate(readLocalNum("t_ba_power_weight", 0.70, remoteEquationValues));
    const obpPowerWeight = toRate(readLocalNum("t_obp_power_weight", 0.70, remoteEquationValues));

    const baConferenceWeight = toWeight(readLocalNum("t_ba_conference_weight", 1.0, remoteEquationValues));
    const obpConferenceWeight = toWeight(readLocalNum("t_obp_conference_weight", 1.0, remoteEquationValues));
    const isoConferenceWeight = toWeight(readLocalNum("t_iso_conference_weight", 1.0, remoteEquationValues));

    const baPitchingWeight = toWeight(readLocalNum("t_ba_pitching_weight", 1.0, remoteEquationValues));
    const obpPitchingWeight = toWeight(readLocalNum("t_obp_pitching_weight", 1.0, remoteEquationValues));
    const isoPitchingWeight = toWeight(readLocalNum("t_iso_pitching_weight", 1.0, remoteEquationValues));

    const baParkWeight = toWeight(readLocalNum("t_ba_park_weight", 1.0, remoteEquationValues));
    const obpParkWeight = toWeight(readLocalNum("t_obp_park_weight", 1.0, remoteEquationValues));
    const isoParkWeight = toWeight(readLocalNum("t_iso_park_weight", 1.0, remoteEquationValues));

    const isoStdPower = readLocalNum("r_iso_std_pr", 45.423, remoteEquationValues);
    const isoStdNcaa = toRate(readLocalNum("r_iso_std_ncaa", 0.07849797197, remoteEquationValues));

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
      fromPark,
      toPark,
      ncaaAvgBA,
      ncaaAvgOBP,
      ncaaAvgISO,
      ncaaAvgWrc,
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

    const basePerOwar = readLocalNum("nil_base_per_owar", 25000, remoteEquationValues);
    const ptm = getProgramTierMultiplierByConference(toConference, DEFAULT_NIL_TIER_MULTIPLIERS);
    const pvm = getPositionValueMultiplier(selectedPlayer.position);
    const nilValuation = projected.owar == null ? null : projected.owar * basePerOwar * ptm * pvm;
    const baPowerAdj = ncaaAvgBA * (baPR / 100);
    const baBlended = (lastAvg * (1 - baPowerWeight)) + (baPowerAdj * baPowerWeight);
    const baConfTerm = baConferenceWeight * ((toAvgPlus - fromAvgPlus) / 100);
    const baPitchTerm = baPitchingWeight * ((toStuff - fromStuff) / 100);
    const baParkTerm = baParkWeight * ((toPark - fromPark) / 100);
    const baMultiplier = 1 + baConfTerm - baPitchTerm + baParkTerm;

    return {
      blocked: false as const,
      missingInputs: [] as string[],
      pAvg: projected.pAvg,
      pObp: projected.pObp,
      pSlg: projected.pSlg,
      pOps: projected.pOps,
      pIso: projected.pIso,
      pWrc: projected.pWrc,
      pWrcPlus: projected.pWrcPlus,
      owar: projected.owar,
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
      baWork: {
        lastStat: lastAvg,
        baPR,
        ncaaAvgBA,
        baPowerWeight,
        baConferenceWeight,
        baPitchingWeight,
        baParkWeight,
        fromAvgPlus,
        toAvgPlus,
        fromStuff,
        toStuff,
        fromPark,
        toPark,
        powerAdj: baPowerAdj,
        blended: baBlended,
        confTerm: baConfTerm,
        pitchTerm: baPitchTerm,
        parkTerm: baParkTerm,
        multiplier: baMultiplier,
      },
    };
  }, [selectedPlayer, toTeamRow, internals, fromConfStats, toConfStats, fromTeamRow, toConference, remoteEquationValues]);

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

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Transfer Portal</h2>
          <p className="text-muted-foreground">
            Simulate any player's projected outcomes at a destination school using conference/park/stuff deltas,
            internal power ratings, oWAR, and NIL. All active roster players are eligible — not limited to portal entries.
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base">Projected Outcomes</CardTitle>
              {selectedPlayer && simulation && !simulation.blocked && (
                <Button asChild variant="outline" size="sm">
                  <Link to={`/dashboard/player/${selectedPlayer.player_id}`}>
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
            <div><span className="text-muted-foreground">NIL PTM/PVM:</span> {simulation && simulation.ptm != null && simulation.pvm != null ? `${simulation.ptm.toFixed(2)} / ${simulation.pvm.toFixed(2)}` : "-"}</div>
          </CardContent>
        </Card>

        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Show Work (pAVG)</CardTitle>
              <CardDescription>Uses the live Context + Multipliers values above.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm font-mono">
              {!simulation || simulation.blocked || !simulation.baWork ? (
                <div className="text-muted-foreground">Select player + destination with all required inputs.</div>
              ) : (
                <>
                  <div>LastStat = {stat(simulation.baWork.lastStat)}</div>
                  <div>PowerAdj = {stat(simulation.baWork.ncaaAvgBA)} × ({stat(simulation.baWork.baPR, 2)} / 100) = {stat(simulation.baWork.powerAdj)}</div>
                  <div>Blended = ({stat(simulation.baWork.lastStat)} × (1 - {stat(simulation.baWork.baPowerWeight, 2)})) + ({stat(simulation.baWork.powerAdj)} × {stat(simulation.baWork.baPowerWeight, 2)}) = {stat(simulation.baWork.blended)}</div>
                  <div>Multiplier = 1 + ({stat(simulation.baWork.baConferenceWeight, 2)} × (({whole(simulation.baWork.toAvgPlus)} - {whole(simulation.baWork.fromAvgPlus)}) / 100)) - ({stat(simulation.baWork.baPitchingWeight, 2)} × (({whole(simulation.baWork.toStuff)} - {whole(simulation.baWork.fromStuff)}) / 100)) + ({stat(simulation.baWork.baParkWeight, 2)} × (({whole(simulation.baWork.toPark)} - {whole(simulation.baWork.fromPark)}) / 100)) = {stat(simulation.baWork.multiplier, 4)}</div>
                  <div className="font-semibold">ProjectedBA = {stat(simulation.baWork.blended)} × {stat(simulation.baWork.multiplier, 4)} = {stat(simulation.pAvg)}</div>
                </>
              )}
            </CardContent>
          </Card>
        )}

      </div>
    </DashboardLayout>
  );
}
