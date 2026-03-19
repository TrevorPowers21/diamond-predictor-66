import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  DEFAULT_PITCHING_WEIGHTS,
  PITCHING_EQUATIONS_STORAGE_KEY,
  readPitchingWeights,
  type PitchingEquationWeights,
} from "@/lib/pitchingEquations";

const toNum = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const parseNum = (v: string | null | undefined) => {
  const n = Number(String(v ?? "").replace(/[%,$]/g, "").trim());
  return Number.isFinite(n) ? n : null;
};

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const stdDevPopulation = (values: number[]) => {
  if (values.length === 0) return null;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
};

export default function PitchingEquationsTab() {
  const [weights, setWeights] = useState<PitchingEquationWeights>(() => readPitchingWeights());

  const weightTotal = useMemo(
    () =>
      weights.fip_plus_weight +
      weights.era_plus_weight +
      weights.whip_plus_weight +
      weights.k9_plus_weight +
      weights.bb9_plus_weight +
      weights.hr9_plus_weight,
    [weights],
  );

  const save = () => {
    try {
      localStorage.setItem(PITCHING_EQUATIONS_STORAGE_KEY, JSON.stringify(weights));
      toast.success("Pitching equation values saved.");
    } catch {
      toast.error("Failed to save pitching equation values.");
    }
  };

  const reset = () => {
    setWeights(DEFAULT_PITCHING_WEIGHTS);
    try {
      localStorage.setItem(PITCHING_EQUATIONS_STORAGE_KEY, JSON.stringify(DEFAULT_PITCHING_WEIGHTS));
      toast.success("Pitching equation values reset.");
    } catch {
      toast.error("Failed to reset pitching equation values.");
    }
  };

  const autoFillFromPitchingStorage = () => {
    try {
      const raw = localStorage.getItem("pitching_stats_storage_2025_v1");
      if (!raw) {
        toast.error("No 2025 pitching stats storage found.");
        return;
      }
      const parsed = JSON.parse(raw) as { rows?: Array<{ values?: string[] }> };
      const rows = Array.isArray(parsed.rows) ? parsed.rows : [];

      const eraVals: number[] = [];
      const fipVals: number[] = [];
      const whipVals: number[] = [];
      const k9Vals: number[] = [];
      const bb9Vals: number[] = [];
      const hr9Vals: number[] = [];

      for (const row of rows) {
        const values = Array.isArray(row.values) ? row.values : [];
        const era = parseNum(values[3]);
        const fip = parseNum(values[4]);
        const whip = parseNum(values[5]);
        const k9 = parseNum(values[6]);
        const bb9 = parseNum(values[7]);
        const hr9 = parseNum(values[8]);
        if (era != null) eraVals.push(era);
        if (fip != null) fipVals.push(fip);
        if (whip != null) whipVals.push(whip);
        if (k9 != null) k9Vals.push(k9);
        if (bb9 != null) bb9Vals.push(bb9);
        if (hr9 != null) hr9Vals.push(hr9);
      }

      const next: PitchingEquationWeights = { ...weights };
      if (eraVals.length > 0) {
        next.era_plus_ncaa_avg = Number(mean(eraVals).toFixed(6));
        const sd = stdDevPopulation(eraVals);
        if (sd != null && sd > 0) next.era_plus_ncaa_sd = Number(sd.toFixed(9));
      }
      if (fipVals.length > 0) {
        next.fip_plus_ncaa_avg = Number(mean(fipVals).toFixed(6));
        const sd = stdDevPopulation(fipVals);
        if (sd != null && sd > 0) next.fip_plus_ncaa_sd = Number(sd.toFixed(9));
      }
      if (whipVals.length > 0) {
        next.whip_plus_ncaa_avg = Number(mean(whipVals).toFixed(6));
        const sd = stdDevPopulation(whipVals);
        if (sd != null && sd > 0) next.whip_plus_ncaa_sd = Number(sd.toFixed(10));
      }
      if (k9Vals.length > 0) {
        next.k9_plus_ncaa_avg = Number(mean(k9Vals).toFixed(6));
        const sd = stdDevPopulation(k9Vals);
        if (sd != null && sd > 0) next.k9_plus_ncaa_sd = Number(sd.toFixed(9));
      }
      if (bb9Vals.length > 0) {
        next.bb9_plus_ncaa_avg = Number(mean(bb9Vals).toFixed(6));
        const sd = stdDevPopulation(bb9Vals);
        if (sd != null && sd > 0) next.bb9_plus_ncaa_sd = Number(sd.toFixed(9));
      }
      if (hr9Vals.length > 0) {
        next.hr9_plus_ncaa_avg = Number(mean(hr9Vals).toFixed(6));
        const sd = stdDevPopulation(hr9Vals);
        if (sd != null && sd > 0) next.hr9_plus_ncaa_sd = Number(sd.toFixed(10));
      }

      setWeights(next);
      localStorage.setItem(PITCHING_EQUATIONS_STORAGE_KEY, JSON.stringify(next));
      toast.success("Auto-filled NCAA averages and SD from 2025 pitching stats storage.");
    } catch {
      toast.error("Failed to auto-fill from pitching stats storage.");
    }
  };

  const sectionHeadingClass = "text-[11px] uppercase tracking-wide font-semibold text-foreground";
  const sectionPanelClass = "rounded-md border bg-background/60 p-3 space-y-2";
  const editableSectionHeader = (title = "Editable (Admin UI)") => (
    <div className="flex items-center justify-between">
      <p className={sectionHeadingClass}>{title}</p>
    </div>
  );
  const eqInput = (value: number, onChange: (v: number) => void) => (
    <Input
      type="text"
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(toNum(e.target.value))}
    />
  );

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Equation Constants</h3>
        <p className="text-sm text-muted-foreground">
          Structured to match the hitting equations tab. This section stores z-score based pitching equation inputs and weights.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Equation Constants</CardTitle>
          <CardDescription>pRV+ at the top, followed by z-score equations and constants.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className={sectionPanelClass}>
            <p className={sectionHeadingClass}>pRV+</p>
            <div className="text-sm font-mono">
              ({weights.fip_plus_weight.toFixed(2)}×FIP+) + ({weights.era_plus_weight.toFixed(2)}×ERA+) + ({weights.whip_plus_weight.toFixed(2)}×WHIP+) + ({weights.k9_plus_weight.toFixed(2)}×K/9+) + ({weights.bb9_plus_weight.toFixed(2)}×BB/9+) + ({weights.hr9_plus_weight.toFixed(2)}×HR/9+)
            </div>
            {editableSectionHeader("Editable Weights")}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <label className="text-xs text-muted-foreground">FIP+ Weight {eqInput(weights.fip_plus_weight, (v) => setWeights((p) => ({ ...p, fip_plus_weight: v })))}</label>
              <label className="text-xs text-muted-foreground">ERA+ Weight {eqInput(weights.era_plus_weight, (v) => setWeights((p) => ({ ...p, era_plus_weight: v })))}</label>
              <label className="text-xs text-muted-foreground">WHIP+ Weight {eqInput(weights.whip_plus_weight, (v) => setWeights((p) => ({ ...p, whip_plus_weight: v })))}</label>
              <label className="text-xs text-muted-foreground">K/9+ Weight {eqInput(weights.k9_plus_weight, (v) => setWeights((p) => ({ ...p, k9_plus_weight: v })))}</label>
              <label className="text-xs text-muted-foreground">BB/9+ Weight {eqInput(weights.bb9_plus_weight, (v) => setWeights((p) => ({ ...p, bb9_plus_weight: v })))}</label>
              <label className="text-xs text-muted-foreground">HR/9+ Weight {eqInput(weights.hr9_plus_weight, (v) => setWeights((p) => ({ ...p, hr9_plus_weight: v })))}</label>
            </div>
            <p className={`text-xs ${Math.abs(weightTotal - 1) < 0.001 ? "text-muted-foreground" : "text-destructive"}`}>
              Weight Total: {weightTotal.toFixed(2)}
            </p>
          </div>

          <div className="px-1 pt-1">
            <h4 className="text-sm font-semibold">Z-Score Equations</h4>
          </div>

          <div className={sectionPanelClass}>
            <p className={sectionHeadingClass}>ERA+</p>
            <div className="text-sm font-mono">100 + (((NCAA AVG ERA - pERA) / NCAA ERA SD) × Scale)</div>
            {editableSectionHeader("Constants")}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <label className="text-xs text-muted-foreground">NCAA AVG ERA {eqInput(weights.era_plus_ncaa_avg, (v) => setWeights((p) => ({ ...p, era_plus_ncaa_avg: v })))}</label>
              <label className="text-xs text-muted-foreground">NCAA ERA SD {eqInput(weights.era_plus_ncaa_sd, (v) => setWeights((p) => ({ ...p, era_plus_ncaa_sd: v })))}</label>
              <label className="text-xs text-muted-foreground">Scale {eqInput(weights.era_plus_scale, (v) => setWeights((p) => ({ ...p, era_plus_scale: v })))}</label>
            </div>
          </div>

          <div className={sectionPanelClass}>
            <p className={sectionHeadingClass}>FIP+</p>
            <div className="text-sm font-mono">100 + (((NCAA AVG FIP - pFIP) / NCAA FIP SD) × Scale)</div>
            {editableSectionHeader("Constants")}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <label className="text-xs text-muted-foreground">NCAA AVG FIP {eqInput(weights.fip_plus_ncaa_avg, (v) => setWeights((p) => ({ ...p, fip_plus_ncaa_avg: v })))}</label>
              <label className="text-xs text-muted-foreground">NCAA FIP SD {eqInput(weights.fip_plus_ncaa_sd, (v) => setWeights((p) => ({ ...p, fip_plus_ncaa_sd: v })))}</label>
              <label className="text-xs text-muted-foreground">Scale {eqInput(weights.fip_plus_scale, (v) => setWeights((p) => ({ ...p, fip_plus_scale: v })))}</label>
            </div>
          </div>

          <div className={sectionPanelClass}>
            <p className={sectionHeadingClass}>WHIP+</p>
            <div className="text-sm font-mono">100 + (((NCAA AVG WHIP - pWHIP) / NCAA WHIP SD) × Scale)</div>
            {editableSectionHeader("Constants")}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <label className="text-xs text-muted-foreground">NCAA AVG WHIP {eqInput(weights.whip_plus_ncaa_avg, (v) => setWeights((p) => ({ ...p, whip_plus_ncaa_avg: v })))}</label>
              <label className="text-xs text-muted-foreground">NCAA WHIP SD {eqInput(weights.whip_plus_ncaa_sd, (v) => setWeights((p) => ({ ...p, whip_plus_ncaa_sd: v })))}</label>
              <label className="text-xs text-muted-foreground">Scale {eqInput(weights.whip_plus_scale, (v) => setWeights((p) => ({ ...p, whip_plus_scale: v })))}</label>
            </div>
          </div>

          <div className={sectionPanelClass}>
            <p className={sectionHeadingClass}>K/9+</p>
            <div className="text-sm font-mono">100 + (((pK/9 - NCAA AVG K/9) / NCAA K/9 SD) × Scale)</div>
            {editableSectionHeader("Constants")}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <label className="text-xs text-muted-foreground">NCAA AVG K/9 {eqInput(weights.k9_plus_ncaa_avg, (v) => setWeights((p) => ({ ...p, k9_plus_ncaa_avg: v })))}</label>
              <label className="text-xs text-muted-foreground">NCAA K/9 SD {eqInput(weights.k9_plus_ncaa_sd, (v) => setWeights((p) => ({ ...p, k9_plus_ncaa_sd: v })))}</label>
              <label className="text-xs text-muted-foreground">Scale {eqInput(weights.k9_plus_scale, (v) => setWeights((p) => ({ ...p, k9_plus_scale: v })))}</label>
            </div>
          </div>

          <div className={sectionPanelClass}>
            <p className={sectionHeadingClass}>BB/9+</p>
            <div className="text-sm font-mono">100 + (((NCAA AVG BB/9 - pBB/9) / NCAA BB/9 SD) × Scale)</div>
            {editableSectionHeader("Constants")}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <label className="text-xs text-muted-foreground">NCAA AVG BB/9 {eqInput(weights.bb9_plus_ncaa_avg, (v) => setWeights((p) => ({ ...p, bb9_plus_ncaa_avg: v })))}</label>
              <label className="text-xs text-muted-foreground">NCAA BB/9 SD {eqInput(weights.bb9_plus_ncaa_sd, (v) => setWeights((p) => ({ ...p, bb9_plus_ncaa_sd: v })))}</label>
              <label className="text-xs text-muted-foreground">Scale {eqInput(weights.bb9_plus_scale, (v) => setWeights((p) => ({ ...p, bb9_plus_scale: v })))}</label>
            </div>
          </div>

          <div className={sectionPanelClass}>
            <p className={sectionHeadingClass}>HR/9+</p>
            <div className="text-sm font-mono">100 + (((NCAA AVG HR/9 - pHR/9) / NCAA HR/9 SD) × Scale)</div>
            {editableSectionHeader("Constants")}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <label className="text-xs text-muted-foreground">NCAA AVG HR/9 {eqInput(weights.hr9_plus_ncaa_avg, (v) => setWeights((p) => ({ ...p, hr9_plus_ncaa_avg: v })))}</label>
              <label className="text-xs text-muted-foreground">NCAA HR/9 SD {eqInput(weights.hr9_plus_ncaa_sd, (v) => setWeights((p) => ({ ...p, hr9_plus_ncaa_sd: v })))}</label>
              <label className="text-xs text-muted-foreground">Scale {eqInput(weights.hr9_plus_scale, (v) => setWeights((p) => ({ ...p, hr9_plus_scale: v })))}</label>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 justify-end">
        <Button variant="outline" onClick={autoFillFromPitchingStorage}>Auto-fill NCAA + SD</Button>
        <Button variant="outline" onClick={reset}>Reset Defaults</Button>
        <Button onClick={save}>Save</Button>
      </div>
    </div>
  );
}
