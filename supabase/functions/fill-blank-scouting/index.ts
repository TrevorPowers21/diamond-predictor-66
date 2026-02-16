import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "").trim();
}

interface CsvPlayer {
  firstName: string;
  lastName: string;
  variant: "regular" | "xstats";
  ev_score: number | null;
  barrel_score: number | null;
  whiff_score: number | null;
  chase_score: number | null;
  power_rating_score: number | null;
  power_rating_plus: number | null;
}

function parseCsv(text: string): CsvPlayer[] {
  const lines = text.split("\n");
  const players: CsvPlayer[] = [];
  const skipPrefixes = ["25 ", "Max", "Min", "Team", ""];

  for (const line of lines) {
    const cols = line.split(",").map(c => c.trim());
    const rawName = cols[0];
    if (!rawName) continue;
    if (skipPrefixes.some(p => p && rawName.startsWith(p))) continue;
    if (rawName.includes("Avg.") || rawName === "Team") continue;

    const evScore = parseFloat(cols[5]);
    const barrelScore = parseFloat(cols[6]);
    if (isNaN(evScore) && isNaN(barrelScore)) continue;

    const whiffScore = parseFloat(cols[7]);
    const chaseScore = parseFloat(cols[8]);
    const opr = parseFloat(cols[9]);
    const powerRating = parseFloat(cols[10]);

    const isXstats = rawName.toLowerCase().endsWith(" xstats");
    const cleanName = isXstats ? rawName.replace(/\s*xstats$/i, "") : rawName;
    const nameParts = cleanName.trim().split(/\s+/);
    if (nameParts.length < 2) continue;

    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(" ");

    players.push({
      firstName,
      lastName,
      variant: isXstats ? "xstats" : "regular",
      ev_score: isNaN(evScore) ? null : evScore,
      barrel_score: isNaN(barrelScore) ? null : barrelScore,
      whiff_score: isNaN(whiffScore) ? null : whiffScore,
      chase_score: isNaN(chaseScore) ? null : chaseScore,
      power_rating_score: isNaN(opr) ? null : opr,
      power_rating_plus: isNaN(powerRating) ? null : powerRating,
    });
  }
  return players;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json();
    const { storagePath, dryRun = true } = body;

    if (!storagePath) {
      return new Response(JSON.stringify({ error: "storagePath required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Download CSV from storage
    const { data: fileData, error: dlErr } = await supabase.storage
      .from("imports")
      .download(storagePath);

    if (dlErr || !fileData) {
      return new Response(JSON.stringify({ error: `Failed to download: ${dlErr?.message}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const csvText = await fileData.text();
    const csvPlayers = parseCsv(csvText);

    // Build lookup: "normalizedFirst|normalizedLast|variant" → scouting data
    const csvLookup = new Map<string, CsvPlayer>();
    for (const p of csvPlayers) {
      const key = `${normalizeName(p.firstName)}|${normalizeName(p.lastName)}|${p.variant}`;
      csvLookup.set(key, p);
    }

    // Get all active predictions - fetch in batches to avoid 1000-row limit
    let allPredictions: any[] = [];
    let offset = 0;
    const batchSize = 1000;
    while (true) {
      const { data: batch, error: batchErr } = await supabase
        .from("player_predictions")
        .select(`
          id, player_id, variant, model_type, status, locked,
          ev_score, barrel_score, whiff_score, chase_score,
          power_rating_score, power_rating_plus,
          players!inner(id, first_name, last_name)
        `)
        .eq("status", "active")
        .range(offset, offset + batchSize - 1);

      if (batchErr) throw batchErr;
      if (!batch || batch.length === 0) break;
      allPredictions = allPredictions.concat(batch);
      if (batch.length < batchSize) break;
      offset += batchSize;
    }

    // Find predictions that are blank and have a CSV match
    const updates: Array<{
      predId: string;
      name: string;
      variant: string;
      modelType: string;
      fields: Record<string, number | null>;
    }> = [];
    const toUnlock: string[] = [];

    for (const pred of allPredictions) {
      const p = pred as any;
      const player = p.players;

      // Check if scouting fields are all blank
      const hasScoutingData = p.ev_score != null || p.barrel_score != null ||
        p.whiff_score != null || p.chase_score != null ||
        p.power_rating_score != null || p.power_rating_plus != null;

      if (hasScoutingData) continue;

      const key = `${normalizeName(player.first_name)}|${normalizeName(player.last_name)}|${p.variant}`;
      const csvMatch = csvLookup.get(key);
      if (!csvMatch) continue;

      const fields: Record<string, number | null> = {};
      if (csvMatch.ev_score != null) fields.ev_score = csvMatch.ev_score;
      if (csvMatch.barrel_score != null) fields.barrel_score = csvMatch.barrel_score;
      if (csvMatch.whiff_score != null) fields.whiff_score = csvMatch.whiff_score;
      if (csvMatch.chase_score != null) fields.chase_score = csvMatch.chase_score;
      if (csvMatch.power_rating_score != null) fields.power_rating_score = csvMatch.power_rating_score;
      if (csvMatch.power_rating_plus != null) fields.power_rating_plus = csvMatch.power_rating_plus;

      if (Object.keys(fields).length === 0) continue;

      updates.push({
        predId: p.id,
        name: `${player.first_name} ${player.last_name}`,
        variant: p.variant,
        modelType: p.model_type,
        fields,
      });

      if (p.locked) {
        toUnlock.push(p.id);
      }
    }

    if (dryRun) {
      return new Response(JSON.stringify({
        mode: "dry_run",
        csvPlayersParsed: csvPlayers.length,
        predictionsChecked: allPredictions.length,
        blankMatchesFound: updates.length,
        toUnlock: toUnlock.length,
        updates: updates.map(u => ({
          name: u.name,
          variant: u.variant,
          modelType: u.modelType,
          fields: u.fields,
        })),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Execute updates
    const results: string[] = [];
    const errors: string[] = [];
    const unlockedCount = toUnlock.length;

    // First unlock those that need filling
    if (toUnlock.length > 0) {
      const { error: unlockErr } = await supabase
        .from("player_predictions")
        .update({ locked: false })
        .in("id", toUnlock);
      if (unlockErr) {
        console.error("Unlock error:", unlockErr);
        errors.push(`Failed to unlock batch: ${unlockErr.message}`);
      }
    }

    for (const u of updates) {
      try {
        const { error } = await supabase
          .from("player_predictions")
          .update(u.fields)
          .eq("id", u.predId);

        if (error) throw error;
        results.push(`${u.name} (${u.variant}/${u.modelType}): filled ${Object.keys(u.fields).join(", ")}`);
      } catch (err) {
        errors.push(`${u.name}: ${(err as Error).message}`);
      }
    }

    return new Response(JSON.stringify({
      mode: "execute",
      filled: results.length,
      unlocked: unlockedCount,
      results,
      errors,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
