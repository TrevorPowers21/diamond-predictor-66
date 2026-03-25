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
import exitPositions2025Seed from "@/data/exit_positions_2025_seed.json";
import powerRatings2025Seed from "@/data/power_ratings_2025_seed.json";
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
import { readPlayerOverrides, updatePlayerOverride } from "@/lib/playerOverrides";
import { readTeamParkFactorComponents, resolveMetricParkFactor } from "@/lib/parkFactors";
import { readPitchingWeights } from "@/lib/pitchingEquations";

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
  pitcherRole?: "SP" | "RP" | null;
  pAvg: number | null;
  pObp: number | null;
  pSlg: number | null;
  pWrcPlus: number | null;
  pEra?: number | null;
  pFip?: number | null;
  pWhip?: number | null;
  pK9?: number | null;
  pBb9?: number | null;
  pHr9?: number | null;
  pRvPlus?: number | null;
  pWar?: number | null;
  owar: number | null;
  nilValuation: number | null;
  createdAt: string;
};

type TransferSnapshot = {
  p_avg: number | null;
  p_obp: number | null;
  p_slg: number | null;
  p_wrc_plus: number | null;
  p_era?: number | null;
  p_fip?: number | null;
  p_whip?: number | null;
  p_k9?: number | null;
  p_bb9?: number | null;
  p_hr9?: number | null;
  p_rv_plus?: number | null;
  p_war?: number | null;
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
  depth_role?: "starter" | "utility" | "bench" | "weekend_starter" | "weekday_starter" | "high_leverage_reliever" | "low_impact_reliever";
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
    p_era?: number | null;
    p_fip?: number | null;
    p_whip?: number | null;
    p_k9?: number | null;
    p_bb9?: number | null;
    p_hr9?: number | null;
    p_rv_plus?: number | null;
    p_war?: number | null;
    nil_valuation?: number | null;
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
  p_era?: number | null;
  p_fip?: number | null;
  p_whip?: number | null;
  p_k9?: number | null;
  p_bb9?: number | null;
  p_hr9?: number | null;
  p_rv_plus?: number | null;
  p_war?: number | null;
  nil_valuation?: number | null;
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
const isUuid = (value: string | null | undefined) =>
  !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value).trim());
const teamNameVariants = (team: string | null | undefined) => {
  const base = (team || "").trim();
  if (!base) return [] as string[];
  const out = new Set<string>([base]);
  const lower = base.toLowerCase();
  if (lower.endsWith(" university")) out.add(base.replace(/\s+university$/i, "").trim());
  else out.add(`${base} University`);
  if (lower.startsWith("university of ")) out.add(base.replace(/^university of\s+/i, "").trim());
  else out.add(`University of ${base}`.trim());
  if (lower === "west virginia") out.add("West Virginia University");
  if (lower === "west virginia university") out.add("West Virginia");
  if (lower === "west virginia" || lower === "west virginia university" || lower === "wvu") {
    out.add("WVU");
    out.add("West Virginia");
    out.add("West Virginia University");
  }
  return Array.from(out).filter(Boolean);
};

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

const readStoragePitcherLocalPlayers = (
  teamName: string | null | undefined,
): Array<{
  first_name: string;
  last_name: string;
  position: string | null;
  team: string | null;
  from_team: string | null;
  conference: string | null;
  role: "SP" | "RP" | null;
}> => {
  if (!teamName || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem("pitching_stats_storage_2025_v1");
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { rows?: Array<{ values?: string[] }> };
    const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
    const teamKey = normalizeName(teamName);
    const out: Array<{
      first_name: string;
      last_name: string;
      position: string | null;
      team: string | null;
      from_team: string | null;
      conference: string | null;
      role: "SP" | "RP" | null;
    }> = [];
    for (const row of rows) {
      const values = Array.isArray(row?.values) ? row.values : [];
      const playerName = (values[0] || "").trim();
      const rowTeam = (values[1] || "").trim();
      if (!playerName || !rowTeam) continue;
      if (normalizeName(rowTeam) !== teamKey) continue;
      const hand = (values[2] || "").trim().toUpperCase();
      const roleRaw = (values[3] || "").trim().toUpperCase();
      const role: "SP" | "RP" | null = roleRaw === "SP" || roleRaw === "RP" ? roleRaw : null;
      const position = hand === "RHP" || hand === "LHP" ? hand : (role || "P");
      const split = splitFullName(playerName);
      out.push({
        first_name: split.first,
        last_name: split.last,
        position,
        team: rowTeam,
        from_team: null,
        conference: null,
        role,
      });
    }
    return out;
  } catch {
    return [];
  }
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
  depthRole: "starter" | "utility" | "bench" | "weekend_starter" | "weekday_starter" | "high_leverage_reliever" | "low_impact_reliever" | null;
  classTransition: string | null;
  devAggressiveness: number | null;
  transferSnapshot: TransferSnapshot | null;
  localPlayer: { first_name: string; last_name: string; position: string | null; team: string | null; from_team: string | null; conference: string | null } | null;
} => {
  if (!raw) return { notes: null, metrics: null, power: null, rosterStatus: null, depthRole: null, classTransition: null, devAggressiveness: null, transferSnapshot: null, localPlayer: null };
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
          obj.depthRole === "starter" ||
          obj.depthRole === "utility" ||
          obj.depthRole === "bench" ||
          obj.depthRole === "weekend_starter" ||
          obj.depthRole === "weekday_starter" ||
          obj.depthRole === "high_leverage_reliever" ||
          obj.depthRole === "low_impact_reliever"
            ? obj.depthRole
            : null,
        classTransition: typeof obj.classTransition === "string" ? obj.classTransition : null,
        devAggressiveness: Number.isFinite(Number(obj.devAggressiveness)) ? Number(obj.devAggressiveness) : null,
        transferSnapshot: (obj.transferSnapshot ?? null) as TransferSnapshot | null,
        localPlayer:
          obj.localPlayer && typeof obj.localPlayer === "object"
            ? {
                first_name: String(obj.localPlayer.first_name || ""),
                last_name: String(obj.localPlayer.last_name || ""),
                position: obj.localPlayer.position != null ? String(obj.localPlayer.position) : null,
                team: obj.localPlayer.team != null ? String(obj.localPlayer.team) : null,
                from_team: obj.localPlayer.from_team != null ? String(obj.localPlayer.from_team) : null,
                conference: obj.localPlayer.conference != null ? String(obj.localPlayer.conference) : null,
              }
            : null,
      };
    }
  } catch {
    // legacy free-text note
  }
  return { notes: raw, metrics: null, power: null, rosterStatus: null, depthRole: null, classTransition: null, devAggressiveness: null, transferSnapshot: null, localPlayer: null };
};

