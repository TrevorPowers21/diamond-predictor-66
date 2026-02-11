import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Class transition base growth rates (from the Google Sheet IFS).
 */
const CLASS_BASES: Record<string, { avg: number; obp: number; slg: number }> = {
  FS: { avg: 0.02, obp: 0.03, slg: 0.04 },
  SJ: { avg: 0.01, obp: 0.02, slg: 0.02 },
  JS: { avg: 0.00, obp: 0.00, slg: 0.00 },
  GR: { avg: 0.00, obp: 0.00, slg: 0.00 },
};

/**
 * Dev aggressiveness coefficients per stat (multiplied by dev_agg value).
 */
const DEV_COEFFS = { avg: 0.02, obp: 0.03, slg: 0.04 };

/**
 * Dampening divisors per stat — controls how quickly growth tapers
 * as the player's current stat exceeds the NCAA baseline.
 */
const DAMPENING_DIVISORS = { avg: 0.08, obp: 0.12, slg: 0.25 };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { prediction_id, dev_aggressiveness, class_transition } = await req.json();

    if (!prediction_id) {
      return new Response(
        JSON.stringify({ error: "prediction_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (dev_aggressiveness !== undefined && ![0, 0.5, 1].includes(dev_aggressiveness)) {
      return new Response(
        JSON.stringify({ error: "dev_aggressiveness must be 0.0, 0.5, or 1.0" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (class_transition !== undefined && !["FS", "SJ", "JS", "GR"].includes(class_transition)) {
      return new Response(
        JSON.stringify({ error: "class_transition must be FS, SJ, JS, or GR" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch the current prediction
    const { data: pred, error: predErr } = await supabase
      .from("player_predictions")
      .select("*")
      .eq("id", prediction_id)
      .single();

    if (predErr || !pred) {
      return new Response(
        JSON.stringify({ error: "Prediction not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch NCAA config values
    const { data: configRows } = await supabase
      .from("model_config")
      .select("config_key, config_value")
      .eq("model_type", "returner")
      .eq("season", pred.season)
      .in("config_key", ["ncaa_avg", "ncaa_obp", "ncaa_slg", "ncaa_power_rating", "park_weight_slg"]);

    let ncaaAvg = 0.28;
    let ncaaObp = 0.385;
    let ncaaSlg = 0.442;
    let ncaaPR = 100;
    let powerWeight = 0.4;
    for (const row of configRows || []) {
      if (row.config_key === "ncaa_avg") ncaaAvg = Number(row.config_value);
      if (row.config_key === "ncaa_obp") ncaaObp = Number(row.config_value);
      if (row.config_key === "ncaa_slg") ncaaSlg = Number(row.config_value);
      if (row.config_key === "ncaa_power_rating") ncaaPR = Number(row.config_value);
      if (row.config_key === "park_weight_slg") powerWeight = Number(row.config_value);
    }

    const ct = class_transition || pred.class_transition || "SJ";
    const devAgg = dev_aggressiveness ?? pred.dev_aggressiveness ?? 0;
    const bases = CLASS_BASES[ct] || CLASS_BASES.GR;
    const fromAvg = Number(pred.from_avg) || 0;
    const fromObp = Number(pred.from_obp) || 0;
    const fromSlg = Number(pred.from_slg) || 0;
    const prPlus = Number(pred.power_rating_plus) || 100;

    // Dampening factor: reduces growth for players already above NCAA baseline
    // Formula: 1 - MIN(0.65, MAX(0, (stat - ncaa_baseline) / divisor) * IF(PR+ >= ncaaPR, 1, 1.1 - PR+/ncaaPR))
    function dampening(stat: number, ncaaBase: number, divisor: number): number {
      const prFactor = prPlus >= ncaaPR ? 1 : 1.1 - prPlus / ncaaPR;
      const raw = Math.max(0, (stat - ncaaBase) / divisor) * prFactor;
      return 1 - Math.min(0.65, raw);
    }

    // Full formula: stat * (1 + (class_base + devAgg * dev_coeff) * dampening) * (1 + powerWeight * ((PR+ - 100)/100) * dampening)
    function calcStat(
      fromStat: number,
      classBase: number,
      devCoeff: number,
      ncaaBase: number,
      divisor: number
    ): number {
      const d = dampening(fromStat, ncaaBase, divisor);
      const growthAdj = 1 + (classBase + devAgg * devCoeff) * d;
      const powerAdj = 1 + powerWeight * ((prPlus - 100) / 100) * d;
      return fromStat * growthAdj * powerAdj;
    }

    const pAvg = round3(calcStat(fromAvg, bases.avg, DEV_COEFFS.avg, ncaaAvg, DAMPENING_DIVISORS.avg));
    const pObp = round3(calcStat(fromObp, bases.obp, DEV_COEFFS.obp, ncaaObp, DAMPENING_DIVISORS.obp));
    const pSlg = round3(calcStat(fromSlg, bases.slg, DEV_COEFFS.slg, ncaaSlg, DAMPENING_DIVISORS.slg));
    const pOps = round3(pObp + pSlg);
    const pIso = round3(pSlg - pAvg);

    // wRC+ (OPS-based approximation)
    const ncaaOps = ncaaObp + ncaaSlg;
    const pWrcPlus = Math.round((pOps / ncaaOps) * 100);
    const pWrc = round3(pOps * 0.44);

    // Update the prediction
    const { error: updateErr } = await supabase
      .from("player_predictions")
      .update({
        class_transition: ct,
        dev_aggressiveness: devAgg,
        p_avg: pAvg,
        p_obp: pObp,
        p_slg: pSlg,
        p_ops: pOps,
        p_iso: pIso,
        p_wrc: pWrc,
        p_wrc_plus: pWrcPlus,
      })
      .eq("id", prediction_id);

    if (updateErr) {
      console.error("Update error:", updateErr);
      return new Response(
        JSON.stringify({ error: "Failed to update prediction" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        prediction: {
          dev_aggressiveness: devAgg,
          p_avg: pAvg,
          p_obp: pObp,
          p_slg: pSlg,
          p_ops: pOps,
          p_iso: pIso,
          p_wrc: pWrc,
          p_wrc_plus: pWrcPlus,
          class_transition: ct,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("recalculate-prediction error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function round3(val: number): number {
  return Math.round(val * 1000) / 1000;
}
