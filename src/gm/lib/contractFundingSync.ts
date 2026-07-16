export type FundingMode = "new_money" | "from_base";

/**
 * Contract → funding sync (GM layer ONLY — never touches team_build_players).
 * Shared by useGmContracts (live, with the app client) and the prod backfill
 * script (with a service client), so both run the exact same logic.
 *
 * A contract behaves like a vendor allocation on the Funding Sources page:
 *   new_money → the vendor's source pool auto-sums its allocations (funds the
 *     NIL/Other cap); the player's total + the cap grow together.
 *   from_base (carve) → same allocation, but the source pool stays null (doesn't
 *     fund the cap) and the player's unassigned amount drops by the same amount,
 *     so their total is unchanged (details existing budget).
 * Writes gm_allocation_source / gm_allocation / gm_player_finance only — the
 * coach sees nothing until a per-row finalize pushes Actual Pay to the build.
 *
 * `sb` is any Supabase client. Returns the allocation id (or null).
 */
export async function syncContractFunding(
  sb: any,
  teamId: string,
  userId: string | null,
  p: { player_id: string; bucket: string; vendor_id: string | null; vendor_name: string | null; funding_mode: FundingMode },
  season: number,
): Promise<string | null> {
  if ((p.bucket !== "nil" && p.bucket !== "other") || !p.vendor_id) return null;
  // Resolve the active/live build the same way useGmRoster's liveBuildId does:
  // flagged active → else most-recently-updated non-default → else default.
  const { data: ab } = await sb.from("team_builds")
    .select("id, is_active, is_default, archived, updated_at").eq("customer_team_id", teamId).order("updated_at", { ascending: false });
  const bl = (ab ?? []).filter((b: any) => !b.archived);
  const buildId = (bl.find((b: any) => b.is_active) ?? bl.find((b: any) => !b.is_default) ?? bl.find((b: any) => b.is_default) ?? bl[0])?.id as string | undefined;
  if (!buildId) return null;
  // Find-or-create the vendor's funding source in the active build. The SOURCE's
  // mode (set at creation) governs — a vendor is new-money or carve as a whole.
  const { data: exist } = await sb.from("gm_allocation_source")
    .select("id, funding_mode").eq("team_build_id", buildId).eq("vendor_id", p.vendor_id).eq("bucket", p.bucket).limit(1);
  let sourceId: string; let mode: FundingMode;
  if (exist?.[0]) { sourceId = exist[0].id; mode = exist[0].funding_mode; }
  else {
    const { data: ins, error } = await sb.from("gm_allocation_source").insert({
      customer_team_id: teamId, team_build_id: buildId, vendor_id: p.vendor_id, name: p.vendor_name?.trim() || "Vendor",
      bucket: p.bucket, total: null, funding_mode: p.funding_mode, base_offset: 0, sort_order: 9999, created_by_user_id: userId,
    }).select("id, funding_mode").single();
    if (error || !ins) return null;
    sourceId = ins.id; mode = ins.funding_mode;
  }
  // The player's allocation = Σ their deals with this vendor+bucket.
  const { data: cs } = await sb.from("gm_contract")
    .select("total_value").eq("customer_team_id", teamId).eq("player_id", p.player_id).eq("vendor_id", p.vendor_id).eq("bucket", p.bucket);
  const newAmount = (cs ?? []).reduce((s: number, c: any) => s + (Number(c.total_value) || 0), 0);
  const { data: al } = await sb.from("gm_allocation").select("id, amount").eq("source_id", sourceId).eq("player_id", p.player_id).limit(1);
  const oldAmount = al?.[0] ? Number(al[0].amount) || 0 : 0;
  let allocationId: string | null = al?.[0]?.id ?? null;
  if (newAmount > 0) {
    const { data: up } = await sb.from("gm_allocation").upsert(
      { customer_team_id: teamId, source_id: sourceId, player_id: p.player_id, amount: newAmount, updated_by_user_id: userId, updated_at: new Date().toISOString() },
      { onConflict: "source_id,player_id" }).select("id").single();
    allocationId = up?.id ?? allocationId;
  } else if (al?.[0]) {
    await sb.from("gm_allocation").delete().eq("id", al[0].id);
    allocationId = null;
  }
  if (mode === "new_money") {
    // Auto-sum the pool so the vendor's money funds the cap.
    const { data: allAl } = await sb.from("gm_allocation").select("amount").eq("source_id", sourceId);
    const pool = (allAl ?? []).reduce((s: number, a: any) => s + (Number(a.amount) || 0), 0);
    await sb.from("gm_allocation_source").update({ total: pool }).eq("id", sourceId);
  } else {
    // Carve: keep the player's total constant by absorbing the delta out of their
    // unassigned amount (mirrors the funding page's "Total" edit). Rostered only.
    const delta = newAmount - oldAmount;
    if (delta !== 0) {
      const { data: bp } = await sb.from("team_build_players").select("id").eq("build_id", buildId).eq("player_id", p.player_id).limit(1);
      const bpid = bp?.[0]?.id as string | undefined;
      if (bpid) {
        const field = p.bucket === "nil" ? "nil_amount" : "other_amount";
        const { data: fin } = await sb.from("gm_player_finance").select(field).eq("build_player_id", bpid).limit(1);
        const cur = fin?.[0]?.[field] != null ? Number(fin[0][field]) : 0;
        await sb.from("gm_player_finance").upsert(
          { build_player_id: bpid, customer_team_id: teamId, player_id: p.player_id, season, [field]: Math.max(0, cur - delta), updated_by_user_id: userId, updated_at: new Date().toISOString() },
          { onConflict: "build_player_id" });
      }
    }
  }
  return allocationId;
}
