/**
 * SYNC `target_board.transfer_snapshot` FROM THE ROSTER'S `player_snapshot`
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * THE RULE (Trevor, 2026-09-01): "they come into the board with their stored values, no toggles, and
 * if they are added to the roster those things can change... the main thing would be that transfer
 * snapshot reads player snapshot after added to the roster."
 *
 * A player can hold TWO stored copies — a `team_build_players.player_snapshot` (roster, toggles and
 * depth role baked in) and a `target_board.transfer_snapshot` (board, the raw destination
 * projection). Whichever a surface picks is what the coach sees. Measured on staging: 39 of 462
 * active-build rows also had a board row, and they disagree —
 *     Jake Hanley  build 2.854 / $285,391   board 2.331 / $233,077
 *     Lauaki Jr.   build 0.503 / $55,347    board 0.264 / $28,958
 *     Jason Flores build $213,203           board $30,099
 * ⇒ ONCE ROSTERED, THE ROSTER COPY IS AUTHORITATIVE. This copies it onto the board row.
 *
 * 🛑 SIDE-AWARE + TWP-AWARE. The board row's slot decides which side it represents; a TWP keeps
 *    `market_value` NULL and carries twp_hitter_market_value / twp_pitcher_market_value, own side
 *    only. Board snapshots spell oWAR as `owar` and market as `nil_valuation`.
 *
 * ⚠ This is a REPAIR for existing rows. The durable fix is the SAVE PATH writing both copies.
 *
 *   npx tsx --env-file=.env.local scripts/sync-board-from-roster-snapshot.ts [--prod] [--apply]
 */
import fs from "fs";
import pg from "pg";

pg.types.setTypeParser(1700, (v: string | null) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v: string | null) => (v === null ? null : Number(v)));

const isProd = process.argv.includes("--prod");
const apply = process.argv.includes("--apply");
const envFile = isProd ? ".env.production.local" : ".env.local";
const m = fs.readFileSync(envFile, "utf8").match(/^PGURI=(.*)$/m);
if (!m) throw new Error(`No PGURI in ${envFile}`);
const isPitSlot = (s: unknown) => /^(SP|RP|CL|P|LHP|RHP)/i.test(String(s || ""));

(async () => {
  const c = new pg.Client({ connectionString: m[1].trim().replace(/^["']|["']$/g, "") });
  await c.connect();
  await c.query("set statement_timeout='9min'");
  console.log(`### ${envFile} · APPLY=${apply}`);
  if (isProd && apply) console.log("!!! PROD WRITE !!!");

  const { rows } = await c.query(`
    select tb.id board_id, tb.position_slot board_slot, tb.transfer_snapshot bs,
           tbp.position_slot roster_slot, tbp.player_snapshot ps,
           pl.is_twp, pl.first_name||' '||pl.last_name nm
    from target_board tb
    join team_builds b on b.id is not null and b.customer_team_id = tb.customer_team_id and b.is_active
    join team_build_players tbp on tbp.build_id = b.id and tbp.player_id = tb.player_id
    join players pl on pl.id = tb.player_id
    where tbp.player_snapshot is not null and tb.transfer_snapshot is not null`);

  const updates: Array<{ id: string; patch: any; nm: string; before: any; after: any }> = [];
  for (const r of rows) {
    const ps = r.ps as any;
    // The ROSTER row's slot decides the side — that is the row whose values we are copying.
    const pit = isPitSlot(r.roster_slot);
    const mkt = ps.market_value ?? null;
    const patch: any = pit
      ? {
          p_era: ps.p_era ?? null, p_fip: ps.p_fip ?? null, p_whip: ps.p_whip ?? null,
          p_k9: ps.p_k9 ?? null, p_bb9: ps.p_bb9 ?? null, p_hr9: ps.p_hr9 ?? null,
          p_rv_plus: ps.p_rv_plus ?? null, p_war: ps.p_war ?? null,
          pitcher_depth_role: ps.pitcher_depth_role ?? null,
          ...(r.is_twp
            ? { nil_valuation: null, twp_pitcher_market_value: ps.twp_pitcher_market_value ?? null, twp_hitter_market_value: null }
            : { nil_valuation: mkt }),
        }
      : {
          p_avg: ps.p_avg ?? null, p_obp: ps.p_obp ?? null, p_slg: ps.p_slg ?? null,
          p_wrc_plus: ps.p_wrc_plus ?? null,
          // board snapshots spell oWAR as `owar`; carry both so either reader resolves
          owar: ps.o_war ?? null, o_war: ps.o_war ?? null,
          d_war: ps.d_war ?? null, bsr_war: ps.bsr_war ?? null,
          total_hitter_war: ps.total_hitter_war ?? null,
          hitter_depth_role: ps.hitter_depth_role ?? null,
          ...(r.is_twp
            ? { nil_valuation: null, twp_hitter_market_value: ps.twp_hitter_market_value ?? null, twp_pitcher_market_value: null }
            : { nil_valuation: mkt }),
        };
    const bs = r.bs as any;
    const key = pit ? "p_war" : "total_hitter_war";
    const before = bs?.[key] ?? bs?.owar ?? null;
    const after = patch[key] ?? patch.owar ?? null;
    const mktBefore = bs?.nil_valuation ?? null;
    const changed = (after != null && (before == null || Math.abs(Number(before) - Number(after)) > 1e-6))
      || (patch.nil_valuation != null && (mktBefore == null || Math.abs(Number(mktBefore) - Number(patch.nil_valuation)) > 1));
    if (!changed) continue;
    updates.push({ id: r.board_id, patch, nm: r.nm, before, after });
  }

  console.log(`rostered players also on the board: ${rows.length} · to sync: ${updates.length}`);
  for (const u of updates.slice(0, 10)) {
    console.log(`   ${u.nm.padEnd(24)} ${u.before == null ? "—" : Number(u.before).toFixed(3)} → ${u.after == null ? "—" : Number(u.after).toFixed(3)}  mkt ${u.patch.nil_valuation == null ? "—" : Math.round(u.patch.nil_valuation)}`);
  }
  if (!apply) { console.log("\nDRY RUN — add --apply."); await c.end(); return; }

  let n = 0;
  for (const u of updates) {
    await c.query(`update target_board set transfer_snapshot = transfer_snapshot || $2::jsonb where id = $1`,
      [u.id, JSON.stringify(u.patch)]);
    n++;
  }
  console.log(`\n✅ synced ${n}/${updates.length}`);
  await c.end();
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
