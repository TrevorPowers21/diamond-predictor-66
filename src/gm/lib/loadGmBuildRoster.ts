import { supabase } from "@/integrations/supabase/client";
import { readPitchingWeights } from "@/lib/pitchingEquations";
import { parseBuildPlayerMeta, projectedEligibilityClass } from "@/pages/team-builder/helpers";
import { effectivePitcherWar, effectiveHitterWar, effectiveMarket, pitcherSessionRole } from "@/lib/effectiveProjection";
import type { GmRow } from "@/gm/hooks/useGmRoster";

export const isPitcherPos = (s: string | null | undefined) => /^(SP|RP|CL|P|LHP|RHP)/i.test(String(s || ""));

/**
 * Pure mapper: turn raw team_build_players rows (+ joined players / finance) into
 * the GmRow the UI renders. Applies the coach's saved production_notes toggles on
 * read (depth role → PA/IP, dev_agg → rate) so GM numbers match Team Builder.
 * Extracted so useGmRoster and the Scenarios page derive rows IDENTICALLY — a
 * change here flows to both, never to just one.
 */
export function deriveGmRows(
  rowsRaw: any[],
  pById: Map<string, any>,
  finByBp: Map<string, any>,
  eq: ReturnType<typeof readPitchingWeights>,
  vendorByPlayer: Map<string, { nil: number; other: number }> = new Map(),
): GmRow[] {
  return rowsRaw.map((r: any) => {
    const meta = parseBuildPlayerMeta(r.production_notes) as any;
    const isLocal = !r.player_id;
    const local = meta?.localPlayer ?? null;
    const p = r.player_id ? pById.get(r.player_id) : null;
    const snap = r.player_snapshot || {};
    const pitcher = isPitcherPos(r.position_slot) || isPitcherPos(p?.position) || isPitcherPos(local?.position);
    const f = finByBp.get(r.id) || {};
    const vend = (r.player_id ? vendorByPlayer.get(String(r.player_id)) : null) ?? { nil: 0, other: 0 };
    const mv = snap.market_value ?? snap.twp_hitter_market_value ?? snap.twp_pitcher_market_value ?? null;
    const storedWar = pitcher ? (snap.p_war ?? null) : (snap.o_war ?? null);

    const devAgg = Number.isFinite(Number(meta?.devAggressiveness)) ? Number(meta.devAggressiveness) : 0;
    const classTransition = meta?.classTransition ?? "SJ";
    const sessionDepthRole = pitcher
      ? (meta?.depthRole ?? (snap.pitcher_role === "SP" ? "weekend_starter" : snap.pitcher_role === "SM" ? "weekday_starter" : undefined))
      : (meta?.depthRole ?? snap.hitter_depth_role);
    const effWar = pitcher
      ? effectivePitcherWar(snap, sessionDepthRole, devAgg, classTransition, eq)
      : effectiveHitterWar(snap.o_war, snap.hitter_depth_role, sessionDepthRole, devAgg, classTransition);
    const effMarket = effectiveMarket(mv, storedWar, effWar);

    const displayPosition = isLocal
      ? (r.position_slot ?? local?.position ?? null)
      : pitcher
        ? pitcherSessionRole(sessionDepthRole)
        : (p?.position ?? r.position_slot ?? null);

    return {
      player_id: r.player_id,
      build_player_id: r.id,
      name: p ? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() : (r.custom_name || "—"),
      position: displayPosition,
      class_year: p?.class_year ?? null,
      is_pitcher: pitcher,
      war: effWar ?? storedWar,
      market_value: effMarket ?? mv,
      nil_value: r.nil_value ?? null,
      scholarship_amount: f.scholarship_amount ?? null,
      rev_share: f.rev_share ?? null,
      nil_amount: f.nil_amount ?? null,
      other_amount: f.other_amount ?? null,
      nil_vendor: vend.nil,
      other_vendor: vend.other,
      actual_pay:
        f.rev_share == null && f.nil_amount == null && f.other_amount == null && vend.nil === 0 && vend.other === 0
          ? null
          : Number(f.rev_share ?? 0) + Number(f.nil_amount ?? 0) + Number(f.other_amount ?? 0) + vend.nil + vend.other,
      finalized: !!f.finalized,
      eligibility_class:
        f.eligibility_class ?? (isLocal ? "FR" : projectedEligibilityClass(p?.class_year, meta?.classTransition ?? null)),
    };
  });
}

/**
 * Fetch + derive one build's roster (rows) plus its coach total budget and GM
 * notes. Loads any build by id — used by the Scenarios page to pull arbitrary
 * builds of the current team.
 */
export async function loadGmBuildRoster(
  buildId: string,
  teamId: string,
): Promise<{ rows: GmRow[]; coachTotalBudget: number | null }> {
  const { data: bps } = await (supabase as any)
    .from("team_build_players")
    .select("id, player_id, custom_name, position_slot, nil_value, included_in_roster, player_snapshot, production_notes")
    .eq("build_id", buildId)
    .eq("included_in_roster", true);
  const rowsRaw = (bps || []).filter((r: any) => r.player_id || r.custom_name);
  const playerIds = rowsRaw.map((r: any) => r.player_id).filter(Boolean);

  const pById = new Map<string, any>();
  for (let i = 0; i < playerIds.length; i += 200) {
    const { data: pl } = await (supabase as any)
      .from("players")
      .select("id, first_name, last_name, position, class_year")
      .in("id", playerIds.slice(i, i + 200));
    for (const p of pl || []) pById.set(p.id, p);
  }

  const buildPlayerIds = rowsRaw.map((r: any) => r.id);
  const finByBp = new Map<string, any>();
  for (let i = 0; i < buildPlayerIds.length; i += 200) {
    const { data: fin } = await (supabase as any)
      .from("gm_player_finance").select("*").in("build_player_id", buildPlayerIds.slice(i, i + 200));
    for (const f of fin || []) finByBp.set(f.build_player_id, f);
  }

  const { data: buildRow } = await (supabase as any)
    .from("team_builds").select("total_budget").eq("id", buildId).maybeSingle();
  const coachTotalBudget = buildRow?.total_budget != null ? Number(buildRow.total_budget) : null;

  // Funding-vendor allocations for THIS build, summed per player_id per bucket.
  // Player NIL/Other = Unassigned (gm_player_finance) + these vendor sums.
  const { data: srcRows2 } = await (supabase as any)
    .from("gm_allocation_source").select("id, bucket").eq("team_build_id", buildId);
  const bucketBySource = new Map<string, "nil" | "other">((srcRows2 || []).map((s: any) => [s.id, s.bucket]));
  const vendorByPlayer = new Map<string, { nil: number; other: number }>();
  const srcIds = (srcRows2 || []).map((s: any) => s.id);
  if (srcIds.length) {
    const allocs: any[] = [];
    for (let i = 0; i < srcIds.length; i += 200) {
      const { data: al } = await (supabase as any).from("gm_allocation").select("source_id, player_id, amount").in("source_id", srcIds.slice(i, i + 200));
      allocs.push(...(al || []));
    }
    for (const a of allocs) {
      if (a.player_id == null || a.amount == null) continue;
      const bucket = bucketBySource.get(a.source_id);
      if (!bucket) continue;
      const pid = String(a.player_id);
      const cur = vendorByPlayer.get(pid) ?? { nil: 0, other: 0 };
      cur[bucket] += Number(a.amount);
      vendorByPlayer.set(pid, cur);
    }
  }

  const rows = deriveGmRows(rowsRaw, pById, finByBp, readPitchingWeights(), vendorByPlayer);
  return { rows, coachTotalBudget };
}
