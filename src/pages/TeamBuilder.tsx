import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import AnalyticsTab from "./team-builder/tabs/AnalyticsTab";
import RosterTab from "./team-builder/tabs/RosterTab";
import TargetBoardTab from "./team-builder/tabs/TargetBoardTab";
import DepthTab from "./team-builder/tabs/DepthTab";
import CompareTab from "./team-builder/tabs/CompareTab";
import { formatWithCommas, parseCommaNumber } from "@/lib/utils";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link, useBlocker, useLocation, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { applyTeamScopeFilter, pickPreferredPrediction } from "@/lib/teamScopedPredictions";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2 } from "lucide-react";
import { useTeamBuilderData, scorePredictionLikeDashboard } from "./team-builder/hooks/useTeamBuilderData";
import { useTeamBuilderSimulation } from "./team-builder/hooks/useTeamBuilderSimulation";
import { useLoadBuild } from "./team-builder/hooks/useLoadBuild";
import {
  getPlayerName, depthKey, slotMatchesPosition, asPitcherRole, pitcherRoleFromSlot,
  normalizeName, isUuid, readStoragePitcherLocalPlayers, parseBuildPlayerMeta,
  serializeBuildPlayerMeta, defaultHitterDepthRoleFromPa, defaultPitcherDepthRoleFromIp,
  teamMatchesSelectedTeam, splitFullNameExport as splitFullName, isPitcher,
} from "./team-builder/helpers";
import { computeOWarFromWrcPlus } from "@/lib/playerCalcs";
import { PROJECTION_SEASON } from "@/lib/seasonConstants";
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
  // Target board "shopping list" gate. See types.ts BuildPlayer for full docs.
  included_in_roster?: boolean;
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

