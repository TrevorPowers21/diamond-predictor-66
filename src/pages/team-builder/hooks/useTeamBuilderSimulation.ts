import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { applyTeamScopeFilter, pickPreferredPrediction } from "@/lib/teamScopedPredictions";
import { computeOWarFromWrcPlus } from "@/lib/playerCalcs";
import { computeTransferProjection } from "@/lib/transferProjection";
import { computeHitterPowerRatings } from "@/lib/powerRatings";
import { computePitcherProjection } from "@/lib/pitcherProjection";
import { computeTransferPitcherProjection } from "@/lib/transferPitcherProjection";
import {
  calcPitchingPlus as _calcPitchingPlusFromLib,
  toPitchingClassAdj as _toPitchingClassAdjFromLib,
} from "@/lib/pitchingEquations";
import {
  TRANSFER_WEIGHT_DEFAULTS,
  transferWeightsForSource,
  JUCO_PITCHING_TRANSFER_WEIGHTS,
  JUCO_DISTRICT_HTP_OVERRIDE,
  JUCO_DISTRICT_CONFERENCE_ID,
  jucoDistrictNameFromConference,
  applyJucoOutlierRegression,
  JUCO_REGRESSION_CONFIG,
} from "@/lib/transferWeightDefaults";
import { getConferenceAliases } from "@/lib/conferenceMapping";
import { PROJECTION_SEASON } from "@/lib/seasonConstants";
import { resolveMetricParkFactor, batsHandToHandedness } from "@/lib/parkFactors";
import { calcPlayerScore, getProgramTierMultiplierByConference, DEFAULT_NIL_TIER_MULTIPLIERS, getPositionValueMultiplier } from "@/lib/nilProgramSpecific";
import {
  normalizeName,
  normalizeKey,
  normalizePitcherDepthRole,
  effectivePitcherRoleForBuild,
  isPitcher as isPitcherHelper,
  isTwp as isTwpHelper,
  hitterEligible as hitterEligibleHelper,
  pitcherEligible as pitcherEligibleHelper,
  pitcherRoleFromSlot,
} from "../helpers";
import type { BuildPlayer, TeamRow } from "../types";

// ── Module-level pure helpers ────────────────────────────────────────────────

// Copied verbatim from TeamBuilder.tsx line 629.
const depthRoleMultiplier = (role: BuildPlayer["depth_role"]) => {
  if (role === "cornerstone") return 1.15;
  if (role === "everyday_starter") return 1.0;
  if (role === "platoon_starter") return 0.7;
  if (role === "utility") return 0.4;
  if (role === "bench") return 0.15;
  // starter (legacy) + all pitcher roles → 1.0
  return 1.0;
};

const isPitcher = isPitcherHelper;
const isTwp = isTwpHelper;
const hitterEligible = hitterEligibleHelper;
const pitcherEligible = pitcherEligibleHelper;

// Local copies of inline helpers from TeamBuilder that are NOT yet in a lib.
const normalizeParkToIndex = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return 100;
  return Math.abs(n) <= 3 ? n * 100 : n;
};

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

function readLocalNum(key: string, fallback: number, remoteValues?: Record<string, number>): number {
  const remote = remoteValues?.[key];
  if (Number.isFinite(remote)) return Number(remote);
  const canonical = (TRANSFER_WEIGHT_DEFAULTS as Record<string, number>)[key];
  if (canonical !== undefined) return canonical;
  return fallback;
}

const conferenceKeyAliases = getConferenceAliases;

const toRate = (n: number) => (Math.abs(n) > 1 ? n / 100 : n);
const toWeight = (n: number) => (Math.abs(n) >= 10 ? n / 100 : n);
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const statKey = (v: number | null | undefined) => (v == null ? "na" : round3(v).toFixed(3));


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

// ── Local row types used by the live-target queries ──────────────────────────

type ConferenceRow = {
  conference: string;
  conference_id: string | null;
  season?: number | null;
  avg_plus: number | null;
  obp_plus: number | null;
  iso_plus: number | null;
  stuff_plus: number | null;
};

