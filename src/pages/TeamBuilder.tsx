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
import { Link, useLocation, useSearchParams } from "react-router-dom";
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
  serializeBuildPlayerMeta, buildPlayerSnapshot, defaultHitterDepthRoleFromPa, defaultPitcherDepthRoleFromIp,
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

function formatDistanceToNowShort(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

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
  const [highlightedPlayerIdx, setHighlightedPlayerIdx] = useState<number | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "pending" | "saving" | "saved" | "error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const playerSaveTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
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
  const [incomingProjectionTier, setIncomingProjectionTier] = useState<"" | "developmental" | "role_player" | "contributor" | "immediate_impact">("");
  const [teamSearchQuery, setTeamSearchQuery] = useState("");
  const [teamSearchOpen, setTeamSearchOpen] = useState(false);
  const [targetPlayerSearchQuery, setTargetPlayerSearchQuery] = useState("");
  const [targetPlayerSearchOpen, setTargetPlayerSearchOpen] = useState(false);
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

  // Stable refs — savePlayerRowFn reads these at fire time so closures are
  // never stale. The debounce schedules 2.5s out; by then the coach may have
  // made more changes, but these refs always hold the current values.
  const livePredsRef = useRef(liveTargetPredictionByPlayerId);
  const playerProjectionRef = useRef(playerProjection);
  const projectedNilRef = useRef(projectedNilForPlayer);
  const rosterPlayersRef = useRef(rosterPlayers);
  const selectedBuildIdRef = useRef(selectedBuildId);
  useEffect(() => { livePredsRef.current = liveTargetPredictionByPlayerId; }, [liveTargetPredictionByPlayerId]);
  useEffect(() => { playerProjectionRef.current = playerProjection; }, [playerProjection]);
  useEffect(() => { projectedNilRef.current = projectedNilForPlayer; }, [projectedNilForPlayer]);
  // rosterPlayersRef is kept current inside setRosterPlayers functional updates (sync)
  useEffect(() => { selectedBuildIdRef.current = selectedBuildId; }, [selectedBuildId]);

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

  const loadBuild = useLoadBuild({
    builds, allPlayersForSearch, selectedTeam, selectedTeamId, effectiveTeamId,
    pitchingMasterRows, pitchingStatsByNameTeam, seasonUsage,
    resolveTeamBuilderPlayer, getSupabaseRole,
    setSelectedBuildId, setBuildName, setTotalBudget, setSelectedTeam,
    setDepthAssignments, setDepthPlaceholders, setRosterPlayers, setDirty,
    lastDepthTeamRef, skipAutoSeedOnceRef, autoSeededTeamRef,
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
      // If the player has a snapshot with hitter_depth_role, the coach's
      // saved depth is authoritative — skip the PA recompute entirely.
      // This prevents the corrective from overwriting manual coach adjustments.
      if ((p.prediction as any)?.hitter_depth_role) return p;
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
            const draft33 = Array.isArray(draft.rosterPlayers) ? draft.rosterPlayers[33] : null;
            console.log("[Draft] restoring from localStorage — player33 depth_role:", (draft33 as any)?.depth_role, "id:", (draft33 as any)?.id);
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
      const p33 = rosterPlayers[33];
      console.log("[Draft] saving to localStorage — player33 depth_role:", (p33 as any)?.depth_role, "id:", (p33 as any)?.id);
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

      if (saveAs || !buildId) {
        // New build — full insert of all players
        if (rosterPlayers.length > 0) {
          const rows = rosterPlayers.map((rp) => buildBuildPlayerRow(rp, buildId!));
          const { data: inserted, error } = await supabase
            .from("team_build_players").insert(rows).select("id, player_id");
          if (error) throw error;
          // Store returned row ids so future per-player saves can UPDATE by id
          if (inserted?.length) {
            const idByPlayerIdx = new Map(inserted.map((r, i) => [i, r.id]));
            setRosterPlayers((prev) => {
              let i = 0;
              return prev.map((rp) => {
                const rowId = idByPlayerIdx.get(i++);
                return rowId ? { ...rp, id: rowId } : rp;
              });
            });
          }
        }
      } else {
        // Existing build — per-player autosave handles individual edits.
        // Only insert players that don't have a row id yet (new adds since last save).
        const newPlayers = rosterPlayers.filter((rp) => !rp.id);
        if (newPlayers.length > 0) {
          const rows = newPlayers.map((rp) => buildBuildPlayerRow(rp, buildId!));
          const { data: inserted, error } = await supabase
            .from("team_build_players").insert(rows).select("id");
          if (error) throw error;
          if (inserted?.length) {
            let i = 0;
            setRosterPlayers((prev) =>
              prev.map((rp) => (!rp.id && i < inserted.length ? { ...rp, id: inserted[i++].id } : rp)),
            );
          }
        }
      }

      setSelectedBuildId(buildId);
      setBuildName(targetName);
      setDirty(false);
      return { buildId, saveAs, targetName };
    },
    onSuccess: (result) => {
      setLastSavedAt(new Date());
      setAutoSaveStatus("saved");
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

  const removePlayer = useCallback((idx: number) => {
    const removed = rosterPlayers[idx];
    setRosterPlayers((prev) => prev.filter((_, i) => i !== idx));
    setDirty(true);
    // Per-player delete — no debounce, immediate
    if (removed?.id && selectedBuildId) {
      setAutoSaveStatus("saving");
      supabase.from("team_build_players").delete().eq("id", removed.id)
        .then(({ error }) => {
          if (error) setAutoSaveStatus("error");
          else { setLastSavedAt(new Date()); setAutoSaveStatus("saved"); }
        });
    }
    if (removed && (removed.roster_status || "returner") === "target" && removed.player_id) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(removed.player_id);
      if (isUuid) removeFromSupabaseBoard(removed.player_id);
    }
  }, [rosterPlayers, selectedBuildId, removeFromSupabaseBoard, supabase]);

  // ── Per-player autosave ───────────────────────────────────────────────────
  // Builds the team_build_players row object for a single player.
  // Calls playerProjectionRef + projectedNilRef to get FINAL display values
  // (post depth+devAgg overlay) so the snapshot stores what the coach sees —
  // no client-side computation needed on next load.
  const buildBuildPlayerRow = useCallback((rp: BuildPlayer, buildId: string) => {
    const fullName = rp.player ? `${rp.player.first_name || ""} ${rp.player.last_name || ""}`.trim() : "";
    const persistedName = (rp.custom_name && rp.custom_name.trim()) || fullName || getPlayerName(rp) || null;
    const side = isPitcher(rp) ? "pitcher" : "hitter";
    const proj = playerProjectionRef.current(rp, side as "hitter" | "pitcher");
    const marketValue = projectedNilRef.current(rp, side as "hitter" | "pitcher");
    return {
      ...(rp.id ? { id: rp.id } : {}),
      build_id: buildId,
      custom_name: persistedName === "TBD" ? null : persistedName,
      player_id: rp.player_id,
      source: rp.source,
      position_slot: rp.position_slot,
      depth_order: rp.depth_order,
      nil_value: rp.nil_value,
      player_snapshot: buildPlayerSnapshot({
        shown: proj.shown as Record<string, unknown> | null,
        owar: proj.owar,
        pwar: proj.pwar,
        marketValue: typeof marketValue === "number" ? marketValue : null,
        coachDepthRole: rp.depth_role ?? null,
        coachDevAgg: rp.dev_aggressiveness ?? null,
      }),
      production_notes: serializeBuildPlayerMeta(
        rp.production_notes, rp.team_metrics ?? null, rp.team_power_plus ?? null,
        rp.roster_status ?? null, rp.depth_role ?? null, rp.class_transition ?? null,
        rp.dev_aggressiveness ?? null, rp.class_transition_overridden ?? false,
        rp.dev_aggressiveness_overridden ?? false, rp.transfer_snapshot ?? null,
        rp.player ? {
          first_name: rp.player.first_name || "", last_name: rp.player.last_name || "",
          position: rp.player.position ?? null, team: rp.player.team ?? null,
          from_team: rp.player.from_team ?? null, conference: rp.player.conference ?? null,
        } : null,
        rp.projection_tier ?? null, rp.nil_value_overridden ?? false,
      ),
    };
  }, []); // all reads go through refs — no deps needed

  // Writes one player row. Only fires when the build already exists (selectedBuildId set)
  // and the player already has a DB row id. New adds go through saveMutation.
  const savePlayerRowFn = useCallback(async (rp: BuildPlayer, buildId: string) => {
    if (!rp.id) { console.log("[Save] savePlayerRowFn skipped — no rp.id", rp); return; }
    const row = buildBuildPlayerRow(rp, buildId);
    console.log("[Save] savePlayerRowFn firing for id:", rp.id,
      "depth_role:", rp.depth_role,
      "snapshot.hitter_depth_role:", (row.player_snapshot as any)?.hitter_depth_role,
      "notes.depthRole:", JSON.parse(row.production_notes || "{}").depthRole,
    );
    setAutoSaveStatus("saving");
    const { error } = await supabase
      .from("team_build_players")
      .update(row)
      .eq("id", rp.id);
    if (error) {
      console.log("[Save] savePlayerRowFn ERROR:", error);
      setAutoSaveStatus("error");
    } else {
      console.log("[Save] savePlayerRowFn SUCCESS for id:", rp.id);
      setLastSavedAt(new Date());
      setAutoSaveStatus("saved");
    }
  }, [buildBuildPlayerRow, supabase]);

  // Per-player debounce: each player index has its own timer so changing
  // player A and player B within 2.5s saves both, not just the later one.
  const debouncedSavePlayer = useCallback((idx: number) => {
    if (!selectedBuildId) { console.log("[Save] debouncedSavePlayer skipped — no selectedBuildId"); return; }
    console.log("[Save] debouncedSavePlayer scheduled idx:", idx);
    setAutoSaveStatus("pending");
    if (playerSaveTimers.current[idx]) clearTimeout(playerSaveTimers.current[idx]);
    const buildId = selectedBuildId;
    playerSaveTimers.current[idx] = setTimeout(() => {
      delete playerSaveTimers.current[idx];
      const rp = rosterPlayersRef.current[idx];
      console.log("[Save] timer fired idx:", idx, "rp.id:", rp?.id, "depth_role:", rp?.depth_role);
      if (rp?.id) void savePlayerRowFn(rp, buildId);
    }, 2500);
  }, [selectedBuildId, savePlayerRowFn]);

  // Flush any pending per-player saves immediately on unmount so navigating
  // away before the 2.5s debounce fires doesn't silently drop changes.
  useEffect(() => {
    return () => {
      const buildId = selectedBuildIdRef.current;
      const players = rosterPlayersRef.current;
      const pendingIdxs = Object.keys(playerSaveTimers.current).map(Number);
      console.log("[Save] UNMOUNT FLUSH — buildId:", buildId, "pending:", pendingIdxs);
      if (!buildId) { console.log("[Save] UNMOUNT skipped — no buildId"); return; }
      if (pendingIdxs.length === 0) { console.log("[Save] UNMOUNT — nothing pending"); return; }
      pendingIdxs.forEach((idx) => {
        clearTimeout(playerSaveTimers.current[idx]);
        delete playerSaveTimers.current[idx];
        const rp = players[idx];
        console.log("[Save] UNMOUNT flushing idx:", idx, "rp.id:", rp?.id, "depth_role:", rp?.depth_role);
        if (rp?.id) void savePlayerRowFn(rp, buildId);
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // refs are stable — no deps needed

  // Clear row highlight on the next click anywhere after an adjustment.
  // setTimeout(0) defers past React's own click handler so the dropdown click
  // that triggered the highlight doesn't immediately clear it.
  useEffect(() => {
    if (highlightedPlayerIdx === null) return;
    const clear = () => setTimeout(() => setHighlightedPlayerIdx(null), 0);
    document.addEventListener("click", clear, { once: true });
    return () => document.removeEventListener("click", clear);
  }, [highlightedPlayerIdx]);

  const updatePlayer = useCallback((idx: number, updates: Partial<BuildPlayer>) => {
    console.log("[Save] updatePlayer idx:", idx, "updates:", updates);
    setRosterPlayers((prev) => {
      const next = prev.map((p, i) => (i === idx ? { ...p, ...updates } : p));
      rosterPlayersRef.current = next;
      console.log("[Save] ref updated, depth_role:", (next[idx] as any)?.depth_role, "id:", (next[idx] as any)?.id);
      return next;
    });
    setDirty(true);
    if ("depth_role" in updates || "dev_aggressiveness" in updates) {
      setHighlightedPlayerIdx(idx);
    }
    debouncedSavePlayer(idx);
  }, [debouncedSavePlayer]);

  const updatePlayerWithRecalc = useCallback(async (idx: number, updates: Partial<BuildPlayer>) => {
    const current = rosterPlayers[idx];
    setRosterPlayers((prev) => {
      const next = prev.map((p, i) => (i === idx ? { ...p, ...updates } : p));
      rosterPlayersRef.current = next; // sync — unmount flush always reads latest
      return next;
    });
    setDirty(true);
    if ("depth_role" in updates || "dev_aggressiveness" in updates) {
      setHighlightedPlayerIdx(idx);
    }
    debouncedSavePlayer(idx); // fire for ALL players before any early return
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
  }, [rosterPlayers, toast, debouncedSavePlayer]);

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
      if (pStats && pPower) {
        const normConf = (c: string | null) => (c || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
        const fromConf = row.conference || null;
        const toTeamRow = teamByKey.get(normalizeKey(selectedTeam)) || null;
        const toConf = toTeamRow?.conference || null;
        const fromPC = pitchingConfLookup.get(normConf(fromConf));
        const toPC = pitchingConfLookup.get(normConf(toConf));
        if (fromPC && toPC && toTeamRow) {
          const fromTeamRowPark = row.team ? (teamByKey.get(normalizeKey(row.team)) || null) : null;
          const baseRole = (() => {
            const r = pStats.role || null;
            if (r === "SP" || r === "RP" || r === "SM") return r as "SP" | "RP" | "SM";
            const g = Number(pStats.g) || 0;
            const gs = Number(pStats.gs) || 0;
            if (g > 0 && gs != null) return ((gs / g) < 0.5 ? "RP" : "SP") as "SP" | "RP";
            return null;
          })();
          const result = computeTransferPitcherProjection(
            {
              era: pStats.era ?? null, fip: pStats.fip ?? null, whip: pStats.whip ?? null,
              k9: pStats.k9 ?? null, bb9: pStats.bb9 ?? null, hr9: pStats.hr9 ?? null,
              storedPrPlus: {
                era: pPower.eraPrPlus ?? null, fip: pPower.fipPrPlus ?? null,
                whip: pPower.whipPrPlus ?? null, k9: pPower.k9PrPlus ?? null,
                bb9: pPower.bb9PrPlus ?? null, hr9: pPower.hr9PrPlus ?? null,
              },
              baseRole,
              fromEraPlus: fromPC.era_plus ?? null, toEraPlus: toPC.era_plus ?? null,
              fromFipPlus: fromPC.fip_plus ?? null, toFipPlus: toPC.fip_plus ?? null,
              fromWhipPlus: fromPC.whip_plus ?? null, toWhipPlus: toPC.whip_plus ?? null,
              fromK9Plus: fromPC.k9_plus ?? null, toK9Plus: toPC.k9_plus ?? null,
              fromBb9Plus: fromPC.bb9_plus ?? null, toBb9Plus: toPC.bb9_plus ?? null,
              fromHr9Plus: fromPC.hr9_plus ?? null, toHr9Plus: toPC.hr9_plus ?? null,
              fromHitterTalent: fromPC.hitter_talent_plus ?? null, toHitterTalent: toPC.hitter_talent_plus ?? null,
              fromEraParkRaw: resolveMetricParkFactor(fromTeamRowPark?.id, "era", teamParkComponents, fromTeamRowPark?.name),
              toEraParkRaw: resolveMetricParkFactor(toTeamRow.id, "era", teamParkComponents, toTeamRow.name),
              fromWhipParkRaw: resolveMetricParkFactor(fromTeamRowPark?.id, "whip", teamParkComponents, fromTeamRowPark?.name),
              toWhipParkRaw: resolveMetricParkFactor(toTeamRow.id, "whip", teamParkComponents, toTeamRow.name),
              fromHr9ParkRaw: resolveMetricParkFactor(fromTeamRowPark?.id, "hr9", teamParkComponents, fromTeamRowPark?.name),
              toHr9ParkRaw: resolveMetricParkFactor(toTeamRow.id, "hr9", teamParkComponents, toTeamRow.name),
              toTeam: toTeamRow.name, toConference: toConf,
            },
            { eq: pitchingEq },
          );
          if (!result.blocked) {
            transferSnapshot = {
              ...transferSnapshot,
              p_era: result.p_era, p_fip: result.p_fip, p_whip: result.p_whip,
              p_k9: result.p_k9, p_bb9: result.p_bb9, p_hr9: result.p_hr9,
              p_rv_plus: result.p_rv_plus, p_war: result.p_war,
              p_wrc_plus: result.p_rv_plus, owar: result.p_war, nil_valuation: result.market_value,
            };
            newP.transfer_snapshot = transferSnapshot;
          } else {
            const computed = computeReturnerPitchingProjection(newP);
            if (computed) {
              transferSnapshot = { ...transferSnapshot, p_era: computed.p_era ?? null, p_fip: computed.p_fip ?? null, p_whip: computed.p_whip ?? null, p_k9: computed.p_k9 ?? null, p_bb9: computed.p_bb9 ?? null, p_hr9: computed.p_hr9 ?? null, p_rv_plus: computed.p_rv_plus ?? null, p_war: computed.p_war ?? null, p_wrc_plus: computed.p_rv_plus ?? null, owar: computed.p_war ?? null, nil_valuation: computed.nil_valuation ?? null };
              newP.transfer_snapshot = transferSnapshot;
            }
          }
        } else {
          const computed = computeReturnerPitchingProjection(newP);
          if (computed) {
            transferSnapshot = { ...transferSnapshot, p_era: computed.p_era ?? null, p_fip: computed.p_fip ?? null, p_whip: computed.p_whip ?? null, p_k9: computed.p_k9 ?? null, p_bb9: computed.p_bb9 ?? null, p_hr9: computed.p_hr9 ?? null, p_rv_plus: computed.p_rv_plus ?? null, p_war: computed.p_war ?? null, p_wrc_plus: computed.p_rv_plus ?? null, owar: computed.p_war ?? null, nil_valuation: computed.nil_valuation ?? null };
            newP.transfer_snapshot = transferSnapshot;
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
    const overrideRole = asPitcherRole(getSupabaseRole(row.id) || null);
    const inferredRole = overrideRole || asPitcherRole(row.position || null);
    const isPitcherRow = /^(SP|RP|CL|P|LHP|RHP)/i.test(String(row.position || ""));

    let transferSnapshot: TransferSnapshot | null = null;
    if (effectiveTeamId && row.id && !isPitcherRow) {
      // Eager precompute path: read STORED projection for this customer team
      // and use it directly — no live recompute. Includes o_war + market_value
      // (PA carry-forward + program tier already baked in by the precompute).
      const { data: precomputedTeamRow } = await supabase
        .from("player_predictions")
        .select("p_avg, p_obp, p_slg, p_wrc_plus, o_war, market_value")
        .eq("player_id", row.id)
        .eq("customer_team_id", effectiveTeamId)
        .eq("variant", "precomputed")
        .eq("season", PROJECTION_SEASON)
        .eq("status", "active")
        .maybeSingle();
      if (precomputedTeamRow) {
        const fromTeamName = row.from_team || row.team;
        const fromTeamRow = fromTeamName ? teamByKey.get(normalizeKey(fromTeamName)) || null : null;
        transferSnapshot = {
          p_avg: precomputedTeamRow.p_avg ?? null,
          p_obp: precomputedTeamRow.p_obp ?? null,
          p_slg: precomputedTeamRow.p_slg ?? null,
          p_wrc_plus: precomputedTeamRow.p_wrc_plus ?? null,
          owar: (precomputedTeamRow as any).o_war ?? null,
          nil_valuation: (precomputedTeamRow as any).market_value ?? null,
          from_team: fromTeamName || null,
          from_conference: fromTeamRow?.conference || row.conference || null,
        } as any;
      }
    }

    const skipLiveCompute = !!effectiveTeamId && !isPitcherRow && !!transferSnapshot;
    if (!transferSnapshot && !skipLiveCompute && chosenPred?.id && selectedTeam) {
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
      const byId = row.id ? seedByPlayerId.get(row.id) : undefined;
      let inferredFromTeam: string | null = byId?.team ?? null;
      if (!inferredFromTeam) {
        const candidates = seedByName.get(normalizeKey(fullName)) || [];
        if (candidates.length === 1) {
          inferredFromTeam = candidates[0].team;
        } else if (candidates.length > 1 && lastAvg != null) {
          const key = `${statKey(lastAvg)}|${statKey(lastObp)}|${statKey(lastSlg)}`;
          const exact = candidates.find((r) => `${statKey(r.avg)}|${statKey(r.obp)}|${statKey(r.slg)}` === key);
          inferredFromTeam = exact?.team || candidates[0].team;
        }
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
        const targetSearchHand = batsHandToHandedness((row as any).bats_hand);
        const fromParkAvgRaw = resolveMetricParkFactor(fromTeamRow?.id, "avg", teamParkComponents, fromTeamRow?.name, undefined, undefined, targetSearchHand);
        const toParkAvgRaw = resolveMetricParkFactor(toTeamRow?.id, "avg", teamParkComponents, toTeamRow?.name, undefined, undefined, targetSearchHand);
        const fromParkObpRaw = resolveMetricParkFactor(fromTeamRow?.id, "obp", teamParkComponents, fromTeamRow?.name, undefined, undefined, targetSearchHand);
        const toParkObpRaw = resolveMetricParkFactor(toTeamRow?.id, "obp", teamParkComponents, toTeamRow?.name, undefined, undefined, targetSearchHand);
        const fromParkIsoRaw = resolveMetricParkFactor(fromTeamRow?.id, "iso", teamParkComponents, fromTeamRow?.name, undefined, undefined, targetSearchHand);
        const toParkIsoRaw = resolveMetricParkFactor(toTeamRow?.id, "iso", teamParkComponents, toTeamRow?.name, undefined, undefined, targetSearchHand);
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
          const baConferenceWeight = toWeight(eqNum("t_ba_conference_weight", TRANSFER_WEIGHT_DEFAULTS.t_ba_conference_weight));
          const obpConferenceWeight = toWeight(eqNum("t_obp_conference_weight", TRANSFER_WEIGHT_DEFAULTS.t_obp_conference_weight));
          const isoConferenceWeight = toWeight(eqNum("t_iso_conference_weight", TRANSFER_WEIGHT_DEFAULTS.t_iso_conference_weight));
          const baPitchingWeight = toWeight(eqNum("t_ba_pitching_weight", TRANSFER_WEIGHT_DEFAULTS.t_ba_pitching_weight));
          const obpPitchingWeight = toWeight(eqNum("t_obp_pitching_weight", TRANSFER_WEIGHT_DEFAULTS.t_obp_pitching_weight));
          const isoPitchingWeight = toWeight(eqNum("t_iso_pitching_weight", TRANSFER_WEIGHT_DEFAULTS.t_iso_pitching_weight));
          const baParkWeight = toWeight(eqNum("t_ba_park_weight", TRANSFER_WEIGHT_DEFAULTS.t_ba_park_weight));
          const obpParkWeight = toWeight(eqNum("t_obp_park_weight", TRANSFER_WEIGHT_DEFAULTS.t_obp_park_weight));
          const isoParkWeight = toWeight(eqNum("t_iso_park_weight", TRANSFER_WEIGHT_DEFAULTS.t_iso_park_weight));
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
            fromPark, toPark, fromObpPark, toObpPark, fromIsoPark, toIsoPark,
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
          const classAdj = classKey === "FS" ? 0.03 : classKey === "SJ" ? 0.02 : classKey === "JS" ? 0.015 : classKey === "GR" ? 0.01 : 0.02;
          const devAgg = Number.isFinite(Number(chosenPred?.dev_aggressiveness)) ? Number(chosenPred?.dev_aggressiveness) : 0;
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
          const nilValuationRaw = owarAdj == null ? null : owarAdj * basePerOwar * ptm * pvm;
          const nilValuation = nilValuationRaw == null ? null : Math.max(0, nilValuationRaw);
          transferSnapshot = {
            p_avg: pAvgAdj, p_obp: pObpAdj, p_slg: pSlgAdj, p_wrc_plus: pWrcPlusAdj,
            owar: owarAdj, nil_valuation: nilValuation,
            from_team: fromTeamName || null, from_conference: fromConference,
          };
        }
      }
    }

    const newP: BuildPlayer = {
      player_id: row.id,
      source: "portal",
      custom_name: `${row.first_name || ""} ${row.last_name || ""}`.trim() || null,
      position_slot: isPitcherRow ? (inferredRole || "RP") : (playerOverrides[row.id]?.position ?? null),
      depth_order: 1,
      nil_value: row.nil_valuations?.[0]?.estimated_value ? Number(row.nil_valuations[0].estimated_value) : 0,
      production_notes: null,
      roster_status: "target",
      depth_role: isPitcherRow
        ? defaultPitcherDepthRoleFromIp(
            (row.source_player_id ? pitchingStatsByNameTeam.bySourceId.get(row.source_player_id)?.ip : null) ?? null,
            (inferredRole === "SP") ? "SP" : "RP",
          )
        // Default hitters to everyday_starter so the displayed oWAR/market
        // match the stored projection on add (multiplier = 1.0). Coach
        // adjusts depth from there.
        : "everyday_starter",
      class_transition: chosenPred?.class_transition ?? "SJ",
      dev_aggressiveness: chosenPred?.dev_aggressiveness ?? 0,
      transfer_snapshot: transferSnapshot,
      player: {
        first_name: row.first_name, last_name: row.last_name,
        position: row.position, bats_hand: (row as any).bats_hand ?? null,
        team: row.team, from_team: row.from_team, conference: row.conference ?? null,
      },
      prediction: chosenPred ?? null,
      nilVal: row.nil_valuations?.[0]?.estimated_value ?? null,
      nil_owar: row.nil_valuations?.[0]?.component_breakdown?.ncaa_owar ?? null,
      team_metrics: null, team_power_plus: null,
    };
    if (isPitcherRow && !transferSnapshot) {
      const computed = computeReturnerPitchingProjection(newP);
      if (computed) {
        newP.transfer_snapshot = {
          p_avg: null, p_obp: null, p_slg: null,
          p_wrc_plus: computed.p_rv_plus ?? null, p_era: computed.p_era ?? null,
          p_fip: computed.p_fip ?? null, p_whip: computed.p_whip ?? null,
          p_k9: computed.p_k9 ?? null, p_bb9: computed.p_bb9 ?? null, p_hr9: computed.p_hr9 ?? null,
          p_rv_plus: computed.p_rv_plus ?? null, p_war: computed.p_war ?? null,
          owar: computed.p_war ?? null, nil_valuation: computed.nil_valuation ?? null,
          from_team: row.from_team || row.team || null, from_conference: row.conference || null,
        };
      }
    }
    setRosterPlayers((prev) => [...prev, newP]);
    setDirty(true);
    setTargetPlayerSearchQuery("");
    setTargetPlayerSearchOpen(false);
    if (row.id && !isOnSupabaseBoard(row.id)) {
      addToSupabaseBoard({ playerId: row.id });
    }
    toast({ title: "Added to targets", description: `${row.first_name} ${row.last_name}` });
    } catch (err: any) {
      toast({ title: "Failed to add target", description: err?.message || "Unexpected error while adding player target.", variant: "destructive" });
    }
  };

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
                division: (sb as any).division ?? null,
              } as any,
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
  }, [supabaseTargetBoard, targetBoardLoading]); // eslint-disable-line react-hooks/exhaustive-deps



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

  const playerRowProps = useMemo(() => ({
    allPlayersById,
    pitchingSourceMap: pitchingStatsByNameTeam.bySourceId,
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
    highlightedPlayerIdx,
  }), [
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
    highlightedPlayerIdx,
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
            <p className="text-muted-foreground text-xs mt-1.5 tracking-wide">Build rosters · track roster budget · manage depth charts</p>
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
            {/* New build: explicit save to create it */}
            {!selectedBuildId && dirty && (
              <Button
                onClick={() => {
                  const name = askBuildName(buildName);
                  if (!name) return;
                  saveMutation.mutate({ saveAs: true, nameOverride: name });
                }}
                disabled={!selectedTeam || saveMutation.isPending}
              >
                {saveMutation.isPending ? "Saving…" : "Save Build"}
              </Button>
            )}
            {/* Existing build: autosave status line */}
            {selectedBuildId && (
              <span className="text-xs text-muted-foreground min-w-[120px] text-right">
                {autoSaveStatus === "pending" && "Unsaved changes"}
                {autoSaveStatus === "saving" && "Saving…"}
                {autoSaveStatus === "saved" && lastSavedAt && `Saved · ${formatDistanceToNowShort(lastSavedAt)}`}
                {autoSaveStatus === "error" && (
                  <span className="text-destructive">
                    Save failed ·{" "}
                    <button className="underline" onClick={() => saveMutation.mutate({})}>Retry</button>
                  </span>
                )}
                {autoSaveStatus === "idle" && lastSavedAt && `Saved · ${formatDistanceToNowShort(lastSavedAt)}`}
              </span>
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
