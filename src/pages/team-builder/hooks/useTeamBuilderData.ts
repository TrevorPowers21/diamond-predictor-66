import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useHitterSeedData } from "@/hooks/useHitterSeedData";
import { usePitchingSeedData } from "@/hooks/usePitchingSeedData";
import { usePitchingEquationWeights } from "@/hooks/usePitchingEquationWeights";
import { useConferenceStats } from "@/hooks/useConferenceStats";
import { usePlayerOverrides } from "@/hooks/usePlayerOverrides";
import { usePitcherRoleOverrides } from "@/hooks/usePitcherRoleOverrides";
import { useTeamsTable } from "@/hooks/useTeamsTable";
import { useParkFactors } from "@/hooks/useParkFactors";
import { useTargetBoard } from "@/hooks/useTargetBoard";
import { applyTeamScopeFilter } from "@/lib/teamScopedPredictions";
import { CURRENT_SEASON, PRIOR_SEASON } from "@/lib/seasonConstants";
import { normalizeName } from "../helpers";
import type { TeamRow } from "../types";

// Internal scoring helper — ranks a prediction row for "best pick" selection.
// Higher score = preferred row. Mirrors the same logic used on the Dashboard.
function scorePredictionLikeDashboard(row: any, isTransferPlayer: boolean): number {
  const rowHasFrom = row.from_avg != null || row.from_obp != null || row.from_slg != null;
  const rowHasPred =
    row.p_avg != null && row.p_obp != null && row.p_slg != null &&
    row.p_ops != null && row.p_iso != null && row.p_wrc_plus != null;
  const rowHasScout =
    row.ev_score != null || row.barrel_score != null ||
    row.whiff_score != null || row.chase_score != null;
  return (
    (((isTransferPlayer && row.model_type === "transfer") || (!isTransferPlayer && row.model_type === "returner")) ? 6 : 0) +
    (rowHasPred ? 5 : 0) +
    (rowHasScout ? 2 : 0) +
    (row.model_type === "transfer" ? 3 : 0) +
    (row.status === "active" ? 2 : 0) +
    (rowHasFrom ? 1 : 0)
  );
}

export type SeasonUsage = {
  thinSample: Map<string, boolean>;
  hitterAb: Map<string, number>;
  hitterAbByNameTeam: Map<string, number>;
  pitcherGs: Map<string, number>;
  pitcherG: Map<string, number>;
};

// Stable empty default — {} literal creates a new reference each render,
// causing simulateTransferProjection useCallback to recreate on every render.
const EMPTY_EQUATION_VALUES: Record<string, number> = {};

const SEASON_USAGE_FALLBACK: SeasonUsage = {
  thinSample: new Map(),
  hitterAb: new Map(),
  hitterAbByNameTeam: new Map(),
  pitcherGs: new Map(),
  pitcherG: new Map(),
};

/**
 * Centralises all data-fetching for Team Builder.
 * Covers: seed data hooks, static Supabase queries, and team-scoped queries
 * (builds + returners). The consumer only provides the two pieces of runtime
 * state the queries actually depend on.
 */
