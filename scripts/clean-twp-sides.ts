/**
 * One-time: make every TWP snapshot STRICTLY own-side, so a hitter row can only
 * ever read hitter data and a pitcher row only pitcher data — no cross-slot leak.
 *  - team_build_players.player_snapshot: hitter slot keeps hitter fields (o_war,
 *    p_avg/obp/slg, p_wrc_plus, hitter_depth_role, twp_hitter) + nulls pitcher fields;
 *    pitcher slot the reverse. Markets baked from the kept-side WAR.
 *  - target_board.transfer_snapshot: rebuilt = hitter fields from the ACTIVE build's
 *    hitter slot + pitcher fields from the pitcher slot (rostered); left as-is for
 *    non-rostered (a single neutral line — sides aren't crossed there), markets baked.
 *
 *   npx tsx scripts/clean-twp-sides.ts          # dry
 *   npx tsx scripts/clean-twp-sides.ts --apply
 */
import { createClient } from "@supabase/supabase-js";
import { computeHitterMarketValue, computePitcherMarketValue } from "../src/lib/depthRoles";
import { DEFAULT_PITCHING_WEIGHTS } from "../src/lib/pitchingEquations";
const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const isPit = (s: string | null) => /^(SP|RP|CL|P|LHP|RHP)/i.test(String(s || ""));

