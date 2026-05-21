// Helpers for reading player_predictions with team-scoped preference.
//
// Eager Transfer Pre-compute writes team-scoped rows
// (customer_team_id = <team>, variant = "precomputed") alongside the
// canonical global rows (customer_team_id IS NULL, variant = "regular").
// Read paths should prefer the team-scoped row for the active customer team.

type PredRow = {
  player_id?: string;
  customer_team_id?: string | null;
  variant?: string | null;
  [k: string]: any;
};

/**
 * Apply a Supabase query filter that returns global rows (NULL customer_team)
 * plus team-scoped rows for the active team. Call BEFORE chaining `.range`
 * / `.order`.
 */
export function applyTeamScopeFilter<T extends { or: any; is: any }>(
  query: T,
  effectiveTeamId: string | null,
): T {
  return effectiveTeamId
    ? query.or(`customer_team_id.is.null,customer_team_id.eq.${effectiveTeamId}`)
    : query.is("customer_team_id", null);
}

/**
 * From the rows for ONE player, pick the preferred prediction:
 *   team-scoped precomputed (if active team has one) → global regular → null
 */
export function pickPreferredPrediction<T extends PredRow>(
  rows: T[],
  effectiveTeamId: string | null,
): T | null {
  if (effectiveTeamId) {
    const teamRow = rows.find(
      (r) => r.customer_team_id === effectiveTeamId && r.variant === "precomputed",
    );
    if (teamRow) return teamRow;
  }
  return rows.find((r) => r.customer_team_id == null && r.variant === "regular") ?? null;
}

/**
 * Reduce a mixed bag of rows into one row per player_id using preference rules
 * above. Rows missing player_id are skipped.
 */
export function dedupePreferredPerPlayer<T extends PredRow>(
  rows: T[],
  effectiveTeamId: string | null,
): T[] {
  const byPlayer = new Map<string, T[]>();
  for (const r of rows) {
    const k = r.player_id;
    if (!k) continue;
    const arr = byPlayer.get(k);
    if (arr) arr.push(r);
    else byPlayer.set(k, [r]);
  }
  const out: T[] = [];
  for (const arr of byPlayer.values()) {
    const pick = pickPreferredPrediction(arr, effectiveTeamId);
    if (pick) out.push(pick);
  }
  return out;
}
