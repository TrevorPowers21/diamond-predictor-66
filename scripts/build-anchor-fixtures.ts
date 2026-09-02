/**
 * Build the anchor fixture set — task zero of AGENT_PHASE_ONE_SCOPE.md §2.
 *
 * Freezes REAL players from PROD (read-only) into src/test/anchors/anchors.fixture.json.
 * The anchor test then recomputes the end outputs from the frozen inputs and asserts they still
 * match. A formula, rollup, or filter change that silently moves a player's numbers fails the gate.
 *
 * WHY PROD, AND WHY FROZEN:
 *   - prod carries the 2026-09-01 verified data (608 consistent / 0 inconsistent)
 *   - the fixture is checked into the repo, so the gate never depends on a live DB or on staging
 *     drifting underneath it
 *
 * ⛔ FRESH ROWS ONLY (updated_at >= 2026-09-01) on every D1 shape. A pre-recalibration row frozen
 *    as an anchor pins the OLD behaviour as if it were correct — the quietest way for this gate to
 *    certify the wrong thing. JUCO is exempt: it is pinned as broken on purpose.
 *
 * ⛔ D1 IS THE CONSISTENCY BOUNDARY. Every shape except `juco_transfer` filters `division='D1'`.
 * Omitting that filter is exactly cause C1 — 477 JUCO rows were 27% of the calibration sample and
 * dragged the whole result. Measured 2026-09-02: D1 transfer oWAR reproduces 97.8%, JUCO 0.1%.
 * An unfiltered sample reports ~60% and means nothing.
 *
 * SHAPES COVERED (§2.1 requires shapes that break DIFFERENTLY, not just more rows):
 *   hitter · starting pitcher · relief pitcher · two-way player · JUCO transfer · returner ·
 *   zero/missing scouting inputs (the `0 -> —` case)
 *
 * READ-ONLY. This script never writes to any database.
 *   npx tsx scripts/build-anchor-fixtures.ts
 */
import { Client, types } from "pg";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";

// node-postgres hands back numeric (1700) and int8 (20) as STRINGS. Left unconverted they poison
// the fixture with string values that then silently pass !== comparisons. See knowledge/code-structure.
types.setTypeParser(1700, Number);
types.setTypeParser(20, Number);

