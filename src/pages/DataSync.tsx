import { useState, useRef } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import CsvBulkImport from "@/components/CsvBulkImport";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Download, Upload, RefreshCw, FileSpreadsheet, CheckCircle, AlertCircle, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

type SyncResult = {
  success: boolean;
  imported?: number;
  exported?: number;
  skipped?: number;
  config_imported?: number;
  conferences_found?: number;
  error?: string;
  players?: { imported?: number; skipped?: number; exported?: number };
  stats?: { imported?: number; skipped?: number; exported?: number };
  returner?: { imported?: number; skipped?: number; config_imported?: number };
  transfer?: { imported?: number; skipped?: number; config_imported?: number };
  transfer_nil?: { imported?: number; skipped?: number };
  returner_nil?: { imported?: number; skipped?: number };
  tcu_nil?: { imported?: number; skipped?: number };
  returner_power?: { imported?: number; skipped?: number; conferences_found?: number };
  transfer_power?: { imported?: number; skipped?: number; conferences_found?: number };
};

export default function DataSync() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const [spreadsheetId, setSpreadsheetId] = useState("1UwtImwQ74ThQlMJizsqMSp6b4tG39uXuiI8nrQ46ZAE");
  const [playersRange, setPlayersRange] = useState("Players!A:N");
  const [statsRange, setStatsRange] = useState("Stats!A:AE");
  const [loading, setLoading] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);

  // Internal ratings import state
  const internalFileRef = useRef<HTMLInputElement>(null);
  const [internalLoading, setInternalLoading] = useState(false);

  // Power ratings CSV import state
  const powerRatingsFileRef = useRef<HTMLInputElement>(null);
  const [powerRatingsLoading, setPowerRatingsLoading] = useState(false);
  const [powerRatingsResult, setPowerRatingsResult] = useState<{ imported: number; skipped: number; total: number; errors?: string[] } | null>(null);
  const [internalResult, setInternalResult] = useState<{ imported: number; skipped: number; total: number; errors?: string[] } | null>(null);

  const handleInternalRatingsImport = async (file: File) => {
    setInternalLoading(true);
    setInternalResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const csvContent = await file.text();
      const res = await supabase.functions.invoke("import-internal-ratings", {
        body: { csv_content: csvContent },
      });
      const result = res.data;
      if (result?.success) {
        setInternalResult({ imported: result.imported, skipped: result.skipped, total: result.total, errors: result.errors });
        toast.success(`Imported ${result.imported} of ${result.total} internal ratings`);
      } else {
        toast.error(result?.error ?? "Import failed");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setInternalLoading(false);
      if (internalFileRef.current) internalFileRef.current.value = "";
    }
  };

  const handlePowerRatingsImport = async (file: File) => {
    setPowerRatingsLoading(true);
    setPowerRatingsResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const csvContent = await file.text();
      const res = await supabase.functions.invoke("import-power-ratings-csv", {
        body: { csv_content: csvContent, model_type: "returner" },
      });
      const result = res.data;
      if (result?.success) {
        setPowerRatingsResult({ imported: result.imported, skipped: result.skipped, total: result.total, errors: result.errors });
        toast.success(`Imported ${result.imported} of ${result.total} power ratings`);
      } else {
        toast.error(result?.error ?? "Import failed");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setPowerRatingsLoading(false);
      if (powerRatingsFileRef.current) powerRatingsFileRef.current.value = "";
    }
  };

  const runSync = async (action: string) => {
    if (!spreadsheetId.trim()) {
      toast.error("Enter a Google Sheet ID");
      return;
    }

    setLoading(action);
    setLastResult(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const res = await supabase.functions.invoke("google-sheets-sync", {
        body: {
          action,
          spreadsheet_id: spreadsheetId.trim(),
          players_range: playersRange,
          stats_range: statsRange,
        },
      });

      const result = res.data as SyncResult;
      setLastResult(result);

      if (result?.success) {
        toast.success(`${action.replace(/_/g, " ")} completed successfully`);
      } else {
        toast.error(result?.error ?? "Sync failed");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
      setLastResult({ success: false, error: msg });
    } finally {
      setLoading(null);
    }
  };

  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ updated: number; errors: number; total: number } | null>(null);

  const runBulkRecalculate = async () => {
    setBulkLoading(true);
    setBulkResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const res = await supabase.functions.invoke("recalculate-prediction", {
        body: { action: "bulk_recalculate" },
      });
      const result = res.data;
      if (result?.success) {
        setBulkResult({ updated: result.updated, errors: result.errors, total: result.total });
        toast.success(`Recalculated ${result.updated} of ${result.total} returner predictions`);
      } else {
        toast.error(result?.error ?? "Bulk recalculation failed");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkLoading(false);
    }
  };

  const actions = [
    { key: "import_returner_predictions", label: "Import Returner Predictions", icon: Download, desc: "Pull returner equation weights + player predictions" },
    { key: "import_transfer_predictions", label: "Import Transfer Predictions", icon: Download, desc: "Pull transfer equation weights + player predictions" },
    { key: "import_predictions_all", label: "Import All Predictions", icon: Download, desc: "Pull both returner + transfer predictions" },
    { key: "import_returner_power_rating", label: "Import Returner Power Rating", icon: Download, desc: "Pull returner offensive power ratings by conference" },
    { key: "import_transfer_power_rating", label: "Import Transfer Power Rating", icon: Download, desc: "Pull transfer offensive power ratings by conference" },
    { key: "import_power_rating_all", label: "Import All Power Ratings", icon: Download, desc: "Pull both returner + transfer power ratings" },
    { key: "import_conference_stats", label: "Import Conference Stats", icon: Download, desc: "Pull '25 conference stats+ data" },
    { key: "import_park_factors", label: "Import Park Factors", icon: Download, desc: "Pull park factor+ full season data" },
    { key: "import_nil_transfer", label: "Import Transfer NIL", icon: Download, desc: "Pull transfer NIL valuations" },
    { key: "import_nil_returner", label: "Import Returner NIL", icon: Download, desc: "Pull returner NIL valuations" },
    { key: "import_nil_tcu", label: "Import TCU Valuation", icon: Download, desc: "Pull TCU player valuations" },
    { key: "import_nil_all", label: "Import All NIL", icon: Download, desc: "Pull all NIL valuations at once" },
    { key: "import_players", label: "Import Players", icon: Download, desc: "Pull player roster from sheet" },
    { key: "import_stats", label: "Import Stats", icon: Download, desc: "Pull season stats from sheet" },
    { key: "export_players", label: "Export Players", icon: Upload, desc: "Push players to sheet" },
    { key: "export_stats", label: "Export Stats", icon: Upload, desc: "Push stats to sheet" },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Google Sheets Sync</h2>
          <p className="text-muted-foreground">Import player data from or export to your Google Sheets.</p>
        </div>
        {/* CSV Bulk Import */}
        <CsvBulkImport />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              Sheet Configuration
            </CardTitle>
            <CardDescription>
              Enter the Spreadsheet ID from your Google Sheet URL. Make sure you've shared the sheet with your service account email.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sheet-id">Spreadsheet ID</Label>
              <Input
                id="sheet-id"
                placeholder="e.g. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
                value={spreadsheetId}
                onChange={(e) => setSpreadsheetId(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Found in the URL: docs.google.com/spreadsheets/d/<strong>SPREADSHEET_ID</strong>/edit
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="players-range">Players Sheet Range</Label>
                <Input
                  id="players-range"
                  value={playersRange}
                  onChange={(e) => setPlayersRange(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="stats-range">Stats Sheet Range</Label>
                <Input
                  id="stats-range"
                  value={statsRange}
                  onChange={(e) => setStatsRange(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-primary/30 col-span-full">
          <CardContent className="flex flex-1 flex-col justify-between pt-6">
            <div className="mb-4">
              <div className="flex items-center gap-2 font-semibold">Bulk Recalculate Returner Predictions</div>
              <p className="text-sm text-muted-foreground mt-1">Re-run the returning player formula on all active returner predictions using the latest equation.</p>
            </div>
            <Button
              onClick={runBulkRecalculate}
              disabled={bulkLoading || loading !== null}
              variant="default"
              className="w-full gap-2"
            >
              {bulkLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {bulkLoading ? "Recalculating…" : "Recalculate All Returners"}
            </Button>
            {bulkResult && (
              <p className="text-sm text-muted-foreground mt-2">
                Updated {bulkResult.updated} of {bulkResult.total} predictions{bulkResult.errors > 0 ? `, ${bulkResult.errors} errors` : ""}
              </p>
            )}
          </CardContent>
        </Card>

        {isAdmin && (
          <Card className="border-primary/30">
            <CardContent className="pt-6">
              <div className="mb-4">
                <div className="flex items-center gap-2 font-semibold">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Import Internal Power Ratings
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">Admin Only</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Upload a CSV with player names and AVG/OBP/SLG power ratings. Matches by first &amp; last name to active predictions.
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  Expected columns: <code className="bg-muted px-1 rounded">first_name, last_name, avg_power_rating, obp_power_rating, slg_power_rating</code>
                </p>
              </div>
              <input
                ref={internalFileRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleInternalRatingsImport(file);
                }}
              />
              <Button
                onClick={() => internalFileRef.current?.click()}
                disabled={internalLoading}
                className="w-full gap-2"
              >
                {internalLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {internalLoading ? "Importing…" : "Upload CSV"}
              </Button>
              {internalResult && (
                <div className="text-sm mt-3 space-y-1">
                  <p className="text-muted-foreground">
                    Imported {internalResult.imported} of {internalResult.total} rows, skipped {internalResult.skipped}
                  </p>
                  {internalResult.errors && internalResult.errors.length > 0 && (
                    <div className="text-destructive text-xs space-y-0.5">
                      {internalResult.errors.map((e, i) => <p key={i}>{e}</p>)}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card className="border-primary/30">
          <CardContent className="pt-6">
            <div className="mb-4">
              <div className="flex items-center gap-2 font-semibold">
                <Upload className="h-4 w-4 text-primary" />
                Import Player Power Ratings (CSV)
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Upload a CSV with player names and power rating values to update existing returner predictions.
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Expected columns: <code className="bg-muted px-1 rounded">first_name, last_name</code> (or <code className="bg-muted px-1 rounded">name</code>) + <code className="bg-muted px-1 rounded">Power Rating</code> and/or <code className="bg-muted px-1 rounded">Offensive Power Rating</code>
              </p>
            </div>
            <input
              ref={powerRatingsFileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handlePowerRatingsImport(file);
              }}
            />
            <Button
              onClick={() => powerRatingsFileRef.current?.click()}
              disabled={powerRatingsLoading}
              className="w-full gap-2"
            >
              {powerRatingsLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {powerRatingsLoading ? "Importing…" : "Upload Power Ratings CSV"}
            </Button>
            {powerRatingsResult && (
              <div className="text-sm mt-3 space-y-1">
                <p className="text-muted-foreground">
                  Imported {powerRatingsResult.imported} of {powerRatingsResult.total} rows, skipped {powerRatingsResult.skipped}
                </p>
                {powerRatingsResult.errors && powerRatingsResult.errors.length > 0 && (
                  <div className="text-destructive text-xs space-y-0.5">
                    {powerRatingsResult.errors.map((e, i) => <p key={i}>{e}</p>)}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {actions.map((a) => (
            <Card key={a.key} className="flex flex-col">
              <CardContent className="flex flex-1 flex-col justify-between pt-6">
                <div className="mb-4">
                  <div className="flex items-center gap-2 font-semibold">{a.label}</div>
                  <p className="text-sm text-muted-foreground mt-1">{a.desc}</p>
                </div>
                <Button
                  onClick={() => runSync(a.key)}
                  disabled={loading !== null}
                  variant={a.key.startsWith("export") ? "outline" : "default"}
                  className="w-full gap-2"
                >
                  {loading === a.key ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <a.icon className="h-4 w-4" />
                  )}
                  {loading === a.key ? "Syncing…" : a.label}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        {lastResult && (
          <Card className={lastResult.success ? "border-primary/30" : "border-destructive/30"}>
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                {lastResult.success ? (
                  <CheckCircle className="h-5 w-5 text-primary mt-0.5" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
                )}
                <div className="space-y-1 text-sm">
                  <p className="font-medium">{lastResult.success ? "Sync Complete" : "Sync Failed"}</p>
                  {lastResult.error && <p className="text-destructive">{lastResult.error}</p>}
                  {lastResult.imported !== undefined && <p>Imported: {lastResult.imported}</p>}
                  {lastResult.exported !== undefined && <p>Exported: {lastResult.exported}</p>}
                  {lastResult.config_imported !== undefined && <p>Config weights imported: {lastResult.config_imported}</p>}
                  {lastResult.conferences_found !== undefined && <p>Conferences found: {lastResult.conferences_found}</p>}
                  {lastResult.skipped !== undefined && lastResult.skipped > 0 && (
                    <p className="text-muted-foreground">Skipped: {lastResult.skipped}</p>
                  )}
                  {lastResult.players && (
                    <p>Players — imported: {lastResult.players.imported ?? lastResult.players.exported ?? 0}, skipped: {lastResult.players.skipped ?? 0}</p>
                  )}
                  {lastResult.stats && (
                    <p>Stats — imported: {lastResult.stats.imported ?? lastResult.stats.exported ?? 0}, skipped: {lastResult.stats.skipped ?? 0}</p>
                  )}
                  {lastResult.returner && (
                    <p>Returner — imported: {lastResult.returner.imported ?? 0}, skipped: {lastResult.returner.skipped ?? 0}, config: {lastResult.returner.config_imported ?? 0}</p>
                  )}
                  {lastResult.transfer && (
                    <p>Transfer — imported: {lastResult.transfer.imported ?? 0}, skipped: {lastResult.transfer.skipped ?? 0}, config: {lastResult.transfer.config_imported ?? 0}</p>
                  )}
                  {lastResult.transfer_nil && (
                    <p>Transfer NIL — imported: {lastResult.transfer_nil.imported ?? 0}, skipped: {lastResult.transfer_nil.skipped ?? 0}</p>
                  )}
                  {lastResult.returner_nil && (
                    <p>Returner NIL — imported: {lastResult.returner_nil.imported ?? 0}, skipped: {lastResult.returner_nil.skipped ?? 0}</p>
                  )}
                  {lastResult.tcu_nil && (
                    <p>TCU NIL — imported: {lastResult.tcu_nil.imported ?? 0}, skipped: {lastResult.tcu_nil.skipped ?? 0}</p>
                  )}
                  {lastResult.returner_power && (
                    <p>Returner Power Rating — imported: {lastResult.returner_power.imported ?? 0}, skipped: {lastResult.returner_power.skipped ?? 0}, conferences: {lastResult.returner_power.conferences_found ?? 0}</p>
                  )}
                  {lastResult.transfer_power && (
                    <p>Transfer Power Rating — imported: {lastResult.transfer_power.imported ?? 0}, skipped: {lastResult.transfer_power.skipped ?? 0}, conferences: {lastResult.transfer_power.conferences_found ?? 0}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Expected Sheet Format</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-2">
            <p><strong>Players sheet</strong> (first row = headers): first_name, last_name, position, team, conference, class_year, handedness, height_inches, weight, home_state, high_school, transfer_portal, portal_entry_date, notes</p>
            <p><strong>Stats sheet</strong> (first row = headers): first_name, last_name, season, games, at_bats, hits, doubles, triples, home_runs, rbi, runs, walks, strikeouts, stolen_bases, caught_stealing, hit_by_pitch, sac_flies, batting_avg, on_base_pct, slugging_pct, ops, innings_pitched, earned_runs, era, whip, hits_allowed, pitch_walks, pitch_strikeouts, wins, losses, saves</p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
