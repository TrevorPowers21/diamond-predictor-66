import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { loadGmBuildRoster } from "@/gm/lib/loadGmBuildRoster";
import type { GmRow } from "@/gm/hooks/useGmRoster";
import { useGmTargetBoard, type GmTarget } from "@/gm/hooks/useGmTargetBoard";
import { getPositionValueMultiplier } from "@/lib/nilProgramSpecific";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Crosshair, FlaskConical, GitCompareArrows, MinusCircle, Plus, PlusCircle, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";

const OSWALD = { fontFamily: "'Oswald', sans-serif" } as const;
const money = (v: number | null | undefined) => (v == null ? "—" : `$${Math.round(v).toLocaleString()}`);
const num = (v: number | null | undefined, d = 1) => (v == null ? "—" : Number(v).toFixed(d));

interface Loaded { rows: GmRow[]; coachTotalBudget: number | null; buildNotes: string | null }
/** One scenario's live totals, reported up so Compare can diff two panels. */
interface ScenarioReport { name: string; war: number; pay: number; headroom: number | null; count: number; projValue: number }

// A target board player, shaped as a hypothetical scenario roster row. WAR +
// market come straight from the precomputed team-scoped projection; pay starts
// at 0 (you set it). Ephemeral — never written.
function targetToRow(t: GmTarget): GmRow {
  return {
    player_id: t.player_id,
    build_player_id: `target:${t.player_id}`,
    name: t.name,
    position: t.position,
    class_year: null,
    is_pitcher: t.is_pitcher,
    war: t.war,
    market_value: t.market_value,
    nil_value: 0,
    scholarship_amount: null,
    rev_share: null,
    nil_amount: null,
    other_amount: null,
    actual_pay: null,
    finalized: false,
    eligibility_class: null,
    is_added_target: true,
  };
}

