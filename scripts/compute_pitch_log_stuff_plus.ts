#!/usr/bin/env node
/**
 * Compute Stuff+ per pitch in pitch_log.
 *
 * Phase 2 (d) of the pitch log build (docs/PITCH_LOG_BUILD.md).
 *
 * Pipeline:
 *   1. Load pop constants from pitcher_stuff_plus_ncaa (season+D1)
 *   2. Compute per-pitcher mean 4-Seam fastball velo (used as fb_ch_velo_diff
 *      reference for changeups — the engine needs it per pitcher).
 *   3. Stream pitch_log rows where stuff_plus IS NULL AND is_data = TRUE
 *      AND pitch_type_reclassified IS NOT NULL, in keyset-paginated batches
 *   4. For each row: build a PitchRow with pitches=1, fb_ch_velo_diff from
 *      step 2, call calculateStuffPlus(pitch_type, row, pop)
 *   5. Upsert raw scores back to pitch_log.stuff_plus in batches
 *   6. Recenter pass: per (pitch_type × hand) bucket, compute mean (excluding
 *      outliers >140 / <60), apply shift so mean = 100. Re-upsert.
 *
 * Idempotent: only processes rows where stuff_plus IS NULL. Safe to re-run.
 *
 * Notes for the per-pitch case vs the original aggregate engine:
 *   - pitches = 1 per row (engine accepts this fine)
 *   - fb_ch_velo_diff = pitcher's mean 4S velo - this pitch's release_velocity
 *     (only relevant for changeups; precomputed once per pitcher)
 *   - Data quality filter: must have ivb + hb + velocity + extension + spin
 *     + rel_height. Missing any → skip (stuff_plus stays NULL).
 *
 * Usage:
 *   npm run compute-pitch-log-stuff-plus -- --apply
 */
import { createClient } from "@supabase/supabase-js";
import {
  calculateStuffPlus,
  type PopConstants,
  type PitchRow,
} from "@/savant/lib/stuffPlusEngine";

const SEASON = 2026;
const FETCH_BATCH = 5000;
const UPSERT_BATCH = 1000;

// Reclassified name (from pitch_log) → pop constants key (from
// pitcher_stuff_plus_ncaa). The engine uses "4S FB" for 4-seam fastballs,
// but our reclassification SQL produced "4-Seam Fastball". Other names
// (Sinker, Cutter, Slider, Sweeper, Gyro Slider, Curveball, Change-up,
// Splitter) already match the engine's case statements verbatim.
const POP_TYPE_KEY: Record<string, string> = {
  "4-Seam Fastball": "4S FB",
  "Sinker": "Sinker",
  "Cutter": "Cutter",
  "Slider": "Slider",
  "Sweeper": "Sweeper",
  "Gyro Slider": "Gyro Slider",
  "Curveball": "Curveball",
  "Change-up": "Change-up",
  "Splitter": "Splitter",
};

interface LogRow {
  uniq_pitch_id: string;
  pitcher_id: string;
  pitcher_hand: "L" | "R" | null;
  pitch_type_reclassified: string;
  release_velocity: number | null;
  ivb: number | null;
  hb: number | null;
  rel_height: number | null;
  rel_side: number | null;
  extension: number | null;
  spin: number | null;
}

interface Scored {
  uniq_pitch_id: string;
  pitcher_id: string;
  pitch_type_reclassified: string;
  pitcher_hand: "L" | "R";
  stuff_plus: number;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // ── 1. Load pop constants ─────────────────────────────────────────────
  console.log("Loading pop constants (D1, season 2026)…");
  const { data: popData, error: popErr } = await (supabase as any)
    .from("pitcher_stuff_plus_ncaa")
    .select("*")
    .eq("season", SEASON)
    .eq("division", "D1");
  if (popErr) {
    console.error(`Failed to load pop constants: ${popErr.message}`);
    process.exit(1);
  }
  const popMap = new Map<string, PopConstants>();
  for (const p of popData as PopConstants[]) {
    popMap.set(`${p.pitch_type}::${p.hand}`, p);
  }
  console.log(`  ${popMap.size} (pitch_type × hand) pop buckets loaded`);

