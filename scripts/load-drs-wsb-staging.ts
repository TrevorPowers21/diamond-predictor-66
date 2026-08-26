/**
 * Load dRS + wSB per-season outputs into STAGING or PROD.
 *   npx tsx scripts/load-drs-wsb-staging.ts                 # staging (.env.local)
 *   npx tsx scripts/load-drs-wsb-staging.ts --dry-run       # staging, no writes
 *   npx tsx scripts/load-drs-wsb-staging.ts --prod          # PROD (.env.production.local) — explicit go
 *   npx tsx scripts/load-drs-wsb-staging.ts --prod --dry-run
 *
 * Reads scripts/drs/output/player_season_defense.csv + player_season_baserunning.csv,
 * resolves each row's player to players.id (uuid): source_player_id first (99.985%),
 * then a (team-abbrev, "F. Last") name fallback for the defensive-only residuals.
 * Anything still unresolved is LOGGED, never silently dropped. Upserts keyed on uuid.
 * The dRS/wSB CSV values are league-wide (computed from the TruMedia Standard export) and
 * ENV-INDEPENDENT — the same CSVs load into either DB; only the uuid resolution is per-env,
 * so prod resolves against PROD's players/Teams Table. Prereq: migration
 * 20260805_player_season_defense_baserunning.sql applied on the target DB first.
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const IS_PROD = process.argv.includes("--prod");
const DRY_RUN = process.argv.includes("--dry-run");
const ENV_FILE = IS_PROD ? ".env.production.local" : ".env.local";
const env = fs.readFileSync(ENV_FILE, "utf8");
const get = (k: string) => (env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] || "").trim();
const url = get("SUPABASE_URL"), key = get("SUPABASE_SERVICE_ROLE_KEY");
// Env-detection guard (mirror the precompute batch scripts): refuse to write prod unless --prod
// is explicit, and refuse --prod against a non-prod URL.
const looksProd = /trbvxuoliwrfowibatkm/.test(url);
if (looksProd && !IS_PROD) { console.error("✗ SUPABASE_URL looks like PROD but --prod not passed. Refusing."); process.exit(1); }
if (IS_PROD && !looksProd) { console.error("✗ --prod passed but SUPABASE_URL is not prod. Refusing."); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });
const DRS_OUT = "scripts/drs/output";

function readCsv(p: string): Record<string, string>[] {
  const txt = fs.readFileSync(p, "utf8").trim();
  const lines = txt.split("\n");
  const hdr = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((ln) => {
    // outputs have no embedded commas/quotes in these columns
    const cells = ln.split(",");
    const o: Record<string, string> = {};
    hdr.forEach((h, i) => (o[h] = (cells[i] ?? "").trim()));
    return o;
  });
}
const num = (v: string) => (v === "" || v === "None" || v == null ? null : Number(v));
const int = (v: string) => (v === "" || v === "None" || v == null ? null : parseInt(v, 10));

async function fetchAll(table: string, cols: string): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await (sb as any).from(table).select(cols).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
async function upsertChunks(table: string, rows: any[], conflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await (sb as any).from(table).upsert(rows.slice(i, i + 500), { onConflict: conflict });
    if (error) throw new Error(`${table} upsert: ${error.message}`);
  }
}

async function main() {
  console.log(`target: ${url.match(/https:\/\/([a-z]+)/)?.[1]} (${IS_PROD ? "🔴 PROD" : "STAGING"})${DRY_RUN ? " [DRY RUN — no writes]" : ""}`);

  // identity maps from players (+ Teams Table for the abbrev fallback)
  const players = await fetchAll("players", "id, first_name, last_name, source_player_id, team_id");
  const teams = await fetchAll("Teams Table", "id, abbreviation");
  const abbrevByTeamId = new Map<string, string>(teams.map((t) => [String(t.id), t.abbreviation]));
  const bySrc = new Map<string, string>();
  const byName = new Map<string, string>(); // (abbrev, "F. Last") -> id
  for (const p of players) {
    if (p.source_player_id) bySrc.set(String(p.source_player_id), p.id);
    const ab = abbrevByTeamId.get(String(p.team_id));
    if (ab && p.first_name && p.last_name) {
      byName.set(`${ab}|${p.first_name[0]}. ${p.last_name}`.toLowerCase(), p.id);
    }
  }
  console.log(`players: ${players.length}  bySrc: ${bySrc.size}  byName: ${byName.size}`);

  const resolve = (srcId: string, team: string, name: string) =>
    (srcId && bySrc.get(srcId)) || byName.get(`${team}|${name}`.toLowerCase()) || null;

  // ---- defense ----
  const dRows = readCsv(path.join(DRS_OUT, "player_season_defense.csv"));
  const defUp: any[] = []; const defMiss: string[] = [];
  for (const r of dRows) {
    const pid = resolve(r.source_player_id, r.team, r.player);
    if (!pid) { defMiss.push(`${r.player} (${r.team} ${r.position})`); continue; }
    defUp.push({
      player_id: pid, source_player_id: r.source_player_id || null, season: int(r.season),
      team: r.team, position: r.position, games: int(r.games), half_innings: int(r.half_innings),
      bip_opportunities: num(r.bip_opportunities), bip_faced: num(r.bip_faced),
      tracking_coverage: num(r.tracking_coverage),
      range_runs: num(r.range_runs), range_gb: num(r.range_gb), range_ld: num(r.range_ld),
      range_fb: num(r.range_fb), error_runs: num(r.error_runs), dp_runs: num(r.dp_runs),
      arm_runs: num(r.arm_runs), framing_runs: num(r.framing_runs), blocking_runs: num(r.blocking_runs),
      throwing_runs: num(r.throwing_runs), bunt_runs: num(r.bunt_runs),
      drs_total: num(r.drs_total), drs_floor: num(r.drs_floor), drs_ceiling: num(r.drs_ceiling),
      plays_made: int(r.plays_made), errors: int(r.errors), assists: int(r.assists),
      putouts: int(r.putouts), pop_time_avg: num(r.pop_time_avg),
      constants_version: r.constants_version, engine_version: r.engine_version,
    });
  }
  if (!DRY_RUN) await upsertChunks("player_season_defense", defUp, "player_id,position,season");
  console.log(`player_season_defense: ${defUp.length} ${DRY_RUN ? "would upsert" : "upserted"}, ${defMiss.length} unresolved`);
  if (defMiss.length) console.log("  unresolved defense:", defMiss.slice(0, 20).join("; "));

  // ---- baserunning (wSB playerId IS source_player_id) ----
  const bRows = readCsv(path.join(DRS_OUT, "player_season_baserunning.csv"));
  const bsrUp: any[] = []; const bsrMiss: string[] = [];
  for (const r of bRows) {
    const pid = bySrc.get(r.playerId) || null;
    if (!pid) { bsrMiss.push(`${r.player} (${r.org_id})`); continue; }
    bsrUp.push({
      player_id: pid, source_player_id: r.playerId || null, season: int(r.season),
      org_id: r.org_id, position: r.position, games: int(r.games), opportunities: num(r.opportunities),
      sb: int(r.SB), cs: int(r.CS), sbh: int(r.SBH),
      wsb_runs: num(r.wsb_runs), wsb_runs_reg: num(r.wsb_runs_reg),
      constants_version: r.constants_version, engine_version: r.engine_version,
    });
  }
  if (!DRY_RUN) await upsertChunks("player_season_baserunning", bsrUp, "player_id,season");
  console.log(`player_season_baserunning: ${bsrUp.length} ${DRY_RUN ? "would upsert" : "upserted"}, ${bsrMiss.length} unresolved`);
  if (bsrMiss.length) console.log("  unresolved bsr:", bsrMiss.slice(0, 20).join("; "));
}
main().catch((e) => { console.error(e); process.exit(1); });
