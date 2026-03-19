import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, Search } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { readPitchingWeights } from "@/lib/pitchingEquations";

type PitchingStorageRow = {
  id: string;
  values: string[];
};

const MAX_COLS = 9; // Columns A-I only
const FIXED_HEADERS = ["Player Name", "Team", "Handedness", "ERA", "FIP", "WHIP", "K/9", "BB/9", "HR/9"];
const NCAA_BASELINES = {
  era: 6.14,
  fip: 5.07,
  whip: 1.62,
  k9: 8.22,
  bb9: 4.58,
  hr9: 1.1,
};

const parseCsvLine = (line: string) => {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        cur += "\"";
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out.map((v) => v.replace(/^"(.*)"$/, "$1").trim());
};

const normalizeHandedness = (value: string) => {
  const v = value.trim().toUpperCase();
  if (v === "R" || v === "RH" || v === "RHP") return "RHP";
  if (v === "L" || v === "LH" || v === "LHP") return "LHP";
  return value;
};

const normalize = (v: string | null | undefined) =>
  (v || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

const toNum = (v: string | null | undefined) => {
  if (v == null) return null;
  const n = Number(String(v).replace(/[%,$]/g, "").trim());
  return Number.isFinite(n) ? n : null;
};

const calcPlus = (baseline: number, value: number | null, invert = false) => {
  if (value == null || value === 0) return null;
  const raw = invert ? (value / baseline) * 100 : (baseline / value) * 100;
  return Number.isFinite(raw) ? Math.round(raw) : null;
};

const calcEraPlus = (era: number | null, ncaaAvgEra: number, ncaaEraSd: number, scale: number) => {
  if (era == null || ncaaEraSd === 0) return null;
  const raw = 100 + (((ncaaAvgEra - era) / ncaaEraSd) * scale);
  return Number.isFinite(raw) ? Math.round(raw) : null;
};

const calcFipPlus = (fip: number | null, ncaaAvgFip: number, ncaaFipSd: number, scale: number) => {
  if (fip == null || ncaaFipSd === 0) return null;
  const raw = 100 + (((ncaaAvgFip - fip) / ncaaFipSd) * scale);
  return Number.isFinite(raw) ? Math.round(raw) : null;
};

const calcWhipPlus = (whip: number | null, ncaaAvgWhip: number, ncaaWhipSd: number, scale: number) => {
  if (whip == null || ncaaWhipSd === 0) return null;
  const raw = 100 + (((ncaaAvgWhip - whip) / ncaaWhipSd) * scale);
  return Number.isFinite(raw) ? Math.round(raw) : null;
};

const calcK9Plus = (k9: number | null, ncaaAvgK9: number, ncaaK9Sd: number, scale: number) => {
  if (k9 == null || ncaaK9Sd === 0) return null;
  const raw = 100 + (((k9 - ncaaAvgK9) / ncaaK9Sd) * scale);
  return Number.isFinite(raw) ? Math.round(raw) : null;
};

const calcBb9Plus = (bb9: number | null, ncaaAvgBb9: number, ncaaBb9Sd: number, scale: number) => {
  if (bb9 == null || ncaaBb9Sd === 0) return null;
  const raw = 100 + (((ncaaAvgBb9 - bb9) / ncaaBb9Sd) * scale);
  return Number.isFinite(raw) ? Math.round(raw) : null;
};

const calcHr9Plus = (hr9: number | null, ncaaAvgHr9: number, ncaaHr9Sd: number, scale: number) => {
  if (hr9 == null || ncaaHr9Sd === 0) return null;
  const raw = 100 + (((ncaaAvgHr9 - hr9) / ncaaHr9Sd) * scale);
  return Number.isFinite(raw) ? Math.round(raw) : null;
};

const isEmbeddedHeaderRow = (values: string[]) => {
  const v0 = (values[0] || "").trim().toLowerCase();
  const v1 = (values[1] || "").trim().toLowerCase();
  const v2 = (values[2] || "").trim().toLowerCase();
  return v0 === "player name" && v1 === "team" && v2 === "handedness";
};

const PAGE_SIZE = 100;
const getPageWindow = (currentPage: number, totalPages: number) => {
  const maxButtons = 7;
  if (totalPages <= maxButtons) return Array.from({ length: totalPages }, (_, i) => i + 1);
  let start = Math.max(1, currentPage - 3);
  let end = Math.min(totalPages, start + maxButtons - 1);
  start = Math.max(1, end - maxButtons + 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
};

export default function PitchingStatsStorageTable({ season }: { season: "2025" | "2026" }) {
  const storageKey = `pitching_stats_storage_${season}_v1`;
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [headers, setHeaders] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return [...FIXED_HEADERS];
      const parsed = JSON.parse(raw) as { headers?: string[] };
      if (!Array.isArray(parsed.headers)) return [...FIXED_HEADERS];
      return parsed.headers.slice(0, MAX_COLS);
    } catch {
      return [...FIXED_HEADERS];
    }
  });
  const [rows, setRows] = useState<PitchingStorageRow[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as { rows?: PitchingStorageRow[] };
      return Array.isArray(parsed.rows) ? parsed.rows : [];
    } catch {
      return [];
    }
  });
  const [weights] = useState(() => readPitchingWeights());

  const { data: players = [] } = useQuery({
    queryKey: ["pitching-storage-player-directory"],
    queryFn: async () => {
      const allPlayers: Array<{ id: string; first_name: string; last_name: string; team: string | null }> = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("players")
          .select("id, first_name, last_name, team")
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
    const byNameTeam = new Map<string, { id: string }>();
    const byName = new Map<string, { id: string }>();
    const byLastFirstInitial = new Map<string, { id: string }>();
    for (const p of players) {
      const first = `${p.first_name || ""}`.trim();
      const last = `${p.last_name || ""}`.trim();
      const fullName = `${first} ${last}`.trim();
      const reversedName = `${last} ${first}`.trim();
      const nameKey = normalize(fullName);
      const reversedNameKey = normalize(reversedName);
      const teamKey = normalize(p.team);
      const key = `${nameKey}|${teamKey}`;
      if (nameKey && !byName.has(nameKey)) byName.set(nameKey, { id: p.id });
      if (reversedNameKey && !byName.has(reversedNameKey)) byName.set(reversedNameKey, { id: p.id });
      if (nameKey && teamKey && !byNameTeam.has(key)) byNameTeam.set(key, { id: p.id });
      if (last) {
        const firstInitial = first.slice(0, 1).toLowerCase();
        const lfKey = normalize(`${last} ${firstInitial}`);
        if (lfKey && !byLastFirstInitial.has(lfKey)) byLastFirstInitial.set(lfKey, { id: p.id });
      }
    }
    return { byNameTeam, byName, byLastFirstInitial };
  }, [players]);

  // Keep headers fixed to the required schema and heal any stale local storage.
  useEffect(() => {
    const isFixed =
      headers.length === FIXED_HEADERS.length &&
      headers.every((h, i) => (h || "").trim().toLowerCase() === FIXED_HEADERS[i].toLowerCase());
    if (isFixed) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ headers: FIXED_HEADERS, rows }));
    } catch {
      // ignore localStorage errors
    }
    setHeaders([...FIXED_HEADERS]);
  }, [headers, rows, storageKey]);

  // Remove any accidental embedded header row from existing stored data.
  useEffect(() => {
    const cleaned = rows.filter((r) => !isEmbeddedHeaderRow(r.values));
    if (cleaned.length === rows.length) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ headers: FIXED_HEADERS, rows: cleaned }));
    } catch {
      // ignore localStorage errors
    }
    setRows(cleaned);
  }, [rows, storageKey]);

  const persist = (nextHeaders: string[], nextRows: PitchingStorageRow[]) => {
    setHeaders(nextHeaders);
    setRows(nextRows);
    try {
      localStorage.setItem(storageKey, JSON.stringify({ headers: nextHeaders, rows: nextRows }));
    } catch {
      // ignore localStorage errors
    }
  };

  const importCsv = async (file: File) => {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) throw new Error("CSV has no data rows.");

    // Use line 1 as the header row.
    const headerLineIndex = 0;
    const nextHeaders = [...FIXED_HEADERS];

    const handednessHeaderIdx = 2;

    const nextRows: PitchingStorageRow[] = [];
    for (let i = headerLineIndex + 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]).slice(0, MAX_COLS);
      if (cols.every((c) => !c?.trim())) continue;

      const values = [...Array(MAX_COLS)].map((_, idx) => cols[idx] || "");
      if (isEmbeddedHeaderRow(values)) continue;
      const inferredHandednessIdx =
        handednessHeaderIdx >= 0
          ? handednessHeaderIdx
          : (/^(R|L|RH|LH|RHP|LHP)$/i.test(values[2] || "") ? 2 : -1);

      if (inferredHandednessIdx >= 0) {
        values[inferredHandednessIdx] = normalizeHandedness(values[inferredHandednessIdx]);
      }

      nextRows.push({
        id: `${season}-${i}`,
        values,
      });
    }

    persist(nextHeaders, nextRows);
    toast.success(`Imported ${nextRows.length} pitching rows (columns A-I only).`);
  };

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.values.some((v) => (v || "").toLowerCase().includes(q)));
  }, [rows, search]);

  useEffect(() => {
    setPage(1);
  }, [search, season]);

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
          <CardTitle className="text-base">Pitching Stats Storage ({season})</CardTitle>
          <CardDescription>
            Imports only columns A-I. Handedness is normalized to RHP/LHP.
          </CardDescription>
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
                toast.error(err?.message || "Failed to import CSV");
              } finally {
                e.currentTarget.value = "";
              }
            }}
          />
          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4 mr-2" />
            Import CSV
          </Button>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing {filteredRows.length ? (safePage - 1) * PAGE_SIZE + 1 : 0}-
            {Math.min(safePage * PAGE_SIZE, filteredRows.length)} of {filteredRows.length} players
          </span>
          <div className="flex items-center gap-1">
            {getPageWindow(safePage, totalPages).map((p) => (
              <Button
                key={`pitching-stats-page-${p}`}
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
        <div className="max-h-[620px] overflow-auto">
          <Table className="table-fixed">
            <TableHeader className="sticky top-0 z-20 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
              <TableRow>
                {Array.from({ length: MAX_COLS }).map((_, i) => (
                  <TableHead
                    key={`h-${i}`}
                    className={
                      i === 0
                        ? "px-2 w-[170px]"
                        : i === 1
                          ? "px-2 w-[145px]"
                          : i === 2
                            ? "px-2 w-[80px]"
                            : "px-2 w-[70px] text-right"
                    }
                  >
                    {FIXED_HEADERS[i]}
                  </TableHead>
                ))}
                <TableHead className="px-2 w-[72px] text-right">ERA+</TableHead>
                <TableHead className="px-2 w-[72px] text-right">FIP+</TableHead>
                <TableHead className="px-2 w-[72px] text-right">WHIP+</TableHead>
                <TableHead className="px-2 w-[72px] text-right">K/9+</TableHead>
                <TableHead className="px-2 w-[72px] text-right">BB/9+</TableHead>
                <TableHead className="px-2 w-[72px] text-right">HR/9+</TableHead>
                <TableHead className="px-2 w-[72px] text-right">pRV+</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedRows.length > 0 ? (
                pagedRows.map((row) => (
                  <TableRow key={row.id}>
                    {Array.from({ length: MAX_COLS }).map((_, i) => (
                      <TableCell
                        key={`${row.id}-${i}`}
                        className={
                          i === 0
                            ? "font-medium px-2"
                            : i === 1 || i === 2
                              ? "px-2"
                              : "px-2 text-right font-mono"
                        }
                      >
                        {(() => {
                          if (i !== 0) return row.values[i] || "—";
                          const playerName = row.values[0] || "";
                          const teamName = row.values[1] || "";
                          const normalizedName = normalize(playerName);
                          const key = `${normalizedName}|${normalize(teamName)}`;
                          const direct = playerLookup.byNameTeam.get(key);
                          const fallback = playerLookup.byName.get(normalizedName);
                          // Support CSV names in "Last, First" format.
                          const swapped =
                            playerName.includes(",")
                              ? normalize(
                                  playerName
                                    .split(",")
                                    .map((s) => s.trim())
                                    .filter(Boolean)
                                    .reverse()
                                    .join(" "),
                                )
                              : null;
                          const swappedMatch = swapped ? playerLookup.byName.get(swapped) : null;
                          const parts = playerName.trim().split(/\s+/).filter(Boolean);
                          const firstInitial = parts[0]?.[0] ? parts[0][0].toLowerCase() : "";
                          const lastToken = parts.length > 1 ? parts[parts.length - 1] : "";
                          const lastFirstInitialKey = normalize(`${lastToken} ${firstInitial}`);
                          const lastFirstInitialMatch = playerLookup.byLastFirstInitial.get(lastFirstInitialKey);
                          const found = direct || fallback || swappedMatch || lastFirstInitialMatch;
                          if (!playerName) return "—";
                          const to = found
                            ? `/dashboard/pitcher/${found.id}`
                            : `/dashboard/pitcher/storage__${encodeURIComponent(playerName)}__${encodeURIComponent(teamName || "")}`;
                          return (
                            <Link
                              to={to}
                              className="text-primary underline underline-offset-4 hover:opacity-80"
                            >
                              {playerName}
                            </Link>
                          );
                        })()}
                      </TableCell>
                    ))}
                    {(() => {
                      const era = toNum(row.values[3]);
                      const fip = toNum(row.values[4]);
                      const whip = toNum(row.values[5]);
                      const k9 = toNum(row.values[6]);
                      const bb9 = toNum(row.values[7]);
                      const hr9 = toNum(row.values[8]);
                      const eraPlus = calcEraPlus(era, weights.era_plus_ncaa_avg, weights.era_plus_ncaa_sd, weights.era_plus_scale);
                      const fipPlus = calcFipPlus(fip, weights.fip_plus_ncaa_avg, weights.fip_plus_ncaa_sd, weights.fip_plus_scale);
                      const whipPlus = calcWhipPlus(whip, weights.whip_plus_ncaa_avg, weights.whip_plus_ncaa_sd, weights.whip_plus_scale);
                      const k9Plus = calcK9Plus(k9, weights.k9_plus_ncaa_avg, weights.k9_plus_ncaa_sd, weights.k9_plus_scale);
                      const bb9Plus = calcBb9Plus(bb9, weights.bb9_plus_ncaa_avg, weights.bb9_plus_ncaa_sd, weights.bb9_plus_scale);
                      const hr9Plus = calcHr9Plus(hr9, weights.hr9_plus_ncaa_avg, weights.hr9_plus_ncaa_sd, weights.hr9_plus_scale);
                      const pRV =
                        [fipPlus, eraPlus, whipPlus, k9Plus, bb9Plus, hr9Plus].some((v) => v == null)
                          ? null
                          : Math.round(
                              (weights.fip_plus_weight * Number(fipPlus)) +
                              (weights.era_plus_weight * Number(eraPlus)) +
                              (weights.whip_plus_weight * Number(whipPlus)) +
                              (weights.k9_plus_weight * Number(k9Plus)) +
                              (weights.bb9_plus_weight * Number(bb9Plus)) +
                              (weights.hr9_plus_weight * Number(hr9Plus)),
                            );
                      return (
                        <>
                          <TableCell className="px-2 text-right font-mono">{eraPlus ?? "—"}</TableCell>
                          <TableCell className="px-2 text-right font-mono">{fipPlus ?? "—"}</TableCell>
                          <TableCell className="px-2 text-right font-mono">{whipPlus ?? "—"}</TableCell>
                          <TableCell className="px-2 text-right font-mono">{k9Plus ?? "—"}</TableCell>
                          <TableCell className="px-2 text-right font-mono">{bb9Plus ?? "—"}</TableCell>
                          <TableCell className="px-2 text-right font-mono">{hr9Plus ?? "—"}</TableCell>
                          <TableCell className="px-2 text-right font-mono font-semibold">{pRV ?? "—"}</TableCell>
                        </>
                      );
                    })()}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={MAX_COLS + 7} className="py-8 text-center text-muted-foreground">
                    No pitching rows loaded for {season}. Import a CSV to begin.
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
