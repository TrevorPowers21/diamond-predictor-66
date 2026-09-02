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
import { paForHitterDepthRole, pitcherExpectedIp, computePitcherMarketValue, computeHitterMarketValue } from "@/lib/depthRoles";
import { readPitchingWeights } from "@/lib/pitchingEquations";

pg.types.setTypeParser(1700, (v: string | null) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v: string | null) => (v === null ? null : Number(v)));

const isProd = process.argv.includes("--prod");
const apply = process.argv.includes("--apply");
const envFile = isProd ? ".env.production.local" : ".env.local";
const m = fs.readFileSync(envFile, "utf8").match(/^PGURI=(.*)$/m);
if (!m) throw new Error(`No PGURI in ${envFile}`);

// ⚠ class transition is ALREADY BAKED INTO THE PROJECTIONS upstream — it is NOT a snapshot field
// and is never written by this script. It is read only to size the dev-aggressiveness ratio, where
// it appears in BOTH numerator and denominator (a damping term, not a class bump).
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
    select tbp.id, tbp.player_snapshot ps, tbp.neutral_snapshot ns, tbp.production_notes pn,
           pl.position, pl.is_twp, tbp.position_slot, ct.name team_name, t.conference
    from team_build_players tbp
    join team_builds b on b.id = tbp.build_id
    left join customer_teams ct on ct.id = b.customer_team_id
    left join players pl on pl.id = tbp.player_id
    left join "Teams Table" t on t.id = ct.school_team_id
    where tbp.neutral_snapshot is not null and tbp.player_snapshot is not null`);

  // depth-role -> expected IP needs the pitching equation weights (pwar_ip_sp / _sm / _rp)
  const pEq = await readPitchingWeights();
  const updates: Array<{ id: string; patch: any; before: number; after: number }> = [];
  let skippedPitcher = 0, skippedNoToggle = 0, unverifiablePwar = 0, wrongSideNeutral = 0;

  for (const r of rows) {
    const ns = r.ns as any;
    // ── PITCHERS ──────────────────────────────────────────────────────────────────────────────
    // Mirrors useTeamBuilderSimulation:1425-1444. Lower-is-better rates take the INVERSE scale;
    // K9 and pRV+ take the same direction as a hitter. Note the pitcher class table has a JS case
    // (0.015) the hitter table does not.
    // 🛑 BRANCH ON THE SLOT, NOT ON WHAT THE NEUTRAL CONTAINS. Kenny Ishikawa's SP row carried a
    //    HITTER neutral, so a content-based branch fed hitter fields onto a pitcher slot: wRC+ 118 /
    //    oWAR 1.187 / hitter_depth_role platoon_starter on an SP row, competing with his real RF row
    //    (oWAR 2.006). Two rows claiming hitter values is why his role change looked like it never
    //    persisted. The SLOT is authoritative for which side a row represents.
    const isPitSlot = /^(SP|RP|CL|P|LHP|RHP)/i.test(String((r as any).position_slot || ""));
    if (isPitSlot) {
      if (ns.p_era == null && ns.p_war == null) { wrongSideNeutral++; continue; }
      const pn0 = typeof r.pn === "string" ? JSON.parse(r.pn) : (r.pn || {});
      const sDev = Number(pn0.devAggressiveness ?? 0);
      const stDev = Number(ns.dev_aggressiveness ?? 0);
      const ctP = String(pn0.classTransition ?? ns.class_transition ?? "SJ").toUpperCase();
      const adjP = ctP === "FS" ? 0.03 : ctP === "JS" ? 0.015 : ctP === "GR" ? 0.01 : 0.02;
      const scaleP = (1 + adjP + sDev * 0.06) / (1 + adjP + stDev * 0.06);
      const invP = scaleP > 0 ? 1 / scaleP : 1;
      const rv = ns.p_rv_plus != null ? Math.round(Number(ns.p_rv_plus) * scaleP) : null;
      // ★★★ IP COMES FROM THE DEPTH ROLE, NOT stored projected_ip ★★★
      // [[feedback_projected_ip_from_depth_role]]. Using the stored value is why Luke Neiswonger —
      // a WEEKEND STARTER at 3.21 ERA / 2.82 FIP — showed 1.14 pWAR and $99k: his row carried a
      // reliever-sized projected_ip, and pWAR is linear in IP. weekend_starter = pwar_ip_sp (~85).
      const depthRoleP = String(pn0.depthRole ?? ns.pitcher_depth_role ?? "").trim();
      const ipFromRole = depthRoleP ? pitcherExpectedIp(depthRoleP as any, pEq) : NaN;
      const ip = Number.isFinite(ipFromRole) && ipFromRole > 0 ? ipFromRole : Number(ns.projected_ip);
      // pWAR — canonical formula (CLAUDE.md / src/savant/lib/war.ts):
      //   (((pRV+ - 100) / 100) * (IP/9) * 6.915 + (IP/9 * 1.92)) / 13.1
      const pwarWith = (rvIn: number, ipIn: number) =>
        ((((rvIn - 100) / 100) * (ipIn / 9) * 6.915) + ((ipIn / 9) * 1.92)) / 13.1;
      // 🛑 SELF-CHECK BEFORE WRITING. Verified on 400 staging neutral rows: this formula reproduces
      //    the stored pWAR on 391 and MISSES on 9 (worst 0.2285) — role-dependent constants the
      //    canonical formula does not capture. Rather than write a guessed pWAR on those rows, prove
      //    the formula on THIS row first: recompute the row's own NEUTRAL pWAR from its neutral pRV+
      //    and IP, and only proceed if it lands on the stored neutral value.
      const nsRv = ns.p_rv_plus != null ? Number(ns.p_rv_plus) : null;
      const nsWar = ns.p_war != null ? Number(ns.p_war) : null;
      // ⚠ VALIDATE with the NEUTRAL's OWN stored IP — that is what produced ns.p_war. Validating
      //   against the role-derived IP would fail on exactly the rows whose stored IP is wrong, which
      //   are the rows we are here to fix (Neiswonger).
      const nsIp = Number(ns.projected_ip);
      const formulaHolds = nsRv != null && nsWar != null && Number.isFinite(nsIp)
        && Math.abs(pwarWith(nsRv, nsIp) - nsWar) <= 0.005;
      if (!formulaHolds) { unverifiablePwar++; continue; }
      // COMPUTE with the ROLE-derived IP — the actual correction.
      const pWar = rv != null && Number.isFinite(ip) ? pwarWith(rv, ip) : null;
      const pMkt = computePitcherMarketValue(pWar, {
        conference: (r as any).conference ?? null,
        role: (pn0.pitcherRole ?? ns.pitcher_role ?? "RP") as any,
        team: (r as any).team_name ?? null,
      });
      const patchP: any = {
        p_era: ns.p_era != null ? Number(ns.p_era) * invP : null,
        p_fip: ns.p_fip != null ? Number(ns.p_fip) * invP : null,
        p_whip: ns.p_whip != null ? Number(ns.p_whip) * invP : null,
        p_bb9: ns.p_bb9 != null ? Number(ns.p_bb9) * invP : null,
        p_hr9: ns.p_hr9 != null ? Number(ns.p_hr9) * invP : null,
        p_k9: ns.p_k9 != null ? Number(ns.p_k9) * scaleP : null,
        p_rv_plus: rv,
        p_war: pWar,
        projected_ip: Number.isFinite(ip) ? ip : null,   // derived from depth role
        pitcher_role: pn0.pitcherRole ?? ns.pitcher_role ?? null,
        pitcher_depth_role: pn0.depthRole ?? ns.pitcher_depth_role ?? null,
        dev_aggressiveness: sDev,
        // own-side only: a pitcher row must not carry hitter fields
        p_avg: null, p_obp: null, p_slg: null, p_iso: null, p_wrc_plus: null,
        o_war: null, total_hitter_war: null, hitter_depth_role: null,
        // ★ MARKET IS STORED, NOT DERIVED AT READ TIME. If pWAR moves and this is not rewritten the
        //   row keeps a market value from the old WAR (Neiswonger: 3.229 pWAR still showing $99k).
        // 🛑 TWP CONVENTION (src/lib/twpMarketValue.ts): a two-way player NULLs the SHARED
        //    `market_value` and carries the value in twp_pitcher_market_value / twp_hitter_market_value.
        //    Writing the shared column on a TWP pollutes every surface that reads it directly (the
        //    target board). Measured: this script had written market_value onto 9 TWP rows.
        // 🛑 OWN-SIDE ONLY. The pitcher neutral is a VERBATIM copy of the prediction row, so it
        //    carries twp_hitter_market_value too. Leaving it on a PITCHER row makes the display pick
        //    the hitter market for a pitcher — Kenny Ishikawa showed $117,921 (his hitter value) on a
        //    P row with 2.00 pWAR. Mirrors useTargetBoard's hitterSnap/pitcherSnap split.
        ...((r as any).is_twp
          ? { market_value: null, twp_pitcher_market_value: pMkt, twp_hitter_market_value: null }
          : { market_value: pMkt }),
      };
      const bP = Number((r.ps as any)?.p_era ?? NaN);
      const aP = patchP.p_era;
      const psWar = Number((r.ps as any)?.p_war ?? NaN);
      const psMkt = Number((r.ps as any)?.market_value ?? NaN);
      const newMkt = pMkt;
      const changedP = (aP != null && (!Number.isFinite(bP) || Math.abs(bP - aP) > 1e-9))
        || Number((r.ps as any)?.p_rv_plus) !== rv
        || (pWar != null && (!Number.isFinite(psWar) || Math.abs(psWar - pWar) > 1e-6))
        || (newMkt != null && (!Number.isFinite(psMkt) || Math.abs(psMkt - Number(newMkt)) > 1))
        || ((r as any).is_twp && ((r.ps as any)?.market_value != null || (r.ps as any)?.twp_hitter_market_value != null));
      if (!changedP) { skippedNoToggle++; continue; }
      updates.push({ id: r.id, patch: patchP, before: bP, after: aP });
      continue;
    }
    if (ns.p_wrc_plus == null) { skippedPitcher++; continue; }   // hitters only
    const pn = typeof r.pn === "string" ? JSON.parse(r.pn) : (r.pn || {});
    const sessionDev = Number(pn.devAggressiveness ?? 0);
    // 🛑 TWP ROLE MIXING. On a two-way player `production_notes.depthRole` holds the PITCHER-side
    //    role, so feeding it to paForHitterDepthRole silently falls back to a default PA. Measured
    //    on staging: hitter snapshots carrying `low_impact_reliever` / `high_leverage_reliever`.
    //    ⇒ Only accept a HITTER role from production_notes; otherwise use the snapshot's own
    //      hitter_depth_role.
    const HITTER_ROLES = ["cornerstone", "everyday_starter", "platoon_starter", "utility", "bench"];
    const pnRole = String(pn.depthRole ?? "");
    const depthRole = HITTER_ROLES.includes(pnRole)
      ? pnRole
      : (ns.hitter_depth_role ?? "everyday_starter");
    const storedDev = Number(ns.dev_aggressiveness ?? 0);
    const ct = pn.classTransition ?? ns.class_transition ?? "SJ";

    const adj = classAdjFor(ct);
    const scale = (1 + adj + sessionDev * 0.06) / (1 + adj + storedDev * 0.06);
    const sessionPa = paForHitterDepthRole(depthRole as any);
    const adjWrc = ns.p_wrc_plus != null ? Math.round(Number(ns.p_wrc_plus) * scale) : null;
    const oWar = adjWrc != null ? computeOWarFromWrcPlus(adjWrc, sessionPa) : null;
    const dWar = Number.isFinite(Number(ns.d_war)) ? Number(ns.d_war) : 0;
    const bsrWar = Number.isFinite(Number(ns.bsr_war)) ? Number(ns.bsr_war) : 0;

    const hMkt = computeHitterMarketValue(oWar != null ? oWar + dWar + bsrWar : null, {
      conference: (r as any).conference ?? null,
      position: (r as any).position ?? null,
    });
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
      // own-side only: a hitter row must not carry pitcher fields
      p_era: null, p_fip: null, p_whip: null, p_k9: null, p_bb9: null, p_hr9: null,
      p_rv_plus: null, p_war: null, projected_ip: null, pitcher_depth_role: null,
      // ★ same rule for hitters — market rides TOTAL hitter WAR (o+d+bsr).
      // 🛑 same TWP convention on the hitter side.
      // 🛑 OWN-SIDE ONLY — same rule, hitter side.
      ...((r as any).is_twp
        ? { market_value: null, twp_hitter_market_value: hMkt, twp_pitcher_market_value: null }
        : { market_value: hMkt }),
    };
    const before = Number((r.ps as any)?.p_avg ?? NaN);
    const after = patch.p_avg;
    const psMktH = Number((r.ps as any)?.market_value ?? NaN);
    const newMktH = hMkt;
    const psOwar = Number((r.ps as any)?.o_war ?? NaN);
    const changed = !Number.isFinite(before) || Math.abs(before - after) > 1e-9
      || Number((r.ps as any)?.p_wrc_plus) !== adjWrc
      || (oWar != null && (!Number.isFinite(psOwar) || Math.abs(psOwar - oWar) > 0.005))
      || (newMktH != null && (!Number.isFinite(psMktH) || Math.abs(psMktH - Number(newMktH)) > 1))
      || ((r as any).is_twp && ((r.ps as any)?.market_value != null || (r.ps as any)?.twp_pitcher_market_value != null));
    if (!changed) { skippedNoToggle++; continue; }
    updates.push({ id: r.id, patch, before, after });
  }

  console.log(`rows: ${rows.length} · to update: ${updates.length} · already correct: ${skippedNoToggle} · non-hitter/non-pitcher skipped: ${skippedPitcher} · ⚠ pWAR unverifiable: ${unverifiablePwar} · ⚠ WRONG-SIDE neutral (slot says pitcher, neutral is a hitter row): ${wrongSideNeutral}`);
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
