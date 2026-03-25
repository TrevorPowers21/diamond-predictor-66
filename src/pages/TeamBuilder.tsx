import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { formatWithCommas, parseCommaNumber } from "@/lib/utils";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, BarChart3, DollarSign, Upload, ChevronDown, ChevronUp } from "lucide-react";
import storage2025Seed from "@/data/storage_2025_seed.json";
import {
  calcPlayerScore,
  DEFAULT_PROGRAM_TOTAL_PLAYER_SCORE,
  getProgramTierMultiplierByConference,
  getPositionValueMultiplier,
  DEFAULT_NIL_TIER_MULTIPLIERS,
} from "@/lib/nilProgramSpecific";
import { computeTransferProjection } from "@/lib/transferProjection";
import { recalculatePredictionById } from "@/lib/predictionEngine";
import { getConferenceAliases } from "@/lib/conferenceMapping";
import { profileRouteFor } from "@/lib/profileRoutes";
import { updatePlayerOverride } from "@/lib/playerOverrides";
import { readTeamParkFactorComponents, resolveMetricParkFactor } from "@/lib/parkFactors";

const POSITION_SLOTS = ["C", "1B", "2B", "SS", "3B", "LF", "CF", "RF", "DH"] as const;
const PITCHER_SLOTS = ["SP1", "SP2", "SP3", "SP4", "SP5", "RP1", "RP2", "RP3", "RP4", "CL"] as const;
const MAX_DEPTH = 3;
const DEV_AGGRESSIVENESS_OPTIONS = [0, 0.5, 1] as const;
const TEAM_BUILDER_DRAFT_KEY = "team_builder_draft_v1";
const TARGET_BOARD_STORAGE_KEY = "team_builder_target_board_v1";
const LEGACY_PITCHING_ROLE_OVERRIDE_KEY = "pitching_role_overrides_v1";
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

type TransferSnapshot = {
  p_avg: number | null;
  p_obp: number | null;
  p_slg: number | null;
  p_wrc_plus: number | null;
  owar: number | null;
  nil_valuation: number | null;
  from_team: string | null;
  from_conference: string | null;
};

type BuildPlayer = {
  id?: string;
  player_id: string | null;
  source: "returner" | "portal";
  custom_name: string | null;
  position_slot: string | null;
  depth_order: number;
  nil_value: number;
  production_notes: string | null;
  roster_status?: "returner" | "leaving" | "target";
  depth_role?: "starter" | "utility" | "bench";
  class_transition?: string | null;
  dev_aggressiveness?: number | null;
  // joined
  player?: {
    first_name: string;
    last_name: string;
    position: string | null;
    team: string | null;
    from_team: string | null;
    conference: string | null;
  } | null;
  prediction?: {
    id?: string | null;
    from_avg: number | null;
    from_obp: number | null;
    from_slg: number | null;
    p_avg: number | null;
    p_obp: number | null;
    p_slg: number | null;
    p_ops: number | null;
    p_wrc_plus: number | null;
    power_rating_plus: number | null;
    model_type: "returner" | "transfer" | string | null;
    status: string | null;
  } | null;
  nilVal?: number | null;
  nil_owar?: number | null;
  team_metrics?: TeamMetricInputs | null;
  team_power_plus?: TeamPowerPlus | null;
  transfer_snapshot?: TransferSnapshot | null;
};

type TeamRow = {
  name: string;
  conference: string | null;
  park_factor: number | null;
};

type ConferenceRow = {
  conference: string;
  season?: number | null;
  avg_plus: number | null;
  obp_plus: number | null;
  iso_plus: number | null;
  stuff_plus: number | null;
};

type TeamMetricInputs = {
  contact: number | null;
  lineDrive: number | null;
  avgExitVelo: number | null;
  popUp: number | null;
  bb: number | null;
  chase: number | null;
  barrel: number | null;
  ev90: number | null;
  pull: number | null;
  la10_30: number | null;
  gb: number | null;
};

type TeamPowerPlus = {
  baPlus: number | null;
  obpPlus: number | null;
  isoPlus: number | null;
  overallPlus: number | null;
};

type SeedRow = {
  playerName: string;
  team: string | null;
  avg: number | null;
  obp: number | null;
  slg: number | null;
};

type PredictionInternalsRow = {
  prediction_id: string;
  avg_power_rating: number | null;
  obp_power_rating: number | null;
  slg_power_rating: number | null;
};

type LivePredictionRow = {
  id: string;
  player_id: string;
  from_avg: number | null;
  from_obp: number | null;
  from_slg: number | null;
  p_avg: number | null;
  p_obp: number | null;
  p_slg: number | null;
  p_ops: number | null;
  p_wrc_plus: number | null;
  power_rating_plus: number | null;
  class_transition: string | null;
  dev_aggressiveness: number | null;
  model_type: string | null;
  variant: string | null;
  status: string | null;
  updated_at: string | null;
};

type LivePlayerRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  team: string | null;
  from_team: string | null;
  conference: string | null;
};

const EMPTY_TEAM_METRICS: TeamMetricInputs = {
  contact: null,
  lineDrive: null,
  avgExitVelo: null,
  popUp: null,
  bb: null,
  chase: null,
  barrel: null,
  ev90: null,
  pull: null,
  la10_30: null,
  gb: null,
};

const normalizeName = (value: string | null | undefined) =>
  (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const parseNum = (raw: unknown): number | null => {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const cleaned = s.replace(/[%$,]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};
const splitFullName = (fullName: string) => {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
};

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

const computeTeamPowerPlus = (raw: TeamMetricInputs): TeamPowerPlus => {
  const contactScore = scoreFromNormal(raw.contact, 77.1, 6.6);
  const lineDriveScore = scoreFromNormal(raw.lineDrive, 20.9, 4.31);
  const avgEVScore = scoreFromNormal(raw.avgExitVelo, 86.2, 4.28);
  const popUpScore = scoreFromNormal(raw.popUp, 7.9, 3.37, true);
  const bbScore = scoreFromNormal(raw.bb, 11.4, 3.57);
  const chaseScore = scoreFromNormal(raw.chase, 23.1, 5.58, true);
  const barrelScore = scoreFromNormal(raw.barrel, 17.3, 7.89);
  const ev90Score = scoreFromNormal(raw.ev90, 103.1, 3.97);
  const pullScore = scoreFromNormal(raw.pull, 36.5, 8.03);
  const laScore = scoreFromNormal(raw.la10_30, 29, 6.81);
  const gbScore = scoreFromNormal(raw.gb, 43.2, 8.0, true);

  const baPower = contactScore == null || lineDriveScore == null || avgEVScore == null || popUpScore == null
    ? null
    : (0.4 * contactScore) + (0.25 * lineDriveScore) + (0.2 * avgEVScore) + (0.15 * popUpScore);
  const obpPower = contactScore == null || lineDriveScore == null || avgEVScore == null || popUpScore == null || bbScore == null || chaseScore == null
    ? null
    : (0.35 * contactScore) + (0.2 * lineDriveScore) + (0.15 * avgEVScore) + (0.1 * popUpScore) + (0.15 * bbScore) + (0.05 * chaseScore);
  const isoPower = barrelScore == null || ev90Score == null || pullScore == null || laScore == null || gbScore == null
    ? null
    : (0.45 * barrelScore) + (0.3 * ev90Score) + (0.15 * pullScore) + (0.05 * laScore) + (0.05 * gbScore);
  const toPlus = (v: number | null) => (v == null ? null : (v / 50) * 100);
  const baPlus = toPlus(baPower);
  const obpPlus = toPlus(obpPower);
  const isoPlus = toPlus(isoPower);
  const overallPower = baPlus == null || obpPlus == null || isoPlus == null
    ? null
    : (0.25 * baPlus) + (0.4 * obpPlus) + (0.35 * isoPlus);
  return {
    baPlus,
    obpPlus,
    isoPlus,
    overallPlus: overallPower,
  };
};

const parseCsvLine = (line: string): string[] => {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "," && !inQuotes) {
      out.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  out.push(current.trim());
  return out;
};

const parseTeamBuilderCsv = (text: string): Array<Record<string, string>> => {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? "";
    });
    rows.push(row);
  }
  return rows;
};

const normalizeHeader = (h: string) => normalizeName(h).replace(/\s+/g, "");

const pickCell = (row: Record<string, string>, aliases: string[]): string | undefined => {
  const entries = Object.entries(row);
  for (const [key, val] of entries) {
    const norm = normalizeHeader(key);
    if (aliases.some((a) => norm === a || norm.includes(a))) return val;
  }
  return undefined;
};

const parseBuildPlayerMeta = (raw: string | null | undefined): {
  notes: string | null;
  metrics: TeamMetricInputs | null;
  power: TeamPowerPlus | null;
  rosterStatus: "returner" | "leaving" | "target" | null;
  depthRole: "starter" | "utility" | "bench" | null;
  classTransition: string | null;
  devAggressiveness: number | null;
  transferSnapshot: TransferSnapshot | null;
} => {
  if (!raw) return { notes: null, metrics: null, power: null, rosterStatus: null, depthRole: null, classTransition: null, devAggressiveness: null, transferSnapshot: null };
  try {
    const obj = JSON.parse(raw);
    if (obj && obj.__team_builder_metrics_v1) {
      return {
        notes: typeof obj.notes === "string" ? obj.notes : null,
        metrics: (obj.metrics ?? null) as TeamMetricInputs | null,
        power: (obj.power ?? null) as TeamPowerPlus | null,
        rosterStatus:
          obj.rosterStatus === "returner" || obj.rosterStatus === "leaving" || obj.rosterStatus === "target"
            ? obj.rosterStatus
            : null,
        depthRole:
          obj.depthRole === "starter" || obj.depthRole === "utility" || obj.depthRole === "bench"
            ? obj.depthRole
            : null,
        classTransition: typeof obj.classTransition === "string" ? obj.classTransition : null,
        devAggressiveness: Number.isFinite(Number(obj.devAggressiveness)) ? Number(obj.devAggressiveness) : null,
        transferSnapshot: (obj.transferSnapshot ?? null) as TransferSnapshot | null,
      };
    }
  } catch {
    // legacy free-text note
  }
  return { notes: raw, metrics: null, power: null, rosterStatus: null, depthRole: null, classTransition: null, devAggressiveness: null, transferSnapshot: null };
};

const serializeBuildPlayerMeta = (
  notes: string | null,
  metrics: TeamMetricInputs | null,
  power: TeamPowerPlus | null,
  rosterStatus: "returner" | "leaving" | "target" | null | undefined,
  depthRole: "starter" | "utility" | "bench" | null | undefined,
  classTransition: string | null | undefined,
  devAggressiveness: number | null | undefined,
  transferSnapshot: TransferSnapshot | null | undefined,
) => {
  if (!notes && !metrics && !power && !rosterStatus && !depthRole && !classTransition && devAggressiveness == null && !transferSnapshot) return null;
  return JSON.stringify({
    __team_builder_metrics_v1: true,
    notes: notes ?? null,
    metrics: metrics ?? null,
    power: power ?? null,
    rosterStatus: rosterStatus ?? null,
    depthRole: depthRole ?? null,
    classTransition: classTransition ?? null,
    devAggressiveness: devAggressiveness ?? null,
    transferSnapshot: transferSnapshot ?? null,
  });
};

const hasSystemPredictionStats = (p: BuildPlayer) =>
  p.prediction?.p_avg != null ||
  p.prediction?.p_obp != null ||
  p.prediction?.p_slg != null ||
  p.prediction?.p_wrc_plus != null;

const selectPreferredPrediction = (predictions: any[] | null | undefined) => {
  const list = (predictions || []).filter(Boolean);
  if (!list.length) return null;
  const rank = (row: any) => {
    const hasFrom = row.from_avg != null || row.from_obp != null || row.from_slg != null;
    const hasPower = row.power_rating_plus != null;
    const statusBoost = row.status === "active" ? 2 : row.status === "departed" ? 1 : 0;
    return (row.model_type === "transfer" ? 3 : 1) + (hasFrom ? 2 : 0) + (hasPower ? 1 : 0) + statusBoost;
  };
  return [...list].sort((a, b) => rank(b) - rank(a))[0] ?? null;
};