(async () => {
  const twp: any[] = [];
  for (let f = 0; ; f += 1000) { const { data } = await sb.from("players").select("id, conference, position, team").eq("is_twp", true).range(f, f + 999); twp.push(...(data || [])); if (!data || data.length < 1000) break; }
  const meta = new Map(twp.map((p) => [p.id, p]));
  const ids = twp.map((p) => p.id);
  const hMkt = (o: any, p: any) => o == null ? null : computeHitterMarketValue(Number(o), { conference: p?.conference ?? null, position: p?.position ?? null });
  const pMkt = (w: any, p: any) => w == null ? null : computePitcherMarketValue(Number(w), { conference: p?.conference ?? null, role: "RP" as any, team: p?.team ?? null }, DEFAULT_PITCHING_WEIGHTS);

  // hitter-only view of a snapshot
  const hitterSide = (s: any, p: any) => ({
    p_avg: s.p_avg ?? null, p_obp: s.p_obp ?? null, p_slg: s.p_slg ?? null, p_wrc_plus: s.p_wrc_plus ?? null,
    o_war: s.o_war ?? null, hitter_depth_role: s.hitter_depth_role ?? null,
    twp_hitter_market_value: hMkt(s.o_war, p),
    // null pitcher fields
    p_era: null, p_fip: null, p_whip: null, p_k9: null, p_bb9: null, p_hr9: null, p_rv_plus: null, p_war: null,
    pitcher_depth_role: null, twp_pitcher_market_value: null, market_value: null, is_twp: true,
  });
  const pitcherSide = (s: any, p: any) => ({
    p_era: s.p_era ?? null, p_fip: s.p_fip ?? null, p_whip: s.p_whip ?? null, p_k9: s.p_k9 ?? null, p_bb9: s.p_bb9 ?? null, p_hr9: s.p_hr9 ?? null,
    p_rv_plus: s.p_rv_plus ?? null, p_war: s.p_war ?? null, pitcher_depth_role: s.pitcher_depth_role ?? null,
    twp_pitcher_market_value: pMkt(s.p_war, p),
    // null hitter fields
    p_avg: null, p_obp: null, p_slg: null, p_wrc_plus: null, o_war: null, hitter_depth_role: null,
    twp_hitter_market_value: null, market_value: null, is_twp: true,
  });

  // 1) team_build_players — own-side per slot
  const bpUpd: any[] = []; const slotSnap = new Map<string, { h?: any; p?: any }>(); // build+player -> sides
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await sb.from("team_build_players").select("id, build_id, player_id, position_slot, player_snapshot").in("player_id", ids.slice(i, i + 100));
    for (const r of (data || [])) {
      const p = meta.get(r.player_id); const s: any = r.player_snapshot; if (!p || !s) continue;
      const ns = isPit(r.position_slot) ? pitcherSide(s, p) : hitterSide(s, p);
      bpUpd.push({ id: r.id, player_snapshot: ns });
      const key = `${r.build_id}|${r.player_id}`; const cur = slotSnap.get(key) ?? {}; if (isPit(r.position_slot)) cur.p = ns; else cur.h = ns; slotSnap.set(key, cur);
    }
  }

  // active build per program → to rebuild rostered transfer_snapshots from clean slots
  const { data: builds } = await sb.from("team_builds").select("id, customer_team_id").eq("is_active", true);
  const activeByTeam = new Map((builds || []).map((b: any) => [b.customer_team_id, b.id]));

  // 2) target_board.transfer_snapshot
  const tbUpd: any[] = []; let tb: any[] = [];
  for (let f = 0; ; f += 1000) { const { data } = await sb.from("target_board").select("id, player_id, customer_team_id, transfer_snapshot").range(f, f + 999); tb.push(...(data || [])); if (!data || data.length < 1000) break; }
  for (const r of tb) {
    const p = meta.get(r.player_id); const s: any = r.transfer_snapshot; if (!p || !s || !s.is_twp) continue;
    const buildId = activeByTeam.get(r.customer_team_id);
    const sides = buildId ? slotSnap.get(`${buildId}|${r.player_id}`) : null;
    let ns: any;
    if (sides?.h || sides?.p) {
      // rostered → merge explicitly: hitter fields from hitter slot, pitcher fields
      // from pitcher slot (spreading a whole side would null the other side's fields).
      const h = sides.h ?? hitterSide(s, p); const pp = sides.p ?? pitcherSide(s, p);
      ns = {
        is_twp: true, nil_valuation: null,
        p_avg: h.p_avg, p_obp: h.p_obp, p_slg: h.p_slg, p_wrc_plus: h.p_wrc_plus,
        owar: h.o_war, o_war: h.o_war, hitter_depth_role: h.hitter_depth_role, twp_hitter_market_value: h.twp_hitter_market_value,
        p_era: pp.p_era, p_fip: pp.p_fip, p_whip: pp.p_whip, p_k9: pp.p_k9, p_bb9: pp.p_bb9, p_hr9: pp.p_hr9,
        p_rv_plus: pp.p_rv_plus, p_war: pp.p_war, pitcher_depth_role: pp.pitcher_depth_role, twp_pitcher_market_value: pp.twp_pitcher_market_value,
      };
    } else {
      // not rostered → keep the neutral line's own o_war/p_war, just bake markets + null shared
      ns = { ...s, twp_hitter_market_value: hMkt(s.o_war ?? s.owar, p), twp_pitcher_market_value: pMkt(s.p_war, p), nil_valuation: null };
    }
    tbUpd.push({ id: r.id, transfer_snapshot: ns, dbg: `${p.position} owar=${(ns.owar ?? ns.o_war)?.toFixed?.(2)} twpH=${Math.round(ns.twp_hitter_market_value||0)} p_war=${ns.p_war?.toFixed?.(2)} twpP=${Math.round(ns.twp_pitcher_market_value||0)}` });
  }

  console.log(`TWPs=${twp.length} | team_build_players cleaned=${bpUpd.length} | transfer_snapshots=${tbUpd.length} | APPLY=${APPLY}`);
  for (const u of tbUpd.slice(0, 6)) console.log(`  ${u.dbg}`);
  if (APPLY) {
    for (const u of bpUpd) { const { error } = await sb.from("team_build_players").update({ player_snapshot: u.player_snapshot }).eq("id", u.id); if (error) throw error; }
    for (const u of tbUpd) { const { error } = await sb.from("target_board").update({ transfer_snapshot: u.transfer_snapshot }).eq("id", u.id); if (error) throw error; }
    console.log("  done.");
  } else console.log("DRY RUN — add --apply.");
})();
