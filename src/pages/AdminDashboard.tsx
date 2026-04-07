import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { computeAndStoreAllScores } from "@/lib/computeAndStoreScores";
import { syncMasterToPlayers } from "@/lib/syncMasterToPlayers";
import { createPredictionsFromMaster } from "@/lib/createPredictionsFromMaster";
(window as any).computeAllScores = computeAndStoreAllScores;
(window as any).syncMasterToPlayers = syncMasterToPlayers;
(window as any).createPredictions = createPredictionsFromMaster;
import DashboardLayout from "@/components/DashboardLayout";
import ConferenceStatsTable from "@/components/ConferenceStatsTable";
import PitchingConferenceStatsTable from "@/components/PitchingConferenceStatsTable";
import PitchingStatsStorageTable from "@/components/PitchingStatsStorageTable";
import PitchingPowerRatingsStorageTable from "@/components/PitchingPowerRatingsStorageTable";
import PitchingStuffPlusStorageTable from "@/components/PitchingStuffPlusStorageTable";
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
import { Pencil, RefreshCw, Scale, Sliders, Trophy, Plus, Trash2, Building2, Check, Edit2, Save, X, Upload, LogIn } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { bulkRecalculatePredictionsLocal } from "@/lib/predictionEngine";
// TODO: Seed JSON files are static local data — migrate to Supabase tables for live updates.
import storage2025Seed from "@/data/storage_2025_seed.json";
import powerRatings2025Seed from "@/data/power_ratings_2025_seed.json";
import exitPositions2025Seed from "@/data/exit_positions_2025_seed.json";
import { profileRouteFor } from "@/lib/profileRoutes";
import { resolveMetricParkFactor } from "@/lib/parkFactors";
import { useParkFactors } from "@/hooks/useParkFactors";

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
  const [season, setSeason] = useState(2024);
  const [result, setResult] = useState<{ inserted: number; skipped: number; teamsResolved: number; teamsUnresolved: string[]; errors: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <div className="flex items-center gap-2">
        <Select value={String(season)} onValueChange={(v) => setSeason(Number(v))}>
          <SelectTrigger className="h-9 w-[90px] text-sm font-semibold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="2024">2024</SelectItem>
            <SelectItem value="2023">2023</SelectItem>
            <SelectItem value="2022">2022</SelectItem>
          </SelectContent>
        </Select>
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
          {loading ? `Importing ${season} Hitters…` : `Import Hitter CSV`}
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
  const [season, setSeason] = useState(2024);
  const [result, setResult] = useState<{ inserted: number; skipped: number; teamsResolved: number; teamsUnresolved: string[]; errors: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <div className="flex items-center gap-2">
        <Select value={String(season)} onValueChange={(v) => setSeason(Number(v))}>
          <SelectTrigger className="h-9 w-[90px] text-sm font-semibold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="2024">2024</SelectItem>
            <SelectItem value="2023">2023</SelectItem>
            <SelectItem value="2022">2022</SelectItem>
          </SelectContent>
        </Select>
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
          {loading ? `Importing ${season} Pitchers…` : `Import Pitcher CSV`}
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
            const r = await syncMasterToPlayers(2025);
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
    </>
  );
}

function ComputeScoresButton() {
  const [loading, setLoading] = useState(false);
  const [season, setSeason] = useState(2025);
  const [result, setResult] = useState<{ hitters: { updated: number; errors: number }; pitchers: { updated: number; errors: number } } | null>(null);
  return (
    <>
      <div className="flex items-center gap-2">
        <Select value={String(season)} onValueChange={(v) => setSeason(Number(v))}>
          <SelectTrigger className="h-9 w-[90px] text-sm font-semibold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="2025">2025</SelectItem>
            <SelectItem value="2024">2024</SelectItem>
            <SelectItem value="2023">2023</SelectItem>
            <SelectItem value="2022">2022</SelectItem>
          </SelectContent>
        </Select>
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
            const r = await createPredictionsFromMaster(2025);
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
  const ADMIN_UI_SEASON = 2025;
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
    r_ba_class_gr: "1",
    r_obp_class_fs: "3",
    r_obp_class_sj: "2",
    r_obp_class_js: "1.5",
    r_obp_class_gr: "1",
    r_iso_class_fs: "4.5",
    r_iso_class_sj: "3",
    r_iso_class_js: "2",
    r_iso_class_gr: "1",
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
    t_ba_conference_weight: "1.000",
    t_ba_pitching_weight: "1.000",
    t_ba_park_weight: "1.000",
    t_obp_ncaa_avg: "0.385",
    t_obp_std_pr: "28.889",
    t_obp_std_ncaa: "0.046781",
    t_obp_power_weight: "0.70",
    t_obp_conference_weight: "1.000",
    t_obp_pitching_weight: "1.000",
    t_obp_park_weight: "1.000",
    t_iso_ncaa_avg: "0.162",
    t_iso_std_ncaa: "0.07849797197",
    t_iso_std_power: "45.423",
    t_iso_conference_weight: "0.250",
    t_iso_pitching_weight: "1.000",
    t_iso_park_weight: "0.050",
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

  const [editableValues, setEditableValues] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem("admin_dashboard_equation_values_v1");
      if (!raw) return defaultEditableValues;
      const parsed = JSON.parse(raw) as Record<string, string>;
      const merged = { ...defaultEditableValues, ...parsed };
      for (const [k, v] of Object.entries(merged)) {
        if (v == null) merged[k] = defaultEditableValues[k] ?? "";
      }
      return merged;
    } catch {
      return defaultEditableValues;
    }
  });

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
        .from("conference_stats")
        .select("conference, avg, obp, iso, wrc")
        .order("conference");
      if (error) throw error;
      return data;
    },
  });
  const ncaaStats = conferenceStats.find((row) => (row.conference || "").toLowerCase().includes("ncaa"));

  const setEditable = (key: string, value: string) => {
    if (/^-?\d*\.?\d*$/.test(value)) {
      setEditableValues((prev) => ({ ...prev, [key]: value }));
    }
  };

  useEffect(() => {
    try {
      localStorage.setItem("admin_dashboard_equation_values_v1", JSON.stringify(editableValues));
    } catch {
      // ignore localStorage write failures
    }
  }, [editableValues]);

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

function PowerRatingsTab() {
  return <ConferenceStatsTable />;
}

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
    p_sd_era_power_rating: "",
    p_sd_fip_power_rating: "",
    p_sd_whip_power_rating: "",
    p_sd_k9_power_rating: "",
    p_sd_bb9_power_rating: "",
    p_sd_hr9_power_rating: "",
  };
  const [editableValues, setEditableValues] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem("admin_dashboard_pitching_power_equation_values_v1");
      if (!raw) return defaultValues;
      return {
        ...defaultValues,
        ...(JSON.parse(raw) as Record<string, string>),
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
        p_era_ncaa_avg_power_rating: "50",
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
        p_ncaa_avg_whip_power_rating: "50",
        p_ncaa_avg_k9_power_rating: "50",
        p_ncaa_avg_bb9_power_rating: "50",
        p_ncaa_avg_hr9_power_rating: "50",
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
    } catch {
      return defaultValues;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("admin_dashboard_pitching_power_equation_values_v1", JSON.stringify(editableValues));
    } catch {
      // ignore localStorage errors
    }
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

// ─── Teams Tab ────────────────────────────────────────────────────────────────

