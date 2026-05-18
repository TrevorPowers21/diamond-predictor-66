/**
 * Filename parsing for JUCO TruMedia exports.
 *
 * Three file types live in the juco-exploration folder:
 *
 *   Hitter Master per region:
 *     "2026 NJCAA Region 14 Hitting Master 051526.csv"
 *     "2026 NJCAA D1 Region 1 Hitting Master 051526.csv"   ← Region 1 variant
 *     "2026 NJCAA Region 10 Hitter Master 051526.csv"      ← "Hitter" typo
 *
 *   Pitching Master per region:
 *     "2026 NJCAA D1 Region 14 Pitching Master 051526.csv"
 *     "2026 NJCAA Region 24 Pitching Master 051526.csv"
 *
 *   Per-pitch Stuff+ (league-wide, pitch_type × hand):
 *     "2026 NJCAA RHP 4S FB Stuff+ 051526.csv"
 *     "2026 NJCAA LHP Slider Stuff+ 051526.csv"
 *     "2026 NJCAA RHP Change-Up Stuff+ 051526.csv"
 *
 * Quirks tolerated: trailing whitespace before .csv, "05152026" vs "051526"
 * date format, "Hitter" vs "Hitting", "D1" prefix optional.
 */

export type JucoFileKind =
  | { kind: "hitter_master"; region: number; season: number }
  | { kind: "pitching_master"; region: number; season: number }
  | { kind: "stuff_plus_inputs"; pitchType: string; hand: "R" | "L"; season: number }
  | { kind: "unknown"; reason: string };

/** Normalize a filename (strip extension, trim, collapse whitespace) for matching. */
function normalize(filename: string): string {
  return filename
    .replace(/\.csv$/i, "")
    .trim()
    .replace(/\s+/g, " ");
}

/** Extract season from the leading 4-digit year (e.g., "2026 NJCAA ..."). */
function parseSeason(filename: string): number {
  const m = filename.match(/(?:^|\s)(20\d{2})\b/);
  return m ? Number(m[1]) : 2026;
}

/**
 * Pitch types we expect from TruMedia. The reclassifier will further sort
 * breaking balls (Cutter / Gyro Slider / Slider / Sweeper / Curveball) from
 * the source tags, so the filename only needs to match TruMedia's labels.
 */
const PITCH_TYPE_ALIASES: Record<string, string> = {
  "4S FB": "4S FB",
  "4SFB": "4S FB",
  "Fastball": "4S FB",
  "Sinker": "Sinker",
  "2S FB": "Sinker",
  "Slider": "Slider",
  "Sweeper": "Sweeper",
  "Cutter": "Cutter",
  "Curveball": "Curveball",
  "CB": "Curveball",
  "Change-Up": "Change-up",
  "Change-up": "Change-up",
  "Changeup": "Change-up",
  "CH": "Change-up",
  "Splitter": "Splitter",
  "Split-Finger": "Splitter",
};

/** Parse a JUCO CSV filename into its kind + dimensions. */
export function classifyJucoFile(filename: string): JucoFileKind {
  const normalized = normalize(filename);
  const season = parseSeason(normalized);

  // Per-pitch Stuff+ files: "... <Hand>HP <PitchType> Stuff+ ..."
  // Hand is RHP or LHP, somewhere before "Stuff+".
  const stuffPlusMatch = normalized.match(/\b(RHP|LHP)\s+(.+?)\s+Stuff\+/i);
  if (stuffPlusMatch) {
    const hand = stuffPlusMatch[1].toUpperCase() === "RHP" ? "R" : "L";
    const rawPitch = stuffPlusMatch[2].trim();
    const pitchType = PITCH_TYPE_ALIASES[rawPitch] ?? rawPitch;
    return { kind: "stuff_plus_inputs", pitchType, hand, season };
  }

  // Region-based files: "... Region <N> ..."
  const regionMatch = normalized.match(/\bRegion\s+(\d+)\b/i);
  if (regionMatch) {
    const region = Number(regionMatch[1]);

    // "Pitching Master" or "Pitcher Master"
    if (/\bPitch(?:ing|er)\s+Master\b/i.test(normalized)) {
      return { kind: "pitching_master", region, season };
    }

    // "Hitting Master" or "Hitter Master"
    if (/\bHit(?:ting|ter)\s+Master\b/i.test(normalized)) {
      return { kind: "hitter_master", region, season };
    }

    return { kind: "unknown", reason: `Region ${region} file but no Master type detected` };
  }

  return { kind: "unknown", reason: "no Region/Stuff+ pattern matched" };
}
