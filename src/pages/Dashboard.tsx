import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PROJECTION_SEASON } from "@/lib/seasonConstants";
import { useTargetBoard } from "@/hooks/useTargetBoard";
import { useHighFollow } from "@/hooks/useHighFollow";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Eye, LogIn, X, CheckCircle, TrendingUp, Users, Calendar, Activity, ArrowRight } from "lucide-react";
import { profileRouteFor } from "@/lib/profileRoutes";
import SchoolBanner from "@/components/SchoolBanner";
import { CURRENT_SEASON } from "@/lib/seasonConstants";
import { useEffectiveSchool } from "@/hooks/useEffectiveSchool";
import { applyTeamScopeFilter, dedupePreferredPerPlayer } from "@/lib/teamScopedPredictions";

type HitterRow = {
  player_id: string;
  first_name: string;
  last_name: string;
  team: string | null;
  from_team: string | null;
  conference: string | null;
  position: string | null;
  model_type: string;
  in_portal: boolean;
  p_wrc_plus: number;
  p_avg: number | null;
  p_obp: number | null;
  p_slg: number | null;
};

type PitcherRow = {
  player_id: string;
  first_name: string;
  last_name: string;
  team: string | null;
  from_team: string | null;
  conference: string | null;
  position: string | null;
  model_type: string;
  in_portal: boolean;
  p_rv_plus: number;
  p_era: number | null;
  p_fip: number | null;
  p_k9: number | null;
};

const todayString = () => {
  const now = new Date();
  return now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
};

const timeSince = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const hrs = Math.floor(diff / 3_600_000);
  if (hrs < 1) return "just now";
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
};

