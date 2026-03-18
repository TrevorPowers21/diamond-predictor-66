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
import { profileRouteFor } from "@/lib/profileRoutes";

type PitchingStorageRow = {
  id: string;
  values: string[];
};

const MAX_COLS = 9; // Columns A-I only
const FIXED_HEADERS = ["Player Name", "Team", "Handedness", "ERA", "FIP", "WHIP", "K/9", "BB/9", "HR/9"];

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

const isEmbeddedHeaderRow = (values: string[]) => {
  const v0 = (values[0] || "").trim().toLowerCase();
  const v1 = (values[1] || "").trim().toLowerCase();
  const v2 = (values[2] || "").trim().toLowerCase();
  return v0 === "player name" && v1 === "team" && v2 === "handedness";
};

export default function PitchingStatsStorageTable({ season }: { season: "2025" | "2026" }) {
  const storageKey = `pitching_stats_storage_${season}_v1`;
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [search, setSearch] = useState("");
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

  const { data: players = [] } = useQuery({
    queryKey: ["pitching-storage-player-directory"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("players")
        .select("id, first_name, last_name, team, position, handedness");
      if (error) throw error;
      return data || [];
    },
  });

  const playerLookup = useMemo(() => {
    const byNameTeam = new Map<string, { id: string; position: string | null; handedness: string | null }>();
    const byName = new Map<string, { id: string; position: string | null; handedness: string | null }>();
    for (const p of players) {
      const fullName = `${p.first_name || ""} ${p.last_name || ""}`.trim();
      const nameKey = normalize(fullName);
      const teamKey = normalize(p.team);
      const key = `${nameKey}|${teamKey}`;
      if (nameKey && !byName.has(nameKey)) byName.set(nameKey, { id: p.id, position: p.position, handedness: p.handedness });
      if (nameKey && teamKey && !byNameTeam.has(key)) byNameTeam.set(key, { id: p.id, position: p.position, handedness: p.handedness });
    }
    return { byNameTeam, byName };
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.length > 0 ? (
                filteredRows.map((row) => (
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
                          const handedness = row.values[2] || null;
                          const key = `${normalize(playerName)}|${normalize(teamName)}`;
                          const direct = playerLookup.byNameTeam.get(key);
                          const fallback = playerLookup.byName.get(normalize(playerName));
                          const found = direct || fallback;
                          if (!found) return playerName || "—";
                          return (
                            <Link
                              to={profileRouteFor(found.id, found.position ?? "P", found.handedness ?? handedness)}
                              className="text-primary underline-offset-4 hover:underline"
                            >
                              {playerName || "—"}
                            </Link>
                          );
                        })()}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={MAX_COLS} className="py-8 text-center text-muted-foreground">
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
