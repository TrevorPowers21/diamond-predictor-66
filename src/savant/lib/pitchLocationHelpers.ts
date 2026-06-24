/**
 * Pitch location & spray-chart math.
 *
 * Coordinate systems carried from the TruMedia export. We use the
 * normalized strike-zone-relative variants (PXNorm / PZNorm) throughout
 * for cross-batter comparability and to avoid mixing units.
 *
 * Coordinate conventions:
 *   PXNorm: horizontal, plate-relative. −1 = left edge of plate, 0 = middle, +1 = right edge.
 *           Catcher's view by default; mirror for pitcher's view.
 *   PZNorm: vertical, zone-relative. −1 = bottom of zone, 0 = middle, +1 = top of zone.
 *           Note: this is the LEAGUE-standardized zone, not per-batter.
 *
 * Reference: docs/pitch_location_spray_reference.md
 */

// ── Strike zone reference (in normalized coords) ────────────────────────
//
// Standard zone is exactly the unit square: PXNorm ∈ [-1, 1], PZNorm ∈ [-1, 1].
export const ZONE_PXNORM_MIN = -1;
export const ZONE_PXNORM_MAX = 1;
export const ZONE_PZNORM_MIN = -1;
export const ZONE_PZNORM_MAX = 1;

// Visual canvas bounds — extends ~1.5x past the zone so chase/take pitches
// remain visible and the zone box has breathing room.
export const VIEW_PXNORM_MIN = -2.4;
export const VIEW_PXNORM_MAX = 2.4;
export const VIEW_PZNORM_MIN = -2.0;
export const VIEW_PZNORM_MAX = 2.0;

// ── 9-box zone grid ──────────────────────────────────────────────────────
//
// Statcast-style 3×3 grid INSIDE the strike zone, indexed 1..9 row-major
// from top-left when viewed from the catcher's perspective:
//
//   1 2 3   ← top (PZNorm 0.333 – 1.0)
//   4 5 6   ← middle (PZNorm -0.333 – 0.333)
//   7 8 9   ← bottom (PZNorm -1.0 – -0.333)
//
// Columns are inside→away in catcher's view (PXNorm -1 → -0.333 → 0.333 → 1).

export type Zone9Box = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

const ZONE_THIRDS = [-1, -1 / 3, 1 / 3, 1];

/**
 * Returns the 9-box zone (1..9) for a pitch, or null if outside the zone.
 */
export function zone9BoxForPitch(pxNorm: number | null, pzNorm: number | null): Zone9Box | null {
  if (pxNorm == null || pzNorm == null) return null;
  if (pxNorm < ZONE_PXNORM_MIN || pxNorm > ZONE_PXNORM_MAX) return null;
  if (pzNorm < ZONE_PZNORM_MIN || pzNorm > ZONE_PZNORM_MAX) return null;

  // Column 0..2 (left to right in catcher's view)
  let col = 0;
  if (pxNorm >= ZONE_THIRDS[2]) col = 2;
  else if (pxNorm >= ZONE_THIRDS[1]) col = 1;

  // Row 0..2 (top to bottom — PZNorm DECREASES going down)
  let row = 0; // top
  if (pzNorm < ZONE_THIRDS[1]) row = 2; // bottom
  else if (pzNorm < ZONE_THIRDS[2]) row = 1; // middle

  return (row * 3 + col + 1) as Zone9Box;
}

/**
 * Returns the corner coords (PXNorm/PZNorm) of a specific 9-box zone.
 * Useful when overlaying the grid as SVG <rect> elements.
 */
export function zone9BoxRect(zone: Zone9Box): {
  pxNormMin: number;
  pxNormMax: number;
  pzNormMin: number;
  pzNormMax: number;
} {
  const idx = zone - 1; // 0..8
  const col = idx % 3;
  const row = Math.floor(idx / 3); // 0=top, 1=middle, 2=bottom
  return {
    pxNormMin: ZONE_THIRDS[col],
    pxNormMax: ZONE_THIRDS[col + 1],
    pzNormMin: ZONE_THIRDS[2 - row],
    pzNormMax: ZONE_THIRDS[3 - row],
  };
}

