import { useState, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Search, Edit2, Check, X, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface ConferenceStat {
  id: string;
  conference: string;
  season: number;
  avg: number | null;
  obp: number | null;
  slg: number | null;
  ops: number | null;
  iso: number | null;
  wrc: number | null;
  ev_score: number | null;
  barrel_score: number | null;
  whiff_score: number | null;
  chase_score: number | null;
  offensive_power_rating: number | null;
  avg_plus: number | null;
  obp_plus: number | null;
  slg_plus: number | null;
  ops_plus: number | null;
  iso_plus: number | null;
  wrc_plus: number | null;
  power_rating_plus: number | null;
  stuff_plus: number | null;
}

function normalizeConferenceName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/^'?\s*25\s+/i, "")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalConferenceName(raw: string | null | undefined): string {
  const cleaned = normalizeConferenceName(raw);
  if (!cleaned) return "";
  const key = cleaned.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (key.includes("atlanticcoastconference")) return "ACC";
  if (key.includes("americaneast")) return "American East";
  if (key.includes("atlanticsunconference")) return "Atlantic Sun Conference";
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
  };
  return map[key] || cleaned;
}

function placeAccBetweenAmericanEastAndAtlanticSun<T extends { conference: string }>(list: T[]): T[] {
  const out = [...list];
  const idxAcc = out.findIndex((r) => canonicalConferenceName(r.conference) === "ACC");
  if (idxAcc < 0) return out;

  const [accRow] = out.splice(idxAcc, 1);
  const idxAmericanEast = out.findIndex((r) => canonicalConferenceName(r.conference) === "American East");
  const idxAtlanticSun = out.findIndex((r) => canonicalConferenceName(r.conference) === "Atlantic Sun Conference");

  let insertAt = out.length;
  if (idxAmericanEast >= 0) insertAt = idxAmericanEast + 1;
  if (idxAtlanticSun >= 0) insertAt = Math.min(insertAt, idxAtlanticSun);
  out.splice(insertAt, 0, accRow);
  return out;
}

type EditFields = Omit<ConferenceStat, "id" | "created_at" | "updated_at">;

const NUM_FIELDS: (keyof EditFields)[] = [
  "avg", "obp", "slg", "ops", "iso", "wrc",
  "avg_plus", "obp_plus", "slg_plus", "ops_plus", "iso_plus", "wrc_plus", "stuff_plus",
];

const LABELS: Record<string, string> = {
  avg: "AVG", obp: "OBP", slg: "SLG", ops: "OPS", iso: "ISO", wrc: "WRC",
  avg_plus: "AVG+", obp_plus: "OBP+", slg_plus: "SLG+",
  ops_plus: "OPS+", iso_plus: "ISO+", wrc_plus: "WRC+", stuff_plus: "Stuff+",
};

const isWholePlusField = (field: keyof EditFields) =>
  field.includes("plus") && field !== "stuff_plus";

function computeDerivedConferenceStats(avg: number | null, obp: number | null, slg: number | null) {
  if (avg == null || obp == null || slg == null) {
    return { ops: null, iso: null, wrc: null };
  }
  const iso = slg - avg;
  const ops = obp + slg;
  const wrc = (0.45 * obp) + (0.30 * slg) + (0.15 * avg) + (0.10 * iso);
  const round3 = (v: number) => Math.round(v * 1000) / 1000;
  return { ops: round3(ops), iso: round3(iso), wrc: round3(wrc) };
}

