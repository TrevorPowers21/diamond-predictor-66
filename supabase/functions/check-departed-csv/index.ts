import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const reqUrl = new URL(req.url);
    const fix = reqUrl.searchParams.get("fix") === "true";

    // Download CSV from storage
    const { data: fileData, error: fileError } = await supabase.storage
      .from("imports")
      .download("temp/Rate_3.csv");
    
    if (fileError) throw new Error(`Failed to download CSV: ${fileError.message}`);
    
    const csvText = await fileData.text();
    const lines = csvText.split("\n").filter(l => l.trim());
    
    console.log(`CSV has ${lines.length} lines`);

    // Parse player names from CSV (col 4 = last name, col 5 = first name)
    const csvPlayers: Array<{first_name: string, last_name: string}> = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      if (cols.length < 6) continue;
      const lastName = cols[4]?.trim();
      const firstName = cols[5]?.trim();
      if (lastName && firstName && lastName !== 'Average' && lastName !== 'Total') {
        csvPlayers.push({ first_name: firstName.toLowerCase(), last_name: lastName.toLowerCase() });
      }
    }

    console.log(`Parsed ${csvPlayers.length} players from CSV`);

    // Load into temp_csv_players table
    // Clear first
    await supabase.from("temp_csv_players").delete().neq("first_name", "___impossible___");

    // Insert in batches of 500
    for (let i = 0; i < csvPlayers.length; i += 500) {
      const batch = csvPlayers.slice(i, i + 500);
      const { error } = await supabase.from("temp_csv_players").insert(batch);
      if (error) throw new Error(`Insert batch error: ${error.message}`);
    }

    console.log(`Loaded ${csvPlayers.length} players into temp_csv_players`);

    // Get ALL departed returner predictions (paginate past 1000 limit)
    let allDeparted: any[] = [];
    let offset = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await supabase
        .from("player_predictions")
        .select("id, player_id, variant, players!inner(first_name, last_name, team)")
        .eq("status", "departed")
        .eq("model_type", "returner")
        .range(offset, offset + pageSize - 1);
      
      if (error) throw error;
      if (!data || data.length === 0) break;
      allDeparted = allDeparted.concat(data);
      if (data.length < pageSize) break;
      offset += pageSize;
    }

    console.log(`Found ${allDeparted.length} total departed returner predictions`);

    // Find matches using the CSV set
    const csvSet = new Set(csvPlayers.map(p => `${p.first_name}|${p.last_name}`));
    const matches: any[] = [];
    for (const pred of allDeparted) {
      const p = (pred as any).players;
      const key = `${p.first_name.toLowerCase()}|${p.last_name.toLowerCase()}`;
      if (csvSet.has(key)) {
        matches.push({
          pred_id: pred.id,
          player_id: pred.player_id,
          variant: pred.variant,
          first_name: p.first_name,
          last_name: p.last_name,
          team: p.team,
        });
      }
    }

    console.log(`Found ${matches.length} departed players that appear in CSV`);

    if (fix && matches.length > 0) {
      // Restore ALL predictions for matched players (all variants)
      const playerIds = [...new Set(matches.map(m => m.player_id))];
      let restored = 0;
      for (let i = 0; i < playerIds.length; i += 100) {
        const batch = playerIds.slice(i, i + 100);
        const { data, error } = await supabase
          .from("player_predictions")
          .update({ status: "active" })
          .in("player_id", batch)
          .eq("status", "departed")
          .eq("model_type", "returner")
          .select("id");
        if (error) throw error;
        restored += (data?.length || 0);
      }

      return new Response(JSON.stringify({
        message: `Fixed ${restored} predictions for ${playerIds.length} players (restored to active)`,
        playerCount: playerIds.length,
        predictionCount: restored,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      message: `Found ${matches.length} departed players that appear in the CSV`,
      csvPlayerCount: csvPlayers.length,
      departedTotal: allDeparted.length,
      matchCount: matches.length,
      sampleMatches: matches.slice(0, 20).map(m => `${m.first_name} ${m.last_name} (${m.team}) [${m.variant}]`),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