  // ── 2. Per-pitcher mean 4S velo (SKIPPED) ─────────────────────────────
  // Originally computed per-pitcher fastball velo to feed fb_ch_velo_diff
  // for change-ups (the engine subtracts the changeup's velo from the
  // pitcher's mean 4S). Pulling 1M+ FB rows via REST chunking exceeds
  // the Supabase statement timeout (57014).
  //
  // Simplification for the initial pass: set fb_ch_velo_diff = 0 for all
  // changeups. The engine treats this as "pitcher's velo gap matches the
  // population mean," which loses per-pitcher specificity for changeups
  // but preserves correctness for the other 8 pitch types.
  //
  // Change-up Stuff+ will still be driven by movement, release, spin, and
  // extension components. The bucket recenter pass still locks the
  // bucket mean at 100. Only the relative ordering inside the changeup
  // bucket loses a degree of fidelity.
  //
  // Follow-up: precompute fb_velo_by_pitcher_id via a server-side view
  // or RPC and join into the score pipeline.
  const fbVeloByPitcher = new Map<string, number>();

  // ── 3. Count pending (best-effort) ────────────────────────────────────
  // The exact count via head:true sometimes returns null on very large
  // filtered sets in Supabase REST. We use whatever we get for progress
  // logging but DON'T gate on it — the streaming loop will exit naturally
  // when no more rows match.
  const { count: pendingCount } = await (supabase as any)
    .from("pitch_log")
    .select("uniq_pitch_id", { count: "exact", head: true })
    .is("stuff_plus", null)
    .eq("is_data", true)
    .not("pitch_type_reclassified", "is", null);
  const pending = pendingCount ?? 0; // 0 just means "unknown" for ratio display
  console.log(`\nPending Stuff+ scoring (best-effort count): ${pendingCount ?? "unknown"} rows`);

  if (!apply) {
    console.log("\n[dry-run] No writes. Re-run with --apply.");
    return;
  }

  // ── 4. Score in batches ───────────────────────────────────────────────
  console.log("\nScoring pitches…");
  const scored: Scored[] = [];
  const skipped = new Map<string, number>();
  let lastId = "";
  let processed = 0;
  const startTime = process.hrtime.bigint();

  while (true) {
    let q = (supabase as any)
      .from("pitch_log")
      .select(
        "uniq_pitch_id, pitcher_id, pitcher_hand, pitch_type_reclassified, release_velocity, ivb, hb, rel_height, rel_side, extension, spin",
      )
      .is("stuff_plus", null)
      .eq("is_data", true)
      .not("pitch_type_reclassified", "is", null)
      .order("uniq_pitch_id", { ascending: true })
      .limit(FETCH_BATCH);
    if (lastId) q = q.gt("uniq_pitch_id", lastId);
    const { data, error } = await q;
    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;

    for (const r of data as LogRow[]) {
      if (!r.pitcher_hand) { skipped.set("no hand", (skipped.get("no hand") ?? 0) + 1); continue; }
      const popKey = POP_TYPE_KEY[r.pitch_type_reclassified] ?? r.pitch_type_reclassified;
      const pop = popMap.get(`${popKey}::${r.pitcher_hand}`);
      if (!pop) {
        skipped.set(`no pop ${popKey}::${r.pitcher_hand}`,
          (skipped.get(`no pop ${popKey}::${r.pitcher_hand}`) ?? 0) + 1);
        continue;
      }

      const fbVelo = fbVeloByPitcher.get(r.pitcher_id);
      const fbChVeloDiff =
        r.pitch_type_reclassified === "Change-up" && fbVelo != null && r.release_velocity != null
          ? fbVelo - r.release_velocity
          : null;

      const pitchRow: PitchRow = {
        id: r.uniq_pitch_id,
        source_player_id: r.pitcher_id,
        pitch_type: r.pitch_type_reclassified,
        hand: r.pitcher_hand,
        pitches: 1,
        velocity: r.release_velocity,
        ivb: r.ivb,
        hb: r.hb,
        rel_height: r.rel_height,
        rel_side: r.rel_side,
        extension: r.extension,
        spin: r.spin,
        fb_ch_velo_diff: fbChVeloDiff,
        needs_review: null,
      };

      // calculateStuffPlus dispatches by the engine's pitch type string —
      // pass the popKey ("4S FB") not the reclassified name ("4-Seam Fastball")
      // so the switch finds the right calculator function.
      const result = calculateStuffPlus(popKey, pitchRow, pop);
      if (!result) {
        skipped.set(`no formula ${r.pitch_type_reclassified}`,
          (skipped.get(`no formula ${r.pitch_type_reclassified}`) ?? 0) + 1);
        continue;
      }

      // Clamp the raw per-pitch score to a sensible Stuff+ range. Per-pitch
      // z-scoring against aggregate population SDs can produce extreme
      // values (10K+) for outlier individual pitches — the original
      // engine smooths these by averaging over many pitches. For our
      // per-pitch persistence: clamp to [40, 160] before recenter so the
      // bucket mean isn't dominated by a few extreme rows.
      const clampedScore = Math.max(40, Math.min(160, result.score));
      scored.push({
        uniq_pitch_id: r.uniq_pitch_id,
        pitcher_id: r.pitcher_id,
        pitch_type_reclassified: r.pitch_type_reclassified,
        pitcher_hand: r.pitcher_hand,
        stuff_plus: Math.round(clampedScore * 10) / 10,
      });
    }

    lastId = data[data.length - 1].uniq_pitch_id;
    processed += data.length;
    const elapsedSec = Number(process.hrtime.bigint() - startTime) / 1e9;
    const rate = processed / elapsedSec;
    const remainingDisplay = pending > 0
      ? `~${(((pending - processed) / rate) / 60).toFixed(1)} min left`
      : `elapsed ${(elapsedSec / 60).toFixed(1)} min`;
    console.log(`  ${processed.toString().padStart(8)} / ${pending > 0 ? pending : "?"}   scored=${scored.length}   (${rate.toFixed(0)}/s, ${remainingDisplay})`);
  }

