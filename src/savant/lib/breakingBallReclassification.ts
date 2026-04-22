import { supabase } from "@/integrations/supabase/client";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Raw row from pitcher_stuff_plus_inputs for a breaking ball */
export interface RawBreakingBallRow {
  id: string;
  source_player_id: string;
  season: number;
  pitch_type: string;        // original source tag — never overwritten
  hand: string;              // "R" or "L"
  team: string | null;
  team_id: string | null;
  conference: string | null;
  conference_id: string | null;
  pitches: number | null;
  velocity: number | null;
  ivb: number | null;
  hb: number | null;
  rel_height: number | null;
  rel_side: number | null;
  extension: number | null;
  spin: number | null;
  vaa: number | null;
  whiff_pct: number | null;
  stuff_plus: number | null;
  gyro_stuff_plus: number | null;
}

export interface ProcessedRow extends RawBreakingBallRow {
  rstr_pitch_class: string;
  needs_review: boolean;
  review_note: string | null;
  review_detail: Record<string, unknown> | null;
  p_consolidated: boolean;
  p_consolidated_count: number | null;
  source_tags: string[];
  dropped_sources: Array<{ pitch_type: string; pitches: number }> | null;
  boundary_case: boolean;
  outlier_flag: boolean;
  outlier_metrics: string[] | null;
  /** Player name fetched from Pitching Master for reporting */
  _playerName?: string;
  /** IDs of rows absorbed during consolidation (to be deleted) */
  _absorbedIds?: string[];
  /** Consolidation rule that was applied */
  _consolidation_rule?: string;
}

export interface DiscrepancyReport {
  crossBucketSamePitch: Array<{
    source_player_id: string;
    name: string;
    hand: string;
    buckets: string[];
    movements: Array<{ ivb: number | null; hb: number | null }>;
    distance: number;
  }>;
  crossBucketTwoPitch: Array<{
    source_player_id: string;
    name: string;
    hand: string;
    buckets: string[];
    movements: Array<{ ivb: number | null; hb: number | null }>;
    distance: number;
  }>;
  boundaryCases: ProcessedRow[];
  outlierCases: ProcessedRow[];
}

export interface PopulationAverages {
  pitch_type: string;
  hand: string;
  season: number;
  n_pitchers: number;
  pitches: number;
  velocity: number | null;
  velocity_sd: number | null;
  ivb: number | null;
  ivb_sd: number | null;
  hb: number | null;
  hb_sd: number | null;
  rel_height: number | null;
  rel_height_sd: number | null;
  rel_side: number | null;
  rel_side_sd: number | null;
  extension: number | null;
  extension_sd: number | null;
  spin: number | null;
  spin_sd: number | null;
  whiff_pct: number | null;
  whiff_pct_sd: number | null;
}

