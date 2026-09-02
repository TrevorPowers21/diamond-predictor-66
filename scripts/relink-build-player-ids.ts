/**
 * RELINK `team_build_players.player_id` FROM THE ROW'S NAME
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY. 191 prod rows (22 staging) carry NO `player_id`. They are the same rows that have no
 * `neutral_snapshot`, because nothing can be derived for a row with no identity. Measured 2026-09-01:
 *   PROD    191 → 72 uniquely matchable · 54 no name at all · 64 name matches nothing · 1 ambiguous
 *   STAGING  22 →  2 uniquely matchable ·  0 no name        · 20 name matches nothing · 0 ambiguous
 *
 * ⛔ NO ID IS RECOVERABLE. Verified: `source_player_id` appears in `production_notes` **0** times and
 *    `player_id` **0** times. 176 rows carry `transferSnapshot`, 137 carry `localPlayer`
 *    (first/last/position/team/from_team/conference). So the ONLY key back to a person is the NAME.
 *
 * 🛑 NAME MATCHING IS THE HARRISON COOK TRAP — READ THIS BEFORE CHANGING THE MATCH RULE.
 *    Trevor's standing rule is IDs over names ([[feedback_id_over_name]]), and this script breaks it
 *    knowingly, under three guards:
 *      1. UNIQUE match only — exactly one `players` row may bear the name. Harrison Cook has TWO
 *         (a D1 stub and a JUCO player), so a row naming him lands in AMBIGUOUS and is SKIPPED, not
 *         guessed. Two Ethan Smiths exist for the same reason.
 *      2. NEVER overwrites — the UPDATE is guarded `WHERE player_id IS NULL`.
 *      3. Every skip is reported with its reason; nothing fails silently.
 *    ⇒ A unique name match is still a heuristic. It is defensible for 72 rows that are otherwise
 *      unreachable, but it is NOT a substitute for the ID path. Do not relax guard 1.
 *
 * ⚠ WHAT THIS DOES NOT DO. Linking `player_id` does not create a `neutral_snapshot`. That is a
 *   separate step (`scripts/backfill-neutral-snapshots.ts`), and it only helps rows whose prediction
 *   row actually carries a WAR — most of these will still have nothing to copy.
 *
 * USAGE — DRY RUN IS THE DEFAULT. Nothing writes without --apply.
 *   npx tsx scripts/relink-build-player-ids.ts                 # staging, dry run
 *   npx tsx scripts/relink-build-player-ids.ts --list          # dry run + print every proposed link
 *   npx tsx scripts/relink-build-player-ids.ts --apply         # staging, WRITES
 *   npx tsx scripts/relink-build-player-ids.ts --prod --list   # prod, dry run, full review list
 *   npx tsx scripts/relink-build-player-ids.ts --prod --apply  # prod, WRITES
 */
import fs from "fs";
import pg from "pg";

const isProd = process.argv.includes("--prod");
const apply = process.argv.includes("--apply");
const showList = process.argv.includes("--list");
/**
 * --active-only : restrict to builds with `is_active = true` (Trevor, 2026-09-01: "only the real
 * builds are necessary"). `is_active` is the right discriminator here, NOT the build NAME — the
 * dead ones are demos/samples (`5/4 Kansas Demo`, `Georgia Example Build 2`, `TCU Demo Team
 * Bii==uild`), several with a NULL customer_team_id, and name-sniffing for "demo" would be another
 * string heuristic layered on top of the one this script already takes on.
 * Measured on prod: 191 orphans total, but only 49 sit on an ACTIVE build across 5 builds
 * (Vanderbilt Projected 15 · Arkansas Baseball 2027 Roster 13 · BYU 2027 10 · My Team Build 8 ·
 * 2027 Proj Jayhawks 3). Linking the other ~142 would spend the IDs-over-names exception on
 * throwaway data.
 */
const activeOnly = process.argv.includes("--active-only");
const envFile = isProd ? ".env.production.local" : ".env.local";

