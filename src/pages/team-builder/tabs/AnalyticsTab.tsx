import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useTeamWarSnapshot,
  useWarBenchmarks,
  useNationalSeedBenchmark,
  useAllTeamSnapshots,
  type TeamWarSnapshot,
  type WarStatRange,
} from "@/hooks/useTeamWarSnapshots";
import { CURRENT_SEASON, PROJECTION_SEASON } from "@/lib/seasonConstants";
import { hitterEligible, pitcherEligible, effectivePitcherRoleForBuild } from "../helpers";
import type { BuildPlayer } from "../types";

interface AnalyticsTabProps {
  rosterPlayers: BuildPlayer[];
  selectedTeam: string;
  rosterTableTotals: { totalWar: number; [key: string]: any };
  totalEffectiveNil: number;
  selectedTeamSourceId: string | null;
  selectedTeamFullName: string | null;
  selectedTeamConference: string | null;
  depthAssignments: Record<string, number>;
  playerProjection: (p: BuildPlayer, side?: "hitter" | "pitcher") => { owar?: number | null; pwar?: number | null };
  pitchingStatsByNameTeam: { bySourceId: Map<string, { role: string | null } | any> };
}

export default function AnalyticsTab({
  rosterPlayers,
  selectedTeam,
  rosterTableTotals,
  totalEffectiveNil,
  selectedTeamSourceId,
  selectedTeamFullName,
  selectedTeamConference,
  depthAssignments,
  playerProjection,
  pitchingStatsByNameTeam,
}: AnalyticsTabProps) {
  const { data: priorYearSnapshot } = useTeamWarSnapshot(selectedTeamSourceId, CURRENT_SEASON);
  const { data: warBenchmarks = [] } = useWarBenchmarks(CURRENT_SEASON);
  const { data: nationalSeedBenchmark } = useNationalSeedBenchmark(CURRENT_SEASON, "1-8");
  const { data: allTeamSnapshots = [] } = useAllTeamSnapshots(CURRENT_SEASON);

  const conferenceChampBenchmarks = useMemo(() => {
    if (!selectedTeamConference) return [];
    return warBenchmarks.filter(
      (b) => b.is_conference_champ && b.conference === selectedTeamConference,
    );
  }, [warBenchmarks, selectedTeamConference]);

  // "Team you want to emulate" picker. Stored as source_team_id; null = none
  // selected. Persists for the session only — fresh nav resets.
  const [emulateTeamId, setEmulateTeamId] = useState<string | null>(null);
  const [emulatePickerOpen, setEmulatePickerOpen] = useState(false);
  const emulateTeamSnapshot = useMemo(
    () => allTeamSnapshots.find((s) => s.source_team_id === emulateTeamId) ?? null,
    [allTeamSnapshots, emulateTeamId],
  );

  // define depthKey locally — trivial: (slot, depth) => `${slot}:${depth}`
  const depthKey = (slot: string, depth: number) => `${slot}:${depth}`;

  // Local helper to get display name from a BuildPlayer
  const getPlayerName = (p: BuildPlayer) =>
    p.player ? `${p.player.first_name} ${p.player.last_name}` : p.custom_name || "TBD";

  const posGroups: Record<string, { count: number; nilTotal: number; warTotal: number }> = {};
  // Per-exact-position aggregation for hitter side (so we can show
  // C / SS / CF separately under the Premium tier instead of one
  // lumped bar). Utility + Bench stay aggregated since position is
  // less relevant for those roles.
  type PosRow = { count: number; warTotal: number };
  const hitterByExactPos: Record<string, PosRow> = {};
  const pitcherByExactPos: Record<string, PosRow> = {};
  let utilityAgg: PosRow = { count: 0, warTotal: 0 };
  let benchAgg: PosRow = { count: 0, warTotal: 0 };

  // Tier metadata — drives ordering, labels, and per-position grouping.
  // Labels are user-facing; keys are internal stable ids. 1B/DH used to be
  // labeled "Low" but reads better as "Power" (they're the bat-first / power
  // positions, not "low-value" — defensive value is the only thing that's low).
  const HITTER_TIERS = [
    { key: "premium", label: "Premium", positions: ["C", "SS", "CF"], blurb: "" },
    { key: "skill",   label: "Skill",   positions: ["2B", "3B", "LF", "RF", "OF"], blurb: "" },
    { key: "power",   label: "Power",   positions: ["1B", "DH"], blurb: "" },
  ] as const;
  const POS_TO_TIER: Record<string, "premium" | "skill" | "power"> = {};
  for (const t of HITTER_TIERS) for (const p of t.positions) POS_TO_TIER[p] = t.key;

  for (const p of rosterPlayers) {
    if ((p.roster_status || "returner") === "leaving") continue;
    const pos = (p.position_slot || p.player?.position || "")
      .toString().toUpperCase().trim();
    const isBench = p.depth_role === "bench";
    const isUtility = p.depth_role === "utility";

    // Group labels match the HITTER_TIERS naming with a position breakdown
    // in parens so coaches see at a glance which positions roll up into
    // each tier. Utility + Bench depth_roles both classify as "Bench" —
    // non-starters share a single grouping regardless of nominal position.
    const group =
      /^(SP)/.test(pos) ? "Starting Pitchers" :
      /^(RP|CL|LHP|RHP|P$)/.test(pos) ? "Relievers" :
      (isBench || isUtility) ? "Bench" :
      /^(C|SS|CF)$/.test(pos) ? "Premium (C/SS/CF)" :
      /^(2B|3B|LF|RF|OF)$/.test(pos) ? "Skill (2B/3B/Corner OF)" :
      /^(1B|DH)$/.test(pos) ? "Power (1B/DH)" :
      /^(UTL|IF)$/.test(pos) ? "Bench" :
      /^(TWP)/.test(pos) ? "Premium (C/SS/CF)" :
      "Bench";
    if (!posGroups[group]) posGroups[group] = { count: 0, nilTotal: 0, warTotal: 0 };
    posGroups[group].count++;
    posGroups[group].nilTotal += (p.nil_value || 0);
    let war = 0;
    if (hitterEligible(p)) war += playerProjection(p, "hitter").owar ?? 0;
    if (pitcherEligible(p)) war += playerProjection(p, "pitcher").pwar ?? 0;
    posGroups[group].warTotal += war;

    // Per-exact-position accumulation (drives the per-position rows
    // under each tier header in the new UI).
    if (group === "Starting Pitchers" || group === "Relievers") {
      const roleKey = group === "Starting Pitchers" ? "SP" : "RP";
      if (!pitcherByExactPos[roleKey]) pitcherByExactPos[roleKey] = { count: 0, warTotal: 0 };
      pitcherByExactPos[roleKey].count++;
      pitcherByExactPos[roleKey].warTotal += war;
    } else if (isBench) {
      benchAgg.count++;
      benchAgg.warTotal += war;
    } else if (isUtility) {
      utilityAgg.count++;
      utilityAgg.warTotal += war;
    } else if (POS_TO_TIER[pos]) {
      if (!hitterByExactPos[pos]) hitterByExactPos[pos] = { count: 0, warTotal: 0 };
      hitterByExactPos[pos].count++;
      hitterByExactPos[pos].warTotal += war;
    }
  }
  const activeCount = rosterPlayers.filter(p => (p.roster_status || "returner") !== "leaving").length;
  const leavingCount = rosterPlayers.filter(p => (p.roster_status || "returner") === "leaving").length;
  const groups = Object.entries(posGroups).sort((a, b) => b[1].nilTotal - a[1].nilTotal);

  // Current build positional WAR splits — mirror the snapshot schema
  // so the year-over-year + benchmark compare cards line up cleanly.
  const hitterContribs: Array<{ p: BuildPlayer; owar: number }> = [];
  const pitcherContribs: Array<{ p: BuildPlayer; pwar: number; role: "SP" | "RP" }> = [];
  for (const p of rosterPlayers) {
    if ((p.roster_status || "returner") === "leaving") continue;
    if (hitterEligible(p)) {
      const owar = playerProjection(p, "hitter").owar ?? 0;
      hitterContribs.push({ p, owar });
    }
    if (pitcherEligible(p)) {
      const pwar = playerProjection(p, "pitcher").pwar ?? 0;
      const sourceId = (p.player as any)?.source_player_id ?? null;
      const pmRole = sourceId ? pitchingStatsByNameTeam.bySourceId.get(sourceId)?.role : null;
      const role = effectivePitcherRoleForBuild(p, pmRole);
      pitcherContribs.push({ p, pwar, role: role === "SP" ? "SP" : "RP" });
    }
  }
  const buildLineupOwar = [...hitterContribs]
    .sort((a, b) => b.owar - a.owar)
    .slice(0, 9)
    .reduce((s, x) => s + x.owar, 0);
  const buildRotationPwar = pitcherContribs
    .filter((x) => x.role === "SP")
    .reduce((s, x) => s + x.pwar, 0);
  const buildBullpenPwar = pitcherContribs
    .filter((x) => x.role === "RP")
    .reduce((s, x) => s + x.pwar, 0);
  const buildTotalWar = rosterTableTotals.totalWar;

  // Delta rendering helper — green if ahead, red if behind, neutral if ±0.1
  const renderDelta = (build: number, bench: number) => {
    const diff = build - bench;
    const abs = Math.abs(diff);
    const color = abs < 0.1 ? "text-muted-foreground" : diff > 0 ? "text-[hsl(var(--success))]" : "text-destructive";
    const sign = diff > 0 ? "+" : "";
    return <div className={`text-xs font-semibold ${color}`}>{sign}{diff.toFixed(2)}</div>;
  };
  const benchTeam = priorYearSnapshot;

  // (renderBenchmarkCard removed — comparison cards consolidated into
  //  a single WAR Comparison table to eliminate redundant big numbers.)

  // Split position groups into hitting vs pitching so the visual cleanly
  // separates oWAR contributors from pWAR contributors. Ordered by positional
  // value (highest → lowest). Always emit all rows even when empty so the
  // coach sees zero-filled tiers ("Power 0 players — $0") as roster gaps
  // rather than silently disappearing slots.
  const hittingOrder = ["Premium (C/SS/CF)", "Skill (2B/3B/Corner OF)", "Power (1B/DH)", "Bench"];
  const pitchingOrder = ["Starting Pitchers", "Relievers"];
  const emptyGroup = { count: 0, nilTotal: 0, warTotal: 0 };
  const groupByKey: Record<string, [string, { count: number; nilTotal: number; warTotal: number }]> = {};
  for (const g of groups) groupByKey[g[0]] = g;
  const hittingGroups: Array<[string, { count: number; nilTotal: number; warTotal: number }]> =
    hittingOrder.map((k) => groupByKey[k] ?? [k, emptyGroup]);
  const pitchingGroups: Array<[string, { count: number; nilTotal: number; warTotal: number }]> =
    pitchingOrder.map((k) => groupByKey[k] ?? [k, emptyGroup]);

  return (
    <>
      {/* Top stats row — RSTR IQ stat-tile pattern: 3px gold left accent,
          Oswald big number, small uppercase tracking label, left-aligned. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-md border border-border/40 border-l-[3px] border-l-[#D4AF37] bg-card/40 px-5 py-4">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Active Roster</div>
          <div className="text-3xl font-bold tabular-nums mt-1.5" style={{ fontFamily: "'Oswald', sans-serif" }}>{activeCount}</div>
        </div>
        <div className="rounded-md border border-border/40 border-l-[3px] border-l-[#D4AF37] bg-card/40 px-5 py-4">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Leaving</div>
          <div className="text-3xl font-bold tabular-nums mt-1.5" style={{ fontFamily: "'Oswald', sans-serif" }}>{leavingCount}</div>
        </div>
        <div className="rounded-md border border-border/40 border-l-[3px] border-l-[#D4AF37] bg-card/40 px-5 py-4">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Avg NIL / Player</div>
          <div className="text-2xl font-bold tabular-nums mt-1.5" style={{ fontFamily: "'Oswald', sans-serif" }}>{activeCount > 0 ? `$${Math.round(totalEffectiveNil / activeCount).toLocaleString()}` : "—"}</div>
        </div>
        <div className="rounded-md border border-border/40 border-l-[3px] border-l-[#D4AF37] bg-card/40 px-5 py-4">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Avg WAR / Player</div>
          <div className="text-2xl font-bold tabular-nums mt-1.5" style={{ fontFamily: "'Oswald', sans-serif" }}>{activeCount > 0 ? (rosterTableTotals.totalWar / activeCount).toFixed(2) : "—"}</div>
        </div>
      </div>

      {/* Consolidated WAR Comparison: your build (once) + each benchmark as a delta row.
          Replaces the old 3-card stack where the same big numbers were repeated.
          National Champion was removed in favor of National Seed (1-8) since
          postseason results are bracket-variance heavy and not a roster-build target. */}
      {(() => {
        type BenchRow =
          | { kind: "team"; label: string; sublabel?: string; bench: TeamWarSnapshot }
          | { kind: "range"; label: string; sublabel?: string; range: {
              total: WarStatRange | null; lineup: WarStatRange | null;
              rotation: WarStatRange | null; bullpen: WarStatRange | null;
            } };
        const benchRows: BenchRow[] = [];
        if (benchTeam) {
          benchRows.push({
            kind: "team",
            label: `${CURRENT_SEASON} Actual — ${benchTeam.team_name}`,
            sublabel: `${benchTeam.games_played_est ?? "?"} games · factor ${benchTeam.proration_factor?.toFixed(2) ?? "—"}`,
            bench: benchTeam,
          });
        }
        for (const c of conferenceChampBenchmarks) {
          benchRows.push({
            kind: "team",
            label: `${CURRENT_SEASON} ${c.conference} Regular-Season Champion — ${c.team_name}`,
            sublabel: conferenceChampBenchmarks.length > 1 ? "split regular-season champ" : undefined,
            bench: c,
          });
        }
        if (nationalSeedBenchmark?.totalWar) {
          benchRows.push({
            kind: "range",
            label: `${CURRENT_SEASON} National Seed Range (1-8)`,
            sublabel: `min – max across the top 8 seeded teams (host through Super Regional)`,
            range: {
              total: nationalSeedBenchmark.totalWar,
              lineup: nationalSeedBenchmark.lineupOwar,
              rotation: nationalSeedBenchmark.rotationPwar,
              bullpen: nationalSeedBenchmark.bullpenPwar,
            },
          });
        }
        if (emulateTeamSnapshot) {
          benchRows.push({
            kind: "team",
            label: `${CURRENT_SEASON} Emulate — ${emulateTeamSnapshot.team_name}`,
            sublabel: emulateTeamSnapshot.conference ?? undefined,
            bench: emulateTeamSnapshot,
          });
        }

        const deltaText = (build: number, bench: number) => {
          const diff = build - bench;
          const abs = Math.abs(diff);
          const color = abs < 0.05 ? "text-muted-foreground" : diff > 0 ? "text-[hsl(var(--success))]" : "text-destructive";
          const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
          return <span className={`tabular-nums font-semibold ${color}`}>{sign}{abs.toFixed(2)}</span>;
        };

        // V1 hero — Total WAR with year-over-year delta vs prior-season actual.
        // Matches the Hitter/Pitcher hero strip pattern (same "+X.XX vs 2025" framing).
        const priorYearTeamTotal = benchTeam
          ? Number(benchTeam.prorated_total_owar) + Number(benchTeam.prorated_total_pwar)
          : null;
        const priorYearTotalDelta = priorYearTeamTotal != null
          ? buildTotalWar - priorYearTeamTotal
          : null;

        return (
          <Card className="border-l-[3px] border-l-[#D4AF37]">
            <CardHeader className="pb-3">
              <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={{ fontFamily: "'Oswald', sans-serif" }}>
                WAR Comparison — {selectedTeam || "Select a team"} {PROJECTION_SEASON} Build
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* V1 hero — Total WAR with year-over-year delta */}
              <div className="mb-5 px-4 py-3 rounded-md bg-card/40 border-l-[3px] border-l-[#D4AF37]">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Total WAR</div>
                <div className="flex items-baseline gap-3 mt-1 flex-wrap">
                  <span className="text-4xl font-bold tabular-nums text-[#D4AF37]" style={{ fontFamily: "'Oswald', sans-serif" }}>{buildTotalWar.toFixed(2)}</span>
                  {priorYearTotalDelta != null && (
                    <span className={`text-sm font-semibold tabular-nums ${Math.abs(priorYearTotalDelta) < 0.05 ? "text-muted-foreground" : priorYearTotalDelta > 0 ? "text-[hsl(var(--success))]" : "text-destructive"}`}>
                      {priorYearTotalDelta > 0 ? "+" : priorYearTotalDelta < 0 ? "−" : ""}{Math.abs(priorYearTotalDelta).toFixed(2)} vs {CURRENT_SEASON}
                    </span>
                  )}
                </div>
              </div>

              {/* Supporting build metrics — Total WAR moved to hero, so 3-tile secondary row */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                <div className="rounded-md border border-border/40 border-l-[3px] border-l-[#D4AF37]/60 bg-card/40 px-4 py-3">
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Lineup oWAR</div>
                  <div className="text-2xl font-bold tabular-nums mt-1" style={{ fontFamily: "'Oswald', sans-serif" }}>{buildLineupOwar.toFixed(2)}</div>
                </div>
                <div className="rounded-md border border-border/40 border-l-[3px] border-l-[#D4AF37]/60 bg-card/40 px-4 py-3">
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Rotation pWAR</div>
                  <div className="text-2xl font-bold tabular-nums mt-1" style={{ fontFamily: "'Oswald', sans-serif" }}>{buildRotationPwar.toFixed(2)}</div>
                </div>
                <div className="rounded-md border border-border/40 border-l-[3px] border-l-[#D4AF37]/60 bg-card/40 px-4 py-3">
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Bullpen pWAR</div>
                  <div className="text-2xl font-bold tabular-nums mt-1" style={{ fontFamily: "'Oswald', sans-serif" }}>{buildBullpenPwar.toFixed(2)}</div>
                </div>
              </div>

              {/* Benchmark comparison table — deltas only, no repeated big numbers */}
              {!selectedTeam ? (
                <div className="text-sm text-muted-foreground">Select a team to load benchmarks.</div>
              ) : benchRows.length === 0 ? (
                <div className="text-sm text-muted-foreground space-y-1">
                  <div>No benchmarks on file for <span className="font-semibold text-foreground">{selectedTeam}</span>.</div>
                  <div className="text-xs">
                    Looked up by source_team_id <span className="font-mono">{selectedTeamSourceId ?? "(none)"}</span>
                    {selectedTeamFullName && selectedTeamFullName !== selectedTeam ? <> and name fallback <span className="font-mono">{selectedTeamFullName}</span></> : null}.
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="text-left py-2 pr-4">Compare vs</th>
                        <th className="text-center py-2 px-4 w-[140px] whitespace-nowrap">Goal Total</th>
                        <th className="text-center py-2 px-4 w-[110px] whitespace-nowrap">Δ Total</th>
                        <th className="text-center py-2 px-4 w-[110px] whitespace-nowrap">Δ Lineup</th>
                        <th className="text-center py-2 px-4 w-[110px] whitespace-nowrap">Δ Rotation</th>
                        <th className="text-center py-2 px-4 w-[110px] whitespace-nowrap">Δ Bullpen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {benchRows.map((row, i) => {
                        if (row.kind === "team") {
                          const benchTotal = Number(row.bench.prorated_total_owar) + Number(row.bench.prorated_total_pwar);
                          return (
                            <tr key={i} className="border-b last:border-0">
                              <td className="py-2 pr-4">
                                <div className="font-medium">{row.label}</div>
                                {row.sublabel && <div className="text-[10px] text-muted-foreground italic">{row.sublabel}</div>}
                              </td>
                              <td className="text-center py-2 px-4 font-mono tabular-nums text-muted-foreground">{benchTotal.toFixed(2)}</td>
                              <td className="text-center py-2 px-4 font-mono">{deltaText(buildTotalWar, benchTotal)}</td>
                              <td className="text-center py-2 px-4 font-mono">{deltaText(buildLineupOwar, Number(row.bench.prorated_starting_lineup_owar))}</td>
                              <td className="text-center py-2 px-4 font-mono">{deltaText(buildRotationPwar, Number(row.bench.prorated_rotation_pwar))}</td>
                              <td className="text-center py-2 px-4 font-mono">{deltaText(buildBullpenPwar, Number(row.bench.prorated_bullpen_pwar))}</td>
                            </tr>
                          );
                        }
                        // range row — show min-max in Goal column, distance-to-median in deltas
                        const rangeText = (r: WarStatRange | null) => {
                          if (!r) return <span className="text-muted-foreground">—</span>;
                          return (
                            <div className="leading-tight">
                              <div className="tabular-nums font-medium">{r.min.toFixed(2)}–{r.max.toFixed(2)}</div>
                              <div className="text-[10px] text-muted-foreground tabular-nums">med {r.median.toFixed(2)}</div>
                            </div>
                          );
                        };
                        const rangeDelta = (build: number, r: WarStatRange | null) => {
                          if (!r) return <span className="text-muted-foreground">—</span>;
                          // In-range = success color; outside = neutral magnitude vs median
                          if (build >= r.min && build <= r.max) {
                            return <span className="tabular-nums font-semibold text-[hsl(var(--success))]">in range</span>;
                          }
                          const diff = build - r.median;
                          const abs = Math.abs(diff);
                          const color = diff > 0 ? "text-muted-foreground" : "text-destructive";
                          const sign = diff > 0 ? "+" : "−";
                          return (
                            <div className="leading-tight">
                              <div className={`tabular-nums font-semibold ${color}`}>{sign}{abs.toFixed(2)}</div>
                              <div className="text-[10px] text-muted-foreground">vs med</div>
                            </div>
                          );
                        };
                        return (
                          <tr key={i} className="border-b last:border-0 bg-[#D4AF37]/[0.04]">
                            <td className="py-2 pr-4">
                              <div className="font-medium">{row.label}</div>
                              {row.sublabel && <div className="text-[10px] text-muted-foreground italic">{row.sublabel}</div>}
                            </td>
                            <td className="text-center py-2 px-4 font-mono">{rangeText(row.range.total)}</td>
                            <td className="text-center py-2 px-4 font-mono">{rangeDelta(buildTotalWar, row.range.total)}</td>
                            <td className="text-center py-2 px-4 font-mono">{rangeDelta(buildLineupOwar, row.range.lineup)}</td>
                            <td className="text-center py-2 px-4 font-mono">{rangeDelta(buildRotationPwar, row.range.rotation)}</td>
                            <td className="text-center py-2 px-4 font-mono">{rangeDelta(buildBullpenPwar, row.range.bullpen)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="text-[10px] text-muted-foreground mt-2 italic">Prorated to 56 games.</div>

                  {/* Emulate picker — searchable combobox (Popover + Command).
                      Searches name + conference inline; D1-only list. */}
                  <div className="mt-4 flex items-center gap-3 pt-3 border-t">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Compare to team:</div>
                    <Popover open={emulatePickerOpen} onOpenChange={setEmulatePickerOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={emulatePickerOpen}
                          className="w-[320px] h-8 justify-between font-normal cursor-pointer"
                        >
                          <span className="truncate">
                            {emulateTeamSnapshot
                              ? `${emulateTeamSnapshot.team_name}${emulateTeamSnapshot.conference ? ` (${emulateTeamSnapshot.conference})` : ""}`
                              : "Pick a team to emulate…"}
                          </span>
                          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[320px] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Search teams…" />
                          <CommandList>
                            <CommandEmpty>No matches.</CommandEmpty>
                            <CommandGroup>
                              <CommandItem
                                value="__none__"
                                className="cursor-pointer"
                                onSelect={() => { setEmulateTeamId(null); setEmulatePickerOpen(false); }}
                              >
                                <Check className={cn("mr-2 h-3.5 w-3.5", emulateTeamId === null ? "opacity-100" : "opacity-0")} />
                                — None —
                              </CommandItem>
                              {allTeamSnapshots.map((t) => {
                                const total = Number(t.prorated_total_owar) + Number(t.prorated_total_pwar);
                                const label = `${t.team_name}${t.conference ? ` (${t.conference})` : ""}`;
                                // Searchable value includes WAR number so users can also
                                // filter by it if they want; visual layout puts name+conf
                                // on the left and the WAR stat right-aligned, muted.
                                const searchValue = `${label} ${total.toFixed(1)}`;
                                return (
                                  <CommandItem
                                    key={t.source_team_id}
                                    value={searchValue}
                                    className="cursor-pointer"
                                    onSelect={() => { setEmulateTeamId(t.source_team_id); setEmulatePickerOpen(false); }}
                                  >
                                    <Check className={cn("mr-2 h-3.5 w-3.5 shrink-0", emulateTeamId === t.source_team_id ? "opacity-100" : "opacity-0")} />
                                    <span className="flex-1 truncate">{label}</span>
                                    <span className="ml-2 text-[10px] tabular-nums text-muted-foreground font-mono shrink-0">
                                      {total.toFixed(1)} WAR
                                    </span>
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {(() => {
        // Per-position WAR breakdown — one row per position slot showing
        // the starter(s). Platoon (≥2 players with depth_role === "starter"
        // at the same position_slot) renders as a split-color bar with
        // combined WAR total. Bench aggregates non-starters into one row.
        // Pitchers: rotation shown individually, top 5 RPs by pWAR.
        // Empirical thresholds from 2025 D1 starters (PA >= 150).
        // Source: supabase/queries/owar_thresholds_by_position_2025.sql
        // Starter threshold = p50 (median actual D1 starter at position)
        // Elite threshold   = p90 (top 10% of starters at position)
        // DH inherits 1B values — no DH-specific sample in the query.
        const POS_STARTER_OWAR: Record<string, number> = {
          C: 0.91, SS: 0.94, CF: 1.08,
          "2B": 0.98, "3B": 0.99, LF: 1.06, RF: 1.09, OF: 0.86,
          "1B": 1.13, DH: 1.13,
        };
        const POS_ELITE_OWAR: Record<string, number> = {
          C: 1.67, SS: 1.70, CF: 1.93,
          "2B": 1.75, "3B": 1.88, LF: 1.79, RF: 1.82, OF: 1.40,
          "1B": 1.95, DH: 1.95,
        };
        const DEFAULT_STARTER = 1.00;
        const DEFAULT_ELITE = 1.80;

        // Two-pass classification: roster build (depth_role) is the
        // primary source. Depth chart (depthAssignments) is the fallback
        // for slots/roles that the build hasn't tagged yet.
        type StarterEntry = { name: string; war: number };
        const ROTATION_ROLES = new Set(["weekend_starter", "weekday_starter", "swing_starter"]);
        const RELIEVER_ROLES = new Set(["workhorse_reliever", "high_leverage_reliever", "mid_leverage_reliever", "low_impact_reliever", "specialist_reliever"]);
        type PitcherRow = { name: string; war: number; role: string; isLefty: boolean };

        // Pass 1: index hitter starters and pitcher role assignments from
        // the roster build's depth_role tags.
        const hitterStarterPosByIdx = new Map<number, string>();
        const rotationIdxs = new Set<number>();
        const bullpenIdxs = new Set<number>();
        rosterPlayers.forEach((p, idx) => {
          if ((p.roster_status || "returner") === "leaving") return;
          const role = p.depth_role || "";
          // d1-eligible hitter tiers: cornerstone, everyday_starter,
          // and legacy "starter" (pre-5-tier drafts).
          const isHitterStarter = role === "cornerstone" || role === "everyday_starter" || role === "starter";
          if (hitterEligible(p) && isHitterStarter) {
            const pos = (p.position_slot || p.player?.position || "")
              .toString().toUpperCase().trim();
            if (POS_TO_TIER[pos]) hitterStarterPosByIdx.set(idx, pos);
          }
          if (pitcherEligible(p)) {
            const role = p.depth_role || "";
            if (ROTATION_ROLES.has(role)) rotationIdxs.add(idx);
            else if (RELIEVER_ROLES.has(role)) bullpenIdxs.add(idx);
          }
        });

        // Pass 2: fill remaining positional/role gaps from the depth chart.
        // Hitter side — promote depth_order=1 players from the depth chart,
        // but honor the build's current position_slot if it's been changed.
        // The build's position change wins over where the chart originally
        // slotted them — e.g., player at SS:1 in chart but position_slot now
        // "2B" → treat them as a 2B starter, not SS.
        const positionsWithStarter = new Set(Array.from(hitterStarterPosByIdx.values()));
        for (const key in depthAssignments) {
          const [chartSlot, depthStr] = key.split(":");
          if (depthStr !== "1") continue;
          if (!POS_TO_TIER[chartSlot]) continue;
          const idx = depthAssignments[key];
          if (idx == null) continue;
          if (hitterStarterPosByIdx.has(idx)) continue;
          const p = rosterPlayers[idx];
          if (!p) continue;
          if ((p.roster_status || "returner") === "leaving") continue;
          if (!hitterEligible(p)) continue;
          const currentPos = (p.position_slot || p.player?.position || "")
            .toString().toUpperCase().trim();
          const effectivePos = POS_TO_TIER[currentPos] ? currentPos : chartSlot;
          if (positionsWithStarter.has(effectivePos)) continue;
          hitterStarterPosByIdx.set(idx, effectivePos);
          positionsWithStarter.add(effectivePos);
        }
        // Pitcher side — promote SP1-SP5 / RP1-RP8 depth-chart picks that
        // aren't already covered by depth_role tags.
        [1, 2, 3, 4, 5].forEach((n) => {
          const idx = depthAssignments[depthKey(`SP${n}`, 1)];
          if (idx == null) return;
          const p = rosterPlayers[idx];
          if (!p) return;
          if ((p.roster_status || "returner") === "leaving") return;
          if (!pitcherEligible(p)) return;
          if (rotationIdxs.has(idx) || bullpenIdxs.has(idx)) return;
          rotationIdxs.add(idx);
        });
        [1, 2, 3, 4, 5, 6, 7, 8].forEach((n) => {
          const idx = depthAssignments[depthKey(`RP${n}`, 1)];
          if (idx == null) return;
          const p = rosterPlayers[idx];
          if (!p) return;
          if ((p.roster_status || "returner") === "leaving") return;
          if (!pitcherEligible(p)) return;
          if (rotationIdxs.has(idx) || bullpenIdxs.has(idx)) return;
          bullpenIdxs.add(idx);
        });

        // Pass 3: bucket every active hitter/pitcher into the final groups.
        const startersByPos: Record<string, StarterEntry[]> = {};
        const benchEntries: Array<{ name: string; war: number }> = [];
        let hittingWarTotal = 0;
        const rotation: PitcherRow[] = [];
        const bullpen: PitcherRow[] = [];
        let pitchingWarTotal = 0;
        rosterPlayers.forEach((p, idx) => {
          if ((p.roster_status || "returner") === "leaving") return;
          if (hitterEligible(p)) {
            const owar = playerProjection(p, "hitter").owar ?? 0;
            hittingWarTotal += owar;
            const starterPos = hitterStarterPosByIdx.get(idx);
            if (starterPos) {
              if (!startersByPos[starterPos]) startersByPos[starterPos] = [];
              startersByPos[starterPos].push({ name: getPlayerName(p), war: owar });
            } else {
              benchEntries.push({ name: getPlayerName(p), war: owar });
            }
          }
          if (pitcherEligible(p)) {
            const pwar = playerProjection(p, "pitcher").pwar ?? 0;
            pitchingWarTotal += pwar;
            const isLefty = (p.player?.throws_hand || "").toUpperCase() === "L";
            const role = p.depth_role || "";
            const row: PitcherRow = { name: getPlayerName(p), war: pwar, role, isLefty };
            if (rotationIdxs.has(idx)) rotation.push(row);
            else if (bullpenIdxs.has(idx)) bullpen.push(row);
          }
        });
        const rotationOrder = ["weekend_starter", "weekday_starter", "swing_starter"];
        rotation.sort((a, b) => {
          const ra = rotationOrder.indexOf(a.role);
          const rb = rotationOrder.indexOf(b.role);
          if (ra !== rb) return ra - rb;
          return b.war - a.war;
        });
        const bullpenWarTotal = bullpen.reduce((s, x) => s + x.war, 0);
        const topBullpen = [...bullpen].sort((a, b) => b.war - a.war).slice(0, 7);

        // Tier labels: a p25 SP (~1.5 WAR) is still a valuable rotation
        // arm — used to be labeled "Below" which mis-framed it as a
        // weakness. "Contributor" reads accurately; the truly weak
        // tier (< p25) keeps a sharper label as "Below".
        const verdictFor = (war: number, starter: number, elite: number): string => {
          if (war >= elite) return "Elite";
          if (war >= starter) return "Starter";
          if (war >= starter * 0.5) return "Contributor";
          return "Below";
        };
        const verdictColor = (v: string) =>
          v === "Elite" ? "text-emerald-600" :
          v === "Starter" ? "text-yellow-600" :
          v === "Contributor" ? "text-orange-600" : "text-red-600";

        // Platoon segments use gold + darker gold from RSTR IQ design system
        const segmentColors = ["bg-[#D4AF37]", "bg-[#A08820]", "bg-amber-700"];

        const renderPosSlot = (pos: string, starters: StarterEntry[]) => {
          const elite = POS_ELITE_OWAR[pos] ?? DEFAULT_ELITE;
          const starterT = POS_STARTER_OWAR[pos] ?? DEFAULT_STARTER;
          const totalWar = starters.reduce((s, x) => s + x.war, 0);
          const v = verdictFor(totalWar, starterT, elite);
          const isPlatoon = starters.length >= 2;
          const rawSegments = starters.map((x) => Math.max(0, (x.war / elite) * 100));
          const segTotal = rawSegments.reduce((s, x) => s + x, 0);
          const scale = segTotal > 100 ? 100 / segTotal : 1;
          const segments = rawSegments.map((s) => s * scale);
          return (
            <div key={pos} className="ml-2">
              <div className="flex items-center justify-between mb-1 gap-3">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="inline-flex items-center justify-center min-w-[28px] h-5 px-1.5 rounded-sm text-[10px] font-bold tracking-wider bg-muted text-foreground/80">{pos}</span>
                  <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {starters.length === 0 ? (
                      <span className="text-sm italic text-muted-foreground">Unfilled</span>
                    ) : starters.map((s, i) => (
                      <span key={i} className="text-sm font-medium flex items-center gap-1.5">
                        {isPlatoon && <span className={`inline-block w-2 h-2 rounded-sm ${segmentColors[i] ?? "bg-amber-600"}`} />}
                        {s.name}
                        {isPlatoon && <span className="text-[10px] text-muted-foreground tabular-nums">({s.war.toFixed(2)})</span>}
                      </span>
                    ))}
                  </div>
                  {starters.length > 0 && (
                    <span className={`text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap ${verdictColor(v)}`}>{v}</span>
                  )}
                </div>
                {starters.length > 0 && (
                  <div className="flex items-center gap-3 text-sm shrink-0">
                    <span className="font-semibold tabular-nums w-16 text-right">{totalWar.toFixed(2)} WAR</span>
                  </div>
                )}
              </div>
              {starters.length > 0 ? (
                <div className="h-2 rounded-full bg-muted overflow-hidden relative flex">
                  {segments.map((w, i) => (
                    <div key={i} className={`h-full ${segmentColors[i] ?? "bg-amber-600"} transition-all`} style={{ width: `${w}%` }} />
                  ))}
                  <div className="absolute top-0 h-full w-px bg-foreground/40" style={{ left: `${Math.min(100, (starterT / elite) * 100)}%` }} title={`Starter benchmark: ${starterT.toFixed(1)} WAR`} />
                </div>
              ) : (
                <div className="h-2 rounded-full bg-muted/40 border border-dashed border-muted-foreground/20" />
              )}
            </div>
          );
        };

        const ROLE_LABEL: Record<string, string> = {
          weekend_starter: "Weekend SP",
          weekday_starter: "Weekday SP",
          swing_starter: "Swing",
          workhorse_reliever: "Workhorse",
          high_leverage_reliever: "High Lev",
          mid_leverage_reliever: "Mid Lev",
          low_impact_reliever: "Low Impact",
          specialist_reliever: "Specialist",
        };
        const renderPitcherRow = (p: PitcherRow, isSp: boolean) => {
          // Empirical thresholds from 2025 D1.
          // SP rows compared against SP_rotation tier (p50/p90 = 2.27/3.89).
          // RP rows compared against RP_primary tier (p50/p90 = 0.99/2.03)
          // — top 7 bullpen by pWAR are realistically primary-tier targets.
          const elite = isSp ? 3.89 : 2.03;
          const starterT = isSp ? 2.27 : 0.99;
          const v = verdictFor(p.war, starterT, elite);
          const pct = Math.min(100, (p.war / elite) * 100);
          return (
            <div key={`${p.name}-${p.role}`} className="ml-2">
              <div className="flex items-center justify-between mb-1 gap-3">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className={`inline-flex items-center justify-center w-5 h-5 rounded-sm text-[10px] font-bold ${p.isLefty ? "bg-blue-500/15 text-blue-700" : "bg-muted text-foreground/80"}`}>{p.isLefty ? "L" : "R"}</span>
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium">{p.name}</span>
                    <span className="text-[10px] text-muted-foreground ml-2 uppercase tracking-wider">{ROLE_LABEL[p.role] ?? p.role}</span>
                  </div>
                  <span className={`text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap ${verdictColor(v)}`}>{v}</span>
                </div>
                <div className="flex items-center gap-3 text-sm shrink-0">
                  <span className="font-semibold tabular-nums w-16 text-right">{p.war.toFixed(2)} WAR</span>
                </div>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden relative">
                <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
                <div className="absolute top-0 h-full w-px bg-foreground/40" style={{ left: `${Math.min(100, (starterT / elite) * 100)}%` }} title={`Starter benchmark: ${starterT.toFixed(1)} WAR`} />
              </div>
            </div>
          );
        };

        const benchWarTotal = benchEntries.reduce((s, x) => s + x.war, 0);

        // Showcase metrics (V1 hero / V2 per-tier / V3 footer treatments):
        // - starterTotalOwar = sum across position-1 starters (the "nine")
        // - eliteCap = sum of POS_ELITE_OWAR for the 9 starting slots
        // - priorYearLineupDelta = vs prior-season actual lineup oWAR
        const STARTING_LINEUP_SLOTS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"];
        const starterTotalOwar = Object.values(startersByPos)
          .reduce((s, arr) => s + arr.reduce((ss, e) => ss + e.war, 0), 0);
        const eliteCap = STARTING_LINEUP_SLOTS.reduce(
          (s, pos) => s + (POS_ELITE_OWAR[pos] ?? DEFAULT_ELITE),
          0,
        );
        const eliteCapPct = eliteCap > 0 ? (starterTotalOwar / eliteCap) * 100 : 0;
        const priorYearLineupOwar = priorYearSnapshot
          ? Number(priorYearSnapshot.prorated_starting_lineup_owar)
          : null;
        const priorYearLineupDelta = priorYearLineupOwar != null
          ? starterTotalOwar - priorYearLineupOwar
          : null;

        // Pitcher showcase metrics — mirror the hitter card, with empirical
        // thresholds from 2025 D1 (pwar_thresholds_by_role_2025.sql).
        //   SP_rotation p90 = 3.89  (top 3 IP per team)
        //   RP_primary  p90 = 2.03  (ranks 4-7 per team, weekday SP + setup/closer)
        //   RP_depth    p90 = 0.83  (rank 8+, middle relief, mop-up, specialist)
        // Cap maps depth-chart slots to empirical buckets:
        //   SP1-SP3   → rotation (3 slots)
        //   SP4-SP5 + RP1-RP4 → primary (6 slots)
        //   RP5-RP7   → depth (3 slots)
        // Hero number uses pitchingWarTotal (all pitchers) so it matches the
        // WAR Comparison card's Rotation+Bullpen aggregate.
        const SP_ROTATION_ELITE_PWAR = 3.89;
        const RP_PRIMARY_ELITE_PWAR = 2.03;
        const RP_DEPTH_ELITE_PWAR = 0.83;
        const pitcherEliteCap =
          3 * SP_ROTATION_ELITE_PWAR +   // SP1-3 (weekend rotation)
          6 * RP_PRIMARY_ELITE_PWAR +    // SP4-5 + RP1-4 (weekday/swing + setup/closer)
          3 * RP_DEPTH_ELITE_PWAR;       // RP5-7 (low-leverage)
        const pitcherEliteCapPct = pitcherEliteCap > 0 ? (pitchingWarTotal / pitcherEliteCap) * 100 : 0;
        const priorYearStaffPwar = priorYearSnapshot
          ? Number(priorYearSnapshot.prorated_rotation_pwar) + Number(priorYearSnapshot.prorated_bullpen_pwar)
          : null;
        const priorYearStaffDelta = priorYearStaffPwar != null
          ? pitchingWarTotal - priorYearStaffPwar
          : null;
        const rotationWarTotal = rotation.reduce((s, x) => s + x.war, 0);

        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Hitter side — one row per position, platoon-aware */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={{ fontFamily: "'Oswald', sans-serif" }}>
                  Hitter WAR by Position
                </CardTitle>
                <div className="text-xs text-muted-foreground">
                  Total oWAR (all hitters): <span className="font-semibold text-foreground tabular-nums">{hittingWarTotal.toFixed(2)}</span>
                </div>
              </CardHeader>
              <CardContent>
                {/* V1 — Hero strip: starting lineup oWAR up top */}
                <div className="mb-5 px-4 py-3 rounded-md bg-card/40 border-l-[3px] border-l-[#D4AF37]">
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Starting Lineup oWAR</div>
                  <div className="flex items-baseline gap-3 mt-1 flex-wrap">
                    <span className="text-4xl font-bold tabular-nums text-[#D4AF37]" style={{ fontFamily: "'Oswald', sans-serif" }}>{starterTotalOwar.toFixed(2)}</span>
                    {priorYearLineupDelta != null && (
                      <span className={`text-sm font-semibold tabular-nums ${Math.abs(priorYearLineupDelta) < 0.05 ? "text-muted-foreground" : priorYearLineupDelta > 0 ? "text-[hsl(var(--success))]" : "text-destructive"}`}>
                        {priorYearLineupDelta > 0 ? "+" : priorYearLineupDelta < 0 ? "−" : ""}{Math.abs(priorYearLineupDelta).toFixed(2)} vs {CURRENT_SEASON}
                      </span>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  {HITTER_TIERS.map((tier) => {
                    const tierEntries = tier.positions.map((pos) => ({ pos, starters: startersByPos[pos] ?? [] }));
                    const tierSubtotal = tierEntries.reduce((s, x) => s + x.starters.reduce((ss, e) => ss + e.war, 0), 0);
                    return (
                      <div key={tier.key} className="space-y-2">
                        {/* V2 — Per-tier mini-total: bigger gold number anchoring each tier */}
                        <div className="flex items-baseline justify-between border-b pb-1.5">
                          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground">{tier.label}</span>
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-xl font-bold tabular-nums text-[#D4AF37]" style={{ fontFamily: "'Oswald', sans-serif" }}>{tierSubtotal.toFixed(2)}</span>
                            <span className="text-[9px] uppercase tracking-wider text-muted-foreground">WAR</span>
                          </div>
                        </div>
                        {tierEntries.map(({ pos, starters }) => renderPosSlot(pos, starters))}
                      </div>
                    );
                  })}
                  {benchEntries.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-baseline justify-between border-b pb-1.5">
                        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground">Bench</span>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-xl font-bold tabular-nums text-muted-foreground" style={{ fontFamily: "'Oswald', sans-serif" }}>{benchWarTotal.toFixed(2)}</span>
                          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">WAR</span>
                        </div>
                      </div>
                      <div className="ml-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm text-muted-foreground">{benchEntries.length} {benchEntries.length === 1 ? "player" : "players"}</span>
                          <span className="font-semibold tabular-nums w-16 text-right">{benchWarTotal.toFixed(2)} WAR</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div className="h-full bg-muted-foreground/40" style={{ width: `${Math.min(100, (benchWarTotal / 4.0) * 100)}%` }} />
                        </div>
                      </div>
                    </div>
                  )}
                  {Object.keys(startersByPos).length === 0 && benchEntries.length === 0 && (
                    <div className="text-sm text-muted-foreground">No hitter contributions yet.</div>
                  )}

                  {/* V3 — Footer bar: starter WAR vs elite cap (room-to-grow gauge) */}
                  {Object.keys(startersByPos).length > 0 && (
                    <div className="pt-3 mt-2 border-t border-border/40">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Proximity to Elite</span>
                        <span className="text-xs tabular-nums">
                          <span className="font-semibold text-foreground">{starterTotalOwar.toFixed(2)}</span>
                          <span className="text-muted-foreground"> / {eliteCap.toFixed(1)}</span>
                          <span className="ml-2 font-semibold text-[#D4AF37]">{eliteCapPct.toFixed(0)}%</span>
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-[#D4AF37] transition-all" style={{ width: `${Math.min(100, eliteCapPct)}%` }} />
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Pitcher side — rotation individually, top 7 bullpen by pWAR.
                Same showcase layering as the Hitter card, but accents in blue
                (#3B82F6) for position-side consistency — hitters are gold, pitchers
                are blue across hero strip, mini-totals, and footer cap bar. */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={{ fontFamily: "'Oswald', sans-serif" }}>
                  Pitcher WAR by Role
                </CardTitle>
                <div className="text-xs text-muted-foreground">
                  Total pWAR (all pitchers): <span className="font-semibold text-foreground tabular-nums">{pitchingWarTotal.toFixed(2)}</span>
                </div>
              </CardHeader>
              <CardContent>
                {/* V1 — Hero strip: staff pWAR up top (gold accent border; big number stays blue for position coding) */}
                <div className="mb-5 px-4 py-3 rounded-md bg-card/40 border-l-[3px] border-l-[#D4AF37]">
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Staff pWAR</div>
                  <div className="flex items-baseline gap-3 mt-1 flex-wrap">
                    <span className="text-4xl font-bold tabular-nums text-[#D4AF37]" style={{ fontFamily: "'Oswald', sans-serif" }}>{pitchingWarTotal.toFixed(2)}</span>
                    {priorYearStaffDelta != null && (
                      <span className={`text-sm font-semibold tabular-nums ${Math.abs(priorYearStaffDelta) < 0.05 ? "text-muted-foreground" : priorYearStaffDelta > 0 ? "text-[hsl(var(--success))]" : "text-destructive"}`}>
                        {priorYearStaffDelta > 0 ? "+" : priorYearStaffDelta < 0 ? "−" : ""}{Math.abs(priorYearStaffDelta).toFixed(2)} vs {CURRENT_SEASON}
                      </span>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    {/* V2 — Per-section mini-total: bigger blue rotation subtotal */}
                    <div className="flex items-baseline justify-between border-b pb-1.5">
                      <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground">Starting Rotation</span>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-xl font-bold tabular-nums text-blue-500" style={{ fontFamily: "'Oswald', sans-serif" }}>{rotationWarTotal.toFixed(2)}</span>
                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground">WAR</span>
                      </div>
                    </div>
                    {rotation.length === 0 ? (
                      <div className="ml-2 text-sm italic text-muted-foreground">No starters assigned</div>
                    ) : (
                      rotation.map((p) => renderPitcherRow(p, true))
                    )}
                  </div>
                  <div className="space-y-2">
                    {/* V2 — Per-section mini-total: bigger blue bullpen subtotal (full pen) */}
                    <div className="flex items-baseline justify-between border-b pb-1.5">
                      <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground">
                        Bullpen
                        {bullpen.length > topBullpen.length && (
                          <span className="ml-2 text-[10px] font-medium normal-case tracking-normal text-muted-foreground">(top {topBullpen.length} of {bullpen.length} shown)</span>
                        )}
                      </span>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-xl font-bold tabular-nums text-blue-500" style={{ fontFamily: "'Oswald', sans-serif" }}>{bullpenWarTotal.toFixed(2)}</span>
                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground">WAR</span>
                      </div>
                    </div>
                    {topBullpen.length === 0 ? (
                      <div className="ml-2 text-sm italic text-muted-foreground">No relievers assigned</div>
                    ) : (
                      topBullpen.map((p) => renderPitcherRow(p, false))
                    )}
                  </div>

                  {/* V3 — Footer bar: staff pWAR vs elite cap (blue fill) */}
                  {(rotation.length > 0 || bullpen.length > 0) && (
                    <div className="pt-3 mt-2 border-t border-border/40">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Proximity to Elite</span>
                        <span className="text-xs tabular-nums">
                          <span className="font-semibold text-foreground">{pitchingWarTotal.toFixed(2)}</span>
                          <span className="text-muted-foreground"> / {pitcherEliteCap.toFixed(1)}</span>
                          <span className="ml-2 font-semibold text-blue-500">{pitcherEliteCapPct.toFixed(0)}%</span>
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.min(100, pitcherEliteCapPct)}%` }} />
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        );
      })()}

      {(() => {
        // Spending by Position Group — hitters first, then a Pitchers
        // section divider, then pitchers. Matches the WAR-by-Position card
        // labels: Premium / Skill / Power / Bench / [Pitchers] / SP / RP.
        const renderSpendRow = ([group, data]: [string, { count: number; nilTotal: number; warTotal: number }]) => {
          const pct = totalEffectiveNil > 0 ? (data.nilTotal / totalEffectiveNil) * 100 : 0;
          return (
            <div key={group}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">{group}</span>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-muted-foreground">{data.count} players</span>
                  <span className="font-semibold">${Math.round(data.nilTotal).toLocaleString()}</span>
                  <span className="text-muted-foreground text-xs w-12 text-right">{pct.toFixed(1)}%</span>
                </div>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
              </div>
            </div>
          );
        };
        return (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={{ fontFamily: "'Oswald', sans-serif" }}>Spending by Position Group</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {hittingGroups.map(renderSpendRow)}
                {pitchingGroups.length > 0 && (
                  <div className="flex items-center gap-3 pt-2 mt-2">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#D4AF37]" style={{ fontFamily: "'Oswald', sans-serif" }}>Pitchers</span>
                    <div className="flex-1 h-px bg-[#D4AF37]/30" />
                  </div>
                )}
                {pitchingGroups.map(renderSpendRow)}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {(() => {
        // Cost Efficiency — same hitters/pitchers split as Spending card.
        // Hitter rows first, then a Pitchers section divider row spanning
        // all columns, then pitcher rows.
        const renderEffRow = ([group, data]: [string, { count: number; nilTotal: number; warTotal: number }]) => (
          <tr key={group} className="border-b last:border-0">
            <td className="py-2 font-medium">{group}</td>
            <td className="py-2 text-right text-muted-foreground">{data.count}</td>
            <td className="py-2 text-right tabular-nums">${Math.round(data.nilTotal).toLocaleString()}</td>
            <td className="py-2 text-right tabular-nums">{data.warTotal.toFixed(2)}</td>
            <td className="py-2 text-right tabular-nums">{data.warTotal > 0 ? `$${Math.round(data.nilTotal / data.warTotal).toLocaleString()}` : "—"}</td>
            <td className="py-2 text-right tabular-nums">{data.count > 0 ? `$${Math.round(data.nilTotal / data.count).toLocaleString()}` : "—"}</td>
          </tr>
        );
        return (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={{ fontFamily: "'Oswald', sans-serif" }}>Cost Efficiency</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 text-xs text-muted-foreground font-medium">Group</th>
                    <th className="text-right py-2 text-xs text-muted-foreground font-medium">Players</th>
                    <th className="text-right py-2 text-xs text-muted-foreground font-medium">Total NIL</th>
                    <th className="text-right py-2 text-xs text-muted-foreground font-medium">Total WAR</th>
                    <th className="text-right py-2 text-xs text-muted-foreground font-medium">$/WAR</th>
                    <th className="text-right py-2 text-xs text-muted-foreground font-medium">NIL/Player</th>
                  </tr>
                </thead>
                <tbody>
                  {hittingGroups.map(renderEffRow)}
                  {pitchingGroups.length > 0 && (
                    <tr>
                      <td colSpan={6} className="pt-3 pb-1">
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#D4AF37]" style={{ fontFamily: "'Oswald', sans-serif" }}>Pitchers</span>
                          <div className="flex-1 h-px bg-[#D4AF37]/30" />
                        </div>
                      </td>
                    </tr>
                  )}
                  {pitchingGroups.map(renderEffRow)}
                </tbody>
              </table>
            </CardContent>
          </Card>
        );
      })()}
    </>
  );
}
