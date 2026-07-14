import { lazy, Suspense, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useGmRoster } from "@/gm/hooks/useGmRoster";
import { useGmContracts } from "@/gm/hooks/useGmContracts";
import PlayerFinancials, { playerComp } from "@/gm/components/PlayerFinancials";
import { isPitcherProfile } from "@/lib/profileRoutes";
import { useEffectiveSchool } from "@/hooks/useEffectiveSchool";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowLeft, LineChart, BarChart3, DollarSign, Activity, Bone, LayoutDashboard, FileText, ClipboardList } from "lucide-react";

// Depth/pitcher role → display label (both hitter and pitcher roles).
const ROLE_LABEL: Record<string, string> = {
  cornerstone: "Cornerstone", everyday_starter: "Everyday Starter", platoon_starter: "Platoon Starter", utility: "Utility", bench: "Bench",
  weekend_starter: "Weekend Starter", weekday_starter: "Weekday Starter", swing_starter: "Swing Starter",
  workhorse_reliever: "Workhorse Reliever", high_leverage_reliever: "High-Leverage Reliever", mid_leverage_reliever: "Mid-Leverage Reliever",
  low_impact_reliever: "Low-Impact Reliever", specialist_reliever: "Specialist Reliever",
};

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
  { key: "development", label: "Player Development", icon: Activity },
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

// Player Development groups the movement/force data sources under one tab with a
// toggle — NewtForce and Biomechanics today, room for more dev detail later.
const DEV_SOURCES = [
  { key: "newtforce", label: "NewtForce", icon: Activity, note: "Force-plate & mound metrics (Accel Impulse Score, Z Transfer, and more) will appear here once NewtForce data is wired into the program database." },
  { key: "biomechanics", label: "Biomechanics", icon: Bone, note: "Motion-capture and biomechanics analysis will live here once that data source is connected." },
] as const;

