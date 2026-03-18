import { useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Upload, Search, Edit2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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

const normalizeConferenceName = (raw: string | null | undefined): string => {
  if (!raw) return "";
  return raw.replace(/^'?\s*25\s+/i, "").replace(/\*/g, "").replace(/\s+/g, " ").trim();
};

const canonicalConferenceName = (raw: string | null | undefined): string => {
  const cleaned = normalizeConferenceName(raw);
  if (!cleaned) return "";
  const key = cleaned.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Handle variants that append abbreviations in parentheses, e.g. "Atlantic Coast Conference (ACC)".
  if (key.includes("atlanticcoastconference")) return "ACC";
  if (key.includes("southeasternconference")) return "SEC";
  if (key.includes("americanathleticconference")) return "American Athletic Conference";
  if (key.includes("coastalathleticassociation")) return "Coastal Athletic Association";
  if (key.includes("missourivalleyconference")) return "Missouri Valley Conference";
  if (key.includes("metroatlanticathleticconference")) return "Metro Atlantic Athletic Conference";
  if (key.includes("midamericanconference")) return "Mid-American Conference";
  if (key.includes("northeastconference")) return "Northeast Conference";
  if (key.includes("southlandconference")) return "Southland Conference";
  if (key.includes("southwesternathleticconference")) return "Southwestern Athletic Conference";
  if (key.includes("westernathleticconference")) return "Western Athletic Conference";

  const map: Record<string, string> = {
    aac: "American Athletic Conference",
    americanathleticconference: "American Athletic Conference",
    a10: "Atlantic 10",
    atlantic10: "Atlantic 10",
    caa: "Coastal Athletic Association",
    coastalathleticassociation: "Coastal Athletic Association",
    acc: "ACC",
    atlanticcoastconference: "ACC",
    sec: "SEC",
    southeasternconference: "SEC",
    big10: "Big Ten",
    bigten: "Big Ten",
    bigtenconference: "Big Ten",
    big12: "Big 12",
    big12conference: "Big 12",
    bigeast: "Big East Conference",
    bigeastconference: "Big East Conference",
    bigsouth: "Big South Conference",
    bigsouthconference: "Big South Conference",
    bigwest: "Big West",
    cusa: "Conference USA",
    conferenceusa: "Conference USA",
    mwc: "Mountain West",
    mountainwest: "Mountain West",
    mountainwestconference: "Mountain West",
    mvc: "Missouri Valley Conference",
    missourivalleyconference: "Missouri Valley Conference",
    nec: "Northeast Conference",
    northeastconference: "Northeast Conference",
    socon: "Southern Conference",
    southern: "Southern Conference",
    southernconference: "Southern Conference",
    swac: "Southwestern Athletic Conference",
    southwesternathleticconference: "Southwestern Athletic Conference",
    wcc: "West Coast Conference",
    westcoastconference: "West Coast Conference",
    wac: "Western Athletic Conference",
    westernathleticconference: "Western Athletic Conference",
    asun: "Atlantic Sun Conference",
    atlanticsunconference: "Atlantic Sun Conference",
    maac: "Metro Atlantic Athletic Conference",
    metroatlanticathleticconference: "Metro Atlantic Athletic Conference",
    mac: "Mid-American Conference",
    midamericanconference: "Mid-American Conference",
    ovc: "Ohio Valley Conference",
    ohiovalleyconference: "Ohio Valley Conference",
    americaeast: "American East",
    ameast: "American East",
    ivyleague: "Ivy League",
    horizonleague: "Horizon League",
    meac: "MEAC",
    pac12: "Pac-12",
    patriotleague: "Patriot League",
    southlandconference: "Southland Conference",
    southland: "Southland Conference",
    summitleague: "Summit League",
    sunbelt: "Sun Belt",
    sunbeltconference: "Sun Belt",
    westernathleticconferencewac: "Western Athletic Conference",
  };
  return map[key] || cleaned;
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

const calcScore = (baseline: number, value: number | null, invert = false) => {
  if (value == null || value === 0) return null;
  if (invert) return roundWhole((value / baseline) * 100); // K/9 (higher is better)
  return roundWhole((baseline / value) * 100); // ERA/FIP/WHIP/BB9/HR9 (lower is better)
};

const fmt2 = (value: number | null) => (value == null ? "—" : Number(value).toFixed(2));

const calcOffensiveEnvironment = (
  hitterTalentPlus: number | null,
  stuffPlus: number | null,
  wrcPlus: number | null,
) => {
  if (hitterTalentPlus == null || wrcPlus == null || stuffPlus == null) return null;
  const value = 0.6 * ((hitterTalentPlus * (100 + 2 * (stuffPlus - 100))) / 100) + 0.4 * wrcPlus;
  return Number.isFinite(value) ? Number(value.toFixed(1)) : null;
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
          return hitterTalentPlusIdx >= 0 ? num(cols[hitterTalentPlusIdx]) : null;
        })(),
      };

      importedByConference.set(conference, row);
    }
    const imported = Array.from(importedByConference.values()).sort((a, b) => a.conference.localeCompare(b.conference));

    persistRows(imported);
    toast.success(`Imported ${imported.length} pitching conference rows`);
  };

  const { ncaaRow, filtered } = useMemo(() => {
    const hasBaseStats = (row: { avg?: number | null; obp?: number | null; slg?: number | null }) =>
      row.avg != null && row.obp != null && row.slg != null;

    // Build hitter order exactly from the hitting conference source.
    const orderByConference = new Map<string, number>();
    const hittingByConference = new Map<string, { conference: string; avg: number | null; obp: number | null; slg: number | null }>();
    for (const r of hittingConferenceStats) {
      const key = canonicalConferenceName(r.conference);
      if (!key) continue;
      const current = hittingByConference.get(key);
      const currentScore = current ? Number(hasBaseStats(current)) : -1;
      const nextScore = Number(hasBaseStats(r));
      if (!current || nextScore > currentScore) {
        hittingByConference.set(key, {
          conference: key,
          avg: r.avg ?? null,
          obp: r.obp ?? null,
          slg: r.slg ?? null,
        });
      }
    }
    const hittingOrdered = Array.from(hittingByConference.values()).filter(hasBaseStats);
    for (let i = 0; i < hittingOrdered.length; i++) {
      const key = canonicalConferenceName(hittingOrdered[i].conference);
      if (key && !orderByConference.has(key)) orderByConference.set(key, i);
    }
    // Keep ACC where you want it in this UI: between American East and Atlantic Sun.
    const americanEastOrder = orderByConference.get("American East");
    if (americanEastOrder != null) {
      orderByConference.set("ACC", americanEastOrder + 0.5);
    }

    // De-dupe pitching rows while keeping latest edit/import for each canonical conference.
    const byConference = new Map<string, PitchingRow>();
    for (const r of rows) {
      const canonical = canonicalConferenceName(r.conference);
      if (!canonical) continue;
      if (byConference.has(canonical)) byConference.delete(canonical);
      byConference.set(canonical, { ...r, conference: canonical });
    }

    // Stable sort: hitter-order first, then preserve local insertion order.
    const baseRows = Array.from(byConference.values());
    const indexByConference = new Map<string, number>();
    baseRows.forEach((r, i) => indexByConference.set(r.conference, i));
    const allRows = [...baseRows].sort((a, b) => {
      const ao = orderByConference.get(a.conference);
      const bo = orderByConference.get(b.conference);
      if (ao != null && bo != null) return ao - bo;
      if (ao != null) return -1;
      if (bo != null) return 1;
      return (indexByConference.get(a.conference) ?? 0) - (indexByConference.get(b.conference) ?? 0);
    });
    const q = search.trim().toLowerCase();
    const searched = q ? allRows.filter((r) => r.conference.toLowerCase().includes(q)) : allRows;
    const ncaa = searched.find((r) => r.conference.toLowerCase().includes("ncaa")) || null;
    const rest = searched.filter((r) => !r.conference.toLowerCase().includes("ncaa"));
    return { ncaaRow: ncaa, filtered: rest };
  }, [rows, search, hittingConferenceStats]);
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
  const wrcPlusByConference = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const row of hittingConferenceStats) {
      const key = canonicalConferenceName(row.conference);
      if (!key) continue;
      const existing = map.get(key);
      if (existing == null || row.wrc_plus != null) map.set(key, row.wrc_plus ?? null);
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
    eraPlus: calcScore(baselines.era, row.era, false),
    fipPlus: calcScore(baselines.fip, row.fip, false),
    whipPlus: calcScore(baselines.whip, row.whip, false),
    k9Plus: calcScore(baselines.k9, row.k9, true),
    bb9Plus: calcScore(baselines.bb9, row.bb9, false),
    hr9Plus: calcScore(baselines.hr9, row.hr9, false),
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
                <TableHead className="text-right">WRC+</TableHead>
                <TableHead className="text-right">Hitter Talent+</TableHead>
                <TableHead className="text-right">Stuff+</TableHead>
                <TableHead className="text-right">Offensive Environment</TableHead>
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
                          const wrcPlus = wrcPlusByConference.get(canonicalConferenceName(r.conference));
                          return wrcPlus == null ? "—" : Math.round(Number(wrcPlus)).toString();
                        })()}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {isEditing ? (
                          <Input
                            type="number"
                            step="1"
                            value={editData.hitter_talent_plus ?? ""}
                            onChange={(e) => setEditData((p) => ({ ...p, hitter_talent_plus: num(e.target.value) }))}
                            className="h-7 w-[80px] text-right text-xs font-mono"
                          />
                        ) : (
                          (() => {
                            const v = r.hitter_talent_plus ?? hitterTalentByConference.get(canonicalConferenceName(r.conference)) ?? null;
                            return v == null ? "—" : Math.round(Number(v)).toString();
                          })()
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {(() => {
                          const stuff = stuffByConference.get(canonicalConferenceName(r.conference));
                          return stuff == null ? "—" : Number(stuff).toFixed(1);
                        })()}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {(() => {
                          const canonical = canonicalConferenceName(r.conference);
                          const wrcPlusRaw = wrcPlusByConference.get(canonical);
                          const wrcPlus = wrcPlusRaw == null ? null : Number(wrcPlusRaw);
                          const hitterTalent = r.hitter_talent_plus ?? hitterTalentByConference.get(canonical) ?? null;
                          const stuffRaw = stuffByConference.get(canonical);
                          const stuff = stuffRaw == null ? null : Number(stuffRaw);
                          const oe = calcOffensiveEnvironment(hitterTalent, stuff, wrcPlus);
                          return oe == null ? "—" : oe.toFixed(1);
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
                          <TableCell className="text-right font-mono">{ncaaDisplayRow.hitter_talent_plus ?? 100}</TableCell>
                          <TableCell className="text-right font-mono">
                            100
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {calcOffensiveEnvironment(ncaaDisplayRow.hitter_talent_plus ?? 100, 100, 100)?.toFixed(1) ?? "100.0"}
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
