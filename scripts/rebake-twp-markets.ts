/**
 * One-time: recompute TWP market values so they MATCH their stored WAR, exactly
 * like an individual hitter/pitcher (oWAR -> computeHitterMarketValue,
 * pWAR -> computePitcherMarketValue). Fixes stale twp_hitter/twp_pitcher that
 * were frozen at an old WAR. Touches target_board.transfer_snapshot (merged: both
 * sides) and team_build_players.player_snapshot (per slot: own side).
 *
 *   npx tsx scripts/rebake-twp-markets.ts          # dry run
 *   npx tsx scripts/rebake-twp-markets.ts --apply  # write
 */
import { createClient } from "@supabase/supabase-js";
import { computeHitterMarketValue, computePitcherMarketValue } from "../src/lib/depthRoles";
import { DEFAULT_PITCHING_WEIGHTS } from "../src/lib/pitchingEquations";
const APPLY = process.argv.includes("--apply");
// Double-keyed prod guard (added 2026-08-30). Already env-driven (no literal .env path),
// but it had NO guard: `--env-file .env.production.local` wrote prod with no opt-in.
const PROD_REF = "trbvxuoliwrfowibatkm";
const WANT_PROD = process.argv.includes("--prod");
const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const URL_IS_PROD = new RegExp(PROD_REF).test(SB_URL);
if (!SB_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error("✗ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set (use --env-file). Refusing."); process.exit(1); }
if (URL_IS_PROD && !WANT_PROD) { console.error(`✗ target is PROD (${PROD_REF}) but --prod was NOT passed. Refusing.`); process.exit(1); }
if (WANT_PROD && !URL_IS_PROD) { console.error(`✗ --prod passed but target is NOT prod: ${SB_URL}. Refusing.`); process.exit(1); }
console.log(`[target] ${URL_IS_PROD ? "PROD" : "STAGING"} ${SB_URL}`);
const sb = createClient(SB_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const isPit = (s: string | null) => /^(SP|RP|CL|P|LHP|RHP)/i.test(String(s || ""));

(async () => {
  // TWP players + conf/pos/team
  const twp: any[] = [];
  for (let f = 0; ; f += 1000) { const { data } = await sb.from("players").select("id, conference, position, team").eq("is_twp", true).range(f, f + 999); twp.push(...(data || [])); if (!data || data.length < 1000) break; }
  const meta = new Map(twp.map((p) => [p.id, p]));
  const ids = twp.map((p) => p.id);
  const hMkt = (owar: any, p: any) => computeHitterMarketValue(owar == null ? null : Number(owar), { conference: p?.conference ?? null, position: p?.position ?? null });
  const pMkt = (pwar: any, p: any) => computePitcherMarketValue(pwar == null ? null : Number(pwar), { conference: p?.conference ?? null, role: "RP" as any, team: p?.team ?? null }, DEFAULT_PITCHING_WEIGHTS);

  // 1) target_board.transfer_snapshot (merged — recompute BOTH sides)
  let tb: any[] = [];
  for (let f = 0; ; f += 1000) { const { data } = await sb.from("target_board").select("id, player_id, transfer_snapshot").range(f, f + 999); tb.push(...(data || [])); if (!data || data.length < 1000) break; }
  const tbUpd: any[] = [];
  for (const r of tb) {
    const p = meta.get(r.player_id); const s: any = r.transfer_snapshot;
    if (!p || !s || !s.is_twp) continue;
    const ns = { ...s, twp_hitter_market_value: hMkt(s.o_war ?? s.owar, p), twp_pitcher_market_value: pMkt(s.p_war, p), nil_valuation: null };
    tbUpd.push({ id: r.id, transfer_snapshot: ns, name: `${p.conference}/${p.position}`, before: `H${Math.round(s.twp_hitter_market_value||0)}/P${Math.round(s.twp_pitcher_market_value||0)}`, after: `H${Math.round(ns.twp_hitter_market_value||0)}/P${Math.round(ns.twp_pitcher_market_value||0)}` });
  }

  // 2) team_build_players.player_snapshot (per slot — recompute OWN side)
  const bpUpd: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const { data } = await sb.from("team_build_players").select("id, player_id, position_slot, player_snapshot").in("player_id", batch);
    for (const r of (data || [])) {
      const p = meta.get(r.player_id); const s: any = r.player_snapshot; if (!p || !s) continue;
      const ns = { ...s };
      if (isPit(r.position_slot)) ns.twp_pitcher_market_value = pMkt(s.p_war, p);
      else ns.twp_hitter_market_value = hMkt(s.o_war, p);
      ns.market_value = null;
      bpUpd.push({ id: r.id, player_snapshot: ns });
    }
  }

  console.log(`TWPs: ${twp.length} | target_board snaps to rebake: ${tbUpd.length} | team_build_players snaps: ${bpUpd.length} | APPLY=${APPLY}`);
  for (const u of tbUpd.slice(0, 8)) console.log(`  tb ${u.name}: ${u.before} -> ${u.after}`);
  if (APPLY) {
    for (const u of tbUpd) { const { error } = await sb.from("target_board").update({ transfer_snapshot: u.transfer_snapshot }).eq("id", u.id); if (error) throw error; }
    for (const u of bpUpd) { const { error } = await sb.from("team_build_players").update({ player_snapshot: u.player_snapshot }).eq("id", u.id); if (error) throw error; }
    console.log(`  done.`);
  } else console.log("DRY RUN — add --apply.");
})();
