import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronDown, ChevronUp } from "lucide-react";
import { formatWithCommas, parseCommaNumber } from "@/lib/utils";
import PlayerTableRow, { type PlayerTableRowSharedProps } from "../PlayerTableRow";
import type { BuildPlayer } from "../types";

const POSITION_SLOTS = ["C", "1B", "2B", "SS", "3B", "LF", "CF", "RF", "DH"] as const;

type HitterTotals = {
  avg: number | null;
  obp: number | null;
  slg: number | null;
  wrcPlusAvg: number | null;
  totalProjectedNil: number;
  totalActualNil: number;
  totalOWar: number;
};

type PitcherTotals = {
  pEraAvg: number | null;
  pWhipAvg: number | null;
  pK9Avg: number | null;
  pBb9Avg: number | null;
  pRvPlusAvg: number | null;
  totalProjectedNil: number;
  totalActualNil: number;
  totalPWar: number;
};

type ProjectionTier = "" | "developmental" | "role_player" | "contributor" | "immediate_impact";

interface RosterTabProps {
  incomingName: string;
  setIncomingName: (name: string) => void;
  incomingPosition: string;
  setIncomingPosition: (pos: string) => void;
  incomingNil: number;
  setIncomingNil: (nil: number) => void;
  incomingProjectionTier: ProjectionTier;
  setIncomingProjectionTier: (t: ProjectionTier) => void;
  addIncomingFreshman: () => void;
  positionPlayers: BuildPlayer[];
  pitchers: BuildPlayer[];
  rosterPlayers: BuildPlayer[];
  playerRowProps: PlayerTableRowSharedProps;
  isProjectedStatus: (p: BuildPlayer) => boolean;
  projectedBudgetValue: (p: BuildPlayer) => number | null;
  positionTableTotals: HitterTotals;
  pitcherTableTotals: PitcherTotals;
  totalBudget: number;
  isAdmin: boolean;
  nilEquationOpen: boolean;
  setNilEquationOpen: React.Dispatch<React.SetStateAction<boolean>>;
  metricsUploadOpen: boolean;
  setMetricsUploadOpen: React.Dispatch<React.SetStateAction<boolean>>;
  totalRosterPlayerScore: number;
  totalEffectiveNil: number;
}

