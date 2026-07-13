import { lazy, Suspense, useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useGmRoster } from "@/gm/hooks/useGmRoster";
import { useGmContracts } from "@/gm/hooks/useGmContracts";
import PlayerFinancials, { playerComp } from "@/gm/components/PlayerFinancials";
import { isPitcherProfile } from "@/lib/profileRoutes";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ArrowLeft, LineChart, BarChart3, DollarSign, Activity, Bone, LayoutDashboard } from "lucide-react";

// Reuse the existing scouting pages verbatim as tab content (embedded = no chrome).
const PlayerProfile = lazy(() => import("@/pages/PlayerProfile"));
const PitcherProfile = lazy(() => import("@/pages/PitcherProfile"));
const PlayerStatsPage = lazy(() => import("@/pages/PlayerStatsPage"));
const PitcherStatsPage = lazy(() => import("@/pages/PitcherStatsPage"));

const OSWALD = { fontFamily: "Oswald, sans-serif" } as const;
const money = (n: number | null | undefined) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));
const num = (n: number | null | undefined, d = 1) => (n == null ? "—" : n.toFixed(d));

const TABS = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "projections", label: "Projections", icon: LineChart },
  { key: "stats", label: "Season Stats", icon: BarChart3 },
  { key: "financials", label: "Financials", icon: DollarSign },
  { key: "newtforce", label: "NewtForce", icon: Activity },
  { key: "biomechanics", label: "Biomechanics", icon: Bone },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <Card className="border-dashed border-border/70">
      <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
        <h3 className="text-lg font-bold" style={OSWALD}>{title}</h3>
        <p className="max-w-md text-sm text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}

/**
 * Universal player hub — the program-wide home for one player. Every internal
 * player click routes here. A header + tab bar; Projections and Season Stats
 * embed the existing scouting pages verbatim; Financials reuses the front-office
 * comp/contracts view; NewtForce/Biomechanics are placeholders until wired.
 */
