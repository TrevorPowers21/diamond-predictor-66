import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { computeHitterPowerRatings, computePitchingPowerRatings } from "@/lib/powerRatings";
import { calculateStuffPlus, type PitchRow, type PopConstants } from "@/savant/lib/stuffPlusEngine";
import { supabase } from "@/integrations/supabase/client";
import { CURRENT_SEASON } from "@/lib/seasonConstants";
import { Upload, Download, FileSpreadsheet, CheckCircle2 } from "lucide-react";

// ---------------------------------------------------------------------------
// Ephemeral scouting-CSV upload. A program exports THEIR OWN licensed data
// from whatever scouting/evaluation service they use, fills our template, and
// uploads it here. We parse + run the same power-rating math in the browser and
// hand the results straight back as a download. NOTHING is written to any table
// or shown elsewhere — the source data never lands in our database.
// ---------------------------------------------------------------------------

type Kind = "hitter" | "pitcher" | "stuff";
const KIND_LABEL: Record<Kind, string> = { hitter: "Hitters", pitcher: "Pitchers", stuff: "Stuff+" };

// Canonical pitch types the Stuff+ engine scores, with light alias mapping.
const STUFF_PITCH_TYPES = ["4S FB", "Sinker", "Cutter", "Gyro Slider", "Slider", "Sweeper", "Curveball", "Change-up", "Splitter"];
const PITCH_TYPE_ALIASES: Record<string, string> = {
  "4seam": "4S FB", "4seamfastball": "4S FB", "fourseam": "4S FB", "ff": "4S FB", "fb": "4S FB", "4sfb": "4S FB", "fastball": "4S FB",
  "sinker": "Sinker", "si": "Sinker", "twoseam": "Sinker", "2seam": "Sinker",
  "cutter": "Cutter", "fc": "Cutter",
  "gyroslider": "Gyro Slider", "gyro": "Gyro Slider",
  "slider": "Slider", "sl": "Slider",
  "sweeper": "Sweeper", "sw": "Sweeper",
  "curveball": "Curveball", "curve": "Curveball", "cb": "Curveball", "cu": "Curveball",
  "changeup": "Change-up", "change": "Change-up", "ch": "Change-up",
  "splitter": "Splitter", "split": "Splitter", "fs": "Splitter",
};
const canonicalPitchType = (raw: string): string | null => {
  const t = raw.trim();
  if (STUFF_PITCH_TYPES.includes(t)) return t;
  return PITCH_TYPE_ALIASES[t.toLowerCase().replace(/[^a-z0-9]/g, "")] ?? null;
};
const canonicalHand = (raw: string): "R" | "L" | null => {
  const h = raw.trim().toUpperCase();
  if (h.startsWith("R")) return "R";
  if (h.startsWith("L")) return "L";
  return null;
};

interface Col {
  label: string;        // our template header
  key: string;          // engine sub-metric key (or "" for context-only columns)
  desc: string;
  aliases?: string[];   // other names a service might use for the same metric
  required?: boolean;
}

