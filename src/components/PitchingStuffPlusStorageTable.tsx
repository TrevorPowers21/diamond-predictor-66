import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Upload, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { parseCsvLine, normalize } from "@/lib/csvUtils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type StuffRow = {
  id: string;
  playerName: string;
  team: string;
  hand: string;
  pitchType: string;
  stuffPlus: number | null;
  usagePct: number | null;
  whiffPct: number | null;
  pitchCount: number | null;
  totalPitches: number | null;
  overallStuffPlus: number | null;
};

type GroupedStuffRow = {
  id: string;
  playerName: string;
  team: string;
  hand: string;
  totalPitches: number | null;
  overallStuffPlus: number | null;
  pitches: Partial<Record<(typeof PITCH_DISPLAY_ORDER)[number], StuffRow>>;
};

const PAGE_SIZE = 100;
const PITCH_DISPLAY_ORDER = ["4S", "SI", "SL", "SWP", "CB", "CT", "CH", "SP"] as const;
const PITCH_TYPE_LABELS: Record<string, string> = {
  "4S": "4-Seam",
  SI: "Sinker",
  SL: "Slider",
  SWP: "Sweeper",
  CB: "Curveball",
  CT: "Cutter",
  CH: "Changeup",
  SP: "Splitter",
};

const isPitcherPosition = (v: string | null | undefined) => /^(SP|RP|CL|P|RHP|LHP)/i.test((v || "").trim());

const parseNumeric = (raw: string | undefined) => {
  const value = (raw || "").trim();
  if (!value || value === "-") return null;
  const n = Number(value.replace(/[%,$]/g, ""));
  return Number.isFinite(n) ? n : null;
};

