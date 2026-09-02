/**
 * Fill total_hitter_war (+ d_war, bsr_war) into the stored HITTER snapshots so the
 * build/board/hub surfaces read the same headline total WAR as the prediction-fed
 * Dashboard (7b display swap). Snapshots stored o_war only, so pickHitterWar fell
 * back to o_war on build-player profiles -> misaligned with the Dashboard total.
 *
 * total_hitter_war = snapshot.o_war (toggle-baked) + d_war + bsr_war (stored on the
 * player's precompute row; d/bsr are destination- and toggle-invariant). This respects
 * the coach's baked toggles (a no-toggle player then aligns with the Dashboard; a
 * toggled player correctly shows the build's toggled total).
 *
 * Targets: team_build_players.{player_snapshot,neutral_snapshot} +
 *          target_board.{transfer_snapshot,neutral_snapshot}. Pitcher snapshots untouched.
 * Idempotent (skips snapshots that already have total_hitter_war). Dry-run default; --apply to write.
 *
 *   staging: npx tsx --env-file=.env.local            scripts/backfill-snapshot-total-hitter-war.ts [--apply]
 *   prod:    npx tsx --env-file=.env.production.local scripts/backfill-snapshot-total-hitter-war.ts --prod [--apply]
 *
 * ★ ENV GUARD ADDED 2026-08-30 (push step F40). This script had NO guard of any kind — it read
 *   `process.env.SUPABASE_URL` with **no `--prod` flag anywhere** (`grep -c` = 0/0), so
 *   `--env-file=.env.production.local` wrote PROD with ZERO opt-in and the only signal was a `host` banner.
 *   It writes team_build_players + target_board snapshots, i.e. coach-visible build/board data.
 *   SIXTH instance of this defect class (after _run_store_no_propagate, both C28 producers, the market
 *   scripts, run-twp-recompute (E35) and backfill_park_factors_seasonal (E2)).
 */
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");

// ── double-keyed env guard: the URL and the --prod flag must AGREE ────────────
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const isProd = /trbvxuoliwrfowibatkm/.test(url);
const prodFlag = process.argv.includes("--prod");
if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("✗ Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY."); process.exit(1);
}
if (isProd && !prodFlag) { console.error("✗ URL is PROD but --prod was not passed — refusing."); process.exit(1); }
if (!isProd && prodFlag) { console.error("✗ --prod passed but URL is not prod — refusing."); process.exit(1); }

const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const host = url.replace(/https:\/\//, "").split(".")[0];
console.log(`[env] ${isProd ? "🔴 PROD" : "STAGING/other"} (${host})  mode=${APPLY ? "APPLY" : "DRY-RUN"}`);

const num = (v: any): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

async function pageAll(table: string, cols: string): Promise<any[]> {
  const out: any[] = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    // ORDER BY id is REQUIRED — range() pagination without a stable sort silently skips/dupes rows.
    const { data, error } = await (sb as any).from(table).select(cols).order("id", { ascending: true }).range(from, from + page - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || !data.length) break;
    out.push(...data);
    if (data.length < page) break;
    from += page;
  }
  return out;
}

/**
 * d_war/bsr_war per player (destination-invariant), for ONLY the snapshot players.
 * Robust: bounded .in() chunks of 100 players, and PAGINATE inside each chunk (each player
 * has ~14 team rows, so a 100-player chunk exceeds the 1000-row cap — must range-page it).
 * Avoids both failure modes: the 200k full scan intermittently drops rows; a single .in()
 * silently truncates at 1000. A player absent here has no d/bsr row → treated as d/bsr 0.
 */
