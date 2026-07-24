/**
 * One-time: mirror the RECIPE (production_notes) from the roster onto the target
 * board, so a rostered target's toggle state travels with its snapshot. The
 * rostered-consistency backfill already copied the snapshot VALUES; this carries
 * the notes that create them, so snapshot + notes agree the same way they do on
 * the roster.
 *
 * One-way rostered targets only (single roster row). TWPs (two roster rows) are
 * skipped and logged — they need the two-row target board (phase 2).
 *
 *   npx tsx scripts/backfill-target-notes-from-roster.ts          # dry run
 *   npx tsx scripts/backfill-target-notes-from-roster.ts --apply  # write
 */
import { createClient } from "@supabase/supabase-js";
const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const depthOf = (pn: any) => { try { const o = typeof pn === "string" ? JSON.parse(pn) : pn; return o?.depthRole ?? "?"; } catch { return "?"; } };

(async () => {
  const { data: builds } = await sb.from("team_builds").select("id, customer_team_id").eq("is_active", true);
  const updates: { ctid: string; pid: string; notes: any; depth: string }[] = [];
  let twpSkipped = 0, noNotes = 0; const twpSamples: string[] = [];
  for (const b of (builds || [])) {
    const ctid = (b as any).customer_team_id as string; if (!ctid) continue;
    const { data: bps } = await sb.from("team_build_players")
      .select("player_id, position_slot, included_in_roster, production_notes")
      .eq("build_id", (b as any).id).eq("included_in_roster", true);
    const { data: tb } = await sb.from("target_board").select("player_id").eq("customer_team_id", ctid);
    const boardPids = new Set((tb || []).map((r: any) => r.player_id));
    const byPid = new Map<string, any[]>();
    for (const bp of (bps || [])) { const pid = (bp as any).player_id; if (!boardPids.has(pid)) continue; (byPid.get(pid) ?? byPid.set(pid, []).get(pid)!).push(bp); }
    for (const [pid, list] of byPid) {
      if (list.length > 1) { twpSkipped++; if (twpSamples.length < 8) twpSamples.push(`  TWP skip: ${pid.slice(0, 8)} (${list.length} roster rows)`); continue; }
      const notes = list[0].production_notes;
      if (notes == null) { noNotes++; continue; }
      updates.push({ ctid, pid, notes, depth: depthOf(notes) });
    }
  }
  console.log(`one-way rostered targets to mirror notes: ${updates.length}   (TWP skipped=${twpSkipped}, roster had no notes=${noNotes})`);
  // per-program breakdown (prove all-programs coverage, not just Georgia)
  const ctIds = [...new Set(updates.map((u) => u.ctid))];
  const ctName = new Map<string, string>();
  for (let i = 0; i < ctIds.length; i += 100) { const { data } = await sb.from("customer_teams").select("id, name").in("id", ctIds.slice(i, i + 100)); for (const c of (data || [])) ctName.set(c.id, c.name); }
  const byCt = new Map<string, number>(); for (const u of updates) byCt.set(u.ctid, (byCt.get(u.ctid) ?? 0) + 1);
  console.log("by program:"); for (const [id, n] of byCt) console.log(`  ${ctName.get(id) ?? id.slice(0, 8)}: ${n}`);
  // name the changes
  const pids = updates.map((u) => u.pid);
  const nm = new Map<string, string>();
  for (let i = 0; i < pids.length; i += 200) { const { data } = await sb.from("players").select("id, first_name, last_name").in("id", pids.slice(i, i + 200)); for (const p of (data || [])) nm.set(p.id, `${p.first_name} ${p.last_name}`); }
  for (const u of updates.slice(0, 25)) console.log(`  ${nm.get(u.pid) ?? u.pid.slice(0, 8)}: roster depth=${u.depth} → target_board.production_notes`);
  if (twpSamples.length) { console.log("TWP (phase 2):"); twpSamples.forEach((s) => console.log(s)); }
  if (!APPLY) { console.log("\nDRY RUN — add --apply."); return; }
  for (const u of updates) { const { error } = await sb.from("target_board").update({ production_notes: u.notes }).eq("customer_team_id", u.ctid).eq("player_id", u.pid); if (error) throw error; }
  console.log(`✅ applied ${updates.length}`);
})();
