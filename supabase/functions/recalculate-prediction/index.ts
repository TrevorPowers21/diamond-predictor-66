import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Class transition growth ranges from the Google Sheet equation.
 * Dev aggressiveness (0.0 / 0.5 / 1.0) interpolates within the range:
 *   0.0 = no additional developmental boost (predictions stay stable)
 *   0.5 = expected growth (midpoint of the range delta)
 *   1.0 = aggressive growth (full range delta applied)
 *
 * The "range" is the difference between the high and low multipliers.
 * At dev_agg=0, predictions are unchanged. At dev_agg=X, each stat
 * gets multiplied by (1 + range * X).
 */
const CLASS_GROWTH_RANGES: Record<string, { avg: number; obp: number; slg: number }> = {
  // FR → SO: AVG ×(1.02–1.04), OBP ×(1.03–1.06), SLG ×(1.04–1.08)
  FS: { avg: 0.02, obp: 0.03, slg: 0.04 },
  // SO → JR: AVG ×(1.01–1.03), OBP ×(1.02–1.04), SLG ×(1.02–1.05)
  SJ: { avg: 0.02, obp: 0.02, slg: 0.03 },
  // JR → SR: AVG ×(1.00–1.02), OBP ×(1.00–1.03), SLG ×(1.00–1.03)
  JS: { avg: 0.02, obp: 0.03, slg: 0.03 },
  // Graduate: no growth expected
  GR: { avg: 0, obp: 0, slg: 0 },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { prediction_id, dev_aggressiveness } = await req.json();

    if (!prediction_id) {
      return new Response(
        JSON.stringify({ error: "prediction_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (![0, 0.5, 1].includes(dev_aggressiveness)) {
      return new Response(
        JSON.stringify({ error: "dev_aggressiveness must be 0.0, 0.5, or 1.0" }),
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

    const classTransition = pred.class_transition || "SJ";
    const oldDevAgg = Number(pred.dev_aggressiveness) || 0;
    const newDevAgg = dev_aggressiveness;
    const ranges = CLASS_GROWTH_RANGES[classTransition] || CLASS_GROWTH_RANGES.GR;

    // Compute the base predictions (what stats are at dev_agg=0)
    // by reversing the old dev_agg adjustment
    const oldAvgFactor = 1 + ranges.avg * oldDevAgg;
    const oldObpFactor = 1 + ranges.obp * oldDevAgg;
    const oldSlgFactor = 1 + ranges.slg * oldDevAgg;

    const baseAvg = Number(pred.p_avg) / oldAvgFactor;
    const baseObp = Number(pred.p_obp) / oldObpFactor;
    const baseSlg = Number(pred.p_slg) / oldSlgFactor;

    // Apply the new dev_agg adjustment
    const newAvgFactor = 1 + ranges.avg * newDevAgg;
    const newObpFactor = 1 + ranges.obp * newDevAgg;
    const newSlgFactor = 1 + ranges.slg * newDevAgg;

    const pAvg = round3(baseAvg * newAvgFactor);
    const pObp = round3(baseObp * newObpFactor);
    const pSlg = round3(baseSlg * newSlgFactor);
    const pOps = round3(pObp + pSlg);
    const pIso = round3(pSlg - pAvg);

    // Recalculate wRC+ (OPS-based approximation, same as sheet)
    // Fetch NCAA averages from model_config
    const { data: configRows } = await supabase
      .from("model_config")
      .select("config_key, config_value")
      .eq("model_type", "returner")
      .eq("season", pred.season)
      .in("config_key", ["ncaa_obp", "ncaa_slg"]);

    let ncaaObp = 0.385;
    let ncaaSlg = 0.442;
    for (const row of configRows || []) {
      if (row.config_key === "ncaa_obp") ncaaObp = Number(row.config_value);
      if (row.config_key === "ncaa_slg") ncaaSlg = Number(row.config_value);
    }

    const ncaaOps = ncaaObp + ncaaSlg;
    const pWrcPlus = Math.round((pOps / ncaaOps) * 100);
    const pWrc = round3(pOps * 0.44);

    // Update the prediction
    const { error: updateErr } = await supabase
      .from("player_predictions")
      .update({
        dev_aggressiveness: newDevAgg,
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
          dev_aggressiveness: newDevAgg,
          p_avg: pAvg,
          p_obp: pObp,
          p_slg: pSlg,
          p_ops: pOps,
          p_iso: pIso,
          p_wrc: pWrc,
          p_wrc_plus: pWrcPlus,
          class_transition: classTransition,
          growth_ranges: ranges,
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
