/**
 * Phase C step 20 — backfill pitch_log.park_code from the DRS Pitch Log CSVs.
 *
 * pitch_log has no game_string on prod; park_code (= gameString minus trailing 9 digits minus
 * "cs-") is derived from the CSVs, loaded into a helper table `_park_code_fix` keyed by
 * uniq_pitch_id, then joined into pitch_log via a raised-timeout UPDATE. Self-contained +
 * env-driven + --prod-guarded (was staging-hardcoded + missing the UPDATE — gap closed).
 * `_park_code_fix` is a temp helper; drop it in Phase H cleanup.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/backfill_park_code_load.ts            # STAGING
 *   npx tsx --env-file .env.production.local scripts/backfill_park_code_load.ts --prod    # PROD
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "node:fs";

const IS_PROD = process.argv.includes("--prod");
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
if (/trbvxuoliwrfowibatkm/.test(url) && !IS_PROD) { console.error("✗ URL is PROD but --prod not passed."); process.exit(1); }
if (IS_PROD && !/trbvxuoliwrfowibatkm/.test(url)) { console.error("✗ --prod passed but URL not prod."); process.exit(1); }
const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }) as any;
const parkCode = (s: string | null) => { if (!s) return null; const t = s.replace(/\d{9}$/, "").replace(/^cs-/, ""); return t || null; };

(async () => {
  console.log(`target: ${IS_PROD ? "🔴 PROD" : "STAGING"}`);
  // 1) helper table
  await sb.rpc("exec_sql", { sql: "create table if not exists _park_code_fix (uniq_pitch_id text primary key, park_code text);" });
  await sb.rpc("exec_sql", { sql: "NOTIFY pgrst, 'reload schema';" });
  await new Promise((r) => setTimeout(r, 2500));
  // 2) read CSVs → uniq_pitch_id → park_code
  const dir = "docs/drs-reference";
  const files = readdirSync(dir).filter((f) => /DRS Pitch Log\.csv$/.test(f));
  const map = new Map<string, string | null>();
  for (const f of files) {
    const lines = readFileSync(`${dir}/${f}`, "utf-8").split("\n");
    const hdr = lines[0].split(",");
    const ui = hdr.indexOf("uniqPitchId"), gi = hdr.indexOf("gameString");
    if (ui < 0 || gi < 0) { console.log("skip (no cols):", f); continue; }
    for (let i = 1; i < lines.length; i++) { const c = lines[i].split(","); const u = c[ui]?.trim(), g = c[gi]?.trim(); if (u && g) map.set(u, parkCode(g)); }
  }
  const rows = [...map.entries()].map(([u, pc]) => ({ uniq_pitch_id: u, park_code: pc }));
  console.log(`loaded ${rows.length} uniq_pitch_id→park_code from ${files.length} CSVs`);
  // 3) upsert into _park_code_fix
  const B = 5000; let done = 0;
  for (let i = 0; i < rows.length; i += B) {
    const { error } = await sb.from("_park_code_fix").upsert(rows.slice(i, i + B), { onConflict: "uniq_pitch_id" });
    if (error) throw new Error(`upsert @${i}: ${error.message}`);
    done += Math.min(B, rows.length - i);
    if (done % 200000 < B) console.log(`  upserted ${done}`);
  }
  console.log(`_park_code_fix loaded: ${done}`);
  // 4) UPDATE pitch_log.park_code (raised timeout, only where different)
  console.log("updating pitch_log.park_code...");
  const t0 = Date.now();
  const { error: ue } = await sb.rpc("exec_sql", { sql:
    "set local statement_timeout='900s'; update pitch_log pl set park_code = f.park_code from _park_code_fix f where f.uniq_pitch_id = pl.uniq_pitch_id and pl.park_code is distinct from f.park_code;" });
  if (ue && !/upstream request timeout/i.test(ue.message)) throw new Error(`UPDATE: ${ue.message}`);
  console.log(`  UPDATE issued (${ue ? "gateway timeout — likely committed server-side; verify" : "ok"}) [${((Date.now() - t0) / 1000).toFixed(0)}s]`);
})();
