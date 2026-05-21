import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import AnalyticsTab from "./team-builder/tabs/AnalyticsTab";
import RosterTab from "./team-builder/tabs/RosterTab";
import TargetBoardTab from "./team-builder/tabs/TargetBoardTab";
import DepthTab from "./team-builder/tabs/DepthTab";
import PlayerTableRow from "./team-builder/PlayerTableRow";
import { formatWithCommas, parseCommaNumber } from "@/lib/utils";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { applyTeamScopeFilter, pickPreferredPrediction } from "@/lib/teamScopedPredictions";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2 } from "lucide-react";
import { useTeamBuilderData, scorePredictionLikeDashboard } from "./team-builder/hooks/useTeamBuilderData";
import { useTeamBuilderSimulation } from "./team-builder/hooks/useTeamBuilderSimulation";
import {
  calcPlayerScore,
  DEFAULT_PROGRAM_TOTAL_PLAYER_SCORE,
  getProgramTierMultiplierByConference,
  getPositionValueMultiplier,
  DEFAULT_NIL_TIER_MULTIPLIERS,
} from "@/lib/nilProgramSpecific";
import { computeTransferProjection } from "@/lib/transferProjection";
import { computeHitterPowerRatings } from "@/lib/powerRatings";
import { recalculatePredictionById } from "@/lib/predictionEngine";
import { classTransitionFromYearOrDefault } from "@/lib/classTransitionUtils";
import { getConferenceAliases } from "@/lib/conferenceMapping";
import { profileRouteFor } from "@/lib/profileRoutes";
import { resolveMetricParkFactor, batsHandToHandedness } from "@/lib/parkFactors";
import { useEffectiveSchool } from "@/hooks/useEffectiveSchool";
// TeamWarSnapshot moved to AnalyticsTab
import { readPitchingWeights } from "@/lib/pitchingEquations";
import { computePitcherProjection } from "@/lib/pitcherProjection";
import { computeTransferPitcherProjection } from "@/lib/transferPitcherProjection";
import { TRANSFER_WEIGHT_DEFAULTS, transferWeightsForSource, JUCO_PITCHING_TRANSFER_WEIGHTS, JUCO_DISTRICT_HTP_OVERRIDE, JUCO_DISTRICT_CONFERENCE_ID, jucoDistrictNameFromConference, applyJucoOutlierRegression, JUCO_REGRESSION_CONFIG } from "@/lib/transferWeightDefaults";
import { assessHitterRisk, type RiskGrade } from "@/lib/playerRisk";

const POSITION_SLOTS = ["C", "1B", "2B", "SS", "3B", "LF", "CF", "RF", "DH"] as const;
const PITCHER_SLOTS = ["SP1", "SP2", "SP3", "SP4", "SP5", "RP1", "RP2", "RP3", "RP4", "CL"] as const;
const MAX_DEPTH = 3;
const DEV_AGGRESSIVENESS_OPTIONS = [0, 0.5, 1] as const;
// Per-team scoped draft key. Previously a single global key leaked one team's
// roster into other teams whenever a superadmin switched impersonation or a
// user logged in as a different customer (the restore effect ran with the
// previous team's payload). Each customer team now persists its own draft.
const TEAM_BUILDER_DRAFT_KEY_PREFIX = "team_builder_draft_v3";
const getDraftKey = (teamId: string | null | undefined): string | null =>
  teamId ? `${TEAM_BUILDER_DRAFT_KEY_PREFIX}::${teamId}` : null;
const LEGACY_PITCHING_ROLE_OVERRIDE_KEY = "pitching_role_overrides_v1";

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
  depth_role?: "cornerstone" | "everyday_starter" | "platoon_starter" | "utility" | "bench" | "starter" | "weekend_starter" | "weekday_starter" | "swing_starter" | "workhorse_reliever" | "high_leverage_reliever" | "mid_leverage_reliever" | "low_impact_reliever" | "specialist_reliever";
  class_transition?: string | null;
  dev_aggressiveness?: number | null;
  class_transition_overridden?: boolean;
  dev_aggressiveness_overridden?: boolean;
  // joined
  player?: {
    first_name: string;
    last_name: string;
    position: string | null;
    is_twp?: boolean | null;
    class_year?: string | null;
    throws_hand?: string | null;
    bats_hand?: string | null;
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
  id: string;
  name: string;
  conference: string | null;
  park_factor: number | null;
  conference_id?: string | null;
  source_team_id?: string | null;
};

type ConferenceRow = {
  conference: string;
  conference_id: string | null;
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
  division: string | null;
  source_player_id: string | null;
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

const teamMatchesSelectedTeam = (candidateTeam: string | null | undefined, selectedTeam: string | null | undefined) => {
  const candidate = (candidateTeam || "").trim();
  const selected = (selectedTeam || "").trim();
  if (!candidate || !selected) return false;

  const candidateVariants = teamNameVariants(candidate);
  const selectedVariants = teamNameVariants(selected);
  const selectedNorms = new Set(selectedVariants.map((v) => normalizeName(v)));

  for (const variant of candidateVariants) {
    const norm = normalizeName(variant);
    if (selectedNorms.has(norm)) return true;
  }

  return false;
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
  masterRows: Array<{ playerName: string; team: string | null; teamId?: string | null; throwHand: string | null; role: string | null; conference: string | null }> = [],
  selectedTeamId?: string | null,
): Array<{
  first_name: string;
  last_name: string;
  position: string | null;
  team: string | null;
  from_team: string | null;
  conference: string | null;
  role: "SP" | "RP" | null;
}> => {
  if (!teamName && !selectedTeamId) return [];
  const out: Array<{
    first_name: string;
    last_name: string;
    position: string | null;
    team: string | null;
    from_team: string | null;
    conference: string | null;
    role: "SP" | "RP" | null;
  }> = [];
  for (const r of masterRows) {
    const playerName = (r.playerName || "").trim();
    const rowTeam = (r.team || "").trim();
    if (!playerName || !rowTeam) continue;
    // ID-first: compare teamId if available, name fallback
    const teamMatch = (selectedTeamId && (r as any).teamId) ? (r as any).teamId === selectedTeamId : teamMatchesSelectedTeam(rowTeam, teamName);
    if (!teamMatch) continue;
    const hand = (r.throwHand || "").trim().toUpperCase();
    const roleRaw = (r.role || "").trim().toUpperCase();
    const role: "SP" | "RP" | null = roleRaw === "SP" || roleRaw === "RP" ? roleRaw : null;
    const position = hand === "RHP" || hand === "LHP" ? hand : (role || "P");
    const split = splitFullName(playerName);
    out.push({
      first_name: split.first,
      last_name: split.last,
      position,
      team: rowTeam,
      from_team: null,
      conference: r.conference || null,
      role,
    });
  }
  return out;
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
  depthRole: "cornerstone" | "everyday_starter" | "platoon_starter" | "utility" | "bench" | "starter" | "weekend_starter" | "weekday_starter" | "swing_starter" | "workhorse_reliever" | "high_leverage_reliever" | "mid_leverage_reliever" | "low_impact_reliever" | "specialist_reliever" | null;
  classTransition: string | null;
  devAggressiveness: number | null;
  classTransitionOverridden: boolean;
  devAggressivenessOverridden: boolean;
  transferSnapshot: TransferSnapshot | null;
  localPlayer: { first_name: string; last_name: string; position: string | null; team: string | null; from_team: string | null; conference: string | null } | null;
} => {
  if (!raw) return { notes: null, metrics: null, power: null, rosterStatus: null, depthRole: null, classTransition: null, devAggressiveness: null, classTransitionOverridden: false, devAggressivenessOverridden: false, transferSnapshot: null, localPlayer: null };
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
          obj.depthRole === "cornerstone" ||
          obj.depthRole === "everyday_starter" ||
          obj.depthRole === "platoon_starter" ||
          obj.depthRole === "starter" ||
          obj.depthRole === "utility" ||
          obj.depthRole === "bench" ||
          obj.depthRole === "weekend_starter" ||
          obj.depthRole === "weekday_starter" ||
          obj.depthRole === "swing_starter" ||
          obj.depthRole === "workhorse_reliever" ||
          obj.depthRole === "high_leverage_reliever" ||
          obj.depthRole === "mid_leverage_reliever" ||
          obj.depthRole === "low_impact_reliever" ||
          obj.depthRole === "specialist_reliever"
            ? obj.depthRole
            : null,
        classTransition: typeof obj.classTransition === "string" ? obj.classTransition : null,
        devAggressiveness: Number.isFinite(Number(obj.devAggressiveness)) ? Number(obj.devAggressiveness) : null,
        classTransitionOverridden: Boolean(obj.classTransitionOverridden),
        devAggressivenessOverridden: Boolean(obj.devAggressivenessOverridden),
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
  return { notes: raw, metrics: null, power: null, rosterStatus: null, depthRole: null, classTransition: null, devAggressiveness: null, classTransitionOverridden: false, devAggressivenessOverridden: false, transferSnapshot: null, localPlayer: null };
};

const serializeBuildPlayerMeta = (
  notes: string | null,
  metrics: TeamMetricInputs | null,
  power: TeamPowerPlus | null,
  rosterStatus: "returner" | "leaving" | "target" | null | undefined,
  depthRole: "cornerstone" | "everyday_starter" | "platoon_starter" | "utility" | "bench" | "starter" | "weekend_starter" | "weekday_starter" | "swing_starter" | "workhorse_reliever" | "high_leverage_reliever" | "mid_leverage_reliever" | "low_impact_reliever" | "specialist_reliever" | null | undefined,
  classTransition: string | null | undefined,
  devAggressiveness: number | null | undefined,
  classTransitionOverridden: boolean | null | undefined,
  devAggressivenessOverridden: boolean | null | undefined,
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
    classTransitionOverridden: Boolean(classTransitionOverridden),
    devAggressivenessOverridden: Boolean(devAggressivenessOverridden),
    transferSnapshot: transferSnapshot ?? null,
    localPlayer: localPlayer ?? null,
  });
};

const hasSystemPredictionStats = (p: BuildPlayer) =>
  p.prediction?.p_avg != null ||
  p.prediction?.p_obp != null ||
  p.prediction?.p_slg != null ||
  p.prediction?.p_wrc_plus != null;

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


