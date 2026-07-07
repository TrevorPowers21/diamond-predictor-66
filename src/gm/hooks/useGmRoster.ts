import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PROJECTION_SEASON } from "@/lib/seasonConstants";
import { toast } from "sonner";
import { readPitchingWeights } from "@/lib/pitchingEquations";
import { parseBuildPlayerMeta, projectedEligibilityClass, serializeBuildPlayerMeta } from "@/pages/team-builder/helpers";
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

/** A player removed from a build (departure), with its (maybe-null) reason. */
export interface GmDeparture {
  build_player_id: string;
  player_id: string | null;
  name: string;
  position: string | null;
  departure_reason: string | null;
}

export const DEPARTURE_REASONS = ["draft", "graduation", "transfer", "other"] as const;

/** Projection tiers for an added freshman — matches Team Builder. */
export type LocalProjectionTier = "" | "developmental" | "role_player" | "contributor" | "immediate_impact";

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
        .select("id, name, is_default, academic_year, updated_at, archived")
        .eq("customer_team_id", effectiveTeamId)
        .order("is_default", { ascending: false })
        .order("updated_at", { ascending: false });
      return (data || [])
        .filter((b: any) => !b.archived && (b.academic_year === season || b.academic_year == null))
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

      // Finance is now keyed per-build (build_player_id), not season-level, so
      // scenario builds each hold their own line. Fetch this build's rows.
      const buildPlayerIds = rowsRaw.map((r: any) => r.id);
      const finByBp = new Map<string, any>();
      for (let i = 0; i < buildPlayerIds.length; i += 200) {
        const { data: fin } = await (supabase as any)
          .from("gm_player_finance").select("*").in("build_player_id", buildPlayerIds.slice(i, i + 200));
        for (const f of fin || []) finByBp.set(f.build_player_id, f);
      }
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
        const f = finByBp.get(r.id) || {};
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

  // Departures: rows removed from THIS build (included_in_roster=false), joined to
  // gm_player_finance for the reason. Reason may be null (pending → batch modal).
  const departuresKey = ["gm-departures", effectiveTeamId ?? null, activeBuildId, season];
  const { data: departures = [] } = useQuery({
    queryKey: departuresKey,
    enabled: !!user?.id && !!effectiveTeamId && !!activeBuildId,
    queryFn: async (): Promise<GmDeparture[]> => {
      const { data: bps } = await (supabase as any)
        .from("team_build_players").select("id, player_id, custom_name, position_slot")
        .eq("build_id", activeBuildId).eq("included_in_roster", false);
      const rowsRaw = bps || [];
      if (!rowsRaw.length) return [];
      const bpIds = rowsRaw.map((r: any) => r.id);
      const finByBp = new Map<string, any>();
      for (let i = 0; i < bpIds.length; i += 200) {
        const { data: fin } = await (supabase as any).from("gm_player_finance").select("build_player_id, departure_reason").in("build_player_id", bpIds.slice(i, i + 200));
        for (const f of fin || []) finByBp.set(f.build_player_id, f);
      }
      const pIds = rowsRaw.map((r: any) => r.player_id).filter(Boolean);
      const pById = new Map<string, any>();
      for (let i = 0; i < pIds.length; i += 200) {
        const { data: pl } = await (supabase as any).from("players").select("id, first_name, last_name, position").in("id", pIds.slice(i, i + 200));
        for (const p of pl || []) pById.set(p.id, p);
      }
      return rowsRaw.map((r: any) => {
        const p = r.player_id ? pById.get(r.player_id) : null;
        return {
          build_player_id: r.id,
          player_id: r.player_id ?? null,
          name: p ? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() : (r.custom_name || "—"),
          position: p?.position ?? r.position_slot ?? null,
          departure_reason: (finByBp.get(r.id)?.departure_reason as string | null) ?? null,
        };
      });
    },
  });
  const pendingReasonCount = departures.filter((d) => !d.departure_reason).length;

  const hitters = useMemo(() => rows.filter((r) => !r.is_pitcher).sort((a, b) => (b.war ?? -Infinity) - (a.war ?? -Infinity)), [rows]);
  const pitchers = useMemo(() => rows.filter((r) => r.is_pitcher).sort((a, b) => (b.war ?? -Infinity) - (a.war ?? -Infinity)), [rows]);

  const totals = useMemo(() => {
    const sum = (f: (r: GmRow) => number | null) => rows.reduce((s, r) => s + (f(r) ?? 0), 0);
    return { revUsed: sum((r) => r.rev_share), nilUsed: sum((r) => r.nil_amount), otherUsed: sum((r) => r.other_amount), schUsed: sum((r) => r.scholarship_amount), actualUsed: sum((r) => r.actual_pay) };
  }, [rows]);

  // The per-player checkmark is the ONLY write for a row: it persists the row's
  // (locally-edited) money buckets to gm_player_finance, computes Actual Pay =
  // Rev Share + NIL + Other (Scholarship excluded), and — when finalizing —
  // communicates that Actual Pay to the coach's build (team_build_players.nil_value).
  const finalizePlayer = useMutation({
    mutationFn: async ({ row, money, finalize }: { row: GmRow; money: RowMoney; finalize: boolean }) => {
      if (!effectiveTeamId) throw new Error("No team in scope");
      const nextFinalized = finalize;
      const rev = money.rev_share, nilA = money.nil_amount, other = money.other_amount;
      const actualPay = rev == null && nilA == null && other == null ? null : Number(rev ?? 0) + Number(nilA ?? 0) + Number(other ?? 0);
      // Keyed per-build (build_player_id) — works for local/added players too.
      const { error } = await (supabase as any).from("gm_player_finance").upsert(
        {
          build_player_id: row.build_player_id, customer_team_id: effectiveTeamId, player_id: row.player_id, season,
          scholarship_amount: money.scholarship_amount, rev_share: rev, nil_amount: nilA, other_amount: other, actual_pay: actualPay,
          finalized: nextFinalized, finalized_at: nextFinalized ? new Date().toISOString() : null,
          updated_by_user_id: user?.id ?? null, updated_at: new Date().toISOString(),
        },
        { onConflict: "build_player_id" },
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
      // Scholarship is aid, NOT part of the comp budget — exclude from the total.
      const total = (caps.rev_share_total ?? 0) + (caps.nil_total ?? 0) + (caps.other_total ?? 0);
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

  // ── Build management (copy-on-write) ──────────────────────────────────────
  const activeBuildIsDefault = !!builds.find((bd) => bd.id === activeBuildId)?.is_default;

  // Clone a build's roster rows + finance lines into a new named build. Returns
  // the new build id. team_build_players + gm_player_finance carry together so
  // scenario copies start identical.
  const cloneBuildInto = async (name: string, sourceBuildId: string): Promise<string> => {
    if (!effectiveTeamId) throw new Error("No team in scope");
    const { data: src } = await (supabase as any).from("team_builds").select("team, academic_year, total_budget, depth_assignments, depth_placeholders").eq("id", sourceBuildId).maybeSingle();
    const { data: nb, error } = await (supabase as any).from("team_builds").insert({
      customer_team_id: effectiveTeamId, name: name.trim() || "Untitled Build", is_default: false,
      team: src?.team ?? null, academic_year: src?.academic_year ?? season, total_budget: src?.total_budget ?? null,
      depth_assignments: src?.depth_assignments ?? null, depth_placeholders: src?.depth_placeholders ?? null,
    }).select("id").single();
    if (error) throw error;
    const newBuildId = nb.id as string;

    const { data: srcRows } = await (supabase as any).from("team_build_players").select("*").eq("build_id", sourceBuildId);
    const rows = srcRows || [];
    if (rows.length) {
      const clones = rows.map((r: any) => { const c = { ...r }; delete c.id; delete c.created_at; delete c.updated_at; c.build_id = newBuildId; return c; });
      const { error: e2 } = await (supabase as any).from("team_build_players").insert(clones);
      if (e2) throw e2;
    }
    // Map old→new build_player_id by natural key, then clone finance lines.
    const keyOf = (r: any) => `${r.player_id ?? "L:" + (r.custom_name ?? "")}|${r.position_slot ?? ""}`;
    const { data: newRows } = await (supabase as any).from("team_build_players").select("id, player_id, custom_name, position_slot").eq("build_id", newBuildId);
    const newByKey = new Map<string, string>((newRows || []).map((nr: any) => [keyOf(nr), nr.id]));
    const oldToNew = new Map<string, string>();
    for (const sr of rows) { const nid = newByKey.get(keyOf(sr)); if (nid) oldToNew.set(sr.id, nid); }
    const srcBpIds = rows.map((r: any) => r.id);
    const srcFin: any[] = [];
    for (let i = 0; i < srcBpIds.length; i += 200) {
      const { data: fin } = await (supabase as any).from("gm_player_finance").select("*").in("build_player_id", srcBpIds.slice(i, i + 200));
      srcFin.push(...(fin || []));
    }
    const finClones = srcFin
      .map((f: any) => { const c = { ...f }; delete c.id; delete c.created_at; delete c.updated_at; c.build_player_id = oldToNew.get(f.build_player_id); return c; })
      .filter((c: any) => c.build_player_id);
    if (finClones.length) { const { error: e3 } = await (supabase as any).from("gm_player_finance").insert(finClones); if (e3) throw e3; }
    return newBuildId;
  };

  const createBuild = useMutation({
    mutationFn: async ({ name, sourceBuildId }: { name: string; sourceBuildId: string }) => cloneBuildInto(name, sourceBuildId),
    onSuccess: (newBuildId) => { qc.invalidateQueries({ queryKey: ["gm-builds"] }); setPickedBuildId(newBuildId); toast.success("Build created"); },
    onError: (e: any) => toast.error(`Create build failed: ${e.message}`),
  });

  const renameBuild = useMutation({
    mutationFn: async ({ buildId, name }: { buildId: string; name: string }) => {
      const { error } = await (supabase as any).from("team_builds").update({ name: name.trim() }).eq("id", buildId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["gm-builds"] }); toast.success("Build renamed"); },
    onError: (e: any) => toast.error(`Rename failed: ${e.message}`),
  });

  // Remove a player: copy-on-write off the default first (into a named build),
  // then mark the row leaving on the working build — included_in_roster=false,
  // production_notes.rosterStatus=leaving (mirror for TB), and gm_player_finance
  // roster_status=leaving (reason filled later).
  const removePlayer = useMutation({
    mutationFn: async ({ row, buildName }: { row: GmRow; buildName: string }) => {
      if (!effectiveTeamId || !activeBuildId) throw new Error("No team/build in scope");
      let targetBuildId = activeBuildId;
      let targetBpId = row.build_player_id;
      let switched: string | null = null;
      if (activeBuildIsDefault) {
        targetBuildId = await cloneBuildInto(buildName, activeBuildId);
        switched = targetBuildId;
        const { data: newRows } = await (supabase as any).from("team_build_players").select("id, player_id, custom_name").eq("build_id", targetBuildId);
        const match = (newRows || []).find((nr: any) => (row.player_id ? nr.player_id === row.player_id : !nr.player_id && nr.custom_name === row.name));
        if (!match) throw new Error("Could not locate the cloned roster row");
        targetBpId = match.id;
      }
      // fetch current notes to preserve fields
      const { data: tbp } = await (supabase as any).from("team_build_players").select("production_notes").eq("id", targetBpId).maybeSingle();
      let obj: any = {}; try { obj = JSON.parse(tbp?.production_notes || "{}"); } catch { /* keep {} */ }
      obj.__team_builder_metrics_v1 = true; obj.rosterStatus = "leaving";
      const { error: e1 } = await (supabase as any).from("team_build_players")
        .update({ included_in_roster: false, production_notes: JSON.stringify(obj) }).eq("id", targetBpId);
      if (e1) throw e1;
      const { error: e2 } = await (supabase as any).from("gm_player_finance").upsert(
        { build_player_id: targetBpId, customer_team_id: effectiveTeamId, player_id: row.player_id, season, roster_status: "leaving", updated_by_user_id: user?.id ?? null, updated_at: new Date().toISOString() },
        { onConflict: "build_player_id" },
      );
      if (e2) throw e2;
      return { switched, name: row.name };
    },
    onSuccess: ({ switched, name }) => {
      qc.invalidateQueries({ queryKey: ["gm-builds"] });
      qc.invalidateQueries({ queryKey: key });
      if (switched) setPickedBuildId(switched);
      toast.success(`Removed ${name} from roster`);
    },
    onError: (e: any) => toast.error(`Remove failed: ${e.message}`),
  });

  // Set a departure reason (GM-only). Upserts on the build row's finance line.
  const setDepartureReason = useMutation({
    mutationFn: async ({ buildPlayerId, playerId, reason }: { buildPlayerId: string; playerId: string | null; reason: string }) => {
      if (!effectiveTeamId) throw new Error("No team in scope");
      const { error } = await (supabase as any).from("gm_player_finance").upsert(
        { build_player_id: buildPlayerId, customer_team_id: effectiveTeamId, player_id: playerId, season, roster_status: "leaving", departure_reason: reason, updated_by_user_id: user?.id ?? null, updated_at: new Date().toISOString() },
        { onConflict: "build_player_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: departuresKey }),
    onError: (e: any) => toast.error(`Save reason failed: ${e.message}`),
  });

  // Restore a departed player back onto the build.
  const restorePlayer = useMutation({
    mutationFn: async (buildPlayerId: string) => {
      const { data: tbp } = await (supabase as any).from("team_build_players").select("production_notes").eq("id", buildPlayerId).maybeSingle();
      let obj: any = {}; try { obj = JSON.parse(tbp?.production_notes || "{}"); } catch { /* keep {} */ }
      obj.__team_builder_metrics_v1 = true; obj.rosterStatus = "returner";
      const { error: e1 } = await (supabase as any).from("team_build_players").update({ included_in_roster: true, production_notes: JSON.stringify(obj) }).eq("id", buildPlayerId);
      if (e1) throw e1;
      const { error: e2 } = await (supabase as any).from("gm_player_finance").update({ roster_status: null, departure_reason: null }).eq("build_player_id", buildPlayerId);
      if (e2) throw e2;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: departuresKey }); qc.invalidateQueries({ queryKey: key }); toast.success("Player restored to roster"); },
    onError: (e: any) => toast.error(`Restore failed: ${e.message}`),
  });

  // Finalize the roster: the chosen build becomes next year's default ("everyone
  // returns" baseline for season+1); every other current-cycle build (incl. the
  // old default) is ARCHIVED (recoverable), not deleted.
  const finalizeRoster = useMutation({
    mutationFn: async (buildId: string) => {
      if (!effectiveTeamId) throw new Error("No team in scope");
      const { error: e1 } = await (supabase as any).from("team_builds")
        .update({ archived: true, is_default: false })
        .eq("customer_team_id", effectiveTeamId).neq("id", buildId)
        .or(`academic_year.eq.${season},academic_year.is.null`);
      if (e1) throw e1;
      const { error: e2 } = await (supabase as any).from("team_builds")
        .update({ is_default: true, academic_year: season + 1, archived: false }).eq("id", buildId);
      if (e2) throw e2;
      return season + 1;
    },
    onSuccess: (nextYear) => {
      qc.invalidateQueries({ queryKey: ["gm-builds"] });
      qc.invalidateQueries({ queryKey: key });
      setPickedBuildId(null);
      toast.success(`Roster finalized — locked as the ${nextYear} default`);
    },
    onError: (e: any) => toast.error(`Finalize roster failed: ${e.message}`),
  });

  // Add a LOCAL player (freshman / JUCO not in the DB): a team_build_players row
  // with no player_id, so it has no projection (coach sees null WAR/Market) but
  // shows position + financials on both builds. Copy-on-write off the default.
  // Transfers WITH data are added via Team Builder, not here.
  const addLocalPlayer = useMutation({
    mutationFn: async ({ name, position, projectionTier, nilValue, buildName }: { name: string; position: string; projectionTier: LocalProjectionTier; nilValue: number; buildName: string }) => {
      if (!effectiveTeamId || !activeBuildId) throw new Error("No team/build in scope");
      let targetBuildId = activeBuildId;
      let switched: string | null = null;
      if (activeBuildIsDefault) {
        targetBuildId = await cloneBuildInto(buildName, activeBuildId);
        switched = targetBuildId;
      }
      const trimmed = name.trim();
      const isPitcherPos = /^(SP|RP|CL|P|LHP|RHP)$/i.test(position);
      // Mirror Team Builder's addIncomingFreshman EXACTLY so the player reads
      // identically on both sides (source, class_transition FS, depth role,
      // projection tier, localPlayer shape via the shared serializer).
      const notes = serializeBuildPlayerMeta(
        null, null, null, "returner",
        isPitcherPos ? "specialist_reliever" : "bench",
        "FS", 0, false, false, null,
        { first_name: trimmed, last_name: "", position: position || null, team: teamName, from_team: null, conference: null },
        projectionTier || null, (nilValue || 0) > 0,
      );
      const { error } = await (supabase as any).from("team_build_players").insert({
        build_id: targetBuildId, player_id: null, source: "returner", custom_name: trimmed,
        position_slot: position || null, depth_order: 1, included_in_roster: true, production_notes: notes, nil_value: Number(nilValue) || 0,
      });
      if (error) throw error;
      return { switched, name: trimmed };
    },
    onSuccess: ({ switched, name }) => {
      qc.invalidateQueries({ queryKey: ["gm-builds"] });
      qc.invalidateQueries({ queryKey: key });
      if (switched) setPickedBuildId(switched);
      toast.success(`Added ${name} to roster`);
    },
    onError: (e: any) => toast.error(`Add player failed: ${e.message}`),
  });

  return {
    teamName,
    season,
    hasTeam: !!effectiveTeamId,
    isLoading,
    builds,
    selectedBuildId: activeBuildId,
    activeBuildIsDefault,
    setSelectedBuildId: setPickedBuildId,
    hitters,
    pitchers,
    budget,
    coachTotalBudget,
    totals,
    finalizePlayer: (row: GmRow, money: RowMoney, finalize: boolean, onDone?: () => void) =>
      finalizePlayer.mutate({ row, money, finalize }, onDone ? { onSuccess: () => onDone() } : undefined),
    createBuild: (name: string, sourceBuildId: string) => createBuild.mutate({ name, sourceBuildId }),
    renameBuild: (buildId: string, name: string) => renameBuild.mutate({ buildId, name }),
    removePlayer: (row: GmRow, buildName: string) => removePlayer.mutate({ row, buildName }),
    departures,
    pendingReasonCount,
    setDepartureReason: (buildPlayerId: string, playerId: string | null, reason: string) => setDepartureReason.mutate({ buildPlayerId, playerId, reason }),
    restorePlayer: (buildPlayerId: string) => restorePlayer.mutate(buildPlayerId),
    finalizeRoster: (buildId: string) => finalizeRoster.mutate(buildId),
    addLocalPlayer: (name: string, position: string, projectionTier: LocalProjectionTier, nilValue: number, buildName: string) => addLocalPlayer.mutate({ name, position, projectionTier, nilValue, buildName }),
    saveBudget: (patch: Partial<GmBudget>) => saveBudget.mutate(patch),
    finalizeBudget: (finalized: boolean) => saveBudget.mutate({ finalized }),
    commitBudget: (caps: { rev_share_total: number | null; nil_total: number | null; scholarship_total: number | null; other_total: number | null; other_breakdown?: GmOtherLine[] | null }) => commitBudget.mutate(caps),
    isFinalizing: commitBudget.isPending,
  };
}