const serializeBuildPlayerMeta = (
  notes: string | null,
  metrics: TeamMetricInputs | null,
  power: TeamPowerPlus | null,
  rosterStatus: "returner" | "leaving" | "target" | null | undefined,
  depthRole: "starter" | "utility" | "bench" | "weekend_starter" | "weekday_starter" | "high_leverage_reliever" | "low_impact_reliever" | null | undefined,
  classTransition: string | null | undefined,
  devAggressiveness: number | null | undefined,
  transferSnapshot: TransferSnapshot | null | undefined,
  localPlayer: { first_name: string; last_name: string; position: string | null; team: string | null; from_team: string | null; conference: string | null } | null | undefined,
) => {
  if (!notes && !metrics && !power && !rosterStatus && !depthRole && !classTransition && devAggressiveness == null && !transferSnapshot && !localPlayer) return null;
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
    localPlayer: localPlayer ?? null,
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
  if (role === "low_impact_reliever") return 0.3;
  if (role === "high_leverage_reliever") return 0.6;
  if (role === "weekday_starter") return 0.8;
  if (role === "weekend_starter") return 1.0;
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

const normalizePitcherRole = (raw: string | null | undefined): "SP" | "RP" => {
  const v = String(raw || "").toUpperCase();
  return v.startsWith("SP") ? "SP" : "RP";
};
const asPitcherRole = (raw: string | null | undefined): "SP" | "RP" | null => {
  const v = String(raw || "").toUpperCase();
  if (v.startsWith("SP")) return "SP";
  if (v.startsWith("RP")) return "RP";
  return null;
};

const normalizePitcherDepthRole = (
  role: BuildPlayer["depth_role"],
  pitcherRole: "SP" | "RP",
): "weekend_starter" | "weekday_starter" | "high_leverage_reliever" | "low_impact_reliever" => {
  if (role === "weekend_starter" || role === "weekday_starter" || role === "high_leverage_reliever" || role === "low_impact_reliever") return role;
  if (role === "starter") return "weekend_starter";
  if (role === "utility") return pitcherRole === "SP" ? "weekday_starter" : "high_leverage_reliever";
  if (role === "bench") return "low_impact_reliever";
  return pitcherRole === "SP" ? "weekend_starter" : "high_leverage_reliever";
};

const storagePitcherRouteFor = (playerName: string, teamName: string | null | undefined) => {
  const nameEnc = encodeURIComponent((playerName || "").trim());
  const teamEnc = encodeURIComponent((teamName || "").trim());
  return `/dashboard/pitcher/storage__${nameEnc}__${teamEnc}`;
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
const parseBaseballInnings = (raw: string | null | undefined): number | null => {
  if (raw == null) return null;
  const s = String(raw).trim();
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
  const legacyEra = parseNum(values[3]);
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
const toPitchingRole = (raw: string | null | undefined): "SP" | "RP" | "SM" | null => {
  const v = String(raw || "").trim().toUpperCase();
  if (v === "SP" || v === "RP" || v === "SM") return v;
  return null;
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
  ) return null;
  const zShift = ((prPlus - 100) / prSd) * ncaaSd;
  const powerAdjusted = lowerIsBetter ? (ncaaAvg - zShift) : (ncaaAvg + zShift);
  const blended = (lastStat * (1 - 0.7)) + (powerAdjusted * 0.7);
  const mult = lowerIsBetter
    ? (1 - classAdjustment - (devAggressiveness * 0.06))
    : (1 + classAdjustment + (devAggressiveness * 0.06));
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
  if (lowerIsBetter) return step > 0 ? value / factor : value * factor;
  return step > 0 ? value * factor : value / factor;
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
  const pitchingEq = useMemo(() => readPitchingWeights(), []);
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
  const autoSeededTeamRef = useRef<string>("");
  const playerOverrides = useMemo(() => readPlayerOverrides(), [rosterPlayers.length]);

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
          .select("id, first_name, last_name, position, team, from_team, conference, player_predictions(id, p_avg, p_obp, p_slg, p_ops, p_wrc_plus, p_era, p_fip, p_whip, p_k9, p_bb9, p_hr9, p_rv_plus, p_war, power_rating_plus, class_transition, dev_aggressiveness, model_type, status, variant), nil_valuations(estimated_value, component_breakdown)")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        all = all.concat(data || []);
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }
      return all.filter((p) => p.first_name && p.last_name);
    },
  });
  const storagePitchersForSearch = useMemo(() => {
    const teamConfByKey = new Map<string, string | null>();
    for (const t of teams as TeamRow[]) {
      teamConfByKey.set(normalizeKey(t.name), t.conference || null);
    }
    try {
      const raw = localStorage.getItem("pitching_stats_storage_2025_v1");
      if (!raw) return [] as any[];
      const parsed = JSON.parse(raw) as { rows?: Array<{ values?: string[] }> };
      const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
      return rows
        .map((r, idx) => {
          const values = Array.isArray(r.values) ? r.values : [];
          const playerName = (values[0] || "").trim();
          const teamName = (values[1] || "").trim();
          if (!playerName) return null;
          const split = splitFullName(playerName);
          const statsView = resolvePitchingStatsView(values);
          const roleRaw = toPitchingRole(statsView.role);
          const g = parseNum(statsView.g);
          const gs = parseNum(statsView.gs);
          const role = roleRaw || (g != null && g > 0 && gs != null ? ((gs / g) < 0.5 ? "RP" : "SP") : "RP");
          return {
            id: `storage-pitcher-${normalizeName(playerName)}-${normalizeName(teamName)}-${idx}`,
            first_name: split.first,
            last_name: split.last,
            position: role,
            team: teamName || null,
            from_team: teamName || null,
            conference: teamConfByKey.get(normalizeKey(teamName || "")) || null,
            __storagePitcher: true,
            __pitching: {
              role,
              p_era: null as number | null,
              p_fip: null as number | null,
              p_whip: null as number | null,
              p_k9: null as number | null,
              p_bb9: null as number | null,
              p_hr9: null as number | null,
              p_rv_plus: null as number | null,
              p_war: null as number | null,
            },
          };
        })
        .filter(Boolean) as any[];
    } catch {
      return [] as any[];
    }
  }, [teams]);
  const seedHittersForSearch = useMemo(() => {
    const teamConfByKey = new Map<string, string | null>();
    for (const t of teams as TeamRow[]) {
      teamConfByKey.set(normalizeKey(t.name), t.conference || null);
    }
    const rows = (storage2025Seed as SeedRow[]) || [];
    const powerByNameTeam = new Map<string, TeamMetricInputs>();
    const powerRows = (powerRatings2025Seed as Array<any>) || [];
    for (const pr of powerRows) {
      const key = `${normalizeName(pr?.playerName || "")}|${normalizeName(pr?.team || "")}`;
      if (!key || key === "|") continue;
      powerByNameTeam.set(key, {
        contact: parseNum(pr?.contact),
        lineDrive: parseNum(pr?.lineDrive),
        avgExitVelo: parseNum(pr?.avgExitVelo),
        popUp: parseNum(pr?.popUp),
        bb: parseNum(pr?.bb),
        chase: parseNum(pr?.chase),
        barrel: parseNum(pr?.barrel),
        ev90: parseNum(pr?.ev90),
        pull: parseNum(pr?.pull),
        la10_30: parseNum(pr?.la10_30),
        gb: parseNum(pr?.gb),
      });
    }
    const out: any[] = [];
    const posMap = exitPositions2025Seed as Record<string, string>;
    for (let idx = 0; idx < rows.length; idx += 1) {
      const r = rows[idx];
      const playerName = (r.playerName || "").trim();
      const teamName = (r.team || "").trim();
      if (!playerName || !teamName) continue;
      const split = splitFullName(playerName);
      const posKey = `${playerName}|${teamName}`;
      const position = posMap[posKey] || posMap[playerName] || null;
      const seedMetrics = powerByNameTeam.get(`${normalizeName(playerName)}|${normalizeName(teamName)}`) || null;
      const seedPowerPlus = seedMetrics ? computeTeamPowerPlus(seedMetrics) : null;
      out.push({
        id: `seed-hitter-${normalizeName(playerName)}-${normalizeName(teamName)}-${idx}`,
        first_name: split.first,
        last_name: split.last,
        position,
        team: teamName,
        from_team: teamName,
        conference: teamConfByKey.get(normalizeKey(teamName)) || null,
        __seedHitter: true,
        __seedStats: {
          avg: r.avg ?? null,
          obp: r.obp ?? null,
          slg: r.slg ?? null,
        },
        __seedPowerPlus: seedPowerPlus,
      });
    }
    return out;
  }, [teams]);
  const combinedTargetSearchPlayers = useMemo(() => {
    const byKey = new Map<string, any>();
    const primaryKeyByNameTeam = new Map<string, string>();
    const isPitchLike = (p: any) => /^(SP|RP|CL|P|LHP|RHP)/i.test(String(p?.position || ""));
    const idKeyOf = (p: any) => (p?.id ? `id:${String(p.id).trim()}` : "");
    const nameTeamKeyOf = (p: any) => `${normalizeName(`${p.first_name} ${p.last_name}`)}|${normalizeName(p.team || "")}`;

    for (const p of allPlayersForSearch) {
      const idKey = idKeyOf(p);
      if (idKey) {
        byKey.set(idKey, p);
        const nt = nameTeamKeyOf(p);
        if (nt && !primaryKeyByNameTeam.has(nt)) primaryKeyByNameTeam.set(nt, idKey);
      } else {
        const key = `local:${nameTeamKeyOf(p)}:${normalizeName(p.position || "")}`;
        byKey.set(key, p);
        const nt = nameTeamKeyOf(p);
        if (nt && !primaryKeyByNameTeam.has(nt)) primaryKeyByNameTeam.set(nt, key);
      }
    }
    for (const sp of storagePitchersForSearch) {
      const nt = nameTeamKeyOf(sp);
      const existingPrimary = nt ? primaryKeyByNameTeam.get(nt) : undefined;
      const existing = existingPrimary ? byKey.get(existingPrimary) : null;
      if (!existing) {
        const key = `storage:${nt}:${normalizeName(sp.position || "")}`;
        byKey.set(key, sp);
        if (nt) primaryKeyByNameTeam.set(nt, key);
        continue;
      }
      // Prefer storage pitcher entry when DB duplicate is not clearly pitcher-typed.
      if (!isPitchLike(existing) || existing.__storagePitcher) {
        if (existingPrimary) {
          byKey.set(existingPrimary, sp);
        }
      }
    }
    for (const sh of seedHittersForSearch) {
      const nt = nameTeamKeyOf(sh);
      if (nt && primaryKeyByNameTeam.has(nt)) continue;
      const key = `seed:${nt}:${normalizeName(sh.position || "")}`;
      byKey.set(key, sh);
      if (nt) primaryKeyByNameTeam.set(nt, key);
    }
    return Array.from(byKey.values());
  }, [allPlayersForSearch, storagePitchersForSearch, seedHittersForSearch]);
  const targetSearchIndex = useMemo(() => {
    return combinedTargetSearchPlayers.map((p) => {
      const fullName = normalizeName(`${p.first_name || ""} ${p.last_name || ""}`);
      const team = normalizeName(p.team || "");
      const position = normalizeName(p.position || "");
      return {
        p,
        fullName,
        team,
        position,
        hay: `${fullName} ${team} ${position}`.trim(),
      };
    });
  }, [combinedTargetSearchPlayers]);
  const allPlayersByIdForHydration = useMemo(() => {
    const map = new Map<string, any>();
    for (const p of allPlayersForSearch) {
      if (p?.id) map.set(String(p.id).trim(), p);
    }
    return map;
  }, [allPlayersForSearch]);

  useEffect(() => {
    if (!allPlayersByIdForHydration.size) return;
    const toNum = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const isPitcherLike = (p: any) => /^(SP|RP|CL|P|LHP|RHP)/i.test(String(p?.position || ""));
    const scorePitchingFingerprint = (snap: TransferSnapshot, pred: any) => {
      const pairs: Array<[number | null, number | null, number]> = [
        [toNum(snap.p_era), toNum(pred?.p_era), 1.0],
        [toNum(snap.p_fip), toNum(pred?.p_fip), 1.0],
        [toNum(snap.p_whip), toNum(pred?.p_whip), 0.7],
        [toNum(snap.p_k9), toNum(pred?.p_k9), 0.35],
        [toNum(snap.p_bb9), toNum(pred?.p_bb9), 0.45],
        [toNum(snap.p_hr9), toNum(pred?.p_hr9), 0.65],
        [toNum(snap.p_rv_plus), toNum(pred?.p_rv_plus), 0.05],
        [toNum(snap.p_war), toNum(pred?.p_war), 0.25],
      ];
      let score = 0;
      let used = 0;
      for (const [a, b, w] of pairs) {
        if (a == null || b == null) continue;
        score += Math.abs(a - b) * w;
        used += 1;
      }
      if (used === 0) return Number.POSITIVE_INFINITY;
      return score;
    };

    setRosterPlayers((prev) => {
      let changed = false;
      const next = prev.map((p) => {
        if (p.player && `${p.player.first_name || ""} ${p.player.last_name || ""}`.trim()) return p;
        const rawId = typeof p.player_id === "string" ? p.player_id.trim() : "";
        let hit = rawId ? allPlayersByIdForHydration.get(rawId) : null;
        if (!hit && p.source === "portal" && p.transfer_snapshot) {
          const fromKey = normalizeName(p.transfer_snapshot.from_team || "");
          const candidates = allPlayersForSearch
            .filter((r: any) => isPitcherLike(r))
            .filter((r: any) => {
              if (!fromKey) return true;
              const cFrom = normalizeName(r.from_team || r.team || "");
              return !!cFrom && cFrom === fromKey;
            });
          let best: any = null;
          let bestScore = Number.POSITIVE_INFINITY;
          let second = Number.POSITIVE_INFINITY;
          for (const c of candidates) {
            const pred = selectTransferPortalPreferredPrediction((c.player_predictions || []).filter((pr: any) => pr.variant === "regular"));
            if (!pred) continue;
            const s = scorePitchingFingerprint(p.transfer_snapshot, pred);
            if (!Number.isFinite(s)) continue;
            if (s < bestScore) {
              second = bestScore;
              bestScore = s;
              best = c;
            } else if (s < second) {
              second = s;
            }
          }
          const unambiguous = best && (bestScore < 0.35 || (second - bestScore) > 0.25);
          if (unambiguous) hit = best;
        }
        if (!hit) return p;
        changed = true;
        const hydratedName = `${hit.first_name || ""} ${hit.last_name || ""}`.trim();
        return {
          ...p,
          custom_name: (p.custom_name && p.custom_name.trim()) || hydratedName || p.custom_name,
          player: {
            first_name: hit.first_name || "",
            last_name: hit.last_name || "",
            position: hit.position || null,
            team: hit.team || null,
            from_team: hit.from_team || null,
            conference: hit.conference || null,
          },
        };
      });
      return changed ? next : prev;
    });
  }, [allPlayersByIdForHydration]);

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
    const terms = q.split(" ").filter(Boolean);
    const scoreFor = (row: { fullName: string; team: string; position: string; hay: string }) => {
      let score = 0;
      if (row.fullName === q) score += 500;
      if (row.fullName.startsWith(q)) score += 250;
      if (row.team.startsWith(q)) score += 100;
      if (row.position.startsWith(q)) score += 40;
      if (row.hay.includes(q)) score += 20;
      return score;
    };
    return targetSearchIndex
      .filter((row) => terms.every((t) => row.hay.includes(t)))
      .sort((a, b) => scoreFor(b) - scoreFor(a))
      .map((row) => row.p)
      .slice(0, 100);
  }, [targetSearchIndex, targetPlayerSearchQuery]);

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
      const variants = teamNameVariants(selectedTeam);
      const normVariants = new Set(variants.map((v) => normalizeName(v)));
      const likeTerms = variants.map((v) => v.trim()).filter(Boolean);
      const orExpr = likeTerms
        .map((v) => `team.ilike.*${v.replace(/\*/g, "").replace(/,/g, " ")}*`)
        .join(",");
      const { data } = await supabase
        .from("players")
        .select(`
          id, first_name, last_name, position, team, from_team, conference,
          player_predictions(id, from_avg, from_obp, from_slg, p_avg, p_obp, p_slg, p_ops, p_wrc_plus, power_rating_plus, class_transition, dev_aggressiveness, model_type, status),
          nil_valuations(estimated_value, component_breakdown)
        `)
        .or(orExpr)
        .or("transfer_portal.eq.false,transfer_portal.is.null");
      return (data ?? []).filter((p: any) => {
        const normTeam = normalizeName(p.team || "");
        if (normVariants.has(normTeam)) return true;
        // Token fallback for variant drift (e.g., WVU/West Virginia University).
        const teamCompact = normTeam.replace(/\buniversity\b/g, "").replace(/\s+/g, " ").trim();
        for (const v of normVariants) {
          const vCompact = v.replace(/\buniversity\b/g, "").replace(/\s+/g, " ").trim();
          if (vCompact && teamCompact && (teamCompact === vCompact || teamCompact.includes(vCompact) || vCompact.includes(teamCompact))) {
            return true;
          }
        }
        return false;
      });
    },
  });
  const storagePitchersForSelectedTeam = useMemo(() => {
    if (!selectedTeam) return [] as BuildPlayer[];
    return readStoragePitcherLocalPlayers(selectedTeam).map((lp) => ({
      player_id: null,
      source: "returner",
      custom_name: null,
      position_slot: lp.role,
      depth_order: 1,
      nil_value: 0,
      production_notes: null,
      roster_status: "returner",
      depth_role: lp.role === "SP" ? "weekend_starter" : "high_leverage_reliever",
      class_transition: "SJ",
      dev_aggressiveness: 0,
      transfer_snapshot: null,
      player: {
        first_name: lp.first_name,
        last_name: lp.last_name,
        position: lp.position,
        team: lp.team,
        from_team: lp.from_team,
        conference: lp.conference,
      },
      prediction: null,
      nilVal: null,
      nil_owar: 0,
      team_metrics: null,
      team_power_plus: null,
    }));
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
      const playerIds = players
        .map((p) => (typeof p.player_id === "string" ? p.player_id.trim() : p.player_id))
        .filter((id): id is string => isUuid(id));
      let playerMap: Record<string, any> = {};
      if (playerIds.length > 0) {
        const { data: pData, error: pErr } = await supabase
          .from("players")
          .select(`
            id, first_name, last_name, position, team, from_team, conference,
            player_predictions(id, from_avg, from_obp, from_slg, p_avg, p_obp, p_slg, p_ops, p_wrc_plus, power_rating_plus, class_transition, dev_aggressiveness, model_type, status),
            nil_valuations(estimated_value, component_breakdown)
          `)
          .in("id", playerIds);
        if (pErr) {
          console.error("TeamBuilder loadBuild players fetch failed:", pErr);
        }
        (pData ?? []).forEach((p) => {
          playerMap[p.id] = p;
        });
      }

      const fallbackPitchers = readStoragePitcherLocalPlayers(build.team || selectedTeam || "");
      const usedFallbackIndices = new Set<number>();
      const reserveFallbackIndexByName = (fullName: string) => {
        const key = normalizeName(fullName);
        if (!key) return;
        for (let i = 0; i < fallbackPitchers.length; i += 1) {
          if (usedFallbackIndices.has(i)) continue;
          const fp = fallbackPitchers[i];
          const fpName = normalizeName(`${fp.first_name || ""} ${fp.last_name || ""}`);
          if (fpName === key) {
            usedFallbackIndices.add(i);
            return;
          }
        }
      };
      const claimFallbackPitcher = (preferredRole: "SP" | "RP" | null) => {
        const pick = (idx: number) => {
          usedFallbackIndices.add(idx);
          const fp = fallbackPitchers[idx];
          return {
            first_name: fp.first_name,
            last_name: fp.last_name,
            position: fp.position,
            team: fp.team,
            from_team: fp.from_team,
            conference: fp.conference,
          };
        };
        if (preferredRole) {
          for (let i = 0; i < fallbackPitchers.length; i += 1) {
            if (usedFallbackIndices.has(i)) continue;
            if (fallbackPitchers[i].role === preferredRole) return pick(i);
          }
        }
        for (let i = 0; i < fallbackPitchers.length; i += 1) {
          if (!usedFallbackIndices.has(i)) return pick(i);
        }
        return null;
      };

      setRosterPlayers(
        players.map((bp) => {
          const normalizedPlayerId = typeof bp.player_id === "string" ? bp.player_id.trim() : bp.player_id;
          const pd = normalizedPlayerId ? playerMap[normalizedPlayerId] : null;
          const activePred = selectPreferredPrediction(pd?.player_predictions);
          const meta = parseBuildPlayerMeta(bp.production_notes);
          const localPlayerRaw = !pd && meta.localPlayer
            ? {
                first_name: (meta.localPlayer.first_name || "").trim(),
                last_name: (meta.localPlayer.last_name || "").trim(),
                position: meta.localPlayer.position ?? null,
                team: meta.localPlayer.team ?? null,
                from_team: meta.localPlayer.from_team ?? null,
                conference: meta.localPlayer.conference ?? null,
              }
            : null;
          const fallbackName = (() => {
            if (bp.custom_name && bp.custom_name.trim()) return bp.custom_name.trim();
            if (meta.notes && meta.notes.trim()) return meta.notes.trim();
            if (!localPlayerRaw) return null;
            const full = `${localPlayerRaw.first_name || ""} ${localPlayerRaw.last_name || ""}`.trim();
            return full || null;
          })();
          const overrideRole = asPitcherRole(pd?.id ? playerOverrides?.[pd.id]?.pitcher_role || null : null);
          const inferredRole = overrideRole || asPitcherRole(pd?.position || null);
          const positionForPitcherInference = pd?.position || localPlayerRaw?.position || "";
          const isPitcherRow = /^(SP|RP|CL|P|LHP|RHP)/i.test(String(positionForPitcherInference));
          const fallbackRole =
            (bp.position_slot === "SP" || bp.position_slot === "RP" ? bp.position_slot : null) ??
            ((meta.depthRole === "weekend_starter" || meta.depthRole === "weekday_starter") ? "SP" : null) ??
            ((meta.depthRole === "high_leverage_reliever" || meta.depthRole === "low_impact_reliever") ? "RP" : null);

          if (pd) {
            const full = `${pd.first_name || ""} ${pd.last_name || ""}`.trim();
            reserveFallbackIndexByName(full);
          } else if (localPlayerRaw) {
            const full = `${localPlayerRaw.first_name || ""} ${localPlayerRaw.last_name || ""}`.trim();
            reserveFallbackIndexByName(full);
          } else if (fallbackName) {
            reserveFallbackIndexByName(fallbackName);
          }

          const recoveredPitcher = !pd && !localPlayerRaw && isPitcherRow ? claimFallbackPitcher(fallbackRole) : null;
          const resolvedLocalPlayer = localPlayerRaw || recoveredPitcher;
          const resolvedName = fallbackName || (resolvedLocalPlayer ? `${resolvedLocalPlayer.first_name || ""} ${resolvedLocalPlayer.last_name || ""}`.trim() : null);
          return {
            ...(bp as any),
            id: bp.id,
            player_id: normalizedPlayerId ?? null,
            source: bp.source as "returner" | "portal",
            custom_name: resolvedName || null,
            position_slot: bp.position_slot || (isPitcherRow ? (inferredRole || "RP") : null),
            depth_order: bp.depth_order ?? 1,
            nil_value: Number(bp.nil_value) || 0,
            production_notes: meta.notes,
            roster_status: meta.rosterStatus ?? ((bp.source as string) === "portal" ? "target" : "returner"),
            depth_role: meta.depthRole ?? (isPitcherRow ? ((inferredRole === "SP") ? "weekend_starter" : "high_leverage_reliever") : "starter"),
            class_transition: meta.classTransition ?? activePred?.class_transition ?? "SJ",
            dev_aggressiveness: meta.devAggressiveness ?? activePred?.dev_aggressiveness ?? 0,
            transfer_snapshot: meta.transferSnapshot ?? null,
            player: pd
              ? { first_name: pd.first_name, last_name: pd.last_name, position: pd.position, team: pd.team, from_team: pd.from_team, conference: pd.conference ?? null }
              : (resolvedLocalPlayer || null),
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
  }, [builds, playerOverrides]);

  // Auto-load returners when team changes and it's a new build
  useEffect(() => {
    if (!selectedTeam || selectedBuildId) return;
    if (skipAutoSeedOnceRef.current) {
      skipAutoSeedOnceRef.current = false;
      return;
    }
    const selectedTeamKey = normalizeName(selectedTeam);
    const hasRoster = rosterPlayers.length > 0;
    const hasTargets = rosterPlayers.some((p) => (p.roster_status || "returner") === "target");
    const alreadySeededThisTeam = autoSeededTeamRef.current === selectedTeamKey;
    // Avoid destructive reseeds that wipe user-added targets/edits.
    if ((alreadySeededThisTeam && hasRoster) || hasTargets || (dirty && hasRoster)) return;

    const mapped: BuildPlayer[] = returners.map((r: any) => {
      const activePred = selectPreferredPrediction(r.player_predictions);
      const overrideRole = asPitcherRole(playerOverrides?.[r.id]?.pitcher_role || null);
      const inferredRole = overrideRole || asPitcherRole(r.position || null);
      const isPitcherRow = /^(SP|RP|CL|P|LHP|RHP)/i.test(String(r.position || ""));
      return {
        player_id: r.id,
        source: "returner" as const,
        custom_name: null,
        position_slot: isPitcherRow ? (inferredRole || "RP") : null,
        depth_order: 1,
        nil_value: r.nil_valuations?.[0]?.estimated_value ? Number(r.nil_valuations[0].estimated_value) : 0,
        production_notes: null,
        roster_status: "returner",
        depth_role: isPitcherRow
          ? ((inferredRole === "SP") ? "weekend_starter" : "high_leverage_reliever")
          : "starter",
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
    autoSeededTeamRef.current = selectedTeamKey;
    setDirty(true);
  }, [returners, selectedTeam, selectedBuildId, storagePitchersForSelectedTeam, playerOverrides, rosterPlayers, dirty]);

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
          ...(() => {
            const fullName = rp.player ? `${rp.player.first_name || ""} ${rp.player.last_name || ""}`.trim() : "";
            const persistedName = (rp.custom_name && rp.custom_name.trim()) || fullName || null;
            return { custom_name: persistedName };
          })(),
          build_id: buildId!,
          player_id: rp.player_id,
          source: rp.source,
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
            rp.player
              ? {
                  first_name: rp.player.first_name || "",
                  last_name: rp.player.last_name || "",
                  position: rp.player.position ?? null,
                  team: rp.player.team ?? null,
                  from_team: rp.player.from_team ?? null,
                  conference: rp.player.conference ?? null,
                }
              : null,
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
          const overrideRole = asPitcherRole(playerOverrides?.[row.id]?.pitcher_role || null);
          const entryRole = asPitcherRole(entry.pitcherRole || null);
          const inferredRole = overrideRole || entryRole || asPitcherRole(row.position || null);
          const isPitcherRow = /^(SP|RP|CL|P|LHP|RHP)/i.test(String(row.position || ""));
          const chosenPred = selectTransferPortalPreferredPrediction(
            (row.player_predictions || []).filter((pr: any) => pr.variant === "regular"),
          );
          const newP: BuildPlayer = {
            player_id: row.id,
            source: "portal",
            custom_name: `${row.first_name || ""} ${row.last_name || ""}`.trim() || null,
            position_slot: isPitcherRow ? (inferredRole || "RP") : null,
            depth_order: 1,
            nil_value: row.nil_valuations?.[0]?.estimated_value ? Number(row.nil_valuations[0].estimated_value) : 0,
            production_notes: null,
            roster_status: "target",
            depth_role: isPitcherRow
              ? ((inferredRole === "SP") ? "weekend_starter" : "high_leverage_reliever")
              : "utility",
            class_transition: chosenPred?.class_transition ?? "SJ",
            dev_aggressiveness: chosenPred?.dev_aggressiveness ?? 0,
            transfer_snapshot: {
              p_avg: entry.pAvg ?? null,
              p_obp: entry.pObp ?? null,
              p_slg: entry.pSlg ?? null,
              p_wrc_plus: entry.pWrcPlus ?? null,
              p_era: entry.pEra ?? null,
              p_fip: entry.pFip ?? null,
              p_whip: entry.pWhip ?? null,
              p_k9: entry.pK9 ?? null,
              p_bb9: entry.pBb9 ?? null,
              p_hr9: entry.pHr9 ?? null,
              p_rv_plus: entry.pRvPlus ?? null,
              p_war: entry.pWar ?? null,
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
  }, [selectedTeam, toast, playerOverrides]);

  const teamByKey = useMemo(() => {
    const map = new Map<string, TeamRow>();
    for (const t of teams as TeamRow[]) {
      map.set(normalizeKey(t.name), t);
    }
    return map;
  }, [teams]);
  const teamParkComponents = useMemo(() => readTeamParkFactorComponents(), [teams]);
  const pitchingStatsByNameTeam = useMemo(() => {
    const byKey = new Map<string, { team: string | null; role: "SP" | "RP" | "SM" | null; era: number | null; fip: number | null; whip: number | null; k9: number | null; bb9: number | null; hr9: number | null; g: number | null; gs: number | null; ip: number | null }>();
    const byName = new Map<string, Array<{ team: string | null; role: "SP" | "RP" | "SM" | null; era: number | null; fip: number | null; whip: number | null; k9: number | null; bb9: number | null; hr9: number | null; g: number | null; gs: number | null; ip: number | null }>>();
    try {
      const raw = localStorage.getItem("pitching_stats_storage_2025_v1");
      if (!raw) return { byKey, byName };
      const parsed = JSON.parse(raw) as { rows?: Array<{ values?: string[] }> };
      const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
      for (const row of rows) {
        const values = Array.isArray(row.values) ? row.values : [];
        const name = (values[0] || "").trim();
        const team = (values[1] || "").trim();
        if (!name) continue;
        const statsView = resolvePitchingStatsView(values);
        const rec = {
          team: team || null,
          role: toPitchingRole(statsView.role),
          era: parseNum(statsView.era),
          fip: parseNum(statsView.fip),
          whip: parseNum(statsView.whip),
          k9: parseNum(statsView.k9),
          bb9: parseNum(statsView.bb9),
          hr9: parseNum(statsView.hr9),
          g: parseNum(statsView.g),
          gs: parseNum(statsView.gs),
          ip: parseBaseballInnings(statsView.ip),
        };
        byKey.set(`${normalizeName(name)}|${normalizeName(team)}`, rec);
        const nKey = normalizeName(name);
        const bucket = byName.get(nKey) || [];
        bucket.push(rec);
        byName.set(nKey, bucket);
      }
    } catch {
      // ignore malformed local storage
    }
    return { byKey, byName };
  }, []);
  const pitchingPrByNameTeam = useMemo(() => {
    const byKey = new Map<string, { eraPrPlus: number | null; fipPrPlus: number | null; whipPrPlus: number | null; k9PrPlus: number | null; bb9PrPlus: number | null; hr9PrPlus: number | null }>();
    const byName = new Map<string, Array<{ eraPrPlus: number | null; fipPrPlus: number | null; whipPrPlus: number | null; k9PrPlus: number | null; bb9PrPlus: number | null; hr9PrPlus: number | null }>>();
    try {
      const raw = localStorage.getItem("pitching_power_ratings_storage_2025_v1");
      if (!raw) return { byKey, byName };
      const parsed = JSON.parse(raw) as { rows?: Array<{ values?: string[] }> };
      const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
      for (const row of rows) {
        const values = Array.isArray(row.values) ? row.values : [];
        const name = (values[0] || "").trim();
        const team = (values[1] || "").trim();
        if (!name) continue;
        const rec = {
          eraPrPlus: parseNum(values[30]),
          fipPrPlus: parseNum(values[31]),
          whipPrPlus: parseNum(values[32]),
          k9PrPlus: parseNum(values[33]),
          hr9PrPlus: parseNum(values[34]),
          bb9PrPlus: parseNum(values[35]),
        };
        byKey.set(`${normalizeName(name)}|${normalizeName(team)}`, rec);
        const nKey = normalizeName(name);
        const bucket = byName.get(nKey) || [];
        bucket.push(rec);
        byName.set(nKey, bucket);
      }
    } catch {
      // ignore malformed local storage
    }
    return { byKey, byName };
  }, []);

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
          p_era: p.transfer_snapshot.p_era ?? null,
          p_fip: p.transfer_snapshot.p_fip ?? null,
          p_whip: p.transfer_snapshot.p_whip ?? null,
          p_k9: p.transfer_snapshot.p_k9 ?? null,
          p_bb9: p.transfer_snapshot.p_bb9 ?? null,
          p_hr9: p.transfer_snapshot.p_hr9 ?? null,
          p_rv_plus: p.transfer_snapshot.p_rv_plus ?? null,
          p_war: p.transfer_snapshot.p_war ?? null,
          nil_valuation: p.transfer_snapshot.nil_valuation ?? null,
          owar: p.transfer_snapshot.owar ?? null,
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
    const isoStdPower = eqNum("t_iso_std_power", 45.423);
    const isoStdNcaa = toRate(eqNum("t_iso_std_ncaa", 0.07849797197));
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
    const classKey = String(p.class_transition || livePred.class_transition || "SJ").toUpperCase();
    const classAdj =
      classKey === "FS" ? 0.03 :
      classKey === "SJ" ? 0.02 :
      classKey === "JS" ? 0.015 :
      classKey === "GR" ? 0.01 : 0.02;
    const devAgg = Number.isFinite(Number(p.dev_aggressiveness)) ? Number(p.dev_aggressiveness) : 0;
    const transferMult = 1 + classAdj + (devAgg * 0.06);
    const pAvgAdj = projected.pAvg * transferMult;
    const pObpAdj = projected.pObp * transferMult;
    const pIsoAdj = projected.pIso * transferMult;
    const pSlgAdj = pAvgAdj + pIsoAdj;
    const pWrcAdj = (wObp * pObpAdj) + (wSlg * pSlgAdj) + (wAvg * pAvgAdj) + (wIso * pIsoAdj);
    const pWrcPlusAdj = ncaaAvgWrc === 0 ? null : Math.round((pWrcAdj / ncaaAvgWrc) * 100);
    const offValueAdj = pWrcPlusAdj == null ? null : (pWrcPlusAdj - 100) / 100;
    const pa = 260;
    const runsPerPa = 0.13;
    const replacementRuns = (pa / 600) * 25;
    const raaAdj = offValueAdj == null ? null : offValueAdj * pa * runsPerPa;
    const rarAdj = raaAdj == null ? null : raaAdj + replacementRuns;
    const owarAdj = rarAdj == null ? null : rarAdj / 10;
    const basePerOwar = eqNum("nil_base_per_owar", 25000);
    const ptm = getProgramTierMultiplierByConference(toTeamRow.conference || null, DEFAULT_NIL_TIER_MULTIPLIERS);
    const pvm = getPositionValueMultiplier(livePlayer.position ?? p.player?.position ?? null);
    const simNilValuation = owarAdj == null ? null : owarAdj * basePerOwar * ptm * pvm;
    return {
      p_avg: Math.round(pAvgAdj * 1000) / 1000,
      p_obp: Math.round(pObpAdj * 1000) / 1000,
      p_slg: Math.round(pSlgAdj * 1000) / 1000,
      p_wrc_plus: pWrcPlusAdj,
      owar: owarAdj,
      nil_valuation: simNilValuation,
    };
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
    try {
    if (row?.__seedHitter) {
      // If a DB-backed player exists for this seed fallback row, always use the DB path
      // so transfer math matches Transfer Portal exactly.
      const matchedDb = allPlayersForSearch.find((p: any) =>
        normalizeName(`${p.first_name || ""} ${p.last_name || ""}`) === normalizeName(`${row.first_name || ""} ${row.last_name || ""}`) &&
        normalizeName(p.team || "") === normalizeName(row.team || ""),
      );
      if (matchedDb) {
        await addPlayerFromTargetSearch(matchedDb);
        return;
      }

      const fullName = `${row.first_name || ""} ${row.last_name || ""}`.trim();
      const alreadyAddedSeed = rosterPlayers.some((p) => {
        if ((p.roster_status || "returner") !== "target") return false;
        const existingName = p.player ? `${p.player.first_name} ${p.player.last_name}`.trim() : (p.custom_name || "");
        return normalizeName(existingName) === normalizeName(fullName) && normalizeName(p.player?.team || "") === normalizeName(row.team || "");
      });
      if (alreadyAddedSeed) {
        toast({ title: "Already on target board", description: `${fullName} is already a target.` });
        setTargetPlayerSearchQuery("");
        setTargetPlayerSearchOpen(false);
        return;
      }
      const newP: BuildPlayer = {
        player_id: null,
        source: "portal",
        custom_name: fullName || null,
        position_slot: null,
        depth_order: 1,
        nil_value: 0,
        production_notes: null,
        roster_status: "target",
        depth_role: "utility",
        class_transition: "SJ",
        dev_aggressiveness: 0,
        transfer_snapshot: {
          p_avg: row.__seedStats?.avg ?? null,
          p_obp: row.__seedStats?.obp ?? null,
          p_slg: row.__seedStats?.slg ?? null,
          p_wrc_plus: null,
          owar: null,
          nil_valuation: null,
          from_team: row.team || null,
          from_conference: row.conference || null,
        },
        player: {
          first_name: row.first_name || "",
          last_name: row.last_name || "",
          position: row.position || null,
          team: row.team || null,
          from_team: row.team || null,
          conference: row.conference || null,
        },
        prediction: null,
        nilVal: null,
        nil_owar: null,
        team_metrics: null,
        team_power_plus: null,
      };
      if (selectedTeam && row.__seedPowerPlus?.baPlus != null && row.__seedPowerPlus?.obpPlus != null && row.__seedPowerPlus?.isoPlus != null) {
        const toTeamRow = teamByKey.get(normalizeKey(selectedTeam)) || null;
        const fromTeamRow = row.team ? (teamByKey.get(normalizeKey(row.team)) || null) : null;
        const fromConference = fromTeamRow?.conference || row.conference || null;
        const fromConfStats = resolveConferenceStats(fromConference);
        const toConfStats = resolveConferenceStats(toTeamRow?.conference || null);
        const lastAvg = row.__seedStats?.avg ?? null;
        const lastObp = row.__seedStats?.obp ?? null;
        const lastSlg = row.__seedStats?.slg ?? null;
        if (
          toTeamRow && fromConfStats && toConfStats &&
          lastAvg != null && lastObp != null && lastSlg != null &&
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
            const projected = computeTransferProjection({
              lastAvg,
              lastObp,
              lastSlg,
              baPR: Number(row.__seedPowerPlus.baPlus),
              obpPR: Number(row.__seedPowerPlus.obpPlus),
              isoPR: Number(row.__seedPowerPlus.isoPlus),
              fromAvgPlus: fromConfStats.avg_plus,
              toAvgPlus: toConfStats.avg_plus,
              fromObpPlus: fromConfStats.obp_plus,
              toObpPlus: toConfStats.obp_plus,
              fromIsoPlus: fromConfStats.iso_plus,
              toIsoPlus: toConfStats.iso_plus,
              fromStuff: fromConfStats.stuff_plus,
              toStuff: toConfStats.stuff_plus,
              fromPark: normalizeParkToIndex(fromParkAvgRaw),
              toPark: normalizeParkToIndex(toParkAvgRaw),
              fromObpPark: normalizeParkToIndex(fromParkObpRaw),
              toObpPark: normalizeParkToIndex(toParkObpRaw),
              fromIsoPark: normalizeParkToIndex(fromParkIsoRaw),
              toIsoPark: normalizeParkToIndex(toParkIsoRaw),
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
              isoStdPower: eqNum("t_iso_std_power", 45.423),
              isoStdNcaa: toRate(eqNum("t_iso_std_ncaa", 0.07849797197)),
              wObp: toRate(eqNum("r_w_obp", 0.45)),
              wSlg: toRate(eqNum("r_w_slg", 0.30)),
              wAvg: toRate(eqNum("r_w_avg", 0.15)),
              wIso: toRate(eqNum("r_w_iso", 0.10)),
            });
            const classKey = "SJ";
            const classAdj = classKey === "SJ" ? 0.02 : 0.02;
            const devAgg = 0;
            const transferMult = 1 + classAdj + (devAgg * 0.06);
            const pAvgAdj = projected.pAvg * transferMult;
            const pObpAdj = projected.pObp * transferMult;
            const pIsoAdj = projected.pIso * transferMult;
            const pSlgAdj = pAvgAdj + pIsoAdj;
            const ncaaAvgWrc = toRate(eqNum("t_wrc_ncaa_avg", 0.364));
            const wObp = toRate(eqNum("r_w_obp", 0.45));
            const wSlg = toRate(eqNum("r_w_slg", 0.30));
            const wAvg = toRate(eqNum("r_w_avg", 0.15));
            const wIso = toRate(eqNum("r_w_iso", 0.10));
            const pWrcAdj = (wObp * pObpAdj) + (wSlg * pSlgAdj) + (wAvg * pAvgAdj) + (wIso * pIsoAdj);
            const pWrcPlusAdj = ncaaAvgWrc === 0 ? null : Math.round((pWrcAdj / ncaaAvgWrc) * 100);
            const offValueAdj = pWrcPlusAdj == null ? null : (pWrcPlusAdj - 100) / 100;
            const pa = 260;
            const runsPerPa = 0.13;
            const replacementRuns = (pa / 600) * 25;
            const raaAdj = offValueAdj == null ? null : offValueAdj * pa * runsPerPa;
            const rarAdj = raaAdj == null ? null : raaAdj + replacementRuns;
            const owarAdj = rarAdj == null ? null : rarAdj / 10;
            const basePerOwar = eqNum("nil_base_per_owar", 25000);
            const ptm = getProgramTierMultiplierByConference(toTeamRow.conference || null, DEFAULT_NIL_TIER_MULTIPLIERS);
            const pvm = getPositionValueMultiplier(row.position);
            const nilValuation = owarAdj == null ? null : owarAdj * basePerOwar * ptm * pvm;
            newP.transfer_snapshot = {
              p_avg: pAvgAdj,
              p_obp: pObpAdj,
              p_slg: pSlgAdj,
              p_wrc_plus: pWrcPlusAdj,
              owar: owarAdj,
              nil_valuation: nilValuation,
              from_team: row.team || null,
              from_conference: fromConference,
            };
          }
        }
      }
      setRosterPlayers((prev) => [...prev, newP]);
      setDirty(true);
      setTargetPlayerSearchQuery("");
      setTargetPlayerSearchOpen(false);
      toast({ title: "Added to targets", description: fullName });
      return;
    }
    if (row?.__storagePitcher) {
      const fullName = `${row.first_name || ""} ${row.last_name || ""}`.trim();
      const alreadyAddedStorage = rosterPlayers.some((p) => {
        if ((p.roster_status || "returner") !== "target") return false;
        const existingName = p.player ? `${p.player.first_name} ${p.player.last_name}`.trim() : (p.custom_name || "");
        return normalizeName(existingName) === normalizeName(fullName) && normalizeName(p.player?.team || "") === normalizeName(row.team || "");
      });
      if (alreadyAddedStorage) {
        toast({ title: "Already on target board", description: `${fullName} is already a target.` });
        setTargetPlayerSearchQuery("");
        setTargetPlayerSearchOpen(false);
        return;
      }
      const inferredRole = asPitcherRole(row.__pitching?.role || row.position || "RP") || "RP";
      let transferSnapshot: TransferSnapshot = {
        p_avg: null,
        p_obp: null,
        p_slg: null,
        p_wrc_plus: row.__pitching?.p_rv_plus ?? null,
        p_era: row.__pitching?.p_era ?? null,
        p_fip: row.__pitching?.p_fip ?? null,
        p_whip: row.__pitching?.p_whip ?? null,
        p_k9: row.__pitching?.p_k9 ?? null,
        p_bb9: row.__pitching?.p_bb9 ?? null,
        p_hr9: row.__pitching?.p_hr9 ?? null,
        p_rv_plus: row.__pitching?.p_rv_plus ?? null,
        p_war: row.__pitching?.p_war ?? null,
        owar: row.__pitching?.p_war ?? null,
        nil_valuation: null,
        from_team: row.team || null,
        from_conference: row.conference || null,
      };
      const newP: BuildPlayer = {
        player_id: null,
        source: "portal",
        custom_name: fullName || null,
        position_slot: inferredRole,
        depth_order: 1,
        nil_value: 0,
        production_notes: null,
        roster_status: "target",
        depth_role: inferredRole === "SP" ? "weekend_starter" : "high_leverage_reliever",
        class_transition: "SJ",
        dev_aggressiveness: 0,
        transfer_snapshot: transferSnapshot,
        player: {
          first_name: row.first_name || "",
          last_name: row.last_name || "",
          position: inferredRole,
          team: row.team || null,
          from_team: row.from_team || row.team || null,
          conference: row.conference || null,
        },
        prediction: null,
        nilVal: null,
        nil_owar: null,
        team_metrics: null,
        team_power_plus: null,
      };
      const computed = computeReturnerPitchingProjection(newP);
      if (computed) {
        transferSnapshot = {
          ...transferSnapshot,
          p_era: computed.p_era ?? null,
          p_fip: computed.p_fip ?? null,
          p_whip: computed.p_whip ?? null,
          p_k9: computed.p_k9 ?? null,
          p_bb9: computed.p_bb9 ?? null,
          p_hr9: computed.p_hr9 ?? null,
          p_rv_plus: computed.p_rv_plus ?? null,
          p_war: computed.p_war ?? null,
          p_wrc_plus: computed.p_rv_plus ?? null,
          owar: computed.p_war ?? null,
          nil_valuation: computed.nil_valuation ?? null,
        };
        newP.transfer_snapshot = transferSnapshot;
      }
      setRosterPlayers((prev) => [...prev, newP]);
      setDirty(true);
      setTargetPlayerSearchQuery("");
      setTargetPlayerSearchOpen(false);
      toast({ title: "Added to targets", description: fullName });
      return;
    }

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
    const overrideRole = asPitcherRole(playerOverrides?.[row.id]?.pitcher_role || null);
    const inferredRole = overrideRole || asPitcherRole(row.position || null);
    const isPitcherRow = /^(SP|RP|CL|P|LHP|RHP)/i.test(String(row.position || ""));

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
        const isoStdPower = eqNum("t_iso_std_power", 45.423);
        const isoStdNcaa = toRate(eqNum("t_iso_std_ncaa", 0.07849797197));
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
          const classKey = String(chosenPred?.class_transition || "SJ").toUpperCase();
          const classAdj =
            classKey === "FS" ? 0.03 :
            classKey === "SJ" ? 0.02 :
            classKey === "JS" ? 0.015 :
            classKey === "GR" ? 0.01 : 0.02;
          const devAgg = Number.isFinite(Number(chosenPred?.dev_aggressiveness))
            ? Number(chosenPred?.dev_aggressiveness)
            : 0;
          const transferMult = 1 + classAdj + (devAgg * 0.06);
          const pAvgAdj = projected.pAvg * transferMult;
          const pObpAdj = projected.pObp * transferMult;
          const pIsoAdj = projected.pIso * transferMult;
          const pSlgAdj = pAvgAdj + pIsoAdj;
          const pWrcAdj = (wObp * pObpAdj) + (wSlg * pSlgAdj) + (wAvg * pAvgAdj) + (wIso * pIsoAdj);
          const pWrcPlusAdj = ncaaAvgWrc === 0 ? null : Math.round((pWrcAdj / ncaaAvgWrc) * 100);
          const offValueAdj = pWrcPlusAdj == null ? null : (pWrcPlusAdj - 100) / 100;
          const pa = 260;
          const runsPerPa = 0.13;
          const replacementRuns = (pa / 600) * 25;
          const raaAdj = offValueAdj == null ? null : offValueAdj * pa * runsPerPa;
          const rarAdj = raaAdj == null ? null : raaAdj + replacementRuns;
          const owarAdj = rarAdj == null ? null : rarAdj / 10;
          const nilValuation = owarAdj == null ? null : owarAdj * basePerOwar * ptm * pvm;

          transferSnapshot = {
            p_avg: pAvgAdj,
            p_obp: pObpAdj,
            p_slg: pSlgAdj,
            p_wrc_plus: pWrcPlusAdj,
            owar: owarAdj,
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
      custom_name: `${row.first_name || ""} ${row.last_name || ""}`.trim() || null,
      position_slot: isPitcherRow ? (inferredRole || "RP") : null,
      depth_order: 1,
      nil_value: row.nil_valuations?.[0]?.estimated_value ? Number(row.nil_valuations[0].estimated_value) : 0,
      production_notes: null,
      roster_status: "target",
      depth_role: isPitcherRow
        ? ((inferredRole === "SP") ? "weekend_starter" : "high_leverage_reliever")
        : "utility",
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
    if (isPitcherRow && !transferSnapshot) {
      const computed = computeReturnerPitchingProjection(newP);
      if (computed) {
        newP.transfer_snapshot = {
          p_avg: null,
          p_obp: null,
          p_slg: null,
          p_wrc_plus: computed.p_rv_plus ?? null,
          p_era: computed.p_era ?? null,
          p_fip: computed.p_fip ?? null,
          p_whip: computed.p_whip ?? null,
          p_k9: computed.p_k9 ?? null,
          p_bb9: computed.p_bb9 ?? null,
          p_hr9: computed.p_hr9 ?? null,
          p_rv_plus: computed.p_rv_plus ?? null,
          p_war: computed.p_war ?? null,
          owar: computed.p_war ?? null,
          nil_valuation: computed.nil_valuation ?? null,
          from_team: row.from_team || row.team || null,
          from_conference: row.conference || null,
        };
      }
    }
    setRosterPlayers((prev) => [...prev, newP]);
    setDirty(true);
    setTargetPlayerSearchQuery("");
    setTargetPlayerSearchOpen(false);
    toast({ title: "Added to targets", description: `${row.first_name} ${row.last_name}` });
    } catch (err: any) {
      toast({
        title: "Failed to add target",
        description: err?.message || "Unexpected error while adding player target.",
        variant: "destructive",
      });
    }
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

  const pitchingTierMultipliers = useMemo(
    () => ({
      sec: pitchingEq.market_tier_sec,
      p4: pitchingEq.market_tier_acc_big12,
      bigTen: pitchingEq.market_tier_big_ten,
      strongMid: pitchingEq.market_tier_strong_mid,
      lowMajor: pitchingEq.market_tier_low_major,
    }),
    [pitchingEq],
  );
  const pitchingPvfForRole = useCallback((role: "SP" | "RP") => {
    return role === "SP" ? pitchingEq.market_pvf_weekend_sp : pitchingEq.market_pvf_reliever;
  }, [pitchingEq]);
  const computePitcherPwar = useCallback((p: BuildPlayer, source: any) => {
    const pRvPlusRaw = source?.p_rv_plus ?? source?.p_wrc_plus ?? p.transfer_snapshot?.p_rv_plus ?? p.transfer_snapshot?.p_wrc_plus ?? null;
    const pRvPlus = Number(pRvPlusRaw);
    if (!Number.isFinite(pRvPlus) || pitchingEq.pwar_runs_per_win === 0) return null;
    const currentPitcherRole = normalizePitcherRole(
      pitcherRoleFromSlot(p.position_slot) || p.player?.position || null,
    );
    const pitcherDepthRole = normalizePitcherDepthRole(p.depth_role, currentPitcherRole);
    const ipByRole = currentPitcherRole === "SP"
      ? (pitcherDepthRole === "weekday_starter" ? pitchingEq.pwar_ip_sm : pitchingEq.pwar_ip_sp)
      : pitchingEq.pwar_ip_rp;
    const pitcherValue = (pRvPlus - 100) / 100;
    const basePwar = (
      (pitcherValue * (ipByRole / 9) * pitchingEq.pwar_r_per_9) +
      ((ipByRole / 9) * pitchingEq.pwar_replacement_runs_per_9)
    ) / pitchingEq.pwar_runs_per_win;
    return basePwar * depthRoleMultiplier(p.depth_role);
  }, [pitchingEq]);
  const computeReturnerPitchingProjection = useCallback((p: BuildPlayer) => {
    const fullName = p.player
      ? `${p.player.first_name} ${p.player.last_name}`.trim()
      : (p.custom_name || "").trim();
    const teamName = p.player?.team || selectedTeam || "";
    const key = `${normalizeName(fullName)}|${normalizeName(teamName)}`;
    const stats = pitchingStatsByNameTeam.byKey.get(key) || (() => {
      const bucket = pitchingStatsByNameTeam.byName.get(normalizeName(fullName)) || [];
      return bucket.length === 1 ? bucket[0] : null;
    })();
    const pr = pitchingPrByNameTeam.byKey.get(key) || (() => {
      const bucket = pitchingPrByNameTeam.byName.get(normalizeName(fullName)) || [];
      return bucket.length === 1 ? bucket[0] : null;
    })();
    if (!stats || !pr) return null;

    const currentPitcherRole = normalizePitcherRole(
      pitcherRoleFromSlot(p.position_slot) || p.player?.position || stats.role || null,
    );
    const baseRole: "SP" | "RP" | "SM" | null = stats.role || (stats.g != null && stats.g > 0 && stats.gs != null ? ((stats.gs / stats.g) < 0.5 ? "RP" : "SP") : null);
    const classTransitionRaw = String(p.class_transition || "SJ").toUpperCase();
    const classTransition: "FS" | "SJ" | "JS" | "GR" =
      classTransitionRaw === "FS" || classTransitionRaw === "SJ" || classTransitionRaw === "JS" || classTransitionRaw === "GR"
        ? classTransitionRaw
        : "SJ";
    const devAgg = Number.isFinite(Number(p.dev_aggressiveness)) ? Number(p.dev_aggressiveness) : 0;

    const classEraAdj = toPitchingClassAdj(classTransition, pitchingEq.class_era_fs, pitchingEq.class_era_sj, pitchingEq.class_era_js, pitchingEq.class_era_gr);
    const classFipAdj = toPitchingClassAdj(classTransition, pitchingEq.class_fip_fs, pitchingEq.class_fip_sj, pitchingEq.class_fip_js, pitchingEq.class_fip_gr);
    const classWhipAdj = toPitchingClassAdj(classTransition, pitchingEq.class_whip_fs, pitchingEq.class_whip_sj, pitchingEq.class_whip_js, pitchingEq.class_whip_gr);
    const classK9Adj = toPitchingClassAdj(classTransition, pitchingEq.class_k9_fs, pitchingEq.class_k9_sj, pitchingEq.class_k9_js, pitchingEq.class_k9_gr);
    const classBb9Adj = toPitchingClassAdj(classTransition, pitchingEq.class_bb9_fs, pitchingEq.class_bb9_sj, pitchingEq.class_bb9_js, pitchingEq.class_bb9_gr);
    const classHr9Adj = toPitchingClassAdj(classTransition, pitchingEq.class_hr9_fs, pitchingEq.class_hr9_sj, pitchingEq.class_hr9_js, pitchingEq.class_hr9_gr);

    const pEra = projectPitchingRate({ lastStat: stats.era, prPlus: pr.eraPrPlus, ncaaAvg: pitchingEq.era_plus_ncaa_avg, ncaaSd: pitchingEq.era_plus_ncaa_sd, prSd: pitchingEq.era_pr_sd, classAdjustment: classEraAdj, devAggressiveness: devAgg, thresholds: pitchingEq.era_damp_thresholds, impacts: pitchingEq.era_damp_impacts, lowerIsBetter: true });
    const pFip = projectPitchingRate({ lastStat: stats.fip, prPlus: pr.fipPrPlus, ncaaAvg: pitchingEq.fip_plus_ncaa_avg, ncaaSd: pitchingEq.fip_plus_ncaa_sd, prSd: pitchingEq.fip_pr_sd, classAdjustment: classFipAdj, devAggressiveness: devAgg, thresholds: pitchingEq.fip_damp_thresholds, impacts: pitchingEq.fip_damp_impacts, lowerIsBetter: true });
    const pWhip = projectPitchingRate({ lastStat: stats.whip, prPlus: pr.whipPrPlus, ncaaAvg: pitchingEq.whip_plus_ncaa_avg, ncaaSd: pitchingEq.whip_plus_ncaa_sd, prSd: pitchingEq.whip_pr_sd, classAdjustment: classWhipAdj, devAggressiveness: devAgg, thresholds: pitchingEq.whip_damp_thresholds, impacts: pitchingEq.whip_damp_impacts, lowerIsBetter: true });
    const pK9 = projectPitchingRate({ lastStat: stats.k9, prPlus: pr.k9PrPlus, ncaaAvg: pitchingEq.k9_plus_ncaa_avg, ncaaSd: pitchingEq.k9_plus_ncaa_sd, prSd: pitchingEq.k9_pr_sd, classAdjustment: classK9Adj, devAggressiveness: devAgg, thresholds: pitchingEq.k9_damp_thresholds, impacts: pitchingEq.k9_damp_impacts, lowerIsBetter: false });
    const pBb9 = projectPitchingRate({ lastStat: stats.bb9, prPlus: pr.bb9PrPlus, ncaaAvg: pitchingEq.bb9_plus_ncaa_avg, ncaaSd: pitchingEq.bb9_plus_ncaa_sd, prSd: pitchingEq.bb9_pr_sd, classAdjustment: classBb9Adj, devAggressiveness: devAgg, thresholds: pitchingEq.bb9_damp_thresholds, impacts: pitchingEq.bb9_damp_impacts, lowerIsBetter: true });
    const pHr9 = projectPitchingRate({ lastStat: stats.hr9, prPlus: pr.hr9PrPlus, ncaaAvg: pitchingEq.hr9_plus_ncaa_avg, ncaaSd: pitchingEq.hr9_plus_ncaa_sd, prSd: pitchingEq.hr9_pr_sd, classAdjustment: classHr9Adj, devAggressiveness: devAgg, thresholds: pitchingEq.hr9_damp_thresholds, impacts: pitchingEq.hr9_damp_impacts, lowerIsBetter: true });

    const teamNameForPark = teamByKey.get(normalizeKey(teamName))?.name || teamName || null;
    const fallbackPark = teamByKey.get(normalizeKey(teamName))?.park_factor ?? null;
    const avgPark = normalizeParkToIndex(resolveMetricParkFactor(teamNameForPark, fallbackPark, "avg", teamParkComponents));
    const obpPark = normalizeParkToIndex(resolveMetricParkFactor(teamNameForPark, fallbackPark, "obp", teamParkComponents));
    const isoPark = normalizeParkToIndex(resolveMetricParkFactor(teamNameForPark, fallbackPark, "iso", teamParkComponents));
    const eraParkRaw = resolveMetricParkFactor(teamNameForPark, null, "era", teamParkComponents);
    const whipParkRaw = resolveMetricParkFactor(teamNameForPark, null, "whip", teamParkComponents);
    const hr9ParkRaw = resolveMetricParkFactor(teamNameForPark, null, "hr9", teamParkComponents);
    const parkAdjustedEra = pEra == null ? null : pEra * (normalizeParkToIndex(eraParkRaw ?? avgPark) / 100);
    const parkAdjustedWhip = pWhip == null ? null : pWhip * (normalizeParkToIndex(whipParkRaw ?? ((0.7 * avgPark) + (0.3 * obpPark))) / 100);
    const parkAdjustedHr9 = pHr9 == null ? null : pHr9 * (normalizeParkToIndex(hr9ParkRaw ?? isoPark) / 100);
    const roleCurve = {
      tier1Max: pitchingEq.rp_to_sp_low_better_tier1_max,
      tier2Max: pitchingEq.rp_to_sp_low_better_tier2_max,
      tier3Max: pitchingEq.rp_to_sp_low_better_tier3_max,
      tier1Mult: pitchingEq.rp_to_sp_low_better_tier1_mult,
      tier2Mult: pitchingEq.rp_to_sp_low_better_tier2_mult,
      tier3Mult: pitchingEq.rp_to_sp_low_better_tier3_mult,
    };
    const roleAdjustedEra = applyRoleTransitionAdjustment(parkAdjustedEra, pitchingEq.sp_to_rp_reg_era_pct, baseRole, currentPitcherRole, true, roleCurve);
    const roleAdjustedFip = applyRoleTransitionAdjustment(pFip, pitchingEq.sp_to_rp_reg_fip_pct, baseRole, currentPitcherRole, true, roleCurve);
    const roleAdjustedWhip = applyRoleTransitionAdjustment(parkAdjustedWhip, pitchingEq.sp_to_rp_reg_whip_pct, baseRole, currentPitcherRole, true, roleCurve);
    const roleAdjustedK9 = applyRoleTransitionAdjustment(pK9, pitchingEq.sp_to_rp_reg_k9_pct, baseRole, currentPitcherRole, false, roleCurve);
    const roleAdjustedBb9 = applyRoleTransitionAdjustment(pBb9, pitchingEq.sp_to_rp_reg_bb9_pct, baseRole, currentPitcherRole, true, roleCurve);
    const roleAdjustedHr9 = applyRoleTransitionAdjustment(parkAdjustedHr9, pitchingEq.sp_to_rp_reg_hr9_pct, baseRole, currentPitcherRole, true, roleCurve);

    const eraPlus = calcPitchingPlus(roleAdjustedEra, pitchingEq.era_plus_ncaa_avg, pitchingEq.era_plus_ncaa_sd, pitchingEq.era_plus_scale, false);
    const fipPlus = calcPitchingPlus(roleAdjustedFip, pitchingEq.fip_plus_ncaa_avg, pitchingEq.fip_plus_ncaa_sd, pitchingEq.fip_plus_scale, false);
    const whipPlus = calcPitchingPlus(roleAdjustedWhip, pitchingEq.whip_plus_ncaa_avg, pitchingEq.whip_plus_ncaa_sd, pitchingEq.whip_plus_scale, false);
    const k9Plus = calcPitchingPlus(roleAdjustedK9, pitchingEq.k9_plus_ncaa_avg, pitchingEq.k9_plus_ncaa_sd, pitchingEq.k9_plus_scale, true);
    const bb9Plus = calcPitchingPlus(roleAdjustedBb9, pitchingEq.bb9_plus_ncaa_avg, pitchingEq.bb9_plus_ncaa_sd, pitchingEq.bb9_plus_scale, false);
    const hr9Plus = calcPitchingPlus(roleAdjustedHr9, pitchingEq.hr9_plus_ncaa_avg, pitchingEq.hr9_plus_ncaa_sd, pitchingEq.hr9_plus_scale, false);
    const pRvPlus = [eraPlus, fipPlus, whipPlus, k9Plus, bb9Plus, hr9Plus].every((v) => v != null)
      ? (Number(eraPlus) * pitchingEq.era_plus_weight) +
        (Number(fipPlus) * pitchingEq.fip_plus_weight) +
        (Number(whipPlus) * pitchingEq.whip_plus_weight) +
        (Number(k9Plus) * pitchingEq.k9_plus_weight) +
        (Number(bb9Plus) * pitchingEq.bb9_plus_weight) +
        (Number(hr9Plus) * pitchingEq.hr9_plus_weight)
      : null;
    const ipByRole = currentPitcherRole === "SP" ? pitchingEq.pwar_ip_sp : pitchingEq.pwar_ip_rp;
    const pitcherValue = pRvPlus == null ? null : ((pRvPlus - 100) / 100);
    const pWar = pitcherValue == null || pitchingEq.pwar_runs_per_win === 0
      ? null
      : (((pitcherValue * (ipByRole / 9) * pitchingEq.pwar_r_per_9) + ((ipByRole / 9) * pitchingEq.pwar_replacement_runs_per_9)) / pitchingEq.pwar_runs_per_win);

    return {
      p_era: roleAdjustedEra,
      p_fip: roleAdjustedFip,
      p_whip: roleAdjustedWhip,
      p_k9: roleAdjustedK9,
      p_bb9: roleAdjustedBb9,
      p_hr9: roleAdjustedHr9,
      p_rv_plus: pRvPlus,
      p_war: pWar,
      nil_valuation: null as number | null,
    };
  }, [pitchingEq, pitchingPrByNameTeam, pitchingStatsByNameTeam, selectedTeam, teamByKey, teamParkComponents]);

  const playerProjection = useCallback((p: BuildPlayer) => {
    const sim = p.roster_status === "target" ? simulateTransferProjection(p) : null;
    const shown = (p.roster_status === "target")
      ? (sim ?? p.transfer_snapshot ?? null)
      : (isPitcher(p) ? (computeReturnerPitchingProjection(p) ?? p.prediction) : p.prediction);
    if (isPitcher(p)) {
      const sourceBase: any = shown ?? p.transfer_snapshot ?? null;
      let source: any = sourceBase;
      if ((p.roster_status || "returner") === "target" && sourceBase) {
        const classTransitionRaw = String(p.class_transition || "SJ").toUpperCase();
        const classTransition: "FS" | "SJ" | "JS" | "GR" =
          classTransitionRaw === "FS" || classTransitionRaw === "SJ" || classTransitionRaw === "JS" || classTransitionRaw === "GR"
            ? classTransitionRaw
            : "SJ";
        const devAgg = Number.isFinite(Number(p.dev_aggressiveness)) ? Number(p.dev_aggressiveness) : 0;
        const classEraAdj = toPitchingClassAdj(classTransition, pitchingEq.class_era_fs, pitchingEq.class_era_sj, pitchingEq.class_era_js, pitchingEq.class_era_gr);
        const classFipAdj = toPitchingClassAdj(classTransition, pitchingEq.class_fip_fs, pitchingEq.class_fip_sj, pitchingEq.class_fip_js, pitchingEq.class_fip_gr);
        const classWhipAdj = toPitchingClassAdj(classTransition, pitchingEq.class_whip_fs, pitchingEq.class_whip_sj, pitchingEq.class_whip_js, pitchingEq.class_whip_gr);
        const classK9Adj = toPitchingClassAdj(classTransition, pitchingEq.class_k9_fs, pitchingEq.class_k9_sj, pitchingEq.class_k9_js, pitchingEq.class_k9_gr);
        const classBb9Adj = toPitchingClassAdj(classTransition, pitchingEq.class_bb9_fs, pitchingEq.class_bb9_sj, pitchingEq.class_bb9_js, pitchingEq.class_bb9_gr);
        const classHr9Adj = toPitchingClassAdj(classTransition, pitchingEq.class_hr9_fs, pitchingEq.class_hr9_sj, pitchingEq.class_hr9_js, pitchingEq.class_hr9_gr);
        const lowBetterMult = (adj: number) => 1 - adj - (devAgg * 0.06);
        const highBetterMult = (adj: number) => 1 + adj + (devAgg * 0.06);
        const fromRole = normalizePitcherRole(p.player?.position || null);
        const toRole = normalizePitcherRole(pitcherRoleFromSlot(p.position_slot) || p.player?.position || null);
        const roleCurve = {
          tier1Max: pitchingEq.rp_to_sp_low_better_tier1_max,
          tier2Max: pitchingEq.rp_to_sp_low_better_tier2_max,
          tier3Max: pitchingEq.rp_to_sp_low_better_tier3_max,
          tier1Mult: pitchingEq.rp_to_sp_low_better_tier1_mult,
          tier2Mult: pitchingEq.rp_to_sp_low_better_tier2_mult,
          tier3Mult: pitchingEq.rp_to_sp_low_better_tier3_mult,
        };
        const pEraBase = sourceBase?.p_era == null ? null : Number(sourceBase.p_era) * lowBetterMult(classEraAdj);
        const pFipBase = sourceBase?.p_fip == null ? null : Number(sourceBase.p_fip) * lowBetterMult(classFipAdj);
        const pWhipBase = sourceBase?.p_whip == null ? null : Number(sourceBase.p_whip) * lowBetterMult(classWhipAdj);
        const pK9Base = sourceBase?.p_k9 == null ? null : Number(sourceBase.p_k9) * highBetterMult(classK9Adj);
        const pBb9Base = sourceBase?.p_bb9 == null ? null : Number(sourceBase.p_bb9) * lowBetterMult(classBb9Adj);
        const pHr9Base = sourceBase?.p_hr9 == null ? null : Number(sourceBase.p_hr9) * lowBetterMult(classHr9Adj);
        const pEraAdj = applyRoleTransitionAdjustment(pEraBase, pitchingEq.sp_to_rp_reg_era_pct, fromRole, toRole, true, roleCurve);
        const pFipAdj = applyRoleTransitionAdjustment(pFipBase, pitchingEq.sp_to_rp_reg_fip_pct, fromRole, toRole, true, roleCurve);
        const pWhipAdj = applyRoleTransitionAdjustment(pWhipBase, pitchingEq.sp_to_rp_reg_whip_pct, fromRole, toRole, true, roleCurve);
        const pK9Adj = applyRoleTransitionAdjustment(pK9Base, pitchingEq.sp_to_rp_reg_k9_pct, fromRole, toRole, false, roleCurve);
        const pBb9Adj = applyRoleTransitionAdjustment(pBb9Base, pitchingEq.sp_to_rp_reg_bb9_pct, fromRole, toRole, true, roleCurve);
        const pHr9Adj = applyRoleTransitionAdjustment(pHr9Base, pitchingEq.sp_to_rp_reg_hr9_pct, fromRole, toRole, true, roleCurve);
        const eraPlus = calcPitchingPlus(pEraAdj, pitchingEq.era_plus_ncaa_avg, pitchingEq.era_plus_ncaa_sd, pitchingEq.era_plus_scale, false);
        const fipPlus = calcPitchingPlus(pFipAdj, pitchingEq.fip_plus_ncaa_avg, pitchingEq.fip_plus_ncaa_sd, pitchingEq.fip_plus_scale, false);
        const whipPlus = calcPitchingPlus(pWhipAdj, pitchingEq.whip_plus_ncaa_avg, pitchingEq.whip_plus_ncaa_sd, pitchingEq.whip_plus_scale, false);
        const k9Plus = calcPitchingPlus(pK9Adj, pitchingEq.k9_plus_ncaa_avg, pitchingEq.k9_plus_ncaa_sd, pitchingEq.k9_plus_scale, true);
        const bb9Plus = calcPitchingPlus(pBb9Adj, pitchingEq.bb9_plus_ncaa_avg, pitchingEq.bb9_plus_ncaa_sd, pitchingEq.bb9_plus_scale, false);
        const hr9Plus = calcPitchingPlus(pHr9Adj, pitchingEq.hr9_plus_ncaa_avg, pitchingEq.hr9_plus_ncaa_sd, pitchingEq.hr9_plus_scale, false);
        const pRvPlus = [eraPlus, fipPlus, whipPlus, k9Plus, bb9Plus, hr9Plus].every((v) => v != null)
          ? (Number(eraPlus) * pitchingEq.era_plus_weight) +
            (Number(fipPlus) * pitchingEq.fip_plus_weight) +
            (Number(whipPlus) * pitchingEq.whip_plus_weight) +
            (Number(k9Plus) * pitchingEq.k9_plus_weight) +
            (Number(bb9Plus) * pitchingEq.bb9_plus_weight) +
            (Number(hr9Plus) * pitchingEq.hr9_plus_weight)
          : (sourceBase?.p_rv_plus ?? sourceBase?.p_wrc_plus ?? null);
        source = {
          ...sourceBase,
          p_era: pEraAdj ?? sourceBase?.p_era ?? null,
          p_fip: pFipAdj ?? sourceBase?.p_fip ?? null,
          p_whip: pWhipAdj ?? sourceBase?.p_whip ?? null,
          p_k9: pK9Adj ?? sourceBase?.p_k9 ?? null,
          p_bb9: pBb9Adj ?? sourceBase?.p_bb9 ?? null,
          p_hr9: pHr9Adj ?? sourceBase?.p_hr9 ?? null,
          p_rv_plus: pRvPlus,
          p_wrc_plus: pRvPlus,
        };
      }
      const pwarComputed = computePitcherPwar(p, source);
      const pwar = pwarComputed ?? source?.p_war ?? source?.owar ?? null;
      return { sim, shown: source, shownWrc: source?.p_rv_plus ?? source?.p_wrc_plus ?? null, owar: pwar ?? 0, pwar };
    }
    const shownWrc = shown?.p_wrc_plus ?? null;
    const baseOwar = computeOWarFromWrcPlus(shownWrc) ?? p.nil_owar ?? 0;
    const owar = baseOwar * depthRoleMultiplier(p.depth_role);
    return { sim, shown, shownWrc, owar, pwar: null };
  }, [computePitcherPwar, computeReturnerPitchingProjection, simulateTransferProjection, pitchingEq]);

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
    if (isPitcher(p)) {
      const projection = playerProjection(p);
      const source: any = projection.shown ?? projection.sim ?? p.transfer_snapshot ?? p.prediction ?? null;
      const direct = source?.nil_valuation ?? null;
      if (Number.isFinite(Number(direct))) return Number(direct);
      const pwar = projection.pwar;
      if (!Number.isFinite(Number(pwar))) return 0;
      const currentPitcherRole = normalizePitcherRole(
        pitcherRoleFromSlot(p.position_slot) || p.player?.position || null,
      );
      const conference = selectedTeam
        ? (teamByKey.get(normalizeKey(selectedTeam))?.conference ?? p.player?.conference ?? null)
        : (p.player?.conference ?? null);
      const ptm = getProgramTierMultiplierByConference(conference, pitchingTierMultipliers);
      const pvm = pitchingPvfForRole(currentPitcherRole);
      return Number(pwar) * pitchingEq.market_dollars_per_war * ptm * pvm;
    }
    return projectedPlayerScore(p) * nilBasePerOWar;
  }, [nilBasePerOWar, pitchingEq.market_dollars_per_war, pitchingPvfForRole, pitchingTierMultipliers, projectedPlayerScore, playerProjection, selectedTeam, teamByKey]);
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
    let sumPEra = 0;
    let sumPWhip = 0;
    let sumPK9 = 0;
    let sumPBb9 = 0;
    let sumPRvPlus = 0;
    let weightPEra = 0;
    let weightPWhip = 0;
    let weightPK9 = 0;
    let weightPBb9 = 0;
    let weightPRvPlus = 0;

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
      if (isPitcher(p)) {
        const source: any = shown ?? ((p.roster_status === "target") ? p.transfer_snapshot : p.prediction) ?? null;
        const role = normalizePitcherRole(
          pitcherRoleFromSlot(p.position_slot) || p.player?.position || null,
        );
        const depthRole = normalizePitcherDepthRole(p.depth_role, role);
        const ipWeight = role === "SP"
          ? (depthRole === "weekday_starter" ? pitchingEq.pwar_ip_sm : pitchingEq.pwar_ip_sp)
          : pitchingEq.pwar_ip_rp;
        const pEra = source?.p_era ?? null;
        const pWhip = source?.p_whip ?? null;
        const pK9 = source?.p_k9 ?? null;
        const pBb9 = source?.p_bb9 ?? null;
        const pRvPlus = source?.p_rv_plus ?? source?.p_wrc_plus ?? null;
        if (pEra != null) {
          sumPEra += Number(pEra) * ipWeight;
          weightPEra += ipWeight;
        }
        if (pWhip != null) {
          sumPWhip += Number(pWhip) * ipWeight;
          weightPWhip += ipWeight;
        }
        if (pK9 != null) {
          sumPK9 += Number(pK9) * ipWeight;
          weightPK9 += ipWeight;
        }
        if (pBb9 != null) {
          sumPBb9 += Number(pBb9) * ipWeight;
          weightPBb9 += ipWeight;
        }
        if (pRvPlus != null) {
          sumPRvPlus += Number(pRvPlus) * ipWeight;
          weightPRvPlus += ipWeight;
        }
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
      pEraAvg: weightPEra > 0 ? sumPEra / weightPEra : null,
      pWhipAvg: weightPWhip > 0 ? sumPWhip / weightPWhip : null,
      pK9Avg: weightPK9 > 0 ? sumPK9 / weightPK9 : null,
      pBb9Avg: weightPBb9 > 0 ? sumPBb9 / weightPBb9 : null,
      pRvPlusAvg: weightPRvPlus > 0 ? sumPRvPlus / weightPRvPlus : null,
      totalOWar,
      totalActualNil,
      totalProjectedNil,
    };
  }, [isProjectedStatus, playerProjection, effectiveNilForPlayer, projectedNilForPlayer, pitchingEq]);
  const rosterTableTotals = useMemo(() => calcTotals(rosterPlayers), [calcTotals, rosterPlayers]);
  const positionTableTotals = useMemo(() => calcTotals(positionPlayers), [calcTotals, positionPlayers]);
  const pitcherTableTotals = useMemo(() => calcTotals(pitchers), [calcTotals, pitchers]);
  const targetPositionTableTotals = useMemo(() => calcTotals(targetPositionPlayers), [calcTotals, targetPositionPlayers]);
  const targetPitcherTableTotals = useMemo(() => calcTotals(targetPitchers), [calcTotals, targetPitchers]);

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
    const isPitcherRow = isPitcher(p);
    const currentPitcherRole = normalizePitcherRole(
      pitcherRoleFromSlot(p.position_slot) || p.player?.position || null,
    );
    const pitcherDepthRole = normalizePitcherDepthRole(p.depth_role, currentPitcherRole);
    const sim = isTarget ? simulateTransferProjection(p) : null;
    // For target players, show raw projected oWAR/NIL (no depth role multiplier) to match Transfer Portal
    const projectedOwar = isTarget ? (sim?.owar ?? null) : (projection.owar ?? null);
    const projectedPwar = isPitcherRow ? projection.pwar : null;
    const projectedNilRaw = isPitcherRow
      ? projectedNilForPlayer(p)
      : (isTarget
          ? (sim?.nil_valuation ?? p.transfer_snapshot?.nil_valuation ?? projectedNilForPlayer(p))
          : projectedNilForPlayer(p));
    const projectedNil = (() => {
      const n = Number(projectedNilRaw);
      if (Number.isFinite(n)) return n;
      const source: any = projection.shown ?? projection.sim ?? p.transfer_snapshot ?? null;
      const fallback = Number(source?.nil_valuation ?? 0);
      return Number.isFinite(fallback) ? fallback : 0;
    })();
    return (
    <TableRow key={globalIdx}>
      <TableCell className="font-medium">
        <div className="flex items-center gap-2">
          {p.player_id ? (
            <Link
              to={profileRouteFor(
                p.player_id,
                isPitcherRow
                  ? currentPitcherRole
                  : (p.position_slot || p.player?.position || null),
                p.player?.position || null,
              )}
              className="text-primary underline underline-offset-2 hover:opacity-80"
            >
              {getPlayerName(p)}
            </Link>
          ) : isPitcherRow ? (
            <Link
              to={storagePitcherRouteFor(getPlayerName(p), p.player?.team || null)}
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
            onValueChange={(v) => {
              if (v === "leaving") {
                const removedName = getPlayerName(p);
                setRosterPlayers((prev) => prev.filter((_, i) => i !== globalIdx));
                setDirty(true);
                toast({
                  title: "Removed from build",
                  description: `${removedName} was removed from this build only.`,
                });
                return;
              }
              updatePlayer(globalIdx, { roster_status: "returner" });
            }}
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
        {isPitcherRow ? (
          <Select
            value={currentPitcherRole}
            onValueChange={(v) => {
              const nextRole = v as "SP" | "RP";
              updatePlayer(globalIdx, {
                position_slot: nextRole,
                depth_role: normalizePitcherDepthRole(p.depth_role, nextRole),
              });
              if (p.player_id) {
                updatePlayerOverride(p.player_id, {
                  position: nextRole,
                  pitcher_role: nextRole,
                });
                writeLegacyPitchingRoleOverride(getPlayerName(p), p.player?.team || null, nextRole);
              }
            }}
          >
            <SelectTrigger className="w-20 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="SP">SP</SelectItem>
              <SelectItem value="RP">RP</SelectItem>
            </SelectContent>
          </Select>
        ) : (
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
        )}
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
        {isPitcherRow ? (
          <Select
            value={pitcherDepthRole}
            onValueChange={(v) =>
              updatePlayer(globalIdx, {
                depth_role: v as "weekend_starter" | "weekday_starter" | "high_leverage_reliever" | "low_impact_reliever",
              })
            }
          >
            <SelectTrigger className="w-[170px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {currentPitcherRole === "SP" ? (
                <>
                  <SelectItem value="weekend_starter">Weekend Starter</SelectItem>
                  <SelectItem value="weekday_starter">Weekday Starter</SelectItem>
                </>
              ) : (
                <>
                  <SelectItem value="high_leverage_reliever">High Leverage Reliever</SelectItem>
                  <SelectItem value="low_impact_reliever">Low Leverage Reliever</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        ) : (
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
        )}
      </TableCell>
      <TableCell className="text-center">
        {(() => {
          const isPitcherRow = isPitcher(p);
          const shown: any = projection.shown ?? null;
          if (isPitcherRow) {
            const source: any = shown ?? ((p.roster_status === "target") ? p.transfer_snapshot : p.prediction) ?? null;
            const pEra = source?.p_era ?? null;
            const pWhip = source?.p_whip ?? null;
            const pK9 = source?.p_k9 ?? null;
            const pBb9 = source?.p_bb9 ?? null;
            if (pEra == null && pWhip == null && pK9 == null && pBb9 == null) return "—";
            return (
              <span className="text-xs font-mono">
                {pEra != null ? Number(pEra).toFixed(2) : "—"} / {pWhip != null ? Number(pWhip).toFixed(2) : "—"} / {pK9 != null ? Number(pK9).toFixed(2) : "—"} / {pBb9 != null ? Number(pBb9).toFixed(2) : "—"}
              </span>
            );
          }
          const projected = (p.roster_status === "target")
            ? { p_avg: shown?.p_avg ?? null, p_obp: shown?.p_obp ?? null, p_slg: shown?.p_slg ?? null }
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
          const sim = projection.sim ?? null;
          const shown: any = projection.shown ?? null;
          const shownMetric = isPitcherRow
            ? ((p.roster_status === "target")
                ? (shown?.p_rv_plus ?? shown?.p_wrc_plus ?? sim?.p_rv_plus ?? p.transfer_snapshot?.p_rv_plus ?? p.transfer_snapshot?.p_wrc_plus ?? null)
                : (shown?.p_rv_plus ?? shown?.p_wrc_plus ?? (p.prediction as any)?.p_rv_plus ?? (p.prediction as any)?.p_wrc_plus ?? p.transfer_snapshot?.p_rv_plus ?? null))
            : ((p.roster_status === "target")
                ? (shown?.p_wrc_plus ?? sim?.p_wrc_plus ?? p.transfer_snapshot?.p_wrc_plus ?? null)
                : (p.prediction?.p_wrc_plus ?? null));
          return shownMetric != null ? shownMetric.toFixed(0) : "—";
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
      <TableCell className={`text-center font-mono text-xs ${(p.roster_status || "returner") === "leaving"
        ? "text-muted-foreground"
        : (isPitcherRow ? "text-foreground" : projectedNilTierClass(projectedNil, totalBudget, fallbackRosterTotalPlayerScore))}`}>
        {(p.roster_status || "returner") === "leaving"
          ? "—"
          : `$${Math.max(0, Math.round(Number.isFinite(Number(projectedNil)) ? Number(projectedNil) : 0)).toLocaleString()}`}
      </TableCell>
      <TableCell className="text-center font-mono text-xs">
        {(p.roster_status || "returner") === "leaving"
          ? "—"
          : (isPitcherRow
            ? (projectedPwar != null ? projectedPwar.toFixed(2) : "—")
            : (projectedOwar != null ? projectedOwar.toFixed(2) : "—"))}
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
                <p className="text-2xl font-bold">{rosterTableTotals.totalOWar.toFixed(2)}</p>
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
                        {positionTableTotals.avg != null && positionTableTotals.obp != null && positionTableTotals.slg != null
                          ? `${positionTableTotals.avg.toFixed(3)} / ${positionTableTotals.obp.toFixed(3)} / ${positionTableTotals.slg.toFixed(3)}`
                          : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        {positionTableTotals.wrcPlusAvg != null ? positionTableTotals.wrcPlusAvg.toFixed(0) : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        ${Math.round(positionTableTotals.totalActualNil).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        ${Math.round(positionTableTotals.totalProjectedNil).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">—</TableCell>
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
                      <TableHead>Role</TableHead>
                      <TableHead>Class Adj</TableHead>
                      <TableHead>Dev Agg</TableHead>
                      <TableHead>Depth</TableHead>
                      <TableHead className="text-center">pERA/pWHIP/pK/9/pBB/9</TableHead>
                      <TableHead className="text-center">pRV+</TableHead>
                      <TableHead className="text-center">Actual NIL ($)</TableHead>
                      <TableHead className="text-center">Projected NIL ($)</TableHead>
                      <TableHead className="text-center">pWAR</TableHead>
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
                        {pitcherTableTotals.pEraAvg != null && pitcherTableTotals.pWhipAvg != null && pitcherTableTotals.pK9Avg != null && pitcherTableTotals.pBb9Avg != null
                          ? `${pitcherTableTotals.pEraAvg.toFixed(2)} / ${pitcherTableTotals.pWhipAvg.toFixed(2)} / ${pitcherTableTotals.pK9Avg.toFixed(2)} / ${pitcherTableTotals.pBb9Avg.toFixed(2)}`
                          : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        {pitcherTableTotals.pRvPlusAvg != null ? pitcherTableTotals.pRvPlusAvg.toFixed(0) : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        ${Math.round(pitcherTableTotals.totalActualNil).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        ${Math.round(pitcherTableTotals.totalProjectedNil).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        {pitcherTableTotals.totalOWar.toFixed(2)}
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
                      {filteredTargetPlayerSearch.map((p, idx) => {
                        const stableKey = p.id
                          ? `db-${p.id}`
                          : `local-${normalizeName(`${p.first_name || ""} ${p.last_name || ""}`)}-${normalizeName(p.team || "")}-${normalizeName(p.position || "")}-${idx}`;
                        return (
                        <div
                          key={stableKey}
                          className="px-3 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground flex items-center justify-between gap-3"
                          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); void addPlayerFromTargetSearch(p); }}
                        >
                          <div className="min-w-0">
                            <div className="font-medium truncate">{p.first_name} {p.last_name}</div>
                            <div className="text-xs text-muted-foreground truncate">{p.team || "—"} • {p.position || "—"}</div>
                          </div>
                          <span className="text-[11px] px-2 py-0.5 rounded border border-border/70 text-muted-foreground shrink-0">
                            {p.position || "—"}
                          </span>
                        </div>
                        );
                      })}
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
                        {targetPositionTableTotals.avg != null && targetPositionTableTotals.obp != null && targetPositionTableTotals.slg != null
                          ? `${targetPositionTableTotals.avg.toFixed(3)} / ${targetPositionTableTotals.obp.toFixed(3)} / ${targetPositionTableTotals.slg.toFixed(3)}`
                          : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        {targetPositionTableTotals.wrcPlusAvg != null ? targetPositionTableTotals.wrcPlusAvg.toFixed(0) : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        ${Math.round(targetPositionTableTotals.totalActualNil).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        ${Math.round(targetPositionTableTotals.totalProjectedNil).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">—</TableCell>
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
                      <TableHead>Role</TableHead>
                      <TableHead>Class Adj</TableHead>
                      <TableHead>Dev Agg</TableHead>
                      <TableHead>Depth</TableHead>
                      <TableHead className="text-center">pERA/pWHIP/pK/9/pBB/9</TableHead>
                      <TableHead className="text-center">pRV+</TableHead>
                      <TableHead className="text-center">Actual NIL ($)</TableHead>
                      <TableHead className="text-center">Projected NIL ($)</TableHead>
                      <TableHead className="text-center">pWAR</TableHead>
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
                        {targetPitcherTableTotals.pEraAvg != null && targetPitcherTableTotals.pWhipAvg != null && targetPitcherTableTotals.pK9Avg != null && targetPitcherTableTotals.pBb9Avg != null
                          ? `${targetPitcherTableTotals.pEraAvg.toFixed(2)} / ${targetPitcherTableTotals.pWhipAvg.toFixed(2)} / ${targetPitcherTableTotals.pK9Avg.toFixed(2)} / ${targetPitcherTableTotals.pBb9Avg.toFixed(2)}`
                          : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        {targetPitcherTableTotals.pRvPlusAvg != null ? targetPitcherTableTotals.pRvPlusAvg.toFixed(0) : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        ${Math.round(targetPitcherTableTotals.totalActualNil).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        ${Math.round(targetPitcherTableTotals.totalProjectedNil).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-center py-2">
                        {targetPitcherTableTotals.totalOWar.toFixed(2)}
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