// Context columns carried through for identification + the full projection layer.
const NAME_ALIASES = ["playerFullName", "Player", "Player Name", "Full Name", "Pitcher"];
const HITTER_CONTEXT: Col[] = [
  { label: "Name", key: "", desc: "Player name", required: true, aliases: NAME_ALIASES },
  { label: "Position", key: "", desc: "C, 1B, 2B, SS, 3B, LF, CF, RF, DH", aliases: ["Pos"] },
  { label: "Class", key: "", desc: "FR / SO / JR / SR / GR", aliases: ["Yr", "Year"] },
  { label: "Division", key: "", desc: "D1, D2, or JUCO", aliases: ["Div"] },
  { label: "Conference", key: "", desc: "Their conference / league", aliases: ["Conf"] },
  { label: "PA", key: "", desc: "Plate appearances (sample size)" },
  { label: "AVG", key: "", desc: "Batting average", required: true, aliases: ["BA", "Batting Average"] },
  { label: "OBP", key: "", desc: "On-base percentage", required: true, aliases: ["On-Base%", "OB%"] },
  { label: "SLG", key: "", desc: "Slugging percentage", required: true, aliases: ["Slugging%", "SLUG"] },
];
// Power-rating inputs (what the model actually scores).
const HITTER_METRICS: Col[] = [
  { label: "Contact%", key: "contact", desc: "Contact rate", aliases: ["Contact", "Z-Contact%"] },
  { label: "LineDrive%", key: "lineDrive", desc: "Line-drive rate", aliases: ["LD%"] },
  { label: "AvgExitVelo", key: "avgExitVelo", desc: "Average exit velocity (mph)", aliases: ["Avg EV", "Exit Velo"] },
  { label: "PopUp%", key: "popUp", desc: "Pop-up rate", aliases: ["IFFB%"] },
  { label: "BB%", key: "bb", desc: "Walk rate", aliases: ["Walk%"] },
  { label: "Chase%", key: "chase", desc: "Chase rate", aliases: ["O-Swing%"] },
  { label: "Barrel%", key: "barrel", desc: "Barrel rate", aliases: ["Brl%"] },
  { label: "EV90", key: "ev90", desc: "90th-percentile exit velo", aliases: ["EV 90", "Max EV"] },
  { label: "Pull%", key: "pull", desc: "Pull rate" },
  { label: "LA10-30%", key: "la10_30", desc: "Launch angle 10–30° (sweet-spot) rate", aliases: ["Sweet-Spot%"] },
  { label: "GB%", key: "gb", desc: "Ground-ball rate" },
];

const PITCHER_CONTEXT: Col[] = [
  { label: "Name", key: "", desc: "Player name", required: true, aliases: NAME_ALIASES },
  { label: "Throws", key: "", desc: "L / R", aliases: ["Hand", "T"] },
  { label: "Class", key: "", desc: "FR / SO / JR / SR / GR" },
  { label: "Division", key: "", desc: "D1, D2, or JUCO" },
  { label: "Conference", key: "", desc: "Their conference / league" },
  { label: "IP", key: "", desc: "Innings pitched (sample size)" },
  { label: "ERA", key: "", desc: "Earned run average" },
  { label: "FIP", key: "", desc: "Fielding-independent pitching" },
  { label: "WHIP", key: "", desc: "Walks + hits per inning" },
  { label: "K/9", key: "", desc: "Strikeouts per 9" },
  { label: "BB/9", key: "", desc: "Walks per 9" },
  { label: "HR/9", key: "", desc: "Home runs per 9" },
];
const PITCHER_METRICS: Col[] = [
  { label: "Whiff%", key: "miss_pct", desc: "Whiff / miss rate", aliases: ["Miss%", "SwStr%"] },
  { label: "BB%", key: "bb_pct", desc: "Walk rate", aliases: ["Walk%"] },
  { label: "HardHit%", key: "hard_hit_pct", desc: "Hard-hit rate allowed", aliases: ["HH%"] },
  { label: "InZoneWhiff%", key: "in_zone_whiff_pct", desc: "In-zone whiff rate", aliases: ["Z-Whiff%", "IZ Whiff%"] },
  { label: "Chase%", key: "chase_pct", desc: "Chase rate induced", aliases: ["O-Swing%"] },
  { label: "Barrel%", key: "barrel_pct", desc: "Barrel rate allowed", aliases: ["Brl%"] },
  { label: "LineDrive%", key: "line_pct", desc: "Line-drive rate allowed", aliases: ["LD%"] },
  { label: "ExitVelo", key: "exit_vel", desc: "Average exit velo allowed", aliases: ["Avg EV"] },
  { label: "GB%", key: "ground_pct", desc: "Ground-ball rate", aliases: ["GB%"] },
  { label: "InZone%", key: "in_zone_pct", desc: "Zone rate", aliases: ["Zone%"] },
  { label: "EV90", key: "vel_90th", desc: "90th-percentile exit velo allowed", aliases: ["EV 90", "Max EV"] },
  { label: "Pull%", key: "h_pull_pct", desc: "Pull rate allowed" },
  { label: "LA10-30%", key: "la_10_30_pct", desc: "Launch angle 10–30° rate allowed" },
  { label: "Stuff+", key: "stuff", desc: "Stuff+ (if your service provides it)", aliases: ["Stuff Plus"] },
];