// Match the existing script convention (scripts/_ki.ts) — read the gitignored env file directly
// rather than adding a dotenv dependency for one script.
function readEnv(file: string, key: string): string | undefined {
  try {
    const m = readFileSync(resolve(process.cwd(), file), "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
    return m?.[1]?.trim().replace(/^["']|["']$/g, "");
  } catch { return undefined; }
}

const ENV_FILE = ".env.production.local";        // PROD — read-only, see below
const CONN = process.env.PGURI || readEnv(ENV_FILE, "PGURI") || readEnv(ENV_FILE, "DATABASE_URL");
if (!CONN) {
  console.error(`✖ No PGURI/DATABASE_URL in ${ENV_FILE}`);
  process.exit(1);
}

/** Columns that define a fixture row. Inputs first, then the stored end outputs we assert on. */
const COLS = `
  pr.id, pr.player_id, pr.model_type, pr.variant, pr.season, pr.customer_team_id,
  pr.from_avg, pr.from_obp, pr.from_slg, pr.from_avg_plus, pr.from_obp_plus, pr.from_slg_plus,
  pr.to_avg_plus, pr.to_obp_plus, pr.to_slg_plus, pr.from_park_factor, pr.to_park_factor,
  pr.class_transition, pr.dev_aggressiveness,
  pr.from_era, pr.from_fip, pr.from_whip, pr.from_k9, pr.from_bb9, pr.from_hr9,
  pr.from_stuff_plus, pr.to_stuff_plus,
  pr.p_avg, pr.p_obp, pr.p_slg, pr.p_ops, pr.p_iso, pr.p_wrc, pr.p_wrc_plus,
  pr.p_era, pr.p_fip, pr.p_whip, pr.p_k9, pr.p_bb9, pr.p_hr9, pr.p_rv_plus,
  pr.o_war, pr.p_war, pr.d_war, pr.bsr_war, pr.total_hitter_war,
  pr.market_value, pr.twp_hitter_market_value, pr.twp_pitcher_market_value,
  pr.projected_ip, pr.projected_pa, pr.hitter_depth_role, pr.pitcher_depth_role, pr.pitcher_role,
  pr.power_rating_plus, pr.power_rating_score, pr.ev_score, pr.barrel_score, pr.chase_score,
  pr.updated_at,
  p.first_name, p.last_name, p.division, p.position, p.is_twp, p.class_year
`;

/**
 * One query per shape. Each is deliberately NARROW and deterministic:
 *   - ordered by player_id so the same rows come back on a re-run
 *   - guarded so a shape that genuinely has no qualifying rows returns 0 and is REPORTED,
 *     never silently backfilled with a row of a different shape
 */
const SHAPES: { key: string; why: string; sql: string }[] = [
  {
    key: "hitter_returner",
    why: "the ordinary hitter — an internal returner projection",
    sql: `SELECT ${COLS} FROM player_predictions pr JOIN players p ON p.id = pr.player_id
          WHERE pr.model_type = 'returner' AND p.division = 'D1' AND pr.updated_at >= '2026-09-01'
            AND pr.p_wrc_plus IS NOT NULL AND pr.o_war IS NOT NULL AND pr.projected_pa > 150
            AND COALESCE(p.is_twp,false) = false
          ORDER BY pr.player_id LIMIT 4`,
  },
  {
    key: "hitter_transfer",
    why: "the transfer path is a DIFFERENT implementation from the returner path",
    sql: `SELECT ${COLS} FROM player_predictions pr JOIN players p ON p.id = pr.player_id
          WHERE pr.model_type = 'transfer' AND p.division = 'D1' AND pr.updated_at >= '2026-09-01'
            AND pr.p_wrc_plus IS NOT NULL AND pr.o_war IS NOT NULL AND pr.projected_pa > 150
            AND COALESCE(p.is_twp,false) = false
          ORDER BY pr.player_id LIMIT 3`,
  },
  {
    key: "starting_pitcher",
    why: "pWAR scales off depth-role IP — the Neiswonger bug (1.14 -> 3.329) lived here",
    sql: `SELECT ${COLS} FROM player_predictions pr JOIN players p ON p.id = pr.player_id
          WHERE p.division = 'D1' AND pr.updated_at >= '2026-09-01' AND pr.p_war IS NOT NULL AND pr.p_rv_plus IS NOT NULL
            AND pr.projected_ip >= 60 AND COALESCE(p.is_twp,false) = false
          ORDER BY pr.player_id LIMIT 3`,
  },
  {
    key: "relief_pitcher",
    why: "low IP changes the replacement-level term's weight entirely",
    sql: `SELECT ${COLS} FROM player_predictions pr JOIN players p ON p.id = pr.player_id
          WHERE p.division = 'D1' AND pr.updated_at >= '2026-09-01' AND pr.p_war IS NOT NULL AND pr.p_rv_plus IS NOT NULL
            AND pr.projected_ip > 0 AND pr.projected_ip <= 40 AND COALESCE(p.is_twp,false) = false
          ORDER BY pr.player_id LIMIT 3`,
  },
  {
    key: "two_way",
    why: "BOTH sides on ONE row; shared market_value stays NULL, values in the twp_* columns",
    sql: `SELECT ${COLS} FROM player_predictions pr JOIN players p ON p.id = pr.player_id
          WHERE p.is_twp = true AND pr.updated_at >= '2026-09-01'
            AND (pr.twp_hitter_market_value IS NOT NULL OR pr.twp_pitcher_market_value IS NOT NULL)
          ORDER BY pr.player_id LIMIT 3`,
  },
  {
    key: "juco_transfer",
    why: "division is NJCAA_D1 (not 'JUCO'); ~62% stale on prod — pins CURRENT behaviour so a JUCO fix shows as a visible diff",
    sql: `SELECT ${COLS} FROM player_predictions pr JOIN players p ON p.id = pr.player_id
          WHERE p.division = 'NJCAA_D1' AND (pr.o_war IS NOT NULL OR pr.p_war IS NOT NULL)
          ORDER BY pr.player_id LIMIT 3`,
  },
  {
    key: "team_scoped_precomputed",
    why: "variant='precomputed' + a customer_team_id outranks global 'regular' in predRank",
    sql: `SELECT ${COLS} FROM player_predictions pr JOIN players p ON p.id = pr.player_id
          WHERE pr.variant = 'precomputed' AND pr.customer_team_id IS NOT NULL
            AND p.division = 'D1' AND pr.updated_at >= '2026-09-01'
            AND pr.p_wrc_plus IS NOT NULL AND pr.o_war IS NOT NULL
          ORDER BY pr.player_id LIMIT 3`,
  },
  {
    key: "zero_scouting_inputs",
    why: "exact zero is MISSING and must render as an em dash, not 0",
    sql: `SELECT ${COLS} FROM player_predictions pr JOIN players p ON p.id = pr.player_id
          WHERE pr.p_wrc_plus IS NOT NULL AND p.division = 'D1' AND pr.updated_at >= '2026-09-01'
            AND (pr.ev_score = 0 OR pr.barrel_score = 0 OR pr.chase_score = 0
                 OR pr.ev_score IS NULL OR pr.barrel_score IS NULL)
          ORDER BY pr.player_id LIMIT 3`,
  },
];
(async () => {
  const c = new Client({ connectionString: CONN, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const gen = await c.query(`SELECT max(updated_at) AS newest, count(*)::int AS n FROM player_predictions`);
  console.log(`prod player_predictions: ${gen.rows[0].n} rows, newest updated_at ${gen.rows[0].newest}`);

  const fixture: any = {
    _README: [
      "FROZEN ANCHOR FIXTURES — do NOT edit to make a test pass.",
      "Real players pulled read-only from PROD. An anchor failure means an output MOVED;",
      "changing an expectation is a human decision, always (AGENT_PHASE_ONE_SCOPE.md §2.2).",
      "Regenerate deliberately: npx tsx scripts/build-anchor-fixtures.ts",
    ],
    _generated_from: "prod",
    _prod_rows_at_capture: gen.rows[0].n,
    _newest_updated_at: gen.rows[0].newest,
    shapes: {} as Record<string, any>,
  };

  const missing: string[] = [];
  for (const s of SHAPES) {
    const r = await c.query(s.sql);
    fixture.shapes[s.key] = { why: s.why, count: r.rows.length, rows: r.rows };
    const mark = r.rows.length === 0 ? "✖ EMPTY" : `✔ ${r.rows.length}`;
    console.log(`  ${mark.padEnd(6)} ${s.key.padEnd(22)} ${s.why}`);
    if (r.rows.length === 0) missing.push(s.key);
  }

  await c.end();

  const dir = resolve(process.cwd(), "src/test/anchors");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "anchors.fixture.json"), JSON.stringify(fixture, null, 2) + "\n");

  const total = Object.values(fixture.shapes).reduce((a: number, s: any) => a + s.count, 0);
  console.log(`\nwrote src/test/anchors/anchors.fixture.json — ${total} players across ${SHAPES.length} shapes`);

  // A shape with no rows is INFORMATION, not an inconvenience to route around (§7 escalation rules).
  if (missing.length) {
    console.log(`\n⚠ SHAPES WITH NO QUALIFYING ROWS: ${missing.join(", ")}`);
    console.log("  Coverage is incomplete — these shapes are NOT gated. Report this, do not paper over it.");
  }
})().catch((e) => {
  console.error("✖", e.message);
  process.exit(1);
});
