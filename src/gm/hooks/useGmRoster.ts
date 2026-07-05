import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PROJECTION_SEASON } from "@/lib/seasonConstants";
import { toast } from "sonner";

const isPitcherPos = (s: string | null | undefined) => /^(SP|RP|CL|P|LHP|RHP)/i.test(String(s || ""));

export interface GmRow {
  player_id: string;
  build_player_id: string;
  name: string;
  position: string | null;
  class_year: string | null;
  is_pitcher: boolean;
  war: number | null;
  market_value: number | null;
  nil_value: number | null; // coach's Team Builder actual pay
  // gm_player_finance
  rev_share: number | null;
  nil_amount: number | null;
  other_amount: number | null;
  actual_pay: number | null;
  finalized: boolean;
  draft_year: number | null;
  eligibility_years_remaining: number | null;
  eligibility_note: string | null;
}

export interface GmBudget {
  rev_share_total: number | null;
  nil_total: number | null;
  other_total: number | null;
  finalized: boolean;
}

/**
 * Front Office roster (Path A): reads the team's default build (same rows the
 * coach uses → two-way sync) joined to gm_player_finance / gm_budget. Money +
 * eligibility edits write to the GM tables; Finalize syncs Actual Pay to the
 * coach's team_build_players.nil_value.
 */