const getPageWindow = (current: number, total: number) => {
  const maxButtons = 7;
  if (total <= maxButtons) return Array.from({ length: total }, (_, i) => i + 1);
  let start = Math.max(1, current - 3);
  let end = Math.min(total, start + maxButtons - 1);
  start = Math.max(1, end - maxButtons + 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
};

const pitchOrderIndex = (pitchType: string) => {
  const idx = PITCH_DISPLAY_ORDER.indexOf(pitchType as typeof PITCH_DISPLAY_ORDER[number]);
  return idx === -1 ? 999 : idx;
};

export default function PitchingStuffPlusStorageTable({ season }: { season: "2025" | "2026" }) {
  const storageKey = `pitching_stuff_plus_storage_${season}_v1`;
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [rows, setRows] = useState<StuffRow[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as { rows?: StuffRow[] };
      return Array.isArray(parsed.rows) ? parsed.rows : [];
    } catch {
      return [];
    }
  });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [syncing, setSyncing] = useState(false);

  const { data: players = [] } = useQuery({
    queryKey: ["pitching-stuff-player-directory"],
    queryFn: async () => {
      const allPlayers: Array<{ id: string; first_name: string; last_name: string; team: string | null; position: string | null; handedness: string | null }> = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("players")
          .select("id, first_name, last_name, team, position, handedness")
          .order("id", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const batch = data || [];
        allPlayers.push(...batch);
        if (batch.length < pageSize) break;
        from += pageSize;
      }
      return allPlayers;
    },
  });

  const playerLookup = useMemo(() => {
    const byName = new Map<string, Array<{ id: string; team: string; handedness: string | null }>>();
    for (const p of players) {
      if (!isPitcherPosition(p.position)) continue;
      const fullName = `${p.first_name || ""} ${p.last_name || ""}`.trim();
      const key = normalize(fullName);
      if (!key) continue;
      const existing = byName.get(key) || [];
      existing.push({ id: p.id, team: p.team || "", handedness: p.handedness });
      byName.set(key, existing);
    }
    return byName;
  }, [players]);

  const persist = (nextRows: StuffRow[]) => {
    setRows(nextRows);
    try {
      localStorage.setItem(storageKey, JSON.stringify({ rows: nextRows }));
    } catch {
      // ignore local storage issues
    }
  };

  useEffect(() => {
    setPage(1);
  }, [season, search]);

  const importCsv = async (file: File) => {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length < 2) throw new Error("CSV has no data rows.");

    const header = parseCsvLine(lines[0]);
    const normalizedHeader = header.map((h) => normalize(h));
    const playerNameIdx = normalizedHeader.findIndex((h) => h === "player name");
    const handIdx = normalizedHeader.findIndex((h) => h === "hand");
    const totalPitchesIdx = normalizedHeader.findIndex((h) => h === "total pitches");
    const overallStuffIdx = normalizedHeader.findIndex((h) => h === "overall stuff");
    if (playerNameIdx < 0 || handIdx < 0) throw new Error("CSV must include Player Name and Hand columns.");

    const pitchDefs: Array<{ pitchType: string; stuffCol: number; countCol: number }> = [
      { pitchType: "4S", stuffCol: normalizedHeader.findIndex((h) => h === "4s stuff"), countCol: normalizedHeader.findIndex((h) => h === "4s p") },
      { pitchType: "SI", stuffCol: normalizedHeader.findIndex((h) => h === "si stuff"), countCol: normalizedHeader.findIndex((h) => h === "si p") },
      { pitchType: "SL", stuffCol: normalizedHeader.findIndex((h) => h === "sl stuff"), countCol: normalizedHeader.findIndex((h) => h === "sl p") },
      { pitchType: "SWP", stuffCol: normalizedHeader.findIndex((h) => h === "swp stuff"), countCol: normalizedHeader.findIndex((h) => h === "swp p") },
      { pitchType: "CB", stuffCol: normalizedHeader.findIndex((h) => h === "cb stuff"), countCol: normalizedHeader.findIndex((h) => h === "cb p") },
      { pitchType: "CT", stuffCol: normalizedHeader.findIndex((h) => h === "ct stuff"), countCol: normalizedHeader.findIndex((h) => h === "ct p") },
      { pitchType: "CH", stuffCol: normalizedHeader.findIndex((h) => h === "ch stuff"), countCol: normalizedHeader.findIndex((h) => h === "ch p") },
      { pitchType: "SP", stuffCol: normalizedHeader.findIndex((h) => h === "sp stuff"), countCol: normalizedHeader.findIndex((h) => h === "sp p") },
    ].filter((def) => def.stuffCol >= 0 && def.countCol >= 0);
    if (pitchDefs.length === 0) throw new Error("CSV does not include pitch Stuff+/count columns.");

    const parsedRows: StuffRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      const playerName = (cols[playerNameIdx] || "").trim();
      const hand = (cols[handIdx] || "").trim().toUpperCase();
      if (!playerName) continue;
      const totalPitches = totalPitchesIdx >= 0 ? parseNumeric(cols[totalPitchesIdx]) : null;
      const overallStuffPlus = overallStuffIdx >= 0 ? parseNumeric(cols[overallStuffIdx]) : null;
      const candidates = playerLookup.get(normalize(playerName)) || [];
      const matched = candidates.find((c) => normalize(c.handedness) === normalize(hand)) || candidates[0];
      const team = matched?.team || "";

      for (const def of pitchDefs) {
        const pitchCount = parseNumeric(cols[def.countCol]);
        const stuffPlus = parseNumeric(cols[def.stuffCol]);
        if ((pitchCount == null || pitchCount <= 0) && stuffPlus == null) continue;
        parsedRows.push({
          id: `${season}-${playerName}-${hand}-${def.pitchType}`,
          playerName,
          team,
          hand,
          pitchType: def.pitchType,
          stuffPlus,
          usagePct: pitchCount != null && totalPitches != null && totalPitches > 0 ? Number((((pitchCount / totalPitches) * 100)).toFixed(2)) : null,
          whiffPct: null,
          pitchCount: pitchCount == null ? null : Math.round(pitchCount),
          totalPitches: totalPitches == null ? null : Math.round(totalPitches),
          overallStuffPlus,
        });
      }
    }

    parsedRows.sort((a, b) => {
      const playerComp = a.playerName.localeCompare(b.playerName);
      if (playerComp !== 0) return playerComp;
      return pitchOrderIndex(a.pitchType) - pitchOrderIndex(b.pitchType);
    });
    persist(parsedRows);
    toast.success(`Imported ${parsedRows.length} Stuff+ pitch rows.`);
  };

  const syncToSupabase = async () => {
    if (rows.length === 0) {
      toast.error("No Stuff+ rows to sync.");
      return;
    }
    setSyncing(true);
    try {
      const seasonNum = Number(season);
      const upserts = rows.map((row) => {
        const candidates = playerLookup.get(normalize(row.playerName)) || [];
        const matched = candidates.find((c) => normalize(c.handedness) === normalize(row.hand)) || candidates[0];
        return {
          season: seasonNum,
          player_id: matched?.id || null,
          player_name: row.playerName,
          hand: row.hand || null,
          pitch_type: row.pitchType,
          stuff_plus: row.stuffPlus,
          usage_pct: row.usagePct,
          whiff_pct: row.whiffPct,
          pitch_count: row.pitchCount,
          total_pitches: row.totalPitches,
          overall_stuff_plus: row.overallStuffPlus,
          source_file: "pitching_stuff_plus_storage",
        };
      });
      const deduped = new Map<string, Record<string, unknown>>();
      for (const row of upserts) deduped.set(`${row.season}|${normalize(row.player_name)}|${normalize(row.hand)}|${row.pitch_type}`, row);
      const unique = Array.from(deduped.values());
      const chunkSize = 500;
      for (let i = 0; i < unique.length; i += chunkSize) {
        const batch = unique.slice(i, i + chunkSize);
        const { error } = await supabase.from("pitch_arsenal" as any).upsert(batch as any, {
          onConflict: "season,player_name,hand,pitch_type",
        });
        if (error) throw error;
      }
      toast.success(`Synced ${unique.length} Stuff+ rows to Supabase.`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to sync Stuff+ rows");
    } finally {
      setSyncing(false);
    }
  };

  const groupedRows = useMemo<GroupedStuffRow[]>(() => {
    const map = new Map<string, GroupedStuffRow>();
    for (const row of rows) {
      const key = `${normalize(row.playerName)}|${normalize(row.hand)}`;
      const existing = map.get(key) || {
        id: key,
        playerName: row.playerName,
        team: row.team,
        hand: row.hand,
        totalPitches: row.totalPitches,
        overallStuffPlus: row.overallStuffPlus,
        pitches: {},
      };
      existing.playerName = existing.playerName || row.playerName;
      existing.team = existing.team || row.team;
      existing.hand = existing.hand || row.hand;
      existing.totalPitches = existing.totalPitches ?? row.totalPitches;
      existing.overallStuffPlus = existing.overallStuffPlus ?? row.overallStuffPlus;
      if (PITCH_DISPLAY_ORDER.includes(row.pitchType as (typeof PITCH_DISPLAY_ORDER)[number])) {
        existing.pitches[row.pitchType as (typeof PITCH_DISPLAY_ORDER)[number]] = row;
      }
      map.set(key, existing);
    }
    return Array.from(map.values()).sort((a, b) => a.playerName.localeCompare(b.playerName));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groupedRows;
    return groupedRows.filter((row) =>
      [row.playerName, row.team, row.hand].some((value) => String(value || "").toLowerCase().includes(q)),
    );
  }, [groupedRows, search]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const pagedRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [filteredRows, safePage]);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-base">Pitching Stuff+ Storage ({season})</CardTitle>
          <CardDescription>One row per player with pitch-specific pitch count, usage%, whiff%, and Stuff+ spread horizontally.</CardDescription>
        </div>
        <div className="flex w-full sm:w-auto items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                await importCsv(file);
              } catch (err: any) {
                toast.error(err?.message || "Failed to import Stuff+ CSV");
              } finally {
                e.currentTarget.value = "";
              }
            }}
          />
          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4 mr-2" />
            Import CSV
          </Button>
          <Button type="button" onClick={syncToSupabase} disabled={syncing || rows.length === 0}>
            {syncing ? "Syncing..." : "Sync to Supabase"}
          </Button>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing {filteredRows.length ? (safePage - 1) * PAGE_SIZE + 1 : 0}-{Math.min(safePage * PAGE_SIZE, filteredRows.length)} of {filteredRows.length} rows
          </span>
          <div className="flex items-center gap-1">
            {getPageWindow(safePage, totalPages).map((p) => (
              <Button
                key={`pitching-stuff-page-${p}`}
                size="sm"
                variant={p === safePage ? "secondary" : "ghost"}
                className="h-7 min-w-7 px-2 text-xs"
                onClick={() => setPage(p)}
              >
                {p}
              </Button>
            ))}
          </div>
        </div>
        <div className="max-h-[620px] overflow-y-auto overflow-x-auto">
          <Table className="table-fixed min-w-[4200px]">
            <TableHeader className="sticky top-0 z-20 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
              <TableRow>
                <TableHead className="sticky left-0 z-30 bg-background min-w-[220px] w-[220px]">Player</TableHead>
                <TableHead className="min-w-[170px] w-[170px]">Team</TableHead>
                <TableHead className="min-w-[80px] w-[80px]">Hand</TableHead>
                {PITCH_DISPLAY_ORDER.flatMap((pitch) => ([
                  <TableHead key={`${pitch}-label`} className="min-w-[120px] w-[120px]">{pitch}</TableHead>,
                  <TableHead key={`${pitch}-count`} className="text-right min-w-[100px] w-[100px]">{pitch} Ct</TableHead>,
                  <TableHead key={`${pitch}-usage`} className="text-right min-w-[100px] w-[100px]">{pitch} Usage%</TableHead>,
                  <TableHead key={`${pitch}-whiff`} className="text-right min-w-[100px] w-[100px]">{pitch} Whiff%</TableHead>,
                  <TableHead key={`${pitch}-stuff`} className="text-right min-w-[100px] w-[100px]">{pitch} Stf+</TableHead>,
                ]))}
                <TableHead className="text-right min-w-[110px] w-[110px]">Total Pitches</TableHead>
                <TableHead className="text-right min-w-[120px] w-[120px]">Overall Stuff+</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedRows.length ? (
                pagedRows.map((row) => {
                  const candidates = playerLookup.get(normalize(row.playerName)) || [];
                  const matched = candidates.find((c) => normalize(c.handedness) === normalize(row.hand)) || candidates[0];
                  const playerId = matched?.id || null;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="sticky left-0 z-10 bg-background font-medium min-w-[220px]">
                        {playerId ? (
                          <Link to={`/dashboard/pitcher/${playerId}`} className="text-primary underline-offset-4 hover:underline">
                            {row.playerName}
                          </Link>
                        ) : (
                          row.playerName
                        )}
                      </TableCell>
                      <TableCell>{row.team || "—"}</TableCell>
                      <TableCell>{row.hand || "—"}</TableCell>
                      {PITCH_DISPLAY_ORDER.flatMap((pitch) => ([
                        <TableCell key={`${row.id}-${pitch}-label`}>
                          {row.pitches[pitch] ? (PITCH_TYPE_LABELS[pitch] || pitch) : "—"}
                        </TableCell>,
                        <TableCell key={`${row.id}-${pitch}-count`} className="text-right font-mono">
                          {row.pitches[pitch]?.pitchCount == null ? "—" : Math.round(row.pitches[pitch]!.pitchCount!).toString()}
                        </TableCell>,
                        <TableCell key={`${row.id}-${pitch}-usage`} className="text-right font-mono">
                          {row.pitches[pitch]?.usagePct == null ? "—" : `${row.pitches[pitch]!.usagePct!.toFixed(1)}%`}
                        </TableCell>,
                        <TableCell key={`${row.id}-${pitch}-whiff`} className="text-right font-mono">
                          {row.pitches[pitch]?.whiffPct == null ? "—" : `${row.pitches[pitch]!.whiffPct!.toFixed(1)}%`}
                        </TableCell>,
                        <TableCell key={`${row.id}-${pitch}-stuff`} className="text-right font-mono">
                          {row.pitches[pitch]?.stuffPlus == null ? "—" : Math.round(row.pitches[pitch]!.stuffPlus!).toString()}
                        </TableCell>,
                      ]))}
                      <TableCell className="text-right font-mono">{row.totalPitches == null ? "—" : Math.round(row.totalPitches).toString()}</TableCell>
                      <TableCell className="text-right font-mono">{row.overallStuffPlus == null ? "—" : Math.round(row.overallStuffPlus).toString()}</TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={45} className="py-8 text-center text-muted-foreground">
                    No {season} Stuff+ rows found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
