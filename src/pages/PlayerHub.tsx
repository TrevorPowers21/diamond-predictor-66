import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useGmRoster, type GmRow } from "@/gm/hooks/useGmRoster";
import { getPositionValueMultiplier } from "@/lib/nilProgramSpecific";
import { useGmPlayerInfo } from "@/gm/hooks/useGmPlayerInfo";
import { defaultDraftYear, defaultEligibilityRemaining } from "@/gm/lib/playerEligibility";
import { CURRENT_SEASON, PROJECTION_SEASON } from "@/lib/seasonConstants";
import { useMarketability } from "@/gm/hooks/useMarketability";
import { usePlayerHubPreview } from "@/hooks/usePlayerHubPreview";
import { ScoutGrade } from "@/components/ScoutGrade";
import { useGmProgramMarketability } from "@/gm/hooks/useGmProgramMarketability";
import { marketabilityTierColor } from "@/gm/lib/marketability";
import MarketabilityDialog from "@/gm/components/MarketabilityDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import PlayerInfoDialog from "@/gm/components/PlayerInfoDialog";
import PlayerFinancials, { playerComp } from "@/gm/components/PlayerFinancials";
import { isPitcherProfile } from "@/lib/profileRoutes";
import { useEffectiveSchool } from "@/hooks/useEffectiveSchool";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowLeft, LineChart, BarChart3, DollarSign, Activity, Bone, LayoutDashboard, ClipboardList, MoreHorizontal } from "lucide-react";

