import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Recalculation constants (mirrored from recalculate-prediction) ──
const CLASS_BASES: Record<string, { avg: number; obp: number; slg: number }> = {
  FS: { avg: 0.03, obp: 0.045, slg: 0.06 },
  SJ: { avg: 0.02, obp: 0.03, slg: 0.035 },
  JS: { avg: 0.015, obp: 0.02, slg: 0.02 },
  GR: { avg: 0.01, obp: 0.01, slg: 0.01 },
};
const DEV_COEFFS = { avg: 0.06, obp: 0.08, slg: 0.1 };
const DAMPENING_DIVISORS = { avg: 0.1, obp: 0.085, slg: 0.3 };

function round3(val: number): number {
  return Math.round(val * 1000) / 1000;
}

interface ModelConfig {
  ncaaAvg: number; ncaaObp: number; ncaaSlg: number;
  ncaaPR: number; powerWeight: number; ncaaWrc: number; defaultDevAgg: number;
}

function toRate(v: number): number {
  return Math.abs(v) > 1 ? v / 100 : v;
}

function normalizeClassTransition(raw?: string | null): string {
  const value = (raw || "").trim().toUpperCase();
  if (!value) return "SJ";
  if (["FS", "SJ", "JS", "GR"].includes(value)) return value;
  if (value.includes("FRESHMAN") || value.includes("FS")) return "FS";
  if (value.includes("SOPHOMORE") || value.includes("SJ")) return "SJ";
  if (value.includes("JUNIOR") || value.includes("JS")) return "JS";
  if (value.includes("GRAD") || value.includes("GR")) return "GR";
  return "SJ";
}