export default function ConferenceStatsTable() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editData, setEditData] = useState<Partial<EditFields>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { data: stats = [], isLoading } = useQuery({
    queryKey: ["conference_stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conference_stats")
        .select("*")
        .order("conference");
      if (error) throw error;
      return data as ConferenceStat[];
    },
  });

  const updateStat = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<EditFields> }) => {
      const { error } = await supabase
        .from("conference_stats")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conference_stats"] });
      setEditingId(null);
      toast.success("Conference stats updated");
    },
    onError: (e) => toast.error(`Failed: ${e.message}`),
  });

  const deleteStat = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("conference_stats").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conference_stats"] });
      toast.success("Conference stats deleted");
    },
    onError: (e) => toast.error(`Failed: ${e.message}`),
  });

  const importCsv = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) throw new Error("CSV has no data rows");

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

      const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, " ").trim());
      const idx = (names: string[]) => {
        for (const n of names) {
          const i = header.findIndex((h) => h === n);
          if (i >= 0) return i;
        }
        return -1;
      };
      const parseNum = (v: string | undefined) => {
        if (!v) return null;
        const cleaned = v.replace(/[%,$]/g, "").trim();
        if (!cleaned) return null;
        const n = Number.parseFloat(cleaned);
        return Number.isFinite(n) ? n : null;
      };
      const round3 = (v: number) => Math.round(v * 1000) / 1000;

      const conferenceIdx = idx(["team", "conference"]);
      const avgIdx = idx(["avg"]);
      const obpIdx = idx(["obp"]);
      const slgIdx = idx(["slg"]);
      const avgPlusIdx = idx(["avg+", "avg plus"]);
      const obpPlusIdx = idx(["obp+", "obp plus"]);
      const slgPlusIdx = idx(["slg+", "slg plus"]);
      const opsPlusIdx = idx(["ops+", "ops plus"]);
      const isoPlusIdx = idx(["iso+", "iso plus"]);
      const wrcPlusIdx = idx(["wrc+", "wrc plus"]);
      const powerRatingPlusIdx = idx(["power rating+", "power rating plus"]);
      const stuffPlusIdx = idx(["stuff+", "stuff plus"]);

      if (conferenceIdx < 0 || avgIdx < 0 || obpIdx < 0 || slgIdx < 0) {
        throw new Error("CSV must include Team/Conference, AVG, OBP, and SLG columns");
      }

      const records: Array<Record<string, unknown>> = [];
      for (let r = 1; r < lines.length; r++) {
        const cols = parseCsvLine(lines[r]);
        const conference = canonicalConferenceName(cols[conferenceIdx]);
        if (!conference) continue;
        const avg = parseNum(cols[avgIdx]);
        const obp = parseNum(cols[obpIdx]);
        const slg = parseNum(cols[slgIdx]);
        if (avg == null || obp == null || slg == null) continue;
        const iso = slg - avg;
        const ops = obp + slg;
        const wrc = (0.45 * obp) + (0.30 * slg) + (0.15 * avg) + (0.10 * iso);
        records.push({
          conference,
          season: 2025,
          avg: round3(avg),
          obp: round3(obp),
          slg: round3(slg),
          ops: round3(ops),
          iso: round3(iso),
          wrc: round3(wrc),
          avg_plus: avgPlusIdx >= 0 ? parseNum(cols[avgPlusIdx]) : null,
          obp_plus: obpPlusIdx >= 0 ? parseNum(cols[obpPlusIdx]) : null,
          slg_plus: slgPlusIdx >= 0 ? parseNum(cols[slgPlusIdx]) : null,
          ops_plus: opsPlusIdx >= 0 ? parseNum(cols[opsPlusIdx]) : null,
          iso_plus: isoPlusIdx >= 0 ? parseNum(cols[isoPlusIdx]) : null,
          wrc_plus: wrcPlusIdx >= 0 ? parseNum(cols[wrcPlusIdx]) : null,
          power_rating_plus: powerRatingPlusIdx >= 0 ? parseNum(cols[powerRatingPlusIdx]) : null,
          stuff_plus: stuffPlusIdx >= 0 ? parseNum(cols[stuffPlusIdx]) : null,
        });
      }

      if (records.length === 0) throw new Error("No valid conference rows found in CSV");

      const { error } = await supabase
        .from("conference_stats")
        .upsert(records, { onConflict: "conference,season" });
      if (error) throw error;
      return records.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["conference_stats"] });
      toast.success(`Imported ${count} conference rows from CSV`);
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`CSV import failed: ${msg}`);
    },
  });

  const { ncaaRow, filtered } = useMemo(() => {
    // Collapse alias duplicates to one canonical conference row.
    const byConference = new Map<string, ConferenceStat>();
    const score = (s: ConferenceStat) =>
      NUM_FIELDS.reduce((acc, f) => acc + ((s[f] as number | null) != null ? 1 : 0), 0) +
      (s.stuff_plus != null ? 1 : 0);
    for (const s of stats) {
      const canonical = canonicalConferenceName(s.conference) || normalizeConferenceName(s.conference);
      const key = canonical.toLowerCase();
      if (!key) continue;
      const current = byConference.get(key);
      if (!current || score(s) > score(current)) {
        byConference.set(key, { ...s, conference: canonical });
      }
    }

    // Keep the table focused: only rows that already have the base stats needed.
    let list = Array.from(byConference.values()).filter(
      (s) => s.avg != null && s.obp != null && s.slg != null,
    );
    list = placeAccBetweenAmericanEastAndAtlanticSun(list);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((s) => s.conference.toLowerCase().includes(q));
    }
    const ncaa = list.find((s) => s.conference.toLowerCase().includes("ncaa"));
    const rest = list.filter((s) => !s.conference.toLowerCase().includes("ncaa"));
    return { ncaaRow: ncaa || null, filtered: rest };
  }, [stats, search]);

  const startEdit = (stat: ConferenceStat) => {
    setEditingId(stat.id);
    setEditName(canonicalConferenceName(stat.conference));
    const fields: Record<string, number | null> = {};
    NUM_FIELDS.forEach((f) => { fields[f] = stat[f] as number | null; });
    setEditData(fields);
  };

  const handleFieldChange = (field: keyof EditFields, value: string) => {
    setEditData((prev) => ({
      ...prev,
      [field]: value === "" ? null : parseFloat(value),
    }));
  };

  const fmt = (val: number | null, isPlus = false, digits = 3) => {
    if (val === null || val === undefined) return "—";
    return isPlus ? val.toFixed(0) : val.toFixed(digits);
  };

  const renderRow = (stat: ConferenceStat, pinned = false) => (
    <TableRow key={stat.id} className={pinned ? "bg-muted/50 font-semibold sticky bottom-0 z-10 border-t-2 border-primary/20" : ""}>
      <TableCell className={`font-medium sticky left-0 z-10 ${pinned ? "bg-muted/50" : "bg-background"}`}>
        {editingId === stat.id ? (
          <Input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="h-7 w-full max-w-[160px] text-xs"
          />
        ) : (
          pinned ? "NCAA Average" : normalizeConferenceName(stat.conference)
        )}
      </TableCell>
      {NUM_FIELDS.map((f) => (
        <TableCell key={f} className="text-center">
          {editingId === stat.id ? (
            <Input
              type="number"
              step={isWholePlusField(f) || f === "offensive_power_rating" ? "1" : f === "stuff_plus" ? "0.1" : "0.001"}
              value={editData[f] ?? ""}
              onChange={(e) => handleFieldChange(f, e.target.value)}
              className="h-7 w-[70px] text-center text-xs"
            />
          ) : (
            <span className="text-sm tabular-nums">
              {fmt(
                stat[f] as number | null,
                isWholePlusField(f) || f === "offensive_power_rating",
                f === "stuff_plus" ? 1 : 3,
              )}
            </span>
          )}
        </TableCell>
      ))}
      <TableCell>
        {editingId === stat.id ? (
          <div className="flex gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => {
                const avg = (editData.avg as number | null | undefined) ?? stat.avg;
                const obp = (editData.obp as number | null | undefined) ?? stat.obp;
                const slg = (editData.slg as number | null | undefined) ?? stat.slg;
                const derived = computeDerivedConferenceStats(avg ?? null, obp ?? null, slg ?? null);
                updateStat.mutate({
                  id: stat.id,
                  updates: { ...editData, ...derived, conference: canonicalConferenceName(editName) },
                });
              }}
            >
              <Check className="h-3.5 w-3.5 text-primary" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingId(null)}>
              <X className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        ) : (
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(stat)}>
              <Edit2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => {
                if (confirm(`Delete stats for "${stat.conference}"?`)) deleteStat.mutate(stat.id);
              }}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-base">Conference Stats (NCAA)</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Shared table for Teams and Admin. Plus stats (AVG+ through WRC+) drive the transfer portal equation.
          </p>
        </div>
        <div className="flex w-full sm:w-auto items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              importCsv.mutate(f);
              e.currentTarget.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={importCsv.isPending}
          >
            {importCsv.isPending ? "Importing CSV…" : "Import CSV"}
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
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">Loading…</div>
        ) : filtered.length === 0 && !ncaaRow ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            No conference stats found. Run "Import Conference Stats" from Data Sync.
          </div>
        ) : (
          <div className="overflow-auto max-h-[60vh]">
            <Table>
              <TableHeader className="sticky top-0 z-20 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
                <TableRow>
                  <TableHead className="min-w-[160px] sticky left-0 bg-background z-10">Conference</TableHead>
                  {NUM_FIELDS.map((f) => (
                    <TableHead key={f} className="min-w-[70px] text-center">{LABELS[f]}</TableHead>
                  ))}
                  <TableHead className="w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((stat) => renderRow(stat))}
                {ncaaRow && renderRow(ncaaRow, true)}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
