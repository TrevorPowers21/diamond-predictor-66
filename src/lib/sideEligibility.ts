/**
 * SIDE ELIGIBILITY — the SINGLE source of truth for "which equations does this player get, and is he a TWP?"
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────────
 * ★ SCOPE: **NCAA D1 ONLY** (Trevor, 2026-08-31: "just make it ncaa only"). JUCO keeps its own separate floors
 *   (`JUCO_PA_THRESHOLD = 75`, `JUCO_IP_THRESHOLD = 20`) and is being restructured — see
 *   [[project_juco_restructure_planned]]. ⛔ Do NOT apply this helper to `division = 'NJCAA_D1'`.
 *
 * ★★ THE ORDER MATTERS — AND IT IS NOT "START AT THE MINIMUM" (Trevor, 2026-08-31):
 *      "it needs to FIRST recognize players who have BOTH, then identify the buckets of each,
 *       and drop the TWP tag from players under the minimum. Not start there."
 *
 *      STEP 1  PRESENCE   — does he have PA at all? IP at all?  (this is what identifies a candidate two-way)
 *      STEP 2  BUCKET     — does each side clear its minimum?   (PA >= 30 / IP >= 5)
 *      STEP 3  TWP TAG    — flagged TWP only if BOTH sides clear. Under the minimum on either side ⇒ DROP the tag.
 *      STEP 4  EQUATIONS  — run only the sides that cleared. A side that did not clear must ALSO have its stored
 *                           values invalidated, not merely skipped (see ⚠ INVALIDATION below).
 *
 *   Starting at the minimum throws away STEP 1: you can no longer tell a genuine two-way who fell short on one side
 *   from a player who never had that side at all — and it is exactly that distinction that decides the TWP tag.
 *   Measured on prod 2026-08-31 (D1, regular-season window): **309 players have BOTH PA and IP**, of whom only
 *   **88 clear both minimums**. The other 221 break down as:
 *       106  pitcher who batted a little   (avg PA 7,   avg IP 28.3)  -> pitcher only, DROP tag
 *        82  hitter who threw a little     (avg PA 144, avg IP 2.1)   -> hitter only,  DROP tag
 *        31  token on both sides           (avg PA 10,  avg IP 1.8)   -> neither,      DROP tag
 *
 * ⛔ `players.position` MUST NOT participate. 203 D1 players with real IP carry a non-pitcher position
 *    (OF/3B/UTL/IF/LF/C and the legacy 'TWP' overload). Position-based filtering silently excluded them, leaving a
 *    STALE `p_war` and NO market value with nothing logged. See SILENT-FAILURE REGISTRY #25.
 * ⛔ `players.is_twp` MUST NOT be the INPUT. It is the OUTPUT of step 3. Using it as an input lets the flag and the
 *    equations disagree — that is REGISTRY #24.
 *
 * ⚠ WINDOW: REGULAR SEASON with a full-season fallback, matching the depth-role anchor
 *   (`useTeamBuilderData.ts:239,254`). Trevor 2026-08-31: *"for the sake of consistency just use regular season."*
 *   Measured: only 32 of 10,406 D1 players change side under a full-season window, all boundary cases gaining a
 *   fraction (Brett Denby would become "two-way" on 2.7 postseason relief innings).
 *
 * ⚠⚠ INVALIDATION IS THE MISSING HALF — NOT YET BUILT.
 *   Skipping a side is NOT the same as clearing it. A player who drops below a minimum keeps whatever `p_war` /
 *   `o_war` / market an earlier run wrote, forever, because nothing revisits him. Measured: applying the IP floor
 *   to the returner pitcher path alone would stop updating **643** players who currently hold a `p_war`.
 *   ⇒ Whoever wires this in MUST also null the non-qualifying side's stored values. See REGISTRY #25.
 */

