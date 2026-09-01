/**
 * BACKFILL `team_build_players.neutral_snapshot`
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS. `neutral_snapshot` is the immutable dev_agg=0 base that a DIRTY toggle recomputes
 * from. The guardrail is `p.neutralPrediction ?? p.prediction` in
 * `useTeamBuilderSimulation.ts:1344` — when `neutral_snapshot` is NULL that `??` falls through to
 * `p.prediction`, which is the ALREADY-ADJUSTED snapshot, and every toggle then compounds on the
 * previous one instead of on neutral. Measured 2026-09-01: prod's active Arkansas build had 13 of 41
 * rows with no neutral_snapshot; staging had 29 of 1,236.
 *
 * WHAT A NEUTRAL SNAPSHOT IS (Trevor, 2026-09-01): *"just a simple copy of precomputed projections
 * into team build."* So it is rebuilt from the player's stored prediction row — NOT from
 * `player_snapshot`, which already has the coach's toggles baked in. Rebuilding from `player_snapshot`
 * would bake the adjustment into the neutral base and make the compounding permanent.
 *
 * ROW SELECTION mirrors the edge fn's predRank and TB's own precedence:
 *   this build's customer_team_id + variant='precomputed'   (preferred)
 *   → global variant='regular' + customer_team_id IS NULL   (a returner has no precompute at his own
 *                                                            school, so he must fall to global)
 *
 * SHAPE is matched to the rows that already exist, verified on staging 2026-09-01:
 *   HITTER  — 13 derived keys, dev_aggressiveness: 0
 *   PITCHER — a straight copy of the prediction row (existing rows carry id/player_id/status/
 *             updated_at/variant/model_type/customer_team_id/from_*), so we copy the row verbatim.
 *   ⛔ Do NOT "normalize" the pitcher shape here. Matching what TB already reads is the point;
 *      a tidier shape would be a different object and the readers would miss keys.
 *
 * USAGE — DRY RUN IS THE DEFAULT. Nothing writes without --apply.
 *   npx tsx scripts/backfill-neutral-snapshots.ts                 # staging, dry run
 *   npx tsx scripts/backfill-neutral-snapshots.ts --apply         # staging, WRITES
 *   npx tsx scripts/backfill-neutral-snapshots.ts --prod          # prod, dry run
 *   npx tsx scripts/backfill-neutral-snapshots.ts --prod --apply  # prod, WRITES
 *   npx tsx scripts/backfill-neutral-snapshots.ts --refresh --apply        # staging, REWRITE ALL
 *   npx tsx scripts/backfill-neutral-snapshots.ts --prod --refresh --apply # prod,    REWRITE ALL
 *
 * ⚠ RUN --refresh AFTER EVERY PRECOMPUTE. Without it the snapshots keep pre-recompute values and
 *   Team Builder silently shows numbers from the previous model while Player Profile shows the new
 *   ones.
 *
 * ⚠ IDEMPOTENT: only touches rows WHERE neutral_snapshot IS NULL. Re-running is safe and a second
 *   run should report 0 candidates.
 */
import fs from "fs";
import pg from "pg";

// 🛑 node-postgres returns PostgreSQL `numeric` (OID 1700) and `int8` (OID 20) as STRINGS.
//    The PITCHER path below copies the prediction row VERBATIM, so without this every numeric field
//    lands in the snapshot as a JSON string. The UI then calls .toFixed() on it and the Team Builder
//    page CRASHES: "shownMetric.toFixed is not a function" (PlayerTableRow.tsx:834).
//    Measured 2026-09-01 after the first --refresh run: 627 pitcher snapshots had p_war/p_era as
//    strings on BOTH staging and prod. The HITTER path never hit this because it coerces via num().
// ⇒ Parse numerics as JS numbers at the DRIVER, so the verbatim copy stays verbatim AND typed.
pg.types.setTypeParser(1700, (v: string | null) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v: string | null) => (v === null ? null : Number(v)));

