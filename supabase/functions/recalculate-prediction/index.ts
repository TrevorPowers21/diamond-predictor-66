import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Default developmental class weights (used when developmental_weights table is empty)
const DEFAULT_CLASS_WEIGHTS: Record<string, number> = {
  FS: 1.06, // FR → SO: biggest developmental jump
  SJ: 1.04, // SO → JR: moderate growth
  JS: 1.02, // JR → SR: marginal gains
  GR: 1.01, // Graduate: minimal change
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

    // 1. Fetch the prediction + player info
    const { data: pred, error: predErr } = await supabase
      .from("player_predictions")
      .select("*, players!inner(id, team, conference, position, class_year)")
      .eq("id", prediction_id)
      .single();

    if (predErr || !pred) {
      return new Response(
        JSON.stringify({ error: "Prediction not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const player = pred.players as any;
    const classTransition = pred.class_transition || "SJ";

    // 2. Fetch model config
    const { data: configRows } = await supabase
      .from("model_config")
      .select("config_key, config_value")
      .eq("model_type", "returner")
      .eq("season", pred.season);

    const config: Record<string, number> = {};
    for (const row of configRows || []) {
      config[row.config_key] = Number(row.config_value);
    }

    const ncaaAvg = config.ncaa_avg ?? 0.28;
    const ncaaObp = config.ncaa_obp ?? 0.385;
    const ncaaSlg = config.ncaa_slg ?? 0.442;
    const conferenceWeight = config.conference_weight ?? 0.7;
    const parkWeightAvgObp = config.park_weight_avg_obp ?? 0.2;
    const parkWeightSlg = config.park_weight_slg ?? 0.4;
    const powerRatingWeight = config.power_rating_weight ?? 0.5;
    const ncaaPowerRating = config.ncaa_power_rating ?? 100;

    // 3. Fetch developmental weight from table (override defaults if populated)
    let classWeight = DEFAULT_CLASS_WEIGHTS[classTransition] ?? 1.03;

    const { data: devWeights } = await supabase
      .from("developmental_weights")
      .select("weight")
      .eq("from_class", classTransition.substring(0, 2) === "FS" ? "FR" :
           classTransition.substring(0, 2) === "SJ" ? "SO" :
           classTransition.substring(0, 2) === "JS" ? "JR" : "Graduate")
      .eq("to_class", classTransition.substring(1, 2) === "S" && classTransition === "FS" ? "SO" :
           classTransition === "SJ" ? "JR" :
           classTransition === "JS" ? "SR" : "Graduate")
      .eq("stat_category", "overall")
      .limit(1);

    if (devWeights && devWeights.length > 0) {
      classWeight = Number(devWeights[0].weight);
    }

    // 4. Fetch park factor for player's team
    let parkFactor = 1.0;
    if (player.team) {
      const { data: parkData } = await supabase
        .from("park_factors")
        .select("overall_factor")
        .eq("team", player.team)
        .eq("season", pred.season)
        .limit(1);

      if (parkData && parkData.length > 0) {
        parkFactor = Number(parkData[0].overall_factor);
      }
    }

    // 5. Fetch power rating for player's conference
    let powerRating = ncaaPowerRating;
    if (player.conference) {
      const { data: prData } = await supabase
        .from("power_ratings")
        .select("rating")
        .eq("conference", player.conference)
        .eq("season", pred.season)
        .limit(1);

      if (prData && prData.length > 0) {
        powerRating = Number(prData[0].rating);
      }
    }

    // 6. Calculate predictions
    // Prior stats
    const fromAvg = Number(pred.from_avg) || ncaaAvg;
    const fromObp = Number(pred.from_obp) || ncaaObp;
    const fromSlg = Number(pred.from_slg) || ncaaSlg;

    // Dev aggressiveness scales the developmental adjustment
    // At 0.0: no developmental boost (class weight = 1.0)
    // At 0.5: half the developmental boost
    // At 1.0: full developmental boost
    const effectiveClassWeight = 1.0 + (classWeight - 1.0) * dev_aggressiveness;

    // Power rating adjustment (conference strength relative to NCAA average)
    const powerRatingPlus = Math.round((powerRating / ncaaPowerRating) * 100);
    const powerAdj = 1.0 + (powerRating / ncaaPowerRating - 1.0) * powerRatingWeight;

    // Park factor adjustment (inverse: high park factor means inflate stats less)
    const parkAdjAvgObp = 1.0 + (1.0 / parkFactor - 1.0) * parkWeightAvgObp;
    const parkAdjSlg = 1.0 + (1.0 / parkFactor - 1.0) * parkWeightSlg;

    // Conference adjustment
    const confAdj = 1.0 + (powerRating / ncaaPowerRating - 1.0) * conferenceWeight;

    // Projected stats
    const pAvg = clamp(fromAvg * effectiveClassWeight * parkAdjAvgObp * confAdj, 0.100, 0.450);
    const pObp = clamp(fromObp * effectiveClassWeight * parkAdjAvgObp * confAdj, 0.150, 0.600);
    const pSlg = clamp(fromSlg * effectiveClassWeight * parkAdjSlg * confAdj * powerAdj, 0.150, 0.900);
    const pOps = pObp + pSlg;
    const pIso = pSlg - pAvg;

    // wRC+ approximation: (pOPS / ncaaOPS) * 100, adjusted
    const ncaaOps = ncaaObp + ncaaSlg;
    const pWrcPlus = Math.round((pOps / ncaaOps) * 100);

    // wRC raw approximation
    const pWrc = pOps * 0.44; // simplified wRC scaling

    // 7. Update the prediction
    const { error: updateErr } = await supabase
      .from("player_predictions")
      .update({
        dev_aggressiveness,
        p_avg: round3(pAvg),
        p_obp: round3(pObp),
        p_slg: round3(pSlg),
        p_ops: round3(pOps),
        p_iso: round3(pIso),
        p_wrc: round3(pWrc),
        p_wrc_plus: pWrcPlus,
        power_rating_plus: powerRatingPlus,
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
          dev_aggressiveness,
          p_avg: round3(pAvg),
          p_obp: round3(pObp),
          p_slg: round3(pSlg),
          p_ops: round3(pOps),
          p_iso: round3(pIso),
          p_wrc: round3(pWrc),
          p_wrc_plus: pWrcPlus,
          power_rating_plus: powerRatingPlus,
          effective_class_weight: round3(effectiveClassWeight),
          park_factor: parkFactor,
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

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function round3(val: number): number {
  return Math.round(val * 1000) / 1000;
}