function recalcPrediction(pred: any, config: ModelConfig) {
  const ct = normalizeClassTransition(pred.class_transition || "SJ");
  const rawDevAgg = pred.dev_aggressiveness ?? config.defaultDevAgg;
  const devAgg = Number.isFinite(Number(rawDevAgg)) ? Number(rawDevAgg) : config.defaultDevAgg;
  const bases = CLASS_BASES[ct] || CLASS_BASES.GR;
  const fromAvg = Number(pred.from_avg) || 0;
  const fromObp = Number(pred.from_obp) || 0;
  const fromSlg = Number(pred.from_slg) || 0;
  const prPlus = Number(pred.power_rating_plus) || 100;

  function dampeningWithPR(stat: number, ncaaBase: number, divisor: number): number {
    const prFactor = prPlus >= config.ncaaPR ? 1 : 1.1 - prPlus / config.ncaaPR;
    return 1 - Math.min(0.75, Math.max(0, (stat - ncaaBase) / divisor) * prFactor);
  }
  function dampeningNoPR(stat: number, ncaaBase: number, divisor: number): number {
    return 1 - Math.min(0.75, Math.max(0, (stat - ncaaBase) / divisor));
  }
  function calcStat(fromStat: number, classBase: number, devCoeff: number, ncaaBase: number, divisor: number, usePR: boolean): number {
    const d = usePR ? dampeningWithPR(fromStat, ncaaBase, divisor) : dampeningNoPR(fromStat, ncaaBase, divisor);
    return fromStat * (1 + (classBase + devAgg * devCoeff) * d) * (1 + config.powerWeight * ((prPlus - 100) / 100) * d);
  }

  const pAvg = round3(calcStat(fromAvg, bases.avg, DEV_COEFFS.avg, config.ncaaAvg, DAMPENING_DIVISORS.avg, true));
  const pObp = round3(calcStat(fromObp, bases.obp, DEV_COEFFS.obp, config.ncaaObp, DAMPENING_DIVISORS.obp, false));
  const pSlg = round3(calcStat(fromSlg, bases.slg, DEV_COEFFS.slg, config.ncaaSlg, DAMPENING_DIVISORS.slg, true));
  const pOps = round3(pObp + pSlg);
  const pIso = round3(pSlg - pAvg);
  const pWrc = round3((0.45 * pObp) + (0.3 * pSlg) + (0.15 * pAvg) + (0.1 * pIso));
  const pWrcPlus = Math.round((pWrc / config.ncaaWrc) * 100);

  return { p_avg: pAvg, p_obp: pObp, p_slg: pSlg, p_ops: pOps, p_iso: pIso, p_wrc: pWrc, p_wrc_plus: pWrcPlus };
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function normalizeName(first: string, last: string): string {
  const f = first.trim().toLowerCase().replace(/[.''\-]/g, "").replace(/\s+/g, " ");
  const l = last.trim().toLowerCase().replace(/\s+(jr\.?|sr\.?|iii|ii|iv|v)$/i, "").replace(/[.''\-]/g, "").replace(/\s+/g, " ");
  return `${f}|${l}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceKey);

    const { csv_content, model_type = "returner" } = await req.json();
    if (!csv_content) {
      return new Response(JSON.stringify({ error: "csv_content is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Load model config for recalculation ──
    const { data: configRows } = await db
      .from("model_config")
      .select("config_key, config_value")
      .eq("model_type", "returner")
      .in("config_key", ["ncaa_avg", "ncaa_obp", "ncaa_slg", "ncaa_power_rating", "park_weight_slg", "power_rating_weight", "ncaa_wrc", "dev_aggressiveness_expected"]);

    const mConfig: ModelConfig = { ncaaAvg: 0.28, ncaaObp: 0.385, ncaaSlg: 0.442, ncaaPR: 100, powerWeight: 0.4, ncaaWrc: 0.364, defaultDevAgg: 0.5 };
    for (const row of configRows || []) {
      if (row.config_key === "ncaa_avg") mConfig.ncaaAvg = Number(row.config_value);
      if (row.config_key === "ncaa_obp") mConfig.ncaaObp = Number(row.config_value);
      if (row.config_key === "ncaa_slg") mConfig.ncaaSlg = Number(row.config_value);
      if (row.config_key === "ncaa_power_rating") mConfig.ncaaPR = Number(row.config_value);
      if (row.config_key === "power_rating_weight") mConfig.powerWeight = Number(row.config_value);
      if (row.config_key === "park_weight_slg") mConfig.powerWeight = Number(row.config_value);
      if (row.config_key === "ncaa_wrc") mConfig.ncaaWrc = Number(row.config_value);
      if (row.config_key === "dev_aggressiveness_expected") mConfig.defaultDevAgg = toRate(Number(row.config_value));
    }

    const lines = csv_content.split(/\r?\n/).filter((l: string) => l.trim());
    if (lines.length < 2) {
      return new Response(JSON.stringify({ error: "CSV needs header + data rows" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const headers = parseCsvLine(lines[0]).map((h: string) => h.toLowerCase().trim());
    const colMap: Record<string, number> = {};
    headers.forEach((h, i) => { colMap[h] = i; });

    // Detect name columns
    const firstNameIdx = colMap["playerfirstname"] ?? colMap["firstname"] ?? colMap["first_name"] ?? colMap["first name"] ?? -1;
    const lastNameIdx = colMap["player"] ?? colMap["lastname"] ?? colMap["last_name"] ?? colMap["last name"] ?? -1;
    let fullNameIdx = colMap["playerfullname"] ?? colMap["formattedname"] ?? colMap["full_name"] ?? colMap["name"] ?? colMap["team"] ?? -1;

    if (fullNameIdx === (colMap["team"] ?? -1) && fullNameIdx !== -1) {
      let looksLikeNames = 0;
      for (let i = 1; i < Math.min(lines.length, 10); i++) {
        const val = (parseCsvLine(lines[i])[fullNameIdx] || "").trim();
        if (/^[A-Z][a-z]+ [A-Z]/.test(val)) looksLikeNames++;
      }
      if (looksLikeNames < 2) fullNameIdx = -1;
    }

    if (firstNameIdx === -1 && fullNameIdx === -1) {
      return new Response(JSON.stringify({ error: "Cannot find name columns. Expected: first_name/last_name or name/full_name" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Detect power rating columns
    const prPlusIdx = colMap["power rating"] ?? colMap["power rating+"] ?? colMap["power_rating_plus"] ?? colMap["pr+"] ?? colMap["pr_plus"] ?? -1;
    const prScoreIdx = colMap["offensive power rating"] ?? colMap["power_rating_score"] ?? colMap["opr"] ?? colMap["opr_score"] ?? -1;

    if (prPlusIdx === -1 && prScoreIdx === -1) {
      return new Response(JSON.stringify({
        error: `No power rating columns found. Expected: "Power Rating" or "Power Rating+" for PR+, "Offensive Power Rating" or "power_rating_score" for score. Headers: ${headers.join(", ")}`
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Load all players
    let allPlayers: { id: string; first_name: string; last_name: string }[] = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data } = await db.from("players").select("id, first_name, last_name").range(from, from + PAGE - 1);
      allPlayers = allPlayers.concat(data || []);
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }

    const playerMap = new Map<string, string>();
    for (const p of allPlayers) {
      playerMap.set(normalizeName(p.first_name, p.last_name), p.id);
    }

    // Load active predictions for model_type (full rows for recalc)
    let allPreds: any[] = [];
    let predFrom = 0;
    while (true) {
      const { data } = await db
        .from("player_predictions")
        .select("*")
        .eq("model_type", model_type)
        .eq("status", "active")
        .eq("variant", "regular")
        .range(predFrom, predFrom + PAGE - 1);
      allPreds = allPreds.concat(data || []);
      if (!data || data.length < PAGE) break;
      predFrom += PAGE;
    }

    const predMap = new Map<string, any>();
    for (const p of allPreds) {
      predMap.set(p.player_id, p);
    }

    let imported = 0;
    let recalculated = 0;
    let skipped = 0;
    const errors: string[] = [];

    const BATCH = 50;
    const dataRows = lines.slice(1);

    for (let b = 0; b < dataRows.length; b += BATCH) {
      const batch = dataRows.slice(b, b + BATCH);
      await Promise.all(batch.map(async (line) => {
        const cols = parseCsvLine(line);
        let firstName = "", lastName = "";

        if (firstNameIdx !== -1 && lastNameIdx !== -1) {
          firstName = cols[firstNameIdx] || "";
          lastName = cols[lastNameIdx] || "";
        } else if (fullNameIdx !== -1) {
          const parts = (cols[fullNameIdx] || "").split(/\s+/);
          firstName = parts[0] || "";
          lastName = parts.slice(1).join(" ") || "";
        }

        if (!firstName || !lastName) { skipped++; return; }
        if (/^(Max|Min|NCAA|Average|Total|Mean|Median|Sum|Count|Grand)$/i.test(firstName.trim())) { skipped++; return; }
        if (/^\d{2,4}\s+(ACC|SEC|Big|Pac|AAC|Sun|Mountain|WCC|MWC)/i.test(`${firstName} ${lastName}`)) { skipped++; return; }

        const key = normalizeName(firstName, lastName);
        const playerId = playerMap.get(key);
        if (!playerId) { skipped++; return; }

        const pred = predMap.get(playerId);
        if (!pred) { skipped++; return; }

        const updates: Record<string, unknown> = {};
        if (prPlusIdx !== -1 && cols[prPlusIdx]) {
          const val = parseFloat(cols[prPlusIdx]);
          if (!isNaN(val)) updates.power_rating_plus = val;
        }
        if (prScoreIdx !== -1 && cols[prScoreIdx]) {
          const val = parseFloat(cols[prScoreIdx]);
          if (!isNaN(val)) updates.power_rating_score = val;
        }

        if (Object.keys(updates).length === 0) { skipped++; return; }

        // Merge updated PR into prediction for recalc
        const mergedPred = { ...pred, ...updates };
        const recalcResult = recalcPrediction(mergedPred, mConfig);

        // Unlock → update with PR + recalculated stats → re-lock
        await db.from("player_predictions").update({ locked: false }).eq("id", pred.id);
        const { error } = await db.from("player_predictions").update({
          ...updates,
          ...recalcResult,
          locked: true,
        }).eq("id", pred.id);

        if (error) {
          errors.push(`${firstName} ${lastName}: ${error.message}`);
        } else {
          imported++;
          recalculated++;
        }
      }));
    }

    return new Response(JSON.stringify({
      success: true, imported, recalculated, skipped, total: dataRows.length,
      errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("import-power-ratings-csv error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
