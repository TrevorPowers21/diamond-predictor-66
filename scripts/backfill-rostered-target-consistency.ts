/**
 * One-time consistency fix: for a target that's also on its program's ACTIVE build
 * roster (included_in_roster=true), copy the build player_snapshot INTO the
 * target_board.transfer_snapshot (field-mapped) so the two lines are 1:1. After
 * this, off-roster reads transfer_snapshot and on-roster reads player_snapshot and
 * they show the SAME numbers; the saveTargetToggle lockstep keeps them 1:1 going forward.
 *
 *   npx tsx scripts/backfill-rostered-target-consistency.ts          # dry run
 *   npx tsx scripts/backfill-rostered-target-consistency.ts --apply  # write
 */
import { createClient } from "@supabase/supabase-js";
const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const isPitSlot = (slot: string | null) => /^(SP|RP|CL|P|LHP|RHP)/i.test(String(slot || ""));

// player_snapshot (o_war / market_value) -> transfer_snapshot (owar / nil_valuation),
// keeping the shared fields + TWP splits. Mirrors saveTargetToggle's t/bp mapping.
function toTransfer(ps: any): any {
  const t: any = { ...ps };
  const isTwp = !!ps.is_twp;
  t.owar = ps.o_war ?? null;
  t.o_war = ps.o_war ?? null;              // saveTargetToggle writes both
  t.nil_valuation = isTwp ? null : (ps.market_value ?? null);
  delete t.market_value;                    // roster-only field name
  return t;
}

// A TWP has two roster rows (hitter slot + pitcher slot). Take the HITTER fields
// from the hitter-slot snapshot and the PITCHER fields from the pitcher-slot
// snapshot — never let one slot's stale other-side pollute the merged line.
function mergeTwp(h: any, p: any): any {
  return {
    is_twp: true, nil_valuation: null,
    // hitter side (hitter slot)
    p_avg: h?.p_avg ?? null, p_obp: h?.p_obp ?? null, p_slg: h?.p_slg ?? null,
    p_wrc_plus: h?.p_wrc_plus ?? null, owar: h?.o_war ?? null, o_war: h?.o_war ?? null,
    hitter_depth_role: h?.hitter_depth_role ?? null,
    twp_hitter_market_value: h?.twp_hitter_market_value ?? null,
    // pitcher side (pitcher slot)
    p_era: p?.p_era ?? null, p_fip: p?.p_fip ?? null, p_whip: p?.p_whip ?? null,
    p_k9: p?.p_k9 ?? null, p_bb9: p?.p_bb9 ?? null, p_hr9: p?.p_hr9 ?? null,
    p_rv_plus: p?.p_rv_plus ?? null, p_war: p?.p_war ?? null,
    pitcher_depth_role: p?.pitcher_depth_role ?? null,
    twp_pitcher_market_value: p?.twp_pitcher_market_value ?? null,
  };
}

(async () => {
  // active build per program
  const { data: builds } = await sb.from("team_builds").select("id, customer_team_id").eq("is_active", true);
  console.log(`active builds: ${builds?.length ?? 0}`);
  let updates: { ctid: string; pid: string; ts: any }[] = [];
  let noBoard = 0, noSnap = 0;
  for (const b of (builds || [])) {
    const ctid = (b as any).customer_team_id as string;
    if (!ctid) continue;
    // rostered players on this active build
    const { data: bps } = await sb.from("team_build_players")
      .select("player_id, position_slot, included_in_roster, player_snapshot")
      .eq("build_id", (b as any).id).eq("included_in_roster", true);
    // that program's target board
    const { data: tb } = await sb.from("target_board")
      .select("player_id, transfer_snapshot").eq("customer_team_id", ctid);
    const boardPids = new Set((tb || []).map((r: any) => r.player_id));
    // group roster rows by player — a TWP has two (hitter slot + pitcher slot)
    const byPid = new Map<string, any[]>();
    for (const bp of (bps || [])) {
      const pid = (bp as any).player_id as string;
      if (!boardPids.has(pid) || !(bp as any).player_snapshot) continue;
      (byPid.get(pid) ?? byPid.set(pid, []).get(pid)!).push(bp);
    }
    for (const [pid, list] of byPid) {
      if (list.length === 1) { updates.push({ ctid, pid, ts: toTransfer(list[0].player_snapshot) }); continue; }
      // TWP: hitter fields from the hitter slot, pitcher fields from the pitcher slot
      const hitRow = list.find((r) => !isPitSlot(r.position_slot)) ?? list[0];
      const pitRow = list.find((r) => isPitSlot(r.position_slot)) ?? list[0];
      updates.push({ ctid, pid, ts: mergeTwp(hitRow.player_snapshot, pitRow.player_snapshot) });
    }
  }
  console.log(`rostered targets to reconcile: ${updates.length}  (noSnapshot=${noSnap})`);
  for (const u of updates.slice(0, 10)) {
    const { data: p } = await sb.from("players").select("first_name,last_name,is_twp").eq("id", u.pid).maybeSingle();
    console.log(`  ${p?.first_name} ${p?.last_name}${p?.is_twp ? " (TWP)" : ""}: owar=${u.ts.owar} p_war=${u.ts.p_war} wrc=${u.ts.p_wrc_plus} rv=${u.ts.p_rv_plus} nil=${u.ts.nil_valuation} twpH=${u.ts.twp_hitter_market_value ?? "-"} twpP=${u.ts.twp_pitcher_market_value ?? "-"}`);
  }
  if (APPLY) {
    for (let i = 0; i < updates.length; i++) {
      const { error } = await sb.from("target_board").update({ transfer_snapshot: updates[i].ts })
        .eq("customer_team_id", updates[i].ctid).eq("player_id", updates[i].pid);
      if (error) throw error;
    }
    console.log(`  done (${updates.length} target_board rows).`);
  } else console.log("DRY RUN — add --apply.");
})();
