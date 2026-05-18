import { supabase } from "@/integrations/supabase/client";

export type LockResult = {
  season: number;
  hittersLocked: number;
  pitchersLocked: number;
  hittersAlreadyLocked: number;
  pitchersAlreadyLocked: number;
  error: string | null;
};

/**
 * Lock the regular-season PA/IP totals for a given season by snapshotting
 * `pa` → `regular_season_pa` on Hitter Master and `IP` → `regular_season_ip`
 * on Pitching Master. Once locked, postseason ABs/innings continue to update
 * `pa` / `IP` but tier classification reads the locked values, so playoff-
 * team players don't get inflated tier assignments.
 *
 * Idempotent. The underlying SQL function only writes rows where the snapshot
 * column is still NULL, so re-running this is safe — it just won't change
 * anything for rows that were already locked.
 *
 * Returns counts of rows actually written this run, plus how many rows were
 * already locked (so the caller can tell the difference between "first lock"
 * and "no-op because already done").
 */
export async function lockRegularSeason(season: number): Promise<LockResult> {
  const result: LockResult = {
    season,
    hittersLocked: 0,
    pitchersLocked: 0,
    hittersAlreadyLocked: 0,
    pitchersAlreadyLocked: 0,
    error: null,
  };

  // Pre-flight: count rows that are about to flip from NULL → set so we can
  // report "X just locked, Y were already locked" instead of just a single
  // count. Useful for distinguishing a re-run from the actual lock event.
  const [hPre, pPre, hAlready, pAlready] = await Promise.all([
    supabase
      .from("Hitter Master")
      .select("id", { count: "exact", head: true })
      .eq("Season", season)
      .is("regular_season_pa", null),
    supabase
      .from("Pitching Master")
      .select("id", { count: "exact", head: true })
      .eq("Season", season)
      .is("regular_season_ip", null),
    supabase
      .from("Hitter Master")
      .select("id", { count: "exact", head: true })
      .eq("Season", season)
      .not("regular_season_pa", "is", null),
    supabase
      .from("Pitching Master")
      .select("id", { count: "exact", head: true })
      .eq("Season", season)
      .not("regular_season_ip", "is", null),
  ]);

  if (hPre.error) { result.error = `Hitter Master pre-count: ${hPre.error.message}`; return result; }
  if (pPre.error) { result.error = `Pitching Master pre-count: ${pPre.error.message}`; return result; }

  result.hittersAlreadyLocked = hAlready.count ?? 0;
  result.pitchersAlreadyLocked = pAlready.count ?? 0;

  const { data, error } = await (supabase as any).rpc("lock_regular_season", { p_season: season });
  if (error) {
    result.error = error.message;
    return result;
  }

  const row = Array.isArray(data) ? data[0] : data;
  result.hittersLocked = Number(row?.hitters_locked ?? 0);
  result.pitchersLocked = Number(row?.pitchers_locked ?? 0);
  return result;
}