// ── Heart / Shadow / Chase tri-zone classification ───────────────────────
//
// Standard Statcast convention. Cutoffs picked to approximate the way the
// Statcast K-Zone Plot reads. May want to tune later with Trevor.

export type Region = "heart" | "shadow" | "chase";

const HEART_HALF = 0.5;       // heart of zone: middle ~half by half
const SHADOW_PAD = 0.4;       // shadow extends 0.4 units beyond the zone

export function regionForPitch(pxNorm: number | null, pzNorm: number | null): Region | null {
  if (pxNorm == null || pzNorm == null) return null;
  const inHeart = Math.abs(pxNorm) <= HEART_HALF && Math.abs(pzNorm) <= HEART_HALF;
  if (inHeart) return "heart";

  const inZone =
    pxNorm >= ZONE_PXNORM_MIN && pxNorm <= ZONE_PXNORM_MAX && pzNorm >= ZONE_PZNORM_MIN && pzNorm <= ZONE_PZNORM_MAX;
  if (inZone) return "shadow";

  const inShadowOutside =
    pxNorm >= ZONE_PXNORM_MIN - SHADOW_PAD &&
    pxNorm <= ZONE_PXNORM_MAX + SHADOW_PAD &&
    pzNorm >= ZONE_PZNORM_MIN - SHADOW_PAD &&
    pzNorm <= ZONE_PZNORM_MAX + SHADOW_PAD;
  if (inShadowOutside) return "shadow";

  return "chase";
}

// ── Spray chart projection (polar → cartesian) ───────────────────────────
//
// Convention from the TruMedia export: SprayAng 0° = straight to CF,
// negative = left side (LF / 3B), positive = right side (RF / 1B).
// Foul lines at ±45°.

const DEG2RAD = Math.PI / 180;

export interface SprayPoint {
  // Field-space coordinates, in feet, with home plate at the origin.
  // x: lateral — negative = left side, positive = right side
  // y: depth — positive = toward outfield (so larger = further out)
  x: number;
  y: number;
}

/** Polar (SprayAng°, FBDst ft) → cartesian (x, y) with home at origin. */
export function spraySprayAngToField(
  sprayAngDeg: number | null,
  distanceFt: number | null,
): SprayPoint | null {
  if (sprayAngDeg == null || distanceFt == null) return null;
  const rad = sprayAngDeg * DEG2RAD;
  return {
    x: distanceFt * Math.sin(rad),
    y: distanceFt * Math.cos(rad),
  };
}

/** True for batted balls inside fair territory (±45° spray angle). */
export function isFairTerritory(sprayAngDeg: number | null): boolean {
  if (sprayAngDeg == null) return false;
  return sprayAngDeg >= -45 && sprayAngDeg <= 45;
}

// ── Pitch type color palette ─────────────────────────────────────────────
//
// Matches the standard MLB Statcast / FanGraphs convention so coaches read
// the chart without a legend.
export const PITCH_TYPE_COLOR: Record<string, string> = {
  "4-Seam Fastball": "#D22D49",
  "Sinker": "#FE9D00",
  "Cutter": "#933F2C",
  "Slider": "#EEE716",
  "Sweeper": "#DDB33A",
  "Gyro Slider": "#C4D000",
  "Curveball": "#00D1ED",
  "Change-up": "#1DBE3A",
  "Splitter": "#3BACAC",
};

// ── Batted-ball outcome color palette ────────────────────────────────────
export const OUTCOME_COLOR: Record<string, string> = {
  "Single": "#22C55E",
  "Double": "#3B82F6",
  "Triple": "#A855F7",
  "HR": "#FBBF24",
  "GroundOut": "#9CA3AF",
  "FlyOut": "#6B7280",
  "LineOut": "#6B7280",
  "PopOut": "#6B7280",
  "Error": "#F87171",
  "FieldersChoice": "#9CA3AF",
  "DoublePlay": "#4B5563",
  "Sac": "#D1D5DB",
};
