import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePitchLog2026PitcherRates } from "@/hooks/usePitchLog2026PitcherRates";
import { usePitchLog2026PitcherPop } from "@/hooks/usePitchLog2026PitcherPop";
import { percentileRank } from "@/savant/lib/percentile";
import { pickPreferredPrediction } from "@/lib/teamScopedPredictions";
import { CURRENT_SEASON, PROJECTION_SEASON } from "@/lib/seasonConstants";

// Slim previews for the player-hub Overview cards: the projected line
// (player_predictions, team-scoped preference) and the current-season line
// (season_stats). Both keyed by players.id.
export interface HubProjection {
  p_avg: number | null; p_obp: number | null; p_slg: number | null; p_ops: number | null; p_wrc_plus: number | null;
  p_era: number | null; p_fip: number | null; p_whip: number | null; p_k9: number | null; p_bb9: number | null;
  dev_aggressiveness: number | null; // dev-agg the row was computed with (scale from this to the build's)
  class_transition: string | null;   // drives the dev-agg class adjustment (hitters)
  pitcher_role: string | null;       // stored role, for the role-transition overlay
}
// Advanced pitcher grades from "Pitching Master" (parallels the hitter card):
// Stuff+ / Whiff% / BB% / Barrel%, each with its 0–100 percentile score.
export interface HubPitcherAdvanced {
  stuff_plus: number | null; stuff_score: number | null;
  whiff: number | null; whiff_score: number | null;
  bb_pct: number | null; bb_score: number | null;
  barrel_pct: number | null; barrel_score: number | null;
}
// Advanced hitter line (Hitter Master + inferred bat speed) — batted-ball &
// plate discipline. Keyed by players.source_player_id (numeric TrackMan id), NOT
// the UUID. Blended values used when the master row is a combined sample.
export interface HubHitterAdvanced {
  barrel: number | null; avg_exit_velo: number | null; contact: number | null; chase: number | null;
  barrel_score: number | null; avg_ev_score: number | null; contact_score: number | null; chase_score: number | null;
}

export function usePlayerHubPreview(
  playerId: string | null | undefined,
  sourcePlayerId: string | null | undefined,
): { projection: HubProjection | null; hitterAdvanced: HubHitterAdvanced | null; pitcherAdvanced: HubPitcherAdvanced | null } {
  const { effectiveTeamId } = useAuth();

  const { data: projection = null } = useQuery({
    queryKey: ["hub-projection", playerId, effectiveTeamId ?? null],
    enabled: !!playerId,
    queryFn: async (): Promise<HubProjection | null> => {
      const { data } = await (supabase as any).from("player_predictions")
        .select("p_avg, p_obp, p_slg, p_ops, p_wrc_plus, p_era, p_fip, p_whip, p_k9, p_bb9, dev_aggressiveness, class_transition, variant, customer_team_id, pitcher_role")
        .eq("player_id", playerId).eq("season", PROJECTION_SEASON).eq("status", "active");
      return (pickPreferredPrediction((data ?? []) as any[], effectiveTeamId ?? null) ?? null) as HubProjection | null;
    },
  });

  // Stuff+ / Whiff% / BB% / Barrel% — EXACTLY as the pitcher profile does it:
  // the pitch-log rates + an empirical percentile rank vs the pitcher population
  // (same hooks + percentileRank), so both the values AND the tile colors match.
  const plRates = usePitchLog2026PitcherRates(sourcePlayerId ?? null).data;
  const plPop = usePitchLog2026PitcherPop().data ?? [];
  // STORED-FIRST (2026-08-23): read the stored Pitching Master scores so the chips don't recompute
  // percentiles on every load (was live-only, no stored fallback). Live rank is only the fallback.
  const { data: pitcherStored = null } = useQuery({
    queryKey: ["hub-pitcher-stored", sourcePlayerId ?? null],
    enabled: !!sourcePlayerId,
    queryFn: async () => {
      const { data } = await (supabase as any).from("Pitching Master")
        .select("stuff_score, whiff_score, bb_score, barrel_score, stuff_plus, blended_stuff_plus")
        .eq("source_player_id", sourcePlayerId).eq("Season", CURRENT_SEASON).limit(1);
      return data?.[0] ?? null;
    },
  });
  const pitcherAdvanced: HubPitcherAdvanced | null = useMemo(() => {
    if (!plRates?.hasData && !pitcherStored) return null;
    const rank = (v: number | null, key: "stuffPlus" | "whiff" | "bb" | "barrel", invert?: boolean) =>
      plPop.length > 0 ? percentileRank(v, plPop.map((p) => (p as any)[key] as number | null), invert ? { invert: true } : undefined) : null;
    return {
      stuff_plus: plRates?.stuffPlus ?? pitcherStored?.stuff_plus ?? null, stuff_score: pitcherStored?.stuff_score ?? rank(plRates?.stuffPlus ?? null, "stuffPlus"),
      whiff: plRates?.whiff ?? null, whiff_score: pitcherStored?.whiff_score ?? rank(plRates?.whiff ?? null, "whiff"),
      bb_pct: plRates?.bb ?? null, bb_score: pitcherStored?.bb_score ?? rank(plRates?.bb ?? null, "bb", true),
      barrel_pct: plRates?.barrel ?? null, barrel_score: pitcherStored?.barrel_score ?? rank(plRates?.barrel ?? null, "barrel", true),
    };
  }, [plRates, plPop, pitcherStored]);

  // Barrel% / Exit Velo / Contact% / Chase% from Hitter Master (blended-aware).
  const { data: hitterAdvanced = null } = useQuery({
    queryKey: ["hub-hitter-adv", sourcePlayerId ?? null],
    enabled: !!sourcePlayerId,
    queryFn: async (): Promise<HubHitterAdvanced | null> => {
      const { data } = await (supabase as any).from("Hitter Master")
        .select("barrel, avg_exit_velo, contact, chase, barrel_score, avg_ev_score, contact_score, chase_score, blended_barrel, blended_avg_exit_velo, blended_contact, blended_chase, combined_used")
        .eq("source_player_id", sourcePlayerId).eq("Season", CURRENT_SEASON).limit(1);
      const r = data?.[0];
      if (!r) return null;
      const cu = !!r.combined_used;
      return {
        barrel: cu ? (r.blended_barrel ?? r.barrel) : r.barrel,
        avg_exit_velo: cu ? (r.blended_avg_exit_velo ?? r.avg_exit_velo) : r.avg_exit_velo,
        contact: cu ? (r.blended_contact ?? r.contact) : r.contact,
        chase: cu ? (r.blended_chase ?? r.chase) : r.chase,
        barrel_score: r.barrel_score ?? null,
        avg_ev_score: r.avg_ev_score ?? null,
        contact_score: r.contact_score ?? null,
        chase_score: r.chase_score ?? null,
      };
    },
  });

  return { projection, hitterAdvanced, pitcherAdvanced };
}
