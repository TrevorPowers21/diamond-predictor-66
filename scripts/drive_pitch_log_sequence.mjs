/**
 * Drive the batched pitch_log SEQUENCE backfill (backfill_pitch_log_seq_batch). Loops 25k rows/call by
 * uniq_pitch_id cursor until drained. Points at .env.local (staging). Prod: point env at prod on "prod, now?".
 *   node scripts/drive_pitch_log_sequence.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync("./.env.local", "utf8").split("\n")
  .filter(l => l.includes("=") && !l.trim().startsWith("#"))
  .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const LIM = 25000;
let cursor = "", total = 0, calls = 0, t0 = Date.now();
while (true) {
  let data, error, tries = 0;
  do {
    ({ data, error } = await sb.rpc("backfill_pitch_log_seq_batch", { _after: cursor, _lim: LIM }));
    if (error) { tries++; console.error(`  call err (try ${tries}): ${error.message}`); await new Promise(r => setTimeout(r, 3000)); }
  } while (error && tries < 4);
  if (error) { console.error("giving up"); process.exit(1); }
  const { processed, last_id } = data[0];
  if (!processed) break;
  total += processed; calls++;
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`call ${calls}: +${processed} rows (total ${total}) cursor=${last_id?.slice(0, 12)}  [${secs}s]`);
  cursor = last_id;
}
console.log(`\nSEQUENCE BACKFILL COMPLETE: ${total} pitch_log rows updated in ${calls} calls, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
