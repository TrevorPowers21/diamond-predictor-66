// PROD variant of drive_pitch_log_backfill.mjs — reads .env.production.local + guards prod.
// Drives backfill_pitch_log_attr_batch(_after,_lim) in a loop until the cursor stops advancing.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const strip = v => v.trim().replace(/^["']|["']$/g, "");
const env = Object.fromEntries(readFileSync("./.env.production.local","utf8").split("\n")
  .filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), strip(l.slice(i+1))];}));
const URL = env.SUPABASE_URL;
if (!URL || !URL.includes("trbvxuoliwrfowibatkm")) { console.error("NOT PROD — abort"); process.exit(1); }
const sb = createClient(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const LIM = 25000;
let cursor = "", total = 0, calls = 0;
const t0 = Date.now();
while (true) {
  let data, error, tries = 0;
  do {
    ({ data, error } = await sb.rpc("backfill_pitch_log_attr_batch", { _after: cursor, _lim: LIM }));
    if (error) { tries++; console.error(`  call err (try ${tries}): ${error.message}`); await new Promise(r=>setTimeout(r,3000)); }
  } while (error && tries < 4);
  if (error) { console.error("ABORT after retries:", error.message); process.exit(1); }
  const row = Array.isArray(data) ? data[0] : data;
  const { processed, last_id } = row;
  calls++;
  if (last_id === cursor) { console.log(`done — cursor did not advance (${last_id})`); break; }
  total += processed;
  cursor = last_id;
  const secs = ((Date.now()-t0)/1000).toFixed(0);
  console.log(`call ${calls}: +${processed} rows (total ${total}) cursor=${last_id}  [${secs}s]`);
  if (processed === 0) break;
}
console.log(`\nBACKFILL COMPLETE: ${total} pitch_log rows updated in ${calls} calls, ${((Date.now()-t0)/1000).toFixed(0)}s`);
