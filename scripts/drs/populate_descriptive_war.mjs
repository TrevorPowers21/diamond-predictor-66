/**
 * WAR redesign Step 3 — populate DESCRIPTIVE WAR onto the Masters (STAGING).
 * Descriptive = last-season actuals from raw accrued on-field data (Master export sheets now;
 * pitch-log-derived next season). TOTAL WAR is the displayed number; oWAR/pWAR are components.
 *
 *   HITTER:  desc_owar = wraa/RPW + (PA/600)*2.0 ;  wraa=((woba−lgwOBA)/wOBAscale)*PA
 *            d_war = Σ drs_floor(pos≠P)/RPW ;  bsr_war = wsb_runs(FULL)/RPW
 *            total_desc_war = desc_owar + d_war + bsr_war
 *   PITCHER: desc_ra9 = 0.5*(RA9 + dRS_behind_per9) + 0.5*(FIP*E2T)
 *            desc_pwar = (replRA9 − desc_ra9)*IP/9/RPW ;  total_desc_war = desc_pwar
 *            dRS_behind_per9 = team_drs*9/team_IP (B-R proration; per-9 is a team-rate)
 *
 * Reads stamped fixtures + Master export sheets + team_drs + player_season_defense/_baserunning.
 * D1 only (constants are D1; JUCO deferred). Writes desc_* columns keyed (source_player_id, 2026).
 *   node scripts/drs/populate_descriptive_war.mjs [--commit]
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const COMMIT = process.argv.includes("--commit");
const SEASON = 2026;
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const C = JSON.parse(readFileSync("output/descriptive_constants.json", "utf8"));
const W = JSON.parse(readFileSync("output/woba_weights.json", "utf8"));
const RPW = C.RPW, E2T = C.E2T, REPL_RA9 = C.replacement_RA9;
const WT = W.woba_weights_above_out_scaled, LGWOBA = W.lgwOBA, WSCALE = W.wOBAscale, OREPL = W.offense_replacement_wins_per_600pa;
console.log(`constants: RPW ${RPW} E2T ${E2T} replRA9 ${REPL_RA9} | wOBA lg ${LGWOBA} scale ${WSCALE} repl ${OREPL}/600`);

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
function sheet(path, key = "playerId") {
  const t = readFileSync(path, "utf8").split("\n"); const H = t[0].split(","); const gi = k => H.indexOf(k);
  const m = {};
  for (let i = 1; i < t.length; i++) { if (!t[i]) continue; const c = t[i].split(","); const id = (c[gi(key)] || "").trim(); if (id) m[id] = c.map(x => x); m[id] && (m[id]._gi = gi); }
  return { rows: m, gi };
}
async function all(t, cols, season = true) { let a = []; for (let f = 0; ; f += 1000) { let q = sb.from(t).select(cols).range(f, f + 999); if (season) q = q.eq("Season", SEASON); const { data, error } = await q; if (error) { console.error(t, error.message); process.exit(1); } a = a.concat(data); if (data.length < 1000) break; } return a; }
async function allNoSeason(t, cols, seasonCol) { let a = []; for (let f = 0; ; f += 1000) { let q = sb.from(t).select(cols).range(f, f + 999); if (seasonCol) q = q.eq(seasonCol, SEASON); const { data, error } = await q; if (error) { console.error(t, error.message); process.exit(1); } a = a.concat(data); if (data.length < 1000) break; } return a; }

// ── load sources ─────────────────────────────────────────────────────────────
const hitSheet = sheet("docs/drs-reference/Full Season Hitting Master Stats.csv");
const pitSheet = sheet("docs/drs-reference/Full Season Pitching Master Stats.csv");
const HM = (await all("Hitter Master", "source_player_id,division,pa")).filter(r => r.division === "D1");
const PM = (await all("Pitching Master", "source_player_id,division,IP,ERA,FIP,TeamID")).filter(r => r.division === "D1" && r.IP > 0);

// team_drs + team_IP for pitcher dRS-behind
const teams = await allNoSeason("Teams Table", "id,source_id", null);
const tid2src = {}; for (const t of teams) tid2src[t.id] = t.source_id;
const snaps = await allNoSeason("team_war_snapshots", "source_team_id,team_drs", "season");
const src2drs = {}; for (const s of snaps) src2drs[String(s.source_team_id)] = s.team_drs;
const teamIP = {}; for (const p of PM) if (p.TeamID) teamIP[p.TeamID] = (teamIP[p.TeamID] || 0) + (p.IP || 0);

// dRS (drs_floor, pos≠P) + wSB (full) keyed by source_player_id
const def = await allNoSeason("player_season_defense", "source_player_id,position,drs_floor", "season");
const dwar = {}; for (const d of def) { if (d.position === "P") continue; const k = String(d.source_player_id); dwar[k] = (dwar[k] || 0) + (d.drs_floor || 0); }
const bsr = await allNoSeason("player_season_baserunning", "source_player_id,wsb_runs", "season");
const bwar = {}; for (const b of bsr) bwar[String(b.source_player_id)] = b.wsb_runs || 0;

// ── compute ──────────────────────────────────────────────────────────────────
const hg = hitSheet.gi, pg = pitSheet.gi;
const hitUpd = [], pitUpd = [];
let hMiss = 0, pMiss = 0;

for (const h of HM) {
  const row = hitSheet.rows[String(h.source_player_id)];
  if (!row) { hMiss++; continue; }
  const g = k => num(row[hg(k)]);
  const PA = g("PA"); if (PA <= 0) continue;
  const HR = g("HR"), T3 = g("3B"), T2 = g("2B"), Hh = g("H"), BB = g("BB"), HBP = g("HBP");
  const B1 = Math.max(0, Hh - T2 - T3 - HR);
  const woba = (WT.BB * BB + WT.HBP * HBP + WT["1B"] * B1 + WT["2B"] * T2 + WT["3B"] * T3 + WT.HR * HR) / PA;
  const wraa = ((woba - LGWOBA) / WSCALE) * PA;
  const desc_owar = wraa / RPW + (PA / 600) * OREPL;
  const d_war = (dwar[String(h.source_player_id)] || 0) / RPW;
  const bsr_war = (bwar[String(h.source_player_id)] || 0) / RPW;
  const total = desc_owar + d_war + bsr_war;
  hitUpd.push({ source_player_id: h.source_player_id, woba: r4(woba), wraa: r3(wraa), desc_owar: r3(desc_owar), d_war: r3(d_war), bsr_war: r3(bsr_war), total_desc_war: r3(total) });
}

for (const p of PM) {
  const row = pitSheet.rows[String(p.source_player_id)];
  if (!row) { pMiss++; continue; }
  const R = num(row[pg("R")]);
  const IP = p.IP, FIP = p.FIP;
  const RA9 = R * 9 / IP;
  const desc_fip_ra9 = (FIP != null ? FIP : RA9 / E2T) * E2T;
  const tdrs = src2drs[String(tid2src[p.TeamID])];
  const tIP = teamIP[p.TeamID];
  const drs_behind_per9 = (tdrs != null && tIP > 0) ? (tdrs * 9 / tIP) : 0;      // per-9 team-rate
  const drs_behind_runs = (tdrs != null && tIP > 0) ? (tdrs * IP / tIP) : 0;      // this pitcher's share
  const desc_ra9 = 0.5 * (RA9 + drs_behind_per9) + 0.5 * desc_fip_ra9;
  const desc_pwar = (REPL_RA9 - desc_ra9) * IP / 9 / RPW;
  pitUpd.push({ source_player_id: p.source_player_id, desc_ra9: r3(desc_ra9), desc_fip_ra9: r3(desc_fip_ra9), drs_behind: r3(drs_behind_runs), desc_pwar: r3(desc_pwar), total_desc_war: r3(desc_pwar) });
}

function r3(x) { return Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null; }
function r4(x) { return Number.isFinite(x) ? Math.round(x * 10000) / 10000 : null; }

// ── report (dry) ─────────────────────────────────────────────────────────────
const stat = (arr, k) => { const v = arr.map(r => r[k]).filter(x => x != null).sort((a, b) => a - b); return { n: v.length, min: v[0], p50: v[Math.floor(v.length / 2)], max: v[v.length - 1], mean: r3(v.reduce((s, x) => s + x, 0) / v.length) }; };
console.log(`\nHITTERS D1 ${HM.length} | computed ${hitUpd.length} | sheet-miss ${hMiss}`);
console.log("  desc_owar", stat(hitUpd, "desc_owar"), "\n  total_desc_war", stat(hitUpd, "total_desc_war"), "\n  d_war", stat(hitUpd, "d_war"), "bsr_war", stat(hitUpd, "bsr_war"));
console.log(`PITCHERS D1 ${PM.length} | computed ${pitUpd.length} | sheet-miss ${pMiss}`);
console.log("  desc_pwar", stat(pitUpd, "desc_pwar"), "\n  desc_ra9", stat(pitUpd, "desc_ra9"));

// spot-check named pitchers/hitters + the tiny-IP tail
const pByName = {}; for (const p of PM) { const row = pitSheet.rows[String(p.source_player_id)]; if (row) pByName[(row[pg("playerFullName")] || "").toLowerCase()] = { p, row }; }
const pmById = {}; for (const p of PM) pmById[String(p.source_player_id)] = p;
console.log("\nSPOT (pitchers):");
for (const nm of ["urbanczyk", "govel", "volantis", "o'harran"]) {
  const hit = Object.keys(pByName).find(k => k.includes(nm));
  if (!hit) { console.log(`  ${nm}: not found`); continue; }
  const u = pitUpd.find(x => String(x.source_player_id) === String(pByName[hit].p.source_player_id));
  const pm = pByName[hit].p;
  console.log(`  ${hit}: IP ${pm.IP} ERA ${pm.ERA} FIP ${pm.FIP} | desc_ra9 ${u.desc_ra9} desc_pwar ${u.desc_pwar} (drs_behind ${u.drs_behind})`);
}
// worst tiny-IP desc_ra9 offenders
const tail = [...pitUpd].sort((a, b) => b.desc_ra9 - a.desc_ra9).slice(0, 3).map(u => ({ ip: pmById[String(u.source_player_id)].IP, desc_ra9: u.desc_ra9, desc_pwar: u.desc_pwar }));
console.log("  tiny-IP tail (worst desc_ra9):", JSON.stringify(tail));

if (!COMMIT) { console.log("\n(dry run — pass --commit to write)"); process.exit(0); }

// ── write (concurrency-limited UPDATEs by source_player_id) ───────────────────
async function writeAll(table, updates) {
  let done = 0; const POOL = 24;
  for (let i = 0; i < updates.length; i += POOL) {
    await Promise.all(updates.slice(i, i + POOL).map(async u => {
      const { source_player_id, ...cols } = u;
      const { error } = await sb.from(table).update(cols).eq("source_player_id", source_player_id).eq("Season", SEASON);
      if (error) { console.error(table, source_player_id, error.message); }
    }));
    done += Math.min(POOL, updates.length - i);
    if (done % 2400 === 0 || done === updates.length) process.stdout.write(`\r  ${table}: ${done}/${updates.length}`);
  }
  console.log("");
}
console.log("\nwriting…");
await writeAll("Hitter Master", hitUpd);
await writeAll("Pitching Master", pitUpd);
console.log("done.");