export default function PlayerHub() {
  const { playerId = "" } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as TabKey) || "overview";
  const setTab = (t: TabKey) => setParams((p) => { p.set("tab", t); return p; }, { replace: true });

  const gm = useGmRoster();
  const { contracts } = useGmContracts(playerId);

  const row = useMemo(
    () => [...gm.hitters, ...gm.pitchers].find((r) => r.player_id === playerId) ?? null,
    [gm.hitters, gm.pitchers, playerId],
  );

  const { data: dbPlayer } = useQuery({
    queryKey: ["player-identity", playerId],
    enabled: !!playerId && !row,
    queryFn: async () => {
      const { data } = await (supabase as any).from("players").select("*").eq("id", playerId).maybeSingle();
      return data as any;
    },
  });

  // Program membership: a player belongs to the program if they're rostered on
  // ANY of the team's builds (add to any build → program profile; removed from
  // all → reverts to the outside scouting design). We know instantly if they're
  // on the selected build (`row`); otherwise check across the team's builds.
  const onSelectedBuild = !!row;
  const buildIds = useMemo(() => gm.builds.map((b) => b.id), [gm.builds]);
  const { data: onAnyBuild, isLoading: membershipLoading } = useQuery({
    queryKey: ["player-program-membership", playerId, buildIds.join(",")],
    enabled: !!playerId && !onSelectedBuild && buildIds.length > 0,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("team_build_players").select("id")
        .in("team_build_id", buildIds).eq("player_id", playerId).eq("included_in_roster", true).limit(1);
      return (data?.length ?? 0) > 0;
    },
  });
  const isProgramPlayer = onSelectedBuild || onAnyBuild === true;
  const resolving = gm.isLoading
    || (!onSelectedBuild && gm.hasTeam && buildIds.length === 0)
    || (!onSelectedBuild && buildIds.length > 0 && membershipLoading);

  const dbName = dbPlayer ? [dbPlayer.first_name, dbPlayer.last_name].filter(Boolean).join(" ") : "";
  const name = (row?.name ?? dbName) || "Player";
  const position = row?.position ?? dbPlayer?.position ?? null;
  const classYr = row?.eligibility_class ?? row?.class_year ?? dbPlayer?.class_year ?? null;
  const isPitcher = isPitcherProfile(position, row?.is_pitcher ? "rhp" : null);
  const c = row ? playerComp(row) : null;

  const headline = (label: string, value: string, accent?: boolean) => (
    <div className="flex flex-col gap-0.5 px-4 py-3">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("font-mono text-lg font-bold tabular-nums", accent ? "text-[#D4AF37]" : "text-foreground")} style={OSWALD}>{value}</span>
    </div>
  );

  // Projections/Season Stats embed the scouting pages, which carry their own
  // identity header — so the hub header only shows on the other tabs (and the
  // details it shows are trimmed to what's relevant, e.g. no position on money).
  const embedsOwnHeader = tab === "projections" || tab === "stats";
  const showPosition = tab !== "financials";

  // Outside the program → the Player-Evaluation (scouting) design, with its own
  // Overview/Season Stats tabs. Only rostered players get the program hub.
  if (resolving) {
    return <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>;
  }
  if (!isProgramPlayer) {
    return (
      <Suspense fallback={<div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>}>
        {isPitcher
          ? <PitcherProfile embedded idOverride={playerId} />
          : <PlayerProfile embedded idOverride={playerId} />}
      </Suspense>
    );
  }

  return (
    <div className="space-y-4">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back</button>

      {/* Header / home — one consistent header, hidden where the embedded page has its own */}
      {!embedsOwnHeader && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#D4AF37]/15 text-xl font-bold text-[#D4AF37]" style={OSWALD}>{(name[0] || "?").toUpperCase()}</div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold leading-tight" style={OSWALD}>{name}</h1>
            <div className="text-xs text-muted-foreground">
              {[showPosition ? position : null, classYr, isPitcher ? "Pitcher" : "Position player"].filter(Boolean).join(" · ")}
              {row && <span className={cn("ml-1.5 font-medium", row.finalized ? "text-emerald-400" : "text-amber-400")}>· {row.finalized ? "Finalized" : "Draft"}</span>}
            </div>
          </div>
        </div>
      )}

        {/* Tab bar */}
        <div className="flex gap-1 overflow-x-auto border-b border-border/60">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn("flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                tab === t.key ? "border-[#D4AF37] text-[#D4AF37]" : "border-transparent text-muted-foreground hover:text-foreground")}>
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === "overview" && (
          <div className="space-y-4">
            <Card className="border-border/60">
              <CardContent className="grid grid-cols-2 divide-x divide-y divide-border/50 p-0 sm:grid-cols-4 sm:divide-y-0">
                {headline("Projected WAR", num(row?.war))}
                {headline("Market Value", money(row?.market_value))}
                {headline("Total Pay", money(c?.total ?? null), true)}
                {headline("Contracts", String(contracts.length))}
              </CardContent>
            </Card>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { t: "projections" as TabKey, label: "Projections", desc: "Projected line & value", icon: LineChart },
                { t: "stats" as TabKey, label: "Season Stats", desc: "This season's numbers", icon: BarChart3 },
                { t: "financials" as TabKey, label: "Financials", desc: "Comp, contracts & obligations", icon: DollarSign },
              ].map((q) => (
                <button key={q.t} onClick={() => setTab(q.t)} className="flex items-center gap-3 rounded-lg border border-border/60 p-3 text-left transition-colors hover:border-[#D4AF37]/50 hover:bg-muted/30">
                  <q.icon className="h-5 w-5 text-[#D4AF37]" />
                  <div><div className="text-sm font-semibold">{q.label}</div><div className="text-[11px] text-muted-foreground">{q.desc}</div></div>
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === "projections" && (
          <Suspense fallback={<div className="py-16 text-center text-sm text-muted-foreground">Loading projections…</div>}>
            {isPitcher
              ? <PitcherProfile embedded hideTabs idOverride={playerId} />
              : <PlayerProfile embedded hideTabs idOverride={playerId} />}
          </Suspense>
        )}

        {tab === "stats" && (
          <Suspense fallback={<div className="py-16 text-center text-sm text-muted-foreground">Loading stats…</div>}>
            {isPitcher
              ? <PitcherStatsPage embedded hideTabs idOverride={playerId} />
              : <PlayerStatsPage embedded hideTabs idOverride={playerId} />}
          </Suspense>
        )}

        {tab === "financials" && <PlayerFinancials playerName={name} playerId={playerId} />}

        {tab === "newtforce" && (
          <Placeholder title="NewtForce" note="Force-plate & mound metrics (Accel Impulse Score, Z Transfer, and more) will appear here once NewtForce data is wired into the program database." />
        )}
        {tab === "biomechanics" && (
          <Placeholder title="Biomechanics" note="Motion-capture and biomechanics analysis will live here once that data source is connected." />
        )}
      </div>
  );
}