// Depth/pitcher role → display label (both hitter and pitcher roles).
const ROLE_LABEL: Record<string, string> = {
  cornerstone: "Cornerstone", everyday_starter: "Everyday Starter", platoon_starter: "Platoon Starter", utility: "Utility", bench: "Bench",
  weekend_starter: "Weekend Starter", weekday_starter: "Weekday Starter", swing_starter: "Swing Starter",
  workhorse_reliever: "Workhorse Reliever", high_leverage_reliever: "High-Leverage Reliever", mid_leverage_reliever: "Mid-Leverage Reliever",
  low_impact_reliever: "Low-Impact Reliever", specialist_reliever: "Specialist Reliever",
};
// Role badge color by value tier: cornerstone (gold) → anchor/high-leverage
// (emerald) → rotation/mid (sky) → depth (slate).
const ROLE_COLOR: Record<string, string> = {
  cornerstone: "border-[#D4AF37]/40 bg-[#D4AF37]/10 text-[#D4AF37]",
  everyday_starter: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  weekend_starter: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  workhorse_reliever: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  high_leverage_reliever: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  platoon_starter: "border-sky-500/40 bg-sky-500/10 text-sky-400",
  utility: "border-sky-500/40 bg-sky-500/10 text-sky-400",
  weekday_starter: "border-sky-500/40 bg-sky-500/10 text-sky-400",
  swing_starter: "border-sky-500/40 bg-sky-500/10 text-sky-400",
  mid_leverage_reliever: "border-sky-500/40 bg-sky-500/10 text-sky-400",
  bench: "border-slate-500/40 bg-slate-500/10 text-slate-400",
  low_impact_reliever: "border-slate-500/40 bg-slate-500/10 text-slate-400",
  specialist_reliever: "border-slate-500/40 bg-slate-500/10 text-slate-400",
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

// Cover branding — crossfades the team logo ↔ team name every ~7s. Falls back to
// a static logo/name when reduced-motion is on or one of the two is missing.
function CoverBrand({ teamName, logoUrl }: { teamName: string | null; logoUrl: string | null }) {
  const reduce = useReducedMotion();
  const [showLogo, setShowLogo] = useState(true);
  const canRotate = !!teamName && !!logoUrl && !reduce;
  useEffect(() => {
    if (!canRotate) return;
    const id = setInterval(() => setShowLogo((s) => !s), 7000);
    return () => clearInterval(id);
  }, [canRotate]);
  const showingLogo = !teamName || (showLogo && !!logoUrl);
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={showingLogo ? "logo" : "name"}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.45, ease: "easeInOut" }}
        className="flex items-center justify-center"
      >
        {showingLogo && logoUrl
          ? <img src={logoUrl} alt="" className="h-10 w-auto drop-shadow-[0_1px_3px_rgba(0,0,0,0.4)]" />
          : <span className="text-lg font-bold uppercase tracking-[0.14em] text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.5)]" style={OSWALD}>{teamName ?? "RSTR IQ"}</span>}
      </motion.div>
    </AnimatePresence>
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
  // Draft board: if the player is on the industry draft board we import
  // (player_slot_values), its draft_year overrides the class/age-computed
  // eligibility. Most recent cycle wins. Null when the player isn't ranked.
  const { data: slotDraftYear } = useQuery({
    queryKey: ["player-hub-slot-draft-year", playerId],
    enabled: !!playerId,
    queryFn: async () => {
      const { data } = await (supabase as any).from("player_slot_values")
        .select("draft_year").eq("player_id", playerId)
        .order("draft_year", { ascending: false }).limit(1).maybeSingle();
      return (data?.draft_year ?? null) as number | null;
    },
  });
  const { logoUrl, schoolName, branding } = useEffectiveSchool();
  const headshotUrl: string | null = dbPlayer?.headshot_url ?? null;
  // Team-colored cover (full "Arkansas Razorbacks" name + team palette). Branding
  // is sparse on staging → falls back to the brand navy. Richer on prod.
  const fullTeamName = branding ? `${branding.displayName} ${branding.mascot}` : schoolName;
  const coverStyle = branding
    ? { background: `linear-gradient(135deg, ${branding.primaryColor} 0%, ${branding.secondaryColor} 100%)` }
    : undefined;

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
  const schMode = gm.budget?.scholarship_mode ?? "pct";
  const schDisplay = row?.scholarship_amount == null ? "—" : (schMode === "dollar" ? money(row.scholarship_amount) : `${Math.round(row.scholarship_amount)}%`);
  // Projected Value = the roster's budget-share (position-weighted WAR / roster
  // total × budget), falling back to stored market value when there's no budget.
  const posWeightedWar = (r: GmRow) => Number(r.war ?? 0) * getPositionValueMultiplier(r.position);
  const rosterScore = [...gm.hitters, ...gm.pitchers].reduce((s, r) => s + posWeightedWar(r), 0);
  const projValue = (() => {
    if (!row) return null;
    const budget = gm.coachTotalBudget ?? 0;
    if (budget <= 0) return null;
    const denom = Math.max(rosterScore, 33);
    return denom > 0 ? Math.max(0, (posWeightedWar(row) / denom) * budget) : null;
  })();
  const displayValue = projValue ?? row?.market_value ?? null;
  const liveBuildName = gm.builds.find((b) => b.id === gm.liveBuildId)?.name ?? null;

  // Program-owned player info (layers over the scraped record) + derived defaults.
  const { info: playerInfo, save: savePlayerInfo, isSaving: savingInfo } = useGmPlayerInfo(playerId);
  const { tier: programTier, save: saveProgramTier } = useGmProgramMarketability();
  const [infoOpen, setInfoOpen] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [savingMarket, setSavingMarket] = useState(false);
  // Marketability questionnaire saves two stores at once: per-player social +
  // connection (gm_player_info) and the program-wide community tier.
  const saveMarketability = async (playerPatch: Parameters<typeof savePlayerInfo>[0], tier: number | null, onDone?: () => void) => {
    setSavingMarket(true);
    try {
      await saveProgramTier(tier);
      savePlayerInfo(playerPatch, onDone);
    } finally {
      setSavingMarket(false);
    }
  };
  // classYr above is the PROJECTED (next-season) class shown in "Class". Draft
  // eligibility is a real-world fact tied to the player's CURRENT class + season
  // (a sophomore now → junior year 2027 → draft 2027; earlier only via age/DOB).
  const currentClass = row?.class_year ?? dbPlayer?.class_year ?? classYr;
  // Precedence: a coach's manual year wins; else the draft board (player_slot_values);
  // else the class/age default.
  const draftYear = playerInfo?.draft_eligible_year ?? slotDraftYear ?? defaultDraftYear(currentClass, playerInfo?.dob, CURRENT_SEASON);
  const onDraftBoard = slotDraftYear != null;
  const eligRemaining = playerInfo?.eligibility_remaining ?? defaultEligibilityRemaining(classYr);

  // Marketability: one 0–100 composite (program + social + connection + draft).
  // Overview shows the score; the Financials tab carries the full scorecard.
  const marketBreakdown = useMarketability(playerId).breakdown;
  const { projection, season, hitterAdvanced } = usePlayerHubPreview(playerId, dbPlayer?.source_player_id ?? null);
  // Baseball-style rate: ".312" not "0.312".
  const rate = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(3).replace(/^0(?=\.)/, ""));
  // Scale the stored projection from the dev-agg it was computed with to the
  // live build's dev-agg (production_notes) — mirrors PlayerProfile's applyDevScale
  // so the card matches the Projections tab.
  const devAggScale = (() => {
    if (!projection) return 1;
    const ct = String(projection.class_transition || "SJ").toUpperCase();
    const classAdj = ct === "FS" ? 0.03 : ct === "JS" ? 0.015 : ct === "GR" ? 0.01 : 0.02;
    const stored = Number.isFinite(Number(projection.dev_aggressiveness)) ? Number(projection.dev_aggressiveness) : 0;
    const build = row?.dev_aggressiveness ?? 0;
    const storedMult = 1 + classAdj + stored * 0.06;
    return storedMult > 0 ? (1 + classAdj + build * 0.06) / storedMult : 1;
  })();
  const sc = (v: number | null | undefined) => (v == null ? null : v * devAggScale);

  const kv = (label: string, value: string, accent?: boolean) => (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-xs font-semibold", accent ? "font-mono text-[#D4AF37]" : "text-foreground")}>{value}</span>
    </div>
  );
  const statBox = (label: string, value: string, accent?: boolean, color?: string) => (
    <div className="flex flex-col items-center justify-center gap-0.5 px-4 py-1.5 text-center">
      <span
        className={cn("font-mono text-base font-bold leading-none tabular-nums", !color && (accent ? "text-[#D4AF37]" : "text-foreground"))}
        style={color ? { ...OSWALD, color } : OSWALD}
      >{value}</span>
      <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
    </div>
  );
  // A detail card (Compensation/Roster-Assignment styling) that routes to a tab.
  const tabCard = (t: TabKey, title: string, body: React.ReactNode) => (
    <Card onClick={() => setTab(t)} className="cursor-pointer border-border/60 transition-colors hover:border-[#D4AF37]/60 hover:bg-muted/10">
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>{title}</h3>
          <span className="text-[11px] text-muted-foreground">Open →</span>
        </div>
        {body}
      </CardContent>
    </Card>
  );
  const projBox = (label: string, value: string, accent?: boolean) => (
    <div className="flex min-h-[3.5rem] flex-col items-center justify-center gap-1 rounded-md border border-border/50 bg-muted/10 px-1 py-1.5 text-center">
      <span className={cn("font-mono text-base font-bold leading-none tabular-nums", accent ? "text-[#D4AF37]" : "text-foreground")} style={OSWALD}>{value}</span>
      <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
    </div>
  );

  // Projections/Season Stats embed the scouting pages, which carry their own
  // identity header — so the hub header only shows on the other tabs (and the
  // details it shows are trimmed to what's relevant, e.g. no position on money).
  const embedsOwnHeader = tab === "projections" || tab === "stats";

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
      {TABS.map((t) => {
        const disabled = t.key === "development"; // greyed until NewtForce/biomech is wired
        return (
          <button key={t.key} onClick={disabled ? undefined : () => setTab(t.key)} disabled={disabled}
            title={disabled ? "Coming soon" : undefined}
            className={cn("flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              disabled ? "cursor-not-allowed border-transparent text-muted-foreground/40"
                : tab === t.key ? "border-[#D4AF37] text-[#D4AF37]" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        );
      })}
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
              {classYr && <Badge variant="outline">{classYr}</Badge>}
              {position && <Badge variant="secondary">{position}</Badge>}
              {row?.depth_role && ROLE_LABEL[row.depth_role] && <Badge variant="outline" className={cn("font-semibold", ROLE_COLOR[row.depth_role] ?? "text-muted-foreground")}>{ROLE_LABEL[row.depth_role]}</Badge>}
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
              <div className={cn("flex h-20 items-center justify-center px-5", !branding && "bg-[#070e1f]")} style={coverStyle}>
                <CoverBrand teamName={fullTeamName} logoUrl={logoUrl} />
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4">
                <div className="-mt-12 flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#0d1a30] ring-4 ring-background">
                  {headshotUrl ? <img src={headshotUrl} alt={name} className="h-full w-full object-cover" /> : <span className="text-3xl font-bold text-[#D4AF37]" style={OSWALD}>{(name[0] || "?").toUpperCase()}</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h1 className="text-2xl font-bold leading-none tracking-tight">{name}</h1>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button title="Edit" className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-52">
                        <DropdownMenuItem onClick={() => setInfoOpen(true)}>Edit Player Information</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setMarketOpen(true)}>Edit Marketability</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                {/* Public stat strip — non-sensitive analytics only. Pay lives in
                    the Compensation card / Financials tab (gated later by role). */}
                <div className="flex flex-wrap items-stretch divide-x divide-border/50 rounded-lg border border-border/50">
                  {statBox("WAR", num(row?.war))}
                  {statBox("Projected Value", money(displayValue))}
                  {statBox("Marketability", marketBreakdown.tier, false, marketabilityTierColor(marketBreakdown.tier))}
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
            {/* Statistical cards up top — Projection + Statistical Profile, each clickable to its tab. */}
            <div className="grid gap-4 md:grid-cols-2">
              {tabCard("projections", `${PROJECTION_SEASON} Projection`, (
                isPitcher ? (
                  <div className="grid grid-cols-5 gap-1.5">
                    {projBox("ERA", num(projection?.p_era, 2))}
                    {projBox("FIP", num(projection?.p_fip, 2))}
                    {projBox("WHIP", num(projection?.p_whip, 2))}
                    {projBox("K/9", num(projection?.p_k9))}
                    {projBox("BB/9", num(projection?.p_bb9))}
                  </div>
                ) : (
                  <div className="grid grid-cols-5 gap-1.5">
                    {projBox("AVG", rate(sc(projection?.p_avg)))}
                    {projBox("OBP", rate(sc(projection?.p_obp)))}
                    {projBox("SLG", rate(sc(projection?.p_slg)))}
                    {projBox("OPS", rate(sc(projection?.p_ops)))}
                    {projBox("wRC+", projection?.p_wrc_plus != null ? String(Math.round(sc(projection.p_wrc_plus)!)) : "—", true)}
                  </div>
                )
              ))}
              {tabCard("stats", `${CURRENT_SEASON} Statistical Profile`, (
                isPitcher ? (
                  season ? (
                    <div className="space-y-1.5">
                      {kv("ERA", num(season.era, 2))}
                      {kv("IP", num(season.innings_pitched))}
                      {kv("K", num(season.pitch_strikeouts, 0))}
                      {kv("BB", num(season.pitch_walks, 0))}
                      {kv("WHIP", num(season.whip, 2))}
                    </div>
                  ) : <p className="text-xs text-muted-foreground">No {CURRENT_SEASON} stats on file yet.</p>
                ) : (
                  hitterAdvanced ? (
                    <div className="grid grid-cols-4 gap-1.5">
                      <ScoutGrade compact label="Brl" fullLabel="Barrel%" value={hitterAdvanced.barrel_score} rawStat={hitterAdvanced.barrel} unit="%" />
                      <ScoutGrade compact label="EV" fullLabel="Exit Velo" value={hitterAdvanced.avg_ev_score} rawStat={hitterAdvanced.avg_exit_velo} unit="mph" />
                      <ScoutGrade compact label="Con" fullLabel="Contact%" value={hitterAdvanced.contact_score} rawStat={hitterAdvanced.contact} unit="%" />
                      <ScoutGrade compact label="Chs" fullLabel="Chase%" value={hitterAdvanced.chase_score} rawStat={hitterAdvanced.chase} unit="%" />
                    </div>
                  ) : <p className="text-xs text-muted-foreground">No {CURRENT_SEASON} batted-ball data yet.</p>
                )
              ))}
            </div>

            {/* Compensation + Roster assignment */}
            <div className="grid gap-4 md:grid-cols-2">
              <Card onClick={() => setTab("financials")} className="cursor-pointer border-border/60 transition-colors hover:border-[#D4AF37]/60 hover:bg-muted/10">
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>Compensation</h3>
                    <span className="text-[11px] text-muted-foreground">Open →</span>
                  </div>
                  {c ? (
                    <div className="space-y-1.5">
                      {kv("Scholarship", schDisplay)}
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
                    <span className="text-[10px] italic text-muted-foreground">{liveBuildName ?? "live build"}</span>
                  </div>
                  <div className="space-y-1.5">
                    {kv("Position", position ?? "—")}
                    {kv("Class", classYr ?? "—")}
                    {kv("Role", (row?.depth_role && ROLE_LABEL[row.depth_role]) ?? "—")}
                    {kv("Eligibility Remaining", eligRemaining != null ? `${eligRemaining} yr${eligRemaining === 1 ? "" : "s"}` : "—")}
                    {kv("Draft Eligibility", draftYear != null ? String(draftYear) : "—", true)}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Player Development — greyed out until NewtForce/biomechanics is wired. */}
            <Card className="border-border/60 opacity-60">
              <CardContent className="flex items-center justify-between p-4">
                <h3 className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>Player Development</h3>
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Coming soon</span>
              </CardContent>
            </Card>
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

        {tab === "financials" && <PlayerFinancials playerName={name} playerId={playerId} onEditMarketability={() => setMarketOpen(true)} />}

        {tab === "development" && <PlayerDevelopment />}

        <PlayerInfoDialog
          open={infoOpen}
          onOpenChange={setInfoOpen}
          playerName={name}
          info={playerInfo}
          scraped={{
            bats: dbPlayer?.bats_hand ?? null,
            throws: dbPlayer?.throws_hand ?? null,
            height_inches: dbPlayer?.height_inches ?? null,
            weight_lbs: dbPlayer?.weight ?? null,
            hometown: dbPlayer?.hometown ?? dbPlayer?.home_state ?? null,
            high_school: dbPlayer?.high_school ?? null,
            contact_phone: dbPlayer?.contact_cell ?? null,
            contact_email: dbPlayer?.contact_email ?? null,
          }}
          draftYearDefault={slotDraftYear ?? defaultDraftYear(currentClass, playerInfo?.dob, CURRENT_SEASON)}
          eligRemainingDefault={defaultEligibilityRemaining(classYr)}
          onSave={savePlayerInfo}
          isSaving={savingInfo}
        />

        <MarketabilityDialog
          open={marketOpen}
          onOpenChange={setMarketOpen}
          playerName={name}
          info={playerInfo}
          programTier={programTier}
          onSave={saveMarketability}
          isSaving={savingMarket || savingInfo}
        />
      </div>
  );
}
