/**
 * Timeout-immune is_conference_game backfill (staging) — supabase-js REST, keyset-paginated.
 * is_conference_game = conference_of(team_id) == conference_of(opponent_id), from Teams Table
 * (Season 2026) source_id → conference_id. team_id/opponent_id are the CLEAN ids
 * (batting_team_id/pitching_team_id are corrupt). Null when an id doesn't resolve.
 *
 * Reads pitch_log in keyset batches by uniq_pitch_id (PK, indexed → fast), computes the flag
 * in JS, writes back via batched UPSERT {uniq_pitch_id, is_conference_game} (POST body, no URL
 * limit; onConflict=uniq_pitch_id → UPDATE). Each REST call is small → immune to the CLI/pooler
 * statement-timeout cap that kills a single 2.6M-row UPDATE.
 *
 * Usage: npx tsx scripts/backfill_is_conference_game.ts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const url = "https://slrxowawbijbjrkozqlj.supabase.co";
const key = readFileSync(".env.local", "utf-8").split("\n")
  .find(l => l.startsWith("SUPABASE_SERVICE_ROLE_KEY="))?.split("=", 2)[1] ?? "";
const sb = createClient(url, key, { auth: { persistSession: false } });

const SEASON = 2026;
const READ = 10000;   // rows per keyset read
const WRITE = 5000;   // rows per upsert

async function main() {
  // 1. conference map: source_id (text) → conference_id
  const conf = new Map<string, string>();
  let from = 0;
  for (;;) {
    const { data, error } = await (sb as any).from("Teams Table")
      .select("source_id, conference_id").eq("Season", SEASON)
      .not("source_id", "is", null).not("conference_id", "is", null)
      .range(from, from + 999);
    if (error) throw error;
    for (const t of data) conf.set(String(t.source_id), t.conference_id);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`conf map: ${conf.size} teams`);

  // 2. keyset-page pitch_log, compute, upsert
  let lastId = "";
  let seen = 0, wrote = 0, intra = 0, nonconf = 0, nullc = 0;
  const t0 = Date.now();
  for (;;) {
    const { data, error } = await (sb as any).from("pitch_log")
      .select("uniq_pitch_id, team_id, opponent_id").eq("season", SEASON)
      .gt("uniq_pitch_id", lastId).order("uniq_pitch_id", { ascending: true }).limit(READ);
    if (error) throw error;
    if (!data.length) break;
    seen += data.length;
    lastId = data[data.length - 1].uniq_pitch_id;

    const trueIds: string[] = []; const falseIds: string[] = [];
    for (const r of data) {
      const bc = conf.get(String(r.team_id)); const oc = conf.get(String(r.opponent_id));
      if (bc != null && oc != null) { if (bc === oc) { trueIds.push(r.uniq_pitch_id); intra++; } else { falseIds.push(r.uniq_pitch_id); nonconf++; } }
      else nullc++;  // stays null (default) — no write needed
    }
    for (const [ids, val] of [[trueIds, true], [falseIds, false]] as [string[], boolean][]) {
      for (let i = 0; i < ids.length; i += WRITE) {
        const chunk = ids.slice(i, i + WRITE);
        const { error: uerr } = await (sb as any).rpc("set_conf_game", { p_ids: chunk, p_val: val });
        if (uerr) throw uerr;
        wrote += chunk.length;
      }
    }
    if (seen % 200000 < READ) console.log(`  ${seen} read / ${wrote} written  (${((Date.now()-t0)/1000).toFixed(0)}s)`);
  }
  console.log(`\n✓ DONE — seen ${seen}, wrote ${wrote} | intra ${intra} / non ${nonconf} / null ${nullc} | ${((Date.now()-t0)/1000).toFixed(0)}s`);
}
main().catch(e => { console.error(e); process.exit(1); });
