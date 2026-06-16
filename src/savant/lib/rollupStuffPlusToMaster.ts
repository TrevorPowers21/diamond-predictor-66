import { supabase } from "@/integrations/supabase/client";

/**
 * Roll Up Per-Pitch Stuff+ → Pitching Master
 *
 * Bridges the gap between the per-pitch Stuff+ values written by the
 * Stuff+ Recompute pipeline (which lands in `pitcher_stuff_plus_inputs`)
 * and the per-pitcher Stuff+ value used by the projection pipeline
 * (which reads from `Pitching Master.stuff_plus`).
 *
 * Without this rollup, reclassifying a pitcher's pitches or recomputing
 * the per-pitch scores has no effect on their projected ERA / FIP / K9 /
 * etc., because Compute Pitching Scores reads `Pitching Master.stuff_plus`
 * as input — not the per-pitch table.
 *
 * The rollup is pitch-weighted: a pitcher's overall Stuff+ is the
 * average of their per-pitch Stuff+ scores, weighted by pitch count.
 * Pitches with `stuff_plus = null` (filtered out for small samples
 * during the Stuff+ Recompute) are excluded; their pitch counts do
 * not contribute to either numerator or denominator.
 */

export interface StuffPlusRollupReport {
  pitchersProcessed: number;
  pitchersUpdated: number;
  pitchersSkipped: number;
  totalPitches: number;
  results: Array<{
    source_player_id: string;
    pitches: number;
    stuff_plus: number;
  }>;
}

interface PitchRow {
  source_player_id: string | null;
  pitches: number | null;
  stuff_plus: number | null;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

async function fetchAll(season: number, sourcePlayerIds?: string[]): Promise<PitchRow[]> {
  const PAGE = 1000;
  const all: PitchRow[] = [];
  let offset = 0;
  const scoped = (sourcePlayerIds && sourcePlayerIds.length > 0);
  while (true) {
    let q = (supabase as any)
      .from("pitcher_stuff_plus_inputs")
      .select("source_player_id, pitches, stuff_plus")
      .eq("season", season);
    if (scoped) q = q.in("source_player_id", sourcePlayerIds!);
    const { data, error } = await q.range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...(data as PitchRow[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

export async function rollupStuffPlusToMaster(
  season: number,
  sourcePlayerIds?: string[],
): Promise<{ report: StuffPlusRollupReport; errors: string[] }> {
  const errors: string[] = [];
  console.time("[StuffPlusRollup] TOTAL");

  console.time("[StuffPlusRollup] 1. fetch per-pitch rows");
  const rows = await fetchAll(season, sourcePlayerIds);
  console.timeEnd("[StuffPlusRollup] 1. fetch per-pitch rows");
  console.log(`[StuffPlusRollup] ${rows.length} per-pitch rows for ${season}`);

  console.time("[StuffPlusRollup] 2. aggregate per pitcher");
  const byPitcher = new Map<string, { sum: number; pitches: number }>();
  for (const r of rows) {
    if (!r.source_player_id) continue;
    if (r.stuff_plus == null || !Number.isFinite(Number(r.stuff_plus))) continue;
    const p = Number(r.pitches);
    if (!Number.isFinite(p) || p <= 0) continue;
    const stuff = Number(r.stuff_plus);
    const cur = byPitcher.get(r.source_player_id);
    if (cur) {
      cur.sum += stuff * p;
      cur.pitches += p;
    } else {
      byPitcher.set(r.source_player_id, { sum: stuff * p, pitches: p });
    }
  }
  console.timeEnd("[StuffPlusRollup] 2. aggregate per pitcher");
  console.log(`[StuffPlusRollup] aggregated to ${byPitcher.size} pitchers`);

  const results: StuffPlusRollupReport["results"] = [];
  let totalPitches = 0;
  for (const [sid, agg] of byPitcher) {
    if (agg.pitches <= 0) continue;
    const stuffPlus = round2(agg.sum / agg.pitches);
    results.push({ source_player_id: sid, pitches: agg.pitches, stuff_plus: stuffPlus });
    totalPitches += agg.pitches;
  }
  results.sort((a, b) => b.pitches - a.pitches);

  console.time("[StuffPlusRollup] 3. write to Pitching Master");
  let updated = 0;
  let skipped = 0;
  const BATCH = 50;
  for (let i = 0; i < results.length; i += BATCH) {
    const batch = results.slice(i, i + BATCH);
    await Promise.all(batch.map(async (row) => {
      const { error, count } = await (supabase as any)
        .from("Pitching Master")
        .update({ stuff_plus: row.stuff_plus }, { count: "exact" })
        .eq("source_player_id", row.source_player_id)
        .eq("Season", season);
      if (error) {
        errors.push(`PM ${row.source_player_id}: ${error.message}`);
        skipped++;
      } else if (count == null || count === 0) {
        // No matching Pitching Master row (pitcher in inputs but not in master)
        skipped++;
      } else {
        updated++;
      }
    }));
  }
  console.timeEnd("[StuffPlusRollup] 3. write to Pitching Master");

  console.timeEnd("[StuffPlusRollup] TOTAL");
  console.log(`[StuffPlusRollup] ${updated} updated, ${skipped} skipped (no Pitching Master row)`);

  return {
    report: {
      pitchersProcessed: results.length,
      pitchersUpdated: updated,
      pitchersSkipped: skipped,
      totalPitches,
      results,
    },
    errors,
  };
}