export interface ReclassificationReport {
  totalPulled: number;
  filter1Dropped: Array<{ source_player_id: string; name: string; pitch_type: string; reason: string }>;
  filter2Dropped: Array<{ source_player_id: string; name: string; pitch_type: string; reason: string }>;
  filterPDropped: Array<{ source_player_id: string; name: string; pitch_type: string; reason: string }>;
  survivingIntoReclassification: number;
  reclassificationCounts: Record<string, Record<string, number>>; // hand → class → count
  unclassifiedRows: Array<{ source_player_id: string; name: string; hand: string; ivb: number; hb: number; pitch_type: string }>;
  tagMovements: Array<{ from: string; to: string; hand: string; count: number }>;
  consolidationCount: number;
  autoAbsorbedCount: number;
  autoConsolidatedCount: number;
  needsReviewCount: number;
  keptSeparateCount: number;
  sourceRowsMerged: number;
  consolidatedRowsProduced: number;
  twoPitchPlayers: Array<{
    source_player_id: string;
    name: string;
    hand: string;
    classes: string[];
    movements: Array<{ ivb: number | null; hb: number | null }>;
    pitchCounts: number[];
  }>;
  subThresholdDropped: number;
  needsReview: ProcessedRow[];
  totalWritten: number;
  logRowsWritten: number;
  /** All distinct pitch_type values in the table for this season (diagnostic) */
  allPitchTypes: Array<{ pitch_type: string; hand: string; count: number }>;
  discrepancy: DiscrepancyReport;
  populationAverages: PopulationAverages[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const BREAKING_BALL_TAGS = ["Slider", "Sweeper", "Curveball"];
const AUTO_ABSORB_MINOR_PCT = 0.05;         // < 5% of total P
const AUTO_ABSORB_DISTANCE = 6.0;           // inches
const AUTO_CONSOLIDATE_DISTANCE = 4.0;      // inches
const NEEDS_REVIEW_DISTANCE_MIN = 4.0;      // inches
const NEEDS_REVIEW_DISTANCE_MAX = 6.0;      // inches
const KEEP_SEPARATE_DISTANCE = 6.0;         // inches
const KEEP_SEPARATE_MINOR_PCT = 0.05;       // >= 5% of total P
const MIN_PITCHES_FOR_CONSOLIDATION = 5;
const BOUNDARY_MARGIN = 1.0;                // inches from bucket boundary
const OUTLIER_SD_THRESHOLD = 3.0;           // flag if > 3 SD from bucket mean

// ─── Step 1: Filters ────────────────────────────────────────────────────────

interface FilterResult {
  surviving: RawBreakingBallRow[];
  filter1Dropped: Array<{ source_player_id: string; name: string; pitch_type: string; reason: string }>;
  filter2Dropped: Array<{ source_player_id: string; name: string; pitch_type: string; reason: string }>;
  filterPDropped: Array<{ source_player_id: string; name: string; pitch_type: string; reason: string }>;
}

function applyFilters(
  rows: RawBreakingBallRow[],
  nameMap: Map<string, string>,
): FilterResult {
  const filter1Dropped: FilterResult["filter1Dropped"] = [];
  const filter2Dropped: FilterResult["filter2Dropped"] = [];
  const filterPDropped: FilterResult["filterPDropped"] = [];
  const surviving: RawBreakingBallRow[] = [];

  for (const row of rows) {
    const name = nameMap.get(row.source_player_id) ?? row.source_player_id;

    // Filter 1 — missing movement data
    if (row.ivb == null || row.hb == null) {
      filter1Dropped.push({
        source_player_id: row.source_player_id,
        name,
        pitch_type: row.pitch_type,
        reason: `Missing movement data: IVB=${row.ivb}, HB=${row.hb}`,
      });
      continue;
    }

    // Filter P — missing or null pitch count
    if (row.pitches == null || !Number.isFinite(row.pitches)) {
      filterPDropped.push({
        source_player_id: row.source_player_id,
        name,
        pitch_type: row.pitch_type,
        reason: `Missing pitch count: P=${row.pitches}`,
      });
      continue;
    }

    // Filter 2 — zero movement with insufficient sample
    if (row.ivb === 0 && row.hb === 0 && row.pitches < MIN_PITCHES_FOR_CONSOLIDATION) {
      filter2Dropped.push({
        source_player_id: row.source_player_id,
        name,
        pitch_type: row.pitch_type,
        reason: `Zero movement with P=${row.pitches} (< ${MIN_PITCHES_FOR_CONSOLIDATION})`,
      });
      continue;
    }

    surviving.push(row);
  }

  return { surviving, filter1Dropped, filter2Dropped, filterPDropped };
}

// ─── Step 2: Four-Bucket Movement Classification ───────────────────────────
// Priority order per spec: Gyro Slider → Curveball → Sweeper → Slider

function reclassifyRHP(ivb: number, hb: number): string | null {
  // Priority 1 — Gyro Slider: near-zero movement in both directions
  if (ivb >= -2 && hb >= -7) return "Gyro Slider";

  // Priority 2 — Curveball: depth wins. IVB-only, regardless of HB.
  if (ivb <= -8) return "Curveball";

  // Priority 3 — Sweeper: dominant horizontal, minimal depth
  if (hb <= -11 && ivb > -4) return "Sweeper";

  // Priority 4 — Slider: default catch for any non-curveball breaking ball
  return "Slider";
}

function reclassifyLHP(ivb: number, hb: number): string | null {
  // Mirror HorzBrk signs, IVB thresholds identical

  // Priority 1 — Gyro Slider: near-zero movement
  if (ivb >= -2 && hb <= 7) return "Gyro Slider";

  // Priority 2 — Curveball: depth wins. IVB-only.
  if (ivb <= -8) return "Curveball";

  // Priority 3 — Sweeper: dominant horizontal (positive HB for LHP)
  if (hb >= 11 && ivb > -4) return "Sweeper";

  // Priority 4 — Slider: default catch for any non-curveball breaking ball
  return "Slider";
}

function reclassify(row: RawBreakingBallRow): string | null {
  const ivb = row.ivb!;
  const hb = row.hb!;
  return row.hand === "L" ? reclassifyLHP(ivb, hb) : reclassifyRHP(ivb, hb);
}

// ─── Step 3: Consolidation (4-Tier Rules) ──────────────────────────────────

function movementDistance(a: { ivb: number | null; hb: number | null }, b: { ivb: number | null; hb: number | null }): number {
  const dIvb = (a.ivb ?? 0) - (b.ivb ?? 0);
  const dHb = (a.hb ?? 0) - (b.hb ?? 0);
  return Math.sqrt(dIvb * dIvb + dHb * dHb);
}

function weightedAvg(values: Array<{ value: number | null; weight: number }>): number | null {
  let sumVal = 0;
  let sumW = 0;
  for (const { value, weight } of values) {
    if (value == null) continue;
    sumVal += value * weight;
    sumW += weight;
  }
  return sumW > 0 ? sumVal / sumW : null;
}

function round2(v: number | null): number | null {
  return v == null ? null : Math.round(v * 100) / 100;
}

function round1(v: number | null): number | null {
  return v == null ? null : Math.round(v * 10) / 10;
}

interface ConsolidationResult {
  outputRows: ProcessedRow[];
  twoPitchPlayers: ReclassificationReport["twoPitchPlayers"];
  sourceRowsMerged: number;
  consolidatedRowsProduced: number;
  autoAbsorbedCount: number;
  autoConsolidatedCount: number;
  needsReviewCount: number;
  keptSeparateCount: number;
  subThresholdDropped: number;
  subThresholdDetails: Array<{ source_player_id: string; name: string; pitch_type: string; pitches: number }>;
}

function consolidate(
  classified: Array<RawBreakingBallRow & { rstr_pitch_class: string; _zeroMovementFlag: boolean }>,
  nameMap: Map<string, string>,
): ConsolidationResult {
  const output: ProcessedRow[] = [];
  const twoPitchPlayers: ReclassificationReport["twoPitchPlayers"] = [];
  let sourceRowsMerged = 0;
  let consolidatedRowsProduced = 0;
  let autoAbsorbedCount = 0;
  let autoConsolidatedCount = 0;
  let needsReviewCount = 0;
  let keptSeparateCount = 0;
  let subThresholdDropped = 0;
  const subThresholdDetails: ConsolidationResult["subThresholdDetails"] = [];

  // Group by (source_player_id, rstr_pitch_class)
  const groups = new Map<string, typeof classified>();
  for (const row of classified) {
    const key = `${row.source_player_id}::${row.rstr_pitch_class}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const makeProcessedRow = (
    r: typeof classified[0],
    name: string,
    overrides?: Partial<ProcessedRow>,
  ): ProcessedRow => ({
    ...r,
    needs_review: r._zeroMovementFlag,
    review_note: r._zeroMovementFlag
      ? "zero movement with sufficient sample — may be legitimate gyro or data error, verify manually"
      : null,
    review_detail: null,
    p_consolidated: false,
    p_consolidated_count: null,
    source_tags: [r.pitch_type],
    dropped_sources: null,
    boundary_case: false,
    outlier_flag: false,
    outlier_metrics: null,
    _playerName: name,
    ...overrides,
  });

  for (const [, group] of groups) {
    const name = nameMap.get(group[0].source_player_id) ?? group[0].source_player_id;

    if (group.length === 1) {
      output.push(makeProcessedRow(group[0], name));
      continue;
    }

    // Multiple rows — sort by P desc for consistent dominant/minor identification
    const sorted = [...group].sort((a, b) => (b.pitches ?? 0) - (a.pitches ?? 0));
    const totalP = sorted.reduce((s, r) => s + (r.pitches ?? 0), 0);

    // Calculate all pairwise distances
    let maxDist = 0;
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const d = movementDistance(sorted[i], sorted[j]);
        if (d > maxDist) maxDist = d;
      }
    }

    // For 2-row groups, calculate minor_pct
    const minorP = sorted.length >= 2 ? (sorted[sorted.length - 1].pitches ?? 0) : 0;
    const minorPct = totalP > 0 ? minorP / totalP : 0;

    // ── Rule 1: Auto-Absorb ────────────────────────────────────────────
    // minor_pct < 5% AND distance < 6.0 inches → merge, no flag
    if (minorPct < AUTO_ABSORB_MINOR_PCT && maxDist < AUTO_ABSORB_DISTANCE) {
      const merged = mergeRows(sorted, name, "auto-absorb");
      autoAbsorbedCount++;
      sourceRowsMerged += sorted.length;
      consolidatedRowsProduced++;
      output.push(merged);
      continue;
    }

    // ── Rule 2: Auto-Consolidate ───────────────────────────────────────
    // distance < 4.0 inches (regardless of minor_pct) → merge
    if (maxDist < AUTO_CONSOLIDATE_DISTANCE) {
      const merged = mergeRows(sorted, name, "auto-consolidate");
      autoConsolidatedCount++;
      sourceRowsMerged += sorted.length;
      consolidatedRowsProduced++;
      output.push(merged);
      continue;
    }

    // ── Rule 3: Needs Review ───────────────────────────────────────────
    // distance 4.0–6.0 AND minor_pct >= 5% → flag, keep separate
    if (maxDist >= NEEDS_REVIEW_DISTANCE_MIN && maxDist < NEEDS_REVIEW_DISTANCE_MAX && minorPct >= KEEP_SEPARATE_MINOR_PCT) {
      needsReviewCount++;
      for (const r of sorted) {
        output.push(makeProcessedRow(r, name, {
          needs_review: true,
          review_note: `needs review — movement distance ${maxDist.toFixed(1)} in (4.0–6.0 range), minor P ${(minorPct * 100).toFixed(1)}% — possible two-pitch case`,
          review_detail: {
            movement_distance: round2(maxDist),
            minor_pct: round2(minorPct),
            rows: sorted.map((s) => ({
              pitch_type: s.pitch_type,
              pitches: s.pitches,
              ivb: s.ivb,
              hb: s.hb,
            })),
          },
        }));
      }
      continue;
    }

    // ── Rule 4: Keep Separate ──────────────────────────────────────────
    // distance >= 6.0 AND minor_pct >= 5% → genuinely different pitches
    if (maxDist >= KEEP_SEPARATE_DISTANCE && minorPct >= KEEP_SEPARATE_MINOR_PCT) {
      keptSeparateCount++;
      const baseClass = sorted[0].rstr_pitch_class;

      twoPitchPlayers.push({
        source_player_id: sorted[0].source_player_id,
        name,
        hand: sorted[0].hand,
        classes: sorted.map((_, i) => `${baseClass}_v${i + 1}`),
        movements: sorted.map((r) => ({ ivb: r.ivb, hb: r.hb })),
        pitchCounts: sorted.map((r) => r.pitches ?? 0),
      });

      for (let i = 0; i < sorted.length; i++) {
        output.push(makeProcessedRow(sorted[i], name, {
          rstr_pitch_class: `${baseClass}_v${i + 1}`,
        }));
      }
      continue;
    }

    // Fallback: if none of the 4 rules matched (shouldn't happen), auto-consolidate
    const merged = mergeRows(sorted, name, "fallback-consolidate");
    autoConsolidatedCount++;
    sourceRowsMerged += sorted.length;
    consolidatedRowsProduced++;
    output.push(merged);
  }

  // Drop sub-threshold P rows from the final output
  const finalOutput: ProcessedRow[] = [];
  for (const row of output) {
    if ((row.pitches ?? 0) < MIN_PITCHES_FOR_CONSOLIDATION && !row.p_consolidated) {
      subThresholdDropped++;
      subThresholdDetails.push({
        source_player_id: row.source_player_id,
        name: row._playerName ?? row.source_player_id,
        pitch_type: row.pitch_type,
        pitches: row.pitches ?? 0,
      });
      continue;
    }
    finalOutput.push(row);
  }

  return {
    outputRows: finalOutput,
    twoPitchPlayers,
    sourceRowsMerged,
    consolidatedRowsProduced,
    autoAbsorbedCount,
    autoConsolidatedCount,
    needsReviewCount,
    keptSeparateCount,
    subThresholdDropped,
    subThresholdDetails,
  };

  function mergeRows(
    rows: Array<RawBreakingBallRow & { rstr_pitch_class: string; _zeroMovementFlag: boolean }>,
    playerName: string,
    rule: string,
  ): ProcessedRow {
    const totalP = rows.reduce((s, r) => s + (r.pitches ?? 0), 0);
    const weights = rows.map((r) => ({ value: r, weight: r.pitches ?? 0 }));
    const wAvg = (getter: (r: RawBreakingBallRow) => number | null): number | null =>
      weightedAvg(weights.map((w) => ({ value: getter(w.value), weight: w.weight })));

    const base = rows[0];
    return {
      ...base,
      pitches: totalP,
      velocity: round2(wAvg((r) => r.velocity)),
      ivb: round2(wAvg((r) => r.ivb)),
      hb: round2(wAvg((r) => r.hb)),
      rel_height: round2(wAvg((r) => r.rel_height)),
      rel_side: round2(wAvg((r) => r.rel_side)),
      extension: round2(wAvg((r) => r.extension)),
      spin: wAvg((r) => r.spin) != null ? Math.round(wAvg((r) => r.spin)!) : null,
      vaa: round2(wAvg((r) => r.vaa)),
      whiff_pct: round1(wAvg((r) => r.whiff_pct)),
      rstr_pitch_class: base.rstr_pitch_class,
      needs_review: false,
      review_note: null,
      review_detail: null,
      p_consolidated: true,
      p_consolidated_count: rows.length,
      source_tags: rows.map((r) => r.pitch_type),
      dropped_sources: null,
      boundary_case: false,
      outlier_flag: false,
      outlier_metrics: null,
      _playerName: playerName,
      _absorbedIds: rows.slice(1).map((r) => r.id),
      _consolidation_rule: rule,
    };
  }
}

// ─── Step 4: Population Averages ───────────────────────────────────────────

function calcPopulationAverages(
  rows: ProcessedRow[],
  season: number,
): PopulationAverages[] {
  // Group by (rstr_pitch_class, hand)
  const groups = new Map<string, ProcessedRow[]>();
  for (const r of rows) {
    // Skip two-pitch variants for population averages — use base class only
    const cls = r.rstr_pitch_class.replace(/_v\d+$/, "");
    const key = `${cls}::${r.hand}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const results: PopulationAverages[] = [];
  for (const [key, group] of groups) {
    const [pitch_type, hand] = key.split("::");
    const totalP = group.reduce((s, r) => s + (r.pitches ?? 0), 0);

    const wMean = (getter: (r: ProcessedRow) => number | null): number | null => {
      let sumW = 0;
      let sumVal = 0;
      for (const r of group) {
        const v = getter(r);
        const p = r.pitches ?? 0;
        if (v == null || p === 0) continue;
        sumVal += v * p;
        sumW += p;
      }
      return sumW > 0 ? sumVal / sumW : null;
    };

    const wSd = (getter: (r: ProcessedRow) => number | null, mean: number | null): number | null => {
      if (mean == null) return null;
      let sumW = 0;
      let sumSq = 0;
      for (const r of group) {
        const v = getter(r);
        const p = r.pitches ?? 0;
        if (v == null || p === 0) continue;
        sumSq += p * (v - mean) * (v - mean);
        sumW += p;
      }
      return sumW > 0 ? Math.sqrt(sumSq / sumW) : null;
    };

    const velMean = wMean((r) => r.velocity);
    const ivbMean = wMean((r) => r.ivb);
    const hbMean = wMean((r) => r.hb);
    const relHMean = wMean((r) => r.rel_height);
    const relSMean = wMean((r) => r.rel_side);
    const extMean = wMean((r) => r.extension);
    const spinMean = wMean((r) => r.spin);
    const whiffMean = wMean((r) => r.whiff_pct);

    results.push({
      pitch_type,
      hand,
      season,
      n_pitchers: group.length,
      pitches: totalP,
      velocity: round2(velMean),
      velocity_sd: round2(wSd((r) => r.velocity, velMean)),
      ivb: round2(ivbMean),
      ivb_sd: round2(wSd((r) => r.ivb, ivbMean)),
      hb: round2(hbMean),
      hb_sd: round2(wSd((r) => r.hb, hbMean)),
      rel_height: round2(relHMean),
      rel_height_sd: round2(wSd((r) => r.rel_height, relHMean)),
      rel_side: round2(relSMean),
      rel_side_sd: round2(wSd((r) => r.rel_side, relSMean)),
      extension: round2(extMean),
      extension_sd: round2(wSd((r) => r.extension, extMean)),
      spin: round2(spinMean),
      spin_sd: round2(wSd((r) => r.spin, spinMean)),
      whiff_pct: round2(whiffMean),
      whiff_pct_sd: round2(wSd((r) => r.whiff_pct, whiffMean)),
    });
  }

  results.sort((a, b) => `${a.hand}${a.pitch_type}`.localeCompare(`${b.hand}${b.pitch_type}`));
  return results;
}

// ─── Step 5: Discrepancy Detection ─────────────────────────────────────────

function detectBoundaryCases(row: ProcessedRow): boolean {
  const ivb = row.ivb;
  const hb = row.hb;
  if (ivb == null || hb == null) return false;

  if (row.hand === "R") {
    // Gyro/Slider boundary: IVB between -3 and -1
    if (ivb >= -3 && ivb <= -1) return true;
    // Slider/Curveball boundary: IVB between -9 and -7
    if (ivb >= -9 && ivb <= -7) return true;
    // Slider/Sweeper boundary: HB between -12 and -10
    if (hb >= -12 && hb <= -10) return true;
  } else {
    // LHP mirrors
    if (ivb >= -3 && ivb <= -1) return true;
    if (ivb >= -9 && ivb <= -7) return true;
    if (hb >= 10 && hb <= 12) return true;
  }
  return false;
}

function detectOutliers(
  row: ProcessedRow,
  popAvgs: PopulationAverages[],
): { isOutlier: boolean; metrics: string[] } {
  const cls = row.rstr_pitch_class.replace(/_v\d+$/, "");
  const pop = popAvgs.find((p) => p.pitch_type === cls && p.hand === row.hand);
  if (!pop) return { isOutlier: false, metrics: [] };

  const flagged: string[] = [];
  const check = (label: string, val: number | null, mean: number | null, sd: number | null) => {
    if (val == null || mean == null || sd == null || sd === 0) return;
    if (Math.abs(val - mean) / sd > OUTLIER_SD_THRESHOLD) flagged.push(label);
  };

  check("velocity", row.velocity, pop.velocity, pop.velocity_sd);
  check("ivb", row.ivb, pop.ivb, pop.ivb_sd);
  check("hb", row.hb, pop.hb, pop.hb_sd);
  check("rel_height", row.rel_height, pop.rel_height, pop.rel_height_sd);
  check("rel_side", row.rel_side, pop.rel_side, pop.rel_side_sd);
  check("extension", row.extension, pop.extension, pop.extension_sd);
  check("spin", row.spin, pop.spin, pop.spin_sd);
  check("whiff_pct", row.whiff_pct, pop.whiff_pct, pop.whiff_pct_sd);

  return { isOutlier: flagged.length > 0, metrics: flagged };
}

function runDiscrepancyDetection(
  rows: ProcessedRow[],
  popAvgs: PopulationAverages[],
): DiscrepancyReport {
  const crossBucketSamePitch: DiscrepancyReport["crossBucketSamePitch"] = [];
  const crossBucketTwoPitch: DiscrepancyReport["crossBucketTwoPitch"] = [];
  const boundaryCases: ProcessedRow[] = [];
  const outlierCases: ProcessedRow[] = [];

  // 5a — Cross-bucket pitcher detection
  // Group by (source_player_id, hand) across ALL buckets
  const byPlayer = new Map<string, ProcessedRow[]>();
  for (const r of rows) {
    const key = `${r.source_player_id}::${r.hand}`;
    if (!byPlayer.has(key)) byPlayer.set(key, []);
    byPlayer.get(key)!.push(r);
  }

  for (const [, playerRows] of byPlayer) {
    const baseClasses = new Set(playerRows.map((r) => r.rstr_pitch_class.replace(/_v\d+$/, "")));
    if (baseClasses.size <= 1) continue;

    // Pitcher appears in multiple buckets
    const bucketEntries = playerRows.map((r) => ({
      bucket: r.rstr_pitch_class,
      ivb: r.ivb,
      hb: r.hb,
    }));

    // Calculate min distance between any two entries in different base buckets
    let minDist = Infinity;
    for (let i = 0; i < playerRows.length; i++) {
      for (let j = i + 1; j < playerRows.length; j++) {
        const ci = playerRows[i].rstr_pitch_class.replace(/_v\d+$/, "");
        const cj = playerRows[j].rstr_pitch_class.replace(/_v\d+$/, "");
        if (ci === cj) continue;
        const d = movementDistance(playerRows[i], playerRows[j]);
        if (d < minDist) minDist = d;
      }
    }

    const entry = {
      source_player_id: playerRows[0].source_player_id,
      name: playerRows[0]._playerName ?? playerRows[0].source_player_id,
      hand: playerRows[0].hand,
      buckets: bucketEntries.map((e) => e.bucket),
      movements: bucketEntries.map((e) => ({ ivb: e.ivb, hb: e.hb })),
      distance: round2(minDist)!,
    };

    if (minDist < AUTO_CONSOLIDATE_DISTANCE) {
      crossBucketSamePitch.push(entry);
    } else {
      crossBucketTwoPitch.push(entry);
    }
  }

  // 5b — Boundary case flagging
  for (const row of rows) {
    const isBoundary = detectBoundaryCases(row);
    if (isBoundary) {
      row.boundary_case = true;
      boundaryCases.push(row);
    }
  }

  // 5c — Extreme outlier flagging
  for (const row of rows) {
    const { isOutlier, metrics } = detectOutliers(row, popAvgs);
    if (isOutlier) {
      row.outlier_flag = true;
      row.outlier_metrics = metrics;
      outlierCases.push(row);
    }
  }

  return { crossBucketSamePitch, crossBucketTwoPitch, boundaryCases, outlierCases };
}

// ─── Step 6: Write Back ────────────────────────────────────────────────────

async function writeResults(
  rows: ProcessedRow[],
  _season: number,
): Promise<{ written: number; logRows: number; errors: string[] }> {
  const errors: string[] = [];
  let written = 0;
  let logRows = 0;
  const BATCH = 50;

  // Batch UPDATE: group ALL rows by rstr_pitch_class and bulk update IDs.
  const classGroups = new Map<string, string[]>();
  for (const r of rows) {
    if (!classGroups.has(r.rstr_pitch_class)) classGroups.set(r.rstr_pitch_class, []);
    classGroups.get(r.rstr_pitch_class)!.push(r.id);
  }

  for (const [cls, ids] of classGroups) {
    // Strip _v1/_v2 suffix so pitch_type matches canonical bucket (Stuff+ engine reads pitch_type)
    const canonicalPitchType = cls.replace(/_v\d+$/, "");
    for (let i = 0; i < ids.length; i += 500) {
      const batch = ids.slice(i, i + 500);
      const { error } = await (supabase as any)
        .from("pitcher_stuff_plus_inputs")
        .update({
          rstr_pitch_class: cls,
          pitch_type: canonicalPitchType,
          needs_review: false,
          p_consolidated: false,
          boundary_case: false,
          outlier_flag: false,
        })
        .in("id", batch);

      if (error) {
        errors.push(`Bulk update ${cls}: ${error.message}`);
      } else {
        written += batch.length;
      }
    }
  }

  // Second pass: flag needs_review rows
  const reviewIds = rows.filter((r) => r.needs_review).map((r) => r.id);
  if (reviewIds.length > 0) {
    for (let i = 0; i < reviewIds.length; i += 500) {
      const batch = reviewIds.slice(i, i + 500);
      await (supabase as any)
        .from("pitcher_stuff_plus_inputs")
        .update({ needs_review: true })
        .in("id", batch);
    }
  }

  // Third pass: flag boundary cases
  const boundaryIds = rows.filter((r) => r.boundary_case).map((r) => r.id);
  if (boundaryIds.length > 0) {
    for (let i = 0; i < boundaryIds.length; i += 500) {
      const batch = boundaryIds.slice(i, i + 500);
      await (supabase as any)
        .from("pitcher_stuff_plus_inputs")
        .update({ boundary_case: true })
        .in("id", batch);
    }
  }

  // Fourth pass: flag outliers
  const outlierIds = rows.filter((r) => r.outlier_flag).map((r) => r.id);
  if (outlierIds.length > 0) {
    for (let i = 0; i < outlierIds.length; i += 500) {
      const batch = outlierIds.slice(i, i + 500);
      await (supabase as any)
        .from("pitcher_stuff_plus_inputs")
        .update({ outlier_flag: true })
        .in("id", batch);
    }
  }

  // Fifth pass: update consolidated rows' metric values
  const consolidated = rows.filter((r) => r.p_consolidated);
  for (const row of consolidated) {
    await (supabase as any)
      .from("pitcher_stuff_plus_inputs")
      .update({
        p_consolidated: true,
        p_consolidated_count: row.p_consolidated_count,
        source_tags: row.source_tags,
        pitches: row.pitches,
        velocity: row.velocity,
        ivb: row.ivb,
        hb: row.hb,
        rel_height: row.rel_height,
        rel_side: row.rel_side,
        extension: row.extension,
        spin: row.spin,
        vaa: row.vaa,
        whiff_pct: row.whiff_pct,
      })
      .eq("id", row.id);
  }

  // Delete absorbed rows in bulk
  const absorbedIds = rows
    .filter((r) => r._absorbedIds && r._absorbedIds.length > 0)
    .flatMap((r) => r._absorbedIds!);

  for (let i = 0; i < absorbedIds.length; i += 500) {
    const batch = absorbedIds.slice(i, i + 500);
    await (supabase as any)
      .from("pitcher_stuff_plus_inputs")
      .delete()
      .in("id", batch);
  }

  // Write to reclassification log
  const logEntries = rows.map((r) => ({
    source_player_id: r.source_player_id,
    season: r.season,
    original_pitch_type: r.pitch_type,
    rstr_pitch_class: r.rstr_pitch_class,
    action_taken: r.p_consolidated
      ? `consolidated ${r.p_consolidated_count} rows [${r.source_tags.join(", ")}] (${r._consolidation_rule})`
      : r.rstr_pitch_class.includes("_v")
        ? `two-pitch split: ${r.rstr_pitch_class}`
        : r.pitch_type !== r.rstr_pitch_class
          ? `reclassified from ${r.pitch_type}`
          : "classification confirmed",
  }));

  for (let i = 0; i < logEntries.length; i += BATCH) {
    const batch = logEntries.slice(i, i + BATCH);
    const { error } = await (supabase as any)
      .from("rstr_reclassification_log")
      .insert(batch);

    if (error) {
      errors.push(`Log batch ${Math.floor(i / BATCH) + 1}: ${error.message}`);
    } else {
      logRows += batch.length;
    }
  }

  return { written, logRows, errors };
}

// ─── Write Population Averages to Supabase ─────────────────────────────────

async function writePopulationAverages(
  averages: PopulationAverages[],
): Promise<{ errors: string[] }> {
  const errors: string[] = [];

  for (const avg of averages) {
    const { error } = await (supabase as any)
      .from("pitcher_stuff_plus_ncaa")
      .upsert(
        {
          pitch_type: avg.pitch_type,
          hand: avg.hand,
          season: avg.season,
          velocity: avg.velocity,
          velocity_sd: avg.velocity_sd,
          ivb: avg.ivb,
          ivb_sd: avg.ivb_sd,
          hb: avg.hb,
          hb_sd: avg.hb_sd,
          rel_height: avg.rel_height,
          rel_height_sd: avg.rel_height_sd,
          rel_side: avg.rel_side,
          rel_side_sd: avg.rel_side_sd,
          extension: avg.extension,
          extension_sd: avg.extension_sd,
          spin: avg.spin,
          spin_sd: avg.spin_sd,
          whiff_pct: avg.whiff_pct,
          whiff_pct_sd: avg.whiff_pct_sd,
        },
        { onConflict: "pitch_type,hand,season" },
      );

    if (error) {
      errors.push(`Pop avg upsert ${avg.pitch_type}/${avg.hand}: ${error.message}`);
    }
  }

  return { errors };
}

// ─── Paginated fetch (Supabase default limit is 1000) ───────────────────────

async function fetchAllRows<T>(
  table: string,
  select: string,
  filters: (query: any) => any,
): Promise<{ data: T[]; error: string | null }> {
  const PAGE = 1000;
  const all: T[] = [];
  let offset = 0;

  while (true) {
    let query = (supabase as any).from(table).select(select).range(offset, offset + PAGE - 1);
    query = filters(query);
    const { data, error } = await query;

    if (error) return { data: all, error: error.message };
    if (!data || data.length === 0) break;

    all.push(...data);
    if (data.length < PAGE) break; // last page
    offset += PAGE;
  }

  return { data: all, error: null };
}

// ─── Main Pipeline ──────────────────────────────────────────────────────────

export async function runBreakingBallReclassification(
  season: number = 2025,
): Promise<{ report: ReclassificationReport; errors: string[] }> {
  const errors: string[] = [];

  // ── Diagnostic: fetch ALL distinct pitch_type values in the table ─────
  const { data: diagRows } = await fetchAllRows<{ pitch_type: string; hand: string }>(
    "pitcher_stuff_plus_inputs",
    "pitch_type, hand",
    (q: any) => q.eq("season", season),
  );

  const ptCounts = new Map<string, number>();
  for (const r of diagRows) {
    const key = `${r.pitch_type}::${r.hand}`;
    ptCounts.set(key, (ptCounts.get(key) ?? 0) + 1);
  }
  const allPitchTypes: ReclassificationReport["allPitchTypes"] = [];
  for (const [key, count] of ptCounts) {
    const [pitch_type, hand] = key.split("::");
    allPitchTypes.push({ pitch_type, hand, count });
  }
  allPitchTypes.sort((a, b) => b.count - a.count);

  // ── Step 1: Pull ALL breaking ball rows ─────────────────────────────────
  const { data: rawData, error: pullErrMsg } = await fetchAllRows<RawBreakingBallRow>(
    "pitcher_stuff_plus_inputs",
    "*",
    (q: any) => q.eq("season", season).in("pitch_type", BREAKING_BALL_TAGS),
  );

  if (pullErrMsg) {
    return {
      report: emptyReport(),
      errors: [`Failed to pull data: ${pullErrMsg}`],
    };
  }

  // ── Deduplicate: collapse identical rows from prior failed pipeline runs ─
  const deduped = new Map<string, RawBreakingBallRow>();
  let dupsRemoved = 0;
  for (const row of rawData) {
    const key = `${row.source_player_id}::${row.pitch_type}::${row.hand}::${row.pitches}::${row.ivb}::${row.hb}`;
    if (!deduped.has(key)) {
      deduped.set(key, row);
    } else {
      dupsRemoved++;
    }
  }
  const rawRows = [...deduped.values()];

  if (dupsRemoved > 0) {
    errors.push(`Deduplicated: removed ${dupsRemoved} duplicate rows (${rawData.length} → ${rawRows.length})`);
  }

  // Fetch player names from Pitching Master for reporting
  const playerIds = [...new Set(rawRows.map((r) => r.source_player_id))];
  const nameMap = new Map<string, string>();

  for (let i = 0; i < playerIds.length; i += 100) {
    const batch = playerIds.slice(i, i + 100);
    const { data: pitchers } = await (supabase as any)
      .from("Pitching Master")
      .select("source_player_id, playerFullName")
      .in("source_player_id", batch)
      .eq("Season", season);

    for (const p of pitchers || []) {
      if (p.source_player_id && p.playerFullName) {
        nameMap.set(p.source_player_id, p.playerFullName);
      }
    }
  }

  // ── Step 1b: Filter ────────────────────────────────────────────────────
  const { surviving, filter1Dropped, filter2Dropped, filterPDropped } = applyFilters(rawRows, nameMap);

  // ── Step 2: Reclassify (4-bucket movement classification) ─────────────
  const classified: Array<RawBreakingBallRow & { rstr_pitch_class: string; _zeroMovementFlag: boolean }> = [];
  const unclassifiedRows: ReclassificationReport["unclassifiedRows"] = [];

  for (const row of surviving) {
    const result = reclassify(row);
    const _zeroMovementFlag = row.ivb === 0 && row.hb === 0;
    if (result == null) {
      unclassifiedRows.push({
        source_player_id: row.source_player_id,
        name: nameMap.get(row.source_player_id) ?? row.source_player_id,
        hand: row.hand,
        ivb: row.ivb!,
        hb: row.hb!,
        pitch_type: row.pitch_type,
      });
    } else {
      classified.push({ ...row, rstr_pitch_class: result, _zeroMovementFlag });
    }
  }

  // Build tag movement stats
  const tagMovementMap = new Map<string, number>();
  for (const row of classified) {
    const key = `${row.hand}::${row.pitch_type}::${row.rstr_pitch_class}`;
    tagMovementMap.set(key, (tagMovementMap.get(key) ?? 0) + 1);
  }
  const tagMovements: ReclassificationReport["tagMovements"] = [];
  for (const [key, count] of tagMovementMap) {
    const [hand, from, to] = key.split("::");
    tagMovements.push({ from, to, hand, count });
  }
  tagMovements.sort((a, b) => b.count - a.count);

  // Reclassification counts by hand and class
  const reclassificationCounts: Record<string, Record<string, number>> = {};
  for (const row of classified) {
    if (!reclassificationCounts[row.hand]) reclassificationCounts[row.hand] = {};
    const bucket = reclassificationCounts[row.hand];
    bucket[row.rstr_pitch_class] = (bucket[row.rstr_pitch_class] ?? 0) + 1;
  }

  // ── Step 3: Consolidation (4-tier rules) ──────────────────────────────
  const {
    outputRows,
    twoPitchPlayers,
    sourceRowsMerged,
    consolidatedRowsProduced,
    autoAbsorbedCount,
    autoConsolidatedCount,
    needsReviewCount,
    keptSeparateCount,
    subThresholdDropped,
  } = consolidate(classified, nameMap);

  // ── Step 4: Calculate population averages from final rows ─────────────
  const populationAverages = calcPopulationAverages(outputRows, season);

  // Write population averages to Supabase
  const popWriteResult = await writePopulationAverages(populationAverages);
  errors.push(...popWriteResult.errors);

  // ── Step 5: Discrepancy detection ─────────────────────────────────────
  const discrepancy = runDiscrepancyDetection(outputRows, populationAverages);

  // ── Step 6: Write back ─────────────────────────────────────────────────
  const writeResult = await writeResults(outputRows, season);
  errors.push(...writeResult.errors);

  // ── Step 7: Build report ───────────────────────────────────────────────
  const report: ReclassificationReport = {
    totalPulled: rawRows.length,
    filter1Dropped,
    filter2Dropped,
    filterPDropped,
    survivingIntoReclassification: surviving.length,
    reclassificationCounts,
    unclassifiedRows,
    tagMovements,
    consolidationCount: consolidatedRowsProduced,
    autoAbsorbedCount,
    autoConsolidatedCount,
    needsReviewCount,
    keptSeparateCount,
    sourceRowsMerged,
    consolidatedRowsProduced,
    twoPitchPlayers,
    subThresholdDropped,
    needsReview: outputRows.filter((r) => r.needs_review),
    totalWritten: writeResult.written,
    logRowsWritten: writeResult.logRows,
    allPitchTypes,
    discrepancy,
    populationAverages,
  };

  return { report, errors };
}

function emptyReport(): ReclassificationReport {
  return {
    totalPulled: 0,
    filter1Dropped: [],
    filter2Dropped: [],
    filterPDropped: [],
    survivingIntoReclassification: 0,
    reclassificationCounts: {},
    unclassifiedRows: [],
    tagMovements: [],
    consolidationCount: 0,
    autoAbsorbedCount: 0,
    autoConsolidatedCount: 0,
    needsReviewCount: 0,
    keptSeparateCount: 0,
    sourceRowsMerged: 0,
    consolidatedRowsProduced: 0,
    twoPitchPlayers: [],
    subThresholdDropped: 0,
    needsReview: [],
    totalWritten: 0,
    logRowsWritten: 0,
    allPitchTypes: [],
    discrepancy: { crossBucketSamePitch: [], crossBucketTwoPitch: [], boundaryCases: [], outlierCases: [] },
    populationAverages: [],
  };
}
