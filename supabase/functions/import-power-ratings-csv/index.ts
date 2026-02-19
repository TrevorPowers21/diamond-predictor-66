import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    // Only use "team" as full name if values look like player names
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

    // Load active predictions for model_type
    const { data: preds } = await db
      .from("player_predictions")
      .select("id, player_id")
      .eq("model_type", model_type)
      .eq("status", "active")
      .eq("variant", "regular");

    const predMap = new Map<string, string>();
    for (const p of preds || []) {
      predMap.set(p.player_id, p.id);
    }

    let imported = 0;
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
        // Skip aggregate rows
        if (/^(Max|Min|NCAA|Average|Total|Mean|Median|Sum|Count|Grand)$/i.test(firstName.trim())) { skipped++; return; }
        if (/^\d{2,4}\s+(ACC|SEC|Big|Pac|AAC|Sun|Mountain|WCC|MWC)/i.test(`${firstName} ${lastName}`)) { skipped++; return; }

        const key = normalizeName(firstName, lastName);
        const playerId = playerMap.get(key);
        if (!playerId) { skipped++; return; }

        const predId = predMap.get(playerId);
        if (!predId) { skipped++; return; }

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

        // Unlock → update → re-lock pattern for locked predictions
        await db.from("player_predictions").update({ locked: false }).eq("id", predId);
        const { error } = await db.from("player_predictions").update({ ...updates, locked: true }).eq("id", predId);

        if (error) {
          errors.push(`${firstName} ${lastName}: ${error.message}`);
        } else {
          imported++;
        }
      }));
    }

    return new Response(JSON.stringify({
      success: true, imported, skipped, total: dataRows.length,
      errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("import-power-ratings-csv error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