export default function Dashboard() {
  const { devBypassed, disableDevBypass, effectiveTeamId } = useAuth();
  const serviceKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  const { schoolName, schoolFullName } = useEffectiveSchool();

  const { data: topHitters = [] } = useQuery({
    queryKey: ["overview-top-hitters", effectiveTeamId],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      // Two-pool strategy: global top-50 + team-scoped top-50 (when active).
      // The previous "single combined query ordered by p_wrc_plus" shortcut
      // dropped team-scoped rows that ranked below position 50 in the global
      // pool — so a player whose team-scoped p_wrc_plus diverged downward
      // (e.g., Georgia's park projects Overbeek 133 vs global 141) lost the
      // team-scoped row and Dashboard displayed the global value while
      // Profile correctly showed the team-scoped one.
      const select = "id, player_id, customer_team_id, model_type, variant, status, p_wrc_plus, p_avg, p_obp, p_slg, players!inner(first_name, last_name, team, from_team, conference, position, pa, transfer_portal, division)";
      const buildBase = () => supabase
        .from("player_predictions")
        .select(select)
        .eq("season", PROJECTION_SEASON)
        .in("status", ["active", "departed"])
        .in("model_type", ["returner", "transfer"])
        .not("players.position", "in", "(SP,RP,CL,P,LHP,RHP)")
        .not("players.division", "eq", "NJCAA_D1")
        .gte("players.pa", 75)
        .not("p_wrc_plus", "is", null)
        .order("p_wrc_plus", { ascending: false })
        .limit(50);

      const globalQ = buildBase().eq("variant", "regular").is("customer_team_id", null);
      const teamQ = effectiveTeamId
        ? buildBase().eq("variant", "precomputed").eq("customer_team_id", effectiveTeamId)
        : null;
      const [globalRes, teamRes] = await Promise.all([
        globalQ,
        teamQ ?? Promise.resolve({ data: [], error: null } as any),
      ]);
      if (globalRes.error) throw globalRes.error;
      if (teamRes.error) throw teamRes.error;
      const globalRows = (globalRes.data ?? []) as any[];
      const teamRows = (teamRes.data ?? []) as any[];

      // Fill in team-scoped rows for any global candidate not yet covered.
      // Handles "global top-50 but team-scoped below 50" edge case.
      const teamByPlayer = new Map<string, any>(teamRows.map((r) => [r.player_id, r]));
      if (effectiveTeamId) {
        const missing = globalRows.map((r) => r.player_id).filter((id) => id && !teamByPlayer.has(id));
        if (missing.length > 0) {
          const { data: fill, error: fillErr } = await supabase
            .from("player_predictions")
            .select(select)
            .eq("season", PROJECTION_SEASON)
            .eq("variant", "precomputed")
            .eq("customer_team_id", effectiveTeamId)
            .in("player_id", missing);
          if (fillErr) throw fillErr;
          for (const r of (fill ?? []) as any[]) teamByPlayer.set(r.player_id, r);
        }
      }

      // Merge: team-scoped beats global per player_id; sort, slice top 5.
      const byPlayer = new Map<string, any>();
      for (const r of globalRows) byPlayer.set(r.player_id, r);
      for (const [pid, r] of teamByPlayer) byPlayer.set(pid, r);

      const rows: HitterRow[] = [...byPlayer.values()]
        .map((r) => ({
          player_id: r.player_id,
          first_name: r.players.first_name,
          last_name: r.players.last_name,
          team: r.players.team ?? null,
          from_team: r.players.from_team ?? null,
          conference: r.players.conference ?? null,
          position: r.players.position ?? null,
          model_type: r.model_type,
          in_portal: r.players.transfer_portal === true,
          p_wrc_plus: Number(r.p_wrc_plus),
          p_avg: r.p_avg,
          p_obp: r.p_obp,
          p_slg: r.p_slg,
        }))
        .sort((a, b) => b.p_wrc_plus - a.p_wrc_plus)
        .slice(0, 5);
      return rows;
    },
  });

  const { data: topPitchers = [] } = useQuery({
    queryKey: ["overview-top-pitchers", effectiveTeamId],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      // Same two-pool merge pattern as topHitters. See note there.
      const select = "id, player_id, customer_team_id, model_type, variant, status, p_rv_plus, p_era, p_fip, p_k9, players!inner(first_name, last_name, team, from_team, conference, position, ip, transfer_portal, division)";
      const buildBase = () => supabase
        .from("player_predictions")
        .select(select)
        .eq("season", PROJECTION_SEASON)
        .in("status", ["active", "departed"])
        .in("model_type", ["returner", "transfer"])
        .in("players.position", ["SP", "RP", "CL", "P", "LHP", "RHP"])
        .not("players.division", "eq", "NJCAA_D1")
        .gte("players.ip", 20)
        .not("p_rv_plus", "is", null)
        .order("p_rv_plus", { ascending: false })
        .limit(50);

      const globalQ = buildBase().eq("variant", "regular").is("customer_team_id", null);
      const teamQ = effectiveTeamId
        ? buildBase().eq("variant", "precomputed").eq("customer_team_id", effectiveTeamId)
        : null;
      const [globalRes, teamRes] = await Promise.all([
        globalQ,
        teamQ ?? Promise.resolve({ data: [], error: null } as any),
      ]);
      if (globalRes.error) throw globalRes.error;
      if (teamRes.error) throw teamRes.error;
      const globalRows = (globalRes.data ?? []) as any[];
      const teamRows = (teamRes.data ?? []) as any[];

      const teamByPlayer = new Map<string, any>(teamRows.map((r) => [r.player_id, r]));
      if (effectiveTeamId) {
        const missing = globalRows.map((r) => r.player_id).filter((id) => id && !teamByPlayer.has(id));
        if (missing.length > 0) {
          const { data: fill, error: fillErr } = await supabase
            .from("player_predictions")
            .select(select)
            .eq("season", PROJECTION_SEASON)
            .eq("variant", "precomputed")
            .eq("customer_team_id", effectiveTeamId)
            .in("player_id", missing);
          if (fillErr) throw fillErr;
          for (const r of (fill ?? []) as any[]) teamByPlayer.set(r.player_id, r);
        }
      }

      const byPlayer = new Map<string, any>();
      for (const r of globalRows) byPlayer.set(r.player_id, r);
      for (const [pid, r] of teamByPlayer) byPlayer.set(pid, r);

      const rows: PitcherRow[] = [...byPlayer.values()]
        .map((r) => ({
          player_id: r.player_id,
          first_name: r.players.first_name,
          last_name: r.players.last_name,
          team: r.players.team ?? null,
          from_team: r.players.from_team ?? null,
          conference: r.players.conference ?? null,
          position: r.players.position ?? null,
          model_type: r.model_type,
          in_portal: r.players.transfer_portal === true,
          p_rv_plus: Number(r.p_rv_plus),
          p_era: r.p_era,
          p_fip: r.p_fip,
          p_k9: r.p_k9,
        }))
        .sort((a, b) => b.p_rv_plus - a.p_rv_plus)
        .slice(0, 5);
      return rows;
    },
  });

  // Total player counts + recent portal activity for the briefing
  const { data: briefingStats } = useQuery({
    queryKey: ["overview-briefing-stats", schoolName ?? "", schoolFullName ?? ""],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      // "Committed" tile counts commits TO the user's school only — not every
      // commit globally. commit_school strings come from Verified Athletics and
      // may be either the short name ("Arkansas") or the full name ("University
      // of Arkansas"), so we OR-match on both via ilike.
      let committedQuery = supabase
        .from("players")
        .select("id", { count: "exact", head: true })
        .eq("portal_status", "COMMITTED");
      if (schoolName || schoolFullName) {
        const ors: string[] = [];
        if (schoolName) ors.push(`commit_school.ilike.%${schoolName}%`);
        if (schoolFullName && schoolFullName !== schoolName) ors.push(`commit_school.ilike.%${schoolFullName}%`);
        committedQuery = committedQuery.or(ors.join(","));
      }
      const [portalCountRes, committedCountRes, recentPortalRes, lastPredRes] = await Promise.all([
        supabase.from("players").select("id", { count: "exact", head: true }).eq("portal_status", "IN PORTAL"),
        committedQuery,
        supabase
          .from("players")
          .select("id, first_name, last_name, team, portal_status")
          .eq("portal_status", "IN PORTAL")
          .order("updated_at", { ascending: false })
          .limit(3),
        supabase
          .from("player_predictions")
          .select("updated_at")
          .eq("season", PROJECTION_SEASON)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      return {
        portalCount: portalCountRes.count ?? 0,
        committedCount: committedCountRes.count ?? 0,
        recentPortal: (recentPortalRes.data || []) as Array<{ id: string; first_name: string; last_name: string; team: string | null; portal_status: string }>,
        lastPredictionAt: (lastPredRes.data as any)?.updated_at ?? null,
      };
    },
  });

  const { board: targetBoard, removePlayer: removeFromBoard } = useTargetBoard();
  const { list: highFollowList } = useHighFollow();

  // Trigger activity query to re-run when followed/board player sets change
  const watchedIdsKey = [
    ...new Set([...highFollowList.map((p) => p.player_id), ...targetBoard.map((p) => p.player_id)]),
  ].sort().join(",");

  // Activity-feed cutoff. The stored value IS the cutoff (point we show items
  // "since"). Logic:
  //   - First-ever visit → set cutoff to 14 days ago so the feed isn't empty.
  //   - Cutoff older than 48h → slide forward to "48h ago" (gives a fresh window).
  //   - Otherwise → keep stored value (cutoff holds steady, click-in doesn't reset).
  const LAST_VISIT_KEY = "rstr_iq_dashboard_last_visit_v3";
  const HOLD_MS = 48 * 60 * 60 * 1000;
  const FIRST_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
  const lastVisitRef = useRef<string>(
    (() => {
      if (typeof window === "undefined") return new Date(0).toISOString();
      try {
        const now = Date.now();
        const stored = localStorage.getItem(LAST_VISIT_KEY);
        const storedMs = stored ? new Date(stored).getTime() : NaN;
        let cutoff: string;
        if (!Number.isFinite(storedMs)) {
          cutoff = new Date(now - FIRST_LOOKBACK_MS).toISOString();
        } else if (now - storedMs > HOLD_MS) {
          cutoff = new Date(now - HOLD_MS).toISOString();
        } else {
          cutoff = stored as string;
        }
        localStorage.setItem(LAST_VISIT_KEY, cutoff);
        return cutoff;
      } catch {
        return new Date(0).toISOString();
      }
    })()
  );

  // Recent portal activity — last 3 days of portal/committed entries, sorted
  // newest first. Hard 3-day floor at the DB level keeps the feed focused on
  // "what's new this week" rather than the full active backlog. Anything
  // older lives on the Transfer Portal page instead.
  const { data: portalActivity = [] } = useQuery({
    queryKey: ["overview-portal-activity-v4", watchedIdsKey, effectiveTeamId],
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      // 3-day floor — anything entered before this drops out of the feed.
      const floorDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      // Minimum sample to qualify for the feed — filters out 1-IP / 1-PA noise
      // from the portal pull while still surfacing real early-season prospects.
      const MIN_HITTER_PA = 25;
      const MIN_PITCHER_IP = 10;
      const pitcherPositions = "SP,RP,CL,P,LHP,RHP";
      const minSampleFilter =
        `and(position.in.(${pitcherPositions}),ip.gte.${MIN_PITCHER_IP}),` +
        `and(position.not.in.(${pitcherPositions}),pa.gte.${MIN_HITTER_PA})`;

      const { data: playerRows } = await (supabase as any)
        .from("players")
        .select("id, first_name, last_name, team, from_team, position, portal_status, portal_entry_date, commit_school, commit_date, updated_at")
        .in("portal_status", ["IN PORTAL", "COMMITTED"])
        .gte("portal_entry_date", floorDate)
        .or(minSampleFilter)
        .order("portal_entry_date", { ascending: false, nullsFirst: false })
        .limit(150);
      const playerIds = (playerRows || []).map((p: any) => p.id);
      const { data: predRows } = playerIds.length === 0
        ? { data: [] }
        : await (() => {
            let q = (supabase as any)
              .from("player_predictions")
              .select("player_id, customer_team_id, p_wrc_plus, p_rv_plus, variant, status")
              .eq("season", PROJECTION_SEASON)
              .in("player_id", playerIds)
              .in("variant", ["regular", "precomputed"])
              .in("status", ["active", "departed"]);
            q = applyTeamScopeFilter(q, effectiveTeamId);
            return q;
          })();
      // Prefer team-scoped precomputed row per player when active team has one.
      const preferred = dedupePreferredPerPlayer((predRows as any[]) || [], effectiveTeamId);
      const predByPlayer = new Map<string, { p_wrc_plus: number | null; p_rv_plus: number | null }>();
      for (const pr of preferred) {
        predByPlayer.set(pr.player_id as string, { p_wrc_plus: pr.p_wrc_plus, p_rv_plus: pr.p_rv_plus });
      }
      const raw = (playerRows || []).map((p: any) => ({
        players: p,
        p_wrc_plus: predByPlayer.get(p.id)?.p_wrc_plus ?? null,
        p_rv_plus: predByPlayer.get(p.id)?.p_rv_plus ?? null,
      }));

      const followSet = new Set(highFollowList.map((p) => p.player_id));
      const boardSet = new Set(targetBoard.map((p) => p.player_id));

      const isPitcher = (pos: string | null | undefined) =>
        /^(SP|RP|CL|P|LHP|RHP)/i.test(String(pos || ""));

      // No second filter — the 3-day DB floor IS the floor. Players without
      // predictions yet (just imported, cascade hasn't run) still show up;
      // their badge just renders without a metric value.
      const all = (raw || [])
        .map((r: any) => ({ ...r.players, p_wrc_plus: r.p_wrc_plus, p_rv_plus: r.p_rv_plus }))
        .map((p: any) => {
          const pitcher = isPitcher(p.position);
          const metric = pitcher ? p.p_rv_plus : p.p_wrc_plus;
          return {
            ...p,
            is_pitcher: pitcher,
            metric_value: metric ?? null,
            source: followSet.has(p.id) ? "following" : boardSet.has(p.id) ? "board" : "top",
          };
        })
        // Hide players we have no 2026 stats for. No prediction at all = no
        // Hitter/Pitching Master row to compute from = nothing useful for
        // coaches to act on (Ryan Brown, Connor Misch, etc. — the VA portal
        // CSV matched a name but we don't track their production).
        .filter((p: any) => p.p_wrc_plus != null || p.p_rv_plus != null);

      // Sort: newest portal_entry_date first → within date, watching first
      // (following/board), then by projected metric desc.
      const sourceRank = (s: string) => (s === "following" || s === "board" ? 0 : 1);
      all.sort((a: any, b: any) => {
        const dateCmp = (b.portal_entry_date || "").localeCompare(a.portal_entry_date || "");
        if (dateCmp !== 0) return dateCmp;
        const srcCmp = sourceRank(a.source) - sourceRank(b.source);
        if (srcCmp !== 0) return srcCmp;
        return (b.metric_value ?? -Infinity) - (a.metric_value ?? -Infinity);
      });

      // Cap at 50 — keeps the scrollable list bounded but allows generous scroll.
      return all.slice(0, 50) as Array<{
        id: string; first_name: string; last_name: string; team: string | null; from_team: string | null; position: string | null;
        portal_status: string; portal_entry_date: string | null; commit_school: string | null; commit_date: string | null;
        updated_at: string; p_wrc_plus?: number | null; p_rv_plus?: number | null;
        is_pitcher: boolean; metric_value: number | null;
        source: "following" | "board" | "top";
      }>;
    },
  });


  const stats = briefingStats ?? { portalCount: 0, committedCount: 0, recentPortal: [], lastPredictionAt: null };


  const fmt3 = (v: number | null) => (v == null ? "—" : v.toFixed(3));
  const fmt2 = (v: number | null) => (v == null ? "—" : v.toFixed(2));

  return (
    <DashboardLayout>
      {import.meta.env.DEV && devBypassed && !serviceKey && (
        <div className="mb-4 space-y-2 rounded border border-yellow-300 bg-yellow-100 p-3 text-yellow-800">
          <p>Warning: Dev bypass active but no service role key provided. Data may be empty.</p>
          <button
            className="text-sm text-blue-600 underline"
            onClick={() => {
              disableDevBypass();
              window.location.href = "/auth";
            }}
          >
            Return to login
          </button>
        </div>
      )}

      <div className="space-y-4 max-w-[1400px] mx-auto">
        <SchoolBanner />

        {/* Morning Briefing — top strip with gold accent, then metric tiles row */}
        <div className="space-y-0">
          <div
            className="rounded-t-lg border-l-[3px] border-l-[#D4AF37] bg-[#0D1B3E] px-4 py-3 flex items-center flex-wrap gap-x-4 gap-y-1"
            style={{ fontFamily: "Inter, sans-serif" }}
          >
            <span
              className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#D4AF37]"
              style={{ fontFamily: "Oswald, sans-serif" }}
            >
              Today's Briefing
            </span>
            <span className="flex items-center gap-1.5 text-xs text-slate-300">
              <Calendar className="h-3 w-3" />
              {todayString()}
            </span>
            <span className="text-slate-500">·</span>
            <span className="flex items-center gap-1.5 text-xs text-slate-300">
              <Activity className="h-3 w-3" />
              Projections updated {timeSince(stats.lastPredictionAt)}
            </span>
          </div>
          {/* Tile row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 rounded-b-lg border border-t-0 border-[#162241] bg-[#0a1428] divide-x divide-[#162241]">
            <BriefingTile
              label="In Portal"
              value={String(stats.portalCount)}
              icon={<LogIn className="h-3.5 w-3.5" />}
              accent="emerald"
            />
            <BriefingTile
              label="Players Following"
              value={String(highFollowList.length)}
              icon={<Users className="h-3.5 w-3.5" />}
            />
            <BriefingTile
              label="Your Board"
              value={String(targetBoard.length)}
              icon={<TrendingUp className="h-3.5 w-3.5" />}
              accent="gold"
            />
            <BriefingTile
              label={schoolName ? `Committed to ${schoolName}` : "Committed"}
              value={String(stats.committedCount)}
              icon={<CheckCircle className="h-3.5 w-3.5" />}
              accent="blue"
            />
          </div>
          {/* Recent Portal Activity — scrollable, prioritized:
              high-follow/board players first → top portal players by pWRC+ →
              capped at last-visit timestamp. */}
          <div className="mt-2 rounded-lg border border-border/60 bg-muted/20 px-4 py-2.5">
            <div className="flex items-center justify-between mb-2">
              <span
                className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#D4AF37]"
                style={{ fontFamily: "Oswald, sans-serif" }}
              >
                Recent Portal Activity
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">
                {portalActivity.length === 0
                  ? "No updates since your last visit"
                  : `${portalActivity.length} ${portalActivity.length === 1 ? "update" : "updates"} since your last visit`}
              </span>
            </div>
            {portalActivity.length === 0 ? (
              <p className="py-3 text-xs text-muted-foreground text-center">Nothing new — check back after the next portal import.</p>
            ) : (
              <div className="max-h-[280px] overflow-y-auto pr-1 divide-y divide-border/30">
                {portalActivity.map((p) => {
                  const isCommitted = p.portal_status === "COMMITTED";
                  const arrowClass = isCommitted ? "text-blue-500" : "text-emerald-500";
                  const destClass = isCommitted ? "text-blue-600" : "text-emerald-600";
                  const sourceLabel =
                    p.source === "following" ? "Following" :
                    p.source === "board"     ? "On Board" :
                    null;
                  const fromTeam = p.from_team || p.team;
                  const toLabel = isCommitted ? (p.commit_school || "Committed") : "Portal";
                  const metricLabel = p.metric_value != null ? Math.round(p.metric_value).toString() : null;
                  const metricSuffix = p.is_pitcher ? "pRV+" : "pWRC+";
                  // portal_entry_date is a calendar date string (YYYY-MM-DD).
                  // new Date("2026-05-19") parses as midnight UTC, which in
                  // US Eastern renders as the prior day. Pin to UTC for display
                  // so the calendar date matches what was stored.
                  const entryDate = p.portal_entry_date
                    ? new Date(p.portal_entry_date).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })
                    : null;
                  return (
                    <Link
                      key={p.id}
                      to={profileRouteFor(p.id, p.position)}
                      className="flex items-center gap-2 py-1.5 text-xs hover:text-primary transition-colors cursor-pointer"
                    >
                      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", isCommitted ? "bg-blue-500" : "bg-[#D4AF37]")} />
                      <span className="font-semibold truncate max-w-[140px]">{p.first_name} {p.last_name}</span>
                      {sourceLabel && (
                        <span className="text-[9px] font-bold uppercase tracking-wider text-[#D4AF37] bg-[#D4AF37]/10 ring-1 ring-[#D4AF37]/30 px-1.5 py-px rounded">
                          {sourceLabel}
                        </span>
                      )}
                      {metricLabel && (
                        <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-px rounded font-mono">
                          {metricLabel} {metricSuffix}
                        </span>
                      )}
                      <span className="flex items-center gap-1.5 ml-1 min-w-0">
                        <span className="text-muted-foreground truncate max-w-[120px]">{fromTeam || "—"}</span>
                        <ArrowRight className={cn("h-3 w-3 shrink-0", arrowClass)} />
                        <span className={cn("font-semibold truncate max-w-[140px]", destClass)}>{toLabel}</span>
                      </span>
                      {entryDate && (
                        <span className="ml-auto text-[10px] text-muted-foreground font-mono shrink-0">
                          {entryDate}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Top 5 Hitters + Top 5 Pitchers (data-dense dashboard style) */}
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          <Card className="border-border/60">
            <CardHeader className="pb-2 pt-3 px-4 border-b border-border/40">
              <div className="flex items-center justify-between gap-3">
                <CardTitle
                  className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#D4AF37] shrink-0"
                  style={{ fontFamily: "Oswald, sans-serif" }}
                >
                  Top 5 Hitters
                </CardTitle>
                <span className="hidden sm:block text-[10px] uppercase tracking-wider text-muted-foreground font-mono whitespace-nowrap">
                  pAVG / pOBP / pSLG · pWRC+
                </span>
                <span className="sm:hidden text-[10px] uppercase tracking-wider text-muted-foreground font-mono">pWRC+</span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/30">
                {topHitters.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">No data.</div>
                ) : (
                  topHitters.map((row, idx) => (
                    <Link
                      key={row.player_id}
                      to={profileRouteFor(row.player_id, row.position)}
                      className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40 transition-colors duration-150 group cursor-pointer"
                    >
                      <span className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold tabular-nums",
                        idx === 0 ? "bg-[#D4AF37]/15 text-[#D4AF37]" : idx <= 2 ? "bg-muted text-foreground" : "text-muted-foreground",
                      )}>
                        {idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold group-hover:text-primary transition-colors">
                            {row.first_name} {row.last_name}
                          </span>
                          {row.in_portal && (
                            <span className="text-[9px] font-bold uppercase tracking-wider text-amber-600 bg-amber-50 border border-amber-200 rounded px-1 py-px">
                              Portal
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className="truncate">{row.from_team || row.team || "-"}</span>
                          {row.position && <><span className="text-muted-foreground/50">·</span><span>{row.position}</span></>}
                        </div>
                      </div>
                      <div className="hidden sm:block text-[10px] text-muted-foreground font-mono tabular-nums shrink-0 pr-2 whitespace-nowrap">
                        {fmt3(row.p_avg)} / {fmt3(row.p_obp)} / {fmt3(row.p_slg)}
                      </div>
                      <div className="font-mono text-base font-bold tabular-nums shrink-0">
                        {Math.round(row.p_wrc_plus)}
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader className="pb-2 pt-3 px-4 border-b border-border/40">
              <div className="flex items-center justify-between gap-3">
                <CardTitle
                  className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#D4AF37] shrink-0"
                  style={{ fontFamily: "Oswald, sans-serif" }}
                >
                  Top 5 Pitchers
                </CardTitle>
                <span className="hidden sm:block text-[10px] uppercase tracking-wider text-muted-foreground font-mono whitespace-nowrap">
                  pERA / pFIP / pK/9 · pRV+
                </span>
                <span className="sm:hidden text-[10px] uppercase tracking-wider text-muted-foreground font-mono">pRV+</span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/30">
                {topPitchers.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">No data.</div>
                ) : (
                  topPitchers.map((row, idx) => (
                    <Link
                      key={row.player_id}
                      to={profileRouteFor(row.player_id, row.position)}
                      className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40 transition-colors duration-150 group cursor-pointer"
                    >
                      <span className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold tabular-nums",
                        idx === 0 ? "bg-[#D4AF37]/15 text-[#D4AF37]" : idx <= 2 ? "bg-muted text-foreground" : "text-muted-foreground",
                      )}>
                        {idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold group-hover:text-primary transition-colors">
                            {row.first_name} {row.last_name}
                          </span>
                          {row.in_portal && (
                            <span className="text-[9px] font-bold uppercase tracking-wider text-amber-600 bg-amber-50 border border-amber-200 rounded px-1 py-px">
                              Portal
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className="truncate">{row.from_team || row.team || "-"}</span>
                          {row.position && <><span className="text-muted-foreground/50">·</span><span>{row.position}</span></>}
                        </div>
                      </div>
                      <div className="hidden sm:block text-[10px] text-muted-foreground font-mono tabular-nums shrink-0 pr-2 whitespace-nowrap">
                        {fmt2(row.p_era)} / {fmt2(row.p_fip)} / {fmt2(row.p_k9)}
                      </div>
                      <div className="font-mono text-base font-bold tabular-nums shrink-0">
                        {Math.round(row.p_rv_plus)}
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Target Board */}
        <Card className="border-border/60">
          <CardHeader className="pb-2 pt-3 px-4 border-b border-border/40 flex flex-row items-center justify-between">
            <CardTitle
              className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]"
              style={{ fontFamily: "Oswald, sans-serif" }}
            >
              Target Board
            </CardTitle>
            <span className="text-[10px] text-muted-foreground/70 font-mono">{targetBoard.length} {targetBoard.length === 1 ? "player" : "players"}</span>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border/30">
              {targetBoard.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No players on your board yet. Add players from the Player Dashboard or player profiles.
                </div>
              ) : (
                targetBoard.map((row) => {
                  const initials = `${(row.first_name?.[0] || "").toUpperCase()}${(row.last_name?.[0] || "").toUpperCase()}`;
                  const displayStatus = row.portal_status === "NOT IN PORTAL" ? "WATCHING" : row.portal_status;
                  const statusConfig = {
                    "IN PORTAL": { bg: "bg-emerald-500/10", text: "text-emerald-600", icon: LogIn, label: "In Portal" },
                    "COMMITTED": { bg: "bg-blue-500/10", text: "text-blue-600", icon: CheckCircle, label: "Committed" },
                    "WATCHING": { bg: "bg-[#D4AF37]/10", text: "text-[#D4AF37]", icon: Eye, label: "Watching" },
                  }[displayStatus] || { bg: "bg-[#D4AF37]/10", text: "text-[#D4AF37]", icon: Eye, label: "Watching" };
                  const StatusIcon = statusConfig.icon;
                  return (
                    <div
                      key={row.player_id}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors duration-150 group"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#A08820]/15 text-[11px] font-bold text-[#D4AF37] ring-1 ring-[#D4AF37]/20">
                        {initials}
                      </div>
                      <Link
                        to={profileRouteFor(row.player_id, row.position)}
                        className="min-w-0 flex-1 cursor-pointer"
                      >
                        <span className="block truncate text-sm font-semibold group-hover:text-primary transition-colors">
                          {row.first_name} {row.last_name}
                        </span>
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className="truncate">{row.team || "—"}</span>
                          {row.position && <><span className="text-muted-foreground/50">·</span><span>{row.position}</span></>}
                        </div>
                      </Link>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                          statusConfig.bg, statusConfig.text,
                        )}>
                          <StatusIcon className="h-2.5 w-2.5" />
                          {statusConfig.label}
                        </span>
                        <button
                          onClick={() => removeFromBoard(row.player_id)}
                          className="text-muted-foreground/40 hover:text-destructive transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                          title="Remove from board"
                          aria-label="Remove from board"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        <div className="text-center pb-2">
          <Link to="/dashboard/returning" className="text-xs font-medium text-primary hover:underline">
            View Full Leaderboard →
          </Link>
        </div>
      </div>
    </DashboardLayout>
  );
}

function BriefingTile({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent?: "emerald" | "blue" | "gold";
}) {
  const accentColor =
    accent === "emerald" ? "text-emerald-400" : accent === "blue" ? "text-blue-400" : accent === "gold" ? "text-[#D4AF37]" : "text-white";
  return (
    <div className="px-4 py-3 flex flex-col gap-0.5">
      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        <span className="text-slate-500">{icon}</span>
        {label}
      </span>
      <span
        className={cn("text-xl font-bold tabular-nums", accentColor)}
        style={{ fontFamily: "Oswald, sans-serif" }}
      >
        {value}
      </span>
    </div>
  );
}
