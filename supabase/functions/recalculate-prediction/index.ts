import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Returner defaults – mirror src/lib/predictionEngine.ts ReturnerConfig defaults.
// Overridden by model_config `admin_ui` r_* rows when available. Class bases are
// keyed avg/obp/iso (ISO, not SLG) to match the SD-blend returner engine.
const DEFAULT_CLASS_BASES: Record<string, { avg: number; obp: number; iso: number }> = {
  FS: { avg: 0.03, obp: 0.03, iso: 0.045 },
  SJ: { avg: 0.02, obp: 0.02, iso: 0.03 },
  JS: { avg: 0.015, obp: 0.015, iso: 0.02 },
  GR: { avg: 0.01, obp: 0.01, iso: 0.01 },
};
const DEFAULT_DEV_COEFFS = { avg: 0.06, obp: 0.06, iso: 0.08 };
const DEFAULT_WRC_WEIGHTS = { intercept: 0.011, obp: 0.691, slg: 0.235, avg: 0, iso: 0 }; // C1 canonical: src/lib/wrc.ts

// Season whose admin_ui equation the returner engine reads. CURRENT_SEASON (2026)
// carries the recalibrated returner constants + C1 wRC weights; 2025 is the
// legacy (pre-C1) set. Keep in sync with src/lib/seasonConstants.ts CURRENT_SEASON.
const CONFIG_SEASON = 2026;

function round3(val: number): number {
  return Math.round(val * 1000) / 1000;
}

interface Config {
  ncaaAvg: number;
  ncaaObp: number;
  ncaaIso: number;
  ncaaPR: number;
  powerWeight: number;
  ncaaWrc: number;
  baStdPower: number;
  baStdNcaa: number;
  obpStdPower: number;
  obpStdNcaa: number;
  isoStdNcaa: number;
  isoStdPower: number;
  classBases: Record<string, { avg: number; obp: number; iso: number }>;
  devCoeffs: { avg: number; obp: number; iso: number };
  wrcWeights: { intercept: number; obp: number; slg: number; avg: number; iso: number };
  defaultDevAgg: number;
}
interface TransferConfig {
  baNcaaAvg: number;
  obpNcaaAvg: number;
  isoNcaaAvg: number;
  baPowerWeight: number;
  obpPowerWeight: number;
  baConferenceWeight: number;
  obpConferenceWeight: number;
  isoConferenceWeight: number;
  baPitchingWeight: number;
  obpPitchingWeight: number;
  isoPitchingWeight: number;
  baParkWeight: number;
  obpParkWeight: number;
  isoParkWeight: number;
  isoStdNcaa: number;
  isoStdPower: number;
  wrcWeights: { intercept: number; obp: number; slg: number; avg: number; iso: number };
  ncaaWrc: number;
}

function toRate(v: number): number {
  // Support either decimal inputs (0.045) or percent-style inputs (4.5)
  return Math.abs(v) > 1 ? v / 100 : v;
}

// Parity helpers ported from src/lib/predictionEngine.ts so the SD-blend math
// behaves identically to the canonical returner engine.
function normalizeRateInput(v: number): number {
  if (!Number.isFinite(v)) return 0;
  // Guardrail: some imported rows store rates as whole-number percent (34.4 → 0.344)
  return Math.abs(v) > 1 ? v / 100 : v;
}
function normalizeProjectedRate(v: number): number {
  if (!Number.isFinite(v)) return 0;
  // Defensive post-calc guardrail against writing scaled percentages as raw rates.
  return Math.abs(v) > 2 ? v / 100 : v;
}
function readSpecificPlus(v: number | null | undefined): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeClassTransition(raw?: string | null): string {
  let value = (raw || "").trim().toUpperCase();
  if (!value) return "SJ";
  if (["FS", "SJ", "JS", "GR"].includes(value)) return value;
  value = value.replace(/^(RS?-?\s*)+/, "").trim();
  if (value === "FR" || value === "FRESHMAN" || value === "FRESH") return "FS";
  if (value === "SO" || value === "SOPHOMORE" || value === "SOPH") return "SJ";
  if (value === "JR" || value === "JUNIOR") return "JS";
  if (value === "SR" || value === "SENIOR") return "GR";
  if (value === "GS" || value === "GRAD" || value === "GRADUATE") return "GR";
  if (value.includes("FRESHMAN")) return "FS";
  if (value.includes("SOPHOMORE")) return "SJ";
  if (value.includes("JUNIOR")) return "JS";
  if (value.includes("SENIOR") || value.includes("GRAD")) return "GR";
  return "SJ";
}

