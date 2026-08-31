/**
 * FILL `pitch_log_pitcher_totals.ip` (+ `ip_reg`) FROM THE PITCH LOG — outs ÷ 3, both windows.
 *
 * WHY: `ip` is **0/5,509 on PROD** (staging 5,415) and has **NO COMMITTED PRODUCER** — staging's values came from an
 * ad-hoc backfill nobody kept. The consequence on prod today: `derive_masters_from_pitchlog.ts` skips its
 * IP-dependent branch (`pitcherIpDependent` returns {} when ip is null), so **K9 / BB9 / HR9 / WHIP / FIP on
 * "Pitching Master" are stale TruMedia values instead of pitch-log-derived.** This script closes that.
 *
 * METHOD (Trevor: "there is an outs total in the inning that the pitch log tracks and you just have to recognize how
 * that changes to get total outs"):
 *   `outs` is the base-out STATE BEFORE the pitch and only ever holds 0/1/2. Outs recorded on a play = the next
 *   row's `outs` minus this row's, within the same half-inning; the final play of a completed half-inning takes it
 *   to 3. Summed per pitcher and divided by 3 → IP. The out is attributed to whoever threw that pitch, so relief
 *   appearances split correctly (a naive `(max(outs)+1)/3` would credit a reliever with outs recorded before he
 *   entered — median error 2.67 IP, measured).
 *   ★ `inn` is TEXT and already encodes the half ('Top 1' / 'Bot 1'), so (game_string, inn) IS a half-inning.
 *
 * ACCURACY — validated against TruMedia "Pitching Master".IP on staging (n=5,377):
 *   this derivation   mean|Δ| 0.476  median 0.33
 *   staging's stored  mean|Δ| 0.486  median 0.33   ← identical quality; the stored column is NOT more correct
 *   engine full_IP    mean|Δ| 0.411  median 0.30
 *   All within the ~0.99 correlation this measure carries by design (refresh_team_season_stats.sql:119 records 0.9932).
 *
 * WINDOWS: regular season = games on/before `regular_season_end`; the date is parsed from `game_string`
 *   (`…20260328…`). Boundary mirrors scripts/drs/drs_engine/season_config.py → 2026: 2026-05-18.
 *   ⚠ ONE SOURCE: that constant also lives in refresh_team_season_stats' `p_reg_end` default. Keep them in sync
 *   until the planned per-team schedule table replaces both.
 *
 *   staging: npx tsx --env-file=.env.local            scripts/fill_pitcher_totals_ip.ts [--apply]
 *   prod:    npx tsx --env-file=.env.production.local scripts/fill_pitcher_totals_ip.ts --prod [--apply]
 */
import pg from "pg";
import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const PROD_FLAG = process.argv.includes("--prod");
const SEASON = Number((process.argv.find((a) => a.startsWith("--season=")) || "").split("=")[1] || 2026);
const REG_END = (process.argv.find((a) => a.startsWith("--reg-end=")) || "").split("=")[1] || `${SEASON}0518`;

const envFile = PROD_FLAG ? ".env.production.local" : ".env.local";
const PGURI = readFileSync(envFile, "utf8").split("\n").find((l) => l.startsWith("PGURI="))
  ?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "") || "";
if (!PGURI) { console.error(`✗ No PGURI in ${envFile}`); process.exit(1); }

// ── double-keyed env guard: the URI and the --prod flag must AGREE ───────────
const isProd = /trbvxuoliwrfowibatkm/.test(PGURI);
if (isProd && !PROD_FLAG) { console.error("✗ URI is PROD but --prod was not passed — refusing."); process.exit(1); }
if (!isProd && PROD_FLAG) { console.error("✗ --prod passed but URI is not prod — refusing."); process.exit(1); }
console.log(`[env] ${isProd ? "🔴 PROD" : "STAGING/other"}  season=${SEASON}  reg_end=${REG_END}  mode=${APPLY ? "APPLY" : "DRY-RUN"}`);