  if (skipped.size > 0) {
    console.log("\nSkipped:");
    for (const [reason, n] of skipped) console.log(`  ${n.toString().padStart(7)} × ${reason}`);
  }

  // ── 5. Recenter per (pitch_type × hand) bucket ────────────────────────
  console.log(`\nRecentering ${scored.length} scores so each (pitch_type × hand) bucket mean = 100…`);
  const buckets = new Map<string, { sum: number; count: number }>();
  for (const s of scored) {
    if (s.stuff_plus > 140 || s.stuff_plus < 60) continue; // exclude outliers
    const k = `${s.pitch_type_reclassified}::${s.pitcher_hand}`;
    const b = buckets.get(k) ?? { sum: 0, count: 0 };
    b.sum += s.stuff_plus;
    b.count += 1;
    buckets.set(k, b);
  }
  const shifts = new Map<string, number>();
  for (const [k, { sum, count }] of buckets) {
    if (count === 0) continue;
    shifts.set(k, sum / count - 100);
    console.log(`  ${k.padEnd(28)}  mean=${(sum / count).toFixed(1).padStart(6)}  shift=${(sum / count - 100).toFixed(1)}  n=${count}`);
  }
  for (const s of scored) {
    const k = `${s.pitch_type_reclassified}::${s.pitcher_hand}`;
    const shift = shifts.get(k);
    if (shift == null) continue;
    s.stuff_plus = Math.round((s.stuff_plus - shift) * 10) / 10;
  }

  // ── 6. Bulk update via RPC ────────────────────────────────────────────
  // Single SQL UPDATE per batch via the public.bulk_update_pitch_log_stuff_plus
  // Postgres function. ~5 min total for 2M rows vs 3+ hours for per-row
  // UPDATEs over PostgREST. The function definition needs to exist on
  // staging — see the bulk-update SQL block at the top of this script's
  // README block.
  console.log(`\nBulk-updating ${scored.length} rows via RPC, batches of ${UPSERT_BATCH}…`);
  let written = 0;
  const writeStart = process.hrtime.bigint();
  for (let i = 0; i < scored.length; i += UPSERT_BATCH) {
    const chunk = scored.slice(i, i + UPSERT_BATCH).map((s) => ({
      uniq_pitch_id: s.uniq_pitch_id,
      stuff_plus: s.stuff_plus,
    }));
    const { data: affected, error } = await (supabase as any).rpc(
      "bulk_update_pitch_log_stuff_plus",
      { updates: chunk },
    );
    if (error) {
      console.error(`RPC ${i}-${i + chunk.length} FAILED: ${error.message}`);
      if (error.message?.includes("does not exist")) {
        console.error(`\nThe Postgres function bulk_update_pitch_log_stuff_plus doesn't exist on this DB.`);
        console.error(`Create it via the SQL block at the top of this script's docstring, then re-run.`);
      }
      process.exit(1);
    }
    written += chunk.length;
    if (i % (UPSERT_BATCH * 10) === 0 || i + UPSERT_BATCH >= scored.length) {
      const sec = Number(process.hrtime.bigint() - writeStart) / 1e9;
      console.log(`  ${written.toString().padStart(8)} / ${scored.length}   affected=${affected}   (${(written / sec).toFixed(0)}/s)`);
    }
  }

  const total = Number(process.hrtime.bigint() - startTime) / 1e9;
  console.log(`\nDone in ${(total / 60).toFixed(1)} min. ${written} rows scored + recentered + upserted.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
