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
