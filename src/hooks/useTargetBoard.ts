import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { toast } from "sonner";
import { logGmActivity } from "@/gm/lib/logGmActivity";
import { PROJECTION_SEASON } from "@/lib/seasonConstants";

// Cast to bypass generated types until supabase types are regenerated
const tb = () => supabase.from("target_board" as any);

export type PortalStatus = "NOT IN PORTAL" | "WATCHING" | "IN PORTAL" | "COMMITTED";

export interface TargetBoardRow {
  id: string;
  player_id: string;
  source_player_id: string | null;
  notes: string | null;
  added_at: string;
  // joined from players
  first_name: string;
  last_name: string;
  team: string | null;
  conference: string | null;
  position: string | null;
  class_year: string | null;
  portal_status: PortalStatus;
  bats_hand: string | null;
  division: string | null;
  // Phase B for targets — the saved DISPLAYED line + toggle state, so a persisted
  // toggle survives refresh instead of being rebuilt to neutral.
  transfer_snapshot: Record<string, any> | null;
  production_notes: string | null;
  // TWP two-row: distinguishes the hitter row from the pitcher row. NULL for a
  // one-way player (single row). Mirrors the roster's per-side rows.
  position_slot: string | null;
  is_twp: boolean;
}

/**
 * Team-wide recruiting watchlist. Scoped on customer_team_id only so every
 * coach on the same team sees the same shared board — Coach A's add shows
 * up for Coach B and vice versa. user_id stays on insert as audit ("who
 * added it") but does NOT filter reads or deletes.
 *
 * Migration 2026-06-17: changed scoping from (user, customer_team_id) to
 * customer_team_id only. Requires DB-side unique-constraint swap from
 * (user_id, customer_team_id, player_id) → (customer_team_id, player_id)
 * plus a one-time dedupe of duplicate (team, player) rows that the old
 * constraint had allowed. SQL lives in commit message of this change.
 *
 * No team in scope (superadmin not impersonating) → returns an empty
 * board. Surfaces should prompt the user to pick a team rather than
 * mixing legacy unscoped rows back in.
 */
