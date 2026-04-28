import { supabase } from "@/integrations/supabase/client";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PopConstants {
  pitch_type: string;
  hand: string;
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
  vaa: number | null;
  vaa_sd: number | null;
  velo_diff: number | null;
  velo_diff_sd: number | null;
}

export interface PitchRow {
  id: string;
  source_player_id: string;
  pitch_type: string;
  hand: string;
  pitches: number | null;
  velocity: number | null;
  ivb: number | null;
  hb: number | null;
  rel_height: number | null;
  rel_side: number | null;
  extension: number | null;
  spin: number | null;
  fb_ch_velo_diff: number | null;
  needs_review: boolean | null;
}

interface ZScores {
  z_velocity: number;
  z_ivb: number;
  z_hb: number;
  z_rel_height: number;
  z_rel_side: number;
  z_extension: number;
  z_spin: number;
  z_velo_diff?: number;
}

interface ScoredRow {
  id: string;
  source_player_id: string;
  pitch_type: string;
  hand: string;
  pitches: number;
  stuff_plus: number;
  zScores: ZScores;
  needs_review: boolean;
  review_note: string | null;
}

export interface StuffPlusReport {
  totalProcessed: number;
  dropped: { reason: string; count: number }[];
  byPitchType: Array<{
    pitch_type: string;
    hand: string;
    count: number;
    mean: number;
    sd: number;
    min: number;
    max: number;
    above110: number;
    above120: number;
    below90: number;
    below80: number;
    flagged: number;
  }>;
  overallCount: number;
  singlePitchCount: number;
  top20: Array<{
    source_player_id: string;
    name: string;
    team: string;
    hand: string;
    overall: number;
    pitchScores: Array<{ pitch_type: string; stuff_plus: number; pitches: number }>;
  }>;
  calibrationWarnings: string[];
  written: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function z(player: number | null, avg: number | null, sd: number | null): number | null {
  if (player == null || avg == null || sd == null || sd === 0) return null;
  return (player - avg) / sd;
}

function zAbs(player: number | null, avg: number | null, sd: number | null): number | null {
  if (player == null || avg == null || sd == null || sd === 0) return null;
  return Math.abs(player - avg) / sd;
}

function zMax(player: number | null, avg: number | null, sd: number | null): number | null {
  if (player == null || avg == null || sd == null || sd === 0) return null;
  return (Math.max(player, avg) - avg) / sd;
}

function zDistFromZero(player: number | null, sd: number | null): number | null {
  if (player == null || sd == null || sd === 0) return null;
  return Math.abs(0 - player) / sd;
}

// ─── Pitch Equations ────────────────────────────────────────────────────────

function calc4SFB(row: PitchRow, pop: PopConstants): { score: number; zs: ZScores } {
  const zv = z(row.velocity, pop.velocity, pop.velocity_sd) ?? 0;
  const zi = z(row.ivb, pop.ivb, pop.ivb_sd) ?? 0;
  const zh = zAbs(row.hb, pop.hb, pop.hb_sd) ?? 0;
  const zrh = zAbs(row.rel_height, pop.rel_height, pop.rel_height_sd) ?? 0;
  const zrs = zAbs(row.rel_side, pop.rel_side, pop.rel_side_sd) ?? 0;
  const ze = z(row.extension, pop.extension, pop.extension_sd) ?? 0;
  const zsp = z(row.spin, pop.spin, pop.spin_sd) ?? 0;

  const weighted = 0.3 * zv + 0.25 * zi + 0.15 * zh + 0.1 * zrh + 0.05 * zrs + 0.1 * ze + 0.05 * zsp;
  return {
    score: 100 + weighted * 20,
    zs: { z_velocity: zv, z_ivb: zi, z_hb: zh, z_rel_height: zrh, z_rel_side: zrs, z_extension: ze, z_spin: zsp },
  };
}

function calcSinker(row: PitchRow, pop: PopConstants, hand: string): { score: number; zs: ZScores } {
  const zv = z(row.velocity, pop.velocity, pop.velocity_sd) ?? 0;
  const zi = z(row.ivb, pop.ivb, pop.ivb_sd) ?? 0;   // negated below
  const zh = z(row.hb, pop.hb, pop.hb_sd) ?? 0;
  const zrh = zAbs(row.rel_height, pop.rel_height, pop.rel_height_sd) ?? 0;
  const zrs = zAbs(row.rel_side, pop.rel_side, pop.rel_side_sd) ?? 0;
  const ze = z(row.extension, pop.extension, pop.extension_sd) ?? 0;

  const hbSign = hand === "L" ? -1 : 1;
  const weighted = 0.3 * zv + (-0.2) * zi + hbSign * 0.3 * zh + 0.05 * zrh + 0.05 * zrs + 0.1 * ze;
  return {
    score: 100 + weighted * 20,
    zs: { z_velocity: zv, z_ivb: zi, z_hb: zh, z_rel_height: zrh, z_rel_side: zrs, z_extension: ze, z_spin: 0 },
  };
}

function calcCutter(row: PitchRow, pop: PopConstants, hand: string): { score: number; zs: ZScores } {
  // MAX floor on velocity — below avg contributes zero
  const zv = zMax(row.velocity, pop.velocity, pop.velocity_sd) ?? 0;
  const zi = zAbs(row.ivb, pop.ivb, pop.ivb_sd) ?? 0;
  const zh = z(row.hb, pop.hb, pop.hb_sd) ?? 0;
  const zrh = zAbs(row.rel_height, pop.rel_height, pop.rel_height_sd) ?? 0;
  const zrs = zAbs(row.rel_side, pop.rel_side, pop.rel_side_sd) ?? 0;
  const ze = z(row.extension, pop.extension, pop.extension_sd) ?? 0;
  const zsp = z(row.spin, pop.spin, pop.spin_sd) ?? 0;

  const hbSign = hand === "L" ? 1 : -1;
  const weighted = 0.3 * zv + 0.15 * zi + hbSign * 0.25 * zh + 0.05 * zrh + 0.05 * zrs + 0.1 * ze + 0.1 * zsp;
  return {
    score: 100 + weighted * 20,
    zs: { z_velocity: zv, z_ivb: zi, z_hb: zh, z_rel_height: zrh, z_rel_side: zrs, z_extension: ze, z_spin: zsp },
  };
}

function calcGyroSlider(row: PitchRow, pop: PopConstants): { score: number; zs: ZScores } {
  // Velocity: MAX floor — below avg contributes zero
  const zv = zMax(row.velocity, pop.velocity, pop.velocity_sd) ?? 0;
  // IVB: proximity to zero rewarded — (sd - |0 - ivb|) / sd
  const zi = (pop.ivb_sd && row.ivb != null) ? (pop.ivb_sd - Math.abs(0 - row.ivb)) / pop.ivb_sd : 0;
  // HB: proximity to zero rewarded — (sd - |0 - hb|) / sd
  const zh = (pop.hb_sd && row.hb != null) ? (pop.hb_sd - Math.abs(0 - row.hb)) / pop.hb_sd : 0;
  const zrh = zAbs(row.rel_height, pop.rel_height, pop.rel_height_sd) ?? 0;
  const zrs = zAbs(row.rel_side, pop.rel_side, pop.rel_side_sd) ?? 0;
  const ze = z(row.extension, pop.extension, pop.extension_sd) ?? 0;

  // Weights: 40 + 15 + 25 + 5 + 5 + 10 = 100%
  const weighted = 0.40 * zv + 0.15 * zi + 0.25 * zh + 0.05 * zrh + 0.05 * zrs + 0.10 * ze;
  return {
    score: 100 + weighted * 20,
    zs: { z_velocity: zv, z_ivb: zi, z_hb: zh, z_rel_height: zrh, z_rel_side: zrs, z_extension: ze, z_spin: 0 },
  };
}

function calcSlider(row: PitchRow, pop: PopConstants, hand: string): { score: number; zs: ZScores } {
  const zv = zMax(row.velocity, pop.velocity, pop.velocity_sd) ?? 0;
  // IVB: avg - player (more depth = positive)
  const ziRaw = z(row.ivb, pop.ivb, pop.ivb_sd) ?? 0;
  const zi = -ziRaw; // (avg - player) / sd = -(player - avg) / sd
  const zh = z(row.hb, pop.hb, pop.hb_sd) ?? 0;
  const zrh = zAbs(row.rel_height, pop.rel_height, pop.rel_height_sd) ?? 0;
  const zrs = zAbs(row.rel_side, pop.rel_side, pop.rel_side_sd) ?? 0;
  const ze = z(row.extension, pop.extension, pop.extension_sd) ?? 0;
  const zsp = z(row.spin, pop.spin, pop.spin_sd) ?? 0;

  const hbSign = hand === "L" ? 1 : -1;
  const weighted = 0.15 * zv + 0.1 * zi + hbSign * 0.35 * zh + 0.05 * zrh + 0.05 * zrs + 0.1 * ze + 0.2 * zsp;
  return {
    score: 100 + weighted * 20,
    zs: { z_velocity: zv, z_ivb: zi, z_hb: zh, z_rel_height: zrh, z_rel_side: zrs, z_extension: ze, z_spin: zsp },
  };
}

function calcSweeper(row: PitchRow, pop: PopConstants, hand: string): { score: number; zs: ZScores } {
  const zv = zMax(row.velocity, pop.velocity, pop.velocity_sd) ?? 0;
  const zi = z(row.ivb, pop.ivb, pop.ivb_sd) ?? 0;   // negated below
  const zh = z(row.hb, pop.hb, pop.hb_sd) ?? 0;
  const zrh = zAbs(row.rel_height, pop.rel_height, pop.rel_height_sd) ?? 0;
  const zrs = zAbs(row.rel_side, pop.rel_side, pop.rel_side_sd) ?? 0;
  const ze = z(row.extension, pop.extension, pop.extension_sd) ?? 0;
  const zsp = z(row.spin, pop.spin, pop.spin_sd) ?? 0;

  const hbSign = hand === "L" ? 1 : -1;
  const weighted = 0.1 * zv + (-0.1) * zi + hbSign * 0.4 * zh + 0.05 * zrh + 0.05 * zrs + 0.1 * ze + 0.2 * zsp;
  return {
    score: 100 + weighted * 20,
    zs: { z_velocity: zv, z_ivb: zi, z_hb: zh, z_rel_height: zrh, z_rel_side: zrs, z_extension: ze, z_spin: zsp },
  };
}

function calcCurveball(row: PitchRow, pop: PopConstants, hand: string): { score: number; zs: ZScores } {
  const zv = zMax(row.velocity, pop.velocity, pop.velocity_sd) ?? 0;
  const zi = z(row.ivb, pop.ivb, pop.ivb_sd) ?? 0;   // negated below
  const zh = z(row.hb, pop.hb, pop.hb_sd) ?? 0;
  const zrh = zAbs(row.rel_height, pop.rel_height, pop.rel_height_sd) ?? 0;
  const zrs = zAbs(row.rel_side, pop.rel_side, pop.rel_side_sd) ?? 0;
  const ze = z(row.extension, pop.extension, pop.extension_sd) ?? 0;
  const zsp = z(row.spin, pop.spin, pop.spin_sd) ?? 0;

  const hbSign = hand === "L" ? 1 : -1;
  const weighted = 0.1 * zv + (-0.3) * zi + hbSign * (-0.15) * zh + 0.05 * zrh + 0.05 * zrs + 0.1 * ze + 0.25 * zsp;
  return {
    score: 100 + weighted * 20,
    zs: { z_velocity: zv, z_ivb: zi, z_hb: zh, z_rel_height: zrh, z_rel_side: zrs, z_extension: ze, z_spin: zsp },
  };
}

function calcChangeup(row: PitchRow, pop: PopConstants, hand: string): { score: number; zs: ZScores } {
  const zvd = z(row.fb_ch_velo_diff, pop.velo_diff, pop.velo_diff_sd) ?? 0;
  const zi = z(row.ivb, pop.ivb, pop.ivb_sd) ?? 0;   // negated below
  const zh = z(row.hb, pop.hb, pop.hb_sd) ?? 0;
  const zrh = zAbs(row.rel_height, pop.rel_height, pop.rel_height_sd) ?? 0;
  const zrs = zAbs(row.rel_side, pop.rel_side, pop.rel_side_sd) ?? 0;
  const ze = z(row.extension, pop.extension, pop.extension_sd) ?? 0;
  const zsp = zAbs(row.spin, pop.spin, pop.spin_sd) ?? 0;  // ABS for changeup spin

  const hbSign = hand === "L" ? -1 : 1;
  const weighted = 0.15 * zvd + (-0.2) * zi + hbSign * 0.35 * zh + 0.05 * zrh + 0.05 * zrs + 0.1 * ze + 0.1 * zsp;
  return {
    score: 100 + weighted * 20,
    zs: { z_velocity: 0, z_ivb: zi, z_hb: zh, z_rel_height: zrh, z_rel_side: zrs, z_extension: ze, z_spin: zsp, z_velo_diff: zvd },
  };
}

function calcSplitter(row: PitchRow, pop: PopConstants, hand: string): { score: number; zs: ZScores } {
  const zv = zMax(row.velocity, pop.velocity, pop.velocity_sd) ?? 0;
  const zi = z(row.ivb, pop.ivb, pop.ivb_sd) ?? 0;   // negated below
  const zh = z(row.hb, pop.hb, pop.hb_sd) ?? 0;
  const zrh = zAbs(row.rel_height, pop.rel_height, pop.rel_height_sd) ?? 0;
  const zrs = zAbs(row.rel_side, pop.rel_side, pop.rel_side_sd) ?? 0;
  const ze = z(row.extension, pop.extension, pop.extension_sd) ?? 0;
  // Spin: (avg - player) / sd = less spin is better
  const zspRaw = z(row.spin, pop.spin, pop.spin_sd) ?? 0;
  const zsp = -zspRaw;

  const hbSign = hand === "L" ? -1 : 1;
  const weighted = 0.1 * zv + (-0.2) * zi + hbSign * 0.25 * zh + 0.05 * zrh + 0.05 * zrs + 0.1 * ze + 0.25 * zsp;
  return {
    score: 100 + weighted * 20,
    zs: { z_velocity: zv, z_ivb: zi, z_hb: zh, z_rel_height: zrh, z_rel_side: zrs, z_extension: ze, z_spin: zsp },
  };
}

// ─── Equation Router ────────────────────────────────────────────────────────

export function calculateStuffPlus(
  pitchType: string,
  row: PitchRow,
  pop: PopConstants,
): { score: number; zs: ZScores } | null {
  switch (pitchType) {
    case "4S FB":        return calc4SFB(row, pop);
    case "Sinker":       return calcSinker(row, pop, row.hand);
    case "Cutter":       return calcCutter(row, pop, row.hand);
    case "Gyro Slider":  return calcGyroSlider(row, pop);
    case "Slider":       return calcSlider(row, pop, row.hand);
    case "Sweeper":      return calcSweeper(row, pop, row.hand);
    case "Curveball":    return calcCurveball(row, pop, row.hand);
    case "Change-up":    return calcChangeup(row, pop, row.hand);
    case "Splitter":     return calcSplitter(row, pop, row.hand);
    default:             return null;
  }
}

// ─── Paginated fetch ────────────────────────────────────────────────────────

async function fetchAll<T>(
  table: string,
  select: string,
  filters: (q: any) => any,
): Promise<T[]> {
  const PAGE = 1000;
  const all: T[] = [];
  let offset = 0;
  while (true) {
    let q = (supabase as any).from(table).select(select).range(offset, offset + PAGE - 1);
    q = filters(q);
    const { data, error } = await q;
    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// ─── Main Pipeline ──────────────────────────────────────────────────────────

const ALL_PITCH_TYPES = ["4S FB", "Sinker", "Cutter", "Gyro Slider", "Slider", "Sweeper", "Curveball", "Change-up", "Splitter"];

export async function runStuffPlusPipeline(
  season: number = 2026,
): Promise<{ report: StuffPlusReport; errors: string[] }> {
  const errors: string[] = [];
  console.time("[Stuff+] TOTAL");

  // ── Pull population constants ──────────────────────────────────────────
  console.time("[Stuff+] 1. fetch population constants");
  const { data: popData, error: popErr } = await (supabase as any)
    .from("pitcher_stuff_plus_ncaa")
    .select("*")
    .eq("season", season);
  console.timeEnd("[Stuff+] 1. fetch population constants");

  if (popErr || !popData) {
    return { report: emptyReport(), errors: [`Failed to pull population constants: ${popErr?.message}`] };
  }

  const popMap = new Map<string, PopConstants>();
  for (const p of popData as PopConstants[]) {
    popMap.set(`${p.pitch_type}::${p.hand}`, p);
  }

  // ── Pull all pitch rows ────────────────────────────────────────────────
  console.time("[Stuff+] 2. fetch pitch rows");
  const allRows = await fetchAll<PitchRow>(
    "pitcher_stuff_plus_inputs",
    "id, source_player_id, pitch_type, hand, pitches, velocity, ivb, hb, rel_height, rel_side, extension, spin, fb_ch_velo_diff, needs_review",
    (q: any) => q.eq("season", season).in("pitch_type", ALL_PITCH_TYPES),
  );
  console.timeEnd("[Stuff+] 2. fetch pitch rows");

  // ── Pull player names ──────────────────────────────────────────────────
  console.time("[Stuff+] 3. fetch player names");
  const playerIds = [...new Set(allRows.map((r) => r.source_player_id))];
  const nameMap = new Map<string, { name: string; team: string }>();
  for (let i = 0; i < playerIds.length; i += 100) {
    const batch = playerIds.slice(i, i + 100);
    const { data } = await (supabase as any)
      .from("Pitching Master")
      .select("source_player_id, playerFullName, Team")
      .in("source_player_id", batch)
      .eq("Season", season);
    for (const p of data || []) {
      if (p.source_player_id) {
        nameMap.set(p.source_player_id, { name: p.playerFullName ?? p.source_player_id, team: p.Team ?? "—" });
      }
    }
  }
  console.timeEnd("[Stuff+] 3. fetch player names");

  // ── Filter and score ───────────────────────────────────────────────────
  console.time("[Stuff+] 4. filter + score (compute)");
  const dropped: Map<string, number> = new Map();
  const scored: ScoredRow[] = [];

  function addDrop(reason: string) {
    dropped.set(reason, (dropped.get(reason) ?? 0) + 1);
  }

  for (const row of allRows) {
    // Data quality filters
    if (row.ivb == null || row.hb == null) { addDrop("Missing IVB or HB"); continue; }
    if (row.ivb === 0 && row.hb === 0 && (row.pitches ?? 0) < 5) { addDrop("Zero movement + P < 5"); continue; }
    if ((row.pitches ?? 0) < 5) { addDrop("P < 5"); continue; }

    const popKey = `${row.pitch_type}::${row.hand}`;
    const pop = popMap.get(popKey);
    if (!pop) { addDrop(`No population constants for ${popKey}`); continue; }

    const result = calculateStuffPlus(row.pitch_type, row, pop);
    if (!result) { addDrop(`Unknown pitch type: ${row.pitch_type}`); continue; }

    const score = Math.round(result.score * 10) / 10;
    let needsReview = row.needs_review ?? false;
    let reviewNote: string | null = null;

    if (score > 140 || score < 60) {
      needsReview = true;
      reviewNote = `Outlier Stuff+ score: ${score}`;
    }

    scored.push({
      id: row.id,
      source_player_id: row.source_player_id,
      pitch_type: row.pitch_type,
      hand: row.hand,
      pitches: row.pitches ?? 0,
      stuff_plus: score,
      zScores: result.zs,
      needs_review: needsReview,
      review_note: reviewNote,
    });
  }

  console.timeEnd("[Stuff+] 4. filter + score (compute)");

  // ── Per-pitch-type recentering: shift each (pitch_type × hand) bucket
  // so its un-weighted per-pitcher mean lands at 100. Un-weighted = average
  // PITCHER scores 100 (vs pitch-weighted = average PITCH scores 100). Better
  // matches "what 100 means for the season's sample set" — pitch-weighted
  // double-counts high-volume pitchers who tend to be the better ones.
  console.time("[Stuff+] 4b. recenter to mean=100 (per-pitcher)");
  const calibBuckets = new Map<string, { sum: number; count: number }>();
  for (const s of scored) {
    if (s.review_note?.startsWith("Outlier")) continue;
    const key = `${s.pitch_type}::${s.hand}`;
    if (!calibBuckets.has(key)) calibBuckets.set(key, { sum: 0, count: 0 });
    const b = calibBuckets.get(key)!;
    b.sum += s.stuff_plus;
    b.count += 1;
  }
  const shifts = new Map<string, number>();
  for (const [key, b] of calibBuckets) {
    if (b.count === 0) continue;
    shifts.set(key, b.sum / b.count - 100);
  }
  for (const s of scored) {
    const key = `${s.pitch_type}::${s.hand}`;
    const shift = shifts.get(key);
    if (shift == null) continue;
    s.stuff_plus = Math.round((s.stuff_plus - shift) * 10) / 10;
    if (s.stuff_plus > 140 || s.stuff_plus < 60) {
      s.needs_review = true;
      s.review_note = `Outlier Stuff+ score: ${s.stuff_plus}`;
    }
  }
  console.log(
    `[Stuff+] Recenter shifts (μ_pop − 100):`,
    [...shifts.entries()].map(([k, v]) => `${k}=${v.toFixed(2)}`).join(" | "),
  );
  console.timeEnd("[Stuff+] 4b. recenter to mean=100");

  // ── Write stuff_plus scores back in batches ────────────────────────────
  console.time("[Stuff+] 5. write per-pitch scores");
  let written = 0;

  // Group by rounded score for efficient batch updates
  const scoreGroups = new Map<number, string[]>();
  for (const s of scored) {
    const key = s.stuff_plus;
    if (!scoreGroups.has(key)) scoreGroups.set(key, []);
    scoreGroups.get(key)!.push(s.id);
  }

  for (const [score, ids] of scoreGroups) {
    for (let i = 0; i < ids.length; i += 500) {
      const batch = ids.slice(i, i + 500);
      const { error } = await (supabase as any)
        .from("pitcher_stuff_plus_inputs")
        .update({ stuff_plus: score })
        .in("id", batch);

      if (error) errors.push(`Update stuff_plus batch: ${error.message}`);
      else written += batch.length;
    }
  }

  console.timeEnd("[Stuff+] 5. write per-pitch scores");

  // Flag outliers
  console.time("[Stuff+] 6. flag outliers");
  const outlierIds = scored.filter((s) => s.needs_review && s.review_note).map((s) => s.id);
  if (outlierIds.length > 0) {
    for (let i = 0; i < outlierIds.length; i += 500) {
      const batch = outlierIds.slice(i, i + 500);
      await (supabase as any)
        .from("pitcher_stuff_plus_inputs")
        .update({ needs_review: true })
        .in("id", batch);
    }
  }
  console.timeEnd("[Stuff+] 6. flag outliers");

  // ── Overall Composite Stuff+ ───────────────────────────────────────────
  console.time("[Stuff+] 7. compute overall composite");
  const playerScores = new Map<string, ScoredRow[]>();
  for (const s of scored) {
    if (!playerScores.has(s.source_player_id)) playerScores.set(s.source_player_id, []);
    playerScores.get(s.source_player_id)!.push(s);
  }

  const overallResults: Array<{
    source_player_id: string;
    hand: string;
    overall: number;
    totalPitches: number;
    pitchTypes: string[];
    pitchScores: Array<{ pitch_type: string; stuff_plus: number; pitches: number }>;
  }> = [];

  let singlePitchCount = 0;

  for (const [pid, rows] of playerScores) {
    const valid = rows.filter((r) => !r.needs_review || r.review_note?.startsWith("Outlier"));
    if (valid.length === 0) continue;

    const totalP = valid.reduce((s, r) => s + r.pitches, 0);
    if (totalP === 0) continue;

    const overall = valid.reduce((s, r) => s + r.stuff_plus * r.pitches, 0) / totalP;
    const rounded = Math.round(overall * 10) / 10;

    if (valid.length < 2) singlePitchCount++;

    overallResults.push({
      source_player_id: pid,
      hand: valid[0].hand,
      overall: rounded,
      totalPitches: totalP,
      pitchTypes: valid.map((r) => r.pitch_type),
      pitchScores: valid.map((r) => ({ pitch_type: r.pitch_type, stuff_plus: r.stuff_plus, pitches: r.pitches })),
    });
  }

  console.timeEnd("[Stuff+] 7. compute overall composite");

  // ── Write overall Stuff+ to Pitching Master (for RSTR IQ) ──────────────
  // Group by rounded overall score for batch updates
  console.time("[Stuff+] 8. write overall to Pitching Master");
  const overallGroups = new Map<number, string[]>();
  for (const o of overallResults) {
    if (!overallGroups.has(o.overall)) overallGroups.set(o.overall, []);
    overallGroups.get(o.overall)!.push(o.source_player_id);
  }

  for (const [score, pids] of overallGroups) {
    for (let i = 0; i < pids.length; i += 500) {
      const batch = pids.slice(i, i + 500);
      const { error } = await (supabase as any)
        .from("Pitching Master")
        .update({ stuff_plus: score })
        .in("source_player_id", batch)
        .eq("Season", season);

      if (error) errors.push(`Pitching Master update: ${error.message}`);
    }
  }
  console.timeEnd("[Stuff+] 8. write overall to Pitching Master");

  // ── Build report ───────────────────────────────────────────────────────
  console.time("[Stuff+] 9. build report");
  const byPitchType: StuffPlusReport["byPitchType"] = [];
  const calibrationWarnings: string[] = [];

  // Group scored rows by pitch_type + hand
  const ptGroups = new Map<string, ScoredRow[]>();
  for (const s of scored) {
    const key = `${s.pitch_type}::${s.hand}`;
    if (!ptGroups.has(key)) ptGroups.set(key, []);
    ptGroups.get(key)!.push(s);
  }

  for (const [key, rows] of ptGroups) {
    const [pt, hand] = key.split("::");
    const scores = rows.map((r) => r.stuff_plus);
    const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
    const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length;
    const sd = Math.sqrt(variance);

    if (Math.abs(mean - 100) > 2) {
      calibrationWarnings.push(`${hand === "R" ? "RHP" : "LHP"} ${pt}: mean=${mean.toFixed(1)} (${(mean - 100).toFixed(1)} off center)`);
    }

    byPitchType.push({
      pitch_type: pt,
      hand,
      count: rows.length,
      mean: Math.round(mean * 10) / 10,
      sd: Math.round(sd * 10) / 10,
      min: Math.round(Math.min(...scores) * 10) / 10,
      max: Math.round(Math.max(...scores) * 10) / 10,
      above110: scores.filter((s) => s > 110).length,
      above120: scores.filter((s) => s > 120).length,
      below90: scores.filter((s) => s < 90).length,
      below80: scores.filter((s) => s < 80).length,
      flagged: rows.filter((r) => r.needs_review).length,
    });
  }

  // Top 20 overall
  overallResults.sort((a, b) => b.overall - a.overall);
  const top20 = overallResults.slice(0, 20).map((o) => {
    const info = nameMap.get(o.source_player_id) ?? { name: o.source_player_id, team: "—" };
    return {
      source_player_id: o.source_player_id,
      name: info.name,
      team: info.team,
      hand: o.hand,
      overall: o.overall,
      pitchScores: o.pitchScores,
    };
  });

  console.timeEnd("[Stuff+] 9. build report");
  console.timeEnd("[Stuff+] TOTAL");

  return {
    report: {
      totalProcessed: scored.length,
      dropped: [...dropped.entries()].map(([reason, count]) => ({ reason, count })),
      byPitchType,
      overallCount: overallResults.length,
      singlePitchCount,
      top20,
      calibrationWarnings,
      written,
    },
    errors,
  };
}

function emptyReport(): StuffPlusReport {
  return {
    totalProcessed: 0,
    dropped: [],
    byPitchType: [],
    overallCount: 0,
    singlePitchCount: 0,
    top20: [],
    calibrationWarnings: [],
    written: 0,
  };
}
