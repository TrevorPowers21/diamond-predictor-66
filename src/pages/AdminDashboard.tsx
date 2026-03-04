import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Pencil, Save, X, RefreshCw, Scale, Sliders, Trophy, Plus, Trash2 } from "lucide-react";
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

  if (isLoading) return <p className="text-muted-foreground py-8 text-center">Loading…</p>;

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
                {editableSectionHeader("r_ba")}
                <div className="space-y-1.5">
                  {editableField("r_ba", "r_ncaa_avg_ba", "NCAA Avg BA")}
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
            <h4 className="font-semibold mb-4">On Base Percentage</h4>
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
                {editableSectionHeader("r_obp")}
                <div className="space-y-1.5">
                  {editableField("r_obp", "r_ncaa_avg_obp", "NCAA Avg OBP")}
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
            <h4 className="font-semibold mb-4">Slugging Percentage</h4>
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
                {editableSectionHeader("r_iso")}
                <div className="space-y-1.5">
                  {editableField("r_iso", "r_ncaa_avg_iso", "NCAA Avg ISO")}
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
                {editableSectionHeader("r_wrc_plus")}
                <div className="space-y-1.5">
                  {editableField("r_wrc_plus", "r_ncaa_avg_wrc", "NCAA Avg WRC")}
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
                  {editableField("t_ba", "t_ba_ncaa_avg", "NCAA Avg Batting Average")}
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
            <h4 className="font-semibold mb-4">On Base Percentage</h4>
            <div className="bg-muted p-4 rounded-lg font-mono text-sm space-y-2">
              <div><span className="text-muted-foreground">LastOBP =</span> LastOnBasePercentage</div>
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
                  {editableField("t_obp", "t_obp_ncaa_avg", "NCAA Avg OBP")}
                  {editableField("t_obp", "t_obp_power_weight", "Power Rating Weight")}
                  {editableField("t_obp", "t_obp_conference_weight", "Conference Weight")}
                  {editableField("t_obp", "t_obp_pitching_weight", "Pitching Weight")}
                  {editableField("t_obp", "t_obp_park_weight", "Park Factor Weight")}
                </div>
              </div>
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Player-Specific</p>
                <div className="ml-2 space-y-0.5">
                  <div>• Last On Base Percentage</div>
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
            <h4 className="font-semibold mb-4">Slugging Percentage</h4>
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
                  {editableField("t_iso", "t_iso_ncaa_avg", "NCAA Avg ISO")}
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
                {editableSectionHeader("t_wrc_plus")}
                <div className="space-y-1.5">
                  {editableField("t_wrc_plus", "t_wrc_plus_ncaa_avg", "NCAA Avg WRC")}
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
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRating, setEditRating] = useState("");
  const [search, setSearch] = useState("");

  const { data: ratings = [], isLoading } = useQuery({
    queryKey: ["power_ratings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("power_ratings")
        .select("*")
        .order("rating", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, rating }: { id: string; rating: number }) => {
      const { error } = await supabase.from("power_ratings").update({ rating }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["power_ratings"] });
      toast.success("Rating updated");
      setEditingId(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const filtered = search
    ? ratings.filter((r) => r.conference.toLowerCase().includes(search.toLowerCase()))
    : ratings;

  if (isLoading) return <p className="text-muted-foreground py-8 text-center">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Conference Power Ratings</h3>
          <p className="text-sm text-muted-foreground">{ratings.length} conferences loaded</p>
        </div>
        <Input
          placeholder="Search conference…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-48"
        />
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Conference</TableHead>
                  <TableHead className="text-right">Rating</TableHead>
                  <TableHead>Season</TableHead>
                  <TableHead className="text-right">AVG+</TableHead>
                  <TableHead className="text-right">OBP+</TableHead>
                  <TableHead className="text-right">SLG+</TableHead>
                  <TableHead className="text-right">OPS+</TableHead>
                  <TableHead className="text-right">wRC+</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r, idx) => {
                  let parsed: any = {};
                  try {
                    parsed = typeof r.notes === "string" ? JSON.parse(r.notes) : r.notes || {};
                  } catch {}

                  return (
                    <TableRow key={r.id}>
                      <TableCell className="text-muted-foreground text-xs">{idx + 1}</TableCell>
                      <TableCell className="font-medium text-sm">{r.conference}</TableCell>
                      <TableCell className="text-right">
                        {editingId === r.id ? (
                          <div className="flex items-center justify-end gap-1">
                            <Input
                              type="number"
                              step="0.1"
                              value={editRating}
                              onChange={(e) => setEditRating(e.target.value)}
                              className="w-20 h-7 text-sm"
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => {
                                const v = parseFloat(editRating);
                                if (!isNaN(v)) updateMutation.mutate({ id: r.id, rating: v });
                              }}
                            >
                              <Save className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingId(null)}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <span className="font-mono font-bold">{Number(r.rating).toFixed(0)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">{r.season}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{parsed.avg_plus ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{parsed.obp_plus ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{parsed.slg_plus ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{parsed.ops_plus ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{parsed.wrc_plus ?? "—"}</TableCell>
                      <TableCell>
                        {editingId !== r.id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => {
                              setEditingId(r.id);
                              setEditRating(r.rating.toString());
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
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
            Manage equation constants, power ratings, and developmental weights in one place.
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
              Power Ratings
            </TabsTrigger>
            <TabsTrigger value="weights" className="gap-1.5">
              <Scale className="h-4 w-4" />
              Dev Weights
            </TabsTrigger>
            <TabsTrigger value="nil" className="gap-1.5">
              <Trophy className="h-4 w-4" />
              NIL Valuations
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
          <TabsContent value="weights">
            <DevWeightsTab />
          </TabsContent>
          <TabsContent value="nil">
            <NilValuationsTableTab />
          </TabsContent>
          <TabsContent value="actions">
            <QuickActionsTab />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
