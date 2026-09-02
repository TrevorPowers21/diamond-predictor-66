/**
 * FULL SNAPSHOT CONSISTENCY AUDIT — every build, every target, every user.
 * Read-only. Compares each stored snapshot against the prediction row it SHOULD have copied
 * (predRank: this team's variant='precomputed' → global returner/regular), field by field.
 *   npx tsx scripts/audit-snapshot-consistency.ts [--prod]
 */
import fs from "fs"; import pg from "pg";
const isProd = process.argv.includes("--prod");
const envFile = isProd ? ".env.production.local" : ".env.local";
const m = fs.readFileSync(envFile,"utf8").match(/^PGURI=(.*)$/m)!;
const H = ["p_avg","p_obp","p_slg","p_wrc_plus","o_war","total_hitter_war","market_value"];
const P = ["p_era","p_fip","p_whip","p_k9","p_bb9","p_hr9","p_rv_plus","p_war"];
const TOL: Record<string,number> = { p_wrc_plus:0.5, p_rv_plus:0.5, market_value:1 };
const tol = (f:string)=>TOL[f] ?? 0.0005;

(async()=>{
const c = new pg.Client({connectionString:m[1].trim().replace(/^["']|["']$/g,"")});
await c.connect(); await c.query("set statement_timeout='9min'");
console.log(`\n══════ ${isProd?"PROD":"STAGING"} — FULL SNAPSHOT AUDIT ══════`);

const preds = new Map<string, any[]>();
for (const r of (await c.query(`select player_id, customer_team_id, model_type, variant,
    p_avg,p_obp,p_slg,p_wrc_plus,o_war,d_war,bsr_war,total_hitter_war,market_value,
    p_era,p_fip,p_whip,p_k9,p_bb9,p_hr9,p_rv_plus,p_war
  from player_predictions where season=2027 and variant in ('regular','precomputed')`)).rows) {
  if (!preds.has(r.player_id)) preds.set(r.player_id, []); preds.get(r.player_id)!.push(r);
}
const pick = (pid:string, ctid:string|null) => {
  const rows = preds.get(pid) || [];
  return rows.find(r=>r.customer_team_id===ctid && r.variant==="precomputed")
      ?? rows.find(r=>r.customer_team_id==null && r.model_type==="returner" && r.variant==="regular") ?? null;
};
const check = (snap:any, pred:any) => {
  if (!snap || !pred) return null;
  const isPit = snap.p_era != null || snap.p_war != null;
  const fields = isPit ? P : H;
  const bad:string[] = [], typ:string[] = [];
  for (const f of fields) {
    // `market_value` is stored as `nil_valuation` on board/transfer snapshots (useActiveBuildSnapshot
    // normalizes it back). `o_war` is carried as `owar` on the legacy shape. Accept both spellings.
    const alias: Record<string,string[]> = { market_value:["market_value","nil_valuation"], o_war:["o_war","owar"] };
    const keys = alias[f] ?? [f];
    let s: any = undefined;
    for (const k of keys) if (snap[k] !== undefined && snap[k] !== null) { s = snap[k]; break; }
    if (s === undefined) s = snap[keys[0]];
    const p = pred[f];
    if (s == null && p == null) continue;
    if (typeof s === "string") typ.push(f);
    // A TWP nulls the SHARED market_value by convention — the value lives in twp_*_market_value
    // (src/lib/twpMarketValue.ts). Not a mismatch.
    if (f === "market_value" && (snap.is_twp === true || snap.is_twp === "true") && s == null) continue;
    if (s == null || p == null) { bad.push(`${f}:${s==null?"snapNULL":"predNULL"}`); continue; }
    if (Math.abs(Number(s)-Number(p)) > tol(f)) bad.push(`${f}:${Number(s).toFixed(3)}vs${Number(p).toFixed(3)}`);
  }
  return { bad, typ };
};
const tally = (label:string, rows:any[], snapKey:string, ctidOf:(r:any)=>string|null) => {
  let ok=0, mism=0, noPred=0, strTyp=0; const ex:string[]=[];
  for (const r of rows) {
    const snap = r[snapKey]; if (!snap) continue;
    const pred = pick(r.player_id, ctidOf(r));
    if (!pred) { noPred++; continue; }
    const res = check(snap, pred); if (!res) continue;
    if (res.typ.length) strTyp++;
    if (res.bad.length) { mism++; if (ex.length<5) ex.push(`${r.player_id.slice(0,8)} ${res.bad.slice(0,3).join(" ")}`); }
    else ok++;
  }
  console.log(`\n${label}`);
  console.log(`   match ${ok} · MISMATCH ${mism} · no-pred ${noPred} · STRING-typed ${strTyp}`);
  for (const e of ex) console.log(`     ⚠ ${e}`);
  return mism + strTyp;
};

const tb = (await c.query(`select tb.player_id, tb.customer_team_id, tb.transfer_snapshot, tb.neutral_snapshot
  from target_board tb`)).rows;
const bp = (await c.query(`select tbp.player_id, b.customer_team_id, tbp.neutral_snapshot, tbp.player_snapshot,
    coalesce((tbp.production_notes::jsonb->>'devAggressivenessOverridden')::boolean,false) toggled
  from team_build_players tbp join team_builds b on b.id=tbp.build_id where tbp.player_id is not null`)).rows;

let fails = 0;
fails += tally("target_board.transfer_snapshot", tb, "transfer_snapshot", r=>r.customer_team_id);
fails += tally("target_board.neutral_snapshot",  tb, "neutral_snapshot",  r=>r.customer_team_id);
fails += tally("team_build_players.neutral_snapshot", bp, "neutral_snapshot", r=>r.customer_team_id);
fails += tally("team_build_players.player_snapshot (UNTOGGLED only)",
  bp.filter((r:any)=>!r.toggled), "player_snapshot", (r:any)=>r.customer_team_id);
console.log(`\n${fails===0 ? "✅ CLEAN — every snapshot matches its source row" : `❌ ${fails} problem row(s)`}`);
await c.end();})().catch(e=>{console.error("FAILED:",e.message);process.exit(1);});
