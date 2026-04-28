import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTargetBoard } from "@/hooks/useTargetBoard";
import { useHighFollow } from "@/hooks/useHighFollow";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Eye, LogIn, X, CheckCircle, TrendingUp, Users, Calendar, Activity, ArrowRight } from "lucide-react";
import { profileRouteFor } from "@/lib/profileRoutes";
import SchoolBanner from "@/components/SchoolBanner";

type HitterRow = {
  player_id: string;
  first_name: string;
  last_name: string;
  team: string | null;
  from_team: string | null;
  conference: string | null;
  position: string | null;
  model_type: string;
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
  const { devBypassed, disableDevBypass } = useAuth();
  const serviceKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

  const { data: topHitters = [] } = useQuery({
    queryKey: ["overview-top-hitters"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const all: any[] = [];
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("player_predictions")
          .select(
            "id, player_id, model_type, variant, status, p_wrc_plus, p_avg, p_obp, p_slg, players!inner(first_name, last_name, team, from_team, conference, position, pa)",
          )
          .eq("variant", "regular")
          .in("status", ["active", "departed"])
          .in("model_type", ["returner", "transfer"])
          .not("players.position", "in", "(SP,RP,CL,P,LHP,RHP)")
          .gte("players.pa", 75)
          .not("p_wrc_plus", "is", null)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = data || [];
        all.push(...rows);
        if (rows.length < PAGE) break;
        from += PAGE;
      }
      const byPlayer = new Map<string, any>();
      for (const row of all) {
        const existing = byPlayer.get(row.player_id);
        if (!existing || (row.p_wrc_plus ?? -Infinity) > (existing.p_wrc_plus ?? -Infinity)) {
          byPlayer.set(row.player_id, row);
        }
      }
      const rows: HitterRow[] = Array.from(byPlayer.values())
        .map((r) => ({
          player_id: r.player_id,
          first_name: r.players.first_name,
          last_name: r.players.last_name,
          team: r.players.team ?? null,
          from_team: r.players.from_team ?? null,
          conference: r.players.conference ?? null,
          position: r.players.position ?? null,
          model_type: r.model_type,
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
    queryKey: ["overview-top-pitchers"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      // Load top pitchers from Pitching Master (overall_pr_plus is the pRV+ equivalent)
      const { data: pmRows, error: pmErr } = await supabase
        .from("Pitching Master")
        .select("source_player_id, playerFullName, Team, Conference, Role, IP, ERA, FIP, K9, overall_pr_plus")
        .eq("Season", 2026)
        .gte("IP", 20)
        .not("overall_pr_plus", "is", null)
        .order("overall_pr_plus", { ascending: false })
        .limit(25);
      if (pmErr) throw pmErr;
      const pitchers = pmRows || [];
      if (pitchers.length === 0) return [];

      // Resolve players.id for each source_player_id so profile links work
      const sourceIds = pitchers.map((p: any) => p.source_player_id).filter(Boolean);
      const playerMap = new Map<string, { id: string; team: string | null; position: string | null }>();
      if (sourceIds.length > 0) {
        const { data: plRows } = await supabase
          .from("players")
          .select("id, source_player_id, team, position")
          .in("source_player_id", sourceIds);
        for (const pl of (plRows || []) as any[]) {
          if (pl.source_player_id) playerMap.set(pl.source_player_id, { id: pl.id, team: pl.team, position: pl.position });
        }
      }

      const out: PitcherRow[] = [];
      for (const r of pitchers as any[]) {
        const pl = playerMap.get(r.source_player_id);
        if (!pl) continue; // skip pitchers not yet linked to a player record
        const fullName = (r.playerFullName || "").trim();
        const [first, ...rest] = fullName.split(" ");
        out.push({
          player_id: pl.id,
          first_name: first || "",
          last_name: rest.join(" ") || "",
          team: r.Team ?? pl.team,
          from_team: null,
          conference: r.Conference ?? null,
          position: r.Role ?? pl.position,
          model_type: "returner",
          p_rv_plus: Number(r.overall_pr_plus),
          p_era: r.ERA,
          p_fip: r.FIP,
          p_k9: r.K9,
        });
        if (out.length >= 5) break;
      }
      return out;
    },
  });

  // Total player counts + recent portal activity for the briefing
  const { data: briefingStats } = useQuery({
    queryKey: ["overview-briefing-stats"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [portalCountRes, committedCountRes, recentPortalRes, lastPredRes] = await Promise.all([
        supabase.from("players").select("id", { count: "exact", head: true }).eq("portal_status", "IN PORTAL"),
        supabase.from("players").select("id", { count: "exact", head: true }).eq("portal_status", "COMMITTED"),
        supabase
          .from("players")
          .select("id, first_name, last_name, team, portal_status")
          .eq("portal_status", "IN PORTAL")
          .order("updated_at", { ascending: false })
          .limit(3),
        supabase
          .from("player_predictions")
          .select("updated_at")
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

  const { data: personalActivity = [] } = useQuery({
    queryKey: ["overview-personal-activity", watchedIdsKey],
    enabled: watchedIdsKey.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const ids = watchedIdsKey.split(",").filter(Boolean);
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from("players")
        .select("id, first_name, last_name, team, from_team, portal_status, updated_at")
        .in("id", ids)
        .in("portal_status", ["IN PORTAL", "COMMITTED"])
        .order("updated_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      // Flag which list each player belongs to
      const followSet = new Set(highFollowList.map((p) => p.player_id));
      const boardSet = new Set(targetBoard.map((p) => p.player_id));
      return (data || []).map((p: any) => ({
        ...p,
        source: followSet.has(p.id) ? "following" : boardSet.has(p.id) ? "board" : "other",
      })) as Array<{ id: string; first_name: string; last_name: string; team: string | null; from_team: string | null; portal_status: string; updated_at: string; source: "following" | "board" | "other" }>;
    },
  });

  const stats = briefingStats ?? { portalCount: 0, committedCount: 0, recentPortal: [], lastPredictionAt: null };

  const displayActivity = personalActivity;

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
              label="Committed"
              value={String(stats.committedCount)}
              icon={<CheckCircle className="h-3.5 w-3.5" />}
              accent="blue"
            />
          </div>
          {/* Personalized updates — your followed/board players with recent portal activity */}
          {displayActivity.length > 0 ? (
            <div className="mt-2 rounded-lg border border-border/60 bg-muted/20 px-4 py-2">
              <div className="flex items-center justify-between mb-1.5">
                <span
                  className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#D4AF37]"
                  style={{ fontFamily: "Oswald, sans-serif" }}
                >
                  Your Updates
                </span>
                <span className="text-[10px] text-muted-foreground font-mono">{displayActivity.length} {displayActivity.length === 1 ? "update" : "updates"}</span>
              </div>
              <div className="divide-y divide-border/30">
                {displayActivity.slice(0, 5).map((p) => {
                  const isPortal = p.portal_status === "IN PORTAL";
                  const arrowClass = isPortal ? "text-emerald-500" : "text-blue-500";
                  const destClass = isPortal ? "text-emerald-600" : "text-blue-600";
                  const sourceLabel = p.source === "following" ? "Following" : p.source === "board" ? "On Board" : null;
                  const fromTeam = p.from_team;
                  const toLabel = isPortal ? "Portal" : (p.team || "—");
                  return (
                    <Link
                      key={p.id}
                      to={`/dashboard/player/${p.id}`}
                      className="flex items-center gap-2 py-1.5 text-xs hover:text-primary transition-colors cursor-pointer"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-[#D4AF37] shrink-0" />
                      <span className="font-semibold">{p.first_name} {p.last_name}</span>
                      {sourceLabel && (
                        <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-px rounded">
                          {sourceLabel}
                        </span>
                      )}
                      <span className="flex items-center gap-1.5 ml-1">
                        <span className="text-muted-foreground">{fromTeam || "—"}</span>
                        <ArrowRight className={cn("h-3 w-3 shrink-0", arrowClass)} />
                        <span className={cn("font-semibold", destClass)}>{toLabel}</span>
                      </span>
                      <span className="ml-auto text-[10px] text-muted-foreground font-mono">{timeSince(p.updated_at)}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ) : highFollowList.length === 0 && targetBoard.length === 0 ? (
            <div className="mt-2 rounded-lg border border-dashed border-border/60 bg-muted/10 px-4 py-2 text-xs text-muted-foreground">
              Add players to your High Follow list or Target Board to see personalized updates here.
            </div>
          ) : null}
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
                          {row.model_type === "transfer" && (
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
                          {row.model_type === "transfer" && (
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
