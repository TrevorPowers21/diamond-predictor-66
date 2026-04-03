import { useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Upload, Search, Edit2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { readPitchingWeights } from "@/lib/pitchingEquations";
import { parseCsvLine } from "@/lib/csvUtils";
import { normalizeConferenceName, canonicalConferenceName } from "@/lib/conferenceMapping";
import { useConferenceStats } from "@/hooks/useConferenceStats";

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

const fmt2 = (value: number | null) => (value == null ? "\u2014" : Number(value).toFixed(2));

const calcHitterTalentPlus = (
  overallHitterPrPlus: number | null,
  stuffPlus: number | null,
  wrcPlus: number | null,
) => {
  if (overallHitterPrPlus == null || stuffPlus == null || wrcPlus == null) return null;
  const value = overallHitterPrPlus + (1.25 * (stuffPlus - 100)) + (0.75 * (100 - wrcPlus));
  return Number.isFinite(value) ? Number(value.toFixed(1)) : null;
};

export default function PitchingConferenceStatsTable() {
  const [search, setSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [editingConference, setEditingConference] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editData, setEditData] = useState<Partial<PitchingRow>>({});
  const [weights] = useState(() => readPitchingWeights());

  // --- Unified conference stats from Supabase ---
  const { conferenceStats, conferenceStatsByKey, loading } = useConferenceStats(2025);

  // Build a lookup map keyed by canonical conference name for easy access
  const statsByCanonical = useMemo(() => {
    const map = new Map<string, typeof conferenceStats[number]>();
    for (const row of conferenceStats) {
      const canonical = canonicalConferenceName(row.conference);
      if (canonical) map.set(canonical, row);
    }
    return map;
  }, [conferenceStats]);

  // Map conference stats to PitchingRow format
  const rows: PitchingRow[] = useMemo(() => {
    return conferenceStats.map((cs) => {
      const canonical = canonicalConferenceName(cs.conference);
      const overallPr = cs.overall_power_rating ?? null;
      const stuff = cs.stuff_plus ?? null;
      const wrc = cs.wrc_plus ?? null;
      const hitterTalent = calcHitterTalentPlus(overallPr, stuff, wrc);
      return {
        conference: canonical || cs.conference,
        era: cs.era,
        fip: cs.fip,
        whip: cs.whip,
        k9: cs.k9,
        bb9: cs.bb9,
        hr9: cs.hr9,
        hitter_talent_plus: hitterTalent,
      };
    });
  }, [conferenceStats]);

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

    if ([confIdx, eraIdx, fipIdx, whipIdx, k9Idx, bb9Idx, hr9Idx].some((i) => i < 0)) {
      throw new Error("CSV must include Team/Conference and ERA/FIP/WHIP/K/9/BB/9/HR/9 columns.");
    }

    const upsertRows: Array<{
      "conference abbreviation": string;
      season: number;
      ERA: number | null;
      FIP: number | null;
      WHIP: number | null;
      K9: number | null;
      BB9: number | null;
      HR9: number | null;
    }> = [];

    const seen = new Set<string>();
    for (let r = 1; r < lines.length; r++) {
      const cols = parseCsvLine(lines[r]);
      const conference = canonicalConferenceName(cols[confIdx]);
      if (!conference || seen.has(conference)) continue;
      seen.add(conference);

      upsertRows.push({
        "conference abbreviation": conference,
        season: 2025,
        ERA: num(cols[eraIdx]),
        FIP: num(cols[fipIdx]),
        WHIP: num(cols[whipIdx]),
        K9: num(cols[k9Idx]),
        BB9: num(cols[bb9Idx]),
        HR9: num(cols[hr9Idx]),
      });
    }

    if (upsertRows.length === 0) throw new Error("No valid rows found in CSV");

    const { error } = await supabase
      .from("Conference Stats")
      .upsert(upsertRows as any, { onConflict: "conference abbreviation,season" });

    if (error) {
      console.error("Supabase upsert error:", error);
      throw new Error(`Failed to save to Supabase: ${error.message}`);
    }

    toast.success(`Imported ${upsertRows.length} pitching conference rows to Supabase`);
    // Reload the page to re-fetch from Supabase (the hook will pick up new data)
    window.location.reload();
  };

  const { ncaaRow, filtered } = useMemo(() => {
    const byConference = new Map<string, PitchingRow>();
    for (const r of rows) {
      const canonical = canonicalConferenceName(r.conference);
      if (!canonical) continue;
      if (byConference.has(canonical)) byConference.delete(canonical);
      byConference.set(canonical, { ...r, conference: canonical });
    }
    const allRows = Array.from(byConference.values()).sort((a, b) =>
      a.conference.localeCompare(b.conference),
    );
    const q = search.trim().toLowerCase();
    const searched = q ? allRows.filter((r) => r.conference.toLowerCase().includes(q)) : allRows;
    const ncaa = searched.find((r) => r.conference.toLowerCase().includes("ncaa")) || null;
    const rest = searched.filter((r) => !r.conference.toLowerCase().includes("ncaa"));
    return { ncaaRow: ncaa, filtered: rest };
  }, [rows, search]);

  const startEdit = (row: PitchingRow) => {
    setEditingConference(row.conference);
    setEditName(row.conference);
    setEditData({ ...row });
  };

  const saveEdit = async (row: PitchingRow) => {
    const canonicalName = canonicalConferenceName(editName);
    if (!canonicalName) {
      toast.error("Conference name cannot be blank");
      return;
    }

    const { error } = await supabase
      .from("Conference Stats")
      .upsert(
        {
          "conference abbreviation": canonicalName,
          season: 2025,
          ERA: num(editData.era),
          FIP: num(editData.fip),
          WHIP: num(editData.whip),
          K9: num(editData.k9),
          BB9: num(editData.bb9),
          HR9: num(editData.hr9),
        } as any,
        { onConflict: "conference abbreviation,season" },
      );

    if (error) {
      toast.error(`Failed to save: ${error.message}`);
      return;
    }

    toast.success(`Updated ${canonicalName}`);
    setEditingConference(null);
    setEditName("");
    setEditData({});
    window.location.reload();
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
            {loading ? "Loading from Supabase..." : "Columns B-G are statistical inputs. Columns H-M are score fields."}
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
                  const canonical = canonicalConferenceName(r.conference);
                  const csRow = statsByCanonical.get(canonical);
                  const overallPr = csRow?.overall_power_rating ?? null;
                  const stuff = csRow?.stuff_plus ?? null;
                  const wrc = csRow?.wrc_plus ?? null;
                  const hitterTalent = calcHitterTalentPlus(overallPr, stuff, wrc) ?? r.hitter_talent_plus;
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
                      <TableCell className="text-right font-mono">{s.eraPlus ?? "\u2014"}</TableCell>
                      <TableCell className="text-right font-mono">{s.fipPlus ?? "\u2014"}</TableCell>
                      <TableCell className="text-right font-mono">{s.whipPlus ?? "\u2014"}</TableCell>
                      <TableCell className="text-right font-mono">{s.k9Plus ?? "\u2014"}</TableCell>
                      <TableCell className="text-right font-mono">{s.bb9Plus ?? "\u2014"}</TableCell>
                      <TableCell className="text-right font-mono">{s.hr9Plus ?? "\u2014"}</TableCell>
                      <TableCell className="text-right font-mono">
                        {overallPr == null ? "\u2014" : Math.round(Number(overallPr)).toString()}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {stuff == null ? "\u2014" : Number(stuff).toFixed(1)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {wrc == null ? "\u2014" : Number(wrc).toFixed(1)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {hitterTalent == null ? "\u2014" : Number(hitterTalent).toFixed(1)}
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
                          <TableCell className="text-right font-mono">{s.eraPlus ?? "\u2014"}</TableCell>
                          <TableCell className="text-right font-mono">{s.fipPlus ?? "\u2014"}</TableCell>
                          <TableCell className="text-right font-mono">{s.whipPlus ?? "\u2014"}</TableCell>
                          <TableCell className="text-right font-mono">{s.k9Plus ?? "\u2014"}</TableCell>
                          <TableCell className="text-right font-mono">{s.bb9Plus ?? "\u2014"}</TableCell>
                          <TableCell className="text-right font-mono">{s.hr9Plus ?? "\u2014"}</TableCell>
                          <TableCell className="text-right font-mono">100</TableCell>
                          <TableCell className="text-right font-mono">100</TableCell>
                          <TableCell className="text-right font-mono">100</TableCell>
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
                    {loading ? "Loading conference stats..." : "No pitching conference rows yet. Import your CSV to begin."}
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
