import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { loadGmBuildRoster } from "@/gm/lib/loadGmBuildRoster";
import type { GmRow } from "@/gm/hooks/useGmRoster";
import { getPositionValueMultiplier } from "@/lib/nilProgramSpecific";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FlaskConical, GitCompareArrows, MinusCircle, PlusCircle, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

const OSWALD = { fontFamily: "'Oswald', sans-serif" } as const;
const money = (v: number | null | undefined) => (v == null ? "—" : `$${Math.round(v).toLocaleString()}`);
const num = (v: number | null | undefined, d = 1) => (v == null ? "—" : Number(v).toFixed(d));

interface Loaded { rows: GmRow[]; coachTotalBudget: number | null; buildNotes: string | null }
interface Summary { war: number; pay: number; headroom: number | null; count: number }

const summarize = (rows: GmRow[], coachTotalBudget: number | null): Summary => {
  const war = rows.reduce((s, r) => s + (r.war ?? 0), 0);
  const pay = rows.reduce((s, r) => s + (r.nil_value ?? 0), 0);
  return { war, pay, headroom: coachTotalBudget != null ? coachTotalBudget - pay : null, count: rows.length };
};
// Stable identity across builds: real players by id, locals by name.
const rowKey = (r: GmRow) => r.player_id ?? `local:${r.name.toLowerCase()}`;

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

  const firstBuild = builds[0]?.id ?? null;
  const [buildA, setBuildA] = useState<string | null>(null);
  const [buildB, setBuildB] = useState<string | null>(null);
  const a = buildA ?? firstBuild;
  const b = buildB ?? builds.find((x) => x.id !== a)?.id ?? null;

  const qA = useQuery({
    queryKey: ["gm-scenario-roster", effectiveTeamId ?? null, a],
    enabled: !!user?.id && !!effectiveTeamId && !!a,
    queryFn: async (): Promise<Loaded> => loadGmBuildRoster(a!, effectiveTeamId!),
  });
  const qB = useQuery({
    queryKey: ["gm-scenario-roster", effectiveTeamId ?? null, b],
    enabled: !!user?.id && !!effectiveTeamId && !!b && mode === "compare",
    queryFn: async (): Promise<Loaded> => loadGmBuildRoster(b!, effectiveTeamId!),
  });

  const nameOf = (id: string | null) => builds.find((x) => x.id === id)?.name ?? "—";

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

      {mode === "whatif"
        ? <WhatIf roster={qA.data} loading={qA.isLoading} builds={builds} buildId={a} onPick={setBuildA} />
        : <Compare qA={qA.data} qB={qB.data} loadingA={qA.isLoading} loadingB={qB.isLoading} builds={builds} a={a} b={b} onPickA={setBuildA} onPickB={setBuildB} nameA={nameOf(a)} nameB={nameOf(b)} />}
    </div>
  );
}

