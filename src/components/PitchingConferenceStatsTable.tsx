import { useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Upload, Search, Edit2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { readPitchingWeights } from "@/lib/pitchingEquations";
import { parseCsvLine } from "@/lib/csvUtils";
import { normalizeConferenceName, canonicalConferenceName } from "@/lib/conferenceMapping";

type PitchingRow = {
  conference: string;
  era: number | null;
  fip: number | null;
  whip: number | null;
  k9: number | null;
  bb9: number | null;
  hr9: number | null;
  hitter_talent_plus: number | null;
};

const STORAGE_KEY_ROWS = "pitching_conference_stats_rows_v1";
const defaultNcaaAverages = {
  era: 6.14,
  fip: 5.07,
  whip: 1.62,
  k9: 8.22,
  bb9: 4.58,
  hr9: 1.10,
};

const num = (v: string | number | null | undefined) => {
  if (v == null) return null;
  const s = String(v).replace(/[%,$]/g, "").trim();
  if (!s) return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

const roundWhole = (v: number | null) => (v == null ? null : Math.round(v));

const calcScore = (baseline: number, value: number | null, invert = false) => {
  if (value == null || value === 0) return null;
  if (invert) return roundWhole((value / baseline) * 100); // K/9 (higher is better)
  return roundWhole((baseline / value) * 100); // ERA/FIP/WHIP/BB9/HR9 (lower is better)
};

const calcEraPlus = (era: number | null, ncaaAvgEra: number, ncaaEraSd: number, scale: number) => {
  if (era == null || ncaaEraSd === 0) return null;
  return roundWhole(100 + (((ncaaAvgEra - era) / ncaaEraSd) * scale));
};

const calcFipPlus = (fip: number | null, ncaaAvgFip: number, ncaaFipSd: number, scale: number) => {
  if (fip == null || ncaaFipSd === 0) return null;
  return roundWhole(100 + (((ncaaAvgFip - fip) / ncaaFipSd) * scale));
};

const calcWhipPlus = (whip: number | null, ncaaAvgWhip: number, ncaaWhipSd: number, scale: number) => {
  if (whip == null || ncaaWhipSd === 0) return null;
  return roundWhole(100 + (((ncaaAvgWhip - whip) / ncaaWhipSd) * scale));
};

const calcK9Plus = (k9: number | null, ncaaAvgK9: number, ncaaK9Sd: number, scale: number) => {
  if (k9 == null || ncaaK9Sd === 0) return null;
  return roundWhole(100 + (((k9 - ncaaAvgK9) / ncaaK9Sd) * scale));
};

const calcBb9Plus = (bb9: number | null, ncaaAvgBb9: number, ncaaBb9Sd: number, scale: number) => {
  if (bb9 == null || ncaaBb9Sd === 0) return null;
  return roundWhole(100 + (((ncaaAvgBb9 - bb9) / ncaaBb9Sd) * scale));
};

const calcHr9Plus = (hr9: number | null, ncaaAvgHr9: number, ncaaHr9Sd: number, scale: number) => {
  if (hr9 == null || ncaaHr9Sd === 0) return null;
  return roundWhole(100 + (((ncaaAvgHr9 - hr9) / ncaaHr9Sd) * scale));
};

const fmt2 = (value: number | null) => (value == null ? "—" : Number(value).toFixed(2));

const calcHitterTalentPlus = (
  overallHitterPrPlus: number | null,
  stuffPlus: number | null,
  wrcPlus: number | null,
) => {
  if (overallHitterPrPlus == null || stuffPlus == null || wrcPlus == null) return null;
  const value = overallHitterPrPlus + (1.25 * (stuffPlus - 100)) + (0.75 * (100 - wrcPlus));
  return Number.isFinite(value) ? Number(value.toFixed(1)) : null;
};

const HITTER_TALENT_PLUS_BY_CONFERENCE: Record<string, number> = {
  "Atlantic 10": 98.4,
  "American Athletic Conference": 103.1,
  ACC: 115.3,
  "American East": 79.4,
  "Atlantic Sun Conference": 91.6,
  "Big East Conference": 100.6,
  "Big South Conference": 93.3,
  "Big Ten": 111.3,
  "Big 12": 116.1,
  "Big West": 101.8,
  "Coastal Athletic Association": 92.1,
  "Conference USA": 103.6,
  "Horizon League": 96.1,
  "Ivy League": 88.8,
  "Metro Atlantic Athletic Conference": 80.3,
  "Mid-American Conference": 94.8,
  "Mountain West": 95.3,
  "Missouri Valley Conference": 102.1,
  "Northeast Conference": 69.9,
  "Ohio Valley Conference": 84.8,
  "Patriot League": 92.0,
  "Southern Conference": 103.8,
  SEC: 116.8,
  "Southland Conference": 84.5,
  "Southwestern Athletic Conference": 77.1,
  "Summit League": 84.4,
  "Sun Belt": 103.1,
  "West Coast Conference": 88.3,
  "Western Athletic Conference": 99.6,
};

const getHitterTalentPlusDefault = (conference: string | null | undefined) => {
  const canonical = canonicalConferenceName(conference);
  if (!canonical) return null;
  return HITTER_TALENT_PLUS_BY_CONFERENCE[canonical] ?? null;
};

const OVERALL_HITTER_POWER_RATING_BY_CONFERENCE: Record<string, number> = {
  "Atlantic 10": 105,
  "American Athletic Conference": 95,
  ACC: 110,
  "American East": 82,
  "Atlantic Sun Conference": 89,
  "Big East Conference": 104,
  "Big South Conference": 102,
  "Big Ten": 110,
  "Big 12": 112,
  "Big West": 96,
  "Coastal Athletic Association": 91,
  "Conference USA": 102,
  "Horizon League": 103,
  "Ivy League": 88,
  "Metro Atlantic Athletic Conference": 86,
  "Mid-American Conference": 98,
  "Mountain West": 100,
  "Missouri Valley Conference": 107,
  "Northeast Conference": 78,
  "Ohio Valley Conference": 87,
  "Patriot League": 94,
  "Southern Conference": 106,
  SEC: 108,
  "Southland Conference": 83,
  "Southwestern Athletic Conference": 93,
  "Summit League": 82,
  "Sun Belt": 97,
  "West Coast Conference": 89,
  "Western Athletic Conference": 103,
};

const getOverallHitterPowerRating = (conference: string | null | undefined) => {
  const canonical = canonicalConferenceName(conference);
  if (!canonical) return null;
  return OVERALL_HITTER_POWER_RATING_BY_CONFERENCE[canonical] ?? null;
};

export default function PitchingConferenceStatsTable() {
  const [search, setSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [editingConference, setEditingConference] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editData, setEditData] = useState<Partial<PitchingRow>>({});
  const [rows, setRows] = useState<PitchingRow[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_ROWS);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as PitchingRow[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [weights] = useState(() => readPitchingWeights());
  const { data: hittingConferenceStats = [] } = useQuery({
    queryKey: ["conference_stats_stuff_plus_pitching_view"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conference_stats")
        .select("conference, season, avg, obp, slg, stuff_plus, wrc_plus, offensive_power_rating")
        .eq("season", 2025);
      if (error) throw error;
      return data || [];
    },
  });

  const persistRows = (next: PitchingRow[]) => {
    setRows(next);
    try {
      localStorage.setItem(STORAGE_KEY_ROWS, JSON.stringify(next));
    } catch {
      // ignore localStorage errors
    }
  };

  const importCsv = async (file: File) => {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) throw new Error("CSV has no data rows");

    const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, " ").trim());
    const idx = (names: string[]) => {
      for (const n of names) {
        const i = header.findIndex((h) => h === n);
        if (i >= 0) return i;
      }
      return -1;
    };

    const confIdx = idx(["team", "conference"]);
    const eraIdx = idx(["era"]);
    const fipIdx = idx(["fip"]);
    const whipIdx = idx(["whip"]);
    const k9Idx = idx(["k/9", "k9"]);
    const bb9Idx = idx(["bb/9", "bb9"]);
    const hr9Idx = idx(["hr/9", "hr9"]);
    const hitterTalentPlusIdx = idx(["hitter talent+", "hitter talent plus"]);
    const hitterTalentPlusColQIdx = 16; // Column Q (0-based index) in the provided sheet format.

    if ([confIdx, eraIdx, fipIdx, whipIdx, k9Idx, bb9Idx, hr9Idx].some((i) => i < 0)) {
      throw new Error("CSV must include Team/Conference and ERA/FIP/WHIP/K/9/BB/9/HR/9 columns.");
    }

    const importedByConference = new Map<string, PitchingRow>();
    for (let r = 1; r < lines.length; r++) {
      const cols = parseCsvLine(lines[r]);
      const conference = canonicalConferenceName(cols[confIdx]);
      if (!conference) continue;

      const row: PitchingRow = {
        conference,
        era: num(cols[eraIdx]),
        fip: num(cols[fipIdx]),
        whip: num(cols[whipIdx]),
        k9: num(cols[k9Idx]),
        bb9: num(cols[bb9Idx]),
        hr9: num(cols[hr9Idx]),
        // Pull Hitter Talent+ from Column Q first, then fallback to header match.
        hitter_talent_plus: (() => {
          const qVal = cols.length > hitterTalentPlusColQIdx ? num(cols[hitterTalentPlusColQIdx]) : null;
          if (qVal != null) return qVal;
          const headerVal = hitterTalentPlusIdx >= 0 ? num(cols[hitterTalentPlusIdx]) : null;
          if (headerVal != null) return headerVal;
          return getHitterTalentPlusDefault(conference);
        })(),
      };

      importedByConference.set(conference, row);
    }
    const imported = Array.from(importedByConference.values()).sort((a, b) => a.conference.localeCompare(b.conference));

    persistRows(imported);
    toast.success(`Imported ${imported.length} pitching conference rows`);
  };

  const { ncaaRow, filtered } = useMemo(() => {
    // De-dupe pitching rows while keeping latest edit/import for each canonical conference.
    const byConference = new Map<string, PitchingRow>();
    for (const r of rows) {
      const canonical = canonicalConferenceName(r.conference);
      if (!canonical) continue;
      if (byConference.has(canonical)) byConference.delete(canonical);
      byConference.set(canonical, { ...r, conference: canonical });
    }
    // Sort alphabetically by conference.
    const allRows = Array.from(byConference.values()).sort((a, b) =>
      a.conference.localeCompare(b.conference),
    );
    const q = search.trim().toLowerCase();
    const searched = q ? allRows.filter((r) => r.conference.toLowerCase().includes(q)) : allRows;
    const ncaa = searched.find((r) => r.conference.toLowerCase().includes("ncaa")) || null;
    const rest = searched.filter((r) => !r.conference.toLowerCase().includes("ncaa"));
    return { ncaaRow: ncaa, filtered: rest };
  }, [rows, search]);
  const stuffByConference = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const row of hittingConferenceStats) {
      const key = canonicalConferenceName(row.conference);
      if (!key) continue;
      const existing = map.get(key);
      // Prefer populated stuff+, otherwise keep existing.
      if (existing == null || row.stuff_plus != null) map.set(key, row.stuff_plus ?? null);
    }
    return map;
  }, [hittingConferenceStats]);
  const hitterTalentByConference = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const row of hittingConferenceStats) {
      const key = canonicalConferenceName(row.conference);
      if (!key) continue;
      const existing = map.get(key);
      if (existing == null || row.offensive_power_rating != null) {
        map.set(key, row.offensive_power_rating ?? null);
      }
    }
    return map;
  }, [hittingConferenceStats]);
  const wrcByConference = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const row of hittingConferenceStats) {
      const key = canonicalConferenceName(row.conference);
      if (!key) continue;
      const existing = map.get(key);
      if (existing == null || row.wrc_plus != null) {
        map.set(key, row.wrc_plus ?? null);
      }
    }
    return map;
  }, [hittingConferenceStats]);

  const startEdit = (row: PitchingRow) => {
    setEditingConference(row.conference);
    setEditName(row.conference);
    setEditData({ ...row });
  };

  const saveEdit = (row: PitchingRow) => {
    const canonicalName = canonicalConferenceName(editName);
    if (!canonicalName) {
      toast.error("Conference name cannot be blank");
      return;
    }
    const next = rows.map((r) => {
      if (r.conference !== row.conference) return r;
      return {
        conference: canonicalName,
        era: num(editData.era),
        fip: num(editData.fip),
        whip: num(editData.whip),
        k9: num(editData.k9),
        bb9: num(editData.bb9),
        hr9: num(editData.hr9),
        hitter_talent_plus: num(editData.hitter_talent_plus),
      };
    });
    persistRows(next);
    setEditingConference(null);
    setEditName("");
    setEditData({});
  };

  const baselines = useMemo(() => ({
    era: ncaaRow?.era ?? defaultNcaaAverages.era,
    fip: ncaaRow?.fip ?? defaultNcaaAverages.fip,
    whip: ncaaRow?.whip ?? defaultNcaaAverages.whip,
    k9: ncaaRow?.k9 ?? defaultNcaaAverages.k9,
    bb9: ncaaRow?.bb9 ?? defaultNcaaAverages.bb9,
    hr9: ncaaRow?.hr9 ?? defaultNcaaAverages.hr9,
  }), [ncaaRow]);
  const ncaaDisplayRow: PitchingRow = useMemo(
    () =>
      ncaaRow ?? {
        conference: "NCAA",
        era: baselines.era,
        fip: baselines.fip,
        whip: baselines.whip,
        k9: baselines.k9,
        bb9: baselines.bb9,
        hr9: baselines.hr9,
        hitter_talent_plus: 100,
      },
    [ncaaRow, baselines],
  );

  const score = (row: PitchingRow) => ({
    eraPlus: calcEraPlus(row.era, weights.era_plus_ncaa_avg, weights.era_plus_ncaa_sd, weights.era_plus_scale),
    fipPlus: calcFipPlus(row.fip, weights.fip_plus_ncaa_avg, weights.fip_plus_ncaa_sd, weights.fip_plus_scale),
    whipPlus: calcWhipPlus(row.whip, weights.whip_plus_ncaa_avg, weights.whip_plus_ncaa_sd, weights.whip_plus_scale),
    k9Plus: calcK9Plus(row.k9, weights.k9_plus_ncaa_avg, weights.k9_plus_ncaa_sd, weights.k9_plus_scale),
    bb9Plus: calcBb9Plus(row.bb9, weights.bb9_plus_ncaa_avg, weights.bb9_plus_ncaa_sd, weights.bb9_plus_scale),
    hr9Plus: calcHr9Plus(row.hr9, weights.hr9_plus_ncaa_avg, weights.hr9_plus_ncaa_sd, weights.hr9_plus_scale),
  });

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-base">Conference Stats (Pitching)</CardTitle>
          <CardDescription className="mt-1">
            Columns B-G are statistical inputs. Columns H-M are score fields.
          </CardDescription>
        </div>
        <div className="flex w-full sm:w-auto items-center gap-2">
          <input
            ref={fileInputRef}
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
          <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4 mr-2" />
            Import CSV
          </Button>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search conferences..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="max-h-[620px] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-20 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
              <TableRow>
                <TableHead className="sticky left-0 z-30 bg-background min-w-[220px]">Conference</TableHead>
                <TableHead className="text-right">ERA</TableHead>
                <TableHead className="text-right">FIP</TableHead>
                <TableHead className="text-right">WHIP</TableHead>
                <TableHead className="text-right">K/9</TableHead>
                <TableHead className="text-right">BB/9</TableHead>
                <TableHead className="text-right">HR/9</TableHead>
                <TableHead className="text-right">ERA+</TableHead>
                <TableHead className="text-right">FIP+</TableHead>
                <TableHead className="text-right">WHIP+</TableHead>
                <TableHead className="text-right">K/9+</TableHead>
                <TableHead className="text-right">BB/9+</TableHead>
                <TableHead className="text-right">HR/9+</TableHead>
                <TableHead className="text-right">Overall Hitter PR+</TableHead>
                <TableHead className="text-right">Stuff+</TableHead>
                <TableHead className="text-right">WRC+</TableHead>
                <TableHead className="text-right">Hitter Talent+</TableHead>
                <TableHead className="w-[90px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length || ncaaDisplayRow ? (
                <>
                {filtered.map((r) => {
                  const s = score(r);
                  const isEditing = editingConference === r.conference;
                  return (
                    <TableRow key={r.conference}>
                      <TableCell className="sticky left-0 z-10 bg-background font-medium">
                        {isEditing ? (
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="h-7 w-full max-w-[200px] text-xs"
                          />
                        ) : (
                          r.conference
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">{isEditing ? <Input type="number" step="0.01" value={editData.era ?? ""} onChange={(e) => setEditData((p) => ({ ...p, era: num(e.target.value) }))} className="h-7 w-[80px] text-right text-xs font-mono" /> : fmt2(r.era)}</TableCell>
                      <TableCell className="text-right font-mono">{isEditing ? <Input type="number" step="0.01" value={editData.fip ?? ""} onChange={(e) => setEditData((p) => ({ ...p, fip: num(e.target.value) }))} className="h-7 w-[80px] text-right text-xs font-mono" /> : fmt2(r.fip)}</TableCell>
                      <TableCell className="text-right font-mono">{isEditing ? <Input type="number" step="0.01" value={editData.whip ?? ""} onChange={(e) => setEditData((p) => ({ ...p, whip: num(e.target.value) }))} className="h-7 w-[80px] text-right text-xs font-mono" /> : fmt2(r.whip)}</TableCell>
                      <TableCell className="text-right font-mono">{isEditing ? <Input type="number" step="0.01" value={editData.k9 ?? ""} onChange={(e) => setEditData((p) => ({ ...p, k9: num(e.target.value) }))} className="h-7 w-[80px] text-right text-xs font-mono" /> : fmt2(r.k9)}</TableCell>
                      <TableCell className="text-right font-mono">{isEditing ? <Input type="number" step="0.01" value={editData.bb9 ?? ""} onChange={(e) => setEditData((p) => ({ ...p, bb9: num(e.target.value) }))} className="h-7 w-[80px] text-right text-xs font-mono" /> : fmt2(r.bb9)}</TableCell>
                      <TableCell className="text-right font-mono">{isEditing ? <Input type="number" step="0.01" value={editData.hr9 ?? ""} onChange={(e) => setEditData((p) => ({ ...p, hr9: num(e.target.value) }))} className="h-7 w-[80px] text-right text-xs font-mono" /> : fmt2(r.hr9)}</TableCell>
                      <TableCell className="text-right font-mono">{s.eraPlus ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono">{s.fipPlus ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono">{s.whipPlus ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono">{s.k9Plus ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono">{s.bb9Plus ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono">{s.hr9Plus ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono">
                        {(() => {
                          const canonical = canonicalConferenceName(r.conference);
                          const overall = getOverallHitterPowerRating(canonical);
                          return overall == null ? "—" : Math.round(Number(overall)).toString();
                        })()}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {(() => {
                          const stuff = stuffByConference.get(canonicalConferenceName(r.conference));
                          return stuff == null ? "—" : Number(stuff).toFixed(1);
                        })()}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {(() => {
                          const wrc = wrcByConference.get(canonicalConferenceName(r.conference));
                          return wrc == null ? "—" : Number(wrc).toFixed(1);
                        })()}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {(() => {
                          const canonical = canonicalConferenceName(r.conference);
                          const overallHitterPr = getOverallHitterPowerRating(canonical);
                          const stuff = stuffByConference.get(canonical);
                          const wrc = wrcByConference.get(canonical);
                          const hitterTalentFromEquation = calcHitterTalentPlus(
                            overallHitterPr,
                            stuff == null ? null : Number(stuff),
                            wrc == null ? null : Number(wrc),
                          );
                          const hitterTalent =
                            hitterTalentFromEquation ??
                            r.hitter_talent_plus ??
                            getHitterTalentPlusDefault(canonical) ??
                            hitterTalentByConference.get(canonical) ??
                            null;
                          return hitterTalent == null ? "—" : Number(hitterTalent).toFixed(1);
                        })()}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => saveEdit(r)}>
                              <Check className="h-3.5 w-3.5 text-primary" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingConference(null)}>
                              <X className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        ) : (
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(r)}>
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {ncaaDisplayRow ? (
                  <TableRow className="bg-muted/50 font-semibold sticky bottom-0 z-10 border-t-2 border-primary/20">
                    {(() => {
                      const s = score(ncaaDisplayRow);
                      return (
                        <>
                          <TableCell className="sticky left-0 z-10 bg-muted/50 font-medium">NCAA Average</TableCell>
                          <TableCell className="text-right font-mono">{fmt2(ncaaDisplayRow.era)}</TableCell>
                          <TableCell className="text-right font-mono">{fmt2(ncaaDisplayRow.fip)}</TableCell>
                          <TableCell className="text-right font-mono">{fmt2(ncaaDisplayRow.whip)}</TableCell>
                          <TableCell className="text-right font-mono">{fmt2(ncaaDisplayRow.k9)}</TableCell>
                          <TableCell className="text-right font-mono">{fmt2(ncaaDisplayRow.bb9)}</TableCell>
                          <TableCell className="text-right font-mono">{fmt2(ncaaDisplayRow.hr9)}</TableCell>
                          <TableCell className="text-right font-mono">{s.eraPlus ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono">{s.fipPlus ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono">{s.whipPlus ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono">{s.k9Plus ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono">{s.bb9Plus ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono">{s.hr9Plus ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono">100</TableCell>
                          <TableCell className="text-right font-mono">
                            100
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            100
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {Number(ncaaDisplayRow.hitter_talent_plus ?? 100).toFixed(1)}
                          </TableCell>
                          <TableCell />
                        </>
                      );
                    })()}
                  </TableRow>
                ) : null}
                </>
              ) : (
                <TableRow>
                  <TableCell colSpan={18} className="py-8 text-center text-muted-foreground">
                    No pitching conference rows yet. Import your CSV to begin.
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
