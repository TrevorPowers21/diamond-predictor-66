import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PROJECTION_SEASON } from "@/lib/seasonConstants";
import { toast } from "sonner";
import { readPitchingWeights } from "@/lib/pitchingEquations";
import { parseBuildPlayerMeta, projectedEligibilityClass } from "@/pages/team-builder/helpers";
import { effectivePitcherWar, effectiveHitterWar, effectiveMarket, pitcherSessionRole } from "@/lib/effectiveProjection";

const isPitcherPos = (s: string | null | undefined) => /^(SP|RP|CL|P|LHP|RHP)/i.test(String(s || ""));

export interface GmBuildOption {
  id: string;
  name: string;
  is_default: boolean;
}

export interface GmRow {
  player_id: string | null; // null for coach-added local players (no DB player row)
  build_player_id: string;
  name: string;
  position: string | null;
  class_year: string | null;
  is_pitcher: boolean;
  war: number | null;
  market_value: number | null;
  nil_value: number | null; // coach's Team Builder actual pay
  // gm_player_finance
  scholarship_amount: number | null;
  rev_share: number | null;
  nil_amount: number | null;
  other_amount: number | null;
  actual_pay: number | null;
  finalized: boolean;
  eligibility_class: string | null; // GM/head-coach display (override ?? class_year)
}

export interface GmOtherLine {
  name: string;
  amount: number;
}

/** The editable money buckets for one roster row. */
export interface RowMoney {
  scholarship_amount: number | null;
  rev_share: number | null;
  nil_amount: number | null;
  other_amount: number | null;
}

export interface GmBudget {
  rev_share_total: number | null;
  nil_total: number | null;
  other_total: number | null;
  scholarship_total: number | null;
  other_breakdown: GmOtherLine[] | null;
  finalized: boolean;
}

/**
 * Front Office roster (Path A): reads a Player-Evaluation build (default or any
 * saved coach build for the team) — the same team_build_players rows the coach
 * uses, so it's two-way — joined to gm_player_finance / gm_budget. Money +
 * eligibility edits write to the GM tables; Finalize syncs Actual Pay to the
 * coach's team_build_players.nil_value.
 */
