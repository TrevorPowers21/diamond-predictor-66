/**
 * Canonical helper for reading market_value on TWP-aware surfaces.
 *
 * Non-TWP players: read row.market_value directly (unchanged).
 * TWP players (is_twp=true on the players row): the row's `market_value` is
 *   NULL. Use twp_hitter_market_value on hitter-context surfaces (PlayerProfile,
 *   Dashboard hitter tab, TB hitter row, Compare hitter, etc.) and
 *   twp_pitcher_market_value on pitcher-context surfaces.
 *
 * Read sites that don't pass context (e.g., a column rendering both sides)
 * can sum both with `sumTwpMarketValues` — though usually it's better to pick.
 */

type RowWithMaybeTwpMv = {
  market_value?: number | null;
  twp_hitter_market_value?: number | null;
  twp_pitcher_market_value?: number | null;
};

export function pickHitterMarketValue(
  row: RowWithMaybeTwpMv | null | undefined,
  isTwp: boolean,
): number | null {
  if (!row) return null;
  if (isTwp) return row.twp_hitter_market_value ?? null;
  return row.market_value ?? null;
}

export function pickPitcherMarketValue(
  row: RowWithMaybeTwpMv | null | undefined,
  isTwp: boolean,
): number | null {
  if (!row) return null;
  if (isTwp) return row.twp_pitcher_market_value ?? null;
  return row.market_value ?? null;
}

export function sumTwpMarketValues(row: RowWithMaybeTwpMv | null | undefined): number | null {
  if (!row) return null;
  const h = row.twp_hitter_market_value ?? 0;
  const p = row.twp_pitcher_market_value ?? 0;
  if (h === 0 && p === 0) return row.market_value ?? null;
  return h + p;
}

/**
 * Canonical WAR readers for display surfaces (Step 7b).
 *
 * Position-player HEADLINE WAR = total_hitter_war (= o_war + d_war + bsr_war).
 * o_war stays the OFFENSIVE component inside breakdowns; it is not the headline.
 * Pitchers keep p_war (already a total).
 *
 * TWP note: unlike market value (split into twp_hitter/pitcher_market_value),
 * WAR is NOT split into twp_* columns — TWPs are stored as separate hitter and
 * pitcher rows/snapshots, each carrying its own total_hitter_war / p_war. So the
 * hitter side always reads total_hitter_war and the pitcher side always p_war;
 * there is no isTwp branch. Never combine the two sides into one number.
 *
 * Transition fallback: while snapshots are being re-baked to carry the composite,
 * a row may have total_hitter_war undefined but o_war/owar present. We fall back to
 * the offensive-only value so the tile shows a number rather than "—". After the
 * re-bake every hitter row/snapshot carries total_hitter_war and the fallback is dead.
 */
type RowWithMaybeWar = {
  o_war?: number | null;
  owar?: number | null; // transfer_snapshot alias for o_war
  p_war?: number | null;
  total_hitter_war?: number | null;
  d_war?: number | null;
  bsr_war?: number | null;
};

export function pickHitterWar(row: RowWithMaybeWar | null | undefined): number | null {
  if (!row) return null;
  return row.total_hitter_war ?? row.o_war ?? row.owar ?? null;
}

export function pickPitcherWar(row: RowWithMaybeWar | null | undefined): number | null {
  if (!row) return null;
  return row.p_war ?? null;
}
