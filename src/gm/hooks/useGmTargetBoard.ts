import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTargetBoard } from "@/hooks/useTargetBoard";
import { applyTeamScopeFilter, dedupePreferredPerPlayer } from "@/lib/teamScopedPredictions";
import { isPitcherPos } from "@/gm/lib/loadGmBuildRoster";

/** A target board player with their team-scoped projection resolved. */
export interface GmTarget {
  player_id: string;
  name: string;
  position: string | null;
  team: string | null;
  is_pitcher: boolean;
  war: number | null;
  market_value: number | null;
}

/**
 * The team's shared target board, enriched with each target's PRECOMPUTED,
 * team-scoped projection (player_predictions, preferring the customer-team
 * precomputed row → global). That's the target's value as a transfer to this
 * team — read straight from the store, so no transfer engine has to re-run.
 */
export function useGmTargetBoard() {
  const { user, effectiveTeamId } = useAuth();
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
          .select("player_id, variant, customer_team_id, o_war, p_war, market_value, twp_hitter_market_value, twp_pitcher_market_value, pitcher_role")
          .in("player_id", playerIds.slice(i, i + 200));
        q = applyTeamScopeFilter(q, effectiveTeamId);
        const { data } = await q;
        for (const p of dedupePreferredPerPlayer(data || [], effectiveTeamId)) map.set(p.player_id, p);
      }
      return map;
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
        };
      }),
    [board, predByPlayer],
  );

  return { targets, isLoading: boardLoading || predLoading };
}
