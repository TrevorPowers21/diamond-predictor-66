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
  const renderClassAdjustmentsCard = (
    fs: number,
    sj: number,
    js: number,
    gr: number,
    onFs: (v: number) => void,
    onSj: (v: number) => void,
    onJs: (v: number) => void,
    onGr: (v: number) => void,
  ) => (
    <div className={sectionPanelClass}>
      <div className="flex items-center justify-between">
        <p className={sectionHeadingClass}>Class Adjustments</p>
        <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]">Edit</Button>
      </div>
      <div className="space-y-2 text-xs">
        <div className="grid grid-cols-[1fr_140px] items-center gap-3">
          <div className="text-muted-foreground">FS</div>
          <div className="relative">
            <Input type="text" inputMode="decimal" className="h-8 pr-6" value={fs} onChange={(e) => onFs(toNum(e.target.value))} />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">%</span>
          </div>
        </div>
        <div className="grid grid-cols-[1fr_140px] items-center gap-3">
          <div className="text-muted-foreground">SJ</div>
          <div className="relative">
            <Input type="text" inputMode="decimal" className="h-8 pr-6" value={sj} onChange={(e) => onSj(toNum(e.target.value))} />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">%</span>
          </div>
        </div>
        <div className="grid grid-cols-[1fr_140px] items-center gap-3">
          <div className="text-muted-foreground">JS</div>
          <div className="relative">
            <Input type="text" inputMode="decimal" className="h-8 pr-6" value={js} onChange={(e) => onJs(toNum(e.target.value))} />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">%</span>
          </div>
        </div>
        <div className="grid grid-cols-[1fr_140px] items-center gap-3">
          <div className="text-muted-foreground">GR</div>
          <div className="relative">
            <Input type="text" inputMode="decimal" className="h-8 pr-6" value={gr} onChange={(e) => onGr(toNum(e.target.value))} />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">%</span>
          </div>
        </div>
      </div>
    </div>
  );
  const setArrayValue = (arr: number[], index: number, value: number) => {
    const next = [...arr];
    next[index] = value;
    return next;
  };
  const renderDampFactorBreakdown = (projectedVar: string, thresholds: number[], impacts: number[]) => {
    const lines = [] as string[];
    if (thresholds.length === 0 || impacts.length !== thresholds.length + 1) return lines;
    lines.push(`${impacts[0]} if ${projectedVar} < ${thresholds[0]}`);
    for (let i = 1; i < thresholds.length; i++) {
      lines.push(`${impacts[i]} if ${thresholds[i - 1]} ≤ ${projectedVar} < ${thresholds[i]}`);
    }
    lines.push(`${impacts[impacts.length - 1]} if ${projectedVar} ≥ ${thresholds[thresholds.length - 1]}`);
    return lines;
  };
  const renderEditableDampeningCard = (
    metricLabel: string,
    projectedVar: string,
    thresholds: number[],
    impacts: number[],
    onThresholdsChange: (next: number[]) => void,
    onImpactsChange: (next: number[]) => void,
  ) => (
    <div className={sectionPanelClass}>
      <div className="flex items-center justify-between">
        <p className={sectionHeadingClass}>{metricLabel} Dampening</p>
        <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]">Edit</Button>
      </div>
      <div className="grid grid-cols-[56px_1fr_56px_1fr_120px] gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground pt-1">
        <div>Lower</div>
        <div>Value</div>
        <div>Upper</div>
        <div>Value</div>
        <div>Impact</div>
      </div>
      <div className="space-y-1.5">
        {thresholds.map((t, i) => {
          const isFirst = i === 0;
          const lowerIdx = i - 1;
          return (
            <div key={`${metricLabel}-row-${i}`} className="grid grid-cols-[56px_1fr_56px_1fr_120px] gap-1.5 items-center">
              <Input className="h-7 font-mono text-xs text-center" value={isFirst ? "<" : "≥"} readOnly />
              <Input
                className="h-7 font-mono text-xs"
                value={isFirst ? t : thresholds[lowerIdx]}
                onChange={(e) => {
                  const n = toNum(e.target.value);
                  const idx = isFirst ? i : lowerIdx;
                  onThresholdsChange(setArrayValue(thresholds, idx, n));
                }}
              />
              <Input className="h-7 font-mono text-xs text-center" value={isFirst ? "" : "<"} readOnly />
              <Input
                className="h-7 font-mono text-xs"
                value={isFirst ? "" : t}
                disabled={isFirst}
                onChange={(e) => {
                  if (!isFirst) onThresholdsChange(setArrayValue(thresholds, i, toNum(e.target.value)));
                }}
              />
              <Input
                className="h-7 font-mono text-xs"
                value={impacts[i]}
                onChange={(e) => onImpactsChange(setArrayValue(impacts, i, toNum(e.target.value)))}
              />
            </div>
          );
        })}
        <div className="grid grid-cols-[56px_1fr_56px_1fr_120px] gap-1.5 items-center">
          <Input className="h-7 font-mono text-xs text-center" value="≥" readOnly />
          <Input
            className="h-7 font-mono text-xs"
            value={thresholds[thresholds.length - 1]}
            onChange={(e) => onThresholdsChange(setArrayValue(thresholds, thresholds.length - 1, toNum(e.target.value)))}
          />
          <Input className="h-7 font-mono text-xs text-center" value="" readOnly />
          <Input className="h-7 font-mono text-xs" value="" readOnly />
          <Input
            className="h-7 font-mono text-xs"
            value={impacts[impacts.length - 1]}
            onChange={(e) => onImpactsChange(setArrayValue(impacts, impacts.length - 1, toNum(e.target.value)))}
          />
        </div>
      </div>
    </div>
  );
  const renderSdConstantsCard = (
    prLabel: string,
    prValue: number,
    onPrChange: (v: number) => void,
    ncaaLabel: string,
    ncaaValue: number,
    onNcaaChange: (v: number) => void,
  ) => (
    <div className={sectionPanelClass}>
      <p className={sectionHeadingClass}>SD Constants</p>
      <div className="space-y-2 text-xs text-muted-foreground">
        <div className="grid grid-cols-[1fr_140px] items-center gap-3">
          <span>{prLabel}</span>
          <Input
            type="text"
            inputMode="decimal"
            className="h-8"
            value={prValue}
            onChange={(e) => onPrChange(toNum(e.target.value))}
          />
        </div>
        <div className="grid grid-cols-[1fr_140px] items-center gap-3">
          <span>{ncaaLabel}</span>
          <Input
            type="text"
            inputMode="decimal"
            className="h-8"
            value={ncaaValue}
            onChange={(e) => onNcaaChange(toNum(e.target.value))}
          />
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Returner Model</CardTitle>
          <CardDescription>Structured like the hitting side for projected pitcher returner equations.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <p className="text-lg font-semibold">ERA</p>
            <div className="bg-muted p-4 rounded-lg space-y-1 text-sm font-mono leading-relaxed">
              <div><span className="text-muted-foreground">LastERA =</span> LastERA</div>
              <div><span className="text-muted-foreground">PowerAdjustedERA =</span> NCAAAvgERA - ((ERAPowerRating+ - 100) / StdDevERAPowerRating+) × StdDevNCAAERA</div>
              <div><span className="text-muted-foreground">BlendedERA =</span> (LastERA × (1 - PowerRatingWeight)) + (PowerAdjustedERA × PowerRatingWeight)</div>
              <div><span className="text-muted-foreground">Mult =</span> 1 - ClassAdjustment - (DevAggressiveness × 0.06)</div>
              <div><span className="text-muted-foreground">ProjectedERA =</span> BlendedERA × Mult</div>
              <div><span className="text-muted-foreground">Delta =</span> ProjectedERA - LastERA</div>
              <div className="text-[12px] break-words">
                <span className="text-muted-foreground">DampFactor =</span>
              </div>
              {renderDampFactorBreakdown("ProjectedERA", weights.era_damp_thresholds, weights.era_damp_impacts).map((line) => (
                <div key={line} className="pl-4 text-xs leading-tight">{line}</div>
              ))}
              <div><span className="text-muted-foreground">FinalERA =</span> LastERA + (Delta × DampFactor)</div>
            </div>
          </div>

          <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>Constants</p>
              <div className="ml-2 space-y-0.5">
                <div>• Power Rating Weight = 0.70</div>
                <div>• NCAA Avg ERA Power Rating+ = 100</div>
              </div>
            </div>
            {renderSdConstantsCard(
              "Std Dev ERA Power Rating+",
              weights.era_pr_sd,
              (v) => setWeights((p) => ({ ...p, era_pr_sd: v })),
              "Std Dev NCAA ERA",
              weights.era_plus_ncaa_sd,
              (v) => setWeights((p) => ({ ...p, era_plus_ncaa_sd: v })),
            )}
            <div className={sectionPanelClass}>
              {editableSectionHeader("NCAA Average")}
              <div className="grid grid-cols-[1fr_140px] items-center gap-3 text-xs text-muted-foreground">
                <span>NCAA Avg ERA</span>
                <Input
                  type="text"
                  inputMode="decimal"
                  className="h-8"
                  value={weights.era_plus_ncaa_avg}
                  onChange={(e) => setWeights((p) => ({ ...p, era_plus_ncaa_avg: toNum(e.target.value) }))}
                />
              </div>
            </div>
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>Player-Specific</p>
              <div className="ml-2 space-y-0.5">
                <div>• Last ERA</div>
                <div>• ERA Power Rating+</div>
                <div>• Dev Aggressiveness (0.0 / 0.5 / 1.0)</div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className={sectionPanelClass}>
              <div className="flex items-center justify-between">
                <p className={sectionHeadingClass}>Class Adjustments</p>
                <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]">Edit</Button>
              </div>
              <div className="space-y-2 text-xs">
                <div className="grid grid-cols-[1fr_140px] items-center gap-3">
                  <div className="text-muted-foreground">FS</div>
                  <div className="relative">
                    <Input type="text" inputMode="decimal" className="h-8 pr-6" value={weights.class_era_fs} onChange={(e) => setWeights((p) => ({ ...p, class_era_fs: toNum(e.target.value) }))} />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">%</span>
                  </div>
                </div>
                <div className="grid grid-cols-[1fr_140px] items-center gap-3">
                  <div className="text-muted-foreground">SJ</div>
                  <div className="relative">
                    <Input type="text" inputMode="decimal" className="h-8 pr-6" value={weights.class_era_sj} onChange={(e) => setWeights((p) => ({ ...p, class_era_sj: toNum(e.target.value) }))} />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">%</span>
                  </div>
                </div>
                <div className="grid grid-cols-[1fr_140px] items-center gap-3">
                  <div className="text-muted-foreground">JS</div>
                  <div className="relative">
                    <Input type="text" inputMode="decimal" className="h-8 pr-6" value={weights.class_era_js} onChange={(e) => setWeights((p) => ({ ...p, class_era_js: toNum(e.target.value) }))} />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">%</span>
                  </div>
                </div>
                <div className="grid grid-cols-[1fr_140px] items-center gap-3">
                  <div className="text-muted-foreground">GR</div>
                  <div className="relative">
                    <Input type="text" inputMode="decimal" className="h-8 pr-6" value={weights.class_era_gr} onChange={(e) => setWeights((p) => ({ ...p, class_era_gr: toNum(e.target.value) }))} />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">%</span>
                  </div>
                </div>
              </div>
            </div>
            {renderEditableDampeningCard(
              "ERA",
              "ProjectedERA",
              weights.era_damp_thresholds,
              weights.era_damp_impacts,
              (next) => setWeights((p) => ({ ...p, era_damp_thresholds: next })),
              (next) => setWeights((p) => ({ ...p, era_damp_impacts: next })),
            )}
          </div>

          <div className="space-y-2">
            <p className="text-lg font-semibold">FIP</p>
            <div className="bg-muted p-4 rounded-lg space-y-1 text-sm font-mono leading-relaxed">
              <div><span className="text-muted-foreground">LastFIP =</span> LastFIP</div>
              <div><span className="text-muted-foreground">PowerAdjustedFIP =</span> NCAAAvgFIP - ((FIPPowerRating+ - 100) / StdDevFIPPowerRating+) × StdDevNCAAFIP</div>
              <div><span className="text-muted-foreground">BlendedFIP =</span> (LastFIP × (1 - PowerRatingWeight)) + (PowerAdjustedFIP × PowerRatingWeight)</div>
              <div><span className="text-muted-foreground">Mult =</span> 1 - ClassAdjustment - (DevAggressiveness × 0.06)</div>
              <div><span className="text-muted-foreground">ProjectedFIP =</span> BlendedFIP × Mult</div>
              <div><span className="text-muted-foreground">Delta =</span> ProjectedFIP - LastFIP</div>
              <div className="text-[12px] break-words">
                <span className="text-muted-foreground">DampFactor =</span>
              </div>
              {renderDampFactorBreakdown("ProjectedFIP", weights.fip_damp_thresholds, weights.fip_damp_impacts).map((line) => (
                <div key={line} className="pl-4 text-xs leading-tight">{line}</div>
              ))}
              <div><span className="text-muted-foreground">FinalFIP =</span> LastFIP + (Delta × DampFactor)</div>
            </div>
          </div>
          <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>Constants</p>
              <div className="ml-2 space-y-0.5">
                <div>• Power Rating Weight = 0.70</div>
                <div>• NCAA Avg FIP Power Rating+ = 100</div>
              </div>
            </div>
            {renderSdConstantsCard(
              "Std Dev FIP Power Rating+",
              weights.fip_pr_sd,
              (v) => setWeights((p) => ({ ...p, fip_pr_sd: v })),
              "Std Dev NCAA FIP",
              weights.fip_plus_ncaa_sd,
              (v) => setWeights((p) => ({ ...p, fip_plus_ncaa_sd: v })),
            )}
            <div className={sectionPanelClass}>
              {editableSectionHeader("NCAA Average")}
              <div className="grid grid-cols-[1fr_140px] items-center gap-3 text-xs text-muted-foreground">
                <span>NCAA Avg FIP</span>
                <Input type="text" inputMode="decimal" className="h-8" value={weights.fip_plus_ncaa_avg} onChange={(e) => setWeights((p) => ({ ...p, fip_plus_ncaa_avg: toNum(e.target.value) }))} />
              </div>
            </div>
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>Player-Specific</p>
              <div className="ml-2 space-y-0.5">
                <div>• Last FIP</div>
                <div>• FIP Power Rating+</div>
                <div>• Dev Aggressiveness (0.0 / 0.5 / 1.0)</div>
              </div>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {renderClassAdjustmentsCard(
              weights.class_fip_fs, weights.class_fip_sj, weights.class_fip_js, weights.class_fip_gr,
              (v) => setWeights((p) => ({ ...p, class_fip_fs: v })),
              (v) => setWeights((p) => ({ ...p, class_fip_sj: v })),
              (v) => setWeights((p) => ({ ...p, class_fip_js: v })),
              (v) => setWeights((p) => ({ ...p, class_fip_gr: v })),
            )}
            {renderEditableDampeningCard(
              "FIP",
              "ProjectedFIP",
              weights.fip_damp_thresholds,
              weights.fip_damp_impacts,
              (next) => setWeights((p) => ({ ...p, fip_damp_thresholds: next })),
              (next) => setWeights((p) => ({ ...p, fip_damp_impacts: next })),
            )}
          </div>

          <div className="space-y-2">
            <p className="text-lg font-semibold">WHIP</p>
            <div className="bg-muted p-4 rounded-lg space-y-1 text-sm font-mono leading-relaxed">
              <div><span className="text-muted-foreground">LastWHIP =</span> LastWHIP</div>
              <div><span className="text-muted-foreground">PowerAdjustedWHIP =</span> NCAAAvgWHIP - ((WHIPPowerRating+ - 100) / StdDevWHIPPowerRating+) × StdDevNCAAWHIP</div>
              <div><span className="text-muted-foreground">BlendedWHIP =</span> (LastWHIP × (1 - PowerRatingWeight)) + (PowerAdjustedWHIP × PowerRatingWeight)</div>
              <div><span className="text-muted-foreground">Mult =</span> 1 - ClassAdjustment - (DevAggressiveness × 0.06)</div>
              <div><span className="text-muted-foreground">ProjectedWHIP =</span> BlendedWHIP × Mult</div>
              <div><span className="text-muted-foreground">Delta =</span> ProjectedWHIP - LastWHIP</div>
              <div className="text-[12px] break-words">
                <span className="text-muted-foreground">DampFactor =</span>
              </div>
              {renderDampFactorBreakdown("ProjectedWHIP", weights.whip_damp_thresholds, weights.whip_damp_impacts).map((line) => (
                <div key={line} className="pl-4 text-xs leading-tight">{line}</div>
              ))}
              <div><span className="text-muted-foreground">FinalWHIP =</span> LastWHIP + (Delta × DampFactor)</div>
            </div>
          </div>
          <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>Constants</p>
              <div className="ml-2 space-y-0.5">
                <div>• Power Rating Weight = 0.70</div>
                <div>• NCAA Avg WHIP Power Rating+ = 100</div>
              </div>
            </div>
            {renderSdConstantsCard(
              "Std Dev WHIP Power Rating+",
              weights.whip_pr_sd,
              (v) => setWeights((p) => ({ ...p, whip_pr_sd: v })),
              "Std Dev NCAA WHIP",
              weights.whip_plus_ncaa_sd,
              (v) => setWeights((p) => ({ ...p, whip_plus_ncaa_sd: v })),
            )}
            <div className={sectionPanelClass}>
              {editableSectionHeader("NCAA Average")}
              <div className="grid grid-cols-[1fr_140px] items-center gap-3 text-xs text-muted-foreground">
                <span>NCAA Avg WHIP</span>
                <Input type="text" inputMode="decimal" className="h-8" value={weights.whip_plus_ncaa_avg} onChange={(e) => setWeights((p) => ({ ...p, whip_plus_ncaa_avg: toNum(e.target.value) }))} />
              </div>
            </div>
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>Player-Specific</p>
              <div className="ml-2 space-y-0.5">
                <div>• Last WHIP</div>
                <div>• WHIP Power Rating+</div>
                <div>• Dev Aggressiveness (0.0 / 0.5 / 1.0)</div>
              </div>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {renderClassAdjustmentsCard(
              weights.class_whip_fs, weights.class_whip_sj, weights.class_whip_js, weights.class_whip_gr,
              (v) => setWeights((p) => ({ ...p, class_whip_fs: v })),
              (v) => setWeights((p) => ({ ...p, class_whip_sj: v })),
              (v) => setWeights((p) => ({ ...p, class_whip_js: v })),
              (v) => setWeights((p) => ({ ...p, class_whip_gr: v })),
            )}
            {renderEditableDampeningCard(
              "WHIP",
              "ProjectedWHIP",
              weights.whip_damp_thresholds,
              weights.whip_damp_impacts,
              (next) => setWeights((p) => ({ ...p, whip_damp_thresholds: next })),
              (next) => setWeights((p) => ({ ...p, whip_damp_impacts: next })),
            )}
          </div>

          <div className="space-y-2">
            <p className="text-lg font-semibold">K/9</p>
            <div className="bg-muted p-4 rounded-lg space-y-1 text-sm font-mono leading-relaxed">
              <div><span className="text-muted-foreground">LastK9 =</span> LastK9</div>
              <div><span className="text-muted-foreground">PowerAdjustedK9 =</span> NCAAAvgK9 + ((K9PowerRating+ - 100) / StdDevK9PowerRating+) × StdDevNCAAK9</div>
              <div><span className="text-muted-foreground">BlendedK9 =</span> (LastK9 × (1 - PowerRatingWeight)) + (PowerAdjustedK9 × PowerRatingWeight)</div>
              <div><span className="text-muted-foreground">Mult =</span> 1 + ClassAdjustment + (DevAggressiveness × 0.06)</div>
              <div><span className="text-muted-foreground">ProjectedK9 =</span> BlendedK9 × Mult</div>
              <div><span className="text-muted-foreground">Delta =</span> ProjectedK9 - LastK9</div>
              <div className="text-[12px] break-words">
                <span className="text-muted-foreground">DampFactor =</span>
              </div>
              {renderDampFactorBreakdown("ProjectedK9", weights.k9_damp_thresholds, weights.k9_damp_impacts).map((line) => (
                <div key={line} className="pl-4 text-xs leading-tight">{line}</div>
              ))}
              <div><span className="text-muted-foreground">FinalK9 =</span> LastK9 + (Delta × DampFactor)</div>
            </div>
          </div>
          <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>Constants</p>
              <div className="ml-2 space-y-0.5">
                <div>• Power Rating Weight = 0.70</div>
                <div>• NCAA Avg K/9 Power Rating+ = 100</div>
              </div>
            </div>
            {renderSdConstantsCard(
              "Std Dev K/9 Power Rating+",
              weights.k9_pr_sd,
              (v) => setWeights((p) => ({ ...p, k9_pr_sd: v })),
              "Std Dev NCAA K/9",
              weights.k9_plus_ncaa_sd,
              (v) => setWeights((p) => ({ ...p, k9_plus_ncaa_sd: v })),
            )}
            <div className={sectionPanelClass}>
              {editableSectionHeader("NCAA Average")}
              <div className="grid grid-cols-[1fr_140px] items-center gap-3 text-xs text-muted-foreground">
                <span>NCAA Avg K/9</span>
                <Input type="text" inputMode="decimal" className="h-8" value={weights.k9_plus_ncaa_avg} onChange={(e) => setWeights((p) => ({ ...p, k9_plus_ncaa_avg: toNum(e.target.value) }))} />
              </div>
            </div>
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>Player-Specific</p>
              <div className="ml-2 space-y-0.5">
                <div>• Last K/9</div>
                <div>• K/9 Power Rating+</div>
                <div>• Dev Aggressiveness (0.0 / 0.5 / 1.0)</div>
              </div>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {renderClassAdjustmentsCard(
              weights.class_k9_fs, weights.class_k9_sj, weights.class_k9_js, weights.class_k9_gr,
              (v) => setWeights((p) => ({ ...p, class_k9_fs: v })),
              (v) => setWeights((p) => ({ ...p, class_k9_sj: v })),
              (v) => setWeights((p) => ({ ...p, class_k9_js: v })),
              (v) => setWeights((p) => ({ ...p, class_k9_gr: v })),
            )}
            {renderEditableDampeningCard(
              "K/9",
              "ProjectedK9",
              weights.k9_damp_thresholds,
              weights.k9_damp_impacts,
              (next) => setWeights((p) => ({ ...p, k9_damp_thresholds: next })),
              (next) => setWeights((p) => ({ ...p, k9_damp_impacts: next })),
            )}
          </div>

          <div className="space-y-2">
            <p className="text-lg font-semibold">BB/9</p>
            <div className="bg-muted p-4 rounded-lg space-y-1 text-sm font-mono leading-relaxed">
              <div><span className="text-muted-foreground">LastBB9 =</span> LastBB9</div>
              <div><span className="text-muted-foreground">PowerAdjustedBB9 =</span> NCAAAvgBB9 - ((BB9PowerRating+ - 100) / StdDevBB9PowerRating+) × StdDevNCAABB9</div>
              <div><span className="text-muted-foreground">BlendedBB9 =</span> (LastBB9 × (1 - PowerRatingWeight)) + (PowerAdjustedBB9 × PowerRatingWeight)</div>
              <div><span className="text-muted-foreground">Mult =</span> 1 - ClassAdjustment - (DevAggressiveness × 0.06)</div>
              <div><span className="text-muted-foreground">ProjectedBB9 =</span> BlendedBB9 × Mult</div>
              <div><span className="text-muted-foreground">Delta =</span> ProjectedBB9 - LastBB9</div>
              <div className="text-[12px] break-words">
                <span className="text-muted-foreground">DampFactor =</span>
              </div>
              {renderDampFactorBreakdown("ProjectedBB9", weights.bb9_damp_thresholds, weights.bb9_damp_impacts).map((line) => (
                <div key={line} className="pl-4 text-xs leading-tight">{line}</div>
              ))}
              <div><span className="text-muted-foreground">FinalBB9 =</span> LastBB9 + (Delta × DampFactor)</div>
            </div>
          </div>
          <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>Constants</p>
              <div className="ml-2 space-y-0.5">
                <div>• Power Rating Weight = 0.70</div>
                <div>• NCAA Avg BB/9 Power Rating+ = 100</div>
              </div>
            </div>
            {renderSdConstantsCard(
              "Std Dev BB/9 Power Rating+",
              weights.bb9_pr_sd,
              (v) => setWeights((p) => ({ ...p, bb9_pr_sd: v })),
              "Std Dev NCAA BB/9",
              weights.bb9_plus_ncaa_sd,
              (v) => setWeights((p) => ({ ...p, bb9_plus_ncaa_sd: v })),
            )}
            <div className={sectionPanelClass}>
              {editableSectionHeader("NCAA Average")}
              <div className="grid grid-cols-[1fr_140px] items-center gap-3 text-xs text-muted-foreground">
                <span>NCAA Avg BB/9</span>
                <Input type="text" inputMode="decimal" className="h-8" value={weights.bb9_plus_ncaa_avg} onChange={(e) => setWeights((p) => ({ ...p, bb9_plus_ncaa_avg: toNum(e.target.value) }))} />
              </div>
            </div>
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>Player-Specific</p>
              <div className="ml-2 space-y-0.5">
                <div>• Last BB/9</div>
                <div>• BB/9 Power Rating+</div>
                <div>• Dev Aggressiveness (0.0 / 0.5 / 1.0)</div>
              </div>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {renderClassAdjustmentsCard(
              weights.class_bb9_fs, weights.class_bb9_sj, weights.class_bb9_js, weights.class_bb9_gr,
              (v) => setWeights((p) => ({ ...p, class_bb9_fs: v })),
              (v) => setWeights((p) => ({ ...p, class_bb9_sj: v })),
              (v) => setWeights((p) => ({ ...p, class_bb9_js: v })),
              (v) => setWeights((p) => ({ ...p, class_bb9_gr: v })),
            )}
            {renderEditableDampeningCard(
              "BB/9",
              "ProjectedBB9",
              weights.bb9_damp_thresholds,
              weights.bb9_damp_impacts,
              (next) => setWeights((p) => ({ ...p, bb9_damp_thresholds: next })),
              (next) => setWeights((p) => ({ ...p, bb9_damp_impacts: next })),
            )}
          </div>

          <div className="space-y-2">
            <p className="text-lg font-semibold">HR/9</p>
            <div className="bg-muted p-4 rounded-lg space-y-1 text-sm font-mono leading-relaxed">
              <div><span className="text-muted-foreground">LastHR9 =</span> LastHR9</div>
              <div><span className="text-muted-foreground">PowerAdjustedHR9 =</span> NCAAAvgHR9 - ((HR9PowerRating+ - 100) / StdDevHR9PowerRating+) × StdDevNCAAHR9</div>
              <div><span className="text-muted-foreground">BlendedHR9 =</span> (LastHR9 × (1 - PowerRatingWeight)) + (PowerAdjustedHR9 × PowerRatingWeight)</div>
              <div><span className="text-muted-foreground">Mult =</span> 1 - ClassAdjustment - (DevAggressiveness × 0.06)</div>
              <div><span className="text-muted-foreground">ProjectedHR9 =</span> BlendedHR9 × Mult</div>
              <div><span className="text-muted-foreground">Delta =</span> ProjectedHR9 - LastHR9</div>
              <div className="text-[12px] break-words">
                <span className="text-muted-foreground">DampFactor =</span>
              </div>
              {renderDampFactorBreakdown("ProjectedHR9", weights.hr9_damp_thresholds, weights.hr9_damp_impacts).map((line) => (
                <div key={line} className="pl-4 text-xs leading-tight">{line}</div>
              ))}
              <div><span className="text-muted-foreground">FinalHR9 =</span> LastHR9 + (Delta × DampFactor)</div>
            </div>
          </div>
          <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>Constants</p>
              <div className="ml-2 space-y-0.5">
                <div>• Power Rating Weight = 0.70</div>
                <div>• NCAA Avg HR/9 Power Rating+ = 100</div>
              </div>
            </div>
            {renderSdConstantsCard(
              "Std Dev HR/9 Power Rating+",
              weights.hr9_pr_sd,
              (v) => setWeights((p) => ({ ...p, hr9_pr_sd: v })),
              "Std Dev NCAA HR/9",
              weights.hr9_plus_ncaa_sd,
              (v) => setWeights((p) => ({ ...p, hr9_plus_ncaa_sd: v })),
            )}
            <div className={sectionPanelClass}>
              {editableSectionHeader("NCAA Average")}
              <div className="grid grid-cols-[1fr_140px] items-center gap-3 text-xs text-muted-foreground">
                <span>NCAA Avg HR/9</span>
                <Input type="text" inputMode="decimal" className="h-8" value={weights.hr9_plus_ncaa_avg} onChange={(e) => setWeights((p) => ({ ...p, hr9_plus_ncaa_avg: toNum(e.target.value) }))} />
              </div>
            </div>
            <div className={sectionPanelClass}>
              <p className={sectionHeadingClass}>Player-Specific</p>
              <div className="ml-2 space-y-0.5">
                <div>• Last HR/9</div>
                <div>• HR/9 Power Rating+</div>
                <div>• Dev Aggressiveness (0.0 / 0.5 / 1.0)</div>
              </div>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {renderClassAdjustmentsCard(
              weights.class_hr9_fs, weights.class_hr9_sj, weights.class_hr9_js, weights.class_hr9_gr,
              (v) => setWeights((p) => ({ ...p, class_hr9_fs: v })),
              (v) => setWeights((p) => ({ ...p, class_hr9_sj: v })),
              (v) => setWeights((p) => ({ ...p, class_hr9_js: v })),
              (v) => setWeights((p) => ({ ...p, class_hr9_gr: v })),
            )}
            {renderEditableDampeningCard(
              "HR/9",
              "ProjectedHR9",
              weights.hr9_damp_thresholds,
              weights.hr9_damp_impacts,
              (next) => setWeights((p) => ({ ...p, hr9_damp_thresholds: next })),
              (next) => setWeights((p) => ({ ...p, hr9_damp_impacts: next })),
            )}
          </div>

          <div className={sectionPanelClass}>
            <p className="text-base font-semibold">pRV+</p>
            <div className="bg-muted p-4 rounded-lg space-y-1 text-sm font-mono leading-relaxed">
              <div><span className="text-muted-foreground">pRV+ =</span> ({weights.fip_plus_weight.toFixed(2)} × FIP+) + ({weights.era_plus_weight.toFixed(2)} × ERA+) + ({weights.whip_plus_weight.toFixed(2)} × WHIP+) + ({weights.k9_plus_weight.toFixed(2)} × K/9+) + ({weights.bb9_plus_weight.toFixed(2)} × BB/9+) + ({weights.hr9_plus_weight.toFixed(2)} × HR/9+)</div>
            </div>
          </div>

          <div className={sectionPanelClass}>
            <p className="text-base font-semibold">Pitching WAR (pWAR)</p>
            <p className="text-sm text-muted-foreground">Equation + pitcher WAR factors</p>

            <div className="space-y-2">
              <p className="text-sm font-semibold">pWAR Equation</p>
              <div className="bg-muted p-4 rounded-lg space-y-1 text-sm font-mono leading-relaxed">
                <div><span className="text-muted-foreground">PitcherValue =</span> (pRV+ - 100) / 100</div>
                <div><span className="text-muted-foreground">RPA =</span> PitcherValue × (IP / 9) × R/9</div>
                <div><span className="text-muted-foreground">ReplacementRuns =</span> (IP / 9) × ReplacementRunsPer9</div>
                <div><span className="text-muted-foreground">pRAR =</span> RPA + ReplacementRuns</div>
                <div><span className="text-muted-foreground">NCAA pWAR =</span> pRAR / RunsPerWin</div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Inputs</p>
                <div className="ml-2 space-y-0.5 text-xs text-muted-foreground">
                  <div>• pRV+</div>
                  <div>• IP (role-based projection)</div>
                  <div>• R/9</div>
                  <div>• ReplacementRunsPer9</div>
                  <div>• RunsPerWin</div>
                </div>
              </div>
              <div className={sectionPanelClass}>
                <div className="flex items-center justify-between">
                  <p className={sectionHeadingClass}>Editable (Admin UI)</p>
                  <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]">Edit</Button>
                </div>
                <p className="text-[11px] text-muted-foreground">* assuming future projections</p>
                <div className="space-y-2 text-xs text-muted-foreground">
                  <div className="grid grid-cols-[1fr_140px] items-center gap-3">
                    <span>IP (Starting Pitcher)</span>
                    <Input type="text" inputMode="decimal" className="h-8" value={weights.pwar_ip_sp} onChange={(e) => setWeights((p) => ({ ...p, pwar_ip_sp: toNum(e.target.value) }))} />
                  </div>
                  <div className="grid grid-cols-[1fr_140px] items-center gap-3">
                    <span>IP (Reliever)</span>
                    <Input type="text" inputMode="decimal" className="h-8" value={weights.pwar_ip_rp} onChange={(e) => setWeights((p) => ({ ...p, pwar_ip_rp: toNum(e.target.value) }))} />
                  </div>
                  <div className="grid grid-cols-[1fr_140px] items-center gap-3">
                    <span>IP (Swingman)</span>
                    <Input type="text" inputMode="decimal" className="h-8" value={weights.pwar_ip_sm} onChange={(e) => setWeights((p) => ({ ...p, pwar_ip_sm: toNum(e.target.value) }))} />
                  </div>
                  <div className="grid grid-cols-[1fr_140px] items-center gap-3">
                    <span>R/9</span>
                    <Input type="text" inputMode="decimal" className="h-8" value={weights.pwar_r_per_9} onChange={(e) => setWeights((p) => ({ ...p, pwar_r_per_9: toNum(e.target.value) }))} />
                  </div>
                  <div className="grid grid-cols-[1fr_140px] items-center gap-3">
                    <span>ReplacementRuns/9</span>
                    <Input type="text" inputMode="decimal" className="h-8" value={weights.pwar_replacement_runs_per_9} onChange={(e) => setWeights((p) => ({ ...p, pwar_replacement_runs_per_9: toNum(e.target.value) }))} />
                  </div>
                  <div className="grid grid-cols-[1fr_140px] items-center gap-3">
                    <span>Runs/Win</span>
                    <Input type="text" inputMode="decimal" className="h-8" value={weights.pwar_runs_per_win} onChange={(e) => setWeights((p) => ({ ...p, pwar_runs_per_win: toNum(e.target.value) }))} />
                  </div>
                </div>
              </div>
            </div>
            <div className={sectionPanelClass}>
              <div className="flex items-center justify-between">
                <p className={sectionHeadingClass}>Role Change Regression (SP ↔ RP)</p>
                <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]">Edit</Button>
              </div>
              <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
                <div className="rounded-md border bg-background/50 p-2">
                  <p className="text-[11px] uppercase tracking-wide font-semibold text-foreground mb-2">Base Impact By Metric (SP→RP)</p>
                  <div className="grid grid-cols-[1fr_140px] gap-2 text-xs text-muted-foreground">
                    <div className="font-medium">Metric</div>
                    <div className="font-medium text-right">Adjustment</div>
                    <div>ERA</div>
                    <div className="relative">
                      <Input type="text" inputMode="decimal" className="h-8 pr-6 text-right" value={weights.sp_to_rp_reg_era_pct} onChange={(e) => setWeights((p) => ({ ...p, sp_to_rp_reg_era_pct: toNum(e.target.value) }))} />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">%</span>
                    </div>
                    <div>FIP</div>
                    <div className="relative">
                      <Input type="text" inputMode="decimal" className="h-8 pr-6 text-right" value={weights.sp_to_rp_reg_fip_pct} onChange={(e) => setWeights((p) => ({ ...p, sp_to_rp_reg_fip_pct: toNum(e.target.value) }))} />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">%</span>
                    </div>
                    <div>WHIP</div>
                    <div className="relative">
                      <Input type="text" inputMode="decimal" className="h-8 pr-6 text-right" value={weights.sp_to_rp_reg_whip_pct} onChange={(e) => setWeights((p) => ({ ...p, sp_to_rp_reg_whip_pct: toNum(e.target.value) }))} />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">%</span>
                    </div>
                    <div>K/9</div>
                    <div className="relative">
                      <Input type="text" inputMode="decimal" className="h-8 pr-6 text-right" value={weights.sp_to_rp_reg_k9_pct} onChange={(e) => setWeights((p) => ({ ...p, sp_to_rp_reg_k9_pct: toNum(e.target.value) }))} />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">%</span>
                    </div>
                    <div>BB/9</div>
                    <div className="relative">
                      <Input type="text" inputMode="decimal" className="h-8 pr-6 text-right" value={weights.sp_to_rp_reg_bb9_pct} onChange={(e) => setWeights((p) => ({ ...p, sp_to_rp_reg_bb9_pct: toNum(e.target.value) }))} />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">%</span>
                    </div>
                    <div>HR/9</div>
                    <div className="relative">
                      <Input type="text" inputMode="decimal" className="h-8 pr-6 text-right" value={weights.sp_to_rp_reg_hr9_pct} onChange={(e) => setWeights((p) => ({ ...p, sp_to_rp_reg_hr9_pct: toNum(e.target.value) }))} />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">%</span>
                    </div>
                  </div>
                </div>
                <div className="rounded-md border bg-background/50 p-2">
                  <p className="text-[11px] uppercase tracking-wide font-semibold text-foreground mb-2">RP→SP Boost Curve (ERA/FIP/WHIP/BB9/HR9)</p>
                  <div className="grid grid-cols-[1fr_120px] gap-2 text-xs text-muted-foreground">
                    <div className="font-medium">Tier Max</div>
                    <div className="font-medium text-right">Multiplier</div>
                    <Input type="text" inputMode="decimal" className="h-8 text-right" value={weights.rp_to_sp_low_better_tier1_max} onChange={(e) => setWeights((p) => ({ ...p, rp_to_sp_low_better_tier1_max: toNum(e.target.value) }))} />
                    <Input type="text" inputMode="decimal" className="h-8 text-right" value={weights.rp_to_sp_low_better_tier1_mult} onChange={(e) => setWeights((p) => ({ ...p, rp_to_sp_low_better_tier1_mult: toNum(e.target.value) }))} />
                    <Input type="text" inputMode="decimal" className="h-8 text-right" value={weights.rp_to_sp_low_better_tier2_max} onChange={(e) => setWeights((p) => ({ ...p, rp_to_sp_low_better_tier2_max: toNum(e.target.value) }))} />
                    <Input type="text" inputMode="decimal" className="h-8 text-right" value={weights.rp_to_sp_low_better_tier2_mult} onChange={(e) => setWeights((p) => ({ ...p, rp_to_sp_low_better_tier2_mult: toNum(e.target.value) }))} />
                    <Input type="text" inputMode="decimal" className="h-8 text-right" value={weights.rp_to_sp_low_better_tier3_max} onChange={(e) => setWeights((p) => ({ ...p, rp_to_sp_low_better_tier3_max: toNum(e.target.value) }))} />
                    <Input type="text" inputMode="decimal" className="h-8 text-right" value={weights.rp_to_sp_low_better_tier3_mult} onChange={(e) => setWeights((p) => ({ ...p, rp_to_sp_low_better_tier3_mult: toNum(e.target.value) }))} />
                    <div className="col-span-2 text-[11px] text-muted-foreground">
                      Applies only when moving toward starter and only to lower-is-better metrics. K/9 uses base role impact only.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className={sectionPanelClass}>
            <p className="text-base font-semibold">Market Value</p>
            <p className="text-sm text-muted-foreground">Pitching market value projection</p>

            <div className="space-y-2">
              <p className="text-sm font-semibold">Default Equation</p>
              <div className="bg-muted p-4 rounded-lg space-y-1 text-sm font-mono leading-relaxed">
                <div><span className="text-muted-foreground">MarketValue =</span> pWAR × $/WAR × ProgramTierMultiplier × PositionalValueFactor</div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className={sectionPanelClass}>
                <p className={sectionHeadingClass}>Inputs</p>
                <div className="ml-2 space-y-0.5 text-xs text-muted-foreground">
                  <div>• pWAR</div>
                  <div>• $/WAR</div>
                  <div>• Program Tier Multiplier (PTM)</div>
                  <div>• Positional Value Factor (PVF)</div>
                </div>
              </div>
              <div className={sectionPanelClass}>
                <div className="flex items-center justify-between">
                  <p className={sectionHeadingClass}>Program Tier Multiplier</p>
                  <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]">Edit</Button>
                </div>
                <div className="space-y-2 text-xs text-muted-foreground">
                  <div className="grid grid-cols-[1fr_140px] items-center gap-3">
                    <span>$/WAR</span>
                    <Input type="text" inputMode="decimal" className="h-8" value={weights.market_dollars_per_war} onChange={(e) => setWeights((p) => ({ ...p, market_dollars_per_war: toNum(e.target.value) }))} />
                  </div>
                  <div className="grid grid-cols-[1fr_140px] items-center gap-3">
                    <span>SEC</span>
                    <Input type="text" inputMode="decimal" className="h-8" value={weights.market_tier_sec} onChange={(e) => setWeights((p) => ({ ...p, market_tier_sec: toNum(e.target.value) }))} />
                  </div>
                  <div className="grid grid-cols-[1fr_140px] items-center gap-3">
                    <span>Big 12 / ACC</span>
                    <Input type="text" inputMode="decimal" className="h-8" value={weights.market_tier_acc_big12} onChange={(e) => setWeights((p) => ({ ...p, market_tier_acc_big12: toNum(e.target.value) }))} />
                  </div>
                  <div className="grid grid-cols-[1fr_140px] items-center gap-3">
                    <span>Big Ten</span>
                    <Input type="text" inputMode="decimal" className="h-8" value={weights.market_tier_big_ten} onChange={(e) => setWeights((p) => ({ ...p, market_tier_big_ten: toNum(e.target.value) }))} />
                  </div>
                  <div className="grid grid-cols-[1fr_140px] items-center gap-3">
                    <span>Strong Mid Major</span>
                    <Input type="text" inputMode="decimal" className="h-8" value={weights.market_tier_strong_mid} onChange={(e) => setWeights((p) => ({ ...p, market_tier_strong_mid: toNum(e.target.value) }))} />
                  </div>
                  <div className="grid grid-cols-[1fr_140px] items-center gap-3">
                    <span>Low Major</span>
                    <Input type="text" inputMode="decimal" className="h-8" value={weights.market_tier_low_major} onChange={(e) => setWeights((p) => ({ ...p, market_tier_low_major: toNum(e.target.value) }))} />
                  </div>
                </div>
              </div>
              <div className={sectionPanelClass}>
                <div className="flex items-center justify-between">
                  <p className={sectionHeadingClass}>Positional Value Factor</p>
                  <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]">Edit</Button>
                </div>
                <div className="space-y-2 text-xs text-muted-foreground">
                  <div className="grid grid-cols-[1fr_140px] items-center gap-3">
                    <span>Weekend Starter</span>
                    <Input type="text" inputMode="decimal" className="h-8" value={weights.market_pvf_weekend_sp} onChange={(e) => setWeights((p) => ({ ...p, market_pvf_weekend_sp: toNum(e.target.value) }))} />
                  </div>
                  <div className="grid grid-cols-[1fr_140px] items-center gap-3">
                    <span>Weekday Starter</span>
                    <Input type="text" inputMode="decimal" className="h-8" value={weights.market_pvf_weekday_sp} onChange={(e) => setWeights((p) => ({ ...p, market_pvf_weekday_sp: toNum(e.target.value) }))} />
                  </div>
                  <div className="grid grid-cols-[1fr_140px] items-center gap-3">
                    <span>Reliever</span>
                    <Input type="text" inputMode="decimal" className="h-8" value={weights.market_pvf_reliever} onChange={(e) => setWeights((p) => ({ ...p, market_pvf_reliever: toNum(e.target.value) }))} />
                  </div>
                  <p className="text-[11px] text-muted-foreground">High-impact vs low-impact reliever split is handled in Team Builder by coach selection.</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

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

          <div className={sectionPanelClass}>
            <p className={sectionHeadingClass}>Overall Pitcher Power Rating</p>
            <div className="text-sm font-mono">
              (0.15 × ERA Power Rating+) + (0.25 × FIP Power Rating+) + (0.10 × WHIP Power Rating+) + (0.20 × K/9 Power Rating+) + (0.15 × BB/9 Power Rating+) + (0.15 × HR/9 Power Rating+)
            </div>
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