function BuildPicker({ value, onChange, builds, label }: { value: string | null; onChange: (id: string) => void; builds: { id: string; name: string }[]; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" style={OSWALD}>{label}</span>
      <Select value={value ?? undefined} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-[220px] text-xs"><SelectValue placeholder="Select build" /></SelectTrigger>
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

// ─────────────────────────────────────────────────────────────────────────────
// What-If: one build, drop players, watch WAR + money move. Nothing is saved.
function WhatIf({ roster, loading, builds, buildId, onPick }: { roster: Loaded | undefined; loading: boolean; builds: { id: string; name: string }[]; buildId: string | null; onPick: (id: string) => void }) {
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  // Ephemeral pay overrides, keyed by build_player_id. Absent = use the real
  // nil_value. Nothing here is written to the DB.
  const [payOverride, setPayOverride] = useState<Record<string, number>>({});
  const [budgetOverride, setBudgetOverride] = useState<number | null>(null);
  const [resetNonce, setResetNonce] = useState(0);
  const toggle = (id: string) => setExcluded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const setPay = (id: string, v: number | null) =>
    setPayOverride((prev) => { const n = { ...prev }; if (v == null) delete n[id]; else n[id] = v; return n; });
  const reset = () => { setExcluded(new Set()); setPayOverride({}); setBudgetOverride(null); setResetNonce((n) => n + 1); };

  const rows = roster?.rows ?? [];
  const baseBudget = roster?.coachTotalBudget ?? null;
  const budget = budgetOverride ?? baseBudget; // scenario's total budget (editable)
  const payOf = (r: GmRow) => (r.build_player_id in payOverride ? payOverride[r.build_player_id] : (r.nil_value ?? 0));
  const kept = rows.filter((r) => !excluded.has(r.build_player_id));

  // Projected Value = budget-share (same model as Team Builder / Roster): a
  // player's position-weighted WAR as a share of the SCENARIO roster's total,
  // times the SCENARIO total budget. Editing the budget or dropping players
  // reflows every projected value. (33 floor mirrors RAW_WAR_BENCHMARK.)
  const posWeightedWar = (r: GmRow) => Number(r.war ?? 0) * getPositionValueMultiplier(r.position);
  const rosterScore = kept.reduce((s, r) => s + posWeightedWar(r), 0);
  const projValue = (r: GmRow): number | null => {
    if (budget == null || budget <= 0) return null;
    return Math.max(0, (posWeightedWar(r) / Math.max(rosterScore, 33)) * budget);
  };

  const base = summarize(rows, baseBudget);
  const scenWar = kept.reduce((s, r) => s + (r.war ?? 0), 0);
  const scenPay = kept.reduce((s, r) => s + payOf(r), 0);
  const scen: Summary = { war: scenWar, pay: scenPay, headroom: budget != null ? budget - scenPay : null, count: kept.length };
  const dWar = scen.war - base.war;
  const dPay = scen.pay - base.pay;
  const dRoom = scen.headroom != null && base.headroom != null ? scen.headroom - base.headroom : null;
  const dBudget = budget != null && baseBudget != null ? budget - baseBudget : null;
  const dropped = rows.length - kept.length;
  const repriced = Object.keys(payOverride).length;
  const changed = dropped > 0 || repriced > 0 || (dBudget != null && Math.abs(dBudget) > 1e-9);

  const hitters = useMemo(() => rows.filter((r) => !r.is_pitcher).sort((x, y) => (y.war ?? -Infinity) - (x.war ?? -Infinity)), [rows]);
  const pitchers = useMemo(() => rows.filter((r) => r.is_pitcher).sort((x, y) => (y.war ?? -Infinity) - (x.war ?? -Infinity)), [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BuildPicker label="Build" value={buildId} onChange={(id) => { onPick(id); reset(); }} builds={builds} />
        {changed && <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={reset}><RotateCcw className="h-3 w-3" /> Reset</Button>}
      </div>

      {/* Live delta strip */}
      <Card className="border-[#D4AF37]/40 bg-[#D4AF37]/[0.05]">
        <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 p-4">
          <StatCell label="Total WAR" value={num(scen.war)} delta={dWar} goodWhenPositive={true} deltaText={`${dWar >= 0 ? "+" : ""}${num(dWar)}`} />
          {/* Editable total budget — drives every Projected Value below. */}
          <div className="flex flex-col">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground" style={OSWALD}>Total Budget</span>
            {baseBudget == null ? (
              <span className="font-mono text-lg font-semibold tabular-nums text-muted-foreground">—</span>
            ) : (
              <EditableMoney key={`budget:${resetNonce}`} value={budget ?? 0} edited={dBudget != null && Math.abs(dBudget) > 1e-9} onCommit={(n) => setBudgetOverride(n)} big />
            )}
            {dBudget != null && Math.abs(dBudget) > 1e-9 && <span className={cn("font-mono text-[11px] tabular-nums", dBudget > 0 ? "text-emerald-500" : "text-red-500")}>{dBudget >= 0 ? "+" : ""}{money(dBudget)}</span>}
          </div>
          <StatCell label="Committed Pay" value={money(scen.pay)} delta={dPay} goodWhenPositive={false} deltaText={`${dPay > 0 ? "+" : ""}${money(dPay)}`} />
          {scen.headroom != null && <StatCell label="Budget Headroom" value={money(scen.headroom)} delta={dRoom} goodWhenPositive={true} deltaText={dRoom != null ? `${dRoom >= 0 ? "+" : ""}${money(dRoom)}` : undefined} />}
          <StatCell label="Roster" value={`${kept.length}`} delta={dropped > 0 ? -dropped : null} goodWhenPositive={true} deltaText={`−${dropped}`} />
          <span className="ml-auto text-[11px] text-muted-foreground">{!changed ? "Drop players, edit pay, or set the budget to test a change. Nothing is saved." : `${[dropped ? `${dropped} dropped` : "", repriced ? `${repriced} repriced` : "", dBudget && Math.abs(dBudget) > 1e-9 ? "budget set" : ""].filter(Boolean).join(" · ")} · nothing saved`}</span>
        </CardContent>
      </Card>

      {loading ? <p className="text-sm text-muted-foreground">Loading roster…</p> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <WhatIfList title="Position Players" rows={hitters} excluded={excluded} onToggle={toggle} payOf={payOf} projValue={projValue} onPay={setPay} resetNonce={resetNonce} />
          <WhatIfList title="Pitchers" rows={pitchers} excluded={excluded} onToggle={toggle} payOf={payOf} projValue={projValue} onPay={setPay} resetNonce={resetNonce} />
        </div>
      )}
    </div>
  );
}

// Inline pay editor. Owns its text state; remounts on resetNonce so Reset
// reseeds it. Commits a number (or null → revert to the real value) on blur/Enter.
function EditableMoney({ value, edited, onCommit, big }: { value: number; edited: boolean; onCommit: (n: number | null) => void; big?: boolean }) {
  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`; // $XXX,XXX
  const [v, setV] = useState(fmt(value));
  const [focused, setFocused] = useState(false);
  return (
    <input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onFocus={(e) => { setFocused(true); setV(String(Math.round(value))); requestAnimationFrame(() => e.target.select()); }}
      onBlur={() => {
        setFocused(false);
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
        "shrink-0 rounded border bg-transparent text-right font-mono tabular-nums outline-none transition-colors focus:border-[#D4AF37]",
        big ? "w-32 px-1.5 py-0.5 text-lg font-semibold" : "w-24 px-1.5 py-0.5 text-xs",
        focused && "border-[#D4AF37]",
        edited ? "border-[#D4AF37]/60 text-[#D4AF37]" : big ? "border-transparent text-foreground hover:border-border" : "border-transparent text-muted-foreground hover:border-border",
      )}
    />
  );
}

function WhatIfList({ title, rows, excluded, onToggle, payOf, projValue, onPay, resetNonce }: { title: string; rows: GmRow[]; excluded: Set<string>; onToggle: (id: string) => void; payOf: (r: GmRow) => number; projValue: (r: GmRow) => number | null; onPay: (id: string, v: number | null) => void; resetNonce: number }) {
  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-4 border-b border-border/40">
        <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>{title} ({rows.length})</CardTitle>
      </CardHeader>
      <CardContent className="p-2">
        {rows.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">No players.</p> : (
          <>
            {/* Column labels — two money columns now, so name them. */}
            <div className="flex items-center gap-2 px-1.5 pb-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70" style={OSWALD}>
              <span className="h-6 w-6 shrink-0" />
              <span className="min-w-0 flex-1" />
              <span className="w-10 shrink-0 text-center">Pos</span>
              <span className="w-12 shrink-0 text-right">WAR</span>
              <span className="w-24 shrink-0 text-right">Proj Value</span>
              <span className="w-24 shrink-0 text-right pr-1.5">Actual Pay</span>
            </div>
            <div className="divide-y divide-border/40">
              {rows.map((r) => {
                const dropped = excluded.has(r.build_player_id);
                const edited = Math.round(payOf(r)) !== Math.round(r.nil_value ?? 0);
                return (
                  <div key={r.build_player_id} className={cn("flex items-center gap-2 py-1.5 px-1.5", dropped && "opacity-40")}>
                    <button
                      onClick={() => onToggle(r.build_player_id)}
                      title={dropped ? "Add back" : "Drop from scenario"}
                      className={cn("inline-flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors cursor-pointer", dropped ? "text-[#D4AF37] hover:bg-[#D4AF37]/10" : "text-muted-foreground/40 hover:bg-amber-500/10 hover:text-amber-500")}
                    >
                      {dropped ? <PlusCircle className="h-3.5 w-3.5" /> : <MinusCircle className="h-3.5 w-3.5" />}
                    </button>
                    <span className={cn("min-w-0 flex-1 truncate text-sm font-medium", dropped && "line-through")}>{r.name}</span>
                    <span className="w-10 shrink-0 text-center text-[11px] font-semibold text-muted-foreground">{r.position || "—"}</span>
                    <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-foreground">{num(r.war)}</span>
                    {/* Projected Value: what this WAR is worth at the scenario budget. */}
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

// ─────────────────────────────────────────────────────────────────────────────
// Compare: two builds side by side + a roster diff (who's only in one).
function Compare({ qA, qB, loadingA, loadingB, builds, a, b, onPickA, onPickB, nameA, nameB }: {
  qA: Loaded | undefined; qB: Loaded | undefined; loadingA: boolean; loadingB: boolean;
  builds: { id: string; name: string }[]; a: string | null; b: string | null;
  onPickA: (id: string) => void; onPickB: (id: string) => void; nameA: string; nameB: string;
}) {
  const rowsA = qA?.rows ?? [];
  const rowsB = qB?.rows ?? [];
  const sA = summarize(rowsA, qA?.coachTotalBudget ?? null);
  const sB = summarize(rowsB, qB?.coachTotalBudget ?? null);

  const { onlyA, onlyB } = useMemo(() => {
    const bKeys = new Set(rowsB.map(rowKey));
    const aKeys = new Set(rowsA.map(rowKey));
    return {
      onlyA: rowsA.filter((r) => !bKeys.has(rowKey(r))).sort((x, y) => (y.war ?? -Infinity) - (x.war ?? -Infinity)),
      onlyB: rowsB.filter((r) => !aKeys.has(rowKey(r))).sort((x, y) => (y.war ?? -Infinity) - (x.war ?? -Infinity)),
    };
  }, [rowsA, rowsB]);

  const metric = (label: string, va: number | null, vb: number | null, fmt: (n: number | null) => string, goodWhenPositive: boolean) => {
    const d = va != null && vb != null ? vb - va : null;
    const tone = d == null || Math.abs(d) < 1e-9 ? "text-muted-foreground" : (d > 0) === goodWhenPositive ? "text-emerald-500" : "text-red-500";
    return (
      <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] items-center gap-2 py-2 border-b border-border/40 last:border-0">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" style={OSWALD}>{label}</span>
        <span className="text-right font-mono text-sm tabular-nums text-foreground">{fmt(va)}</span>
        <span className="text-right font-mono text-sm tabular-nums text-foreground">{fmt(vb)}</span>
        <span className={cn("text-right font-mono text-xs tabular-nums", tone)}>{d == null || Math.abs(d) < 1e-9 ? "—" : `${d > 0 ? "+" : ""}${fmt(d)}`}</span>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <BuildPicker label="Build A" value={a} onChange={onPickA} builds={builds} />
        <BuildPicker label="Build B" value={b} onChange={onPickB} builds={builds} />
      </div>

      {a && b && a === b && <p className="text-sm text-muted-foreground">Pick two different builds to compare.</p>}
      {loadingA || loadingB ? <p className="text-sm text-muted-foreground">Loading builds…</p> : (
        <>
          <Card>
            <CardHeader className="pb-2 pt-3 px-4 border-b border-border/40">
              <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] items-center gap-2">
                <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>Comparison</CardTitle>
                <span className="text-right text-[11px] font-semibold uppercase tracking-wider text-foreground/80" style={OSWALD}>{nameA}</span>
                <span className="text-right text-[11px] font-semibold uppercase tracking-wider text-foreground/80" style={OSWALD}>{nameB}</span>
                <span className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" style={OSWALD}>B − A</span>
              </div>
            </CardHeader>
            <CardContent className="px-4 py-1">
              {metric("Total WAR", sA.war, sB.war, (n) => num(n), true)}
              {metric("Committed Pay", sA.pay, sB.pay, (n) => money(n), false)}
              {metric("Budget Headroom", sA.headroom, sB.headroom, (n) => money(n), true)}
              {metric("Roster Count", sA.count, sB.count, (n) => (n == null ? "—" : String(n)), true)}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <DiffList title={`Only in ${nameA}`} rows={onlyA} tone="red" />
            <DiffList title={`Only in ${nameB}`} rows={onlyB} tone="green" />
          </div>
        </>
      )}
    </div>
  );
}

function DiffList({ title, rows, tone }: { title: string; rows: GmRow[]; tone: "red" | "green" }) {
  const warSum = rows.reduce((s, r) => s + (r.war ?? 0), 0);
  const paySum = rows.reduce((s, r) => s + (r.nil_value ?? 0), 0);
  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-4 border-b border-border/40">
        <CardTitle className={cn("text-[13px] font-bold uppercase tracking-[0.12em]", tone === "green" ? "text-emerald-500" : "text-red-400")} style={OSWALD}>
          {title} ({rows.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-2">
        {rows.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">Same players on both.</p> : (
          <div className="divide-y divide-border/40">
            {rows.map((r) => (
              <div key={r.build_player_id} className="flex items-center gap-2 py-1.5 px-1.5">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.name}</span>
                <span className="w-10 shrink-0 text-center text-[11px] font-semibold text-muted-foreground">{r.position || "—"}</span>
                <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-foreground">{num(r.war)}</span>
                <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">{money(r.nil_value)}</span>
              </div>
            ))}
            <div className="flex items-center gap-2 py-1.5 px-1.5 bg-muted/30">
              <span className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground" style={OSWALD}>Net</span>
              <span className="w-10 shrink-0" />
              <span className="w-12 shrink-0 text-right font-mono text-xs font-semibold tabular-nums text-foreground">{num(warSum)}</span>
              <span className="w-20 shrink-0 text-right font-mono text-xs font-semibold tabular-nums text-foreground">{money(paySum)}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
