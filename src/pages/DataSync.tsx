import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Download, Upload, RefreshCw, FileSpreadsheet, CheckCircle, AlertCircle } from "lucide-react";

type SyncResult = {
  success: boolean;
  imported?: number;
  exported?: number;
  skipped?: number;
  config_imported?: number;
  error?: string;
  players?: { imported?: number; skipped?: number; exported?: number };
  stats?: { imported?: number; skipped?: number; exported?: number };
  returner?: { imported?: number; skipped?: number; config_imported?: number };
  transfer?: { imported?: number; skipped?: number; config_imported?: number };
  transfer_nil?: { imported?: number; skipped?: number };
  returner_nil?: { imported?: number; skipped?: number };
  tcu_nil?: { imported?: number; skipped?: number };
};

export default function DataSync() {
  const [spreadsheetId, setSpreadsheetId] = useState("1UwtImwQ74ThQlMJizsqMSp6b4tG39uXuiI8nrQ46ZAE");
  const [playersRange, setPlayersRange] = useState("Players!A:N");
  const [statsRange, setStatsRange] = useState("Stats!A:AE");
  const [loading, setLoading] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);

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

  const actions = [
    { key: "import_returner_predictions", label: "Import Returner Predictions", icon: Download, desc: "Pull returner equation weights + player predictions" },
    { key: "import_transfer_predictions", label: "Import Transfer Predictions", icon: Download, desc: "Pull transfer equation weights + player predictions" },
    { key: "import_predictions_all", label: "Import All Predictions", icon: Download, desc: "Pull both returner + transfer predictions" },
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