// Returner-hitter recompute — SD-blend, ported verbatim from
// src/lib/predictionEngine.ts `recalcReturner`. Per-stat scouting ratings come
// from the prediction row's from_avg_plus / from_obp_plus / from_slg_plus
// (populated in Step 3), NOT the overall power_rating_plus. Growth term is the
// class base + dev_aggressiveness·devCoeff. NO divisor damp, NO multiplicative
// power_rating adjustment.
function recalc(pred: any, config: Config, overrides?: { dev_aggressiveness?: number; class_transition?: string }) {
  const ct = normalizeClassTransition(overrides?.class_transition || pred.class_transition || "SJ");
  const rawDevAgg = overrides?.dev_aggressiveness ?? pred.dev_aggressiveness ?? config.defaultDevAgg;
  const devAgg = Number.isFinite(Number(rawDevAgg)) ? Number(rawDevAgg) : config.defaultDevAgg;
  const bases = config.classBases[ct] || config.classBases.GR || { avg: 0.01, obp: 0.01, iso: 0.01 };
  const powerWeight = config.powerWeight;
  const fromAvg = normalizeRateInput(Number(pred.from_avg));
  const fromObp = normalizeRateInput(Number(pred.from_obp));
  const fromSlg = normalizeRateInput(Number(pred.from_slg));
  const baPlus = readSpecificPlus(pred.from_avg_plus);
  const obpPlus = readSpecificPlus(pred.from_obp_plus);
  const isoPlus = readSpecificPlus(pred.from_slg_plus);
  const dc = config.devCoeffs;
  const ww = config.wrcWeights;

  const pAvg = baPlus == null
    ? null
    : (() => {
      const safeBaStdPower = config.baStdPower === 0 ? 1 : config.baStdPower;
      const scaledBa = config.ncaaAvg + (((baPlus - config.ncaaPR) / safeBaStdPower) * config.baStdNcaa);
      const baBlended = (fromAvg * (1 - powerWeight)) + (scaledBa * powerWeight);
      const baProjected = baBlended * (1 + bases.avg + (devAgg * dc.avg));
      return round3(normalizeProjectedRate(baProjected));
    })();

  const pObp = obpPlus == null
    ? null
    : (() => {
      const safeObpStdPower = config.obpStdPower === 0 ? 1 : config.obpStdPower;
      const scaledObp = config.ncaaObp + (((obpPlus - config.ncaaPR) / safeObpStdPower) * config.obpStdNcaa);
      const obpBlended = (fromObp * (1 - powerWeight)) + (scaledObp * powerWeight);
      const obpProjected = obpBlended * (1 + bases.obp + (devAgg * dc.obp));
      return round3(normalizeProjectedRate(obpProjected));
    })();

  const pIso = isoPlus == null
    ? null
    : (() => {
      const lastIso = fromSlg - fromAvg;
      const scaledIso = config.ncaaIso + (((isoPlus - config.ncaaPR) / config.isoStdPower) * config.isoStdNcaa);
      const blendedIso = (lastIso * (1 - powerWeight)) + (scaledIso * powerWeight);
      return round3(normalizeProjectedRate(blendedIso * (1 + bases.iso + (devAgg * dc.iso))));
    })();

  const pSlg = pAvg == null || pIso == null ? null : round3(normalizeProjectedRate(pAvg + pIso));
  const pOps = pObp == null || pSlg == null ? null : round3(normalizeProjectedRate(pObp + pSlg));
  const pWrc = pObp == null || pSlg == null || pAvg == null || pIso == null
    ? null
    : round3((ww.intercept) + (ww.obp * pObp) + (ww.slg * pSlg) + (ww.avg * pAvg) + (ww.iso * pIso));
  const pWrcPlus = pWrc == null ? null : Math.round((pWrc / config.ncaaWrc) * 100);

  return { p_avg: pAvg, p_obp: pObp, p_slg: pSlg, p_ops: pOps, p_iso: pIso, p_wrc: pWrc, p_wrc_plus: pWrcPlus, class_transition: ct, dev_aggressiveness: devAgg };
}

