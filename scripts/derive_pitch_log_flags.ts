#!/usr/bin/env node
/**
 * Derive boolean flags + pitch_result_category for pitch_log rows.
 *
 * Phase 2 (a) of the pitch log build (docs/PITCH_LOG_BUILD.md). Reads
 * each row's pitch_result + cs_prob, computes the 9 derived columns
 * in JS, and upserts in batches.
 *
 * The original implementation tried a single large UPDATE statement
 * via Supabase's RPC, but the API gateway times out at ~60s regardless
 * of statement_timeout. This batch approach avoids that ceiling.
 *
 * Idempotent: only processes rows where is_foul IS NULL.
 *
 * Usage:
 *   npm run derive-pitch-log-flags                 # dry-run (logs counts)
 *   npm run derive-pitch-log-flags -- --apply      # write to staging
 *   npm run derive-pitch-log-flags:prod -- --apply # write to prod
 */
import { createClient } from "@supabase/supabase-js";

interface PitchRow {
  uniq_pitch_id: string;
  pitch_result: string | null;
  cs_prob: number | null;
  spray_ang: number | null;
  batter_hand: string | null;
  px_norm: number | null;
  pz_norm: number | null;
}

interface DerivedRow {
  uniq_pitch_id: string;
  pitch_result_category: string;
  is_foul: boolean;
  is_in_zone: boolean | null;
  is_strike: boolean;
  is_swing: boolean;
  is_whiff: boolean;
  is_chase: boolean | null;
  is_in_play: boolean;
  is_batted_ball_in_play: boolean;
  hit_location: string | null;
  batted_direction: string | null;
  pitch_zone: string | null;
}

/**
 * 13-zone strike-zone location from px_norm/pz_norm. Matches zoneForPitch in
 * src/savant/components/PitchZone*.tsx EXACTLY (so stored == displayed):
 *   in-zone unit square -> '1'..'9' (3x3, row0=top pz>1/3, col0=left px<-1/3)
 *   outside -> 'UL'/'UR'/'LL'/'LR' quadrant by sign; |px|>4 or |pz|>4 -> null.
 * Absolute (catcher's view), not batter-relative.
 */
function pitchZone(px: number | null, pz: number | null): string | null {
  if (px == null || pz == null) return null;
  if (Math.abs(px) > 4 || Math.abs(pz) > 4) return null;
  if (px >= -1 && px <= 1 && pz >= -1 && pz <= 1) {
    const col = px < -1 / 3 ? 0 : px < 1 / 3 ? 1 : 2;
    const row = pz > 1 / 3 ? 0 : pz > -1 / 3 ? 1 : 2;
    return String(row * 3 + col + 1);
  }
  if (px <= 0 && pz >= 0) return "UL";
  if (px >= 0 && pz >= 0) return "UR";
  if (px <= 0 && pz <= 0) return "LL";
  return "LR";
}

/**
 * Absolute field section of a batted ball from spray_ang.
 * Cutoffs (locked w/ Trevor): far_left -45..-30, left_center -30..-15,
 * center -15..15, right_center 15..30, far_right 30..45.
 */
function hitLocation(spray: number | null, bip: boolean): string | null {
  if (!bip || spray == null || spray < -45 || spray > 45) return null;
  if (spray < -30) return "far_left";
  if (spray < -15) return "left_center";
  if (spray <= 15) return "center";
  if (spray <= 30) return "right_center";
  return "far_right";
}

/**
 * pull | center | oppo from spray_ang + the row's batter_hand. Center band
 * +/-15 (matches Master HPull%). RHB pulls left (negative), LHB pulls right.
 * Per-row hand => switch hitters resolve exactly.
 */
function battedDirection(
  spray: number | null,
  hand: string | null,
  bip: boolean,
): string | null {
  if (!bip || spray == null || hand == null || spray < -45 || spray > 45) return null;
  if (spray >= -15 && spray <= 15) return "center";
  if (hand === "R") return spray < -15 ? "pull" : "oppo";
  if (hand === "L") return spray > 15 ? "pull" : "oppo";
  return null;
}

/** Outcomes that count as a "ball put in play" (NOT foul). */
function isInPlay(r: string | null): boolean {
  if (!r) return false;
  return (
    r.startsWith("Single") ||
    r === "Double Play" ||
    r.startsWith("Triple") ||
    r.startsWith("Double") ||
    r.startsWith("Home Run") ||
    r === "Ground Out" ||
    r === "Fly Out" ||
    r === "Line Out" ||
    r === "Pop Out" ||
    r === "Sac Bunt" ||
    r === "Sac Fly" ||
    r.startsWith("Reached on Error") ||
    r === "Fielder's Choice"
  );
}

function isSwing(r: string | null): boolean {
  if (!r) return false;
  if (r === "Strike Swinging" || r === "Foul" || r === "Strikeout (Swinging)") return true;
  return isInPlay(r);
}

