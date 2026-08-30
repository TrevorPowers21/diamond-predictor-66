/**
 * Recompute MARKET fields in place on build player_snapshots from each snapshot's
 * own stored WAR at the build program's conference tier (+ slot position for
 * hitters), canonical fns (no PVF, floor $0). WAR + depth roles are already stored
 * on build snapshots and are left untouched — this only re-derives the dollar
 * figure so it's an exact function of the displayed WAR (e.g. Sifford's negative
 * market floors to $0).
 *
 *   npx tsx scripts/resync-build-snapshot-markets.ts [--all] [--apply]              # staging
 *   npx tsx --env-file .env.production.local scripts/… --prod [--all] [--apply]     # prod
 *   default = Georgia active build; --all = every build
 *
 * ⚠ 2026-08-30 FIX: this script used to hardcode `rd(".env.local", …)`, so neither
 * `--prod` nor `--env-file` could redirect it — an F42 "prod resync" silently
 * resynced STAGING and reported success. It is now env-driven (process.env first,
 * env-file fallback) and double-key-guarded: prod URL without `--prod` refuses, and
 * `--prod` without a prod URL refuses.
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import { computeHitterMarketValue, computePitcherMarketValue, pitcherRoleFromDepthRole } from "../src/lib/depthRoles";
import { DEFAULT_PITCHING_WEIGHTS as EQ } from "../src/lib/pitchingEquations";
const PROD_REF = "trbvxuoliwrfowibatkm";
const WANT_PROD = process.argv.includes("--prod");
const ENV_FILE = WANT_PROD ? ".env.production.local" : ".env.local";
const rd = (f: string, k: string) => { try { return (fs.readFileSync(f, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] || "").trim().replace(/^"|"$/g, ""); } catch { return ""; } };
// Env-driven: whatever `--env-file` loaded wins; the file is only a fallback.
const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || rd(ENV_FILE, "SUPABASE_URL") || rd(ENV_FILE, "VITE_SUPABASE_URL");
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || rd(ENV_FILE, "SUPABASE_SERVICE_ROLE_KEY");
const URL_IS_PROD = new RegExp(PROD_REF).test(SB_URL || "");
if (!SB_URL || !SB_KEY) { console.error(`✗ no Supabase URL/key resolved (env vars or ${ENV_FILE}). Refusing.`); process.exit(1); }
if (URL_IS_PROD && !WANT_PROD) { console.error(`✗ target is PROD (${PROD_REF}) but --prod was NOT passed. Refusing.`); process.exit(1); }
if (WANT_PROD && !URL_IS_PROD) { console.error(`✗ --prod passed but target is NOT prod: ${SB_URL}. Refusing.`); process.exit(1); }
console.log(`[target] ${URL_IS_PROD ? "PROD" : "STAGING"} ${SB_URL}`);
const sb = createClient(SB_URL, SB_KEY);
const APPLY = process.argv.includes("--apply"), ALL = process.argv.includes("--all");
// ⚠ STAGING build id. Verified 2026-08-30: this build does NOT exist on prod, so the
// default (non---all) scope returns 0 rows there. On prod, pass --all or the prod build id.
const GA_BUILD = "7429b448-17be-42a1-9434-86f54ab24e49";
const num = (v: any) => v == null ? null : Number(v);
const isPit = (s: any) => /^(SP|RP|CL|P|LHP|RHP)/i.test(String(s || ""));

(async () => {
  // build_id → conference  (team_builds.customer_team_id → customer_teams.school_team_id → Teams Table.conference)
  const { data: cts } = await sb.from("customer_teams").select("id, school_team_id");
  const teamIds = [...new Set((cts || []).map((c: any) => c.school_team_id).filter(Boolean).map(String))];
  const teamConf = new Map<string, string>();
  for (let i = 0; i < teamIds.length; i += 200) { const { data } = await sb.from("Teams Table").select("id, conference").in("id", teamIds.slice(i, i + 200)); for (const t of (data || [])) teamConf.set(String(t.id), t.conference); }
  const ctConf = new Map<string, string>(); for (const c of (cts || [])) { const cf = teamConf.get(String(c.school_team_id)); if (cf) ctConf.set(c.id, cf); }
  const { data: builds } = await sb.from("team_builds").select("id, customer_team_id");
  const buildConf = new Map<string, string>(); for (const b of (builds || [])) { const cf = ctConf.get((b as any).customer_team_id); if (cf) buildConf.set(b.id, cf); }

  let bps: any[] = [];
  { let f = 0; for (;;) { let q = sb.from("team_build_players").select("id, build_id, player_id, position_slot, player_snapshot").order("id").range(f, f + 999); if (!ALL) q = q.eq("build_id", GA_BUILD); const { data, error } = await q; if (error) throw error; bps = bps.concat(data || []); if (!data || data.length < 1000) break; f += 1000; } }
  const pids = [...new Set(bps.map((r: any) => r.player_id))];
  const posName = new Map<string, string>(), playerPos = new Map<string, string>();
  for (let i = 0; i < pids.length; i += 200) { const { data } = await sb.from("players").select("id, first_name, last_name, position").in("id", pids.slice(i, i + 200)); for (const p of (data || [])) { posName.set(p.id, `${p.first_name} ${p.last_name}`); playerPos.set(p.id, p.position); } }

  let changed = 0, noConf = 0; const updates: { id: string; player_snapshot: any }[] = [], samples: string[] = [];
  for (const r of (bps || [])) {
    const conf = buildConf.get(r.build_id); if (!conf) { noConf++; continue; }
    const s = { ...(r.player_snapshot || {}) }; if (!Object.keys(s).length) continue;
    const before = JSON.stringify(s);
    const isTwp = !!s.is_twp, owar = num(s.o_war), pwar = num(s.p_war);
    // ONLY the unambiguous, position-independent error: a non-positive WAR must
    // floor to $0 (canonical), but stale rows kept a positive dollar. Positive-WAR
    // hitter markets depend on position (slot may be null → the bake resolves it
    // per-player) so we leave those to the app's live bake, never guess here.
    const floorNeg = (war: number | null, stored: any) => (war != null && war <= 0 && stored != null && Math.abs(num(stored)!) > 1) ? 0 : undefined;
    if (isTwp) { const h = floorNeg(owar, s.twp_hitter_market_value), p = floorNeg(pwar, s.twp_pitcher_market_value); if (h !== undefined) s.twp_hitter_market_value = h; if (p !== undefined) s.twp_pitcher_market_value = p; }
    else { const side = owar != null ? owar : pwar; const f = floorNeg(side, s.market_value); if (f !== undefined) s.market_value = f; }
    const os = r.player_snapshot || {};
    if (JSON.stringify(s) !== before) {
      changed++; updates.push({ id: r.id, player_snapshot: s });
      if (samples.length < 15) samples.push(`  ${posName.get(r.player_id)} [${r.position_slot}]: mv ${os.market_value == null ? "—" : Math.round(os.market_value)}→${s.market_value == null ? "—" : Math.round(s.market_value)}${isTwp ? ` twpH ${os.twp_hitter_market_value == null ? "—" : Math.round(os.twp_hitter_market_value)}→${s.twp_hitter_market_value == null ? "—" : Math.round(s.twp_hitter_market_value)} twpP ${os.twp_pitcher_market_value == null ? "—" : Math.round(os.twp_pitcher_market_value)}→${s.twp_pitcher_market_value == null ? "—" : Math.round(s.twp_pitcher_market_value)}` : ""}`);
    }
  }
  console.log(`scope=${ALL ? "ALL builds" : "Georgia active build"}  rows=${bps?.length}  changed=${changed}  noConf=${noConf}`);
  if (!ALL && (bps?.length ?? 0) === 0) console.log(`⚠ 0 rows for build ${GA_BUILD} on this env — wrong build id for this project. Use --all or the correct build id.`);
  samples.forEach((s) => console.log(s));
  if (!APPLY) { console.log("\n(dry-run — no writes. Add --apply.)"); return; }
  for (let i = 0; i < updates.length; i++) { const { error } = await sb.from("team_build_players").update({ player_snapshot: updates[i].player_snapshot }).eq("id", updates[i].id); if (error) console.log("err", updates[i].id, error.message); if ((i + 1) % 50 === 0) process.stdout.write(`\r  ${i + 1}/${updates.length}`); }
  console.log(`\n✅ applied ${updates.length}`);
})();
