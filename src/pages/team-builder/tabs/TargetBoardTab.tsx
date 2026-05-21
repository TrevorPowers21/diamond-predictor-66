import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { BuildPlayer } from "../types";

type HitterTotals = {
  avg: number | null;
  obp: number | null;
  slg: number | null;
  wrcPlusAvg: number | null;
  totalProjectedNil: number;
  totalActualNil: number;
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

type PlayerSearchResult = {
  id?: string;
  first_name?: string;
  last_name?: string;
  team?: string | null;
  position?: string | null;
};

interface TargetBoardTabProps {
  targetPlayerSearchQuery: string;
  setTargetPlayerSearchQuery: (q: string) => void;
  targetPlayerSearchOpen: boolean;
  setTargetPlayerSearchOpen: (open: boolean) => void;
  filteredTargetPlayerSearch: PlayerSearchResult[];
  addPlayerFromTargetSearch: (p: PlayerSearchResult) => void;
  targetPositionPlayers: BuildPlayer[];
  targetPitchers: BuildPlayer[];
  rosterPlayers: BuildPlayer[];
  renderPlayerRow: (p: BuildPlayer, idx: number, globalIdx: number, pool?: "hitter" | "pitcher") => React.ReactNode;
  isProjectedStatus: (p: BuildPlayer) => boolean;
  projectedBudgetValue: (p: BuildPlayer) => number | null;
  targetPositionTableTotals: HitterTotals;
  targetPitcherTableTotals: PitcherTotals;
  totalBudget: number;
}

const normalizeName = (value: string | null | undefined) =>
  String(value || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();

export default function TargetBoardTab({
  targetPlayerSearchQuery,
  setTargetPlayerSearchQuery,
  targetPlayerSearchOpen,
  setTargetPlayerSearchOpen,
  filteredTargetPlayerSearch,
  addPlayerFromTargetSearch,
  targetPositionPlayers,
  targetPitchers,
  rosterPlayers,
  renderPlayerRow,
  isProjectedStatus,
  projectedBudgetValue,
  targetPositionTableTotals,
  targetPitcherTableTotals,
  totalBudget,
}: TargetBoardTabProps) {
  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={{ fontFamily: "'Oswald', sans-serif" }}>Add Player Target</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Input
              placeholder="Search any player by name, team, or position…"
              value={targetPlayerSearchQuery}
              onChange={(e) => { setTargetPlayerSearchQuery(e.target.value); setTargetPlayerSearchOpen(true); }}
              onFocus={() => setTargetPlayerSearchOpen(true)}
              onBlur={() => setTimeout(() => setTargetPlayerSearchOpen(false), 150)}
            />
            {targetPlayerSearchOpen && filteredTargetPlayerSearch.length > 0 && (
              <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-72 overflow-auto">
                {filteredTargetPlayerSearch.map((p, idx) => {
                  const stableKey = p.id
                    ? `db-${p.id}`
                    : `local-${normalizeName(`${p.first_name || ""} ${p.last_name || ""}`)}-${normalizeName(p.team || "")}-${normalizeName(p.position || "")}-${idx}`;
                  return (
                    <div
                      key={stableKey}
                      className="px-3 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground flex items-center justify-between gap-3"
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); void addPlayerFromTargetSearch(p); }}
                    >
                      <div className="min-w-0">
                        <div className="font-medium truncate">{p.first_name} {p.last_name}</div>
                        <div className="text-xs text-muted-foreground truncate">{p.team || "—"} • {p.position || "—"}</div>
                      </div>
                      <span className="text-[11px] px-2 py-0.5 rounded border border-border/70 text-muted-foreground shrink-0">
                        {p.position || "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {targetPlayerSearchQuery && filteredTargetPlayerSearch.length === 0 && (
              <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md px-3 py-2 text-sm text-muted-foreground">
                No players found
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={{ fontFamily: "'Oswald', sans-serif" }}>Target Position Players ({targetPositionPlayers.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[1200px]">
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-20 bg-muted/95 backdrop-blur-sm shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)] min-w-[180px]">Player</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Risk</TableHead>
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
              {targetPositionPlayers.length === 0 ? (
                <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground py-8">No target position players</TableCell></TableRow>
              ) : (
                targetPositionPlayers.map((p, i) => {
                  const globalIdx = rosterPlayers.indexOf(p);
                  return renderPlayerRow(p, i, globalIdx, "hitter");
                })
              )}
              <TableRow className="bg-muted/40 font-medium">
                <TableCell colSpan={6} className="text-right align-middle py-2 pr-3 font-semibold">Totals</TableCell>
                <TableCell className="font-mono text-sm font-semibold text-center py-2 whitespace-nowrap">
                  {targetPositionTableTotals.avg != null && targetPositionTableTotals.obp != null && targetPositionTableTotals.slg != null
                    ? `${targetPositionTableTotals.avg.toFixed(3)} / ${targetPositionTableTotals.obp.toFixed(3)} / ${targetPositionTableTotals.slg.toFixed(3)}`
                    : "—"}
                </TableCell>
                <TableCell className="font-mono text-sm font-semibold text-center py-2">
                  {targetPositionTableTotals.wrcPlusAvg != null ? targetPositionTableTotals.wrcPlusAvg.toFixed(0) : "—"}
                </TableCell>
                <TableCell className="font-mono text-sm font-semibold text-center py-2">
                  ${Math.round(targetPositionTableTotals.totalProjectedNil).toLocaleString()}
                </TableCell>
                <TableCell className="font-mono text-sm font-semibold text-center py-2">
                  {totalBudget > 0 ? `$${Math.round(targetPositionPlayers.filter(p => isProjectedStatus(p)).reduce((sum, p) => sum + (projectedBudgetValue(p) ?? 0), 0)).toLocaleString()}` : "—"}
                </TableCell>
                <TableCell className="font-mono text-sm font-semibold text-center py-2">
                  ${Math.round(targetPositionTableTotals.totalActualNil).toLocaleString()}
                </TableCell>
                <TableCell className="font-mono text-sm font-semibold text-center py-2">—</TableCell>
                <TableCell className="py-2"></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={{ fontFamily: "'Oswald', sans-serif" }}>Target Pitchers ({targetPitchers.length})</CardTitle>
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
              {targetPitchers.length === 0 ? (
                <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground py-8">No target pitchers</TableCell></TableRow>
              ) : (
                targetPitchers.map((p, i) => {
                  const globalIdx = rosterPlayers.indexOf(p);
                  return renderPlayerRow(p, i, globalIdx, "pitcher");
                })
              )}
              <TableRow className="bg-muted/40 font-medium">
                <TableCell colSpan={6} className="text-right align-middle py-2 pr-3 font-semibold">Totals</TableCell>
                <TableCell className="font-mono text-sm font-semibold text-center py-2 whitespace-nowrap">
                  {targetPitcherTableTotals.pEraAvg != null && targetPitcherTableTotals.pWhipAvg != null && targetPitcherTableTotals.pK9Avg != null && targetPitcherTableTotals.pBb9Avg != null
                    ? `${targetPitcherTableTotals.pEraAvg.toFixed(2)} / ${targetPitcherTableTotals.pWhipAvg.toFixed(2)} / ${targetPitcherTableTotals.pK9Avg.toFixed(2)} / ${targetPitcherTableTotals.pBb9Avg.toFixed(2)}`
                    : "—"}
                </TableCell>
                <TableCell className="font-mono text-sm font-semibold text-center py-2">
                  {targetPitcherTableTotals.pRvPlusAvg != null ? targetPitcherTableTotals.pRvPlusAvg.toFixed(0) : "—"}
                </TableCell>
                <TableCell className="font-mono text-sm font-semibold text-center py-2">
                  ${Math.round(targetPitcherTableTotals.totalProjectedNil).toLocaleString()}
                </TableCell>
                <TableCell className="font-mono text-sm font-semibold text-center py-2">
                  {totalBudget > 0 ? `$${Math.round(targetPitchers.filter(p => isProjectedStatus(p)).reduce((sum, p) => sum + (projectedBudgetValue(p) ?? 0), 0)).toLocaleString()}` : "—"}
                </TableCell>
                <TableCell className="font-mono text-sm font-semibold text-center py-2">
                  ${Math.round(targetPitcherTableTotals.totalActualNil).toLocaleString()}
                </TableCell>
                <TableCell className="font-mono text-sm font-semibold text-center py-2">
                  {targetPitcherTableTotals.totalPWar.toFixed(2)}
                </TableCell>
                <TableCell className="py-2"></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