export default function RosterTab({
  incomingName,
  setIncomingName,
  incomingPosition,
  setIncomingPosition,
  incomingNil,
  setIncomingNil,
  incomingProjectionTier,
  setIncomingProjectionTier,
  addIncomingFreshman,
  positionPlayers,
  pitchers,
  rosterPlayers,
  playerRowProps,
  isProjectedStatus,
  projectedBudgetValue,
  positionTableTotals,
  pitcherTableTotals,
  totalBudget,
  isAdmin,
  nilEquationOpen,
  setNilEquationOpen,
  metricsUploadOpen,
  setMetricsUploadOpen,
  totalRosterPlayerScore,
  totalEffectiveNil,
}: RosterTabProps) {
  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={{ fontFamily: "'Oswald', sans-serif" }}>Add Incoming Freshman</CardTitle>
          <CardDescription>Add a player with no projected stats. Value can still be tracked.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
            <div>
              <Label className="text-xs mb-1 block">Player Name</Label>
              <Input
                value={incomingName}
                onChange={(e) => setIncomingName(e.target.value)}
                placeholder="First Last"
              />
            </div>
            <div>
              <Label className="text-xs mb-1 block">Position</Label>
              <Select value={incomingPosition || "none"} onValueChange={(v) => setIncomingPosition(v === "none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select position" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {[...POSITION_SLOTS, "TWP"].map((p) => (
                    <SelectItem key={`incoming-${p}`} value={p}>{p}</SelectItem>
                  ))}
                  <SelectItem value="RHP">RHP</SelectItem>
                  <SelectItem value="LHP">LHP</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Projection Tier</Label>
              <Select
                value={incomingProjectionTier || "none"}
                onValueChange={(v) => setIncomingProjectionTier(v === "none" ? "" : (v as "developmental" | "role_player" | "contributor" | "immediate_impact"))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select tier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  <SelectItem value="developmental">Developmental</SelectItem>
                  <SelectItem value="role_player">Role Player</SelectItem>
                  <SelectItem value="contributor">Contributor</SelectItem>
                  <SelectItem value="immediate_impact">Immediate Impact</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Initial Value ($)</Label>
              <Input
                type="text"
                inputMode="numeric"
                value={formatWithCommas(incomingNil)}
                onChange={(e) => setIncomingNil(parseCommaNumber(e.target.value))}
              />
            </div>
            <div>
              <Button onClick={addIncomingFreshman}>Add To Roster</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Position Players */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={{ fontFamily: "'Oswald', sans-serif" }}>Position Players ({positionPlayers.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[1200px]">
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-20 bg-muted/95 backdrop-blur-sm shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)] min-w-[180px]">Player</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Pos</TableHead>
                <TableHead>Position Change</TableHead>
                <TableHead>Dev Agg</TableHead>
                <TableHead>Depth</TableHead>
                <TableHead className="text-center min-w-[220px] whitespace-nowrap">pAVG/pOBP/pSLG</TableHead>
                <TableHead className="text-center">wRC+</TableHead>
                <TableHead className="text-center">Market Value ($)</TableHead>
                <TableHead className="text-center">Projected Value ($)</TableHead>
                <TableHead className="text-center">Actual Value ($)</TableHead>
                <TableHead className="text-center">oWAR</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {positionPlayers.length === 0 ? (
                <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground py-8">No position players added</TableCell></TableRow>
              ) : (
                positionPlayers.map((p, i) => {
                  const globalIdx = rosterPlayers.indexOf(p);
                  return <PlayerTableRow key={globalIdx} p={p} idx={i} globalIdx={globalIdx} pool="hitter" {...playerRowProps} />;
                })
              )}
              <TableRow className="bg-muted/40 font-medium">
                <TableCell colSpan={6} className="text-right align-middle py-2 pr-3 font-semibold">Totals</TableCell>
                <TableCell className="font-mono text-sm font-semibold text-center py-2 whitespace-nowrap">
                  {positionTableTotals.avg != null && positionTableTotals.obp != null && positionTableTotals.slg != null
                    ? `${positionTableTotals.avg.toFixed(3)} / ${positionTableTotals.obp.toFixed(3)} / ${positionTableTotals.slg.toFixed(3)}`
                    : "—"}
                </TableCell>
                <TableCell className="font-mono text-sm font-semibold text-center py-2">
                  {positionTableTotals.wrcPlusAvg != null ? positionTableTotals.wrcPlusAvg.toFixed(0) : "—"}
                </TableCell>
                <TableCell className="font-mono text-sm font-semibold text-center py-2">
                  ${Math.round(positionTableTotals.totalProjectedNil).toLocaleString()}
                </TableCell>
                <TableCell className="font-mono text-sm font-semibold text-center py-2">
                  {totalBudget > 0 ? `$${Math.round(positionPlayers.filter(p => isProjectedStatus(p)).reduce((sum, p) => sum + (projectedBudgetValue(p) ?? 0), 0)).toLocaleString()}` : "—"}
                </TableCell>
                <TableCell className="font-mono text-sm font-semibold text-center py-2">
                  ${Math.round(positionTableTotals.totalActualNil).toLocaleString()}
                </TableCell>
                <TableCell className="font-mono text-sm font-semibold text-center py-2">
                  {positionTableTotals.totalOWar.toFixed(2)}
                </TableCell>
                <TableCell className="py-2"></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pitchers */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={{ fontFamily: "'Oswald', sans-serif" }}>Pitchers ({pitchers.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[1200px]">
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-20 bg-muted/95 backdrop-blur-sm shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)] min-w-[180px]">Player</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Pos</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Dev Agg</TableHead>
                <TableHead>Depth</TableHead>
                <TableHead className="text-center min-w-[240px] whitespace-nowrap">pERA/pWHIP/pK/9/pBB/9</TableHead>
                <TableHead className="text-center">pRV+</TableHead>
                <TableHead className="text-center">Market Value ($)</TableHead>
                <TableHead className="text-center">Projected Value ($)</TableHead>
                <TableHead className="text-center">Actual Value ($)</TableHead>
                <TableHead className="text-center">pWAR</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pitchers.length === 0 ? (
                <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground py-8">No pitchers added</TableCell></TableRow>
              ) : (
                pitchers.map((p, i) => {
                  const globalIdx = rosterPlayers.indexOf(p);
                  return <PlayerTableRow key={globalIdx} p={p} idx={i} globalIdx={globalIdx} pool="pitcher" {...playerRowProps} />;
                })
              )}
              <TableRow className="bg-muted/40 font-medium">
                <TableCell colSpan={6} className="text-right align-middle py-2 pr-3 font-semibold">Totals</TableCell>
                <TableCell className="font-mono text-sm font-semibold text-center py-2 whitespace-nowrap">
                  {pitcherTableTotals.pEraAvg != null && pitcherTableTotals.pWhipAvg != null && pitcherTableTotals.pK9Avg != null && pitcherTableTotals.pBb9Avg != null
                    ? `${pitcherTableTotals.pEraAvg.toFixed(2)} / ${pitcherTableTotals.pWhipAvg.toFixed(2)} / ${pitcherTableTotals.pK9Avg.toFixed(2)} / ${pitcherTableTotals.pBb9Avg.toFixed(2)}`
                    : "—"}
                </TableCell>
                <TableCell className="font-mono text-sm font-semibold text-center py-2">
                  {pitcherTableTotals.pRvPlusAvg != null ? pitcherTableTotals.pRvPlusAvg.toFixed(0) : "—"}
                </TableCell>
                <TableCell className="font-mono text-sm font-semibold text-center py-2">
                  ${Math.round(pitcherTableTotals.totalProjectedNil).toLocaleString()}
                </TableCell>
                <TableCell className="font-mono text-sm font-semibold text-center py-2">
                  {totalBudget > 0 ? `$${Math.round(pitchers.filter(p => isProjectedStatus(p)).reduce((sum, p) => sum + (projectedBudgetValue(p) ?? 0), 0)).toLocaleString()}` : "—"}
                </TableCell>
                <TableCell className="font-mono text-sm font-semibold text-center py-2">
                  ${Math.round(pitcherTableTotals.totalActualNil).toLocaleString()}
                </TableCell>
                <TableCell className="font-mono text-sm font-semibold text-center py-2">
                  {pitcherTableTotals.totalPWar.toFixed(2)}
                </TableCell>
                <TableCell className="py-2"></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Projected NIL Equation — admin only */}
      {isAdmin && (
        <Card>
          <CardHeader className="pb-3 cursor-pointer select-none" onClick={() => setNilEquationOpen(o => !o)}>
            <div className="flex items-center justify-between">
              <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={{ fontFamily: "'Oswald', sans-serif" }}>Projected NIL Equation</CardTitle>
              {nilEquationOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </CardHeader>
          {nilEquationOpen && (
            <>
              <CardContent className="pt-0 pb-3 space-y-1">
                <CardDescription>
                  Player Score = oWAR × PTM × PVF; Projected NIL = Player Score × $/oWAR
                </CardDescription>
                <p className="text-xs text-muted-foreground">
                  Team budget is used to track fit: Sum(NIL used for returners + targets) vs Total Budget.
                </p>
                <p className="text-xs text-muted-foreground">
                  Position Change uses PVF for valuation. Updating Position Change recalculates Player Score and Projected NIL automatically.
                </p>
              </CardContent>
              <CardContent className="flex flex-col gap-3 text-sm md:flex-row md:items-center md:justify-between pt-0">
                <div className="text-muted-foreground">
                  Total Roster Player Score: <span className="font-mono text-foreground">{totalRosterPlayerScore.toFixed(2)}</span>
                </div>
                <div className="text-muted-foreground">
                  NIL Used Total (Returners + Targets): <span className="font-mono text-foreground">${Math.round(totalEffectiveNil).toLocaleString()}</span>
                </div>
              </CardContent>
            </>
          )}
        </Card>
      )}

      {/* Team-Only Power Metrics Upload */}
      <Card>
        <CardHeader className="pb-3 cursor-pointer select-none" onClick={() => setMetricsUploadOpen(o => !o)}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={{ fontFamily: "'Oswald', sans-serif" }}>Team-Only Power Metrics Upload <span className="text-xs font-normal text-muted-foreground italic ml-2">Coming soon</span></CardTitle>
            {metricsUploadOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </CardHeader>
        {metricsUploadOpen && (
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <p className="text-sm text-muted-foreground italic">Coming soon</p>
          </CardContent>
        )}
      </Card>
    </>
  );
}