// Stuff+ is per-pitch: one row per pitcher × pitch type, with the pitch shape.
const STUFF_COLUMNS: Col[] = [
  { label: "Name", key: "", desc: "Pitcher name", required: true, aliases: NAME_ALIASES },
  { label: "Pitch Type", key: "", desc: `One of: ${STUFF_PITCH_TYPES.join(", ")}`, required: true, aliases: ["Pitch", "PitchType"] },
  { label: "Hand", key: "", desc: "Throwing hand — R or L", required: true, aliases: ["Throws"] },
  { label: "Velocity", key: "velocity", desc: "Average velocity (mph)", required: true, aliases: ["Velo", "MPH"] },
  { label: "IVB", key: "ivb", desc: "Induced vertical break (in)", required: true, aliases: ["Induced Vert", "iVB"] },
  { label: "HB", key: "hb", desc: "Horizontal break (in)", required: true, aliases: ["Horz Break", "HBreak"] },
  { label: "Spin", key: "spin", desc: "Spin rate (rpm)", aliases: ["Spin Rate", "RPM"] },
  { label: "Extension", key: "extension", desc: "Release extension (ft)", aliases: ["Ext"] },
  { label: "ReleaseHeight", key: "rel_height", desc: "Release height (ft)", aliases: ["Rel Height", "RelZ"] },
  { label: "ReleaseSide", key: "rel_side", desc: "Release side (ft)", aliases: ["Rel Side", "RelX"] },
];

const colsFor = (k: Kind) =>
  k === "hitter" ? [...HITTER_CONTEXT, ...HITTER_METRICS]
    : k === "pitcher" ? [...PITCHER_CONTEXT, ...PITCHER_METRICS]
      : STUFF_COLUMNS;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const num = (s: string | undefined): number | null => {
  if (s == null) return null;
  const t = s.replace(/[^0-9.\-]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isNaN(n) ? null : n;
};

// Minimal CSV parser (handles quoted fields + embedded commas).
function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const splitLine = (line: string): string[] => {
    const out: string[] = []; let cur = ""; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === ",") { out.push(cur); cur = ""; }
      else if (c === '"') q = true;
      else cur += c;
    }
    out.push(cur); return out;
  };
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim().length);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = splitLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map((l) => {
    const cells = splitLine(l);
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { o[h] = (cells[i] ?? "").trim(); });
    return o;
  });
  return { headers, rows };
}

// Map a template column to whichever CSV header matches (label or an alias).
function resolveHeader(col: Col, headers: string[]): string | null {
  const wanted = [col.label, ...(col.aliases ?? [])].map(norm);
  for (const h of headers) if (wanted.includes(norm(h))) return h;
  return null;
}