export function useGmRoster() {
  const { user, effectiveTeamId, availableTeams } = useAuth();
  const qc = useQueryClient();
  const season = PROJECTION_SEASON;
  // Selected build lives in the URL (?build=…) so navigating to a player profile
  // and back restores the same build the user was viewing, not the default.
  const [searchParams, setSearchParams] = useSearchParams();
  const pickedBuildId = searchParams.get("build");
  const setPickedBuildId = (id: string | null) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set("build", id);
        else next.delete("build");
        return next;
      },
      { replace: true },
    );

  const teamName = useMemo(
    () => availableTeams?.find((t) => t.id === effectiveTeamId)?.name ?? null,
    [availableTeams, effectiveTeamId],
  );

  // Saved builds for this team (Player Evaluation side): default + coach builds.
  const { data: builds = [] } = useQuery({
    queryKey: ["gm-builds", effectiveTeamId ?? null, season],
    enabled: !!user?.id && !!effectiveTeamId,
    queryFn: async (): Promise<GmBuildOption[]> => {
      const { data } = await (supabase as any)
        .from("team_builds")
        .select("id, name, is_default, academic_year, updated_at")
        .eq("customer_team_id", effectiveTeamId)
        .order("is_default", { ascending: false })
        .order("updated_at", { ascending: false });
      return (data || [])
        .filter((b: any) => b.academic_year === season || b.academic_year == null)
        .map((b: any) => ({ id: b.id, name: b.is_default ? "Default Roster" : b.name, is_default: !!b.is_default }));
    },
  });

  const defaultBuildId = useMemo(() => builds.find((b) => b.is_default)?.id ?? builds[0]?.id ?? null, [builds]);
  // Guard: the picked build must belong to the CURRENT team's builds. Otherwise a
  // build selected for one team would leak its roster when impersonating another
  // (pickedBuildId is component state and doesn't reset on team switch).
  const activeBuildId = useMemo(
    () => (pickedBuildId && builds.some((b) => b.id === pickedBuildId) ? pickedBuildId : defaultBuildId),
    [pickedBuildId, builds, defaultBuildId],
  );

  const key = ["gm-roster", effectiveTeamId ?? null, activeBuildId, season];
  const { data, isLoading } = useQuery({
    queryKey: key,
    enabled: !!user?.id && !!effectiveTeamId && !!activeBuildId,
    queryFn: async () => {
      const { data: bps } = await (supabase as any)
        .from("team_build_players")
        .select("id, player_id, custom_name, position_slot, nil_value, included_in_roster, player_snapshot, production_notes")
        .eq("build_id", activeBuildId)
        .eq("included_in_roster", true);
      // Include coach-added local players (no player_id — they live in
      // production_notes.localPlayer + custom_name) so freshmen/recruits appear.
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

      const { data: fin } = await (supabase as any)
        .from("gm_player_finance").select("*").eq("customer_team_id", effectiveTeamId).eq("season", season);
      const finByPlayer = new Map<string, any>((fin || []).map((f: any) => [f.player_id, f]));
      const { data: bud } = await (supabase as any)
        .from("gm_budget").select("*").eq("customer_team_id", effectiveTeamId).eq("season", season).maybeSingle();
      // The coach's total_budget flows one-way INTO the GM (like a player's
      // nil_value → Actual Pay): it fills the Total until the GM Finalizes.
      const { data: buildRow } = await (supabase as any)
        .from("team_builds").select("total_budget").eq("id", activeBuildId).maybeSingle();
      const coachTotalBudget = buildRow?.total_budget != null ? Number(buildRow.total_budget) : null;

      // Pitching equation weights for the effective-WAR recompute (sync read).
      const eq = readPitchingWeights();

      const rows: GmRow[] = rowsRaw.map((r: any) => {
        const meta = parseBuildPlayerMeta(r.production_notes) as any;
        const isLocal = !r.player_id;
        const local = meta?.localPlayer ?? null;
        const p = r.player_id ? pById.get(r.player_id) : null;
        const snap = r.player_snapshot || {};
        const pitcher = isPitcherPos(r.position_slot) || isPitcherPos(p?.position) || isPitcherPos(local?.position);
        const f = (r.player_id ? finByPlayer.get(r.player_id) : null) || {};
        const mv = snap.market_value ?? snap.twp_hitter_market_value ?? snap.twp_pitcher_market_value ?? null;
        const storedWar = pitcher ? (snap.p_war ?? null) : (snap.o_war ?? null);

        // Apply the coach's saved toggles (production_notes) on read so the GM
        // view matches Team Builder: depth role → innings/PA, dev_agg → rate.
        // Falls back to the stored baseline when there's no rate to recompute.
        const devAgg = Number.isFinite(Number(meta?.devAggressiveness)) ? Number(meta.devAggressiveness) : 0;
        const classTransition = meta?.classTransition ?? "SJ";
        const sessionDepthRole = pitcher
          ? (meta?.depthRole ?? (snap.pitcher_role === "SP" ? "weekend_starter" : snap.pitcher_role === "SM" ? "weekday_starter" : undefined))
          : (meta?.depthRole ?? snap.hitter_depth_role);
        const effWar = pitcher
          ? effectivePitcherWar(snap, sessionDepthRole, devAgg, classTransition, eq)
          : effectiveHitterWar(snap.o_war, snap.hitter_depth_role, sessionDepthRole, devAgg, classTransition);
        const effMarket = effectiveMarket(mv, storedWar, effWar);

        // Position label follows the coach's assigned role for pitchers (the SAME
        // SP/RP bucket that produced the WAR/market above) so an RP moved to a
        // starter reads as "SP" next to his SP-specific numbers — never a stored
        // "RP" beside a starter's WAR. Hitters keep their true fielding position.
        const displayPosition = isLocal
          ? (r.position_slot ?? local?.position ?? null) // recruits: show their raw slot, not a role bucket
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
          // Actual Pay = Rev Share + NIL + Other (Scholarship is aid, NOT pay).
          // Derived live so the buckets visibly add up; null until any is set.
          actual_pay:
            f.rev_share == null && f.nil_amount == null && f.other_amount == null
              ? null
              : Number(f.rev_share ?? 0) + Number(f.nil_amount ?? 0) + Number(f.other_amount ?? 0),
          finalized: !!f.finalized,
          // 2027 roster → show the projection-season eligibility (class advanced
          // one year), unless a GM override exists. Coach-added locals are
          // incoming recruits → FR (their classTransition is a meaningless default).
          eligibility_class:
            f.eligibility_class ?? (isLocal ? "FR" : projectedEligibilityClass(p?.class_year, meta?.classTransition ?? null)),
        };
      });
      const budget: GmBudget | null = bud
        ? { rev_share_total: bud.rev_share_total, nil_total: bud.nil_total, other_total: bud.other_total, scholarship_total: bud.scholarship_total, other_breakdown: (bud.other_breakdown as GmOtherLine[] | null) ?? null, finalized: !!bud.finalized }
        : null;
      return { rows, budget, coachTotalBudget };
    },
  });

  const rows = data?.rows ?? [];
  const budget = data?.budget ?? null;
  const coachTotalBudget = data?.coachTotalBudget ?? null;

  const hitters = useMemo(() => rows.filter((r) => !r.is_pitcher).sort((a, b) => (b.war ?? -Infinity) - (a.war ?? -Infinity)), [rows]);
  const pitchers = useMemo(() => rows.filter((r) => r.is_pitcher).sort((a, b) => (b.war ?? -Infinity) - (a.war ?? -Infinity)), [rows]);

  const totals = useMemo(() => {
    const sum = (f: (r: GmRow) => number | null) => rows.reduce((s, r) => s + (f(r) ?? 0), 0);
    return { revUsed: sum((r) => r.rev_share), nilUsed: sum((r) => r.nil_amount), otherUsed: sum((r) => r.other_amount), schUsed: sum((r) => r.scholarship_amount), actualUsed: sum((r) => r.actual_pay) };
  }, [rows]);

  const savePlayer = useMutation({
    mutationFn: async ({ playerId, patch }: { playerId: string | null; patch: Partial<GmRow> }) => {
      if (!effectiveTeamId) throw new Error("No team in scope");
      // gm_player_finance keys on player_id — coach-added locals have none yet.
      if (!playerId) throw new Error("Money for added recruits saves once they're linked to a player record");
      const upsert: any = { customer_team_id: effectiveTeamId, player_id: playerId, season, updated_by_user_id: user?.id ?? null, updated_at: new Date().toISOString() };
      for (const k of ["scholarship_amount", "rev_share", "nil_amount", "other_amount", "actual_pay", "eligibility_class"] as const) {
        if (k in patch) upsert[k] = (patch as any)[k];
      }
      const { error } = await (supabase as any).from("gm_player_finance").upsert(upsert, { onConflict: "customer_team_id,player_id,season" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: any) => toast.error(`Save failed: ${e.message}`),
  });

  // The per-player checkmark is the ONLY write for a row: it persists the row's
  // (locally-edited) money buckets to gm_player_finance, computes Actual Pay =
  // Rev Share + NIL + Other (Scholarship excluded), and — when finalizing —
  // communicates that Actual Pay to the coach's build (team_build_players.nil_value).
  const finalizePlayer = useMutation({
    mutationFn: async ({ row, money, finalize }: { row: GmRow; money: RowMoney; finalize: boolean }) => {
      if (!effectiveTeamId) throw new Error("No team in scope");
      if (!row.player_id) throw new Error("Finalize once the recruit is linked to a player record");
      const nextFinalized = finalize;
      const rev = money.rev_share, nilA = money.nil_amount, other = money.other_amount;
      const actualPay = rev == null && nilA == null && other == null ? null : Number(rev ?? 0) + Number(nilA ?? 0) + Number(other ?? 0);
      const { error } = await (supabase as any).from("gm_player_finance").upsert(
        {
          customer_team_id: effectiveTeamId, player_id: row.player_id, season,
          scholarship_amount: money.scholarship_amount, rev_share: rev, nil_amount: nilA, other_amount: other, actual_pay: actualPay,
          finalized: nextFinalized, finalized_at: nextFinalized ? new Date().toISOString() : null,
          updated_by_user_id: user?.id ?? null, updated_at: new Date().toISOString(),
        },
        { onConflict: "customer_team_id,player_id,season" },
      );
      if (error) throw error;
      if (nextFinalized) {
        const { error: e2 } = await (supabase as any).from("team_build_players").update({ nil_value: actualPay }).eq("id", row.build_player_id);
        if (e2) throw e2;
      }
      return { nextFinalized, name: row.name };
    },
    onSuccess: ({ nextFinalized, name }) => {
      qc.invalidateQueries({ queryKey: key });
      if (nextFinalized) toast.success(`Finalized pay for ${name} — synced to Team Builder`);
    },
    onError: (e: any) => toast.error(`Finalize failed: ${e.message}`),
  });

  const saveBudget = useMutation({
    mutationFn: async (patch: Partial<GmBudget>) => {
      if (!effectiveTeamId) throw new Error("No team in scope");
      const { error } = await (supabase as any).from("gm_budget").upsert(
        { customer_team_id: effectiveTeamId, season, ...patch, updated_by_user_id: user?.id ?? null, updated_at: new Date().toISOString() },
        { onConflict: "customer_team_id,season" },
      );
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast.success("Budget saved"); },
    onError: (e: any) => toast.error(`Budget save failed: ${e.message}`),
  });

  // Finalize the budget from the GM popup: persist the four allotment caps, mark
  // finalized, then COMMUNICATE the summed total into the coach's Team Builder by
  // writing team_builds.total_budget for the active build (what the coach's
  // build reads as its spending budget — useLoadBuild → setTotalBudget).
  type BudgetCaps = { rev_share_total: number | null; nil_total: number | null; scholarship_total: number | null; other_total: number | null; other_breakdown?: GmOtherLine[] | null };
  const commitBudget = useMutation({
    mutationFn: async (caps: BudgetCaps) => {
      if (!effectiveTeamId) throw new Error("No team in scope");
      const total = (caps.rev_share_total ?? 0) + (caps.nil_total ?? 0) + (caps.scholarship_total ?? 0) + (caps.other_total ?? 0);
      const { error } = await (supabase as any).from("gm_budget").upsert(
        { customer_team_id: effectiveTeamId, season, ...caps, finalized: true, finalized_at: new Date().toISOString(), updated_by_user_id: user?.id ?? null, updated_at: new Date().toISOString() },
        { onConflict: "customer_team_id,season" },
      );
      if (error) throw error;
      if (activeBuildId) {
        const { error: e2 } = await (supabase as any).from("team_builds").update({ total_budget: total }).eq("id", activeBuildId);
        if (e2) throw e2;
      }
      return total;
    },
    onSuccess: (total) => {
      qc.invalidateQueries({ queryKey: key });
      toast.success(`Budget finalized — $${Math.round(total).toLocaleString("en-US")} pushed to Team Builder`);
    },
    onError: (e: any) => toast.error(`Finalize failed: ${e.message}`),
  });

  return {
    teamName,
    season,
    hasTeam: !!effectiveTeamId,
    isLoading,
    builds,
    selectedBuildId: activeBuildId,
    setSelectedBuildId: setPickedBuildId,
    hitters,
    pitchers,
    budget,
    coachTotalBudget,
    totals,
    savePlayer: (playerId: string | null, patch: Partial<GmRow>) => savePlayer.mutate({ playerId, patch }),
    finalizePlayer: (row: GmRow, money: RowMoney, finalize: boolean, onDone?: () => void) =>
      finalizePlayer.mutate({ row, money, finalize }, onDone ? { onSuccess: () => onDone() } : undefined),
    saveBudget: (patch: Partial<GmBudget>) => saveBudget.mutate(patch),
    finalizeBudget: (finalized: boolean) => saveBudget.mutate({ finalized }),
    commitBudget: (caps: { rev_share_total: number | null; nil_total: number | null; scholarship_total: number | null; other_total: number | null; other_breakdown?: GmOtherLine[] | null }) => commitBudget.mutate(caps),
    isFinalizing: commitBudget.isPending,
  };
}