const selectTransferPortalPreferredPrediction = (predictions: any[] | null | undefined) => {
  const list = (predictions || []).filter(Boolean);
  if (!list.length) return null;
  const rank = (row: any) => {
    const hasFrom = row.from_avg != null || row.from_obp != null || row.from_slg != null;
    const hasPower = row.power_rating_plus != null;
    const statusBoost = row.status === "active" ? 2 : row.status === "departed" ? 1 : 0;
    // Target board players are always transfers; prefer "transfer" model predictions (matches Transfer Portal logic)
    const modelMatchBoost = row.model_type === "transfer" ? 4 : 0;
    const variantBoost = row.variant === "regular" ? 3 : 0;
    return modelMatchBoost + variantBoost + (row.model_type === "transfer" ? 3 : 1) + (hasFrom ? 2 : 0) + (hasPower ? 1 : 0) + statusBoost;
  };
  return [...list].sort((a, b) => {
    const diff = rank(b) - rank(a);
    if (diff !== 0) return diff;
    // Tie-break: most recently updated wins (matches Transfer Portal logic)
    const tsA = new Date(a.updated_at || 0).getTime();
    const tsB = new Date(b.updated_at || 0).getTime();
    return tsB - tsA;
  })[0] ?? null;
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

const computeOWarFromWrcPlus = (wrcPlus: number | null | undefined) => {
  if (wrcPlus == null) return null;
  const pa = 260;
  const runsPerPa = 0.13;
  const replacementRuns = (pa / 600) * 25;
  const offValue = (wrcPlus - 100) / 100;
  const raa = offValue * pa * runsPerPa;
  const rar = raa + replacementRuns;
  return rar / 10;
};

const projectedNilTierClass = (
  value: number | null | undefined,
  totalBudget: number,
  rosterScoreBaseline: number,
) => {
  if (value == null) return "text-muted-foreground";

  const budget = Number(totalBudget) || 0;
  const baseline = Math.max(Number(rosterScoreBaseline) || 0, 1);
  if (budget <= 0) return "text-muted-foreground";

  // Budget-aware tiers: compare each player's projected NIL to a baseline share of budget.
  // Baseline share is budget / roster score baseline (default 68).
  const baselineShare = budget / baseline;
  const averageCut = baselineShare * 0.8;
  const goodCut = baselineShare * 1.2;

  if (value >= goodCut) return "text-[hsl(var(--success))]";
  if (value >= averageCut) return "text-[hsl(var(--warning))]";
  return "text-destructive";
};

const depthRoleMultiplier = (role: BuildPlayer["depth_role"]) => {
  if (role === "bench") return 0.3;
  if (role === "utility") return 0.6;
  return 1.0;
};

const pitcherRoleFromSlot = (slot: string | null | undefined): "SP" | "RP" | "SM" | null => {
  if (!slot) return null;
  const s = slot.toUpperCase();
  if (s.startsWith("SP")) return "SP";
  if (s.startsWith("RP") || s === "CL") return "RP";
  return "SM";
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const statKey = (v: number | null | undefined) => (v == null ? "na" : round3(v).toFixed(3));
const toRate = (n: number) => (Math.abs(n) > 1 ? n / 100 : n);
// Weight parser for transfer multipliers:
// - keep small scalar entries as-is (e.g. 2 => 2)
// - still support legacy percent-style entries (e.g. 70 => 0.70, 100 => 1.0)
const toWeight = (n: number) => (Math.abs(n) >= 10 ? n / 100 : n);
const normalizeParkToIndex = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return 100;
  return Math.abs(n) <= 3 ? n * 100 : n;
};

const normalizeKey = (value: string | null | undefined) =>
  (value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

const writeLegacyPitchingRoleOverride = (
  playerName: string | null | undefined,
  teamName: string | null | undefined,
  role: "SP" | "RP" | "SM" | null,
) => {
  if (typeof window === "undefined" || !playerName || !teamName) return;
  const key = `${normalizeName(playerName)}|${normalizeKey(teamName)}`;
  try {
    const raw = window.localStorage.getItem(LEGACY_PITCHING_ROLE_OVERRIDE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, "SP" | "RP" | "SM">) : {};
    if (role) parsed[key] = role;
    else delete parsed[key];
    window.localStorage.setItem(LEGACY_PITCHING_ROLE_OVERRIDE_KEY, JSON.stringify(parsed));
  } catch {
    // ignore local storage failures
  }
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

export default function TeamBuilder() {
  const { user, hasRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = hasRole("admin");
  const [searchParams] = useSearchParams();
  const validTabs = new Set(["roster", "target-board", "compare", "depth"]);
  const requestedTab = (searchParams.get("tab") || "").trim().toLowerCase();
  const initialTab = validTabs.has(requestedTab) ? requestedTab : "roster";

  const [selectedBuildId, setSelectedBuildId] = useState<string | null>(null);
  const [nilEquationOpen, setNilEquationOpen] = useState(false);
  const [metricsUploadOpen, setMetricsUploadOpen] = useState(false);
  const [buildName, setBuildName] = useState("My Team Build");
  const [selectedTeam, setSelectedTeam] = useState<string>("");
  const [totalBudget, setTotalBudget] = useState<number>(0);
  const [rosterPlayers, setRosterPlayers] = useState<BuildPlayer[]>([]);
  const [dirty, setDirty] = useState(false);
  const [programTierMultiplier, setProgramTierMultiplier] = useState<number>(1.2);
  const [programTierConference, setProgramTierConference] = useState<string>("");
  const [fallbackRosterTotalPlayerScore, setFallbackRosterTotalPlayerScore] = useState<number>(DEFAULT_PROGRAM_TOTAL_PLAYER_SCORE);
  const [depthAssignments, setDepthAssignments] = useState<Record<string, number>>({});
  const [depthPlaceholders, setDepthPlaceholders] = useState<Record<string, "freshman" | "transfer">>({});
  const [incomingName, setIncomingName] = useState("");
  const [incomingPosition, setIncomingPosition] = useState("");
  const [incomingNil, setIncomingNil] = useState<number>(0);
  const [teamSearchQuery, setTeamSearchQuery] = useState("");
  const [teamSearchOpen, setTeamSearchOpen] = useState(false);
  const [targetPlayerSearchQuery, setTargetPlayerSearchQuery] = useState("");
  const [targetPlayerSearchOpen, setTargetPlayerSearchOpen] = useState(false);
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
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const skipAutoSeedOnceRef = useRef(false);

  useEffect(() => {
    setTeamSearchQuery(selectedTeam || "");
  }, [selectedTeam]);

  // Fetch teams
  const { data: teams = [] } = useQuery({
    queryKey: ["teams-list"],
    queryFn: async () => {
      const { data } = await supabase.from("teams").select("name, conference, park_factor").order("name");
      return (data ?? []) as TeamRow[];
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

  // All players for target board search
  const { data: allPlayersForSearch = [] } = useQuery({
    queryKey: ["team-builder-all-players-search"],
    queryFn: async () => {
      let all: any[] = [];
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("players")
          .select("id, first_name, last_name, position, team, from_team, conference, player_predictions(id, p_avg, p_obp, p_slg, p_ops, p_wrc_plus, power_rating_plus, class_transition, dev_aggressiveness, model_type, status, variant), nil_valuations(estimated_value, component_breakdown)")
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
    queryKey: ["conference-stats-for-team-builder"],
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
        if (!existing || score > existing.score) {
          byConf.set(key, { row, score });
        }
      }
      return Array.from(byConf.values()).map((v) => v.row);
    },
  });

  const conferenceOptions = useMemo(() => {
    const set = new Set<string>();
    (teams as Array<{ name: string; conference: string | null }>).forEach((t) => {
      if (t.conference?.trim()) set.add(t.conference.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [teams]);

  const filteredTeamOptions = useMemo(() => {
    const q = teamSearchQuery.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter((t) => t.name.toLowerCase().includes(q));
  }, [teams, teamSearchQuery]);

  const filteredTargetPlayerSearch = useMemo(() => {
    const q = normalizeName(targetPlayerSearchQuery);
    if (!q) return [];
    return allPlayersForSearch
      .filter((p) =>
        normalizeName(`${p.first_name} ${p.last_name} ${p.team || ""} ${p.position || ""}`).includes(q)
      )
      .slice(0, 25);
  }, [allPlayersForSearch, targetPlayerSearchQuery]);

  const allPlayersById = useMemo(() => {
    const map = new Map<string, any>();
    for (const p of allPlayersForSearch) map.set(p.id, p);
    return map;
  }, [allPlayersForSearch]);

  const filterPlayersForCompare = useCallback((q: string) => {
    const nq = normalizeName(q);
    if (!nq) return [] as any[];
    return allPlayersForSearch
      .filter((p) =>
        normalizeName(`${p.first_name} ${p.last_name} ${p.team || ""} ${p.position || ""}`).includes(nq),
      )
      .slice(0, 25);
  }, [allPlayersForSearch]);

  const filteredCompareAPlayers = useMemo(
    () => filterPlayersForCompare(compareAPlayerSearch),
    [compareAPlayerSearch, filterPlayersForCompare],
  );
  const filteredCompareBPlayers = useMemo(
    () => filterPlayersForCompare(compareBPlayerSearch),
    [compareBPlayerSearch, filterPlayersForCompare],
  );

  const filterTeamsForCompare = useCallback((q: string) => {
    const nq = normalizeName(q);
    if (!nq) return [] as TeamRow[];
    return (teams as TeamRow[])
      .filter((t) => normalizeName(`${t.name} ${t.conference || ""}`).includes(nq))
      .slice(0, 30);
  }, [teams]);

  const filteredCompareATeams = useMemo(
    () => filterTeamsForCompare(compareATeamSearch),
    [compareATeamSearch, filterTeamsForCompare],
  );
  const filteredCompareBTeams = useMemo(
    () => filterTeamsForCompare(compareBTeamSearch),
    [compareBTeamSearch, filterTeamsForCompare],
  );

  // Fetch existing builds
  const { data: builds = [] } = useQuery({
    queryKey: ["team-builds"],
    queryFn: async () => {
      const { data } = await supabase
        .from("team_builds")
        .select("*")
        .order("updated_at", { ascending: false });
      return data ?? [];
    },
  });

  // Fetch returners for selected team
  const { data: returners = [] } = useQuery({
    queryKey: ["team-returners", selectedTeam],
    enabled: !!selectedTeam,
    queryFn: async () => {
      const { data } = await supabase
        .from("players")
        .select(`
          id, first_name, last_name, position, team, from_team, conference,
          player_predictions(id, from_avg, from_obp, from_slg, p_avg, p_obp, p_slg, p_ops, p_wrc_plus, power_rating_plus, class_transition, dev_aggressiveness, model_type, status),
          nil_valuations(estimated_value, component_breakdown)
        `)
        .eq("team", selectedTeam)
        .or("transfer_portal.eq.false,transfer_portal.is.null");
      return data ?? [];
    },
  });
  const storagePitchersForSelectedTeam = useMemo(() => {
    if (!selectedTeam) return [] as BuildPlayer[];
    try {
      const raw = localStorage.getItem("pitching_stats_storage_2025_v1");
      if (!raw) return [] as BuildPlayer[];
      const parsed = JSON.parse(raw) as { rows?: Array<{ values?: string[] }> };
      const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
      const selectedTeamKey = normalizeName(selectedTeam);
      const out: BuildPlayer[] = [];
      for (const row of rows) {
        const values = Array.isArray(row?.values) ? row.values : [];
        const playerName = (values[0] || "").trim();
        const teamName = (values[1] || "").trim();
        if (!playerName || !teamName) continue;
        if (normalizeName(teamName) !== selectedTeamKey) continue;
        const hand = (values[2] || "").trim().toUpperCase();
        const roleRaw = (values[3] || "").trim().toUpperCase();
        const role = roleRaw === "SP" || roleRaw === "RP" || roleRaw === "SM" ? roleRaw : null;
        const position = hand === "RHP" || hand === "LHP" ? hand : (role || "P");
        const name = splitFullName(playerName);
        out.push({
          player_id: null,
          source: "returner",
          custom_name: null,
          position_slot: null,
          depth_order: 1,
          nil_value: 0,
          production_notes: null,
          roster_status: "returner",
          depth_role: "starter",
          class_transition: "SJ",
          dev_aggressiveness: 0,
          transfer_snapshot: null,
          player: {
            first_name: name.first,
            last_name: name.last,
            position,
            team: teamName,
            from_team: null,
            conference: null,
          },
          prediction: null,
          nilVal: null,
          nil_owar: 0,
          team_metrics: null,
          team_power_plus: null,
        });
      }
      return out;
    } catch {
      return [] as BuildPlayer[];
    }
  }, [selectedTeam]);

  // Load a saved build
  const loadBuild = useCallback(async (buildId: string) => {
    const build = builds.find((b) => b.id === buildId);
    if (!build) return;
    setSelectedBuildId(buildId);
    setBuildName(build.name);
    setSelectedTeam(build.team);
    setTotalBudget(Number(build.total_budget) || 0);

    const { data: players } = await supabase
      .from("team_build_players")
      .select("*")
      .eq("build_id", buildId);

    if (players) {
      // Fetch player details for each
      const playerIds = players.filter((p) => p.player_id).map((p) => p.player_id!);
      let playerMap: Record<string, any> = {};
      if (playerIds.length > 0) {
        const { data: pData } = await supabase
          .from("players")
          .select(`
            id, first_name, last_name, position, team, from_team, conference,
            player_predictions(id, from_avg, from_obp, from_slg, p_avg, p_obp, p_slg, p_ops, p_wrc_plus, power_rating_plus, class_transition, dev_aggressiveness, model_type, status),
            nil_valuations(estimated_value, component_breakdown)
          `)
          .in("id", playerIds);
        (pData ?? []).forEach((p) => {
          playerMap[p.id] = p;
        });
      }

      setRosterPlayers(
        players.map((bp) => {
          const pd = bp.player_id ? playerMap[bp.player_id] : null;
          const activePred = selectPreferredPrediction(pd?.player_predictions);
          const meta = parseBuildPlayerMeta(bp.production_notes);
          return {
            ...(bp as any),
            id: bp.id,
            player_id: bp.player_id,
            source: bp.source as "returner" | "portal",
            custom_name: bp.custom_name,
            position_slot: bp.position_slot,
            depth_order: bp.depth_order ?? 1,
            nil_value: Number(bp.nil_value) || 0,
            production_notes: meta.notes,
            roster_status: meta.rosterStatus ?? ((bp.source as string) === "portal" ? "target" : "returner"),
            depth_role: meta.depthRole ?? "starter",
            class_transition: meta.classTransition ?? activePred?.class_transition ?? "SJ",
            dev_aggressiveness: meta.devAggressiveness ?? activePred?.dev_aggressiveness ?? 0,
            transfer_snapshot: meta.transferSnapshot ?? null,
            player: pd ? { first_name: pd.first_name, last_name: pd.last_name, position: pd.position, team: pd.team, from_team: pd.from_team, conference: pd.conference ?? null } : null,
            prediction: activePred ?? null,
            nilVal: pd?.nil_valuations?.[0]?.estimated_value ?? null,
            nil_owar: pd?.nil_valuations?.[0]?.component_breakdown?.ncaa_owar ?? null,
            team_metrics: meta.metrics,
            team_power_plus: meta.power,
          };
        })
      );
    }
    setDirty(false);
  }, [builds]);

  // Auto-load returners when team changes and it's a new build
  useEffect(() => {
    if (!selectedTeam || selectedBuildId) return;
    if (skipAutoSeedOnceRef.current) {
      skipAutoSeedOnceRef.current = false;
      return;
    }
    const mapped: BuildPlayer[] = returners.map((r: any) => {
      const activePred = selectPreferredPrediction(r.player_predictions);
      return {
        player_id: r.id,
        source: "returner" as const,
        custom_name: null,
        position_slot: null,
        depth_order: 1,
        nil_value: r.nil_valuations?.[0]?.estimated_value ? Number(r.nil_valuations[0].estimated_value) : 0,
        production_notes: null,
        roster_status: "returner",
        depth_role: "starter",
        class_transition: activePred?.class_transition ?? "SJ",
        dev_aggressiveness: activePred?.dev_aggressiveness ?? 0,
        transfer_snapshot: null,
        player: { first_name: r.first_name, last_name: r.last_name, position: r.position, team: r.team, from_team: r.from_team, conference: r.conference ?? null },
        prediction: activePred ?? null,
        nilVal: r.nil_valuations?.[0]?.estimated_value ?? null,
        nil_owar: r.nil_valuations?.[0]?.component_breakdown?.ncaa_owar ?? null,
      };
    });
    const existing = new Set(
      mapped.map((p) => {
        const full = `${p.player?.first_name || ""} ${p.player?.last_name || ""}`.trim();
        return `${normalizeName(full)}|${normalizeName(p.player?.team || selectedTeam)}`;
      }),
    );
    const merged = [...mapped];
    for (const sp of storagePitchersForSelectedTeam) {
      const full = `${sp.player?.first_name || ""} ${sp.player?.last_name || ""}`.trim();
      const key = `${normalizeName(full)}|${normalizeName(sp.player?.team || selectedTeam)}`;
      if (existing.has(key)) continue;
      existing.add(key);
      merged.push(sp);
    }
    setRosterPlayers(merged);
    setDirty(true);
  }, [returners, selectedTeam, selectedBuildId, storagePitchersForSelectedTeam]);

  // Restore unsaved Team Builder draft when coming back from another page.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(TEAM_BUILDER_DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as {
        selectedBuildId: string | null;
        buildName: string;
        selectedTeam: string;
        totalBudget: number;
        rosterPlayers: BuildPlayer[];
        programTierMultiplier: number;
        programTierConference: string;
        fallbackRosterTotalPlayerScore: number;
        dirty: boolean;
      };
      if (!draft) return;

      setSelectedBuildId(draft.selectedBuildId ?? null);
      setBuildName(draft.buildName ?? "My Team Build");
      setSelectedTeam(draft.selectedTeam ?? "");
      setTotalBudget(Number(draft.totalBudget) || 0);
      setRosterPlayers(Array.isArray(draft.rosterPlayers) ? draft.rosterPlayers : []);
      setProgramTierMultiplier(Number(draft.programTierMultiplier) || 1.2);
      setProgramTierConference(draft.programTierConference ?? "");
      setFallbackRosterTotalPlayerScore(Number(draft.fallbackRosterTotalPlayerScore) || DEFAULT_PROGRAM_TOTAL_PLAYER_SCORE);
      setDirty(Boolean(draft.dirty));
      skipAutoSeedOnceRef.current = true;
    } catch {
      // ignore invalid draft payloads
    }
  }, []);

  // Persist Team Builder draft so browser back returns to the same state.
  useEffect(() => {
    try {
      const payload = {
        selectedBuildId,
        buildName,
        selectedTeam,
        totalBudget,
        rosterPlayers,
        programTierMultiplier,
        programTierConference,
        fallbackRosterTotalPlayerScore,
        dirty,
      };
      sessionStorage.setItem(TEAM_BUILDER_DRAFT_KEY, JSON.stringify(payload));
    } catch {
      // ignore storage quota/access errors
    }
  }, [
    selectedBuildId,
    buildName,
    selectedTeam,
    totalBudget,
    rosterPlayers,
    programTierMultiplier,
    programTierConference,
    fallbackRosterTotalPlayerScore,
    dirty,
  ]);

  useEffect(() => {
    if (!selectedTeam) return;
    const teamRow = (teams as Array<{ name: string; conference: string | null }>).find((t) => t.name === selectedTeam);
    const conf = teamRow?.conference?.trim();
    if (!conf) return;
    setProgramTierConference(conf);
    setProgramTierMultiplier(getProgramTierMultiplierByConference(conf, DEFAULT_NIL_TIER_MULTIPLIERS));
  }, [selectedTeam, teams]);

  const askBuildName = (seed?: string) => {
    const fallback = selectedTeam ? `${selectedTeam} Build` : "My Team Build";
    const initial = (seed || buildName || fallback).trim();
    const next = window.prompt("Enter a build name", initial);
    if (next == null) return null;
    const cleaned = next.trim();
    return cleaned || initial || fallback;
  };

  // Save build
  const saveMutation = useMutation({
    mutationFn: async (opts?: { saveAs?: boolean; nameOverride?: string }) => {
      if (!user) throw new Error("Not logged in");
      const saveAs = !!opts?.saveAs;
      const targetName = (opts?.nameOverride || buildName || "").trim() || (selectedTeam ? `${selectedTeam} Build` : "My Team Build");
      let buildId = saveAs ? null : selectedBuildId;

      if (buildId) {
        await supabase.from("team_builds").update({ name: targetName, team: selectedTeam, total_budget: totalBudget }).eq("id", buildId);
        await supabase.from("team_build_players").delete().eq("build_id", buildId);
      } else {
        const { data, error } = await supabase.from("team_builds").insert({
          user_id: user.id,
          name: targetName,
          team: selectedTeam,
          total_budget: totalBudget,
        }).select("id").single();
        if (error) throw error;
        buildId = data.id;
      }

      if (rosterPlayers.length > 0) {
        const rows = rosterPlayers.map((rp) => ({
          build_id: buildId!,
          player_id: rp.player_id,
          source: rp.source,
          custom_name: rp.custom_name,
          position_slot: rp.position_slot,
          depth_order: rp.depth_order,
          nil_value: rp.nil_value,
          production_notes: serializeBuildPlayerMeta(
            rp.production_notes,
            rp.team_metrics ?? null,
            rp.team_power_plus ?? null,
            rp.roster_status ?? null,
            rp.depth_role ?? null,
            rp.class_transition ?? null,
            rp.dev_aggressiveness ?? null,
            rp.transfer_snapshot ?? null,
          ),
        }));
        const { error } = await supabase.from("team_build_players").insert(rows);
        if (error) throw error;
      }

      setSelectedBuildId(buildId);
      setBuildName(targetName);
      setDirty(false);
      return { buildId, saveAs, targetName };
    },
    onSuccess: (result) => {
      toast({ title: result?.saveAs ? `Build saved as "${result.targetName}"` : "Build saved" });
      queryClient.invalidateQueries({ queryKey: ["team-builds"] });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const deleteBuildMutation = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("team_builds").delete().eq("id", id);
    },
    onSuccess: () => {
      setSelectedBuildId(null);
      setRosterPlayers([]);
      setBuildName("My Team Build");
      setSelectedTeam("");
      setTotalBudget(0);
      queryClient.invalidateQueries({ queryKey: ["team-builds"] });
      toast({ title: "Build deleted" });
    },
  });

  useEffect(() => {
    if (!selectedTeam) return;
    let cancelled = false;
    const run = async () => {
      const queue = readTargetBoard();
      if (!queue.length) return;
      const selectedTeamKey = normalizeKey(selectedTeam);
      const eligible = queue.filter((q) => normalizeKey(q.destinationTeam) === selectedTeamKey);
      if (!eligible.length) return;

      const ids = Array.from(new Set(eligible.map((q) => q.playerId)));
      const { data, error } = await supabase
        .from("players")
        .select(`
          id, first_name, last_name, position, team, from_team, conference,
          player_predictions(id, from_avg, from_obp, from_slg, p_avg, p_obp, p_slg, p_ops, p_wrc_plus, power_rating_plus, class_transition, dev_aggressiveness, model_type, status, variant),
          nil_valuations(estimated_value, component_breakdown)
        `)
        .in("id", ids);
      if (error) {
        toast({ title: "Target Board sync failed", description: error.message, variant: "destructive" });
        return;
      }
      if (cancelled) return;

      const rowsById = new Map<string, any>();
      (data || []).forEach((r: any) => rowsById.set(r.id, r));

      let added = 0;
      setRosterPlayers((prev) => {
        const next = [...prev];
        for (const entry of eligible) {
          const row = rowsById.get(entry.playerId);
          if (!row) continue;
          const exists = next.some((p) => p.player_id === row.id && (p.roster_status || "returner") === "target");
          if (exists) continue;
          const chosenPred = selectTransferPortalPreferredPrediction(
            (row.player_predictions || []).filter((pr: any) => pr.variant === "regular"),
          );
          const newP: BuildPlayer = {
            player_id: row.id,
            source: "portal",
            custom_name: null,
            position_slot: null,
            depth_order: 1,
            nil_value: row.nil_valuations?.[0]?.estimated_value ? Number(row.nil_valuations[0].estimated_value) : 0,
            production_notes: null,
            roster_status: "target",
            depth_role: "utility",
            class_transition: chosenPred?.class_transition ?? "SJ",
            dev_aggressiveness: chosenPred?.dev_aggressiveness ?? 0,
            transfer_snapshot: {
              p_avg: entry.pAvg ?? null,
              p_obp: entry.pObp ?? null,
              p_slg: entry.pSlg ?? null,
              p_wrc_plus: entry.pWrcPlus ?? null,
              owar: entry.owar ?? null,
              nil_valuation: entry.nilValuation ?? null,
              from_team: entry.fromTeam ?? null,
              from_conference: entry.fromConference ?? null,
            },
            player: {
              first_name: row.first_name,
              last_name: row.last_name,
              position: row.position,
              team: row.team,
              from_team: row.from_team,
              conference: row.conference ?? null,
            },
            prediction: chosenPred ?? null,
            nilVal: row.nil_valuations?.[0]?.estimated_value ?? null,
            nil_owar: row.nil_valuations?.[0]?.component_breakdown?.ncaa_owar ?? null,
          };
          next.push(newP);
          added += 1;
        }
        return next;
      });

      const remaining = queue.filter((q) => normalizeKey(q.destinationTeam) !== selectedTeamKey);
      writeTargetBoard(remaining);
      if (added > 0) {
        setDirty(true);
        toast({ title: "Target Board synced", description: `Added ${added} target${added === 1 ? "" : "s"} to this build.` });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [selectedTeam, toast]);

  const teamByKey = useMemo(() => {
    const map = new Map<string, TeamRow>();
    for (const t of teams as TeamRow[]) {
      map.set(normalizeKey(t.name), t);
    }
    return map;
  }, [teams]);
  const teamParkComponents = useMemo(() => readTeamParkFactorComponents(), [teams]);

  const confByKey = useMemo(() => {
    const map = new Map<string, ConferenceRow>();
    for (const c of conferenceStats as ConferenceRow[]) {
      map.set(normalizeKey(c.conference), c);
    }
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

  const targetPredictionIds = useMemo(
    () =>
      rosterPlayers
        .filter((p) => (p.roster_status || "returner") === "target")
        .map((p) => p.prediction?.id || null)
        .filter((v): v is string => !!v),
    [rosterPlayers],
  );

  const targetPlayerIds = useMemo(
    () =>
      rosterPlayers
        .filter((p) => (p.roster_status || "returner") === "target" && !!p.player_id)
        .map((p) => p.player_id as string),
    [rosterPlayers],
  );

  const { data: liveTargetPredictions = [] } = useQuery({
    queryKey: ["team-builder-live-target-predictions", targetPlayerIds],
    enabled: targetPlayerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_predictions")
        .select("id, player_id, from_avg, from_obp, from_slg, p_avg, p_obp, p_slg, p_ops, p_wrc_plus, power_rating_plus, class_transition, dev_aggressiveness, model_type, variant, status, updated_at")
        .in("model_type", ["returner", "transfer"])
        .in("player_id", targetPlayerIds);
      if (error) throw error;
      return (data || []) as LivePredictionRow[];
    },
  });

  const liveTargetPredictionByPlayerId = useMemo(() => {
    const grouped = new Map<string, LivePredictionRow[]>();
    for (const row of liveTargetPredictions) {
      const list = grouped.get(row.player_id) || [];
      list.push(row);
      grouped.set(row.player_id, list);
    }
    const out = new Map<string, LivePredictionRow>();
    for (const [playerId, rows] of grouped.entries()) {
      const best = selectTransferPortalPreferredPrediction(rows) as LivePredictionRow | null;
      if (best) out.set(playerId, best);
    }
    return out;
  }, [liveTargetPredictions]);

  const { data: liveTargetPlayers = [] } = useQuery({
    queryKey: ["team-builder-live-target-players", targetPlayerIds],
    enabled: targetPlayerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("players")
        .select("id, first_name, last_name, position, team, from_team, conference")
        .in("id", targetPlayerIds);
      if (error) throw error;
      return (data || []) as LivePlayerRow[];
    },
  });

  const liveTargetPlayerById = useMemo(() => {
    const map = new Map<string, LivePlayerRow>();
    for (const row of liveTargetPlayers) {
      if (!map.has(row.id)) map.set(row.id, row);
    }
    return map;
  }, [liveTargetPlayers]);

  const internalsPredictionIds = useMemo(() => {
    const ids = new Set<string>();
    targetPredictionIds.forEach((id) => ids.add(id));
    liveTargetPredictions.forEach((row) => {
      if (row.id) ids.add(row.id);
    });
    return Array.from(ids);
  }, [targetPredictionIds, liveTargetPredictions]);

  const { data: predictionInternalsRows = [] } = useQuery({
    queryKey: ["team-builder-prediction-internals", internalsPredictionIds],
    enabled: internalsPredictionIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_prediction_internals")
        .select("prediction_id, avg_power_rating, obp_power_rating, slg_power_rating")
        .in("prediction_id", internalsPredictionIds);
      if (error) throw error;
      return (data || []) as PredictionInternalsRow[];
    },
  });

  const internalsByPredictionId = useMemo(() => {
    const map = new Map<string, PredictionInternalsRow>();
    for (const row of predictionInternalsRows) {
      if (!map.has(row.prediction_id)) map.set(row.prediction_id, row);
    }
    return map;
  }, [predictionInternalsRows]);

  const resolveConferenceStats = useCallback((conference: string | null | undefined): ConferenceRow | null => {
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
    for (const [k, row] of confByKey.entries()) {
      if (!aliases.some((a) => k.includes(a) || a.includes(k))) continue;
      const s = score(row);
      if (s > bestScore) {
        best = row;
        bestScore = s;
      }
    }
    return best;
  }, [confByKey]);

  const simulateTransferProjection = useCallback((p: BuildPlayer) => {
    const snapshotFallback = p.transfer_snapshot
      ? {
          p_avg: p.transfer_snapshot.p_avg,
          p_obp: p.transfer_snapshot.p_obp,
          p_slg: p.transfer_snapshot.p_slg,
          p_wrc_plus: p.transfer_snapshot.p_wrc_plus,
        }
      : null;
    if (!selectedTeam) return snapshotFallback;
    if (!p.player) return snapshotFallback;
    const livePlayer = (p.player_id ? liveTargetPlayerById.get(p.player_id) : null) || p.player;
    const livePred = (p.player_id ? liveTargetPredictionByPlayerId.get(p.player_id) : null) || p.prediction;
    if (!livePred) {
      return snapshotFallback;
    }
    const lastAvg = livePred.from_avg;
    const lastObp = livePred.from_obp;
    const lastSlg = livePred.from_slg;
    if (lastAvg == null || lastObp == null || lastSlg == null) {
      return snapshotFallback;
    }

    const fullName = `${livePlayer.first_name} ${livePlayer.last_name}`;
    const candidates = seedByName.get(normalizeKey(fullName)) || [];
    let inferredFromTeam: string | null = null;
    if (candidates.length === 1) {
      inferredFromTeam = candidates[0].team;
    } else if (candidates.length > 1) {
      const key = `${statKey(lastAvg)}|${statKey(lastObp)}|${statKey(lastSlg)}`;
      const exact = candidates.find((r) => `${statKey(r.avg)}|${statKey(r.obp)}|${statKey(r.slg)}` === key);
      inferredFromTeam = exact?.team || candidates[0].team;
    }

    const fromTeamName = livePlayer.from_team || inferredFromTeam || livePlayer.team;
    const fromTeamRow = fromTeamName ? teamByKey.get(normalizeKey(fromTeamName)) || null : null;
    const toTeamRow = teamByKey.get(normalizeKey(selectedTeam)) || null;
    if (!toTeamRow) {
      return snapshotFallback;
    }

    const fromConference = fromTeamRow?.conference || livePlayer.conference || null;
    const fromConfStats = resolveConferenceStats(fromConference);
    const toConfStats = resolveConferenceStats(toTeamRow.conference || null);

    const internals = livePred.id ? internalsByPredictionId.get(livePred.id) || null : null;
    // Use stat-specific power rating+ only (no fallback to overall power_rating_plus).
    const baPR = internals?.avg_power_rating ?? null;
    const obpPR = internals?.obp_power_rating ?? null;
    const isoPR = internals?.slg_power_rating ?? null;

    if (baPR == null || obpPR == null || isoPR == null) {
      return snapshotFallback;
    }
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
    if (
      fromAvgPlus == null || toAvgPlus == null ||
      fromObpPlus == null || toObpPlus == null ||
      fromIsoPlus == null || toIsoPlus == null ||
      fromStuff == null || toStuff == null ||
      fromParkAvgRaw == null || toParkAvgRaw == null ||
      fromParkObpRaw == null || toParkObpRaw == null ||
      fromParkIsoRaw == null || toParkIsoRaw == null
    ) {
      return snapshotFallback;
    }
    const fromPark = normalizeParkToIndex(fromParkAvgRaw);
    const toPark = normalizeParkToIndex(toParkAvgRaw);
    const fromObpPark = normalizeParkToIndex(fromParkObpRaw);
    const toObpPark = normalizeParkToIndex(toParkObpRaw);
    const fromIsoPark = normalizeParkToIndex(fromParkIsoRaw);
    const toIsoPark = normalizeParkToIndex(toParkIsoRaw);

    const ncaaAvgBA = toRate(eqNum("t_ba_ncaa_avg", 0.280));
    const ncaaAvgOBP = toRate(eqNum("t_obp_ncaa_avg", 0.385));
    const ncaaAvgISO = toRate(eqNum("t_iso_ncaa_avg", 0.162));
    const ncaaAvgWrc = toRate(eqNum("t_wrc_ncaa_avg", 0.364));
    const baStdPower = eqNum("t_ba_std_pr", 31.297);
    const baStdNcaa = toRate(eqNum("t_ba_std_ncaa", 0.043455));
    const obpStdPower = eqNum("t_obp_std_pr", 28.889);
    const obpStdNcaa = toRate(eqNum("t_obp_std_ncaa", 0.046781));
    const baPowerWeight = toRate(eqNum("t_ba_power_weight", 0.70));
    const obpPowerWeight = toRate(eqNum("t_obp_power_weight", 0.70));
    const baConferenceWeight = toWeight(eqNum("t_ba_conference_weight", 1.0));
    const obpConferenceWeight = toWeight(eqNum("t_obp_conference_weight", 1.0));
    const isoConferenceWeight = toWeight(eqNum("t_iso_conference_weight", 0.25));
    const baPitchingWeight = toWeight(eqNum("t_ba_pitching_weight", 1.0));
    const obpPitchingWeight = toWeight(eqNum("t_obp_pitching_weight", 1.0));
    const isoPitchingWeight = toWeight(eqNum("t_iso_pitching_weight", 1.0));
    const baParkWeight = toWeight(eqNum("t_ba_park_weight", 1.0));
    const obpParkWeight = toWeight(eqNum("t_obp_park_weight", 1.0));
    const isoParkWeight = toWeight(eqNum("t_iso_park_weight", 0.05));
    const isoStdPower = eqNum("r_iso_std_pr", 45.423);
    const isoStdNcaa = toRate(eqNum("r_iso_std_ncaa", 0.07849797197));
    const wObp = toRate(eqNum("r_w_obp", 0.45));
    const wSlg = toRate(eqNum("r_w_slg", 0.30));
    const wAvg = toRate(eqNum("r_w_avg", 0.15));
    const wIso = toRate(eqNum("r_w_iso", 0.10));

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
    const basePerOwar = eqNum("nil_base_per_owar", 25000);
    const ptm = getProgramTierMultiplierByConference(toTeamRow.conference || null, DEFAULT_NIL_TIER_MULTIPLIERS);
    const pvm = getPositionValueMultiplier(livePlayer.position ?? p.player?.position ?? null);
    const simNilValuation = projected.owar == null ? null : projected.owar * basePerOwar * ptm * pvm;
    return { p_avg: projected.pAvg, p_obp: projected.pObp, p_slg: projected.pSlg, p_wrc_plus: projected.pWrcPlus, owar: projected.owar, nil_valuation: simNilValuation };
  }, [selectedTeam, teamByKey, resolveConferenceStats, internalsByPredictionId, seedByName, liveTargetPredictionByPlayerId, liveTargetPlayerById, teamParkComponents]);

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
    queryKey: ["team-builder-compare-internals-a", compareAPrediction?.id],
    enabled: !!compareAPrediction?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_prediction_internals")
        .select("avg_power_rating, obp_power_rating, slg_power_rating")
        .eq("prediction_id", compareAPrediction.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: compareBInternals } = useQuery({
    queryKey: ["team-builder-compare-internals-b", compareBPrediction?.id],
    enabled: !!compareBPrediction?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_prediction_internals")
        .select("avg_power_rating, obp_power_rating, slg_power_rating")
        .eq("prediction_id", compareBPrediction.id)
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
      fromConfStats.stuff_plus == null || toConfStats.stuff_plus == null
    ) return null;

    const fromParkAvgRaw = resolveMetricParkFactor(fromTeamRow?.name, fromTeamRow?.park_factor ?? null, "avg", teamParkComponents);
    const toParkAvgRaw = resolveMetricParkFactor(toTeamRow?.name, toTeamRow?.park_factor ?? null, "avg", teamParkComponents);
    const fromParkObpRaw = resolveMetricParkFactor(fromTeamRow?.name, fromTeamRow?.park_factor ?? null, "obp", teamParkComponents);
    const toParkObpRaw = resolveMetricParkFactor(toTeamRow?.name, toTeamRow?.park_factor ?? null, "obp", teamParkComponents);
    const fromParkIsoRaw = resolveMetricParkFactor(fromTeamRow?.name, fromTeamRow?.park_factor ?? null, "iso", teamParkComponents);
    const toParkIsoRaw = resolveMetricParkFactor(toTeamRow?.name, toTeamRow?.park_factor ?? null, "iso", teamParkComponents);
    if (
      fromParkAvgRaw == null || toParkAvgRaw == null ||
      fromParkObpRaw == null || toParkObpRaw == null ||
      fromParkIsoRaw == null || toParkIsoRaw == null
    ) return null;

    const projected = computeTransferProjection({
      lastAvg, lastObp, lastSlg, baPR, obpPR, isoPR,
      fromAvgPlus: fromConfStats.avg_plus, toAvgPlus: toConfStats.avg_plus,
      fromObpPlus: fromConfStats.obp_plus, toObpPlus: toConfStats.obp_plus,
      fromIsoPlus: fromConfStats.iso_plus, toIsoPlus: toConfStats.iso_plus,
      fromStuff: fromConfStats.stuff_plus, toStuff: toConfStats.stuff_plus,
      fromPark: normalizeParkToIndex(fromParkAvgRaw), toPark: normalizeParkToIndex(toParkAvgRaw),
      fromObpPark: normalizeParkToIndex(fromParkObpRaw), toObpPark: normalizeParkToIndex(toParkObpRaw),
      fromIsoPark: normalizeParkToIndex(fromParkIsoRaw), toIsoPark: normalizeParkToIndex(toParkIsoRaw),
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
      isoConferenceWeight: toWeight(eqNum("t_iso_conference_weight", 0.25)),
      baPitchingWeight: toWeight(eqNum("t_ba_pitching_weight", 1.0)),
      obpPitchingWeight: toWeight(eqNum("t_obp_pitching_weight", 1.0)),
      isoPitchingWeight: toWeight(eqNum("t_iso_pitching_weight", 1.0)),
      baParkWeight: toWeight(eqNum("t_ba_park_weight", 1.0)),
      obpParkWeight: toWeight(eqNum("t_obp_park_weight", 1.0)),
      isoParkWeight: toWeight(eqNum("t_iso_park_weight", 0.05)),
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
      fromPark: fromParkAvgRaw,
      toPark: toParkAvgRaw,
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
  }, [eqNum, inferFromTeamForPrediction, resolveConferenceStats, teamByKey, teamParkComponents]);

  const compareASimulation = useMemo(
    () => computeCompareSimulation(compareAPlayer, compareAPrediction, compareAInternals, compareADestinationTeam),
    [compareAPlayer, compareAPrediction, compareAInternals, compareADestinationTeam, computeCompareSimulation],
  );
  const compareBSimulation = useMemo(
    () => computeCompareSimulation(compareBPlayer, compareBPrediction, compareBInternals, compareBDestinationTeam),
    [compareBPlayer, compareBPrediction, compareBInternals, compareBDestinationTeam, computeCompareSimulation],
  );

  const removePlayer = (idx: number) => {
    setRosterPlayers((prev) => prev.filter((_, i) => i !== idx));
    setDirty(true);
  };

  const updatePlayer = (idx: number, updates: Partial<BuildPlayer>) => {
    setRosterPlayers((prev) => prev.map((p, i) => (i === idx ? { ...p, ...updates } : p)));
    setDirty(true);
  };

  const updatePlayerWithRecalc = async (idx: number, updates: Partial<BuildPlayer>) => {
    const current = rosterPlayers[idx];
    updatePlayer(idx, updates);

    // For returner rows, re-run the prediction when class/dev inputs change so displayed
    // pAVG/pOBP/pSLG, wRC+, and derived oWAR stay accurate.
    if (!current || (current.roster_status || "returner") === "target") return;
    const predictionId = current.prediction?.id;
    if (!predictionId) return;

    const classTransition = (updates.class_transition ?? current.class_transition ?? null) as string | null;
    const devAgg = Number(updates.dev_aggressiveness ?? current.dev_aggressiveness ?? 0);

    try {
      const res = await recalculatePredictionById(predictionId, {
        class_transition: classTransition ?? undefined,
        dev_aggressiveness: Number.isFinite(devAgg) ? devAgg : undefined,
      });
      setRosterPlayers((prev) =>
        prev.map((p, i) =>
          i === idx
            ? {
                ...p,
                prediction: p.prediction ? { ...p.prediction, ...(res?.prediction || {}) } : p.prediction,
              }
            : p,
        ),
      );
    } catch (e: any) {
      toast({
        title: "Recalc failed",
        description: e?.message || "Could not recalculate player outputs.",
        variant: "destructive",
      });
    }
  };

  const addIncomingFreshman = () => {
    const name = incomingName.trim();
    if (!name) {
      toast({ title: "Name required", description: "Enter a player name for incoming freshman.", variant: "destructive" });
      return;
    }
    const newP: BuildPlayer = {
      player_id: null,
      source: "returner",
      custom_name: name,
      position_slot: incomingPosition || null,
      depth_order: 1,
      nil_value: Number(incomingNil) || 0,
      production_notes: null,
      roster_status: "returner",
      depth_role: "bench",
      class_transition: "FS",
      dev_aggressiveness: 0,
      transfer_snapshot: null,
      player: {
        first_name: name,
        last_name: "",
        position: incomingPosition || null,
        team: selectedTeam || null,
        from_team: null,
        conference: null,
      },
      prediction: null,
      nilVal: null,
      nil_owar: 0,
      team_metrics: null,
      team_power_plus: null,
    };
    setRosterPlayers((prev) => [...prev, newP]);
    setIncomingName("");
    setIncomingPosition("");
    setIncomingNil(0);
    setDirty(true);
  };

  const addPlayerFromTargetSearch = async (row: any) => {
    const alreadyAdded = rosterPlayers.some(
      (p) => p.player_id === row.id && (p.roster_status || "returner") === "target"
    );
    if (alreadyAdded) {
      toast({ title: "Already on target board", description: `${row.first_name} ${row.last_name} is already a target.` });
      setTargetPlayerSearchQuery("");
      setTargetPlayerSearchOpen(false);
      return;
    }

    const chosenPred = selectTransferPortalPreferredPrediction(
      (row.player_predictions || []).filter((pr: any) => pr.variant === "regular")
    );

    // Fetch prediction internals so we can run the same simulation as Transfer Portal
    let transferSnapshot: TransferSnapshot | null = null;
    if (chosenPred?.id && selectedTeam) {
      const { data: internals } = await supabase
        .from("player_prediction_internals")
        .select("avg_power_rating, obp_power_rating, slg_power_rating")
        .eq("prediction_id", chosenPred.id)
        .maybeSingle();

      const baPR = internals?.avg_power_rating ?? null;
      const obpPR = internals?.obp_power_rating ?? null;
      const isoPR = internals?.slg_power_rating ?? null;

      const lastAvg = chosenPred.from_avg ?? null;
      const lastObp = chosenPred.from_obp ?? null;
      const lastSlg = chosenPred.from_slg ?? null;

      const fullName = `${row.first_name} ${row.last_name}`;
      const candidates = seedByName.get(normalizeKey(fullName)) || [];
      let inferredFromTeam: string | null = null;
      if (candidates.length === 1) {
        inferredFromTeam = candidates[0].team;
      } else if (candidates.length > 1 && lastAvg != null) {
        const key = `${statKey(lastAvg)}|${statKey(lastObp)}|${statKey(lastSlg)}`;
        const exact = candidates.find((r) => `${statKey(r.avg)}|${statKey(r.obp)}|${statKey(r.slg)}` === key);
        inferredFromTeam = exact?.team || candidates[0].team;
      }

      const fromTeamName = row.from_team || inferredFromTeam || row.team;
      const fromTeamRow = fromTeamName ? teamByKey.get(normalizeKey(fromTeamName)) || null : null;
      const toTeamRow = teamByKey.get(normalizeKey(selectedTeam)) || null;
      const fromConference = fromTeamRow?.conference || row.conference || null;
      const fromConfStats = resolveConferenceStats(fromConference);
      const toConfStats = resolveConferenceStats(toTeamRow?.conference || null);

      if (
        baPR != null && obpPR != null && isoPR != null &&
        lastAvg != null && lastObp != null && lastSlg != null &&
        toTeamRow && fromConfStats && toConfStats &&
        fromConfStats.avg_plus != null && toConfStats.avg_plus != null &&
        fromConfStats.obp_plus != null && toConfStats.obp_plus != null &&
        fromConfStats.iso_plus != null && toConfStats.iso_plus != null &&
        fromConfStats.stuff_plus != null && toConfStats.stuff_plus != null
      ) {
        const fromParkAvgRaw = resolveMetricParkFactor(fromTeamRow?.name, fromTeamRow?.park_factor ?? null, "avg", teamParkComponents);
        const toParkAvgRaw = resolveMetricParkFactor(toTeamRow?.name, toTeamRow?.park_factor ?? null, "avg", teamParkComponents);
        const fromParkObpRaw = resolveMetricParkFactor(fromTeamRow?.name, fromTeamRow?.park_factor ?? null, "obp", teamParkComponents);
        const toParkObpRaw = resolveMetricParkFactor(toTeamRow?.name, toTeamRow?.park_factor ?? null, "obp", teamParkComponents);
        const fromParkIsoRaw = resolveMetricParkFactor(fromTeamRow?.name, fromTeamRow?.park_factor ?? null, "iso", teamParkComponents);
        const toParkIsoRaw = resolveMetricParkFactor(toTeamRow?.name, toTeamRow?.park_factor ?? null, "iso", teamParkComponents);
        if (
          fromParkAvgRaw != null && toParkAvgRaw != null &&
          fromParkObpRaw != null && toParkObpRaw != null &&
          fromParkIsoRaw != null && toParkIsoRaw != null
        ) {
          const fromPark = normalizeParkToIndex(fromParkAvgRaw);
          const toPark = normalizeParkToIndex(toParkAvgRaw);
          const fromObpPark = normalizeParkToIndex(fromParkObpRaw);
          const toObpPark = normalizeParkToIndex(toParkObpRaw);
          const fromIsoPark = normalizeParkToIndex(fromParkIsoRaw);
          const toIsoPark = normalizeParkToIndex(toParkIsoRaw);

        const ncaaAvgBA = toRate(eqNum("t_ba_ncaa_avg", 0.280));
        const ncaaAvgOBP = toRate(eqNum("t_obp_ncaa_avg", 0.385));
        const ncaaAvgISO = toRate(eqNum("t_iso_ncaa_avg", 0.162));
        const ncaaAvgWrc = toRate(eqNum("t_wrc_ncaa_avg", 0.364));
        const baStdPower = eqNum("t_ba_std_pr", 31.297);
        const baStdNcaa = toRate(eqNum("t_ba_std_ncaa", 0.043455));
        const obpStdPower = eqNum("t_obp_std_pr", 28.889);
        const obpStdNcaa = toRate(eqNum("t_obp_std_ncaa", 0.046781));
        const baPowerWeight = toRate(eqNum("t_ba_power_weight", 0.70));
        const obpPowerWeight = toRate(eqNum("t_obp_power_weight", 0.70));
        const baConferenceWeight = toWeight(eqNum("t_ba_conference_weight", 1.0));
        const obpConferenceWeight = toWeight(eqNum("t_obp_conference_weight", 1.0));
        const isoConferenceWeight = toWeight(eqNum("t_iso_conference_weight", 0.25));
        const baPitchingWeight = toWeight(eqNum("t_ba_pitching_weight", 1.0));
        const obpPitchingWeight = toWeight(eqNum("t_obp_pitching_weight", 1.0));
        const isoPitchingWeight = toWeight(eqNum("t_iso_pitching_weight", 1.0));
        const baParkWeight = toWeight(eqNum("t_ba_park_weight", 1.0));
        const obpParkWeight = toWeight(eqNum("t_obp_park_weight", 1.0));
        const isoParkWeight = toWeight(eqNum("t_iso_park_weight", 0.05));
        const isoStdPower = eqNum("r_iso_std_pr", 45.423);
        const isoStdNcaa = toRate(eqNum("r_iso_std_ncaa", 0.07849797197));
        const wObp = toRate(eqNum("r_w_obp", 0.45));
        const wSlg = toRate(eqNum("r_w_slg", 0.30));
        const wAvg = toRate(eqNum("r_w_avg", 0.15));
        const wIso = toRate(eqNum("r_w_iso", 0.10));

          const projected = computeTransferProjection({
          lastAvg, lastObp, lastSlg, baPR, obpPR, isoPR,
          fromAvgPlus: fromConfStats.avg_plus, toAvgPlus: toConfStats.avg_plus,
          fromObpPlus: fromConfStats.obp_plus, toObpPlus: toConfStats.obp_plus,
          fromIsoPlus: fromConfStats.iso_plus, toIsoPlus: toConfStats.iso_plus,
          fromStuff: fromConfStats.stuff_plus, toStuff: toConfStats.stuff_plus,
          fromPark, toPark,
          fromObpPark, toObpPark,
          fromIsoPark, toIsoPark,
          ncaaAvgBA, ncaaAvgOBP, ncaaAvgISO, ncaaAvgWrc,
          baStdPower, baStdNcaa, obpStdPower, obpStdNcaa,
          baPowerWeight, obpPowerWeight,
          baConferenceWeight, obpConferenceWeight, isoConferenceWeight,
          baPitchingWeight, obpPitchingWeight, isoPitchingWeight,
          baParkWeight, obpParkWeight, isoParkWeight,
          isoStdPower, isoStdNcaa, wObp, wSlg, wAvg, wIso,
        });

          const basePerOwar = eqNum("nil_base_per_owar", 25000);
          const ptm = getProgramTierMultiplierByConference(toTeamRow.conference || null, DEFAULT_NIL_TIER_MULTIPLIERS);
          const pvm = getPositionValueMultiplier(row.position);
          const nilValuation = projected.owar == null ? null : projected.owar * basePerOwar * ptm * pvm;

          transferSnapshot = {
            p_avg: projected.pAvg,
            p_obp: projected.pObp,
            p_slg: projected.pSlg,
            p_wrc_plus: projected.pWrcPlus,
            owar: projected.owar,
            nil_valuation: nilValuation,
            from_team: fromTeamName || null,
            from_conference: fromConference,
          };
        }
      }
    }

    const newP: BuildPlayer = {
      player_id: row.id,
      source: "portal",
      custom_name: null,
      position_slot: null,
      depth_order: 1,
      nil_value: row.nil_valuations?.[0]?.estimated_value ? Number(row.nil_valuations[0].estimated_value) : 0,
      production_notes: null,
      roster_status: "target",
      depth_role: "utility",
      class_transition: chosenPred?.class_transition ?? "SJ",
      dev_aggressiveness: chosenPred?.dev_aggressiveness ?? 0,
      transfer_snapshot: transferSnapshot,
      player: {
        first_name: row.first_name,
        last_name: row.last_name,
        position: row.position,
        team: row.team,
        from_team: row.from_team,
        conference: row.conference ?? null,
      },
      prediction: chosenPred ?? null,
      nilVal: row.nil_valuations?.[0]?.estimated_value ?? null,
      nil_owar: row.nil_valuations?.[0]?.component_breakdown?.ncaa_owar ?? null,
      team_metrics: null,
      team_power_plus: null,
    };
    setRosterPlayers((prev) => [...prev, newP]);
    setDirty(true);
    setTargetPlayerSearchQuery("");
    setTargetPlayerSearchOpen(false);
    toast({ title: "Added to targets", description: `${row.first_name} ${row.last_name}` });
  };

  const applyTeamMetricsCsv = async (file: File) => {
    const csvText = await file.text();
    const rows = parseTeamBuilderCsv(csvText);
    if (rows.length === 0) {
      toast({ title: "CSV import failed", description: "No rows found in CSV.", variant: "destructive" });
      return;
    }

    const rosterNameToIndex = new Map<string, number>();
    rosterPlayers.forEach((p, idx) => {
      const fullName = p.player ? `${p.player.first_name} ${p.player.last_name}` : p.custom_name || "";
      const key = normalizeName(fullName);
      if (key && !rosterNameToIndex.has(key)) rosterNameToIndex.set(key, idx);
    });

    let updated = 0;
    let unmatched = 0;
    let skippedSystem = 0;

    setRosterPlayers((prev) => {
      const next = [...prev];
      for (const row of rows) {
        const rawName =
          pickCell(row, ["playername", "name", "fullname", "player"]) ||
          `${pickCell(row, ["firstname"]) || ""} ${pickCell(row, ["lastname"]) || ""}`.trim();
        const key = normalizeName(rawName);
        if (!key || !rosterNameToIndex.has(key)) {
          unmatched += 1;
          continue;
        }
        const idx = rosterNameToIndex.get(key)!;
        const current = next[idx];
        if (hasSystemPredictionStats(current)) {
          skippedSystem += 1;
          continue;
        }
        const metrics: TeamMetricInputs = {
          contact: parseNum(pickCell(row, ["contact", "contactpct", "contactpercentage"])),
          lineDrive: parseNum(pickCell(row, ["linedrive", "ld", "linedrivepct"])),
          avgExitVelo: parseNum(pickCell(row, ["avgexitvelo", "averageexitvelocity", "exitvelo", "ev"])),
          popUp: parseNum(pickCell(row, ["popup", "popuppct"])),
          bb: parseNum(pickCell(row, ["bb", "bbpct", "walk", "walkpct"])),
          chase: parseNum(pickCell(row, ["chase", "chasepct"])),
          barrel: parseNum(pickCell(row, ["barrel", "barrelpct"])),
          ev90: parseNum(pickCell(row, ["ev90"])),
          pull: parseNum(pickCell(row, ["pull", "pullpct"])),
          la10_30: parseNum(pickCell(row, ["la1030", "launchangle1030", "la10to30"])),
          gb: parseNum(pickCell(row, ["gb", "gbpct", "groundball", "groundballpct"])),
        };
        const merged: TeamMetricInputs = {
          ...EMPTY_TEAM_METRICS,
          ...(current.team_metrics ?? {}),
          ...Object.fromEntries(
            Object.entries(metrics).filter(([, v]) => v != null),
          ),
        } as TeamMetricInputs;
        const powerPlus = computeTeamPowerPlus(merged);
        next[idx] = { ...current, team_metrics: merged, team_power_plus: powerPlus };
        updated += 1;
      }
      return next;
    });

    setDirty(true);
    toast({
      title: "Team metrics imported",
      description: `Updated ${updated} roster players, skipped ${skippedSystem} with existing system stats, unmatched rows: ${unmatched}. Data is saved only in this Team Builder build.`,
    });
  };

  const downloadTeamMetricsTemplate = () => {
    const header = [
      "Player Name",
      "Contact%",
      "Line Drive%",
      "Avg Exit Velo",
      "Pop-Up%",
      "BB%",
      "Chase%",
      "Barrel%",
      "EV90",
      "Pull%",
      "LA 10-30%",
      "GB%",
    ];
    const sample = [
      "Sample Player",
      "78.5",
      "21.4",
      "88.1",
      "6.2",
      "10.8",
      "24.0",
      "15.2",
      "102.7",
      "38.4",
      "30.1",
      "42.3",
    ];
    const csv = `${header.join(",")}\n${sample.join(",")}\n`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "team_builder_power_metrics_template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadPlayerProfileTemplate = () => {
    const header = [
      "Player Name",
      "Team",
      "Position",
      "Class",
      "AVG",
      "OBP",
      "SLG",
      "OPS",
      "ISO",
      "wRC+",
      "oWAR",
      "Contact%",
      "Line Drive%",
      "Avg Exit Velo",
      "Pop-Up%",
      "BB%",
      "Chase%",
      "Barrel%",
      "EV90",
      "Pull%",
      "LA 10-30%",
      "GB%",
      "Notes",
    ];
    const sample = [
      "Sample Player",
      "Sample University",
      "CF",
      "JR",
      "0.312",
      "0.401",
      "0.522",
      "0.923",
      "0.210",
      "112",
      "1.44",
      "79.0",
      "22.0",
      "88.4",
      "6.1",
      "11.2",
      "23.4",
      "16.0",
      "103.5",
      "37.1",
      "29.2",
      "41.8",
      "Optional team notes",
    ];
    const csv = `${header.join(",")}\n${sample.join(",")}\n`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "team_builder_player_profile_template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Split into position players and pitchers
  const isPitcher = (p: BuildPlayer) => {
    const pos = p.position_slot || p.player?.position || "";
    return /^(SP|RP|CL|P|LHP|RHP)/i.test(pos);
  };

  const positionPlayers = rosterPlayers.filter((p) => !isPitcher(p));
  const pitchers = rosterPlayers.filter((p) => isPitcher(p));
  const targetPlayers = rosterPlayers.filter((p) => (p.roster_status || "returner") === "target");
  const targetPositionPlayers = targetPlayers.filter((p) => !isPitcher(p));
  const targetPitchers = targetPlayers.filter((p) => isPitcher(p));

  const playerProjection = useCallback((p: BuildPlayer) => {
    const sim = p.roster_status === "target" ? simulateTransferProjection(p) : null;
    const shown = (p.roster_status === "target") ? sim : p.prediction;
    const shownWrc = shown?.p_wrc_plus ?? null;
    const baseOwar = computeOWarFromWrcPlus(shownWrc) ?? p.nil_owar ?? 0;
    const owar = baseOwar * depthRoleMultiplier(p.depth_role);
    return { sim, shown, shownWrc, owar };
  }, [simulateTransferProjection]);

  const projectedPlayerScore = useCallback((p: BuildPlayer) => {
    const { owar } = playerProjection(p);
    return calcPlayerScore({
      owar,
      programTierMultiplier,
      position: p.position_slot || p.player?.position,
    });
  }, [playerProjection, programTierMultiplier]);

  const nilBasePerOWar = eqNum("nil_base_per_owar", 25000);
  const projectedNilForPlayer = useCallback((p: BuildPlayer) => {
    if (!isProjectedStatus(p)) return 0;
    return projectedPlayerScore(p) * nilBasePerOWar;
  }, [projectedPlayerScore, nilBasePerOWar]);
  const effectiveNilForPlayer = useCallback((p: BuildPlayer) => {
    if (!isProjectedStatus(p)) return 0;
    const actualNil = Number(p.nil_value) || 0;
    if (actualNil > 0) return actualNil;
    return projectedNilForPlayer(p);
  }, [projectedNilForPlayer]);

  const isProjectedStatus = (p: BuildPlayer) => (p.roster_status || "returner") !== "leaving";

  const totalRosterPlayerScore = rosterPlayers.reduce((sum, p) => {
    if (!isProjectedStatus(p)) return sum;
    return sum + projectedPlayerScore(p);
  }, 0);
  const totalEffectiveNil = rosterPlayers.reduce((sum, p) => {
    return sum + effectiveNilForPlayer(p);
  }, 0);
  const budgetRemaining = totalBudget - totalEffectiveNil;
  const calcTotals = useCallback((rows: BuildPlayer[]) => {
    let sumAvg = 0;
    let sumObp = 0;
    let sumSlg = 0;
    let sumWrc = 0;
    let weightAvg = 0;
    let weightObp = 0;
    let weightSlg = 0;
    let weightWrc = 0;
    let totalOWar = 0;
    let totalActualNil = 0;
    let totalProjectedNil = 0;

    for (const p of rows) {
      if (!isProjectedStatus(p)) continue;
      const mult = depthRoleMultiplier(p.depth_role);
      const { shown, owar } = playerProjection(p);
      if (shown?.p_avg != null) {
        sumAvg += shown.p_avg * mult;
        weightAvg += mult;
      }
      if (shown?.p_obp != null) {
        sumObp += shown.p_obp * mult;
        weightObp += mult;
      }
      if (shown?.p_slg != null) {
        sumSlg += shown.p_slg * mult;
        weightSlg += mult;
      }
      if (shown?.p_wrc_plus != null) {
        sumWrc += shown.p_wrc_plus * mult;
        weightWrc += mult;
      }
      totalOWar += owar ?? 0;
      totalActualNil += effectiveNilForPlayer(p);
      totalProjectedNil += projectedNilForPlayer(p);
    }

    return {
      avg: weightAvg > 0 ? sumAvg / weightAvg : null,
      obp: weightObp > 0 ? sumObp / weightObp : null,
      slg: weightSlg > 0 ? sumSlg / weightSlg : null,
      wrcPlusAvg: weightWrc > 0 ? sumWrc / weightWrc : null,
      totalOWar,
      totalActualNil,
      totalProjectedNil,
    };
  }, [isProjectedStatus, playerProjection, effectiveNilForPlayer, projectedNilForPlayer]);
  const tableTotals = useMemo(() => calcTotals(rosterPlayers), [calcTotals, rosterPlayers]);
  const targetTableTotals = useMemo(() => calcTotals(targetPlayers), [calcTotals, targetPlayers]);

  const depthKey = (slot: string, depth: number) => `${slot}:${depth}`;

  const slotMatchesPosition = useCallback((posRaw: string | null | undefined, slot: string) => {
    const pos = (posRaw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!pos) return false;
    if (slot === "C") return pos === "C";
    if (slot === "1B") return pos === "1B";
    if (slot === "2B") return pos === "2B";
    if (slot === "3B") return pos === "3B";
    if (slot === "SS") return pos === "SS";
    if (slot === "LF") return pos === "LF";
    if (slot === "CF") return pos === "CF";
    if (slot === "RF") return pos === "RF";
    if (slot === "DH") return pos === "DH";
    return false;
  }, []);

  useEffect(() => {
    setDepthAssignments((prev) => {
      const next: Record<string, number> = {};
      for (const [k, idx] of Object.entries(prev)) {
        if (Number.isInteger(idx) && idx >= 0 && idx < rosterPlayers.length) next[k] = idx;
      }

      rosterPlayers.forEach((p, idx) => {
        if (!p.position_slot || !p.depth_order) return;
        const k = depthKey(p.position_slot, p.depth_order);
        if (next[k] == null) next[k] = idx;
      });

      for (const slot of POSITION_SLOTS) {
        const k = depthKey(slot, 1);
        if (next[k] != null) continue;
        const idx = rosterPlayers.findIndex(
          (p) =>
            (p.roster_status || "returner") !== "leaving" &&
            !isPitcher(p) &&
            slotMatchesPosition(p.player?.position || null, slot),
        );
        if (idx >= 0) next[k] = idx;
      }

      const pitcherIdxs = rosterPlayers
        .map((p, idx) => ({ p, idx }))
        .filter(({ p }) => (p.roster_status || "returner") !== "leaving" && isPitcher(p))
        .map(({ idx }) => idx);

      for (let i = 1; i <= 5; i += 1) {
        const k = depthKey(`SP${i}`, 1);
        if (next[k] == null && pitcherIdxs[i - 1] != null) next[k] = pitcherIdxs[i - 1];
      }
      for (let i = 1; i <= 8; i += 1) {
        const k = depthKey(`RP${i}`, 1);
        if (next[k] == null && pitcherIdxs[i + 4] != null) next[k] = pitcherIdxs[i + 4];
      }

      return next;
    });
  }, [rosterPlayers, slotMatchesPosition]);

  const getPlayerName = (p: BuildPlayer) =>
    p.player ? `${p.player.first_name} ${p.player.last_name}` : p.custom_name || "TBD";

  const eligiblePositionPlayers = useMemo(
    () =>
      rosterPlayers
        .map((rp, idx) => ({ rp, idx }))
        .filter(({ rp }) => !isPitcher(rp) && (rp.roster_status || "returner") !== "leaving"),
    [rosterPlayers],
  );

  const eligiblePitchers = useMemo(
    () =>
      rosterPlayers
        .map((rp, idx) => ({ rp, idx }))
        .filter(({ rp }) => isPitcher(rp) && (rp.roster_status || "returner") !== "leaving"),
    [rosterPlayers],
  );

  const assignDepthSlot = (slot: string, depth: number, value: string) => {
    setDepthAssignments((prev) => {
      const next = { ...prev };
      const k = depthKey(slot, depth);
      if (value === "none" || value === "freshman" || value === "transfer") {
        delete next[k];
      } else {
        next[k] = Number(value);
      }
      return next;
    });
    setDepthPlaceholders((prev) => {
      const next = { ...prev };
      const k = depthKey(slot, depth);
      if (value === "freshman" || value === "transfer") next[k] = value;
      else delete next[k];
      return next;
    });
    setDirty(true);
  };

  const renderDepthStack = (
    slot: string,
    eligible: Array<{ rp: BuildPlayer; idx: number }>,
    className: string,
  ) => {
    return (
      <div className={`absolute -translate-x-1/2 ${className}`}>
        <p className="mb-1 text-[10px] font-semibold tracking-wide text-slate-700 text-center">{slot}</p>
        <div className="w-[106px] space-y-1">
          {[1, 2, 3].map((depth) => {
            const currentIdx = depthAssignments[depthKey(slot, depth)];
            const placeholder = depthPlaceholders[depthKey(slot, depth)] ?? null;
            return (
              <Select key={`${slot}-${depth}`} value={currentIdx != null ? String(currentIdx) : (placeholder ?? "none")} onValueChange={(v) => assignDepthSlot(slot, depth, v)}>
                <SelectTrigger className="h-6 rounded-sm border-slate-300 bg-white/95 px-1 text-[10px] text-black shadow-sm">
                  <SelectValue placeholder={`${depth}`} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  <SelectItem value="freshman">Freshman</SelectItem>
                  <SelectItem value="transfer">Transfer</SelectItem>
                  {eligible.map(({ rp, idx }) => (
                    <SelectItem key={`${slot}-${depth}-${idx}`} value={String(idx)}>
                      {getPlayerName(rp)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            );
          })}
        </div>
      </div>
    );
  };

  const renderStartingRotationStack = (
    eligible: Array<{ rp: BuildPlayer; idx: number }>,
    className: string,
  ) => {
    return (
      <div className={`absolute -translate-x-1/2 ${className}`}>
        <p className="mb-1 text-[10px] font-semibold tracking-wide text-slate-700 text-center">Starting Rotation</p>
        <div className="w-[120px] space-y-1">
          {[1, 2, 3, 4, 5].map((sp) => {
            const slot = `SP${sp}`;
            const currentIdx = depthAssignments[depthKey(slot, 1)];
            const placeholder = depthPlaceholders[depthKey(slot, 1)] ?? null;
            return (
              <Select key={slot} value={currentIdx != null ? String(currentIdx) : (placeholder ?? "none")} onValueChange={(v) => assignDepthSlot(slot, 1, v)}>
                <SelectTrigger className="h-6 rounded-sm border-slate-300 bg-white/95 px-1 text-[10px] text-black shadow-sm">
                  <SelectValue placeholder={slot} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  <SelectItem value="freshman">Freshman</SelectItem>
                  <SelectItem value="transfer">Transfer</SelectItem>
                  {eligible.map(({ rp, idx }) => (
                    <SelectItem key={`${slot}-${idx}`} value={String(idx)}>
                      {getPlayerName(rp)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            );
          })}
        </div>
      </div>
    );
  };

  const renderRelieversStack = (
    eligible: Array<{ rp: BuildPlayer; idx: number }>,
    className: string,
  ) => {
    return (
      <div className={`absolute -translate-x-1/2 ${className}`}>
        <p className="mb-1 text-[10px] font-semibold tracking-wide text-slate-700 text-center">Relievers</p>
        <div className="w-[120px] space-y-1">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((rpNum) => {
            const slot = `RP${rpNum}`;
            const currentIdx = depthAssignments[depthKey(slot, 1)];
            const placeholder = depthPlaceholders[depthKey(slot, 1)] ?? null;
            return (
              <Select key={slot} value={currentIdx != null ? String(currentIdx) : (placeholder ?? "none")} onValueChange={(v) => assignDepthSlot(slot, 1, v)}>
                <SelectTrigger className="h-6 rounded-sm border-slate-300 bg-white/95 px-1 text-[10px] text-black shadow-sm">
                  <SelectValue placeholder={slot} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  <SelectItem value="freshman">Freshman</SelectItem>
                  <SelectItem value="transfer">Transfer</SelectItem>
                  {eligible.map(({ rp, idx }) => (
                    <SelectItem key={`${slot}-${idx}`} value={String(idx)}>
                      {getPlayerName(rp)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            );
          })}
        </div>
      </div>
    );
  };

  const newBuild = () => {
    setSelectedBuildId(null);
    setRosterPlayers([]);
    setBuildName("My Team Build");
    setSelectedTeam("");
    setTotalBudget(0);
    setDirty(false);
  };

  const renderPlayerRow = (p: BuildPlayer, idx: number, globalIdx: number) => {
    const projection = playerProjection(p);
    const isTarget = (p.roster_status || "returner") === "target";
    const sim = isTarget ? simulateTransferProjection(p) : null;
    // For target players, show raw projected oWAR/NIL (no depth role multiplier) to match Transfer Portal
    const projectedOwar = isTarget ? (sim?.owar ?? null) : (projection.owar ?? null);
    const projectedNil = isTarget
      ? (sim?.nil_valuation ?? projectedNilForPlayer(p))
      : projectedNilForPlayer(p);
    return (
    <TableRow key={globalIdx}>
      <TableCell className="font-medium">
        <div className="flex items-center gap-2">
          {p.player_id ? (
            <Link
              to={profileRouteFor(p.player_id, p.player?.position ?? null)}
              className="text-primary underline underline-offset-2 hover:opacity-80"
            >
              {getPlayerName(p)}
            </Link>
          ) : (
            <span>{getPlayerName(p)}</span>
          )}
        </div>
        {(p.roster_status || "returner") === "target" && (
          <div className="text-[11px] text-muted-foreground">
            From: {p.transfer_snapshot?.from_team || p.player?.from_team || p.player?.team || "—"} ({p.transfer_snapshot?.from_conference || p.player?.conference || "—"})
          </div>
        )}
      </TableCell>
      <TableCell>
        {(p.roster_status || (p.source === "portal" ? "target" : "returner")) === "target" ? (
          <span className="text-xs font-medium text-primary">Target</span>
        ) : (
          <Select
            value={p.roster_status || "returner"}
            onValueChange={(v) => updatePlayer(globalIdx, { roster_status: v as "returner" | "leaving" })}
          >
            <SelectTrigger className="w-[110px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="returner">Returner</SelectItem>
              <SelectItem value="leaving">Leaving</SelectItem>
            </SelectContent>
          </Select>
        )}
      </TableCell>
      <TableCell>{p.player?.position || "—"}</TableCell>
      <TableCell>
        <Select
          value={p.position_slot || "none"}
          onValueChange={(v) => {
            const nextSlot = v === "none" ? null : v;
            updatePlayer(globalIdx, { position_slot: nextSlot });
            if (p.player_id) {
              const isPitchSlot = !!nextSlot && [...PITCHER_SLOTS].includes(nextSlot as typeof PITCHER_SLOTS[number]);
              const nextPitchRole = isPitchSlot ? pitcherRoleFromSlot(nextSlot) : null;
              updatePlayerOverride(p.player_id, {
                position: nextSlot,
                pitcher_role: nextPitchRole,
              });
              writeLegacyPitchingRoleOverride(getPlayerName(p), p.player?.team || null, nextPitchRole);
            }
          }}
        >
          <SelectTrigger className="w-20 h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">—</SelectItem>
            {[...POSITION_SLOTS, ...PITCHER_SLOTS].map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Select
          value={p.class_transition || "SJ"}
          onValueChange={(v) => updatePlayerWithRecalc(globalIdx, { class_transition: v })}
        >
          <SelectTrigger className="w-[90px] h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="FS">FR→SO</SelectItem>
            <SelectItem value="SJ">SO→JR</SelectItem>
            <SelectItem value="JS">JR→SR</SelectItem>
            <SelectItem value="GR">GR</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Select
          value={String(
            p.dev_aggressiveness === 0 || p.dev_aggressiveness === 0.5 || p.dev_aggressiveness === 1
              ? p.dev_aggressiveness
              : 0
          )}
          onValueChange={(v) => updatePlayerWithRecalc(globalIdx, { dev_aggressiveness: Number(v) })}
        >
          <SelectTrigger className="w-[90px] h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DEV_AGGRESSIVENESS_OPTIONS.map((v) => (
              <SelectItem key={v} value={String(v)}>
                {v.toFixed(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Select
          value={p.depth_role || "starter"}
          onValueChange={(v) => updatePlayer(globalIdx, { depth_role: v as "starter" | "utility" | "bench" })}
        >
          <SelectTrigger className="w-[96px] h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="starter">Starter</SelectItem>
            <SelectItem value="utility">Utility</SelectItem>
            <SelectItem value="bench">Bench</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="text-center">
        {(() => {
          const sim = p.roster_status === "target" ? simulateTransferProjection(p) : null;
          const projected = (p.roster_status === "target")
            ? { p_avg: sim?.p_avg ?? null, p_obp: sim?.p_obp ?? null, p_slg: sim?.p_slg ?? null }
            : { p_avg: p.prediction?.p_avg ?? null, p_obp: p.prediction?.p_obp ?? null, p_slg: p.prediction?.p_slg ?? null };
          if (projected.p_avg == null && projected.p_obp == null && projected.p_slg == null) return "—";
          return (
          <span className="text-xs font-mono">
            {projected.p_avg?.toFixed(3) || "—"} / {projected.p_obp?.toFixed(3) || "—"} / {projected.p_slg?.toFixed(3) || "—"}
          </span>
          );
        })()}
      </TableCell>
      <TableCell className="text-center">
        {(() => {
          const sim = p.roster_status === "target" ? simulateTransferProjection(p) : null;
          const shownWrc = (p.roster_status === "target")
            ? (sim?.p_wrc_plus ?? null)
            : (p.prediction?.p_wrc_plus ?? null);
          return shownWrc != null ? shownWrc.toFixed(0) : "—";
        })()}
      </TableCell>
      <TableCell className="text-center">
        <Input
          type="text"
          inputMode="numeric"
          className="w-28 h-8 mx-auto text-center"
          value={formatWithCommas(p.nil_value)}
          onChange={(e) => updatePlayer(globalIdx, { nil_value: parseCommaNumber(e.target.value) })}
        />
      </TableCell>
      <TableCell className={`text-center font-mono text-xs ${(p.roster_status || "returner") === "leaving" ? "text-muted-foreground" : projectedNilTierClass(projectedNil, totalBudget, fallbackRosterTotalPlayerScore)}`}>
        {(p.roster_status || "returner") === "leaving" ? "—" : `$${Math.round(projectedNil).toLocaleString()}`}
      </TableCell>
      <TableCell className="text-center font-mono text-xs">
        {(p.roster_status || "returner") === "leaving" ? "—" : (projectedOwar != null ? projectedOwar.toFixed(2) : "—")}
      </TableCell>
      <TableCell>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removePlayer(globalIdx)}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </TableCell>
    </TableRow>
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Team Builder</h2>
            <p className="text-muted-foreground text-sm">Build rosters, track NIL budget, and manage depth charts.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[220px]">
              <Label className="text-xs mb-1 block">Load Saved Build</Label>
              <Select value={selectedBuildId || "new"} onValueChange={(v) => v === "new" ? newBuild() : loadBuild(v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select build…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">+ New Build</SelectItem>
                  {builds.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name} ({b.team})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={newBuild}>
              <Plus className="h-4 w-4 mr-1" /> New Build
            </Button>
            <Button
              onClick={() => {
                const name = askBuildName(buildName);
                if (!name) return;
                saveMutation.mutate({ saveAs: true, nameOverride: name });
              }}
              disabled={!selectedTeam || saveMutation.isPending}
            >
              {saveMutation.isPending ? "Saving…" : "Save As"}
              {dirty && <span className="ml-1 text-xs opacity-70">•</span>}
            </Button>
          </div>
        </div>

        {/* Build selector & config */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="relative">
            <Label className="text-xs mb-1 block">Team</Label>
            <Input
              placeholder="Search team…"
              value={teamSearchQuery}
              onChange={(e) => {
                const next = e.target.value;
                setTeamSearchQuery(next);
                setTeamSearchOpen(true);
                if (!next.trim() && selectedTeam) {
                  setSelectedTeam("");
                  setSelectedBuildId(null);
                  setDirty(true);
                }
              }}
              onFocus={() => {
                setTeamSearchOpen(true);
              }}
              onBlur={() => setTimeout(() => setTeamSearchOpen(false), 150)}
              className="w-full"
            />
            {teamSearchOpen && filteredTeamOptions.length > 0 && (
              <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-60 overflow-auto">
                {filteredTeamOptions.map((t) => (
                  <div
                    key={t.name}
                    className="px-3 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground"
                    onMouseDown={() => {
                      setSelectedTeam(t.name);
                      setTeamSearchQuery("");
                      setTeamSearchOpen(false);
                      setSelectedBuildId(null);
                      setDirty(true);
                    }}
                  >
                    {t.name}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <Label className="text-xs mb-1 block">Total Budget ($)</Label>
            <Input type="text" inputMode="numeric" value={formatWithCommas(totalBudget)} onChange={(e) => { setTotalBudget(parseCommaNumber(e.target.value)); setDirty(true); }} />
          </div>
          <div>
            <Label className="text-xs mb-1 block">Program Tier Conference (PTM)</Label>
            <Select
              value={programTierConference}
              onValueChange={(v) => {
                setProgramTierConference(v);
                setProgramTierMultiplier(getProgramTierMultiplierByConference(v, DEFAULT_NIL_TIER_MULTIPLIERS));
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select conference..." />
              </SelectTrigger>
              <SelectContent>
                {conferenceOptions.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">PTM auto-set to: {programTierMultiplier.toFixed(2)}</p>
          </div>
        </div>

        {/* Budget summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4 pb-4 flex items-center gap-3">
              <BarChart3 className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">{tableTotals.totalOWar.toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">Total WAR</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 flex items-center gap-3">
              <DollarSign className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">${Math.round(totalEffectiveNil).toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Total NIL Used (Actual overrides)</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 flex items-center gap-3">
              <DollarSign className={`h-5 w-5 ${budgetRemaining < 0 ? "text-destructive" : "text-muted-foreground"}`} />
              <div>
                <p className={`text-2xl font-bold ${budgetRemaining < 0 ? "text-destructive" : ""}`}>
                  ${budgetRemaining.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">Budget Remaining (vs NIL used)</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue={initialTab}>
          <div className="flex items-center justify-between gap-2">
            <TabsList>
              <TabsTrigger value="roster">Roster</TabsTrigger>
              <TabsTrigger value="target-board">Target Board</TabsTrigger>
              <TabsTrigger value="depth">Depth Chart</TabsTrigger>
            </TabsList>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setRosterPlayers((prev) =>
                  prev.map((p) => {
                    if ((p.roster_status || "returner") === "leaving") return p;
                    const projectedNil = projectedNilForPlayer(p);
                    return { ...p, nil_value: Math.round(projectedNil) };
                  })
                );
                setDirty(true);
              }}
            >
              Apply Projected NIL
            </Button>
          </div>

          <TabsContent value="roster" className="space-y-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Add Incoming Freshman</CardTitle>
                <CardDescription>Add a player with no projected stats; NIL can still be tracked.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                  <div>
                    <Label className="text-xs mb-1 block">Player Name</Label>
                    <Input
                      value={incomingName}
                      onChange={(e) => setIncomingName(e.target.value)}
                      placeholder="First Last"
                    />
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">Position</Label>
                    <Select value={incomingPosition || "none"} onValueChange={(v) => setIncomingPosition(v === "none" ? "" : v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select position" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {[...POSITION_SLOTS, "TWP"].map((p) => (
                          <SelectItem key={`incoming-${p}`} value={p}>{p}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">Initial NIL ($)</Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={formatWithCommas(incomingNil)}
                      onChange={(e) => setIncomingNil(parseCommaNumber(e.target.value))}
                    />
                  </div>
                  <div>
                    <Button onClick={addIncomingFreshman}>Add To Roster</Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Position Players */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Position Players ({positionPlayers.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Player</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Pos</TableHead>
                      <TableHead>Position Change</TableHead>
                      <TableHead>Class Adj</TableHead>
                      <TableHead>Dev Agg</TableHead>
                      <TableHead>Depth</TableHead>
                      <TableHead className="text-center">pAVG/pOBP/pSLG</TableHead>
                      <TableHead className="text-center">wRC+</TableHead>
                      <TableHead className="text-center">Actual NIL ($)</TableHead>
                      <TableHead className="text-center">Projected NIL ($)</TableHead>
                      <TableHead className="text-center">oWAR</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {positionPlayers.length === 0 ? (
                      <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground py-8">No position players added</TableCell></TableRow>
                    ) : (
                      positionPlayers.map((p, i) => {
                        const globalIdx = rosterPlayers.indexOf(p);
                        return renderPlayerRow(p, i, globalIdx);
                      })
                    )}
                    <TableRow className="bg-muted/40 font-medium">
                      <TableCell colSpan={7} className="text-right align-middle py-2 pr-3 font-semibold">Totals</TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        {tableTotals.avg != null && tableTotals.obp != null && tableTotals.slg != null
                          ? `${tableTotals.avg.toFixed(3)} / ${tableTotals.obp.toFixed(3)} / ${tableTotals.slg.toFixed(3)}`
                          : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        {tableTotals.wrcPlusAvg != null ? tableTotals.wrcPlusAvg.toFixed(0) : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        ${Math.round(tableTotals.totalActualNil).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        ${Math.round(tableTotals.totalProjectedNil).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        {tableTotals.totalOWar.toFixed(2)}
                      </TableCell>
                      <TableCell className="py-2"></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Pitchers */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Pitchers ({pitchers.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Player</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Pos</TableHead>
                      <TableHead>Position Change</TableHead>
                      <TableHead>Class Adj</TableHead>
                      <TableHead>Dev Agg</TableHead>
                      <TableHead>Depth</TableHead>
                      <TableHead className="text-center">pAVG/pOBP/pSLG</TableHead>
                      <TableHead className="text-center">wRC+</TableHead>
                      <TableHead className="text-center">Actual NIL ($)</TableHead>
                      <TableHead className="text-center">Projected NIL ($)</TableHead>
                      <TableHead className="text-center">oWAR</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pitchers.length === 0 ? (
                      <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground py-8">No pitchers added</TableCell></TableRow>
                    ) : (
                      pitchers.map((p, i) => {
                        const globalIdx = rosterPlayers.indexOf(p);
                        return renderPlayerRow(p, i, globalIdx);
                      })
                    )}
                    <TableRow className="bg-muted/40 font-medium">
                      <TableCell colSpan={7} className="text-right align-middle py-2 pr-3 font-semibold">Totals</TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        {tableTotals.avg != null && tableTotals.obp != null && tableTotals.slg != null
                          ? `${tableTotals.avg.toFixed(3)} / ${tableTotals.obp.toFixed(3)} / ${tableTotals.slg.toFixed(3)}`
                          : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        {tableTotals.wrcPlusAvg != null ? tableTotals.wrcPlusAvg.toFixed(0) : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        ${Math.round(tableTotals.totalActualNil).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        ${Math.round(tableTotals.totalProjectedNil).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        {tableTotals.totalOWar.toFixed(2)}
                      </TableCell>
                      <TableCell className="py-2"></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Projected NIL Equation — admin only */}
            {isAdmin && (
              <Card>
                <CardHeader className="pb-3 cursor-pointer select-none" onClick={() => setNilEquationOpen(o => !o)}>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Projected NIL Equation</CardTitle>
                    {nilEquationOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </CardHeader>
                {nilEquationOpen && (
                  <>
                    <CardContent className="pt-0 pb-3 space-y-1">
                      <CardDescription>
                        Player Score = oWAR × PTM × PVF; Projected NIL = Player Score × $/oWAR
                      </CardDescription>
                      <p className="text-xs text-muted-foreground">
                        Team budget is used to track fit: Sum(NIL used for returners + targets) vs Total Budget.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Position Change uses PVF for valuation. Updating Position Change recalculates Player Score and Projected NIL automatically.
                      </p>
                    </CardContent>
                    <CardContent className="flex flex-col gap-3 text-sm md:flex-row md:items-center md:justify-between pt-0">
                      <div className="text-muted-foreground">
                        Total Roster Player Score: <span className="font-mono text-foreground">{totalRosterPlayerScore.toFixed(2)}</span>
                      </div>
                      <div className="text-muted-foreground">
                        NIL Used Total (Returners + Targets): <span className="font-mono text-foreground">${Math.round(totalEffectiveNil).toLocaleString()}</span>
                      </div>
                    </CardContent>
                  </>
                )}
              </Card>
            )}

            {/* Team-Only Power Metrics Upload */}
            <Card>
              <CardHeader className="pb-3 cursor-pointer select-none" onClick={() => setMetricsUploadOpen(o => !o)}>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Team-Only Power Metrics Upload</CardTitle>
                  {metricsUploadOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </div>
              </CardHeader>
              {metricsUploadOpen && (
                <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <input
                    ref={uploadInputRef}
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      try {
                        await applyTeamMetricsCsv(f);
                      } catch (err: any) {
                        toast({ title: "CSV import failed", description: err?.message || "Unable to parse CSV", variant: "destructive" });
                      } finally {
                        e.currentTarget.value = "";
                      }
                    }}
                  />
                  <Button variant="outline" onClick={() => uploadInputRef.current?.click()}>
                    <Upload className="h-4 w-4 mr-1" />
                    Upload Team Metrics CSV
                  </Button>
                  <Button variant="ghost" onClick={downloadTeamMetricsTemplate}>
                    Download Metrics Template
                  </Button>
                  <Button variant="ghost" onClick={downloadPlayerProfileTemplate}>
                    Download Player Profile Template
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Team-build only import. Templates include data fields and examples, not internal formulas or weighting logic.
                  </p>
                </CardContent>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="target-board" className="space-y-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Add Player Target</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="relative">
                  <Input
                    placeholder="Search any player by name, team, or position…"
                    value={targetPlayerSearchQuery}
                    onChange={(e) => { setTargetPlayerSearchQuery(e.target.value); setTargetPlayerSearchOpen(true); }}
                    onFocus={() => setTargetPlayerSearchOpen(true)}
                    onBlur={() => setTimeout(() => setTargetPlayerSearchOpen(false), 150)}
                  />
                  {targetPlayerSearchOpen && filteredTargetPlayerSearch.length > 0 && (
                    <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-72 overflow-auto">
                      {filteredTargetPlayerSearch.map((p) => (
                        <div
                          key={p.id}
                          className="px-3 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground flex justify-between items-center gap-2"
                          onMouseDown={() => addPlayerFromTargetSearch(p)}
                        >
                          <span className="font-medium">{p.first_name} {p.last_name}</span>
                          <span className="text-muted-foreground text-xs">{p.team || "—"} · {p.position || "—"}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {targetPlayerSearchQuery && filteredTargetPlayerSearch.length === 0 && (
                    <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md px-3 py-2 text-sm text-muted-foreground">
                      No players found
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Target Position Players ({targetPositionPlayers.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Player</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Pos</TableHead>
                      <TableHead>Position Change</TableHead>
                      <TableHead>Class Adj</TableHead>
                      <TableHead>Dev Agg</TableHead>
                      <TableHead>Depth</TableHead>
                      <TableHead className="text-center">pAVG/pOBP/pSLG</TableHead>
                      <TableHead className="text-center">wRC+</TableHead>
                      <TableHead className="text-center">Actual NIL ($)</TableHead>
                      <TableHead className="text-center">Projected NIL ($)</TableHead>
                      <TableHead className="text-center">oWAR</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {targetPositionPlayers.length === 0 ? (
                      <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground py-8">No target position players</TableCell></TableRow>
                    ) : (
                      targetPositionPlayers.map((p, i) => {
                        const globalIdx = rosterPlayers.indexOf(p);
                        return renderPlayerRow(p, i, globalIdx);
                      })
                    )}
                    <TableRow className="bg-muted/40 font-medium">
                      <TableCell colSpan={7} className="text-right align-middle py-2 pr-3 font-semibold">Totals</TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        {targetTableTotals.avg != null && targetTableTotals.obp != null && targetTableTotals.slg != null
                          ? `${targetTableTotals.avg.toFixed(3)} / ${targetTableTotals.obp.toFixed(3)} / ${targetTableTotals.slg.toFixed(3)}`
                          : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        {targetTableTotals.wrcPlusAvg != null ? targetTableTotals.wrcPlusAvg.toFixed(0) : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        ${Math.round(targetTableTotals.totalActualNil).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        ${Math.round(targetTableTotals.totalProjectedNil).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        {targetTableTotals.totalOWar.toFixed(2)}
                      </TableCell>
                      <TableCell className="py-2"></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Target Pitchers ({targetPitchers.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Player</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Pos</TableHead>
                      <TableHead>Position Change</TableHead>
                      <TableHead>Class Adj</TableHead>
                      <TableHead>Dev Agg</TableHead>
                      <TableHead>Depth</TableHead>
                      <TableHead className="text-center">pAVG/pOBP/pSLG</TableHead>
                      <TableHead className="text-center">wRC+</TableHead>
                      <TableHead className="text-center">Actual NIL ($)</TableHead>
                      <TableHead className="text-center">Projected NIL ($)</TableHead>
                      <TableHead className="text-center">oWAR</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {targetPitchers.length === 0 ? (
                      <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground py-8">No target pitchers</TableCell></TableRow>
                    ) : (
                      targetPitchers.map((p, i) => {
                        const globalIdx = rosterPlayers.indexOf(p);
                        return renderPlayerRow(p, i, globalIdx);
                      })
                    )}
                    <TableRow className="bg-muted/40 font-medium">
                      <TableCell colSpan={7} className="text-right align-middle py-2 pr-3 font-semibold">Totals</TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        {targetTableTotals.avg != null && targetTableTotals.obp != null && targetTableTotals.slg != null
                          ? `${targetTableTotals.avg.toFixed(3)} / ${targetTableTotals.obp.toFixed(3)} / ${targetTableTotals.slg.toFixed(3)}`
                          : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        {targetTableTotals.wrcPlusAvg != null ? targetTableTotals.wrcPlusAvg.toFixed(0) : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        ${Math.round(targetTableTotals.totalActualNil).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        ${Math.round(targetTableTotals.totalProjectedNil).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        {targetTableTotals.totalOWar.toFixed(2)}
                      </TableCell>
                      <TableCell className="py-2"></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Compare tab hidden — functionality moved to /dashboard/compare */}
          <TabsContent value="compare" className="hidden">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Compare A</CardTitle>
                  <CardDescription>Run Transfer Portal simulation inputs in a standalone panel.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="relative">
                    <Label className="text-xs mb-1 block">Player</Label>
                    <Input
                      placeholder="Search player by name, team, or position…"
                      value={compareAPlayerSearch}
                      onChange={(e) => {
                        setCompareAPlayerSearch(e.target.value);
                        setCompareAPlayerOpen(true);
                      }}
                      onFocus={() => setCompareAPlayerOpen(true)}
                      onBlur={() => setTimeout(() => setCompareAPlayerOpen(false), 150)}
                    />
                    {compareAPlayerOpen && filteredCompareAPlayers.length > 0 && (
                      <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-72 overflow-auto">
                        {filteredCompareAPlayers.map((p) => (
                          <div
                            key={`compare-a-${p.id}`}
                            className="px-3 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground flex justify-between items-center gap-2"
                            onMouseDown={() => {
                              setCompareAPlayerId(p.id);
                              setCompareAPlayerSearch(`${p.first_name} ${p.last_name}`);
                              setCompareAPlayerOpen(false);
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
                      value={compareATeamSearch}
                      onChange={(e) => {
                        setCompareATeamSearch(e.target.value);
                        setCompareATeamOpen(true);
                      }}
                      onFocus={() => setCompareATeamOpen(true)}
                      onBlur={() => setTimeout(() => setCompareATeamOpen(false), 150)}
                    />
                    {compareATeamOpen && filteredCompareATeams.length > 0 && (
                      <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-72 overflow-auto">
                        {filteredCompareATeams.map((t) => (
                          <div
                            key={`compare-a-team-${t.name}`}
                            className="px-3 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground"
                            onMouseDown={() => {
                              setCompareADestinationTeam(t.name);
                              setCompareATeamSearch(t.name);
                              setCompareATeamOpen(false);
                            }}
                          >
                            {t.name} {t.conference ? `· ${t.conference}` : ""}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {compareAPlayer?.id && (
                    <div className="text-xs text-muted-foreground">
                      Selected:{" "}
                      <Link
                        className="underline underline-offset-2 text-primary"
                        to={profileRouteFor(compareAPlayer.id, compareAPlayer.position ?? null)}
                      >
                        {compareAPlayer.first_name} {compareAPlayer.last_name}
                      </Link>
                    </div>
                  )}

                  {compareASimulation ? (
                    <div className="space-y-3">
                      <div className="rounded-md border p-3 bg-muted/20">
                        <p className="text-xs font-medium mb-2">Context + Multipliers Used</p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          <div>From Team</div><div className="font-mono text-right">{compareASimulation.fromTeam || "—"}</div>
                          <div>From Conference</div><div className="font-mono text-right">{compareASimulation.fromConference || "—"}</div>
                          <div>To Conference</div><div className="font-mono text-right">{compareASimulation.toConference || "—"}</div>
                          <div>From Park Factor</div><div className="font-mono text-right">{compareASimulation.fromPark ?? "—"}</div>
                          <div>To Park Factor</div><div className="font-mono text-right">{compareASimulation.toPark ?? "—"}</div>
                          <div>AVG+ Delta</div><div className="font-mono text-right">{compareASimulation.fromAvgPlus} → {compareASimulation.toAvgPlus}</div>
                          <div>OBP+ Delta</div><div className="font-mono text-right">{compareASimulation.fromObpPlus} → {compareASimulation.toObpPlus}</div>
                          <div>ISO+ Delta</div><div className="font-mono text-right">{compareASimulation.fromIsoPlus} → {compareASimulation.toIsoPlus}</div>
                          <div>Stuff+ Delta</div><div className="font-mono text-right">{compareASimulation.fromStuff} → {compareASimulation.toStuff}</div>
                        </div>
                      </div>

                      <div className="rounded-md border p-3">
                        <p className="text-xs font-medium mb-2">Projected Outcomes</p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          <div>pAVG / pOBP / pSLG</div>
                          <div className="font-mono text-right">
                            {compareASimulation.pAvg?.toFixed(3) ?? "—"} / {compareASimulation.pObp?.toFixed(3) ?? "—"} / {compareASimulation.pSlg?.toFixed(3) ?? "—"}
                          </div>
                          <div>pOPS</div><div className="font-mono text-right">{compareASimulation.pOps?.toFixed(3) ?? "—"}</div>
                          <div>pISO</div><div className="font-mono text-right">{compareASimulation.pIso?.toFixed(3) ?? "—"}</div>
                          <div>pWRC+</div><div className="font-mono text-right">{compareASimulation.pWrcPlus?.toFixed(0) ?? "—"}</div>
                          <div>oWAR</div><div className="font-mono text-right">{compareASimulation.owar?.toFixed(2) ?? "—"}</div>
                          <div>Projected NIL</div><div className="font-mono text-right">{compareASimulation.nilValuation != null ? `$${Math.round(compareASimulation.nilValuation).toLocaleString()}` : "—"}</div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                      Select player and destination team to run comparison panel A.
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Compare B</CardTitle>
                  <CardDescription>Independent panel. You can select the same player as Compare A.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="relative">
                    <Label className="text-xs mb-1 block">Player</Label>
                    <Input
                      placeholder="Search player by name, team, or position…"
                      value={compareBPlayerSearch}
                      onChange={(e) => {
                        setCompareBPlayerSearch(e.target.value);
                        setCompareBPlayerOpen(true);
                      }}
                      onFocus={() => setCompareBPlayerOpen(true)}
                      onBlur={() => setTimeout(() => setCompareBPlayerOpen(false), 150)}
                    />
                    {compareBPlayerOpen && filteredCompareBPlayers.length > 0 && (
                      <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-72 overflow-auto">
                        {filteredCompareBPlayers.map((p) => (
                          <div
                            key={`compare-b-${p.id}`}
                            className="px-3 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground flex justify-between items-center gap-2"
                            onMouseDown={() => {
                              setCompareBPlayerId(p.id);
                              setCompareBPlayerSearch(`${p.first_name} ${p.last_name}`);
                              setCompareBPlayerOpen(false);
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
                      value={compareBTeamSearch}
                      onChange={(e) => {
                        setCompareBTeamSearch(e.target.value);
                        setCompareBTeamOpen(true);
                      }}
                      onFocus={() => setCompareBTeamOpen(true)}
                      onBlur={() => setTimeout(() => setCompareBTeamOpen(false), 150)}
                    />
                    {compareBTeamOpen && filteredCompareBTeams.length > 0 && (
                      <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-72 overflow-auto">
                        {filteredCompareBTeams.map((t) => (
                          <div
                            key={`compare-b-team-${t.name}`}
                            className="px-3 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground"
                            onMouseDown={() => {
                              setCompareBDestinationTeam(t.name);
                              setCompareBTeamSearch(t.name);
                              setCompareBTeamOpen(false);
                            }}
                          >
                            {t.name} {t.conference ? `· ${t.conference}` : ""}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {compareBPlayer?.id && (
                    <div className="text-xs text-muted-foreground">
                      Selected:{" "}
                      <Link
                        className="underline underline-offset-2 text-primary"
                        to={profileRouteFor(compareBPlayer.id, compareBPlayer.position ?? null)}
                      >
                        {compareBPlayer.first_name} {compareBPlayer.last_name}
                      </Link>
                    </div>
                  )}

                  {compareBSimulation ? (
                    <div className="space-y-3">
                      <div className="rounded-md border p-3 bg-muted/20">
                        <p className="text-xs font-medium mb-2">Context + Multipliers Used</p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          <div>From Team</div><div className="font-mono text-right">{compareBSimulation.fromTeam || "—"}</div>
                          <div>From Conference</div><div className="font-mono text-right">{compareBSimulation.fromConference || "—"}</div>
                          <div>To Conference</div><div className="font-mono text-right">{compareBSimulation.toConference || "—"}</div>
                          <div>From Park Factor</div><div className="font-mono text-right">{compareBSimulation.fromPark ?? "—"}</div>
                          <div>To Park Factor</div><div className="font-mono text-right">{compareBSimulation.toPark ?? "—"}</div>
                          <div>AVG+ Delta</div><div className="font-mono text-right">{compareBSimulation.fromAvgPlus} → {compareBSimulation.toAvgPlus}</div>
                          <div>OBP+ Delta</div><div className="font-mono text-right">{compareBSimulation.fromObpPlus} → {compareBSimulation.toObpPlus}</div>
                          <div>ISO+ Delta</div><div className="font-mono text-right">{compareBSimulation.fromIsoPlus} → {compareBSimulation.toIsoPlus}</div>
                          <div>Stuff+ Delta</div><div className="font-mono text-right">{compareBSimulation.fromStuff} → {compareBSimulation.toStuff}</div>
                        </div>
                      </div>

                      <div className="rounded-md border p-3">
                        <p className="text-xs font-medium mb-2">Projected Outcomes</p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          <div>pAVG / pOBP / pSLG</div>
                          <div className="font-mono text-right">
                            {compareBSimulation.pAvg?.toFixed(3) ?? "—"} / {compareBSimulation.pObp?.toFixed(3) ?? "—"} / {compareBSimulation.pSlg?.toFixed(3) ?? "—"}
                          </div>
                          <div>pOPS</div><div className="font-mono text-right">{compareBSimulation.pOps?.toFixed(3) ?? "—"}</div>
                          <div>pISO</div><div className="font-mono text-right">{compareBSimulation.pIso?.toFixed(3) ?? "—"}</div>
                          <div>pWRC+</div><div className="font-mono text-right">{compareBSimulation.pWrcPlus?.toFixed(0) ?? "—"}</div>
                          <div>oWAR</div><div className="font-mono text-right">{compareBSimulation.owar?.toFixed(2) ?? "—"}</div>
                          <div>Projected NIL</div><div className="font-mono text-right">{compareBSimulation.nilValuation != null ? `$${Math.round(compareBSimulation.nilValuation).toLocaleString()}` : "—"}</div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                      Select player and destination team to run comparison panel B.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="depth">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Depth Chart Board</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="mx-auto relative h-[780px] w-full max-w-[980px] overflow-hidden rounded-xl border border-slate-400 bg-[#e5e5e5]">
                  <svg className="absolute inset-0 h-full w-full" viewBox="0 0 980 760" preserveAspectRatio="none">
                    <path
                      d="M90 210 Q490 -180 890 210 L490 610 Z
                         M350 470 L490 330 L630 470 L490 610 Z"
                      fill="#f2f2f2"
                      fillRule="evenodd"
                    />
                    <path d="M90 210 Q490 -180 890 210" fill="none" stroke="#525252" strokeWidth="2" />
                    <line x1="490" y1="610" x2="90" y2="210" stroke="#525252" strokeWidth="2" />
                    <line x1="490" y1="610" x2="890" y2="210" stroke="#525252" strokeWidth="2" />

                    <path d="M350 470 L490 330 L630 470 L490 610 Z" fill="#d1d5db" stroke="#4b5563" strokeWidth="2" />
                    <path d="M264 384 L272 392 Q490 100 708 392 L716 384" fill="none" stroke="#4b5563" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <line x1="490" y1="610" x2="390" y2="510" stroke="#4b5563" strokeWidth="1.5" />
                    <line x1="490" y1="610" x2="590" y2="510" stroke="#4b5563" strokeWidth="1.5" />

                    <circle cx="490" cy="470" r="26" fill="#f2f2f2" stroke="#6b7280" strokeWidth="1.5" />
                    <rect x="484" y="467" width="12" height="6" rx="1.5" fill="#9ca3af" />
                    <circle cx="490" cy="620" r="38" fill="#f2f2f2" stroke="#6b7280" strokeWidth="1.5" />
                    <polygon points="490,624 500,616 500,604 480,604 480,616" fill="#ffffff" stroke="#6b7280" strokeWidth="1.5" />
                  </svg>

                  {renderDepthStack("CF", eligiblePositionPlayers, "left-[50%] top-[58px]")}
                  {renderDepthStack("LF", eligiblePositionPlayers, "left-[28%] top-[152px]")}
                  {renderDepthStack("RF", eligiblePositionPlayers, "left-[72%] top-[152px]")}

                  {renderDepthStack("SS", eligiblePositionPlayers, "left-[39%] top-[272px]")}
                  {renderDepthStack("2B", eligiblePositionPlayers, "left-[61%] top-[272px]")}
                  {renderDepthStack("3B", eligiblePositionPlayers, "left-[30%] top-[434px]")}
                  {renderDepthStack("1B", eligiblePositionPlayers, "left-[70%] top-[434px]")}
                  {renderDepthStack("C", eligiblePositionPlayers, "left-[50%] top-[654px]")}

                  {renderDepthStack("DH", eligiblePositionPlayers, "left-[66%] top-[606px]")}

                  {renderStartingRotationStack(eligiblePitchers, "left-[10%] top-[490px]")}

                  {renderRelieversStack(eligiblePitchers, "left-[90%] top-[456px]")}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Delete build */}
        {selectedBuildId && (
          <div className="flex justify-end">
            <Button variant="destructive" size="sm" onClick={() => deleteBuildMutation.mutate(selectedBuildId)}>
              <Trash2 className="h-4 w-4 mr-1" /> Delete Build
            </Button>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