const computeOWarFromWrcPlus = (wrcPlus: number | null | undefined, actualPa?: number | null) => {
  if (wrcPlus == null) return null;
  const pa = actualPa ?? 260;
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

// Hitter depth-role multipliers scale oWAR off the 260-PA everyday-starter
// baseline. Five tiers (quality-anchored — cornerstone gate uses overall_plus,
// the rest are pure PA volume buckets):
//   cornerstone        1.15  (3-4-5 hitter — overall_plus ≥ 115 AND PA ≥ 100)
//   everyday_starter   1.00  (PA ≥ 150 — baseline regular)
//   platoon_starter    0.70  (PA 50–149 — strong-side platoon)
//   utility            0.40  (PA 15–49 — multi-position sub)
//   bench              0.15  (PA < 15 — end-of-bench / development)
// Legacy "starter" maps to everyday_starter (1.0) for back-compat with old
// localStorage drafts before the 5-tier model existed.
// All pitcher roles → 1.0; pitcher granularity is baked into pitcherExpectedIp().
const depthRoleMultiplier = (role: BuildPlayer["depth_role"]) => {
  if (role === "cornerstone") return 1.15;
  if (role === "everyday_starter") return 1.0;
  if (role === "platoon_starter") return 0.7;
  if (role === "utility") return 0.4;
  if (role === "bench") return 0.15;
  // starter (legacy) + all pitcher roles → 1.0
  return 1.0;
};

// Infer default hitter depth tier from current-season PA. Pure playing-time
// buckets — quality is captured downstream in wRC+ inside the WAR formula, so
// the tier just sets the playing-time slice that scales projected oWAR off
// the 260-PA baseline. Calibrated against 2026 regular-season PAs (WAR is
// prorated regular-season-only); a true iron-man D1 hitter accrues ~245 PAs
// across ~55 regular-season games.
//   cornerstone:       PA ≥ 220   (~2 per team — plays nearly every game)
//   everyday_starter:  PA ≥ 130   (~6 per team — regular contributor)
//   platoon_starter:   PA 50–129  (~5 per team — strong-side platoon)
//   utility:           PA 15–49   (~3 per team — multi-position sub)
//   bench:             PA < 15    (~2 per team — end-of-bench, development)
const defaultHitterDepthRoleFromPa = (
  pa: number | null | undefined,
): "cornerstone" | "everyday_starter" | "platoon_starter" | "utility" | "bench" => {
  const paNum = Number(pa);
  const safePa = Number.isFinite(paNum) ? paNum : 0;
  if (safePa >= 220) return "cornerstone";
  if (safePa >= 130) return "everyday_starter";
  if (safePa >= 50) return "platoon_starter";
  if (safePa >= 15) return "utility";
  return "bench";
};

// Infer default depth_role tier from a pitcher's prior-year IP. Used at
// build-seeding time so newly added players land in the tier that matches
// what they actually did last year (coach can override). Thresholds tuned
// to D1 norms:
//   SP: 65+ IP weekend, 35-65 weekday, <35 swing
//   RP: 40+ workhorse, 25-40 high lev, 15-25 mid lev, 8-15 low impact, <8 specialist
// Falls back to role-based default if IP is missing/zero.
const defaultPitcherDepthRoleFromIp = (
  ip: number | null | undefined,
  role: "SP" | "RP",
): "weekend_starter" | "weekday_starter" | "swing_starter" | "workhorse_reliever" | "high_leverage_reliever" | "mid_leverage_reliever" | "low_impact_reliever" | "specialist_reliever" => {
  const ipNum = Number(ip);
  if (!Number.isFinite(ipNum) || ipNum <= 0) {
    return role === "SP" ? "weekend_starter" : "high_leverage_reliever";
  }
  if (role === "SP") {
    if (ipNum >= 65) return "weekend_starter";
    if (ipNum >= 35) return "weekday_starter";
    return "swing_starter";
  }
  if (ipNum >= 40) return "workhorse_reliever";
  if (ipNum >= 25) return "high_leverage_reliever";
  if (ipNum >= 15) return "mid_leverage_reliever";
  if (ipNum >= 8) return "low_impact_reliever";
  return "specialist_reliever";
};

// Per-tier expected IP for pitchers — replaces the old binary
// (pwar_ip_sp vs pwar_ip_sm vs pwar_ip_rp) lookup. Tuned to typical D1
// usage. Coaches can be more precise by picking the tier that matches
// the role's actual workload, not just SP/RP.
const pitcherExpectedIp = (
  depthRole: BuildPlayer["depth_role"],
  pitchingEq: { pwar_ip_sp: number; pwar_ip_sm: number; pwar_ip_rp: number },
): number => {
  switch (depthRole) {
    // Starters
    case "weekend_starter":     return pitchingEq.pwar_ip_sp;  // ~80 IP — Fri/Sat/Sun rotation
    case "weekday_starter":     return pitchingEq.pwar_ip_sm;  // ~50 IP — midweek SP
    case "swing_starter":       return 30;                     // long relief / spot start
    // Relievers — graduated by leverage + workload
    case "workhorse_reliever":  return 50;                     // closer/setup workhorse
    case "high_leverage_reliever": return 33;                  // primary setup
    case "mid_leverage_reliever":  return 20;                  // middle relief
    case "low_impact_reliever":    return 12;                  // mop-up
    case "specialist_reliever":    return 6;                   // LOOGY/situational
    default:                    return pitchingEq.pwar_ip_rp;  // fallback
  }
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
  if (v.startsWith("SP") || v === "STARTER" || v === "SM") return "SP";
  if (v.startsWith("RP") || v === "RELIEVER" || v === "CL" || v === "CLOSER") return "RP";
  return null;
};

// Resolve a pitcher role for the pitcher-pool render / pWAR compute. For
// traditional pitchers, this returns the explicit slot role (SP/RP). For TWPs
// whose `position_slot` is the hitter primary (e.g. "SS"), the slot does NOT
// disambiguate — so we fall back to the Pitching Master role (already derived
// from GS/G ratio in `pitchingMasterRows`) before defaulting to RP. Without
// this, a TWP-SS in the pitcher pool computes pWAR with the swingman IP
// projection, which is wrong for a player whose actual pitching profile is
// clearly a starter.
const effectivePitcherRoleForBuild = (
  p: BuildPlayer,
  pitchingMasterRole: string | null | undefined,
): "SP" | "RP" => {
  const slotRole = asPitcherRole(p.position_slot);
  if (slotRole) return slotRole;
  if (p.player?.is_twp) {
    const pmRole = asPitcherRole(pitchingMasterRole);
    if (pmRole) return pmRole;
    return "RP";
  }
  return asPitcherRole(p.player?.position ?? null) || asPitcherRole(pitchingMasterRole) || "RP";
};

type PitcherDepthRole =
  | "weekend_starter"
  | "weekday_starter"
  | "swing_starter"
  | "workhorse_reliever"
  | "high_leverage_reliever"
  | "mid_leverage_reliever"
  | "low_impact_reliever"
  | "specialist_reliever";

const isPitcherDepthRole = (role: BuildPlayer["depth_role"]): role is PitcherDepthRole =>
  role === "weekend_starter" || role === "weekday_starter" || role === "swing_starter" ||
  role === "workhorse_reliever" || role === "high_leverage_reliever" || role === "mid_leverage_reliever" ||
  role === "low_impact_reliever" || role === "specialist_reliever";

const normalizePitcherDepthRole = (
  role: BuildPlayer["depth_role"],
  pitcherRole: "SP" | "RP",
): PitcherDepthRole => {
  if (isPitcherDepthRole(role)) return role;
  // Hitter-tier → pitcher-tier conversion for TWPs whose primary side is the
  // pitcher. Map by usage band: cornerstone/everyday → top SP/RP, platoon →
  // mid, utility/bench → bottom.
  if (role === "cornerstone" || role === "everyday_starter" || role === "starter") {
    return pitcherRole === "SP" ? "weekend_starter" : "high_leverage_reliever";
  }
  if (role === "platoon_starter") {
    return pitcherRole === "SP" ? "weekday_starter" : "mid_leverage_reliever";
  }
  if (role === "utility") return pitcherRole === "SP" ? "weekday_starter" : "mid_leverage_reliever";
  if (role === "bench") return pitcherRole === "SP" ? "swing_starter" : "low_impact_reliever";
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
// Lifted to module scope so useEffect AND useCallback hooks can both reach it
// (was previously trapped inside a useEffect closure, which broke the
// resolveTeamBuilderPlayer codepath whenever pitcherOnly was set).
const isPitcherLike = (p: any) => /^(SP|RP|CL|P|LHP|RHP)/i.test(String(p?.position || ""));

// Multi-candidate park factor resolver — mirrors TransferPortal's behavior so
// pitcher targets resolve park factors via UUID first, then by team name with
// multiple normalization fallbacks (handles "UC Santa Barbara" vs "UCSB" vs
// "UC-Santa Barbara"). Without this, missing rate-specific parks zero out the
// transfer parkTerm and TB drifts from TP for the same pitcher.
const resolveTransferParkFactor = (
  teamId: string | null | undefined,
  names: Array<string | null | undefined>,
  metric: "avg" | "obp" | "iso" | "era" | "whip" | "hr9",
  map: any,
): number | null => {
  if (teamId) {
    const v = resolveMetricParkFactor(teamId, metric, map);
    if (v != null && Number.isFinite(v)) return v;
  }
  for (const name of names) {
    const v = resolveMetricParkFactor(null, metric, map, name);
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
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
// projectPitchingRate is imported from @/lib/pitcherProjection (consolidated
// 2026-05-05). TB calls it with fallbackToLastStat=true to preserve the
// previous behavior of carrying the season's actual rate forward when PR+
// inputs are missing rather than dropping the row.
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
  // 1) Supabase model_config is the authority
  const remote = remoteValues?.[key];
  if (Number.isFinite(remote)) return Number(remote);
  // 2) Canonical default from transferWeightDefaults
  const canonical = (TRANSFER_WEIGHT_DEFAULTS as Record<string, number>)[key];
  if (canonical !== undefined) return canonical;
  return fallback;
}

export default function TeamBuilder() {
  const { user, hasRole, effectiveTeamId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedBuildId, setSelectedBuildId] = useState<string | null>(null);
  const [nilEquationOpen, setNilEquationOpen] = useState(false);
  const [metricsUploadOpen, setMetricsUploadOpen] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<string>("");

  const {
    hitterStats, powerRatingsData, exitPositions,
    pitchingMasterRows, pitchingPowerEq, newConfStats,
    playerOverrideMap, playerOverrides, updatePlayerOverrideFn,
    getSupabaseRole, setSupabaseRole,
    teams, teamsByName, teamParkComponents,
    supabaseTargetBoard, removeFromSupabaseBoard, addToSupabaseBoard, isOnSupabaseBoard,
    selectedTeamRow, selectedTeamId,
    remoteEquationValues, allPlayersForSearch, hitterMasterPaMap,
    seasonUsage, builds, returners, returnersUpdatedAt,
  } = useTeamBuilderData({ effectiveTeamId, selectedTeam });
  const thinSampleMap = seasonUsage.thinSample;

  const isAdmin = hasRole("admin");
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const validTabs = new Set(["roster", "target-board", "compare", "depth", "analytics"]);
  const requestedTab = (searchParams.get("tab") || "").trim().toLowerCase();
  const initialTab = validTabs.has(requestedTab) ? requestedTab : "roster";
  // Controlled tab state mirrored to ?tab= so refresh/hard-refresh keeps the
  // user on the same view (and the URL becomes shareable). Without this the
  // Tabs component is uncontrolled and tab changes never reach the URL.
  const [activeTab, setActiveTab] = useState<string>(initialTab);
  const onTabChange = useCallback(
    (next: string) => {
      setActiveTab(next);
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === "roster") params.delete("tab");
          else params.set("tab", next);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const pitchingEq = useMemo(() => readPitchingWeights(), []);

  // Derive pitching conference plus-stats lookup from Supabase conference stats
  const pitchingConfLookup = useMemo(() => {
    const normConf = (c: string | null) => (c || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
    const eq = pitchingEq;
    const map = new Map<string, { conference: string; era_plus: number; fip_plus: number; whip_plus: number; k9_plus: number; bb9_plus: number; hr9_plus: number; hitter_talent_plus: number }>();
    for (const cs of newConfStats) {
      const toPlus = (value: number | null, ncaaAvg: number, ncaaSd: number, scale: number, higherIsBetter: boolean): number | null => {
        if (value == null || !Number.isFinite(value) || !Number.isFinite(ncaaAvg) || !Number.isFinite(ncaaSd) || ncaaSd === 0) return null;
        const core = higherIsBetter ? ((value - ncaaAvg) / ncaaSd) : ((ncaaAvg - value) / ncaaSd);
        const raw = 100 + (core * scale);
        return Number.isFinite(raw) ? raw : null;
      };
      const eraPlus = toPlus(cs.era, eq.era_plus_ncaa_avg, eq.era_plus_ncaa_sd, eq.era_plus_scale, false);
      const fipPlus = toPlus(cs.fip, eq.fip_plus_ncaa_avg, eq.fip_plus_ncaa_sd, eq.fip_plus_scale, false);
      const whipPlus = toPlus(cs.whip, eq.whip_plus_ncaa_avg, eq.whip_plus_ncaa_sd, eq.whip_plus_scale, false);
      const k9Plus = toPlus(cs.k9, eq.k9_plus_ncaa_avg, eq.k9_plus_ncaa_sd, eq.k9_plus_scale, true);
      const bb9Plus = toPlus(cs.bb9, eq.bb9_plus_ncaa_avg, eq.bb9_plus_ncaa_sd, eq.bb9_plus_scale, false);
      const hr9Plus = toPlus(cs.hr9, eq.hr9_plus_ncaa_avg, eq.hr9_plus_ncaa_sd, eq.hr9_plus_scale, false);
      if (eraPlus == null || fipPlus == null || whipPlus == null || k9Plus == null || bb9Plus == null || hr9Plus == null) continue;
      const stuffPlus = cs.stuff_plus ?? 100;
      const wrcPlus = cs.wrc_plus ?? 100;
      const overallPowerRating = cs.overall_power_rating ?? 100;
      const hitterTalentPlus = overallPowerRating + (1.25 * (stuffPlus - 100)) + (0.75 * (100 - wrcPlus));
      const entry = {
        conference: cs.conference,
        era_plus: Math.round(eraPlus),
        fip_plus: Math.round(fipPlus),
        whip_plus: Math.round(whipPlus),
        k9_plus: Math.round(k9Plus),
        bb9_plus: Math.round(bb9Plus),
        hr9_plus: Math.round(hr9Plus),
        hitter_talent_plus: Math.round(hitterTalentPlus * 10) / 10,
      };
      // Register under every alias so lookup hits regardless of which form
      // the team's `conference` string is stored in (e.g. SEC vs Southeastern
      // Conference). Mirrors how TransferPortal's pitchingConfByKey indexes.
      for (const alias of getConferenceAliases(cs.conference)) {
        if (alias && !map.has(alias)) map.set(alias, entry);
      }
      // Also key by conference_id UUID — canonical join key. JUCO districts
      // need this since their name normalization doesn't reach the alias map.
      if (cs.conference_id) map.set(cs.conference_id, entry);
    }
    return map;
  }, [newConfStats, pitchingEq]);

  const [buildName, setBuildName] = useState("My Team Build");
  const [totalBudget, setTotalBudget] = useState<number>(0);
  const [rosterPlayers, setRosterPlayers] = useState<BuildPlayer[]>([]);
  const [dirty, setDirty] = useState(false);
  const [programTierMultiplier, setProgramTierMultiplier] = useState<number>(1.2);
  const [programTierConference, setProgramTierConference] = useState<string>("");
  const [fallbackRosterTotalPlayerScore, setFallbackRosterTotalPlayerScore] = useState<number>(DEFAULT_PROGRAM_TOTAL_PLAYER_SCORE);
  const [depthAssignments, setDepthAssignments] = useState<Record<string, number>>({});
  const [depthPlaceholders, setDepthPlaceholders] = useState<Record<string, "freshman" | "transfer">>({});
  // Tracks the team the depth chart belongs to. When selectedTeam changes
  // (and isn't a load/restore), the team-change effect below clears the
  // depth chart so old indices don't re-bind to whoever happens to land at
  // that array position in the new team's roster. Restore paths
  // (loadBuild, draft restore) pre-set this ref to skip the clear.
  const lastDepthTeamRef = useRef<string | null>(null);
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
  // Tracks which effectiveTeamId the current in-memory Team Builder state
  // represents. Used to detect customer-team changes (impersonation switch,
  // sign-in as a different customer) and to suppress draft persistence
  // during the transition before the restore effect catches up.
  const stateTeamRef = useRef<string | null>(null);
  // Set true by the draft restore so the latest-build auto-load effect knows
  // to back off (an in-progress unsaved draft should win over the saved
  // build for the same team).
  const restoredFromDraftRef = useRef(false);

  useEffect(() => {
    setTeamSearchQuery(selectedTeam || "");
  }, [selectedTeam]);

  // When the user is impersonating a customer team (or has a default team),
  // auto-fill the team picker with that school. Replaces the old
  // DEMO_SCHOOL.name default. Only fires when no team is currently picked
  // and no build is loaded — never overrides an active selection.
  const { schoolName: effectiveSchoolName, allowAllTeams } = useEffectiveSchool();
  useEffect(() => {
    if (!effectiveSchoolName) return;
    if (selectedBuildId) return;
    if (selectedTeam) return;
    setSelectedTeam(effectiveSchoolName);
  }, [effectiveSchoolName, selectedBuildId, selectedTeam]);

  const eqNum = (key: string, fallback: number) => readLocalNum(key, fallback, remoteEquationValues);

  // Pitchers for target board search — derived from Pitching Master hook
  const storagePitchersForSearch = useMemo(() => {
    const out: any[] = [];
    for (let idx = 0; idx < pitchingMasterRows.length; idx++) {
      const r = pitchingMasterRows[idx];
      const playerName = (r.playerName || "").trim();
      const teamName = (r.team || "").trim();
      if (!playerName) continue;
      const split = splitFullName(playerName);
      const g = r.g != null ? Number(r.g) : null;
      const gs = r.gs != null ? Number(r.gs) : null;
      const roleRaw = toPitchingRole(r.role);
      const role = roleRaw === "SP" || roleRaw === "RP" ? roleRaw : (g != null && g > 0 && gs != null ? ((gs / g) < 0.5 ? "RP" : "SP") : "RP");
      out.push({
        id: r.id || `pm-pitcher-${normalizeName(playerName)}-${normalizeName(teamName)}-${idx}`,
        first_name: split.first,
        last_name: split.last,
        position: role,
        team: teamName || null,
        from_team: teamName || null,
        conference: r.conference || null,
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
      });
    }
    return out;
  }, [pitchingMasterRows]);
  const seedHittersForSearch = useMemo(() => {
    const teamConfByKey = new Map<string, string | null>();
    for (const t of teams as TeamRow[]) {
      teamConfByKey.set(normalizeKey(t.name), t.conference || null);
    }
    const rows = (hitterStats as SeedRow[]) || [];
    const powerByKey = new Map<string, TeamMetricInputs>();
    const powerRows = (powerRatingsData as Array<any>) || [];
    for (const pr of powerRows) {
      const metrics: TeamMetricInputs = {
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
      };
      // ID-first: index by source_player_id
      if (pr?.player_id) powerByKey.set(`sid:${pr.player_id}`, metrics);
      // Name|team fallback
      const key = `${normalizeName(pr?.playerName || "")}|${normalizeName(pr?.team || "")}`;
      if (key && key !== "|") powerByKey.set(key, metrics);
    }
    const out: any[] = [];
    const posMap = exitPositions as Record<string, string>;
    for (let idx = 0; idx < rows.length; idx += 1) {
      const r = rows[idx];
      const playerName = (r.playerName || "").trim();
      const teamName = (r.team || "").trim();
      if (!playerName || !teamName) continue;
      const split = splitFullName(playerName);
      const posKey = `${playerName}|${teamName}`;
      const position = posMap[posKey] || posMap[playerName] || null;
      // ID-first lookup, name|team fallback
      const seedMetrics = (r.player_id ? powerByKey.get(`sid:${r.player_id}`) : null) ?? powerByKey.get(`${normalizeName(playerName)}|${normalizeName(teamName)}`) ?? null;
      const seedPowerPlus = seedMetrics ? computeTeamPowerPlus(seedMetrics) : null;
      out.push({
        id: `seed-hitter-${normalizeName(playerName)}-${normalizeName(teamName)}-${idx}`,
        first_name: split.first,
        last_name: split.last,
        position,
        team: teamName,
        from_team: teamName,
        conference: teamConfByKey.get(normalizeKey(teamName)) || null,
        teamId: r.teamId ?? null,
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
  }, [teams, hitterStats, powerRatingsData, exitPositions]);


  const powerLookup = useMemo(() => {
    const map = new Map<string, any>();
    const rows = (powerRatingsData as Array<any>) || [];
    for (const pr of rows) {
      // ID-first: index by source_player_id
      if (pr?.player_id) map.set(`sid:${pr.player_id}`, pr);
      // Name|team fallback
      const key = `${normalizeName(pr?.playerName || "")}|${normalizeName(pr?.team || "")}`;
      if (key && key !== "|") map.set(key, pr);
      const nameOnly = normalizeName(pr?.playerName || "");
      if (nameOnly && !map.has(nameOnly)) map.set(nameOnly, pr);
    }
    return map;
  }, [powerRatingsData]);

  const combinedTargetSearchPlayers = useMemo(() => {
    const byKey = new Map<string, any>();
    const primaryKeyByNameTeam = new Map<string, string>();
    const isPitchLike = (p: any) => /^(SP|RP|CL|P|LHP|RHP)/i.test(String(p?.position || ""));
    const idKeyOf = (p: any) => (p?.id ? `id:${String(p.id).trim()}` : "");
    const nameTeamKeyOf = (p: any) => `${normalizeName(`${p.first_name} ${p.last_name}`)}|${normalizeName(p.team || "")}`;

    // Filter: only include players we have 2026 stats for. Predictions are
    // generated only from Hitter/Pitching Master rows, so requiring at least
    // one prediction with a non-null projection ensures we never surface
    // VA-portal-matched players whose production we don't actually track
    // (Ryan Brown, Connor Misch cases — they exist in `players` because
    // the portal CSV created a row, but we have no master data on them).
    const hasUsableProjection = (p: any) => {
      const preds = Array.isArray(p?.player_predictions) ? p.player_predictions : [];
      return preds.some((pr: any) => pr?.p_wrc_plus != null || pr?.p_rv_plus != null);
    };
    for (const p of allPlayersForSearch) {
      if (!hasUsableProjection(p)) continue;
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
          const fromTeamId = p.transfer_snapshot.from_team_id || null;
          const fromKey = normalizeName(p.transfer_snapshot.from_team || "");
          const candidates = allPlayersForSearch
            .filter((r: any) => isPitcherLike(r))
            .filter((r: any) => {
              if (!fromKey && !fromTeamId) return true;
              // ID-first: compare team_id if available
              if (fromTeamId && r.team_id) return r.team_id === fromTeamId;
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
            is_twp: (hit as any).is_twp ?? false,
            throws_hand: (hit as any).throws_hand ?? null,
            team: hit.team || null,
            from_team: hit.from_team || null,
            conference: hit.conference || null,
          },
        };
      });
      return changed ? next : prev;
    });
  }, [allPlayersByIdForHydration]);

  const conferenceStats: ConferenceRow[] = useMemo(() => {
    const byConf = new Map<string, { row: ConferenceRow; score: number }>();
    for (const raw of newConfStats) {
      const key = normalizeKey(raw.conference);
      if (!key) continue;
      const row: ConferenceRow = {
        conference: raw.conference,
        conference_id: raw.conference_id ?? null,
        season: raw.season,
        avg_plus: raw.avg != null ? Math.round((raw.avg / 0.280) * 100) : null,
        obp_plus: raw.obp != null ? Math.round((raw.obp / 0.385) * 100) : null,
        iso_plus: raw.iso != null ? Math.round((raw.iso / 0.162) * 100) : null,
        stuff_plus: raw.stuff_plus,
      };
      const score =
        (row.avg_plus != null ? 1 : 0) +
        (row.obp_plus != null ? 1 : 0) +
        (row.iso_plus != null ? 1 : 0) +
        (row.stuff_plus != null ? 1 : 0) +
        (row.season === 2026 ? 2 : 0);
      const existing = byConf.get(key);
      if (!existing || score > existing.score) {
        byConf.set(key, { row, score });
      }
    }
    return Array.from(byConf.values()).map((v) => v.row);
  }, [newConfStats]);

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

  const resolveTeamBuilderPlayer = useCallback((
    rawPlayerId: string | null | undefined,
    fullName: string | null | undefined,
    teamName: string | null | undefined,
    pitcherOnly: boolean | null = null,
  ) => {
    const normalizedId = typeof rawPlayerId === "string" ? rawPlayerId.trim() : rawPlayerId;
    if (normalizedId && allPlayersById.has(normalizedId)) return allPlayersById.get(normalizedId);

    const normalizedFullName = normalizeName(fullName || "");
    if (!normalizedFullName) return null;

    let candidates = allPlayersForSearch.filter((row: any) =>
      normalizeName(`${row.first_name || ""} ${row.last_name || ""}`) === normalizedFullName,
    );

    if (pitcherOnly === true) {
      candidates = candidates.filter((row: any) => isPitcherLike(row));
    } else if (pitcherOnly === false) {
      candidates = candidates.filter((row: any) => !isPitcherLike(row));
    }

    if (teamName) {
      const byTeam = candidates.filter((row: any) =>
        teamMatchesSelectedTeam(row.team || row.from_team || "", teamName),
      );
      if (byTeam.length === 1) return byTeam[0];
      if (byTeam.length > 1) candidates = byTeam;
    }

    if (candidates.length === 1) return candidates[0];
    return null;
  }, [allPlayersById, allPlayersForSearch]);

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
  const pitchingStatsByNameTeam = useMemo(() => {
    type PStatRec = { team: string | null; role: "SP" | "RP" | "SM" | null; era: number | null; fip: number | null; whip: number | null; k9: number | null; bb9: number | null; hr9: number | null; g: number | null; gs: number | null; ip: number | null };
    const byKey = new Map<string, PStatRec>();
    const byName = new Map<string, PStatRec[]>();
    const bySourceId = new Map<string, PStatRec>();
    const abbrToFull = new Map<string, string>();
    const fullToAbbr = new Map<string, string>();
    for (const t of teams) {
      if (t.abbreviation && t.fullName) {
        abbrToFull.set(normalizeName(t.abbreviation), normalizeName(t.fullName));
        fullToAbbr.set(normalizeName(t.fullName), normalizeName(t.abbreviation));
      }
    }
    const addRec = (name: string, team: string, rec: PStatRec, sourceId?: string | null) => {
      const nName = normalizeName(name);
      const nTeam = normalizeName(team);
      const key = `${nName}|${nTeam}`;
      if (!byKey.has(key)) byKey.set(key, rec);
      const altTeam = abbrToFull.get(nTeam) || fullToAbbr.get(nTeam);
      if (altTeam) {
        const altKey = `${nName}|${altTeam}`;
        if (!byKey.has(altKey)) byKey.set(altKey, rec);
      }
      const bucket = byName.get(nName) || [];
      bucket.push(rec);
      byName.set(nName, bucket);
      if (sourceId) bySourceId.set(sourceId, rec);
    };
    for (const r of pitchingMasterRows) {
      const name = (r.playerName || "").trim();
      const team = (r.team || "").trim();
      if (!name) continue;
      const rec = {
        team: team || null,
        role: toPitchingRole(r.role),
        era: r.era != null ? Number(r.era) : null,
        fip: r.fip != null ? Number(r.fip) : null,
        whip: r.whip != null ? Number(r.whip) : null,
        k9: r.k9 != null ? Number(r.k9) : null,
        bb9: r.bb9 != null ? Number(r.bb9) : null,
        hr9: r.hr9 != null ? Number(r.hr9) : null,
        g: r.g != null ? Number(r.g) : null,
        gs: r.gs != null ? Number(r.gs) : null,
        ip: r.ip != null ? Number(r.ip) : null,
      };
      addRec(name, team, rec, r.source_player_id);
    }
    return { byKey, byName, bySourceId };
  }, [pitchingMasterRows, teams]);

  const {
    teamByKey,
    selectedTeamSourceId, selectedTeamConference, selectedTeamFullName,
    pitchingPrByNameTeam,
    confByKey,
    seedByName, seedByPlayerId,
    liveTargetPredictionByPlayerId, liveTargetPlayerById, internalsByPredictionId,
    resolveConferenceStats,
    simulateTransferProjection,
    computePitcherPwar, computeReturnerPitchingProjection,
    playerProjection,
    projectedPlayerScore, projectedNilForPlayer, effectiveNilForPlayer,
    isProjectedStatus, projectedBudgetValue,
    calcTotals,
    rosterTableTotals, positionTableTotals, pitcherTableTotals,
    targetPositionTableTotals, targetPitcherTableTotals,
    hitterEligible, pitcherEligible,
    positionPlayers, pitchers, targetPositionPlayers, targetPitchers,
    totalEffectiveNil, totalRosterPlayerScore, budgetRemaining,
    pitchingTierMultipliers, pitchingPvfForRole,
  } = useTeamBuilderSimulation({
    teams, teamsByName, pitchingMasterRows, pitchingPowerEq, newConfStats,
    hitterStats, teamParkComponents, remoteEquationValues,
    pitchingEq, pitchingConfLookup, pitchingStatsByNameTeam,
    selectedTeam, effectiveTeamId,
    rosterPlayers, totalBudget, fallbackRosterTotalPlayerScore,
    programTierMultiplier,
    powerLookup,
  });

  const storagePitchersForSelectedTeam = useMemo(() => {
    if (!selectedTeam) return [] as BuildPlayer[];
    return readStoragePitcherLocalPlayers(selectedTeam, pitchingMasterRows, selectedTeamId).map((lp) => ({
      player_id: null,
      source: "returner",
      custom_name: null,
      position_slot: lp.role,
      depth_order: 1,
      nil_value: 0,
      production_notes: null,
      roster_status: "returner",
      depth_role: defaultPitcherDepthRoleFromIp(
        pitchingStatsByNameTeam.byKey.get(`${normalizeName(`${lp.first_name} ${lp.last_name}`.trim())}|${normalizeName(lp.team || "")}`)?.ip ?? null,
        lp.role === "SP" ? "SP" : "RP",
      ),
      class_transition: "SJ",
      dev_aggressiveness: 0,
      class_transition_overridden: false,
      dev_aggressiveness_overridden: false,
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
  }, [selectedTeam, pitchingMasterRows]);
  const seedHittersForSelectedTeam = useMemo(() => {
    if (!selectedTeam) return [] as BuildPlayer[];
    return seedHittersForSearch
      .filter((row: any) => {
        // ID-first: compare teamId if available
        if (selectedTeamId && row.teamId) return row.teamId === selectedTeamId;
        return teamMatchesSelectedTeam(row.team || "", selectedTeam);
      })
      .filter((row: any) => !/^(SP|RP|CL|P|LHP|RHP)/i.test(String(row.position || "")))
      .filter((row: any) => {
        const fullName = normalizeName(`${row.first_name || ""} ${row.last_name || ""}`);
        // Only exclude seed hitter if a DB player with the same name AND same team
        // has a returner prediction — i.e., they will appear in the `returners` query.
        // Must also verify the DB player's team matches the selected team so a same-name
        // player on a different team doesn't block the seed fallback.
        return !allPlayersForSearch.some((p: any) => {
          const dbFullName = normalizeName(`${p.first_name || ""} ${p.last_name || ""}`);
          const isPitcherRow = /^(SP|RP|CL|P|LHP|RHP)/i.test(String(p.position || ""));
          if (isPitcherRow || dbFullName !== fullName) return false;
          if (!teamMatchesSelectedTeam(p.team, selectedTeam)) return false;
          const preds = Array.isArray(p.player_predictions) ? p.player_predictions : [];
          return preds.some((pr: any) => pr.model_type === "returner" && pr.variant === "regular" && (pr.status === "active" || pr.status === "departed"));
        });
      })
      .map((row: any) => ({
        player_id: isUuid(row.id) ? row.id : null,
        source: "returner" as const,
        custom_name: null,
        position_slot: null,
        depth_order: 1,
        nil_value: 0,
        production_notes: null,
        roster_status: "returner" as const,
        depth_role: "everyday_starter" as const,
        class_transition: "SJ",
        dev_aggressiveness: 0,
        class_transition_overridden: false,
        dev_aggressiveness_overridden: false,
        transfer_snapshot: null,
        player: {
          first_name: row.first_name,
          last_name: row.last_name,
          position: row.position,
          team: row.team,
          from_team: row.from_team,
          conference: row.conference ?? null,
        },
        prediction: row.__seedStats
          ? {
              id: null,
              from_avg: row.__seedStats.avg ?? null,
              from_obp: row.__seedStats.obp ?? null,
              from_slg: row.__seedStats.slg ?? null,
              p_avg: row.__seedStats.avg ?? null,
              p_obp: row.__seedStats.obp ?? null,
              p_slg: row.__seedStats.slg ?? null,
              p_ops:
                row.__seedStats.obp != null && row.__seedStats.slg != null
                  ? Number(row.__seedStats.obp) + Number(row.__seedStats.slg)
                  : null,
              p_wrc_plus: null,
              power_rating_plus: row.__seedPowerPlus?.overallPlus ?? null,
              class_transition: "SJ",
              dev_aggressiveness: 0,
              model_type: "returner",
              status: "active",
            }
          : null,
        nilVal: null,
        nil_owar: null,
        team_metrics: null,
        team_power_plus: row.__seedPowerPlus ?? null,
      }));
  }, [allPlayersForSearch, seedHittersForSearch, selectedTeam]);

  // Load a saved build
  const loadBuild = useCallback(async (buildId: string) => {
    const build = builds.find((b) => b.id === buildId);
    if (!build) return;
    setSelectedBuildId(buildId);
    setBuildName(build.name);
    // Pre-record the team in the depth-clear ref so the team-change effect
    // doesn't wipe the depth chart we're about to restore. The effect
    // compares lastDepthTeamRef.current vs the new selectedTeam; matching
    // them here makes it a no-op for this load.
    lastDepthTeamRef.current = build.team || null;
    // Suppress the next auto-seed pass — loadBuild has already supplied the
    // returner+target rows from the saved build. Without this guard, the
    // returners query refetches when selectedTeam changes and the auto-seed
    // effect wipes the loaded roster, replacing it with fresh defaults.
    skipAutoSeedOnceRef.current = true;
    autoSeededTeamRef.current = normalizeName(build.team || "");
    setSelectedTeam(build.team);
    setTotalBudget(Number(build.total_budget) || 0);
    const savedDepthAssignments =
      build.depth_assignments && typeof build.depth_assignments === "object" && !Array.isArray(build.depth_assignments)
        ? (build.depth_assignments as Record<string, number>)
        : {};
    const savedDepthPlaceholders =
      build.depth_placeholders && typeof build.depth_placeholders === "object" && !Array.isArray(build.depth_placeholders)
        ? (build.depth_placeholders as Record<string, "freshman" | "transfer">)
        : {};
    setDepthAssignments(savedDepthAssignments);
    setDepthPlaceholders(savedDepthPlaceholders);

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
      let predictionMap: Record<string, any> = {};
      if (playerIds.length > 0) {
        const { data: pData, error: pErr } = await supabase
          .from("players")
          .select(`
            id, first_name, last_name, position, is_twp, class_year, throws_hand, bats_hand, team, from_team, conference,
            player_predictions(id, from_avg, from_obp, from_slg, from_era, from_fip, from_whip, from_k9, from_bb9, from_hr9, p_avg, p_obp, p_slg, p_ops, p_iso, p_wrc_plus, p_era, p_fip, p_whip, p_k9, p_bb9, p_hr9, p_rv_plus, pitcher_role, power_rating_plus, class_transition, dev_aggressiveness, model_type, status, variant, updated_at),
            nil_valuations(estimated_value, component_breakdown)
          `)
          .in("id", playerIds);
        if (pErr) {
          console.error("TeamBuilder loadBuild players fetch failed:", pErr);
        }
        (pData ?? []).forEach((p) => {
          playerMap[p.id] = p;
        });

        let predQuery = supabase
          .from("player_predictions")
          .select("id, player_id, customer_team_id, from_avg, from_obp, from_slg, from_era, from_fip, from_whip, from_k9, from_bb9, from_hr9, p_avg, p_obp, p_slg, p_ops, p_iso, p_wrc_plus, p_era, p_fip, p_whip, p_k9, p_bb9, p_hr9, p_rv_plus, pitcher_role, power_rating_plus, class_transition, dev_aggressiveness, model_type, status, variant, updated_at")
          .in("player_id", playerIds)
          .in("variant", ["regular", "precomputed"])
          .in("status", ["active", "departed"]);
        predQuery = applyTeamScopeFilter(predQuery as any, effectiveTeamId);
        const { data: predData, error: predErr } = await predQuery;
        if (predErr) {
          console.error("TeamBuilder loadBuild predictions fetch failed:", predErr);
        }
        const grouped = new Map<string, any[]>();
        for (const row of predData || []) {
          const pid = String(row.player_id || "");
          if (!pid) continue;
          const list = grouped.get(pid) || [];
          list.push(row);
          grouped.set(pid, list);
        }
        for (const [pid, rows] of grouped.entries()) {
          const player = playerMap[pid];
          if (!player) continue;
          // Prefer team-scoped precomputed row when active team has one (so
          // saved builds for a customer team reflect their tuned equation),
          // else fall back to the existing best-of-regular picker.
          const teamScoped = pickPreferredPrediction(rows as any[], effectiveTeamId);
          if (teamScoped && (teamScoped as any).customer_team_id === effectiveTeamId) {
            predictionMap[pid] = teamScoped;
            continue;
          }
          const preds = rows.filter((r: any) => r.variant === "regular" && (r.status === "active" || r.status === "departed"));
          if (preds.length === 0) continue;
          let best = preds[0];
          for (const row of preds) {
            if (!best) { best = row; continue; }
            const rowScore = scorePredictionLikeDashboard(row, false);
            const bestScore = scorePredictionLikeDashboard(best, false);
            if (rowScore > bestScore) best = row;
            else if (rowScore === bestScore) {
              if (new Date(row.updated_at || 0).getTime() > new Date(best.updated_at || 0).getTime()) best = row;
            }
          }
          predictionMap[pid] = best;
        }
      }

      const fallbackPitchers = readStoragePitcherLocalPlayers(build.team || selectedTeam || "", pitchingMasterRows, selectedTeamId);
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
        players.map((bp: any) => {
          try {
          const meta = parseBuildPlayerMeta(bp.production_notes);
          const fallbackName = (() => {
            if (bp.custom_name && bp.custom_name.trim()) return bp.custom_name.trim();
            if (meta.notes && meta.notes.trim()) return meta.notes.trim();
            if (!meta.localPlayer) return null;
            const full = `${meta.localPlayer.first_name || ""} ${meta.localPlayer.last_name || ""}`.trim();
            return full || null;
          })();
          const fallbackTeam = meta.localPlayer?.team ?? build.team ?? selectedTeam ?? null;
          const fallbackPosition = meta.localPlayer?.position ?? bp.position_slot ?? null;
          const fallbackPitcherLike = /^(SP|RP|CL|P|LHP|RHP)/i.test(String(fallbackPosition || ""));
          const normalizedPlayerIdRaw = typeof bp.player_id === "string" ? bp.player_id.trim() : bp.player_id;
          const recoveredPlayer = !normalizedPlayerIdRaw && fallbackName
            ? resolveTeamBuilderPlayer(
                null,
                fallbackName,
                fallbackTeam,
                fallbackPitcherLike ? true : false,
              )
            : null;
          const normalizedPlayerId = normalizedPlayerIdRaw || recoveredPlayer?.id || null;
          const pd = normalizedPlayerId ? (playerMap[normalizedPlayerId] || recoveredPlayer || null) : null;
          const activePred = normalizedPlayerId ? (predictionMap[normalizedPlayerId] ?? null) : null;
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
          const overrideRole = asPitcherRole(pd?.id ? (getSupabaseRole(pd.id) || null) : null);
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
          const resolvedName = fallbackName
            || (resolvedLocalPlayer ? `${resolvedLocalPlayer.first_name || ""} ${resolvedLocalPlayer.last_name || ""}`.trim() || null : null)
            || (pd ? `${pd.first_name || ""} ${pd.last_name || ""}`.trim() || null : null);
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
            // depth_role recomputed from current PA/IP for hitters. Saved
            // builds from before 2026-05-20 baked in "bench" for hitters
            // when seasonUsage was empty at save time; that stale value
            // would persist forever otherwise. PA-based recompute fixes
            // load-time bench-reversion. Pitcher recompute from IP also
            // keeps the latest reality. Saved meta.depthRole used only
            // as a final fallback when neither PA nor IP is available.
            depth_role: (() => {
              if (isPitcherRow) {
                const ip = (pd?.source_player_id ? pitchingStatsByNameTeam.bySourceId.get(pd.source_player_id)?.ip : null) ?? null;
                if (ip != null) {
                  return defaultPitcherDepthRoleFromIp(ip, (inferredRole === "SP") ? "SP" : "RP");
                }
                return meta.depthRole ?? defaultPitcherDepthRoleFromIp(null, (inferredRole === "SP") ? "SP" : "RP");
              }
              // Hitter: PA-based tier from current seasonUsage. Falls back
              // to meta.depthRole only if usage hasn't loaded yet.
              const hNameKey = pd ? `${normalizeName(`${pd.first_name || ""} ${pd.last_name || ""}`.trim())}|${normalizeName(pd.team || "")}` : null;
              const hitterAb = (pd?.id ? seasonUsage.hitterAb?.get(pd.id) : null) ?? (hNameKey ? seasonUsage.hitterAbByNameTeam?.get(hNameKey) : null) ?? null;
              if (hitterAb != null && hitterAb > 0) {
                return defaultHitterDepthRoleFromPa(hitterAb);
              }
              return meta.depthRole ?? "everyday_starter";
            })(),
            class_transition: meta.classTransitionOverridden ? (meta.classTransition ?? "SJ") : (activePred?.class_transition ?? "SJ"),
            dev_aggressiveness: meta.devAggressivenessOverridden ? (meta.devAggressiveness ?? 0) : (activePred?.dev_aggressiveness ?? 0),
            class_transition_overridden: meta.classTransitionOverridden,
            dev_aggressiveness_overridden: meta.devAggressivenessOverridden,
            transfer_snapshot: meta.transferSnapshot ?? null,
            player: pd
              ? {
                  first_name: pd.first_name,
                  last_name: pd.last_name,
                  position: pd.position,
                  is_twp: (pd as any).is_twp ?? false,
                  class_year: (pd as any).class_year ?? null,
                  throws_hand: (pd as any).throws_hand ?? null,
                  bats_hand: (pd as any).bats_hand ?? null,
                  team: pd.team,
                  from_team: pd.from_team,
                  conference: pd.conference ?? null,
                }
              : (resolvedLocalPlayer || null),
            prediction: activePred ?? null,
            nilVal: pd?.nil_valuations?.[0]?.estimated_value ?? null,
            nil_owar: pd?.nil_valuations?.[0]?.component_breakdown?.ncaa_owar ?? null,
            team_metrics: meta.metrics,
            team_power_plus: meta.power,
          };
          } catch (err) {
            // Per-row data-quality warning — noisy in prod when a saved build
            // has any malformed players. Keep visible in dev to flag bad rows.
            if (import.meta.env.DEV) {
              console.warn("[TeamBuilder] Failed to process roster player:", err, bp);
            }
            return null;
          }
        }).filter(Boolean) as any[]);
    }
    setDirty(false);
  }, [builds, playerOverrides, allPlayersForSearch, selectedTeam, resolveTeamBuilderPlayer]);

  // Auto-load roster when team changes and it's a new build.
  // Single source: Supabase players table via the returners query.
  useEffect(() => {
    if (!selectedTeam || selectedBuildId) return;
    if (skipAutoSeedOnceRef.current) {
      skipAutoSeedOnceRef.current = false;
      return;
    }
    const selectedTeamKey = normalizeName(selectedTeam);
    // Include seasonUsage load state so the effect re-runs once the playing-time
    // maps populate after the initial seed (which may have happened with empty maps).
    const seedKey = `${selectedTeamKey}|usage:${(seasonUsage.hitterAbByNameTeam?.size ?? 0) > 0 ? "loaded" : "empty"}`;
    if (autoSeededTeamRef.current === seedKey) return;
    // Wait for the query to have actually fetched data for this team
    if (returnersUpdatedAt === 0) return;

    const roster: BuildPlayer[] = returners.map((r: any) => {
      const player = r.players;
      if (!player) return null;
      // TWP (two-way) defaults to hitter side on the team builder — coaches
      // can click into the profile to see the pitching view.
      const isPitcherRow = /^(SP|RP|CL|P|LHP|RHP)$/i.test(String(player.position || ""));
      const overrideRole = asPitcherRole(getSupabaseRole(player.id) || null);
      // Check Pitching Master Role for accurate SP/RP from last season
      const _pName = `${player.first_name || ""} ${player.last_name || ""}`.trim();
      const _pmKey = `${normalizeName(_pName)}|${normalizeName(player.team || "")}`;
      const _pmSid = player.source_player_id || null;
      const pmRec = pitchingStatsByNameTeam.byKey.get(_pmKey)
        || (_pmSid ? pitchingStatsByNameTeam.bySourceId.get(_pmSid) : null)
        || (() => { const b = pitchingStatsByNameTeam.byName.get(normalizeName(_pName)) || []; return b.length >= 1 ? b[0] : null; })();
      const pmRole = asPitcherRole(pmRec?.role ?? null);
      // Pitcher role seed: coach override wins; otherwise derive from GS/G with
      // the "5 starts minimum" floor so a pitcher who made 2 emergency starts
      // doesn't get tagged as a starter. pmRole is ignored when there's enough
      // GS/G signal because stored Role can lag reality.
      const seedPitcherGs = seasonUsage.pitcherGs.get(player.id) ?? pmRec?.gs ?? 0;
      const seedPitcherG = seasonUsage.pitcherG.get(player.id) ?? pmRec?.g ?? 0;
      const seedIsStarter = seedPitcherGs >= 5 && seedPitcherG > 0 && (seedPitcherGs / seedPitcherG) >= 0.5;
      const inferredRole: "SP" | "RP" | "SM" = overrideRole || (seedPitcherG > 0 ? (seedIsStarter ? "SP" : "RP") : (pmRole || asPitcherRole(player.position || null) || "RP"));
      // Hitter role seed: 5-tier pure-PA model (defaultHitterDepthRoleFromPa).
      // Falls back to name+team lookup when source_player_id doesn't reconcile.
      const _hNameKey = `${normalizeName(`${player.first_name || ""} ${player.last_name || ""}`.trim())}|${normalizeName(player.team || "")}`;
      const seedHitterAb = seasonUsage.hitterAb?.get(player.id) ?? seasonUsage.hitterAbByNameTeam?.get(_hNameKey) ?? 0;
      const seedHitterDepth = defaultHitterDepthRoleFromPa(seedHitterAb);
      return {
        player_id: player.id,
        source: "returner" as const,
        custom_name: null,
        position_slot: isPitcherRow ? (inferredRole || "RP") : (playerOverrides[player.id]?.position ?? null),
        depth_order: 1,
        nil_value: 0,
        production_notes: null,
        roster_status: "returner" as const,
        depth_role: isPitcherRow
          ? defaultPitcherDepthRoleFromIp(pmRec?.ip ?? null, (inferredRole === "SP") ? "SP" : "RP")
          : seedHitterDepth,
        class_transition: r.class_transition ?? "SJ",
        dev_aggressiveness: r.dev_aggressiveness ?? 0,
        class_transition_overridden: false,
        dev_aggressiveness_overridden: false,
        transfer_snapshot: null,
        player: {
          first_name: player.first_name,
          last_name: player.last_name,
          position: player.position,
          is_twp: (player as any).is_twp ?? false,
          class_year: (player as any).class_year ?? null,
          throws_hand: (player as any).throws_hand ?? null,
          bats_hand: (player as any).bats_hand ?? null,
          team: player.team,
          from_team: player.from_team,
          conference: player.conference ?? null,
          source_player_id: player.source_player_id ?? null,
        },
        prediction: r ?? null,
        nilVal: null,
        nil_owar: null,
        team_metrics: null,
        team_power_plus: null,
      };
    }).filter(Boolean) as BuildPlayer[];

    if (roster.length > 0 || autoSeededTeamRef.current !== seedKey) {
      // Preserve any non-returner rows (especially "target" rows synced from
      // the Supabase target board) so the returners load doesn't wipe a player
      // the user just added from the player profile page. Returners are
      // re-seeded from this effect; targets/portal/manual entries are kept.
      setRosterPlayers((prev) => {
        // Stable-merge so array indices don't shift on re-seed. depthAssignments
        // keys by array index, so any reorder rebinds the wrong player to a
        // depth slot. Strategy: walk `prev` in order, swap each returner row
        // for its refreshed counterpart from `roster` (matched by player_id),
        // append any returners not yet in prev, and keep non-returner rows
        // (targets/portal/manual) at their existing positions.
        const rosterByPid = new Map<string, BuildPlayer>();
        for (const r of roster) {
          if (r.player_id) rosterByPid.set(r.player_id, r);
        }
        const seenPids = new Set<string>();
        const merged: BuildPlayer[] = prev.map((p) => {
          if ((p.roster_status || "returner") !== "returner") return p;
          if (!p.player_id) return p;
          const refreshed = rosterByPid.get(p.player_id);
          if (!refreshed) return p; // no longer a returner in fresh data — keep as-is
          seenPids.add(p.player_id);
          return refreshed;
        });
        const appended = roster.filter((r) => r.player_id && !seenPids.has(r.player_id));
        return [...merged, ...appended];
      });
      autoSeededTeamRef.current = seedKey;
    }
  }, [returners, returnersUpdatedAt, selectedTeam, selectedBuildId, playerOverrides, seasonUsage]);

  // Saved-build depth-role corrective. The main auto-seed effect bails when a
  // saved build is loaded (selectedBuildId truthy), so it can't recompute
  // depth_role when seasonUsage transitions empty→loaded. Result: builds
  // saved before seasonUsage cached had hitters baked in as "bench" forever,
  // even after PA data caught up. This effect catches that case: when usage
  // loads AND we have a saved build in state, walk the returner rows and
  // refresh hitter depth_role from current PA. Runs once per seasonUsage
  // load (gated by ref).
  const usageCorrectedBuildRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedBuildId) return;
    if (!(seasonUsage.hitterAbByNameTeam?.size > 0)) return;
    if (usageCorrectedBuildRef.current === selectedBuildId) return;
    usageCorrectedBuildRef.current = selectedBuildId;
    // Update depth_role from current-season PA so WAR calculations stay
    // accurate. Do NOT touch depthAssignments — the auto-fill effect already
    // skips filled slots, so manual assignments (and the coach's starter
    // lineup) stay exactly where they are even when the underlying tier
    // changes. Clearing assignments caused "starters moving to bench" when
    // a corrected player's old slot got filled by someone else before they
    // could be re-placed.
    setRosterPlayers((prev) => prev.map((p) => {
      if (!p.player) return p;
      if ((p.roster_status || "returner") !== "returner") return p;
      const isPitcherRow = /^(SP|RP|CL|P|LHP|RHP)/i.test(String(p.player.position || ""));
      if (isPitcherRow) return p;
      const hNameKey = `${normalizeName(`${p.player.first_name || ""} ${p.player.last_name || ""}`.trim())}|${normalizeName(p.player.team || "")}`;
      const playerIdHit = p.player_id ? seasonUsage.hitterAb?.get(p.player_id) : null;
      const hitterAb = playerIdHit ?? seasonUsage.hitterAbByNameTeam?.get(hNameKey) ?? null;
      if (hitterAb == null || hitterAb <= 0) return p;
      const recomputed = defaultHitterDepthRoleFromPa(hitterAb);
      if (recomputed === p.depth_role) return p;
      return { ...p, depth_role: recomputed };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBuildId, seasonUsage]);

  // Restore unsaved Team Builder draft on mount or whenever the active
  // customer team changes (login, sign-out, or superadmin impersonation
  // switch). Per-team scoped key so one team's draft never leaks into
  // another team's view.
  useEffect(() => {
    if (!effectiveTeamId) {
      stateTeamRef.current = null;
      restoredFromDraftRef.current = false;
      return;
    }
    if (stateTeamRef.current === effectiveTeamId) return;

    // Team changed (or first mount with a team). Clear in-memory state so
    // the previous team's roster/build never lingers, then attempt to
    // restore this team's draft.
    setSelectedBuildId(null);
    setBuildName("My Team Build");
    setSelectedTeam("");
    setRosterPlayers([]);
    setDirty(false);
    setDepthAssignments({});
    setDepthPlaceholders({});
    autoSeededTeamRef.current = "";
    restoredFromDraftRef.current = false;

    try {
      const draftKey = getDraftKey(effectiveTeamId);
      const raw = draftKey ? localStorage.getItem(draftKey) : null;
      if (raw) {
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
          depthAssignments?: Record<string, number>;
          depthPlaceholders?: Record<string, "freshman" | "transfer">;
        };
        if (draft) {
          if (!draft.selectedTeam) {
            // Empty draft (written before the persist guard was added). Purge
            // it so the auto-load effect can default to the most-recent build.
            if (draftKey) localStorage.removeItem(draftKey);
          } else {
            setSelectedBuildId(draft.selectedBuildId ?? null);
            setBuildName(draft.buildName ?? "My Team Build");
            setSelectedTeam(draft.selectedTeam ?? "");
            setTotalBudget(Number(draft.totalBudget) || 0);
            setRosterPlayers(Array.isArray(draft.rosterPlayers) ? draft.rosterPlayers : []);
            setProgramTierMultiplier(Number(draft.programTierMultiplier) || 1.2);
            setProgramTierConference(draft.programTierConference ?? "");
            setFallbackRosterTotalPlayerScore(Number(draft.fallbackRosterTotalPlayerScore) || DEFAULT_PROGRAM_TOTAL_PLAYER_SCORE);
            setDirty(false);
            if (draft.depthAssignments) setDepthAssignments(draft.depthAssignments);
            if (draft.depthPlaceholders) setDepthPlaceholders(draft.depthPlaceholders);
            skipAutoSeedOnceRef.current = true;
            autoSeededTeamRef.current = normalizeName(draft.selectedTeam);
            restoredFromDraftRef.current = true;
          }
        }
      }
    } catch {
      // ignore invalid draft payloads
    }

    stateTeamRef.current = effectiveTeamId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTeamId]);

  // Default to most-recent saved build for the current team when no draft
  // was restored. Trevor's ask: "default to last build specific to that
  // team if they have one." Only runs after the restore effect (gated by
  // stateTeamRef catching up) and only when there's no draft to honor.
  useEffect(() => {
    if (!effectiveTeamId) return;
    if (stateTeamRef.current !== effectiveTeamId) return;
    if (restoredFromDraftRef.current) return;
    if (selectedBuildId) return;
    if (builds.length === 0) return;
    const latest = builds[0] as { id: string };
    loadBuild(latest.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTeamId, selectedBuildId, builds.length]);

  // Persist Team Builder draft so browser back returns to the same state.
  // Two guards prevent cross-team leakage:
  //   1) Scoped key (per effectiveTeamId) so each team has its own draft slot
  //   2) stateTeamRef must match effectiveTeamId — otherwise the restore
  //      effect hasn't reset state for the new team yet and we'd write the
  //      previous team's data into the new team's key.
  useEffect(() => {
    if (!effectiveTeamId) return;
    if (stateTeamRef.current !== effectiveTeamId) return;
    if (!selectedTeam) return;
    const draftKey = getDraftKey(effectiveTeamId);
    if (!draftKey) return;
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
        depthAssignments,
        depthPlaceholders,
      };
      localStorage.setItem(draftKey, JSON.stringify(payload));
    } catch {
      // ignore storage quota/access errors
    }
  }, [
    effectiveTeamId,
    selectedBuildId,
    buildName,
    selectedTeam,
    totalBudget,
    rosterPlayers,
    programTierMultiplier,
    programTierConference,
    fallbackRosterTotalPlayerScore,
    dirty,
    depthAssignments,
    depthPlaceholders,
  ]);

  useEffect(() => {
    if (!selectedTeam) return;
    const teamRow = (teams as Array<{ name: string; conference: string | null }>).find((t) => t.name === selectedTeam);
    const conf = teamRow?.conference?.trim();
    if (!conf) return;
    setProgramTierConference(conf);
    setProgramTierMultiplier(getProgramTierMultiplierByConference(conf, DEFAULT_NIL_TIER_MULTIPLIERS));
  }, [selectedTeam, teams]);

  // Reset depth assignments when the selected team changes (after the initial
  // localStorage restore). Without this, old indices silently re-assign to
  // whoever happens to be at that array position in the new team's roster.
  // (lastDepthTeamRef is declared above with the depth state.)
  useEffect(() => {
    const current = selectedTeam || null;
    const last = lastDepthTeamRef.current;
    if (last === null) {
      // First settling of selectedTeam (initial mount + draft restore) — record
      // it without clearing so the restored depth chart stays put.
      lastDepthTeamRef.current = current;
      return;
    }
    if (current !== last) {
      lastDepthTeamRef.current = current;
      setDepthAssignments({});
      setDepthPlaceholders({});
    }
  }, [selectedTeam]);

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
        await supabase.from("team_builds").update({
          name: targetName,
          team: selectedTeam,
          total_budget: totalBudget,
          depth_assignments: depthAssignments,
          depth_placeholders: depthPlaceholders,
        }).eq("id", buildId);
        await supabase.from("team_build_players").delete().eq("build_id", buildId);
      } else {
        if (!effectiveTeamId) throw new Error("No team in scope — pick a team before saving a build");
        const { data, error } = await supabase.from("team_builds").insert({
          user_id: user.id,
          customer_team_id: effectiveTeamId,
          name: targetName,
          team: selectedTeam,
          total_budget: totalBudget,
          depth_assignments: depthAssignments,
          depth_placeholders: depthPlaceholders,
        }).select("id").single();
        if (error) throw error;
        buildId = data.id;
      }

      if (rosterPlayers.length > 0) {
        const rows = rosterPlayers.map((rp) => ({
          ...(() => {
            const fullName = rp.player ? `${rp.player.first_name || ""} ${rp.player.last_name || ""}`.trim() : "";
            const persistedName = (rp.custom_name && rp.custom_name.trim()) || fullName || getPlayerName(rp) || null;
            return { custom_name: persistedName === "TBD" ? null : persistedName };
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
            rp.class_transition_overridden ?? false,
            rp.dev_aggressiveness_overridden ?? false,
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
      setDepthAssignments({});
      setDepthPlaceholders({});
      queryClient.invalidateQueries({ queryKey: ["team-builds"] });
      toast({ title: "Build deleted" });
    },
  });

  // Bidirectional sync between Supabase target board and Team Builder roster targets
  const targetSyncedRef = useRef(false);
  // Per-id push tracker — without this, an empty initial supabaseTargetBoard
  // load lets the effect re-run after each mutation invalidation. Even
  // though isOnSupabaseBoard guards the call, the query is invalidated but
  // not yet refetched, so isOnSupabaseBoard returns false and we re-push the
  // same player. Result: an infinite "Added to target board" toast loop the
  // user hit on hard refresh.
  const pushedPlayerIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (targetSyncedRef.current) return;
    const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

    // Push roster targets → Supabase (deduped against in-session push history)
    const rosterTargets = rosterPlayers.filter((p) => (p.roster_status || "returner") === "target" && p.player_id && isUuid(p.player_id));
    for (const p of rosterTargets) {
      const pid = p.player_id!;
      if (pushedPlayerIdsRef.current.has(pid)) continue;
      if (!isOnSupabaseBoard(pid)) {
        addToSupabaseBoard({ playerId: pid });
      }
      pushedPlayerIdsRef.current.add(pid);
    }

    // 2. Pull Supabase board → roster targets (players added from profiles/dashboard)
    if (supabaseTargetBoard.length > 0) {
      const existingPlayerIds = new Set(rosterPlayers.map((rp) => rp.player_id));
      const newFromSupabase = supabaseTargetBoard.filter((sb) => !existingPlayerIds.has(sb.player_id));
      if (newFromSupabase.length > 0) {
        setRosterPlayers((prev) => {
          const next = [...prev];
          for (const sb of newFromSupabase) {
            if (next.some((rp) => rp.player_id === sb.player_id)) continue;
            const isPitcherRow = /^(SP|RP|CL|P|LHP|RHP)/i.test(String(sb.position || ""));
            const inferredRole = asPitcherRole(sb.position || null);
            next.push({
              player_id: sb.player_id,
              source: "portal",
              custom_name: `${sb.first_name} ${sb.last_name}`.trim() || null,
              position_slot: isPitcherRow ? (inferredRole || "RP") : (playerOverrides[sb.player_id]?.position ?? null),
              depth_order: 1,
              nil_value: 0,
              production_notes: null,
              roster_status: "target",
              depth_role: isPitcherRow
                ? defaultPitcherDepthRoleFromIp(
                    ((sb as any).source_player_id ? pitchingStatsByNameTeam.bySourceId.get((sb as any).source_player_id)?.ip : null) ?? null,
                    (inferredRole === "SP") ? "SP" : "RP",
                  )
                : "utility",
              class_transition: classTransitionFromYearOrDefault(sb.class_year),
              dev_aggressiveness: 0,
              transfer_snapshot: null,
              player: {
                first_name: sb.first_name,
                last_name: sb.last_name,
                position: sb.position,
                class_year: sb.class_year ?? null,
                bats_hand: sb.bats_hand ?? null,
                team: sb.team,
                from_team: sb.team,
                conference: sb.conference ?? null,
              },
              prediction: null,
              nilVal: null,
              nil_owar: null,
            } as BuildPlayer);
          }
          return next;
        });
        setDirty(true);
      }
    }

    // Only lock the one-shot sync after we've actually seen the Supabase board
    // load. Without this guard, a first render where supabaseTargetBoard is
    // still empty (query in-flight) would skip the pull and then refuse to
    // re-run when data arrives, so seeded target rows would never appear.
    if (supabaseTargetBoard.length > 0) {
      targetSyncedRef.current = true;
    }
    // Intentionally not depending on rosterPlayers — this is a one-shot sync
    // (gated by targetSyncedRef). Re-running on every roster edit churned the
    // effect needlessly and caused position-shuffle glitches.
  }, [supabaseTargetBoard]); // eslint-disable-line react-hooks/exhaustive-deps

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

      // Auto-assign position players. Position resolution: position_slot
      // (build's current change) wins over player.position (original/raw).
      // Depth ordering at each slot: starter → utility → bench.
      const usedIdxs = new Set(Object.values(next));
      // Effective position for slot matching — honors build's position change.
      const effectivePos = (p: BuildPlayer) => p.position_slot ?? p.player?.position ?? null;
      const matchAtSlot = (p: BuildPlayer, slot: string) => slotMatchesPosition(effectivePos(p), slot);

      // Depth chart tier mapping for the 5-tier hitter model:
      //   d1 = cornerstone | everyday_starter (legacy "starter")
      //   d2 = platoon_starter | utility
      //   d3 = bench
      // No cross-tier fallback within a slot — if a position has nobody in
      // the d1-eligible set, depth 1 stays empty until the coach assigns one,
      // EXCEPT for the explicit promotion path below (promote best d2 to d1
      // when no d1 candidate exists).
      const fillByRoleGroup = (slot: string, depth: number, roles: Array<NonNullable<BuildPlayer["depth_role"]>>) => {
        if (next[depthKey(slot, depth)] != null) return;
        for (const role of roles) {
          const idx = rosterPlayers.findIndex(
            (p, i) =>
              !usedIdxs.has(i) &&
              (p.roster_status || "returner") !== "leaving" &&
              !isPitcher(p) &&
              p.depth_role === role &&
              matchAtSlot(p, slot),
          );
          if (idx >= 0) { next[depthKey(slot, depth)] = idx; usedIdxs.add(idx); return; }
        }
      };
      for (const slot of POSITION_SLOTS) {
        fillByRoleGroup(slot, 1, ["cornerstone", "everyday_starter", "starter"]);
        // Fallback: when no d1-eligible starter is tagged at this position,
        // promote the best d2-tier player (platoon or utility) whose position
        // matches the slot. Their depth_role stays the same — they just occupy
        // the d1 chart slot so depth-chart UI + WAR-by-Position analytics show
        // them as the de-facto starter. Tiebreak: highest projected oWAR.
        if (next[depthKey(slot, 1)] == null) {
          const candidates = rosterPlayers
            .map((p, idx) => ({ p, idx }))
            .filter(({ p, idx }) =>
              !usedIdxs.has(idx) &&
              (p.roster_status || "returner") !== "leaving" &&
              !isPitcher(p) &&
              (p.depth_role === "platoon_starter" || p.depth_role === "utility") &&
              matchAtSlot(p, slot),
            );
          if (candidates.length > 0) {
            candidates.sort((a, b) => {
              const aWar = playerProjection(a.p, "hitter").owar ?? 0;
              const bWar = playerProjection(b.p, "hitter").owar ?? 0;
              return bWar - aWar;
            });
            const top = candidates[0];
            next[depthKey(slot, 1)] = top.idx;
            usedIdxs.add(top.idx);
          }
        }
        fillByRoleGroup(slot, 2, ["platoon_starter", "utility"]);
        fillByRoleGroup(slot, 3, ["bench"]);
      }

      // IF/OF distribution: players with generic "IF" or "OF" position (no
      // specific slot) fill across the relevant position group. Same strict
      // hierarchy — a generic IF starter only fills depth 1, a generic IF
      // utility only fills depth 2, a generic IF bench only fills depth 3.
      const IF_SLOTS = ["1B", "2B", "3B", "SS"];
      const OF_SLOTS = ["LF", "CF", "RF"];
      const normalizePos = (raw: string | null | undefined) =>
        (raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      // 5-tier hitter model: cornerstone/everyday_starter are depth 1 (the
      // "starting nine"), platoon_starter/utility are depth 2 (situational +
      // backup), bench is depth 3. Legacy "starter" kept for old build drafts.
      const ROLE_TO_DEPTH: Record<string, number> = {
        cornerstone: 1,
        everyday_starter: 1,
        starter: 1,
        platoon_starter: 2,
        utility: 2,
        bench: 3,
      };
      const distributeGeneric = (positionTag: "IF" | "OF", slots: string[]) => {
        const candidates = rosterPlayers
          .map((p, idx) => ({ p, idx }))
          .filter(({ p, idx }) =>
            !usedIdxs.has(idx) &&
            (p.roster_status || "returner") !== "leaving" &&
            !isPitcher(p) &&
            normalizePos(effectivePos(p)) === positionTag &&
            !!p.depth_role && ROLE_TO_DEPTH[p.depth_role] != null,
          );
        for (const { p, idx } of candidates) {
          const targetDepth = ROLE_TO_DEPTH[p.depth_role!];
          for (const slot of slots) {
            if (next[depthKey(slot, targetDepth)] == null) {
              next[depthKey(slot, targetDepth)] = idx;
              usedIdxs.add(idx);
              break;
            }
          }
        }
      };
      distributeGeneric("IF", IF_SLOTS);
      distributeGeneric("OF", OF_SLOTS);

      // Auto-assign pitchers — strict role → slot mapping, no cross-tier
      // fallback. Same guarantee as hitters: the player in any given slot is
      // tagged with the right tier or the slot stays empty for the coach to
      // fill manually. Role priority follows the IP gradient (weekend SP at
      // the top of the rotation, specialist at the bottom of the pen).
      const PITCHER_SLOT_ROLES: Array<[string, BuildPlayer["depth_role"]]> = [
        ["SP1", "weekend_starter"],
        ["SP2", "weekend_starter"],
        ["SP3", "weekend_starter"],
        ["SP4", "weekday_starter"],
        ["SP5", "swing_starter"],
        ["RP1", "workhorse_reliever"],
        ["RP2", "high_leverage_reliever"],
        ["RP3", "high_leverage_reliever"],
        ["RP4", "mid_leverage_reliever"],
        ["RP5", "mid_leverage_reliever"],
        ["RP6", "low_impact_reliever"],
        ["RP7", "low_impact_reliever"],
        ["RP8", "specialist_reliever"],
      ];
      for (const [slot, role] of PITCHER_SLOT_ROLES) {
        const k = depthKey(slot, 1);
        if (next[k] != null) continue;
        const idx = rosterPlayers.findIndex(
          (p, i) =>
            !usedIdxs.has(i) &&
            (p.roster_status || "returner") !== "leaving" &&
            isPitcher(p) &&
            p.depth_role === role,
        );
        if (idx >= 0) { next[k] = idx; usedIdxs.add(idx); }
      }

      return next;
    });
  }, [rosterPlayers, slotMatchesPosition, playerProjection]);

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

  // Class color reads the player's CURRENT class_year (FR/SO/JR/SR/GR),
  // not class_transition. class_transition encodes the year-to-year move
  // ("SJ" = sophomore-to-junior projection), so a SJ-tagged player is
  // currently a junior — coloring them green ("SO") was off by one and
  // didn't match the depth-chart legend or the player profile. Falls back
  // to deriving the current class from class_transition for legacy rows.
  const classColor = (cy: string | null | undefined, isPlaceholder?: boolean) => {
    if (isPlaceholder) return "border-blue-500 bg-blue-100 text-blue-900";
    // Strip redshirt prefix — R-JR colors as JR, R-SO as SO, etc.
    const c = (cy || "").toUpperCase().replace(/^R-/, "");
    if (!c) return "border-slate-300 bg-white text-black";
    if (c === "FR") return "border-blue-500 bg-blue-100 text-blue-900";
    if (c === "SO") return "border-green-600 bg-green-200 text-green-900";
    if (c === "JR") return "border-yellow-500 bg-yellow-100 text-yellow-900";
    if (c === "SR" || c === "GR") return "border-red-500 bg-red-100 text-red-900";
    return "border-slate-300 bg-white text-black";
  };
  // Derive the player's current class for color coding. Prefer canonical
  // class_year; fall back to the second letter of class_transition (SJ → J → JR).
  const playerCurrentClass = (p: BuildPlayer | null | undefined): string | null => {
    if (!p) return null;
    const cy = (p.player?.class_year || "").toUpperCase();
    if (cy) return cy;
    const ct = String(p.class_transition || "").toUpperCase();
    if (ct === "FS") return "SO";
    if (ct === "SJ") return "JR";
    if (ct === "JS") return "SR";
    if (ct === "GR") return "GR";
    return null;
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
            const selectedPlayer = currentIdx != null ? rosterPlayers[currentIdx] : null;
            const cy = playerCurrentClass(selectedPlayer);
            const isPlaceholder = placeholder === "freshman" || placeholder === "transfer";
            const colorCls = currentIdx != null ? classColor(cy) : isPlaceholder ? classColor(null, true) : "border-slate-300 bg-white text-black";
            return (
              <Select key={`${slot}-${depth}`} value={currentIdx != null ? String(currentIdx) : (placeholder ?? "none")} onValueChange={(v) => assignDepthSlot(slot, depth, v)}>
                <SelectTrigger className={`h-6 rounded-sm px-1 text-[10px] shadow-sm ${colorCls}`}>
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
            const selectedPlayer = currentIdx != null ? rosterPlayers[currentIdx] : null;
            const colorCls = currentIdx != null ? classColor(playerCurrentClass(selectedPlayer)) : "border-slate-300 bg-white text-black";
            return (
              <Select key={slot} value={currentIdx != null ? String(currentIdx) : (placeholder ?? "none")} onValueChange={(v) => assignDepthSlot(slot, 1, v)}>
                <SelectTrigger className={`h-6 rounded-sm px-1 text-[10px] shadow-sm ${colorCls}`}>
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
            const selectedPlayer = currentIdx != null ? rosterPlayers[currentIdx] : null;
            const colorCls = currentIdx != null ? classColor(playerCurrentClass(selectedPlayer)) : "border-slate-300 bg-white text-black";
            return (
              <Select key={slot} value={currentIdx != null ? String(currentIdx) : (placeholder ?? "none")} onValueChange={(v) => assignDepthSlot(slot, 1, v)}>
                <SelectTrigger className={`h-6 rounded-sm px-1 text-[10px] shadow-sm ${colorCls}`}>
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
    setBuildName("My Team Build");
    setTotalBudget(0);
    setDirty(false);
    setSelectedTeam(effectiveSchoolName ?? "");
    setTeamSearchQuery(effectiveSchoolName ?? "");
    // Clear depth assignments — old indices would silently point at the new
    // roster's players at those array slots, which is worse than empty.
    setDepthAssignments({});
    setDepthPlaceholders({});
    skipAutoSeedOnceRef.current = true;
    // Rebuild roster from returners only (no targets)
    const roster: BuildPlayer[] = returners.map((r: any) => {
      const player = r.players;
      if (!player) return null;
      // TWP (two-way) defaults to hitter side on the team builder — coaches
      // can click into the profile to see the pitching view.
      const isPitcherRow = /^(SP|RP|CL|P|LHP|RHP)$/i.test(String(player.position || ""));
      const overrideRole = asPitcherRole(getSupabaseRole(player.id) || null);
      // Check Pitching Master Role for accurate SP/RP from last season
      const _pName = `${player.first_name || ""} ${player.last_name || ""}`.trim();
      const _pmKey = `${normalizeName(_pName)}|${normalizeName(player.team || "")}`;
      const _pmSid = player.source_player_id || null;
      const pmRec = pitchingStatsByNameTeam.byKey.get(_pmKey)
        || (_pmSid ? pitchingStatsByNameTeam.bySourceId.get(_pmSid) : null)
        || (() => { const b = pitchingStatsByNameTeam.byName.get(normalizeName(_pName)) || []; return b.length >= 1 ? b[0] : null; })();
      const pmRole = asPitcherRole(pmRec?.role ?? null);
      // Pitcher role seed: coach override wins; otherwise derive from GS/G with
      // the "5 starts minimum" floor so a pitcher who made 2 emergency starts
      // doesn't get tagged as a starter. pmRole is ignored when there's enough
      // GS/G signal because stored Role can lag reality.
      const seedPitcherGs = seasonUsage.pitcherGs.get(player.id) ?? pmRec?.gs ?? 0;
      const seedPitcherG = seasonUsage.pitcherG.get(player.id) ?? pmRec?.g ?? 0;
      const seedIsStarter = seedPitcherGs >= 5 && seedPitcherG > 0 && (seedPitcherGs / seedPitcherG) >= 0.5;
      const inferredRole: "SP" | "RP" | "SM" = overrideRole || (seedPitcherG > 0 ? (seedIsStarter ? "SP" : "RP") : (pmRole || asPitcherRole(player.position || null) || "RP"));
      // Hitter role seed: 5-tier pure-PA model (defaultHitterDepthRoleFromPa).
      // Falls back to name+team lookup when source_player_id doesn't reconcile.
      const _hNameKey = `${normalizeName(`${player.first_name || ""} ${player.last_name || ""}`.trim())}|${normalizeName(player.team || "")}`;
      const seedHitterAb = seasonUsage.hitterAb?.get(player.id) ?? seasonUsage.hitterAbByNameTeam?.get(_hNameKey) ?? 0;
      const seedHitterDepth = defaultHitterDepthRoleFromPa(seedHitterAb);
      return {
        player_id: player.id,
        source: "returner" as const,
        custom_name: null,
        position_slot: isPitcherRow ? (inferredRole || "RP") : (playerOverrides[player.id]?.position ?? null),
        depth_order: 1,
        nil_value: 0,
        production_notes: null,
        roster_status: "returner" as const,
        depth_role: isPitcherRow
          ? defaultPitcherDepthRoleFromIp(pmRec?.ip ?? null, (inferredRole === "SP") ? "SP" : "RP")
          : seedHitterDepth,
        class_transition: r.class_transition ?? "SJ",
        dev_aggressiveness: r.dev_aggressiveness ?? 0,
        class_transition_overridden: false,
        dev_aggressiveness_overridden: false,
        transfer_snapshot: null,
        player: {
          first_name: player.first_name,
          last_name: player.last_name,
          position: player.position,
          is_twp: (player as any).is_twp ?? false,
          class_year: (player as any).class_year ?? null,
          throws_hand: (player as any).throws_hand ?? null,
          bats_hand: (player as any).bats_hand ?? null,
          team: player.team,
          from_team: player.from_team,
          conference: player.conference ?? null,
          source_player_id: player.source_player_id ?? null,
        },
        prediction: r ?? null,
        nilVal: null,
        nil_owar: null,
        team_metrics: null,
        team_power_plus: null,
      };
    }).filter(Boolean) as BuildPlayer[];
    setRosterPlayers(roster);
    autoSeededTeamRef.current = normalizeName(selectedTeam);
  };

  const renderPlayerRow = useCallback((p: BuildPlayer, idx: number, globalIdx: number, pool?: "hitter" | "pitcher") => (
    <PlayerTableRow
      p={p}
      idx={idx}
      globalIdx={globalIdx}
      pool={pool}
      allPlayersById={allPlayersById}
      pitchingSourceMap={pitchingStatsByNameTeam.bySourceId}
      thinSampleMap={thinSampleMap}
      powerLookup={powerLookup}
      confByKey={confByKey}
      hitterMasterPaMap={hitterMasterPaMap}
      exitPositions={exitPositions}
      totalBudget={totalBudget}
      fallbackRosterTotalPlayerScore={fallbackRosterTotalPlayerScore}
      selectedTeam={selectedTeam}
      returnTo={`${location.pathname}${location.search}${location.hash}`}
      playerProjection={playerProjection}
      simulateTransferProjection={simulateTransferProjection}
      projectedNilForPlayer={projectedNilForPlayer}
      projectedBudgetValue={projectedBudgetValue}
      resolveTeamBuilderPlayer={resolveTeamBuilderPlayer}
      updatePlayer={updatePlayer}
      updatePlayerWithRecalc={updatePlayerWithRecalc}
      removePlayer={removePlayer}
      markPlayerLeaving={markPlayerLeaving}
      updatePlayerOverrideFn={updatePlayerOverrideFn}
      setSupabaseRole={setSupabaseRole}
    />
  ), [
    allPlayersById,
    pitchingStatsByNameTeam,
    thinSampleMap,
    powerLookup,
    confByKey,
    hitterMasterPaMap,
    exitPositions,
    totalBudget,
    fallbackRosterTotalPlayerScore,
    selectedTeam,
    location,
    playerProjection,
    simulateTransferProjection,
    projectedNilForPlayer,
    projectedBudgetValue,
    resolveTeamBuilderPlayer,
    updatePlayer,
    updatePlayerWithRecalc,
    removePlayer,
    markPlayerLeaving,
    updatePlayerOverrideFn,
    setSupabaseRole,
  ]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header — brand Oswald + gold accent, consistent with Overview & Player Dashboard */}
        <div className="rounded-lg border-l-[3px] border-l-[#D4AF37] border-t border-r border-b border-border/60 bg-muted/20 px-4 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2
              className="text-2xl font-bold tracking-[0.04em] uppercase leading-none"
              style={{ fontFamily: "'Oswald', sans-serif", color: "#D4AF37" }}
            >
              Team Builder
            </h2>
            <p className="text-muted-foreground text-xs mt-1.5 tracking-wide">Build rosters · track NIL budget · manage depth charts</p>
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
            {dirty && (
              <Button
                onClick={() => {
                  if (selectedBuildId) {
                    saveMutation.mutate({});
                  } else {
                    const name = askBuildName(buildName);
                    if (!name) return;
                    saveMutation.mutate({ saveAs: true, nameOverride: name });
                  }
                }}
                disabled={!selectedTeam || saveMutation.isPending}
              >
                {saveMutation.isPending ? "Saving…" : "Save"}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                const name = askBuildName(buildName);
                if (!name) return;
                saveMutation.mutate({ saveAs: true, nameOverride: name });
              }}
              disabled={!selectedTeam || saveMutation.isPending}
            >
              Save As
            </Button>
          </div>
        </div>

        {/* Build selector & config */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="relative">
            <Label className="text-xs mb-1 block">Team</Label>
            {allowAllTeams ? (
              <>
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
              </>
            ) : (
              <Input value={effectiveSchoolName ?? ""} disabled readOnly className="w-full opacity-100 cursor-not-allowed" />
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
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-4 text-center">
            <div className="text-muted-foreground text-xs uppercase tracking-wide">Total WAR</div>
            <div className="text-2xl font-bold tracking-tight mt-1">{rosterTableTotals.totalWar.toFixed(2)}</div>
          </div>
          <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-4 text-center">
            <div className="text-muted-foreground text-xs uppercase tracking-wide">Budget Used</div>
            <div className="text-2xl font-bold tracking-tight mt-1">${Math.round(totalEffectiveNil).toLocaleString()}</div>
          </div>
          <div className={`rounded-lg border-2 p-4 text-center ${budgetRemaining < 0 ? "border-destructive/30 bg-destructive/5" : "border-primary/20 bg-primary/5"}`}>
            <div className="text-muted-foreground text-xs uppercase tracking-wide">Remaining</div>
            <div className={`text-2xl font-bold tracking-tight mt-1 ${budgetRemaining < 0 ? "text-destructive" : ""}`}>${Math.round(budgetRemaining).toLocaleString()}</div>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={onTabChange}>
          <div className="flex items-center justify-between gap-2">
            <TabsList>
              <TabsTrigger value="roster">Roster</TabsTrigger>
              <TabsTrigger value="target-board">Target Board</TabsTrigger>
              <TabsTrigger value="depth">Depth Chart</TabsTrigger>
              <TabsTrigger value="analytics">Program Analytics</TabsTrigger>
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
            <RosterTab
              incomingName={incomingName}
              setIncomingName={setIncomingName}
              incomingPosition={incomingPosition}
              setIncomingPosition={setIncomingPosition}
              incomingNil={incomingNil}
              setIncomingNil={setIncomingNil}
              addIncomingFreshman={addIncomingFreshman}
              positionPlayers={positionPlayers}
              pitchers={pitchers}
              rosterPlayers={rosterPlayers}
              renderPlayerRow={renderPlayerRow}
              isProjectedStatus={isProjectedStatus}
              projectedBudgetValue={projectedBudgetValue}
              positionTableTotals={positionTableTotals}
              pitcherTableTotals={pitcherTableTotals}
              totalBudget={totalBudget}
              isAdmin={isAdmin}
              nilEquationOpen={nilEquationOpen}
              setNilEquationOpen={setNilEquationOpen}
              metricsUploadOpen={metricsUploadOpen}
              setMetricsUploadOpen={setMetricsUploadOpen}
              totalRosterPlayerScore={totalRosterPlayerScore}
              totalEffectiveNil={totalEffectiveNil}
            />
          </TabsContent>

          <TabsContent value="target-board" className="space-y-6">
            <TargetBoardTab
              targetPlayerSearchQuery={targetPlayerSearchQuery}
              setTargetPlayerSearchQuery={setTargetPlayerSearchQuery}
              targetPlayerSearchOpen={targetPlayerSearchOpen}
              setTargetPlayerSearchOpen={setTargetPlayerSearchOpen}
              filteredTargetPlayerSearch={filteredTargetPlayerSearch}
              addPlayerFromTargetSearch={addPlayerFromTargetSearch}
              targetPositionPlayers={targetPositionPlayers}
              targetPitchers={targetPitchers}
              rosterPlayers={rosterPlayers}
              renderPlayerRow={renderPlayerRow}
              isProjectedStatus={isProjectedStatus}
              projectedBudgetValue={projectedBudgetValue}
              targetPositionTableTotals={targetPositionTableTotals}
              targetPitcherTableTotals={targetPitcherTableTotals}
              totalBudget={totalBudget}
            />
          </TabsContent>

          <TabsContent value="compare-hidden" className="hidden">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={{ fontFamily: "'Oswald', sans-serif" }}>Compare A</CardTitle>
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
                        state={{ returnTo: `${location.pathname}${location.search}${location.hash}` }}
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
                  <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={{ fontFamily: "'Oswald', sans-serif" }}>Compare B</CardTitle>
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
                        state={{ returnTo: `${location.pathname}${location.search}${location.hash}` }}
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
            <DepthTab
              eligiblePositionPlayers={eligiblePositionPlayers}
              eligiblePitchers={eligiblePitchers}
              renderDepthStack={renderDepthStack}
              renderStartingRotationStack={renderStartingRotationStack}
              renderRelieversStack={renderRelieversStack}
            />
          </TabsContent>

          <TabsContent value="analytics" className="space-y-6">
            <AnalyticsTab
              rosterPlayers={rosterPlayers}
              selectedTeam={selectedTeam}
              rosterTableTotals={rosterTableTotals}
              totalEffectiveNil={totalEffectiveNil}
              selectedTeamSourceId={selectedTeamSourceId}
              selectedTeamFullName={selectedTeamFullName}
              selectedTeamConference={selectedTeamConference}
              depthAssignments={depthAssignments}
              playerProjection={playerProjection}
              pitchingStatsByNameTeam={pitchingStatsByNameTeam}
            />
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
