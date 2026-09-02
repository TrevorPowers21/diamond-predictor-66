/**
 * REFRESH `team_build_players.player_snapshot` — UNTOGGLED ROWS ONLY.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY. `player_snapshot` is the TOGGLE-BAKED copy. For a row with NO toggle it must equal the
 * neutral (dev_agg=0) line by definition — so after a precompute it is simply STALE.
 * Measured staging 2026-09-01: 559 of 578 untoggled rows differed from their (already-refreshed)
 * neutral_snapshot.
 *
 * 🛑 TOGGLED ROWS ARE NEVER TOUCHED. `devAggressivenessOverridden = true` is excluded outright.
 *    Rebuilding a toggled row from a neutral line would flatten the coach's toggle — the exact
 *    failure Trevor called out. This script copies neutral → player_snapshot ONLY where the two
 *    are supposed to be identical.
 *
 * ⚠ STAT KEYS ONLY. Merges a whitelist so any extra keys already on player_snapshot survive.
 *
 *   npx tsx scripts/refresh-player-snapshots-untoggled.ts [--prod] [--apply]
 */
import fs from "fs"; import pg from "pg";
const isProd = process.argv.includes("--prod");
const apply = process.argv.includes("--apply");
const envFile = isProd ? ".env.production.local" : ".env.local";
const m = fs.readFileSync(envFile,"utf8").match(/^PGURI=(.*)$/m)!;
const KEYS = ["p_avg","p_obp","p_slg","p_ops","p_iso","p_wrc","p_wrc_plus","o_war","d_war","bsr_war",
  "total_hitter_war","market_value","twp_hitter_market_value","hitter_depth_role",
  "p_era","p_fip","p_whip","p_k9","p_bb9","p_hr9","p_rv_plus","p_war","pitcher_role",
  "pitcher_depth_role","projected_ip","twp_pitcher_market_value"];
(async()=>{
const c=new pg.Client({connectionString:m[1].trim().replace(/^["']|["']$/g,"")});
await c.connect(); await c.query("set statement_timeout='9min'");
console.log(`### ${envFile} · APPLY=${apply}`);
if (isProd && apply) console.log("!!! PROD WRITE !!!");
const { rows } = await c.query(`
  select id, neutral_snapshot, player_snapshot
  from team_build_players
  where coalesce((production_notes::jsonb->>'devAggressivenessOverridden')::boolean,false) = false
    and neutral_snapshot is not null and player_snapshot is not null`);
let changed = 0; const upd: Array<{id:string;patch:any}> = [];
for (const r of rows) {
  const patch: any = {};
  for (const k of KEYS) if (r.neutral_snapshot[k] !== undefined) patch[k] = r.neutral_snapshot[k];
  const diff = Object.keys(patch).some(k => JSON.stringify(r.player_snapshot[k]) !== JSON.stringify(patch[k]));
  if (diff) { upd.push({ id: r.id, patch }); changed++; }
}
console.log(`untoggled rows: ${rows.length} · would update: ${changed}`);
if (!apply) { console.log("DRY RUN — add --apply."); await c.end(); return; }
let n=0;
for (const u of upd) {
  await c.query(`update team_build_players set player_snapshot = player_snapshot || $2::jsonb
                 where id = $1 and coalesce((production_notes::jsonb->>'devAggressivenessOverridden')::boolean,false) = false`,
                [u.id, JSON.stringify(u.patch)]);
  if (++n % 200 === 0) process.stdout.write(`\r  ${n}/${upd.length}`);
}
console.log(`\n✅ updated ${n}/${upd.length}`);
await c.end();})().catch(e=>{console.error("FAILED:",e.message);process.exit(1);});
