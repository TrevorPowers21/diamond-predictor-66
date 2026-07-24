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
const rd = (f: string, k: string) => (fs.readFileSync(f, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] || "").trim().replace(/^"|"$/g, "");
const sb = createClient(rd(".env.local", "VITE_SUPABASE_URL"), rd(".env.local", "SUPABASE_SERVICE_ROLE_KEY"));
const APPLY = process.argv.includes("--apply");
const isPit = (s: any) => /^(SP|RP|CL|P|LHP|RHP)/i.test(String(s || ""));
const hitterFromRoster = (ps: any) => ({ is_twp: true, nil_valuation: null, p_avg: ps.p_avg ?? null, p_obp: ps.p_obp ?? null, p_slg: ps.p_slg ?? null, p_wrc_plus: ps.p_wrc_plus ?? null, owar: ps.o_war ?? null, o_war: ps.o_war ?? null, hitter_depth_role: ps.hitter_depth_role ?? null, twp_hitter_market_value: ps.twp_hitter_market_value ?? null });
const pitcherFromRoster = (ps: any) => ({ is_twp: true, nil_valuation: null, p_era: ps.p_era ?? null, p_fip: ps.p_fip ?? null, p_whip: ps.p_whip ?? null, p_k9: ps.p_k9 ?? null, p_bb9: ps.p_bb9 ?? null, p_hr9: ps.p_hr9 ?? null, p_rv_plus: ps.p_rv_plus ?? null, p_war: ps.p_war ?? null, pitcher_depth_role: ps.pitcher_depth_role ?? null, twp_pitcher_market_value: ps.twp_pitcher_market_value ?? null });
const hitterFromPred = (p: any) => ({ is_twp: true, nil_valuation: null, p_avg: p.p_avg, p_obp: p.p_obp, p_slg: p.p_slg, p_wrc_plus: p.p_wrc_plus, owar: p.o_war, o_war: p.o_war, hitter_depth_role: p.hitter_depth_role, twp_hitter_market_value: p.twp_hitter_market_value });
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
  const F = "player_id,customer_team_id,variant,model_type,p_avg,p_obp,p_slg,p_wrc_plus,p_era,p_fip,p_whip,p_k9,p_bb9,p_hr9,p_rv_plus,p_war,o_war,hitter_depth_role,pitcher_depth_role,twp_hitter_market_value,twp_pitcher_market_value";

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
