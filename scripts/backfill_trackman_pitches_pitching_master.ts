/**
 * Backfill Pitching Master.trackman_pitches = Σ pitcher_stuff_plus_inputs.pitches
 * per (source_player_id, season). The rolled-up TOTAL TrackMan pitch count per pitcher.
 *
 * WHY: trackman_pitches is the true per-pitcher TrackMan sample size. It was null for ~87%
 * of pitchers (never systematically populated). It's the gate for the Stuff+ display min-pitch
 * qualifier (a pitcher with real IP but few tracked pitches — e.g. 12.7 IP / 22 pitches — has a
 * thin, unreliable Stuff+ that should not top leaderboards). Documented intent: memory
 * project_trackman_pitches_column ("sum pitcher_stuff_plus_inputs.pitches per pitcher").
 *
 * Idempotent: only updates rows whose stored value differs. Dry-run by default; pass --apply to write.
 * Season via --season (default 2026). Staging (.env.local) first, then prod.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/backfill_trackman_pitches_pitching_master.ts            # dry-run
 *   npx tsx --env-file-if-exists=.env.local scripts/backfill_trackman_pitches_pitching_master.ts --apply
 */
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const seasonArg = process.argv.find((a) => a.startsWith("--season="));
const SEASON = seasonArg ? Number(seasonArg.split("=")[1]) : 2026;

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const host = (process.env.SUPABASE_URL || "").replace(/https:\/\//, "").split(".")[0];

async function pageAll(table: string, cols: string, seasonCol: string, season: number): Promise<any[]> {
  const out: any[] = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    // ★ STAGE-0 (2026-08-29): unordered .range() silently drops/dupes rows across pages. Both callers
    // (pitcher_stuff_plus_inputs, "Pitching Master") have an "id" PK — verified 2026-08-29.
    const { data, error } = await (sb as any).from(table).select(cols).eq(seasonCol, season).order("id", { ascending: true }).range(from, from + page - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || !data.length) break;
    out.push(...data);
    if (data.length < page) break;
    from += page;
  }
  return out;
}

async function main() {
  console.log(`DB=${host} season=${SEASON} mode=${APPLY ? "APPLY" : "DRY-RUN"}`);

  // 1. Σ pitches per source_player_id from the Stuff+ inputs
  const inputs = await pageAll("pitcher_stuff_plus_inputs", "source_player_id,pitches", "season", SEASON);
  const sums = new Map<string, number>();
  for (const r of inputs) {
    if (!r.source_player_id) continue;
    sums.set(r.source_player_id, (sums.get(r.source_player_id) || 0) + Number(r.pitches || 0));
  }
  console.log(`inputs: ${inputs.length} rows -> ${sums.size} pitchers with a summed pitch count`);

  // 2. current Pitching Master rows for the season
  const master = await pageAll("Pitching Master", "source_player_id,trackman_pitches", "Season", SEASON);
  const bySpid = new Map<string, any>();
  for (const m of master) if (m.source_player_id) bySpid.set(m.source_player_id, m);
  console.log(`Pitching Master ${SEASON}: ${master.length} rows`);

  // 3. diff — only rows whose stored value differs from the computed sum
  const changes: { spid: string; from: number | null; to: number }[] = [];
  let noMasterRow = 0;
  for (const [spid, total] of sums) {
    const m = bySpid.get(spid);
    if (!m) { noMasterRow++; continue; }
    const cur = m.trackman_pitches == null ? null : Number(m.trackman_pitches);
    if (cur !== total) changes.push({ spid, from: cur, to: total });
  }
  console.log(`\nwould change: ${changes.length} Master rows (${noMasterRow} summed pitchers have no ${SEASON} Master row — skipped)`);
  const wasNull = changes.filter((c) => c.from == null).length;
  console.log(`  of those: ${wasNull} were NULL, ${changes.length - wasNull} had a different stored value`);
  const sample = changes.slice(0, 8).map((c) => `${c.spid.slice(0, 8)}:${c.from}->${c.to}`).join("  ");
  console.log(`  sample: ${sample}`);

  if (!APPLY) { console.log("\nDRY-RUN — no writes. Re-run with --apply to write."); return; }

  // 4. apply, grouped by target value to minimize round-trips
  const byValue = new Map<number, string[]>();
  for (const c of changes) (byValue.get(c.to) || byValue.set(c.to, []).get(c.to)!).push(c.spid);
  let done = 0;
  for (const [val, spids] of byValue) {
    for (let i = 0; i < spids.length; i += 200) {
      const chunk = spids.slice(i, i + 200);
      const { error } = await (sb as any)
        .from("Pitching Master")
        .update({ trackman_pitches: val })
        .eq("Season", SEASON)
        .in("source_player_id", chunk);
      if (error) { console.log("UPDATE ERR", error.message); process.exit(1); }
      done += chunk.length;
    }
  }
  console.log(`\nAPPLIED: wrote trackman_pitches to ${done} Pitching Master rows (season ${SEASON}).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