// outs-state delta per half-inning, attributed to the pitcher who threw the pitch.
const IP_SQL = `
with p as (
  select pitcher_id,
         substring(game_string from '(20\\d\\d(?:0[1-9]|1[0-2])[0-3]\\d)') as gdate,
         outs,
         lead(outs) over (partition by game_string, inn order by uniq_pitch_id) nxt
  from pitch_log
  where season = $1 and inn is not null and outs is not null
    and pitcher_id is not null and game_string is not null
),
d as (select pitcher_id, gdate, greatest(coalesce(nxt, 3) - outs, 0) as outs_made from p)
select pitcher_id,
       sum(outs_made) / 3.0                                            as ip,
       sum(outs_made) filter (where gdate <= $2) / 3.0                 as ip_reg
from d group by pitcher_id`;

async function main() {
  const c = new pg.Client({ connectionString: PGURI });
  await c.connect();
  try {
    const before = (await c.query(
      `select count(*) rows, count(ip) ip_filled from pitch_log_pitcher_totals where season=$1 and dimension_key='all'`, [SEASON])).rows[0];
    console.log(`BEFORE — totals rows ${before.rows}, ip filled ${before.ip_filled}`);

    const derived = (await c.query(IP_SQL, [SEASON, REG_END])).rows;
    const withIp = derived.filter((r) => Number(r.ip) > 0);
    const totIp = withIp.reduce((s, r) => s + Number(r.ip), 0);
    const totReg = withIp.reduce((s, r) => s + Number(r.ip_reg || 0), 0);
    console.log(`DERIVED — ${derived.length} pitchers (${withIp.length} with IP>0)`);
    console.log(`  Σ IP ${totIp.toFixed(1)}   Σ reg ${totReg.toFixed(1)}   post = ${(totIp - totReg).toFixed(1)} (${(100 * (totIp - totReg) / totIp).toFixed(1)}%)`);
    const top = [...withIp].sort((a, b) => Number(b.ip) - Number(a.ip)).slice(0, 5);
    console.log("  top 5:", top.map((r) => `${r.pitcher_id} ${Number(r.ip).toFixed(2)} (reg ${Number(r.ip_reg).toFixed(2)})`).join(" · "));

    // accuracy check against the authoritative TruMedia line
    const acc = (await c.query(
      `select source_player_id sid, "IP" ip from "Pitching Master" where "Season"=$1 and division='D1' and "IP" is not null`, [SEASON])).rows;
    const byId = new Map(derived.map((r) => [String(r.pitcher_id), Number(r.ip)]));
    const diffs = acc.map((m) => { const v = byId.get(String(m.sid)); return v == null ? null : Math.abs(v - Number(m.ip)); })
      .filter((x): x is number => x != null).sort((a, b) => a - b);
    if (diffs.length) {
      const mean = diffs.reduce((s, v) => s + v, 0) / diffs.length;
      console.log(`  vs TruMedia Master.IP — n=${diffs.length} mean|Δ|=${mean.toFixed(3)} median=${diffs[Math.floor(diffs.length / 2)].toFixed(2)} p90=${diffs[Math.floor(diffs.length * 0.9)].toFixed(2)}`);
      if (mean > 1.0) { console.error("✗ mean |Δ| > 1.0 IP vs the Master line — derivation looks wrong. ABORTING."); process.exit(1); }
    }

    if (!APPLY) { console.log("\nDRY-RUN — no writes. Re-run with --apply."); return; }

    await c.query(`alter table pitch_log_pitcher_totals add column if not exists ip_reg numeric`);
    let n = 0, miss = 0;
    for (const r of derived) {
      const res = await c.query(
        `update pitch_log_pitcher_totals set ip=$1, ip_reg=$2 where season=$3 and dimension_key='all' and pitcher_id=$4`,
        [Number(r.ip), Number(r.ip_reg || 0), SEASON, r.pitcher_id]);
      if (res.rowCount) n += res.rowCount; else miss++;
    }
    console.log(`\n✓ updated ${n} totals rows (${miss} derived pitchers had no 'all' totals row)`);
    const after = (await c.query(
      `select count(*) rows, count(ip) ip_filled, count(ip_reg) reg_filled, round(avg(ip)::numeric,2) avg_ip
       from pitch_log_pitcher_totals where season=$1 and dimension_key='all'`, [SEASON])).rows[0];
    console.log(`AFTER — rows ${after.rows}, ip ${after.ip_filled}, ip_reg ${after.reg_filled}, avg ip ${after.avg_ip}`);
  } finally { await c.end(); }
}
main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