export function useGmRoster() {
  const { user, effectiveTeamId, availableTeams } = useAuth();
  const qc = useQueryClient();
  const season = PROJECTION_SEASON;

  const teamName = useMemo(
    () => availableTeams?.find((t) => t.id === effectiveTeamId)?.name ?? null,
    [availableTeams, effectiveTeamId],
  );

  const key = ["gm-roster", effectiveTeamId ?? null, season];
  const { data, isLoading } = useQuery({
    queryKey: key,
    enabled: !!user?.id && !!effectiveTeamId,
    queryFn: async () => {
      // 1. latest default build for this team
      const { data: builds } = await (supabase as any)
        .from("team_builds")
        .select("id, academic_year")
        .eq("customer_team_id", effectiveTeamId)
        .eq("is_default", true)
        .order("updated_at", { ascending: false })
        .limit(1);
      const build = builds?.[0];
      if (!build) return { rows: [] as GmRow[], budget: null as GmBudget | null };

      // 2. on-roster players in that build
      const { data: bps } = await (supabase as any)
        .from("team_build_players")
        .select("id, player_id, custom_name, position_slot, nil_value, included_in_roster, player_snapshot")
        .eq("build_id", build.id)
        .eq("included_in_roster", true);
      const rowsRaw = (bps || []).filter((r: any) => r.player_id);
      const playerIds = rowsRaw.map((r: any) => r.player_id);

      // 3. player name/class/position
      const pById = new Map<string, any>();
      for (let i = 0; i < playerIds.length; i += 200) {
        const { data: pl } = await (supabase as any)
          .from("players")
          .select("id, first_name, last_name, position, class_year")
          .in("id", playerIds.slice(i, i + 200));
        for (const p of pl || []) pById.set(p.id, p);
      }

      // 4. gm finance + budget for this team + season
      const { data: fin } = await (supabase as any)
        .from("gm_player_finance")
        .select("*")
        .eq("customer_team_id", effectiveTeamId)
        .eq("season", season);
      const finByPlayer = new Map<string, any>((fin || []).map((f: any) => [f.player_id, f]));
      const { data: bud } = await (supabase as any)
        .from("gm_budget")
        .select("*")
        .eq("customer_team_id", effectiveTeamId)
        .eq("season", season)
        .maybeSingle();

      const rows: GmRow[] = rowsRaw.map((r: any) => {
        const p = pById.get(r.player_id);
        const snap = r.player_snapshot || {};
        const pitcher = isPitcherPos(r.position_slot) || isPitcherPos(p?.position);
        const f = finByPlayer.get(r.player_id) || {};
        const mv = snap.market_value ?? snap.twp_hitter_market_value ?? snap.twp_pitcher_market_value ?? null;
        return {
          player_id: r.player_id,
          build_player_id: r.id,
          name: p ? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() : (r.custom_name || "—"),
          position: p?.position ?? r.position_slot ?? null,
          class_year: p?.class_year ?? null,
          is_pitcher: pitcher,
          war: pitcher ? (snap.p_war ?? null) : (snap.o_war ?? null),
          market_value: mv,
          nil_value: r.nil_value ?? null,
          rev_share: f.rev_share ?? null,
          nil_amount: f.nil_amount ?? null,
          other_amount: f.other_amount ?? null,
          actual_pay: f.actual_pay ?? r.nil_value ?? null,
          finalized: !!f.finalized,
          draft_year: f.draft_year ?? null,
          eligibility_years_remaining: f.eligibility_years_remaining ?? null,
          eligibility_note: f.eligibility_note ?? null,
        };
      });
      const budget: GmBudget | null = bud
        ? { rev_share_total: bud.rev_share_total, nil_total: bud.nil_total, other_total: bud.other_total, finalized: !!bud.finalized }
        : null;
      return { rows, budget };
    },
  });

  const rows = data?.rows ?? [];
  const budget = data?.budget ?? null;

  const hitters = useMemo(() => rows.filter((r) => !r.is_pitcher).sort((a, b) => (b.war ?? -Infinity) - (a.war ?? -Infinity)), [rows]);
  const pitchers = useMemo(() => rows.filter((r) => r.is_pitcher).sort((a, b) => (b.war ?? -Infinity) - (a.war ?? -Infinity)), [rows]);

  const totals = useMemo(() => {
    const sum = (f: (r: GmRow) => number | null) => rows.reduce((s, r) => s + (f(r) ?? 0), 0);
    return {
      revUsed: sum((r) => r.rev_share),
      nilUsed: sum((r) => r.nil_amount),
      otherUsed: sum((r) => r.other_amount),
      actualUsed: sum((r) => r.actual_pay),
    };
  }, [rows]);

  const savePlayer = useMutation({
    mutationFn: async ({ playerId, patch }: { playerId: string; patch: Partial<GmRow> }) => {
      if (!effectiveTeamId) throw new Error("No team in scope");
      const upsert: any = { customer_team_id: effectiveTeamId, player_id: playerId, season, updated_by_user_id: user?.id ?? null, updated_at: new Date().toISOString() };
      for (const k of ["rev_share", "nil_amount", "other_amount", "actual_pay", "draft_year", "eligibility_years_remaining", "eligibility_note"] as const) {
        if (k in patch) upsert[k] = (patch as any)[k];
      }
      const { error } = await (supabase as any).from("gm_player_finance").upsert(upsert, { onConflict: "customer_team_id,player_id,season" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: any) => toast.error(`Save failed: ${e.message}`),
  });

  const finalizePlayer = useMutation({
    mutationFn: async (row: GmRow) => {
      if (!effectiveTeamId) throw new Error("No team in scope");
      const nextFinalized = !row.finalized;
      const { error } = await (supabase as any).from("gm_player_finance").upsert(
        { customer_team_id: effectiveTeamId, player_id: row.player_id, season, actual_pay: row.actual_pay, finalized: nextFinalized, finalized_at: nextFinalized ? new Date().toISOString() : null, updated_by_user_id: user?.id ?? null, updated_at: new Date().toISOString() },
        { onConflict: "customer_team_id,player_id,season" },
      );
      if (error) throw error;
      // On finalize, sync Actual Pay to the coach's Team Builder (nil_value).
      if (nextFinalized) {
        const { error: e2 } = await (supabase as any).from("team_build_players").update({ nil_value: row.actual_pay }).eq("id", row.build_player_id);
        if (e2) throw e2;
      }
      return nextFinalized;
    },
    onSuccess: (nextFinalized, row) => {
      qc.invalidateQueries({ queryKey: key });
      if (nextFinalized) toast.success(`Finalized pay for ${row.name} — synced to Team Builder`);
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
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: any) => toast.error(`Budget save failed: ${e.message}`),
  });

  return {
    teamName,
    season,
    hasTeam: !!effectiveTeamId,
    isLoading,
    hitters,
    pitchers,
    budget,
    totals,
    savePlayer: (playerId: string, patch: Partial<GmRow>) => savePlayer.mutate({ playerId, patch }),
    finalizePlayer: (row: GmRow) => finalizePlayer.mutate(row),
    saveBudget: (patch: Partial<GmBudget>) => saveBudget.mutate(patch),
    finalizeBudget: (finalized: boolean) => saveBudget.mutate({ finalized, ...(finalized ? {} : {}) }),
  };
}
