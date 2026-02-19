import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_"));
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(",").map((v) => v.trim());
    if (vals.length < 2) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = vals[idx] || ""; });
    rows.push(row);
  }
  return rows;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { csv_content } = await req.json();
    if (!csv_content) {
      return new Response(JSON.stringify({ error: "csv_content is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rows = parseCsv(csv_content);
    if (rows.length === 0) {
      return new Response(JSON.stringify({ error: "No data rows found in CSV" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Detect column names - flexible matching
    const sample = rows[0];
    const keys = Object.keys(sample);
    const findCol = (patterns: string[]) => keys.find((k) => patterns.some((p) => k.includes(p)));

    let firstNameCol = findCol(["first_name", "firstname", "playerfirstname"]);
    let lastNameCol = findCol(["last_name", "lastname", "playerlastname"]);
    let fullNameCol = findCol(["full_name", "fullname", "name", "player", "formattedname"]);

    // If no name columns found, check if the first column (possibly blank header) contains names
    if (!firstNameCol && !fullNameCol) {
      const firstKey = keys[0];
      // Check if first column values look like names (e.g., "John Smith")
      let looksLikeNames = 0;
      for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const val = (rows[i][firstKey] || "").trim();
        if (/^[A-Z][a-z]+ [A-Z]/.test(val)) looksLikeNames++;
      }
      if (looksLikeNames >= 2) {
        fullNameCol = firstKey;
      }
    }

    if (!firstNameCol && !fullNameCol) {
      return new Response(JSON.stringify({ error: `Could not find name columns. Headers found: ${keys.join(", ")}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const avgCol = findCol(["avg_power", "avg_pr", "avg_rating"]);
    const obpCol = findCol(["obp_power", "obp_pr", "obp_rating"]);
    const slgCol = findCol(["slg_power", "slg_pr", "slg_rating"]);

    if (!avgCol && !obpCol && !slgCol) {
      return new Response(JSON.stringify({ error: `Could not find any power rating columns. Headers found: ${keys.join(", ")}. Expected columns containing: avg_power, obp_power, slg_power (or avg_pr, obp_pr, slg_pr)` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all players for name matching
    const { data: players } = await supabase.from("players").select("id, first_name, last_name");
    if (!players) throw new Error("Failed to fetch players");

    const playerMap = new Map<string, string>();
    for (const p of players) {
      const key = `${p.first_name.toLowerCase().trim()}|${p.last_name.toLowerCase().trim()}`;
      playerMap.set(key, p.id);
    }

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const row of rows) {
      let firstName = "", lastName = "";

      if (firstNameCol && lastNameCol) {
        firstName = row[firstNameCol]?.trim() || "";
        lastName = row[lastNameCol]?.trim() || "";
      } else if (fullNameCol !== undefined) {
        const parts = (row[fullNameCol] || "").trim().split(/\s+/);
        firstName = parts[0] || "";
        lastName = parts.slice(1).join(" ") || "";
      }

      if (!firstName || !lastName) { skipped++; continue; }
      if (["average", "total", "team", "player", "max", "min", "ncaa", "mean", "median"].includes(firstName.toLowerCase())) { skipped++; continue; }

      const key = `${firstName.toLowerCase()}|${lastName.toLowerCase()}`;
      const playerId = playerMap.get(key);
      if (!playerId) { skipped++; continue; }

      // Find active prediction for this player
      const { data: preds } = await supabase
        .from("player_predictions")
        .select("id")
        .eq("player_id", playerId)
        .eq("status", "active")
        .eq("variant", "regular")
        .limit(1);

      if (!preds || preds.length === 0) { skipped++; continue; }
      const predictionId = preds[0].id;

      const upsertData: Record<string, any> = { prediction_id: predictionId };
      if (avgCol && row[avgCol]) upsertData.avg_power_rating = parseFloat(row[avgCol]);
      if (obpCol && row[obpCol]) upsertData.obp_power_rating = parseFloat(row[obpCol]);
      if (slgCol && row[slgCol]) upsertData.slg_power_rating = parseFloat(row[slgCol]);

      const { error } = await supabase
        .from("player_prediction_internals")
        .upsert(upsertData, { onConflict: "prediction_id" });

      if (error) {
        errors.push(`${firstName} ${lastName}: ${error.message}`);
      } else {
        imported++;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      imported,
      skipped,
      total: rows.length,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("import-internal-ratings error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
