import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import ConferenceStatsTable from "@/components/ConferenceStatsTable";
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
import { Pencil, RefreshCw, Scale, Sliders, Trophy, Plus, Trash2, Building2, Check, Edit2, Save, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

// ─── Equation Constants Tab ───────────────────────────────────────────────────

function EquationConstantsTab() {
  const [editableSections, setEditableSections] = useState<Record<string, boolean>>({});
  const defaultEditableValues: Record<string, string> = {
    r_ncaa_avg_ba: "0.280",
    r_ncaa_avg_obp: "0.385",
    r_ncaa_avg_iso: "0.162",
    r_w_obp: "0.45",
    r_w_slg: "0.30",
    r_w_avg: "0.15",
    r_w_iso: "0.10",
    r_ncaa_avg_wrc: "1.000",
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
    t_ba_ncaa_avg: "0.280",
    t_ba_power_weight: "0.70",
    t_ba_conference_weight: "1.000",
    t_ba_pitching_weight: "1.000",
    t_ba_park_weight: "1.000",
    t_obp_ncaa_avg: "0.385",
    t_obp_power_weight: "0.70",
    t_obp_conference_weight: "1.000",
    t_obp_pitching_weight: "1.000",
    t_obp_park_weight: "1.000",
    t_iso_ncaa_avg: "0.162",
    t_iso_std_ncaa: "0.07849797197",
    t_iso_std_power: "45.423",
    t_iso_conference_weight: "1.000",
    t_iso_pitching_weight: "1.000",
    t_iso_park_weight: "1.000",
    t_w_obp: "0.45",
    t_w_slg: "0.30",
    t_w_avg: "0.15",
    t_w_iso: "0.10",
    t_wrc_plus_ncaa_avg: "1.000",
    nil_base_per_owar: "25000",
    nil_tier_sec: "1.5",
    nil_tier_p4: "1.2",
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
      // Force latest OBP weight defaults into editable values so legacy local storage does not override them.
      merged.obp_contact_pct_weight = defaultEditableValues.obp_contact_pct_weight;
      merged.obp_line_drive_pct_weight = defaultEditableValues.obp_line_drive_pct_weight;
      merged.obp_avg_exit_velocity_weight = defaultEditableValues.obp_avg_exit_velocity_weight;
      merged.obp_pop_up_pct_weight = defaultEditableValues.obp_pop_up_pct_weight;
      merged.obp_walk_pct_weight = defaultEditableValues.obp_walk_pct_weight;
      merged.obp_chase_pct_weight = defaultEditableValues.obp_chase_pct_weight;
      merged.obp_ncaa_avg_power_rating = defaultEditableValues.obp_ncaa_avg_power_rating;
      for (const [k, v] of Object.entries(merged)) {
        if (v === "") merged[k] = defaultEditableValues[k] ?? "";
      }
      return merged;
    } catch {
      return defaultEditableValues;
    }
  });

  const { isLoading } = useQuery({
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
              <div><span className="text-muted-foreground">Blended =</span> (LastBA × (1 - PowerRatingWeight)) + (NCAAAvgBA × (BAPowerRating+ / NCAAAvgPowerRating) × PowerRatingWeight)</div>
              <div><span className="text-muted-foreground">Mult =</span> (1) + (ClassAdjustment) + (DevAggressiveness × 0.06)</div>
              <div><span className="text-muted-foreground">Projected =</span> Blended × Mult</div>
              <div><span className="text-muted-foreground">Delta =</span> Projected - LastBA</div>
              <div><span className="text-muted-foreground">DampFactor =</span></div>
              <div className="ml-6 space-y-1 text-xs">
                <div>1.0 if Delta ≤ 0 (no growth)</div>
                <div>1.0 if 0 &lt; Delta ≤ 0.03 (small growth, full effect)</div>
                <div>0.9 if 0.03 &lt; Delta ≤ 0.06 (moderate growth, 90% of delta)</div>
                <div>0.7 if 0.06 &lt; Delta ≤ 0.08 (large growth, 70% of delta)</div>
                <div>0.4 if Delta &gt; 0.08 (extreme growth, 40% of delta)</div>
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
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-4">On Base %</h4>
            <div className="bg-muted p-4 rounded-lg font-mono text-sm space-y-2">
              <div><span className="text-muted-foreground">Blended =</span> (LastOBP × (1 - PowerRatingWeight)) + (NCAAAvgOBP × (OBPPowerRating+ / NCAAAvgPowerRating) × PowerRatingWeight)</div>
              <div><span className="text-muted-foreground">Mult =</span> (1) + (ClassAdjustment) + (DevAggressiveness × 0.06)</div>
              <div><span className="text-muted-foreground">Projected =</span> Blended × Mult</div>
              <div><span className="text-muted-foreground">Delta =</span> Projected - LastOBP</div>
              <div><span className="text-muted-foreground">DampFactor =</span></div>
              <div className="ml-6 space-y-1 text-xs">
                <div>1.0 if Delta ≤ 0 (no growth)</div>
                <div>1.0 if 0 &lt; Delta ≤ 0.03 (small growth, full effect)</div>
                <div>0.9 if 0.03 &lt; Delta ≤ 0.06 (moderate growth, 90% of delta)</div>
                <div>0.7 if 0.06 &lt; Delta ≤ 0.08 (large growth, 70% of delta)</div>
                <div>0.4 if Delta &gt; 0.08 (extreme growth, 40% of delta)</div>
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
              <div><span className="text-muted-foreground">PowerAdj =</span> NCAAAvgBattingAverage × (BattingAveragePowerRating+ / 100)</div>
              <div><span className="text-muted-foreground">Blended =</span> (LastStat × (1 - PowerRatingWeight)) + (PowerAdj × PowerRatingWeight)</div>
              <div><span className="text-muted-foreground">Multiplier =</span> (1 + (ConferenceWeight × ((ToAverage+ - FromAverage+) / 100))) - (PitchingWeight × ((ToStuff+ - FromStuff+) / 100)) + (ParkFactorWeight × ((ToParkFactor - FromParkFactor) / 100))</div>
              <div><span className="text-muted-foreground">ProjectedBA =</span> Blended × Multiplier</div>
            </div>
            <div className="mt-4 grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Constants</p>
                <div className="ml-2 space-y-0.5">
                  <div>• Power rating normalization = 100</div>
                </div>
              </div>
              <div className={sectionPanelClass}>
                {editableSectionHeader("t_ba")}
                <div className="space-y-1.5">
                  {syncedField("NCAA Avg Batting Average", ncaaStats?.avg, 3)}
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
              <div><span className="text-muted-foreground">PowerAdj =</span> NCAAAvgOBP × (OBPPowerRating+ / 100)</div>
              <div><span className="text-muted-foreground">Blended =</span> (LastOBP × (1 - PowerRatingWeight)) + (PowerAdj × PowerRatingWeight)</div>
              <div><span className="text-muted-foreground">Multiplier =</span> (1 + (ConferenceWeight × ((ToOBP+ - FromOBP+) / 100))) - (PitchingWeight × ((ToStuff+ - FromStuff+) / 100)) + (ParkFactorWeight × ((ToParkFactor - FromParkFactor) / 100))</div>
              <div><span className="text-muted-foreground">ProjectedOBP =</span> Blended × Multiplier</div>
            </div>
            <div className="mt-4 grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Constants</p>
                <div className="ml-2 space-y-0.5">
                  <div>• Power rating normalization = 100</div>
                </div>
              </div>
              <div className={sectionPanelClass}>
                {editableSectionHeader("t_obp")}
                <div className="space-y-1.5">
                  {syncedField("NCAA Avg OBP", ncaaStats?.obp, 3)}
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
              <div><span className="text-muted-foreground">Multiplier =</span> (1 + (ConferenceWeight × ((ToISO+ - FromISO+) / 100))) - (PitchingWeight × ((ToStuff+ - FromStuff+) / 100)) + (ParkFactorWeight × ((ToParkFactor - FromParkFactor) / 100))</div>
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
          <CardTitle className="text-lg">NIL Valuation</CardTitle>
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
                  <div>• ACC / Big12 / Big10 = 1.2</div>
                  <div>• Strong Mid Major = 0.8</div>
                  <div>• Low Major = 0.5</div>
                  <div className="pt-1">• Catcher / Shortstop / Center Field = 1.3</div>
                  <div>• Second Base / Third Base / Corner Outfield = 1.1</div>
                  <div>• First Base / DH = 1.0</div>
                  <div>• Bench Utility = 0.8</div>
                  <div className="pt-1 text-[10px]">Conference-to-tier mapping can be defined later.</div>
                </div>
              </div>
              <div className={sectionPanelClass}>
                {editableSectionHeader("nil_tiers")}
                <div className="space-y-1.5">
                  {editableField("nil_tiers", "nil_tier_sec", "SEC")}
                  {editableField("nil_tiers", "nil_tier_p4", "ACC/Big12/Big10")}
                  {editableField("nil_tiers", "nil_tier_strong_mid", "Strong Mid Major")}
                  {editableField("nil_tiers", "nil_tier_low_major", "Low Major")}
                </div>
                <div className="my-2 border-t" />
                {editableSectionHeader("nil_positions")}
                <div className="space-y-1.5">
                  {editableField("nil_positions", "nil_pos_group_c_ss_cf", "Catcher / Shortstop / Center Field")}
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
    iso_ncaa_ev_metric: "0.0",
    iso_ncaa_barrel_metric: "0.0",
    iso_ncaa_whiff_metric: "0.0",
    iso_ncaa_chase_metric: "0.0",
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
    iso_ev_std_dev: "1.0",
    iso_barrel_std_dev: "1.0",
    iso_whiff_std_dev: "1.0",
    iso_chase_std_dev: "1.0",
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
    iso_ev_weight: "0.45",
    iso_barrel_weight: "0.40",
    iso_whiff_weight: "0.10",
    iso_chase_weight: "0.05",
    overall_ba_weight: "0.30",
    overall_obp_weight: "0.30",
    overall_iso_weight: "0.25",
    overall_contact_weight: "0.15",
  };
  const [editableValues, setEditableValues] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem("admin_dashboard_power_equation_values_v3");
      if (!raw) return defaultEditableValues;
      const parsed = JSON.parse(raw) as Record<string, string>;
      const merged = { ...defaultEditableValues, ...parsed };
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
  const isoEVWeight = safeNumber(editableValues.iso_ev_weight, 0.45);
  const isoBarrelWeight = safeNumber(editableValues.iso_barrel_weight, 0.4);
  const isoWhiffWeight = safeNumber(editableValues.iso_whiff_weight, 0.1);
  const isoChaseWeight = safeNumber(editableValues.iso_chase_weight, 0.05);

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
            <div><span className="text-muted-foreground">BAPowerRating+ =</span> (BAPowerRating / NCAAAverageBAPowerRating) × 100</div>
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
            <div><span className="text-muted-foreground">OBPPowerRating+ =</span> (OBPPowerRating / NCAAAverageOBPPowerRating) × 100</div>
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
            <div><span className="text-muted-foreground">ISOPowerRating =</span> ({isoEVWeight.toFixed(2)} × EVScore) + ({isoBarrelWeight.toFixed(2)} × BarrelScore) + ({isoWhiffWeight.toFixed(2)} × WhiffScore) + ({isoChaseWeight.toFixed(2)} × ChaseScore)</div>
            <div><span className="text-muted-foreground">ISOPowerRating+ =</span> (ISOPowerRating / NCAAAverageISOPowerRating) × 100</div>
          </div>
          <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>Player-Specific Inputs</p>
              <div className="ml-2 space-y-0.5">
                <div>• EV Score</div>
                <div>• Barrel Score</div>
                <div>• Whiff Score</div>
                <div>• Chase Score</div>
              </div>
            </div>
            <div className={sectionPanelClass}>
              {editableSectionHeader("pr_iso")}
              <div className="space-y-1.5">
                {editableField("pr_iso", "iso_ncaa_avg_power_rating", "NCAA Average ISO Power Rating")}
                {editableField("pr_iso", "iso_ev_weight", "EV Weight")}
                {editableField("pr_iso", "iso_barrel_weight", "Barrel Weight")}
                {editableField("pr_iso", "iso_whiff_weight", "Whiff Weight")}
                {editableField("pr_iso", "iso_chase_weight", "Chase Weight")}
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
            <div><span className="text-muted-foreground">OverallPowerRating =</span> (BAPowerRating × BAWeight) + (OBPPowerRating × OBPWeight) + (ISOPowerRating × ISOWeight) + (ContactComponent × ContactWeight)</div>
          </div>
          <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>Inputs</p>
              <div className="ml-2 space-y-0.5">
                <div>• BA Power Rating</div>
                <div>• OBP Power Rating</div>
                <div>• ISO Power Rating</div>
                <div>• Contact Component</div>
              </div>
            </div>
            <div className={sectionPanelClass}>
              {editableSectionHeader("pr_overall")}
              <div className="space-y-1.5">
                {editableField("pr_overall", "overall_ba_weight", "BA Weight")}
                {editableField("pr_overall", "overall_obp_weight", "OBP Weight")}
                {editableField("pr_overall", "overall_iso_weight", "ISO Weight")}
                {editableField("pr_overall", "overall_contact_weight", "Contact Weight")}
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
                <div className="rounded bg-background/70 px-2 py-1 break-words">EVScore = NORM.DIST(EVMetric, NCAAAverageEVMetric, EVMetricStdDev, TRUE) × 100</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">BarrelScore = NORM.DIST(BarrelMetric, NCAAAverageBarrelMetric, BarrelMetricStdDev, TRUE) × 100</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">WhiffScore = 100 - (NORM.DIST(WhiffMetric, NCAAAverageWhiffMetric, WhiffMetricStdDev, TRUE) × 100)</div>
                <div className="rounded bg-background/70 px-2 py-1 break-words">ChaseScore = 100 - (NORM.DIST(ChaseMetric, NCAAAverageChaseMetric, ChaseMetricStdDev, TRUE) × 100)</div>
              </div>
            </div>
          </div>

          <div className={sectionPanelClass}>
            {editableSectionHeader("pr_std_dev", "Standard Deviations (Editable, System-Wide)")}
            <p className="text-[11px] text-muted-foreground">
              Calculated across every player in this system. These are manual admin inputs until automated recalculation is added.
            </p>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide font-semibold text-foreground">Batting Average</p>
                {editableField("pr_std_dev", "ba_contact_pct_std_dev", "Contact % Std Dev (Range: 54 to 95)")}
                {editableField("pr_std_dev", "ba_line_drive_pct_std_dev", "Line Drive % Std Dev (Range: 8 to 35)")}
                {editableField("pr_std_dev", "ba_avg_exit_velocity_std_dev", "Average Exit Velocity Std Dev (Range: 59.3 to 103.5)")}
                {editableField("pr_std_dev", "ba_pop_up_pct_std_dev", "Pop-Up % Std Dev (Range: 20.8 to 0)")}
              </div>
              <div className="space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide font-semibold text-foreground">On Base %</p>
                {editableField("pr_std_dev", "obp_contact_pct_std_dev", "Contact % Std Dev (Range: 54 to 95)")}
                {editableField("pr_std_dev", "obp_line_drive_pct_std_dev", "Line Drive % Std Dev (Range: 8 to 35)")}
                {editableField("pr_std_dev", "obp_avg_exit_velocity_std_dev", "Average Exit Velocity Std Dev (Range: 59.3 to 103.5)")}
                {editableField("pr_std_dev", "obp_pop_up_pct_std_dev", "Pop-Up % Std Dev (Range: 20.8 to 0)")}
                {editableField("pr_std_dev", "obp_walk_pct_std_dev", "BB% Std Dev (Range: 2.5 to 26)")}
                {editableField("pr_std_dev", "obp_chase_pct_std_dev", "Chase % Std Dev (Range: 43.7 to 79)")}
              </div>
              <div className="space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide font-semibold text-foreground">Isolated Power</p>
                {editableField("pr_std_dev", "iso_ev_std_dev", "EV Std Dev (Range: min to max)")}
                {editableField("pr_std_dev", "iso_barrel_std_dev", "Barrel Std Dev (Range: min to max)")}
                {editableField("pr_std_dev", "iso_whiff_std_dev", "Whiff Std Dev (Range: min to max)")}
                {editableField("pr_std_dev", "iso_chase_std_dev", "Chase Std Dev (Range: min to max)")}
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
              <div className="space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide font-semibold text-foreground">Batting Average</p>
                {editableField("pr_ncaa_averages", "ba_ncaa_contact_pct", "NCAA Average Contact % (%)")}
                {editableField("pr_ncaa_averages", "ba_ncaa_line_drive_pct", "NCAA Average Line Drive % (%)")}
                {editableField("pr_ncaa_averages", "ba_ncaa_avg_exit_velocity", "NCAA Average Exit Velocity")}
                {editableField("pr_ncaa_averages", "ba_ncaa_pop_up_pct", "NCAA Average Pop-Up % (%)")}
              </div>
              <div className="space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide font-semibold text-foreground">On Base %</p>
                {editableField("pr_ncaa_averages", "obp_ncaa_contact_pct", "NCAA Average Contact % (%)")}
                {editableField("pr_ncaa_averages", "obp_ncaa_line_drive_pct", "NCAA Average Line Drive % (%)")}
                {editableField("pr_ncaa_averages", "obp_ncaa_avg_exit_velocity", "NCAA Average Exit Velocity")}
                {editableField("pr_ncaa_averages", "obp_ncaa_pop_up_pct", "NCAA Average Pop-Up % (%)")}
                {editableField("pr_ncaa_averages", "obp_ncaa_walk_pct", "NCAA Average BB%")}
                {editableField("pr_ncaa_averages", "obp_ncaa_chase_pct", "NCAA Average Chase % (%)")}
              </div>
              <div className="space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide font-semibold text-foreground">Isolated Power</p>
                {editableField("pr_ncaa_averages", "iso_ncaa_ev_metric", "NCAA Average EV Metric")}
                {editableField("pr_ncaa_averages", "iso_ncaa_barrel_metric", "NCAA Average Barrel Metric")}
                {editableField("pr_ncaa_averages", "iso_ncaa_whiff_metric", "NCAA Average Whiff Metric")}
                {editableField("pr_ncaa_averages", "iso_ncaa_chase_metric", "NCAA Average Chase Metric")}
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
  "ACC", "AAC", "A-10", "America East", "ASUN", "Big 12", "Big East", "Big Sky",
  "Big South", "Big Ten", "Big West", "CAA", "CUSA", "Horizon League", "Ivy League",
  "MAAC", "MAC", "MEAC", "Mountain West", "MVC", "NEC", "OVC", "Pac-12",
  "Patriot League", "SoCon", "Southland", "Summit League", "Sun Belt", "SWAC",
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
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [confFilter, setConfFilter] = useState<string>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editConf, setEditConf] = useState("");
  const [editName, setEditName] = useState("");
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamConf, setNewTeamConf] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

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

  const updateTeam = useMutation({
    mutationFn: async ({ id, name, conference }: { id: string; name: string; conference: string }) => {
      const { error } = await supabase.from("teams").update({ name, conference }).eq("id", id);
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
      const { error } = await supabase.from("teams").insert({ name, conference: conference || null });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-teams"] });
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      setNewTeamName("");
      setNewTeamConf("");
      setShowAddForm(false);
      toast.success("Team added");
    },
    onError: (e) => toast.error(`Failed: ${e.message}`),
  });

  const filtered = useMemo(() => {
    let list = teams;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((t) => t.name.toLowerCase().includes(q) || (t.conference || "").toLowerCase().includes(q));
    }
    if (confFilter !== "all") {
      if (confFilter === "unassigned") list = list.filter((t) => !t.conference);
      else list = list.filter((t) => t.conference === confFilter);
    }
    return list;
  }, [teams, search, confFilter]);

  const confCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    teams.forEach((t) => {
      const c = t.conference || "Unassigned";
      counts[c] = (counts[c] || 0) + 1;
    });
    return counts;
  }, [teams]);

  const uniqueConfs = useMemo(() => [...new Set(teams.map((t) => t.conference).filter(Boolean))].sort() as string[], [teams]);

  const startEdit = (team: TeamRow) => {
    setEditingId(team.id);
    setEditConf(team.conference || "");
    setEditName(team.name);
  };

  const saveEdit = (id: string) => {
    updateTeam.mutate({ id, name: editName, conference: editConf });
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
            <div className="relative w-full sm:w-64">
              <Input placeholder="Search teams..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
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
                    <TableHead className="min-w-[100px] text-center">Park Factor</TableHead>
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
                        <span className="text-sm tabular-nums">{Math.round((team.park_factor ?? 1.0) * 100)}</span>
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
        toast.success(`Recalculated ${result.updated} of ${result.total} predictions`);
      } else {
        toast.error(result?.error ?? "Failed");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkLoading(false);
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
            <p className="font-medium">Bulk Recalculate Returner Predictions</p>
            <p className="text-sm text-muted-foreground">
              Re-run the formula on all active returner predictions using the latest equation constants and power ratings.
            </p>
          </div>
          <Button onClick={runBulkRecalculate} disabled={bulkLoading} className="gap-2">
            {bulkLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {bulkLoading ? "Recalculating…" : "Recalculate All"}
          </Button>
          {bulkResult && (
            <p className="text-sm text-muted-foreground">
              Updated {bulkResult.updated} of {bulkResult.total} predictions
              {bulkResult.errors > 0 ? `, ${bulkResult.errors} errors` : ""}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Admin Dashboard ─────────────────────────────────────────────────────

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
            <TabsTrigger value="actions" className="gap-1.5">
              <RefreshCw className="h-4 w-4" />
              Actions
            </TabsTrigger>
          </TabsList>

          <TabsContent value="equations">
            <EquationConstantsTab />
          </TabsContent>
          <TabsContent value="power">
            <PowerRatingsTab />
          </TabsContent>
          <TabsContent value="power-ratings">
            <AdminPowerRatingsTab />
          </TabsContent>
          <TabsContent value="teams">
            <TeamsAdminTab />
          </TabsContent>
          <TabsContent value="actions">
            <QuickActionsTab />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