function TeamsAdminTab() {
  const { parkMap } = useParkFactors();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [confFilter, setConfFilter] = useState<string>("all");
  const [parkFilter, setParkFilter] = useState<string>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editConf, setEditConf] = useState("");
  const [editName, setEditName] = useState("");
  const [editParkFactor, setEditParkFactor] = useState("");
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamConf, setNewTeamConf] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [lastParkImportUnmatched, setLastParkImportUnmatched] = useState<Array<{ csvName: string; suggestedTeam: string | null }>>([]);
  const teamCsvInputRef = useRef<HTMLInputElement | null>(null);
  const canonicalTeamNames = useMemo(() => {
    const set = new Set<string>();
    (storage2025Seed as Array<{ team: string | null }>).forEach((r) => {
      const t = (r.team || "").trim();
      if (t) set.add(t);
    });
    return Array.from(set);
  }, []);
  const TEAM_ALIASES: Record<string, string> = {
    // Manual short-name aliases from park-factor unmatched audit (2026-03-24)
    alabama: "University of Alabama",
    arkansas: "University of Arkansas",
    byu: "Brigham Young University",
    connecticut: "University of Connecticut",
    delaware: "University of Delaware",
    florida: "University of Florida",
    georgia: "University of Georgia",
    houston: "University of Houston",
    illinois: "University of Illinois",
    indiana: "Indiana University",
    kansas: "University of Kansas",
    kentucky: "University of Kentucky",
    maryland: "University of Maryland",
    miami: "University of Miami",
    michigan: "University of Michigan",
    missouri: "University of Missouri",
    missouristate: "Missouri State University",
    navy: "Navy",
    navalacademy: "Navy",
    njit: "New Jersey Institute of Technology",
    northcarolina: "University of North Carolina",
    northwestern: "Northwestern University",
    ohio: "Ohio University",
    oklahoma: "University of Oklahoma",
    oregon: "University of Oregon",
    siuedwardsville: "SIU Edwardsville",
    southernillinoisunivedwardsville: "SIU Edwardsville",
    southcarolina: "University of South Carolina",
    southern: "Southern University",
    southernillinois: "Southern Illinois University",
    tcu: "Texas Christian University",
    tennessee: "University of Tennessee",
    texas: "University of Texas",
    louisianaatmonroe: "University of Louisiana Monroe",
    utah: "University of Utah",
    umbc: "University of Maryland, Baltimore County",
    virginia: "University of Virginia",
    washington: "University of Washington",
    lsu: "Louisiana State",
    fsu: "Florida State University",
    olemiss: "Ole Miss",
    mississippi: "Ole Miss",
    uconn: "University of Connecticut",
    unc: "University of North Carolina",
    ucla: "University of California Los Angeles",
    universityofcalifornialosangelesucla: "University of California Los Angeles",
    usc: "University of Southern California",
    ucf: "University of Central Florida",
    usf: "University of South Florida",
    uab: "UAB",
    alabamabirmingham: "UAB",
    utsa: "UTSA",
    universityoftexassanantonio: "UTSA",
    calstatenorthridge: "CSU Northridge",
    fau: "Florida Atlantic University",
    utrgv: "University of Texas Rio Grande Valley",
    texasriograndevalley: "University of Texas Rio Grande Valley",
    northcarolinaatstate: "North Carolina A&T",
    northcarolinaatstateuniversity: "North Carolina A&T",
    massachusetts: "UMass",
    universityofmassachusettsamherst: "UMass",
    umassuniversityofmassachusetts: "UMass",
    vcu: "VCU",
    virginiacommonwealth: "VCU",
    virginiacommonwealthuniversity: "VCU",
    ncstate: "North Carolina State University",
    kstate: "Kansas State University",
    osu: "Ohio State",
    arizona: "University of Arizona",
    uofa: "University of Arizona",
    universityofarizona: "University of Arizona",
    california: "California",
    universityofcalifornia: "California",
    ucb: "California",
    calberkeley: "California",
    // Big Ten locked canonical aliases
    universityofsoutherncalifornia: "University of Southern California",
    universityofcalifornialosangeles: "University of California Los Angeles",
    umd: "University of Maryland",
    universityofmaryland: "University of Maryland",
    universityofmarylandcollegepark: "University of Maryland",
    marylandcollegepark: "University of Maryland",
    rutgersuniversity: "Rutgers",
    uiuc: "Illinois",
    universityofillinois: "Illinois",
    umich: "Michigan",
    universityofmichigan: "Michigan",
    indianauniversity: "Indiana",
    indianauniversitybloomington: "Indiana University",
    indianauniversitybloomingtonindianauniversity: "Indiana University",
    northwesternuniversity: "Northwestern",
    ohiostateuniversity: "Ohio State",
    psu: "Penn State",
    pennstateuniversity: "Penn State",
    msu: "Michigan State",
    michiganstateuniversity: "Michigan State",
    universityofwashington: "Washington",
    // Big West locked canonical aliases
    ucsantabarbara: "UC Santa Barbara",
    ucsb: "UC Santa Barbara",
    csunorthridge: "CSU Northridge",
    csun: "CSU Northridge",
    universityofhawaii: "Hawaii",
    hawaiiatmanoa: "Hawaii",
    ucirvine: "UC Irvine",
    uci: "UC Irvine",
    ucdavis: "UC Davis",
    ucd: "UC Davis",
    calpoly: "Cal Poly",
    calpolystate: "Cal Poly",
    csufullerton: "CSU Fullerton",
    calstatefullerton: "CSU Fullerton",
    fullerton: "CSU Fullerton",
    csubakersfield: "California State University Bakersfield",
    calstatebakersfield: "California State University Bakersfield",
    ucsandiego: "University of California San Diego",
    ucsd: "University of California San Diego",
    universityofcaliforniasandiego: "University of California San Diego",
    lbsu: "Long Beach State",
    longbeachstateuniversity: "Long Beach State",
    ucriverside: "UC Riverside",
    ucr: "UC Riverside",
    // Coastal Athletic Association locked canonical aliases
    uncw: "University of North Carolina Wilmington",
    universityofnorthcarolinawilmington: "University of North Carolina Wilmington",
    towsonuniversity: "Towson",
    collegeofcharleston: "College of Charleston",
    cofc: "College of Charleston",
    elonuniversity: "Elon",
    williamandmary: "William and Mary",
    collegeofwilliamandmary: "William and Mary",
    campbelluniversity: "Campbell",
    northeasternuniversity: "Northeastern",
    monmouthuniversity: "Monmouth",
    northcarolinaat: "North Carolina A&T",
    northcarolinaaandt: "North Carolina A&T",
    northcarolinastateat: "North Carolina A&T",
    northcarolinastateaandt: "North Carolina A&T",
    ncat: "North Carolina A&T",
    hofstrauniversity: "Hofstra",
    stonybrookuniversity: "Stony Brook",
    sunystonybrook: "Stony Brook",
    // Conference USA locked canonical aliases
    jacksonvillestateuniversity: "Jacksonville State",
    jsu: "Jacksonville State",
    libertyuniversity: "Liberty",
    middletennesseestateuniversity: "Middle Tennessee State",
    mtsu: "Middle Tennessee State",
    missouristateuniversity: "Missouri State",
    dallasbaptist: "Dallas Baptist University",
    dbu: "Dallas Baptist University",
    westernkentuckyuniversity: "Western Kentucky",
    wku: "Western Kentucky",
    louisianatechuniversity: "Louisiana Tech",
    latech: "Louisiana Tech",
    samhoustonstateuniversity: "Sam Houston State",
    shu: "Sam Houston State",
    floridainternational: "Florida International",
    floridainternationaluniversity: "Florida International",
    fiu: "Florida International",
    newmexicostateuniversity: "New Mexico State",
    nmstate: "New Mexico State",
    kennesawstateuniversity: "Kennesaw State",
    universityofdelaware: "Delaware",
    udel: "Delaware",
    // Ivy League locked canonical aliases
    yaleuniversity: "Yale",
    dartmouthcollege: "Dartmouth",
    columbiauniversity: "Columbia",
    princetonuniversity: "Princeton",
    brownuniversity: "Brown",
    universityofpennsylvania: "Pennsylvania",
    upenn: "Pennsylvania",
    penn: "Pennsylvania",
    cornelluniversity: "Cornell",
    harvarduniversity: "Harvard",
    // Metro Atlantic Athletic Conference (MAAC) locked canonical aliases
    rideruniversity: "Rider",
    manhattancollege: "Manhattan",
    manhattanuniversity: "Manhattan",
    mountsaintmarys: "Mount St. Mary's",
    mountstmarys: "Mount St. Mary's",
    mountsaintmarysuniversity: "Mount St. Mary's",
    ionauniversity: "Iona",
    sienacollege: "Siena",
    merrimackcollege: "Merrimack",
    canisiusuniversity: "Canisius",
    quinnipiacuniversity: "Quinnipiac",
    niagarauniversity: "Niagara",
    fairfielduniversity: "Fairfield",
    sacredheartuniversity: "Sacred Heart",
    stpeters: "St. Peters",
    saintpeters: "St. Peters",
    saintpetersuniversity: "St. Peters",
    maristcollege: "Marist",
    maristuniversity: "Marist",
    // Mid-American Conference (MAC) locked canonical aliases
    kentstateuniversity: "Kent State",
    miamiofohio: "Miami (OH)",
    miamiohio: "Miami (OH)",
    miamioh: "Miami (OH)",
    miamiuniversityohio: "Miami (OH)",
    northernillinoisuniversity: "Northern Illinois",
    niu: "Northern Illinois",
    umass: "UMass",
    universityofmassachusetts: "UMass",
    umassamherst: "UMass",
    centralmichiganuniversity: "Central Michigan",
    akronuniversity: "Akron",
    universityofakron: "Akron",
    ballstateuniversity: "Ball State",
    westernmichiganuniversity: "Western Michigan",
    toledouniversity: "Toledo",
    universityoftoledo: "Toledo",
    easternmichiganuniversity: "Eastern Michigan",
    bowlinggreenstateuniversity: "Bowling Green",
    bowlinggreenohio: "Bowling Green",
    // Missouri Valley Conference (MVC) locked canonical aliases
    murraystateuniversity: "Murray State",
    illinoisstateuniversity: "Illinois State",
    indianastateuniversity: "Indiana State",
    valparaisouniversity: "Valparaiso",
    southernillinoisuniversity: "Southern Illinois",
    siu: "Southern Illinois",
    illinoischicago: "Illinois Chicago",
    universityillinoischicago: "Illinois Chicago",
    universityofillinoischicago: "Illinois Chicago",
    uic: "Illinois Chicago",
    belmontuniversity: "Belmont",
    bradleyuniversity: "Bradley",
    universityofevansville: "Evansville",
    // Mountain West locked canonical aliases
    universityofnewmexico: "New Mexico",
    unm: "New Mexico",
    universityofnevadalasvegas: "UNLV",
    unlv: "UNLV",
    sandiegostateuniversity: "San Diego State",
    sdsu: "San Diego State",
    fresnostateuniversity: "Fresno State",
    californiastateuniversityfresno: "Fresno State",
    universityofnevadareno: "Nevada",
    unreno: "Nevada",
    grandcanyonuniversity: "Grand Canyon",
    gcu: "Grand Canyon",
    washingtonstateuniversity: "Washington State",
    wsu: "Washington State",
    sanjosestateuniversity: "San Jose State",
    sjsu: "San Jose State",
    unitedstatesairforceacademy: "Air Force",
    airforceacademy: "Air Force",
    // Northeast Conference (NEC) locked canonical aliases
    centralconnecticutstateuniversity: "Central Connecticut State",
    ccsu: "Central Connecticut State",
    fairleighdickinsonuniversity: "Fairleigh Dickinson",
    fdu: "Fairleigh Dickinson",
    norfolkstateuniversity: "Norfolk State",
    comptonstate: "Coppin State",
    coppinstate: "Coppin State",
    coppinstateuniversity: "Coppin State",
    longislanduniversity: "Long Island University",
    liu: "Long Island University-Brooklyn",
    liubrooklyn: "Long Island University-Brooklyn",
    longislanduniversitybrooklyn: "Long Island University-Brooklyn",
    brooklyncollege: "Long Island University-Brooklyn",
    universityofnewhaven: "University of New Haven",
    marylandeasternshore: "Maryland Eastern Shore",
    universityofmarylandeasternshore: "Maryland Eastern Shore",
    umes: "Maryland Eastern Shore",
    wagnercollege: "Wagner",
    mercyhurstuniversity: "Mercyhurst",
    stonehillcollege: "Stonehill",
    lemoynecollege: "Le Moyne",
    lemoyne: "Le Moyne",
    delawarestateuniversity: "Delaware State",
    // Ohio Valley Conference (OVC) locked canonical aliases
    universityofsouthernindiana: "Southern Indiana",
    southernindianauniversity: "Southern Indiana",
    tennesseetechuniversity: "Tennessee Tech",
    southeasternmissouristate: "Southeast Missouri State",
    southeastmissouristate: "Southeast Missouri State",
    southeastmissoutistate: "Southeast Missouri State",
    semo: "Southeast Missouri State",
    universityofarkansaslittlerock: "University of Arkansas Little Rock",
    arkansaslittlerock: "University of Arkansas Little Rock",
    littlerock: "University of Arkansas Little Rock",
    utmartin: "UT Martin",
    universityoftennesseemartin: "UT Martin",
    easternillinoisuniversity: "Eastern Illinois",
    moreheadstateuniversity: "Morehead State",
    lindenwooduniversity: "Lindenwood",
    southernindianaedwardsville: "SIU Edwardsville",
    southernillinoisedwardsville: "SIU Edwardsville",
    southernillinoisuniversityedwardsville: "SIU Edwardsville",
    siue: "SIU Edwardsville",
    westernillinoisuniversity: "Western Illinois",
    // Patriot League locked canonical aliases
    unitedstatesnavalacademy: "Navy",
    usnavalacademy: "Navy",
    usna: "Navy",
    armywestpoint: "Army",
    unitedstatesmilitaryacademy: "Army",
    usma: "Army",
    lehighuniversity: "Lehigh",
    collegeoftheholycross: "Holy Cross",
    holycrossuniversity: "Holy Cross",
    bucknelluniversity: "Bucknell",
    lafayettecollege: "Lafayette",
    // Southeastern Conference (SEC) locked canonical aliases
    universityoftexas: "Texas",
    universityoftexasataustin: "Texas",
    ut: "Texas",
    texasam: "Texas A&M",
    texasaandm: "Texas A&M",
    texasamuniversity: "Texas A&M",
    universityofmississippi: "Ole Miss",
    uf: "Florida",
    universityofflorida: "Florida",
    mississippistateuniversity: "Mississippi State",
    msst: "Mississippi State",
    universityofoklahoma: "Oklahoma",
    uk: "Kentucky",
    universityofkentucky: "Kentucky",
    universityofmissouri: "Missouri",
    mizzou: "Missouri",
    auburnuniversity: "Auburn",
    universityofalabama: "Alabama",
    louisianastate: "Louisiana State",
    louisianastateuniversity: "Louisiana State",
    universityofgeorgia: "Georgia",
    georgiauniversity: "Georgia",
    universityofgeoriga: "Georgia",
    georiga: "Georgia",
    universityofarkansas: "Arkansas",
    universityoftennessee: "Tennessee",
    universityofsouthcarolina: "South Carolina",
    southcarolinauniversity: "South Carolina",
    vanderbiltuniversity: "Vanderbilt",
    // Southern Conference (SoCon) locked canonical aliases
    merceruniversity: "Mercer",
    virginiamilitaryinstitute: "Virginia Military Institute",
    vmi: "Virginia Military Institute",
    easttennesseestateuniversity: "East Tennessee State",
    etsu: "East Tennessee State",
    woffordcollege: "Wofford",
    westerncarolinauniversity: "Western Carolina",
    thecitadel: "The Citadel",
    citadel: "The Citadel",
    uncgreensboro: "UNC Greensboro",
    universityofnorthcarolinagreensboro: "UNC Greensboro",
    samford: "Samford",
    samforduniversity: "Samford",
    sanford: "Samford",
    // Southland Conference locked canonical aliases
    stephenfaustinstate: "Stephen F Austin State",
    stephenfaustinstateuniversity: "Stephen F Austin State",
    sfa: "Stephen F Austin State",
    lamaruniversity: "Lamar",
    texasamcorpuschristi: "Texas A&M Corpus Christi",
    texasaandmcorpuschristi: "Texas A&M Corpus Christi",
    tamucc: "Texas A&M Corpus Christi",
    mcneesestate: "McNeese State",
    mcneesestateuniversity: "McNeese State",
    universityofincarnateword: "Incarnate Word",
    uiw: "Incarnate Word",
    northwesternstateuniversity: "Northwestern State",
    southeasternlouisianauniversity: "Southeastern Louisiana",
    nichollsstate: "Nicholls State",
    nichollsstateuniversity: "Nicholls State",
    houstonchristianuniversity: "Houston Christian",
    houstonbaptist: "Houston Christian",
    hcu: "Houston Christian",
    universityoftexasriograndevalley: "University of Texas Rio Grande Valley",
    utriograndevalley: "University of Texas Rio Grande Valley",
    utriogrande: "University of Texas Rio Grande Valley",
    universityofneworleans: "New Orleans",
    uno: "New Orleans",
    // Southwestern Athletic Conference (SWAC) locked canonical aliases
    bethunecookmanuniversity: "Bethune-Cookman",
    jacksonstateuniversity: "Jackson State",
    alabamastateuniversity: "Alabama State",
    texassouthernuniversity: "Texas Southern",
    alabamaam: "Alabama A&M",
    alabamaaandm: "Alabama A&M",
    alabamaamuniversity: "Alabama A&M",
    universityofarkansaspinebluff: "Arkansas Pine Bluff",
    arkansaspinebluff: "Arkansas Pine Bluff",
    uapb: "Arkansas Pine Bluff",
    floridaam: "Florida A&M",
    floridaaandm: "Florida A&M",
    floridaamuniversity: "Florida A&M",
    famu: "Florida A&M",
    prairieviewam: "Prairie View A&M",
    prairieviewaandm: "Prairie View A&M",
    prairieviewamuniversity: "Prairie View A&M",
    pvam: "Prairie View A&M",
    southernuniversity: "Southern",
    gramblingstateuniversity: "Grambling State",
    mississippivalleystateuniversity: "Mississippi Valley State",
    alcornstateuniversity: "Alcorn State",
    // Sun Belt Conference locked canonical aliases
    southernmiss: "Southern Miss",
    southernmississippi: "Southern Miss",
    universityofsouthernmississippi: "Southern Miss",
    usm: "Southern Miss",
    universityofsouthalabama: "South Alabama",
    usa: "South Alabama",
    arkansasstateuniversity: "Arkansas State",
    texassateuniversity: "Texas State",
    texasstateuniversity: "Texas State",
    louisianalafayette: "Louisiana",
    universityoflouisianalafayette: "Louisiana",
    ulafayette: "Louisiana",
    louisiana: "Louisiana",
    appalachianstateuniversity: "Appalachian State",
    appstate: "Appalachian State",
    coastalcarolinauniversity: "Coastal Carolina",
    georgiastateuniversity: "Georgia State",
    olddominionuniversity: "Old Dominion",
    odu: "Old Dominion",
    marshalluniversity: "Marshall",
    universityoflouisianamonroe: "University of Louisiana Monroe",
    ulmonroe: "University of Louisiana Monroe",
    ulm: "University of Louisiana Monroe",
    louisianamonroe: "University of Louisiana Monroe",
    troyuniversity: "Troy",
    jamesmadisonuniversity: "James Madison",
    jmu: "James Madison",
    georgiasouthernuniversity: "Georgia Southern",
    // The Summit League locked canonical aliases
    oralrobertsuniversity: "Oral Roberts",
    oru: "Oral Roberts",
    southdakotastateuniversity: "South Dakota State",
    sdsujackrabbits: "South Dakota State",
    universityofnebraskaomaha: "Omaha",
    nebraskaomaha: "Omaha",
    omahauniversity: "Omaha",
    universityofstthomasminnesota: "University of St. Thomas",
    stthomasminnesota: "University of St. Thomas",
    ust: "University of St. Thomas",
    northdakotastateuniversity: "North Dakota State",
    ndsu: "North Dakota State",
    northerncoloradouniversity: "Northern Colorado",
    unco: "Northern Colorado",
    // West Coast Conference (WCC) locked canonical aliases
    saintmarys: "Saint Mary's",
    stmarys: "Saint Mary's",
    saintmaryscollege: "Saint Mary's",
    sanfrancisco: "San Francisco",
    universityofsanfrancisco: "San Francisco",
    usfca: "San Francisco",
    universityofsandiego: "San Diego",
    usd: "San Diego",
    universityofportland: "Portland",
    universityofthepacific: "Pacific",
    pacificuniversity: "Pacific",
    santaclarauniversity: "Santa Clara",
    gonzagauniversity: "Gonzaga",
    loyolamarymountuniversity: "Loyola Marymount",
    lmu: "Loyola Marymount",
    pepperdineuniversity: "Pepperdine",
    seattleuniversity: "Seattle",
    // Western Athletic Conference (WAC) locked canonical aliases
    californiabaptistuniversity: "California Baptist",
    cbu: "California Baptist",
    utahtechuniversity: "Utah Tech",
    dixiestate: "Utah Tech",
    tarletonstateuniversity: "Tarleton State",
    abilenechristianuniversity: "Abilene Christian",
    acu: "Abilene Christian",
    utahvalleyuniversity: "Utah Valley",
    uvu: "Utah Valley",
    universityoftexasarlington: "University of Texas Arlington",
    utarlington: "University of Texas Arlington",
    uta: "University of Texas Arlington",
    sacramentostateuniversity: "Sacramento State",
    sacstate: "Sacramento State",
  };
  const normalizeCanonicalKey = (value: string) =>
    value
      .toLowerCase()
      .replace(/\ba&m\b/g, "am")
      .replace(/\but\b/g, "texas")
      .replace(/\bnc\b/g, "north carolina")
      .replace(/\bsc\b/g, "south carolina")
      .replace(/\bint'?l\b/g, "international")
      .replace(/\bsaint\b/g, "st")
      .replace(/\bst[.]?\b/g, "state")
      .replace(/\brio grande valley\b/g, "riograndevalley")
      .replace(/\bthe\b|\bof\b|\bat\b|\band\b/g, " ")
      .replace(/university|college|school/gi, "")
      .replace(/[^a-z0-9]/g, "")
      .trim();
  const canonicalTokens = (value: string) =>
    value
      .toLowerCase()
      .replace(/[()\-/,]/g, " ")
      .replace(/\bsaint\b/g, "st")
      .replace(/\bst[.]?\b/g, "state")
      .replace(/\bthe\b|\bof\b|\bat\b|\band\b/g, " ")
      .replace(/university|college|school/gi, " ")
      .split(/\s+/)
      .filter(Boolean);
  const acronymKey = (value: string) => {
    const words = value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .filter((w) => !["university", "college", "the", "of", "at", "and"].includes(w));
    return words.map((w) => w[0]).join("");
  };
  const resolveCanonicalTeamName = (input: string) => {
    const raw = (input || "").trim();
    if (!raw) return raw;
    const key = normalizeCanonicalKey(raw);
    if (!key) return raw;
    // Hard disambiguation: "California" must never map to UCLA.
    if (key === "california") return "California";
    if (key === "californialosangeles") return "University of California Los Angeles";
    if (TEAM_ALIASES[key]) return TEAM_ALIASES[key];

    const candidates = canonicalTeamNames.filter((name) => {
      const ckey = normalizeCanonicalKey(name);
      return ckey === key || ckey.includes(key) || key.includes(ckey);
    });
    if (candidates.length === 1) return candidates[0];

    // Match acronym/short form (e.g. LSU, UTRGV) to a unique canonical school.
    const keyAcr = acronymKey(raw);
    const acronymMatches = canonicalTeamNames.filter((name) => acronymKey(name) === keyAcr);
    if (acronymMatches.length === 1) return acronymMatches[0];
    const looseAcronymMatches = canonicalTeamNames.filter((name) => {
      const a = acronymKey(name);
      return a.startsWith(keyAcr) || keyAcr.startsWith(a);
    });
    if (keyAcr.length >= 2 && looseAcronymMatches.length === 1) return looseAcronymMatches[0];

    // Token-prefix matching for shortened forms (e.g. "Miss St", "UT Rio Grande").
    const rawTokens = canonicalTokens(raw);
    if (rawTokens.length > 0) {
      const tokenMatches = canonicalTeamNames.filter((name) => {
        const cTokens = canonicalTokens(name);
        return rawTokens.every((rt) => cTokens.some((ct) => ct.startsWith(rt)));
      });
      if (tokenMatches.length === 1) return tokenMatches[0];
    }

    return raw;
  };
  const normalizeConferenceName = (input: string | null | undefined) => {
    const raw = (input || "").trim();
    if (!raw) return "";
    const key = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
    const map: Record<string, string> = {
      acc: "Atlantic Coast Conference",
      atlanticcoastconference: "Atlantic Coast Conference",
      aac: "American Athletic Conference",
      americanaeast: "America East",
      americaeast: "America East",
      americanathleticconference: "American Athletic Conference",
      a10: "Atlantic 10",
      atlantic10: "Atlantic 10",
      caa: "Coastal Athletic Association",
      coastalathleticassociation: "Coastal Athletic Association",
      bigtenconference: "Big Ten",
      bigten: "Big Ten",
      coastalathleticconference: "Coastal Athletic Association",
      coastalalthleticconference: "Coastal Athletic Association",
      coastalathletic: "Coastal Athletic Association",
    };
    if (map[key]) return map[key];
    return raw;
  };
  const LOCKED_TEAM_CONFERENCES: Record<string, string> = {
    // America East
    "New Jersey Institute of Technology": "America East",
    "University of Maryland, Baltimore County": "America East",
    "Bryant University": "America East",
    Binghamton: "America East",
    "UMass Lowell": "America East",
    Albany: "America East",
    Maine: "America East",
    // American Athletic
    UTSA: "American Athletic Conference",
    "South Florida": "American Athletic Conference",
    "Wichita State": "American Athletic Conference",
    Charlotte: "American Athletic Conference",
    UAB: "American Athletic Conference",
    Rice: "American Athletic Conference",
    Tulane: "American Athletic Conference",
    "East Carolina": "American Athletic Conference",
    "Florida Atlantic": "American Athletic Conference",
    Memphis: "American Athletic Conference",
    // Atlantic 10
    Dayton: "Atlantic 10",
    LaSalle: "Atlantic 10",
    Richmond: "Atlantic 10",
    "George Mason": "Atlantic 10",
    VCU: "Atlantic 10",
    Davidson: "Atlantic 10",
    "George Washington": "Atlantic 10",
    "St. Joseph's": "Atlantic 10",
    "St. Louis": "Atlantic 10",
    "St. Bonaventure": "Atlantic 10",
    Fordham: "Atlantic 10",
    "Rhode Island": "Atlantic 10",
    // ACC
    "Georgia Tech": "ACC",
    "Wake Forest": "ACC",
    Clemson: "ACC",
    Virginia: "ACC",
    "North Carolina": "ACC",
    "North Carolina State": "ACC",
    "Florida State": "ACC",
    Pittsburgh: "ACC",
    Miami: "ACC",
    Duke: "ACC",
    California: "ACC",
    "Notre Dame": "ACC",
    "Boston College": "ACC",
    Louisville: "ACC",
    "Virginia Tech": "ACC",
    Stanford: "ACC",
    // ASUN
    "Florida Gulf Coast": "ASUN",
    Jacksonville: "ASUN",
    "Central Arkansas": "ASUN",
    "North Florida": "ASUN",
    "Austin Peay": "ASUN",
    "North Alabama": "ASUN",
    Lipscomb: "ASUN",
    Stetson: "ASUN",
    "Queens University of Charlotte": "ASUN",
    "Eastern Kentucky": "ASUN",
    Bellarmine: "ASUN",
    "West Georgia": "ASUN",
    // Big 12
    Cincinnati: "Big 12",
    "West Virginia": "Big 12",
    "Arizona State": "Big 12",
    "Oklahoma State": "Big 12",
    Kansas: "Big 12",
    "Kansas State": "Big 12",
    "Texas Tech": "Big 12",
    TCU: "Big 12",
    Houston: "Big 12",
    "Central Florida": "Big 12",
    Utah: "Big 12",
    Baylor: "Big 12",
    BYU: "Big 12",
    "University of Arizona": "Big 12",
    // Big East
    Georgetown: "Big East",
    UConn: "Big East",
    "Seton Hall": "Big East",
    Xavier: "Big East",
    Creighton: "Big East",
    Villanova: "Big East",
    Butler: "Big East",
    "Saint John's": "Big East",
    // Big South
    Longwood: "Big South",
    "Charleston Southern": "Big South",
    Winthrop: "Big South",
    "Gardner Webb": "Big South",
    Radford: "Big South",
    "High Point": "Big South",
    "University of North Carolina Asheville": "Big South",
    "South Carolina Upstate": "Big South",
    Presbyterian: "Big South",
    // Big Ten
    "University of Southern California": "Big Ten",
    "University of California Los Angeles": "Big Ten",
    UCLA: "Big Ten",
    Oregon: "Big Ten",
    Minnesota: "Big Ten",
    Iowa: "Big Ten",
    Purdue: "Big Ten",
    Nebraska: "Big Ten",
    "University of Maryland": "Big Ten",
    Rutgers: "Big Ten",
    Illinois: "Big Ten",
    Michigan: "Big Ten",
    Indiana: "Big Ten",
    Northwestern: "Big Ten",
    "Ohio State": "Big Ten",
    "Penn State": "Big Ten",
    "Michigan State": "Big Ten",
    Washington: "Big Ten",
    // Big West
    "UC Santa Barbara": "Big West",
    "CSU Northridge": "Big West",
    Hawaii: "Big West",
    "UC Irvine": "Big West",
    "UC Davis": "Big West",
    "Cal Poly": "Big West",
    "CSU Fullerton": "Big West",
    "California State University Bakersfield": "Big West",
    "University of California San Diego": "Big West",
    "Long Beach State": "Big West",
    "UC Riverside": "Big West",
    // CAA
    "University of North Carolina Wilmington": "Coastal Athletic Association",
    Towson: "Coastal Athletic Association",
    "College of Charleston": "Coastal Athletic Association",
    Elon: "Coastal Athletic Association",
    "William and Mary": "Coastal Athletic Association",
    Campbell: "Coastal Athletic Association",
    Northeastern: "Coastal Athletic Association",
    Monmouth: "Coastal Athletic Association",
    "North Carolina State A&T": "Coastal Athletic Association",
    Hofstra: "Coastal Athletic Association",
    "Stony Brook": "Coastal Athletic Association",
    // CUSA
    "Jacksonville State": "CUSA",
    Liberty: "CUSA",
    "Middle Tennessee State": "CUSA",
    "Missouri State": "CUSA",
    "Dallas Baptist University": "CUSA",
    "Western Kentucky": "CUSA",
    "Louisiana Tech": "CUSA",
    "Sam Houston State": "CUSA",
    "Florida International": "CUSA",
    "New Mexico State": "CUSA",
    "Kennesaw State": "CUSA",
    Delaware: "CUSA",
    // Independent
    "Oregon State": "Independent",
    // Ivy
    Yale: "Ivy League",
    Dartmouth: "Ivy League",
    Columbia: "Ivy League",
    Princeton: "Ivy League",
    Brown: "Ivy League",
    Pennsylvania: "Ivy League",
    Cornell: "Ivy League",
    Harvard: "Ivy League",
    // MAAC
    Rider: "MAAC",
    Manhattan: "MAAC",
    "Mount St. Mary's": "MAAC",
    Iona: "MAAC",
    Siena: "MAAC",
    Merrimack: "MAAC",
    Canisius: "MAAC",
    Quinnipiac: "MAAC",
    Niagara: "MAAC",
    Fairfield: "MAAC",
    "Sacred Heart": "MAAC",
    "St. Peters": "MAAC",
    Marist: "MAAC",
    // MAC
    "Kent State": "MAC",
    "Miami (OH)": "MAC",
    "Northern Illinois": "MAC",
    UMass: "MAC",
    "Central Michigan": "MAC",
    Akron: "MAC",
    "Ball State": "MAC",
    "Western Michigan": "MAC",
    Toledo: "MAC",
    "Eastern Michigan": "MAC",
    "Bowling Green": "MAC",
    // MVC
    "Murray State": "MVC",
    "Illinois State": "MVC",
    "Indiana State": "MVC",
    Valparaiso: "MVC",
    "Southern Illinois": "MVC",
    "Illinois Chicago": "MVC",
    Belmont: "MVC",
    Bradley: "MVC",
    Evansville: "MVC",
    // Mountain West
    "New Mexico": "Mountain West",
    UNLV: "Mountain West",
    "San Diego State": "Mountain West",
    "Fresno State": "Mountain West",
    Nevada: "Mountain West",
    "Grand Canyon": "Mountain West",
    "Washington State": "Mountain West",
    "San Jose State": "Mountain West",
    "Air Force": "Mountain West",
    // NEC
    "Central Connecticut State": "NEC",
    "Fairleigh Dickinson": "NEC",
    "Norfolk State": "NEC",
    "Coppin State": "NEC",
    "Long Island University-Brooklyn": "NEC",
    "University of New Haven": "NEC",
    "Maryland Eastern Shore": "NEC",
    Wagner: "NEC",
    Mercyhurst: "NEC",
    Stonehill: "NEC",
    "Le Moyne": "NEC",
    "Delaware State": "NEC",
    // OVC
    "Southern Indiana": "OVC",
    "Tennessee Tech": "OVC",
    "Southeast Missouri State": "OVC",
    "University of Arkansas Little Rock": "OVC",
    "UT Martin": "OVC",
    "Eastern Illinois": "OVC",
    "Morehead State": "OVC",
    Lindenwood: "OVC",
    "University of Southern Indiana Edwardsville": "OVC",
    "Western Illinois": "OVC",
    // Patriot
    Navy: "Patriot League",
    Army: "Patriot League",
    Lehigh: "Patriot League",
    "Holy Cross": "Patriot League",
    Bucknell: "Patriot League",
    Lafayette: "Patriot League",
    // SEC
    Texas: "SEC",
    "Texas A&M": "SEC",
    "Ole Miss": "SEC",
    Florida: "SEC",
    "Mississippi State": "SEC",
    Oklahoma: "SEC",
    Kentucky: "SEC",
    Missouri: "SEC",
    Auburn: "SEC",
    Alabama: "SEC",
    "Louisiana State": "SEC",
    Georgia: "SEC",
    Arkansas: "SEC",
    Tennessee: "SEC",
    "South Carolina": "SEC",
    Vanderbilt: "SEC",
    // SoCon
    Mercer: "SoCon",
    "Virginia Military Institute": "SoCon",
    "East Tennessee State": "SoCon",
    Wofford: "SoCon",
    "Western Carolina": "SoCon",
    "The Citadel": "SoCon",
    "UNC Greensboro": "SoCon",
    Samford: "SoCon",
    // Southland
    "Stephen F Austin State": "Southland",
    Lamar: "Southland",
    "Texas A&M Corpus Christi": "Southland",
    "McNeese State": "Southland",
    "Incarnate Word": "Southland",
    "Northwestern State": "Southland",
    "Southeastern Louisiana": "Southland",
    "Nicholls State": "Southland",
    "Houston Christian": "Southland",
    "University of Texas Rio Grande Valley": "Southland",
    "New Orleans": "Southland",
    // SWAC
    "Bethune-Cookman": "SWAC",
    "Jackson State": "SWAC",
    "Alabama State": "SWAC",
    "Texas Southern": "SWAC",
    "Alabama A&M": "SWAC",
    "Arkansas Pine Bluff": "SWAC",
    "Florida A&M": "SWAC",
    "Prairie View A&M": "SWAC",
    Southern: "SWAC",
    "Grambling State": "SWAC",
    "Mississippi Valley State": "SWAC",
    "Alcorn State": "SWAC",
    // Sun Belt
    "Southern Miss": "Sun Belt",
    "South Alabama": "Sun Belt",
    "Arkansas State": "Sun Belt",
    "Texas State": "Sun Belt",
    Louisiana: "Sun Belt",
    "Appalachian State": "Sun Belt",
    "Coastal Carolina": "Sun Belt",
    "Georgia State": "Sun Belt",
    "Old Dominion": "Sun Belt",
    Marshall: "Sun Belt",
    "University of Louisiana Monroe": "Sun Belt",
    Troy: "Sun Belt",
    "James Madison": "Sun Belt",
    "Georgia Southern": "Sun Belt",
    // Summit
    "Oral Roberts": "Summit League",
    "South Dakota State": "Summit League",
    Omaha: "Summit League",
    "University of St. Thomas": "Summit League",
    "North Dakota State": "Summit League",
    "Northern Colorado": "Summit League",
    // WCC
    "Saint Mary's": "WCC",
    "San Francisco": "WCC",
    "San Diego": "WCC",
    Portland: "WCC",
    Pacific: "WCC",
    "Santa Clara": "WCC",
    Gonzaga: "WCC",
    "Loyola Marymount": "WCC",
    Pepperdine: "WCC",
    Seattle: "WCC",
    // WAC
    "California Baptist": "WAC",
    "Utah Tech": "WAC",
    "Tarleton State": "WAC",
    "Abilene Christian": "WAC",
    "Utah Valley": "WAC",
    "University of Texas Arlington": "WAC",
    "Sacramento State": "WAC",
    // Explicit disambiguation
    "University of California": "ACC",
  };
  const isOregonStateTeam = (name: string) => {
    const key = normalizeCanonicalKey(resolveCanonicalTeamName(name || ""));
    return key === "oregonstate";
  };
  const getLockedConferenceForTeam = (name: string) => {
    const canonical = resolveCanonicalTeamName(name || "");
    const key = normalizeCanonicalKey(canonical);
    for (const [teamName, conference] of Object.entries(LOCKED_TEAM_CONFERENCES)) {
      if (normalizeCanonicalKey(teamName) === key) return normalizeConferenceName(conference);
    }
    return null;
  };
  const seedTeamDefaults = useMemo(() => {
    const byKey = new Map<string, { name: string; conferenceCounts: Map<string, number> }>();
    for (const r of storage2025Seed as Array<{ team: string | null; conference?: string | null }>) {
      const rawTeam = (r.team || "").trim();
      if (!rawTeam) continue;
      const canonicalName = resolveCanonicalTeamName(rawTeam);
      const key = normalizeCanonicalKey(canonicalName || rawTeam);
      if (!byKey.has(key)) {
        byKey.set(key, { name: canonicalName || rawTeam, conferenceCounts: new Map() });
      }
      const conf = ((r.conference as string | null) || "").trim();
      if (!conf) continue;
      const normalizedConf = normalizeConferenceName(conf);
      const counts = byKey.get(key)!.conferenceCounts;
      counts.set(normalizedConf, (counts.get(normalizedConf) || 0) + 1);
    }
    return Array.from(byKey.entries()).map(([key, value]) => {
      const bestConference =
        Array.from(value.conferenceCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      return { key, name: value.name, conference: bestConference };
    });
  }, [canonicalTeamNames]);

  const { data: teams = [], isLoading } = useQuery({
    queryKey: ["admin-teams"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, conference, park_factor")
        .order("name");
      if (error) throw error;
      return (data || []) as TeamRow[];
    },
  });

  const dedupeTeamsInDb = async () => {
    const { data: allTeams, error } = await supabase
      .from("teams")
      .select("id, name, conference, park_factor");
    if (error) throw error;

    type TeamRec = { id: string; name: string; conference: string | null; park_factor: number | null };
    const byKey = new Map<string, TeamRec[]>();
    for (const t of (allTeams || []) as TeamRec[]) {
      const canonicalName = resolveCanonicalTeamName(t.name);
      const key = normalizeCanonicalKey(canonicalName || t.name);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(t);
    }

    let mergedGroups = 0;
    let removedRows = 0;
    for (const [, group] of byKey) {
      if (group.length <= 1) continue;
      mergedGroups++;
      const canonical = resolveCanonicalTeamName(group[0].name);

      const confCounts = new Map<string, number>();
      for (const row of group) {
        const conf = (row.conference || "").trim();
        if (!conf) continue;
        confCounts.set(conf, (confCounts.get(conf) || 0) + 1);
      }
      const bestConferenceRaw = Array.from(confCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const bestConference = bestConferenceRaw ? normalizeConferenceName(bestConferenceRaw) : null;
      const bestParkFactor = group.find((r) => r.park_factor != null)?.park_factor ?? null;

      const primary = [...group].sort((a, b) => {
        const aScore =
          (resolveCanonicalTeamName(a.name) === canonical ? 4 : 0) +
          (a.conference ? 2 : 0) +
          (a.park_factor != null ? 1 : 0);
        const bScore =
          (resolveCanonicalTeamName(b.name) === canonical ? 4 : 0) +
          (b.conference ? 2 : 0) +
          (b.park_factor != null ? 1 : 0);
        return bScore - aScore;
      })[0];

      const duplicateIds = group.filter((r) => r.id !== primary.id).map((r) => r.id);
      if (duplicateIds.length > 0) {
        const { error: delErr } = await supabase.from("teams").delete().in("id", duplicateIds);
        if (delErr) throw delErr;
        removedRows += duplicateIds.length;
      }

      // Update the remaining row after duplicates are removed to avoid teams_name_key collisions.
      const desiredName = canonical || primary.name;
      const { error: upErr } = await supabase
        .from("teams")
        .update({
          name: desiredName,
          conference: bestConference,
          park_factor: bestParkFactor,
        })
        .eq("id", primary.id);
      if (upErr) {
        // If a name collision still exists outside this group, keep current name and only apply data merge.
        const { error: fallbackErr } = await supabase
          .from("teams")
          .update({
            conference: bestConference,
            park_factor: bestParkFactor,
          })
          .eq("id", primary.id);
        if (fallbackErr) throw fallbackErr;
      }
    }

    // Fill missing conferences from canonical-key peers, then ensure no blanks remain.
    const { data: afterDedupeTeams, error: refetchError } = await supabase
      .from("teams")
      .select("id, name, conference");
    if (refetchError) throw refetchError;

    const conferenceByKey = new Map<string, Map<string, number>>();
    for (const t of (afterDedupeTeams || []) as Array<{ id: string; name: string; conference: string | null }>) {
      const conf = normalizeConferenceName(t.conference).trim();
      if (!conf) continue;
      const key = normalizeCanonicalKey(resolveCanonicalTeamName(t.name));
      if (!conferenceByKey.has(key)) conferenceByKey.set(key, new Map());
      const counts = conferenceByKey.get(key)!;
      counts.set(conf, (counts.get(conf) || 0) + 1);
    }

    for (const t of (afterDedupeTeams || []) as Array<{ id: string; name: string; conference: string | null }>) {
      const conf = normalizeConferenceName(t.conference).trim();
      if (conf) continue;
      const key = normalizeCanonicalKey(resolveCanonicalTeamName(t.name));
      const counts = conferenceByKey.get(key);
      const best = counts ? Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] : null;
      const nextConf = normalizeConferenceName(best || (isOregonStateTeam(t.name) ? "Independent" : "Unknown"));
      const { error: fillErr } = await supabase.from("teams").update({ conference: nextConf }).eq("id", t.id);
      if (fillErr) throw fillErr;
    }

    return { mergedGroups, removedRows };
  };

  const updateTeam = useMutation({
    mutationFn: async ({ id, name, conference, parkFactorInput }: { id: string; name: string; conference: string; parkFactorInput: string }) => {
      const manualName = name.trim();
      if (!manualName) throw new Error("Team name is required.");
      const normalizedConference = normalizeConferenceName(conference) || "Unknown";
      const parkRaw = parkFactorInput.trim();
      let parkFactor: number | null = null;
      if (parkRaw !== "") {
        const parsed = Number.parseFloat(parkRaw);
        if (!Number.isFinite(parsed)) throw new Error("Park factor must be numeric or blank.");
        parkFactor = parsed > 3 ? parsed / 100 : parsed;
      }
      const { error } = await supabase
        .from("teams")
        .update({ name: manualName, conference: normalizedConference, park_factor: parkFactor })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-teams"] });
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      setEditingId(null);
      toast.success("Team updated");
    },
    onError: (e) => toast.error(`Failed: ${e.message}`),
  });

  const deleteTeam = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("teams").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-teams"] });
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      toast.success("Team deleted");
    },
    onError: (e) => toast.error(`Failed: ${e.message}`),
  });

  const addTeam = useMutation({
    mutationFn: async ({ name, conference }: { name: string; conference: string }) => {
      const manualName = name.trim();
      if (!manualName) throw new Error("Team name is required.");
      const normalizedConference = normalizeConferenceName(conference);
      const { error } = await supabase
        .from("teams")
        .insert({ name: manualName, conference: normalizedConference || null });
      if (!error) return { mode: "inserted" as const };

      // If the team already exists, do not modify it automatically.
      const code = (error as { code?: string }).code;
      if (code === "23505" || (error.message || "").toLowerCase().includes("teams_name_key")) {
        return { mode: "exists" as const };
      }

      throw error;
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["admin-teams"] });
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      setNewTeamName("");
      setNewTeamConf("");
      setShowAddForm(false);
      if (res.mode === "exists") toast.success("Team already exists. No changes made.");
      else toast.success("Team added");
    },
    onError: (e) => toast.error(`Failed: ${e.message}`),
  });

  const fillConferencesFromPlayers = useMutation({
    mutationFn: async () => {
      const { data: players, error: playersError } = await supabase
        .from("players")
        .select("team, conference")
        .not("team", "is", null)
        .not("conference", "is", null);
      if (playersError) throw playersError;

      const byTeam = new Map<string, Map<string, number>>();
      const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
      for (const p of (players || [])) {
        const team = (p.team || "").trim();
        const conf = normalizeConferenceName(p.conference).trim();
        if (!team || !conf) continue;
        const key = norm(resolveCanonicalTeamName(team));
        if (!byTeam.has(key)) byTeam.set(key, new Map());
        const confCounts = byTeam.get(key)!;
        confCounts.set(conf, (confCounts.get(conf) || 0) + 1);
      }

      let updated = 0;
      for (const t of teams) {
        if (t.conference && t.conference.trim()) continue;
        const key = norm(resolveCanonicalTeamName(t.name));
        const confCounts = byTeam.get(key);
        if (!confCounts || confCounts.size === 0) continue;
        const best = Array.from(confCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
        if (!best) continue;
        const { error } = await supabase.from("teams").update({ conference: normalizeConferenceName(best) }).eq("id", t.id);
        if (error) throw error;
        updated++;
      }

      // Ensure every team has a conference label, even if we cannot infer one yet.
      const { data: stillBlank, error: blankErr } = await supabase
        .from("teams")
        .select("id,name")
        .or("conference.is.null,conference.eq.");
      if (blankErr) throw blankErr;

      let defaulted = 0;
      for (const row of stillBlank || []) {
        const defaultConference = normalizeConferenceName(
          isOregonStateTeam((row as { name?: string }).name || "") ? "Independent" : "Unknown",
        );
        const { error } = await supabase.from("teams").update({ conference: defaultConference }).eq("id", row.id);
        if (error) throw error;
        defaulted++;
      }

      return { updated, defaulted };
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["admin-teams"] });
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      toast.success(`Filled conference for ${res.updated} teams (${res.defaulted} set to Unknown).`);
    },
    onError: (e) => toast.error(`Conference fill failed: ${e.message}`),
  });

  const importTeamParkFactors = useMutation({
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

      const normalizedRows = lines.map((line) =>
        parseCsvLine(line).map((c) => c.toLowerCase().replace(/\s+/g, " ").trim()),
      );
      const scanRows = normalizedRows.slice(0, Math.min(normalizedRows.length, 12));
      const findColumn = (pred: (cell: string) => boolean) => {
        for (let r = 0; r < scanRows.length; r++) {
          const row = scanRows[r];
          for (let c = 0; c < row.length; c++) {
            if (pred(row[c])) return { row: r, col: c };
          }
        }
        return null;
      };
      const teamCell = findColumn((cell) => ["team", "team name", "school"].includes(cell));
      const parkCell = findColumn((cell) =>
        cell.includes("park factor+") ||
        cell === "park factor wrc+" ||
        cell === "3-year avg impact" ||
        cell === "3 year avg impact" ||
        cell === "3-yr avg impact" ||
        cell === "3yr avg impact",
      );
      const obpCell = findColumn((cell) =>
        (cell.includes("obp") || cell.includes("on base")) &&
        (cell.includes("impact") || cell.includes("park factor")),
      );
      const isoCell = findColumn((cell) =>
        (cell.includes("iso") || cell.includes("isolated power")) &&
        (cell.includes("impact") || cell.includes("park factor")),
      );
      const eraCell = findColumn((cell) =>
        (cell.includes("r/g") || cell.includes("runs per game") || cell.includes("era")) &&
        (cell.includes("impact") || cell.includes("park factor")),
      );
      const whipCell = findColumn((cell) =>
        cell.includes("whip") && (cell.includes("impact") || cell.includes("park factor")),
      );
      const hr9Cell = findColumn((cell) =>
        (cell.includes("hr/9") || cell.includes("hr9") || cell.includes("home run per 9")) &&
        (cell.includes("impact") || cell.includes("park factor")),
      );
      if (!teamCell) {
        throw new Error("CSV must include a Team column.");
      }

      const hasHittingColumns = !!(parkCell && obpCell && isoCell);
      const hasPitchingColumns = !!(eraCell && whipCell && hr9Cell);
      if (!hasHittingColumns && !hasPitchingColumns) {
        throw new Error(
          "CSV must include either hitting park factors (AVG/OBP/ISO) or pitching park factors (R/G+, WHIP+, HR/9+).",
        );
      }

      const teamIdx = teamCell.col;
      const parkPlusIdx = parkCell?.col ?? -1;
      const obpIdx = obpCell?.col ?? -1;
      const isoIdx = isoCell?.col ?? -1;
      const eraIdx = eraCell?.col ?? -1;
      const whipIdx = whipCell?.col ?? -1;
      const hr9Idx = hr9Cell?.col ?? -1;
      const dataStartIndex = [
        teamCell.row,
        parkCell?.row ?? 0,
        obpCell?.row ?? 0,
        isoCell?.row ?? 0,
        eraCell?.row ?? 0,
        whipCell?.row ?? 0,
        hr9Cell?.row ?? 0,
      ].reduce((m, v) => Math.max(m, v), 0) + 1;

      const normalizeTeamKey = (v: string) =>
        v.toLowerCase().replace(/[^a-z0-9]/g, "");
      const parseNum = (v: string | undefined) => {
        if (!v) return null;
        const n = Number.parseFloat(v.replace(/[%,$]/g, "").trim());
        return Number.isFinite(n) ? n : null;
      };

      const { data: existingTeams, error: existingError } = await supabase
        .from("teams")
        .select("id, name, conference");
      if (existingError) throw existingError;
      const existingNames = (existingTeams || []).map((t) => t.name);
      const suggestTeamName = (csvName: string) => {
        const targetKey = normalizeCanonicalKey(resolveCanonicalTeamName(csvName || ""));
        if (!targetKey) return null;
        const exact = existingNames.find((n) => normalizeCanonicalKey(resolveCanonicalTeamName(n)) === targetKey);
        if (exact) return exact;
        const soft = existingNames.find((n) => {
          const k = normalizeCanonicalKey(resolveCanonicalTeamName(n));
          return k.includes(targetKey) || targetKey.includes(k);
        });
        return soft || null;
      };
      const byNorm = new Map<string, { id: string; name: string; conference: string | null }>();
      for (const t of (existingTeams || [])) {
        const rawKey = normalizeTeamKey(t.name);
        const canonicalKey = normalizeTeamKey(resolveCanonicalTeamName(t.name));
        if (!byNorm.has(rawKey)) byNorm.set(rawKey, t);
        if (!byNorm.has(canonicalKey)) byNorm.set(canonicalKey, t);
      }

      const toUpdateById = new Map<string, number | null>();
      const unmatchedTeams = new Set<string>();
      let processed = 0;
      let matched = 0;

      for (let i = dataStartIndex; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i]);
        const originalTeam = (cols[teamIdx] || "").trim();
        const team = resolveCanonicalTeamName(originalTeam);
        if (!team) continue;
        const avgPlus = hasHittingColumns ? parseNum(cols[parkPlusIdx]) : null;
        const obpPlus = hasHittingColumns ? parseNum(cols[obpIdx]) : null;
        const isoPlus = hasHittingColumns ? parseNum(cols[isoIdx]) : null;
        const eraPlus = hasPitchingColumns ? parseNum(cols[eraIdx]) : null;
        const whipPlus = hasPitchingColumns ? parseNum(cols[whipIdx]) : null;
        const hr9Plus = hasPitchingColumns ? parseNum(cols[hr9Idx]) : null;
        const avgFactor = avgPlus == null ? null : avgPlus / 100;
        const obpFactor = obpPlus == null ? null : obpPlus / 100;
        const isoFactor = isoPlus == null ? null : isoPlus / 100;
        const eraFactor = eraPlus == null ? null : eraPlus / 100;
        const whipFactor = whipPlus == null ? null : whipPlus / 100;
        const hr9Factor = hr9Plus == null ? null : hr9Plus / 100;
        const key = normalizeTeamKey(team);
        const existing = byNorm.get(key);
        if (existing) {
          matched++;
          if (hasHittingColumns) {
            toUpdateById.set(existing.id, avgFactor);
          }
          // TODO: Write per-metric park factors (obp, iso, era, whip, hr9) to Supabase park_factors table
          // Previously stored in localStorage via writeTeamParkFactorComponents — now handled by Supabase
        } else {
          unmatchedTeams.add(originalTeam || team);
        }
        processed++;
      }

      const toUpdate = Array.from(toUpdateById.entries()).map(([id, park_factor]) => ({ id, park_factor }));
      for (let i = 0; i < toUpdate.length; i += 200) {
        const chunk = toUpdate.slice(i, i + 200);
        for (const row of chunk) {
          const { error } = await supabase.from("teams").update({ park_factor: row.park_factor }).eq("id", row.id);
          if (error) throw error;
        }
      }
      return {
        processed,
        updated: hasHittingColumns ? toUpdate.length : matched,
        skippedUnmatched: unmatchedTeams.size,
        unmatchedPreview: Array.from(unmatchedTeams).slice(0, 5),
        unmatchedDetails: Array.from(unmatchedTeams)
          .sort((a, b) => a.localeCompare(b))
          .map((name) => ({ csvName: name, suggestedTeam: suggestTeamName(name) })),
      };
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["admin-teams"] });
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      setLastParkImportUnmatched(res.unmatchedDetails || []);
      const suffix =
        res.skippedUnmatched > 0
          ? `, ${res.skippedUnmatched} unmatched skipped${res.unmatchedPreview.length ? ` (${res.unmatchedPreview.join(", ")})` : ""}`
          : "";
      toast.success(`Imported team park factors: ${res.updated} updated (${res.processed} rows processed${suffix}).`);
    },
    onError: (e) => toast.error(`Team CSV import failed: ${e.message}`),
  });

  const dedupeTeams = useMutation({
    mutationFn: dedupeTeamsInDb,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["admin-teams"] });
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      toast.success(`Deduplicated teams: ${res.removedRows} duplicate rows removed across ${res.mergedGroups} schools.`);
    },
    onError: (e) => toast.error(`Deduplicate failed: ${e.message}`),
  });
  const resetTeamImport = useMutation({
    mutationFn: async () => {
      const { data: allTeams, error } = await supabase
        .from("teams")
        .select("id, name, conference, park_factor");
      if (error) throw error;

      type TeamRec = { id: string; name: string; conference: string | null; park_factor: number | null };
      const byKey = new Map<string, TeamRec[]>();
      for (const t of (allTeams || []) as TeamRec[]) {
        const canonical = resolveCanonicalTeamName(t.name);
        const key = normalizeCanonicalKey(canonical || t.name);
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key)!.push(t);
      }

      let removedRows = 0;
      for (const [, group] of byKey) {
        const canonicalName = resolveCanonicalTeamName(group[0].name);
        const primary = [...group].sort((a, b) => {
          const aScore = (a.conference ? 2 : 0) + (a.park_factor != null ? 1 : 0);
          const bScore = (b.conference ? 2 : 0) + (b.park_factor != null ? 1 : 0);
          return bScore - aScore;
        })[0];
        const duplicateIds = group.filter((r) => r.id !== primary.id).map((r) => r.id);

        if (duplicateIds.length > 0) {
          const { error: delErr } = await supabase.from("teams").delete().in("id", duplicateIds);
          if (delErr) throw delErr;
          removedRows += duplicateIds.length;
        }

        const normalizedConference = normalizeConferenceName(
          isOregonStateTeam(canonicalName) ? "Independent" : primary.conference,
        );
        const { error: upErr } = await supabase
          .from("teams")
          .update({
            name: canonicalName || primary.name,
            conference: normalizedConference && normalizedConference.trim() ? normalizedConference : "Unknown",
            park_factor: null, // restart park-factor import from clean slate
          })
          .eq("id", primary.id);
        if (upErr) throw upErr;
      }

      return { removedRows, retainedRows: byKey.size };
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["admin-teams"] });
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      toast.success(`Team import reset complete: ${res.removedRows} duplicates removed, ${res.retainedRows} canonical teams kept.`);
    },
    onError: (e) => toast.error(`Reset team import failed: ${e.message}`),
  });
  const resetTeamsToSeed = useMutation({
    mutationFn: async () => {
      await dedupeTeamsInDb();

      const desiredByKey = new Map(
        seedTeamDefaults.map((t) => {
          const conf = t.conference || (isOregonStateTeam(t.name) ? "Independent" : "Unknown");
          return [t.key, { name: t.name, conference: normalizeConferenceName(conf) }];
        }),
      );

      const { data: allTeams, error } = await supabase.from("teams").select("id, name, conference, park_factor");
      if (error) throw error;

      let removed = 0;
      let updated = 0;
      let inserted = 0;
      const keptKeys = new Set<string>();

      for (const t of allTeams || []) {
        const key = normalizeCanonicalKey(resolveCanonicalTeamName(t.name));
        const desired = desiredByKey.get(key);
        if (!desired) {
          const { error: delErr } = await supabase.from("teams").delete().eq("id", t.id);
          if (delErr) throw delErr;
          removed++;
          continue;
        }
        if (keptKeys.has(key)) {
          const { error: delDupErr } = await supabase.from("teams").delete().eq("id", t.id);
          if (delDupErr) throw delDupErr;
          removed++;
          continue;
        }
        keptKeys.add(key);

        const nextConference = desired.conference || "Unknown";
        const needsUpdate =
          t.name !== desired.name ||
          (t.conference || "") !== nextConference ||
          t.park_factor !== null;
        if (needsUpdate) {
          const { error: upErr } = await supabase
            .from("teams")
            .update({
              name: desired.name,
              conference: nextConference,
              park_factor: null,
            })
            .eq("id", t.id);
          if (upErr) throw upErr;
          updated++;
        }
      }

      for (const [key, desired] of desiredByKey.entries()) {
        if (keptKeys.has(key)) continue;
        const { error: insErr } = await supabase.from("teams").insert({
          name: desired.name,
          conference: desired.conference || "Unknown",
          park_factor: null,
        });
        if (insErr) throw insErr;
        inserted++;
      }

      await dedupeTeamsInDb();
      return { removed, updated, inserted, totalSeedTeams: desiredByKey.size };
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["admin-teams"] });
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      toast.success(
        `Reset to seed complete: ${res.removed} removed, ${res.updated} updated, ${res.inserted} inserted (${res.totalSeedTeams} baseline teams).`,
      );
    },
    onError: (e) => toast.error(`Reset to seed failed: ${e.message}`),
  });
  const applyLockedTeamStandards = useMutation({
    mutationFn: async () => {
      const { data: allTeams, error } = await supabase.from("teams").select("id, name, conference, park_factor");
      if (error) throw error;

      let updated = 0;
      let inserted = 0;
      for (const t of allTeams || []) {
        const canonicalName = resolveCanonicalTeamName(t.name);
        const lockedConference = getLockedConferenceForTeam(canonicalName);
        const nextConference =
          lockedConference ||
          (isOregonStateTeam(canonicalName) ? "Independent" : normalizeConferenceName(t.conference || "") || "Unknown");
        const needsUpdate =
          t.name !== canonicalName ||
          (t.conference || "") !== nextConference;
        if (!needsUpdate) continue;
        const { error: upErr } = await supabase
          .from("teams")
          .update({ name: canonicalName, conference: nextConference })
          .eq("id", t.id);
        if (upErr) throw upErr;
        updated++;
      }

      // Ensure every locked canonical team exists at least once.
      const existingKeys = new Set(
        (allTeams || []).map((t) => normalizeCanonicalKey(resolveCanonicalTeamName(t.name))),
      );
      const canonicalLockedTeams = new Map<string, { name: string; conference: string }>();
      for (const [teamName, conference] of Object.entries(LOCKED_TEAM_CONFERENCES)) {
        const canonicalName = resolveCanonicalTeamName(teamName);
        const key = normalizeCanonicalKey(canonicalName);
        if (!key) continue;
        if (!canonicalLockedTeams.has(key)) {
          canonicalLockedTeams.set(key, {
            name: canonicalName,
            conference: normalizeConferenceName(conference),
          });
        }
      }
      for (const [key, row] of canonicalLockedTeams.entries()) {
        if (existingKeys.has(key)) continue;
        const { error: insErr } = await supabase.from("teams").insert({
          name: row.name,
          conference: row.conference,
          park_factor: null,
        });
        if (insErr) throw insErr;
        inserted++;
      }

      const dedupe = await dedupeTeamsInDb();
      return { updated, inserted, dedupe };
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["admin-teams"] });
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      toast.success(
        `Applied locked team standards: ${res.updated} updated, ${res.inserted} inserted, ${res.dedupe?.removedRows || 0} duplicates removed.`,
      );
    },
    onError: (e) => toast.error(`Apply locked standards failed: ${e.message}`),
  });

  const filtered = useMemo(() => {
    let list = teams;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((t) =>
        t.name.toLowerCase().includes(q) ||
        normalizeConferenceName(t.conference).toLowerCase().includes(q),
      );
    }
    if (confFilter !== "all") {
      if (confFilter === "unassigned") list = list.filter((t) => !normalizeConferenceName(t.conference));
      else list = list.filter((t) => normalizeConferenceName(t.conference) === confFilter);
    }
    if (parkFilter !== "all") {
      if (parkFilter === "blank") list = list.filter((t) => t.park_factor == null);
      else if (parkFilter === "filled") list = list.filter((t) => t.park_factor != null);
    }
    return list;
  }, [teams, search, confFilter, parkFilter, resolveCanonicalTeamName]);
  const teamParkComponents = parkMap;
  const formatParkDisplay = useCallback((value: number | null | undefined) => {
    if (value == null || !Number.isFinite(value)) return "";
    const scaled = Math.abs(value) <= 3 ? value * 100 : value;
    return String(Math.round(scaled));
  }, []);
  const blankParkFactorRows = useMemo(() => {
    return teams
      .map((t) => {
        const avg = resolveMetricParkFactor(t.id, "avg", teamParkComponents, t.name);
        const obp = resolveMetricParkFactor(t.id, "obp", teamParkComponents, t.name);
        const iso = resolveMetricParkFactor(t.id, "iso", teamParkComponents, t.name);
        const era = resolveMetricParkFactor(t.id, "era", teamParkComponents, t.name);
        const whip = resolveMetricParkFactor(t.id, "whip", teamParkComponents, t.name);
        const hr9 = resolveMetricParkFactor(t.id, "hr9", teamParkComponents, t.name);
        if (avg != null && obp != null && iso != null && era != null && whip != null && hr9 != null) return null;
        return {
          team: t.name,
          conference: normalizeConferenceName(t.conference),
          avg_pf: formatParkDisplay(avg),
          obp_pf: formatParkDisplay(obp),
          iso_pf: formatParkDisplay(iso),
          era_pf: formatParkDisplay(era),
          whip_pf: formatParkDisplay(whip),
          hr9_pf: formatParkDisplay(hr9),
        };
      })
      .filter(Boolean) as Array<{ team: string; conference: string; avg_pf: string; obp_pf: string; iso_pf: string; era_pf: string; whip_pf: string; hr9_pf: string }>;
  }, [teams, teamParkComponents, formatParkDisplay]);
  const equalParkFactorRows = useMemo(() => {
    const eq = (a: number, b: number) => Math.abs(a - b) < 1e-9;
    return teams
      .map((t) => {
        const avg = resolveMetricParkFactor(t.id, "avg", teamParkComponents, t.name);
        const obp = resolveMetricParkFactor(t.id, "obp", teamParkComponents, t.name);
        const iso = resolveMetricParkFactor(t.id, "iso", teamParkComponents, t.name);
        if (avg == null || obp == null || iso == null) return null;
        if (!eq(avg, obp) || !eq(avg, iso)) return null;
        return {
          team: t.name,
          conference: normalizeConferenceName(t.conference),
          avg_pf: formatParkDisplay(avg),
          obp_pf: formatParkDisplay(obp),
          iso_pf: formatParkDisplay(iso),
        };
      })
      .filter(Boolean) as Array<{ team: string; conference: string; avg_pf: string; obp_pf: string; iso_pf: string }>;
  }, [teams, teamParkComponents, formatParkDisplay]);
  const equalPitchingParkFactorRows = useMemo(() => {
    return teams
      .map((t) => {
        const era = resolveMetricParkFactor(t.id, "era", teamParkComponents, t.name);
        const whip = resolveMetricParkFactor(t.id, "whip", teamParkComponents, t.name);
        const hr9 = resolveMetricParkFactor(t.id, "hr9", teamParkComponents, t.name);
        const eraDisplay = formatParkDisplay(era);
        const whipDisplay = formatParkDisplay(whip);
        const hr9Display = formatParkDisplay(hr9);
        if (!eraDisplay || !whipDisplay || !hr9Display) return null;
        if (!(eraDisplay === whipDisplay && eraDisplay === hr9Display)) return null;
        return {
          team: t.name,
          conference: normalizeConferenceName(t.conference),
          rg_pf: eraDisplay,
          whip_pf: whipDisplay,
          hr9_pf: hr9Display,
        };
      })
      .filter(Boolean) as Array<{ team: string; conference: string; rg_pf: string; whip_pf: string; hr9_pf: string }>;
  }, [teams, teamParkComponents, formatParkDisplay]);

  const downloadCsv = useCallback((filename: string, header: string[], rows: string[][]) => {
    const esc = (s: string) => {
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [header.join(","), ...rows.map((r) => r.map((c) => esc(c ?? "")).join(","))];
    const blob = new Blob([`${lines.join("\n")}\n`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const confCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    teams.forEach((t) => {
      const c = normalizeConferenceName(t.conference) || "Unassigned";
      counts[c] = (counts[c] || 0) + 1;
    });
    return counts;
  }, [teams]);

  const uniqueConfs = useMemo(
    () =>
      [...new Set(teams.map((t) => normalizeConferenceName(t.conference)).filter(Boolean))].sort() as string[],
    [teams],
  );

  const startEdit = (team: TeamRow) => {
    setEditingId(team.id);
    setEditConf(team.conference || "");
    setEditName(team.name);
    setEditParkFactor(team.park_factor == null ? "" : String(Math.round(team.park_factor * 100)));
  };

  const saveEdit = (id: string) => {
    updateTeam.mutate({ id, name: editName, conference: editConf, parkFactorInput: editParkFactor });
  };

  return (
    <div className="space-y-4">
      {showAddForm && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="text-sm font-medium text-muted-foreground mb-1 block">Team Name</label>
                <Input value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} placeholder="e.g. University of Example" />
              </div>
              <div className="w-48">
                <label className="text-sm font-medium text-muted-foreground mb-1 block">Conference</label>
                <Select value={newTeamConf} onValueChange={setNewTeamConf}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    {CONFERENCES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => addTeam.mutate({ name: newTeamName, conference: newTeamConf })} disabled={!newTeamName.trim()} size="sm">
                Add
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowAddForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">All Teams</CardTitle>
          <div className="flex gap-2">
            <input
              ref={teamCsvInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                importTeamParkFactors.mutate(f);
                e.currentTarget.value = "";
              }}
            />
            <Select value={confFilter} onValueChange={setConfFilter}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Conferences</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {uniqueConfs.map((c) => (
                  <SelectItem key={c} value={c}>{c} ({confCounts[c] || 0})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={parkFilter} onValueChange={setParkFilter}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Park: All</SelectItem>
                <SelectItem value="blank">Park: Blank</SelectItem>
                <SelectItem value="filled">Park: Filled</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative w-full sm:w-64">
              <Input placeholder="Search teams..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Button
              onClick={() => teamCsvInputRef.current?.click()}
              size="sm"
              variant="outline"
            >
              {importTeamParkFactors.isPending ? "Importing CSV…" : "Import Teams CSV"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (!blankParkFactorRows.length) {
                  toast.success("No blank AVG/OBP/ISO park factors.");
                  return;
                }
                downloadCsv(
                  `blank_park_factor_audit_${new Date().toISOString().slice(0, 10)}.csv`,
                  ["Team", "Conference", "AVG PF", "OBP PF", "ISO PF", "R/G PF", "WHIP PF", "HR/9 PF"],
                  blankParkFactorRows.map((r) => [r.team, r.conference, r.avg_pf, r.obp_pf, r.iso_pf, r.era_pf, r.whip_pf, r.hr9_pf]),
                );
                toast.success(`Exported ${blankParkFactorRows.length} blank park-factor row(s).`);
              }}
            >
              Export Blank PF Audit
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (!equalParkFactorRows.length) {
                  toast.success("No teams have identical AVG/OBP/ISO park factors.");
                  return;
                }
                downloadCsv(
                  `equal_park_factor_audit_${new Date().toISOString().slice(0, 10)}.csv`,
                  ["Team", "Conference", "AVG PF", "OBP PF", "ISO PF"],
                  equalParkFactorRows.map((r) => [r.team, r.conference, r.avg_pf, r.obp_pf, r.iso_pf]),
                );
                toast.success(`Exported ${equalParkFactorRows.length} equal park-factor row(s).`);
              }}
            >
              Export Equal PF Audit
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (!equalPitchingParkFactorRows.length) {
                  toast.success("No teams have identical R/G, WHIP, and HR/9 park factors.");
                  return;
                }
                downloadCsv(
                  `equal_pitching_park_factor_audit_${new Date().toISOString().slice(0, 10)}.csv`,
                  ["Team", "Conference", "R/G PF", "WHIP PF", "HR/9 PF"],
                  equalPitchingParkFactorRows.map((r) => [r.team, r.conference, r.rg_pf, r.whip_pf, r.hr9_pf]),
                );
                toast.success(`Exported ${equalPitchingParkFactorRows.length} equal pitching park-factor row(s).`);
              }}
            >
              Export Equal Pitching PF
            </Button>
            {lastParkImportUnmatched.length > 0 ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  downloadCsv(
                    `unmatched_park_factor_names_${new Date().toISOString().slice(0, 10)}.csv`,
                    ["CSV Team Name", "Suggested Team Match"],
                    lastParkImportUnmatched.map((r) => [r.csvName, r.suggestedTeam || ""]),
                  );
                  toast.success(`Exported ${lastParkImportUnmatched.length} unmatched-name row(s).`);
                }}
              >
                Export Unmatched Names
              </Button>
            ) : null}
            <Button onClick={() => setShowAddForm((v) => !v)} size="sm" className="gap-1">
              <Plus className="h-4 w-4" />
              Add Team
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">Loading teams…</div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">No teams found</div>
          ) : (
            <div className="overflow-auto max-h-[60vh]">
              <Table>
                <TableHeader className="sticky top-0 z-20 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
                  <TableRow>
                    <TableHead className="min-w-[250px]">Team</TableHead>
                    <TableHead className="min-w-[90px] text-center">AVG PF</TableHead>
                    <TableHead className="min-w-[90px] text-center">OBP PF</TableHead>
                    <TableHead className="min-w-[90px] text-center">ISO PF</TableHead>
                    <TableHead className="min-w-[90px] text-center">R/G PF</TableHead>
                    <TableHead className="min-w-[90px] text-center">WHIP PF</TableHead>
                    <TableHead className="min-w-[90px] text-center">HR/9 PF</TableHead>
                    <TableHead className="min-w-[180px]">Conference</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((team) => (
                    <TableRow key={team.id}>
                      <TableCell className="font-medium">
                        {editingId === team.id ? (
                          <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8 w-full max-w-[280px]" />
                        ) : (
                          team.name
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {editingId === team.id ? (
                          <Input
                            value={editParkFactor}
                            onChange={(e) => setEditParkFactor(e.target.value)}
                            placeholder="blank"
                            className="h-8 w-24 text-center"
                          />
                        ) : (
                          <span className="text-sm tabular-nums">
                            {(() => {
                              const v = resolveMetricParkFactor(team.id, "avg", teamParkComponents, team.name);
                              return formatParkDisplay(v) || "—";
                            })()}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="text-sm tabular-nums">
                          {(() => {
                            const v = resolveMetricParkFactor(team.id, "obp", teamParkComponents, team.name);
                            return formatParkDisplay(v) || "—";
                          })()}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="text-sm tabular-nums">
                          {(() => {
                            const v = resolveMetricParkFactor(team.id, "iso", teamParkComponents, team.name);
                            return formatParkDisplay(v) || "—";
                          })()}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="text-sm tabular-nums">
                          {(() => {
                            const v = resolveMetricParkFactor(team.id, "era", teamParkComponents, team.name);
                            return formatParkDisplay(v) || "—";
                          })()}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="text-sm tabular-nums">
                          {(() => {
                            const v = resolveMetricParkFactor(team.id, "whip", teamParkComponents, team.name);
                            return formatParkDisplay(v) || "—";
                          })()}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="text-sm tabular-nums">
                          {(() => {
                            const v = resolveMetricParkFactor(team.id, "hr9", teamParkComponents, team.name);
                            return formatParkDisplay(v) || "—";
                          })()}
                        </span>
                      </TableCell>
                      <TableCell>
                        {editingId === team.id ? (
                          <Select value={editConf} onValueChange={setEditConf}>
                            <SelectTrigger className="w-44 h-8">
                              <SelectValue placeholder="Select conference" />
                            </SelectTrigger>
                            <SelectContent>
                              {CONFERENCES.map((c) => (
                                <SelectItem key={c} value={c}>{c}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : team.conference ? (
                          <Badge variant="secondary">{team.conference}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {editingId === team.id ? (
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => saveEdit(team.id)}>
                              <Check className="h-3.5 w-3.5 text-[hsl(var(--success))]" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingId(null)}>
                              <X className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(team)}>
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => {
                                if (confirm(`Delete "${team.name}"?`)) deleteTeam.mutate(team.id);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
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
  const [syncSeedLoading, setSyncSeedLoading] = useState(false);
  const [syncSeedResult, setSyncSeedResult] = useState<{ stats: number; power: number; linked: number } | null>(null);
  const linkCsvRef = useRef<HTMLInputElement | null>(null);
  const [linkCsvLoading, setLinkCsvLoading] = useState(false);
  const [linkCsvResult, setLinkCsvResult] = useState<{ teamsLinked: number; playersLinked: number; playersCreated: number; unmatched: string[] } | null>(null);
  const [syncPitchingLoading, setSyncPitchingLoading] = useState(false);
  const [syncPitchingResult, setSyncPitchingResult] = useState<{ stats: number; power: number } | null>(null);
  const masterCsvRef = useRef<HTMLInputElement | null>(null);
  const [masterCsvLoading, setMasterCsvLoading] = useState(false);
  const [masterCsvResult, setMasterCsvResult] = useState<{ cleared: boolean; stats: number; power: number; linked: number } | null>(null);

  const importMasterHitterCsv = async (file: File) => {
    setMasterCsvLoading(true);
    setMasterCsvResult(null);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) throw new Error("CSV has no data rows");

      // Parse header
      const header = lines[0].split(",").map((h) => h.trim());
      const col = (name: string) => header.indexOf(name);

      // Validate required columns
      const requiredCols = ["playerId", "playerFullName", "newestTeamLocation", "pos", "AVG", "OBP", "SLG", "ISO", "Contact%", "Line%", "ExitVel", "Popup%", "BB%", "Chase%", "Barrel%", "90thExitVel", "HPull%", "LA10-30%", "Ground%"];
      const missing = requiredCols.filter((c) => col(c) < 0);
      if (missing.length > 0) throw new Error(`Missing columns: ${missing.join(", ")}`);

      // Parse % values: "76.9%" → 76.9
      const parsePct = (v: string) => {
        const n = parseFloat(v.replace("%", ""));
        return isNaN(n) ? null : n;
      };
      const parseNum = (v: string) => {
        const n = parseFloat(v);
        return isNaN(n) ? null : n;
      };

      // Parse rows
      const statsRows: Array<any> = [];
      const powerRows: Array<any> = [];
      for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(",").map((v) => v.trim());
        const playerName = vals[col("playerFullName")];
        const team = vals[col("newestTeamLocation")];
        if (!playerName || !team) continue;

        statsRows.push({
          player_name: playerName,
          team,
          conference: null,
          season: 2025,
          avg: parseNum(vals[col("AVG")]),
          obp: parseNum(vals[col("OBP")]),
          slg: parseNum(vals[col("SLG")]),
          source: "master_csv_2025",
        });

        powerRows.push({
          player_name: playerName,
          team,
          season: 2025,
          position: vals[col("pos")] || null,
          contact: parsePct(vals[col("Contact%")]),
          line_drive: parsePct(vals[col("Line%")]),
          avg_exit_velo: parseNum(vals[col("ExitVel")]),
          pop_up: parsePct(vals[col("Popup%")]),
          bb: parsePct(vals[col("BB%")]),
          chase: parsePct(vals[col("Chase%")]),
          barrel: parsePct(vals[col("Barrel%")]),
          ev90: parseNum(vals[col("90thExitVel")]),
          pull: parsePct(vals[col("HPull%")]),
          la_10_30: parsePct(vals[col("LA10-30%")]),
          gb: parsePct(vals[col("Ground%")]),
          source: "master_csv_2025",
        });
      }

      if (statsRows.length === 0) throw new Error("No valid rows parsed from CSV");

      // Step 1: Clear existing 2025 data from both tables
      const { error: clearStatsErr } = await supabase
        .from("hitter_stats_storage")
        .delete()
        .eq("season", 2025);
      if (clearStatsErr) throw clearStatsErr;

      const { error: clearPowerErr } = await supabase
        .from("hitting_power_ratings_storage")
        .delete()
        .eq("season", 2025);
      if (clearPowerErr) throw clearPowerErr;

      // Step 2: Insert fresh data in chunks
      const chunkSize = 500;
      for (let i = 0; i < statsRows.length; i += chunkSize) {
        const { error } = await supabase
          .from("hitter_stats_storage")
          .upsert(statsRows.slice(i, i + chunkSize), { onConflict: "player_name,team,season" });
        if (error) throw error;
      }
      for (let i = 0; i < powerRows.length; i += chunkSize) {
        const { error } = await supabase
          .from("hitting_power_ratings_storage")
          .upsert(powerRows.slice(i, i + chunkSize), { onConflict: "player_name,team,season" });
        if (error) throw error;
      }

      // Step 3: Link player_id using source_player_id from CSV + name matching
      const normalize = (v: string | null | undefined) =>
        (v || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
      const normalizeTeamForKey = (team: string | null | undefined) => {
        const t = normalize(team);
        return t.replace(/\buniversity\b/g, "").replace(/\bof\b/g, "").replace(/\s+/g, " ").trim();
      };

      // Build source_player_id → player_id map from players table
      const allPlayers: Array<{ id: string; first_name: string; last_name: string; team: string | null; source_player_id: string | null }> = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("players")
          .select("id, first_name, last_name, team, source_player_id")
          .order("id", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const batch = data || [];
        allPlayers.push(...batch);
        if (batch.length < pageSize) break;
        from += pageSize;
      }

      // Build lookups: source_player_id → player_id, and name+team → player_id
      const playerIdBySourceId = new Map<string, string>();
      const playerIdByNameTeam = new Map<string, string>();
      const playerIdByName = new Map<string, string | null>();
      for (const p of allPlayers) {
        if (p.source_player_id) playerIdBySourceId.set(p.source_player_id, p.id);
        const fullName = normalize(`${p.first_name} ${p.last_name}`);
        playerIdByNameTeam.set(`${fullName}|${normalizeTeamForKey(p.team)}`, p.id);
        if (playerIdByName.has(fullName)) {
          playerIdByName.set(fullName, null);
        } else {
          playerIdByName.set(fullName, p.id);
        }
      }

      // Build CSV sourceId → playerName+team for matching
      const csvSourceIdToRow = new Map<string, { playerName: string; team: string }>();
      for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(",").map((v) => v.trim());
        const sourceId = vals[col("playerId")];
        const playerName = vals[col("playerFullName")];
        const team = vals[col("newestTeamLocation")];
        if (sourceId && playerName && team) csvSourceIdToRow.set(sourceId, { playerName, team });
      }

      // Match and update player_id on storage rows
      let linkedCount = 0;
      const linkBatch = async (table: string) => {
        const { data: unlinked } = await supabase
          .from(table)
          .select("id, player_name, team")
          .is("player_id", null)
          .eq("season", 2025);
        if (!unlinked || unlinked.length === 0) return 0;

        let count = 0;
        for (const row of unlinked) {
          // Try source_player_id first: find which CSV row matches this player
          let pid: string | undefined;
          for (const [srcId, info] of csvSourceIdToRow.entries()) {
            if (info.playerName === row.player_name && info.team === row.team) {
              pid = playerIdBySourceId.get(srcId);
              break;
            }
          }
          // Fallback: name+team matching
          if (!pid) {
            const ntKey = `${normalize(row.player_name)}|${normalizeTeamForKey(row.team)}`;
            pid = playerIdByNameTeam.get(ntKey) ?? playerIdByName.get(normalize(row.player_name)) ?? undefined;
          }
          if (pid) {
            await supabase.from(table).update({ player_id: pid }).eq("id", row.id);
            count++;
          }
        }
        return count;
      };

      linkedCount += await linkBatch("hitter_stats_storage");
      linkedCount += await linkBatch("hitting_power_ratings_storage");

      setMasterCsvResult({ cleared: true, stats: statsRows.length, power: powerRows.length, linked: linkedCount });
      toast.success(`Imported ${statsRows.length} hitters. Linked ${linkedCount} to player IDs.`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setMasterCsvLoading(false);
      if (masterCsvRef.current) masterCsvRef.current.value = "";
    }
  };

  const [createMissingLoading, setCreateMissingLoading] = useState(false);
  const [createMissingResult, setCreateMissingResult] = useState<{ created: number; linked: number; alreadyLinked: number } | null>(null);

  const masterPitchingCsvRef = useRef<HTMLInputElement | null>(null);
  const [masterPitchingLoading, setMasterPitchingLoading] = useState(false);
  const [masterPitchingResult, setMasterPitchingResult] = useState<{ stats: number; power: number; linked: number } | null>(null);

  const importMasterPitchingCsv = async (file: File) => {
    setMasterPitchingLoading(true);
    setMasterPitchingResult(null);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) throw new Error("CSV has no data rows");

      const header = lines[0].split(",").map((h) => h.trim());
      const col = (name: string) => header.indexOf(name);

      const requiredCols = ["playerId", "playerFullName", "newestTeamLocation", "throwsHand", "IP", "G", "GS", "ERA", "FIP", "WHIP", "K/9", "BB/9", "HR/9", "Stuff+", "Miss%", "BB%", "HardHit%", "InZoneWhiff%", "Chase%", "Barrel%", "Line%", "ExitVel", "Ground%", "InZone%", "90thVel", "HPull%", "LA10-30%"];
      const missing = requiredCols.filter((c) => col(c) < 0);
      if (missing.length > 0) throw new Error(`Missing columns: ${missing.join(", ")}`);

      const parsePct = (v: string) => { const n = parseFloat(v.replace("%", "")); return isNaN(n) ? null : n; };
      const parseNum = (v: string) => { const n = parseFloat(v); return isNaN(n) ? null : n; };

      const statsRows: Array<any> = [];
      const powerRows: Array<any> = [];
      for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(",").map((v) => v.trim());
        // Handle quoted fields (e.g. "Indiana University, Bloomington")
        const rawLine = lines[i];
        const parsedVals: string[] = [];
        let inQuote = false;
        let curr = "";
        for (const ch of rawLine) {
          if (ch === '"') { inQuote = !inQuote; continue; }
          if (ch === "," && !inQuote) { parsedVals.push(curr.trim()); curr = ""; continue; }
          curr += ch;
        }
        parsedVals.push(curr.trim());
        const v = parsedVals;

        const playerName = v[col("playerFullName")];
        const team = v[col("newestTeamLocation")];
        if (!playerName || !team) continue;

        const gNum = parseNum(v[col("G")]);
        const gsNum = parseNum(v[col("GS")]);
        const derivedRole = gNum != null && gNum > 0 && gsNum != null ? ((gsNum / gNum) < 0.5 ? "RP" : "SP") : "P";

        statsRows.push({
          player_name: playerName,
          team,
          handedness: v[col("throwsHand")] || null,
          role: derivedRole,
          season: 2025,
          era: parseNum(v[col("ERA")]),
          fip: parseNum(v[col("FIP")]),
          whip: parseNum(v[col("WHIP")]),
          k9: parseNum(v[col("K/9")]),
          bb9: parseNum(v[col("BB/9")]),
          hr9: parseNum(v[col("HR/9")]),
          ip: parseNum(v[col("IP")]),
          g: gNum != null ? Math.round(gNum) : null,
          gs: gsNum != null ? Math.round(gsNum) : null,
        });

        powerRows.push({
          player_name: playerName,
          team,
          season: 2025,
          stuff_plus: parseNum(v[col("Stuff+")]),
          whiff_pct: parsePct(v[col("Miss%")]),
          bb_pct: parsePct(v[col("BB%")]),
          hh_pct: parsePct(v[col("HardHit%")]),
          iz_whiff_pct: parsePct(v[col("InZoneWhiff%")]),
          chase_pct: parsePct(v[col("Chase%")]),
          barrel_pct: parsePct(v[col("Barrel%")]),
          ld_pct: parsePct(v[col("Line%")]),
          avg_exit_velo: parseNum(v[col("ExitVel")]),
          gb_pct: parsePct(v[col("Ground%")]),
          iz_pct: parsePct(v[col("InZone%")]),
          ev90: parseNum(v[col("90thVel")]),
          pull_pct: parsePct(v[col("HPull%")]),
          la_10_30_pct: parsePct(v[col("LA10-30%")]),
        });
      }

      if (statsRows.length === 0) throw new Error("No valid rows parsed");

      // Clear existing 2025 pitching data
      const { error: clearStats } = await supabase.from("pitching_stats_storage").delete().eq("season", 2025);
      if (clearStats) throw clearStats;
      const { error: clearPower } = await supabase.from("pitching_power_ratings_storage").delete().eq("season", 2025);
      if (clearPower) throw clearPower;

      // Insert stats
      const chunkSize = 500;
      for (let i = 0; i < statsRows.length; i += chunkSize) {
        const { error } = await supabase.from("pitching_stats_storage").upsert(statsRows.slice(i, i + chunkSize), { onConflict: "player_name,team,season" });
        if (error) throw error;
      }
      // Insert power ratings
      for (let i = 0; i < powerRows.length; i += chunkSize) {
        const { error } = await supabase.from("pitching_power_ratings_storage").upsert(powerRows.slice(i, i + chunkSize), { onConflict: "player_name,team,season" });
        if (error) throw error;
      }

      // Link player_ids
      const normalize = (v: string | null | undefined) =>
        (v || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
      const normalizeTeamForKey = (team: string | null | undefined) => {
        const t = normalize(team);
        return t.replace(/\buniversity\b/g, "").replace(/\bof\b/g, "").replace(/\s+/g, " ").trim();
      };

      const allPlayers: Array<{ id: string; first_name: string; last_name: string; team: string | null; source_player_id: string | null }> = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase.from("players").select("id, first_name, last_name, team, source_player_id").order("id", { ascending: true }).range(from, from + 999);
        if (error) throw error;
        allPlayers.push(...(data || []));
        if (!data || data.length < 1000) break;
        from += 1000;
      }

      const playerIdByNameTeam = new Map<string, string>();
      const playerIdByName = new Map<string, string | null>();
      for (const p of allPlayers) {
        const fullName = normalize(`${p.first_name} ${p.last_name}`);
        playerIdByNameTeam.set(`${fullName}|${normalizeTeamForKey(p.team)}`, p.id);
        if (playerIdByName.has(fullName)) playerIdByName.set(fullName, null);
        else playerIdByName.set(fullName, p.id);
      }

      let linkedCount = 0;
      for (const table of ["pitching_stats_storage", "pitching_power_ratings_storage"] as const) {
        const allRows: Array<any> = [];
        let rFrom = 0;
        while (true) {
          const { data } = await supabase.from(table).select("id, player_name, team").is("player_id", null).eq("season", 2025).range(rFrom, rFrom + 999);
          allRows.push(...(data || []));
          if (!data || data.length < 1000) break;
          rFrom += 1000;
        }
        for (const row of allRows) {
          const ntKey = `${normalize(row.player_name)}|${normalizeTeamForKey(row.team)}`;
          const pid = playerIdByNameTeam.get(ntKey) ?? playerIdByName.get(normalize(row.player_name));
          if (pid) {
            await supabase.from(table).update({ player_id: pid }).eq("id", row.id);
            linkedCount++;
          }
        }
      }

      setMasterPitchingResult({ stats: statsRows.length, power: powerRows.length, linked: linkedCount });
      toast.success(`Imported ${statsRows.length} pitchers. Linked ${linkedCount} to player IDs.`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setMasterPitchingLoading(false);
      if (masterPitchingCsvRef.current) masterPitchingCsvRef.current.value = "";
    }
  };

  // --- Update Stuff+ from CSV ---
  const stuffPlusCsvRef = useRef<HTMLInputElement | null>(null);
  const [stuffPlusLoading, setStuffPlusLoading] = useState(false);
  const [stuffPlusResult, setStuffPlusResult] = useState<{ updated: number; notFound: number; skipped: number } | null>(null);

  const importStuffPlusCsv = async (file: File) => {
    setStuffPlusLoading(true);
    setStuffPlusResult(null);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 3) throw new Error("CSV has no data rows (need header + blank + data)");

      const parseLine = (raw: string): string[] => {
        const out: string[] = [];
        let inQuote = false;
        let curr = "";
        for (const ch of raw) {
          if (ch === '"') { inQuote = !inQuote; continue; }
          if (ch === "," && !inQuote) { out.push(curr.trim()); curr = ""; continue; }
          curr += ch;
        }
        out.push(curr.trim());
        return out;
      };

      const norm = (v: string) => (v || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

      // Fetch ALL existing pitching power ratings (paginated)
      const allRows: Array<{ id: string; player_name: string; team: string }> = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("pitching_power_ratings_storage")
          .select("id, player_name, team")
          .eq("season", 2025)
          .range(from, from + 999);
        if (error) throw error;
        allRows.push(...(data || []));
        if (!data || data.length < 1000) break;
        from += 1000;
      }

      // Build normalized lookup: "normalized_name|normalized_team" → id
      const lookup = new Map<string, string>();
      // Also build name-only fallback for cases where team differs slightly
      const nameOnly = new Map<string, string>();
      for (const row of allRows) {
        const key = `${norm(row.player_name)}|${norm(row.team)}`;
        lookup.set(key, row.id);
        // Name-only (last resort) — only set if not ambiguous
        const nk = norm(row.player_name);
        if (nameOnly.has(nk)) {
          nameOnly.set(nk, "__ambiguous__");
        } else {
          nameOnly.set(nk, row.id);
        }
      }

      const dataStart = lines[1].replace(/,/g, "").trim() === "" ? 2 : 1;

      let updated = 0;
      let notFound = 0;
      let skipped = 0;

      // Batch updates in groups of 50
      const updates: Array<{ id: string; stuff_plus: number }> = [];

      for (let i = dataStart; i < lines.length; i++) {
        const vals = parseLine(lines[i]);
        const playerName = (vals[0] || "").trim();
        const team = (vals[1] || "").trim();
        const stuffStr = (vals[2] || "").trim();
        if (!playerName || !team) { skipped++; continue; }
        const stuffVal = parseFloat(stuffStr);
        if (isNaN(stuffVal)) { skipped++; continue; }

        const key = `${norm(playerName)}|${norm(team)}`;
        let matchId = lookup.get(key);
        // Fallback: name-only match if unambiguous
        if (!matchId) {
          const nameId = nameOnly.get(norm(playerName));
          if (nameId && nameId !== "__ambiguous__") matchId = nameId;
        }
        if (!matchId) { notFound++; console.log(`Not found: ${playerName} | ${team}`); continue; }

        updates.push({ id: matchId, stuff_plus: stuffVal });
      }

      // Execute updates — also null out derived scores/PR+ so they get recalculated from fresh stuff_plus
      for (const upd of updates) {
        const { error: updErr } = await supabase
          .from("pitching_power_ratings_storage")
          .update({
            stuff_plus: upd.stuff_plus,
            stuff_score: null,
            era_pr_plus: null,
            fip_pr_plus: null,
            k9_pr_plus: null,
          })
          .eq("id", upd.id);
        if (updErr) { console.error(`Error updating id ${upd.id}:`, updErr); skipped++; continue; }
        updated++;
      }

      setStuffPlusResult({ updated, notFound, skipped });
      toast.success(`Updated Stuff+ for ${updated} pitchers. ${notFound} not found.`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setStuffPlusLoading(false);
      if (stuffPlusCsvRef.current) stuffPlusCsvRef.current.value = "";
    }
  };

  const createMissingPlayers = async () => {
    setCreateMissingLoading(true);
    setCreateMissingResult(null);
    try {
      // Find all unlinked hitter storage rows
      const { data: unlinkedStats, error: fetchErr } = await supabase
        .from("hitter_stats_storage")
        .select("id, player_name, team")
        .is("player_id", null)
        .eq("season", 2025);
      if (fetchErr) throw fetchErr;
      if (!unlinkedStats || unlinkedStats.length === 0) {
        setCreateMissingResult({ created: 0, linked: 0, alreadyLinked: 0 });
        toast.info("All storage rows are already linked.");
        return;
      }

      // Get unique player_name + team combos
      const uniquePlayers = new Map<string, { playerName: string; team: string }>();
      for (const row of unlinkedStats) {
        const key = `${row.player_name}||${row.team}`;
        if (!uniquePlayers.has(key)) {
          uniquePlayers.set(key, { playerName: row.player_name, team: row.team });
        }
      }

      // Build team lookup: normalized team name → team_id
      const allTeams: Array<{ id: string; name: string }> = [];
      let tFrom = 0;
      while (true) {
        const { data, error } = await supabase
          .from("teams")
          .select("id, name")
          .order("id", { ascending: true })
          .range(tFrom, tFrom + 999);
        if (error) throw error;
        allTeams.push(...(data || []));
        if (!data || data.length < 1000) break;
        tFrom += 1000;
      }

      const normalize = (v: string | null | undefined) =>
        (v || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
      const normalizeTeamForKey = (team: string | null | undefined) => {
        const t = normalize(team);
        return t.replace(/\buniversity\b/g, "").replace(/\bof\b/g, "").replace(/\s+/g, " ").trim();
      };

      const teamIdByNorm = new Map<string, string>();
      for (const t of allTeams) {
        teamIdByNorm.set(normalizeTeamForKey(t.name), t.id);
      }

      // Create player records
      let created = 0;
      const newPlayerMap = new Map<string, string>(); // "name||team" → new player_id
      for (const [key, info] of uniquePlayers) {
        const parts = info.playerName.trim().split(/\s+/);
        const firstName = parts[0] || "";
        const lastName = parts.slice(1).join(" ") || "";
        const teamId = teamIdByNorm.get(normalizeTeamForKey(info.team)) || null;

        const { data: newPlayer, error: insertErr } = await supabase
          .from("players")
          .insert({
            first_name: firstName,
            last_name: lastName,
            team: info.team,
            team_id: teamId,
            position: "UTL",
            class_year: "Unknown",
          })
          .select("id")
          .single();
        if (insertErr) {
          console.warn(`Failed to create player ${info.playerName}: ${insertErr.message}`);
          continue;
        }
        newPlayerMap.set(key, newPlayer.id);
        created++;
      }

      // Link storage rows to new player IDs
      let linked = 0;
      for (const row of unlinkedStats) {
        const key = `${row.player_name}||${row.team}`;
        const pid = newPlayerMap.get(key);
        if (pid) {
          await supabase.from("hitter_stats_storage").update({ player_id: pid }).eq("id", row.id);
          linked++;
        }
      }

      // Also link matching power ratings rows
      const { data: unlinkedPower } = await supabase
        .from("hitting_power_ratings_storage")
        .select("id, player_name, team")
        .is("player_id", null)
        .eq("season", 2025);
      let powerLinked = 0;
      if (unlinkedPower) {
        for (const row of unlinkedPower) {
          const key = `${row.player_name}||${row.team}`;
          const pid = newPlayerMap.get(key);
          if (pid) {
            await supabase.from("hitting_power_ratings_storage").update({ player_id: pid }).eq("id", row.id);
            powerLinked++;
          }
        }
      }

      setCreateMissingResult({ created, linked: linked + powerLinked, alreadyLinked: 2299 - unlinkedStats.length });
      toast.success(`Created ${created} new players, linked ${linked + powerLinked} storage rows.`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setCreateMissingLoading(false);
    }
  };

  const [relinkLoading, setRelinkLoading] = useState(false);
  const [relinkResult, setRelinkResult] = useState<{ relinked: number; deleted: number } | null>(null);

  const relinkAndDedup = async () => {
    setRelinkLoading(true);
    setRelinkResult(null);
    try {
      const normalize = (v: string | null | undefined) =>
        (v || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
      const normalizeTeamForKey = (team: string | null | undefined) => {
        const t = normalize(team);
        return t.replace(/\buniversity\b/g, "").replace(/\bof\b/g, "").replace(/\s+/g, " ").trim();
      };

      // Fetch all players
      const allPlayers: Array<{ id: string; first_name: string; last_name: string; team: string | null }> = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("players")
          .select("id, first_name, last_name, team")
          .order("id", { ascending: true })
          .range(from, from + 999);
        if (error) throw error;
        allPlayers.push(...(data || []));
        if (!data || data.length < 1000) break;
        from += 1000;
      }

      // Fetch all predictions player_ids
      const predPlayerIds = new Set<string>();
      let pFrom = 0;
      while (true) {
        const { data, error } = await supabase
          .from("player_predictions")
          .select("player_id")
          .order("player_id", { ascending: true })
          .range(pFrom, pFrom + 999);
        if (error) throw error;
        for (const r of (data || [])) predPlayerIds.add(r.player_id);
        if (!data || data.length < 1000) break;
        pFrom += 1000;
      }

      // Group players by normalized name+team — prefer the one with predictions
      const groups = new Map<string, Array<{ id: string; hasPred: boolean }>>();
      for (const p of allPlayers) {
        const key = `${normalize(`${p.first_name} ${p.last_name}`)}|${normalizeTeamForKey(p.team)}`;
        const arr = groups.get(key) || [];
        arr.push({ id: p.id, hasPred: predPlayerIds.has(p.id) });
        groups.set(key, arr);
      }

      // For each group, pick the "winner" (has predictions, or first one)
      const winnerByKey = new Map<string, string>();
      const losers: string[] = [];
      for (const [key, arr] of groups) {
        const winner = arr.find((p) => p.hasPred) || arr[0];
        winnerByKey.set(key, winner.id);
        for (const p of arr) {
          if (p.id !== winner.id) losers.push(p.id);
        }
      }

      // Re-link all storage rows to the winner player_id
      let relinked = 0;
      for (const table of ["hitter_stats_storage", "hitting_power_ratings_storage"] as const) {
        const { data: rows } = await supabase
          .from(table)
          .select("id, player_name, team, player_id")
          .eq("season", 2025);
        if (!rows) continue;
        for (const row of rows) {
          const key = `${normalize(row.player_name)}|${normalizeTeamForKey(row.team)}`;
          const winnerId = winnerByKey.get(key);
          if (winnerId && winnerId !== row.player_id) {
            await supabase.from(table).update({ player_id: winnerId }).eq("id", row.id);
            relinked++;
          }
        }
      }

      // Delete duplicate player records (losers with no predictions)
      let deleted = 0;
      for (const loserId of losers) {
        if (!predPlayerIds.has(loserId)) {
          await supabase.from("players").delete().eq("id", loserId);
          deleted++;
        }
      }

      setRelinkResult({ relinked, deleted });
      toast.success(`Re-linked ${relinked} storage rows, deleted ${deleted} duplicate players.`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRelinkLoading(false);
    }
  };

  const syncPitchingDataToSupabase = async () => {
    setSyncPitchingLoading(true);
    setSyncPitchingResult(null);
    try {
      const chunkSize = 500;
      const parseNum = (v: string | undefined) => {
        if (!v) return null;
        const n = Number(String(v).replace(/[%,$]/g, "").trim());
        return Number.isFinite(n) ? n : null;
      };

      // Sync pitching stats from localStorage
      let statsCount = 0;
      try {
        const raw = window.localStorage.getItem("pitching_stats_storage_2025_v1");
        if (raw) {
          const parsed = JSON.parse(raw) as { rows?: Array<{ values?: string[] }> };
          const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
          const statsRows = rows.map((r) => {
            const values = Array.isArray(r.values) ? r.values : [];
            const legacyEra = parseNum(values[3]);
            const isLegacy = legacyEra != null && legacyEra > 0 && legacyEra < 20;
            return {
              player_name: (values[0] || "").trim(),
              team: (values[1] || "").trim() || null,
              handedness: (values[2] || "").trim() || null,
              role: isLegacy ? (values[12] || "").trim() || null : (values[3] || "").trim() || null,
              season: 2025,
              era: isLegacy ? parseNum(values[3]) : parseNum(values[7]),
              fip: isLegacy ? parseNum(values[4]) : parseNum(values[8]),
              whip: isLegacy ? parseNum(values[5]) : parseNum(values[9]),
              k9: isLegacy ? parseNum(values[6]) : parseNum(values[10]),
              bb9: isLegacy ? parseNum(values[7]) : parseNum(values[11]),
              hr9: isLegacy ? parseNum(values[8]) : parseNum(values[12]),
              ip: isLegacy ? parseNum(values[11]) : parseNum(values[4]),
              g: isLegacy ? (parseNum(values[9]) != null ? Math.round(parseNum(values[9])!) : null) : (parseNum(values[5]) != null ? Math.round(parseNum(values[5])!) : null),
              gs: isLegacy ? (parseNum(values[10]) != null ? Math.round(parseNum(values[10])!) : null) : (parseNum(values[6]) != null ? Math.round(parseNum(values[6])!) : null),
            };
          }).filter((r) => !!r.player_name);
          for (let i = 0; i < statsRows.length; i += chunkSize) {
            const { error } = await supabase
              .from("pitching_stats_storage")
              .upsert(statsRows.slice(i, i + chunkSize), { onConflict: "player_name,team,season" });
            if (error) throw error;
          }
          statsCount = statsRows.length;
        }
      } catch (e: any) {
        console.warn("Pitching stats sync error:", e?.message);
      }

      // Sync pitching power ratings from localStorage
      let powerCount = 0;
      try {
        const raw = window.localStorage.getItem("pitching_power_ratings_storage_2025_v1");
        if (raw) {
          const parsed = JSON.parse(raw) as { rows?: Array<{ values?: string[] }> };
          const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
          const powerRows = rows.map((r) => {
            const values = Array.isArray(r.values) ? r.values : [];
            const name = (values[0] || "").trim();
            if (!name) return null;
            return {
              player_name: name,
              team: (values[1] || "").trim() || null,
              season: 2025,
              stuff_plus: parseNum(values[16]),
              whiff_pct: parseNum(values[17]),
              bb_pct: parseNum(values[18]),
              hh_pct: parseNum(values[19]),
              iz_whiff_pct: parseNum(values[20]),
              chase_pct: parseNum(values[21]),
              barrel_pct: parseNum(values[22]),
              ld_pct: parseNum(values[23]),
              avg_exit_velo: parseNum(values[24]),
              gb_pct: parseNum(values[25]),
              iz_pct: parseNum(values[26]),
              ev90: parseNum(values[27]),
              pull_pct: parseNum(values[28]),
              la_10_30_pct: parseNum(values[29]),
              era_pr_plus: parseNum(values[30]) != null ? Math.round(parseNum(values[30])!) : null,
              fip_pr_plus: parseNum(values[31]) != null ? Math.round(parseNum(values[31])!) : null,
              whip_pr_plus: parseNum(values[32]) != null ? Math.round(parseNum(values[32])!) : null,
              k9_pr_plus: parseNum(values[33]) != null ? Math.round(parseNum(values[33])!) : null,
              hr9_pr_plus: parseNum(values[34]) != null ? Math.round(parseNum(values[34])!) : null,
              bb9_pr_plus: parseNum(values[35]) != null ? Math.round(parseNum(values[35])!) : null,
            };
          }).filter(Boolean);
          for (let i = 0; i < powerRows.length; i += chunkSize) {
            const { error } = await supabase
              .from("pitching_power_ratings_storage")
              .upsert(powerRows.slice(i, i + chunkSize), { onConflict: "player_name,team,season" });
            if (error) throw error;
          }
          powerCount = powerRows.length;
        }
      } catch (e: any) {
        console.warn("Pitching power sync error:", e?.message);
      }

      setSyncPitchingResult({ stats: statsCount, power: powerCount });
      toast.success(`Synced ${statsCount} pitching stat rows and ${powerCount} power rating rows to Supabase`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncPitchingLoading(false);
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
      const { data: allTeams } = await supabase.from("teams").select("id, name, source_team_id");
      const { data: allPlayers } = await supabase.from("players").select("id, first_name, last_name, team, team_id, source_player_id");
      if (!allTeams || !allPlayers) throw new Error("Failed to fetch teams/players");

      const normalize = (v: string | null | undefined) =>
        (v || "").trim().toLowerCase().replace(/\buniversity\b/g, "").replace(/\bof\b/g, "").replace(/\bthe\b/g, "").replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();

      // Build team lookup maps
      const teamBySourceId = new Map<string, typeof allTeams[0]>();
      const teamByNormalizedName = new Map<string, typeof allTeams[0]>();
      for (const t of allTeams) {
        if (t.source_team_id) teamBySourceId.set(String(t.source_team_id), t);
        teamByNormalizedName.set(normalize(t.name), t);
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
        if (matchedTeam && sourceTeamId && !matchedTeam.source_team_id) {
          await supabase.from("teams").update({ source_team_id: sourceTeamId }).eq("id", matchedTeam.id);
          matchedTeam.source_team_id = sourceTeamId;
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
            team: matchedTeam?.name ?? teamLocation ?? teamName ?? null,
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
            const newPlayer = { id: created.id, first_name: newFirstName, last_name: newLastName, team: matchedTeam?.name ?? null, team_id: matchedTeam?.id ?? null, source_player_id: sourcePlayerId } as any;
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

  const syncSeedDataToSupabase = async () => {
    setSyncSeedLoading(true);
    setSyncSeedResult(null);
    try {
      const chunkSize = 500;
      const statsRows = (storage2025Seed as Array<any>).map((r: any) => ({
        player_name: r.playerName,
        team: r.team ?? null,
        conference: r.conference ?? null,
        season: 2025,
        avg: r.avg ?? null,
        obp: r.obp ?? null,
        slg: r.slg ?? null,
        source: r.source ?? "storage_2025_seed",
      }));
      for (let i = 0; i < statsRows.length; i += chunkSize) {
        const { error } = await supabase
          .from("hitter_stats_storage")
          .upsert(statsRows.slice(i, i + chunkSize), { onConflict: "player_name,team,season" });
        if (error) throw error;
      }

      const powerRows = (powerRatings2025Seed as Array<any>).map((r: any) => ({
        player_name: r.playerName,
        team: r.team ?? null,
        season: 2025,
        position: (exitPositions2025Seed as Record<string, string>)[`${r.playerName}|${r.team}`]
          ?? (exitPositions2025Seed as Record<string, string>)[r.playerName]
          ?? null,
        contact: r.contact ?? null,
        line_drive: r.lineDrive ?? null,
        avg_exit_velo: r.avgExitVelo ?? null,
        pop_up: r.popUp ?? null,
        bb: r.bb ?? null,
        chase: r.chase ?? null,
        barrel: r.barrel ?? null,
        ev90: r.ev90 ?? null,
        pull: r.pull ?? null,
        la_10_30: r.la10_30 ?? null,
        gb: r.gb ?? null,
        source: r.source ?? "power_ratings_2025_seed",
      }));
      for (let i = 0; i < powerRows.length; i += chunkSize) {
        const { error } = await supabase
          .from("hitting_power_ratings_storage")
          .upsert(powerRows.slice(i, i + chunkSize), { onConflict: "player_name,team,season" });
        if (error) throw error;
      }

      // --- Player ID linking pass ---
      // Fetch all players and match by normalized name+team to write player_id
      const normalize = (v: string | null | undefined) =>
        (v || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
      const allPlayers: Array<{ id: string; first_name: string; last_name: string; team: string | null }> = [];
      let from = 0;
      const playerPageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("players")
          .select("id, first_name, last_name, team")
          .order("id", { ascending: true })
          .range(from, from + playerPageSize - 1);
        if (error) throw error;
        const batch = data || [];
        allPlayers.push(...batch);
        if (batch.length < playerPageSize) break;
        from += playerPageSize;
      }

      // Build lookup: "normalizedName|normalizedTeam" → player_id
      const playerIdByNameTeam = new Map<string, string>();
      const playerIdByName = new Map<string, string | null>();
      const normalizeTeamForKey = (team: string | null | undefined) => {
        const t = normalize(team);
        return t.replace(/\buniversity\b/g, "").replace(/\bof\b/g, "").replace(/\s+/g, " ").trim();
      };
      for (const p of allPlayers) {
        const fullName = normalize(`${p.first_name} ${p.last_name}`);
        const ntKey = `${fullName}|${normalizeTeamForKey(p.team)}`;
        playerIdByNameTeam.set(ntKey, p.id);
        // Track name-only: null means ambiguous (multiple players with same name)
        if (playerIdByName.has(fullName)) {
          playerIdByName.set(fullName, null); // ambiguous
        } else {
          playerIdByName.set(fullName, p.id);
        }
      }

      let linkedCount = 0;
      const linkChunkSize = 300;

      // Link hitter_stats_storage rows
      const { data: unlinkedStats } = await supabase
        .from("hitter_stats_storage")
        .select("id, player_name, team")
        .is("player_id", null)
        .eq("season", 2025);
      if (unlinkedStats && unlinkedStats.length > 0) {
        const updates: Array<{ id: string; player_id: string }> = [];
        for (const row of unlinkedStats) {
          const ntKey = `${normalize(row.player_name)}|${normalizeTeamForKey(row.team)}`;
          const pid = playerIdByNameTeam.get(ntKey) ?? playerIdByName.get(normalize(row.player_name));
          if (pid) updates.push({ id: row.id, player_id: pid });
        }
        for (let i = 0; i < updates.length; i += linkChunkSize) {
          const batch = updates.slice(i, i + linkChunkSize);
          for (const u of batch) {
            await supabase.from("hitter_stats_storage").update({ player_id: u.player_id }).eq("id", u.id);
          }
        }
        linkedCount += updates.length;
      }

      // Link hitting_power_ratings_storage rows
      const { data: unlinkedPower } = await supabase
        .from("hitting_power_ratings_storage")
        .select("id, player_name, team")
        .is("player_id", null)
        .eq("season", 2025);
      if (unlinkedPower && unlinkedPower.length > 0) {
        const updates: Array<{ id: string; player_id: string }> = [];
        for (const row of unlinkedPower) {
          const ntKey = `${normalize(row.player_name)}|${normalizeTeamForKey(row.team)}`;
          const pid = playerIdByNameTeam.get(ntKey) ?? playerIdByName.get(normalize(row.player_name));
          if (pid) updates.push({ id: row.id, player_id: pid });
        }
        for (let i = 0; i < updates.length; i += linkChunkSize) {
          const batch = updates.slice(i, i + linkChunkSize);
          for (const u of batch) {
            await supabase.from("hitting_power_ratings_storage").update({ player_id: u.player_id }).eq("id", u.id);
          }
        }
        linkedCount += updates.length;
      }

      setSyncSeedResult({ stats: statsRows.length, power: powerRows.length, linked: linkedCount });
      toast.success(`Synced ${statsRows.length} stats, ${powerRows.length} power ratings, linked ${linkedCount} to player IDs`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncSeedLoading(false);
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
        .from("teams")
        .select("name, conference");
      if (teamsErr) throw teamsErr;
      const teamByNorm = new Map<string, { name: string; conference: string | null }>();
      for (const t of teams || []) {
        const key = normalizeTeamMatch(t.name);
        if (!key) continue;
        if (!teamByNorm.has(key)) {
          teamByNorm.set(key, { name: t.name, conference: t.conference || null });
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
            <p className="font-medium">Sync Player Profile Teams to Teams Table</p>
            <p className="text-sm text-muted-foreground">
              Match player team/conference to valid Teams-table names using 2025 storage + aliases. Ambiguous or unmatched entries are left blank for manual review.
            </p>
          </div>
          <Button onClick={sync2025TeamsForNonTransfers} disabled={syncTeamsLoading} variant="outline" className="gap-2">
            {syncTeamsLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {syncTeamsLoading ? "Syncing Teams…" : "Sync Team Names"}
          </Button>
          {syncTeamsResult && (
            <p className="text-sm text-muted-foreground">
              Updated: {syncTeamsResult.updated}, cleared to blank: {syncTeamsResult.clearedUnmatched}, skipped ambiguous: {syncTeamsResult.skippedAmbiguous}, unmatched: {syncTeamsResult.unmatched}
            </p>
          )}
          {syncTeamsResult && syncTeamsResult.unresolvedSample.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Unresolved sample: {syncTeamsResult.unresolvedSample.join(", ")}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div>
            <p className="font-medium">Sync 2025 Hitter Seed Data to Supabase</p>
            <p className="text-sm text-muted-foreground">
              Uploads the local 2025 hitter stats and power ratings JSON seed files to Supabase so all networks can access them. Safe to re-run — uses upsert.
            </p>
          </div>
          <Button onClick={syncSeedDataToSupabase} disabled={syncSeedLoading} variant="outline" className="gap-2">
            {syncSeedLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {syncSeedLoading ? "Syncing Seed Data…" : "Sync 2025 Hitter Seed Data"}
          </Button>
          {syncSeedResult && (
            <p className="text-sm text-muted-foreground">
              Synced {syncSeedResult.stats} hitter stat rows and {syncSeedResult.power} power rating rows. Linked {syncSeedResult.linked} rows to player IDs.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div>
            <p className="font-medium">Import Master 2025 Hitter CSV</p>
            <p className="text-sm text-muted-foreground">
              Clears all existing 2025 hitter stats and power ratings, then imports fresh from a single master CSV. Links player IDs via source_player_id and name matching.
            </p>
          </div>
          <input
            ref={masterCsvRef}
            type="file"
            accept=".csv"
            className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
            disabled={masterCsvLoading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importMasterHitterCsv(file);
            }}
          />
          {masterCsvLoading && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin" /> Clearing old data and importing master CSV…
            </p>
          )}
          {masterCsvResult && (
            <p className="text-sm text-muted-foreground">
              Cleared old data. Imported {masterCsvResult.stats} stat rows and {masterCsvResult.power} power rating rows. Linked {masterCsvResult.linked} to player IDs.
            </p>
          )}
          {masterCsvResult && masterCsvResult.linked < masterCsvResult.stats && (
            <div className="pt-2 border-t space-y-2">
              <p className="text-sm font-medium">{masterCsvResult.stats - masterCsvResult.linked} players unlinked — create player records for them?</p>
              <Button onClick={createMissingPlayers} disabled={createMissingLoading} variant="outline" className="gap-2">
                {createMissingLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {createMissingLoading ? "Creating Players…" : "Create Missing Players & Link"}
              </Button>
              {createMissingResult && (
                <p className="text-sm text-muted-foreground">
                  Created {createMissingResult.created} new player records, linked {createMissingResult.linked} storage rows. {createMissingResult.alreadyLinked} were already linked.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div>
            <p className="font-medium">Re-link Storage & Remove Duplicates</p>
            <p className="text-sm text-muted-foreground">
              Fixes mismatched player_id links on hitter storage rows. Points all rows to the player record that has predictions, then deletes orphan duplicates. Safe to re-run.
            </p>
          </div>
          <Button onClick={relinkAndDedup} disabled={relinkLoading} variant="outline" className="gap-2">
            {relinkLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {relinkLoading ? "Re-linking…" : "Re-link & Dedup Players"}
          </Button>
          {relinkResult && (
            <p className="text-sm text-muted-foreground">
              Re-linked {relinkResult.relinked} storage rows, deleted {relinkResult.deleted} duplicate player records.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div>
            <p className="font-medium">Sync 2025 Pitching Data to Supabase</p>
            <p className="text-sm text-muted-foreground">
              Uploads pitching stats and power ratings from localStorage to Supabase so all networks can access them. Safe to re-run — uses upsert.
            </p>
          </div>
          <Button onClick={syncPitchingDataToSupabase} disabled={syncPitchingLoading} variant="outline" className="gap-2">
            {syncPitchingLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {syncPitchingLoading ? "Syncing Pitching Data…" : "Sync 2025 Pitching Data"}
          </Button>
          {syncPitchingResult && (
            <p className="text-sm text-muted-foreground">
              Synced {syncPitchingResult.stats} pitching stat rows and {syncPitchingResult.power} power rating rows.
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div>
            <p className="font-medium">Import Master 2025 Pitching CSV</p>
            <p className="text-sm text-muted-foreground">
              Clears all existing 2025 pitching stats and power ratings, then imports fresh from a single master CSV. Links player IDs via name matching.
            </p>
          </div>
          <input
            ref={masterPitchingCsvRef}
            type="file"
            accept=".csv"
            className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
            disabled={masterPitchingLoading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importMasterPitchingCsv(file);
            }}
          />
          {masterPitchingLoading && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin" /> Clearing old data and importing master pitching CSV…
            </p>
          )}
          {masterPitchingResult && (
            <p className="text-sm text-muted-foreground">
              Imported {masterPitchingResult.stats} stat rows and {masterPitchingResult.power} power rating rows. Linked {masterPitchingResult.linked} to player IDs.
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
            <p className="font-medium">Compute All Scores</p>
            <p className="text-sm text-muted-foreground">
              Computes power rating scores (BA+, OBP+, ISO+, ERA PR+, etc.) for all unscored players and writes them to Supabase. Runs automatically on data load, but can be triggered manually.
            </p>
          </div>
          <ComputeScoresButton />
          <div className="border-t pt-4">
            <p className="font-medium">Create Predictions from Master</p>
            <p className="text-sm text-muted-foreground">
              Creates returner predictions and power rating internals for all hitters in the players table using Hitter Master data. Skips players who already have predictions. Then run "Bulk Recalculate" to compute projected stats.
            </p>
          </div>
          <CreatePredictionsButton />
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
          <div className="border-t pt-4">
            <p className="font-medium">Fix Pitcher EV90 (90th Exit Velo Against)</p>
            <p className="text-sm text-muted-foreground">
              Upload a CSV with playerId and 90thExitVel columns. Overwrites the 90th_vel column in 2025 Pitching Master with correct exit velocity data (was incorrectly pitch velocity).
            </p>
          </div>
          <ImportPitcherEv90Button />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div>
            <p className="font-medium">Update Stuff+ from CSV</p>
            <p className="text-sm text-muted-foreground">
              Upload a CSV with columns: Player Name, Team, Stuff+. Updates only the stuff_plus field in pitching_power_ratings_storage for matching players. Does NOT clear other data.
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

function DataStorage2025Tab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedSeason, setSelectedSeason] = useState<"2025" | "2026">("2025");
  const [storageDomain, setStorageDomain] = useState<"hitting" | "pitching">("hitting");
  const [storageView, setStorageView] = useState<"stats" | "power">("stats");
  const [showMissingOnly, setShowMissingOnly] = useState(false);
  const [statsPage, setStatsPage] = useState(1);
  const [powerPage, setPowerPage] = useState(1);
  const PAGE_SIZE = 100;
  const normalize = (value: string | null | undefined) =>
    (value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  const toPlayerKey = (name: string, team?: string | null) => `${normalize(name)}|${normalize(team || "")}`;
  const statsSeedRows = useMemo(
    () =>
      (storage2025Seed as Array<{
        id: string;
        playerName: string;
        team: string | null;
        conference: string | null;
        avg: number | null;
        obp: number | null;
        slg: number | null;
        source: string;
      }>).map((r) => ({ ...r })),
    [],
  );
  const statsSeedByKey = useMemo(
    () => new Map(statsSeedRows.map((r) => [toPlayerKey(r.playerName, r.team), r])),
    [statsSeedRows],
  );
  const statsSeedByName = useMemo(() => {
    const map = new Map<string, Array<(typeof statsSeedRows)[number]>>();
    for (const row of statsSeedRows) {
      const key = normalize(row.playerName);
      const arr = map.get(key) || [];
      arr.push(row);
      map.set(key, arr);
    }
    return map;
  }, [statsSeedRows]);
  const powerSeedRows = useMemo(
    () =>
      (powerRatings2025Seed as Array<{
        id: string;
        playerName: string;
        team: string | null;
        contact: number | null;
        lineDrive: number | null;
        avgExitVelo: number | null;
        popUp: number | null;
        bb: number | null;
        chase: number | null;
        barrel: number | null;
        ev90: number | null;
        pull: number | null;
        la10_30: number | null;
        gb: number | null;
        source: string;
      }>).map((r) => ({ ...r })),
    [],
  );
  const powerSeedByKey = useMemo(
    () => new Map(powerSeedRows.map((r) => [toPlayerKey(r.playerName, r.team), r])),
    [powerSeedRows],
  );
  const powerSeedByName = useMemo(() => {
    const map = new Map<string, Array<(typeof powerSeedRows)[number]>>();
    for (const row of powerSeedRows) {
      const key = normalize(row.playerName);
      const arr = map.get(key) || [];
      arr.push(row);
      map.set(key, arr);
    }
    return map;
  }, [powerSeedRows]);
  const editableValues = useMemo<Record<string, string>>(() => {
    const defaults: Record<string, string> = {
      ba_ncaa_contact_pct: "77.1",
      ba_ncaa_line_drive_pct: "20.9",
      ba_ncaa_avg_exit_velocity: "86.2",
      ba_ncaa_popup_pct: "7.9",
      obp_ncaa_bb_pct: "11.4",
      obp_ncaa_chase_pct: "23.1",
      iso_ncaa_barrel_pct: "17.3",
      iso_ncaa_ev90: "103.10",
      iso_ncaa_pull_pct: "36.5",
      iso_ncaa_la10_30_pct: "29",
      iso_ncaa_gb_pct: "43.2",
      ba_contact_pct_std_dev: "6.60",
      ba_line_drive_pct_std_dev: "4.31",
      ba_avg_exit_velocity_std_dev: "4.28",
      ba_popup_pct_std_dev: "3.37",
      obp_bb_pct_std_dev: "3.57",
      obp_chase_pct_std_dev: "5.58",
      iso_barrel_pct_std_dev: "7.89",
      iso_ev90_std_dev: "3.97",
      iso_pull_pct_std_dev: "8.03",
      iso_la10_30_pct_std_dev: "6.81",
      iso_gb_pct_std_dev: "8.0",
      ba_contact_pct_weight: "0.40",
      ba_line_drive_pct_weight: "0.25",
      ba_avg_exit_velocity_weight: "0.20",
      ba_popup_pct_weight: "0.15",
      obp_contact_pct_weight: "0.35",
      obp_line_drive_pct_weight: "0.20",
      obp_avg_exit_velocity_weight: "0.15",
      obp_popup_pct_weight: "0.10",
      obp_bb_pct_weight: "0.15",
      obp_chase_pct_weight: "0.05",
      iso_barrel_pct_weight: "0.45",
      iso_ev90_weight: "0.30",
      iso_pull_pct_weight: "0.15",
      iso_la10_30_pct_weight: "0.05",
      iso_gb_pct_weight: "0.05",
      overall_avg_exit_velocity_weight: "0.35",
      overall_barrel_pct_weight: "0.15",
      overall_contact_pct_weight: "0.30",
      overall_chase_pct_weight: "0.20",
      ba_ncaa_avg_power_rating: "50",
      obp_ncaa_avg_power_rating: "50",
      iso_ncaa_avg_power_rating: "50",
    };
    try {
      const raw = localStorage.getItem("admin_dashboard_power_equation_values_v3");
      if (!raw) return defaults;
      const parsed = JSON.parse(raw) as Record<string, string>;
      return { ...defaults, ...parsed };
    } catch {
      return defaults;
    }
  }, []);

  const { data: playerDirectory = [] } = useQuery({
    queryKey: ["admin-player-directory"],
    queryFn: async () => {
      const allPlayers: Array<{ id: string; first_name: string; last_name: string; team: string | null }> = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("players")
          .select("id, first_name, last_name, team")
          .order("id", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const batch = data || [];
        allPlayers.push(...batch);
        if (batch.length < pageSize) break;
        from += pageSize;
      }
      return allPlayers;
    },
  });

  const playerIdByKey = useMemo(() => {
    const byKey = new Map<string, string>();
    const byName = new Map<string, string>();
    for (const p of playerDirectory) {
      const fullName = `${p.first_name} ${p.last_name}`.trim();
      const key = toPlayerKey(fullName, p.team);
      const nameKey = normalize(fullName);
      if (!byKey.has(key)) byKey.set(key, p.id);
      if (!byName.has(nameKey)) byName.set(nameKey, p.id);
    }
    return { byKey, byName };
  }, [playerDirectory]);
  const resolvePlayerId = (playerName: string, team?: string | null) => {
    const key = toPlayerKey(playerName, team);
    const byKeyMatch = playerIdByKey.byKey.get(key);
    if (byKeyMatch) return byKeyMatch;
    return playerIdByKey.byName.get(normalize(playerName)) ?? null;
  };
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
  const { data: teamDirectory = [] } = useQuery({
    queryKey: ["admin-teams-park-factor-directory"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("name, park_factor");
      if (error) throw error;
      return data || [];
    },
  });
  const parkFactorByTeam = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const row of teamDirectory as Array<{ name: string; park_factor: number | null }>) {
      const key = normalizeTeamMatch(row.name);
      if (!key) continue;
      if (!map.has(key)) map.set(key, row.park_factor);
    }
    return map;
  }, [teamDirectory]);
  const getParkFactorForTeam = (team: string | null | undefined) => {
    const key = normalizeTeamMatch(team);
    if (!key) return null;
    const fromTeams = parkFactorByTeam.get(key);
    if (fromTeams != null) return fromTeams;
    // Temporary hardcoded values requested for normalization checks.
    if (key === "university of southern indiana" || key === "southern indiana") return 0.98;
    if (key === "omaha") return 0.99;
    return null;
  };

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["admin-data-storage", selectedSeason],
    queryFn: async () => {
      let allData: any[] = [];
      let from = 0;
      const pageSize = 1000;

      while (true) {
        const { data, error } = await supabase
          .from("season_stats")
          .select(`
            id,
            season,
            games,
            at_bats,
            hits,
            home_runs,
            rbi,
            batting_avg,
            on_base_pct,
            slugging_pct,
            ops,
            players!inner(first_name, last_name, team, conference)
          `)
          .eq("season", Number(selectedSeason))
          .order("id", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;

        const batch = data || [];
        allData = allData.concat(batch);
        if (batch.length < pageSize) break;
        from += pageSize;
      }

      if (selectedSeason === "2025") {
        const dbRowsByName = new Map<string, Array<{ avg: number | null; obp: number | null; slg: number | null; conference: string | null }>>();
        for (const row of allData) {
          const playerName = `${row.players?.first_name || ""} ${row.players?.last_name || ""}`.trim();
          const key = normalize(playerName);
          if (!key) continue;
          const arr = dbRowsByName.get(key) || [];
          arr.push({
            avg: row.batting_avg as number | null,
            obp: row.on_base_pct as number | null,
            slg: row.slugging_pct as number | null,
            conference: row.players?.conference as string | null,
          });
          dbRowsByName.set(key, arr);
        }
        return statsSeedRows.map((seed) => {
          const matches = dbRowsByName.get(normalize(seed.playerName)) || [];
          const db = matches.length === 1 ? matches[0] : null;
          return {
            id: seed.id,
            playerName: seed.playerName,
            team: seed.team,
            conference: db?.conference ?? seed.conference ?? null,
            avg: db?.avg ?? seed.avg ?? null,
            obp: db?.obp ?? seed.obp ?? null,
            slg: db?.slg ?? seed.slg ?? null,
            source: db ? "storage_2025_seed + season_stats_overlay" : seed.source,
          };
        });
      }

      if (allData.length > 0) {
        return allData.map((row: any) => {
          const playerName = `${row.players?.first_name || ""} ${row.players?.last_name || ""}`.trim();
          return {
            id: row.id as string,
            playerName,
            team: row.players?.team as string | null,
            conference: row.players?.conference as string | null,
            avg: row.batting_avg as number | null,
            obp: row.on_base_pct as number | null,
            slg: row.slugging_pct as number | null,
            source: "season_stats",
          };
        });
      }

      // Fallback for testing: pull last-known baseline stats from player_predictions
      // so the storage table is still populated before season_stats is fully imported.
      let predData: any[] = [];
      let predFrom = 0;
      while (true) {
        const { data, error } = await supabase
          .from("player_predictions")
          .select(`
            id,
            player_id,
            from_avg,
            from_obp,
            from_slg,
            players!inner(first_name, last_name, team, conference)
          `)
          .eq("season", Number(selectedSeason))
          .range(predFrom, predFrom + pageSize - 1);
        if (error) throw error;
        const batch = data || [];
        predData = predData.concat(batch);
        if (batch.length < pageSize) break;
        predFrom += pageSize;
      }

      const byPlayer = new Map<string, any>();
      for (const row of predData) {
        const pid = row.player_id as string;
        if (!byPlayer.has(pid)) byPlayer.set(pid, row);
      }

      const predictionFallback = Array.from(byPlayer.values()).map((row: any) => {
        const playerName = `${row.players?.first_name || ""} ${row.players?.last_name || ""}`.trim();
        const team = row.players?.team as string | null;
        return {
          id: row.id as string,
          playerName,
          team,
          conference: row.players?.conference as string | null,
          avg: row.from_avg as number | null,
          obp: row.from_obp as number | null,
          slg: row.from_slg as number | null,
          source: "player_predictions.from_*",
        };
      });
      if (predictionFallback.length > 0) return predictionFallback;

      if (selectedSeason === "2025") {
        return statsSeedRows.map((r) => ({ ...r }));
      }
      return [];
    },
  });

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let result = rows;
    if (q) {
      result = result.filter((r) =>
        [r.playerName, r.team || "", r.conference || ""].some((v) =>
          v.toLowerCase().includes(q),
        ),
      );
    }
    if (showMissingOnly && storageView === "stats") {
      result = result.filter((r) => {
        const playerKey = toPlayerKey(r.playerName || "", r.team);
        const hasLinkedProfile = playerIdByKey.byKey.has(playerKey) || playerIdByKey.byName.has(normalize(r.playerName || ""));
        return (
          !hasLinkedProfile ||
          !r.team ||
          r.avg == null ||
          r.obp == null ||
          r.slg == null
        );
      });
    }
    return result;
  }, [rows, search, showMissingOnly, storageView, playerIdByKey]);

  const { data: powerRows = [], isLoading: isPowerLoading } = useQuery({
    queryKey: ["admin-power-storage", selectedSeason],
    queryFn: async () => {
      let allData: any[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("player_predictions")
          .select(`
            id,
            model_type,
            variant,
            ev_score,
            barrel_score,
            whiff_score,
            chase_score,
            power_rating_score,
            power_rating_plus,
            players!inner(first_name, last_name, team)
          `)
          .eq("season", Number(selectedSeason))
          .order("updated_at", { ascending: false })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const batch = data || [];
        allData = allData.concat(batch);
        if (batch.length < pageSize) break;
        from += pageSize;
      }
      // 2025 power metrics must be sourced from the curated seed CSV only.
      // Do not overlay partial scouting fields from player_predictions, which can
      // reintroduce stale/misaligned values by name.
      if (selectedSeason === "2025") {
        return powerSeedRows.map((r) => ({ ...r }));
      }
      if (allData.length > 0) {
        return allData.map((row: any) => {
          const playerName = `${row.players?.first_name || ""} ${row.players?.last_name || ""}`.trim();
          return {
            id: row.id as string,
            playerName,
            team: row.players?.team as string | null,
            contact: null,
            lineDrive: null,
            avgExitVelo: null,
            popUp: null,
            bb: null,
            chase: row.chase_score as number | null,
            barrel: row.barrel_score as number | null,
            ev90: row.ev_score as number | null,
            pull: null,
            la10_30: null,
            gb: null,
            source: "player_predictions.partial",
          };
        });
      }
      return [];
    },
  });

  const filteredPowerRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let result = powerRows;
    if (q) {
      result = result.filter((r) =>
        [r.playerName, r.team || ""].some((v) => v.toLowerCase().includes(q)),
      );
    }
    if (showMissingOnly && storageView === "power") {
      result = result.filter((r) =>
        r.contact == null ||
        r.lineDrive == null ||
        r.avgExitVelo == null ||
        r.popUp == null ||
        r.bb == null ||
        r.chase == null ||
        r.barrel == null ||
        r.ev90 == null ||
        r.pull == null ||
        r.la10_30 == null ||
        r.gb == null,
      );
    }
    return result;
  }, [powerRows, search, showMissingOnly, storageView]);
  useEffect(() => {
    setStatsPage(1);
    setPowerPage(1);
  }, [search, showMissingOnly, selectedSeason, storageView]);
  const statsTotalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const powerTotalPages = Math.max(1, Math.ceil(filteredPowerRows.length / PAGE_SIZE));
  const safeStatsPage = Math.max(1, Math.min(statsPage, statsTotalPages));
  const safePowerPage = Math.max(1, Math.min(powerPage, powerTotalPages));
  const pagedStatsRows = useMemo(() => {
    const start = (safeStatsPage - 1) * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [filteredRows, safeStatsPage]);
  const pagedPowerRows = useMemo(() => {
    const start = (safePowerPage - 1) * PAGE_SIZE;
    return filteredPowerRows.slice(start, start + PAGE_SIZE);
  }, [filteredPowerRows, safePowerPage]);
  const getPageWindow = (current: number, total: number) => {
    const maxButtons = 7;
    if (total <= maxButtons) return Array.from({ length: total }, (_, i) => i + 1);
    let start = Math.max(1, current - 3);
    let end = Math.min(total, start + maxButtons - 1);
    start = Math.max(1, end - maxButtons + 1);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  };
  const powerParkCoverage = useMemo(() => {
    const total = filteredPowerRows.length;
    const assigned = filteredPowerRows.filter((r) => {
      return getParkFactorForTeam(r.team) != null;
    }).length;
    return { assigned, total };
  }, [filteredPowerRows, parkFactorByTeam]);

  const fmt3 = (v: number | null) => (v == null ? "—" : v.toFixed(3));
  const fmt2 = (v: number | null) => (v == null ? "—" : v.toFixed(2));
  const fmtWhole = (v: number | null) => (v == null ? "—" : Math.round(v).toString());
  const safeNumber = (value: string | undefined, fallback: number) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  const toAbbrevName = (fullName: string) => {
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return fullName;
    const firstInitial = parts[0][0]?.toUpperCase() || "";
    const lastName = parts[parts.length - 1];
    return `${firstInitial}. ${lastName}`;
  };
  const getPositionFor = (playerName: string, team?: string | null) => {
    if (selectedSeason !== "2025") return null;
    const byNameTeam = (exitPositions2025Seed as Record<string, string>)[`${playerName}|${team || ""}`];
    if (byNameTeam) return byNameTeam;
    const byName = (exitPositions2025Seed as Record<string, string>)[playerName];
    if (byName) return byName;
    const key = toAbbrevName(playerName);
    return (exitPositions2025Seed as Record<string, string>)[key] ?? null;
  };
  const erf = (x: number) => {
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * ax);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
    return sign * y;
  };
  const normalCdf = (x: number, mean: number, sd: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(mean) || !Number.isFinite(sd) || sd <= 0) return null;
    return 0.5 * (1 + erf((x - mean) / (sd * Math.SQRT2)));
  };
  const scoreFromNormal = (x: number | null, mean: number, sd: number, invert = false) => {
    if (x == null) return null;
    const cdf = normalCdf(x, mean, sd);
    if (cdf == null) return null;
    const pct = cdf * 100;
    return invert ? 100 - pct : pct;
  };
  const derivePowerScoresAndRatings = (r: {
    contact: number | null; lineDrive: number | null; avgExitVelo: number | null; popUp: number | null;
    bb: number | null; chase: number | null; barrel: number | null; ev90: number | null;
    pull: number | null; la10_30: number | null; gb: number | null;
  }) => {
    const baNcaaContact = safeNumber(editableValues.ba_ncaa_contact_pct, 77.1);
    const baNcaaLineDrive = safeNumber(editableValues.ba_ncaa_line_drive_pct, 20.9);
    const baNcaaAvgEV = safeNumber(editableValues.ba_ncaa_avg_exit_velocity, 86.2);
    const baNcaaPopUp = safeNumber(editableValues.ba_ncaa_popup_pct, 7.9);
    const obpNcaaBB = safeNumber(editableValues.obp_ncaa_bb_pct, 11.4);
    const obpNcaaChase = safeNumber(editableValues.obp_ncaa_chase_pct, 23.1);
    const isoNcaaBarrel = safeNumber(editableValues.iso_ncaa_barrel_pct, 17.3);
    const isoNcaaEv90 = safeNumber(editableValues.iso_ncaa_ev90, 103.1);
    const isoNcaaPull = safeNumber(editableValues.iso_ncaa_pull_pct, 36.5);
    const isoNcaaLa1030 = safeNumber(editableValues.iso_ncaa_la10_30_pct, 29);
    const isoNcaaGb = safeNumber(editableValues.iso_ncaa_gb_pct, 43.2);

    const baContactSd = safeNumber(editableValues.ba_contact_pct_std_dev, 6.6);
    const baLineDriveSd = safeNumber(editableValues.ba_line_drive_pct_std_dev, 4.31);
    const baAvgEvSd = safeNumber(editableValues.ba_avg_exit_velocity_std_dev, 4.28);
    const baPopUpSd = safeNumber(editableValues.ba_popup_pct_std_dev, 3.37);
    const obpBbSd = safeNumber(editableValues.obp_bb_pct_std_dev, 3.57);
    const obpChaseSd = safeNumber(editableValues.obp_chase_pct_std_dev, 5.58);
    const isoBarrelSd = safeNumber(editableValues.iso_barrel_pct_std_dev, 7.89);
    const isoEv90Sd = safeNumber(editableValues.iso_ev90_std_dev, 3.97);
    const isoPullSd = safeNumber(editableValues.iso_pull_pct_std_dev, 8.03);
    const isoLa1030Sd = safeNumber(editableValues.iso_la10_30_pct_std_dev, 6.81);
    const isoGbSd = safeNumber(editableValues.iso_gb_pct_std_dev, 8.0);

    const contactScore = scoreFromNormal(r.contact, baNcaaContact, baContactSd);
    const lineDriveScore = scoreFromNormal(r.lineDrive, baNcaaLineDrive, baLineDriveSd);
    const avgEVScore = scoreFromNormal(r.avgExitVelo, baNcaaAvgEV, baAvgEvSd);
    const popUpScore = scoreFromNormal(r.popUp, baNcaaPopUp, baPopUpSd, true);
    const bbScore = scoreFromNormal(r.bb, obpNcaaBB, obpBbSd);
    const chaseScore = scoreFromNormal(r.chase, obpNcaaChase, obpChaseSd, true);
    const barrelScore = scoreFromNormal(r.barrel, isoNcaaBarrel, isoBarrelSd);
    const ev90Score = scoreFromNormal(r.ev90, isoNcaaEv90, isoEv90Sd);
    const pullScore = scoreFromNormal(r.pull, isoNcaaPull, isoPullSd);
    const la1030Score = scoreFromNormal(r.la10_30, isoNcaaLa1030, isoLa1030Sd);
    const gbScore = scoreFromNormal(r.gb, isoNcaaGb, isoGbSd, true);

    const baPower =
      contactScore == null || lineDriveScore == null || avgEVScore == null || popUpScore == null
        ? null
        : (
          (safeNumber(editableValues.ba_contact_pct_weight, 0.4) * contactScore) +
          (safeNumber(editableValues.ba_line_drive_pct_weight, 0.25) * lineDriveScore) +
          (safeNumber(editableValues.ba_avg_exit_velocity_weight, 0.2) * avgEVScore) +
          (safeNumber(editableValues.ba_popup_pct_weight, 0.15) * popUpScore)
        );
    const obpPower =
      contactScore == null || lineDriveScore == null || avgEVScore == null || popUpScore == null || bbScore == null || chaseScore == null
        ? null
        : (
          (safeNumber(editableValues.obp_contact_pct_weight, 0.35) * contactScore) +
          (safeNumber(editableValues.obp_line_drive_pct_weight, 0.2) * lineDriveScore) +
          (safeNumber(editableValues.obp_avg_exit_velocity_weight, 0.15) * avgEVScore) +
          (safeNumber(editableValues.obp_popup_pct_weight, 0.1) * popUpScore) +
          (safeNumber(editableValues.obp_bb_pct_weight, 0.15) * bbScore) +
          (safeNumber(editableValues.obp_chase_pct_weight, 0.05) * chaseScore)
        );
    const isoPower =
      barrelScore == null || ev90Score == null || pullScore == null || la1030Score == null || gbScore == null
        ? null
        : (
          (safeNumber(editableValues.iso_barrel_pct_weight, 0.45) * barrelScore) +
          (safeNumber(editableValues.iso_ev90_weight, 0.3) * ev90Score) +
          (safeNumber(editableValues.iso_pull_pct_weight, 0.15) * pullScore) +
          (safeNumber(editableValues.iso_la10_30_pct_weight, 0.05) * la1030Score) +
          (safeNumber(editableValues.iso_gb_pct_weight, 0.05) * gbScore)
        );
    const baBase = safeNumber(editableValues.ba_ncaa_avg_power_rating, 50);
    const obpBase = safeNumber(editableValues.obp_ncaa_avg_power_rating, 50);
    const isoBase = safeNumber(editableValues.iso_ncaa_avg_power_rating, 50);
    const toPlus = (v: number | null, base: number) => (v == null || base === 0 ? null : (v / base) * 100);
    const baPowerPlus = toPlus(baPower, baBase);
    const obpPowerPlus = toPlus(obpPower, obpBase);
    const isoPowerPlus = toPlus(isoPower, isoBase);
    const overallPowerPlus =
      baPowerPlus == null || obpPowerPlus == null || isoPowerPlus == null
        ? null
        : (0.25 * baPowerPlus) + (0.4 * obpPowerPlus) + (0.35 * isoPowerPlus);

    return {
      contactScore, lineDriveScore, avgEVScore, popUpScore, bbScore, chaseScore,
      barrelScore, ev90Score, pullScore, la1030Score, gbScore,
      baPower, obpPower, isoPower, overallPower: overallPowerPlus,
      baPowerPlus, obpPowerPlus, isoPowerPlus, overallPowerPlus,
    };
  };
  const deriveMetrics = (avg: number | null, obp: number | null, slg: number | null) => {
    if (avg == null || obp == null || slg == null) {
      return { iso: null, ops: null, wrc: null, wrcPlus: null, owar: null };
    }
    // Manual in-app calculations from B-D style inputs (AVG/OBP/SLG).
    const iso = slg - avg;
    const ops = obp + slg;
    const wObp = 0.45;
    const wSlg = 0.30;
    const wAvg = 0.15;
    const wIso = 0.10;
    const ncaaAvgWrc = 0.364;
    const wrc = (wObp * obp) + (wSlg * slg) + (wAvg * avg) + (wIso * iso);
    const wrcPlus = ncaaAvgWrc === 0 ? null : (wrc / ncaaAvgWrc) * 100;
    if (wrcPlus == null) return { iso, ops, wrc, wrcPlus: null, owar: null };
    const offValue = (wrcPlus - 100) / 100;
    const plateAppearances = 260;
    const runsPerPA = 0.13;
    const replacementRunsPer600 = 25;
    const runsPerWin = 10;
    const raa = offValue * plateAppearances * runsPerPA;
    const replacementRuns = (plateAppearances / 600) * replacementRunsPer600;
    const rar = raa + replacementRuns;
    const owar = rar / runsPerWin;
    return { iso, ops, wrc, wrcPlus, owar };
  };

  const buildAndLinkProfilesMutation = useMutation({
    mutationFn: async () => {
      const season = Number(selectedSeason);
      if (season !== 2025) {
        throw new Error("Build/link action is currently limited to 2025 data storage.");
      }
      const { data: authData } = await supabase.auth.getSession();
      if (!authData.session) throw new Error("Not authenticated");

      const toNameParts = (fullName: string) => {
        const parts = fullName.trim().split(/\s+/).filter(Boolean);
        if (parts.length === 0) return { first_name: "Unknown", last_name: "Player" };
        if (parts.length === 1) return { first_name: parts[0], last_name: parts[0] };
        return { first_name: parts.slice(0, -1).join(" "), last_name: parts[parts.length - 1] };
      };
      const statsSeed = (storage2025Seed as Array<{
        id: string;
        playerName: string;
        team: string | null;
        conference: string | null;
        avg: number | null;
        obp: number | null;
        slg: number | null;
      }>).filter((row) => !!row.playerName?.trim());

      const powerByKey = new Map(
        (powerRatings2025Seed as Array<{
          playerName: string;
          team: string | null;
          contact: number | null;
          lineDrive: number | null;
          avgExitVelo: number | null;
          popUp: number | null;
          bb: number | null;
          chase: number | null;
          barrel: number | null;
          ev90: number | null;
          pull: number | null;
          la10_30: number | null;
          gb: number | null;
        }>).map((row) => [toPlayerKey(row.playerName, row.team), row]),
      );
      const desiredTeamByName = new Map<string, { team: string | null; conference: string | null }>();
      const ambiguousNameKeys = new Set<string>();
      for (const row of statsSeed) {
        const nameKey = normalize(row.playerName);
        if (!nameKey) continue;
        const existing = desiredTeamByName.get(nameKey);
        if (!existing) {
          desiredTeamByName.set(nameKey, { team: row.team ?? null, conference: row.conference ?? null });
          continue;
        }
        const existingTeam = (existing.team || "").trim();
        const nextTeam = (row.team || "").trim();
        if (existingTeam && nextTeam && existingTeam !== nextTeam) {
          ambiguousNameKeys.add(nameKey);
        }
      }

      // Fetch teams table for team_id linking
      const allTeamsForSync: Array<{ id: string; name: string }> = [];
      let tSyncFrom = 0;
      while (true) {
        const { data, error } = await supabase.from("teams").select("id, name").order("id", { ascending: true }).range(tSyncFrom, tSyncFrom + 999);
        if (error) throw error;
        allTeamsForSync.push(...(data || []));
        if (!data || data.length < 1000) break;
        tSyncFrom += 1000;
      }
      const normalizeTeamSync = (v: string | null | undefined) =>
        (v || "").trim().toLowerCase().replace(/\buniversity\b/g, "").replace(/\bof\b/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
      const teamIdByNormSync = new Map<string, string>();
      for (const t of allTeamsForSync) {
        teamIdByNormSync.set(normalizeTeamSync(t.name), t.id);
      }
      const resolveTeamId = (teamName: string | null | undefined) => teamIdByNormSync.get(normalizeTeamSync(teamName)) ?? null;

      // Fetch current players so we only insert missing ones.
      const existingPlayers: Array<{
        id: string;
        first_name: string;
        last_name: string;
        team: string | null;
        team_id: string | null;
      }> = [];
      let playerFrom = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("players")
          .select("id, first_name, last_name, team, team_id")
          .order("id", { ascending: true })
          .range(playerFrom, playerFrom + pageSize - 1);
        if (error) throw error;
        const batch = data || [];
        existingPlayers.push(...batch);
        if (batch.length < pageSize) break;
        playerFrom += pageSize;
      }

      const playerIdByKey = new Map<string, string>();
      const playerIdByName = new Map<string, string>();
      const playerTeamBackfillUpdates: Array<{ id: string; team: string | null; conference: string | null }> = [];
      for (const player of existingPlayers) {
        const fullName = `${player.first_name} ${player.last_name}`.trim();
        const key = toPlayerKey(fullName, player.team);
        if (!playerIdByKey.has(key)) playerIdByKey.set(key, player.id);
        const nameKey = normalize(fullName);
        if (!playerIdByName.has(nameKey)) playerIdByName.set(nameKey, player.id);
        if (!nameKey || ambiguousNameKeys.has(nameKey)) continue;
        const desired = desiredTeamByName.get(nameKey);
        if (!desired) continue;
        const currTeam = (player.team || "").trim();
        const nextTeam = (desired.team || "").trim();
        if (currTeam === nextTeam) continue;
        playerTeamBackfillUpdates.push({
          id: player.id,
          team: desired.team ?? null,
          conference: desired.conference ?? null,
        });
      }
      // Backfill missing team_id on existing players
      let teamIdBackfillCount = 0;
      for (const player of existingPlayers) {
        if (player.team_id) continue;
        const tid = resolveTeamId(player.team);
        if (!tid) continue;
        const { error } = await supabase.from("players").update({ team_id: tid }).eq("id", player.id);
        if (!error) teamIdBackfillCount++;
      }

      let updatedPlayers = 0;
      if (playerTeamBackfillUpdates.length > 0) {
        for (const row of playerTeamBackfillUpdates) {
          const teamId = resolveTeamId(row.team);
          const { error } = await supabase
            .from("players")
            .update({ team: row.team, conference: row.conference, ...(teamId ? { team_id: teamId } : {}) })
            .eq("id", row.id);
          if (error) throw error;
          updatedPlayers++;
        }
      }

      const playersToInsert: Array<{
        first_name: string;
        last_name: string;
        team: string | null;
        conference: string | null;
        position: string | null;
        transfer_portal: boolean;
      }> = [];
      const plannedPlayerKeys = new Set<string>();
      const plannedPlayerNameKeys = new Set<string>();

      for (const row of statsSeed) {
        const fullName = row.playerName.trim();
        const key = toPlayerKey(fullName, row.team);
        const nameKey = normalize(fullName);
        if (playerIdByKey.has(key) || playerIdByName.has(nameKey) || plannedPlayerKeys.has(key) || plannedPlayerNameKeys.has(nameKey)) continue;
        const nameParts = toNameParts(fullName);
        playersToInsert.push({
          first_name: nameParts.first_name,
          last_name: nameParts.last_name,
          team: row.team ?? null,
          team_id: resolveTeamId(row.team),
          conference: row.conference ?? null,
          position: getPositionFor(fullName, row.team),
          transfer_portal: false,
        });
        plannedPlayerKeys.add(key);
        plannedPlayerNameKeys.add(nameKey);
      }

      let createdPlayers = 0;
      if (playersToInsert.length > 0) {
        const insertedPlayers: Array<{
          id: string;
          first_name: string;
          last_name: string;
          team: string | null;
        }> = [];
        for (let i = 0; i < playersToInsert.length; i += 300) {
          const batch = playersToInsert.slice(i, i + 300);
          const { data, error } = await supabase
            .from("players")
            .insert(batch)
            .select("id, first_name, last_name, team");
          if (error) throw error;
          insertedPlayers.push(...(data || []));
        }
        createdPlayers = insertedPlayers.length;
        for (const player of insertedPlayers) {
          const fullName = `${player.first_name} ${player.last_name}`.trim();
          const key = toPlayerKey(fullName, player.team);
          const nameKey = normalize(fullName);
          if (!playerIdByKey.has(key)) playerIdByKey.set(key, player.id);
          if (!playerIdByName.has(nameKey)) playerIdByName.set(nameKey, player.id);
        }
      }

      // Fetch existing regular returner predictions for this season.
      const existingPreds: Array<{ id: string; player_id: string }> = [];
      let predFrom = 0;
      while (true) {
        const { data, error } = await supabase
          .from("player_predictions")
          .select("id, player_id")
          .eq("season", season)
          .eq("model_type", "returner")
          .eq("variant", "regular")
          .range(predFrom, predFrom + pageSize - 1);
        if (error) throw error;
        const batch = data || [];
        existingPreds.push(...batch);
        if (batch.length < pageSize) break;
        predFrom += pageSize;
      }
      const existingPredPlayerIds = new Set(existingPreds.map((p) => p.player_id));

      const predictionsToInsert: Array<{
        player_id: string;
        model_type: string;
        variant: string;
        season: number;
        status: string;
        locked: boolean;
        class_transition: string;
        dev_aggressiveness: number;
        from_avg: number | null;
        from_obp: number | null;
        from_slg: number | null;
        power_rating_plus: number | null;
      }> = [];
      const internalByPlayerId = new Map<string, { avg: number | null; obp: number | null; slg: number | null }>();
      const powerPlusByPlayerId = new Map<string, number>();
      const plannedPredictionPlayerIds = new Set<string>();

      // Fetch power ratings from Supabase by player_id (UUID-linked, no name matching needed)
      const dbPowerByPlayerId = new Map<string, typeof powerSeedRows[number]>();
      let powerFrom = 0;
      while (true) {
        const { data, error } = await supabase
          .from("hitting_power_ratings_storage")
          .select("player_id, player_name, team, contact, line_drive, avg_exit_velo, pop_up, bb, chase, barrel, ev90, pull, la_10_30, gb")
          .eq("season", season)
          .not("player_id", "is", null)
          .range(powerFrom, powerFrom + pageSize - 1);
        if (error) throw error;
        for (const row of data || []) {
          if (row.player_id) {
            dbPowerByPlayerId.set(row.player_id, {
              id: "", playerName: row.player_name || "", team: row.team || "",
              contact: row.contact, lineDrive: row.line_drive, avgExitVelo: row.avg_exit_velo,
              popUp: row.pop_up, bb: row.bb, chase: row.chase, barrel: row.barrel,
              ev90: row.ev90, pull: row.pull, la10_30: row.la_10_30, gb: row.gb, source: "supabase",
            });
          }
        }
        if (!data || data.length < pageSize) break;
        powerFrom += pageSize;
      }

      for (const row of statsSeed) {
        const fullName = row.playerName.trim();
        const key = toPlayerKey(fullName, row.team);
        const nameKey = normalize(fullName);
        const playerId = playerIdByKey.get(key) || playerIdByName.get(nameKey);
        // Look up power by UUID first, fall back to name+team key from seed, then name variants
        const nameVariants = (name: string, team: string | null) => {
          const keys = [toPlayerKey(name, team)];
          // Common nickname mappings
          const nicknames: Record<string, string[]> = {
            christopher: ["chris"], chris: ["christopher"],
            michael: ["mike"], mike: ["michael"],
            nicholas: ["nick"], nick: ["nicholas"],
            william: ["will", "bill"], will: ["william"], bill: ["william"],
            robert: ["rob", "bob"], rob: ["robert"], bob: ["robert"],
            james: ["jim", "jimmy"], jim: ["james"], jimmy: ["james"],
            joseph: ["joe"], joe: ["joseph"],
            benjamin: ["ben"], ben: ["benjamin"],
            matthew: ["matt"], matt: ["matthew"],
            daniel: ["dan"], dan: ["daniel"],
            anthony: ["tony"], tony: ["anthony"],
            thomas: ["tom"], tom: ["thomas"],
            richard: ["rich", "rick"], rich: ["richard"], rick: ["richard"],
            edward: ["ed", "eddie"], ed: ["edward"], eddie: ["edward"],
            jonathan: ["jon"], jon: ["jonathan"],
            samuel: ["sam"], sam: ["samuel"],
            alexander: ["alex"], alex: ["alexander"],
            timothy: ["tim"], tim: ["timothy"],
            zachary: ["zach"], zach: ["zachary"],
          };
          const parts = name.trim().split(/\s+/);
          const first = parts[0]?.toLowerCase();
          const rest = parts.slice(1).join(" ");
          for (const alt of (nicknames[first] || [])) {
            keys.push(toPlayerKey(`${alt} ${rest}`, team));
          }
          return keys;
        };
        let powerRow = (playerId ? dbPowerByPlayerId.get(playerId) : null) || powerByKey.get(key);
        if (!powerRow) {
          for (const vk of nameVariants(fullName, row.team ?? null)) {
            powerRow = powerByKey.get(vk);
            if (powerRow) break;
          }
        }
        if (!powerRow && playerIdByName.has(nameKey)) {
          powerRow = dbPowerByPlayerId.get(playerIdByName.get(nameKey)!) || null;
        }
        const power = powerRow ? derivePowerScoresAndRatings(powerRow) : null;
        if (playerId) {
          internalByPlayerId.set(playerId, {
            avg: power?.baPowerPlus ?? null,
            obp: power?.obpPowerPlus ?? null,
            slg: power?.isoPowerPlus ?? null,
          });
          // Track overall power for updating existing predictions
          if (power?.overallPowerPlus != null) {
            powerPlusByPlayerId.set(playerId, power.overallPowerPlus);
          }
        }
        if (!playerId || existingPredPlayerIds.has(playerId) || plannedPredictionPlayerIds.has(playerId)) continue;
        predictionsToInsert.push({
          player_id: playerId,
          model_type: "returner",
          variant: "regular",
          season,
          status: "active",
          locked: true,
          class_transition: "SJ",
          dev_aggressiveness: 0.0,
          from_avg: row.avg ?? null,
          from_obp: row.obp ?? null,
          from_slg: row.slg ?? null,
          power_rating_plus: power?.overallPowerPlus ?? 100,
        });
        plannedPredictionPlayerIds.add(playerId);
      }

      let createdPredictions = 0;
      const insertedPredictionRows: Array<{ id: string; player_id: string }> = [];
      if (predictionsToInsert.length > 0) {
        for (let i = 0; i < predictionsToInsert.length; i += 300) {
          const batch = predictionsToInsert.slice(i, i + 300);
          const { data, error } = await supabase
            .from("player_predictions")
            .insert(batch)
            .select("id, player_id");
          if (error) throw error;
          const inserted = data || [];
          insertedPredictionRows.push(...inserted);
          createdPredictions += inserted.length;
        }
      }

      // Upsert internals for NEWLY created predictions
      const internalsToUpsert: Array<{
        prediction_id: string;
        avg_power_rating: number | null;
        obp_power_rating: number | null;
        slg_power_rating: number | null;
      }> = insertedPredictionRows.map((pred) => {
        const internal = internalByPlayerId.get(pred.player_id);
        return {
          prediction_id: pred.id,
          avg_power_rating: internal?.avg ?? null,
          obp_power_rating: internal?.obp ?? null,
          slg_power_rating: internal?.slg ?? null,
        };
      });
      if (internalsToUpsert.length > 0) {
        const { error } = await supabase
          .from("player_prediction_internals")
          .upsert(internalsToUpsert, { onConflict: "prediction_id" });
        if (error) throw error;
      }

      // Also update internals for EXISTING predictions that now have power data
      const existingInternalsToUpdate: typeof internalsToUpsert = [];
      for (const pred of existingPreds) {
        const internal = internalByPlayerId.get(pred.player_id);
        if (!internal || (internal.avg == null && internal.obp == null && internal.slg == null)) continue;
        existingInternalsToUpdate.push({
          prediction_id: pred.id,
          avg_power_rating: internal.avg,
          obp_power_rating: internal.obp,
          slg_power_rating: internal.slg,
        });
      }
      if (existingInternalsToUpdate.length > 0) {
        for (let i = 0; i < existingInternalsToUpdate.length; i += 300) {
          const batch = existingInternalsToUpdate.slice(i, i + 300);
          const { error } = await supabase
            .from("player_prediction_internals")
            .upsert(batch, { onConflict: "prediction_id" });
          if (error) throw error;
        }
      }

      // Update power_rating_plus on existing predictions that were missing it
      for (const pred of existingPreds) {
        const pp = powerPlusByPlayerId.get(pred.player_id);
        if (pp == null) continue;
        await supabase.from("player_predictions").update({ power_rating_plus: pp }).eq("id", pred.id);
      }

      // Backfill internals for already-existing returner predictions in case they were created earlier.
      if (existingPreds.length > 0) {
        const missingInternals = existingPreds.map((pred) => {
          const internal = internalByPlayerId.get(pred.player_id);
          return {
            prediction_id: pred.id,
            avg_power_rating: internal?.avg ?? null,
            obp_power_rating: internal?.obp ?? null,
            slg_power_rating: internal?.slg ?? null,
          };
        });
        if (missingInternals.length > 0) {
          const { error } = await supabase
            .from("player_prediction_internals")
            .upsert(missingInternals, { onConflict: "prediction_id" });
          if (error) throw error;
        }
      }

      // Keep 2025 returner template aligned with current testing defaults:
      // class transition SJ and dev aggressiveness 0.0 unless user manually changed away from legacy default.
      const { error: normalizeDevError } = await supabase
        .from("player_predictions")
        .update({ dev_aggressiveness: 0.0, class_transition: "SJ" })
        .eq("season", season)
        .eq("model_type", "returner")
        .eq("variant", "regular")
        .or("dev_aggressiveness.is.null,dev_aggressiveness.eq.0.5");
      if (normalizeDevError) throw normalizeDevError;

      const recalcData = await bulkRecalculatePredictionsLocal();

      return {
        createdPlayers,
        updatedPlayers,
        createdPredictions,
        recalculated: recalcData.updated ?? 0,
        teamIdBackfill: teamIdBackfillCount,
      };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["admin-data-storage"] });
      queryClient.invalidateQueries({ queryKey: ["admin-power-storage"] });
      queryClient.invalidateQueries({ queryKey: ["returning-players-2025-unified"] });
      queryClient.invalidateQueries({ queryKey: ["player-profile"] });
      queryClient.invalidateQueries({ queryKey: ["team-builder-returners-v3"] });
      toast.success(
        `Profiles synced: ${result.createdPlayers} players added, ${result.updatedPlayers} players updated, ${result.createdPredictions} predictions added, ${result.recalculated} recalculated, ${result.teamIdBackfill} team_ids linked.`,
      );
    },
    onError: (error: unknown) => {
      let message = "Failed to build/link player profiles.";
      if (error instanceof Error && error.message) {
        message = error.message;
      } else if (error && typeof error === "object") {
        try {
          const maybe = error as { message?: string; details?: string; hint?: string; code?: string };
          const parts = [maybe.message, maybe.details, maybe.hint, maybe.code].filter(Boolean);
          if (parts.length > 0) message = parts.join(" | ");
          else message = JSON.stringify(error);
        } catch {
          // keep default
        }
      }
      toast.error(message);
    },
  });

  if (
    storageDomain === "hitting" &&
    ((storageView === "stats" && isLoading) || (storageView === "power" && isPowerLoading))
  ) {
    return <p className="text-muted-foreground py-8 text-center">Loading {selectedSeason} storage data…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">2025 Data Storage</h3>
          <p className="text-sm text-muted-foreground">Storage for each player&apos;s 2025 team and stats. This is source data for future backend equation auto-population, not prediction results.</p>
          {storageDomain === "hitting" && filteredRows.length > 0 ? (
            <p className="text-xs text-muted-foreground mt-1">Source: {filteredRows[0].source}</p>
          ) : null}
          {storageDomain === "hitting" && storageView === "power" && (
            <p className="text-xs text-muted-foreground mt-1">
              Park factors assigned (filtered rows): {powerParkCoverage.assigned}/{powerParkCoverage.total}
            </p>
          )}
        </div>
        <Input
          placeholder="Search player/team/conference…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:w-72"
        />
        <Button
          type="button"
          variant={showMissingOnly ? "secondary" : "outline"}
          onClick={() => setShowMissingOnly((prev) => !prev)}
        >
          {showMissingOnly ? "Showing Missing Only" : "Missing Data Only"}
        </Button>
        <Select value={selectedSeason} onValueChange={(v: "2025" | "2026") => setSelectedSeason(v)}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Season" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="2025">2025</SelectItem>
            <SelectItem value="2026">2026</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => buildAndLinkProfilesMutation.mutate()}
          disabled={buildAndLinkProfilesMutation.isPending || selectedSeason !== "2025"}
          title={selectedSeason !== "2025" ? "Only available for 2025 right now" : undefined}
        >
          {buildAndLinkProfilesMutation.isPending ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          {buildAndLinkProfilesMutation.isPending ? "Building/Linking…" : "Build/Link 2025 Profiles"}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Tabs value={storageDomain} onValueChange={(v) => setStorageDomain(v as "hitting" | "pitching")} className="p-4 pt-3">
            <TabsList>
              <TabsTrigger value="hitting">Hitting</TabsTrigger>
              <TabsTrigger value="pitching">Pitching</TabsTrigger>
            </TabsList>

            <TabsContent value="hitting" className="mt-3">
              <Tabs value={storageView} onValueChange={(v) => setStorageView(v as "stats" | "power")}>
                <TabsList>
                  <TabsTrigger value="stats">Stats Storage</TabsTrigger>
                  <TabsTrigger value="power">Power Ratings Storage</TabsTrigger>
                </TabsList>

                <TabsContent value="stats" className="mt-3">
                  <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      Showing {filteredRows.length ? (safeStatsPage - 1) * PAGE_SIZE + 1 : 0}-
                      {Math.min(safeStatsPage * PAGE_SIZE, filteredRows.length)} of {filteredRows.length} players
                    </span>
                    <div className="flex items-center gap-1">
                      {getPageWindow(safeStatsPage, statsTotalPages).map((p) => (
                        <Button
                          key={`stats-page-${p}`}
                          size="sm"
                          variant={p === safeStatsPage ? "secondary" : "ghost"}
                          className="h-7 min-w-7 px-2 text-xs"
                          onClick={() => setStatsPage(p)}
                        >
                          {p}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="max-h-[620px] overflow-auto">
                    <Table>
                      <TableHeader className="sticky top-0 z-20 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
                        <TableRow>
                          <TableHead className="sticky left-0 z-30 bg-background min-w-[220px]">Player</TableHead>
                          <TableHead>Team</TableHead>
                          <TableHead className="text-right">Park Factor+</TableHead>
                          <TableHead>Pos</TableHead>
                          <TableHead className="text-right">AVG</TableHead>
                          <TableHead className="text-right">OBP</TableHead>
                          <TableHead className="text-right">SLG</TableHead>
                          <TableHead className="text-right">OPS</TableHead>
                          <TableHead className="text-right">ISO</TableHead>
                          <TableHead className="text-right">WRC</TableHead>
                          <TableHead className="text-right">WRC+</TableHead>
                          <TableHead className="text-right">oWAR</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pagedStatsRows.length ? (
                          pagedStatsRows.map((r) => {
                            const m = deriveMetrics(r.avg, r.obp, r.slg);
                            return (
                              <TableRow key={r.id}>
                                <TableCell className="sticky left-0 z-10 bg-background font-medium min-w-[220px]">
                                  {(() => {
                                    const playerId = resolvePlayerId(r.playerName || "", r.team);
                                    if (!playerId) return r.playerName || "—";
                                    return (
                                      <Link
                                        to={profileRouteFor(playerId, getPositionFor(r.playerName, r.team))}
                                        className="text-primary underline-offset-4 hover:underline"
                                      >
                                        {r.playerName || "—"}
                                      </Link>
                                    );
                                  })()}
                                </TableCell>
                                <TableCell>{r.team || "—"}</TableCell>
                                <TableCell className="text-right font-mono">
                                  {(() => {
                                    const pf = getParkFactorForTeam(r.team);
                                    return pf == null ? "—" : Math.round(pf * 100).toString();
                                  })()}
                                </TableCell>
                                <TableCell>{getPositionFor(r.playerName, r.team) || "—"}</TableCell>
                                <TableCell className="text-right font-mono">{fmt3(r.avg)}</TableCell>
                                <TableCell className="text-right font-mono">{fmt3(r.obp)}</TableCell>
                                <TableCell className="text-right font-mono">{fmt3(r.slg)}</TableCell>
                                <TableCell className="text-right font-mono">{fmt3(m.ops)}</TableCell>
                                <TableCell className="text-right font-mono">{fmt3(m.iso)}</TableCell>
                                <TableCell className="text-right font-mono">{fmt3(m.wrc)}</TableCell>
                                <TableCell className="text-right font-mono">{m.wrcPlus == null ? "—" : Math.round(m.wrcPlus).toString()}</TableCell>
                                <TableCell className="text-right font-mono">{fmt2(m.owar)}</TableCell>
                              </TableRow>
                            );
                          })
                        ) : (
                          <TableRow>
                            <TableCell colSpan={12} className="py-8 text-center text-muted-foreground">
                              No {selectedSeason} season stats rows found.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="power" className="mt-3">
                  <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      Showing {filteredPowerRows.length ? (safePowerPage - 1) * PAGE_SIZE + 1 : 0}-
                      {Math.min(safePowerPage * PAGE_SIZE, filteredPowerRows.length)} of {filteredPowerRows.length} players
                    </span>
                    <div className="flex items-center gap-1">
                      {getPageWindow(safePowerPage, powerTotalPages).map((p) => (
                        <Button
                          key={`power-page-${p}`}
                          size="sm"
                          variant={p === safePowerPage ? "secondary" : "ghost"}
                          className="h-7 min-w-7 px-2 text-xs"
                          onClick={() => setPowerPage(p)}
                        >
                          {p}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="max-h-[620px] overflow-auto">
                    <Table>
                      <TableHeader className="sticky top-0 z-20 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
                        <TableRow>
                          <TableHead className="sticky left-0 z-30 bg-background min-w-[220px]">Player</TableHead>
                          <TableHead>Team</TableHead>
                          <TableHead>Pos</TableHead>
                          <TableHead className="text-right">Contact%</TableHead>
                          <TableHead className="text-right">Line Drive%</TableHead>
                          <TableHead className="text-right">Avg Exit Velo</TableHead>
                          <TableHead className="text-right">Pop-Up%</TableHead>
                          <TableHead className="text-right">BB%</TableHead>
                          <TableHead className="text-right">Chase%</TableHead>
                          <TableHead className="text-right">Barrel%</TableHead>
                          <TableHead className="text-right">EV90</TableHead>
                          <TableHead className="text-right">Pull%</TableHead>
                          <TableHead className="text-right">LA 10-30%</TableHead>
                          <TableHead className="text-right">GB%</TableHead>
                          <TableHead className="text-right">Contact Score</TableHead>
                          <TableHead className="text-right">Line Drive Score</TableHead>
                          <TableHead className="text-right">Avg EV Score</TableHead>
                          <TableHead className="text-right">Pop-Up Score</TableHead>
                          <TableHead className="text-right">BB% Score</TableHead>
                          <TableHead className="text-right">Chase% Score</TableHead>
                          <TableHead className="text-right">Barrel Score</TableHead>
                          <TableHead className="text-right">EV90 Score</TableHead>
                          <TableHead className="text-right">Pull% Score</TableHead>
                          <TableHead className="text-right">LA10-30 Score</TableHead>
                          <TableHead className="text-right">GB% Score</TableHead>
                          <TableHead className="text-right">BA Power Rating+</TableHead>
                          <TableHead className="text-right">OBP Power Rating+</TableHead>
                          <TableHead className="text-right">ISO Power Rating+</TableHead>
                          <TableHead className="text-right">Overall Power Rating+</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pagedPowerRows.length ? (
                          pagedPowerRows.map((r) => {
                            const p = derivePowerScoresAndRatings(r);
                            return (
                            <TableRow key={r.id}>
                              <TableCell className="sticky left-0 z-10 bg-background font-medium min-w-[220px]">
                                {(() => {
                                  const playerId = resolvePlayerId(r.playerName || "", r.team);
                                  if (!playerId) return r.playerName || "—";
                                  return (
                                    <Link
                                      to={profileRouteFor(playerId, getPositionFor(r.playerName, r.team))}
                                      className="text-primary underline-offset-4 hover:underline"
                                    >
                                      {r.playerName || "—"}
                                    </Link>
                                  );
                                })()}
                              </TableCell>
                              <TableCell>{r.team || "—"}</TableCell>
                              <TableCell>{getPositionFor(r.playerName, r.team) || "—"}</TableCell>
                              <TableCell className="text-right font-mono">{fmt2(r.contact)}</TableCell>
                                <TableCell className="text-right font-mono">{fmt2(r.lineDrive)}</TableCell>
                                <TableCell className="text-right font-mono">{fmt2(r.avgExitVelo)}</TableCell>
                                <TableCell className="text-right font-mono">{fmt2(r.popUp)}</TableCell>
                                <TableCell className="text-right font-mono">{fmt2(r.bb)}</TableCell>
                                <TableCell className="text-right font-mono">{fmt2(r.chase)}</TableCell>
                                <TableCell className="text-right font-mono">{fmt2(r.barrel)}</TableCell>
                                <TableCell className="text-right font-mono">{fmt2(r.ev90)}</TableCell>
                                <TableCell className="text-right font-mono">{fmt2(r.pull)}</TableCell>
                                <TableCell className="text-right font-mono">{fmt2(r.la10_30)}</TableCell>
                                <TableCell className="text-right font-mono">{fmt2(r.gb)}</TableCell>
                                <TableCell className="text-right font-mono">{fmtWhole(p.contactScore)}</TableCell>
                                <TableCell className="text-right font-mono">{fmtWhole(p.lineDriveScore)}</TableCell>
                                <TableCell className="text-right font-mono">{fmtWhole(p.avgEVScore)}</TableCell>
                                <TableCell className="text-right font-mono">{fmtWhole(p.popUpScore)}</TableCell>
                                <TableCell className="text-right font-mono">{fmtWhole(p.bbScore)}</TableCell>
                                <TableCell className="text-right font-mono">{fmtWhole(p.chaseScore)}</TableCell>
                                <TableCell className="text-right font-mono">{fmtWhole(p.barrelScore)}</TableCell>
                                <TableCell className="text-right font-mono">{fmtWhole(p.ev90Score)}</TableCell>
                                <TableCell className="text-right font-mono">{fmtWhole(p.pullScore)}</TableCell>
                                <TableCell className="text-right font-mono">{fmtWhole(p.la1030Score)}</TableCell>
                                <TableCell className="text-right font-mono">{fmtWhole(p.gbScore)}</TableCell>
                                <TableCell className="text-right font-mono">{fmtWhole(p.baPowerPlus)}</TableCell>
                                <TableCell className="text-right font-mono">{fmtWhole(p.obpPowerPlus)}</TableCell>
                                <TableCell className="text-right font-mono">{fmtWhole(p.isoPowerPlus)}</TableCell>
                                <TableCell className="text-right font-mono">{fmtWhole(p.overallPowerPlus)}</TableCell>
                              </TableRow>
                            );
                          })
                        ) : (
                          <TableRow>
                            <TableCell colSpan={30} className="py-8 text-center text-muted-foreground">
                              No {selectedSeason} power rating rows found.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>
              </Tabs>
            </TabsContent>

            <TabsContent value="pitching" className="mt-3">
              <Tabs defaultValue="stats">
                <TabsList>
                  <TabsTrigger value="stats">Stats Storage</TabsTrigger>
                  <TabsTrigger value="power">Power Ratings Storage</TabsTrigger>
                  <TabsTrigger value="stuff">Stuff+</TabsTrigger>
                </TabsList>
                <TabsContent value="stats" className="mt-3">
                  <PitchingStatsStorageTable season={selectedSeason} />
                </TabsContent>
                <TabsContent value="power" className="mt-3">
                  <PitchingPowerRatingsStorageTable season={selectedSeason} />
                </TabsContent>
                <TabsContent value="stuff" className="mt-3">
                  <PitchingStuffPlusStorageTable season={selectedSeason} />
                </TabsContent>
              </Tabs>
            </TabsContent>
          </Tabs>
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
  hitting: ReactNode;
  pitching?: ReactNode;
  pitchingTitle: string;
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
            <TabsTrigger value="teams" className="gap-1.5">
              <Building2 className="h-4 w-4" />
              Teams
            </TabsTrigger>
            <TabsTrigger value="data-storage-2025" className="gap-1.5">
              <Check className="h-4 w-4" />
              Data Storage
            </TabsTrigger>
            <TabsTrigger value="actions" className="gap-1.5">
              <RefreshCw className="h-4 w-4" />
              Data Sync
            </TabsTrigger>
            <TabsTrigger value="portal" className="gap-1.5">
              <LogIn className="h-4 w-4" />
              Portal
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
            <HittingPitchingSection
              hitting={<PowerRatingsTab />}
              pitching={<PitchingConferenceStatsTable />}
              pitchingTitle="Conference Statistics — Pitching"
            />
          </TabsContent>
          <TabsContent value="power-ratings">
            <HittingPitchingSection
              hitting={<AdminPowerRatingsTab />}
              pitching={<PitchingPowerRatingsTab />}
              pitchingTitle="Power Ratings — Pitching"
            />
          </TabsContent>
          <TabsContent value="teams">
            <TeamsAdminTab />
          </TabsContent>
          <TabsContent value="actions">
            <QuickActionsTab />
          </TabsContent>
          <TabsContent value="data-storage-2025">
            <DataStorage2025Tab />
          </TabsContent>
          <TabsContent value="portal">
            <BulkPortalStatusTab />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