type SeedRow = {
  playerName: string;
  team: string | null;
  avg: number | null;
  obp: number | null;
  slg: number | null;
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

type PredictionInternalsRow = {
  prediction_id: string;
  avg_power_rating: number | null;
  obp_power_rating: number | null;
  slg_power_rating: number | null;
};

// ── Params interface ──────────────────────────────────────────────────────────

interface UseTeamBuilderSimulationParams {
  // from useTeamBuilderData
  teams: any[];
  teamsByName: any;
  pitchingMasterRows: any[];
  pitchingPowerEq: Record<string, number>;
  newConfStats: any[];
  hitterStats: any[];
  teamParkComponents: Record<string, any>;
  remoteEquationValues: Record<string, number>;

  // local memos that STAY in TeamBuilder (also used elsewhere in TB)
  pitchingEq: Record<string, number>;
  pitchingConfLookup: Map<string, any>;
  pitchingStatsByNameTeam: {
    byKey: Map<string, any>;
    byName: Map<string, any[]>;
    bySourceId: Map<string, any>;
  };

  // state
  selectedTeam: string | null;
  effectiveTeamId: string | null;
  rosterPlayers: any[];
  totalBudget: number;
  fallbackRosterTotalPlayerScore: number;
  programTierMultiplier: number;

  // power lookup (computed in TB from powerRatingsData)
  powerLookup: Map<string, any>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useTeamBuilderSimulation(params: UseTeamBuilderSimulationParams) {
  const {
    teams,
    teamsByName,
    pitchingMasterRows,
    pitchingPowerEq,
    newConfStats,
    hitterStats,
    teamParkComponents,
    remoteEquationValues,
    pitchingEq,
    pitchingConfLookup,
    pitchingStatsByNameTeam,
    selectedTeam,
    effectiveTeamId,
    rosterPlayers,
    totalBudget,
    fallbackRosterTotalPlayerScore,
    programTierMultiplier,
    powerLookup,
  } = params;

  const eqNum = (key: string, fallback: number) => readLocalNum(key, fallback, remoteEquationValues);

  // ── Block A: teamByKey ───────────────────────────────────────────────────────
  const teamByKey = useMemo(() => {
    const map = new Map<string, TeamRow>();
    const shorten = (v: string) => normalizeKey(v).replace(/\b(university|college|of)\b/g, "").replace(/\s+/g, " ").trim();
    for (const t of teams as TeamRow[]) {
      map.set(normalizeKey(t.name), t);
      const short = shorten(t.name);
      if (short && !map.has(short)) map.set(short, t);
    }
    return {
      get(key: string) {
        return map.get(key) ?? map.get(shorten(key)) ?? undefined;
      },
      has(key: string) {
        return map.has(key) || map.has(shorten(key));
      },
    };
  }, [teams]);

  // ── Block B: selectedTeamSourceId / selectedTeamConference / selectedTeamFullName
  const { selectedTeamSourceId, selectedTeamConference, selectedTeamFullName } = useMemo(() => {
    if (!selectedTeam) return { selectedTeamSourceId: null, selectedTeamConference: null, selectedTeamFullName: null };
    const key = selectedTeam.toLowerCase().trim();
    const row =
      teamsByName?.get(key) ??
      (teams as TeamRow[]).find(
        (t) =>
          normalizeKey((t as any).name) === normalizeKey(selectedTeam) ||
          normalizeKey((t as any).fullName) === normalizeKey(selectedTeam),
      );
    return {
      selectedTeamSourceId: row?.source_team_id ?? null,
      selectedTeamConference: (row as any)?.conference ?? null,
      selectedTeamFullName: (row as any)?.fullName ?? (row as any)?.name ?? selectedTeam,
    };
  }, [selectedTeam, teams, teamsByName]);

  // ── Block C: pitchingPrByNameTeam ────────────────────────────────────────────
  const pitchingPrByNameTeam = useMemo(() => {
    type PRec = { eraPrPlus: number | null; fipPrPlus: number | null; whipPrPlus: number | null; k9PrPlus: number | null; bb9PrPlus: number | null; hr9PrPlus: number | null };
    const byKey = new Map<string, PRec>();
    const byName = new Map<string, PRec[]>();
    const bySourceId = new Map<string, PRec>();
    const abbrToFull = new Map<string, string>();
    const fullToAbbr = new Map<string, string>();
    for (const t of teams) {
      if (t.abbreviation && t.fullName) {
        abbrToFull.set(normalizeName(t.abbreviation), normalizeName(t.fullName));
        fullToAbbr.set(normalizeName(t.fullName), normalizeName(t.abbreviation));
      }
    }
    const addRec = (name: string, team: string, rec: PRec, sourceId?: string | null) => {
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

    const EQ = { p_ncaa_avg_stuff_plus: 100, p_ncaa_avg_whiff_pct: 22.9, p_ncaa_avg_bb_pct: 11.3, p_ncaa_avg_hh_pct: 36, p_ncaa_avg_in_zone_whiff_pct: 16.4, p_ncaa_avg_chase_pct: 23.1, p_ncaa_avg_barrel_pct: 17.3, p_ncaa_avg_ld_pct: 20.9, p_ncaa_avg_avg_ev: 86.2, p_ncaa_avg_gb_pct: 43.2, p_ncaa_avg_in_zone_pct: 47.2, p_ncaa_avg_ev90: 103.1, p_ncaa_avg_pull_pct: 36.5, p_ncaa_avg_la_10_30_pct: 29, p_sd_stuff_plus: 3.967566764, p_sd_whiff_pct: 5.476169924, p_sd_bb_pct: 2.92040411, p_sd_hh_pct: 6.474203457, p_sd_in_zone_whiff_pct: 4.299203457, p_sd_chase_pct: 4.619392309, p_sd_barrel_pct: 4.988140199, p_sd_ld_pct: 3.580670928, p_sd_avg_ev: 2.362900608, p_sd_gb_pct: 6.958760046, p_sd_in_zone_pct: 3.325412065, p_sd_ev90: 1.767350585, p_sd_pull_pct: 5.356686254, p_sd_la_10_30_pct: 5.773803471, p_era_stuff_plus_weight: 0.21, p_era_whiff_pct_weight: 0.23, p_era_bb_pct_weight: 0.17, p_era_hh_pct_weight: 0.07, p_era_in_zone_whiff_pct_weight: 0.12, p_era_chase_pct_weight: 0.08, p_era_barrel_pct_weight: 0.12, p_era_ncaa_avg_power_rating: 50, p_ncaa_avg_whip_power_rating: 50, p_ncaa_avg_k9_power_rating: 50, p_ncaa_avg_bb9_power_rating: 50, p_ncaa_avg_hr9_power_rating: 50, p_fip_hr9_power_rating_plus_weight: 0.45, p_fip_bb9_power_rating_plus_weight: 0.3, p_fip_k9_power_rating_plus_weight: 0.25, p_whip_bb_pct_weight: 0.25, p_whip_ld_pct_weight: 0.2, p_whip_avg_ev_weight: 0.15, p_whip_whiff_pct_weight: 0.25, p_whip_gb_pct_weight: 0.1, p_whip_chase_pct_weight: 0.05, p_k9_whiff_pct_weight: 0.35, p_k9_stuff_plus_weight: 0.3, p_k9_in_zone_whiff_pct_weight: 0.25, p_k9_chase_pct_weight: 0.1, p_bb9_bb_pct_weight: 0.55, p_bb9_in_zone_pct_weight: 0.3, p_bb9_chase_pct_weight: 0.15, p_hr9_barrel_pct_weight: 0.32, p_hr9_ev90_weight: 0.24, p_hr9_gb_pct_weight: 0.18, p_hr9_pull_pct_weight: 0.14, p_hr9_la_10_30_pct_weight: 0.12 };
    const normalCdf = (x: number) => { const sign = x < 0 ? -1 : 1; const ax = Math.abs(x) / Math.sqrt(2); const t = 1 / (1 + 0.3275911 * ax); const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-ax * ax)); return 0.5 * (1 + erf); };
    const cs = (v: number | null, avg: number, sd: number, lib = false) => { if (v == null || sd <= 0) return null; const p = normalCdf((v - avg) / sd) * 100; return lib ? 100 - p : p; };
    const s = (v: number | null | undefined) => v == null ? null : Number(v);
    const nws = (items: Array<{ v: number; w: number }>) => { const wt = items.reduce((a, i) => a + (i.v * i.w), 0); const tw = items.reduce((a, i) => a + i.w, 0); return tw > 0 ? wt / tw : null; };

    for (const pr of pitchingMasterRows) {
      const name = (pr.playerName || "").trim();
      const team = (pr.team || "").trim();
      if (!name) continue;
      const stuff = pr.stuffPlus != null ? cs(pr.stuffPlus, EQ.p_ncaa_avg_stuff_plus, EQ.p_sd_stuff_plus) : null;
      const whiff = cs(pr.miss_pct, EQ.p_ncaa_avg_whiff_pct, EQ.p_sd_whiff_pct);
      const bb = cs(pr.bb_pct, EQ.p_ncaa_avg_bb_pct, EQ.p_sd_bb_pct, true);
      const hh = cs(pr.hard_hit_pct, EQ.p_ncaa_avg_hh_pct, EQ.p_sd_hh_pct, true);
      const izWhiff = cs(pr.in_zone_whiff_pct, EQ.p_ncaa_avg_in_zone_whiff_pct, EQ.p_sd_in_zone_whiff_pct);
      const chase = cs(pr.chase_pct, EQ.p_ncaa_avg_chase_pct, EQ.p_sd_chase_pct);
      const barrel = cs(pr.barrel_pct, EQ.p_ncaa_avg_barrel_pct, EQ.p_sd_barrel_pct, true);
      const ld = cs(pr.line_pct, EQ.p_ncaa_avg_ld_pct, EQ.p_sd_ld_pct, true);
      const avgEv = cs(pr.exit_vel, EQ.p_ncaa_avg_avg_ev, EQ.p_sd_avg_ev, true);
      const gb = cs(pr.ground_pct, EQ.p_ncaa_avg_gb_pct, EQ.p_sd_gb_pct);
      const iz = cs(pr.in_zone_pct, EQ.p_ncaa_avg_in_zone_pct, EQ.p_sd_in_zone_pct);
      const ev90 = cs(pr.vel_90th, EQ.p_ncaa_avg_ev90, EQ.p_sd_ev90, true);
      const pull = cs(pr.h_pull_pct, EQ.p_ncaa_avg_pull_pct, EQ.p_sd_pull_pct, true);
      const la1030 = cs(pr.la_10_30_pct, EQ.p_ncaa_avg_la_10_30_pct, EQ.p_sd_la_10_30_pct, true);
      const eraPr = [stuff, whiff, bb, hh, izWhiff, chase, barrel].every((v) => v != null)
        ? ((s(stuff)! * EQ.p_era_stuff_plus_weight) + (s(whiff)! * EQ.p_era_whiff_pct_weight) + (s(bb)! * EQ.p_era_bb_pct_weight) + (s(hh)! * EQ.p_era_hh_pct_weight) + (s(izWhiff)! * EQ.p_era_in_zone_whiff_pct_weight) + (s(chase)! * EQ.p_era_chase_pct_weight) + (s(barrel)! * EQ.p_era_barrel_pct_weight)) / EQ.p_era_ncaa_avg_power_rating * 100
        : null;
      const whipPr = [bb, ld, avgEv, whiff, gb, chase].every((v) => v != null)
        ? (nws([{v:s(bb)!,w:EQ.p_whip_bb_pct_weight},{v:s(ld)!,w:EQ.p_whip_ld_pct_weight},{v:s(avgEv)!,w:EQ.p_whip_avg_ev_weight},{v:s(whiff)!,w:EQ.p_whip_whiff_pct_weight},{v:s(gb)!,w:EQ.p_whip_gb_pct_weight},{v:s(chase)!,w:EQ.p_whip_chase_pct_weight}]) ?? 0) / EQ.p_ncaa_avg_whip_power_rating * 100
        : null;
      const k9Pr = [whiff, stuff, izWhiff, chase].every((v) => v != null)
        ? ((s(whiff)! * EQ.p_k9_whiff_pct_weight) + (s(stuff)! * EQ.p_k9_stuff_plus_weight) + (s(izWhiff)! * EQ.p_k9_in_zone_whiff_pct_weight) + (s(chase)! * EQ.p_k9_chase_pct_weight)) / EQ.p_ncaa_avg_k9_power_rating * 100
        : null;
      const bb9Pr = [bb, iz, chase].every((v) => v != null)
        ? ((s(bb)! * EQ.p_bb9_bb_pct_weight) + (s(iz)! * EQ.p_bb9_in_zone_pct_weight) + (s(chase)! * EQ.p_bb9_chase_pct_weight)) / EQ.p_ncaa_avg_bb9_power_rating * 100
        : null;
      const hr9Pr = [barrel, ev90, gb, pull, la1030].every((v) => v != null)
        ? ((s(barrel)! * EQ.p_hr9_barrel_pct_weight) + (s(ev90)! * EQ.p_hr9_ev90_weight) + (s(gb)! * EQ.p_hr9_gb_pct_weight) + (s(pull)! * EQ.p_hr9_pull_pct_weight) + (s(la1030)! * EQ.p_hr9_la_10_30_pct_weight)) / EQ.p_ncaa_avg_hr9_power_rating * 100
        : null;
      const fipPr = hr9Pr != null && bb9Pr != null && k9Pr != null
        ? (hr9Pr * EQ.p_fip_hr9_power_rating_plus_weight) + (bb9Pr * EQ.p_fip_bb9_power_rating_plus_weight) + (k9Pr * EQ.p_fip_k9_power_rating_plus_weight)
        : null;
      addRec(name, team, {
        eraPrPlus: pr.era_pr_plus ?? eraPr,
        fipPrPlus: pr.fip_pr_plus ?? fipPr,
        whipPrPlus: pr.whip_pr_plus ?? whipPr,
        k9PrPlus: pr.k9_pr_plus ?? k9Pr,
        hr9PrPlus: pr.hr9_pr_plus ?? hr9Pr,
        bb9PrPlus: pr.bb9_pr_plus ?? bb9Pr,
      }, pr.source_player_id);
    }
    return { byKey, byName, bySourceId };
  }, [pitchingMasterRows, teams]);

  // ── Block D: confByKey, confByConfId ─────────────────────────────────────────
  // Build conferenceStats (same local useMemo from TB) from newConfStats
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
        (raw.season === 2026 ? 2 : 0);
      const existing = byConf.get(key);
      if (!existing || score > existing.score) {
        byConf.set(key, { row, score });
      }
    }
    return Array.from(byConf.values()).map((v) => v.row);
  }, [newConfStats]);

  const confByKey = useMemo(() => {
    const map = new Map<string, ConferenceRow>();
    for (const c of conferenceStats as ConferenceRow[]) {
      map.set(normalizeKey(c.conference), c);
    }
    return map;
  }, [conferenceStats]);

  const confByConfId = useMemo(() => {
    const map = new Map<string, ConferenceRow>();
    for (const c of conferenceStats as ConferenceRow[]) {
      if (c.conference_id) map.set(c.conference_id, c);
    }
    return map;
  }, [conferenceStats]);

  // ── Block E: seedByName, seedByPlayerId ──────────────────────────────────────
  const [seedByName, seedByPlayerId] = useMemo(() => {
    const map = new Map<string, SeedRow[]>();
    const byId = new Map<string, SeedRow>();
    for (const row of hitterStats as SeedRow[]) {
      const nameKey = normalizeKey(row.playerName);
      if (!nameKey || !row.team) continue;
      const list = map.get(nameKey) || [];
      list.push(row);
      map.set(nameKey, list);
      if ((row as any).player_id) byId.set((row as any).player_id, row);
    }
    return [map, byId];
  }, [hitterStats]);

  // ── Block F: targetPredictionIds, targetPlayerIds, queries, lookup maps ──────
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
    queryKey: ["team-builder-live-target-predictions", targetPlayerIds, effectiveTeamId],
    enabled: targetPlayerIds.length > 0,
    queryFn: async () => {
      let q = supabase
        .from("player_predictions")
        .select("id, player_id, customer_team_id, from_avg, from_obp, from_slg, p_avg, p_obp, p_slg, p_ops, p_iso, p_wrc_plus, power_rating_plus, class_transition, dev_aggressiveness, model_type, variant, status, updated_at")
        .eq("season", PROJECTION_SEASON)
        .in("model_type", ["returner", "transfer"])
        .in("player_id", targetPlayerIds);
      q = applyTeamScopeFilter(q as any, effectiveTeamId);
      const { data, error } = await q;
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
      const teamScoped = pickPreferredPrediction(rows as any[], effectiveTeamId) as LivePredictionRow | null;
      const best = teamScoped ?? (selectTransferPortalPreferredPrediction(rows) as LivePredictionRow | null);
      if (best) out.set(playerId, best);
    }
    return out;
  }, [liveTargetPredictions, effectiveTeamId]);

  const { data: liveTargetPlayers = [] } = useQuery({
    queryKey: ["team-builder-live-target-players", targetPlayerIds],
    enabled: targetPlayerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("players")
        .select("id, first_name, last_name, position, team, from_team, conference, division, source_player_id")
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

  // ── Block G: resolveConferenceStats ──────────────────────────────────────────
  const resolveConferenceStats = useCallback((
    conference: string | null | undefined,
    conferenceId?: string | null,
  ): ConferenceRow | null => {
    if (conferenceId) {
      const byId = confByConfId.get(conferenceId);
      if (byId) return byId;
    }
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
  }, [confByKey, confByConfId]);

  // ── Block H: simulateTransferProjection ─────────────────────────────────────
  const simulateTransferProjection = useCallback((p: BuildPlayer, side?: "hitter" | "pitcher") => {
    const treatAsPitcher = side === "pitcher" || (side == null && isPitcher(p));
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

    if (!treatAsPitcher && effectiveTeamId && (livePred as any)?.variant === "precomputed" && (livePred as any)?.customer_team_id === effectiveTeamId) {
      const lp = livePred as any;
      return {
        p_avg: lp.p_avg ?? null,
        p_obp: lp.p_obp ?? null,
        p_slg: lp.p_slg ?? null,
        p_ops: lp.p_ops ?? ((lp.p_obp ?? 0) + (lp.p_slg ?? 0)),
        p_iso: lp.p_iso ?? null,
        p_wrc_plus: lp.p_wrc_plus ?? null,
        owar: computeOWarFromWrcPlus(lp.p_wrc_plus ?? null),
        nil_valuation: null,
      } as any;
    }

    if (treatAsPitcher) {
      const isJucoPitcherSrc = (livePlayer as any).division === "NJCAA_D1"
        || /^NJCAA D1/i.test(String(livePlayer.conference || ""));
      const pName = `${livePlayer.first_name} ${livePlayer.last_name}`;
      const pSrcId = (livePlayer as any)?.source_player_id || null;
      const pNameKey = `${normalizeName(pName)}|${normalizeName(livePlayer.team || "")}`;
      const pStats = pitchingStatsByNameTeam.byKey.get(pNameKey)
        || (pSrcId ? pitchingStatsByNameTeam.bySourceId.get(pSrcId) : null)
        || (() => {
          const bucket = pitchingStatsByNameTeam.byName.get(normalizeName(pName)) || [];
          return bucket.length === 1 ? bucket[0] : (bucket[0] || null);
        })();
      const pPower = pitchingPrByNameTeam.byKey.get(pNameKey)
        || (pSrcId ? pitchingPrByNameTeam.bySourceId.get(pSrcId) : null)
        || (() => {
          const bucket = pitchingPrByNameTeam.byName.get(normalizeName(pName)) || [];
          return bucket.length === 1 ? bucket[0] : (bucket[0] || null);
        })();
      if (!pStats) return snapshotFallback;
      if (!pPower && !isJucoPitcherSrc) return snapshotFallback;

      const pStatsTeamId = (pStats as any)?.teamId as string | undefined;
      const livePlayerTeamId = (livePlayer as any).team_id as string | undefined;
      const fromTeamRow: TeamRow | null = (() => {
        if (pStatsTeamId) {
          const byPmId = (teams as any[]).find((t) => t.id === pStatsTeamId);
          if (byPmId) return byPmId;
          const bySourceId = (teams as any[]).find((t) => t.source_team_id === pStatsTeamId);
          if (bySourceId) return bySourceId;
        }
        if (livePlayerTeamId) {
          const byPk = (teams as any[]).find((t) => t.id === livePlayerTeamId);
          if (byPk) return byPk;
        }
        if (livePlayer.team) {
          const byName = teamByKey.get(normalizeKey(livePlayer.team));
          if (byName) return byName;
        }
        return null;
      })();
      const fromConf = fromTeamRow?.conference || livePlayer.conference || null;
      const toTeamRow = teamByKey.get(normalizeKey(selectedTeam)) || null;
      if (!toTeamRow) return snapshotFallback;
      const toConf = toTeamRow.conference || null;
      const lookupConfPC = (conf: string | null, confId?: string | null) => {
        if (confId) {
          const byId = pitchingConfLookup.get(confId);
          if (byId) return byId;
        }
        if (!conf) return null;
        for (const alias of getConferenceAliases(conf)) {
          const hit = pitchingConfLookup.get(alias);
          if (hit) return hit;
        }
        return null;
      };
      const jucoFromConfId = isJucoPitcherSrc
        ? (JUCO_DISTRICT_CONFERENCE_ID[jucoDistrictNameFromConference(fromConf) ?? ""] ?? null)
        : null;
      const fromPC = lookupConfPC(fromConf, fromTeamRow?.conference_id ?? jucoFromConfId);
      const toPC = lookupConfPC(toConf, toTeamRow.conference_id ?? null);

      const baseRole = (() => {
        const r = pStats.role || null;
        if (r === "SP" || r === "RP" || r === "SM") return r as "SP" | "RP" | "SM";
        const g = Number(pStats.g) || 0;
        const gs = Number(pStats.gs) || 0;
        if (g > 0 && gs != null) return ((gs / g) < 0.5 ? "RP" : "SP") as "SP" | "RP";
        return null;
      })();
      const isTargetOnly = (p.roster_status || "returner") === "target";
      const normalizePitcherRole = (raw: string | null | undefined): "SP" | "RP" => {
        const v = String(raw || "").toUpperCase();
        return v.startsWith("SP") ? "SP" : "RP";
      };
      const slotRole = isTargetOnly
        ? baseRole
        : (normalizePitcherRole(pitcherRoleFromSlot(p.position_slot) || p.player?.position || null) || baseRole);

      const effEq = isJucoPitcherSrc ? { ...pitchingEq, ...JUCO_PITCHING_TRANSFER_WEIGHTS } : pitchingEq;
      const jucoDistrict = isJucoPitcherSrc
        ? (fromConf ?? "").replace(/^NJCAA D1 /, "").replace(/ District$/, "")
        : null;
      const effFromHitterTalent = isJucoPitcherSrc
        ? (JUCO_DISTRICT_HTP_OVERRIDE[jucoDistrict ?? ""] ?? null)
        : (fromPC?.hitter_talent_plus ?? null);

      const result = computeTransferPitcherProjection(
        {
          era: pStats.era ?? null,
          fip: pStats.fip ?? null,
          whip: pStats.whip ?? null,
          k9: pStats.k9 ?? null,
          bb9: pStats.bb9 ?? null,
          hr9: pStats.hr9 ?? null,
          storedPrPlus: {
            era: pPower?.eraPrPlus ?? null,
            fip: pPower?.fipPrPlus ?? null,
            whip: pPower?.whipPrPlus ?? null,
            k9: pPower?.k9PrPlus ?? null,
            bb9: pPower?.bb9PrPlus ?? null,
            hr9: pPower?.hr9PrPlus ?? null,
          },
          baseRole,
          fromEraPlus: fromPC?.era_plus ?? null,
          toEraPlus: toPC?.era_plus ?? null,
          fromFipPlus: fromPC?.fip_plus ?? null,
          toFipPlus: toPC?.fip_plus ?? null,
          fromWhipPlus: fromPC?.whip_plus ?? null,
          toWhipPlus: toPC?.whip_plus ?? null,
          fromK9Plus: fromPC?.k9_plus ?? null,
          toK9Plus: toPC?.k9_plus ?? null,
          fromBb9Plus: fromPC?.bb9_plus ?? null,
          toBb9Plus: toPC?.bb9_plus ?? null,
          fromHr9Plus: fromPC?.hr9_plus ?? null,
          toHr9Plus: toPC?.hr9_plus ?? null,
          fromHitterTalent: effFromHitterTalent,
          toHitterTalent: toPC?.hitter_talent_plus ?? null,
          fromEraParkRaw: resolveTransferParkFactor(fromTeamRow?.id, [livePlayer.team, fromTeamRow?.name], "era", teamParkComponents),
          toEraParkRaw: resolveTransferParkFactor(toTeamRow.id, [selectedTeam, toTeamRow.name], "era", teamParkComponents),
          fromWhipParkRaw: resolveTransferParkFactor(fromTeamRow?.id, [livePlayer.team, fromTeamRow?.name], "whip", teamParkComponents),
          toWhipParkRaw: resolveTransferParkFactor(toTeamRow.id, [selectedTeam, toTeamRow.name], "whip", teamParkComponents),
          fromHr9ParkRaw: resolveTransferParkFactor(fromTeamRow?.id, [livePlayer.team, fromTeamRow?.name], "hr9", teamParkComponents),
          toHr9ParkRaw: resolveTransferParkFactor(toTeamRow.id, [selectedTeam, toTeamRow.name], "hr9", teamParkComponents),
          toTeam: toTeamRow.name,
          toConference: toConf,
        },
        { eq: effEq, roleOverride: slotRole },
      );

      if (result.blocked) {
        return snapshotFallback;
      }

      const pitcherClassKey = String(p.class_transition || livePred.class_transition || "SJ").toUpperCase();
      const pitcherClassTransition: "FS" | "SJ" | "JS" | "GR" = isJucoPitcherSrc
        ? "SJ"
        : (pitcherClassKey === "FS" || pitcherClassKey === "SJ" || pitcherClassKey === "JS" || pitcherClassKey === "GR"
            ? pitcherClassKey
            : "SJ");
      const pitcherDevAgg = isJucoPitcherSrc
        ? 0
        : (Number.isFinite(Number(p.dev_aggressiveness ?? livePred.dev_aggressiveness))
            ? Number(p.dev_aggressiveness ?? livePred.dev_aggressiveness)
            : 0);
      const classEraAdj = isJucoPitcherSrc ? 0 : toPitchingClassAdj(pitcherClassTransition, pitchingEq.class_era_fs, pitchingEq.class_era_sj, pitchingEq.class_era_js, pitchingEq.class_era_gr);
      const classFipAdj = isJucoPitcherSrc ? 0 : toPitchingClassAdj(pitcherClassTransition, pitchingEq.class_fip_fs, pitchingEq.class_fip_sj, pitchingEq.class_fip_js, pitchingEq.class_fip_gr);
      const classWhipAdj = isJucoPitcherSrc ? 0 : toPitchingClassAdj(pitcherClassTransition, pitchingEq.class_whip_fs, pitchingEq.class_whip_sj, pitchingEq.class_whip_js, pitchingEq.class_whip_gr);
      const classK9Adj = isJucoPitcherSrc ? 0 : toPitchingClassAdj(pitcherClassTransition, pitchingEq.class_k9_fs, pitchingEq.class_k9_sj, pitchingEq.class_k9_js, pitchingEq.class_k9_gr);
      const classBb9Adj = isJucoPitcherSrc ? 0 : toPitchingClassAdj(pitcherClassTransition, pitchingEq.class_bb9_fs, pitchingEq.class_bb9_sj, pitchingEq.class_bb9_js, pitchingEq.class_bb9_gr);
      const classHr9Adj = isJucoPitcherSrc ? 0 : toPitchingClassAdj(pitcherClassTransition, pitchingEq.class_hr9_fs, pitchingEq.class_hr9_sj, pitchingEq.class_hr9_js, pitchingEq.class_hr9_gr);
      const pitcherLowMult = (adj: number) => 1 - adj - (pitcherDevAgg * 0.06);
      const pitcherHighMult = (adj: number) => 1 + adj + (pitcherDevAgg * 0.06);

      const adjEra = result.p_era == null ? null : result.p_era * pitcherLowMult(classEraAdj);
      const adjFip = result.p_fip == null ? null : result.p_fip * pitcherLowMult(classFipAdj);
      const adjWhip = result.p_whip == null ? null : result.p_whip * pitcherLowMult(classWhipAdj);
      const adjK9 = result.p_k9 == null ? null : result.p_k9 * pitcherHighMult(classK9Adj);
      const adjBb9 = result.p_bb9 == null ? null : result.p_bb9 * pitcherLowMult(classBb9Adj);
      const adjHr9 = result.p_hr9 == null ? null : result.p_hr9 * pitcherLowMult(classHr9Adj);

      const eraPlusAdj = calcPitchingPlus(adjEra, pitchingEq.era_plus_ncaa_avg, pitchingEq.era_plus_ncaa_sd, pitchingEq.era_plus_scale, false);
      const fipPlusAdj = calcPitchingPlus(adjFip, pitchingEq.fip_plus_ncaa_avg, pitchingEq.fip_plus_ncaa_sd, pitchingEq.fip_plus_scale, false);
      const whipPlusAdj = calcPitchingPlus(adjWhip, pitchingEq.whip_plus_ncaa_avg, pitchingEq.whip_plus_ncaa_sd, pitchingEq.whip_plus_scale, false);
      const k9PlusAdj = calcPitchingPlus(adjK9, pitchingEq.k9_plus_ncaa_avg, pitchingEq.k9_plus_ncaa_sd, pitchingEq.k9_plus_scale, true);
      const bb9PlusAdj = calcPitchingPlus(adjBb9, pitchingEq.bb9_plus_ncaa_avg, pitchingEq.bb9_plus_ncaa_sd, pitchingEq.bb9_plus_scale, false);
      const hr9PlusAdj = calcPitchingPlus(adjHr9, pitchingEq.hr9_plus_ncaa_avg, pitchingEq.hr9_plus_ncaa_sd, pitchingEq.hr9_plus_scale, false);

      const pRvPlusAdj = [eraPlusAdj, fipPlusAdj, whipPlusAdj, k9PlusAdj, bb9PlusAdj, hr9PlusAdj].every((v) => v != null)
        ? (Number(eraPlusAdj) * pitchingEq.era_plus_weight) +
          (Number(fipPlusAdj) * pitchingEq.fip_plus_weight) +
          (Number(whipPlusAdj) * pitchingEq.whip_plus_weight) +
          (Number(k9PlusAdj) * pitchingEq.k9_plus_weight) +
          (Number(bb9PlusAdj) * pitchingEq.bb9_plus_weight) +
          (Number(hr9PlusAdj) * pitchingEq.hr9_plus_weight)
        : result.p_rv_plus;

      return {
        p_avg: null,
        p_obp: null,
        p_slg: null,
        p_wrc_plus: pRvPlusAdj,
        p_era: adjEra,
        p_fip: adjFip,
        p_whip: adjWhip,
        p_k9: adjK9,
        p_bb9: adjBb9,
        p_hr9: adjHr9,
        p_rv_plus: pRvPlusAdj,
        p_war: result.p_war,
        nil_valuation: result.market_value,
        owar: result.p_war,
      };
    }

    const rawLastAvg = livePred.from_avg;
    const rawLastObp = livePred.from_obp;
    const rawLastSlg = livePred.from_slg;
    if (rawLastAvg == null || rawLastObp == null || rawLastSlg == null) {
      return snapshotFallback;
    }

    const isJucoSrc = (livePlayer as any).division === "NJCAA_D1"
      || /^NJCAA D1/i.test(String(livePlayer.conference || ""));
    const lastAvg = isJucoSrc
      ? applyJucoOutlierRegression(rawLastAvg, JUCO_REGRESSION_CONFIG.avg.mean, JUCO_REGRESSION_CONFIG.avg.threshold, JUCO_REGRESSION_CONFIG.avg.slope, JUCO_REGRESSION_CONFIG.avg.maxR)
      : rawLastAvg;
    const lastObp = isJucoSrc
      ? applyJucoOutlierRegression(rawLastObp, JUCO_REGRESSION_CONFIG.obp.mean, JUCO_REGRESSION_CONFIG.obp.threshold, JUCO_REGRESSION_CONFIG.obp.slope, JUCO_REGRESSION_CONFIG.obp.maxR)
      : rawLastObp;
    const lastSlg = (() => {
      if (!isJucoSrc) return rawLastSlg;
      const rawIso = rawLastSlg - rawLastAvg;
      const adjIso = applyJucoOutlierRegression(rawIso, JUCO_REGRESSION_CONFIG.iso.mean, JUCO_REGRESSION_CONFIG.iso.threshold, JUCO_REGRESSION_CONFIG.iso.slope, JUCO_REGRESSION_CONFIG.iso.maxR);
      return lastAvg + adjIso;
    })();

    const fullName = `${livePlayer.first_name} ${livePlayer.last_name}`;
    const byId = p.player_id ? seedByPlayerId.get(p.player_id) : undefined;
    let inferredFromTeam: string | null = byId?.team ?? null;
    if (!inferredFromTeam) {
    const candidates = seedByName.get(normalizeKey(fullName)) || [];
    if (candidates.length === 1) {
      inferredFromTeam = candidates[0].team;
    } else if (candidates.length > 1) {
      const key = `${statKey(lastAvg)}|${statKey(lastObp)}|${statKey(lastSlg)}`;
      const exact = candidates.find((r) => `${statKey(r.avg)}|${statKey(r.obp)}|${statKey(r.slg)}` === key);
      inferredFromTeam = exact?.team || candidates[0].team;
    }
    }

    const fromTeamName = livePlayer.from_team || inferredFromTeam || livePlayer.team;
    const fromTeamRow = fromTeamName ? teamByKey.get(normalizeKey(fromTeamName)) || null : null;
    const toTeamRow = teamByKey.get(normalizeKey(selectedTeam)) || null;
    if (!toTeamRow) {
      return snapshotFallback;
    }

    const fromConference = fromTeamRow?.conference || livePlayer.conference || null;
    const jucoFromConfId = isJucoSrc
      ? (JUCO_DISTRICT_CONFERENCE_ID[jucoDistrictNameFromConference(fromConference) ?? ""] ?? null)
      : null;
    const fromConfStats = resolveConferenceStats(fromConference, fromTeamRow?.conference_id ?? jucoFromConfId);
    const toConfStats = resolveConferenceStats(toTeamRow.conference || null, toTeamRow.conference_id ?? null);

    const internals = livePred.id ? internalsByPredictionId.get(livePred.id) || null : null;
    const isoPRFromSeed = (() => {
      const sid = (livePlayer as any).source_player_id || (p.player as any)?.source_player_id;
      const sidKey = sid ? `sid:${sid}` : null;
      const nameKey = `${normalizeName(`${livePlayer.first_name} ${livePlayer.last_name}`.trim())}|${normalizeName(livePlayer.team || "")}`;
      const seed = (sidKey ? powerLookup.get(sidKey) : null) || powerLookup.get(nameKey) || null;
      if (!seed) return null;
      const computed = computeHitterPowerRatings({
        contact: seed.contact, lineDrive: seed.lineDrive,
        avgExitVelo: seed.avgExitVelo, popUp: seed.popUp,
        bb: seed.bb, chase: seed.chase,
        barrel: seed.barrel, ev90: seed.ev90,
        pull: seed.pull, la10_30: seed.la10_30, gb: seed.gb,
      });
      return computed;
    })();
    const baPR = internals?.avg_power_rating ?? isoPRFromSeed?.baPlus ?? (isJucoSrc ? 100 : null);
    const obpPR = internals?.obp_power_rating ?? isoPRFromSeed?.obpPlus ?? (isJucoSrc ? 100 : null);
    const isoPR = internals?.slg_power_rating ?? isoPRFromSeed?.isoPlus ?? (isJucoSrc ? 100 : null);

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
    const hand = batsHandToHandedness((livePlayer as any).bats_hand);
    const fromParkAvgRaw = resolveMetricParkFactor(fromTeamRow?.id, "avg", teamParkComponents, fromTeamRow?.name, undefined, undefined, hand);
    const toParkAvgRaw = resolveMetricParkFactor(toTeamRow?.id, "avg", teamParkComponents, toTeamRow?.name, undefined, undefined, hand);
    const fromParkObpRaw = resolveMetricParkFactor(fromTeamRow?.id, "obp", teamParkComponents, fromTeamRow?.name, undefined, undefined, hand);
    const toParkObpRaw = resolveMetricParkFactor(toTeamRow?.id, "obp", teamParkComponents, toTeamRow?.name, undefined, undefined, hand);
    const fromParkIsoRaw = resolveMetricParkFactor(fromTeamRow?.id, "iso", teamParkComponents, fromTeamRow?.name, undefined, undefined, hand);
    const toParkIsoRaw = resolveMetricParkFactor(toTeamRow?.id, "iso", teamParkComponents, toTeamRow?.name, undefined, undefined, hand);
    if (
      fromAvgPlus == null || toAvgPlus == null ||
      fromObpPlus == null || toObpPlus == null ||
      fromIsoPlus == null || toIsoPlus == null ||
      fromStuff == null || toStuff == null
    ) {
      return snapshotFallback;
    }
    if (!isJucoSrc && (
      fromParkAvgRaw == null || toParkAvgRaw == null ||
      fromParkObpRaw == null || toParkObpRaw == null ||
      fromParkIsoRaw == null || toParkIsoRaw == null
    )) {
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
    const srcW = transferWeightsForSource(isJucoSrc ? "NJCAA_D1" : null);
    const jW = <K extends keyof typeof srcW>(k: K, d1: number) => isJucoSrc ? srcW[k] : d1;
    const baPowerWeight = toRate(jW("t_ba_power_weight", eqNum("t_ba_power_weight", 0.70)));
    const obpPowerWeight = toRate(jW("t_obp_power_weight", eqNum("t_obp_power_weight", 0.70)));
    const baConferenceWeight = toWeight(jW("t_ba_conference_weight", eqNum("t_ba_conference_weight", TRANSFER_WEIGHT_DEFAULTS.t_ba_conference_weight)));
    const obpConferenceWeight = toWeight(jW("t_obp_conference_weight", eqNum("t_obp_conference_weight", TRANSFER_WEIGHT_DEFAULTS.t_obp_conference_weight)));
    const isoConferenceWeight = toWeight(jW("t_iso_conference_weight", eqNum("t_iso_conference_weight", TRANSFER_WEIGHT_DEFAULTS.t_iso_conference_weight)));
    const baPitchingWeight = toWeight(jW("t_ba_pitching_weight", eqNum("t_ba_pitching_weight", TRANSFER_WEIGHT_DEFAULTS.t_ba_pitching_weight)));
    const obpPitchingWeight = toWeight(jW("t_obp_pitching_weight", eqNum("t_obp_pitching_weight", TRANSFER_WEIGHT_DEFAULTS.t_obp_pitching_weight)));
    const isoPitchingWeight = toWeight(jW("t_iso_pitching_weight", eqNum("t_iso_pitching_weight", TRANSFER_WEIGHT_DEFAULTS.t_iso_pitching_weight)));
    const baParkWeight = toWeight(jW("t_ba_park_weight", eqNum("t_ba_park_weight", TRANSFER_WEIGHT_DEFAULTS.t_ba_park_weight)));
    const obpParkWeight = toWeight(jW("t_obp_park_weight", eqNum("t_obp_park_weight", TRANSFER_WEIGHT_DEFAULTS.t_obp_park_weight)));
    const isoParkWeight = toWeight(jW("t_iso_park_weight", eqNum("t_iso_park_weight", TRANSFER_WEIGHT_DEFAULTS.t_iso_park_weight)));
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
    const classAdj = isJucoSrc ? 0 : (
      classKey === "FS" ? 0.03 :
      classKey === "SJ" ? 0.02 :
      classKey === "JS" ? 0.015 :
      classKey === "GR" ? 0.01 : 0.02);
    const devAgg = isJucoSrc ? 0 : (Number.isFinite(Number(p.dev_aggressiveness)) ? Number(p.dev_aggressiveness) : 0);
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
  }, [selectedTeam, teamByKey, resolveConferenceStats, internalsByPredictionId, seedByName, seedByPlayerId, liveTargetPredictionByPlayerId, liveTargetPlayerById, teamParkComponents, pitchingStatsByNameTeam, pitchingPrByNameTeam, pitchingConfLookup, pitchingEq, teams, effectiveTeamId, powerLookup, remoteEquationValues]);

  // ── Block I: inline helpers (module-level, exposed for TB) ───────────────────
  // (isPitcher, isTwp, hitterEligible, pitcherEligible already defined above)
  // Block K (positionPlayers / pitchers / target* arrays) moved below Block O
  // because their WAR-desc sort comparators call playerProjection — declaration
  // order matters here, otherwise TDZ throws on first TB render.

  // ── Block L: pitchingTierMultipliers, pitchingPvfForRole ─────────────────────
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

  // ── Block M: computePitcherPwar ───────────────────────────────────────────────
  const computePitcherPwar = useCallback((p: BuildPlayer, source: any) => {
    const pRvPlusRaw = source?.p_rv_plus ?? source?.p_wrc_plus ?? p.transfer_snapshot?.p_rv_plus ?? p.transfer_snapshot?.p_wrc_plus ?? null;
    const pRvPlus = Number(pRvPlusRaw);
    if (!Number.isFinite(pRvPlus) || pitchingEq.pwar_runs_per_win === 0) return null;
    const sourceId = (p.player as any)?.source_player_id ?? null;
    const pmRole = sourceId ? pitchingStatsByNameTeam.bySourceId.get(sourceId)?.role : null;
    const currentPitcherRole = effectivePitcherRoleForBuild(p, pmRole);
    const pitcherDepthRole = normalizePitcherDepthRole(p.depth_role, currentPitcherRole);
    const pitcherExpectedIp = (
      depthRole: BuildPlayer["depth_role"],
      eq: { pwar_ip_sp: number; pwar_ip_sm: number; pwar_ip_rp: number },
    ): number => {
      switch (depthRole) {
        case "weekend_starter":       return eq.pwar_ip_sp;
        case "weekday_starter":       return eq.pwar_ip_sm;
        case "swing_starter":         return 30;
        case "workhorse_reliever":    return 50;
        case "high_leverage_reliever":return 33;
        case "mid_leverage_reliever": return 20;
        case "low_impact_reliever":   return 12;
        case "specialist_reliever":   return 6;
        default:                      return eq.pwar_ip_rp;
      }
    };
    const ipByRole = pitcherExpectedIp(pitcherDepthRole, pitchingEq);
    const pitcherValue = (pRvPlus - 100) / 100;
    const basePwar = (
      (pitcherValue * (ipByRole / 9) * pitchingEq.pwar_r_per_9) +
      ((ipByRole / 9) * pitchingEq.pwar_replacement_runs_per_9)
    ) / pitchingEq.pwar_runs_per_win;
    return basePwar * depthRoleMultiplier(p.depth_role);
  }, [pitchingEq, pitchingStatsByNameTeam]);

  // ── Block N: computeReturnerPitchingProjection ────────────────────────────────
  const computeReturnerPitchingProjection = useCallback((p: BuildPlayer) => {
    const fullName = p.player
      ? `${p.player.first_name} ${p.player.last_name}`.trim()
      : (p.custom_name || "").trim();
    const teamName = p.player?.team || selectedTeam || "";
    const key = `${normalizeName(fullName)}|${normalizeName(teamName)}`;
    const sourceId = (p as any)?.player?.source_player_id || null;
    const nName = normalizeName(fullName);

    const stats = pitchingStatsByNameTeam.byKey.get(key)
      || (sourceId ? pitchingStatsByNameTeam.bySourceId.get(sourceId) : null)
      || (() => {
        const bucket = pitchingStatsByNameTeam.byName.get(nName) || [];
        if (bucket.length === 1) return bucket[0];
        if (bucket.length > 1) {
          const selNorm = normalizeName(selectedTeam || "");
          const match = bucket.find((b) => normalizeName(b.team || "") === selNorm);
          if (match) return match;
          return bucket[0];
        }
        return null;
      })();
    const pr = pitchingPrByNameTeam.byKey.get(key)
      || (sourceId ? pitchingPrByNameTeam.bySourceId.get(sourceId) : null)
      || (() => {
        const bucket = pitchingPrByNameTeam.byName.get(nName) || [];
        if (bucket.length >= 1) return bucket[0];
        return null;
      })();
    if (!stats) return null;

    const currentPitcherRole = effectivePitcherRoleForBuild(p, stats.role);
    const classTransitionRaw = String(p.class_transition || "SJ").toUpperCase();
    const classTransition: "FS" | "SJ" | "JS" | "GR" =
      classTransitionRaw === "FS" || classTransitionRaw === "SJ" || classTransitionRaw === "JS" || classTransitionRaw === "GR"
        ? classTransitionRaw
        : "SJ";
    const devAgg = Number.isFinite(Number(p.dev_aggressiveness)) ? Number(p.dev_aggressiveness) : 0;
    const teamRowForPark = teamByKey.get(normalizeKey(teamName)) || null;

    const projection = computePitcherProjection(
      {
        era: stats.era ?? null,
        fip: stats.fip ?? null,
        whip: stats.whip ?? null,
        k9: stats.k9 ?? null,
        bb9: stats.bb9 ?? null,
        hr9: stats.hr9 ?? null,
        stuffPlus: null,
        miss_pct: null,
        bb_pct: null,
        hard_hit_pct: null,
        in_zone_whiff_pct: null,
        chase_pct: null,
        barrel_pct: null,
        line_pct: null,
        exit_vel: null,
        ground_pct: null,
        in_zone_pct: null,
        vel_90th: null,
        h_pull_pct: null,
        la_10_30_pct: null,
        role: stats.role ?? null,
        g: stats.g ?? null,
        gs: stats.gs ?? null,
        team: teamName || null,
        teamId: teamRowForPark?.id ?? null,
        conference: teamRowForPark?.conference ?? null,
      },
      {
        eq: pitchingEq,
        powerEq: pitchingPowerEq as unknown as Record<string, number>,
        parkMap: teamParkComponents,
        teamMatch: teamRowForPark
          ? { id: teamRowForPark.id, name: teamRowForPark.name, park_factor: teamRowForPark.park_factor ?? null }
          : null,
        roleOverride: currentPitcherRole,
        classTransition,
        devAggressiveness: devAgg,
        storedPrPlus: pr
          ? {
              era: pr.eraPrPlus ?? null,
              fip: pr.fipPrPlus ?? null,
              whip: pr.whipPrPlus ?? null,
              k9: pr.k9PrPlus ?? null,
              bb9: pr.bb9PrPlus ?? null,
              hr9: pr.hr9PrPlus ?? null,
            }
          : undefined,
      },
    );

    return {
      p_era: projection.p_era,
      p_fip: projection.p_fip,
      p_whip: projection.p_whip,
      p_k9: projection.p_k9,
      p_bb9: projection.p_bb9,
      p_hr9: projection.p_hr9,
      p_rv_plus: projection.p_rv_plus,
      p_war: projection.p_war,
      nil_valuation: null as number | null,
    };
  }, [pitchingEq, pitchingPowerEq, pitchingPrByNameTeam, pitchingStatsByNameTeam, selectedTeam, teamByKey, teamParkComponents]);

  // ── Block O: playerProjection ────────────────────────────────────────────────
  const playerProjection = useCallback((p: BuildPlayer, side?: "hitter" | "pitcher") => {
    const treatAsPitcher = side === "pitcher" || (side == null && isPitcher(p));
    const sim = p.roster_status === "target" ? simulateTransferProjection(p, side) : null;
    const shown = (p.roster_status === "target")
      ? (sim ?? p.transfer_snapshot ?? null)
      : (treatAsPitcher ? (computeReturnerPitchingProjection(p) ?? p.prediction) : p.prediction);
    if (treatAsPitcher) {
      const sourceBase: any = shown ?? p.transfer_snapshot ?? null;
      let source: any = sourceBase;
      if ((p.roster_status || "returner") === "target" && sourceBase) {
        const livePred = p.player_id ? liveTargetPredictionByPlayerId.get(p.player_id) : null;
        const classTransitionRaw = String(p.class_transition || livePred?.class_transition || "SJ").toUpperCase();
        const classTransition: "FS" | "SJ" | "JS" | "GR" =
          classTransitionRaw === "FS" || classTransitionRaw === "SJ" || classTransitionRaw === "JS" || classTransitionRaw === "GR"
            ? classTransitionRaw
            : "SJ";
        const devAggCandidate = Number.isFinite(Number(p.dev_aggressiveness))
          ? Number(p.dev_aggressiveness)
          : Number.isFinite(Number(livePred?.dev_aggressiveness))
            ? Number(livePred?.dev_aggressiveness)
            : 0;
        const devAgg = devAggCandidate;
        const classEraAdj = toPitchingClassAdj(classTransition, pitchingEq.class_era_fs, pitchingEq.class_era_sj, pitchingEq.class_era_js, pitchingEq.class_era_gr);
        const classFipAdj = toPitchingClassAdj(classTransition, pitchingEq.class_fip_fs, pitchingEq.class_fip_sj, pitchingEq.class_fip_js, pitchingEq.class_fip_gr);
        const classWhipAdj = toPitchingClassAdj(classTransition, pitchingEq.class_whip_fs, pitchingEq.class_whip_sj, pitchingEq.class_whip_js, pitchingEq.class_whip_gr);
        const classK9Adj = toPitchingClassAdj(classTransition, pitchingEq.class_k9_fs, pitchingEq.class_k9_sj, pitchingEq.class_k9_js, pitchingEq.class_k9_gr);
        const classBb9Adj = toPitchingClassAdj(classTransition, pitchingEq.class_bb9_fs, pitchingEq.class_bb9_sj, pitchingEq.class_bb9_js, pitchingEq.class_bb9_gr);
        const classHr9Adj = toPitchingClassAdj(classTransition, pitchingEq.class_hr9_fs, pitchingEq.class_hr9_sj, pitchingEq.class_hr9_js, pitchingEq.class_hr9_gr);
        const lowBetterMult = (adj: number) => 1 - adj - (devAgg * 0.06);
        const highBetterMult = (adj: number) => 1 + adj + (devAgg * 0.06);
        const pEraAdj = sourceBase?.p_era == null ? null : Number(sourceBase.p_era) * lowBetterMult(classEraAdj);
        const pFipAdj = sourceBase?.p_fip == null ? null : Number(sourceBase.p_fip) * lowBetterMult(classFipAdj);
        const pWhipAdj = sourceBase?.p_whip == null ? null : Number(sourceBase.p_whip) * lowBetterMult(classWhipAdj);
        const pK9Adj = sourceBase?.p_k9 == null ? null : Number(sourceBase.p_k9) * highBetterMult(classK9Adj);
        const pBb9Adj = sourceBase?.p_bb9 == null ? null : Number(sourceBase.p_bb9) * lowBetterMult(classBb9Adj);
        const pHr9Adj = sourceBase?.p_hr9 == null ? null : Number(sourceBase.p_hr9) * lowBetterMult(classHr9Adj);
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
    const shownWrc = (() => {
      if (shown?.p_wrc_plus != null) return shown.p_wrc_plus;
      const pAvg = Number(shown?.p_avg);
      const pObp = Number(shown?.p_obp);
      const pSlg = Number(shown?.p_slg);
      const pIso = Number(shown?.p_iso ?? ((Number.isFinite(pSlg) && Number.isFinite(pAvg)) ? (pSlg - pAvg) : NaN));
      if (![pAvg, pObp, pSlg, pIso].every(Number.isFinite)) return null;
      const wObp = eqNum("r_w_obp", 0.45);
      const wSlg = eqNum("r_w_slg", 0.3);
      const wAvg = eqNum("r_w_avg", 0.15);
      const wIso = eqNum("r_w_iso", 0.1);
      const ncaaWrc = eqNum("r_ncaa_avg_wrc", 0.364);
      if (!Number.isFinite(ncaaWrc) || ncaaWrc <= 0) return null;
      const pWrc = (wObp * pObp) + (wSlg * pSlg) + (wAvg * pAvg) + (wIso * pIso);
      return Math.round((pWrc / ncaaWrc) * 100);
    })();
    const baseOwar = computeOWarFromWrcPlus(shownWrc) ?? p.nil_owar ?? 0;
    const owar = baseOwar * depthRoleMultiplier(p.depth_role);
    return { sim, shown, shownWrc, owar, pwar: null };
  }, [computePitcherPwar, computeReturnerPitchingProjection, simulateTransferProjection, pitchingEq, liveTargetPredictionByPlayerId, remoteEquationValues]);

  // ── Block K (relocated): positionPlayers, pitchers, targetPlayers, targetPositionPlayers, targetPitchers
  // Sorted by WAR desc so highest-impact players appear at the top of each table.
  // Must live AFTER playerProjection — sort comparators call into it.
  const positionPlayers = [...rosterPlayers.filter(hitterEligible)]
    .sort((a, b) => (playerProjection(b, "hitter")?.owar ?? -Infinity) - (playerProjection(a, "hitter")?.owar ?? -Infinity));
  const pitchers = [...rosterPlayers.filter(pitcherEligible)]
    .sort((a, b) => ((playerProjection(b, "pitcher") as any)?.pwar ?? -Infinity) - ((playerProjection(a, "pitcher") as any)?.pwar ?? -Infinity));
  const targetPlayers = rosterPlayers.filter((p) => (p.roster_status || "returner") === "target");
  const targetPositionPlayers = [...targetPlayers.filter(hitterEligible)]
    .sort((a, b) => (playerProjection(b, "hitter")?.owar ?? -Infinity) - (playerProjection(a, "hitter")?.owar ?? -Infinity));
  const targetPitchers = [...targetPlayers.filter(pitcherEligible)]
    .sort((a, b) => ((playerProjection(b, "pitcher") as any)?.pwar ?? -Infinity) - ((playerProjection(a, "pitcher") as any)?.pwar ?? -Infinity));

  // ── Block P: projectedPlayerScore, nilBasePerOWar, projectedNilForPlayer, effectiveNilForPlayer
  const projectedPlayerScore = useCallback((p: BuildPlayer) => {
    const { owar } = playerProjection(p);
    return calcPlayerScore({
      owar,
      programTierMultiplier,
      position: p.position_slot || p.player?.position,
    });
  }, [playerProjection, programTierMultiplier]);

  const nilBasePerOWar = eqNum("nil_base_per_owar", 25000);

  const isProjectedStatus = (p: BuildPlayer) => (p.roster_status || "returner") !== "leaving";

  const projectedNilForPlayer = useCallback((p: BuildPlayer, side?: "hitter" | "pitcher") => {
    if (!isProjectedStatus(p)) return 0;
    const renderAsPitcher = side === "pitcher" || (side == null && isPitcher(p));
    if (renderAsPitcher) {
      const projection = playerProjection(p, "pitcher");
      const source: any = projection.shown ?? projection.sim ?? p.transfer_snapshot ?? p.prediction ?? null;
      const direct = Number(source?.nil_valuation);
      if (Number.isFinite(direct) && direct > 0) return direct;
      const pwar = projection.pwar;
      if (!Number.isFinite(Number(pwar))) return 0;
      const sourceId = (p.player as any)?.source_player_id ?? null;
      const pmRole = sourceId ? pitchingStatsByNameTeam.bySourceId.get(sourceId)?.role : null;
      const currentPitcherRole = effectivePitcherRoleForBuild(p, pmRole);
      const conference = selectedTeam
        ? (teamByKey.get(normalizeKey(selectedTeam))?.conference ?? p.player?.conference ?? null)
        : (p.player?.conference ?? null);
      const ptm = getProgramTierMultiplierByConference(conference, pitchingTierMultipliers);
      const pvm = pitchingPvfForRole(currentPitcherRole);
      return Number(pwar) * pitchingEq.market_dollars_per_war * ptm * pvm;
    }
    return projectedPlayerScore(p) * nilBasePerOWar;
  }, [nilBasePerOWar, pitchingEq, pitchingPvfForRole, pitchingTierMultipliers, projectedPlayerScore, playerProjection, selectedTeam, teamByKey, pitchingStatsByNameTeam]);

  const effectiveNilForPlayer = useCallback((p: BuildPlayer, side?: "hitter" | "pitcher") => {
    if (!isProjectedStatus(p)) return 0;
    const onPrimarySide = side == null || (side === "pitcher" ? isPitcher(p) : !isPitcher(p));
    if (onPrimarySide) {
      const actualNil = Number(p.nil_value) || 0;
      if (actualNil > 0) return actualNil;
    }
    return projectedNilForPlayer(p, side);
  }, [projectedNilForPlayer]);

  // ── Block Q: isProjectedStatus, totalRosterPlayerScore, totalEffectiveNil, budgetRemaining
  // (isProjectedStatus defined above near projectedNilForPlayer)

  const totalRosterPlayerScore = rosterPlayers.reduce((sum, p) => {
    if (!isProjectedStatus(p)) return sum;
    return sum + projectedPlayerScore(p);
  }, 0);
  const totalEffectiveNil = rosterPlayers.reduce((sum, p) => {
    let v = 0;
    if (hitterEligible(p)) v += effectiveNilForPlayer(p, "hitter");
    if (pitcherEligible(p)) v += effectiveNilForPlayer(p, "pitcher");
    return sum + v;
  }, 0);
  const budgetRemaining = totalBudget - totalEffectiveNil;

  // ── Block R: calcTotals, table total useMemos, projectedBudgetValue ──────────
  const calcTotals = useCallback((rows: BuildPlayer[], forSide?: "hitter" | "pitcher") => {
    let sumAvg = 0;
    let sumObp = 0;
    let sumSlg = 0;
    let sumWrc = 0;
    let weightAvg = 0;
    let weightObp = 0;
    let weightSlg = 0;
    let weightWrc = 0;
    let totalOWar = 0;
    let totalPWar = 0;
    let totalActualNil = 0;
    let totalProjectedNil = 0;
    let totalPlayerScore = 0;
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
      const { shown } = playerProjection(p);
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
      if (pitcherEligible(p)) {
        const pitcherProj = isPitcher(p) ? { shown } : playerProjection(p, "pitcher");
        const source: any = pitcherProj.shown ?? ((p.roster_status === "target") ? p.transfer_snapshot : p.prediction) ?? null;
        const sourceId = (p.player as any)?.source_player_id ?? null;
        const pmRole = sourceId ? pitchingStatsByNameTeam.bySourceId.get(sourceId)?.role : null;
        const role = effectivePitcherRoleForBuild(p, pmRole);
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
      if (forSide === "hitter") {
        totalOWar += playerProjection(p, "hitter").owar ?? 0;
      } else if (forSide === "pitcher") {
        totalPWar += playerProjection(p, "pitcher").pwar ?? 0;
      } else {
        if (hitterEligible(p)) {
          totalOWar += playerProjection(p, "hitter").owar ?? 0;
        }
        if (pitcherEligible(p)) {
          totalPWar += playerProjection(p, "pitcher").pwar ?? 0;
        }
      }
      totalActualNil += effectiveNilForPlayer(p, forSide);
      totalProjectedNil += projectedNilForPlayer(p, forSide);
      totalPlayerScore += projectedPlayerScore(p);
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
      totalPWar,
      totalWar: totalOWar + totalPWar,
      totalActualNil,
      totalProjectedNil,
      totalPlayerScore,
    };
  }, [isProjectedStatus, playerProjection, effectiveNilForPlayer, projectedNilForPlayer, pitchingEq, pitchingStatsByNameTeam]);

  const rosterTableTotals = useMemo(() => calcTotals(rosterPlayers), [calcTotals, rosterPlayers]);
  const positionTableTotals = useMemo(() => calcTotals(positionPlayers, "hitter"), [calcTotals, positionPlayers]);
  const pitcherTableTotals = useMemo(() => calcTotals(pitchers, "pitcher"), [calcTotals, pitchers]);
  const targetPositionTableTotals = useMemo(() => calcTotals(targetPositionPlayers, "hitter"), [calcTotals, targetPositionPlayers]);
  const targetPitcherTableTotals = useMemo(() => calcTotals(targetPitchers, "pitcher"), [calcTotals, targetPitchers]);

  const projectedBudgetValue = useCallback((p: BuildPlayer) => {
    if (!isProjectedStatus(p) || totalBudget <= 0) return null;
    const score = projectedPlayerScore(p);
    const total = fallbackRosterTotalPlayerScore;
    if (total <= 0) return null;
    return (score / total) * totalBudget;
  }, [projectedPlayerScore, totalBudget, fallbackRosterTotalPlayerScore]);

  // ── Return ────────────────────────────────────────────────────────────────────
  return {
    teamByKey,
    selectedTeamSourceId,
    selectedTeamConference,
    selectedTeamFullName,
    pitchingPrByNameTeam,
    confByKey,
    seedByName,
    seedByPlayerId,
    liveTargetPredictionByPlayerId,
    liveTargetPlayerById,
    internalsByPredictionId,
    resolveConferenceStats,
    simulateTransferProjection,
    computePitcherPwar,
    computeReturnerPitchingProjection,
    playerProjection,
    projectedPlayerScore,
    nilBasePerOWar,
    projectedNilForPlayer,
    effectiveNilForPlayer,
    isProjectedStatus,
    projectedBudgetValue,
    calcTotals,
    rosterTableTotals,
    positionTableTotals,
    pitcherTableTotals,
    targetPositionTableTotals,
    targetPitcherTableTotals,
    hitterEligible,
    pitcherEligible,
    positionPlayers,
    pitchers,
    targetPositionPlayers,
    targetPitchers,
    totalEffectiveNil,
    totalRosterPlayerScore,
    budgetRemaining,
    pitchingTierMultipliers,
    pitchingPvfForRole,
  };
}
