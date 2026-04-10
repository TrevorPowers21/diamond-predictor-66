import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Upload, RefreshCw, Check, AlertCircle } from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ParsedRow {
  source_player_id: string;
  season: number;
  pitch_type: string;
  hand: string;
  team: string;
  team_id: string;
  conference: string | null;
  conference_id: string | null;
  pitches: number | null;
  velocity: number | null;
  ivb: number | null;
  hb: number | null;
  rel_height: number | null;
  rel_side: number | null;
  extension: number | null;
  spin: number | null;
  vaa: number | null;
  whiff_pct: number | null;
  stuff_plus: null;
  gyro_stuff_plus: null;
}

interface ImportResult {
  successCount: number;
  errorCount: number;
  errors: string[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseNum(val: string | undefined): number | null {
  if (!val || val.trim() === "" || val.trim() === "-") return null;
  const n = Number(val.trim());
  return Number.isFinite(n) ? n : null;
}

function parseWhiff(val: string | undefined): number | null {
  if (!val || val.trim() === "" || val.trim() === "-") return null;
  const cleaned = val.replace(/%/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseInt2(val: string | undefined): number | null {
  if (!val || val.trim() === "" || val.trim() === "-") return null;
  const n = Number(val.trim());
  return Number.isFinite(n) ? Math.round(n) : null;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function StuffPlusImporter() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [season, setSeason] = useState<number>(2025);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [pitchType, setPitchType] = useState<string>("");
  const [hand, setHand] = useState<string>("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  // ── CSV Upload & Parse ──────────────────────────────────────────────────

  async function handleFile(file: File) {
    setImportResult(null);
    setParseError(null);
    setParsedRows([]);
    setPitchType("");
    setHand("");

    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) {
        setParseError("CSV must have a header row and at least one data row.");
        return;
      }

      const header = parseCsvLine(lines[0]).map((h) => h.trim());

      // Column index mapping
      const col = (name: string) => header.indexOf(name);
      const iPlayerId = col("playerId");
      const iThrowsHand = col("throwsHand");
      const iTeamName = col("newestTeamName");
      const iTeamId = col("newestTeamId");
      const iPitchType = col("Pitch Type");
      const iPitches = col("P");
      const iVel = col("Vel");
      const iIVB = col("IndVertBrk");
      const iHB = col("HorzBrk");
      const iRelH = col("RelHeight");
      const iRelS = col("RelSide");
      const iExt = col("Extension");
      const iSpin = col("Spin");
      const iVAA = col("VertApprAngle");
      const iMiss = col("Miss%");

      if (iPlayerId === -1) {
        setParseError(`Missing required column 'playerId'. Found columns: ${header.join(", ")}`);
        return;
      }

      // Read pitch type from first data row
      const firstDataRow = parseCsvLine(lines[1]);
      const detectedPitchType = iPitchType !== -1 ? (firstDataRow[iPitchType] || "").trim() : "";
      if (!detectedPitchType) {
        setParseError("Could not detect Pitch Type from the first data row.");
        return;
      }
      setPitchType(detectedPitchType);

      // Detect hand from first data row
      const detectedHand = iThrowsHand !== -1 ? (firstDataRow[iThrowsHand] || "").trim() : "";
      setHand(detectedHand);

      // Fetch Teams Table for conference lookup
      const { data: teams } = await supabase.from("Teams Table").select("id, full_name, abbreviation, conference, conference_id, source_id");
      type TeamEntry = { conference: string | null; conference_id: string | null };
      const teamLookup = new Map<string, TeamEntry>();
      for (const t of teams || []) {
        const entry: TeamEntry = { conference: t.conference, conference_id: t.conference_id };
        if (t.source_id) teamLookup.set(String(t.source_id), entry);
        if (t.abbreviation) teamLookup.set(t.abbreviation.toLowerCase().trim(), entry);
        teamLookup.set(t.full_name.toLowerCase().trim(), entry);
      }

      // Parse data rows
      const rows: ParsedRow[] = [];
      for (let i = 1; i < lines.length; i++) {
        const values = parseCsvLine(lines[i]);
        const playerId = (values[iPlayerId] || "").trim();
        if (!playerId) continue;

        const teamId = iTeamId !== -1 ? (values[iTeamId] || "").trim() : "";
        const teamName = iTeamName !== -1 ? (values[iTeamName] || "").trim() : "";

        // Conference lookup: try source_id first, then team name
        let conf: TeamEntry = { conference: null, conference_id: null };
        if (teamId && teamLookup.has(teamId)) {
          conf = teamLookup.get(teamId)!;
        } else if (teamName && teamLookup.has(teamName.toLowerCase().trim())) {
          conf = teamLookup.get(teamName.toLowerCase().trim())!;
        }

        const rowHand = iThrowsHand !== -1 ? (values[iThrowsHand] || "").trim() : detectedHand;

        rows.push({
          source_player_id: playerId,
          season,
          pitch_type: detectedPitchType,
          hand: rowHand || detectedHand,
          team: teamName,
          team_id: teamId,
          conference: conf.conference,
          conference_id: conf.conference_id,
          pitches: parseInt2(values[iPitches]),
          velocity: parseNum(values[iVel]),
          ivb: parseNum(values[iIVB]),
          hb: parseNum(values[iHB]),
          rel_height: parseNum(values[iRelH]),
          rel_side: parseNum(values[iRelS]),
          extension: parseNum(values[iExt]),
          spin: parseInt2(values[iSpin]),
          vaa: parseNum(values[iVAA]),
          whiff_pct: parseWhiff(values[iMiss]),
          stuff_plus: null,
          gyro_stuff_plus: null,
        });
      }

      setParsedRows(rows);
    } catch (err: any) {
      setParseError(err.message || "Failed to parse CSV.");
    }
  }

  // ── Import to Supabase ──────────────────────────────────────────────────

  async function handleImport() {
    if (parsedRows.length === 0) return;
    setImporting(true);
    setImportResult(null);

    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    const BATCH_SIZE = 100;
    for (let i = 0; i < parsedRows.length; i += BATCH_SIZE) {
      const batch = parsedRows.slice(i, i + BATCH_SIZE);
      const { error } = await (supabase as any)
        .from("pitcher_stuff_plus_inputs")
        .insert(batch);

      if (error) {
        errorCount += batch.length;
        errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`);
      } else {
        successCount += batch.length;
      }
    }

    setImportResult({ successCount, errorCount, errors });
    setImporting(false);
  }

  // ── Render ──────────────────────────────────────────────────────────────

  const previewRows = parsedRows.slice(0, 5);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stuff+ Pitch Data Import</CardTitle>
        <CardDescription>
          Import pitch-by-pitch Stuff+ input data from CSV into the pitcher_stuff_plus_inputs table.
          Each CSV should contain data for a single pitch type.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Controls */}
        <div className="flex items-end gap-4 flex-wrap">
          <div className="space-y-2">
            <Label>Season</Label>
            <Select value={String(season)} onValueChange={(v) => setSeason(Number(v))}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2023">2023</SelectItem>
                <SelectItem value="2024">2024</SelectItem>
                <SelectItem value="2025">2025</SelectItem>
                <SelectItem value="2026">2026</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>CSV File</Label>
            <div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                  if (fileRef.current) fileRef.current.value = "";
                }}
              />
              <Button variant="outline" className="gap-2" onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4" />
                Choose CSV
              </Button>
            </div>
          </div>
        </div>

        {/* Parse Error */}
        {parseError && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="h-4 w-4" />
            {parseError}
          </div>
        )}

        {/* Preview */}
        {parsedRows.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant="outline" className="text-sm">
                Pitch Type: {pitchType}
              </Badge>
              <Badge variant="outline" className="text-sm">
                Hand: {hand || "—"}
              </Badge>
              <Badge variant="outline" className="text-sm">
                Season: {season}
              </Badge>
              <Badge variant="secondary" className="text-sm">
                {parsedRows.length} rows ready
              </Badge>
              {parsedRows.filter((r) => !r.conference).length > 0 && (
                <Badge variant="destructive" className="text-sm">
                  {parsedRows.filter((r) => !r.conference).length} missing conference
                </Badge>
              )}
            </div>

            {/* Preview table */}
            <div className="rounded-md border overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Player ID</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead>Conf</TableHead>
                    <TableHead>Vel</TableHead>
                    <TableHead>IVB</TableHead>
                    <TableHead>HB</TableHead>
                    <TableHead>RelH</TableHead>
                    <TableHead>RelS</TableHead>
                    <TableHead>Ext</TableHead>
                    <TableHead>Spin</TableHead>
                    <TableHead>VAA</TableHead>
                    <TableHead>Whiff%</TableHead>
                    <TableHead>P</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">{r.source_player_id}</TableCell>
                      <TableCell>{r.team}</TableCell>
                      <TableCell>{r.conference || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>{r.velocity ?? "—"}</TableCell>
                      <TableCell>{r.ivb ?? "—"}</TableCell>
                      <TableCell>{r.hb ?? "—"}</TableCell>
                      <TableCell>{r.rel_height ?? "—"}</TableCell>
                      <TableCell>{r.rel_side ?? "—"}</TableCell>
                      <TableCell>{r.extension ?? "—"}</TableCell>
                      <TableCell>{r.spin ?? "—"}</TableCell>
                      <TableCell>{r.vaa ?? "—"}</TableCell>
                      <TableCell>{r.whiff_pct != null ? `${r.whiff_pct}%` : "—"}</TableCell>
                      <TableCell>{r.pitches ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {parsedRows.length > 5 && (
              <p className="text-xs text-muted-foreground">
                Showing first 5 of {parsedRows.length} rows.
              </p>
            )}

            {/* Import Button */}
            <Button onClick={handleImport} disabled={importing} className="gap-2">
              {importing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {importing ? "Importing..." : `Import ${parsedRows.length} Rows`}
            </Button>
          </div>
        )}

        {/* Result */}
        {importResult && (
          <div className="space-y-1">
            {importResult.successCount > 0 && (
              <p className="text-sm text-green-600">
                Successfully imported {importResult.successCount} rows.
              </p>
            )}
            {importResult.errorCount > 0 && (
              <p className="text-sm text-destructive">
                Failed to import {importResult.errorCount} rows.
              </p>
            )}
            {importResult.errors.length > 0 && (
              <div className="text-xs text-destructive space-y-0.5">
                {importResult.errors.slice(0, 5).map((e, i) => (
                  <p key={i}>{e}</p>
                ))}
                {importResult.errors.length > 5 && (
                  <p>...and {importResult.errors.length - 5} more errors</p>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