const parseNum = (raw: unknown): number | null => {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const cleaned = s.replace(/[%$,]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
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
    supabaseTargetBoard, targetBoardLoading, removeFromSupabaseBoard, addToSupabaseBoard, isOnSupabaseBoard,
    selectedTeamRow, selectedTeamId,
    remoteEquationValues, allPlayersForSearch, hitterMasterPaMap,
    seasonUsage, builds, buildsLoading, returners, returnersUpdatedAt,
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
  const [showNewBuildDialog, setShowNewBuildDialog] = useState(false);
  const [programTierMultiplier, setProgramTierMultiplier] = useState<number>(1.2);
  const [programTierConference, setProgramTierConference] = useState<string>("");
  const [fallbackRosterTotalPlayerScore, setFallbackRosterTotalPlayerScore] = useState<number>(DEFAULT_PROGRAM_TOTAL_PLAYER_SCORE);
  const [depthAssignments, setDepthAssignments] = useState<Record<string, number>>({});
  const [depthPlaceholders, setDepthPlaceholders] = useState<Record<string, "freshman" | "transfer">>({});
  // True after the coach's first successful save — subsequent dirty navigations
  // and idle timeouts auto-save silently instead of showing a prompt.
  const [hasSavedOnce, setHasSavedOnce] = useState(false);
  const [promptBuildName, setPromptBuildName] = useState("");
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  const [savedBuildNameDisplay, setSavedBuildNameDisplay] = useState("");
  // Tracks the team the depth chart belongs to. When selectedTeam changes
  // (and isn't a load/restore), the team-change effect below clears the
  // depth chart so old indices don't re-bind to whoever happens to land at
  // that array position in the new team's roster. Restore paths
  // (loadBuild, draft restore) pre-set this ref to skip the clear.
  const lastDepthTeamRef = useRef<string | null>(null);
  const [incomingName, setIncomingName] = useState("");
  const [incomingPosition, setIncomingPosition] = useState("");
  const [incomingNil, setIncomingNil] = useState<number>(0);
  const [incomingProjectionTier, setIncomingProjectionTier] = useState<"" | "developmental" | "role_player" | "contributor" | "immediate_impact">("");
  const [teamSearchQuery, setTeamSearchQuery] = useState("");
  const [teamSearchOpen, setTeamSearchOpen] = useState(false);
  const [targetPlayerSearchQuery, setTargetPlayerSearchQuery] = useState("");
  const [targetPlayerSearchOpen, setTargetPlayerSearchOpen] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const skipAutoSeedOnceRef = useRef(false);
  const autoSeededTeamRef = useRef<string>("");
  // Prevents duplicate default-build seeding for the same team while builds === 0.
  const defaultBuildCreatingForTeamRef = useRef<string | null>(null);
  // Prevents the auto-load effect from overriding a just-called newBuild().
  const newBuildPendingRef = useRef(false);
  // Tracks which effectiveTeamId the current in-memory Team Builder state
  // represents. Used to detect customer-team changes (impersonation switch,
  // sign-in as a different customer) and to suppress draft persistence
  // during the transition before the restore effect catches up.
  const stateTeamRef = useRef<string | null>(null);

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
      // BUT: for TWPs, the DB row holds the real player UUID + the hitter side.
      // Replacing it with a storage pitcher entry (synthetic `pm-pitcher-...` id)
      // breaks the target-add path: row.id no longer matches players.id, so the
      // stored-prediction fetch returns nothing, the TWP dual-row mirror never
      // fires, and the player lands as "pitcher with - stats". Keep the DB row.
      if ((!isPitchLike(existing) || existing.__storagePitcher) && !existing.is_twp) {
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
    pitcherSkillByKey,
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

  // Flips to true once loadBuild finishes setting rosterPlayers. State (not
  // ref) so the Supabase target-board sync effect re-fires when it flips and
  // can run its pull step after the saved build has populated the roster.
  // Prevents a race that duplicated saved-build targets on remount.
  const [buildLoadDone, setBuildLoadDone] = useState(false);
  const buildLoadDoneRef = useRef(false);
  buildLoadDoneRef.current = buildLoadDone;
  const loadBuild = useLoadBuild({
    builds, allPlayersForSearch, selectedTeam, selectedTeamId, effectiveTeamId,
    pitchingMasterRows, pitchingStatsByNameTeam, seasonUsage,
    resolveTeamBuilderPlayer, getSupabaseRole,
    setSelectedBuildId, setBuildName, setTotalBudget, setSelectedTeam,
    setDepthAssignments, setDepthPlaceholders, setRosterPlayers, setDirty,
    lastDepthTeamRef, skipAutoSeedOnceRef, autoSeededTeamRef,
    buildLoadDoneRef, setBuildLoadDone,
  });

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

    const roster: BuildPlayer[] = returners.flatMap((r: any) => {
      const player = r.players;
      if (!player) return [] as BuildPlayer[];
      // TWP (two-way) gets BOTH a hitter row AND a pitcher row appended.
      // Different position_slots → distinct depthAssignments keys so they
      // don't collide.
      const playerIsTwp = !!(player as any).is_twp;
      const isPitcherRow = /^(SP|RP|CL|P|LHP|RHP)$/i.test(String(player.position || ""));
      const overrideRole = asPitcherRole(getSupabaseRole(player.id) || null);
      const _pName = `${player.first_name || ""} ${player.last_name || ""}`.trim();
      const _pmKey = `${normalizeName(_pName)}|${normalizeName(player.team || "")}`;
      const _pmSid = player.source_player_id || null;
      const pmRec = pitchingStatsByNameTeam.byKey.get(_pmKey)
        || (_pmSid ? pitchingStatsByNameTeam.bySourceId.get(_pmSid) : null)
        || (() => { const b = pitchingStatsByNameTeam.byName.get(normalizeName(_pName)) || []; return b.length >= 1 ? b[0] : null; })();
      const pmRole = asPitcherRole(pmRec?.role ?? null);
      const seedPitcherGs = seasonUsage.pitcherGs.get(player.id) ?? pmRec?.gs ?? 0;
      const seedPitcherG = seasonUsage.pitcherG.get(player.id) ?? pmRec?.g ?? 0;
      const seedIsStarter = seedPitcherGs >= 5 && seedPitcherG > 0 && (seedPitcherGs / seedPitcherG) >= 0.5;
      const inferredRole: "SP" | "RP" | "SM" = overrideRole || (seedPitcherG > 0 ? (seedIsStarter ? "SP" : "RP") : (pmRole || asPitcherRole(player.position || null) || "RP"));
      const _hNameKey = `${normalizeName(`${player.first_name || ""} ${player.last_name || ""}`.trim())}|${normalizeName(player.team || "")}`;
      const seedHitterAb = seasonUsage.hitterAb?.get(player.id) ?? seasonUsage.hitterAbByNameTeam?.get(_hNameKey) ?? 0;
      const seedHitterDepth = defaultHitterDepthRoleFromPa(seedHitterAb);
      const validPitcherDepths = [
        "weekend_starter", "weekday_starter", "swing_starter",
        "workhorse_reliever", "high_leverage_reliever", "mid_leverage_reliever",
        "low_impact_reliever", "specialist_reliever",
      ];
      const resolvedPitcherDepth = (() => {
        const stored = (r as any)?.pitcher_depth_role;
        if (validPitcherDepths.includes(stored)) return stored;
        return defaultPitcherDepthRoleFromIp(pmRec?.ip ?? null, (inferredRole === "SP") ? "SP" : "RP");
      })();
      const validHitterDepths = ["cornerstone", "everyday_starter", "platoon_starter", "utility", "bench"];
      const storedHitterDepth = (r as any)?.hitter_depth_role;
      const resolvedHitterDepth = validHitterDepths.includes(storedHitterDepth) ? storedHitterDepth : seedHitterDepth;
      const playerMeta = {
        first_name: player.first_name,
        last_name: player.last_name,
        position: player.position,
        is_twp: playerIsTwp,
        class_year: (player as any).class_year ?? null,
        throws_hand: (player as any).throws_hand ?? null,
        bats_hand: (player as any).bats_hand ?? null,
        team: player.team,
        from_team: player.from_team,
        conference: player.conference ?? null,
        source_player_id: player.source_player_id ?? null,
      };
      const baseFields = {
        player_id: player.id,
        source: "returner" as const,
        custom_name: null,
        depth_order: 1,
        nil_value: 0,
        production_notes: null,
        roster_status: "returner" as const,
        class_transition: r.class_transition ?? "SJ",
        dev_aggressiveness: r.dev_aggressiveness ?? 0,
        class_transition_overridden: false,
        dev_aggressiveness_overridden: false,
        transfer_snapshot: null,
        prediction: r ?? null,
        nilVal: null,
        nil_owar: null,
        team_metrics: null,
        team_power_plus: null,
      };
      // For TWPs the playerOverrides map can hold a stale pitcher role (set
      // back when Kenny etc. were pitcher-only). Use players.position directly
      // for the hitter side — that's where the manually-filled hitter position
      // lives now. Non-TWP rows still honor the override.
      const isPitcherPosStr = (s: string | null | undefined) => !!s && /^(SP|RP|CL|LHP|RHP|P)$/i.test(s);
      const hitterPosForTwp = !isPitcherPosStr(player.position) ? player.position : null;
      const primary: BuildPlayer = {
        ...baseFields,
        position_slot: isPitcherRow
          ? (inferredRole || "RP")
          : (playerIsTwp ? hitterPosForTwp : (playerOverrides[player.id]?.position ?? null)),
        depth_role: isPitcherRow ? resolvedPitcherDepth : resolvedHitterDepth,
        player: playerMeta,
      };
      if (playerIsTwp) {
        if (isPitcherRow) {
          // Primary is pitcher; add hitter mirror.
          const mirror: BuildPlayer = {
            ...baseFields,
            position_slot: hitterPosForTwp,
            depth_role: resolvedHitterDepth,
            player: { ...playerMeta, position: hitterPosForTwp },
          };
          return [primary, mirror];
        } else {
          // Primary is hitter; add pitcher mirror.
          const mirror: BuildPlayer = {
            ...baseFields,
            position_slot: inferredRole || "RP",
            depth_role: resolvedPitcherDepth,
            player: { ...playerMeta, position: inferredRole || "RP" },
          };
          return [primary, mirror];
        }
      }
      return [primary];
    }) as BuildPlayer[];

    if (roster.length > 0 || autoSeededTeamRef.current !== seedKey) {
      // Preserve any non-returner rows (especially "target" rows synced from
      // the Supabase target board) so the returners load doesn't wipe a player
      // the user just added from the player profile page. Returners are
      // re-seeded from this effect; targets/portal/manual entries are kept.
      setRosterPlayers((prev) => {
        // Stable-merge so array indices don't shift on re-seed. depthAssignments
        // keys by array index, so any reorder rebinds the wrong player to a
        // depth slot. Strategy: walk `prev` in order, swap each returner row
        // for its refreshed counterpart from `roster` (matched by player_id +
        // side-signature), append any returners not yet in prev, and keep
        // non-returner rows (targets/portal/manual) at their existing positions.
        //
        // TWPs now spawn two rows with the SAME player_id (one hitter, one
        // pitcher). We need a compound key (player_id + isPitcherSlot) so the
        // two sides don't collide in the lookup map — otherwise the merge
        // collapses both prev rows onto whichever side won the Map.set race
        // and re-fires of this effect compound the duplicates (3 hitters +
        // 1 pitcher etc.).
        const isPitcherSlot = (s: string | null | undefined) =>
          !!s && /^(SP|RP|CL|LHP|RHP|P)$/i.test(s);
        const rowKey = (r: BuildPlayer): string | null =>
          r.player_id ? `${r.player_id}|${isPitcherSlot(r.position_slot) ? "P" : "H"}` : null;
        const rosterByKey = new Map<string, BuildPlayer>();
        for (const r of roster) {
          const k = rowKey(r);
          if (k) rosterByKey.set(k, r);
        }
        const seenKeys = new Set<string>();
        const merged: BuildPlayer[] = prev.map((p) => {
          if ((p.roster_status || "returner") !== "returner") return p;
          const k = rowKey(p);
          if (!k) return p;
          const refreshed = rosterByKey.get(k);
          if (!refreshed) return p; // no longer a returner in fresh data — keep as-is
          seenKeys.add(k);
          return refreshed;
        });
        const appended = roster.filter((r) => {
          const k = rowKey(r);
          return !!k && !seenKeys.has(k);
        });
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

  // Reset state whenever the active customer team changes (login, sign-out,
  // or superadmin impersonation switch).
  useEffect(() => {
    if (!effectiveTeamId) {
      stateTeamRef.current = null;
      return;
    }
    if (stateTeamRef.current === effectiveTeamId) return;

    // Team changed (or first mount with a team). Clear in-memory state so
    // the previous team's roster/build never lingers.
    setSelectedBuildId(null);
    setBuildName("My Team Build");
    setSelectedTeam("");
    setRosterPlayers([]);
    setDirty(false);
    setDepthAssignments({});
    setDepthPlaceholders({});
    autoSeededTeamRef.current = "";
    defaultBuildCreatingForTeamRef.current = null;
    forkedBuildIdRef.current = null;
    forkInFlightRef.current = null;
    setHasSavedOnce(false);

    stateTeamRef.current = effectiveTeamId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTeamId]);

  // Default to most-recent saved build for the current team. Trevor's ask:
  // "default to last build specific to that team if they have one." Only
  // runs after the team-change effect (gated by stateTeamRef catching up).
  // When there are no builds yet, seeds local state from returners so the
  // coach sees a populated roster immediately. The DB record is created when
  // they save (or when the precompute Edge Function runs for the team).
  useEffect(() => {
    if (!effectiveTeamId) return;
    if (stateTeamRef.current !== effectiveTeamId) return;
    if (selectedBuildId) return;
    if (buildsLoading) return;
    // If newBuild() was just called, don't override it by loading a saved build.
    if (newBuildPendingRef.current) {
      newBuildPendingRef.current = false;
      return;
    }
    if (builds.length === 0) {
      // No saved builds — seed from returners so the coach sees a roster,
      // not a blank page. Use the ref guard to run only once per team.
      if (defaultBuildCreatingForTeamRef.current === effectiveTeamId) return;
      defaultBuildCreatingForTeamRef.current = effectiveTeamId;
      newBuild();
      return;
    }
    // Prefer most-recent coach build for the current season; fall back to any
    // prior-year coach build, then to the most-recent default build.
    // Builds are sorted updated_at DESC by the query, so [0] is always the latest.
    const coachBuilds = builds.filter((b: any) => !b.is_default);
    const defaultBuilds = builds.filter((b: any) => b.is_default);
    const currentYearCoachBuilds = coachBuilds.filter((b: any) => b.academic_year === PROJECTION_SEASON);
    const toLoad = (currentYearCoachBuilds[0] ?? coachBuilds[0] ?? defaultBuilds[0]) as { id: string } | undefined;
    if (!toLoad) return;
    loadBuild(toLoad.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTeamId, selectedBuildId, builds.length, buildsLoading]);

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
      // If currently on a default build, silently fork to a coach build first.
      // Returns the new build ID (or null if already a coach build). We use the
      // return value directly because React state won't update until next render.
      const forkedId = await forkFromDefaultIfNeeded();
      let buildId = saveAs ? null : (forkedId ?? selectedBuildId);

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
          academic_year: PROJECTION_SEASON,
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
          // Returners + existing targets default true (column-level default).
          // Only newly added targets land as false; the "+" toggle on the
          // target board flips this to true.
          included_in_roster: rp.included_in_roster ?? true,
          player_snapshot: rp.prediction ?? null,
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
            rp.projection_tier ?? null,
            rp.nil_value_overridden ?? false,
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
      setHasSavedOnce(true);
      toast({ title: result?.saveAs ? `Build saved as "${result.targetName}"` : "Build saved" });
      queryClient.invalidateQueries({ queryKey: ["team-builds"] });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  // True when the currently loaded build is a system-managed default build.
  const isDefaultBuild = useMemo(() => {
    if (!selectedBuildId) return false;
    const b = builds.find((x: any) => x.id === selectedBuildId);
    return (b as any)?.is_default === true;
  }, [selectedBuildId, builds]);

  // Season transition banner — shown when the coach has prior-year builds but no
  // current-season coach build yet. Dismissed per-session.
  const hasCurrentYearCoachBuild = useMemo(
    () => builds.some((b: any) => !b.is_default && b.academic_year === PROJECTION_SEASON),
    [builds],
  );
  const hasPriorYearCoachBuild = useMemo(
    () => builds.some((b: any) => !b.is_default && b.academic_year != null && b.academic_year !== PROJECTION_SEASON),
    [builds],
  );
  const SEASON_BANNER_KEY = `tb_season_banner_dismissed_${PROJECTION_SEASON}`;
  const [seasonBannerDismissed, setSeasonBannerDismissed] = useState(
    () => typeof sessionStorage !== "undefined" && sessionStorage.getItem(SEASON_BANNER_KEY) === "1",
  );
  const showSeasonBanner = !seasonBannerDismissed && hasPriorYearCoachBuild && !hasCurrentYearCoachBuild;
  const dismissSeasonBanner = useCallback(() => {
    sessionStorage.setItem(SEASON_BANNER_KEY, "1");
    setSeasonBannerDismissed(true);
  }, [SEASON_BANNER_KEY]);

  const idleSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  // After 30s of idle with unsaved changes: prompt on first save, auto-save after that.
  useEffect(() => {
    if (idleSaveTimerRef.current) clearTimeout(idleSaveTimerRef.current);
    if (!dirty) { setShowSavePrompt(false); return; }
    idleSaveTimerRef.current = setTimeout(() => {
      if (hasSavedOnce) {
        saveMutation.mutate({});
      } else {
        setPromptBuildName(selectedTeam ? `${selectedTeam} Build` : "My Build");
        setShowSavePrompt(true);
      }
    }, 30_000);
    return () => {
      if (idleSaveTimerRef.current) clearTimeout(idleSaveTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, hasSavedOnce]);

  // Ref that prevents duplicate concurrent fork calls. Stores the in-flight
  // promise so all callers await the same fork operation.
  const forkInFlightRef = useRef<Promise<string | null> | null>(null);
  const forkedBuildIdRef = useRef<string | null>(null);

  // Silently forks the current default build into a new coach build.
  // Returns the new build id if a fork was created, null if no fork needed.
  // Safe to call multiple times — deduplicates via ref.
  const forkFromDefaultIfNeeded = useCallback(async (): Promise<string | null> => {
    if (forkedBuildIdRef.current) return null; // already forked this session
    if (!selectedBuildId) return null;
    const b = builds.find((x: any) => x.id === selectedBuildId);
    if (!(b as any)?.is_default) return null;

    if (forkInFlightRef.current) return forkInFlightRef.current;

    const promise = (async () => {
      const { data: newBuild, error: buildErr } = await supabase
        .from("team_builds")
        .insert([{
          customer_team_id: (b as any).customer_team_id,
          team: (b as any).team,
          name: "Unsaved Build",
          user_id: (b as any).user_id,
          total_budget: (b as any).total_budget ?? 0,
          depth_assignments: (b as any).depth_assignments ?? {},
          depth_placeholders: (b as any).depth_placeholders ?? {},
          is_default: false,
          academic_year: (b as any).academic_year ?? null,
        }])
        .select("id")
        .single();
      if (buildErr || !newBuild) {
        console.error("[forkDefault] build insert failed:", buildErr?.message);
        forkInFlightRef.current = null;
        return null;
      }
      const newBuildId = newBuild.id as string;

      // Copy all player rows to the new build, clearing the DB-assigned ids.
      const { data: existingPlayers } = await supabase
        .from("team_build_players")
        .select("*")
        .eq("build_id", selectedBuildId);
      if (existingPlayers && existingPlayers.length > 0) {
        const copies = existingPlayers.map(({ id: _id, build_id: _bid, ...rest }: any) => ({
          ...rest,
          build_id: newBuildId,
        }));
        await supabase.from("team_build_players").insert(copies);
      }

      forkedBuildIdRef.current = newBuildId;
      // Pre-mark the forked build as usage-corrected so the depth corrective
      // effect (which fires when selectedBuildId changes) doesn't recompute
      // depth_role from PA data and overwrite the coach's change that triggered
      // the fork in the first place.
      usageCorrectedBuildRef.current = newBuildId;
      setSelectedBuildId(newBuildId);
      setBuildName("Unsaved Build");
      queryClient.invalidateQueries({ queryKey: ["team-builds"] });
      return newBuildId;
    })();

    forkInFlightRef.current = promise;
    return promise;
  }, [selectedBuildId, builds, supabase, queryClient]);

  // Silently fork the default build the moment the coach makes their first change,
  // so the default is never mutated and the coach build is ready to receive saves.
  useEffect(() => {
    if (!dirty || !isDefaultBuild) return;
    forkFromDefaultIfNeeded();
  }, [dirty, isDefaultBuild, forkFromDefaultIfNeeded]);

  // Block navigation when there are unsaved changes — prompt coach to save.
  const blocker = useBlocker(() => dirty);

  // Handle blocked navigation: auto-save silently after first save, prompt first time.
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (!dirty) { blocker.proceed(); return; }
    if (hasSavedOnce) {
      saveMutation.mutateAsync({})
        .then(() => blocker.proceed())
        .catch(() => blocker.proceed());
    } else {
      setPromptBuildName(selectedTeam ? `${selectedTeam} Build` : "My Build");
      setShowSavePrompt(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocker.state]);

  const deleteBuildMutation = useMutation({
    mutationFn: async (id: string) => {
      const b = builds.find((x: any) => x.id === id);
      if ((b as any)?.is_default) {
        const confirmed = window.confirm(
          "You are removing the default roster for this team. This cannot be undone and will affect what coaches see when they first log in.\n\nAre you sure you want to proceed?"
        );
        if (!confirmed) return;
      }
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

  const removePlayer = useCallback((idx: number) => {
    const removed = rosterPlayers[idx];
    setRosterPlayers((prev) => prev.filter((_, i) => i !== idx));
    setDirty(true);
    if (removed && (removed.roster_status || "returner") === "target" && removed.player_id) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(removed.player_id);
      if (isUuid) removeFromSupabaseBoard(removed.player_id);
    }
  }, [rosterPlayers, removeFromSupabaseBoard]);

  const updatePlayer = useCallback((idx: number, updates: Partial<BuildPlayer>) => {
    setRosterPlayers((prev) => prev.map((p, i) => (i === idx ? { ...p, ...updates } : p)));
    setDirty(true);
  }, []);

  const updatePlayerWithRecalc = useCallback(async (idx: number, updates: Partial<BuildPlayer>) => {
    const current = rosterPlayers[idx];
    setRosterPlayers((prev) => prev.map((p, i) => (i === idx ? { ...p, ...updates } : p)));
    setDirty(true);
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
            ? { ...p, prediction: p.prediction ? { ...p.prediction, ...(res?.prediction || {}) } : p.prediction }
            : p,
        ),
      );
    } catch (e: any) {
      toast({ title: "Recalc failed", description: e?.message || "Could not recalculate player outputs.", variant: "destructive" });
    }
  }, [rosterPlayers, toast]);

  const markPlayerLeaving = useCallback((idx: number, name: string) => {
    setRosterPlayers((prev) => prev.filter((_, i) => i !== idx));
    setDirty(true);
    toast({ title: "Removed from build", description: `${name} was removed from this build only.` });
  }, [toast]);

  const addIncomingFreshman = () => {
    const name = incomingName.trim();
    if (!name) {
      toast({ title: "Name required", description: "Enter a player name.", variant: "destructive" });
      return;
    }
    // Pitcher position triggers the pitcher table on the roster view; default
    // bench depth role for pitchers maps to specialist_reliever.
    const isPitcherPos = /^(SP|RP|CL|P|LHP|RHP)$/i.test(incomingPosition);
    const newP: BuildPlayer = {
      player_id: null,
      source: "returner",
      custom_name: name,
      position_slot: incomingPosition || null,
      depth_order: 1,
      nil_value: Number(incomingNil) || 0,
      production_notes: null,
      roster_status: "returner",
      depth_role: isPitcherPos ? "specialist_reliever" : "bench",
      class_transition: "FS",
      dev_aggressiveness: 0,
      class_transition_overridden: false,
      dev_aggressiveness_overridden: false,
      projection_tier: incomingProjectionTier || null,
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
    setIncomingProjectionTier("");
    setDirty(true);
  };

  const addPlayerFromTargetSearch = async (row: any) => {
    try {
    if (row?.__seedHitter) {
      const matchedDb = allPlayersForSearch.find((p: any) =>
        normalizeName(`${p.first_name || ""} ${p.last_name || ""}`) === normalizeName(`${row.first_name || ""} ${row.last_name || ""}`) &&
        normalizeName(p.team || "") === normalizeName(row.team || ""),
      );
      if (matchedDb) {
        await addPlayerFromTargetSearch(matchedDb);
        return;
      }
      // Seed-hitter row didn't dedupe to the preloaded list — either the
      // 16K-player query hasn't resolved yet (fresh refresh) or the seed's
      // team is the player's NEXT school and doesn't match DB row's team.
      // JIT-fetch the DB row directly so we don't fall through to the
      // manual-seed path (which has no stored prediction → blank stats).
      // Mirrors TransferPortal.tsx's per-selected-player fetch pattern.
      const { data: dbHits } = await supabase
        .from("players")
        .select("id, first_name, last_name, position, is_twp, class_year, throws_hand, bats_hand, team, from_team, conference, transfer_portal, portal_status")
        .ilike("first_name", row.first_name || "")
        .ilike("last_name", row.last_name || "");
      const dbCandidates = (dbHits || []).filter((p: any) => (p.team || "").trim() !== "");
      const dbExact = dbCandidates.find((p: any) =>
        normalizeName(p.team || "") === normalizeName(row.team || ""),
      );
      const resolved = dbExact ?? (dbCandidates.length === 1 ? dbCandidates[0] : null);
      if (resolved) {
        await addPlayerFromTargetSearch(resolved);
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
        // Default to everyday_starter so displayed oWAR/market match the
        // projection at the multiplier=1.0 baseline. Coach adjusts from there.
        depth_role: "everyday_starter",
        class_transition: classTransitionFromYearOrDefault(row.class_year),
        dev_aggressiveness: 0,
        class_transition_overridden: false,
        dev_aggressiveness_overridden: false,
        // New targets land off-roster — coach clicks the "+" icon on the
        // target board row to add them to roster aggregations.
        included_in_roster: false,
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
          class_year: row.class_year ?? null,
          bats_hand: (row as any).bats_hand ?? null,
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
        const fromConfStats = resolveConferenceStats(fromConference, fromTeamRow?.conference_id ?? null);
        const toConfStats = resolveConferenceStats(toTeamRow?.conference || null, toTeamRow?.conference_id ?? null);
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
          const targetSeedHand = batsHandToHandedness((row as any).bats_hand);
          const fromParkAvgRaw = resolveMetricParkFactor(fromTeamRow?.id, "avg", teamParkComponents, fromTeamRow?.name, undefined, undefined, targetSeedHand);
          const toParkAvgRaw = resolveMetricParkFactor(toTeamRow?.id, "avg", teamParkComponents, toTeamRow?.name, undefined, undefined, targetSeedHand);
          const fromParkObpRaw = resolveMetricParkFactor(fromTeamRow?.id, "obp", teamParkComponents, fromTeamRow?.name, undefined, undefined, targetSeedHand);
          const toParkObpRaw = resolveMetricParkFactor(toTeamRow?.id, "obp", teamParkComponents, toTeamRow?.name, undefined, undefined, targetSeedHand);
          const fromParkIsoRaw = resolveMetricParkFactor(fromTeamRow?.id, "iso", teamParkComponents, fromTeamRow?.name, undefined, undefined, targetSeedHand);
          const toParkIsoRaw = resolveMetricParkFactor(toTeamRow?.id, "iso", teamParkComponents, toTeamRow?.name, undefined, undefined, targetSeedHand);
          if (
            fromParkAvgRaw != null && toParkAvgRaw != null &&
            fromParkObpRaw != null && toParkObpRaw != null &&
            fromParkIsoRaw != null && toParkIsoRaw != null
          ) {
            const projected = computeTransferProjection({
              lastAvg, lastObp, lastSlg,
              baPR: Number(row.__seedPowerPlus.baPlus),
              obpPR: Number(row.__seedPowerPlus.obpPlus),
              isoPR: Number(row.__seedPowerPlus.isoPlus),
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
              baConferenceWeight: toWeight(eqNum("t_ba_conference_weight", TRANSFER_WEIGHT_DEFAULTS.t_ba_conference_weight)),
              obpConferenceWeight: toWeight(eqNum("t_obp_conference_weight", TRANSFER_WEIGHT_DEFAULTS.t_obp_conference_weight)),
              isoConferenceWeight: toWeight(eqNum("t_iso_conference_weight", TRANSFER_WEIGHT_DEFAULTS.t_iso_conference_weight)),
              baPitchingWeight: toWeight(eqNum("t_ba_pitching_weight", TRANSFER_WEIGHT_DEFAULTS.t_ba_pitching_weight)),
              obpPitchingWeight: toWeight(eqNum("t_obp_pitching_weight", TRANSFER_WEIGHT_DEFAULTS.t_obp_pitching_weight)),
              isoPitchingWeight: toWeight(eqNum("t_iso_pitching_weight", TRANSFER_WEIGHT_DEFAULTS.t_iso_pitching_weight)),
              baParkWeight: toWeight(eqNum("t_ba_park_weight", TRANSFER_WEIGHT_DEFAULTS.t_ba_park_weight)),
              obpParkWeight: toWeight(eqNum("t_obp_park_weight", TRANSFER_WEIGHT_DEFAULTS.t_obp_park_weight)),
              isoParkWeight: toWeight(eqNum("t_iso_park_weight", TRANSFER_WEIGHT_DEFAULTS.t_iso_park_weight)),
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
            const nilValuationRaw = owarAdj == null ? null : owarAdj * basePerOwar * ptm * pvm;
            const nilValuation = nilValuationRaw == null ? null : Math.max(0, nilValuationRaw);
            newP.transfer_snapshot = {
              p_avg: pAvgAdj, p_obp: pObpAdj, p_slg: pSlgAdj,
              p_wrc_plus: pWrcPlusAdj, owar: owarAdj, nil_valuation: nilValuation,
              from_team: row.team || null, from_conference: fromConference,
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
      // Same JIT pattern as the seed-hitter branch: storage pitchers carry a
      // synthetic `pm-pitcher-...` id (not a UUID), so the standard stored-
      // fetch path can't resolve them. Try the preloaded list first (which
      // may not have arrived yet on fresh refresh), then a direct Supabase
      // round-trip by source_player_id and/or name+team. Route the DB row
      // through the standard path so prediction + transfer_snapshot are
      // populated identically to a Dashboard / Profile add.
      const matchedDbLocal = allPlayersForSearch.find((p: any) =>
        (row.source_player_id && p.source_player_id === row.source_player_id) ||
        (normalizeName(`${p.first_name || ""} ${p.last_name || ""}`) === normalizeName(fullName) &&
          normalizeName(p.team || "") === normalizeName(row.team || "")),
      );
      if (matchedDbLocal) {
        await addPlayerFromTargetSearch(matchedDbLocal);
        return;
      }
      let dbCandidates: any[] = [];
      if (row.source_player_id) {
        const { data } = await supabase
          .from("players")
          .select("id, first_name, last_name, position, is_twp, class_year, throws_hand, bats_hand, team, from_team, conference, source_player_id, transfer_portal, portal_status")
          .eq("source_player_id", row.source_player_id);
        dbCandidates = (data || []).filter((p: any) => (p.team || "").trim() !== "");
      }
      if (dbCandidates.length === 0) {
        const { data } = await supabase
          .from("players")
          .select("id, first_name, last_name, position, is_twp, class_year, throws_hand, bats_hand, team, from_team, conference, source_player_id, transfer_portal, portal_status")
          .ilike("first_name", row.first_name || "")
          .ilike("last_name", row.last_name || "");
        dbCandidates = (data || []).filter((p: any) => (p.team || "").trim() !== "");
      }
      const dbExact = dbCandidates.find((p: any) =>
        normalizeName(p.team || "") === normalizeName(row.team || ""),
      );
      const resolved = dbExact ?? (dbCandidates.length === 1 ? dbCandidates[0] : null);
      if (resolved) {
        await addPlayerFromTargetSearch(resolved);
        return;
      }
      const inferredRole = asPitcherRole(row.__pitching?.role || row.position || "RP") || "RP";
      let transferSnapshot: TransferSnapshot = {
        p_avg: null, p_obp: null, p_slg: null,
        p_wrc_plus: row.__pitching?.p_rv_plus ?? null,
        p_era: row.__pitching?.p_era ?? null, p_fip: row.__pitching?.p_fip ?? null,
        p_whip: row.__pitching?.p_whip ?? null, p_k9: row.__pitching?.p_k9 ?? null,
        p_bb9: row.__pitching?.p_bb9 ?? null, p_hr9: row.__pitching?.p_hr9 ?? null,
        p_rv_plus: row.__pitching?.p_rv_plus ?? null, p_war: row.__pitching?.p_war ?? null,
        owar: row.__pitching?.p_war ?? null, nil_valuation: null,
        from_team: row.team || null, from_conference: row.conference || null,
      };
      const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
      const realPlayerId = (row.id && isUuid(row.id)) ? row.id : null;
      const newP: BuildPlayer = {
        player_id: realPlayerId,
        source: "portal",
        custom_name: fullName || null,
        position_slot: inferredRole,
        depth_order: 1,
        nil_value: 0,
        production_notes: null,
        roster_status: "target",
        depth_role: defaultPitcherDepthRoleFromIp(
          (row.source_player_id ? pitchingStatsByNameTeam.bySourceId.get(row.source_player_id)?.ip : null) ?? row.__pitching?.ip ?? null,
          (inferredRole === "SP") ? "SP" : "RP",
        ),
        class_transition: classTransitionFromYearOrDefault(row.class_year),
        dev_aggressiveness: 0,
        class_transition_overridden: false,
        dev_aggressiveness_overridden: false,
        // New targets land off-roster — coach clicks the "+" icon on the
        // target board row to add them to roster aggregations.
        included_in_roster: false,
        transfer_snapshot: transferSnapshot,
        player: {
          first_name: row.first_name || "", last_name: row.last_name || "",
          position: inferredRole, class_year: row.class_year ?? null,
          bats_hand: (row as any).bats_hand ?? null,
          team: row.team || null, from_team: row.from_team || row.team || null,
          conference: row.conference || null,
        },
        prediction: null, nilVal: null, nil_owar: null, team_metrics: null, team_power_plus: null,
      };
      const fullNameKey = normalizeName(fullName);
      const teamKey = normalizeName(row.team || "");
      const statsKey = `${fullNameKey}|${teamKey}`;
      const pStats = pitchingStatsByNameTeam.byKey.get(statsKey) || (() => {
        const bucket = pitchingStatsByNameTeam.byName.get(fullNameKey) || [];
        return bucket.length === 1 ? bucket[0] : null;
      })();
      const pPower = pitchingPrByNameTeam.byKey.get(statsKey) || (() => {
        const bucket = pitchingPrByNameTeam.byName.get(fullNameKey) || [];
        return bucket.length === 1 ? bucket[0] : null;
      })();
      // Stored-first: fetch the player's precomputed row for the active team +
      // their actual IP from players table. Bake stored values into snapshot
      // and use real IP for depth role tier. Matches what Profile shows.
      if (realPlayerId) {
        const [{ data: storedRows }, { data: playerRow }] = await Promise.all([
          supabase
            .from("player_predictions")
            .select("customer_team_id, variant, p_era, p_fip, p_whip, p_k9, p_bb9, p_hr9, p_rv_plus, p_war, market_value, pitcher_role, projected_ip, hitter_depth_role, pitcher_depth_role")
            .eq("player_id", realPlayerId)
            .eq("season", PROJECTION_SEASON)
            .in("status", ["active", "departed"]),
          supabase
            .from("players")
            .select("ip, position")
            .eq("id", realPlayerId)
            .maybeSingle(),
        ]);
        const teamScoped = (storedRows || []).find((r: any) => (r as any).customer_team_id === effectiveTeamId);
        const globalRow = (storedRows || []).find((r: any) => (r as any).customer_team_id == null);
        const stored: any = teamScoped ?? globalRow ?? (storedRows || [])[0] ?? null;
        if (stored) {
          newP.transfer_snapshot = {
            ...transferSnapshot,
            p_era: stored.p_era, p_fip: stored.p_fip, p_whip: stored.p_whip,
            p_k9: stored.p_k9, p_bb9: stored.p_bb9, p_hr9: stored.p_hr9,
            p_rv_plus: stored.p_rv_plus, p_war: stored.p_war,
            p_wrc_plus: stored.p_rv_plus, owar: stored.p_war,
            nil_valuation: stored.market_value,
          };
        }
        // Prefer stored pitcher_depth_role (written by worker / bulkRecalc);
        // fall back to deriving from real IP + stored pitcher_role for older rows.
        const realIp = (playerRow as any)?.ip ?? null;
        const roleForDepth: "SP" | "RP" =
          stored?.pitcher_role === "SP" ? "SP" :
          stored?.pitcher_role === "RP" ? "RP" :
          (inferredRole === "SP" ? "SP" : "RP");
        const storedPitcherDepth = stored?.pitcher_depth_role;
        const validPitcherDepths = [
          "weekend_starter", "weekday_starter", "swing_starter",
          "workhorse_reliever", "high_leverage_reliever", "mid_leverage_reliever",
          "low_impact_reliever", "specialist_reliever",
        ];
        if (validPitcherDepths.includes(storedPitcherDepth)) {
          newP.depth_role = storedPitcherDepth;
        } else if (realIp != null) {
          newP.depth_role = defaultPitcherDepthRoleFromIp(realIp, roleForDepth);
        }
      }
      setRosterPlayers((prev) => [...prev, newP]);
      setDirty(true);
      setTargetPlayerSearchQuery("");
      setTargetPlayerSearchOpen(false);
      toast({ title: "Added to targets", description: fullName });
      return;
    }

    // Standard path: fetch this player's team-scoped precomputed row and
    // drop it straight onto the target board. TWPs (is_twp=true) spawn two
    // rows — one hitter, one pitcher — each carrying their respective stored
    // stats. Non-TWPs get a single row matching their position. No live
    // recompute, no transfer-projection math — the precompute pipeline
    // already produced the per-team projection.
    //
    // Invariant: a player_id can appear at most once per side (hitter / pitcher).
    // Adding a TWP creates two rows with the same player_id but different
    // sides — that's legitimate. Adding a returner-on-this-team to the target
    // board is NOT legitimate: it spawns a second row using the precomputed
    // transfer projection (assumes transfer-to-this-team math), which sits
    // beside the returner row and looks like a bug (same wRC+, different
    // oWAR / MV because depth + transfer overlays differ).
    //
    // The setRosterPlayers updater pattern at the end of this branch is the
    // bulletproof side of this guard — it operates on latest state so the
    // sync-effect race (where rosterPlayers may be stale at closure capture)
    // can't slip past it either.
    const alreadyOnRoster = rosterPlayers.some((p) => p.player_id === row.id);
    if (alreadyOnRoster) {
      toast({ title: "Already on your roster", description: `${row.first_name} ${row.last_name} is already on this team.` });
      setTargetPlayerSearchQuery("");
      setTargetPlayerSearchOpen(false);
      return;
    }

    if (!row.id) {
      toast({ title: "Cannot add target", description: "Player has no id — pick a DB-matched row from the dropdown.", variant: "destructive" });
      return;
    }

    // Pull every prediction row for this player + their is_twp flag in one trip.
    const [{ data: storedRows }, { data: playerRow }] = await Promise.all([
      supabase
        .from("player_predictions")
        .select("customer_team_id, variant, p_avg, p_obp, p_slg, p_wrc_plus, o_war, market_value, twp_hitter_market_value, twp_pitcher_market_value, hitter_depth_role, p_era, p_fip, p_whip, p_k9, p_bb9, p_hr9, p_rv_plus, p_war, pitcher_role, pitcher_depth_role, projected_ip, class_transition, dev_aggressiveness")
        .eq("player_id", row.id)
        .eq("season", PROJECTION_SEASON)
        .in("status", ["active", "departed"]),
      supabase
        .from("players")
        .select("is_twp, position, ip, pa, class_year")
        .eq("id", row.id)
        .maybeSingle(),
    ]);
    const teamScoped = (storedRows || []).find((r: any) => r.customer_team_id === effectiveTeamId && r.variant === "precomputed");
    const globalReturner = (storedRows || []).find((r: any) => r.variant === "regular" && r.customer_team_id == null);
    const stored: any = teamScoped ?? globalReturner ?? (storedRows || [])[0] ?? null;

    const isTwp = !!(playerRow as any)?.is_twp;
    const dbPosition = (playerRow as any)?.position ?? row.position ?? null;
    const isPitcherByPos = /^(SP|RP|CL|P|LHP|RHP)/i.test(String(dbPosition || ""));
    const realIp = (playerRow as any)?.ip ?? null;

    const classTransition = stored?.class_transition ?? classTransitionFromYearOrDefault((playerRow as any)?.class_year ?? row.class_year);
    const devAggressiveness = Number.isFinite(Number(stored?.dev_aggressiveness)) ? Number(stored.dev_aggressiveness) : 0;

    const fromTeamName = row.from_team || row.team || null;
    const fromConference = row.conference || null;

    const validHitterDepths = ["cornerstone", "everyday_starter", "platoon_starter", "utility", "bench"];
    const validPitcherDepths = ["weekend_starter", "weekday_starter", "swing_starter", "workhorse_reliever", "high_leverage_reliever", "mid_leverage_reliever", "low_impact_reliever", "specialist_reliever"];

    const baseFields = {
      player_id: row.id,
      source: "portal" as const,
      custom_name: `${row.first_name || ""} ${row.last_name || ""}`.trim() || null,
      depth_order: 1,
      nil_value: 0,
      production_notes: null,
      roster_status: "target" as const,
      class_transition: classTransition,
      dev_aggressiveness: devAggressiveness,
      class_transition_overridden: false,
      dev_aggressiveness_overridden: false,
      // New targets land off-roster — coach clicks the "+" icon on the
      // target board row to add them to roster aggregations.
      included_in_roster: false,
      prediction: stored ?? null,
      nilVal: row.nil_valuations?.[0]?.estimated_value ?? null,
      nil_owar: row.nil_valuations?.[0]?.component_breakdown?.ncaa_owar ?? null,
      team_metrics: null,
      team_power_plus: null,
    };

    const playerMeta = {
      first_name: row.first_name || (playerRow as any)?.first_name || "",
      last_name: row.last_name || (playerRow as any)?.last_name || "",
      position: dbPosition,
      class_year: (playerRow as any)?.class_year ?? row.class_year ?? null,
      bats_hand: (row as any).bats_hand ?? null,
      team: row.team || null,
      from_team: row.from_team || row.team || null,
      conference: row.conference || null,
      is_twp: isTwp,
    };

    const buildHitterRow = (): BuildPlayer => {
      const storedHitterDepth = stored?.hitter_depth_role;
      const depthRole = validHitterDepths.includes(storedHitterDepth) ? storedHitterDepth : "everyday_starter";
      return {
        ...baseFields,
        position_slot: playerOverrides[row.id]?.position ?? (isPitcherByPos ? null : dbPosition) ?? null,
        depth_role: depthRole,
        transfer_snapshot: {
          p_avg: stored?.p_avg ?? null,
          p_obp: stored?.p_obp ?? null,
          p_slg: stored?.p_slg ?? null,
          p_wrc_plus: stored?.p_wrc_plus ?? null,
          owar: stored?.o_war ?? null,
          nil_valuation: isTwp ? (stored?.twp_hitter_market_value ?? null) : (stored?.market_value ?? null),
          from_team: fromTeamName,
          from_conference: fromConference,
        },
        player: { ...playerMeta, position: isPitcherByPos ? null : dbPosition },
      };
    };

    const buildPitcherRow = (): BuildPlayer => {
      const pitcherRole: "SP" | "RP" = stored?.pitcher_role === "SP" ? "SP" : "RP";
      const storedPitcherDepth = stored?.pitcher_depth_role;
      const depthRole = validPitcherDepths.includes(storedPitcherDepth)
        ? storedPitcherDepth
        : (realIp != null ? defaultPitcherDepthRoleFromIp(realIp, pitcherRole) : (pitcherRole === "SP" ? "weekend_starter" : "high_leverage_reliever"));
      return {
        ...baseFields,
        position_slot: pitcherRole,
        depth_role: depthRole,
        transfer_snapshot: {
          p_avg: null, p_obp: null, p_slg: null,
          p_wrc_plus: stored?.p_rv_plus ?? null,
          p_era: stored?.p_era ?? null,
          p_fip: stored?.p_fip ?? null,
          p_whip: stored?.p_whip ?? null,
          p_k9: stored?.p_k9 ?? null,
          p_bb9: stored?.p_bb9 ?? null,
          p_hr9: stored?.p_hr9 ?? null,
          p_rv_plus: stored?.p_rv_plus ?? null,
          p_war: stored?.p_war ?? null,
          owar: stored?.p_war ?? null,
          nil_valuation: isTwp ? (stored?.twp_pitcher_market_value ?? null) : (stored?.market_value ?? null),
          from_team: fromTeamName,
          from_conference: fromConference,
        },
        player: { ...playerMeta, position: pitcherRole },
      };
    };

    const playersToAdd: BuildPlayer[] = isTwp
      ? [buildHitterRow(), buildPitcherRow()]
      : (isPitcherByPos ? [buildPitcherRow()] : [buildHitterRow()]);

    // Bulletproof dedup at apply-time. The upfront `alreadyOnRoster` check
    // above reads from closure-captured rosterPlayers; the sync-effect race
    // could fire this function with stale closure (roster empty at capture,
    // populated by loadBuild by apply time). The updater pattern operates on
    // latest state, so any row whose (player_id, side) already exists on
    // roster — even if it landed *between* the upfront check and here — is
    // silently dropped. TWPs are unaffected: hitter side and pitcher side
    // have distinct keys.
    const rosterSideOf = (rp: any): "P" | "H" =>
      /^(SP|RP|CL|P|LHP|RHP)$/i.test(String(rp?.position_slot || "")) ? "P" : "H";
    const rosterKeyOf = (rp: any) => `${rp?.player_id || ""}|${rosterSideOf(rp)}`;
    setRosterPlayers((prev) => {
      const existingKeys = new Set(prev.map(rosterKeyOf));
      const fresh = playersToAdd.filter((np) => !existingKeys.has(rosterKeyOf(np)));
      if (fresh.length === 0) return prev;
      return [...prev, ...fresh];
    });
    setDirty(true);
    setTargetPlayerSearchQuery("");
    setTargetPlayerSearchOpen(false);
    if (row.id && !isOnSupabaseBoard(row.id)) {
      // silent=true: TB shows its own "Added to targets" toast immediately
      // below, no need to double-notify.
      addToSupabaseBoard({ playerId: row.id, silent: true });
    }
    // __sync: this row was injected by the bidirectional sync pull (a Profile /
    // Dashboard / Portal add propagating into TB). The originating surface
    // already showed its own toast — second toast would be noise.
    if (!row?.__sync) {
      toast({ title: "Added to targets", description: `${row.first_name} ${row.last_name}` });
    }
    } catch (err: any) {
      toast({ title: "Failed to add target", description: err?.message || "Unexpected error while adding player target.", variant: "destructive" });
    }
  };

  // Bidirectional sync between Supabase target board and Team Builder roster targets.
  // Previously gated as a one-shot effect via targetSyncedRef so this block
  // only ran on the first mount. That broke cross-surface real-time sync:
  // a player added on the Player Dashboard / Profile / Portal after TB was
  // already open would never propagate to the TB target board tab until the
  // coach navigated away and back. Same in reverse for TB-added targets that
  // were supposed to appear on the Targets page. Removed the one-shot gate
  // 2026-06-17 — the existing dedupe (pushedPlayerIdsRef on push, existing
  // playerIds check on pull) prevents duplicate operations on re-runs.
  // The effect deps already exclude rosterPlayers, so it only re-fires when
  // supabaseTargetBoard / build-load state changes — no roster-edit churn.
  // Per-id push tracker — without this, an empty initial supabaseTargetBoard
  // load lets the effect re-run after each mutation invalidation. Even
  // though isOnSupabaseBoard guards the call, the query is invalidated but
  // not yet refetched, so isOnSupabaseBoard returns false and we re-push the
  // same player. Result: an infinite "Added to target board" toast loop the
  // user hit on hard refresh.
  const pushedPlayerIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    // Don't push until the board query has resolved — while loading,
    // isOnSupabaseBoard returns false for everyone, causing duplicate-insert
    // errors ("Already on Target Board") for players already in the DB.
    if (targetBoardLoading) return;
    const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

    // Push roster targets → Supabase (deduped against in-session push history)
    const rosterTargets = rosterPlayers.filter((p) => (p.roster_status || "returner") === "target" && p.player_id && isUuid(p.player_id));
    for (const p of rosterTargets) {
      const pid = p.player_id!;
      if (pushedPlayerIdsRef.current.has(pid)) continue;
      if (!isOnSupabaseBoard(pid)) {
        // silent=true: the sync effect can fire on every remount; only the
        // direct user-initiated add path should toast.
        addToSupabaseBoard({ playerId: pid, silent: true });
      }
      pushedPlayerIdsRef.current.add(pid);
    }

    // 2. Pull Supabase board → roster targets (players added from profiles/dashboard).
    // Delegates to addPlayerFromTargetSearch so each player gets the stored-first
    // snapshot fetch (real pWAR/oWAR/MV, depth role from stored, etc.) AND the
    // TWP dual-row mirror. The inline push that used to live here wrote a
    // blank-stats row with no DB fetch, which surfaced as "Overbeek showing
    // only as a pitcher with no stats" for TWPs.
    //
    // Wait for saved-build load to finish before pulling — otherwise the
    // empty initial rosterPlayers makes every supabase target look "new" and
    // we end up adding duplicates of players that are about to be loaded
    // from team_build_players.
    //
    // Two cases of "pending":
    //   1) builds query still loading — builds.length === 0 here doesn't
    //      mean "no saved builds", it means "we don't know yet"
    //   2) builds query resolved with saved builds, but loadBuild hasn't
    //      run to populate rosterPlayers yet
    // No savedBuildPending gate. Pull whenever supabaseTargetBoard has
    // entries — the existingPlayerIds dedup below prevents duplicates with
    // anything a saved-build load (now or later) brings in. Result: the TB
    // target board tab consistently shows the team's target_board entries
    // regardless of which build is loaded (or none), matching the Targets
    // sidebar — "one team board that appears on every build."
    if (supabaseTargetBoard.length > 0) {
      const existingPlayerIds = new Set(rosterPlayers.map((rp) => rp.player_id));
      const newFromSupabase = supabaseTargetBoard.filter((sb) => !existingPlayerIds.has(sb.player_id));
      if (newFromSupabase.length > 0) {
        (async () => {
          for (const sb of newFromSupabase) {
            await addPlayerFromTargetSearch({
              id: sb.player_id,
              first_name: sb.first_name,
              last_name: sb.last_name,
              position: sb.position,
              class_year: sb.class_year ?? null,
              bats_hand: (sb as any).bats_hand ?? null,
              team: sb.team,
              from_team: sb.team,
              conference: sb.conference ?? null,
              source_player_id: (sb as any).source_player_id ?? null,
              // __sync flag suppresses the "Added to targets" toast inside
              // addPlayerFromTargetSearch — the originating surface (Profile /
              // Dashboard / Portal) already showed its own "Added to Target
              // Board" toast, so a second one fires for every cross-surface
              // pull. Cross-surface pulls also shouldn't mark the build dirty.
              __sync: true,
            });
          }
        })();
      }
    }

    // Reverse-direction sync: when target_board entries get deleted on
    // another surface (Targets page trash icon, Player Profile remove, etc.),
    // any matching roster_status='target' rows in this TB's rosterPlayers
    // become stale ghosts. Purge them.
    //
    // Gate on pushedPlayerIdsRef — we only purge targets that were previously
    // synced to target_board. A target that's still pending its first push
    // (just added via TB search this session) won't be in pushedPlayerIdsRef
    // yet, so it's preserved until the push completes.
    {
      const supabaseIds = new Set(supabaseTargetBoard.map((sb) => sb.player_id));
      const purgeIds = new Set<string>();
      for (const p of rosterPlayers) {
        if ((p.roster_status || "returner") !== "target") continue;
        if (!p.player_id) continue;
        if (!pushedPlayerIdsRef.current.has(p.player_id)) continue;
        if (!supabaseIds.has(p.player_id)) purgeIds.add(p.player_id);
      }
      if (purgeIds.size > 0) {
        setRosterPlayers((prev) =>
          prev.filter((p) => !(p.player_id && purgeIds.has(p.player_id) && (p.roster_status || "returner") === "target"))
        );
        // Drop purged IDs from the push tracker so a re-add would re-push.
        for (const pid of purgeIds) pushedPlayerIdsRef.current.delete(pid);
      }
    }

    // (one-shot lock removed 2026-06-17 — effect now re-runs whenever the
    // supabaseTargetBoard list changes, so cross-surface adds appear in TB
    // immediately and vice versa.)
    // Intentionally not depending on rosterPlayers — we only want to sync
    // when supabaseTargetBoard or build-load state changes. Re-running on
    // every roster edit churns the effect and caused position-shuffle
    // glitches in the past. buildLoadDone
    // IS in deps so the effect re-fires once when loadBuild finishes.
  }, [supabaseTargetBoard, targetBoardLoading, builds.length, buildsLoading, buildLoadDone, selectedBuildId]); // eslint-disable-line react-hooks/exhaustive-deps



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

      // Bail out when nothing changed — returning `prev` (same reference) lets
      // React skip the re-render, breaking the render loop that fires when
      // the playerProjection sort comparator produces floating-point deltas.
      const prevEntries = Object.entries(prev);
      if (
        prevEntries.length === Object.keys(next).length &&
        prevEntries.every(([k, v]) => next[k] === v)
      ) return prev;

      return next;
    });
  }, [rosterPlayers, playerProjection]);

  // Depth-chart assignment dropdowns: only on-roster players are
  // assignable. Off-roster targets ("+" toggle, not yet added to the
  // roster) are excluded so the coach can't accidentally slot a player
  // they haven't committed to. The mapped `idx` is the ORIGINAL
  // rosterPlayers index — filtering preserves it, so saved
  // depthAssignments continue to resolve correctly.
  const isOnRoster = (rp: BuildPlayer) =>
    (rp.roster_status || "returner") !== "target" ||
    (rp as any).included_in_roster !== false;
  const eligiblePositionPlayers = useMemo(
    () =>
      rosterPlayers
        .map((rp, idx) => ({ rp, idx }))
        .filter(({ rp }) => !isPitcher(rp) && (rp.roster_status || "returner") !== "leaving" && isOnRoster(rp)),
    [rosterPlayers],
  );

  const eligiblePitchers = useMemo(
    () =>
      rosterPlayers
        .map((rp, idx) => ({ rp, idx }))
        .filter(({ rp }) => isPitcher(rp) && (rp.roster_status || "returner") !== "leaving" && isOnRoster(rp)),
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
  const newBuild = () => {
    // Signal the auto-load effect not to override our fresh state when
    // selectedBuildId drops to null and triggers the effect's deps.
    newBuildPendingRef.current = true;
    setHasSavedOnce(false);
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
    const roster: BuildPlayer[] = returners.flatMap((r: any) => {
      const player = r.players;
      if (!player) return [] as BuildPlayer[];
      // TWP (two-way) gets BOTH a hitter row AND a pitcher row appended.
      const playerIsTwp = !!(player as any).is_twp;
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
      const validPitcherDepths = [
        "weekend_starter", "weekday_starter", "swing_starter",
        "workhorse_reliever", "high_leverage_reliever", "mid_leverage_reliever",
        "low_impact_reliever", "specialist_reliever",
      ];
      const resolvedPitcherDepth = (() => {
        const stored = (r as any)?.pitcher_depth_role;
        if (validPitcherDepths.includes(stored)) return stored;
        return defaultPitcherDepthRoleFromIp(pmRec?.ip ?? null, (inferredRole === "SP") ? "SP" : "RP");
      })();
      const validHitterDepths = ["cornerstone", "everyday_starter", "platoon_starter", "utility", "bench"];
      const storedHitterDepth = (r as any)?.hitter_depth_role;
      const resolvedHitterDepth = validHitterDepths.includes(storedHitterDepth) ? storedHitterDepth : seedHitterDepth;
      const playerMeta = {
        first_name: player.first_name,
        last_name: player.last_name,
        position: player.position,
        is_twp: playerIsTwp,
        class_year: (player as any).class_year ?? null,
        throws_hand: (player as any).throws_hand ?? null,
        bats_hand: (player as any).bats_hand ?? null,
        team: player.team,
        from_team: player.from_team,
        conference: player.conference ?? null,
        source_player_id: player.source_player_id ?? null,
      };
      const baseFields = {
        player_id: player.id,
        source: "returner" as const,
        custom_name: null,
        depth_order: 1,
        nil_value: 0,
        production_notes: null,
        roster_status: "returner" as const,
        class_transition: r.class_transition ?? "SJ",
        dev_aggressiveness: r.dev_aggressiveness ?? 0,
        class_transition_overridden: false,
        dev_aggressiveness_overridden: false,
        transfer_snapshot: null,
        prediction: r ?? null,
        nilVal: null,
        nil_owar: null,
        team_metrics: null,
        team_power_plus: null,
      };
      const isPitcherPosStr = (s: string | null | undefined) => !!s && /^(SP|RP|CL|LHP|RHP|P)$/i.test(s);
      const hitterPosForTwp = !isPitcherPosStr(player.position) ? player.position : null;
      const primary: BuildPlayer = {
        ...baseFields,
        position_slot: isPitcherRow
          ? (inferredRole || "RP")
          : (playerIsTwp ? hitterPosForTwp : (playerOverrides[player.id]?.position ?? null)),
        depth_role: isPitcherRow ? resolvedPitcherDepth : resolvedHitterDepth,
        player: playerMeta,
      };
      if (playerIsTwp) {
        if (isPitcherRow) {
          const mirror: BuildPlayer = {
            ...baseFields,
            position_slot: hitterPosForTwp,
            depth_role: resolvedHitterDepth,
            player: { ...playerMeta, position: hitterPosForTwp },
          };
          return [primary, mirror];
        } else {
          const mirror: BuildPlayer = {
            ...baseFields,
            position_slot: inferredRole || "RP",
            depth_role: resolvedPitcherDepth,
            player: { ...playerMeta, position: inferredRole || "RP" },
          };
          return [primary, mirror];
        }
      }
      return [primary];
    }) as BuildPlayer[];
    setRosterPlayers(roster);
    autoSeededTeamRef.current = normalizeName(selectedTeam);
  };

  const playerRowProps = useMemo(() => ({
    allPlayersById,
    pitchingSourceMap: pitchingStatsByNameTeam.bySourceId,
    pitcherSkillByKey,
    thinSampleMap,
    powerLookup,
    confByKey,
    hitterMasterPaMap,
    exitPositions,
    totalBudget,
    fallbackRosterTotalPlayerScore,
    selectedTeam,
    returnTo: `${location.pathname}${location.search}${location.hash}`,
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
  }), [
    allPlayersById,
    pitchingStatsByNameTeam,
    pitcherSkillByKey,
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
        {/* Season transition banner */}
        {showSeasonBanner && (
          <div className="rounded-lg border border-blue-400/40 bg-blue-950/30 px-4 py-3 flex items-start justify-between gap-3 text-sm">
            <div className="text-blue-200">
              <strong className="text-blue-100">New season available.</strong>{" "}
              Your previous builds are still here, but the default roster has been updated for{" "}
              {PROJECTION_SEASON}. Click <em>Save As</em> to create your {PROJECTION_SEASON} build.
            </div>
            <button
              className="shrink-0 text-blue-400 hover:text-blue-200 transition-colors text-xs mt-0.5"
              onClick={dismissSeasonBanner}
            >
              Dismiss
            </button>
          </div>
        )}
        {/* Save prompt — shown after 15s idle (first time only; after that auto-saves) */}
        {showSavePrompt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="bg-[#0d1a30] border border-[#162241] rounded-xl p-6 w-full max-w-sm shadow-2xl">
              <h3 className="text-base font-bold text-slate-100 mb-1">Name your build</h3>
              <p className="text-sm text-slate-400 mb-4">
                You've made changes to the roster. Give this build a name and save it to keep your work.
              </p>
              <input
                type="text"
                value={promptBuildName}
                onChange={(e) => setPromptBuildName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && promptBuildName.trim()) {
                    const name = promptBuildName.trim();
                    saveMutation.mutateAsync({ nameOverride: name }).then(() => {
                      setShowSavePrompt(false);
                      setSavedBuildNameDisplay(name);
                      setShowSaveSuccess(true);
                    });
                  }
                }}
                placeholder="e.g. 2026 Roster"
                className="w-full bg-[#0a1428] border border-[#162241] rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#D4AF37] mb-4"
                autoFocus
              />
              <div className="flex gap-2 justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowSavePrompt(false);
                    setDirty(false);
                    if (blocker.state === "blocked") blocker.proceed();
                  }}
                >
                  Discard
                </Button>
                <Button
                  size="sm"
                  disabled={saveMutation.isPending || !promptBuildName.trim()}
                  onClick={async () => {
                    const name = promptBuildName.trim();
                    await saveMutation.mutateAsync({ nameOverride: name });
                    setShowSavePrompt(false);
                    setSavedBuildNameDisplay(name);
                    setShowSaveSuccess(true);
                  }}
                >
                  {saveMutation.isPending ? "Saving…" : "Save Build"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Save success confirmation */}
        {showSaveSuccess && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="bg-[#0d1a30] border border-[#162241] rounded-xl p-6 w-full max-w-sm shadow-2xl relative">
              <button
                className="absolute top-4 right-4 text-slate-400 hover:text-slate-100 transition-colors cursor-pointer"
                onClick={() => {
                  setShowSaveSuccess(false);
                  if (blocker.state === "blocked") blocker.proceed();
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
              <div className="flex items-center gap-3 mb-2">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-500/20 border border-green-500/30 shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-400"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <h3 className="text-base font-bold text-slate-100">Build saved</h3>
              </div>
              <p className="text-sm text-slate-400 pl-11">
                &ldquo;{savedBuildNameDisplay}&rdquo; has been saved to your account.
              </p>
            </div>
          </div>
        )}

        {/* New Build dialog — clone current or start from default */}
        {showNewBuildDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="bg-[#0d1a30] border border-[#162241] rounded-xl p-6 w-full max-w-sm shadow-2xl">
              <h3 className="text-base font-bold text-slate-100 mb-1">Start a new build</h3>
              <p className="text-sm text-slate-400 mb-5">How would you like to begin?</p>
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  className="justify-start"
                  onClick={() => {
                    setShowNewBuildDialog(false);
                    newBuild();
                  }}
                >
                  Start from default roster
                </Button>
                {selectedBuildId && !isDefaultBuild && (
                  <Button
                    variant="outline"
                    className="justify-start"
                    onClick={() => {
                      setShowNewBuildDialog(false);
                      saveMutation.mutate({ saveAs: true, nameOverride: `${buildName} (copy)` });
                    }}
                  >
                    Clone &ldquo;{buildName}&rdquo;
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1"
                  onClick={() => setShowNewBuildDialog(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}
        {/* Header — brand Oswald + gold accent, consistent with Overview & Player Dashboard */}
        <div className="rounded-lg border-l-[3px] border-l-[#D4AF37] border-t border-r border-b border-border/60 bg-muted/20 px-4 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2
              className="text-2xl font-bold tracking-[0.04em] uppercase leading-none"
              style={{ fontFamily: "'Oswald', sans-serif", color: "#D4AF37" }}
            >
              Team Builder
            </h2>
            <p className="text-muted-foreground text-xs mt-1.5 tracking-wide">Build rosters · track roster budget · manage depth charts</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[220px]">
              <Label className="text-xs mb-1 block">Load Saved Build</Label>
              <Select value={selectedBuildId || "new"} onValueChange={(v) => { if (v === "new") { setShowNewBuildDialog(true); } else { setHasSavedOnce(false); loadBuild(v); } }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select build…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">+ New Build</SelectItem>
                  {builds.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}{(b as any).is_default ? " (Default)" : ""} ({b.team})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={() => setShowNewBuildDialog(true)}>
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
            {/*
              Apply Projected NIL button removed 2026-06-17. The math concept
              stays — projectedNilForPlayer feeds totals/budget when a row has
              nil_value_overridden=false (see effectiveNilForPlayer) — but the
              one-click bulk-fill was being clicked accidentally and leaving
              projected values in the Actual Value cells without setting the
              override flag, so coaches saw projection numbers that looked like
              their own typed-in actuals. Removing the button forces all
              Actual Value entries to be explicit per-row coach typing.
            */}
          </div>

          <TabsContent value="roster" className="space-y-6">
            <RosterTab
              incomingName={incomingName}
              setIncomingName={setIncomingName}
              incomingPosition={incomingPosition}
              setIncomingPosition={setIncomingPosition}
              incomingNil={incomingNil}
              setIncomingNil={setIncomingNil}
              incomingProjectionTier={incomingProjectionTier}
              setIncomingProjectionTier={setIncomingProjectionTier}
              addIncomingFreshman={addIncomingFreshman}
              positionPlayers={positionPlayers}
              pitchers={pitchers}
              rosterPlayers={rosterPlayers}
              playerRowProps={playerRowProps}
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
              playerRowProps={playerRowProps}
              isProjectedStatus={isProjectedStatus}
              projectedBudgetValue={projectedBudgetValue}
              targetPositionTableTotals={targetPositionTableTotals}
              targetPitcherTableTotals={targetPitcherTableTotals}
              totalBudget={totalBudget}
            />
          </TabsContent>

          <TabsContent value="compare-hidden" className="hidden">
            <CompareTab
              allPlayersForSearch={allPlayersForSearch}
              teams={teams}
              allPlayersById={allPlayersById}
              resolveConferenceStats={resolveConferenceStats}
              teamByKey={teamByKey}
              teamParkComponents={teamParkComponents}
              eqNum={eqNum}
              seedByName={seedByName}
            />
          </TabsContent>

          <TabsContent value="depth">
            <DepthTab
              eligiblePositionPlayers={eligiblePositionPlayers}
              eligiblePitchers={eligiblePitchers}
              depthAssignments={depthAssignments}
              depthPlaceholders={depthPlaceholders}
              rosterPlayers={rosterPlayers}
              assignDepthSlot={assignDepthSlot}
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
