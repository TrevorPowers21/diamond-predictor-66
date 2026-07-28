// Single source of truth for resolving a program's ACTIVE (live) build.
//
// Decided 2026-07-24 (see memory project_active_build_resolver). The active build
// must resolve automatically — no manual pick — and survive a coach poking at
// another team's build. Every read path should use THIS, not a bare
// `.eq("is_active", true)`, which returns nothing when the flag was never set
// (true for most legacy programs) and silently breaks the target board.
//
// Rule:
//   1) explicit is_active (same-team) if set →
//   2) else among same-team, non-default, current-academic-year builds:
//        largest roster (most activity, only when counts are provided) →
//        most-recently-updated → newest-created →
//   3) else the default build (GM-visibility fallback only).

export type ResolvableBuild = {
  id: string;
  is_active?: boolean | null;
  is_default?: boolean | null;
  team?: string | null;
  academic_year?: number | string | null;
  updated_at?: string | null;
  created_at?: string | null;
  roster_count?: number | null; // optional; enables the largest-roster tiebreak (one-time backfill)
};

// Upcoming baseball season the app is currently building for.
export const CURRENT_ACADEMIC_YEAR = 2027;

const yearEq = (a: unknown, b: unknown) => String(a ?? "") === String(b ?? "");

export function resolveActiveBuildId(
  builds: ResolvableBuild[] | null | undefined,
  opts?: { programTeam?: string | null; academicYear?: number | string | null },
): string | null {
  const list = (builds ?? []).filter(Boolean);
  if (!list.length) return null;

  // 1) explicit flag wins
  const explicit = list.find((b) => b.is_active);
  if (explicit) return explicit.id;

  const year = opts?.academicYear ?? CURRENT_ACADEMIC_YEAR;
  let nonDefault = list.filter((b) => !b.is_default);

  // same-team scope: drop cross-team experiments (e.g. an LSU build under Georgia).
  // Only apply when it doesn't empty the pool, so a mislabeled team can't hide the
  // real roster.
  if (opts?.programTeam) {
    const sameTeam = nonDefault.filter((b) => (b.team ?? "") === opts.programTeam);
    if (sameTeam.length) nonDefault = sameTeam;
  }

  // season guard: prefer current-year builds; fall back to all if none tagged.
  const yearMatch = nonDefault.filter((b) => yearEq(b.academic_year, year));
  const pool = yearMatch.length ? yearMatch : nonDefault;

  if (pool.length) {
    const t = (s: string | null | undefined) => (s ? Date.parse(s) || 0 : 0);
    const sorted = [...pool].sort((a, b) => {
      const rc = (b.roster_count ?? -1) - (a.roster_count ?? -1); // largest roster first
      if (rc) return rc;
      const up = t(b.updated_at) - t(a.updated_at); // then most recently updated
      if (up) return up;
      return t(b.created_at) - t(a.created_at); // then newest created
    });
    return sorted[0].id;
  }

  // 3) last resort — the default build (GM visibility only)
  return list.find((b) => b.is_default)?.id ?? list[0]?.id ?? null;
}
