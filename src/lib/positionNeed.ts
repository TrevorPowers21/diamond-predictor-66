// ─────────────────────────────────────────────────────────────────────────────
// Positional NEED — the team-specific scarcity layer (spec §3 + §4).
//
// Positional value is PURELY team-need-driven (decided 2026-08-16): there is NO
// always-on national positional multiplier. A position commands a premium ONLY
// when it's an actual hole on the roster — the scarcity a coach actually feels.
//
//   1. Championship-starter bar: the WAR a top-quartile-ish (p70) full-time
//      regular produced at each position. The BAR is calibrated from 2026
//      DESCRIPTIVE full-season WAR ONLY because that's the one complete season of
//      real data to build a threshold from. Players are then checked against it
//      with their PROJECTED WAR (we project forward): a rostered player whose
//      projection clears the bar → "solid"; nobody clears → hole.
//   2. Need ladder: when a spot is a hole, a target who fills it is marked up on
//      the board. C/SS/weekend-SP 1.3; all OF (incl CF) + 2B/3B 1.1; 1B/DH/non-
//      starter-P 1.0. CF=1.1 is coach-feedback-backed. No bench tier.
//
// The premium touches TARGET-BOARD prices only, never rostered allocations.
// ─────────────────────────────────────────────────────────────────────────────

/** p70 of full-time regulars (reg_season_pa≥200 hitters / reg_season_ip≥65 wSP),
 * 2026 descriptive full-season WAR. Stamped 2026-08-16 from staging. */
export const CHAMPIONSHIP_STARTER_BAR = {
  C: 2.11,
  "1B": 1.77,
  "2B": 1.48,
  "3B": 1.57,
  SS: 1.42,
  LF: 1.70,
  CF: 1.74,
  RF: 1.88,
  weekend_SP: 3.06,
} as const;

/** Bars for the generic pitch-log labels (OF / IF), used until the position-
 * display fix emits specific spots. Group averages of the members above. */
const GENERIC_BAR = {
  OF: (1.70 + 1.74 + 1.88) / 3, // 1.77
  IF: (1.42 + 1.48 + 1.57) / 3, // 1.49
} as const;

export const NEED_LADDER = { premium: 1.3, moderate: 1.1, neutral: 1.0 } as const;

export type PositionCanon =
  | "C" | "1B" | "2B" | "3B" | "SS" | "LF" | "CF" | "RF" | "OF" | "IF" | "DH" | "P";

/** Normalize any raw position label to a canonical key. Generic pitch-log labels
 * ("OF"/"IF") stay generic on purpose — the position-display fix resolves them. */
export function canonPosition(raw: string | null | undefined): PositionCanon | null {
  const p = (raw || "").trim().toUpperCase().replace(/\s+/g, " ");
  if (["C", "CATCHER"].includes(p)) return "C";
  if (["1B", "FIRST BASE", "FIRSTBASE"].includes(p)) return "1B";
  if (["2B", "SECOND BASE", "SECONDBASE"].includes(p)) return "2B";
  if (["3B", "THIRD BASE", "THIRDBASE"].includes(p)) return "3B";
  if (["SS", "SHORTSTOP"].includes(p)) return "SS";
  if (["LF", "LEFT FIELD", "LEFTFIELD"].includes(p)) return "LF";
  if (["CF", "CENTER FIELD", "CENTERFIELD"].includes(p)) return "CF";
  if (["RF", "RIGHT FIELD", "RIGHTFIELD"].includes(p)) return "RF";
  if (["OF", "OUTFIELD", "CORNER OUTFIELD", "COF"].includes(p)) return "OF";
  if (["IF", "INF", "INFIELD"].includes(p)) return "IF";
  if (["DH", "DESIGNATED HITTER", "DESIGNATEDHITTER"].includes(p)) return "DH";
  if (["P", "PITCHER", "SP", "RP"].includes(p)) return "P";
  return null;
}

/**
 * Need-ladder multiplier for a position. Premium (1.3): C, SS, weekend SP.
 * Moderate (1.1): all OF incl CF + generic OF, 2B, 3B, generic IF. Neutral (1.0):
 * 1B, DH, non-weekend-starter pitchers, unknown. Generic IF → 1.1 (never
 * auto-credit an unlabeled infielder the SS 1.3).
 */
export function needMultiplierForPosition(
  raw: string | null | undefined,
  opts?: { isWeekendStarter?: boolean },
): number {
  const c = canonPosition(raw);
  if (c === "P") return opts?.isWeekendStarter ? NEED_LADDER.premium : NEED_LADDER.neutral;
  if (c === "C" || c === "SS") return NEED_LADDER.premium;
  if (c === "1B" || c === "DH" || c == null) return NEED_LADDER.neutral;
  // LF, CF, RF, OF, 2B, 3B, IF
  return NEED_LADDER.moderate;
}

/**
 * The championship-starter WAR bar for a position. Pitchers only have a bar when
 * they're a weekend starter (relievers aren't a need position). Returns null when
 * there is no meaningful bar (non-weekend-starter pitcher).
 */
export function championshipBarForPosition(
  raw: string | null | undefined,
  opts?: { isWeekendStarter?: boolean },
): number | null {
  const c = canonPosition(raw);
  if (c === "P") return opts?.isWeekendStarter ? CHAMPIONSHIP_STARTER_BAR.weekend_SP : null;
  if (c === "OF") return GENERIC_BAR.OF;
  if (c === "IF") return GENERIC_BAR.IF;
  if (c === "DH") return CHAMPIONSHIP_STARTER_BAR["1B"]; // bat-first spot; bar only used for detection, DH prices neutral
  if (c && c in CHAMPIONSHIP_STARTER_BAR) return CHAMPIONSHIP_STARTER_BAR[c as keyof typeof CHAMPIONSHIP_STARTER_BAR];
  return null;
}

export type NeedState = "solid" | "hole";

/**
 * A position is SOLID when at least one slotted player's PROJECTED WAR clears the
 * championship bar; otherwise it's a HOLE (empty or thin — both price the same per
 * spec §3). Players are checked with projected WAR (we project forward); the bar
 * itself is descriptive-calibrated only because it's the one full season of data.
 * `slottedWars` is every player slotted at the spot (freshmen / no-history carry
 * 0 → they don't clear).
 */
export function rosterPositionState(
  bar: number | null,
  slottedWars: Array<number | null | undefined>,
): NeedState {
  if (bar == null) return "solid"; // no bar → not a need position (e.g. reliever)
  const clears = slottedWars.some((w) => w != null && Number.isFinite(Number(w)) && Number(w) >= bar);
  return clears ? "solid" : "hole";
}
