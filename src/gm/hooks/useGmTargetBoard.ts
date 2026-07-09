import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTargetBoard } from "@/hooks/useTargetBoard";
import { applyTeamScopeFilter, dedupePreferredPerPlayer } from "@/lib/teamScopedPredictions";
import { isPitcherPos } from "@/gm/lib/loadGmBuildRoster";
import { logGmActivity } from "@/gm/lib/logGmActivity";

/** One authored, dated note on a target. */
export interface GmTargetNote {
  id: string;
  player_id: string;
  author: string | null;
  note_date: string;
  body: string | null;
}

/** A target board player with their team-scoped projection resolved. */
export interface GmTarget {
  player_id: string;
  name: string;
  position: string | null;
  team: string | null;
  is_pitcher: boolean;
  war: number | null;
  market_value: number | null;
  offer: number | null;            // what we're willing to pay (GM-only)
  notes: GmTargetNote[];
  /** Precomputed prediction row — snapshotted onto the build row on Add to Roster. */
  snapshot: Record<string, any> | null;
}

/**
 * The team's shared target board, enriched with each target's PRECOMPUTED,
 * team-scoped projection (player_predictions, preferring the customer-team
 * precomputed row → global). That's the target's value as a transfer to this
 * team — read straight from the store, so no transfer engine has to re-run.
 *
 * Also layers the GM-only overlays: the "what we're offering" number
 * (gm_target_offer) and the authored note log (gm_target_notes).
 */
export function useGmTargetBoard() {
  const { user, effectiveTeamId } = useAuth();
  const qc = useQueryClient();
  const { board, isLoading: boardLoading } = useTargetBoard();
  const playerIds = useMemo(() => board.map((r) => r.player_id), [board]);

  const { data: predByPlayer = new Map<string, any>(), isLoading: predLoading } = useQuery({
    queryKey: ["gm-target-preds", effectiveTeamId ?? null, playerIds],
    enabled: !!user?.id && !!effectiveTeamId && playerIds.length > 0,
    queryFn: async () => {
      const map = new Map<string, any>();
      for (let i = 0; i < playerIds.length; i += 200) {
        let q = (supabase as any)
          .from("player_predictions")
          .select("player_id, variant, customer_team_id, o_war, p_war, market_value, twp_hitter_market_value, twp_pitcher_market_value, pitcher_role, hitter_depth_role")
          .in("player_id", playerIds.slice(i, i + 200));
        q = applyTeamScopeFilter(q, effectiveTeamId);
        const { data } = await q;
        for (const p of dedupePreferredPerPlayer(data || [], effectiveTeamId)) map.set(p.player_id, p);
      }
      return map;
    },
  });

  const offerKey = ["gm-target-offers", effectiveTeamId ?? null];
  const { data: offerByPlayer = new Map<string, number>() } = useQuery({
    queryKey: offerKey,
    enabled: !!user?.id && !!effectiveTeamId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("gm_target_offer").select("player_id, offer_amount").eq("customer_team_id", effectiveTeamId);
      const m = new Map<string, number>();
      for (const r of data || []) if (r.offer_amount != null) m.set(r.player_id, Number(r.offer_amount));
      return m;
    },
  });

  const notesKey = ["gm-target-notes", effectiveTeamId ?? null];
  const { data: notesByPlayer = new Map<string, GmTargetNote[]>() } = useQuery({
    queryKey: notesKey,
    enabled: !!user?.id && !!effectiveTeamId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("gm_target_notes").select("id, player_id, author, note_date, body")
        .eq("customer_team_id", effectiveTeamId).order("created_at", { ascending: false });
      const m = new Map<string, GmTargetNote[]>();
      for (const r of data || []) {
        const arr = m.get(r.player_id) ?? [];
        arr.push(r as GmTargetNote);
        m.set(r.player_id, arr);
      }
      return m;
    },
  });

  const targets: GmTarget[] = useMemo(
    () =>
      board.map((r) => {
        const pred = predByPlayer.get(r.player_id);
        const pitcher = isPitcherPos(r.position);
        const war = pitcher ? (pred?.p_war ?? null) : (pred?.o_war ?? null);
        const market = pred?.market_value ?? pred?.twp_hitter_market_value ?? pred?.twp_pitcher_market_value ?? null;
        return {
          player_id: r.player_id,
          name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "—",
          position: r.position,
          team: r.team,
          is_pitcher: pitcher,
          war,
          market_value: market,
          offer: offerByPlayer.get(r.player_id) ?? null,
          notes: notesByPlayer.get(r.player_id) ?? [],
          snapshot: pred ?? null,
        };
      }),
    [board, predByPlayer, offerByPlayer, notesByPlayer],
  );

  const saveOffer = useMutation({
    mutationFn: async ({ playerId, amount }: { playerId: string; amount: number | null }) => {
      if (!effectiveTeamId) throw new Error("No team in scope");
      const { error } = await (supabase as any).from("gm_target_offer").upsert(
        { customer_team_id: effectiveTeamId, player_id: playerId, offer_amount: amount, updated_by_user_id: user?.id ?? null, updated_at: new Date().toISOString() },
        { onConflict: "customer_team_id,player_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: offerKey }),
    onError: (e: any) => toast.error(`Save offer failed: ${e.message}`),
  });

  const addNote = useMutation({
    mutationFn: async ({ playerId, body }: { playerId: string; body: string }) => {
      if (!effectiveTeamId) throw new Error("No team in scope");
      const { error } = await (supabase as any).from("gm_target_notes").insert({
        customer_team_id: effectiveTeamId, player_id: playerId, author: user?.email ?? null,
        body: body.trim(), created_by_user_id: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: notesKey }); toast.success("Note added"); },
    onError: (e: any) => toast.error(`Add note failed: ${e.message}`),
  });

  const removeNote = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("gm_target_notes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: notesKey }),
    onError: (e: any) => toast.error(`Delete note failed: ${e.message}`),
  });

  return {
    targets,
    isLoading: boardLoading || predLoading,
    saveOffer: (playerId: string, amount: number | null) => saveOffer.mutate({ playerId, amount }),
    addNote: (playerId: string, body: string) => addNote.mutate({ playerId, body }),
    removeNote: (id: string) => removeNote.mutate(id),
  };
}
