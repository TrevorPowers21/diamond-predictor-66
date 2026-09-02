/**
 * RE-BAKE `team_build_players.player_snapshot` FROM neutral + THE SAVED TOGGLES
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY. `scripts/refresh-player-snapshots-untoggled.ts` (2026-09-01) copied NEUTRAL values into
 * `player_snapshot`. Neutral is the dev_agg=0 base and carries NO toggle and NO depth role, so every
 * row it touched lost its baked adjustment and player_snapshot == neutral_snapshot. The toggles were
 * never lost — they live in `production_notes` — but the snapshot no longer reflected them.
 *
 * WHAT THIS DOES. Rebuilds `player_snapshot` = neutral base × the SAVED toggle, using the SAME math
 * the app applies (useTeamBuilderSimulation):
 *     classAdj  = FS 0.03 · GR 0.01 · else 0.02
 *     scale     = (1 + classAdj + sessionDev*0.06) / (1 + classAdj + storedDev*0.06)
 *     p_avg/p_obp/p_slg/p_iso  ×= scale
 *     p_wrc_plus = round(base × scale)
 *     o_war      = computeOWarFromWrcPlus(adjWrc, paForHitterDepthRole(depthRole))
 *     total_hitter_war = o_war + d_war + bsr_war      ⛔ d/bsr are NEVER scaled
 *
 * 🛑 HITTERS ONLY. The pitcher toggle path inverts for lower-is-better rates and is not reproduced
 *    here; pitcher rows are left untouched rather than guessed at.
 *
 *   npx tsx scripts/rebake-player-snapshot-toggles.ts [--prod] [--apply]
 */
import fs from "fs";
import pg from "pg";
import { computeOWarFromWrcPlus } from "@/lib/playerCalcs";
import { paForHitterDepthRole } from "@/lib/depthRoles";

pg.types.setTypeParser(1700, (v: string | null) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v: string | null) => (v === null ? null : Number(v)));

const isProd = process.argv.includes("--prod");
const apply = process.argv.includes("--apply");
const envFile = isProd ? ".env.production.local" : ".env.local";
const m = fs.readFileSync(envFile, "utf8").match(/^PGURI=(.*)$/m);
if (!m) throw new Error(`No PGURI in ${envFile}`);

const classAdjFor = (ct: string | null | undefined) => {
  const c = String(ct || "SJ").toUpperCase();
  return c === "FS" ? 0.03 : c === "GR" ? 0.01 : 0.02;
};

(async () => {
  const c = new pg.Client({ connectionString: m[1].trim().replace(/^["']|["']$/g, "") });
  await c.connect();
  await c.query("set statement_timeout='9min'");
  console.log(`### ${envFile} · APPLY=${apply}`);
  if (isProd && apply) console.log("!!! PROD WRITE !!!");

  const { rows } = await c.query(`
    select tbp.id, tbp.player_snapshot ps, tbp.neutral_snapshot ns, tbp.production_notes pn
    from team_build_players tbp
    where tbp.neutral_snapshot is not null and tbp.player_snapshot is not null`);

  const updates: Array<{ id: string; patch: any; before: number; after: number }> = [];
  let skippedPitcher = 0, skippedNoToggle = 0;

  for (const r of rows) {
    const ns = r.ns as any;
    if (ns.p_wrc_plus == null) { skippedPitcher++; continue; }   // hitters only
    const pn = typeof r.pn === "string" ? JSON.parse(r.pn) : (r.pn || {});
    const sessionDev = Number(pn.devAggressiveness ?? 0);
    const depthRole = pn.depthRole ?? ns.hitter_depth_role ?? "everyday_starter";
    const storedDev = Number(ns.dev_aggressiveness ?? 0);
    const ct = pn.classTransition ?? ns.class_transition ?? "SJ";

    const adj = classAdjFor(ct);
    const scale = (1 + adj + sessionDev * 0.06) / (1 + adj + storedDev * 0.06);
    const sessionPa = paForHitterDepthRole(depthRole as any);
    const adjWrc = ns.p_wrc_plus != null ? Math.round(Number(ns.p_wrc_plus) * scale) : null;
    const oWar = adjWrc != null ? computeOWarFromWrcPlus(adjWrc, sessionPa) : null;
    const dWar = Number.isFinite(Number(ns.d_war)) ? Number(ns.d_war) : 0;
    const bsrWar = Number.isFinite(Number(ns.bsr_war)) ? Number(ns.bsr_war) : 0;

    const patch: any = {
      p_avg: ns.p_avg != null ? Number(ns.p_avg) * scale : null,
      p_obp: ns.p_obp != null ? Number(ns.p_obp) * scale : null,
      p_slg: ns.p_slg != null ? Number(ns.p_slg) * scale : null,
      p_iso: ns.p_iso != null ? Number(ns.p_iso) * scale : null,
      p_wrc_plus: adjWrc,
      o_war: oWar,
      d_war: dWar,
      bsr_war: bsrWar,
      total_hitter_war: oWar != null ? oWar + dWar + bsrWar : null,
      hitter_depth_role: depthRole,
      dev_aggressiveness: sessionDev,   // so the app's guardrail can see what is baked in
      class_transition: ct,
    };
    const before = Number((r.ps as any)?.p_avg ?? NaN);
    const after = patch.p_avg;
    const changed = !Number.isFinite(before) || Math.abs(before - after) > 1e-9
      || Number((r.ps as any)?.p_wrc_plus) !== adjWrc;
    if (!changed) { skippedNoToggle++; continue; }
    updates.push({ id: r.id, patch, before, after });
  }

  console.log(`rows: ${rows.length} · hitters to update: ${updates.length} · already correct: ${skippedNoToggle} · pitcher rows skipped: ${skippedPitcher}`);
  for (const u of updates.slice(0, 8)) {
    console.log(`   ${u.id.slice(0, 8)}  p_avg ${Number.isFinite(u.before) ? u.before.toFixed(4) : "—"} → ${u.after.toFixed(4)}  wRC+ ${u.patch.p_wrc_plus}  oWAR ${u.patch.o_war?.toFixed(3)}`);
  }
  if (!apply) { console.log("\nDRY RUN — add --apply."); await c.end(); return; }

  let n = 0;
  for (const u of updates) {
    await c.query(`update team_build_players set player_snapshot = player_snapshot || $2::jsonb where id = $1`,
      [u.id, JSON.stringify(u.patch)]);
    if (++n % 200 === 0) process.stdout.write(`\r  ${n}/${updates.length}`);
  }
  console.log(`\n✅ re-baked ${n}/${updates.length}`);
  await c.end();
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
