#!/usr/bin/env node
/**
 * Returner Hitter Pre-compute (also aliased as npm run precompute-returner-hitters).
 *
 * Batch-updates EVERY D1 hitter's returner projection row in player_predictions
 * for PROJECTION_SEASON. Idempotent — safe to re-run after any equation weight
 * change or Hitter Master refresh. Originally written to seed the 2027 season;
 * now the canonical recurring precompute for hitter returners.
 *
 * Run: npm run precompute-returner-hitters [-- --dry-run]
 *
 * Does this in two steps:
 *
 *   1. `createPredictionsFromMaster()` — creates `(model_type='returner',
 *      variant='regular', customer_team_id=NULL, season=2027)` rows for every
 *      player that doesn't have one yet, populating `from_avg / from_obp /
 *      from_slg / power_rating_plus / class_transition` from Hitter Master
 *      2026.
 *   2. For every 2027 hitter returner row (existing or newly-created), recompute
 *      `p_avg, p_obp, p_slg, p_ops, p_iso, p_wrc, p_wrc_plus` using the live
 *      `recalcReturner` engine + the player's stored power-rating internals.
 *
 * Pitcher and transfer rows are intentionally untouched here. The filter
 * `from_avg IS NOT NULL` excludes pitcher rows (which carry from_era instead).
 * Transfer rows are not selected at all.
 *
 * Usage:
 *   npm run backfill-2027-hitter-returners               # staging
 *   npm run backfill-2027-hitter-returners -- --dry-run  # staging dry-run
 *   npm run backfill-2027-hitter-returners:prod          # prod
 */

import { supabase } from "@/integrations/supabase/client";
import { CURRENT_SEASON, PROJECTION_SEASON } from "@/lib/seasonConstants";
import { createPredictionsFromMaster } from "@/lib/createPredictionsFromMaster";
import {
  loadEngineConfig,
  recalcReturner,
  readSpecificPlus,
  type ReturnerPowerContext,
} from "@/lib/predictionEngine";
import { computeHitterOWar, computeHitterMarketValue, defaultHitterDepthRoleFromActualPa, paForHitterDepthRole } from "@/lib/depthRoles";
import { projectJucoReturner } from "@/lib/jucoReturnerProjection";

const C = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m" };

async function loadAllPaged<T>(builder: () => any): Promise<T[]> {
  const PAGE = 1000;
  let out: T[] = [];
  let from = 0;
  while (true) {
    // .order("id") = unique tiebreaker; without it range() pages have no guaranteed order and silently
    // overlap/skip, dropping whole players (and their fallbacks) from the precompute.
    const { data, error } = await builder().order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw error;
    out = out.concat(data || []);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}


// ─── DRY-RUN DELTA REPORT (2026-09-01, step 6) ──────────────────────────────────────────────────
// Read-only. Compares what THIS run would write against what is stored, so the calibration change
// can be inspected BEFORE any write. Gate is ACROSS THE RANGE (p05..p90) + biggest movers, never
// the mean alone — a bug calibrated perfectly at the mean is invisible to a mean-only check.
const _pctl = (xs: number[], q: number): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
};
const _fmt = (n: number, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : "  —  ");
function _rangeReport(label: string, pairs: Array<{ before: number | null; after: number | null }>, d = 3) {
  const both = pairs.filter((p) => p.before != null && p.after != null && Number.isFinite(p.before as number) && Number.isFinite(p.after as number));
  if (!both.length) { console.log(`   ${label.padEnd(16)} (no comparable rows)`); return; }
  const B = both.map((p) => p.before as number), A = both.map((p) => p.after as number);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const spreadB = _pctl(B, 0.9) - _pctl(B, 0.05), spreadA = _pctl(A, 0.9) - _pctl(A, 0.05);
  const spreadPct = spreadB !== 0 ? ((spreadA - spreadB) / spreadB) * 100 : NaN;
  console.log(`   ${label.padEnd(10)} n=${String(both.length).padStart(5)}  ` +
    `mean ${_fmt(mean(B), d)}→${_fmt(mean(A), d)} (${(mean(A) - mean(B) >= 0 ? "+" : "")}${_fmt(mean(A) - mean(B), d)})  ` +
    `p05 ${_fmt(_pctl(B, 0.05), d)}→${_fmt(_pctl(A, 0.05), d)}  ` +
    `p50 ${_fmt(_pctl(B, 0.5), d)}→${_fmt(_pctl(A, 0.5), d)}  ` +
    `p90 ${_fmt(_pctl(B, 0.9), d)}→${_fmt(_pctl(A, 0.9), d)}  ` +
    `spread ${_fmt(spreadB, d)}→${_fmt(spreadA, d)} (${spreadPct >= 0 ? "+" : ""}${_fmt(spreadPct, 1)}%)`);
}