export default function GMScenarios() {
  const { user, effectiveTeamId, availableTeams } = useAuth();
  const teamName = availableTeams?.find((t) => t.id === effectiveTeamId)?.name ?? null;
  const [mode, setMode] = useState<"whatif" | "compare">("whatif");

  const { data: builds = [] } = useQuery({
    queryKey: ["gm-scenario-builds", effectiveTeamId ?? null],
    enabled: !!user?.id && !!effectiveTeamId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("team_builds")
        .select("id, name, is_default, archived, updated_at")
        .eq("customer_team_id", effectiveTeamId)
        .order("is_default", { ascending: false })
        .order("updated_at", { ascending: false });
      return (data || [])
        .filter((b: any) => !b.archived)
        .map((b: any) => ({ id: b.id as string, name: (b.is_default ? "Default Roster" : b.name) as string }));
    },
  });

  const first = builds[0]?.id ?? null;
  const second = builds.find((x) => x.id !== first)?.id ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold leading-tight" style={OSWALD}>The Situation Room</h2>
          <p className="text-sm text-muted-foreground">{teamName ? `${teamName} · what-if & build compare` : "Pick a team above."}</p>
        </div>
        <div className="flex rounded-md border border-border/60 p-0.5">
          {([["whatif", "What-If", FlaskConical], ["compare", "Compare", GitCompareArrows]] as const).map(([m, label, Icon]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors",
                mode === m ? "bg-[#D4AF37]/15 text-[#D4AF37]" : "text-muted-foreground hover:text-foreground",
              )}
              style={OSWALD}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      {mode === "whatif" ? (
        <ScenarioPanel variant="full" builds={builds} teamId={effectiveTeamId} userId={user?.id} defaultBuildId={first} />
      ) : (
        <CompareView builds={builds} teamId={effectiveTeamId} userId={user?.id} firstBuild={first} secondBuild={second} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Compare: two independent scenario sandboxes side by side, with a live A-vs-B
// bar on top. Each side can drop/add/re-price freely — "this SS vs that SS".
function CompareView({ builds, teamId, userId, firstBuild, secondBuild }: {
  builds: { id: string; name: string }[]; teamId: string | null; userId: string | undefined; firstBuild: string | null; secondBuild: string | null;
}) {
  const [repA, setRepA] = useState<ScenarioReport | null>(null);
  const [repB, setRepB] = useState<ScenarioReport | null>(null);

  const metric = (label: string, va: number | null, vb: number | null, fmt: (n: number | null) => string, goodWhenPositive: boolean) => {
    const d = va != null && vb != null ? vb - va : null;
    const tone = d == null || Math.abs(d) < 1e-9 ? "text-muted-foreground" : (d > 0) === goodWhenPositive ? "text-emerald-500" : "text-red-500";
    return (
      <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] items-center gap-2 py-1.5 border-b border-border/40 last:border-0">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" style={OSWALD}>{label}</span>
        <span className="text-right font-mono text-sm tabular-nums text-foreground">{fmt(va)}</span>
        <span className="text-right font-mono text-sm tabular-nums text-foreground">{fmt(vb)}</span>
        <span className={cn("text-right font-mono text-xs tabular-nums", tone)}>{d == null || Math.abs(d) < 1e-9 ? "—" : `${d > 0 ? "+" : ""}${fmt(d)}`}</span>
      </div>
    );
  };
  const perWin = (r: ScenarioReport | null) => (r && r.war > 0.05 ? r.pay / r.war : null);

  return (
    <div className="space-y-4">
      {repA && repB && (
        <Card className="border-[#D4AF37]/40 bg-[#D4AF37]/[0.04]">
          <CardHeader className="pb-2 pt-3 px-4 border-b border-border/40">
            <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] items-center gap-2">
              <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>Head to Head</CardTitle>
              <span className="truncate text-right text-[11px] font-semibold uppercase tracking-wider text-foreground/80" style={OSWALD}>{repA.name}</span>
              <span className="truncate text-right text-[11px] font-semibold uppercase tracking-wider text-foreground/80" style={OSWALD}>{repB.name}</span>
              <span className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" style={OSWALD}>B − A</span>
            </div>
          </CardHeader>
          <CardContent className="px-4 py-1">
            {metric("Total WAR", repA.war, repB.war, (n) => num(n), true)}
            {metric("Committed Pay", repA.pay, repB.pay, (n) => money(n), false)}
            {metric("Budget Headroom", repA.headroom, repB.headroom, (n) => money(n), true)}
            {metric("$ / Win", perWin(repA), perWin(repB), (n) => money(n), false)}
            {metric("Roster", repA.count, repB.count, (n) => (n == null ? "—" : String(n)), true)}
          </CardContent>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <ScenarioPanel variant="column" builds={builds} teamId={teamId} userId={userId} defaultBuildId={firstBuild} onReport={setRepA} />
        <ScenarioPanel variant="column" builds={builds} teamId={teamId} userId={userId} defaultBuildId={secondBuild} onReport={setRepB} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// A self-contained scenario sandbox for ONE build: pick a build, drop players,
// add targets, re-price, flex the budget. Renders full-width (What-If) or as a
// compare column. Reports its live totals up via onReport.
function ScenarioPanel({ variant, builds, teamId, userId, defaultBuildId, onReport }: {
  variant: "full" | "column"; builds: { id: string; name: string }[]; teamId: string | null; userId: string | undefined; defaultBuildId: string | null; onReport?: (r: ScenarioReport) => void;
}) {
  const [pickedBuild, setPickedBuild] = useState<string | null>(null);
  const buildId = pickedBuild ?? defaultBuildId;
  const buildName = builds.find((b) => b.id === buildId)?.name ?? "—";

  const { data: roster, isLoading } = useQuery({
    queryKey: ["gm-scenario-roster", teamId ?? null, buildId],
    enabled: !!userId && !!teamId && !!buildId,
    queryFn: async (): Promise<Loaded> => loadGmBuildRoster(buildId!, teamId!),
  });

  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [payOverride, setPayOverride] = useState<Record<string, number>>({});
  const [budgetOverride, setBudgetOverride] = useState<number | null>(null);
  const [addedTargets, setAddedTargets] = useState<GmRow[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [resetNonce, setResetNonce] = useState(0);
  const toggle = (id: string) => setExcluded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const setPay = (id: string, v: number | null) => setPayOverride((prev) => { const n = { ...prev }; if (v == null) delete n[id]; else n[id] = v; return n; });
  const addTarget = (t: GmTarget) => setAddedTargets((prev) => (prev.some((r) => r.player_id === t.player_id) ? prev : [...prev, targetToRow(t)]));
  const removeTarget = (playerId: string) => setAddedTargets((prev) => prev.filter((r) => r.player_id !== playerId));
  const reset = () => { setExcluded(new Set()); setPayOverride({}); setBudgetOverride(null); setAddedTargets([]); setResetNonce((n) => n + 1); };
  const pickBuild = (id: string) => { setPickedBuild(id); reset(); };

  const buildRows = roster?.rows ?? [];
  const onBuild = new Set(buildRows.map((r) => r.player_id).filter(Boolean));
  const rows = [...buildRows, ...addedTargets.filter((t) => !onBuild.has(t.player_id))];
  const baseBudget = roster?.coachTotalBudget ?? null;
  const budget = budgetOverride ?? baseBudget;
  const payOf = (r: GmRow) => (r.build_player_id in payOverride ? payOverride[r.build_player_id] : (r.nil_value ?? 0));
  const kept = rows.filter((r) => !excluded.has(r.build_player_id));

  const posWeightedWar = (r: GmRow) => Number(r.war ?? 0) * getPositionValueMultiplier(r.position);
  const rosterScore = kept.reduce((s, r) => s + posWeightedWar(r), 0);
  const projValue = (r: GmRow): number | null => {
    if (budget == null || budget <= 0) return null;
    return Math.max(0, (posWeightedWar(r) / Math.max(rosterScore, 33)) * budget);
  };

  const baseWar = buildRows.reduce((s, r) => s + (r.war ?? 0), 0);
  const basePay = buildRows.reduce((s, r) => s + (r.nil_value ?? 0), 0);
  const baseHeadroom = baseBudget != null ? baseBudget - basePay : null;
  const scenWar = kept.reduce((s, r) => s + (r.war ?? 0), 0);
  const scenPay = kept.reduce((s, r) => s + payOf(r), 0);
  const scenHeadroom = budget != null ? budget - scenPay : null;
  const scenProj = kept.reduce((s, r) => s + (projValue(r) ?? 0), 0);
  const dWar = scenWar - baseWar;
  const dPay = scenPay - basePay;
  const dRoom = scenHeadroom != null && baseHeadroom != null ? scenHeadroom - baseHeadroom : null;
  const dBudget = budget != null && baseBudget != null ? budget - baseBudget : null;
  const dropped = rows.length - kept.length;
  const added = rows.length - buildRows.length;
  const repriced = Object.keys(payOverride).length;
  const changed = dropped > 0 || added > 0 || repriced > 0 || (dBudget != null && Math.abs(dBudget) > 1e-9);

  const hitters = useMemo(() => rows.filter((r) => !r.is_pitcher).sort((x, y) => (y.war ?? -Infinity) - (x.war ?? -Infinity)), [rows]);
  const pitchers = useMemo(() => rows.filter((r) => r.is_pitcher).sort((x, y) => (y.war ?? -Infinity) - (x.war ?? -Infinity)), [rows]);

  // Report live totals up (Compare header). Not dependent on onReport identity.
  useEffect(() => {
    onReport?.({ name: buildName, war: scenWar, pay: scenPay, headroom: scenHeadroom, count: kept.length, projValue: scenProj });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildName, scenWar, scenPay, scenHeadroom, kept.length, scenProj]);

  const col = variant === "column";

  return (
    <Card className={cn(col && "border-border/60")}>
      {col && (
        <CardHeader className="pb-2 pt-3 px-4 border-b border-border/40">
          <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>{buildName}</CardTitle>
        </CardHeader>
      )}
      <CardContent className={cn(col ? "space-y-3 p-3" : "space-y-4 p-0")}>
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <BuildPicker label={col ? "" : "Build"} value={buildId} onChange={pickBuild} builds={builds} />
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setPickerOpen(true)}>
            <Crosshair className="h-3.5 w-3.5" /> Add from Target Board
          </Button>
          {changed && <Button variant="ghost" size="sm" className="ml-auto h-7 gap-1.5 text-xs" onClick={reset}><RotateCcw className="h-3 w-3" /> Reset</Button>}
        </div>

        {/* Live totals + editable budget */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-md border border-[#D4AF37]/40 bg-[#D4AF37]/[0.05] p-3">
          <StatCell label="Total WAR" value={num(scenWar)} delta={dWar} goodWhenPositive={true} deltaText={`${dWar >= 0 ? "+" : ""}${num(dWar)}`} />
          <div className="flex flex-col">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground" style={OSWALD}>Total Budget</span>
            {baseBudget == null ? (
              <span className="font-mono text-lg font-semibold tabular-nums text-muted-foreground">—</span>
            ) : (
              <EditableMoney key={`budget:${resetNonce}`} value={budget ?? 0} edited={dBudget != null && Math.abs(dBudget) > 1e-9} onCommit={(n) => setBudgetOverride(n)} big />
            )}
            {dBudget != null && Math.abs(dBudget) > 1e-9 && <span className={cn("font-mono text-[11px] tabular-nums", dBudget > 0 ? "text-emerald-500" : "text-red-500")}>{dBudget >= 0 ? "+" : ""}{money(dBudget)}</span>}
          </div>
          <StatCell label="Committed Pay" value={money(scenPay)} delta={dPay} goodWhenPositive={false} deltaText={`${dPay > 0 ? "+" : ""}${money(dPay)}`} />
          {scenHeadroom != null && <StatCell label="Headroom" value={money(scenHeadroom)} delta={dRoom} goodWhenPositive={true} deltaText={dRoom != null ? `${dRoom >= 0 ? "+" : ""}${money(dRoom)}` : undefined} />}
          <StatCell label="Roster" value={`${kept.length}`} delta={dropped > 0 ? -dropped : null} goodWhenPositive={true} deltaText={`−${dropped}`} />
          {!col && <span className="ml-auto text-[11px] text-muted-foreground">{!changed ? "Drop players, add targets, edit pay, or set the budget. Nothing is saved." : `${[added ? `${added} added` : "", dropped ? `${dropped} dropped` : "", repriced ? `${repriced} repriced` : "", dBudget && Math.abs(dBudget) > 1e-9 ? "budget set" : ""].filter(Boolean).join(" · ")} · nothing saved`}</span>}
        </div>

        {isLoading ? <p className="text-sm text-muted-foreground">Loading roster…</p> : (
          <div className={cn("grid gap-4", col ? "grid-cols-1" : "lg:grid-cols-2")}>
            <ScenarioList title="Position Players" rows={hitters} excluded={excluded} onToggle={toggle} payOf={payOf} projValue={projValue} onPay={setPay} onRemoveTarget={removeTarget} resetNonce={resetNonce} />
            <ScenarioList title="Pitchers" rows={pitchers} excluded={excluded} onToggle={toggle} payOf={payOf} projValue={projValue} onPay={setPay} onRemoveTarget={removeTarget} resetNonce={resetNonce} />
          </div>
        )}
      </CardContent>

      <TargetPicker open={pickerOpen} onOpenChange={setPickerOpen} addedIds={new Set(addedTargets.map((r) => r.player_id!))} onAdd={addTarget} />
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function TargetPicker({ open, onOpenChange, addedIds, onAdd }: { open: boolean; onOpenChange: (o: boolean) => void; addedIds: Set<string>; onAdd: (t: GmTarget) => void }) {
  const { targets, isLoading } = useGmTargetBoard();
  const [q, setQ] = useState("");
  const filtered = targets.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()) || (t.position ?? "").toLowerCase().includes(q.toLowerCase()) || (t.team ?? "").toLowerCase().includes(q.toLowerCase()));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle style={OSWALD}>Add from Target Board</DialogTitle></DialogHeader>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search targets…" className="h-9 text-sm" />
        <div className="max-h-[55vh] space-y-1 overflow-y-auto">
          {isLoading ? <p className="py-6 text-center text-xs text-muted-foreground">Loading targets…</p>
            : filtered.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">{targets.length === 0 ? "No targets on the board yet." : "No matches."}</p>
            : filtered.map((t) => {
              const added = addedIds.has(t.player_id);
              return (
                <div key={t.player_id} className="flex items-center gap-2 rounded-md border border-border/50 px-2.5 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{t.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{[t.position, t.team].filter(Boolean).join(" · ") || "—"}</div>
                  </div>
                  <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-foreground">{num(t.war)}</span>
                  <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">{money(t.market_value)}</span>
                  <Button variant={added ? "ghost" : "outline"} size="sm" className="h-7 shrink-0 gap-1 text-xs" disabled={added} onClick={() => onAdd(t)}>
                    {added ? "Added" : <><Plus className="h-3 w-3" /> Add</>}
                  </Button>
                </div>
              );
            })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BuildPicker({ value, onChange, builds, label }: { value: string | null; onChange: (id: string) => void; builds: { id: string; name: string }[]; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" style={OSWALD}>{label}</span>}
      <Select value={value ?? undefined} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue placeholder="Select build" /></SelectTrigger>
        <SelectContent>{builds.map((bd) => <SelectItem key={bd.id} value={bd.id} className="text-xs">{bd.name}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

function StatCell({ label, value, delta, goodWhenPositive, deltaText }: { label: string; value: string; delta?: number | null; goodWhenPositive?: boolean; deltaText?: string }) {
  const show = delta != null && Math.abs(delta) > 1e-9;
  const tone = !show ? "text-muted-foreground" : (delta! > 0) === goodWhenPositive ? "text-emerald-500" : "text-red-500";
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground" style={OSWALD}>{label}</span>
      <span className="font-mono text-lg font-semibold tabular-nums text-foreground">{value}</span>
      {show && <span className={cn("font-mono text-[11px] tabular-nums", tone)}>{deltaText}</span>}
    </div>
  );
}

// Inline pay/budget editor. Owns its text state; remounts on resetNonce so Reset
// reseeds it. Commits a number (or null → revert to the real value) on blur/Enter.
function EditableMoney({ value, edited, onCommit, big }: { value: number; edited: boolean; onCommit: (n: number | null) => void; big?: boolean }) {
  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const [v, setV] = useState(fmt(value));
  return (
    <input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onFocus={(e) => { setV(String(Math.round(value))); requestAnimationFrame(() => e.target.select()); }}
      onBlur={() => {
        const t = v.replace(/[^0-9.]/g, "");
        if (t === "") { onCommit(null); setV(fmt(value)); return; }
        const n = Number(t);
        if (Number.isNaN(n)) { setV(fmt(value)); return; }
        onCommit(n);
        setV(fmt(n));
      }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      inputMode="numeric"
      title="Edit for this scenario (not saved)"
      className={cn(
        "shrink-0 rounded border bg-muted/40 text-right font-mono tabular-nums outline-none transition-colors hover:border-[#D4AF37]/50 focus:border-[#D4AF37] focus:bg-background focus:ring-1 focus:ring-[#D4AF37]/30",
        big ? "w-32 px-2 py-1 text-lg font-semibold" : "w-24 px-2 py-1 text-xs",
        edited ? "border-[#D4AF37]/60 text-[#D4AF37]" : "border-border text-foreground",
      )}
    />
  );
}

function ScenarioList({ title, rows, excluded, onToggle, payOf, projValue, onPay, onRemoveTarget, resetNonce }: { title: string; rows: GmRow[]; excluded: Set<string>; onToggle: (id: string) => void; payOf: (r: GmRow) => number; projValue: (r: GmRow) => number | null; onPay: (id: string, v: number | null) => void; onRemoveTarget: (playerId: string) => void; resetNonce: number }) {
  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-4 border-b border-border/40">
        <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>{title} ({rows.length})</CardTitle>
      </CardHeader>
      <CardContent className="p-2">
        {rows.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">No players.</p> : (
          <>
            <div className="flex items-center gap-2 px-1.5 pb-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70" style={OSWALD}>
              <span className="h-6 w-6 shrink-0" />
              <span className="min-w-0 flex-1" />
              <span className="w-9 shrink-0 text-center">Pos</span>
              <span className="w-11 shrink-0 text-right">WAR</span>
              <span className="w-24 shrink-0 text-right">Proj Value</span>
              <span className="w-24 shrink-0 text-right pr-1.5">Actual Pay</span>
            </div>
            <div className="divide-y divide-border/40">
              {rows.map((r) => {
                const dropped = excluded.has(r.build_player_id);
                const edited = Math.round(payOf(r)) !== Math.round(r.nil_value ?? 0);
                return (
                  <div key={r.build_player_id} className={cn("flex items-center gap-2 py-1.5 px-1.5", dropped && "opacity-40", r.is_added_target && "bg-[#D4AF37]/[0.05]")}>
                    {r.is_added_target ? (
                      <button onClick={() => onRemoveTarget(r.player_id!)} title="Remove target" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground/40 transition-colors hover:bg-destructive/10 hover:text-destructive cursor-pointer">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <button onClick={() => onToggle(r.build_player_id)} title={dropped ? "Add back" : "Drop from scenario"} className={cn("inline-flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors cursor-pointer", dropped ? "text-[#D4AF37] hover:bg-[#D4AF37]/10" : "text-muted-foreground/40 hover:bg-amber-500/10 hover:text-amber-500")}>
                        {dropped ? <PlusCircle className="h-3.5 w-3.5" /> : <MinusCircle className="h-3.5 w-3.5" />}
                      </button>
                    )}
                    <span className={cn("min-w-0 flex-1 truncate text-sm font-medium", dropped && "line-through")}>
                      {r.name}
                      {r.is_added_target && <span className="ml-1.5 rounded bg-[#D4AF37]/15 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#D4AF37]" style={OSWALD}>Target</span>}
                    </span>
                    <span className="w-9 shrink-0 text-center text-[11px] font-semibold text-muted-foreground">{r.position || "—"}</span>
                    <span className="w-11 shrink-0 text-right font-mono text-xs tabular-nums text-foreground">{num(r.war)}</span>
                    <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums text-foreground/80">{money(projValue(r))}</span>
                    {dropped
                      ? <span className="w-24 shrink-0 pr-1.5 text-right font-mono text-xs tabular-nums text-muted-foreground">{money(payOf(r))}</span>
                      : <EditableMoney key={`${r.build_player_id}:${resetNonce}`} value={payOf(r)} edited={edited} onCommit={(n) => onPay(r.build_player_id, n)} />}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