function isStrike(r: string | null): boolean {
  if (!r) return false;
  if (
    r === "Strike Looking" ||
    r === "Strike Swinging" ||
    r === "Foul" ||
    r.startsWith("Strikeout")
  ) return true;
  return isInPlay(r);
}

function categorize(r: string | null): string {
  if (r == null || r === "") return "Other";
  if (r === "Foul") return "Foul";
  if (r === "Ball" || r === "Ball in the Dirt" || r === "Intentional Ball") return "Ball";
  if (r === "Walk" || r === "Intentional Walk") return "Walk";
  if (r === "Hit By Pitch") return "HBP";
  if (r === "Strike Looking" || r === "Strike Swinging") return "Strike";
  if (r.startsWith("Strikeout")) return "Strikeout";
  if (r.startsWith("Home Run")) return "HR";
  if (r.startsWith("Single")) return "Single";
  if (r === "Double Play") return "DoublePlay";
  if (r.startsWith("Triple")) return "Triple";
  if (r.startsWith("Double")) return "Double";
  if (r === "Ground Out") return "GroundOut";
  if (r === "Fly Out") return "FlyOut";
  if (r === "Line Out") return "LineOut";
  if (r === "Pop Out") return "PopOut";
  if (r === "Sac Bunt" || r === "Sac Fly") return "Sac";
  if (r.startsWith("Reached on Error")) return "Error";
  if (r === "Fielder's Choice") return "FieldersChoice";
  return "Other";
}

function derive(row: PitchRow): DerivedRow {
  const r = row.pitch_result;
  const cs = row.cs_prob;
  const swing = isSwing(r);
  const inZone = cs == null ? null : cs >= 0.5;
  return {
    uniq_pitch_id: row.uniq_pitch_id,
    pitch_result_category: categorize(r),
    is_foul: r === "Foul",
    is_in_zone: inZone,
    is_strike: isStrike(r),
    is_swing: swing,
    is_whiff: r === "Strike Swinging" || r === "Strikeout (Swinging)",
    is_chase: cs == null ? null : swing && cs < 0.5,
    is_in_play: isInPlay(r),
    is_batted_ball_in_play: isInPlay(r),
    hit_location: hitLocation(row.spray_ang, isInPlay(r)),
    batted_direction: battedDirection(row.spray_ang, row.batter_hand, isInPlay(r)),
    pitch_zone: pitchZone(row.px_norm, row.pz_norm),
  };
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

  const { count: pendingInitial } = await (supabase as any)
    .from("pitch_log")
    .select("uniq_pitch_id", { count: "exact", head: true })
    .is("is_foul", null);

  console.log(`Pending derivation: ${pendingInitial ?? "?"} rows`);

  if (!apply) {
    console.log(`\n[dry-run] No writes. Re-run with --apply.`);
    return;
  }

  if (!pendingInitial || pendingInitial === 0) {
    console.log("Nothing to do.");
    return;
  }

  // Stream-fetch + batch upsert. Pages keyed by uniq_pitch_id (PK) for
  // stable order — Supabase rejects offsets beyond 1000 by default, so
  // we use keyset pagination instead.
  const FETCH_BATCH = 5000;
  const UPSERT_BATCH = 1000;
  let processed = 0;
  let lastId = "";

  const startTime = process.hrtime.bigint();
  while (true) {
    const sel = (supabase as any)
      .from("pitch_log")
      .select("uniq_pitch_id, pitch_result, cs_prob, spray_ang, batter_hand, px_norm, pz_norm")
      .is("is_foul", null)
      .order("uniq_pitch_id", { ascending: true })
      .limit(FETCH_BATCH);
    // keyset cursor — avoid offset entirely
    const query = lastId ? sel.gt("uniq_pitch_id", lastId) : sel;
    const { data, error } = await query;
    if (error) {
      console.error(`SELECT failed: ${error.message}`);
      process.exit(1);
    }
    if (!data || data.length === 0) break;

    const derived = (data as PitchRow[]).map(derive);

    // Upsert in sub-batches
    for (let i = 0; i < derived.length; i += UPSERT_BATCH) {
      const chunk = derived.slice(i, i + UPSERT_BATCH);
      const { error: upErr } = await (supabase as any)
        .from("pitch_log")
        .upsert(chunk, { onConflict: "uniq_pitch_id" });
      if (upErr) {
        console.error(`UPSERT failed at ${processed + i}: ${upErr.message}`);
        process.exit(1);
      }
    }

    processed += derived.length;
    lastId = derived[derived.length - 1].uniq_pitch_id;

    const elapsedSec = Number(process.hrtime.bigint() - startTime) / 1e9;
    const rate = processed / elapsedSec;
    const remaining = (pendingInitial - processed) / rate;
    console.log(
      `  ${processed.toString().padStart(8)} / ${pendingInitial} processed  (${rate.toFixed(0)} rows/s, ~${(remaining / 60).toFixed(1)} min left)`,
    );
  }

  const elapsed = Number(process.hrtime.bigint() - startTime) / 1e9;
  console.log(`\nDone in ${(elapsed / 60).toFixed(1)} min. ${processed} rows derived.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