function PlayerDevelopment() {
  const [src, setSrc] = useState<(typeof DEV_SOURCES)[number]["key"]>("newtforce");
  const active = DEV_SOURCES.find((s) => s.key === src)!;
  return (
    <div className="space-y-3">
      <div className="flex w-fit gap-0.5 rounded-md border border-border/60 bg-muted/30 p-0.5">
        {DEV_SOURCES.map((s) => (
          <button key={s.key} onClick={() => setSrc(s.key)}
            className={cn("flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold transition-colors",
              src === s.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            <s.icon className="h-3.5 w-3.5" /> {s.label}
          </button>
        ))}
      </div>
      <Placeholder title={active.label} note={active.note} />
    </div>
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

  // Always fetch the player record — for the headshot (players.headshot_url,
  // auto-populated from the roster source) and identity fallback.
  const { data: dbPlayer } = useQuery({
    queryKey: ["player-identity", playerId],
    enabled: !!playerId,
    queryFn: async () => {
      const { data } = await (supabase as any).from("players").select("*").eq("id", playerId).maybeSingle();
      return data as any;
    },
  });
  const { logoUrl } = useEffectiveSchool();
  const headshotUrl: string | null = dbPlayer?.headshot_url ?? null;

  // Program membership: a player belongs to the program if they're on the LIVE
  // (active) build — the same build that drives their numbers, so membership and
  // display always agree. Not on the live build → the outside scouting design.
  const liveBuildId = gm.liveBuildId;
  const { data: onLiveBuild, isLoading: membershipLoading } = useQuery({
    queryKey: ["player-program-membership", playerId, liveBuildId],
    enabled: !!playerId && !!liveBuildId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("team_build_players").select("id")
        .eq("build_id", liveBuildId).eq("player_id", playerId).eq("included_in_roster", true).limit(1);
      return (data?.length ?? 0) > 0;
    },
  });
  const isProgramPlayer = onLiveBuild === true;
  const resolving = gm.isLoading || (!!liveBuildId && membershipLoading);

  const dbName = dbPlayer ? [dbPlayer.first_name, dbPlayer.last_name].filter(Boolean).join(" ") : "";
  const name = (row?.name ?? dbName) || "Player";
  const position = row?.position ?? dbPlayer?.position ?? null;
  const classYr = row?.eligibility_class ?? row?.class_year ?? dbPlayer?.class_year ?? null;
  const isPitcher = isPitcherProfile(position, row?.is_pitcher ? "rhp" : null);
  const c = row ? playerComp(row) : null;

  const kv = (label: string, value: string, accent?: boolean) => (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-xs font-semibold", accent ? "font-mono text-[#D4AF37]" : "text-foreground")}>{value}</span>
    </div>
  );
  const statBox = (label: string, value: string, accent?: boolean) => (
    <div className="flex flex-col items-center justify-center gap-0.5 px-4 py-1.5 text-center">
      <span className={cn("font-mono text-base font-bold leading-none tabular-nums", accent ? "text-[#D4AF37]" : "text-foreground")} style={OSWALD}>{value}</span>
      <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
    </div>
  );
  const contractTotal = contracts.reduce((s, ct) => s + (ct.total_value ?? 0), 0);
  const openObligations = contracts.flatMap((ct) => ct.obligations).filter((o) => !o.fulfilled).length;

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

  // The tab bar sits under whichever header the tab uses: the hub's mirror
  // header on Overview/Financials/Player Development, or the scouting page's own
  // header on Projections/Season Stats (passed in as tabSlot so it renders right
  // beneath that header).
  const tabBar = (
    <div className="flex gap-1 overflow-x-auto border-b border-border/60">
      {TABS.map((t) => (
        <button key={t.key} onClick={() => setTab(t.key)}
          className={cn("flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            tab === t.key ? "border-[#D4AF37] text-[#D4AF37]" : "border-transparent text-muted-foreground hover:text-foreground")}>
          <t.icon className="h-4 w-4" /> {t.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header — mirrors the scouting profile's style (name + badges, one back
          button). Hidden on Projections/Season Stats (own scouting header) and on
          Overview (its cover-photo hero carries the name). */}
      {!embedsOwnHeader && tab !== "overview" && (
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-bold tracking-tight">{name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {showPosition && position && <Badge variant="secondary">{position}</Badge>}
              {classYr && <Badge variant="outline">{classYr}</Badge>}
              <Badge variant="outline" className="text-muted-foreground">{isPitcher ? "Pitcher" : "Position player"}</Badge>
              {row && <Badge variant="outline" className={cn("font-semibold", row.finalized ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500" : "border-amber-500/40 bg-amber-500/10 text-amber-500")}>{row.finalized ? "Finalized" : "Draft"}</Badge>}
              {c && c.total > 0 && <Badge variant="outline" className="border-[#D4AF37]/40 bg-[#D4AF37]/10 font-semibold text-[#D4AF37]">{money(c.total)}</Badge>}
            </div>
          </div>
        </div>
      )}

        {/* Overview has its OWN cover-photo hero above the tabs (name-only — the
            details live in the Roster Assignment card below). Every other tab uses
            the mirror header. */}
        {tab === "overview" && (
          <>
            <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back</button>
            <Card className="overflow-hidden border-border/60">
              <div className="flex h-20 items-center justify-center bg-[#070e1f] px-5">
                {logoUrl ? <img src={logoUrl} alt="" className="h-10 w-auto opacity-90" /> : <span className="text-sm font-semibold tracking-widest text-[#D4AF37]/70" style={OSWALD}>RSTR IQ</span>}
              </div>
              <div className="flex flex-wrap items-end gap-x-5 gap-y-3 px-5 pb-4">
                <div className="-mt-10 flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#D4AF37]/15 ring-4 ring-background">
                  {headshotUrl ? <img src={headshotUrl} alt={name} className="h-full w-full object-cover" /> : <span className="text-2xl font-bold text-[#D4AF37]" style={OSWALD}>{(name[0] || "?").toUpperCase()}</span>}
                </div>
                <div className="min-w-0 flex-1 pt-2">
                  <h1 className="text-2xl font-bold tracking-tight">{name}</h1>
                </div>
                <div className="flex flex-wrap items-stretch divide-x divide-border/50 rounded-lg border border-border/50">
                  {statBox("WAR", num(row?.war))}
                  {statBox("Market Value", money(row?.market_value))}
                  {statBox("Total Pay", money(c?.total ?? null), true)}
                  {statBox("Value vs Pay", c && c.total > 0 && row?.market_value != null ? `${(row.market_value / c.total).toFixed(2)}×` : "—")}
                </div>
              </div>
            </Card>
          </>
        )}

        {/* Tab bar — under the mirror header (other tabs) or the Overview hero;
            on Projections/Season Stats it's slotted under the scouting header. */}
        {!embedsOwnHeader && tabBar}

        {/* Tab content */}
        {tab === "overview" && (
          <div className="space-y-4">
            {/* Compensation + Roster assignment */}
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="border-border/60">
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>Compensation</h3>
                    <button onClick={() => setTab("financials")} className="text-[11px] text-muted-foreground hover:text-foreground">Financials →</button>
                  </div>
                  {c ? (
                    <div className="space-y-1.5">
                      {kv("Revenue Share", money(c.rev))}
                      {kv("NIL", money(c.nil))}
                      {kv("Other", money(c.other))}
                      <div className="flex items-center justify-between border-t border-border/50 pt-1.5">
                        <span className="text-xs font-semibold">Total Pay</span>
                        <span className="font-mono text-sm font-bold text-[#D4AF37]">{money(c.total)}</span>
                      </div>
                    </div>
                  ) : <p className="text-xs text-muted-foreground">No compensation set on the live roster build.</p>}
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>Roster Assignment</h3>
                    <span className="text-[10px] italic text-muted-foreground">from live build</span>
                  </div>
                  <div className="space-y-1.5">
                    {kv("Position", position ?? "—")}
                    {kv("Class", classYr ?? "—")}
                    {kv("Role", (row?.depth_role && ROLE_LABEL[row.depth_role]) ?? "—")}
                    {kv("Dev Aggressiveness", row ? String(row.dev_aggressiveness) : "—")}
                    {kv("Status", row?.finalized ? "Finalized" : "Draft", true)}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Contracts & obligations summary */}
            <button onClick={() => setTab("financials")} className="flex w-full items-center gap-3 rounded-lg border border-border/60 p-3 text-left transition-colors hover:border-[#D4AF37]/50 hover:bg-muted/30">
              <FileText className="h-5 w-5 shrink-0 text-[#D4AF37]" />
              <div className="min-w-0 flex-1 text-sm">
                {contracts.length > 0 ? (
                  <><span className="font-semibold">{contracts.length} contract{contracts.length > 1 ? "s" : ""}</span> on file · {money(contractTotal)} total{openObligations > 0 && <> · <span className="text-amber-400">{openObligations} open obligation{openObligations > 1 ? "s" : ""}</span></>}</>
                ) : <span className="text-muted-foreground">No contracts on file — add one on Financials.</span>}
              </div>
              <span className="shrink-0 text-[11px] text-muted-foreground">Financials →</span>
            </button>

            {/* Quick jump to the deeper tabs */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { t: "projections" as TabKey, label: "Projections", desc: "Projected line & value", icon: LineChart },
                { t: "stats" as TabKey, label: "Season Stats", desc: "This season's numbers", icon: BarChart3 },
                { t: "financials" as TabKey, label: "Financials", desc: "Comp, contracts & obligations", icon: DollarSign },
                { t: "development" as TabKey, label: "Player Development", desc: "NewtForce & biomechanics", icon: ClipboardList },
              ].map((q) => (
                <button key={q.t} onClick={() => setTab(q.t)} className="flex items-center gap-3 rounded-lg border border-border/60 p-3 text-left transition-colors hover:border-[#D4AF37]/50 hover:bg-muted/30">
                  <q.icon className="h-5 w-5 shrink-0 text-[#D4AF37]" />
                  <div className="min-w-0"><div className="truncate text-sm font-semibold">{q.label}</div><div className="truncate text-[11px] text-muted-foreground">{q.desc}</div></div>
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === "projections" && (
          <Suspense fallback={<div className="py-16 text-center text-sm text-muted-foreground">Loading projections…</div>}>
            {isPitcher
              ? <PitcherProfile embedded hideTabs tabSlot={tabBar} idOverride={playerId} warOverride={row ? row.war : undefined} marketOverride={row ? row.market_value : undefined} devAggOverride={row ? row.dev_aggressiveness : undefined} roleOverride={row ? row.depth_role : undefined} />
              : <PlayerProfile embedded hideTabs tabSlot={tabBar} idOverride={playerId} warOverride={row ? row.war : undefined} marketOverride={row ? row.market_value : undefined} devAggOverride={row ? row.dev_aggressiveness : undefined} roleOverride={row ? row.depth_role : undefined} />}
          </Suspense>
        )}

        {tab === "stats" && (
          <Suspense fallback={<div className="py-16 text-center text-sm text-muted-foreground">Loading stats…</div>}>
            {isPitcher
              ? <PitcherStatsPage embedded hideTabs tabSlot={tabBar} idOverride={playerId} />
              : <PlayerStatsPage embedded hideTabs tabSlot={tabBar} idOverride={playerId} />}
          </Suspense>
        )}

        {tab === "financials" && <PlayerFinancials playerName={name} playerId={playerId} />}

        {tab === "development" && <PlayerDevelopment />}
      </div>
  );
}
