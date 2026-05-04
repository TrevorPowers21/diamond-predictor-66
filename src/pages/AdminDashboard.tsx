import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { computeAndStoreAllScores } from "@/lib/computeAndStoreScores";
import { syncMasterToPlayers, addMissingPlayers } from "@/lib/syncMasterToPlayers";
import { createPredictionsFromMaster } from "@/lib/createPredictionsFromMaster";
(window as any).computeAllScores = computeAndStoreAllScores;
(window as any).syncMasterToPlayers = syncMasterToPlayers;
(window as any).createPredictions = createPredictionsFromMaster;
import { TRANSFER_WEIGHT_DEFAULTS } from "@/lib/transferWeightDefaults";
import DashboardLayout from "@/components/DashboardLayout";
import PitchingConferenceStatsTable from "@/components/PitchingConferenceStatsTable";
import PitchingEquationsTab from "@/components/PitchingEquationsTab";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Pencil, RefreshCw, Scale, Sliders, Trophy, Plus, Trash2, Check, Edit2, Save, X, Upload, LogIn, UserPlus } from "lucide-react";
import RosterOverrideTab from "@/components/RosterOverrideTab";
import { useAuth } from "@/hooks/useAuth";
import { bulkRecalculatePredictionsLocal } from "@/lib/predictionEngine";
// TODO: Seed JSON files are static local data — migrate to Supabase tables for live updates.
import storage2025Seed from "@/data/storage_2025_seed.json";
import powerRatings2025Seed from "@/data/power_ratings_2025_seed.json";
import exitPositions2025Seed from "@/data/exit_positions_2025_seed.json";
import { profileRouteFor } from "@/lib/profileRoutes";
import { resolveMetricParkFactor } from "@/lib/parkFactors";
import { useParkFactors } from "@/hooks/useParkFactors";
import StuffPlusImporter from "@/components/StuffPlusImporter";

// ─── Sync & Compute Buttons ──────────────────────────────────────────────────

function ImportPitchArsenalButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ pitchesImported: number; playersProcessed: number; stuffPlusUpdated: number; errors: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setLoading(true);
        setResult(null);
        try {
          const text = await file.text();
          const { importPitchArsenalFromCsv } = await import("@/lib/importPitchArsenal");
          const r = await importPitchArsenalFromCsv(text);
          setResult(r);
        } catch (err: any) {
          setResult({ pitchesImported: 0, playersProcessed: 0, stuffPlusUpdated: 0, errors: [err.message] });
        }
        setLoading(false);
        if (fileRef.current) fileRef.current.value = "";
      }} />
      <Button onClick={() => fileRef.current?.click()} disabled={loading} variant="outline" className="gap-2">
        {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        {loading ? "Importing Arsenal…" : "Import Pitch Arsenal CSV"}
      </Button>
      {result && (
        <p className="text-sm text-muted-foreground">
          Imported {result.pitchesImported} pitch rows for {result.playersProcessed} players. {result.stuffPlusUpdated} Pitching Master rows updated with Stuff+.
          {result.errors.length > 0 && ` Errors: ${result.errors.slice(0, 3).join("; ")}${result.errors.length > 3 ? `... +${result.errors.length - 3} more` : ""}`}
        </p>
      )}
    </>
  );
}

function ImportPaAbButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ hitterMasterUpdated: number; playersUpdated: number; notFound: number; errors: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setLoading(true);
        setResult(null);
        try {
          const text = await file.text();
          const { importPaAbFromCsv } = await import("@/lib/importPaAbData");
          const r = await importPaAbFromCsv(text);
          setResult(r);
        } catch (err: any) {
          setResult({ hitterMasterUpdated: 0, playersUpdated: 0, notFound: 0, errors: [err.message] });
        }
        setLoading(false);
        if (fileRef.current) fileRef.current.value = "";
      }} />
      <Button onClick={() => fileRef.current?.click()} disabled={loading} variant="outline" className="gap-2">
        {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        {loading ? "Importing PA/AB…" : "Import PA/AB from CSV"}
      </Button>
      {result && (
        <p className="text-sm text-muted-foreground">
          Updated {result.hitterMasterUpdated} in Hitter Master, {result.playersUpdated} in players. {result.notFound} not found.
          {result.errors.length > 0 && ` Errors: ${result.errors.slice(0, 3).join("; ")}${result.errors.length > 3 ? `... +${result.errors.length - 3} more` : ""}`}
        </p>
      )}
    </>
  );
}

function ImportHistoricalHittersButton() {
  const [loading, setLoading] = useState(false);
  const season = 2026;
  const [result, setResult] = useState<{ inserted: number; skipped: number; teamsResolved: number; teamsUnresolved: string[]; errors: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <div className="flex items-center gap-2">
        <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setLoading(true);
          setResult(null);
          try {
            const text = await file.text();
            const { importHistoricalHittersCsv } = await import("@/lib/importHistoricalHitters");
            const r = await importHistoricalHittersCsv(text, season);
            setResult(r);
          } catch (err: any) {
            setResult({ inserted: 0, skipped: 0, teamsResolved: 0, teamsUnresolved: [], errors: [err.message] });
          }
          setLoading(false);
          if (fileRef.current) fileRef.current.value = "";
        }} />
        <Button onClick={() => fileRef.current?.click()} disabled={loading} variant="outline" className="gap-2">
          {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {loading ? `Importing ${season} Hitters…` : `Import ${season} Hitter CSV`}
        </Button>
      </div>
      {result && (
        <p className="text-sm text-muted-foreground">
          Inserted {result.inserted} hitters for {season}. Skipped {result.skipped}. Teams resolved: {result.teamsResolved}.
          {result.teamsUnresolved.length > 0 && ` Unresolved teams: ${result.teamsUnresolved.slice(0, 10).join(", ")}${result.teamsUnresolved.length > 10 ? `... +${result.teamsUnresolved.length - 10} more` : ""}`}
          {result.errors.length > 0 && ` Errors: ${result.errors.slice(0, 3).join("; ")}${result.errors.length > 3 ? `... +${result.errors.length - 3} more` : ""}`}
        </p>
      )}
    </>
  );
}

function ImportPitcherEv90Button() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ updated: number; notFound: number; errors: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setLoading(true);
        setResult(null);
        try {
          const text = await file.text();
          const { importPitcherEv90FromCsv } = await import("@/lib/importPitcherEv90");
          const r = await importPitcherEv90FromCsv(text);
          setResult(r);
        } catch (err: any) {
          setResult({ updated: 0, notFound: 0, errors: [err.message] });
        }
        setLoading(false);
        if (fileRef.current) fileRef.current.value = "";
      }} />
      <Button onClick={() => fileRef.current?.click()} disabled={loading} variant="outline" className="gap-2">
        {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        {loading ? "Updating EV90…" : "Update Pitcher EV90 from CSV"}
      </Button>
      {result && (
        <p className="text-sm text-muted-foreground">
          Updated {result.updated} pitchers. {result.notFound} not found.
          {result.errors.length > 0 && ` Errors: ${result.errors.slice(0, 3).join("; ")}${result.errors.length > 3 ? `... +${result.errors.length - 3} more` : ""}`}
        </p>
      )}
    </>
  );
}

function ImportHistoricalPitchersButton() {
  const [loading, setLoading] = useState(false);
  const season = 2026;
  const [result, setResult] = useState<{ inserted: number; skipped: number; teamsResolved: number; teamsUnresolved: string[]; errors: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <div className="flex items-center gap-2">
        <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setLoading(true);
          setResult(null);
          try {
            const text = await file.text();
            const { importHistoricalPitchersCsv } = await import("@/lib/importHistoricalPitchers");
            const r = await importHistoricalPitchersCsv(text, season);
            setResult(r);
          } catch (err: any) {
            setResult({ inserted: 0, skipped: 0, teamsResolved: 0, teamsUnresolved: [], errors: [err.message] });
          }
          setLoading(false);
          if (fileRef.current) fileRef.current.value = "";
        }} />
        <Button onClick={() => fileRef.current?.click()} disabled={loading} variant="outline" className="gap-2">
          {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {loading ? `Importing ${season} Pitchers…` : `Import ${season} Pitcher CSV`}
        </Button>
      </div>
      {result && (
        <p className="text-sm text-muted-foreground">
          Inserted {result.inserted} pitchers for {season}. Skipped {result.skipped}. Teams resolved: {result.teamsResolved}.
          {result.teamsUnresolved.length > 0 && ` Unresolved teams: ${result.teamsUnresolved.slice(0, 10).join(", ")}${result.teamsUnresolved.length > 10 ? `... +${result.teamsUnresolved.length - 10} more` : ""}`}
          {result.errors.length > 0 && ` Errors: ${result.errors.slice(0, 3).join("; ")}${result.errors.length > 3 ? `... +${result.errors.length - 3} more` : ""}`}
        </p>
      )}
    </>
  );
}

function SyncMasterButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ hittersInserted: number; pitchersInserted: number; hittersSkipped: number; pitchersSkipped: number; errors: string[] } | null>(null);
  return (
    <>
      <Button
        onClick={async () => {
          setLoading(true);
          setResult(null);
          try {
            const r = await syncMasterToPlayers(2026);
            setResult(r);
          } catch (e: any) {
            setResult({ hittersInserted: 0, pitchersInserted: 0, hittersSkipped: 0, pitchersSkipped: 0, errors: [e.message] });
          }
          setLoading(false);
        }}
        disabled={loading}
        variant="outline"
        className="gap-2"
      >
        {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        {loading ? "Syncing Master → Players…" : "Sync Master → Players"}
      </Button>
      {result && (
        <p className="text-sm text-muted-foreground">
          Inserted {result.hittersInserted} hitters, {result.pitchersInserted} pitchers. Skipped {result.hittersSkipped + result.pitchersSkipped} existing.
          {result.errors.length > 0 && ` Errors: ${result.errors.join("; ")}`}
        </p>
      )}
      <AddMissingPlayersButton />
    </>
  );
}

function AddMissingPlayersButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ inserted: number; skipped: number; errors: string[] } | null>(null);
  return (
    <>
      <Button
        onClick={async () => {
          setLoading(true);
          setResult(null);
          try {
            const r = await addMissingPlayers(2026);
            setResult(r);
          } catch (e: any) {
            setResult({ inserted: 0, skipped: 0, errors: [e.message] });
          }
          setLoading(false);
        }}
        disabled={loading}
        variant="outline"
        className="gap-2"
      >
        {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        {loading ? "Adding missing players…" : "Add Missing Players"}
      </Button>
      {result && (
        <p className="text-sm text-muted-foreground">
          Added {result.inserted} new players. {result.skipped} already existed.
          {result.errors.length > 0 && ` Errors: ${result.errors.join("; ")}`}
        </p>
      )}
    </>
  );
}