/** NCAA D1 minimum regular-season PA to run the HITTER equations. Mirrors run-twp-recompute.ts (Trevor 2026-08-25). */
export const SIDE_MIN_PA = 30;
/** NCAA D1 minimum regular-season IP to run the PITCHER equations. Mirrors run-twp-recompute.ts (Trevor 2026-08-25). */
export const SIDE_MIN_IP = 5;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** True only for the NCAA D1 lane this helper governs. JUCO/D2/D3 are out of scope by design. */
export const isNcaaD1 = (division: string | null | undefined): boolean => division === "D1";

/**
 * Regular-season volume with a full-season fallback — the SAME convention as the depth-role anchor.
 * ⛔ Pass the MASTER row, never the `players` row: `players.pa`/`players.ip` are identity-table copies that nothing
 *    keeps in sync (SILENT-FAILURE REGISTRY #9).
 */
export const hitterVolume = (m: { regular_season_pa?: unknown; pa?: unknown } | null | undefined): number =>
  num(m?.regular_season_pa ?? m?.pa);
export const pitcherVolume = (m: { regular_season_ip?: unknown; IP?: unknown } | null | undefined): number =>
  num(m?.regular_season_ip ?? (m as any)?.IP);

export type SideClassification = {
  // STEP 1 — PRESENCE (any volume at all). This is what identifies a two-way CANDIDATE.
  hasHitterStats: boolean;
  hasPitcherStats: boolean;
  /** has BOTH kinds of stats, at ANY volume — the two-way candidate set (309 on D1) */
  hasBothStats: boolean;
  // STEP 2 — BUCKET (clears the minimum)
  /** run the hitter equations */
  hitter: boolean;
  /** run the pitcher equations */
  pitcher: boolean;
  // STEP 3 — TAG
  /** `players.is_twp` SHOULD be this. Both sides clear the minimum. */
  isTwp: boolean;
  /** had both kinds of stats but fell short on a side ⇒ the TWP tag must be DROPPED */
  dropTwpTag: boolean;
  pa: number;
  ip: number;
};

/**
 * The four steps, in order. Give it the player's two Master rows (either may be null).
 *
 *   const cls = classifySides(hitterMasterRow, pitcherMasterRow);
 *   if (!cls.pitcher) { nullPitcherSide(row); continue; }     // skip AND invalidate
 *   const field = cls.isTwp ? "twp_pitcher_market_value" : "market_value";
 */
export function classifySides(
  hitterMasterRow: { regular_season_pa?: unknown; pa?: unknown } | null | undefined,
  pitcherMasterRow: { regular_season_ip?: unknown; IP?: unknown } | null | undefined,
): SideClassification {
  const pa = hitterVolume(hitterMasterRow);
  const ip = pitcherVolume(pitcherMasterRow);

  // STEP 1 — presence
  const hasHitterStats = pa > 0;
  const hasPitcherStats = ip > 0;
  const hasBothStats = hasHitterStats && hasPitcherStats;

  // STEP 2 — bucket against the minimums
  const hitter = pa >= SIDE_MIN_PA;
  const pitcher = ip >= SIDE_MIN_IP;

  // STEP 3 — the tag is an OUTPUT: both sides must clear
  const isTwp = hitter && pitcher;
  const dropTwpTag = hasBothStats && !isTwp;

  return { hasHitterStats, hasPitcherStats, hasBothStats, hitter, pitcher, isTwp, dropTwpTag, pa, ip };
}

/**
 * Which column do this player's dollars belong in?
 * ⛔ Never branch on a snapshot's embedded `is_twp` (REGISTRY #21) nor on `players.is_twp` (it is derived).
 */
export const hitterMarketField = (c: SideClassification): "twp_hitter_market_value" | "market_value" =>
  c.isTwp ? "twp_hitter_market_value" : "market_value";
export const pitcherMarketField = (c: SideClassification): "twp_pitcher_market_value" | "market_value" =>
  c.isTwp ? "twp_pitcher_market_value" : "market_value";
