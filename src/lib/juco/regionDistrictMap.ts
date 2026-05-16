/**
 * NJCAA D1 region → district → UUID mapping.
 *
 * 19 regions field NJCAA D1 baseball. NJCAA officially groups them into
 * 10 districts for postseason play. Districts are the natural baseline
 * grouping (small regions like R15/R20 share district context with larger
 * neighbors). District UUIDs are deterministic and reused across imports
 * (idempotent upsert key for Teams Table.conference_id).
 *
 * The district UUIDs are hand-generated and locked here. NEVER regenerate
 * them — every Teams Table row + downstream join keys depend on these
 * specific values. If we ever need to rotate, do it once and run an
 * UPDATE migration on Teams Table to migrate FK references.
 *
 * Source: NJCAA D1 District Championship bracket (2026 season).
 */

export type JucoDistrict =
  | "Appalachian"
  | "East"
  | "Mid-South"
  | "Midwest"
  | "Plains"
  | "South"
  | "South Atlantic"
  | "South Central"
  | "Southwest"
  | "West";

export type JucoRegion =
  | 1 | 2 | 4 | 5 | 6 | 7 | 8 | 9 | 10
  | 11 | 14 | 15 | 16 | 17 | 18 | 20 | 22 | 23 | 24;

/** Deterministic UUIDs per district (do not change). */
export const DISTRICT_UUIDS: Record<JucoDistrict, string> = {
  Appalachian:     "a1c70000-0000-4000-8000-000000000001",
  East:            "a1c70000-0000-4000-8000-000000000002",
  "Mid-South":     "a1c70000-0000-4000-8000-000000000003",
  Midwest:         "a1c70000-0000-4000-8000-000000000004",
  Plains:          "a1c70000-0000-4000-8000-000000000005",
  South:           "a1c70000-0000-4000-8000-000000000006",
  "South Atlantic":"a1c70000-0000-4000-8000-000000000007",
  "South Central": "a1c70000-0000-4000-8000-000000000008",
  Southwest:       "a1c70000-0000-4000-8000-000000000009",
  West:            "a1c70000-0000-4000-8000-000000000010",
};

/** Region → district lookup. */
export const REGION_TO_DISTRICT: Record<JucoRegion, JucoDistrict> = {
  1: "West",
  2: "South Central",
  4: "Midwest",
  5: "Southwest",
  6: "Plains",
  7: "Appalachian",
  8: "South Atlantic",
  9: "West",
  10: "East",
  11: "Midwest",
  14: "Mid-South",
  15: "East",
  16: "South Central",
  17: "Appalachian",
  18: "West",
  20: "East",
  22: "South",
  23: "South",
  24: "Midwest",
};

/** All JUCO regions that field NJCAA D1 baseball. */
export const ALL_JUCO_REGIONS: JucoRegion[] = [
  1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 20, 22, 23, 24,
];

/** Look up district for a region; throws if region is unknown. */
export function districtForRegion(region: number): JucoDistrict {
  const d = REGION_TO_DISTRICT[region as JucoRegion];
  if (!d) throw new Error(`Unknown JUCO region: ${region}`);
  return d;
}

/** Look up district UUID for a region; throws if region is unknown. */
export function districtUuidForRegion(region: number): string {
  return DISTRICT_UUIDS[districtForRegion(region)];
}

/**
 * Build the canonical conference text label for a JUCO team.
 * Example: region 14 → "NJCAA D1 Mid-South"
 */
export function conferenceLabelForRegion(region: number): string {
  return `NJCAA D1 ${districtForRegion(region)}`;
}

/**
 * Build the region display text.
 * Example: region 14 → "NJCAA D1 Region 14"
 */
export function regionLabel(region: number): string {
  return `NJCAA D1 Region ${region}`;
}

/** Division tag used on every JUCO row. */
export const JUCO_DIVISION = "NJCAA_D1";