async function buildDbsrMap(playerIds: string[]): Promise<Map<string, { d: number; bsr: number }>> {
  const m = new Map<string, { d: number; bsr: number }>();
  const ids = [...new Set(playerIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    let from = 0;
    for (;;) {
      const { data, error } = await (sb as any)
        .from("player_predictions")
        .select("player_id, d_war, bsr_war")
        .in("player_id", chunk)
        .not("d_war", "is", null)
        .order("player_id", { ascending: true })
        .range(from, from + 999);
      if (error) throw new Error(`dbsr: ${error.message}`);
      if (!data || !data.length) break;
      for (const r of data) {
        if (!r.player_id || m.has(r.player_id)) continue;
        m.set(r.player_id, { d: num(r.d_war) ?? 0, bsr: num(r.bsr_war) ?? 0 });
      }
      if (data.length < 1000) break;
      from += 1000;
    }
  }
  return m;
}

/**
 * Returns a mutated HITTER snapshot when its total_hitter_war (or d/bsr) is not the correct
 * o_war + real d + real bsr — idempotent BY VALUE (fixes null totals AND stale total==o_war/d=0
 * from earlier writers). Returns null for pitcher snapshots, no-WAR rows, or already-correct rows.
 * If the player has no d/bsr row (dbsr undefined), total = o_war (correct: JUCO/no-defense → d/bsr 0).
 */
function fillHitter(snap: any, dbsr: { d: number; bsr: number } | undefined): any | null {
  if (!snap || typeof snap !== "object") return null;
  const owar = num(snap.o_war ?? snap.owar);
  if (owar == null) return null; // pitcher snapshot or no WAR — skip
  const d = dbsr?.d ?? 0, bsr = dbsr?.bsr ?? 0;
  const want = owar + d + bsr;
  const haveTotal = num(snap.total_hitter_war);
  const haveD = num(snap.d_war), haveBsr = num(snap.bsr_war);
  const consistent = haveTotal != null && Math.abs(haveTotal - want) < 0.001 && haveD === d && haveBsr === bsr;
  if (consistent) return null; // already correct — no write
  return { ...snap, total_hitter_war: want, d_war: d, bsr_war: bsr };
}

async function main() {
  console.log(`DB=${host} mode=${APPLY ? "APPLY" : "DRY-RUN"}`);

  // team_build_players + target_board
  const bps = await pageAll("team_build_players", "id, player_id, player_snapshot, neutral_snapshot");
  const tbs = await pageAll("target_board", "id, player_id, transfer_snapshot, neutral_snapshot");

  const snapPlayerIds = [...bps, ...tbs].map((r) => r.player_id);
  const dbsr = await buildDbsrMap(snapPlayerIds);
  console.log(`d/bsr map: ${dbsr.size} players (of ${new Set(snapPlayerIds.filter(Boolean)).size} snapshot players)`);

  const plans: { table: string; id: any; patch: Record<string, any>; label: string }[] = [];
  for (const bp of bps) {
    const patch: Record<string, any> = {};
    const d = dbsr.get(bp.player_id);
    const ps = fillHitter(bp.player_snapshot, d);
    if (ps) patch.player_snapshot = ps;
    const ns = fillHitter(bp.neutral_snapshot, d);
    if (ns) patch.neutral_snapshot = ns;
    if (Object.keys(patch).length) plans.push({ table: "team_build_players", id: bp.id, patch, label: `tbp ${String(bp.player_id).slice(0, 8)}` });
  }

  for (const tb of tbs) {
    const patch: Record<string, any> = {};
    const d = dbsr.get(tb.player_id);
    const ts = fillHitter(tb.transfer_snapshot, d);
    if (ts) patch.transfer_snapshot = ts;
    const ns = fillHitter(tb.neutral_snapshot, d);
    if (ns) patch.neutral_snapshot = ns;
    if (Object.keys(patch).length) plans.push({ table: "target_board", id: tb.id, patch, label: `tb ${String(tb.player_id).slice(0, 8)}` });
  }

  console.log(`\nsnapshots to fill: ${plans.length}`);
  for (const p of plans.slice(0, 8)) {
    const k = Object.keys(p.patch).join("+");
    const s = p.patch.player_snapshot ?? p.patch.neutral_snapshot ?? p.patch.transfer_snapshot;
    console.log(`  ${p.label} [${k}]: o_war=${(s.o_war ?? s.owar)?.toFixed?.(2)} + d${s.d_war?.toFixed?.(2)} + bsr${s.bsr_war?.toFixed?.(2)} => total ${s.total_hitter_war?.toFixed?.(2)}`);
  }

  if (!APPLY) { console.log("\nDRY-RUN — no writes. Re-run with --apply."); return; }

  let done = 0;
  for (const p of plans) {
    const { error } = await (sb as any).from(p.table).update(p.patch).eq("id", p.id);
    if (error) { console.log(`ERR ${p.table} ${p.id}: ${error.message}`); process.exit(1); }
    done++;
    if (done % 200 === 0) console.log(`  …${done}/${plans.length}`);
  }
  console.log(`\nAPPLIED: filled total_hitter_war on ${done} snapshots.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