const isProd = process.argv.includes("--prod");
const apply = process.argv.includes("--apply");
/**
 * --refresh : ALSO rewrite rows that ALREADY have a neutral_snapshot.
 *
 * ★ WHY THIS EXISTS (2026-09-01). `neutral_snapshot` is a COPY of the prediction row. A precompute
 *   rewrites `player_predictions` but NOTHING cascades to the copies, so after every recalibration
 *   every neutral snapshot is stale. Measured on staging right after the 2026-09-01 returner +
 *   transfer recomputes: 310 of 586 comparable rows STALE. Symptom (Trevor): "player profile is
 *   showing properly on staging but team builder is not" — Player Profile reads
 *   `player_predictions` directly; Team Builder reads the snapshot.
 *
 * ✅ SAFE FOR TOGGLES — THIS IS THE WHOLE REASON IT IS THE NEUTRAL SCRIPT THAT GAINS THE FLAG.
 *   A neutral snapshot is the dev_agg=0 base and carries NO toggle state; the coach's toggles live in
 *   `production_notes` and are applied ON TOP at read time
 *   (`useTeamBuilderSimulation.ts:1361` → `shown = p.neutralPrediction ?? p.prediction`, then a
 *   devAggScale RATIO multiplies it). Refreshing neutral therefore fixes the DISPLAY for clean AND
 *   toggled rows and cannot disturb a toggle.
 *   ⛔ Do NOT add a --refresh to a script that writes `player_snapshot`/`transfer_snapshot` from
 *      predictions instead. Those are the TOGGLE-BAKED copies; rebuilding them from a prediction
 *      flattens every coach's toggle back to neutral.
 */
const refresh = process.argv.includes("--refresh");
const envFile = isProd ? ".env.production.local" : ".env.local";

