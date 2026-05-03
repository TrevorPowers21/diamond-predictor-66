/**
 * Single source of truth for the application's "current season".
 *
 * Bumping this constant on the season transition (e.g. 2026 → 2027) is the
 * one-line change that flips:
 *   - useTeamsTable → reads new season's Teams Table rows
 *   - admin_ui equation overrides → read new season's model_config rows
 *   - Master table playing-time lookups → seed depth/role from prior season
 *   - Park factors / Conference stats fallbacks → keyed off this season
 *
 * Anywhere else in the codebase that needs "the current active season",
 * import from here instead of inlining a literal.
 */
export const CURRENT_SEASON = 2026;

/** Prior season relative to CURRENT_SEASON. Useful for blend / fallback queries. */
export const PRIOR_SEASON = CURRENT_SEASON - 1;