function recalcTransfer(pred: any, config: TransferConfig) {
  const fromAvgRaw = Number(pred.from_avg);
  const fromObpRaw = Number(pred.from_obp);
  const fromSlgRaw = Number(pred.from_slg);
  const prPlusRaw = Number(pred.power_rating_plus);
  const fromAvgPlusRaw = Number(pred.from_avg_plus);
  const toAvgPlusRaw = Number(pred.to_avg_plus);
  const fromObpPlusRaw = Number(pred.from_obp_plus);
  const toObpPlusRaw = Number(pred.to_obp_plus);
  const fromSlgPlusRaw = Number(pred.from_slg_plus);
  const toSlgPlusRaw = Number(pred.to_slg_plus);
  const fromStuffRaw = Number(pred.from_stuff_plus);
  const toStuffRaw = Number(pred.to_stuff_plus);
  const fromParkRaw = Number(pred.from_park_factor);
  const toParkRaw = Number(pred.to_park_factor);

  if (!Number.isFinite(fromAvgRaw) || !Number.isFinite(fromObpRaw) || !Number.isFinite(fromSlgRaw)) {
    return { p_avg: null, p_obp: null, p_slg: null, p_ops: null, p_iso: null, p_wrc: null, p_wrc_plus: null };
  }

  const fromAvg = fromAvgRaw;
  const fromObp = fromObpRaw;
  const fromSlg = fromSlgRaw;
  const prPlus = Number.isFinite(prPlusRaw) ? prPlusRaw : 100;
  const fromAvgPlus = Number.isFinite(fromAvgPlusRaw) ? fromAvgPlusRaw : 100;
  const toAvgPlus = Number.isFinite(toAvgPlusRaw) ? toAvgPlusRaw : fromAvgPlus;
  const fromObpPlus = Number.isFinite(fromObpPlusRaw) ? fromObpPlusRaw : 100;
  const toObpPlus = Number.isFinite(toObpPlusRaw) ? toObpPlusRaw : fromObpPlus;
  const fromSlgPlus = Number.isFinite(fromSlgPlusRaw) ? fromSlgPlusRaw : 100;
  const toSlgPlus = Number.isFinite(toSlgPlusRaw) ? toSlgPlusRaw : fromSlgPlus;
  const fromStuff = Number.isFinite(fromStuffRaw) ? fromStuffRaw : 100;
  const toStuff = Number.isFinite(toStuffRaw) ? toStuffRaw : fromStuff;
  const fromPark = Number.isFinite(fromParkRaw) ? fromParkRaw : 1;
  const toPark = Number.isFinite(toParkRaw) ? toParkRaw : fromPark;

  const baPowerAdj = config.baNcaaAvg * (prPlus / 100);
  const baBlended = fromAvg * (1 - config.baPowerWeight) + baPowerAdj * config.baPowerWeight;
  const baMultiplier =
    1 +
    (config.baConferenceWeight * ((toAvgPlus - fromAvgPlus) / 100)) -
    (config.baPitchingWeight * ((toStuff - fromStuff) / 100)) +
    (config.baParkWeight * ((toPark - fromPark) / 100));
  const pAvg = round3(baBlended * baMultiplier);

  const obpPowerAdj = config.obpNcaaAvg * (prPlus / 100);
  const obpBlended = fromObp * (1 - config.obpPowerWeight) + obpPowerAdj * config.obpPowerWeight;
  const obpMultiplier =
    1 +
    (config.obpConferenceWeight * ((toObpPlus - fromObpPlus) / 100)) -
    (config.obpPitchingWeight * ((toStuff - fromStuff) / 100)) +
    (config.obpParkWeight * ((toPark - fromPark) / 100));
  const pObp = round3(obpBlended * obpMultiplier);

  const lastIso = fromSlg - fromAvg;
  const ratingZ = config.isoStdPower > 0 ? (prPlus - 100) / config.isoStdPower : 0;
  const scaledIso = config.isoNcaaAvg + (ratingZ * config.isoStdNcaa);
  const isoBlended = (lastIso * (1 - 0.3)) + (scaledIso * 0.3);
  const isoMultiplier =
    1 +
    (config.isoConferenceWeight * ((toSlgPlus - fromSlgPlus) / 100)) -
    (config.isoPitchingWeight * ((toStuff - fromStuff) / 100)) +
    (config.isoParkWeight * ((toPark - fromPark) / 100));
  const pIso = round3(isoBlended * isoMultiplier);

  const pSlg = round3(pAvg + pIso);
  const pOps = round3(pObp + pSlg);
  const pWrc = round3(config.wrcWeights.intercept + (config.wrcWeights.obp * pObp) + (config.wrcWeights.slg * pSlg) + (config.wrcWeights.avg * pAvg) + (config.wrcWeights.iso * pIso));
  const pWrcPlus = config.ncaaWrc === 0 ? null : Math.round((pWrc / config.ncaaWrc) * 100);

  return { p_avg: pAvg, p_obp: pObp, p_slg: pSlg, p_ops: pOps, p_iso: pIso, p_wrc: pWrc, p_wrc_plus: pWrcPlus };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { prediction_id, dev_aggressiveness, class_transition, action } = body;

    // Fetch returner equation from the admin_ui model_config rows (the r_* keys).
    // The legacy filter model_type='returner' matched ZERO rows (all equation
    // rows live under model_type='admin_ui'), so the engine silently ran on
    // hardcoded defaults. Filter by CONFIG_SEASON so the 2025 (legacy) and 2026
    // (recalibrated) copies of every r_* key don't collide.
    const { data: configRows } = await supabase
      .from("model_config")
      .select("config_key, config_value")
      .eq("model_type", "admin_ui")
      .eq("season", CONFIG_SEASON);
    const { data: transferConfigRows } = await supabase
      .from("model_config")
      .select("config_key, config_value")
      .eq("model_type", "transfer");

  // Defaults mirror src/lib/predictionEngine.ts ReturnerConfig. ncaaPR + powerWeight
    // are locked (no r_* key); dev coeffs + defaultDevAgg have no admin_ui key today
    // and fall through to these defaults, matching predictionEngine.
    const config: Config = {
      ncaaAvg: 0.28,
      ncaaObp: 0.385,
      ncaaIso: 0.162,
      ncaaPR: 100,
      powerWeight: 0.7,
      ncaaWrc: 0.3782,
      baStdPower: 31.297,
      baStdNcaa: 0.043455,
      obpStdPower: 28.889,
      obpStdNcaa: 0.046781,
      isoStdNcaa: 0.07849797197,
      isoStdPower: 45.423,
      classBases: JSON.parse(JSON.stringify(DEFAULT_CLASS_BASES)),
      devCoeffs: { ...DEFAULT_DEV_COEFFS },
      wrcWeights: { ...DEFAULT_WRC_WEIGHTS },
      defaultDevAgg: 0,
    };
    // Build a key→value map so r_* keys read explicitly (avoids ordering issues
    // and lets t_iso_std_power fill in when the r_ variant is absent).
    const cv = new Map<string, number>();
    for (const row of configRows || []) {
      const n = Number(row.config_value);
      if (Number.isFinite(n)) cv.set(row.config_key, n);
    }
    const applyR = (key: string, set: (v: number) => void) => {
      if (cv.has(key)) set(cv.get(key)!);
    };
    applyR("r_ncaa_avg_ba", (v) => { config.ncaaAvg = toRate(v); });
    applyR("r_ncaa_avg_obp", (v) => { config.ncaaObp = toRate(v); });
    applyR("r_ncaa_avg_iso", (v) => { config.ncaaIso = toRate(v); });
    applyR("r_ncaa_avg_wrc", (v) => { config.ncaaWrc = toRate(v); });
    applyR("r_ba_std_pr", (v) => { config.baStdPower = v; });   // raw (>1) — not a rate
    applyR("r_ba_std_ncaa", (v) => { config.baStdNcaa = toRate(v); });
    applyR("r_obp_std_pr", (v) => { config.obpStdPower = v; });
    applyR("r_obp_std_ncaa", (v) => { config.obpStdNcaa = toRate(v); });
    applyR("r_iso_std_ncaa", (v) => { config.isoStdNcaa = toRate(v); });
    // isoStdPower: prefer r_iso_std_power, else t_iso_std_power (transfer key). Raw.
    if (cv.has("r_iso_std_power")) config.isoStdPower = cv.get("r_iso_std_power")!;
    else if (cv.has("t_iso_std_power")) config.isoStdPower = cv.get("t_iso_std_power")!;
    applyR("r_w_intercept", (v) => { config.wrcWeights.intercept = v; });
    applyR("r_w_obp", (v) => { config.wrcWeights.obp = v; });
    applyR("r_w_slg", (v) => { config.wrcWeights.slg = v; });
    applyR("r_w_avg", (v) => { config.wrcWeights.avg = v; });
    applyR("r_w_iso", (v) => { config.wrcWeights.iso = v; });
    // Class bases: r_{ba|obp|iso}_class_{fs|sj|js|gr}. Stored in PERCENT for whole
    // values (3 → 0.03) but as rates for tiny ones (0.01 → 0.01); toRate handles both.
    for (const cls of ["fs", "sj", "js", "gr"] as const) {
      const CLS = cls.toUpperCase();
      if (!config.classBases[CLS]) config.classBases[CLS] = { avg: 0.01, obp: 0.01, iso: 0.01 };
      applyR(`r_ba_class_${cls}`, (v) => { config.classBases[CLS].avg = toRate(v); });
      applyR(`r_obp_class_${cls}`, (v) => { config.classBases[CLS].obp = toRate(v); });
      applyR(`r_iso_class_${cls}`, (v) => { config.classBases[CLS].iso = toRate(v); });
    }
    const transferConfig: TransferConfig = {
      baNcaaAvg: 0.28,
      obpNcaaAvg: 0.385,
      isoNcaaAvg: 0.162,
      baPowerWeight: 0.7,
      obpPowerWeight: 0.7,
      baConferenceWeight: 1,
      obpConferenceWeight: 1,
      isoConferenceWeight: 1,
      baPitchingWeight: 1,
      obpPitchingWeight: 1,
      isoPitchingWeight: 1,
      baParkWeight: 1,
      obpParkWeight: 1,
      isoParkWeight: 1,
      isoStdNcaa: 0.07849797197,
      isoStdPower: 45.423,
      wrcWeights: { ...DEFAULT_WRC_WEIGHTS },
      ncaaWrc: 0.3782,
    };
    for (const row of transferConfigRows || []) {
      const k = row.config_key;
      const v = Number(row.config_value);
      if (k === "ncaa_avg") transferConfig.baNcaaAvg = v;
      else if (k === "ncaa_obp") transferConfig.obpNcaaAvg = v;
      else if (k === "ncaa_iso") transferConfig.isoNcaaAvg = v;
      else if (k === "ncaa_wrc" || k === "wrc_plus_ncaa_avg") transferConfig.ncaaWrc = v;
      else if (k === "ba_power_weight" || k === "power_rating_weight") transferConfig.baPowerWeight = v;
      else if (k === "obp_power_weight") transferConfig.obpPowerWeight = v;
      else if (k === "ba_conference_weight" || k === "conference_weight") transferConfig.baConferenceWeight = v;
      else if (k === "obp_conference_weight") transferConfig.obpConferenceWeight = v;
      else if (k === "iso_conference_weight") transferConfig.isoConferenceWeight = v;
      else if (k === "ba_pitching_weight" || k === "pitching_weight") transferConfig.baPitchingWeight = v;
      else if (k === "obp_pitching_weight") transferConfig.obpPitchingWeight = v;
      else if (k === "iso_pitching_weight") transferConfig.isoPitchingWeight = v;
      else if (k === "ba_park_weight" || k === "park_weight") transferConfig.baParkWeight = v;
      else if (k === "obp_park_weight") transferConfig.obpParkWeight = v;
      else if (k === "iso_park_weight") transferConfig.isoParkWeight = v;
      else if (k === "iso_std_ncaa") transferConfig.isoStdNcaa = v;
      else if (k === "iso_std_power") transferConfig.isoStdPower = v;
      else if (k.startsWith("wrc_weight_")) {
        const stat = k.replace("wrc_weight_", "") as "obp" | "slg" | "avg" | "iso";
        transferConfig.wrcWeights[stat] = v;
      }
    }

    // ─── BULK MODE ───
    if (action === "bulk_recalculate") {
      // Fetch all active returner + transfer predictions
      const { data: preds, error: fetchErr } = await supabase
        .from("player_predictions")
        .select("*")
        .in("model_type", ["returner", "transfer"])
        .eq("status", "active");

      if (fetchErr) throw new Error(`Fetch failed: ${fetchErr.message}`);
      if (!preds || preds.length === 0) {
        return new Response(JSON.stringify({ success: true, updated: 0, message: "No active predictions found" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      let updated = 0;
      let errors = 0;
      let updatedReturner = 0;
      let updatedTransfer = 0;
      const BATCH = 50;

      for (let i = 0; i < preds.length; i += BATCH) {
        const batch = preds.slice(i, i + BATCH);
        await Promise.all(batch.map(async (pred) => {
          try {
            const result = pred.model_type === "transfer" ? recalcTransfer(pred, transferConfig) : recalc(pred, config);
            // Unlock → update → re-lock
            await supabase.from("player_predictions").update({ locked: false }).eq("id", pred.id);
            const { error } = await supabase.from("player_predictions").update({
              ...result, locked: true,
            }).eq("id", pred.id);
            if (error) { errors++; console.error(`Update ${pred.id}:`, error); }
            else {
              updated++;
              if (pred.model_type === "transfer") updatedTransfer++;
              else updatedReturner++;
            }
          } catch (e) { errors++; console.error(`Pred ${pred.id}:`, e); }
        }));
      }

      return new Response(JSON.stringify({ success: true, updated, updated_returner: updatedReturner, updated_transfer: updatedTransfer, errors, total: preds.length }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ─── SINGLE MODE ───
    if (!prediction_id) {
      return new Response(JSON.stringify({ error: "prediction_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: pred, error: predErr } = await supabase
      .from("player_predictions").select("*").eq("id", prediction_id).single();
    if (predErr || !pred) {
      return new Response(JSON.stringify({ error: "Prediction not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const result = pred.model_type === "transfer"
      ? recalcTransfer(pred, transferConfig)
      : recalc(pred, config, { dev_aggressiveness, class_transition });

    const { error: updateErr } = await supabase
      .from("player_predictions").update(result).eq("id", prediction_id);

    if (updateErr) {
      return new Response(JSON.stringify({ error: "Failed to update prediction" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: true, prediction: result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("recalculate-prediction error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
