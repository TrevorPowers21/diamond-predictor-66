/**
 * BACKFILL `pitch_log.game_string` FROM THE SOURCE DRS PITCH-LOG CSVs.
 *
 * WHY: `game_string` is **0 / 2,576,146 on PROD** (staging 2,576,146). It is NOT a derived value — it is an
 * identifier that arrives with the export and is written at INGEST (`scripts/ingest_pitch_log.ts:325`,
 * `textOrNull(get(row, cols, "gameString"))`). Prod was ingested from a load that lost it.
 *
 * WHAT IT BREAKS WHILE NULL:
 *   • per-pitcher IP (outs ÷ 3) — the half-inning key is (game_string, inn); `scripts/fill_pitcher_totals_ip.ts`
 *     derives **0 pitchers** on prod today.
 *   • `refresh_team_season_stats` step 5 (team W/L records) — "game key = game_string = EXACT game id,
 *     doubleheader-safe". With NULLs there is nothing to key on.
 *
 * SOURCE: docs/drs-reference/*DRS Pitch Log*.csv — 34 files, `uniqPitchId` (col 7) → `gameString` (col 4).
 *   VERIFIED: 2,576,230 distinct uniqPitchId, **0 rows with an empty gameString**, 100% coverage of prod's rows.
 *   ⛔ NOT copied from staging: this reads the same source export staging was loaded from, so the value is
 *      re-derived per environment rather than cloned (`feedback_derive_over_copy`).
 *
 * SAFETY: only fills rows where `game_string IS NULL` — never overwrites an existing value. Idempotent.
 *
 *   staging: npx tsx scripts/backfill_pitch_log_game_string.ts            [--apply]
 *   prod:    npx tsx scripts/backfill_pitch_log_game_string.ts --prod     [--apply]
 */
import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const PROD_FLAG = process.argv.includes("--prod");
const SEASON = Number((process.argv.find((a) => a.startsWith("--season=")) || "").split("=")[1] || 2026);

const envFile = PROD_FLAG ? ".env.production.local" : ".env.local";
const PGURI = readFileSync(envFile, "utf8").split("\n").find((l) => l.startsWith("PGURI="))
  ?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "") || "";
if (!PGURI) { console.error(`✗ No PGURI in ${envFile}`); process.exit(1); }
const isProd = /trbvxuoliwrfowibatkm/.test(PGURI);
if (isProd !== PROD_FLAG) { console.error("✗ env/flag mismatch — refusing."); process.exit(1); }
console.log(`[env] ${isProd ? "🔴 PROD" : "STAGING/other"}  season=${SEASON}  mode=${APPLY ? "APPLY" : "DRY-RUN"}`);

const DIR = "docs/drs-reference";

/** quote-aware CSV line split (team names contain commas) */
function splitLine(line: string): string[] {
  const out: string[] = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur); return out;
}

function loadMap(): Map<string, string> {
  const files = readdirSync(DIR).filter((f) => /DRS Pitch Log.*\.csv$/i.test(f)).sort();
  const m = new Map<string, string>();
  let rows = 0, empties = 0;
  for (const f of files) {
    const lines = readFileSync(`${DIR}/${f}`, "utf8").split("\n");
    if (!lines.length) continue;
    const H = splitLine(lines[0]).map((s) => s.trim());
    const iu = H.indexOf("uniqPitchId"), ig = H.indexOf("gameString");
    if (iu < 0 || ig < 0) { console.warn(`  ⚠ ${f}: missing uniqPitchId/gameString — skipped`); continue; }
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i]) continue;
      const c = splitLine(lines[i]);
      const u = (c[iu] || "").trim(), g = (c[ig] || "").trim();
      if (!u) continue;
      rows++;
      if (!g) { empties++; continue; }
      m.set(u, g);
    }
  }
  console.log(`  read ${files.length} files · ${rows.toLocaleString()} rows · ${m.size.toLocaleString()} distinct uniqPitchId · ${empties} empty gameString`);
  return m;
}

async function main() {
  const c = new pg.Client({ connectionString: PGURI });
  await c.connect();
  try {
    const before = (await c.query(
      `select count(*) total, count(game_string) filled from pitch_log where season=$1`, [SEASON])).rows[0];
    console.log(`BEFORE — pitch_log ${Number(before.total).toLocaleString()} rows, game_string filled ${Number(before.filled).toLocaleString()}`);

    const map = loadMap();
    if (!map.size) { console.error("✗ no mapping loaded — ABORT"); process.exit(1); }

    // how many of prod's NULL rows can we actually resolve?
    const nullIds = (await c.query(
      `select uniq_pitch_id from pitch_log where season=$1 and game_string is null`, [SEASON])).rows;
    const resolvable = nullIds.filter((r) => map.has(String(r.uniq_pitch_id))).length;
    console.log(`  NULL rows: ${nullIds.length.toLocaleString()} · resolvable from CSV: ${resolvable.toLocaleString()} (${(100 * resolvable / (nullIds.length || 1)).toFixed(2)}%)`);
    const sample = nullIds.slice(0, 3).map((r) => `${r.uniq_pitch_id} → ${map.get(String(r.uniq_pitch_id)) ?? "(unresolved)"}`);
    console.log(`  sample: ${sample.join(" · ")}`);

    if (!APPLY) { console.log("\nDRY-RUN — no writes. Re-run with --apply."); return; }
    if (resolvable === 0) { console.error("✗ nothing resolvable — ABORT"); process.exit(1); }

    // ★ BATCHED UPDATE. Two earlier failures shaped this:
    //   1. `create temp table … ON COMMIT DROP` — node-postgres autocommits every statement, so the CREATE committed
    //      and dropped the table before the inserts ran ("relation _gs_map does not exist").
    //   2. ONE set-based UPDATE over 2.5M rows exceeded prod's `statement_timeout` (2min) and rolled back whole.
    // So: no temp table at all — feed each chunk straight into the UPDATE via unnest(). Each chunk autocommits, stays
    // well under the timeout, and a mid-run failure leaves a PARTIAL fill that is safe to resume (the WHERE clause is
    // `game_string is null`, so re-running only touches what is still empty).
    const entries = [...map.entries()];
    const CHUNK = 25000;
    let updated = 0, done = 0;
    const t0 = Date.now();
    for (let i = 0; i < entries.length; i += CHUNK) {
      const slice = entries.slice(i, i + CHUNK);
      const res = await c.query(
        `update pitch_log p set game_string = m.gs
         from unnest($1::text[], $2::text[]) as m(upid, gs)
         where p.uniq_pitch_id = m.upid and p.season = $3 and p.game_string is null`,
        [slice.map((e) => e[0]), slice.map((e) => e[1]), SEASON]);
      updated += res.rowCount ?? 0;
      done += slice.length;
      const pct = (100 * done / entries.length).toFixed(1);
      process.stdout.write(`\r  ${done.toLocaleString()}/${entries.length.toLocaleString()} (${pct}%) · updated ${updated.toLocaleString()} · ${((Date.now() - t0) / 60000).toFixed(1)}m   `);
    }
    console.log(`\n✓ updated ${updated.toLocaleString()} rows`);

    const after = (await c.query(
      `select count(*) total, count(game_string) filled, count(distinct game_string) games from pitch_log where season=$1`, [SEASON])).rows[0];
    console.log(`AFTER  — filled ${Number(after.filled).toLocaleString()} / ${Number(after.total).toLocaleString()} · distinct games ${Number(after.games).toLocaleString()}`);
  } finally { await c.end(); }
}
main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