async function main() {
  const isProd = process.argv.includes("--prod");
  const dryRun = process.argv.includes("--dry-run");

  // Env-detection guard: refuse to write prod unless --prod explicitly passed.
  const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").toLowerCase();
  const looksLikeProd = supabaseUrl.includes("ualmkgkdnoubccoieahf") || supabaseUrl.includes("trbvxuoliwrfowibatkm") || supabaseUrl.includes("prod");
  if (looksLikeProd && !isProd) {
    console.error(`${C.red}✗ SUPABASE_URL looks like PROD but --prod was not passed. Refusing to write.${C.reset}`);
    console.error(`  URL: ${supabaseUrl || "(unset)"}`);
    process.exit(1);
  }
  if (isProd && !looksLikeProd) {
    console.error(`${C.red}✗ --prod passed but SUPABASE_URL doesn't look like prod. Refusing to write.${C.reset}`);
    console.error(`  URL: ${supabaseUrl || "(unset)"}`);
    process.exit(1);
  }

  console.log(`${C.bold}2027 Hitter Returner Backfill${C.reset} on ${isProd ? "PROD" : "STAGING"}${dryRun ? ` ${C.yellow}[DRY RUN]${C.reset}` : ""}`);
  console.log(`  data season:       ${CURRENT_SEASON} (Hitter Master)`);
  console.log(`  projection season: ${PROJECTION_SEASON} (player_predictions write target)`);

  // ─── Step 1: createPredictionsFromMaster ─────────────────────────────
  if (dryRun) {
    console.log(`${C.yellow}[DRY RUN]${C.reset} skipping createPredictionsFromMaster() — would create/update returner rows at season=${PROJECTION_SEASON} from Hitter Master ${CURRENT_SEASON}`);
  } else {
    console.log(`${C.cyan}→${C.reset} step 1: createPredictionsFromMaster() — creating 2027 returner rows from Hitter Master 2026...`);
    const createResult = await createPredictionsFromMaster();
    console.log(`  ${C.green}✓${C.reset} createPredictionsFromMaster:`, createResult);
    if (createResult.errors.length > 0) {
      console.log(`  ${C.yellow}${createResult.errors.length} errors during create (continuing to recalc):${C.reset}`);
      for (const e of createResult.errors.slice(0, 5)) console.log(`    ${e}`);
    }
  }

  // ─── Step 2: load all 2027 hitter returner rows ──────────────────────
  console.log(`${C.cyan}→${C.reset} step 2: loading 2027 hitter returner rows...`);
  const rows = await loadAllPaged<any>(() =>
    supabase
      .from("player_predictions")
      .select("*")
      .eq("season", PROJECTION_SEASON)
      .eq("model_type", "returner")
      .eq("variant", "regular")
      .is("customer_team_id", null)
      .not("from_avg", "is", null),
  );
  console.log(`  ${rows.length} hitter returner rows at season=${PROJECTION_SEASON} (from_avg NOT NULL)`);
  if (rows.length === 0) {
    console.log(`${C.yellow}Nothing to recalc. Exiting.${C.reset}`);
    return;
  }

  // ─── Step 3: load engine config ──────────────────────────────────────
  console.log(`${C.cyan}→${C.reset} loading engine config (returner side)...`);
  const config = await loadEngineConfig();

  // ─── Step 3b: load player meta (position + conference + pa) for oWAR/$ ─
  // Returner rows have customer_team_id=NULL, so the "home" conference is the
  // player's current team conference — used for the program-tier market scale.
  // players.conference is NULL for ~10K rows, so fall back to Teams Table
  // resolution via source_team_id (or team name) when missing — otherwise the
  // multiplier defaults to lowMajor (0.5) and every affected player gets
  // mid-major market values regardless of where they actually play.
  console.log(`${C.cyan}→${C.reset} loading player meta (position + conference + pa)...`);
  const playerIds = Array.from(new Set(rows.map((r) => r.player_id as string)));
  const playerMeta = new Map<string, { position: string | null; conference: string | null; pa: number | null; division: string | null; is_twp: boolean; source_player_id: string | null }>();
  const PLAYER_BATCH = 200;
  const rawPlayers: Array<{ id: string; source_player_id: string | null; position: string | null; conference: string | null; pa: number | null; source_team_id: string | null; team: string | null; division: string | null; is_twp: boolean }> = [];
  for (let i = 0; i < playerIds.length; i += PLAYER_BATCH) {
    const ids = playerIds.slice(i, i + PLAYER_BATCH);
    const { data, error } = await supabase
      .from("players")
      .select("id, source_player_id, position, conference, pa, source_team_id, team, division, is_twp")
      .in("id", ids);
    if (error) throw error;
    for (const p of (data || []) as any[]) rawPlayers.push(p);
  }

  // Build a Teams Table lookup keyed by source_id and by normalized team name
  // so we can resolve conference when players.conference is null.
  console.log(`${C.cyan}→${C.reset} loading Teams Table for conference fallback...`);
  const teamsRows = await loadAllPaged<any>(() =>
    (supabase as any).from("Teams Table").select("source_id, full_name, abbreviation, conference"),
  );
  const teamConfBySourceId = new Map<string, string | null>();
  const teamConfByName = new Map<string, string | null>();
  const normKey = (s: string | null | undefined) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const t of teamsRows as any[]) {
    if (t.source_id) teamConfBySourceId.set(String(t.source_id), t.conference ?? null);
    if (t.full_name) teamConfByName.set(normKey(t.full_name), t.conference ?? null);
    if (t.abbreviation) teamConfByName.set(normKey(t.abbreviation), t.conference ?? null);
  }
  let confFromPlayer = 0;
  let confFromSourceId = 0;
  let confFromName = 0;
  let confUnresolved = 0;
  for (const p of rawPlayers) {
    let conf: string | null = p.conference ?? null;
    if (conf) confFromPlayer++;
    else if (p.source_team_id && teamConfBySourceId.has(String(p.source_team_id))) {
      conf = teamConfBySourceId.get(String(p.source_team_id)) ?? null;
      if (conf) confFromSourceId++; else confUnresolved++;
    } else if (p.team && teamConfByName.has(normKey(p.team))) {
      conf = teamConfByName.get(normKey(p.team)) ?? null;
      if (conf) confFromName++; else confUnresolved++;
    } else {
      confUnresolved++;
    }
    playerMeta.set(p.id, { position: p.position, conference: conf, pa: p.pa, division: p.division ?? null, is_twp: !!p.is_twp, source_player_id: p.source_player_id ?? null });
  }
  console.log(`  conference resolution: ${confFromPlayer} from players.conference, ${confFromSourceId} from source_team_id, ${confFromName} from team name, ${confUnresolved} unresolved`);

  // ─── Step 3c: Hitter Master power ratings by source_player_id ─────────
  // COLLAPSE (2026-08-12): read ba/obp/iso_power_rating STRAIGHT FROM the
  // Hitter Master @ CURRENT_SEASON — NOT the stale player_prediction_internals
  // copy. Same source rows createPredictionsFromMaster wrote from, read FRESH
  // so a Master re-store flows into returner projections with nothing stale between.
  // Master.iso_power_rating IS the ISO-plus internals stored as slg_power_rating.
  console.log(`${C.cyan}→${C.reset} loading Hitter Master power ratings @ ${CURRENT_SEASON}...`);
  const masterRatingRows = await loadAllPaged<any>(() =>
    (supabase as any)
      .from("Hitter Master")
      .select("id, source_player_id, ba_power_rating, obp_power_rating, iso_power_rating, d_war, bsr_war, regular_season_pa, pa")
      .eq("Season", CURRENT_SEASON),
  );
  const masterRatingsBySourceId = new Map<string, any>();
  for (const m of masterRatingRows as any[]) {
    if (m.source_player_id != null) masterRatingsBySourceId.set(String(m.source_player_id), m);
  }
  console.log(`  ${masterRatingsBySourceId.size} hitter master rows with a source_player_id`);

  // ─── Step 4: recalc ──────────────────────────────────────────────────
  console.log(`${C.cyan}→${C.reset} recomputing p_* fields...`);
  const RECALC_BATCH = 200;
  const updates: Array<{ id: string; patch: any }> = [];
  let computed = 0;
  let nullProjected = 0;
  let missingMasterRatings = 0;

  for (let i = 0; i < rows.length; i += RECALC_BATCH) {
    const slice = rows.slice(i, i + RECALC_BATCH);

    for (const row of slice) {
      const meta = playerMeta.get(row.player_id) ?? { position: null, conference: null, pa: null, division: null, is_twp: false };

      // ── JUCO branch ─────────────────────────────────────────────────────
      // JUCO returner regular rows DO NOT go through recalcReturner. The D1
      // equation references park factors + conference env+ + power-rating
      // weights that don't exist for JUCO and produce nonsense when applied
      // (Yearsley's .349/.461/.364 was a victim). Instead, passthrough 2026
      // actuals + JUCO tier market scale.
      if (meta.division === "NJCAA_D1") {
        // PA floor: sub-75 PA JUCO rows are tiny-sample noise (1-6 PA guys
        // with 1.000 AVG / 2.500 SLG) that pollute leaderboards. Mirror the
        // JUCO_PA_THRESHOLD used by the initial backfill and the transfer
        // precompute. Null all p_* so they drop out of ranking surfaces.
        const JUCO_PA_THRESHOLD = 75;
        const rawPa = Number(meta.pa) || 0;
        if (rawPa < JUCO_PA_THRESHOLD) {
          updates.push({
            id: row.id,
            patch: {
              p_avg: null, p_obp: null, p_slg: null, p_ops: null, p_iso: null,
              p_wrc: null, p_wrc_plus: null,
              o_war: null, market_value: null,
              projected_pa: null, hitter_depth_role: null,
              locked: false,
              updated_at: new Date().toISOString(),
            },
          });
          nullProjected++;
          continue;
        }

        const result = projectJucoReturner({
          from_avg: row.from_avg,
          from_obp: row.from_obp,
          from_slg: row.from_slg,
          actualPa: meta.pa,
          conference: meta.conference,
          position: meta.position,
        });
        if (result.p_avg == null && result.p_obp == null && result.p_slg == null) {
          nullProjected++;
        }
        updates.push({
          id: row.id,
          patch: {
            p_avg: result.p_avg,
            p_obp: result.p_obp,
            p_slg: result.p_slg,
            p_ops: result.p_ops,
            p_iso: result.p_iso,
            p_wrc: result.p_wrc,
            p_wrc_plus: result.p_wrc_plus,
            o_war: result.o_war,
            market_value: result.market_value,
            projected_pa: result.projected_pa,
            hitter_depth_role: result.hitter_depth_role,
            locked: false,
            updated_at: new Date().toISOString(),
          },
        });
        computed++;
        continue;
      }

      // ── D1 branch (unchanged) ───────────────────────────────────────────
      const master = meta.source_player_id ? masterRatingsBySourceId.get(String(meta.source_player_id)) : null;
      if (!master) missingMasterRatings++;
      const powerContext: ReturnerPowerContext = {
        baPlus: readSpecificPlus(master?.ba_power_rating) ?? null,
        obpPlus: readSpecificPlus(master?.obp_power_rating) ?? null,
        isoPlus: readSpecificPlus(master?.iso_power_rating) ?? null,
      };
      const result = recalcReturner(row, config.returner, powerContext);
      if (result.p_avg == null && result.p_obp == null && result.p_slg == null) {
        nullProjected++;
      }
      // Auto-assign depth role from last-season PA; store tier-based PA
      // (cornerstone=245, everyday=215, etc.) so within-tier players don't
      // see jarring oWAR/market gaps.
      // ★ 2026-08-31 — DEPTH ROLE READS THE MASTER'S REGULAR-SEASON PA, not `players.pa`.
      // WHY: this previously read `meta.pa` (= `players.pa`), a stat on the IDENTITY table that nothing keeps in sync
      // with the Masters. After the 2026-08-31 Masters fill, prod's `players.pa` (120.4) diverged from
      // `"Hitter Master".pa` (127.7) and 306 hitters silently dropped out of the `cornerstone` tier. On STAGING the
      // two columns happen to be equal (128.0 / 128.0, 5,343 of 5,343), which is why it never surfaced there.
      // Trevor: "Both should be regular season PA" + "we don't even really need players.pa … just change what column
      // is read". Fallback is the Master's FULL-season `pa` (Trevor: "full season is fine") so `players` is no longer
      // a stat source on this path. Matches TeamBuilder (useTeamBuilderData.ts:239 `regular_season_pa ?? pa`).
      const hitterDepthRole = defaultHitterDepthRoleFromActualPa(
        master?.regular_season_pa ?? master?.pa ?? meta.pa,
      );
      const projectedPa = paForHitterDepthRole(hitterDepthRole);
      const oWar = computeHitterOWar(result.p_wrc_plus, null, hitterDepthRole);
      // STEP 7 (2026-08-13): market rides TOTAL hitter WAR (oWAR + dWAR + bsrWAR), not oWAR alone.
      // dWAR/bsrWAR are destination-invariant — read from the Master (same values refresh_composite_war
      // sums into total_hitter_war). Market still moves only via oWAR, but the input is the full total.
      const dWar = master?.d_war != null ? Number(master.d_war) : 0;
      const bsrWar = master?.bsr_war != null ? Number(master.bsr_war) : 0;
      const totalHitterWar = oWar != null ? oWar + dWar + bsrWar : null;
      const marketValue = totalHitterWar != null
        ? computeHitterMarketValue(totalHitterWar, { conference: meta.conference, position: meta.position })
        : null;
      // TWPs keep the hitter market in twp_hitter_market_value and NULL the shared
      // market_value column — same convention as the transfer precompute /
      // deriveHitterStored. Writing the shared column for a TWP is a bug that
      // pollutes any surface reading market_value directly (the target board).
      updates.push({
        id: row.id,
        patch: {
          p_avg: result.p_avg,
          p_obp: result.p_obp,
          p_slg: result.p_slg,
          p_ops: result.p_ops,
          p_iso: result.p_iso,
          p_wrc: result.p_wrc,
          p_wrc_plus: result.p_wrc_plus,
          o_war: oWar,
          // 2026-08-23: store total_hitter_war DIRECTLY (o+d+bsr) — always fresh/consistent, no
          // refresh_composite_war() lag. total_hitter_war = position-player headline; o_war = component.
          total_hitter_war: totalHitterWar,
          // ★★ 2026-08-31 — DO NOT NULL A SHARED COLUMN WE HAVE NO VALUE FOR.
          //   `market_value` on a `returner/regular` row is SHARED between this hitter pass and the pitcher pass
          //   (precompute-returner-pitchers → derivePitcherStored). There is ONE row per player and BOTH stages
          //   write this column, so the LAST writer wins — and E37 runs AFTER E36.
          //   Previously this wrote `market_value: marketValue` unconditionally. For a PITCHER who happens to also
          //   carry a 2026 "Hitter Master" row, `oWar` is null ⇒ `marketValue` is null ⇒ this NULLED the pitcher
          //   market E36 had just written. Measured on prod: **34 D1 returner pitchers with positive p_war showing
          //   NO market value**, e.g. Derek Arrocha (SWAC, 2.531 pWAR, weekend_starter) whose correct market is
          //   $31,635. All 34 carry this pass's fingerprint (`hitter_depth_role` + `projected_pa` set, `o_war` null).
          //   ★ `predictionEngine.ts:57-59` NAMES this collision — the TWP `twp_*_market_value` split exists
          //   precisely so "the hitter loop's market_value write doesn't get stomped". But that protection only
          //   applies to players flagged `is_twp`; a pitcher who merely HAS a hitter Master row is unprotected.
          //   ⇒ Only write the shared column when we actually have a hitter value. See SILENT-FAILURE REGISTRY #24.
          ...(meta.is_twp
            ? { market_value: null, twp_hitter_market_value: marketValue }
            : (marketValue != null ? { market_value: marketValue } : {})),
          projected_pa: projectedPa,
          hitter_depth_role: hitterDepthRole,
          // Unlock so future runs can refresh; trigger reverts rates when locked=true.
          locked: false,
          updated_at: new Date().toISOString(),
        },
      });
      computed++;
    }
  }

  console.log(`${C.bold}Recalc result:${C.reset} ${C.green}${computed} computed${C.reset}, ${C.yellow}${nullProjected} all-null projections${C.reset}, ${C.yellow}${missingMasterRatings} rows missing master ratings${C.reset}`);

  if (dryRun) {
    console.log(`${C.yellow}[DRY RUN]${C.reset} would UPDATE ${updates.length} rows — diffing vs stored (no writes)...`);
    const ids = updates.map((u: any) => u.id);
    const stored = new Map<string, any>();
    for (let i = 0; i < ids.length; i += 100) {
      const { data: sd, error: se } = await (supabase as any).from("player_predictions")
        .select("id, player_id, p_avg, p_obp, p_slg, p_ops, p_iso, p_wrc_plus, o_war, total_hitter_war, market_value, projected_pa")
        .in("id", ids.slice(i, i + 100));
      if (se) throw new Error(`stored lookup failed: ${se.message}`);
      for (const r of (sd || [])) stored.set(r.id, r);
    }
    const pids = Array.from(new Set(Array.from(stored.values()).map((r: any) => r.player_id)));
    const meta = new Map<string, { name: string; div: string | null }>();
    for (let i = 0; i < pids.length; i += 100) {
      const { data: pd, error: pe } = await (supabase as any).from("players")
        .select("id, first_name, last_name, division").in("id", pids.slice(i, i + 100));
      if (pe) throw new Error(`players lookup failed: ${pe.message}`);
      for (const r of (pd || [])) meta.set(r.id, { name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(), div: r.division });
    }
    const rows = updates.map((u: any) => { const st = stored.get(u.id); return { u, s: st, m: st ? meta.get(st.player_id) : undefined }; })
      .filter((r: any) => r.s && r.m?.div === "D1");
    const qual = rows.filter((r: any) => Number(r.u.patch.projected_pa ?? r.s.projected_pa) >= 100);
    console.log(`\n${C.bold}D1 rows with a stored comparison: ${rows.length} · QUALIFIED (projected_pa>=100): ${qual.length}${C.reset}`);
    for (const [lbl, col, dp] of [["p_avg", "p_avg", 3], ["p_obp", "p_obp", 3], ["p_slg", "p_slg", 3],
                                  ["p_wrc_plus", "p_wrc_plus", 1], ["o_war", "o_war", 3],
                                  ["tot_hit_war", "total_hitter_war", 3], ["market", "market_value", 0]] as Array<[string, string, number]>) {
      _rangeReport(lbl, qual.map((r: any) => ({ before: r.s[col] == null ? null : Number(r.s[col]),
        after: r.u.patch[col] === undefined ? (r.s[col] == null ? null : Number(r.s[col])) : (r.u.patch[col] == null ? null : Number(r.u.patch[col])) })), dp);
    }
    const movers = qual.map((r: any) => ({ name: r.m.name, pa: Number(r.u.patch.projected_pa ?? r.s.projected_pa),
        b: r.s.p_wrc_plus == null ? NaN : Number(r.s.p_wrc_plus),
        a: r.u.patch.p_wrc_plus == null ? NaN : Number(r.u.patch.p_wrc_plus) }))
      .filter((x: any) => Number.isFinite(x.b) && Number.isFinite(x.a))
      .map((x: any) => ({ ...x, d: x.a - x.b })).sort((p: any, q: any) => Math.abs(q.d) - Math.abs(p.d));
    console.log(`\n${C.bold}20 LARGEST p_wrc_plus MOVES (qualified):${C.reset}`);
    for (const x of movers.slice(0, 20)) {
      const arrow = x.d >= 0 ? `${C.green}▲` : `${C.red}▼`;
      console.log(`   ${x.name.padEnd(26)} pa=${String(Math.round(x.pa)).padStart(4)}  ${_fmt(x.b, 1)} → ${_fmt(x.a, 1)}  ${arrow}${x.d >= 0 ? "+" : ""}${_fmt(x.d, 1)}${C.reset}`);
    }
    const unchanged = movers.filter((x: any) => Math.abs(x.d) < 1e-6).length;
    console.log(`\n   unchanged (|Δ|<1e-6): ${unchanged}/${movers.length}`);
    return;
  }

  // ─── Step 5: UPDATE rows in batches (NOT upsert — rows already exist) ─
  console.log(`${C.cyan}→${C.reset} updating ${updates.length} rows in batches of 100...`);
  const WRITE_BATCH = 100;
  let written = 0;
  let writeErrors = 0;
  for (let i = 0; i < updates.length; i += WRITE_BATCH) {
    const batch = updates.slice(i, i + WRITE_BATCH);
    // Each row update goes individually (Supabase UPDATE doesn't support
    // multi-row WHERE id IN (...) with per-row values). Fire concurrently
    // within each batch to keep throughput reasonable.
    const settled = await Promise.allSettled(
      batch.map((u) =>
        supabase.from("player_predictions").update(u.patch).eq("id", u.id),
      ),
    );
    for (const s of settled) {
      if (s.status === "rejected" || (s.status === "fulfilled" && (s.value as any).error)) {
        writeErrors++;
      } else {
        written++;
      }
    }
    process.stdout.write(`\r  ${written}/${updates.length}${writeErrors > 0 ? ` (${writeErrors} errors)` : ""}`);
  }
  console.log(`\n${C.green}✓ done${C.reset} — ${written} updated, ${writeErrors} errors`);
}

main().catch((e) => { console.error(e); process.exit(1); });
