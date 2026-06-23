#!/usr/bin/env node
/**
 * Build the pitch_log_xba_lookup table from every batted ball in pitch_log.
 *
 * Methodology (matches MLB Statcast):
 *   * 1-mph EV bins, 1-degree LA bins
 *   * Per bucket: count actual outcomes (1B/2B/3B/HR/other-out) and derive
 *     probabilities
 *   * Linear weights for xwOBA (MLB 2023 baseline)
 *
 * Sparsity smoothing:
 *   * Buckets with sample_n < MIN_BUCKET_SIZE get neighbor-averaged
 *     (3×3 window). Smoothed flag set so downstream knows.
 *
 * Idempotent — clears the lookup table and rebuilds.
 *
 * Usage:
 *   npm run build-xba-lookup -- --apply
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const APPLY = process.argv.includes("--apply");

// MLB 2023 linear weights — used for expected_woba per bucket.
const W_1B = 0.882;
const W_2B = 1.254;
const W_3B = 1.586;
const W_HR = 2.041;
const W_OUT = 0;

const MIN_BUCKET_SIZE = 5;

interface Bucket {
  ev_bin: number;
  la_bin: number;
  n: number;
  n_1b: number;
  n_2b: number;
  n_3b: number;
  n_hr: number;
  n_out: number; // anything not 1B/2B/3B/HR among batted-ball-in-play results
}

async function fetchAllBattedBalls(): Promise<Bucket[]> {
  console.log("Scanning pitch_log for batted balls...");
  const buckets = new Map<string, Bucket>();
  // Supabase PostgREST caps default responses at 1000. We page by that size
  // and only stop when an empty page returns.
  const PAGE = 1000;
  let from = 0;
  let total = 0;
  while (true) {
    const { data, error } = await (supabase as any)
      .from("pitch_log")
      .select("exit_velocity, launch_angle, pitch_result_category")
      .eq("is_batted_ball_in_play", true)
      .not("exit_velocity", "is", null)
      .not("launch_angle", "is", null)
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("Query error:", error);
      break;
    }
    if (!data || data.length === 0) break;
    for (const row of data) {
      const ev = Math.floor(row.exit_velocity as number);
      const la = Math.floor(row.launch_angle as number);
      const key = `${ev}_${la}`;
      let b = buckets.get(key);
      if (!b) {
        b = { ev_bin: ev, la_bin: la, n: 0, n_1b: 0, n_2b: 0, n_3b: 0, n_hr: 0, n_out: 0 };
        buckets.set(key, b);
      }
      b.n++;
      const cat = row.pitch_result_category as string;
      if (cat === "Single") b.n_1b++;
      else if (cat === "Double") b.n_2b++;
      else if (cat === "Triple") b.n_3b++;
      else if (cat === "HR") b.n_hr++;
      else b.n_out++;
    }
    total += data.length;
    if (total % 50000 === 0) console.log(`  scanned ${total.toLocaleString()}...`);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`Scanned ${total.toLocaleString()} batted balls into ${buckets.size} buckets.\n`);
  return Array.from(buckets.values());
}

function smooth(rawBuckets: Bucket[]): Array<Bucket & { smoothed: boolean }> {
  // Build EV/LA range to bound the neighbor search
  const byKey = new Map<string, Bucket>();
  for (const b of rawBuckets) byKey.set(`${b.ev_bin}_${b.la_bin}`, b);
  const out: Array<Bucket & { smoothed: boolean }> = [];
  for (const b of rawBuckets) {
    if (b.n >= MIN_BUCKET_SIZE) {
      out.push({ ...b, smoothed: false });
      continue;
    }
    // Combine with up-to-8 neighbors (3x3 window centered on the bucket)
    const merged: Bucket = { ...b };
    for (let dev = -1; dev <= 1; dev++) {
      for (let dla = -1; dla <= 1; dla++) {
        if (dev === 0 && dla === 0) continue;
        const k = `${b.ev_bin + dev}_${b.la_bin + dla}`;
        const nb = byKey.get(k);
        if (!nb) continue;
        merged.n += nb.n;
        merged.n_1b += nb.n_1b;
        merged.n_2b += nb.n_2b;
        merged.n_3b += nb.n_3b;
        merged.n_hr += nb.n_hr;
        merged.n_out += nb.n_out;
      }
    }
    out.push({ ...merged, smoothed: true });
  }
  return out;
}

interface Row {
  ev_bin: number;
  la_bin: number;
  sample_n: number;
  p_1b: number;
  p_2b: number;
  p_3b: number;
  p_hr: number;
  p_hit: number;
  expected_bases: number;
  expected_woba: number;
  smoothed: boolean;
}

function deriveRow(b: Bucket & { smoothed: boolean }): Row {
  const n = b.n;
  const p_1b = n > 0 ? b.n_1b / n : 0;
  const p_2b = n > 0 ? b.n_2b / n : 0;
  const p_3b = n > 0 ? b.n_3b / n : 0;
  const p_hr = n > 0 ? b.n_hr / n : 0;
  const p_hit = p_1b + p_2b + p_3b + p_hr;
  const expected_bases = 1 * p_1b + 2 * p_2b + 3 * p_3b + 4 * p_hr;
  const expected_woba =
    W_1B * p_1b + W_2B * p_2b + W_3B * p_3b + W_HR * p_hr + W_OUT * (1 - p_hit);
  return {
    ev_bin: b.ev_bin,
    la_bin: b.la_bin,
    sample_n: n,
    p_1b: round(p_1b, 4),
    p_2b: round(p_2b, 4),
    p_3b: round(p_3b, 4),
    p_hr: round(p_hr, 4),
    p_hit: round(p_hit, 4),
    expected_bases: round(expected_bases, 4),
    expected_woba: round(expected_woba, 4),
    smoothed: b.smoothed,
  };
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

async function main() {
  console.log("== Building pitch_log_xba_lookup ==\n");
  if (!APPLY) {
    console.log("DRY RUN — pass --apply to actually persist. Scanning anyway for counts...\n");
  }
  const raw = await fetchAllBattedBalls();
  console.log(`Smoothing buckets with n < ${MIN_BUCKET_SIZE}...`);
  const smoothed = smooth(raw);
  const rows = smoothed.map(deriveRow);

  const thin = rows.filter((r) => r.sample_n < MIN_BUCKET_SIZE).length;
  console.log(
    `Built ${rows.length} bucket rows. ${rows.length - thin} dense + ${thin} thin (kept post-smoothing).`,
  );

  // Print 5 sanity-check rows: peak EVs, common LAs.
  console.log("\nSpot-check (highest-sample buckets):");
  rows
    .slice()
    .sort((a, b) => b.sample_n - a.sample_n)
    .slice(0, 5)
    .forEach((r) => {
      console.log(
        `  EV ${r.ev_bin} / LA ${r.la_bin}: n=${r.sample_n}, p_hit=${r.p_hit.toFixed(3)}, p_hr=${r.p_hr.toFixed(3)}, xBases=${r.expected_bases.toFixed(3)}, xwOBA=${r.expected_woba.toFixed(3)}`,
      );
    });

  if (!APPLY) {
    console.log("\n(dry run — skipping write)");
    return;
  }

  console.log("\nClearing existing lookup rows...");
  const { error: delErr } = await (supabase as any)
    .from("pitch_log_xba_lookup")
    .delete()
    .neq("ev_bin", -99999); // delete-all guard
  if (delErr) console.warn("Delete warning:", delErr);

  console.log(`Inserting ${rows.length} rows in batches of 500...`);
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await (supabase as any)
      .from("pitch_log_xba_lookup")
      .insert(chunk);
    if (error) {
      console.error(`Insert error at row ${i}:`, error);
      process.exit(1);
    }
    inserted += chunk.length;
    if (inserted % 2000 === 0) console.log(`  inserted ${inserted}...`);
  }
  console.log(`\nDone. Wrote ${inserted} rows.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
