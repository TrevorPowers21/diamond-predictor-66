#!/usr/bin/env node
/**
 * PROD variant of backfill_pitch_log_attribution.mjs — reads .env.production.local
 * (quote-stripped) + guards the prod ref. Loads {uniq_pitch_id + attribution cols}
 * from the DRS Pitch Log CSVs into pitch_log_attr on PROD. Requires the Step-3 DDL first.
 *   node scripts/backfill_pitch_log_attribution_prod.mjs            # dry-run
 *   node scripts/backfill_pitch_log_attribution_prod.mjs --apply    # write temp table
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { glob } from "node:fs/promises";

const APPLY = process.argv.includes("--apply");
const strip = v => v.trim().replace(/^["']|["']$/g, "");
const env = Object.fromEntries(readFileSync("./.env.production.local","utf8").split("\n")
  .filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), strip(l.slice(i+1))];}));
const URL = env.SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !URL.includes("trbvxuoliwrfowibatkm")) { console.error("NOT PROD (.env.production.local) — abort"); process.exit(1); }
const sb = createClient(URL, KEY, { auth:{persistSession:false} });

const ATTR = {
  uniq_pitch_id:"uniqPitchId", atbat_desc:"atbatDesc",
  first_baseman:"FirstBaseman", second_baseman:"SecondBaseman", third_baseman:"ThirdBaseman",
  short_stop:"ShortStop", left_fielder:"LeftFielder", center_fielder:"CenterFielder", right_fielder:"RightFielder",
  man_on_first:"ManOnFirst", man_on_second:"ManOnSecond", man_on_third:"ManOnThird",
  sba2:"SBA2", sb2:"SB2", sba3:"SBA3", sb3:"SB3",
  p_pbwp_pct:"pPBWP%", p_call_strk_pct:"pCallStrk%",
  pop_time:"PopTime", deliv_time:"DelivTime", c_time_to_base:"CTimeToBase",
  c_throw_base:"CThrowBase", c_exch_time:"CExchTime", pick_att_base:"PickAttBase",
  hang_time:"HangTime", runs:"Runs",
};
const TEXT = new Set(["uniq_pitch_id","atbat_desc","first_baseman","second_baseman","third_baseman",
  "short_stop","left_fielder","center_fielder","right_fielder","man_on_first","man_on_second","man_on_third",
  "c_throw_base","pick_att_base"]);
const INT = new Set(["sba2","sb2","sba3","sb3","runs"]);

function parseRow(line){ const out=[]; let cur="",q=false;
  for(let i=0;i<line.length;i++){const c=line[i];
    if(c==='"'){ if(q&&line[i+1]==='"'){cur+='"';i++;} else q=!q; }
    else if(c===","&&!q){out.push(cur);cur="";} else cur+=c; }
  out.push(cur); return out; }
const txt = s => { s=(s??"").trim(); return (s===""||s==="-"||s==="—")?null:s; };
const num = s => { const t=txt(s); if(t==null)return null; const n=Number(t.replace(/s$/,"").replace(/%$/,"")); return Number.isFinite(n)?n:null; };
const int = s => { const n=num(s); return n==null?null:Math.trunc(n); };
const norm = (col,v) => TEXT.has(col)?txt(v):INT.has(col)?int(v):num(v);

const files = [];
for await (const f of glob("docs/drs-reference/*DRS Pitch Log.csv")) files.push(f);
files.sort();
console.log(`${files.length} DRS Pitch Log files -> PROD pitch_log_attr  (${APPLY?"APPLY":"dry-run"})`);

const seen = new Set();
let buf = [], total=0, dupes=0, written=0, badKey=0;
const BATCH = 1000;
async function flush(){
  if(!buf.length) return;
  if(APPLY){
    const { error } = await sb.from("pitch_log_attr").upsert(buf, { onConflict:"uniq_pitch_id" });
    if(error){ console.error("batch FAILED:", error.message); process.exit(1); }
  }
  written += buf.length; buf = [];
  if(written % 100000 < BATCH) console.log(`  ${written} rows…`);
}
for(const f of files){
  const lines = readFileSync(f,"utf8").split(/\r?\n/);
  const hdr = parseRow(lines[0]);
  const pos = {};
  for(let i=0;i<hdr.length;i++){ const h=hdr[i].trim();
    for(const [col,head] of Object.entries(ATTR)) if(h===head) pos[col]=i; }
  if(pos.uniq_pitch_id==null){ console.error(`  ${f}: no uniqPitchId header — skip`); continue; }
  for(let i=1;i<lines.length;i++){
    if(!lines[i]) continue;
    const r = parseRow(lines[i]);
    const uid = txt(r[pos.uniq_pitch_id]);
    if(!uid){ badKey++; continue; }
    total++;
    if(seen.has(uid)){ dupes++; continue; }
    seen.add(uid);
    const rec = {};
    for(const col of Object.keys(ATTR)) rec[col] = norm(col, pos[col]==null?null:r[pos[col]]);
    buf.push(rec);
    if(buf.length>=BATCH) await flush();
  }
}
await flush();
console.log(`\nrows scanned: ${total} | unique loaded: ${written} | dupes skipped: ${dupes} | bad key: ${badKey}`);
if(!APPLY) console.log("dry-run — re-run with --apply to write pitch_log_attr");