const C = { red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", dim: "\x1b[2m", reset: "\x1b[0m" };

function pguri(): string {
  const env = fs.readFileSync(envFile, "utf8");
  const m = env.match(/^PGURI=(.*)$/m);
  if (!m) throw new Error(`No PGURI in ${envFile}`);
  return m[1].trim().replace(/^["']|["']$/g, "");
}

const isPit = (s: string | null) => /^(SP|RP|CL|P|LHP|RHP)/i.test(String(s || ""));
const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** HITTER neutral snapshot — the 13 keys the existing rows carry, dev-neutral by construction. */
function hitterNeutral(pred: any) {
  const o = num(pred.o_war);
  const d = num(pred.d_war);
  const b = num(pred.bsr_war);
  return {
    p_avg: num(pred.p_avg),
    p_obp: num(pred.p_obp),
    p_slg: num(pred.p_slg),
    p_wrc_plus: num(pred.p_wrc_plus),
    o_war: o,
    d_war: d,
    bsr_war: b,
    // total = oWAR + dWAR + bsrWAR. Trevor 2026-09-01: dev/role scale oWAR ONLY; d/bsr are unscaled.
    // Prefer the stored total when present so we never disagree with the row we copied from.
    total_hitter_war: num(pred.total_hitter_war) ?? (o != null ? o + (d ?? 0) + (b ?? 0) : null),
    market_value: num(pred.market_value),
    twp_hitter_market_value: num(pred.twp_hitter_market_value),
    hitter_depth_role: pred.hitter_depth_role ?? null,
    class_transition: pred.class_transition ?? null,
    dev_aggressiveness: 0, // ← the whole point: the neutral base is dev 0
  };
}

async function main() {
  const client = new pg.Client({ connectionString: pguri() });
  await client.connect();
  await client.query("set statement_timeout='15min'");

  const db = await client.query("select current_database() db");
  console.log(`### DB: ${envFile} (${db.rows[0].db}) · APPLY=${apply} ###`);
  if (isProd && apply) console.log(`${C.red}!!! PROD WRITE !!!${C.reset}`);

  // Candidates: neutral is NULL. Carry the build's customer_team_id so we pick the right pred row.
  const { rows: candidates } = await client.query(`
    select tbp.id, tbp.player_id, tbp.position_slot, tb.customer_team_id,
           (tbp.player_snapshot is not null) as has_player_snap
    from team_build_players tbp
    join team_builds tb on tb.id = tbp.build_id
    where ${refresh ? "true" : "tbp.neutral_snapshot is null"}
      and tbp.player_id is not null
    order by tbp.id
  `);
  console.log(`candidates (${refresh ? "REFRESH — ALL rows, existing snapshots WILL be overwritten" : "neutral_snapshot IS NULL"}): ${candidates.length}`);
  if (candidates.length === 0) {
    console.log(`${C.green}nothing to do${C.reset}`);
    await client.end();
    return;
  }

  const playerIds = [...new Set(candidates.map((r: any) => r.player_id))];
  const { rows: preds } = await client.query(
    `select * from player_predictions
     where player_id = any($1) and season = 2027 and status in ('active','departed')`,
    [playerIds],
  );

  // predRank: this build's precomputed (3) > global regular (2) > anything else (1). Never another
  // team's precompute — that is a projection TO a different school.
  const pick = (pid: string, teamId: string | null) => {
    const mine = preds.filter((p: any) => p.player_id === pid);
    return (
      mine.find((p: any) => p.customer_team_id === teamId && p.variant === "precomputed") ??
      mine.find((p: any) => p.customer_team_id == null && p.variant === "regular") ??
      null
    );
  };

  let hitters = 0, pitchers = 0, noPred = 0;
  const updates: { id: string; snap: any }[] = [];
  const samples: string[] = [];

  for (const row of candidates as any[]) {
    const pred = pick(row.player_id, row.customer_team_id);
    if (!pred) { noPred++; continue; }
    const pitcher = isPit(row.position_slot);
    // ⛔ Never rebuild from player_snapshot — it has the coach's toggles baked in.
    const snap = pitcher ? pred : hitterNeutral(pred);
    if (pitcher) pitchers++; else hitters++;
    updates.push({ id: row.id, snap });
    if (samples.length < 5) {
      samples.push(
        `  ${pitcher ? "P" : "H"} slot=${String(row.position_slot ?? "—").padEnd(3)} ` +
        `pred=${pred.variant}/${pred.customer_team_id ? "team" : "global"} ` +
        (pitcher
          ? `p_era=${num(pred.p_era)?.toFixed(3) ?? "—"} p_war=${num(pred.p_war)?.toFixed(3) ?? "—"}`
          : `o_war=${num(pred.o_war)?.toFixed(3) ?? "—"} total=${num((snap as any).total_hitter_war)?.toFixed(3) ?? "—"}`),
      );
    }
  }

  console.log(`  hitters: ${hitters} · pitchers: ${pitchers} · ${C.yellow}no prediction row: ${noPred}${C.reset}`);
  console.log("sample of what WOULD be written:");
  samples.forEach((s) => console.log(s));

  if (!apply) {
    console.log(`\n${C.yellow}DRY RUN — nothing written.${C.reset} Re-run with --apply to write ${updates.length} rows.`);
    await client.end();
    return;
  }

  let done = 0;
  for (const u of updates) {
    const r = await client.query(
      `update team_build_players set neutral_snapshot = $2
       where id = $1 ${refresh ? "" : "and neutral_snapshot is null"}`,
      [u.id, JSON.stringify(u.snap)],
    );
    done += r.rowCount ?? 0;
    if (done % 25 === 0) process.stdout.write(`  ${done}/${updates.length}`);
  }
  console.log(`\n${C.green}✅ wrote ${done}/${updates.length}${C.reset}`);
  console.log(`BACKFILL_SUMMARY env=${isProd ? "prod" : "staging"} apply=${apply} wrote=${done} no_pred=${noPred}`);
  await client.end();
}

main().catch((e) => { console.error(`${C.red}FAILED:${C.reset}`, e.message); process.exit(1); });
