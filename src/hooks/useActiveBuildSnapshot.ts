import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { resolveActiveBuildId } from "@/lib/activeBuild";

/**
 * THE SAVED LINE FOR ONE PLAYER, ON THE ACTIVE BUILD — the single source every surface should read.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * 🛑 WHY THIS EXISTS (Trevor, 2026-09-01): *"for player profiles on roster or target board it just
 *    needs to read the saved player/transfer snapshot across all the sites. No live compute."*
 *
 * The snapshot machinery was already built — `team_build_players.neutral_snapshot` (the immutable
 * dev-agg 0 base) and `player_snapshot` (the coach's toggles baked in at save time). What was missing
 * is that NOTHING ENFORCED IT: four surfaces each re-implemented the lookup and each drifted.
 *
 *   Team Builder          reads the snapshot          ✅ was already right
 *   PlayerProfile         read player_predictions     ❌ fixed 2026-09-01
 *   PitcherProfile        read player_predictions     ❌ fixed 2026-09-01
 *   PlayerHub (GM home)   re-derives with a scalar    ❌ this hook
 *
 * ★ THE GM HUB BUG THIS CLOSES. `PlayerHub.tsx` applied `low(v) = v * (1 - delta)` — an ADDITIVE
 *   approximation of the dev scale — while PitcherProfile used the proper multiplicative ratio via
 *   `projectEffectivePitcher`. Same intent, different arithmetic, so a toggled pitcher read
 *   **4.84 on the GM home page and 4.86 everywhere else** (Luke Howe, 2026-09-01). The fix is not a
 *   better approximation — it is to stop computing and read what was saved.
 *
 * ⛔ DO NOT apply `devAggScale`, `depthScale`, or any role-transition overlay on top of what this
 *    returns. The snapshot ALREADY has the coach's dev-agg and role baked in; scaling it again
 *    compounds the adjustment. That double-apply is the exact defect the neutral snapshot exists to
 *    prevent.
 *
 * ⚠ RETURNS NULL when the player is not on the active build. That is the correct signal to fall back
 *   to the stored NEUTRAL projection (`player_predictions`, which is dev-neutral — measured
 *   dev_aggressiveness = 0.000 across all 7,062 projected rows on prod). A non-rostered player MAY be
 *   scaled live for a preview: Trevor, 2026-09-01 — *"they still need a local live compute that then
 *   resets on refresh and doesn't save anywhere."*
 *
 * ⬜ NOT YET COVERED — `target_board`. A player on the board but NOT rostered has his line in
 *    `target_board.transfer_snapshot` (+ its own `neutral_snapshot`); prod carries 57 such rows for
 *    Arkansas alone. This hook currently reads only `team_build_players`. Wire the board in here, in
 *    ONE place, rather than adding it per-surface.
 */
export type BuildSnapshotSide = "hitter" | "pitcher";

const isPitcherSlot = (s: string | null | undefined) => /^(SP|RP|CL|P|LHP|RHP)/i.test(String(s || ""));

/**
 * TARGET BOARD fallback — a player can be on the board WITHOUT being on the roster, and his saved
 * line then lives in `target_board.transfer_snapshot` (staging: 169 rows, all populated, 8 teams;
 * prod: 57 for Arkansas alone). Before 2026-09-01 no surface read this at all, so a board-only
 * player silently fell through to the neutral projection.
 *
 * ⚠ THE BOARD SHAPE IS NOT THE BUILD SHAPE. Verified against staging:
 *     `nil_valuation`  is the board's market value   (build uses `market_value`)
 *     `owar`           is carried ALONGSIDE `o_war`  (legacy key; either may be the populated one)
 *   TargetBoardSubtab already normalizes exactly this pair. We do the same here so every caller sees
 *   ONE shape and no surface has to know which table the line came from.
 *
 * ⛔ TWPs: a two-way player's board row can carry BOTH `p_era` and `p_wrc_plus`, so field-presence
 *    alone cannot pick a side — `position_slot` decides, and the field guard is only a backstop.
 */
async function boardSnapshot(
  playerId: string,
  customerTeamId: string,
  side: BuildSnapshotSide,
): Promise<Record<string, any> | null> {
  const { data: tb } = await (supabase as any)
    .from("target_board")
    .select("player_id, position_slot, transfer_snapshot")
    .eq("customer_team_id", customerTeamId)
    .eq("player_id", playerId);

  const rows = (tb || []).filter((r: any) => r.transfer_snapshot);
  if (rows.length === 0) return null;

  const wantPitcher = side === "pitcher";
  const match =
    rows.length === 1 && isPitcherSlot(rows[0].position_slot) === wantPitcher
      ? rows[0]
      : rows.find((r: any) => isPitcherSlot(r.position_slot) === wantPitcher);
  if (!match) return null;

  const raw = match.transfer_snapshot as Record<string, any>;
  if (wantPitcher && raw.p_era == null) return null;
  if (!wantPitcher && raw.p_wrc_plus == null && raw.p_avg == null) return null;

  // Normalize to the build-snapshot shape so callers never branch on the source table.
  return {
    ...raw,
    o_war: raw.o_war ?? raw.owar ?? null,
    market_value: raw.market_value ?? raw.nil_valuation ?? null,
  };
}

export function useActiveBuildSnapshot(
  playerId: string | null | undefined,
  side: BuildSnapshotSide,
) {
  const { effectiveTeamId } = useAuth();

  const { data = null, isLoading } = useQuery({
    queryKey: ["active-build-snapshot", playerId ?? null, side, effectiveTeamId ?? null],
    enabled: !!playerId && !!effectiveTeamId,
    queryFn: async (): Promise<Record<string, any> | null> => {
      const { data: blds } = await (supabase as any)
        .from("team_builds")
        .select("id, is_active, is_default, team, academic_year, updated_at, created_at")
        .eq("customer_team_id", effectiveTeamId);
      const activeId = resolveActiveBuildId(blds);
      if (!activeId) return null;

      const { data: bps } = await (supabase as any)
        .from("team_build_players")
        .select("player_id, position_slot, included_in_roster, player_snapshot")
        .eq("build_id", activeId)
        .eq("included_in_roster", true)
        .eq("player_id", playerId);

      const rows = (bps || []).filter((r: any) => r.player_snapshot);
      if (rows.length === 0) return boardSnapshot(playerId!, effectiveTeamId!, side);

      // A TWP has TWO rows — a hitter slot and a pitcher slot. Take the one this caller asked for;
      // never merge them, or a two-way player's hitter card shows his pitching line.
      const wantPitcher = side === "pitcher";
      const match =
        rows.length === 1 && isPitcherSlot(rows[0].position_slot) === wantPitcher
          ? rows[0]
          : rows.find((r: any) => isPitcherSlot(r.position_slot) === wantPitcher);
      // Rostered, but not on the side we were asked for (e.g. a hitter-only roster row and this is
      // the pitcher card) — the board may still hold that side's line.
      if (!match) return boardSnapshot(playerId!, effectiveTeamId!, side);

      // Field guard: a hitter-slot snapshot has no pitching fields and vice versa. Returning the
      // wrong shape would spread `undefined` over a caller's line instead of failing cleanly.
      const snap = match.player_snapshot as Record<string, any>;
      if (wantPitcher && snap.p_era == null) return null;
      if (!wantPitcher && snap.p_wrc_plus == null && snap.p_avg == null) return null;
      return snap;
    },
  });

  return { snapshot: data, isSnapshotBacked: !!data, isLoading };
}
