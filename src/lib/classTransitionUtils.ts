/**
 * Class transition derivation.
 *
 * `players.class_year` is the canonical input (TruMedia / roster import sets
 * this per player). The projection engine reads `class_transition` on each
 * prediction row to apply year-over-year development adjustments
 * (FS=freshman→sophomore, SJ=sophomore→junior, JS=junior→senior, GR=grad).
 *
 * Historically a number of write-time call sites hardcoded "SJ" as the
 * default class_transition for new prediction / target rows. With accurate
 * class data from TruMedia, that default is wrong for every freshman, junior,
 * senior, and grad. This helper centralizes the derivation so every
 * write-time site can do the right thing without re-implementing the
 * normalization rules.
 *
 * Coaches can still manually override class_transition on the player profile
 * page when they need to model a non-standard development trajectory (e.g. a
 * redshirt, a JUCO transfer with unusual eligibility). The override sets
 * `class_transition_overridden = true` and locks the row from auto-infer.
 */

export type ClassTransition = "FS" | "SJ" | "JS" | "GR";

/**
 * Derive a class_transition code from a player's current class_year.
 * Accepts the messy values seen in real data — roster CSVs, TruMedia,
 * legacy hand entry — and normalizes to one of FS / SJ / JS / GR.
 *
 * Returns null when the input doesn't map to a known class. Callers
 * typically default to "SJ" only as a last resort.
 */
export function classTransitionFromYear(
  classYear: string | null | undefined,
): ClassTransition | null {
  if (!classYear) return null;
  let x = String(classYear).trim().toUpperCase();
  // Strip redshirt prefixes (R-, RS-, R ).
  x = x.replace(/^(RS?-?\s*)+/, "").trim();
  if (x === "FR" || x === "FRESHMAN" || x === "FRESH") return "FS";
  if (x === "SO" || x === "SOPHOMORE" || x === "SOPH") return "SJ";
  if (x === "JR" || x === "JUNIOR") return "JS";
  if (x === "SR" || x === "SENIOR") return "GR";
  if (x === "GR" || x === "GRADUATE" || x === "GRAD" || x === "GS") return "GR";
  return null;
}

/**
 * Convenience wrapper for callers that need a guaranteed value. Falls back
 * to "SJ" only when class_year is unknown — preserves prior behavior for
 * untracked players while making it explicit when the default is in use.
 */
export function classTransitionFromYearOrDefault(
  classYear: string | null | undefined,
  fallback: ClassTransition = "SJ",
): ClassTransition {
  return classTransitionFromYear(classYear) ?? fallback;
}

/**
 * Resolve the class_transition to STORE on a prediction at (re)compute time,
 * class_year-authoritative:
 *   explicit coach override (class_transition_overridden) → class_year-derived
 *   → the existing stored value → null.
 * Use this instead of passing through `pred.class_transition` so the pervasive
 * stale "SJ" default self-corrects on the next precompute. Returns null when
 * nothing resolves (the caller/engine may apply its own last-resort default).
 * See docs/knowledge/eligibility-and-class.md.
 */
export function resolveClassTransition(
  classYear: string | null | undefined,
  pred?: { class_transition?: string | null; class_transition_overridden?: boolean | null } | null,
): string | null {
  if (pred?.class_transition_overridden && pred.class_transition) return pred.class_transition;
  return classTransitionFromYear(classYear) ?? pred?.class_transition ?? null;
}
