import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CLASS_BASES: Record<string, { avg: number; obp: number; slg: number }> = {
  FS: { avg: 0.03, obp: 0.045, slg: 0.06 },
  SJ: { avg: 0.02, obp: 0.03, slg: 0.035 },
  JS: { avg: 0.015, obp: 0.02, slg: 0.02 },
  GR: { avg: 0.01, obp: 0.01, slg: 0.01 },
};

const DEV_COEFFS = { avg: 0.06, obp: 0.08, slg: 0.1 };
const DAMPENING_DIVISORS = { avg: 0.1, obp: 0.16, slg: 0.3 };

function round3(val: number): number {
  return Math.round(val * 1000) / 1000;
}

interface Config {
  ncaaAvg: number;
  ncaaObp: number;
  ncaaSlg: number;
  ncaaPR: number;
  powerWeight: number;
  ncaaWrc: number;
}

function recalc(pred: any, config: Config, overrides?: { dev_aggressiveness?: number; class_transition?: string }) {
  const ct = overrides?.class_transition || pred.class_transition || "SJ";
  const devAgg = overrides?.dev_aggressiveness ?? pred.dev_aggressiveness ?? 0;
  const bases = CLASS_BASES[ct] || CLASS_BASES.GR;
  const fromAvg = Number(pred.from_avg) || 0;
  const fromObp = Number(pred.from_obp) || 0;
  const fromSlg = Number(pred.from_slg) || 0;
  const prPlus = Number(pred.power_rating_plus) || 100;

  function dampening(stat: number, ncaaBase: number, divisor: number): number {
    const prFactor = prPlus >= config.ncaaPR ? 1 : 1.1 - prPlus / config.ncaaPR;
    const raw = Math.max(0, (stat - ncaaBase) / divisor) * prFactor;
    return 1 - Math.min(0.75, raw);
  }

  function calcStat(fromStat: number, classBase: number, devCoeff: number, ncaaBase: number, divisor: number): number {
    const d = dampening(fromStat, ncaaBase, divisor);
    const growthAdj = 1 + (classBase + devAgg * devCoeff) * d;
    const powerAdj = 1 + config.powerWeight * ((prPlus - 100) / 100) * d;
    return fromStat * growthAdj * powerAdj;
  }

  const pAvg = round3(calcStat(fromAvg, bases.avg, DEV_COEFFS.avg, config.ncaaAvg, DAMPENING_DIVISORS.avg));
  const pObp = round3(calcStat(fromObp, bases.obp, DEV_COEFFS.obp, config.ncaaObp, DAMPENING_DIVISORS.obp));
  const pSlg = round3(calcStat(fromSlg, bases.slg, DEV_COEFFS.slg, config.ncaaSlg, DAMPENING_DIVISORS.slg));
  const pOps = round3(pObp + pSlg);
  const pIso = round3(pSlg - pAvg);
  const pWrc = round3((0.45 * pObp) + (0.3 * pSlg) + (0.15 * pAvg) + (0.1 * pIso));
  const pWrcPlus = Math.round((pWrc / config.ncaaWrc) * 100);

  return { p_avg: pAvg, p_obp: pObp, p_slg: pSlg, p_ops: pOps, p_iso: pIso, p_wrc: pWrc, p_wrc_plus: pWrcPlus, class_transition: ct, dev_aggressiveness: devAgg };
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

    // Fetch config
    const { data: configRows } = await supabase
      .from("model_config")
      .select("config_key, config_value")
      .eq("model_type", "returner")
      .in("config_key", ["ncaa_avg", "ncaa_obp", "ncaa_slg", "ncaa_power_rating", "park_weight_slg", "ncaa_wrc"]);

    const config: Config = { ncaaAvg: 0.28, ncaaObp: 0.385, ncaaSlg: 0.442, ncaaPR: 100, powerWeight: 0.4, ncaaWrc: 0.364 };
    for (const row of configRows || []) {
      if (row.config_key === "ncaa_avg") config.ncaaAvg = Number(row.config_value);
      if (row.config_key === "ncaa_obp") config.ncaaObp = Number(row.config_value);
      if (row.config_key === "ncaa_slg") config.ncaaSlg = Number(row.config_value);
      if (row.config_key === "ncaa_power_rating") config.ncaaPR = Number(row.config_value);
      if (row.config_key === "park_weight_slg") config.powerWeight = Number(row.config_value);
      if (row.config_key === "ncaa_wrc") config.ncaaWrc = Number(row.config_value);
    }

    // ─── BULK MODE ───
    if (action === "bulk_recalculate") {
      // Fetch all active returner predictions
      const { data: preds, error: fetchErr } = await supabase
        .from("player_predictions")
        .select("*")
        .eq("model_type", "returner")
        .eq("status", "active");

      if (fetchErr) throw new Error(`Fetch failed: ${fetchErr.message}`);
      if (!preds || preds.length === 0) {
        return new Response(JSON.stringify({ success: true, updated: 0, message: "No active returner predictions found" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      let updated = 0;
      let errors = 0;
      const BATCH = 50;

      for (let i = 0; i < preds.length; i += BATCH) {
        const batch = preds.slice(i, i + BATCH);
        await Promise.all(batch.map(async (pred) => {
          try {
            const result = recalc(pred, config);
            // Unlock → update → re-lock
            await supabase.from("player_predictions").update({ locked: false }).eq("id", pred.id);
            const { error } = await supabase.from("player_predictions").update({
              ...result, locked: true,
            }).eq("id", pred.id);
            if (error) { errors++; console.error(`Update ${pred.id}:`, error); }
            else updated++;
          } catch (e) { errors++; console.error(`Pred ${pred.id}:`, e); }
        }));
      }

      return new Response(JSON.stringify({ success: true, updated, errors, total: preds.length }),
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

    const result = recalc(pred, config, { dev_aggressiveness, class_transition });

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
