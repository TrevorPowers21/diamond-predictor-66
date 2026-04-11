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
  /** Player name fetched from Pitching Master for reporting */
  _playerName?: string;
  /** IDs of rows absorbed during consolidation (to be deleted) */
  _absorbedIds?: string[];
}

export interface ReclassificationReport {
  totalPulled: number;
  filter1Dropped: Array<{ source_player_id: string; name: string; pitch_type: string; reason: string }>;
  filter2Dropped: Array<{ source_player_id: string; name: string; pitch_type: string; reason: string }>;
  survivingIntoReclassification: number;
  reclassificationCounts: Record<string, Record<string, number>>; // hand → class → count
  tagMovements: Array<{ from: string; to: string; hand: string; count: number }>;
  consolidationCount: number;
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
}

// ─── Constants ──────────────────────────────────────────────────────────────

const BREAKING_BALL_TAGS = ["Slider", "Sweeper", "Curveball"];
const MOVEMENT_DISTANCE_THRESHOLD = 4.0;
const MIN_PITCHES_FOR_CONSOLIDATION = 5;
const GRAY_ZONE_P_RATIO = 0.3;  // within 30%
const GRAY_ZONE_DIST_MIN = 2.0;
const GRAY_ZONE_DIST_MAX = 4.0;

// ─── Step 2: Filters ────────────────────────────────────────────────────────

interface FilterResult {
  surviving: RawBreakingBallRow[];
  filter1Dropped: Array<{ source_player_id: string; name: string; pitch_type: string; reason: string }>;
  filter2Dropped: Array<{ source_player_id: string; name: string; pitch_type: string; reason: string }>;
}

function applyFilters(
  rows: RawBreakingBallRow[],
  nameMap: Map<string, string>,
): FilterResult {
  const filter1Dropped: FilterResult["filter1Dropped"] = [];
  const filter2Dropped: FilterResult["filter2Dropped"] = [];
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

    // Filter 2 — zero movement
    if (row.ivb === 0 && row.hb === 0) {
      if ((row.pitches ?? 0) < MIN_PITCHES_FOR_CONSOLIDATION) {
        filter2Dropped.push({
          source_player_id: row.source_player_id,
          name,
          pitch_type: row.pitch_type,
          reason: `Zero movement with P=${row.pitches} (< ${MIN_PITCHES_FOR_CONSOLIDATION})`,
        });
        continue;
      }
      // Keep but flag
      surviving.push(row);
      continue;
    }

    surviving.push(row);
  }

  return { surviving, filter1Dropped, filter2Dropped };
}

// ─── Step 3: Reclassification ───────────────────────────────────────────────

function reclassifyRHP(ivb: number, hb: number): string {
  // Priority order — first match wins
  if (ivb <= -8 && hb <= 0)                    return "Curveball";
  if (hb <= -11 && ivb > -4)                   return "Sweeper";
  if (ivb >= -2 && hb >= -7)                   return "Gyro Slider";
  if (ivb >= -8 && ivb <= -2 && hb >= -11 && hb <= -4) return "Slider";

  // Tiebreakers
  if (ivb <= -8)  return "Curveball";
  if (hb <= -11)  return "Sweeper";
  return "Slider";
}

function reclassifyLHP(ivb: number, hb: number): string {
  // Mirror HorzBrk signs, IVB thresholds identical
  if (ivb <= -8 && hb >= 0)                    return "Curveball";
  if (hb >= 11 && ivb > -4)                    return "Sweeper";
  if (ivb >= -2 && hb <= 7)                    return "Gyro Slider";
  if (ivb >= -8 && ivb <= -2 && hb >= 4 && hb <= 11) return "Slider";

  // Tiebreakers
  if (ivb <= -8)  return "Curveball";
  if (hb >= 11)   return "Sweeper";
  return "Slider";
}

