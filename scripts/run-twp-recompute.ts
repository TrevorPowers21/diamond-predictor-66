/**
 * Runner for the canonical TWP detector (src/lib/recomputeTwpStatus.ts).
 * Uses the shared supabase client, which in Node CLI mode reads
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local (staging).
 *
 * Usage:
 *   staging: npx tsx --env-file=.env.local            scripts/run-twp-recompute.ts [--apply]
 *   prod:    npx tsx --env-file=.env.production.local scripts/run-twp-recompute.ts --prod [--apply]
 * Threshold: PA>=30 & IP>=5 (detector default; Trevor-confirmed 2026-08-25).
 *
 * ★ ENV GUARD ADDED 2026-08-30. This script had NO guard of any kind (`grep -c` = 0 for both the prod ref and
 *   `--prod`), so `--env-file .env.production.local` wrote PROD with ZERO opt-in and passing `--prod` did nothing.
 *   It is the FIRST step of Phase E and it writes `players.is_twp` + primary `position` — the identity table every
 *   downstream precompute keys off — so an accidental prod write here corrupts every projection that follows.
 *   Fifth instance of this defect (after _run_store_no_propagate, both C28 producers, and the market scripts).
 */
import { recomputeTwpStatus } from "@/lib/recomputeTwpStatus";
import { supabase } from "@/integrations/supabase/client";

const APPLY = process.argv.includes("--apply");
const PA = 30, IP = 5, SEASON = 2026;

// ── double-keyed env guard: the URL and the --prod flag must AGREE ────────────
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const isProd = /trbvxuoliwrfowibatkm/.test(url);
const prodFlag = process.argv.includes("--prod");
if (isProd && !prodFlag) { console.error("✗ URL is PROD but --prod was not passed — refusing."); process.exit(1); }
if (!isProd && prodFlag) { console.error("✗ --prod passed but URL is not prod — refusing."); process.exit(1); }
console.log(`[env] ${isProd ? "PROD" : "STAGING/other"}  season=${SEASON}  mode=${APPLY ? "APPLY" : "DRY-RUN"}`);

// snapshot current position/is_twp by source_player_id for flip classification
const sidMeta = new Map<string, { pos: string | null; twp: boolean; div: string | null }>();
for (let f = 0; ; f += 1000) {
  const { data } = await supabase.from("players")
    .select("source_player_id, position, is_twp, division").order("id").range(f, f + 999);
  for (const p of (data || []) as any[]) if (p.source_player_id) sidMeta.set(String(p.source_player_id), { pos: p.position, twp: !!p.is_twp, div: p.division });
  if (!data || data.length < 1000) break;
}

console.log(`\n${APPLY ? "🔴 APPLY" : "🟡 DRY RUN"} — recomputeTwpStatus(${SEASON}, PA>=${PA}, IP>=${IP})\n`);
const r = await recomputeTwpStatus(SEASON, PA, IP, !APPLY);

console.log(`\n===== REPORT =====`);
console.log(`scanned:            ${r.scanned}`);
console.log(`NEW TWPs (flag on): ${r.newTwps.length}`);
console.log(`legacy-migrated:    ${r.legacyMigrated}`);
console.log(`unchanged TWPs:     ${r.unchangedTwps}`);
console.log(`demoted -> hitter:  ${r.demotedToHitter.length}`);
console.log(`demoted -> pitcher: ${r.demotedToPitcher.length}`);
console.log(`cleared -> null:    ${r.clearedToNull.length}`);
console.log(`left alone:         ${r.leftAlone}`);
console.log(`errors:             ${r.errors.length}`);
if (r.errors.length) r.errors.slice(0, 5).forEach(e => console.log(`   ! ${e}`));

// classify NEW twps by what happens to position
const flipsPtoH: any[] = [], gainFlagOnly: any[] = [], newPrimaryP: any[] = [];
let d1 = 0, juco = 0;
for (const t of r.newTwps) {
  const m = sidMeta.get(String(t.source_player_id));
  if (m?.div === "NJCAA_D1") juco++; else d1++;
  if (m?.pos === "P" && t.primaryPos !== "P") flipsPtoH.push({ ...t, oldPos: m?.pos });
  else if (t.primaryPos === "P") newPrimaryP.push(t);
  else gainFlagOnly.push({ ...t, oldPos: m?.pos });
}
console.log(`\nNEW TWP breakdown:  D1=${d1}  JUCO=${juco}`);
console.log(`  P -> hitter-primary FLIPS: ${flipsPtoH.length}`);
console.log(`  gain flag, position unchanged (already hitter Pos): ${gainFlagOnly.length}`);
console.log(`  primary stays P (no valid hitter Pos): ${newPrimaryP.length}`);
console.log(`\nsample P->hitter flips:`);
flipsPtoH.slice(0, 12).forEach(t => console.log(`   ${t.name} : P -> ${t.primaryPos}  (pa=${t.pa} ip=${Math.round(t.ip)})`));
console.log(`\nsample gain-flag-only (D1):`);
gainFlagOnly.filter(t => sidMeta.get(String(t.source_player_id))?.div !== "NJCAA_D1").slice(0, 8).forEach(t => console.log(`   ${t.name} : ${t.oldPos} + TWP  (pa=${t.pa} ip=${Math.round(t.ip)})`));
if (r.demotedToHitter.length || r.demotedToPitcher.length || r.clearedToNull.length) {
  console.log(`\ndemotions/clears (the current 2 flags may move):`);
  [...r.demotedToHitter, ...r.demotedToPitcher, ...r.clearedToNull].slice(0,6).forEach((d:any)=>console.log(`   ${d.name}: ${d.newPos!==undefined?('-> '+d.newPos):(d.reason||'')}`));
}
console.log(`\n${APPLY ? "APPLIED." : "DRY RUN — nothing written. Re-run with --apply to write."}`);