export function useTargetBoard() {
  const { user, effectiveTeamId, isSuperadmin, availableTeams } = useAuth();
  const qc = useQueryClient();

  // The team every read/write is pinned to. For a coach this is their own
  // team; for a superadmin it is whichever team they are impersonating. Used
  // only for a human-readable confirmation — the actual scoping is the
  // customer_team_id filter below plus the RLS is_team_member() wall.
  const scopedTeamName = useMemo(
    () => availableTeams?.find((t) => t.id === effectiveTeamId)?.name ?? null,
    [availableTeams, effectiveTeamId],
  );

  const { data: board = [], isLoading } = useQuery({
    queryKey: ["target-board", effectiveTeamId ?? null],
    enabled: !!user?.id && !!effectiveTeamId,
    queryFn: async () => {
      // Hard read gate: never query unscoped. Every read is pinned to exactly
      // one customer_team_id. A superadmin who is not impersonating a team has
      // no board in scope, so return empty rather than the whole table — this
      // is what guarantees a superadmin sees one team at a time, never a blend.
      if (!effectiveTeamId) return [];
      const { data, error } = await tb()
        .select("id, player_id, position_slot, notes, added_at, transfer_snapshot, production_notes, players!inner(first_name, last_name, team, conference, position, class_year, portal_status, bats_hand, division, source_player_id, is_twp)")
        // Team-scoped only — every coach on the team sees the same board.
        .eq("customer_team_id", effectiveTeamId!)
        .order("added_at", { ascending: false });

      if (error) throw error;

      return (data || []).map((row: any) => ({
        id: row.id,
        player_id: row.player_id,
        source_player_id: row.players.source_player_id ?? null,
        notes: row.notes,
        added_at: row.added_at,
        first_name: row.players.first_name,
        last_name: row.players.last_name,
        team: row.players.team,
        conference: row.players.conference,
        position: row.players.position,
        class_year: row.players.class_year,
        portal_status: row.players.portal_status || "NOT IN PORTAL",
        bats_hand: row.players.bats_hand ?? null,
        division: row.players.division ?? null,
        transfer_snapshot: row.transfer_snapshot ?? null,
        production_notes: row.production_notes ?? null,
        position_slot: row.position_slot ?? null,
        is_twp: !!row.players.is_twp,
      })) as TargetBoardRow[];
    },
    // Refetch when the user re-focuses TB / Targets / any surface using the
    // hook. Profile add in another tab/route → target_board mutation runs in
    // that context → this query may be cached as fresh on the other surface.
    // refetchOnWindowFocus guarantees the latest server state on focus.
    refetchOnWindowFocus: true,
    // Treat data as immediately stale so any refetch trigger (focus,
    // remount, invalidation) actually re-runs the network call instead of
    // serving cached.
    staleTime: 0,
  });

  const playerIds = new Set(board.map((r) => r.player_id));

  const addPlayer = useMutation({
    mutationFn: async ({ playerId, silent: _silent }: { playerId: string; silent?: boolean }) => {
      if (!user?.id) throw new Error("Not logged in");
      // Superadmin write gate: an add ALWAYS lands on exactly one team — the one
      // currently in scope. A superadmin who is not impersonating has no team,
      // so block the write outright instead of storing an orphan/mis-scoped row.
      // This is why the same add can never fan out to more than one board.
      if (!effectiveTeamId) {
        throw new Error(
          isSuperadmin
            ? "No team in scope — impersonate a team first so the target lands on that team only"
            : "No team in scope — join a team first",
        );
      }
      // Create the neutral transfer_snapshot AS PART OF the add — a copy of the
      // player's program-scoped neutral projection — so every board row is
      // display-ready with zero async rebuild (the batch load reads it directly).
      // Toggles later overwrite it via saveTargetToggle; removal deletes the row.
      const [{ data: preds }, { data: pl }] = await Promise.all([
        supabase.from("player_predictions")
          .select("customer_team_id, variant, model_type, p_avg, p_obp, p_slg, p_wrc_plus, p_era, p_fip, p_whip, p_k9, p_bb9, p_hr9, p_rv_plus, p_war, o_war, d_war, bsr_war, total_hitter_war, market_value, twp_hitter_market_value, twp_pitcher_market_value, hitter_depth_role, pitcher_depth_role, class_transition, pitcher_role, projected_ip")
          .eq("player_id", playerId).eq("season", PROJECTION_SEASON).in("status", ["active", "departed"]),
        supabase.from("players").select("is_twp, position").eq("id", playerId).maybeSingle(),
      ]);
      const isTwp = !!(pl as any)?.is_twp;
      const plPosition = (pl as any)?.position ?? null;
      const rows = (preds || []) as any[];
      const pred =
        rows.find((r) => r.customer_team_id === effectiveTeamId && r.variant === "precomputed")
        ?? rows.find((r) => r.model_type === "returner" && r.variant === "regular" && r.customer_team_id == null)
        ?? rows.find((r) => r.customer_team_id === effectiveTeamId) ?? rows[0] ?? null;
      const transfer_snapshot = pred ? {
        p_avg: pred.p_avg, p_obp: pred.p_obp, p_slg: pred.p_slg, p_wrc_plus: pred.p_wrc_plus,
        p_era: pred.p_era, p_fip: pred.p_fip, p_whip: pred.p_whip, p_k9: pred.p_k9, p_bb9: pred.p_bb9, p_hr9: pred.p_hr9,
        p_rv_plus: pred.p_rv_plus, p_war: pred.p_war, owar: pred.o_war, o_war: pred.o_war,
        // ★ 2026-09-01 — TOTAL hitter WAR is the position-player HEADLINE (o+d+bsr). Writing only
        //   o_war made a newly added hitter show his oWAR alone (Ryder Helfrick 2.32 instead of
        //   4.94). d_war/bsr_war ride along so a consumer can show the split without a refetch.
        d_war: pred.d_war, bsr_war: pred.bsr_war, total_hitter_war: pred.total_hitter_war,
        nil_valuation: isTwp ? null : pred.market_value,
        twp_hitter_market_value: pred.twp_hitter_market_value, twp_pitcher_market_value: pred.twp_pitcher_market_value,
        hitter_depth_role: pred.hitter_depth_role, pitcher_depth_role: pred.pitcher_depth_role,
        is_twp: isTwp,
      } : null;
      // Persisted NEUTRAL base (dev_agg=0), own-side, so the toggle recompute never
      // depends on a live fetch. Mirrors scripts/backfill-neutral-snapshot.
      const hitterNeutral = pred ? { dev_aggressiveness: 0, class_transition: pred.class_transition ?? null, p_avg: pred.p_avg, p_obp: pred.p_obp, p_slg: pred.p_slg, p_wrc_plus: pred.p_wrc_plus, o_war: pred.o_war, d_war: pred.d_war, bsr_war: pred.bsr_war, total_hitter_war: pred.total_hitter_war, hitter_depth_role: pred.hitter_depth_role, twp_hitter_market_value: pred.twp_hitter_market_value, market_value: pred.market_value } : null;
      const pitcherNeutral = pred ? { dev_aggressiveness: 0, class_transition: pred.class_transition ?? null, p_era: pred.p_era, p_fip: pred.p_fip, p_whip: pred.p_whip, p_k9: pred.p_k9, p_bb9: pred.p_bb9, p_hr9: pred.p_hr9, p_rv_plus: pred.p_rv_plus, p_war: pred.p_war, pitcher_role: pred.pitcher_role ?? null, pitcher_depth_role: pred.pitcher_depth_role, twp_pitcher_market_value: pred.twp_pitcher_market_value, projected_ip: pred.projected_ip ?? null } : null;
      const oneWayNeutral = /^(SP|RP|CL|P|LHP|RHP)$/i.test(String(plPosition || "").trim()) ? pitcherNeutral : hitterNeutral;
      // TWP → TWO rows (hitter slot + pitcher slot), each own-side only, mirroring
      // the roster. One-way → a single row (position_slot NULL). Own-side split
      // keeps a side's snapshot from carrying the other side's stats.
      let insertRows: any[];
      if (isTwp && transfer_snapshot) {
        const t = transfer_snapshot as any;
        const isPitPos = /^(SP|RP|CL|P|LHP|RHP)$/i.test(String(plPosition || "").trim());
        const hitterSlot = isPitPos ? "UTL" : (plPosition || "UTL");
        const pitcherSlot = /starter/i.test(String(pred?.pitcher_depth_role || "")) ? "SP" : "RP";
        const hitterSnap = { is_twp: true, nil_valuation: null, p_avg: t.p_avg, p_obp: t.p_obp, p_slg: t.p_slg, p_wrc_plus: t.p_wrc_plus, owar: t.owar, o_war: t.o_war, d_war: t.d_war, bsr_war: t.bsr_war, total_hitter_war: t.total_hitter_war, hitter_depth_role: t.hitter_depth_role, twp_hitter_market_value: t.twp_hitter_market_value };
        const pitcherSnap = { is_twp: true, nil_valuation: null, p_era: t.p_era, p_fip: t.p_fip, p_whip: t.p_whip, p_k9: t.p_k9, p_bb9: t.p_bb9, p_hr9: t.p_hr9, p_rv_plus: t.p_rv_plus, p_war: t.p_war, pitcher_depth_role: t.pitcher_depth_role, twp_pitcher_market_value: t.twp_pitcher_market_value };
        insertRows = [
          { user_id: user.id, player_id: playerId, customer_team_id: effectiveTeamId, position_slot: hitterSlot, transfer_snapshot: hitterSnap, neutral_snapshot: hitterNeutral },
          { user_id: user.id, player_id: playerId, customer_team_id: effectiveTeamId, position_slot: pitcherSlot, transfer_snapshot: pitcherSnap, neutral_snapshot: pitcherNeutral },
        ];
      } else {
        insertRows = [{ user_id: user.id, player_id: playerId, customer_team_id: effectiveTeamId, position_slot: null, transfer_snapshot, neutral_snapshot: oneWayNeutral }];
      }
      const { error } = await tb().insert(insertRows);
      if (error) throw error;
      // Log to the front-office feed (skip silent syncs so remounts don't spam).
      if (!_silent) {
        try {
          const { data: p } = await supabase.from("players").select("first_name, last_name").eq("id", playerId).maybeSingle();
          const name = p ? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() : "a player";
          await logGmActivity(effectiveTeamId, user.email ?? null, user.id, `added ${name || "a player"} to the target board`, "/gm/targets");
        } catch { /* activity is best-effort */ }
      }
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["target-board", effectiveTeamId ?? null] });
      qc.invalidateQueries({ queryKey: ["gm-activity"] });
      // silent=true suppresses the toast. Used by the TB roster→supabase sync
      // effect, which can fire on every remount; the user-facing add path
      // (PlayerProfile / Dashboard "Add to board" buttons) leaves silent
      // undefined so they keep their visible confirmation. Name the team so a
      // superadmin always sees WHICH board received the target.
      if (!variables?.silent) {
        toast.success(scopedTeamName ? `Added to ${scopedTeamName} Target Board` : "Added to Target Board");
      }
    },
    onError: (e: any, variables) => {
      if (e?.message?.includes("duplicate") || e?.code === "23505") {
        if (!variables?.silent) toast.info("Already on Target Board");
      } else {
        toast.error(`Failed to add: ${e.message}`);
      }
    },
  });

  const removePlayer = useMutation({
    mutationFn: async (playerId: string) => {
      if (!user?.id) throw new Error("Not logged in");
      if (!effectiveTeamId) throw new Error("No team in scope");
      const { error } = await tb()
        .delete()
        // Team-scoped delete — any coach on the team can remove any entry.
        .eq("customer_team_id", effectiveTeamId)
        .eq("player_id", playerId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["target-board", effectiveTeamId ?? null] });
      toast.success("Removed from Target Board");
    },
    onError: (e: any) => toast.error(`Failed to remove: ${e.message}`),
  });

  return {
    board,
    isLoading,
    playerIds,
    isOnBoard: (playerId: string) => playerIds.has(playerId),
    addPlayer: addPlayer.mutate,
    removePlayer: removePlayer.mutate,
  };
}
