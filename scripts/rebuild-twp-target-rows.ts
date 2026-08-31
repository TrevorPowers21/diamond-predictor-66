/**
 * Rebuild every TWP's target_board rows into exactly TWO own-side rows (hitter slot
 * + pitcher slot). Idempotent: deletes the player's board rows for the team and
 * reinserts two from the source of truth — the active-build roster if rostered,
 * else the gatekept player_predictions line. Fixes the partial split.
 *
 *   npx tsx scripts/rebuild-twp-target-rows.ts          # dry run
 *   npx tsx scripts/rebuild-twp-target-rows.ts --apply  # write
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import { resolveActiveBuildId } from "../src/lib/activeBuild";
// Env-driven + double-keyed prod guard (added 2026-08-30, matching resync-build-snapshot-markets.ts).
const PROD_REF = "trbvxuoliwrfowibatkm";
const WANT_PROD = process.argv.includes("--prod");
const ENV = WANT_PROD ? ".env.production.local" : ".env.local";
const rd = (f: string, k: string) => { try { return (fs.readFileSync(f, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] || "").trim().replace(/^"|"$/g, ""); } catch { return ""; } };
const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || rd(ENV, "VITE_SUPABASE_URL") || rd(ENV, "SUPABASE_URL");
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || rd(ENV, "SUPABASE_SERVICE_ROLE_KEY");
const URL_IS_PROD = new RegExp(PROD_REF).test(SB_URL || "");
if (!SB_URL || !SB_KEY) { console.error(`✗ no Supabase URL/key resolved (env vars or ${ENV}). Refusing.`); process.exit(1); }
if (URL_IS_PROD && !WANT_PROD) { console.error(`✗ target is PROD (${PROD_REF}) but --prod was NOT passed. Refusing.`); process.exit(1); }
if (WANT_PROD && !URL_IS_PROD) { console.error(`✗ --prod passed but target is NOT prod: ${SB_URL}. Refusing.`); process.exit(1); }
console.log(`[target] ${URL_IS_PROD ? "PROD" : "STAGING"} ${SB_URL}`);
const sb = createClient(SB_URL, SB_KEY);
const APPLY = process.argv.includes("--apply");
const isPit = (s: any) => /^(SP|RP|CL|P|LHP|RHP)/i.test(String(s || ""));
// ★ `total_hitter_war` (= o_war + d_war + bsr_war, NO p_war) MUST be carried through. F40 wrote it onto every
//   hitter snapshot; this builder is a HAND-LISTED field set, so anything omitted here is SILENTLY STRIPPED on
//   rebuild — it deletes the board rows and reinserts from these objects. Omitting it re-broke F40's own gate
//   ("0 snapshots with o_war but NULL total_hitter_war"). Added 2026-08-31. See SILENT-FAILURE REGISTRY #18.
//   ⛔ If you add a field to the hitter snapshot anywhere else, add it HERE and to `F` below, or it will vanish.
const hitterFromRoster = (ps: any) => ({ is_twp: true, nil_valuation: null, p_avg: ps.p_avg ?? null, p_obp: ps.p_obp ?? null, p_slg: ps.p_slg ?? null, p_wrc_plus: ps.p_wrc_plus ?? null, owar: ps.o_war ?? null, o_war: ps.o_war ?? null, d_war: ps.d_war ?? null, bsr_war: ps.bsr_war ?? null, total_hitter_war: ps.total_hitter_war ?? null, hitter_depth_role: ps.hitter_depth_role ?? null, twp_hitter_market_value: ps.twp_hitter_market_value ?? null });
const pitcherFromRoster = (ps: any) => ({ is_twp: true, nil_valuation: null, p_era: ps.p_era ?? null, p_fip: ps.p_fip ?? null, p_whip: ps.p_whip ?? null, p_k9: ps.p_k9 ?? null, p_bb9: ps.p_bb9 ?? null, p_hr9: ps.p_hr9 ?? null, p_rv_plus: ps.p_rv_plus ?? null, p_war: ps.p_war ?? null, pitcher_depth_role: ps.pitcher_depth_role ?? null, twp_pitcher_market_value: ps.twp_pitcher_market_value ?? null });
const hitterFromPred = (p: any) => ({ is_twp: true, nil_valuation: null, p_avg: p.p_avg, p_obp: p.p_obp, p_slg: p.p_slg, p_wrc_plus: p.p_wrc_plus, owar: p.o_war, o_war: p.o_war, d_war: p.d_war ?? null, bsr_war: p.bsr_war ?? null, total_hitter_war: p.total_hitter_war ?? null, hitter_depth_role: p.hitter_depth_role, twp_hitter_market_value: p.twp_hitter_market_value });
const pitcherFromPred = (p: any) => ({ is_twp: true, nil_valuation: null, p_era: p.p_era, p_fip: p.p_fip, p_whip: p.p_whip, p_k9: p.p_k9, p_bb9: p.p_bb9, p_hr9: p.p_hr9, p_rv_plus: p.p_rv_plus, p_war: p.p_war, pitcher_depth_role: p.pitcher_depth_role, twp_pitcher_market_value: p.twp_pitcher_market_value });

(async () => {
  const { data: twp } = await sb.from("players").select("id, first_name, last_name, position").eq("is_twp", true);
  const twpIds = new Set((twp || []).map((p: any) => p.id));
  const nm = new Map((twp || []).map((p: any) => [p.id, `${p.first_name} ${p.last_name}`]));
  const posOf = new Map((twp || []).map((p: any) => [p.id, p.position]));
  const { data: tb } = await sb.from("target_board").select("id, user_id, player_id, customer_team_id").in("player_id", [...twpIds]);
  // group board rows by (player, ct)
  const groups = new Map<string, { pid: string; ctid: string; user_id: string }>();
  for (const r of (tb || [])) groups.set(`${r.player_id}|${r.customer_team_id}`, { pid: r.player_id, ctid: r.customer_team_id, user_id: (r as any).user_id });
  const { data: builds } = await sb.from("team_builds").select("id, customer_team_id, is_active, is_default, team, academic_year, updated_at, created_at");
  const buildsByCt = new Map<string, any[]>(); for (const b of (builds || [])) { (buildsByCt.get(b.customer_team_id) ?? buildsByCt.set(b.customer_team_id, []).get(b.customer_team_id)!).push(b); }
  // ★ d_war / bsr_war / total_hitter_war added 2026-08-31 — without them `hitterFromPred` cannot carry the
  //   composite and the rebuilt row loses it silently. See REGISTRY #18.
  const F = "player_id,customer_team_id,variant,model_type,p_avg,p_obp,p_slg,p_wrc_plus,p_era,p_fip,p_whip,p_k9,p_bb9,p_hr9,p_rv_plus,p_war,o_war,d_war,bsr_war,total_hitter_war,hitter_depth_role,pitcher_depth_role,twp_hitter_market_value,twp_pitcher_market_value";

  let done = 0; const samples: string[] = [];
  for (const { pid, ctid, user_id } of groups.values()) {
    const activeId = resolveActiveBuildId(buildsByCt.get(ctid));
    let hSlot = "UTL", pSlot = "SP", hSnap: any = null, pSnap: any = null, hNotes: any = null, pNotes: any = null, src = "pred";
    if (activeId) {
      const { data: bps } = await sb.from("team_build_players").select("position_slot, player_snapshot, production_notes").eq("build_id", activeId).eq("player_id", pid).eq("included_in_roster", true);
      const h = (bps || []).find((x: any) => !isPit(x.position_slot)); const p = (bps || []).find((x: any) => isPit(x.position_slot));
      if (h && p) { src = "roster"; hSlot = h.position_slot || "UTL"; pSlot = p.position_slot || "SP"; hSnap = hitterFromRoster(h.player_snapshot || {}); pSnap = pitcherFromRoster(p.player_snapshot || {}); hNotes = h.production_notes ?? null; pNotes = p.production_notes ?? null; }
    }
    if (!hSnap) { // gatekept prediction
      const { data: preds } = await sb.from("player_predictions").select(F).eq("player_id", pid).eq("season", 2027);
      const rows = (preds || []) as any[];
      const pred = rows.find((r) => r.customer_team_id === ctid && r.variant === "precomputed") ?? rows.find((r) => r.model_type === "returner" && r.variant === "regular" && r.customer_team_id == null) ?? rows.find((r) => r.customer_team_id === ctid) ?? rows[0];
      if (!pred) { console.log(`  ⚠ no prediction for ${nm.get(pid)} @ ${ctid.slice(0, 8)} — skipped`); continue; }
      const pos = posOf.get(pid); hSlot = isPit(pos) ? "UTL" : (pos || "UTL"); pSlot = /starter/i.test(String(pred.pitcher_depth_role || "")) ? "SP" : "RP";
      hSnap = hitterFromPred(pred); pSnap = pitcherFromPred(pred);
    }
    done++;
    if (samples.length < 12) samples.push(`  ${nm.get(pid)} @${ctid.slice(0, 8)} [${src}]: ${hSlot} owar=${hSnap.owar} twpH=${hSnap.twp_hitter_market_value == null ? "-" : Math.round(hSnap.twp_hitter_market_value)} | ${pSlot} pwar=${pSnap.p_war} twpP=${pSnap.twp_pitcher_market_value == null ? "-" : Math.round(pSnap.twp_pitcher_market_value)}`);
    if (APPLY) {
      await sb.from("target_board").delete().eq("player_id", pid).eq("customer_team_id", ctid);
      const { error } = await sb.from("target_board").insert([
        { user_id, player_id: pid, customer_team_id: ctid, position_slot: hSlot, transfer_snapshot: hSnap, production_notes: hNotes },
        { user_id, player_id: pid, customer_team_id: ctid, position_slot: pSlot, transfer_snapshot: pSnap, production_notes: pNotes },
      ]);
      if (error) console.log(`  insert err ${nm.get(pid)}: ${error.message}`);
    }
  }
  console.log(`TWP (player,team) groups rebuilt to 2 rows: ${done}`);
  samples.forEach((s) => console.log(s));
  console.log(APPLY ? "\n✅ applied" : "\nDRY RUN — add --apply.");
})();