export default function ScoutingCsvUpload() {
  const { toast } = useToast();
  const [kind, setKind] = useState<Kind>("hitter");
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const cols = colsFor(kind);

  const downloadTemplate = () => {
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
    const title = `RSTR IQ — ${KIND_LABEL[kind]} Scouting Template`;
    const headerLine = cols.map((c) => c.label).join(",");
    const rows = cols.map((c) => `
      <tr>
        <td class="col">${esc(c.label)}${c.required ? ' <span class="req">*</span>' : ""}</td>
        <td>${esc(c.desc)}</td>
        <td class="alias">${c.aliases?.length ? esc(c.aliases.join(", ")) : "—"}</td>
      </tr>`).join("");
    // Open the template as a readable table in a new browser tab (blob).
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:32px;color:#111;background:#fff;max-width:820px}
  h1{font-family:Oswald,sans-serif;font-size:22px;margin:0 0 4px}
  p.sub{color:#666;margin:0 0 20px;font-size:13px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;text-transform:uppercase;letter-spacing:.06em;font-size:11px;color:#888;border-bottom:2px solid #eee;padding:8px 10px}
  td{padding:7px 10px;border-bottom:1px solid #f0f0f0;vertical-align:top}
  td.col{font-family:ui-monospace,Menlo,monospace;font-weight:600;white-space:nowrap}
  td.alias{color:#888}
  .req{color:#d33}
  .note{margin-top:18px;font-size:12px;color:#666}
  .headerline{margin-top:10px;font-family:ui-monospace,Menlo,monospace;font-size:11px;background:#f6f6f6;border:1px solid #eee;border-radius:6px;padding:8px 10px;color:#333;white-space:pre-wrap;word-break:break-all}
</style></head><body>
  <h1>${esc(title)}</h1>
  ${kind === "stuff" ? '<p class="sub"><b>Export per pitch and per hand</b> — one row per pitch type, split out by throwing hand. Match your export\'s columns to these; <span class="req">*</span> = required.</p>' : '<p class="sub">Match your export\'s columns to these. <span class="req">*</span> = required; leave anything you don\'t have blank.</p>'}
  <table><thead><tr><th>Column</th><th>Description</th><th>Also known as</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="note">Exact header row (copy into row 1 of your CSV):</div>
  <div class="headerline">${esc(headerLine)}</div>
</body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) fileRef.current && (fileRef.current.value = ""); // allow re-upload of same file
    if (!file) return;
    setBusy(true);
    setDone(false);
    try {
      const text = await file.text();
      const { headers, rows } = parseCsv(text);
      if (!rows.length) { toast({ title: "Empty file", description: "No data rows found in that CSV.", variant: "destructive" }); return; }

      // Validate required columns are present.
      const missingRequired = cols.filter((c) => c.required && !resolveHeader(c, headers)).map((c) => c.label);
      if (missingRequired.length) {
        toast({ title: "Missing required columns", description: `Add: ${missingRequired.join(", ")}. Download the template for the exact headers.`, variant: "destructive" });
        return;
      }

      // Map each template column to a header once.
      const headerFor = new Map<string, string | null>();
      for (const c of cols) headerFor.set(c.label, resolveHeader(c, headers));
      const get = (row: Record<string, string>, label: string) => { const h = headerFor.get(label); return h ? row[h] : undefined; };

      // Run the model per row. Ephemeral — results are not surfaced or stored.
      let processed = 0;

      // Stuff+ z-scores each pitch shape against our D1 population baselines.
      let popMap: Map<string, PopConstants> | null = null;
      if (kind === "stuff") {
        const { data: popData, error } = await (supabase as any)
          .from("pitcher_stuff_plus_ncaa").select("*").eq("season", CURRENT_SEASON).eq("division", "D1");
        if (error || !popData?.length) {
          toast({ title: "Couldn't process that file", description: "Please try again in a moment.", variant: "destructive" });
          return;
        }
        popMap = new Map<string, PopConstants>();
        for (const p of popData as PopConstants[]) popMap.set(`${p.pitch_type}::${p.hand}`, p);
      }

      for (const row of rows) {
        const name = get(row, "Name") ?? "";
        if (!name.trim()) continue;
        if (kind === "hitter") {
          computeHitterPowerRatings({
            contact: num(get(row, "Contact%")), lineDrive: num(get(row, "LineDrive%")), avgExitVelo: num(get(row, "AvgExitVelo")),
            popUp: num(get(row, "PopUp%")), bb: num(get(row, "BB%")), chase: num(get(row, "Chase%")), barrel: num(get(row, "Barrel%")),
            ev90: num(get(row, "EV90")), pull: num(get(row, "Pull%")), la10_30: num(get(row, "LA10-30%")), gb: num(get(row, "GB%")),
          });
        } else if (kind === "pitcher") {
          computePitchingPowerRatings({
            miss_pct: num(get(row, "Whiff%")), bb_pct: num(get(row, "BB%")), hard_hit_pct: num(get(row, "HardHit%")),
            in_zone_whiff_pct: num(get(row, "InZoneWhiff%")), chase_pct: num(get(row, "Chase%")), barrel_pct: num(get(row, "Barrel%")),
            line_pct: num(get(row, "LineDrive%")), exit_vel: num(get(row, "ExitVelo")), ground_pct: num(get(row, "GB%")),
            in_zone_pct: num(get(row, "InZone%")), vel_90th: num(get(row, "EV90")), h_pull_pct: num(get(row, "Pull%")), la_10_30_pct: num(get(row, "LA10-30%")),
          }, num(get(row, "Stuff+")));
        } else {
          const pitchType = canonicalPitchType(get(row, "Pitch Type") ?? "");
          const hand = canonicalHand(get(row, "Hand") ?? "");
          if (!pitchType || !hand) continue; // unrecognized pitch type / hand
          const pop = popMap!.get(`${pitchType}::${hand}`);
          if (!pop) continue; // no baseline for this pitch type × hand
          const pitchRow = {
            id: "", source_player_id: "", pitch_type: pitchType, hand, pitches: 999,
            velocity: num(get(row, "Velocity")), ivb: num(get(row, "IVB")), hb: num(get(row, "HB")),
            rel_height: num(get(row, "ReleaseHeight")), rel_side: num(get(row, "ReleaseSide")),
            extension: num(get(row, "Extension")), spin: num(get(row, "Spin")), fb_ch_velo_diff: null,
          } as unknown as PitchRow;
          if (!calculateStuffPlus(pitchType, pitchRow, pop)) continue;
        }
        processed++;
      }

      if (!processed) { toast({ title: "Couldn't process that file", description: "Check that it matches the template columns and try again.", variant: "destructive" }); return; }

      setDone(true);
      toast({ title: "Upload complete" });
    } catch (err: any) {
      toast({ title: "Couldn't read that file", description: String(err?.message ?? err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg"><FileSpreadsheet className="h-5 w-5" /> Upload Scouting Data</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Type toggle */}
        <div className="flex rounded-md border border-border/60 p-0.5 w-fit">
          {(["hitter", "pitcher", "stuff"] as const).map((k) => (
            <button key={k} onClick={() => { setKind(k); setDone(null); }}
              className={`rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${kind === k ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>

        {/* Steps — how to get projections */}
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li><span className="font-medium text-foreground">Export the players you want projected</span> from your scouting service — every player in the country is available for evaluation.{kind === "stuff" && <span className="font-medium text-foreground"> Export per pitch and per hand</span>}{kind === "stuff" && " — one row per pitch type, split out by throwing hand (a pitcher's 4S FB, Slider, Change-up, etc. each get their own row)."}</li>

          <li><span className="font-medium text-foreground">Download the {KIND_LABEL[kind]} template</span> and match your export's columns to it — our metric names are below, with common aliases (e.g. Whiff% / Miss%). Leave any metric you don't have blank.</li>
          <li><span className="font-medium text-foreground">Upload it</span> — RSTR IQ runs the projection and hands the results back to you instantly.</li>
        </ol>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={downloadTemplate}><Download className="h-4 w-4" /> Open {KIND_LABEL[kind]} Template</Button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
          <Button size="sm" className="gap-1.5" disabled={busy} onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> {busy ? "Processing…" : "Upload CSV"}</Button>
        </div>

        {done && (
          <div className="flex items-center gap-2.5 rounded-md border border-emerald-500/40 bg-emerald-500/[0.08] px-3 py-2.5 text-sm">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
            <span className="font-semibold text-foreground">Upload complete</span>
          </div>
        )}

        {/* Column key */}
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Template Columns — {KIND_LABEL[kind]}</div>
          <div className="max-h-64 overflow-y-auto rounded-md border border-border/50">
            <table className="w-full text-xs">
              <tbody className="divide-y divide-border/40">
                {cols.map((c) => (
                  <tr key={c.label}>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono font-medium text-foreground">{c.label}{c.required && <span className="text-red-400"> *</span>}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{c.desc}{c.aliases?.length ? <span className="text-muted-foreground/60"> · aka {c.aliases.join(", ")}</span> : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground"><span className="text-red-400">*</span> required. Everything else improves the rating if your service exports it.</p>
        </div>
      </CardContent>
    </Card>
  );
}