export function useTeamBuilderData({
  effectiveTeamId,
  selectedTeam,
}: {
  effectiveTeamId: string | null;
  selectedTeam: string;
}) {
  // ── External seed / config hooks ────────────────────────────────────────────
  const { hitterStats, powerRatings: powerRatingsData, exitPositions } = useHitterSeedData();
  // Gate behind effectiveTeamId — it's null until auth resolves, so this
  // prevents the concurrent page fetches from firing before the JWT is ready
  // (which causes 500s on the Pitching Master concurrent batch requests).
  const { pitchers: pitchingMasterRows } = usePitchingSeedData(2026, !!effectiveTeamId);
  const pitchingPowerEq = usePitchingEquationWeights();
  const { conferenceStats: newConfStats } = useConferenceStats(2026);
  const { overrides: playerOverrideMap, updateOverride: updatePlayerOverrideFn } = usePlayerOverrides();
  const { getRole: getSupabaseRole, setRole: setSupabaseRole } = usePitcherRoleOverrides();
  const { teams, teamsByName } = useTeamsTable();
  const { parkMap: teamParkComponents } = useParkFactors();
  const {
    board: supabaseTargetBoard,
    isLoading: targetBoardLoading,
    removePlayer: removeFromSupabaseBoard,
    addPlayer: addToSupabaseBoard,
    isOnBoard: isOnSupabaseBoard,
  } = useTargetBoard();

  // ── Team row derivation (depends on teams from useTeamsTable) ───────────────
  const selectedTeamRow = useMemo(() => {
    if (!selectedTeam) return null;
    const exact = (teams as TeamRow[]).find((t) => t.name === selectedTeam);
    if (exact) return exact;
    const shorten = (v: string) =>
      v.trim().toLowerCase()
        .replace(/\b(university|college|of)\b/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const short = shorten(selectedTeam);
    return (teams as TeamRow[]).find((t) => shorten(t.name) === short) ?? null;
  }, [selectedTeam, teams]);
  const selectedTeamId = selectedTeamRow?.id ?? null;

  // ── Player overrides map (flat object form for draft serialisation) ─────────
  const playerOverrides = useMemo(() => {
    const obj: Record<string, { position?: string | null }> = {};
    for (const [pid, ov] of playerOverrideMap.entries()) {
      obj[pid] = { position: ov.position };
    }
    return obj;
  }, [playerOverrideMap]);

  // ── Static Supabase queries ──────────────────────────────────────────────────

  const { data: remoteEquationValues = EMPTY_EQUATION_VALUES } = useQuery({
    queryKey: ["admin-ui-equation-values", CURRENT_SEASON],
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("model_config")
        .select("config_key, config_value")
        .eq("model_type", "admin_ui")
        .eq("season", CURRENT_SEASON);
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const row of data || []) map[row.config_key] = Number(row.config_value);
      return map;
    },
  });

  const { data: allPlayersForSearch = [] } = useQuery({
    queryKey: ["team-builder-all-players-search", effectiveTeamId],
    // Heavy query: scans ~16K players + lateral joins to player_predictions
    // and nil_valuations. Several MB of disk reads per fire. With the
    // defaults (staleTime 0, refetchOnWindowFocus true) it was re-firing
    // every tab refocus and depleting the Supabase disk IO budget. Cache
    // aggressively — the data only changes when an admin imports new
    // players, not while a coach is using the page.
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      let all: any[] = [];
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("players")
          .select("id, first_name, last_name, position, is_twp, class_year, throws_hand, bats_hand, team, from_team, conference, transfer_portal, portal_status, player_predictions(id, customer_team_id, from_avg, from_obp, from_slg, from_era, from_fip, from_whip, from_k9, from_bb9, from_hr9, p_avg, p_obp, p_slg, p_ops, p_iso, p_wrc_plus, p_era, p_fip, p_whip, p_k9, p_bb9, p_hr9, p_rv_plus, pitcher_role, power_rating_plus, class_transition, dev_aggressiveness, model_type, status, variant, updated_at), nil_valuations(estimated_value, component_breakdown)")
          // Stable ORDER BY so paginated .range() calls don't overlap or
          // skip rows non-deterministically.
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        all = all.concat(data || []);
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }
      // Hide players with no team — 50%+ of the players table is legacy
      // rows with null `team` (no Hitter Master backfill ran on them). They
      // show up as ghost rows in the search dropdown with no team chip and
      // confuse coaches. Backfill is a separate effort; filter for now.
      return all.filter((p) => p.first_name && p.last_name && (p.team || "").trim() !== "");
    },
  });

  const { data: hitterMasterPaMap = new Map<string, number>() } = useQuery({
    queryKey: ["team-builder-pa-lookup", PRIOR_SEASON],
    queryFn: async () => {
      const map = new Map<string, number>();
      const { data: hmRows } = await (supabase as any)
        .from("Hitter Master")
        .select("source_player_id, pa, ab")
        .eq("Season", PRIOR_SEASON)
        .gt("ab", 0);
      const sourceIdToPa = new Map<string, number>();
      for (const r of (hmRows || [])) {
        const pa = r.pa ?? r.ab ?? null;
        if (pa != null && r.source_player_id) sourceIdToPa.set(r.source_player_id, pa);
      }
      const { data: playerRows } = await supabase.from("players").select("id, source_player_id");
      for (const p of (playerRows || [])) {
        if (p.source_player_id && sourceIdToPa.has(p.source_player_id)) {
          map.set(p.id, sourceIdToPa.get(p.source_player_id)!);
        }
      }
      return map;
    },
    staleTime: 30 * 60 * 1000,
  });

  const { data: seasonUsage = SEASON_USAGE_FALLBACK } = useQuery({
    queryKey: ["team-builder-season-usage-lookup-v7", CURRENT_SEASON],
    queryFn: async () => {
      const thinSample = new Map<string, boolean>();
      const hitterAb = new Map<string, number>();
      const hitterAbByNameTeam = new Map<string, number>();
      const pitcherGs = new Map<string, number>();
      const pitcherG = new Map<string, number>();
      const fetchAllPaged = async <T,>(builder: () => any): Promise<T[]> => {
        const out: T[] = [];
        let from = 0;
        const PAGE = 1000;
        while (true) {
          const { data, error } = await builder().range(from, from + PAGE - 1);
          if (error) throw error;
          out.push(...((data || []) as T[]));
          if (!data || data.length < PAGE) break;
          from += PAGE;
        }
        return out;
      };
      const [hmRows, pmRows, playerRows] = await Promise.all([
        fetchAllPaged<any>(() =>
          (supabase as any)
            .from("Hitter Master")
            .select("source_player_id, pa, ab, combined_used, Season, playerFullName, Team")
            .eq("Season", CURRENT_SEASON),
        ),
        fetchAllPaged<any>(() =>
          (supabase as any)
            .from("Pitching Master")
            .select("source_player_id, IP, GS, G, combined_used")
            .eq("Season", CURRENT_SEASON),
        ),
        fetchAllPaged<any>(() =>
          supabase.from("players").select("id, source_player_id"),
        ),
      ]);
      const hitterBySource = new Map<string, { ab: number; thin: boolean }>();
      const pitcherBySource = new Map<string, { gs: number; g: number; thin: boolean }>();
      for (const r of (hmRows || [])) {
        // Prefer regular_season_pa when locked — keeps tier classification stable
        // across postseason additions; playoff teams don't get inflated tier counts.
        const playingTime = Number(r.regular_season_pa ?? r.pa ?? r.ab) || 0;
        if (r.source_player_id) {
          const existing = hitterBySource.get(r.source_player_id);
          if (!existing || playingTime > existing.ab) {
            hitterBySource.set(r.source_player_id, { ab: playingTime, thin: playingTime < 15 && !r.combined_used });
          }
        }
        const nameKey = `${normalizeName(r.playerFullName || "")}|${normalizeName(r.Team || "")}`;
        if (nameKey !== "|") {
          const prev = hitterAbByNameTeam.get(nameKey) ?? 0;
          if (playingTime > prev) hitterAbByNameTeam.set(nameKey, playingTime);
        }
      }
      for (const r of (pmRows || [])) {
        if (!r.source_player_id) continue;
        const ip = Number(r.regular_season_ip ?? r.IP) || 0;
        const gs = Number(r.GS) || 0;
        const g = Number(r.G) || 0;
        pitcherBySource.set(r.source_player_id, { gs, g, thin: ip < 5 && !r.combined_used });
      }
      for (const p of (playerRows || [])) {
        if (!p.source_player_id) continue;
        const h = hitterBySource.get(p.source_player_id);
        if (h) {
          hitterAb.set(p.id, h.ab);
          if (h.thin) thinSample.set(p.id, true);
        }
        const pit = pitcherBySource.get(p.source_player_id);
        if (pit) {
          pitcherGs.set(p.id, pit.gs);
          pitcherG.set(p.id, pit.g);
          if (pit.thin) thinSample.set(p.id, true);
        }
      }
      return { thinSample, hitterAb, hitterAbByNameTeam, pitcherGs, pitcherG };
    },
    staleTime: 30 * 60 * 1000,
  });

  // ── Team-scoped queries ──────────────────────────────────────────────────────

  const { data: builds = [] } = useQuery({
    queryKey: ["team-builds", effectiveTeamId ?? null],
    enabled: !!effectiveTeamId,
    queryFn: async () => {
      const { data } = await supabase
        .from("team_builds")
        .select("*")
        .eq("customer_team_id", effectiveTeamId!)
        .order("updated_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: returners = [], dataUpdatedAt: returnersUpdatedAt } = useQuery({
    queryKey: [
      "team-builder-returners-v3",
      selectedTeamId, selectedTeam,
      hitterStats.length, pitchingMasterRows.length,
    ],
    enabled: !!selectedTeam,
    staleTime: 5 * 60 * 1000,
    retry: 1,
    queryFn: async () => {
      const active2025Ids = new Set<string>();
      for (const r of hitterStats) { if ((r as any).player_id) active2025Ids.add((r as any).player_id); }
      for (const r of pitchingMasterRows) { if ((r as any).source_player_id) active2025Ids.add((r as any).source_player_id); }

      const selectCols =
        "id, first_name, last_name, position, is_twp, class_year, throws_hand, bats_hand, team, from_team, conference, transfer_portal, source_player_id, portal_status, player_predictions(id, from_avg, from_obp, from_slg, from_era, from_fip, from_whip, from_k9, from_bb9, from_hr9, p_avg, p_obp, p_slg, p_ops, p_iso, p_wrc, p_wrc_plus, p_era, p_fip, p_whip, p_k9, p_bb9, p_hr9, p_rv_plus, pitcher_role, power_rating_plus, class_transition, dev_aggressiveness, model_type, status, variant, updated_at)";

      let query = supabase.from("players").select(selectCols).eq("transfer_portal", false);
      if (selectedTeamId) {
        query = query.eq("team_id", selectedTeamId);
      } else {
        query = query.eq("team", selectedTeam);
      }
      const { data, error } = await query;
      if (error) throw error;

      if (selectedTeamId && selectedTeam) {
        const { data: byName } = await supabase
          .from("players")
          .select(selectCols)
          .eq("team", selectedTeam)
          .eq("transfer_portal", false);
        const merged = new Map<string, any>();
        for (const p of (data || [])) merged.set(p.id, p);
        for (const p of (byName || [])) merged.set(p.id, p);
        return processReturners([...merged.values()]);
      }
      return processReturners(data || []);

      function processReturners(players: any[]) {
        const results: any[] = [];
        for (const player of players) {
          if (player.source_player_id && !active2025Ids.has(player.source_player_id)) continue;
          const preds = (player.player_predictions || []).filter(
            (pr: any) => pr.variant === "regular" && (pr.status === "active" || pr.status === "departed"),
          );
          let best = preds.length > 0 ? preds[0] : null;
          for (const row of preds) {
            if (!best) { best = row; continue; }
            const rowScore = scorePredictionLikeDashboard(row, false);
            const bestScore = scorePredictionLikeDashboard(best, false);
            if (rowScore > bestScore) best = row;
            else if (rowScore === bestScore) {
              if (new Date(row.updated_at || 0).getTime() > new Date(best.updated_at || 0).getTime()) best = row;
            }
          }
          results.push({
            ...(best || {}),
            player_id: player.id,
            players: {
              id: player.id,
              first_name: player.first_name,
              last_name: player.last_name,
              position: player.position,
              is_twp: (player as any).is_twp ?? false,
              class_year: (player as any).class_year ?? null,
              throws_hand: (player as any).throws_hand ?? null,
              bats_hand: (player as any).bats_hand ?? null,
              team: player.team,
              from_team: player.from_team,
              conference: player.conference,
              transfer_portal: player.transfer_portal,
            },
          });
        }
        return results;
      }
    },
  });

  return {
    // Seed + config hooks
    hitterStats,
    powerRatingsData,
    exitPositions,
    pitchingMasterRows,
    pitchingPowerEq,
    newConfStats,
    playerOverrideMap,
    playerOverrides,
    updatePlayerOverrideFn,
    getSupabaseRole,
    setSupabaseRole,
    teams,
    teamsByName,
    teamParkComponents,
    supabaseTargetBoard,
    targetBoardLoading,
    removeFromSupabaseBoard,
    addToSupabaseBoard,
    isOnSupabaseBoard,
    // Derived
    selectedTeamRow,
    selectedTeamId,
    // Query data
    remoteEquationValues,
    allPlayersForSearch,
    hitterMasterPaMap,
    seasonUsage,
    builds,
    returners,
    returnersUpdatedAt,
  };
}

// Re-export so callers can use the scorer for build-restore prediction ranking
// without duplicating logic. TeamBuilder needs it at line ~2108.
export { scorePredictionLikeDashboard };