function ComputeNcaaAveragesButton() {
  const [loading, setLoading] = useState(false);
  const [allSeasonsRunning, setAllSeasonsRunning] = useState(false);
  const [allSeasonsLog, setAllSeasonsLog] = useState<string[]>([]);
  const season = 2026;
  const [result, setResult] = useState<{ hittersUsed: number; pitchersUsed: number; fieldsWritten: number; errors: string[] } | null>(null);

  const runAllSeasons = async () => {
    if (!confirm(
      "Compute NCAA Averages for ALL historical seasons?\n\n" +
      "Refreshes ncaa_averages mean + SD across every season — required after Stuff+ recalibration so equations use correct baselines.",
    )) return;

    setAllSeasonsRunning(true);
    setAllSeasonsLog([]);
    const log: string[] = [];
    const append = (msg: string) => {
      log.push(msg);
      setAllSeasonsLog([...log]);
    };

    try {
      const { computeAndStoreNcaaAverages } = await import("@/lib/computeNcaaAverages");
      const { data: sData } = await supabase
        .from("Hitter Master")
        .select("Season")
        .not("Season", "is", null);
      const seasons = [...new Set((sData || []).map((r: any) => r.Season))].sort((a, b) => b - a);
      append(`Found seasons: ${seasons.join(", ")}`);

      for (const s of seasons) {
        append(`\n[${s}] Compute NCAA Averages…`);
        const r = await computeAndStoreNcaaAverages(s);
        append(`[${s}] hitters=${r.hittersUsed} pitchers=${r.pitchersUsed} fields=${r.fieldsWritten}${r.errors.length ? ` errors=${r.errors.length}` : ""}`);
      }
      append("\n✓ Done.");
    } catch (err: any) {
      append(`✗ Error: ${err.message || String(err)}`);
    } finally {
      setAllSeasonsRunning(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          onClick={async () => {
            setLoading(true);
            setResult(null);
            try {
              const { computeAndStoreNcaaAverages } = await import("@/lib/computeNcaaAverages");
              const r = await computeAndStoreNcaaAverages(season);
              setResult(r);
            } catch (e: any) {
              setResult({ hittersUsed: 0, pitchersUsed: 0, fieldsWritten: 0, errors: [e.message] });
            }
            setLoading(false);
          }}
          disabled={loading || allSeasonsRunning}
          variant="outline"
          className="gap-2"
        >
          {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {loading ? `Computing ${season} NCAA Averages…` : `Compute ${season} NCAA Averages`}
        </Button>
        <Button
          onClick={runAllSeasons}
          disabled={loading || allSeasonsRunning}
          variant="outline"
          className="gap-2 border-red-500 text-red-500 hover:bg-red-500/10"
        >
          {allSeasonsRunning ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
          {allSeasonsRunning ? "Recomputing All Seasons…" : "↻ ALL Seasons"}
        </Button>
      </div>
      {result && (
        <p className="text-sm text-muted-foreground">
          {result.hittersUsed} hitters + {result.pitchersUsed} pitchers used. {result.fieldsWritten} fields written.
          {result.errors.length > 0 && ` Errors: ${result.errors.join("; ")}`}
        </p>
      )}
      {allSeasonsLog.length > 0 && (
        <pre className="border bg-muted px-3 py-2 text-xs whitespace-pre-wrap font-mono">
          {allSeasonsLog.join("\n")}
        </pre>
      )}
    </>
  );
}

function ComputeScoresButton() {
  const [loading, setLoading] = useState(false);
  const season = 2026;
  const [result, setResult] = useState<{ hitters: { updated: number; errors: number }; pitchers: { updated: number; errors: number } } | null>(null);
  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          onClick={async () => {
            setLoading(true);
            setResult(null);
            try {
              const r = await computeAndStoreAllScores(season);
              setResult(r);
            } catch {
              setResult({ hitters: { updated: 0, errors: -1 }, pitchers: { updated: 0, errors: -1 } });
            }
            setLoading(false);
          }}
          disabled={loading}
          variant="outline"
          className="gap-2"
        >
          {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {loading ? `Computing ${season} Scores…` : `Compute ${season} Scores`}
        </Button>
      </div>
      {result && (
        <p className="text-sm text-muted-foreground">
          Hitters: {result.hitters.updated} scored. Pitchers: {result.pitchers.updated} scored.
          {(result.hitters.errors > 0 || result.pitchers.errors > 0) && ` Errors: ${result.hitters.errors + result.pitchers.errors}`}
        </p>
      )}
    </>
  );
}

function InferClassTransitionsButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ updated: number; skipped: number; errors: number } | null>(null);
  return (
    <>
      <Button
        onClick={async () => {
          setLoading(true);
          setResult(null);
          try {
            const { inferAllClassTransitions } = await import("@/lib/inferClassTransitions");
            const r = await inferAllClassTransitions(2026);
            setResult(r);
          } catch (e: any) {
            setResult({ updated: 0, skipped: 0, errors: -1 });
            console.error(e);
          }
          setLoading(false);
        }}
        disabled={loading}
        variant="outline"
        className="gap-2"
      >
        {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        {loading ? "Inferring class transitions…" : "Auto-Infer Class Transitions"}
      </Button>
      {result && (
        <p className="text-sm text-muted-foreground">
          Updated: {result.updated}. Skipped (overridden / no change): {result.skipped}.
          {result.errors > 0 && ` Errors: ${result.errors}`}
        </p>
      )}
    </>
  );
}

function CreateStubPredictionsButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ created: number; errors: string[] } | null>(null);
  return (
    <>
      <Button
        onClick={async () => {
          setLoading(true);
          setResult(null);
          try {
            const { createStubPredictionsForAllPlayers } = await import("@/lib/createPredictionsFromMaster");
            const r = await createStubPredictionsForAllPlayers(2026);
            setResult(r);
          } catch (e: any) {
            setResult({ created: 0, errors: [e.message] });
          }
          setLoading(false);
        }}
        disabled={loading}
        variant="outline"
        className="gap-2"
      >
        {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        {loading ? "Creating Stubs…" : "Create Stub Predictions for All Players"}
      </Button>
      {result && (
        <p className="text-sm text-muted-foreground">
          Created {result.created} stub predictions.
          {result.errors.length > 0 && ` Errors: ${result.errors.length}`}
        </p>
      )}
    </>
  );
}

function CreatePredictionsButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ predictionsCreated: number; internalsCreated: number; errors: string[] } | null>(null);
  return (
    <>
      <Button
        onClick={async () => {
          setLoading(true);
          setResult(null);
          try {
            const r = await createPredictionsFromMaster(2026);
            setResult(r);
          } catch (e: any) {
            setResult({ predictionsCreated: 0, internalsCreated: 0, errors: [e.message] });
          }
          setLoading(false);
        }}
        disabled={loading}
        variant="outline"
        className="gap-2"
      >
        {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        {loading ? "Creating Predictions…" : "Create Predictions from Master"}
      </Button>
      {result && (
        <p className="text-sm text-muted-foreground">
          Created {result.predictionsCreated} predictions, {result.internalsCreated} internals.
          {result.errors.length > 0 && ` Errors: ${result.errors.join("; ")}`}
        </p>
      )}
    </>
  );
}

// ─── Equation Constants Tab ───────────────────────────────────────────────────

function EquationConstantsTab() {
  const ADMIN_UI_MODEL_TYPE = "admin_ui";
  const ADMIN_UI_SEASON = 2026;
  const [editableSections, setEditableSections] = useState<Record<string, boolean>>({});
  const defaultEditableValues: Record<string, string> = {
    r_ncaa_avg_ba: "0.280",
    r_ba_std_pr: "31.297",
    r_ba_std_ncaa: "0.043455",
    r_ncaa_avg_obp: "0.385",
    r_obp_std_pr: "28.889",
    r_obp_std_ncaa: "0.046781",
    r_ncaa_avg_iso: "0.162",
    r_w_obp: "0.45",
    r_w_slg: "0.30",
    r_w_avg: "0.15",
    r_w_iso: "0.10",
    r_ncaa_avg_wrc: "0.364",
    owar_wrc_plus_baseline: "100",
    owar_plate_appearances: "260",
    owar_run_value_per_pa: "0.13",
    owar_replacement_runs_per_600: "25",
    owar_runs_per_win: "10",
    r_ba_class_fs: "3",
    r_ba_class_sj: "2",
    r_ba_class_js: "1.5",
    r_ba_class_gr: "0.01",
    r_obp_class_fs: "3",
    r_obp_class_sj: "2",
    r_obp_class_js: "1.5",
    r_obp_class_gr: "0.01",
    r_iso_class_fs: "4.5",
    r_iso_class_sj: "3",
    r_iso_class_js: "2",
    r_iso_class_gr: "0.01",
    r_ba_damp_tier1_max: "0.350",
    r_ba_damp_tier2_max: "0.380",
    r_ba_damp_tier3_max: "0.420",
    r_ba_damp_tier1_impact: "1.00",
    r_ba_damp_tier2_impact: "0.90",
    r_ba_damp_tier3_impact: "0.70",
    r_ba_damp_tier4_impact: "0.40",
    r_obp_damp_tier1_max: "0.455",
    r_obp_damp_tier2_max: "0.485",
    r_obp_damp_tier3_max: "0.525",
    r_obp_damp_tier1_impact: "1.00",
    r_obp_damp_tier2_impact: "0.90",
    r_obp_damp_tier3_impact: "0.70",
    r_obp_damp_tier4_impact: "0.40",
    t_ba_ncaa_avg: "0.280",
    t_ba_std_pr: "31.297",
    t_ba_std_ncaa: "0.043455",
    t_ba_power_weight: "0.70",
    t_ba_conference_weight: String(TRANSFER_WEIGHT_DEFAULTS.t_ba_conference_weight),
    t_ba_pitching_weight: String(TRANSFER_WEIGHT_DEFAULTS.t_ba_pitching_weight),
    t_ba_park_weight: String(TRANSFER_WEIGHT_DEFAULTS.t_ba_park_weight),
    t_obp_ncaa_avg: "0.385",
    t_obp_std_pr: "28.889",
    t_obp_std_ncaa: "0.046781",
    t_obp_power_weight: "0.70",
    t_obp_conference_weight: String(TRANSFER_WEIGHT_DEFAULTS.t_obp_conference_weight),
    t_obp_pitching_weight: String(TRANSFER_WEIGHT_DEFAULTS.t_obp_pitching_weight),
    t_obp_park_weight: String(TRANSFER_WEIGHT_DEFAULTS.t_obp_park_weight),
    t_iso_ncaa_avg: "0.162",
    t_iso_std_ncaa: "0.07849797197",
    t_iso_std_power: "45.423",
    t_iso_conference_weight: String(TRANSFER_WEIGHT_DEFAULTS.t_iso_conference_weight),
    t_iso_pitching_weight: String(TRANSFER_WEIGHT_DEFAULTS.t_iso_pitching_weight),
    t_iso_park_weight: String(TRANSFER_WEIGHT_DEFAULTS.t_iso_park_weight),
    t_w_obp: "0.45",
    t_w_slg: "0.30",
    t_w_avg: "0.15",
    t_w_iso: "0.10",
    t_wrc_plus_ncaa_avg: "1.000",
    nil_base_per_owar: "25000",
    nil_tier_sec: "1.5",
    nil_tier_p4: "1.2",
    nil_tier_big_ten: "1.0",
    nil_tier_strong_mid: "0.8",
    nil_tier_low_major: "0.5",
    nil_pos_group_c_ss_cf: "1.3",
    nil_pos_group_2b_3b_cof: "1.1",
    nil_pos_group_1b_dh: "1.0",
    nil_pos_group_bench_utility: "0.8",
    nil_program_total_player_score: "68",
  };

  const [editableValues, setEditableValues] = useState<Record<string, string>>(defaultEditableValues);

  const remoteHydratedRef = useRef(false);
  const lastPersistedRef = useRef<Record<string, string> | null>(null);

  const { data: modelConfigRows = [], isLoading } = useQuery({
    queryKey: ["model_config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("model_config")
        .select("*")
        .order("model_type")
        .order("config_key");
      if (error) throw error;
      return data;
    },
  });
  const { data: conferenceStats = [], isLoading: isConferenceStatsLoading } = useQuery({
    queryKey: ["conference_stats_equation_sync"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Conference Stats")
        .select(`"conference abbreviation", AVG, OBP, ISO, WRC_plus`)
        .order("conference abbreviation");
      if (error) throw error;
      return (data || []).map((r: any) => ({
        conference: r["conference abbreviation"],
        avg: r.AVG,
        obp: r.OBP,
        iso: r.ISO,
        wrc: r.WRC_plus,
      }));
    },
  });
  const ncaaStats = conferenceStats.find((row) => (row.conference || "").toLowerCase().includes("ncaa"));

  const setEditable = (key: string, value: string) => {
    if (/^-?\d*\.?\d*$/.test(value)) {
      setEditableValues((prev) => ({ ...prev, [key]: value }));
    }
  };

  useEffect(() => {
    if (remoteHydratedRef.current) return;
    if (!modelConfigRows.length) {
      remoteHydratedRef.current = true;
      return;
    }
    const remoteRows = modelConfigRows.filter(
      (row) => row.model_type === ADMIN_UI_MODEL_TYPE && Number(row.season) === ADMIN_UI_SEASON,
    );
    if (remoteRows.length > 0) {
      setEditableValues((prev) => {
        const next = { ...prev };
        for (const row of remoteRows) {
          if (row.config_key) next[row.config_key] = String(row.config_value);
        }
        // Fix stale transfer weight defaults: if model_config still has the
        // old wrong value of 1.0 for a weight key, replace with the canonical
        // default. Once the user intentionally sets a different value, it sticks.
        for (const [key, canonical] of Object.entries(TRANSFER_WEIGHT_DEFAULTS)) {
          const dbVal = Number(next[key]);
          if (dbVal === 1 && canonical !== 1) {
            next[key] = String(canonical);
          }
        }
        return next;
      });
    }
    remoteHydratedRef.current = true;
  }, [modelConfigRows]);

  useEffect(() => {
    if (!remoteHydratedRef.current) return;
    if (lastPersistedRef.current && JSON.stringify(lastPersistedRef.current) === JSON.stringify(editableValues)) return;

    const timeout = window.setTimeout(async () => {
      const rows = Object.entries(editableValues)
        .map(([config_key, raw]) => ({
          model_type: ADMIN_UI_MODEL_TYPE,
          season: ADMIN_UI_SEASON,
          config_key,
          config_value: Number(raw),
        }))
        .filter((r) => Number.isFinite(r.config_value));

      if (rows.length === 0) return;

      const { error } = await supabase
        .from("model_config")
        .upsert(rows, { onConflict: "model_type,season,config_key" });

      if (!error) {
        lastPersistedRef.current = editableValues;
      } else {
        // Keep local values even if DB persistence fails.
        console.warn("Failed to persist admin equation values", error.message);
      }
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [editableValues]);

  const toggleEditableSection = (sectionKey: string) => {
    setEditableSections((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }));
  };

  const sectionHeadingClass = "text-[11px] uppercase tracking-wide font-semibold text-foreground";
  const sectionPanelClass = "rounded-md border bg-background/60 p-3 space-y-2";
  const editableSectionHeader = (sectionKey: string, title = "Editable (Admin UI)") => {
    const isEditable = !!editableSections[sectionKey];
    return (
      <div className="flex items-center justify-between gap-2">
        <p className={sectionHeadingClass}>{title}</p>
        <Button
          type="button"
          size="sm"
          variant={isEditable ? "secondary" : "outline"}
          className="h-6 px-2 text-[11px]"
          onClick={() => toggleEditableSection(sectionKey)}
        >
          {isEditable ? "Done" : "Edit"}
        </Button>
      </div>
    );
  };
  const editableField = (
    sectionKey: string,
    key: string,
    label: string,
    _step = "0.001",
    suffix?: string,
    format?: "currency",
  ) => {
    const isSectionEditable = !!editableSections[sectionKey];
    const rawValue = editableValues[key] ?? "";
    const currencyNumber = Number(rawValue);
    const formattedValue =
      format === "currency" && rawValue !== "" && !Number.isNaN(currencyNumber)
        ? `$${currencyNumber.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
        : rawValue;
    return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <div className="relative">
        <Input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={formattedValue}
          onChange={(e) => setEditable(key, format === "currency" ? e.target.value.replace(/[$,]/g, "") : e.target.value)}
          readOnly={!isSectionEditable}
          className={`h-7 w-32 px-2 ${suffix ? "pr-6" : ""} text-left font-mono text-xs read-only:cursor-default read-only:caret-transparent read-only:opacity-70`}
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
            {suffix}
          </span>
        ) : null}
      </div>
    </div>
    );
  };
  const syncedField = (label: string, value: number | null | undefined, decimals = 3) => (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <div className="relative">
        <Input
          type="text"
          value={value == null ? "—" : Number(value).toFixed(decimals)}
          readOnly
          className="h-7 w-32 px-2 text-left font-mono text-xs read-only:cursor-default read-only:caret-transparent read-only:opacity-70"
        />
      </div>
    </div>
  );

  if (isLoading || isConferenceStatsLoading) return <p className="text-muted-foreground py-8 text-center">Loading…</p>;
  const baTier1Max = editableValues.r_ba_damp_tier1_max || "0.350";
  const baTier2Max = editableValues.r_ba_damp_tier2_max || "0.380";
  const baTier3Max = editableValues.r_ba_damp_tier3_max || "0.420";
  const obpTier1Max = editableValues.r_obp_damp_tier1_max || "0.455";
  const obpTier2Max = editableValues.r_obp_damp_tier2_max || "0.485";
  const obpTier3Max = editableValues.r_obp_damp_tier3_max || "0.525";

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Equation Constants</h3>
        <p className="text-sm text-muted-foreground">
          These values drive the projection formulas. Use the section `Edit` button under each Editable block to unlock changes.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Returner Model</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <h4 className="font-semibold mb-4">Batting Average</h4>
            <div className="bg-muted p-4 rounded-lg font-mono text-sm space-y-2">
              <div><span className="text-muted-foreground">ScaledBA =</span> NCAAAvgBA + ((BAPowerRating+ - NCAAAvgPowerRating) / StdDevBAPowerRating) × StdDevNCAABA</div>
              <div><span className="text-muted-foreground">Blended =</span> (LastBA × (1 - PowerRatingWeight)) + (ScaledBA × PowerRatingWeight)</div>
              <div><span className="text-muted-foreground">Mult =</span> (1) + (ClassAdjustment) + (DevAggressiveness × 0.06)</div>
              <div><span className="text-muted-foreground">Projected =</span> Blended × Mult</div>
              <div><span className="text-muted-foreground">Delta =</span> Projected - LastBA</div>
              <div><span className="text-muted-foreground">DampFactor =</span> IFS(Projected ≤ 0.350, 1.0, Projected ≤ 0.380, 0.9, Projected ≤ 0.420, 0.7, TRUE, 0.4)</div>
              <div className="ml-6 space-y-1 text-xs">
                <div>1.0 if Projected ≤ 0.350</div>
                <div>0.9 if 0.350 &lt; Projected ≤ 0.380</div>
                <div>0.7 if 0.380 &lt; Projected ≤ 0.420</div>
                <div>0.4 if Projected &gt; 0.420</div>
              </div>
              <div><span className="text-muted-foreground">Final =</span> LastBA + (Delta × DampFactor)</div>
            </div>
            <div className="mt-4 grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Constants</p>
                <div className="ml-2 space-y-0.5">
                  <div>• Power Rating Weight = 0.7</div>
                  <div>• NCAA Avg Power Rating = 100</div>
                </div>
              </div>
              <div className={sectionPanelClass}>
                {editableSectionHeader("r_ba_sd", "SD Constants")}
                <div className="space-y-1.5">
                  {editableField("r_ba_sd", "r_ba_std_pr", "Std Dev BA Power Rating+")}
                  {editableField("r_ba_sd", "r_ba_std_ncaa", "Std Dev NCAA BA")}
                </div>
              </div>
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>NCAA Average</p>
                <div className="space-y-1.5">
                  {syncedField("NCAA Avg BA", ncaaStats?.avg, 3)}
                </div>
              </div>
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Player-Specific</p>
                <div className="ml-2 space-y-0.5">
                  <div>• Last BA</div>
                  <div>• BA Power Rating +</div>
                  <div>• Dev Aggressiveness (-2 to +2)</div>
                </div>
              </div>
              <div className={sectionPanelClass}>
                {editableSectionHeader("r_ba_class", "Class Adjustments")}
                <div className="space-y-1.5">
                  {editableField("r_ba_class", "r_ba_class_fs", "FS", "0.1", "%")}
                  {editableField("r_ba_class", "r_ba_class_sj", "SJ", "0.1", "%")}
                  {editableField("r_ba_class", "r_ba_class_js", "JS", "0.1", "%")}
                  {editableField("r_ba_class", "r_ba_class_gr", "GR", "0.1", "%")}
                </div>
              </div>
              <div className={sectionPanelClass}>
                {editableSectionHeader("r_ba_damp", "Batting Average Dampening")}
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <Input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      spellCheck={false}
                      value={editableValues.r_ba_damp_tier1_max ?? ""}
                      onChange={(e) => setEditable("r_ba_damp_tier1_max", e.target.value)}
                      readOnly={!editableSections.r_ba_damp}
                      className="h-7 px-2 text-left font-mono text-xs read-only:cursor-default read-only:caret-transparent read-only:opacity-70"
                    />
                    <Input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      spellCheck={false}
                      value={editableValues.r_ba_damp_tier2_max ?? ""}
                      onChange={(e) => setEditable("r_ba_damp_tier2_max", e.target.value)}
                      readOnly={!editableSections.r_ba_damp}
                      className="h-7 px-2 text-left font-mono text-xs read-only:cursor-default read-only:caret-transparent read-only:opacity-70"
                    />
                    <Input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      spellCheck={false}
                      value={editableValues.r_ba_damp_tier3_max ?? ""}
                      onChange={(e) => setEditable("r_ba_damp_tier3_max", e.target.value)}
                      readOnly={!editableSections.r_ba_damp}
                      className="h-7 px-2 text-left font-mono text-xs read-only:cursor-default read-only:caret-transparent read-only:opacity-70"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <span>Range (Projected BA)</span>
                    <span>Impact</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 items-center">
                    <div className="h-7 px-2 flex items-center border rounded-md bg-muted/40 text-[11px] text-muted-foreground font-mono">
                      ≤ {baTier1Max}
                    </div>
                    <Input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      spellCheck={false}
                      value={editableValues.r_ba_damp_tier1_impact ?? ""}
                      onChange={(e) => setEditable("r_ba_damp_tier1_impact", e.target.value)}
                      readOnly={!editableSections.r_ba_damp}
                      className="h-7 px-2 text-left font-mono text-xs read-only:cursor-default read-only:caret-transparent read-only:opacity-70"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2 items-center">
                    <div className="h-7 px-2 flex items-center border rounded-md bg-muted/40 text-[11px] text-muted-foreground font-mono">
                      &gt; {baTier1Max} and ≤ {baTier2Max}
                    </div>
                    <Input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      spellCheck={false}
                      value={editableValues.r_ba_damp_tier2_impact ?? ""}
                      onChange={(e) => setEditable("r_ba_damp_tier2_impact", e.target.value)}
                      readOnly={!editableSections.r_ba_damp}
                      className="h-7 px-2 text-left font-mono text-xs read-only:cursor-default read-only:caret-transparent read-only:opacity-70"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2 items-center">
                    <div className="h-7 px-2 flex items-center border rounded-md bg-muted/40 text-[11px] text-muted-foreground font-mono">
                      &gt; {baTier2Max} and ≤ {baTier3Max}
                    </div>
                    <Input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      spellCheck={false}
                      value={editableValues.r_ba_damp_tier3_impact ?? ""}
                      onChange={(e) => setEditable("r_ba_damp_tier3_impact", e.target.value)}
                      readOnly={!editableSections.r_ba_damp}
                      className="h-7 px-2 text-left font-mono text-xs read-only:cursor-default read-only:caret-transparent read-only:opacity-70"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2 items-center">
                    <div className="h-7 px-2 flex items-center border rounded-md bg-muted/40 text-[11px] text-muted-foreground font-mono">
                      &gt; {baTier3Max}
                    </div>
                    <Input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      spellCheck={false}
                      value={editableValues.r_ba_damp_tier4_impact ?? ""}
                      onChange={(e) => setEditable("r_ba_damp_tier4_impact", e.target.value)}
                      readOnly={!editableSections.r_ba_damp}
                      className="h-7 px-2 text-left font-mono text-xs read-only:cursor-default read-only:caret-transparent read-only:opacity-70"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-4">On Base %</h4>
            <div className="bg-muted p-4 rounded-lg font-mono text-sm space-y-2">
              <div><span className="text-muted-foreground">ScaledOBP =</span> NCAAAvgOBP + ((OBPPowerRating+ - NCAAAvgPowerRating) / StdDevOBPPowerRating) × StdDevNCAAOBP</div>
              <div><span className="text-muted-foreground">Blended =</span> (LastOBP × (1 - PowerRatingWeight)) + (ScaledOBP × PowerRatingWeight)</div>
              <div><span className="text-muted-foreground">Mult =</span> (1) + (ClassAdjustment) + (DevAggressiveness × 0.06)</div>
              <div><span className="text-muted-foreground">Projected =</span> Blended × Mult</div>
              <div><span className="text-muted-foreground">Delta =</span> Projected - LastOBP</div>
              <div><span className="text-muted-foreground">DampFactor =</span> IFS(Projected ≤ 0.455, 1.0, Projected ≤ 0.485, 0.9, Projected ≤ 0.525, 0.7, TRUE, 0.4)</div>
              <div className="ml-6 space-y-1 text-xs">
                <div>1.0 if Projected ≤ 0.455</div>
                <div>0.9 if 0.455 &lt; Projected ≤ 0.485</div>
                <div>0.7 if 0.485 &lt; Projected ≤ 0.525</div>
                <div>0.4 if Projected &gt; 0.525</div>
              </div>
              <div><span className="text-muted-foreground">Final =</span> LastOBP + (Delta × DampFactor)</div>
            </div>
            <div className="mt-4 grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Constants</p>
                <div className="ml-2 space-y-0.5">
                  <div>• Power Rating Weight = 0.7</div>
                  <div>• NCAA Avg Power Rating = 100</div>
                </div>
              </div>
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>NCAA Average</p>
                <div className="space-y-1.5">
                  {syncedField("NCAA Avg OBP", ncaaStats?.obp, 3)}
                </div>
              </div>
              <div className={sectionPanelClass}>
                {editableSectionHeader("r_obp_sd", "SD Constants")}
                <div className="space-y-1.5">
                  {editableField("r_obp_sd", "r_obp_std_pr", "Std Dev OBP Power Rating+")}
                  {editableField("r_obp_sd", "r_obp_std_ncaa", "Std Dev NCAA OBP")}
                </div>
              </div>
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Player-Specific</p>
                <div className="ml-2 space-y-0.5">
                  <div>• Last OBP</div>
                  <div>• OBP Power Rating +</div>
                  <div>• Dev Aggressiveness (-2 to +2)</div>
                </div>
              </div>
              <div className={sectionPanelClass}>
                {editableSectionHeader("r_obp_class", "Class Adjustments")}
                <div className="space-y-1.5">
                  {editableField("r_obp_class", "r_obp_class_fs", "FS", "0.1", "%")}
                  {editableField("r_obp_class", "r_obp_class_sj", "SJ", "0.1", "%")}
                  {editableField("r_obp_class", "r_obp_class_js", "JS", "0.1", "%")}
                  {editableField("r_obp_class", "r_obp_class_gr", "GR", "0.1", "%")}
                </div>
              </div>
              <div className={sectionPanelClass}>
                {editableSectionHeader("r_obp_damp", "On Base % Dampening")}
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <Input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      spellCheck={false}
                      value={editableValues.r_obp_damp_tier1_max ?? ""}
                      onChange={(e) => setEditable("r_obp_damp_tier1_max", e.target.value)}
                      readOnly={!editableSections.r_obp_damp}
                      className="h-7 px-2 text-left font-mono text-xs read-only:cursor-default read-only:caret-transparent read-only:opacity-70"
                    />
                    <Input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      spellCheck={false}
                      value={editableValues.r_obp_damp_tier2_max ?? ""}
                      onChange={(e) => setEditable("r_obp_damp_tier2_max", e.target.value)}
                      readOnly={!editableSections.r_obp_damp}
                      className="h-7 px-2 text-left font-mono text-xs read-only:cursor-default read-only:caret-transparent read-only:opacity-70"
                    />
                    <Input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      spellCheck={false}
                      value={editableValues.r_obp_damp_tier3_max ?? ""}
                      onChange={(e) => setEditable("r_obp_damp_tier3_max", e.target.value)}
                      readOnly={!editableSections.r_obp_damp}
                      className="h-7 px-2 text-left font-mono text-xs read-only:cursor-default read-only:caret-transparent read-only:opacity-70"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <span>Range (Projected OBP)</span>
                    <span>Impact</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 items-center">
                    <div className="h-7 px-2 flex items-center border rounded-md bg-muted/40 text-[11px] text-muted-foreground font-mono">
                      ≤ {obpTier1Max}
                    </div>
                    <Input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      spellCheck={false}
                      value={editableValues.r_obp_damp_tier1_impact ?? ""}
                      onChange={(e) => setEditable("r_obp_damp_tier1_impact", e.target.value)}
                      readOnly={!editableSections.r_obp_damp}
                      className="h-7 px-2 text-left font-mono text-xs read-only:cursor-default read-only:caret-transparent read-only:opacity-70"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2 items-center">
                    <div className="h-7 px-2 flex items-center border rounded-md bg-muted/40 text-[11px] text-muted-foreground font-mono">
                      &gt; {obpTier1Max} and ≤ {obpTier2Max}
                    </div>
                    <Input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      spellCheck={false}
                      value={editableValues.r_obp_damp_tier2_impact ?? ""}
                      onChange={(e) => setEditable("r_obp_damp_tier2_impact", e.target.value)}
                      readOnly={!editableSections.r_obp_damp}
                      className="h-7 px-2 text-left font-mono text-xs read-only:cursor-default read-only:caret-transparent read-only:opacity-70"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2 items-center">
                    <div className="h-7 px-2 flex items-center border rounded-md bg-muted/40 text-[11px] text-muted-foreground font-mono">
                      &gt; {obpTier2Max} and ≤ {obpTier3Max}
                    </div>
                    <Input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      spellCheck={false}
                      value={editableValues.r_obp_damp_tier3_impact ?? ""}
                      onChange={(e) => setEditable("r_obp_damp_tier3_impact", e.target.value)}
                      readOnly={!editableSections.r_obp_damp}
                      className="h-7 px-2 text-left font-mono text-xs read-only:cursor-default read-only:caret-transparent read-only:opacity-70"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2 items-center">
                    <div className="h-7 px-2 flex items-center border rounded-md bg-muted/40 text-[11px] text-muted-foreground font-mono">
                      &gt; {obpTier3Max}
                    </div>
                    <Input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      spellCheck={false}
                      value={editableValues.r_obp_damp_tier4_impact ?? ""}
                      onChange={(e) => setEditable("r_obp_damp_tier4_impact", e.target.value)}
                      readOnly={!editableSections.r_obp_damp}
                      className="h-7 px-2 text-left font-mono text-xs read-only:cursor-default read-only:caret-transparent read-only:opacity-70"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-4">Slugging %</h4>
            <div className="bg-muted p-4 rounded-lg font-mono text-sm space-y-2">
              <div><span className="text-muted-foreground">ProjectedSLG =</span> PredictedBA + PredictedISO</div>
            </div>
            <div className="mt-4 grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Inputs</p>
                <div className="ml-2 space-y-0.5">
                  <div>• Predicted BA (from BA equation)</div>
                  <div>• Predicted ISO (from ISO equation)</div>
                </div>
              </div>
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Notes</p>
                <div className="ml-2 space-y-0.5">
                  <div>• No extra weighting or dampening applied here</div>
                  <div>• Final SLG is a direct sum of BA and ISO projections</div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-4">On Base + Slugging (OPS)</h4>
            <div className="bg-muted p-4 rounded-lg font-mono text-sm space-y-2">
              <div><span className="text-muted-foreground">ProjectedOPS =</span> PredictedOBP + PredictedSLG</div>
            </div>
            <div className="mt-4 grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Inputs</p>
                <div className="ml-2 space-y-0.5">
                  <div>• Predicted OBP</div>
                  <div>• Predicted SLG</div>
                </div>
              </div>
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Notes</p>
                <div className="ml-2 space-y-0.5">
                  <div>• Direct sum of OBP and SLG projections</div>
                  <div>• No additional multiplier applied</div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-4">Isolated Power</h4>
            <div className="bg-muted p-4 rounded-lg font-mono text-sm space-y-2">
              <div><span className="text-muted-foreground">LastISO =</span> LastSlugging - LastBattingAverage</div>
              <div><span className="text-muted-foreground">ScaledISO =</span> NCAAAvgISO + ((ISOPowerRating+ - NCAAAvgPowerRating) / StdDevISOPowerRating) × StdDevNCAAISO</div>
              <div><span className="text-muted-foreground">BlendedISO =</span> (LastISO × (1 - PowerRatingWeight)) + (ScaledISO × PowerRatingWeight)</div>
              <div><span className="text-muted-foreground">Mult =</span> (1) + (ClassAdjustment) + (DevAggressiveness × 0.08)</div>
              <div><span className="text-muted-foreground">ProjectedISO =</span> BlendedISO × Mult</div>
            </div>
            <div className="mt-4 grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Constants</p>
                <div className="ml-2 space-y-0.5">
                  <div>• Power Rating Weight = 0.70</div>
                  <div>• NCAA Avg Power Rating = 100</div>
                  <div>• Std Dev ISO Power Rating = 45.423</div>
                  <div>• Std Dev NCAA ISO = 0.07849797197</div>
                </div>
              </div>
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>NCAA Average</p>
                <div className="space-y-1.5">
                  {syncedField("NCAA Avg ISO", ncaaStats?.iso, 3)}
                </div>
              </div>
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Player-Specific</p>
                <div className="ml-2 space-y-0.5">
                  <div>• Last Slugging</div>
                  <div>• Last Batting Average</div>
                  <div>• ISO Power Rating +</div>
                  <div>• Dev Aggressiveness</div>
                </div>
              </div>
              <div className={sectionPanelClass}>
                {editableSectionHeader("r_iso_class", "Class Adjustments")}
                <div className="space-y-1.5">
                  {editableField("r_iso_class", "r_iso_class_fs", "FS", "0.1", "%")}
                  {editableField("r_iso_class", "r_iso_class_sj", "SJ", "0.1", "%")}
                  {editableField("r_iso_class", "r_iso_class_js", "JS", "0.1", "%")}
                  {editableField("r_iso_class", "r_iso_class_gr", "GR", "0.1", "%")}
                </div>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-4">Weighted Runs Created (wRC)</h4>
            <div className="bg-muted p-4 rounded-lg font-mono text-sm space-y-2">
              <div><span className="text-muted-foreground">ProjectedWRC =</span> (OBPWeight × PredictedOBP) + (SLGWeight × PredictedSLG) + (AVGWeight × PredictedAVG) + (ISOWeight × PredictedISO)</div>
            </div>
            <div className="mt-4 grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Inputs</p>
                <div className="ml-2 space-y-0.5">
                  <div>• Predicted OBP</div>
                  <div>• Predicted SLG</div>
                  <div>• Predicted AVG</div>
                  <div>• Predicted ISO</div>
                </div>
              </div>
              <div className={sectionPanelClass}>
                {editableSectionHeader("r_wrc")}
                <div className="space-y-1.5">
                  {editableField("r_wrc", "r_w_obp", "OBP Weight")}
                  {editableField("r_wrc", "r_w_slg", "SLG Weight")}
                  {editableField("r_wrc", "r_w_avg", "AVG Weight")}
                  {editableField("r_wrc", "r_w_iso", "ISO Weight")}
                </div>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-4">Weighted Runs Created + (wRC+)</h4>
            <div className="bg-muted p-4 rounded-lg font-mono text-sm space-y-2">
              <div><span className="text-muted-foreground">ProjectedWRC+ =</span> (PredictedWRC / NCAAAvgWRC) × 100</div>
            </div>
            <div className="mt-4 grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Inputs</p>
                <div className="ml-2 space-y-0.5">
                  <div>• Predicted WRC</div>
                  <div>• NCAA Avg WRC</div>
                </div>
              </div>
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>NCAA Average</p>
                <div className="space-y-1.5">
                  {syncedField("NCAA Avg WRC", ncaaStats?.wrc, 3)}
                </div>
              </div>
            </div>
          </div>

        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Transfer Portal Model</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h4 className="font-semibold mb-4">Batting Average</h4>
            <div className="bg-muted p-4 rounded-lg font-mono text-sm space-y-2">
              <div><span className="text-muted-foreground">LastStat =</span> LastBattingAverage</div>
              <div><span className="text-muted-foreground">PowerAdj =</span> NCAAAvgBattingAverage + ((BattingAveragePowerRating+ - 100) / StdDevBAPowerRating+) × StdDevNCAABattingAverage</div>
              <div><span className="text-muted-foreground">Blended =</span> (LastStat × (1 - PowerRatingWeight)) + (PowerAdj × PowerRatingWeight)</div>
              <div><span className="text-muted-foreground">Multiplier =</span> (1 + (ConferenceWeight × ((ToAverage+ - FromAverage+) / 100))) - (PitchingWeight × ((ToStuff+ - FromStuff+) / 100)) + (ParkFactorWeight × ((ToAVGParkFactor - FromAVGParkFactor) / 100))</div>
              <div><span className="text-muted-foreground">ProjectedBA =</span> Blended × Multiplier</div>
            </div>
            <div className="mt-4 grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Constants</p>
                <div className="ml-2 space-y-0.5">
                  <div>• Power rating baseline = 100</div>
                </div>
              </div>
              <div className={sectionPanelClass}>
                {editableSectionHeader("t_ba")}
                <div className="space-y-1.5">
                  {syncedField("NCAA Avg Batting Average", ncaaStats?.avg, 3)}
                  {editableField("t_ba", "t_ba_std_pr", "StdDev BA Power Rating +")}
                  {editableField("t_ba", "t_ba_std_ncaa", "StdDev NCAA Batting Average")}
                  {editableField("t_ba", "t_ba_power_weight", "Power Rating Weight")}
                  {editableField("t_ba", "t_ba_conference_weight", "Conference Weight")}
                  {editableField("t_ba", "t_ba_pitching_weight", "Pitching Weight")}
                  {editableField("t_ba", "t_ba_park_weight", "Park Factor Weight")}
                </div>
              </div>
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Player-Specific</p>
                <div className="ml-2 space-y-0.5">
                  <div>• Last Batting Average</div>
                  <div>• Batting Average Power Rating +</div>
                </div>
              </div>
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Conference-Specific (delta from conference transfer)</p>
                <div className="ml-2 space-y-0.5">
                  <div>• To Average + / From Average +</div>
                  <div>• To Stuff + / From Stuff +</div>
                  <div>• To Park Factor / From Park Factor</div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-4">On Base %</h4>
            <div className="bg-muted p-4 rounded-lg font-mono text-sm space-y-2">
              <div><span className="text-muted-foreground">LastOBP =</span> LastOnBase%</div>
              <div><span className="text-muted-foreground">PowerAdj =</span> NCAAAvgOBP + ((OBPPowerRating+ - 100) / StdDevOBPPowerRating+) × StdDevNCAAOBP</div>
              <div><span className="text-muted-foreground">Blended =</span> (LastOBP × (1 - PowerRatingWeight)) + (PowerAdj × PowerRatingWeight)</div>
              <div><span className="text-muted-foreground">Multiplier =</span> (1 + (ConferenceWeight × ((ToOBP+ - FromOBP+) / 100))) - (PitchingWeight × ((ToStuff+ - FromStuff+) / 100)) + (ParkFactorWeight × ((ToOBPParkFactor - FromOBPParkFactor) / 100))</div>
              <div><span className="text-muted-foreground">ProjectedOBP =</span> Blended × Multiplier</div>
            </div>
            <div className="mt-4 grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Constants</p>
                <div className="ml-2 space-y-0.5">
                  <div>• Power rating baseline = 100</div>
                </div>
              </div>
              <div className={sectionPanelClass}>
                {editableSectionHeader("t_obp")}
                <div className="space-y-1.5">
                  {syncedField("NCAA Avg OBP", ncaaStats?.obp, 3)}
                  {editableField("t_obp", "t_obp_std_pr", "StdDev OBP Power Rating +")}
                  {editableField("t_obp", "t_obp_std_ncaa", "StdDev NCAA OBP")}
                  {editableField("t_obp", "t_obp_power_weight", "Power Rating Weight")}
                  {editableField("t_obp", "t_obp_conference_weight", "Conference Weight")}
                  {editableField("t_obp", "t_obp_pitching_weight", "Pitching Weight")}
                  {editableField("t_obp", "t_obp_park_weight", "Park Factor Weight")}
                </div>
              </div>
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Player-Specific</p>
                <div className="ml-2 space-y-0.5">
                  <div>• Last On Base %</div>
                  <div>• OBP Power Rating +</div>
                </div>
              </div>
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Conference-Specific (delta from conference transfer)</p>
                <div className="ml-2 space-y-0.5">
                  <div>• To OBP + / From OBP +</div>
                  <div>• To Stuff + / From Stuff +</div>
                  <div>• To Park Factor / From Park Factor</div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-4">Slugging %</h4>
            <div className="bg-muted p-4 rounded-lg font-mono text-sm space-y-2">
              <div><span className="text-muted-foreground">ProjectedSLG =</span> PredictedISO + PredictedBA</div>
            </div>
            <div className="mt-4 grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Inputs</p>
                <div className="ml-2 space-y-0.5">
                  <div>• Predicted ISO</div>
                  <div>• Predicted BA</div>
                </div>
              </div>
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Notes</p>
                <div className="ml-2 space-y-0.5">
                  <div>• Direct sum of ISO and BA projections</div>
                  <div>• No additional multiplier applied</div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-4">On Base + Slugging (OPS)</h4>
            <div className="bg-muted p-4 rounded-lg font-mono text-sm space-y-2">
              <div><span className="text-muted-foreground">ProjectedOPS =</span> PredictedOBP + PredictedSLG</div>
            </div>
            <div className="mt-4 grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Inputs</p>
                <div className="ml-2 space-y-0.5">
                  <div>• Predicted OBP</div>
                  <div>• Predicted SLG</div>
                </div>
              </div>
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Notes</p>
                <div className="ml-2 space-y-0.5">
                  <div>• Direct sum of OBP and SLG projections</div>
                  <div>• No additional multiplier applied</div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-4">Isolated Power</h4>
            <div className="bg-muted p-4 rounded-lg font-mono text-sm space-y-2">
              <div><span className="text-muted-foreground">LastISO =</span> LastSlugging - LastBattingAverage</div>
              <div><span className="text-muted-foreground">RatingZ =</span> (ISOPowerRating+ - 100) / StdDevISOPowerRating</div>
              <div><span className="text-muted-foreground">ScaledISO =</span> NCAAAvgISO + (RatingZ × StdDevNCAAISO)</div>
              <div><span className="text-muted-foreground">Blended =</span> (LastISO × (1 - 0.3)) + (ScaledISO × 0.3)</div>
              <div><span className="text-muted-foreground">Multiplier =</span> (1 + (ConferenceWeight × ((ToISO+ - FromISO+) / 100))) - (PitchingWeight × ((ToStuff+ - FromStuff+) / 100)) + (ParkFactorWeight × ((ToISOParkFactor - FromISOParkFactor) / 100))</div>
              <div><span className="text-muted-foreground">ProjectedISO =</span> Blended × Multiplier</div>
            </div>
            <div className="mt-4 grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Constants</p>
                <div className="ml-2 space-y-0.5">
                  <div>• Power rating baseline = 100</div>
                  <div>• ISO Power Rating Weight = 0.3</div>
                </div>
              </div>
              <div className={sectionPanelClass}>
                {editableSectionHeader("t_iso")}
                <div className="space-y-1.5">
                  {syncedField("NCAA Avg ISO", ncaaStats?.iso, 3)}
                  {editableField("t_iso", "t_iso_std_ncaa", "Std Dev NCAA ISO", "0.000001")}
                  {editableField("t_iso", "t_iso_std_power", "Std Dev ISO Power Rating")}
                  {editableField("t_iso", "t_iso_conference_weight", "Conference Weight")}
                  {editableField("t_iso", "t_iso_pitching_weight", "Pitching Weight")}
                  {editableField("t_iso", "t_iso_park_weight", "Park Factor Weight")}
                </div>
              </div>
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Player-Specific</p>
                <div className="ml-2 space-y-0.5">
                  <div>• Last Slugging</div>
                  <div>• Last Batting Average</div>
                  <div>• ISO Power Rating +</div>
                </div>
              </div>
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Conference-Specific (delta from conference transfer)</p>
                <div className="ml-2 space-y-0.5">
                  <div>• To ISO + / From ISO +</div>
                  <div>• To Stuff + / From Stuff +</div>
                  <div>• To Park Factor / From Park Factor</div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-4">Weighted Runs Created (wRC)</h4>
            <div className="bg-muted p-4 rounded-lg font-mono text-sm space-y-2">
              <div><span className="text-muted-foreground">ProjectedWRC =</span> (OBPWeight × PredictedOBP) + (SLGWeight × PredictedSLG) + (AVGWeight × PredictedAVG) + (ISOWeight × PredictedISO)</div>
            </div>
            <div className="mt-4 grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Inputs</p>
                <div className="ml-2 space-y-0.5">
                  <div>• Predicted OBP</div>
                  <div>• Predicted SLG</div>
                  <div>• Predicted AVG</div>
                  <div>• Predicted ISO</div>
                </div>
              </div>
              <div className={sectionPanelClass}>
                {editableSectionHeader("t_wrc")}
                <div className="space-y-1.5">
                  {editableField("t_wrc", "t_w_obp", "OBP Weight")}
                  {editableField("t_wrc", "t_w_slg", "SLG Weight")}
                  {editableField("t_wrc", "t_w_avg", "AVG Weight")}
                  {editableField("t_wrc", "t_w_iso", "ISO Weight")}
                </div>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-4">Weighted Runs Created + (wRC+)</h4>
            <div className="bg-muted p-4 rounded-lg font-mono text-sm space-y-2">
              <div><span className="text-muted-foreground">ProjectedWRC+ =</span> (PredictedWRC / NCAAAvgWRC) × 100</div>
            </div>
            <div className="mt-4 grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Inputs</p>
                <div className="ml-2 space-y-0.5">
                  <div>• Predicted WRC</div>
                  <div>• NCAA Avg WRC</div>
                </div>
              </div>
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>NCAA Average</p>
                <div className="space-y-1.5">
                  {syncedField("NCAA Avg WRC", ncaaStats?.wrc, 3)}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Offensive Wins Above Replacement (oWAR)</CardTitle>
          <CardDescription>Equation + all offensive WAR factors</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h4 className="font-semibold mb-4">oWAR Equation</h4>
            <div className="bg-muted p-4 rounded-lg font-mono text-sm space-y-2">
              <div><span className="text-muted-foreground">OffValue =</span> (ProjectedWRC+ - WRC+Baseline) / 100</div>
              <div><span className="text-muted-foreground">RAA =</span> OffValue × PlateAppearances × Runs/PA</div>
              <div><span className="text-muted-foreground">ReplacementRuns =</span> (PlateAppearances / 600) × ReplacementRuns/600PA</div>
              <div><span className="text-muted-foreground">RAR =</span> RAA + ReplacementRuns</div>
              <div><span className="text-muted-foreground">ProjectedOWAR =</span> RAR / Runs/Win</div>
            </div>
            <div className="mt-4 grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Inputs</p>
                <div className="ml-2 space-y-0.5">
                  <div>• ProjectedWRC+</div>
                  <div>• WRC+Baseline (100)</div>
                  <div>• PlateAppearances</div>
                  <div>• Runs/PA</div>
                  <div>• ReplacementRuns/600PA (25)</div>
                  <div>• Runs/Win</div>
                  <div>• *For future projections, at 260 plate appearances = 10.83</div>
                </div>
              </div>
              <div className={sectionPanelClass}>
                {editableSectionHeader("owar_eq")}
                <p className="text-[10px] text-muted-foreground">* assuming future projections</p>
                <div className="space-y-1.5">
                  {editableField("owar_eq", "owar_wrc_plus_baseline", "WRC+Baseline")}
                  {editableField("owar_eq", "owar_plate_appearances", "PlateAppearances")}
                  {editableField("owar_eq", "owar_run_value_per_pa", "Runs/PA")}
                  {editableField("owar_eq", "owar_replacement_runs_per_600", "ReplacementRuns/600PA")}
                  {editableField("owar_eq", "owar_runs_per_win", "Runs/Win")}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Market Value</CardTitle>
          <CardDescription>Baseline equation for backend valuation projections</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h4 className="font-semibold mb-2">Default Equation</h4>
            <div className="bg-muted p-4 rounded-lg font-mono text-sm space-y-2">
              <div><span className="text-muted-foreground">ProjectedNILValue =</span> oWAR × $/oWAR × ProgramTierMultiplier × PositionalValueMultiplier</div>
            </div>
            <div className="mt-2 grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Inputs</p>
                <div className="ml-2 space-y-0.5">
                  <div>• oWAR</div>
                  <div>• $/oWAR</div>
                  <div>• Program Tier Multiplier</div>
                  <div>• Positional Value Multiplier</div>
                </div>
              </div>
              <div className={sectionPanelClass}>
                {editableSectionHeader("nil_default_eq")}
                <div className="space-y-1.5">
                  {editableField("nil_default_eq", "nil_base_per_owar", "$/oWAR", "0.001", undefined, "currency")}
                </div>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-2">Program & Positional Multipliers</h4>
            <div className="mt-1 grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Defaults</p>
                <div className="ml-2 space-y-0.5">
                  <div>• SEC = 1.5</div>
                  <div>• ACC / Big12 = 1.2</div>
                  <div>• Big Ten = 1.0</div>
                  <div>• Strong Mid Major = 0.8</div>
                  <div>• Low Major = 0.5</div>
                  <div className="pt-1">• Strong Mid Major conferences: American Athletic, Sun Belt, Big West, Mountain West</div>
                  <div>• All remaining conferences default to Low Major</div>
                  <div className="pt-1">• Catcher / Shortstop / Center Field / TWP = 1.3</div>
                  <div>• Second Base / Third Base / Corner Outfield = 1.1</div>
                  <div>• First Base / DH = 1.0</div>
                  <div>• Bench Utility = 0.8</div>
                </div>
              </div>
              <div className={sectionPanelClass}>
                {editableSectionHeader("nil_tiers")}
                <div className="space-y-1.5">
                  {editableField("nil_tiers", "nil_tier_sec", "SEC")}
                  {editableField("nil_tiers", "nil_tier_p4", "ACC/Big12")}
                  {editableField("nil_tiers", "nil_tier_big_ten", "Big Ten")}
                  {editableField("nil_tiers", "nil_tier_strong_mid", "Strong Mid Major")}
                  {editableField("nil_tiers", "nil_tier_low_major", "Low Major")}
                </div>
                <div className="my-2 border-t" />
                {editableSectionHeader("nil_positions")}
                <div className="space-y-1.5">
                  {editableField("nil_positions", "nil_pos_group_c_ss_cf", "Catcher / Shortstop / Center Field / TWP")}
                  {editableField("nil_positions", "nil_pos_group_2b_3b_cof", "Second Base / Third Base / Corner Outfield")}
                  {editableField("nil_positions", "nil_pos_group_1b_dh", "First Base / DH")}
                  {editableField("nil_positions", "nil_pos_group_bench_utility", "Bench Utility")}
                </div>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-2">Program-Specific NIL Equation</h4>
            <div className="bg-muted p-4 rounded-lg font-mono text-sm space-y-2">
              <div><span className="text-muted-foreground">PlayerScore =</span> oWAR × ProgramTierMultiplier × PositionalValueMultiplier</div>
              <div><span className="text-muted-foreground">ProgramSpecificNIL =</span> (PlayerScore / SumOfTotalRosterPlayerScore) × TeamSpecificTotalNILBudget</div>
            </div>
            <div className="mt-2 grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Inputs</p>
                <div className="ml-2 space-y-0.5">
                  <div>• oWAR</div>
                  <div>• Program Tier Multiplier (PTM)</div>
                  <div>• Positional Value Multiplier (PVF)</div>
                  <div>• Team-Specific Total NIL Budget</div>
                  <div>• Sum of Total Roster Player Score (68 for future projections)</div>
                </div>
              </div>
              <div className={sectionPanelClass}>
                {editableSectionHeader("nil_program_specific")}
                <div className="space-y-1.5">
                  {editableField("nil_program_specific", "nil_program_total_player_score", "Future Projection Sum of Total Roster Players' Score")}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}

// ─── Power Ratings Tab ────────────────────────────────────────────────────────


function AdminPowerRatingsTab() {
  const [editableSections, setEditableSections] = useState<Record<string, boolean>>({});
  const defaultEditableValues: Record<string, string> = {
    ba_ncaa_contact_pct: "77.1",
    ba_ncaa_line_drive_pct: "20.9",
    ba_ncaa_avg_exit_velocity: "86.2",
    ba_ncaa_pop_up_pct: "7.9",
    ba_ncaa_avg_power_rating: "50",
    obp_ncaa_avg_power_rating: "50",
    iso_ncaa_avg_power_rating: "50",
    obp_ncaa_contact_pct: "77.1",
    obp_ncaa_line_drive_pct: "20.9",
    obp_ncaa_avg_exit_velocity: "86.2",
    obp_ncaa_pop_up_pct: "7.9",
    obp_ncaa_walk_pct: "11.4",
    obp_ncaa_chase_pct: "23.1",
    iso_ncaa_barrel_pct: "17.3",
    iso_ncaa_ev90: "103.10",
    iso_ncaa_pull_pct: "36.5",
    iso_ncaa_la_10_30: "29",
    iso_ncaa_gb_pct: "43.2",
    ba_contact_pct_std_dev: "6.60",
    ba_line_drive_pct_std_dev: "4.31",
    ba_avg_exit_velocity_std_dev: "4.28",
    ba_pop_up_pct_std_dev: "3.37",
    obp_contact_pct_std_dev: "6.60",
    obp_line_drive_pct_std_dev: "4.31",
    obp_avg_exit_velocity_std_dev: "4.28",
    obp_pop_up_pct_std_dev: "3.37",
    obp_walk_pct_std_dev: "3.57",
    obp_chase_pct_std_dev: "5.58",
    iso_barrel_pct_std_dev: "7.89",
    iso_ev90_std_dev: "3.97",
    iso_pull_pct_std_dev: "8.03",
    iso_la_10_30_std_dev: "6.81",
    iso_gb_pct_std_dev: "8.0",
    ba_contact_pct_weight: "0.40",
    ba_line_drive_pct_weight: "0.25",
    ba_avg_exit_velocity_weight: "0.20",
    ba_pop_up_pct_weight: "0.15",
    obp_contact_pct_weight: "0.35",
    obp_line_drive_pct_weight: "0.20",
    obp_avg_exit_velocity_weight: "0.15",
    obp_pop_up_pct_weight: "0.10",
    obp_walk_pct_weight: "0.15",
    obp_chase_pct_weight: "0.05",
    iso_barrel_pct_weight: "0.45",
    iso_ev90_weight: "0.30",
    iso_pull_pct_weight: "0.15",
    iso_la_10_30_weight: "0.05",
    iso_gb_pct_weight: "0.05",
    overall_avg_exit_velocity_weight: "0.35",
    overall_barrel_pct_weight: "0.15",
    overall_contact_pct_weight: "0.30",
    overall_chase_pct_weight: "0.20",
  };
  const [editableValues, setEditableValues] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem("admin_dashboard_power_equation_values_v3");
      if (!raw) return defaultEditableValues;
      const parsed = JSON.parse(raw) as Record<string, string>;
      const merged = { ...defaultEditableValues, ...parsed };
      merged.obp_contact_pct_weight = defaultEditableValues.obp_contact_pct_weight;
      merged.obp_line_drive_pct_weight = defaultEditableValues.obp_line_drive_pct_weight;
      merged.obp_avg_exit_velocity_weight = defaultEditableValues.obp_avg_exit_velocity_weight;
      merged.obp_pop_up_pct_weight = defaultEditableValues.obp_pop_up_pct_weight;
      merged.obp_walk_pct_weight = defaultEditableValues.obp_walk_pct_weight;
      merged.obp_chase_pct_weight = defaultEditableValues.obp_chase_pct_weight;
      merged.obp_ncaa_avg_power_rating = defaultEditableValues.obp_ncaa_avg_power_rating;
      merged.iso_barrel_pct_weight = defaultEditableValues.iso_barrel_pct_weight;
      merged.iso_ev90_weight = defaultEditableValues.iso_ev90_weight;
      merged.iso_pull_pct_weight = defaultEditableValues.iso_pull_pct_weight;
      merged.iso_la_10_30_weight = defaultEditableValues.iso_la_10_30_weight;
      merged.iso_gb_pct_weight = defaultEditableValues.iso_gb_pct_weight;
      merged.iso_ncaa_avg_power_rating = defaultEditableValues.iso_ncaa_avg_power_rating;
      merged.iso_ncaa_barrel_pct = defaultEditableValues.iso_ncaa_barrel_pct;
      merged.iso_ncaa_ev90 = defaultEditableValues.iso_ncaa_ev90;
      merged.iso_ncaa_pull_pct = defaultEditableValues.iso_ncaa_pull_pct;
      merged.iso_ncaa_la_10_30 = defaultEditableValues.iso_ncaa_la_10_30;
      merged.iso_ncaa_gb_pct = defaultEditableValues.iso_ncaa_gb_pct;
      for (const [k, v] of Object.entries(merged)) {
        if (v === "") merged[k] = defaultEditableValues[k] ?? "";
      }
      return merged;
    } catch {
      return defaultEditableValues;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("admin_dashboard_power_equation_values_v3", JSON.stringify(editableValues));
    } catch {
      // ignore storage errors
    }
  }, [editableValues]);

  const setEditable = (key: string, value: string) => {
    if (/^-?\d*\.?\d*$/.test(value)) {
      setEditableValues((prev) => ({ ...prev, [key]: value }));
    }
  };

  const toggleEditableSection = (sectionKey: string) => {
    setEditableSections((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }));
  };

  const sectionHeadingClass = "text-[11px] uppercase tracking-wide font-semibold text-foreground";
  const sectionPanelClass = "rounded-md border bg-background/60 p-3 space-y-2";
  const editableSectionHeader = (sectionKey: string, title = "Editable (Admin UI)") => {
    const isEditable = !!editableSections[sectionKey];
    return (
      <div className="flex items-center justify-between gap-2">
        <p className={sectionHeadingClass}>{title}</p>
        <Button
          type="button"
          size="sm"
          variant={isEditable ? "secondary" : "outline"}
          className="h-6 px-2 text-[11px]"
          onClick={() => toggleEditableSection(sectionKey)}
        >
          {isEditable ? "Done" : "Edit"}
        </Button>
      </div>
    );
  };

  const editableField = (sectionKey: string, key: string, label: string) => {
    const isSectionEditable = !!editableSections[sectionKey];
    return (
      <div className="flex items-center justify-between gap-3">
        <span>{label}</span>
        <Input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={editableValues[key] ?? ""}
          onChange={(e) => setEditable(key, e.target.value)}
          readOnly={!isSectionEditable}
          className="h-7 w-32 px-2 text-left font-mono text-xs read-only:cursor-default read-only:caret-transparent read-only:opacity-70"
        />
      </div>
    );
  };

  const safeNumber = (value: string | undefined, fallback: number) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  const baContactWeight = safeNumber(editableValues.ba_contact_pct_weight, 0.4);
  const baLineDriveWeight = safeNumber(editableValues.ba_line_drive_pct_weight, 0.25);
  const baAvgEVWeight = safeNumber(editableValues.ba_avg_exit_velocity_weight, 0.2);
  const baPopUpWeight = safeNumber(editableValues.ba_pop_up_pct_weight, 0.15);
  const obpContactWeight = safeNumber(editableValues.obp_contact_pct_weight, 0.35);
  const obpLineDriveWeight = safeNumber(editableValues.obp_line_drive_pct_weight, 0.2);
  const obpAvgEVWeight = safeNumber(editableValues.obp_avg_exit_velocity_weight, 0.15);
  const obpPopUpWeight = safeNumber(editableValues.obp_pop_up_pct_weight, 0.1);
  const obpWalkWeight = safeNumber(editableValues.obp_walk_pct_weight, 0.15);
  const obpChaseWeight = safeNumber(editableValues.obp_chase_pct_weight, 0.05);
  const isoBarrelWeight = safeNumber(editableValues.iso_barrel_pct_weight, 0.45);
  const isoEV90Weight = safeNumber(editableValues.iso_ev90_weight, 0.3);
  const isoPullWeight = safeNumber(editableValues.iso_pull_pct_weight, 0.15);
  const isoLA1030Weight = safeNumber(editableValues.iso_la_10_30_weight, 0.05);
  const isoGBWeight = safeNumber(editableValues.iso_gb_pct_weight, 0.05);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Power Rating Equations</h3>
        <p className="text-sm text-muted-foreground">Equation tables used to calculate component and overall offensive power ratings.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Batting Average Power Rating</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted p-4 rounded-lg font-mono text-sm">
            <div><span className="text-muted-foreground">BAPowerRating =</span> ({baContactWeight.toFixed(2)} × ContactScore) + ({baLineDriveWeight.toFixed(2)} × LineDriveScore) + ({baAvgEVWeight.toFixed(2)} × AverageExitVelocityScore) + ({baPopUpWeight.toFixed(2)} × PopUpScore)</div>
            <div className="mt-2"><span className="text-muted-foreground">BAPowerRating+ =</span> (BAPowerRating / NCAAAverageBAPowerRating) × 100</div>
          </div>
          <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>Player-Specific Inputs</p>
              <div className="ml-2 space-y-0.5">
                <div>• Contact %</div>
                <div>• Line Drive %</div>
                <div>• Pop-Up %</div>
                <div>• Average Exit Velocity</div>
              </div>
            </div>
            <div className={sectionPanelClass}>
              {editableSectionHeader("pr_ba")}
              <div className="space-y-1.5">
                {editableField("pr_ba", "ba_ncaa_avg_power_rating", "NCAA Average BA Power Rating")}
                {editableField("pr_ba", "ba_contact_pct_weight", "Contact % Weight")}
                {editableField("pr_ba", "ba_line_drive_pct_weight", "Line Drive % Weight")}
                {editableField("pr_ba", "ba_avg_exit_velocity_weight", "Average Exit Velocity Weight")}
                {editableField("pr_ba", "ba_pop_up_pct_weight", "Pop-Up % Weight")}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">On Base % Power Rating</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted p-4 rounded-lg font-mono text-sm">
            <div><span className="text-muted-foreground">OBPPowerRating =</span> ({obpContactWeight.toFixed(2)} × ContactScore) + ({obpLineDriveWeight.toFixed(2)} × LineDriveScore) + ({obpAvgEVWeight.toFixed(2)} × AverageExitVelocityScore) + ({obpPopUpWeight.toFixed(2)} × PopUpScore) + ({obpWalkWeight.toFixed(2)} × BB%Score) + ({obpChaseWeight.toFixed(2)} × ChaseScore)</div>
            <div className="mt-2"><span className="text-muted-foreground">OBPPowerRating+ =</span> (OBPPowerRating / NCAAAverageOBPPowerRating) × 100</div>
          </div>
          <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>Player-Specific Inputs</p>
              <div className="ml-2 space-y-0.5">
                <div>• Contact %</div>
                <div>• Line Drive %</div>
                <div>• Average Exit Velocity</div>
                <div>• Pop-Up %</div>
                <div>• BB%</div>
                <div>• Chase %</div>
              </div>
            </div>
            <div className={sectionPanelClass}>
              {editableSectionHeader("pr_obp")}
              <div className="space-y-1.5">
                {editableField("pr_obp", "obp_ncaa_avg_power_rating", "NCAA Average OBP Power Rating")}
                {editableField("pr_obp", "obp_contact_pct_weight", "Contact % Weight")}
                {editableField("pr_obp", "obp_line_drive_pct_weight", "Line Drive % Weight")}
                {editableField("pr_obp", "obp_avg_exit_velocity_weight", "Average Exit Velocity Weight")}
                {editableField("pr_obp", "obp_pop_up_pct_weight", "Pop-Up % Weight")}
                {editableField("pr_obp", "obp_walk_pct_weight", "BB% Weight")}
                {editableField("pr_obp", "obp_chase_pct_weight", "Chase % Weight")}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Isolated Power Power Rating</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted p-4 rounded-lg font-mono text-sm">
            <div><span className="text-muted-foreground">ISOPowerRating =</span> ({isoBarrelWeight.toFixed(2)} × BarrelScore) + ({isoEV90Weight.toFixed(2)} × EV90Score) + ({isoPullWeight.toFixed(2)} × Pull%Score) + ({isoLA1030Weight.toFixed(2)} × LA10-30Score) + ({isoGBWeight.toFixed(2)} × GB%Score)</div>
            <div className="mt-2"><span className="text-muted-foreground">ISOPowerRating+ =</span> (ISOPowerRating / NCAAAverageISOPowerRating(50)) / 100</div>
          </div>
          <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>Player-Specific Inputs</p>
              <div className="ml-2 space-y-0.5">
                <div>• Barrel %</div>
                <div>• EV90</div>
                <div>• Pull %</div>
                <div>• LA10-30</div>
                <div>• GB %</div>
              </div>
            </div>
            <div className={sectionPanelClass}>
              {editableSectionHeader("pr_iso")}
              <div className="space-y-1.5">
                {editableField("pr_iso", "iso_ncaa_avg_power_rating", "NCAA Average ISO Power Rating")}
                {editableField("pr_iso", "iso_barrel_pct_weight", "Barrel % Weight")}
                {editableField("pr_iso", "iso_ev90_weight", "EV90 Weight")}
                {editableField("pr_iso", "iso_pull_pct_weight", "Pull % Weight")}
                {editableField("pr_iso", "iso_la_10_30_weight", "LA10-30 Weight")}
                {editableField("pr_iso", "iso_gb_pct_weight", "GB % Weight")}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Overall Power Rating</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted p-4 rounded-lg font-mono text-sm">
            <div><span className="text-muted-foreground">OverallPowerRating+ =</span> (0.25 × BAPowerRating+) + (0.40 × OBPPowerRating+) + (0.35 × ISOPowerRating+)</div>
          </div>
          <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>Inputs</p>
              <div className="ml-2 space-y-0.5">
                <div>• BA Power Rating+</div>
                <div>• OBP Power Rating+</div>
                <div>• ISO Power Rating+</div>
              </div>
            </div>
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>Weights</p>
              <div className="ml-2 space-y-0.5">
                <div>• BA Power Rating+ Weight = 0.25</div>
                <div>• OBP Power Rating+ Weight = 0.40</div>
                <div>• ISO Power Rating+ Weight = 0.35</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Score Equations Reference</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-2 xl:grid-cols-3">
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>Batting Average Scores</p>
              <div className="space-y-2 font-mono leading-relaxed">
                <div className="rounded bg-background/70 px-2 py-1 break-words">ContactScore = NORM.DIST(Contact%, NCAAAverageContact%, Contact%StdDev, TRUE) × 100</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">LineDriveScore = NORM.DIST(LineDrive%, NCAAAverageLineDrive%, LineDrive%StdDev, TRUE) × 100</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">AverageExitVelocityScore = NORM.DIST(AverageExitVelocity, NCAAAverageExitVelocity, AverageExitVelocityStdDev, TRUE) × 100</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">PopUpScore = 100 - (NORM.DIST(PopUp%, NCAAAveragePopUp%, PopUp%StdDev, TRUE) × 100)</div>
              </div>
            </div>
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>On Base % Scores</p>
              <div className="space-y-2 font-mono leading-relaxed">
                <div className="rounded bg-background/70 px-2 py-1 break-words">ContactScore = NORM.DIST(Contact%, NCAAAverageContact%, Contact%StdDev, TRUE) × 100</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">LineDriveScore = NORM.DIST(LineDrive%, NCAAAverageLineDrive%, LineDrive%StdDev, TRUE) × 100</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">AverageExitVelocityScore = NORM.DIST(AverageExitVelocity, NCAAAverageExitVelocity, AverageExitVelocityStdDev, TRUE) × 100</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">PopUpScore = 100 - (NORM.DIST(PopUp%, NCAAAveragePopUp%, PopUp%StdDev, TRUE) × 100)</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">BB%Score = NORM.DIST(BB%, NCAAAverageBB%, BB%StdDev, TRUE) × 100</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">ChaseScore = 100 - (NORM.DIST(Chase%, NCAAAverageChase%, Chase%StdDev, TRUE) × 100)</div>
              </div>
            </div>
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>Isolated Power Scores</p>
              <div className="space-y-2 font-mono leading-relaxed">
                <div className="rounded bg-background/70 px-2 py-1 break-words">BarrelScore = NORM.DIST(Barrel%, NCAAAverageBarrel%, Barrel%StdDev, TRUE) × 100</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">EV90Score = NORM.DIST(EV90, NCAAAverageEV90, EV90StdDev, TRUE) × 100</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">Pull%Score = NORM.DIST(Pull%, NCAAAveragePull%, Pull%StdDev, TRUE) × 100</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">LA10-30Score = NORM.DIST(LA10-30, NCAAAverageLA10-30, LA10-30StdDev, TRUE) × 100</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">GB%Score = 100 - (NORM.DIST(GB%, NCAAAverageGB%, GB%StdDev, TRUE) × 100)</div>
              </div>
            </div>
          </div>

          <div className={sectionPanelClass}>
            {editableSectionHeader("pr_std_dev", "Standard Deviations (Editable, System-Wide)")}
            <p className="text-[11px] text-muted-foreground">
              Calculated across every player in this system. These are manual admin inputs until automated recalculation is added.
            </p>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-md border bg-background/70 p-3 space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide font-semibold text-foreground">Batting Average</p>
                {editableField("pr_std_dev", "ba_contact_pct_std_dev", "Contact % Std Dev (Range: 54 to 95)")}
                {editableField("pr_std_dev", "ba_line_drive_pct_std_dev", "Line Drive % Std Dev (Range: 8 to 35)")}
                {editableField("pr_std_dev", "ba_avg_exit_velocity_std_dev", "Average Exit Velocity Std Dev (Range: 59.3 to 103.5)")}
                {editableField("pr_std_dev", "ba_pop_up_pct_std_dev", "Pop-Up % Std Dev (Range: 20.8 to 0)")}
              </div>
              <div className="rounded-md border bg-background/70 p-3 space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide font-semibold text-foreground">On Base %</p>
                {editableField("pr_std_dev", "obp_contact_pct_std_dev", "Contact % Std Dev (Range: 54 to 95)")}
                {editableField("pr_std_dev", "obp_line_drive_pct_std_dev", "Line Drive % Std Dev (Range: 8 to 35)")}
                {editableField("pr_std_dev", "obp_avg_exit_velocity_std_dev", "Average Exit Velocity Std Dev (Range: 59.3 to 103.5)")}
                {editableField("pr_std_dev", "obp_pop_up_pct_std_dev", "Pop-Up % Std Dev (Range: 20.8 to 0)")}
                {editableField("pr_std_dev", "obp_walk_pct_std_dev", "BB% Std Dev (Range: 2.5 to 26)")}
                {editableField("pr_std_dev", "obp_chase_pct_std_dev", "Chase % Std Dev (Range: 43.7 to 79)")}
              </div>
              <div className="rounded-md border bg-background/70 p-3 space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide font-semibold text-foreground">Isolated Power</p>
                {editableField("pr_std_dev", "iso_barrel_pct_std_dev", "Barrel % Std Dev (Range: 0 to 50)")}
                {editableField("pr_std_dev", "iso_ev90_std_dev", "EV90 Std Dev (Range: 75.1 to 115.9)")}
                {editableField("pr_std_dev", "iso_pull_pct_std_dev", "Pull % Std Dev (Range: 0 to 72)")}
                {editableField("pr_std_dev", "iso_la_10_30_std_dev", "LA10-30 % Std Dev (Range: 0 to 72.7)")}
                {editableField("pr_std_dev", "iso_gb_pct_std_dev", "GB % Std Dev (Range: 69.7 to 18.8)")}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">NCAA Averages (Power Ratings Inputs)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Note: These NCAA averages are temporary manual admin inputs and should be pulled automatically from a data source like TruMedia.
          </p>
          <div className={sectionPanelClass}>
            {editableSectionHeader("pr_ncaa_averages")}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-md border bg-background/70 p-3 space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide font-semibold text-foreground">Batting Average</p>
                {editableField("pr_ncaa_averages", "ba_ncaa_contact_pct", "NCAA Average Contact % (%)")}
                {editableField("pr_ncaa_averages", "ba_ncaa_line_drive_pct", "NCAA Average Line Drive % (%)")}
                {editableField("pr_ncaa_averages", "ba_ncaa_avg_exit_velocity", "NCAA Average Exit Velocity")}
                {editableField("pr_ncaa_averages", "ba_ncaa_pop_up_pct", "NCAA Average Pop-Up % (%)")}
              </div>
              <div className="rounded-md border bg-background/70 p-3 space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide font-semibold text-foreground">On Base %</p>
                {editableField("pr_ncaa_averages", "obp_ncaa_contact_pct", "NCAA Average Contact % (%)")}
                {editableField("pr_ncaa_averages", "obp_ncaa_line_drive_pct", "NCAA Average Line Drive % (%)")}
                {editableField("pr_ncaa_averages", "obp_ncaa_avg_exit_velocity", "NCAA Average Exit Velocity")}
                {editableField("pr_ncaa_averages", "obp_ncaa_pop_up_pct", "NCAA Average Pop-Up % (%)")}
                {editableField("pr_ncaa_averages", "obp_ncaa_walk_pct", "NCAA Average BB%")}
                {editableField("pr_ncaa_averages", "obp_ncaa_chase_pct", "NCAA Average Chase % (%)")}
              </div>
              <div className="rounded-md border bg-background/70 p-3 space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide font-semibold text-foreground">Isolated Power</p>
                {editableField("pr_ncaa_averages", "iso_ncaa_barrel_pct", "NCAA Average Barrel %")}
                {editableField("pr_ncaa_averages", "iso_ncaa_ev90", "NCAA Average EV90")}
                {editableField("pr_ncaa_averages", "iso_ncaa_pull_pct", "NCAA Average Pull %")}
                {editableField("pr_ncaa_averages", "iso_ncaa_la_10_30", "NCAA Average LA10-30")}
                {editableField("pr_ncaa_averages", "iso_ncaa_gb_pct", "NCAA Average GB %")}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PitchingPowerRatingsTab() {
  const PITCHING_MODEL_TYPE = "admin_ui";
  const PITCHING_SEASON = 2026;
  const [editableSections, setEditableSections] = useState<Record<string, boolean>>({});
  const defaultValues: Record<string, string> = {
    p_era_ncaa_avg_power_rating: "50",
    p_ncaa_avg_whip_power_rating: "50",
    p_ncaa_avg_k9_power_rating: "50",
    p_ncaa_avg_bb9_power_rating: "50",
    p_ncaa_avg_hr9_power_rating: "50",
    p_era_stuff_plus_weight: "0.21",
    p_era_whiff_pct_weight: "0.23",
    p_era_bb_pct_weight: "0.17",
    p_era_hh_pct_weight: "0.07",
    p_era_in_zone_whiff_pct_weight: "0.12",
    p_era_chase_pct_weight: "0.08",
    p_era_barrel_pct_weight: "0.12",
    p_fip_hr9_power_rating_plus_weight: "0.45",
    p_fip_bb9_power_rating_plus_weight: "0.30",
    p_fip_k9_power_rating_plus_weight: "0.25",
    p_whip_bb_pct_weight: "0.25",
    p_whip_ld_pct_weight: "0.20",
    p_whip_avg_ev_weight: "0.15",
    p_whip_whiff_pct_weight: "0.25",
    p_whip_gb_pct_weight: "0.10",
    p_whip_chase_pct_weight: "0.05",
    p_k9_whiff_pct_weight: "0.35",
    p_k9_stuff_plus_weight: "0.30",
    p_k9_in_zone_whiff_pct_weight: "0.25",
    p_k9_chase_pct_weight: "0.10",
    p_bb9_bb_pct_weight: "0.55",
    p_bb9_in_zone_pct_weight: "0.30",
    p_bb9_chase_pct_weight: "0.15",
    p_hr9_barrel_pct_weight: "0.32",
    p_hr9_ev90_weight: "0.24",
    p_hr9_gb_pct_weight: "0.18",
    p_hr9_pull_pct_weight: "0.14",
    p_hr9_la_10_30_pct_weight: "0.12",
    p_ncaa_avg_stuff_plus: "100",
    p_ncaa_avg_whiff_pct: "22.9",
    p_ncaa_avg_bb_pct: "11.3",
    p_ncaa_avg_hh_pct: "36.0",
    p_ncaa_avg_in_zone_whiff_pct: "16.4",
    p_ncaa_avg_chase_pct: "23.1",
    p_ncaa_avg_barrel_pct: "17.3",
    p_ncaa_avg_ld_pct: "20.9",
    p_ncaa_avg_avg_ev: "86.2",
    p_ncaa_avg_gb_pct: "43.2",
    p_ncaa_avg_in_zone_pct: "47.2",
    p_ncaa_avg_ev90: "103.1",
    p_ncaa_avg_pull_pct: "36.5",
    p_ncaa_avg_la_10_30_pct: "29.0",
    p_sd_stuff_plus: "3.967566764",
    p_sd_whiff_pct: "5.476169924",
    p_sd_bb_pct: "2.92040411",
    p_sd_hh_pct: "6.474203457",
    p_sd_in_zone_whiff_pct: "4.299203457",
    p_sd_chase_pct: "4.619392309",
    p_sd_barrel_pct: "4.988140199",
    p_sd_ld_pct: "3.580670928",
    p_sd_avg_ev: "2.362900608",
    p_sd_gb_pct: "6.958760046",
    p_sd_in_zone_pct: "3.325412065",
    p_sd_ev90: "1.767350585",
    p_sd_pull_pct: "5.356686254",
    p_sd_la_10_30_pct: "5.773803471",
  };
  const [editableValues, setEditableValues] = useState<Record<string, string>>(defaultValues);

  const remoteHydratedRef = useRef(false);
  const lastPersistedRef = useRef<Record<string, string> | null>(null);

  // Read from Supabase model_config (authority)
  const { data: pitchingConfigRows = [] } = useQuery({
    queryKey: ["model_config_pitching"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("model_config")
        .select("config_key, config_value")
        .eq("model_type", PITCHING_MODEL_TYPE)
        .eq("season", PITCHING_SEASON);
      if (error) throw error;
      return (data || []).filter((r: any) => r.config_key?.startsWith("p_"));
    },
  });

  // Hydrate from Supabase on first load
  useEffect(() => {
    if (remoteHydratedRef.current) return;
    if (!pitchingConfigRows.length) {
      remoteHydratedRef.current = true;
      return;
    }
    setEditableValues((prev) => {
      const next = { ...prev };
      for (const row of pitchingConfigRows) {
        if (row.config_key) next[row.config_key] = String(row.config_value);
      }
      return next;
    });
    remoteHydratedRef.current = true;
  }, [pitchingConfigRows]);

  // Auto-persist changes back to Supabase
  useEffect(() => {
    if (!remoteHydratedRef.current) return;
    if (lastPersistedRef.current && JSON.stringify(lastPersistedRef.current) === JSON.stringify(editableValues)) return;

    const timeout = window.setTimeout(async () => {
      const rows = Object.entries(editableValues)
        .filter(([key]) => key.startsWith("p_"))
        .map(([config_key, raw]) => ({
          model_type: PITCHING_MODEL_TYPE,
          season: PITCHING_SEASON,
          config_key,
          config_value: Number(raw),
        }))
        .filter((r) => Number.isFinite(r.config_value));

      if (rows.length === 0) return;

      const { error } = await supabase
        .from("model_config")
        .upsert(rows, { onConflict: "model_type,season,config_key" });

      if (!error) {
        lastPersistedRef.current = editableValues;
      }
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [editableValues]);

  useEffect(() => {
    // Locked constant: keep WHIP Chase% weight fixed at 5%.
    if (editableValues.p_whip_chase_pct_weight !== "0.05") {
      setEditableValues((prev) => ({ ...prev, p_whip_chase_pct_weight: "0.05" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setEditable = (key: string, value: string) => {
    if (key === "p_whip_chase_pct_weight") return;
    setEditableValues((prev) => ({ ...prev, [key]: value }));
  };
  const sectionHeadingClass = "text-[11px] uppercase tracking-wide font-semibold text-foreground";
  const sectionPanelClass = "rounded-md border bg-background/60 p-3 space-y-2";
  const editableSectionHeader = (sectionKey: string, title = "Editable (Admin UI)") => {
    const isEditable = !!editableSections[sectionKey];
    return (
      <div className="flex items-center justify-between">
        <p className={sectionHeadingClass}>{title}</p>
        <Button
          type="button"
          size="sm"
          variant={isEditable ? "secondary" : "outline"}
          className="h-6 px-2 text-[10px]"
          onClick={() => setEditableSections((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }))}
        >
          {isEditable ? "Done" : "Edit"}
        </Button>
      </div>
    );
  };
  const editableField = (sectionKey: string, key: string, label: string) => {
    const isSectionEditable = !!editableSections[sectionKey];
    return (
      <div className="flex items-center justify-between gap-3">
        <span>{label}</span>
        <Input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={editableValues[key] ?? ""}
          onChange={(e) => setEditable(key, e.target.value)}
          readOnly={!isSectionEditable}
          className="h-7 w-32 px-2 text-left font-mono text-xs read-only:cursor-default read-only:caret-transparent read-only:opacity-70"
        />
      </div>
    );
  };
  const toNumber = (value: string | undefined, fallback: number) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  const eraStuffWeight = toNumber(editableValues.p_era_stuff_plus_weight, 0.21);
  const eraWhiffWeight = toNumber(editableValues.p_era_whiff_pct_weight, 0.23);
  const eraBBWeight = toNumber(editableValues.p_era_bb_pct_weight, 0.17);
  const eraHHWeight = toNumber(editableValues.p_era_hh_pct_weight, 0.07);
  const eraInZoneWhiffWeight = toNumber(editableValues.p_era_in_zone_whiff_pct_weight, 0.12);
  const eraChaseWeight = toNumber(editableValues.p_era_chase_pct_weight, 0.08);
  const eraBarrelWeight = toNumber(editableValues.p_era_barrel_pct_weight, 0.12);
  const fipHr9Weight = toNumber(editableValues.p_fip_hr9_power_rating_plus_weight, 0.45);
  const fipBb9Weight = toNumber(editableValues.p_fip_bb9_power_rating_plus_weight, 0.30);
  const fipK9Weight = toNumber(editableValues.p_fip_k9_power_rating_plus_weight, 0.25);
  const whipBbWeight = toNumber(editableValues.p_whip_bb_pct_weight, 0.25);
  const whipLdWeight = toNumber(editableValues.p_whip_ld_pct_weight, 0.20);
  const whipAvgEvWeight = toNumber(editableValues.p_whip_avg_ev_weight, 0.15);
  const whipWhiffWeight = toNumber(editableValues.p_whip_whiff_pct_weight, 0.25);
  const whipGbWeight = toNumber(editableValues.p_whip_gb_pct_weight, 0.10);
  const whipChaseWeight = 0.05;
  const k9WhiffWeight = toNumber(editableValues.p_k9_whiff_pct_weight, 0.35);
  const k9StuffWeight = toNumber(editableValues.p_k9_stuff_plus_weight, 0.30);
  const k9InZoneWhiffWeight = toNumber(editableValues.p_k9_in_zone_whiff_pct_weight, 0.25);
  const k9ChaseWeight = toNumber(editableValues.p_k9_chase_pct_weight, 0.10);
  const bb9BbWeight = toNumber(editableValues.p_bb9_bb_pct_weight, 0.55);
  const bb9InZoneWeight = toNumber(editableValues.p_bb9_in_zone_pct_weight, 0.30);
  const bb9ChaseWeight = toNumber(editableValues.p_bb9_chase_pct_weight, 0.15);
  const hr9BarrelWeight = toNumber(editableValues.p_hr9_barrel_pct_weight, 0.32);
  const hr9Ev90Weight = toNumber(editableValues.p_hr9_ev90_weight, 0.24);
  const hr9GbWeight = toNumber(editableValues.p_hr9_gb_pct_weight, 0.18);
  const hr9PullWeight = toNumber(editableValues.p_hr9_pull_pct_weight, 0.14);
  const hr9LaWeight = toNumber(editableValues.p_hr9_la_10_30_pct_weight, 0.12);
  const eraPowerRatingAvg = toNumber(editableValues.p_era_ncaa_avg_power_rating, 50);
  const whipPowerRatingAvg = toNumber(editableValues.p_ncaa_avg_whip_power_rating, 50);
  const k9PowerRatingAvg = toNumber(editableValues.p_ncaa_avg_k9_power_rating, 50);
  const bb9PowerRatingAvg = toNumber(editableValues.p_ncaa_avg_bb9_power_rating, 50);
  const hr9PowerRatingAvg = toNumber(editableValues.p_ncaa_avg_hr9_power_rating, 50);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Pitching Power Rating Equations</h3>
        <p className="text-sm text-muted-foreground">Pitching-side buildout scaffold matching the hitting equation structure.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">ERA Power Rating</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted p-4 rounded-lg font-mono text-sm overflow-hidden cursor-default select-none">
            <div className="whitespace-nowrap text-[13px] leading-tight">
              <span className="text-muted-foreground">ERA Power Rating =</span>{" "}
              ({eraStuffWeight.toFixed(2)} * Stuff+Score) + ({eraWhiffWeight.toFixed(2)} * Whiff%Score) + ({eraBBWeight.toFixed(2)} * BB%Score) + ({eraHHWeight.toFixed(2)} * HardHit%Score) + ({eraInZoneWhiffWeight.toFixed(2)} * InZoneWhiff%Score) + ({eraChaseWeight.toFixed(2)} * Chase%Score) + ({eraBarrelWeight.toFixed(2)} * Barrel%Score)
            </div>
            <div className="mt-2">
              <span className="text-muted-foreground">ERA Power Rating+ =</span>{" "}
              (ERA Power Rating / NCAA Average ERA Power Rating ({eraPowerRatingAvg.toFixed(0)})) * 100
            </div>
          </div>
          <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>Player-Specific Metrics</p>
              <div className="ml-2 space-y-0.5">
                <div>• Stuff+</div>
                <div>• Whiff%</div>
                <div>• BB%</div>
                <div>• HardHit%</div>
                <div>• InZoneWhiff%</div>
                <div>• Chase%</div>
                <div>• Barrel%</div>
              </div>
            </div>
            <div className={sectionPanelClass}>
              {editableSectionHeader("p_pr_era")}
              <div className="space-y-1.5">
                {editableField("p_pr_era", "p_era_ncaa_avg_power_rating", "NCAA Average ERA Power Rating")}
                {editableField("p_pr_era", "p_era_stuff_plus_weight", "Stuff+ Weight")}
                {editableField("p_pr_era", "p_era_whiff_pct_weight", "Whiff% Weight")}
                {editableField("p_pr_era", "p_era_bb_pct_weight", "BB% Weight")}
                {editableField("p_pr_era", "p_era_hh_pct_weight", "HardHit% Weight")}
                {editableField("p_pr_era", "p_era_in_zone_whiff_pct_weight", "InZoneWhiff% Weight")}
                {editableField("p_pr_era", "p_era_chase_pct_weight", "Chase% Weight")}
                {editableField("p_pr_era", "p_era_barrel_pct_weight", "Barrel% Weight")}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">FIP Power Rating+</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted p-4 rounded-lg font-mono text-sm overflow-hidden cursor-default select-none">
            <div className="whitespace-nowrap text-[13px] leading-tight">
              <span className="text-muted-foreground">FIP Power Rating+ =</span>{" "}
              ({fipHr9Weight.toFixed(2)} * HR/9 Power Rating+) + ({fipBb9Weight.toFixed(2)} * BB/9 Power Rating+) + ({fipK9Weight.toFixed(2)} * K/9 Power Rating+)
            </div>
          </div>
          <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>Player-Specific Metrics</p>
              <div className="ml-2 space-y-0.5">
                <div>• HR/9 Power Rating+</div>
                <div>• BB/9 Power Rating+</div>
                <div>• K/9 Power Rating+</div>
                <div>• No score equations needed (derived from existing power ratings).</div>
              </div>
            </div>
            <div className={sectionPanelClass}>
              {editableSectionHeader("p_pr_fip")}
              <div className="space-y-1.5">
                {editableField("p_pr_fip", "p_fip_hr9_power_rating_plus_weight", "HR/9 Power Rating+ Weight")}
                {editableField("p_pr_fip", "p_fip_bb9_power_rating_plus_weight", "BB/9 Power Rating+ Weight")}
                {editableField("p_pr_fip", "p_fip_k9_power_rating_plus_weight", "K/9 Power Rating+ Weight")}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">WHIP Power Rating</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted p-4 rounded-lg font-mono text-sm overflow-hidden cursor-default select-none">
            <div className="whitespace-nowrap text-[13px] leading-tight">
              <span className="text-muted-foreground">WHIP Power Rating =</span>{" "}
              ({whipBbWeight.toFixed(2)} * BB%Score) + ({whipLdWeight.toFixed(2)} * LineDrive%Score) + ({whipAvgEvWeight.toFixed(2)} * AvgEVScore) + ({whipWhiffWeight.toFixed(2)} * Whiff%Score) + ({whipGbWeight.toFixed(2)} * GB%Score) + ({whipChaseWeight.toFixed(2)} * Chase%Score)
            </div>
            <div className="mt-2">
              <span className="text-muted-foreground">WHIP Power Rating+ =</span>{" "}
              (WHIP Power Rating / NCAA Avg. WHIP Power Rating ({whipPowerRatingAvg.toFixed(0)})) * 100
            </div>
          </div>
          <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>Player-Specific Metrics</p>
              <div className="ml-2 space-y-0.5">
                <div>• BB%</div>
                <div>• LineDrive%</div>
                <div>• AvgEV</div>
                <div>• Whiff%</div>
                <div>• GB%</div>
                <div>• Chase%</div>
              </div>
            </div>
            <div className={sectionPanelClass}>
              {editableSectionHeader("p_pr_whip")}
              <div className="space-y-1.5">
                {editableField("p_pr_whip", "p_ncaa_avg_whip_power_rating", "NCAA Average WHIP Power Rating")}
                {editableField("p_pr_whip", "p_whip_bb_pct_weight", "BB% Weight")}
                {editableField("p_pr_whip", "p_whip_ld_pct_weight", "LineDrive% Weight")}
                {editableField("p_pr_whip", "p_whip_avg_ev_weight", "AvgEV Weight")}
                {editableField("p_pr_whip", "p_whip_whiff_pct_weight", "Whiff% Weight")}
                {editableField("p_pr_whip", "p_whip_gb_pct_weight", "GB% Weight")}
                <div className="flex items-center justify-between gap-2">
                  <p className="text-muted-foreground">Chase% Weight (Locked)</p>
                  <Input
                    value="0.05"
                    readOnly
                    className="h-7 w-32 px-2 text-left font-mono text-xs cursor-default caret-transparent opacity-70"
                  />
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">K/9 Power Rating</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted p-4 rounded-lg font-mono text-sm overflow-hidden cursor-default select-none">
            <div className="whitespace-nowrap text-[13px] leading-tight">
              <span className="text-muted-foreground">K/9 Power Rating =</span>{" "}
              ({k9WhiffWeight.toFixed(2)} * Whiff%Score) + ({k9StuffWeight.toFixed(2)} * Stuff+Score) + ({k9InZoneWhiffWeight.toFixed(2)} * InZoneWhiff%Score) + ({k9ChaseWeight.toFixed(2)} * Chase%Score)
            </div>
            <div className="mt-2">
              <span className="text-muted-foreground">K/9 Power Rating+ =</span>{" "}
              (K/9 Power Rating / NCAA Average K/9 Power Rating ({k9PowerRatingAvg.toFixed(0)})) * 100
            </div>
          </div>
          <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>Player-Specific Metrics</p>
              <div className="ml-2 space-y-0.5">
                <div>• Whiff%</div>
                <div>• Stuff+</div>
                <div>• InZoneWhiff%</div>
                <div>• Chase%</div>
              </div>
            </div>
            <div className={sectionPanelClass}>
              {editableSectionHeader("p_pr_k9")}
              <div className="space-y-1.5">
                {editableField("p_pr_k9", "p_ncaa_avg_k9_power_rating", "NCAA Average K/9 Power Rating")}
                {editableField("p_pr_k9", "p_k9_whiff_pct_weight", "Whiff% Weight")}
                {editableField("p_pr_k9", "p_k9_stuff_plus_weight", "Stuff+ Weight")}
                {editableField("p_pr_k9", "p_k9_in_zone_whiff_pct_weight", "InZoneWhiff% Weight")}
                {editableField("p_pr_k9", "p_k9_chase_pct_weight", "Chase% Weight")}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">BB/9 Power Rating</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted p-4 rounded-lg font-mono text-sm overflow-hidden cursor-default select-none">
            <div className="whitespace-nowrap text-[13px] leading-tight">
              <span className="text-muted-foreground">BB/9 Power Rating =</span>{" "}
              ({bb9BbWeight.toFixed(2)} * BB%Score) + ({bb9InZoneWeight.toFixed(2)} * In Zone%Score) + ({bb9ChaseWeight.toFixed(2)} * Chase%Score)
            </div>
            <div className="mt-2">
              <span className="text-muted-foreground">BB/9 Power Rating+ =</span>{" "}
              (BB/9 Power Rating / NCAA Average BB/9 PR ({bb9PowerRatingAvg.toFixed(0)})) * 100
            </div>
          </div>
          <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>Player-Specific Metrics</p>
              <div className="ml-2 space-y-0.5">
                <div>• BB%</div>
                <div>• In Zone%</div>
                <div>• Chase%</div>
              </div>
            </div>
            <div className={sectionPanelClass}>
              {editableSectionHeader("p_pr_bb9")}
              <div className="space-y-1.5">
                {editableField("p_pr_bb9", "p_ncaa_avg_bb9_power_rating", "NCAA Average BB/9 Power Rating")}
                {editableField("p_pr_bb9", "p_bb9_bb_pct_weight", "BB% Weight")}
                {editableField("p_pr_bb9", "p_bb9_in_zone_pct_weight", "In Zone% Weight")}
                {editableField("p_pr_bb9", "p_bb9_chase_pct_weight", "Chase% Weight")}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">HR/9 Power Rating</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted p-4 rounded-lg font-mono text-sm overflow-hidden cursor-default select-none">
            <div className="whitespace-nowrap text-[13px] leading-tight">
              <span className="text-muted-foreground">HR/9 Power Rating =</span>{" "}
              ({hr9BarrelWeight.toFixed(2)} * Barrel%Score) + ({hr9Ev90Weight.toFixed(2)} * EV90Score) + ({hr9GbWeight.toFixed(2)} * GB%Score) + ({hr9PullWeight.toFixed(2)} * Pull%Score) + ({hr9LaWeight.toFixed(2)} * LA 10-30%Score)
            </div>
            <div className="mt-2">
              <span className="text-muted-foreground">HR/9 Power Rating+ =</span>{" "}
              (HR/9 Power Rating / NCAA Avg HR/9 Power Rating ({hr9PowerRatingAvg.toFixed(0)})) * 100
            </div>
          </div>
          <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>Player-Specific Metrics</p>
              <div className="ml-2 space-y-0.5">
                <div>• Barrel%</div>
                <div>• EV90</div>
                <div>• GB%</div>
                <div>• Pull%</div>
                <div>• LA 10-30%</div>
              </div>
            </div>
            <div className={sectionPanelClass}>
              {editableSectionHeader("p_pr_hr9")}
              <div className="space-y-1.5">
                {editableField("p_pr_hr9", "p_ncaa_avg_hr9_power_rating", "NCAA Average HR/9 Power Rating")}
                {editableField("p_pr_hr9", "p_hr9_barrel_pct_weight", "Barrel% Weight")}
                {editableField("p_pr_hr9", "p_hr9_ev90_weight", "EV90 Weight")}
                {editableField("p_pr_hr9", "p_hr9_gb_pct_weight", "GB% Weight")}
                {editableField("p_pr_hr9", "p_hr9_pull_pct_weight", "Pull% Weight")}
                {editableField("p_pr_hr9", "p_hr9_la_10_30_pct_weight", "LA 10-30% Weight")}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Score Equations Reference</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-2 xl:grid-cols-3">
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>ERA Power Rating Scores</p>
              <div className="space-y-2 font-mono leading-relaxed">
                <div className="rounded bg-background/70 px-2 py-1 break-words">Stuff+ Score = NORM.DIST(Stuff+, NCAAAvgStuff+, Stuff+StdDev, TRUE) × 100</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">Whiff% Score = NORM.DIST(Whiff%, NCAAAvgWhiff%, Whiff%StdDev, TRUE) × 100</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">BB% Score = 100 - (NORM.DIST(BB%, NCAAAvgBB%, BB%StdDev, TRUE) × 100)</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">HH% Score = 100 - (NORM.DIST(HH%, NCAAAvgHH%, HH%StdDev, TRUE) × 100)</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">In Zone Whiff Score = NORM.DIST(InZoneWhiff%, NCAAAvgInZoneWhiff%, InZoneWhiff%StdDev, TRUE) × 100</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">Chase% Score = NORM.DIST(Chase%, NCAAAvgChase%, Chase%StdDev, TRUE) × 100</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">Barrel% Score = 100 - (NORM.DIST(Barrel%, NCAAAvgBarrel%, Barrel%StdDev, TRUE) × 100)</div>
              </div>
            </div>
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>WHIP Power Rating Scores</p>
              <div className="space-y-2 font-mono leading-relaxed">
                <div className="rounded bg-background/70 px-2 py-1 break-words">BB% Score = 100 - (NORM.DIST(BB%, NCAAAvgBB%, BB%StdDev, TRUE) × 100)</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">LineDrive% Score = 100 - (NORM.DIST(LineDrive%, NCAAAvgLineDrive%, LineDrive%StdDev, TRUE) × 100)</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">AvgEV Score = 100 - (NORM.DIST(AvgEV, NCAAAvgAvgEV, AvgEVStdDev, TRUE) × 100)</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">Whiff% Score = NORM.DIST(Whiff%, NCAAAvgWhiff%, Whiff%StdDev, TRUE) × 100</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">GB% Score = NORM.DIST(GB%, NCAAAvgGB%, GB%StdDev, TRUE) × 100</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">Chase% Score = NORM.DIST(Chase%, NCAAAvgChase%, Chase%StdDev, TRUE) × 100</div>
              </div>
            </div>
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>K/9 Power Rating Scores</p>
              <div className="space-y-2 font-mono leading-relaxed">
                <div className="rounded bg-background/70 px-2 py-1 break-words">Whiff% Score = NORM.DIST(Whiff%, NCAAAvgWhiff%, Whiff%StdDev, TRUE) × 100</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">Stuff+ Score = NORM.DIST(Stuff+, NCAAAvgStuff+, Stuff+StdDev, TRUE) × 100</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">InZoneWhiff% Score = NORM.DIST(InZoneWhiff%, NCAAAvgInZoneWhiff%, InZoneWhiff%StdDev, TRUE) × 100</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">Chase% Score = NORM.DIST(Chase%, NCAAAvgChase%, Chase%StdDev, TRUE) × 100</div>
              </div>
            </div>
          </div>
          <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-2 xl:max-w-[66%] xl:mx-auto">
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>BB/9 Power Rating Scores</p>
              <div className="space-y-2 font-mono leading-relaxed">
                <div className="rounded bg-background/70 px-2 py-1 break-words">BB% Score = 100 - (NORM.DIST(BB%, NCAAAvgBB%, BB%StdDev, TRUE) × 100)</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">In Zone% Score = NORM.DIST(InZone%, NCAAAvgInZone%, InZone%StdDev, TRUE) × 100</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">Chase% Score = NORM.DIST(Chase%, NCAAAvgChase%, Chase%StdDev, TRUE) × 100</div>
              </div>
            </div>
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>HR/9 Power Rating Scores</p>
              <div className="space-y-2 font-mono leading-relaxed">
                <div className="rounded bg-background/70 px-2 py-1 break-words">Barrel% Score = 100 - (NORM.DIST(Barrel%, NCAAAvgBarrel%, Barrel%StdDev, TRUE) × 100)</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">EV90 Score = NORM.DIST(EV90, NCAAAvgEV90, EV90StdDev, TRUE) × 100</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">GB% Score = NORM.DIST(GB%, NCAAAvgGB%, GB%StdDev, TRUE) × 100</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">Pull% Score = 100 - (NORM.DIST(Pull%, NCAAAvgPull%, Pull%StdDev, TRUE) × 100)</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">LA 10-30% Score = NORM.DIST(LA10-30%, NCAAAvgLA10-30%, LA10-30%StdDev, TRUE) × 100</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Power Rating Specific Standard Deviations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Editable player-metric standard deviations used in each pitching power rating.
          </p>
          <div className={sectionPanelClass}>
            {editableSectionHeader("p_pr_rating_std_dev", "Standard Deviations (Editable, System-Wide)")}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-md border bg-background/70 p-3 space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide font-semibold text-foreground">ERA Power Rating</p>
                {editableField("p_pr_rating_std_dev", "p_sd_stuff_plus", "Stuff+ Std Dev")}
                {editableField("p_pr_rating_std_dev", "p_sd_whiff_pct", "Whiff% Std Dev")}
                {editableField("p_pr_rating_std_dev", "p_sd_bb_pct", "BB% Std Dev")}
                {editableField("p_pr_rating_std_dev", "p_sd_hh_pct", "HardHit% Std Dev")}
                {editableField("p_pr_rating_std_dev", "p_sd_in_zone_whiff_pct", "InZoneWhiff% Std Dev")}
                {editableField("p_pr_rating_std_dev", "p_sd_chase_pct", "Chase% Std Dev")}
                {editableField("p_pr_rating_std_dev", "p_sd_barrel_pct", "Barrel% Std Dev")}
              </div>
              <div className="rounded-md border bg-background/70 p-3 space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide font-semibold text-foreground">WHIP Power Rating</p>
                {editableField("p_pr_rating_std_dev", "p_sd_bb_pct", "BB% Std Dev")}
                {editableField("p_pr_rating_std_dev", "p_sd_ld_pct", "LineDrive% Std Dev")}
                {editableField("p_pr_rating_std_dev", "p_sd_avg_ev", "AvgEV Std Dev")}
                {editableField("p_pr_rating_std_dev", "p_sd_whiff_pct", "Whiff% Std Dev")}
                {editableField("p_pr_rating_std_dev", "p_sd_gb_pct", "GB% Std Dev")}
                {editableField("p_pr_rating_std_dev", "p_sd_chase_pct", "Chase% Std Dev")}
              </div>
              <div className="rounded-md border bg-background/70 p-3 space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide font-semibold text-foreground">K/9 Power Rating</p>
                {editableField("p_pr_rating_std_dev", "p_sd_whiff_pct", "Whiff% Std Dev")}
                {editableField("p_pr_rating_std_dev", "p_sd_stuff_plus", "Stuff+ Std Dev")}
                {editableField("p_pr_rating_std_dev", "p_sd_in_zone_whiff_pct", "InZoneWhiff% Std Dev")}
                {editableField("p_pr_rating_std_dev", "p_sd_chase_pct", "Chase% Std Dev")}
              </div>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:max-w-[66%] xl:mx-auto">
              <div className="rounded-md border bg-background/70 p-3 space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide font-semibold text-foreground">BB/9 Power Rating</p>
                {editableField("p_pr_rating_std_dev", "p_sd_bb_pct", "BB% Std Dev")}
                {editableField("p_pr_rating_std_dev", "p_sd_in_zone_pct", "InZone% Std Dev")}
                {editableField("p_pr_rating_std_dev", "p_sd_chase_pct", "Chase% Std Dev")}
              </div>
              <div className="rounded-md border bg-background/70 p-3 space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide font-semibold text-foreground">HR/9 Power Rating</p>
                {editableField("p_pr_rating_std_dev", "p_sd_barrel_pct", "Barrel% Std Dev")}
                {editableField("p_pr_rating_std_dev", "p_sd_ev90", "EV90 Std Dev")}
                {editableField("p_pr_rating_std_dev", "p_sd_gb_pct", "GB% Std Dev")}
                {editableField("p_pr_rating_std_dev", "p_sd_pull_pct", "Pull% Std Dev")}
                {editableField("p_pr_rating_std_dev", "p_sd_la_10_30_pct", "LA 10-30% Std Dev")}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Power Rating Specific NCAA Averages</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Editable player-metric NCAA averages used in each pitching power rating.
          </p>
          <div className={sectionPanelClass}>
            {editableSectionHeader("p_pr_rating_ncaa_avg", "NCAA Averages (Editable, System-Wide)")}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-md border bg-background/70 p-3 space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide font-semibold text-foreground">ERA Power Rating</p>
                {editableField("p_pr_rating_ncaa_avg", "p_ncaa_avg_stuff_plus", "NCAA Average Stuff+")}
                {editableField("p_pr_rating_ncaa_avg", "p_ncaa_avg_whiff_pct", "NCAA Average Whiff%")}
                {editableField("p_pr_rating_ncaa_avg", "p_ncaa_avg_bb_pct", "NCAA Average BB%")}
                {editableField("p_pr_rating_ncaa_avg", "p_ncaa_avg_hh_pct", "NCAA Average HardHit%")}
                {editableField("p_pr_rating_ncaa_avg", "p_ncaa_avg_in_zone_whiff_pct", "NCAA Average InZoneWhiff%")}
                {editableField("p_pr_rating_ncaa_avg", "p_ncaa_avg_chase_pct", "NCAA Average Chase%")}
                {editableField("p_pr_rating_ncaa_avg", "p_ncaa_avg_barrel_pct", "NCAA Average Barrel%")}
              </div>
              <div className="rounded-md border bg-background/70 p-3 space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide font-semibold text-foreground">WHIP Power Rating</p>
                {editableField("p_pr_rating_ncaa_avg", "p_ncaa_avg_bb_pct", "NCAA Average BB%")}
                {editableField("p_pr_rating_ncaa_avg", "p_ncaa_avg_ld_pct", "NCAA Average LineDrive%")}
                {editableField("p_pr_rating_ncaa_avg", "p_ncaa_avg_avg_ev", "NCAA Average AvgEV")}
                {editableField("p_pr_rating_ncaa_avg", "p_ncaa_avg_whiff_pct", "NCAA Average Whiff%")}
                {editableField("p_pr_rating_ncaa_avg", "p_ncaa_avg_gb_pct", "NCAA Average GB%")}
                {editableField("p_pr_rating_ncaa_avg", "p_ncaa_avg_chase_pct", "NCAA Average Chase%")}
              </div>
              <div className="rounded-md border bg-background/70 p-3 space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide font-semibold text-foreground">K/9 Power Rating</p>
                {editableField("p_pr_rating_ncaa_avg", "p_ncaa_avg_whiff_pct", "NCAA Average Whiff%")}
                {editableField("p_pr_rating_ncaa_avg", "p_ncaa_avg_stuff_plus", "NCAA Average Stuff+")}
                {editableField("p_pr_rating_ncaa_avg", "p_ncaa_avg_in_zone_whiff_pct", "NCAA Average InZoneWhiff%")}
                {editableField("p_pr_rating_ncaa_avg", "p_ncaa_avg_chase_pct", "NCAA Average Chase%")}
              </div>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:max-w-[66%] xl:mx-auto">
              <div className="rounded-md border bg-background/70 p-3 space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide font-semibold text-foreground">BB/9 Power Rating</p>
                {editableField("p_pr_rating_ncaa_avg", "p_ncaa_avg_bb_pct", "NCAA Average BB%")}
                {editableField("p_pr_rating_ncaa_avg", "p_ncaa_avg_in_zone_pct", "NCAA Average InZone%")}
                {editableField("p_pr_rating_ncaa_avg", "p_ncaa_avg_chase_pct", "NCAA Average Chase%")}
              </div>
              <div className="rounded-md border bg-background/70 p-3 space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide font-semibold text-foreground">HR/9 Power Rating</p>
                {editableField("p_pr_rating_ncaa_avg", "p_ncaa_avg_barrel_pct", "NCAA Average Barrel%")}
                {editableField("p_pr_rating_ncaa_avg", "p_ncaa_avg_ev90", "NCAA Average EV90")}
                {editableField("p_pr_rating_ncaa_avg", "p_ncaa_avg_gb_pct", "NCAA Average GB%")}
                {editableField("p_pr_rating_ncaa_avg", "p_ncaa_avg_pull_pct", "NCAA Average Pull%")}
                {editableField("p_pr_rating_ncaa_avg", "p_ncaa_avg_la_10_30_pct", "NCAA Average LA 10-30%")}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Dev Weights Tab ──────────────────────────────────────────────────────────

const POSITIONS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH", "UTIL", "RHP", "LHP"];
const CLASS_YEARS = ["FR", "SO", "JR", "SR", "Graduate"];
const STAT_CATEGORIES = ["overall", "batting_avg", "on_base_pct", "slugging_pct", "ops", "wrc_plus", "era", "whip"];

type DevWeight = {
  id: string;
  position: string;
  from_class: string;
  to_class: string;
  stat_category: string;
  weight: number;
  notes: string | null;
};

type WeightForm = {
  position: string;
  from_class: string;
  to_class: string;
  stat_category: string;
  weight: string;
  notes: string;
};

const emptyForm: WeightForm = { position: "", from_class: "", to_class: "", stat_category: "overall", weight: "1.000", notes: "" };
const CONFERENCES = [
  "ACC", "AAC", "A-10", "America East", "ASUN", "Big 12", "Big East",
  "Big South", "Big Ten", "Big West", "CAA", "CUSA", "Horizon League", "Ivy League",
  "MAAC", "MAC", "MEAC", "Mountain West", "MVC", "NEC", "OVC", "Pac-12",
  "Patriot League", "SEC", "SoCon", "Southland", "Summit League", "Sun Belt", "SWAC",
  "WAC", "WCC",
];

type TeamRow = {
  id: string;
  name: string;
  conference: string | null;
  park_factor: number | null;
};

function DevWeightsTab() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<WeightForm>(emptyForm);
  const [filterPosition, setFilterPosition] = useState<string>("all");

  const { data: weights = [], isLoading } = useQuery({
    queryKey: ["developmental_weights"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("developmental_weights")
        .select("*")
        .order("position")
        .order("from_class")
        .order("to_class");
      if (error) throw error;
      return data as DevWeight[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (formData: WeightForm) => {
      const payload = {
        position: formData.position,
        from_class: formData.from_class,
        to_class: formData.to_class,
        stat_category: formData.stat_category,
        weight: parseFloat(formData.weight),
        notes: formData.notes || null,
      };
      if (editingId) {
        const { error } = await supabase.from("developmental_weights").update(payload).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("developmental_weights").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["developmental_weights"] });
      toast.success(editingId ? "Weight updated" : "Weight added");
      closeDialog();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("developmental_weights").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["developmental_weights"] });
      toast.success("Weight deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const openEdit = (w: DevWeight) => {
    setEditingId(w.id);
    setForm({
      position: w.position,
      from_class: w.from_class,
      to_class: w.to_class,
      stat_category: w.stat_category,
      weight: w.weight.toString(),
      notes: w.notes || "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.position || !form.from_class || !form.to_class) {
      toast.error("Position and class transitions are required");
      return;
    }
    const w = parseFloat(form.weight);
    if (isNaN(w) || w < 0 || w > 5) {
      toast.error("Weight must be between 0 and 5");
      return;
    }
    saveMutation.mutate(form);
  };

  const filtered = filterPosition === "all" ? weights : weights.filter((w) => w.position === filterPosition);
  const uniquePositions = [...new Set(weights.map((w) => w.position))];

  if (isLoading) return <p className="text-muted-foreground py-8 text-center">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Developmental Weights</h3>
          <p className="text-sm text-muted-foreground">
            {weights.length} weights across {uniquePositions.length} positions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filterPosition} onValueChange={setFilterPosition}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Positions</SelectItem>
              {uniquePositions.map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="gap-1"
            onClick={() => { setEditingId(null); setForm(emptyForm); setDialogOpen(true); }}
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="text-center py-12">
              <Scale className="mx-auto h-10 w-10 text-muted-foreground/40" />
              <p className="mt-3 text-muted-foreground">No developmental weights configured.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Position</TableHead>
                    <TableHead>From → To</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Weight</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((w) => (
                    <TableRow key={w.id}>
                      <TableCell className="font-medium">{w.position}</TableCell>
                      <TableCell>{w.from_class} → {w.to_class}</TableCell>
                      <TableCell className="capitalize">{w.stat_category.replace(/_/g, " ")}</TableCell>
                      <TableCell className="text-right font-mono">
                        <span className={
                          Number(w.weight) > 1 ? "text-[hsl(var(--success))]"
                            : Number(w.weight) < 1 ? "text-destructive"
                            : "text-muted-foreground"
                        }>
                          {Number(w.weight).toFixed(3)}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-muted-foreground text-sm">{w.notes || "—"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(w)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteMutation.mutate(w.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(o) => (o ? setDialogOpen(true) : closeDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit" : "Add"} Developmental Weight</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Position</Label>
                <Select value={form.position} onValueChange={(v) => setForm({ ...form, position: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Stat Category</Label>
                <Select value={form.stat_category} onValueChange={(v) => setForm({ ...form, stat_category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STAT_CATEGORIES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>From Class</Label>
                <Select value={form.from_class} onValueChange={(v) => setForm({ ...form, from_class: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {CLASS_YEARS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>To Class</Label>
                <Select value={form.to_class} onValueChange={(v) => setForm({ ...form, to_class: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {CLASS_YEARS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Weight (0–5)</Label>
              <Input type="number" step="0.001" min="0" max="5" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} />
              <p className="text-xs text-muted-foreground">1.000 = no adjustment. &gt;1 = positive. &lt;1 = regression.</p>
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving…" : editingId ? "Update" : "Add"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── NIL Valuations Tab ───────────────────────────────────────────────────────

function NilValuationsTableTab() {
  const [search, setSearch] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["admin-nil-valuations-table"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nil_valuations")
        .select(`
          id,
          season,
          estimated_value,
          offensive_effectiveness,
          war,
          updated_at,
          players!inner(first_name, last_name, team, conference, position, class_year)
        `)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data || []).map((row: any) => ({
        id: row.id as string,
        season: row.season as number,
        playerName: `${row.players.first_name} ${row.players.last_name}`,
        team: row.players.team as string | null,
        conference: row.players.conference as string | null,
        position: row.players.position as string | null,
        classYear: row.players.class_year as string | null,
        estimatedValue: row.estimated_value as number | null,
        offensiveEffectiveness: row.offensive_effectiveness as number | null,
        war: row.war as number | null,
        updatedAt: row.updated_at as string,
      }));
    },
  });

  const filteredRows = rows.filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      r.playerName.toLowerCase().includes(q) ||
      (r.team || "").toLowerCase().includes(q) ||
      (r.conference || "").toLowerCase().includes(q)
    );
  });

  const fmtMoney = (v: number | null) =>
    v == null ? "—" : `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

  const fmtNum = (v: number | null, d = 2) => (v == null ? "—" : v.toFixed(d));

  if (isLoading) return <p className="text-muted-foreground py-8 text-center">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">NIL Valuations Table</h3>
          <p className="text-sm text-muted-foreground">{filteredRows.length} rows</p>
        </div>
        <Input
          placeholder="Search player/team/conference…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:w-72"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[620px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Player</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Conf</TableHead>
                  <TableHead>Pos</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Season</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Off Eff</TableHead>
                  <TableHead className="text-right">WAR</TableHead>
                  <TableHead className="text-right">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.length ? (
                  filteredRows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.playerName}</TableCell>
                      <TableCell>{r.team || "—"}</TableCell>
                      <TableCell>{r.conference || "—"}</TableCell>
                      <TableCell>{r.position || "—"}</TableCell>
                      <TableCell>{r.classYear || "—"}</TableCell>
                      <TableCell>{r.season}</TableCell>
                      <TableCell className="text-right font-mono">{fmtMoney(r.estimatedValue)}</TableCell>
                      <TableCell className="text-right font-mono">{fmtNum(r.offensiveEffectiveness, 1)}</TableCell>
                      <TableCell className="text-right font-mono">{fmtNum(r.war, 2)}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {new Date(r.updatedAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
                      No NIL valuation rows found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Quick Actions Tab ────────────────────────────────────────────────────────

function QuickActionsTab() {
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ updated: number; errors: number; total: number } | null>(null);
  const [clearTeamsLoading, setClearTeamsLoading] = useState(false);
  const [clearTeamsResult, setClearTeamsResult] = useState<{ playersCleared: number } | null>(null);
  const [syncTeamsLoading, setSyncTeamsLoading] = useState(false);
  const [syncTeamsResult, setSyncTeamsResult] = useState<{
    updated: number;
    clearedUnmatched: number;
    skippedAmbiguous: number;
    unmatched: number;
    unresolvedSample: string[];
  } | null>(null);
  const linkCsvRef = useRef<HTMLInputElement | null>(null);
  const [linkCsvLoading, setLinkCsvLoading] = useState(false);
  const [linkCsvResult, setLinkCsvResult] = useState<{ teamsLinked: number; playersLinked: number; playersCreated: number; unmatched: string[] } | null>(null);
  const stuffPlusCsvRef = useRef<HTMLInputElement | null>(null);
  const [stuffPlusLoading, setStuffPlusLoading] = useState(false);
  const [stuffPlusResult, setStuffPlusResult] = useState<{ updated: number; notFound: number; skipped: number } | null>(null);

  const importStuffPlusCsv = async (file: File) => {
    setStuffPlusLoading(true);
    setStuffPlusResult(null);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) throw new Error("CSV has no data rows");
      const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
      const nameCol = headers.findIndex((h) => h.includes("player") || h.includes("name"));
      const teamCol = headers.findIndex((h) => h.includes("team"));
      const stuffCol = headers.findIndex((h) => h.includes("stuff"));
      if (nameCol < 0 || stuffCol < 0) throw new Error("CSV must have Player Name and Stuff+ columns");

      const normalize = (v: string | null | undefined) =>
        (v || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

      let updated = 0;
      let notFound = 0;
      let skipped = 0;

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map((c) => c.trim());
        const playerName = cols[nameCol] || "";
        const team = teamCol >= 0 ? (cols[teamCol] || "") : "";
        const stuffRaw = cols[stuffCol] || "";
        const stuffVal = parseFloat(stuffRaw);
        if (!playerName || !Number.isFinite(stuffVal)) { skipped++; continue; }

        // Match by name+team in Pitching Master
        let query = (supabase as any).from("Pitching Master").update({
          stuff_plus: stuffVal,
          era_power_rating_plus: null,
          fip_power_rating_plus: null,
          k9_power_rating_plus: null,
        }).eq("Season", 2025).ilike("playerFullName", playerName);
        if (team) query = query.ilike("Team", `%${team}%`);
        const { count, error } = await query.select("id", { count: "exact", head: true });

        if (error) { notFound++; continue; }
        if ((count ?? 0) > 0) updated++;
        else notFound++;
      }

      setStuffPlusResult({ updated, notFound, skipped });
      toast.success(`Updated ${updated} pitchers' Stuff+. ${notFound} not found. ${skipped} skipped.`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setStuffPlusLoading(false);
    }
  };

  const linkSourceIdsCsv = async (file: File) => {
    setLinkCsvLoading(true);
    setLinkCsvResult(null);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) throw new Error("CSV has no data rows");

      // Parse CSV with proper quote handling
      const parseLine = (line: string) => {
        const out: string[] = [];
        let cur = "";
        let inQuotes = false;
        for (const ch of line) {
          if (ch === '"') { inQuotes = !inQuotes; continue; }
          if (ch === "," && !inQuotes) { out.push(cur.trim()); cur = ""; continue; }
          cur += ch;
        }
        out.push(cur.trim());
        return out;
      };

      const header = parseLine(lines[0]).map((h) => h.toLowerCase().trim());
      const col = (names: string[]) => {
        for (const n of names) {
          const i = header.indexOf(n.toLowerCase());
          if (i >= 0) return i;
        }
        return -1;
      };

      const playerIdCol = col(["playerid", "player_id"]);
      const firstNameCol = col(["playerfirstname", "firstname", "first_name"]);
      const lastNameCol = col(["player", "lastname", "last_name"]);
      const fullNameCol = col(["playerfullname", "fullname"]);
      const teamNameCol = col(["newestteamname", "team", "teamname"]);
      const teamIdCol = col(["newestteamid", "team_id", "teamid"]);
      const teamLocationCol = col(["newestteamlocation", "teamlocation"]);
      const posCol = col(["pos", "position"]);

      if (playerIdCol < 0) throw new Error("CSV must have a playerId column");

      // Fetch all teams and players for matching
      const { data: allTeams } = await supabase.from("Teams Table").select("id, full_name, abbreviation, source_id");
      const { data: allPlayers } = await supabase.from("players").select("id, first_name, last_name, team, team_id, source_player_id");
      if (!allTeams || !allPlayers) throw new Error("Failed to fetch teams/players");

      const normalize = (v: string | null | undefined) =>
        (v || "").trim().toLowerCase().replace(/\buniversity\b/g, "").replace(/\bof\b/g, "").replace(/\bthe\b/g, "").replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();

      // Build team lookup maps
      const teamBySourceId = new Map<string, typeof allTeams[0]>();
      const teamByNormalizedName = new Map<string, typeof allTeams[0]>();
      for (const t of allTeams) {
        if (t.source_id) teamBySourceId.set(String(t.source_id), t);
        teamByNormalizedName.set(normalize(t.full_name), t);
        if (t.abbreviation) teamByNormalizedName.set(normalize(t.abbreviation), t);
      }

      // Build player lookup maps
      const playerBySourceId = new Map<string, typeof allPlayers[0]>();
      const playersByNormalizedName = new Map<string, Array<typeof allPlayers[0]>>();
      for (const p of allPlayers) {
        if (p.source_player_id) playerBySourceId.set(String(p.source_player_id), p);
        const nameKey = normalize(`${p.first_name} ${p.last_name}`);
        const arr = playersByNormalizedName.get(nameKey) || [];
        arr.push(p);
        playersByNormalizedName.set(nameKey, arr);
      }

      let teamsLinked = 0;
      let playersLinked = 0;
      let playersCreated = 0;
      const unmatched: string[] = [];

      for (let i = 1; i < lines.length; i++) {
        const cols = parseLine(lines[i]);
        const sourcePlayerId = cols[playerIdCol] || "";
        if (!sourcePlayerId) continue;

        const firstName = firstNameCol >= 0 ? (cols[firstNameCol] || "").trim() : "";
        const lastName = lastNameCol >= 0 ? (cols[lastNameCol] || "").trim() : "";
        const fullName = fullNameCol >= 0 ? (cols[fullNameCol] || "").trim() : `${firstName} ${lastName}`.trim();
        const sourceTeamId = teamIdCol >= 0 ? (cols[teamIdCol] || "").trim() : "";
        const teamName = teamNameCol >= 0 ? (cols[teamNameCol] || "").trim() : "";
        const teamLocation = teamLocationCol >= 0 ? (cols[teamLocationCol] || "").trim() : "";
        const position = posCol >= 0 ? (cols[posCol] || "").trim() : "";

        // Resolve team
        let matchedTeam = sourceTeamId ? teamBySourceId.get(sourceTeamId) : undefined;
        if (!matchedTeam) {
          matchedTeam = teamByNormalizedName.get(normalize(teamLocation))
            || teamByNormalizedName.get(normalize(teamName));
        }

        // Link source_team_id on teams table if not already set
        if (matchedTeam && sourceTeamId && !matchedTeam.source_id) {
          await supabase.from("Teams Table").update({ source_id: sourceTeamId }).eq("id", matchedTeam.id);
          (matchedTeam as any).source_id = sourceTeamId;
          teamBySourceId.set(sourceTeamId, matchedTeam);
          teamsLinked++;
        }

        // Resolve player
        let matchedPlayer = playerBySourceId.get(sourcePlayerId);
        if (!matchedPlayer) {
          const nameKey = normalize(fullName);
          const candidates = playersByNormalizedName.get(nameKey) || [];
          if (candidates.length === 1) {
            matchedPlayer = candidates[0];
          } else if (candidates.length > 1 && matchedTeam) {
            matchedPlayer = candidates.find((p) => p.team_id === matchedTeam!.id) || undefined;
          }
        }

        if (matchedPlayer) {
          const updates: Record<string, any> = {};
          if (!matchedPlayer.source_player_id) updates.source_player_id = sourcePlayerId;
          if (matchedTeam && !matchedPlayer.team_id) {
            updates.team_id = matchedTeam.id;
            updates.source_team_id = sourceTeamId || null;
          } else if (sourceTeamId && !matchedPlayer.source_team_id) {
            updates.source_team_id = sourceTeamId;
          }
          if (position && !matchedPlayer.position) updates.position = position;
          if (Object.keys(updates).length > 0) {
            await supabase.from("players").update(updates).eq("id", matchedPlayer.id);
            playersLinked++;
          } else if (!matchedPlayer.source_player_id) {
            await supabase.from("players").update({ source_player_id: sourcePlayerId }).eq("id", matchedPlayer.id);
            playersLinked++;
          }
        } else {
          // No match found — create a new player record
          const nameParts = fullName.trim().split(/\s+/);
          const newFirstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(" ") : (firstName || nameParts[0] || "Unknown");
          const newLastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : (lastName || "Player");
          const { data: created, error: createErr } = await supabase.from("players").insert({
            first_name: newFirstName,
            last_name: newLastName,
            team: matchedTeam?.full_name ?? teamLocation ?? teamName ?? null,
            team_id: matchedTeam?.id ?? null,
            position: position || null,
            source_player_id: sourcePlayerId,
            source_team_id: sourceTeamId || null,
            transfer_portal: false,
          }).select("id").single();
          if (createErr) {
            unmatched.push(`${fullName} (${teamLocation || teamName}) — create failed: ${createErr.message}`);
          } else {
            playersCreated++;
            // Add to lookup so re-encountering this player won't create a dupe
            const newPlayer = { id: created.id, first_name: newFirstName, last_name: newLastName, team: matchedTeam?.full_name ?? null, team_id: matchedTeam?.id ?? null, source_player_id: sourcePlayerId } as any;
            playerBySourceId.set(sourcePlayerId, newPlayer);
            const nameKey = normalize(fullName);
            const arr = playersByNormalizedName.get(nameKey) || [];
            arr.push(newPlayer);
            playersByNormalizedName.set(nameKey, arr);
          }
        }
      }

      setLinkCsvResult({ teamsLinked, playersLinked, playersCreated, unmatched: unmatched.slice(0, 20) });
      toast.success(`Linked ${playersLinked} players, created ${playersCreated} new players, ${teamsLinked} teams. ${unmatched.length} errors.`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLinkCsvLoading(false);
    }
  };


  const runBulkRecalculate = async () => {
    setBulkLoading(true);
    setBulkResult(null);
    try {
      const result = await bulkRecalculatePredictionsLocal();
      setBulkResult({
        updated: result.updated ?? 0,
        errors: result.errors ?? 0,
        total: result.total ?? 0,
      });
      toast.success(
        `Bulk recalculated ${result.updated ?? 0}/${result.total ?? 0} predictions` +
          ((result.errors ?? 0) > 0 ? ` with ${result.errors} errors` : ""),
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkLoading(false);
    }
  };

  const clearTransfer2026Assignments = async () => {
    setClearTeamsLoading(true);
    setClearTeamsResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const { count: transferPlayerCount, error: countPlayerErr } = await supabase
        .from("players")
        .select("id", { count: "exact", head: true })
        .eq("transfer_portal", true);
      if (countPlayerErr) throw countPlayerErr;

      const { error: clearPlayersErr } = await supabase
        .from("players")
        .update({ team: null, conference: null })
        .eq("transfer_portal", true);
      if (clearPlayersErr) throw clearPlayersErr;

      const result = {
        playersCleared: transferPlayerCount ?? 0,
      };
      setClearTeamsResult(result);
      toast.success(
        `Cleared destination team data for ${result.playersCleared} transfer players.`,
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setClearTeamsLoading(false);
    }
  };

  const sync2025TeamsForNonTransfers = async () => {
    setSyncTeamsLoading(true);
    setSyncTeamsResult(null);
    try {
      const normalize = (value: string | null | undefined) =>
        (value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
      const normalizeTeamMatch = (value: string | null | undefined) => {
        const key = normalize(value);
        const aliases: Record<string, string> = {
          "university of maryland college park": "university of maryland",
          "maryland college park": "university of maryland",
          "university of maryland eastern shore": "maryland eastern shore",
          "maryland eastern shore": "maryland eastern shore",
          "umes": "maryland eastern shore",
          "alabama birmingham": "uab",
          "uab": "uab",
          "university of texas san antonio": "utsa",
          "utsa": "utsa",
          "university of southern indiana": "southern indiana",
          "university of san francisco": "san francisco",
          "university of nebraska omaha": "omaha",
          "university of nevada las vegas": "unlv",
          "unlv": "unlv",
          "university of mississippi": "ole miss",
          "olemiss": "ole miss",
          "university of massachusetts": "umass",
          "umass": "umass",
          "university of hawaii manoa": "hawaii",
          "university of hawaii": "hawaii",
          "university of arkansas pine bluff": "arkansas pine bluff",
          "charlotte university": "charlotte",
          "unc charlotte": "charlotte",
          "texas a m university": "texas a m",
          "stephen f austin state university": "stephen f austin state",
          "southeast missouri state university": "southeast missouri state",
          "southeastern missouri state": "southeast missouri state",
          "southeastern missouri state university": "southeast missouri state",
          "semo": "southeast missouri state",
          "southeast missouti state": "southeast missouri state",
          "samford university": "samford",
          "nicholls state university": "nicholls state",
          "miami university ohio": "miami oh",
          "mcneese state university": "mcneese state",
          "louisiana state university": "louisiana state",
          "indiana university bloomington": "indiana university",
          "florida international university": "florida international",
          "coppin state university": "coppin state",
          "cal state northridge": "csu northridge",
          "cal state fullerton": "csu fullerton",
          "california state university fullerton": "csu fullerton",
          "california state fullerton": "csu fullerton",
          "csu fullerton": "csu fullerton",
          "uic": "illinois chicago",
          "university illinois chicago": "illinois chicago",
          "university of illinois chicago": "illinois chicago",
          "army west point": "army",
          "prairie view a m university": "prairie view a m",
          "prairie view a m": "prairie view a m",
          "pvam": "prairie view a m",
          "alabama a m university": "alabama a m",
          "air force academy": "air force",
          "air force": "air force",
          "fiu": "florida international",
          "famu": "florida a m",
          "lsu": "louisiana state",
          "vcu": "vcu",
          "north carolina a t state university": "north carolina state a t",
          "north carolina a t": "north carolina state a t",
          "ncat": "north carolina state a t",
        };
        return aliases[key] || key;
      };

      const seedRows = storage2025Seed as Array<{
        playerName: string;
        team: string | null;
        conference: string | null;
      }>;

      const seedByName = new Map<string, Array<{ team: string | null; conference: string | null }>>();
      for (const row of seedRows) {
        const nameKey = normalize(row.playerName);
        if (!nameKey) continue;
        const arr = seedByName.get(nameKey) || [];
        arr.push({ team: row.team, conference: row.conference });
        seedByName.set(nameKey, arr);
      }

      const { data: allPlayers, error: playersErr } = await supabase
        .from("players")
        .select("id, first_name, last_name, team, conference");
      if (playersErr) throw playersErr;

      const { data: teams, error: teamsErr } = await supabase
        .from("Teams Table")
        .select("full_name, abbreviation, conference");
      if (teamsErr) throw teamsErr;
      const teamByNorm = new Map<string, { name: string; conference: string | null }>();
      for (const t of teams || []) {
        const key = normalizeTeamMatch(t.full_name);
        if (!key) continue;
        if (!teamByNorm.has(key)) {
          teamByNorm.set(key, { name: t.full_name, conference: t.conference || null });
        }
        if (t.abbreviation) {
          const abbrKey = normalizeTeamMatch(t.abbreviation);
          if (abbrKey && !teamByNorm.has(abbrKey)) {
            teamByNorm.set(abbrKey, { name: t.full_name, conference: t.conference || null });
          }
        }
      }
      const lookupTeamMatch = (team: string | null | undefined) => {
        const raw = (team || "").trim();
        if (!raw) return null;
        return teamByNorm.get(normalizeTeamMatch(raw)) || null;
      };

      let updated = 0;
      let clearedUnmatched = 0;
      let skippedAmbiguous = 0;
      let unmatched = 0;
      const unresolvedNames: string[] = [];

      for (const p of allPlayers || []) {
        const fullName = `${p.first_name || ""} ${p.last_name || ""}`.trim();
        const nameKey = normalize(fullName);
        if (!nameKey) continue;
        const matches = seedByName.get(nameKey) || [];
        const currentTeamMatch = lookupTeamMatch(p.team);

        let nextTeam: string | null = null;
        let nextConference: string | null = null;

        if (matches.length === 0) {
          if (currentTeamMatch) {
            nextTeam = currentTeamMatch.name;
            nextConference = currentTeamMatch.conference;
          } else {
            unmatched++;
            unresolvedNames.push(fullName);
          }
        } else {
          const uniqueTeams = [
            ...new Set(
              matches.map((m) => normalizeTeamMatch((m.team || "").trim())).filter(Boolean),
            ),
          ];
          if (uniqueTeams.length > 1) {
            const playerConference = (p.conference || "").trim();
            const confMatches = playerConference
              ? matches.filter((m) => (m.conference || "").trim() === playerConference)
              : [];
            const uniqueConfTeams = [
              ...new Set(
                confMatches.map((m) => normalizeTeamMatch((m.team || "").trim())).filter(Boolean),
              ),
            ];

            if (uniqueConfTeams.length === 1) {
              const chosen = confMatches.find(
                (m) => normalizeTeamMatch((m.team || "").trim()) === uniqueConfTeams[0],
              ) || confMatches[0];
              const chosenTeam = (chosen.team || "").trim();
              if (chosenTeam) {
                const chosenTeamMatch = lookupTeamMatch(chosenTeam);
                if (chosenTeamMatch) {
                  nextTeam = chosenTeamMatch.name;
                  nextConference = chosenTeamMatch.conference;
                }
              }
            }

            if (nextTeam) {
              // resolved from conference disambiguation
            } else
            // Prefer canonicalizing existing team if it maps cleanly.
            if (currentTeamMatch) {
              nextTeam = currentTeamMatch.name;
              nextConference = currentTeamMatch.conference;
            } else {
              skippedAmbiguous++;
              unresolvedNames.push(fullName);
            }
          } else {
            const chosen = matches.find(
              (m) => normalizeTeamMatch((m.team || "").trim()) === uniqueTeams[0],
            ) || matches[0];
            const chosenTeam = (chosen.team || "").trim();
            if (chosenTeam) {
              const chosenTeamMatch = lookupTeamMatch(chosenTeam);
              if (chosenTeamMatch) {
                nextTeam = chosenTeamMatch.name;
                nextConference = chosenTeamMatch.conference;
              } else {
                unmatched++;
                unresolvedNames.push(fullName);
              }
            } else if (currentTeamMatch) {
              nextTeam = currentTeamMatch.name;
              nextConference = currentTeamMatch.conference;
            } else {
              unmatched++;
              unresolvedNames.push(fullName);
            }
          }
        }

        if (!nextTeam) {
          if ((p.team || "") !== "" || (p.conference || "") !== "") {
            const { error: clearErr } = await supabase
              .from("players")
              .update({ team: null, conference: null })
              .eq("id", p.id);
            if (clearErr) throw clearErr;
            clearedUnmatched++;
          }
          continue;
        }

        const changed = (p.team || "") !== nextTeam || (p.conference || "") !== (nextConference || "");
        if (!changed) continue;

        const { error: upErr } = await supabase
          .from("players")
          .update({ team: nextTeam, conference: nextConference })
          .eq("id", p.id);
        if (upErr) throw upErr;
        updated++;
      }

      const result = {
        updated,
        clearedUnmatched,
        skippedAmbiguous,
        unmatched,
        unresolvedSample: unresolvedNames.slice(0, 12),
      };
      setSyncTeamsResult(result);
      toast.success(
        `Synced player teams: ${updated} updated, ${clearedUnmatched} cleared to blank, ${skippedAmbiguous} ambiguous, ${unmatched} unmatched.`,
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncTeamsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Quick Actions</h3>
        <p className="text-sm text-muted-foreground">Run bulk operations after changing constants or weights.</p>
      </div>
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div>
            <p className="font-medium">Bulk Recalculate All Returners</p>
            <p className="text-sm text-muted-foreground">
              Re-run the returner formula on all player predictions (returners + transfers), including departed players.
            </p>
          </div>
          <Button onClick={runBulkRecalculate} disabled={bulkLoading} className="gap-2">
            {bulkLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {bulkLoading ? "Recalculating…" : "Run Bulk Recalculate"}
          </Button>
          {bulkResult && (
            <p className="text-sm text-muted-foreground">
              Updated {bulkResult.updated} of {bulkResult.total} predictions
              {bulkResult.errors > 0 ? `, ${bulkResult.errors} errors` : ""}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div>
            <p className="font-medium">Clear Transfer 2026 Team Assignments</p>
            <p className="text-sm text-muted-foreground">
              Clears destination team/conference for transfer players so 2026 mapping can be re-imported cleanly.
            </p>
          </div>
          <Button onClick={clearTransfer2026Assignments} disabled={clearTeamsLoading} variant="destructive" className="gap-2">
            {clearTeamsLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {clearTeamsLoading ? "Clearing…" : "Clear Transfer 2026 Team Data"}
          </Button>
          {clearTeamsResult && (
            <p className="text-sm text-muted-foreground">
              Cleared players: {clearTeamsResult.playersCleared}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div>
            <p className="font-medium">Sync Master Tables → Players</p>
            <p className="text-sm text-muted-foreground">
              Creates a players row for every hitter and pitcher in Hitter Master / Pitching Master that doesn't already exist. Links by source_player_id. Safe to re-run.
            </p>
          </div>
          <SyncMasterButton />
          <div className="border-t pt-4">
            <p className="font-medium">Compute NCAA Averages</p>
            <p className="text-sm text-muted-foreground">
              Auto-calculates weighted means + SDs for every hitter and pitcher metric from Hitter Master / Pitching Master. Hitters weighted by PA (AB fallback), pitchers weighted by IP. Writes to <code>ncaa_averages</code>. Run this BEFORE Compute Scores so the +stats use fresh baselines.
            </p>
          </div>
          <ComputeNcaaAveragesButton />
          <div className="border-t pt-4">
            <p className="font-medium">Compute All Scores</p>
            <p className="text-sm text-muted-foreground">
              Computes power rating scores (BA+, OBP+, ISO+, ERA PR+, etc.) for all unscored players and writes them to Supabase. Runs automatically on data load, but can be triggered manually.
            </p>
          </div>
          <ComputeScoresButton />
          <div className="border-t pt-4">
            <p className="font-medium">Auto-Infer Class Transitions</p>
            <p className="text-sm text-muted-foreground">
              Sets each player's class transition (FS/SJ/JS/GR) based on how many years
              they've been in the system. First-seen 2025 → FS, first-seen 2024 → SJ,
              first-seen 2023 → JS, first-seen 2022 → GR. Skips players whose class has
              been manually overridden by a coach.
            </p>
          </div>
          <InferClassTransitionsButton />
          <div className="border-t pt-4">
            <p className="font-medium">Create Predictions from Master</p>
            <p className="text-sm text-muted-foreground">
              Creates returner predictions and power rating internals for all hitters in the players table using Hitter Master data. Skips players who already have predictions. Then run "Bulk Recalculate" to compute projected stats.
            </p>
          </div>
          <CreatePredictionsButton />
          <div className="border-t pt-4">
            <p className="font-medium">Create Stub Predictions for All Players</p>
            <p className="text-sm text-muted-foreground">
              Creates a blank returner prediction row for every player (hitter or pitcher, current or departed) who doesn't already have one. Required so Auto-Infer Class Transitions has somewhere to write each player's class. Idempotent and fast.
            </p>
          </div>
          <CreateStubPredictionsButton />
          <div className="border-t pt-4">
            <p className="font-medium">Import PA/AB from CSV</p>
            <p className="text-sm text-muted-foreground">
              Upload a CSV with playerId, AB, and PA columns. Updates Hitter Master and players tables by source_player_id.
            </p>
          </div>
          <ImportPaAbButton />
          <div className="border-t pt-4">
            <p className="font-medium">Import Pitch Arsenal (Stuff+ & Whiff%)</p>
            <p className="text-sm text-muted-foreground">
              Upload the Stuff+ Model CSV with per-pitch Stuff+ and Whiff% data. Clears and replaces existing arsenal data. Also updates Overall Stuff+ for pitcher projections.
            </p>
          </div>
          <ImportPitchArsenalButton />
          <div className="border-t pt-4">
            <p className="font-medium">Import Historical Hitter Data</p>
            <p className="text-sm text-muted-foreground">
              Upload a source hitter CSV for a past season (2022-2024). Clears existing data for that season and imports fresh. Resolves conference from Teams Table.
            </p>
          </div>
          <ImportHistoricalHittersButton />
          <div className="border-t pt-4">
            <p className="font-medium">Import Historical Pitcher Data</p>
            <p className="text-sm text-muted-foreground">
              Upload a source pitcher CSV for a past season (2022-2024). Clears existing pitching data for that season and imports fresh. Will NOT touch 2025 data.
            </p>
          </div>
          <ImportHistoricalPitchersButton />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div>
            <p className="font-medium">Update Stuff+ from CSV</p>
            <p className="text-sm text-muted-foreground">
              Upload a CSV with columns: Player Name, Team, Stuff+. Updates only the stuff_plus field on 2025 Pitching Master rows for matching players, and nulls out PR+ scores so the next Compute Scores run picks up the new values.
            </p>
          </div>
          <input
            ref={stuffPlusCsvRef}
            type="file"
            accept=".csv"
            className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
            disabled={stuffPlusLoading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importStuffPlusCsv(file);
            }}
          />
          {stuffPlusLoading && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin" /> Updating Stuff+ values…
            </p>
          )}
          {stuffPlusResult && (
            <p className="text-sm text-muted-foreground">
              Updated {stuffPlusResult.updated} pitchers. {stuffPlusResult.notFound} not found in DB. {stuffPlusResult.skipped} skipped (blank/invalid).
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div>
            <p className="font-medium">Link Source IDs from CSV</p>
            <p className="text-sm text-muted-foreground">
              Upload a CSV exported from your source system. Matches players by name+team and stores the source system's player ID and team ID for future imports. Safe to re-run.
            </p>
          </div>
          <input
            ref={linkCsvRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                await linkSourceIdsCsv(file);
              } catch (err: any) {
                toast.error(err?.message || "Failed to process CSV");
              } finally {
                e.currentTarget.value = "";
              }
            }}
          />
          <Button onClick={() => linkCsvRef.current?.click()} disabled={linkCsvLoading} variant="outline" className="gap-2">
            {linkCsvLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {linkCsvLoading ? "Linking Source IDs…" : "Upload CSV to Link Source IDs"}
          </Button>
          {linkCsvResult && (
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                Linked {linkCsvResult.playersLinked} existing players, created {linkCsvResult.playersCreated} new players, linked {linkCsvResult.teamsLinked} teams.
                {linkCsvResult.unmatched.length > 0 ? ` ${linkCsvResult.unmatched.length} errors.` : ""}
              </p>
              {linkCsvResult.unmatched.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Unmatched sample: {linkCsvResult.unmatched.join(", ")}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PitchingPlaceholder({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>
          Pitching configuration for this section is not set up yet.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Use the Hitting tab for current workflows. Pitching will be added in a follow-up pass.
        </p>
      </CardContent>
    </Card>
  );
}

function HittingPitchingSection({
  hitting,
  pitching,
  pitchingTitle,
}: {
  hitting?: ReactNode;
  pitching?: ReactNode;
  pitchingTitle?: string;
}) {
  return (
    <Tabs defaultValue="hitting" className="space-y-3">
      <TabsList>
        <TabsTrigger value="hitting">Hitting</TabsTrigger>
        <TabsTrigger value="pitching">Pitching</TabsTrigger>
      </TabsList>
      <TabsContent value="hitting">{hitting}</TabsContent>
      <TabsContent value="pitching">{pitching ?? <PitchingPlaceholder title={pitchingTitle} />}</TabsContent>
    </Tabs>
  );
}

// ─── Main Admin Dashboard ─────────────────────────────────────────────────────

function BulkPortalStatusTab() {
  const [nameList, setNameList] = useState("");
  const [targetStatus, setTargetStatus] = useState<string>("IN PORTAL");
  const [results, setResults] = useState<{ input: string; name: string; team: string; matched: boolean; playerId?: string }[]>([]);
  const [processing, setProcessing] = useState(false);
  const queryClient = useQueryClient();

  const handleBulkUpdate = async () => {
    const lines = nameList
      .split("\n")
      .map((n) => n.trim())
      .filter(Boolean);
    if (!lines.length) return;

    setProcessing(true);
    const output: typeof results = [];

    for (const line of lines) {
      // Format: "First Last, Team" or "Last, First, Team"
      const parts = line.split(",").map((s) => s.trim());
      let first = "";
      let last = "";
      let team = "";

      if (parts.length >= 3) {
        // "Last, First, Team"
        last = parts[0];
        first = parts[1];
        team = parts.slice(2).join(", ");
      } else if (parts.length === 2) {
        // "First Last, Team"
        const nameParts = parts[0].split(/\s+/);
        first = nameParts[0] || "";
        last = nameParts.slice(1).join(" ") || "";
        team = parts[1];
      } else {
        output.push({ input: line, name: line, team: "", matched: false });
        continue;
      }

      if ((!first && !last) || !team) {
        output.push({ input: line, name: `${first} ${last}`.trim(), team, matched: false });
        continue;
      }

      // Exact match on name + team
      const { data } = await supabase
        .from("players")
        .select("id, first_name, last_name, team")
        .ilike("first_name", first)
        .ilike("last_name", last)
        .ilike("team", `%${team}%`)
        .limit(5);

      if (data && data.length > 0) {
        for (const player of data) {
          await supabase
            .from("players")
            .update({ portal_status: targetStatus, transfer_portal: targetStatus === "IN PORTAL" } as any)
            .eq("id", player.id);
          output.push({ input: line, name: `${player.first_name} ${player.last_name}`, team: player.team || "", matched: true, playerId: player.id });
        }
      } else {
        output.push({ input: line, name: `${first} ${last}`.trim(), team, matched: false });
      }
    }

    setResults(output);
    setProcessing(false);
    queryClient.invalidateQueries({ queryKey: ["target-board"] });
    queryClient.invalidateQueries({ queryKey: ["returning-players-2025-unified"] });
  };

  const matched = results.filter((r) => r.matched).length;
  const unmatched = results.filter((r) => !r.matched).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Bulk Portal Status Update</CardTitle>
        <CardDescription>
          Paste a list of players, one per line. Each line must include name and team to avoid mismatches.
          <br />
          Formats: <code className="text-xs bg-muted px-1 rounded">First Last, Team</code> or <code className="text-xs bg-muted px-1 rounded">Last, First, Team</code>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Label className="text-sm font-medium whitespace-nowrap">Set status to:</Label>
          <select
            className={`text-xs font-semibold uppercase tracking-wider rounded-full px-3 py-1.5 border-0 cursor-pointer appearance-none transition-colors ${
              targetStatus === "IN PORTAL" ? "bg-emerald-500/10 text-emerald-600"
              : targetStatus === "COMMITTED" ? "bg-blue-500/10 text-blue-600"
              : targetStatus === "WATCHING" ? "bg-[#D4AF37]/10 text-[#D4AF37]"
              : "bg-muted text-muted-foreground"
            }`}
            value={targetStatus}
            onChange={(e) => setTargetStatus(e.target.value)}
          >
            <option value="NOT IN PORTAL">Not In Portal</option>
            <option value="WATCHING">Watching</option>
            <option value="IN PORTAL">In Portal</option>
            <option value="COMMITTED">Committed</option>
          </select>
        </div>

        <textarea
          className="w-full min-h-[200px] rounded-md border border-border bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          placeholder={"John Smith, Arizona State\nJane Doe, Oregon State\nDoe, Jane, Texas"}
          value={nameList}
          onChange={(e) => setNameList(e.target.value)}
        />

        <div className="flex items-center gap-3">
          <Button onClick={handleBulkUpdate} disabled={processing || !nameList.trim()}>
            {processing ? "Processing…" : `Update ${nameList.split("\n").filter((n) => n.trim()).length} Players`}
          </Button>
          {results.length > 0 && (
            <span className="text-sm text-muted-foreground">
              <span className="text-emerald-600 font-medium">{matched} matched</span>
              {unmatched > 0 && <> · <span className="text-destructive font-medium">{unmatched} not found</span></>}
            </span>
          )}
        </div>

        {results.length > 0 && (
          <div className="rounded-md border border-border divide-y divide-border max-h-[300px] overflow-auto">
            {results.map((r, i) => (
              <div key={i} className={`flex items-center gap-2 px-3 py-1.5 text-sm ${r.matched ? "" : "bg-destructive/5"}`}>
                {r.matched ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                ) : (
                  <X className="h-3.5 w-3.5 text-destructive shrink-0" />
                )}
                <span className={r.matched ? "" : "text-destructive"}>{r.name}</span>
                {r.team && <span className="text-[10px] text-muted-foreground">· {r.team}</span>}
                {!r.matched && <span className="text-[10px] text-muted-foreground ml-auto">No match found</span>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminDashboard() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const isStaff = hasRole("staff");

  if (!isAdmin && !isStaff) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">You don't have access to this page.</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Admin Dashboard</h2>
          <p className="text-muted-foreground">
            Manage equation constants, conference statistics, teams, and NIL valuations in one place.
          </p>
        </div>

        <Tabs defaultValue="equations" className="space-y-4">
          <TabsList>
            <TabsTrigger value="equations" className="gap-1.5">
              <Sliders className="h-4 w-4" />
              Equations
            </TabsTrigger>
            <TabsTrigger value="power" className="gap-1.5">
              <Trophy className="h-4 w-4" />
              Conference Statistics
            </TabsTrigger>
            <TabsTrigger value="power-ratings" className="gap-1.5">
              <Trophy className="h-4 w-4" />
              Power Ratings
            </TabsTrigger>
            <TabsTrigger value="actions" className="gap-1.5">
              <RefreshCw className="h-4 w-4" />
              Data Sync
            </TabsTrigger>
            <TabsTrigger value="portal" className="gap-1.5">
              <LogIn className="h-4 w-4" />
              Portal
            </TabsTrigger>
            <TabsTrigger value="stuff-import" className="gap-1.5">
              <Upload className="h-4 w-4" />
              Stuff+ Import
            </TabsTrigger>
            <TabsTrigger value="roster-override" className="gap-1.5">
              <UserPlus className="h-4 w-4" />
              Roster
            </TabsTrigger>
          </TabsList>

          <TabsContent value="equations">
            <HittingPitchingSection
              hitting={<EquationConstantsTab />}
              pitching={<PitchingEquationsTab />}
              pitchingTitle="Equations — Pitching"
            />
          </TabsContent>
          <TabsContent value="power">
            <PitchingConferenceStatsTable />
          </TabsContent>
          <TabsContent value="power-ratings">
            <HittingPitchingSection
              hitting={<AdminPowerRatingsTab />}
              pitching={<PitchingPowerRatingsTab />}
              pitchingTitle="Power Ratings — Pitching"
            />
          </TabsContent>
          <TabsContent value="actions">
            <QuickActionsTab />
          </TabsContent>
          <TabsContent value="portal">
            <BulkPortalStatusTab />
          </TabsContent>
          <TabsContent value="stuff-import">
            <StuffPlusImporter />
          </TabsContent>
          <TabsContent value="roster-override">
            <RosterOverrideTab />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
