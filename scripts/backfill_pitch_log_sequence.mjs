/**
 * Backfill the pitch_log SEQUENCE columns (pitch_num_in_game / ab_num_in_game / pitch_num_in_ab) added by
 * 20260808_pitch_log_add_sequence.sql. Same proven path as backfill_pitch_log_attribution.mjs:
 *   (a) loads {uniq_pitch_id + sequence cols} into a TEMP table pitch_log_seq (this script),
 *   (b) then a BATCHED server-side UPDATE joins it onto pitch_log (drive_pitch_log_sequence.mjs / SQL).
 * Dedups by uniq_pitch_id across overlapping-window files. Points at .env.local (staging).
 *   node scripts/backfill_pitch_log_sequence.mjs            # dry-run
 *   node scripts/backfill_pitch_log_sequence.mjs --apply    # load pitch_log_seq
 */
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(readFileSync("./.env.local", "utf8").split("\n")
  .filter(l => l.includes("=") && !l.trim().startsWith("#"))
  .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const URL = env.VITE_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const APPLY = process.argv.includes("--apply");

// db column -> exact TruMedia CSV header
const SEQ = { uniq_pitch_id: "uniqPitchId", pitch_num_in_game: "pitchNumInGame",
              ab_num_in_game: "abNumInGame", pitch_num_in_ab: "pitchNumInAB" };
const txt = s => { s = (s ?? "").trim(); return (s === "" || s === "-" || s === "—") ? null : s; };
const int = s => { const t = txt(s); if (t == null) return null; const n = Math.trunc(Number(t)); return Number.isFinite(n) ? n : null; };

const files = [];
for await (const f of glob("docs/drs-reference/*DRS Pitch Log.csv")) files.push(f);
files.sort();
console.log(`${files.length} DRS Pitch Log files -> pitch_log_seq  (${APPLY ? "APPLY" : "dry-run"})`);

const seen = new Set();
let total = 0, written = 0, dupes = 0, badKey = 0, buf = [];
async function flush() {
  if (!buf.length) return;
  if (APPLY) {
    const { error } = await sb.from("pitch_log_seq").upsert(buf, { onConflict: "uniq_pitch_id" });
    if (error) { console.error("batch FAILED:", error.message); process.exit(1); }
  }
  buf = [];
}
for (const f of files) {
  const lines = readFileSync(f, "utf8").split(/\r?\n/);
  const hdr = lines[0].split(",");
  const pos = {};
  for (let i = 0; i < hdr.length; i++) { const h = hdr[i].trim();
    for (const [col, head] of Object.entries(SEQ)) if (h === head) pos[col] = i; }
  if (pos.uniq_pitch_id == null) { console.error(`  ${f}: no uniqPitchId header — skip`); continue; }
  for (let li = 1; li < lines.length; li++) {
    if (!lines[li]) continue;
    const r = lines[li].split(",");
    const uid = txt(r[pos.uniq_pitch_id]); total++;
    if (uid == null) { badKey++; continue; }
    if (seen.has(uid)) { dupes++; continue; }
    seen.add(uid);
    const rec = { uniq_pitch_id: uid };
    for (const col of ["pitch_num_in_game", "ab_num_in_game", "pitch_num_in_ab"])
      rec[col] = pos[col] == null ? null : int(r[pos[col]]);
    buf.push(rec); written++;
    if (buf.length >= 5000) await flush();
  }
}
await flush();
console.log(`rows scanned: ${total} | unique loaded: ${written} | dupes skipped: ${dupes} | bad key: ${badKey}`);
if (!APPLY) console.log("dry-run only — re-run with --apply to load pitch_log_seq");