function reclassify(row: RawBreakingBallRow): string {
  const ivb = row.ivb!;
  const hb = row.hb!;
  return row.hand === "L" ? reclassifyLHP(ivb, hb) : reclassifyRHP(ivb, hb);
}

// ─── Step 4: Consolidation ──────────────────────────────────────────────────

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

interface ConsolidationResult {
  outputRows: ProcessedRow[];
  twoPitchPlayers: ReclassificationReport["twoPitchPlayers"];
  sourceRowsMerged: number;
  consolidatedRowsProduced: number;
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
  let subThresholdDropped = 0;
  const subThresholdDetails: ConsolidationResult["subThresholdDetails"] = [];

  // Group by (source_player_id, rstr_pitch_class)
  const groups = new Map<string, typeof classified>();
  for (const row of classified) {
    const key = `${row.source_player_id}::${row.rstr_pitch_class}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  for (const [, group] of groups) {
    const name = nameMap.get(group[0].source_player_id) ?? group[0].source_player_id;

    if (group.length === 1) {
      // Single row — just pass through
      const r = group[0];
      output.push({
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
        _playerName: name,
      });
      continue;
    }

    // Multiple rows — Decision 1: check movement distance between all pairs
    // For simplicity with >2 rows, check max pairwise distance
    let maxDist = 0;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const d = movementDistance(group[i], group[j]);
        if (d > maxDist) maxDist = d;
      }
    }

    if (maxDist >= MOVEMENT_DISTANCE_THRESHOLD) {
      // Legitimate two-pitch player — sort by P desc, assign v1/v2
      const sorted = [...group].sort((a, b) => (b.pitches ?? 0) - (a.pitches ?? 0));
      const baseClass = sorted[0].rstr_pitch_class;

      twoPitchPlayers.push({
        source_player_id: sorted[0].source_player_id,
        name,
        hand: sorted[0].hand,
        classes: sorted.map((r, i) => `${baseClass}_v${i + 1}`),
        movements: sorted.map((r) => ({ ivb: r.ivb, hb: r.hb })),
        pitchCounts: sorted.map((r) => r.pitches ?? 0),
      });

      for (let i = 0; i < sorted.length; i++) {
        const r = sorted[i];
        output.push({
          ...r,
          rstr_pitch_class: `${baseClass}_v${i + 1}`,
          needs_review: r._zeroMovementFlag,
          review_note: r._zeroMovementFlag
            ? "zero movement with sufficient sample — may be legitimate gyro or data error, verify manually"
            : null,
          review_detail: null,
          p_consolidated: false,
          p_consolidated_count: null,
          source_tags: [r.pitch_type],
          dropped_sources: null,
          _playerName: name,
        });
      }
      continue;
    }

    // Movement distance < threshold → tagging artifact, consolidate
    // Decision 2: drop sub-threshold P rows before consolidating
    const survivingRows = group.filter((r) => (r.pitches ?? 0) >= MIN_PITCHES_FOR_CONSOLIDATION);
    const droppedRows = group.filter((r) => (r.pitches ?? 0) < MIN_PITCHES_FOR_CONSOLIDATION);

    for (const d of droppedRows) {
      subThresholdDropped++;
      subThresholdDetails.push({
        source_player_id: d.source_player_id,
        name,
        pitch_type: d.pitch_type,
        pitches: d.pitches ?? 0,
      });
    }

    const droppedSources = droppedRows.length > 0
      ? droppedRows.map((d) => ({ pitch_type: d.pitch_type, pitches: d.pitches ?? 0 }))
      : null;

    if (survivingRows.length === 0) {
      // All rows were sub-threshold — shouldn't happen but handle gracefully
      continue;
    }

    if (survivingRows.length === 1) {
      // Only one survived after dropping sub-threshold — keep as-is, no merge
      const r = survivingRows[0];
      output.push({
        ...r,
        needs_review: r._zeroMovementFlag,
        review_note: r._zeroMovementFlag
          ? "zero movement with sufficient sample — may be legitimate gyro or data error, verify manually"
          : null,
        review_detail: null,
        p_consolidated: false,
        p_consolidated_count: null,
        source_tags: [r.pitch_type],
        dropped_sources: droppedSources,
        _playerName: name,
      });
      continue;
    }

    // Decision 3: consolidate with weighted averages
    const totalP = survivingRows.reduce((s, r) => s + (r.pitches ?? 0), 0);
    const weights = survivingRows.map((r) => ({ value: r, weight: r.pitches ?? 0 }));

    const wAvg = (getter: (r: RawBreakingBallRow) => number | null): number | null =>
      weightedAvg(weights.map((w) => ({ value: getter(w.value), weight: w.weight })));

    // Check gray zone — Decision 4
    let grayZone = false;
    let grayZoneDetail: Record<string, unknown> | null = null;
    if (survivingRows.length === 2) {
      const [a, b] = survivingRows;
      const pA = a.pitches ?? 0;
      const pB = b.pitches ?? 0;
      const pMin = Math.min(pA, pB);
      const pMax = Math.max(pA, pB);
      const pRatio = pMax > 0 ? Math.abs(pA - pB) / pMax : 1;
      const dist = movementDistance(a, b);

      if (pRatio <= GRAY_ZONE_P_RATIO && dist >= GRAY_ZONE_DIST_MIN && dist < GRAY_ZONE_DIST_MAX) {
        grayZone = true;
        grayZoneDetail = {
          movement_distance: Math.round(dist * 100) / 100,
          row_a: {
            pitch_type: a.pitch_type,
            pitches: pA,
            ivb: a.ivb,
            hb: a.hb,
            velocity: a.velocity,
            spin: a.spin,
          },
          row_b: {
            pitch_type: b.pitch_type,
            pitches: pB,
            ivb: b.ivb,
            hb: b.hb,
            velocity: b.velocity,
            spin: b.spin,
          },
        };
      }
    }

    const anyNeedsReview = survivingRows.some((r) => r._zeroMovementFlag) || grayZone;

    // Use the first surviving row as the base for identity fields
    const base = survivingRows[0];
    const merged: ProcessedRow = {
      ...base,
      pitches: totalP,
      velocity: wAvg((r) => r.velocity),
      ivb: wAvg((r) => r.ivb),
      hb: wAvg((r) => r.hb),
      rel_height: wAvg((r) => r.rel_height),
      rel_side: wAvg((r) => r.rel_side),
      extension: wAvg((r) => r.extension),
      spin: wAvg((r) => r.spin) != null ? Math.round(wAvg((r) => r.spin)!) : null,
      vaa: wAvg((r) => r.vaa),
      whiff_pct: wAvg((r) => r.whiff_pct),
      rstr_pitch_class: base.rstr_pitch_class,
      needs_review: anyNeedsReview,
      review_note: grayZone
        ? "gray zone consolidation — P counts within 30% and movement distance 2.0–4.0 in, verify manually"
        : base._zeroMovementFlag
          ? "zero movement with sufficient sample — may be legitimate gyro or data error, verify manually"
          : null,
      review_detail: grayZoneDetail,
      p_consolidated: true,
      p_consolidated_count: survivingRows.length,
      source_tags: survivingRows.map((r) => r.pitch_type),
      dropped_sources: droppedSources,
      _playerName: name,
      // Track absorbed row IDs: all surviving rows except the base, plus dropped rows
      _absorbedIds: [
        ...survivingRows.slice(1).map((r) => r.id),
        ...droppedRows.map((r) => r.id),
      ],
    };

    sourceRowsMerged += survivingRows.length;
    consolidatedRowsProduced++;
    output.push(merged);
  }

  return { outputRows: output, twoPitchPlayers, sourceRowsMerged, consolidatedRowsProduced, subThresholdDropped, subThresholdDetails };
}

// ─── Step 5: Write Back (UPDATE by ID — never insert/delete) ────────────────

async function writeResults(
  rows: ProcessedRow[],
  _season: number,
): Promise<{ written: number; logRows: number; errors: string[] }> {
  const errors: string[] = [];
  let written = 0;
  let logRows = 0;
  const BATCH = 50;

  // Batch UPDATE: group ALL rows by rstr_pitch_class and bulk update IDs.
  // For the small number of consolidated/special rows, do a second pass.
  const classGroups = new Map<string, string[]>();
  for (const r of rows) {
    if (!classGroups.has(r.rstr_pitch_class)) classGroups.set(r.rstr_pitch_class, []);
    classGroups.get(r.rstr_pitch_class)!.push(r.id);
  }

  for (const [cls, ids] of classGroups) {
    for (let i = 0; i < ids.length; i += 500) {
      const batch = ids.slice(i, i + 500);
      const { error } = await (supabase as any)
        .from("pitcher_stuff_plus_inputs")
        .update({ rstr_pitch_class: cls, needs_review: false, p_consolidated: false })
        .in("id", batch);

      if (error) {
        errors.push(`Bulk update ${cls}: ${error.message}`);
      } else {
        written += batch.length;
      }
    }
  }

  // Second pass: flag needs_review rows (much smaller set)
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

  // Third pass: update consolidated rows' metric values (very small set)
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
      ? `consolidated ${r.p_consolidated_count} rows [${r.source_tags.join(", ")}]`
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
  // No reset needed — the UPDATE step overwrites rstr_pitch_class on every row.
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
  // Group by (source_player_id, pitch_type, hand, pitches, ivb, hb) and keep one.
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

  // Fetch in batches of 100 to avoid URL length limits
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

  // ── Step 2: Filter ─────────────────────────────────────────────────────
  const { surviving, filter1Dropped, filter2Dropped } = applyFilters(rawRows, nameMap);

  // ── Step 3: Reclassify ─────────────────────────────────────────────────
  const classified = surviving.map((row) => {
    const rstr_pitch_class = reclassify(row);
    const _zeroMovementFlag = row.ivb === 0 && row.hb === 0;
    return { ...row, rstr_pitch_class, _zeroMovementFlag };
  });

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

  // ── Step 4: Consolidation ──────────────────────────────────────────────
  const {
    outputRows,
    twoPitchPlayers,
    sourceRowsMerged,
    consolidatedRowsProduced,
    subThresholdDropped,
  } = consolidate(classified, nameMap);

  // ── Step 5: Write back ─────────────────────────────────────────────────
  const writeResult = await writeResults(outputRows, season);
  errors.push(...writeResult.errors);

  // ── Step 6: Build report ───────────────────────────────────────────────
  const report: ReclassificationReport = {
    totalPulled: rawRows.length,
    filter1Dropped,
    filter2Dropped,
    survivingIntoReclassification: surviving.length,
    reclassificationCounts,
    tagMovements,
    consolidationCount: consolidatedRowsProduced,
    sourceRowsMerged,
    consolidatedRowsProduced,
    twoPitchPlayers,
    subThresholdDropped,
    needsReview: outputRows.filter((r) => r.needs_review),
    totalWritten: writeResult.written,
    logRowsWritten: writeResult.logRows,
    allPitchTypes,
  };

  return { report, errors };
}

function emptyReport(): ReclassificationReport {
  return {
    totalPulled: 0,
    filter1Dropped: [],
    filter2Dropped: [],
    survivingIntoReclassification: 0,
    reclassificationCounts: {},
    tagMovements: [],
    consolidationCount: 0,
    sourceRowsMerged: 0,
    consolidatedRowsProduced: 0,
    twoPitchPlayers: [],
    subThresholdDropped: 0,
    needsReview: [],
    totalWritten: 0,
    logRowsWritten: 0,
    allPitchTypes: [],
  };
}