const C = { red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", dim: "\x1b[2m", reset: "\x1b[0m" };

function pguri(): string {
  const env = fs.readFileSync(envFile, "utf8");
  const m = env.match(/^PGURI=(.*)$/m);
  if (!m) throw new Error(`No PGURI in ${envFile}`);
  return m[1].trim().replace(/^["']|["']$/g, "");
}

/** Lowercase, strip punctuation/accents-ish, collapse whitespace. Deliberately conservative: a
 *  looser normaliser would create MORE matches, and more matches on a heuristic is worse, not better. */
const norm = (s: unknown) =>
  String(s ?? "").toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

async function main() {
  const client = new pg.Client({ connectionString: pguri() });
  await client.connect();
  await client.query("set statement_timeout='10min'");
  const db = await client.query("select current_database() db");
  console.log(`### DB: ${envFile} (${db.rows[0].db}) · APPLY=${apply} ###`);
  if (isProd && apply) console.log(`${C.red}!!! PROD WRITE !!!${C.reset}`);

  console.log(activeOnly ? "scope: ACTIVE builds only" : `${C.yellow}scope: ALL builds (including demos)${C.reset}`);
  const { rows: orphans } = await client.query(
    `select tbp.id, tbp.custom_name, tbp.position_slot, tbp.production_notes, tbp.source,
            tb.customer_team_id, tb.name as build_name, tb.is_active
     from team_build_players tbp
     join team_builds tb on tb.id = tbp.build_id
     where tbp.player_id is null
       ${activeOnly ? "and tb.is_active = true" : ""}
     order by tbp.custom_name nulls last`,
  );
  const { rows: players } = await client.query(
    `select id, first_name, last_name, team, position, division from players`,
  );

  const byName = new Map<string, any[]>();
  for (const p of players) {
    const k = norm(`${p.first_name} ${p.last_name}`);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k)!.push(p);
  }

  const link: { id: string; playerId: string; name: string; who: any; build: string }[] = [];
  const skipped: { name: string; reason: string; detail?: string }[] = [];

  for (const r of orphans as any[]) {
    let lp: any = null;
    try {
      const pn = typeof r.production_notes === "string" ? JSON.parse(r.production_notes) : r.production_notes;
      lp = pn?.localPlayer ?? null;
    } catch { /* malformed notes are just a missing hint, not an error */ }

    const name = r.custom_name || (lp ? `${lp.first_name ?? ""} ${lp.last_name ?? ""}`.trim() : null);
    if (!name) { skipped.push({ name: "(no name)", reason: "no custom_name and no localPlayer" }); continue; }

    const cands = byName.get(norm(name)) ?? [];
    if (cands.length === 0) { skipped.push({ name, reason: "no players row bears this name" }); continue; }
    if (cands.length > 1) {
      // ⛔ The Harrison Cook case lands here BY DESIGN. Do not "resolve" it with team/position —
      //    a wrong link silently attaches a build row to the wrong human, which is worse than a null.
      skipped.push({ name, reason: `AMBIGUOUS — ${cands.length} players share this name`,
        detail: cands.map((p) => `${p.division}/${p.team ?? "?"}/${p.position ?? "?"}`).join(" | ") });
      continue;
    }
    link.push({ id: r.id, playerId: cands[0].id, name, who: cands[0], build: r.build_name });
  }

  console.log(`orphans: ${orphans.length} · ${C.green}linkable: ${link.length}${C.reset} · skipped: ${skipped.length}`);

  const byReason = new Map<string, number>();
  for (const s of skipped) {
    const key = s.reason.startsWith("AMBIGUOUS") ? "AMBIGUOUS" : s.reason;
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }
  console.log("skip reasons:");
  for (const [k, v] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${String(v).padStart(4)}  ${k}`);
  for (const s of skipped.filter((x) => x.reason.startsWith("AMBIGUOUS"))) {
    console.log(`   ${C.yellow}⚠ ${s.name}${C.reset} → ${s.detail}`);
  }

  if (showList) {
    console.log("\n── every proposed link (review these before --apply) ──");
    for (const l of link) {
      console.log(`   ${l.name.padEnd(24)} → ${l.who.division}/${l.who.team ?? "?"}/${l.who.position ?? "?"}  ${C.dim}${l.playerId}${C.reset}  [${l.build}]`);
    }
  }

  if (!apply) {
    console.log(`\n${C.yellow}DRY RUN — nothing written.${C.reset} Re-run with --apply to link ${link.length} rows.`);
    await client.end();
    return;
  }

  let done = 0;
  for (const l of link) {
    // `player_id is null` in the WHERE makes this idempotent and impossible to overwrite a real link.
    const r = await client.query(
      `update team_build_players set player_id = $2 where id = $1 and player_id is null`,
      [l.id, l.playerId],
    );
    done += r.rowCount ?? 0;
  }
  console.log(`${C.green}✅ linked ${done}/${link.length}${C.reset}`);
  console.log(`RELINK_SUMMARY env=${isProd ? "prod" : "staging"} apply=${apply} linked=${done} skipped=${skipped.length}`);
  await client.end();
}

main().catch((e) => { console.error(`${C.red}FAILED:${C.reset}`, e.message); process.exit(1); });
