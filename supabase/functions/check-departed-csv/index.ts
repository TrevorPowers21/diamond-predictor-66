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
    const step = reqUrl.searchParams.get("step") || "load"; // "load", "check", "fix"

    if (step === "load") {
      // Accept raw CSV text and load names into temp table
      const body = await req.text();
      const lines = body.split("\n").filter(l => l.trim());
      
      console.log(`CSV has ${lines.length} lines`);
      
      // Clear existing data
      await supabase.from("temp_csv_players").delete().neq("first_name", "___impossible___");
      
      // Parse CSV and batch insert
      const rows: { first_name: string; last_name: string }[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",");
        if (cols.length < 6) continue;
        const lastName = cols[4]?.trim();
        const firstName = cols[5]?.trim();
        if (lastName && firstName) {
          rows.push({ first_name: firstName, last_name: lastName });
        }
      }

      console.log(`Parsed ${rows.length} players from CSV`);

      // Insert in batches of 500
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const { error } = await supabase.from("temp_csv_players").insert(batch);
        if (error) throw error;
      }

      return new Response(JSON.stringify({
        message: `Loaded ${rows.length} players into temp table`,
        sample: rows.slice(0, 5),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (step === "check" || step === "fix") {
      // Get all departed returner predictions (paginate)
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

      // Get all CSV players from temp table
      let csvPlayers: any[] = [];
      let csvOffset = 0;
      while (true) {
        const { data, error } = await supabase
          .from("temp_csv_players")
          .select("first_name, last_name")
          .range(csvOffset, csvOffset + 999);
        if (error) throw error;
        if (!data || data.length === 0) break;
        csvPlayers = csvPlayers.concat(data);
        if (data.length < 1000) break;
        csvOffset += 1000;
      }

      const csvSet = new Set(
        csvPlayers.map((p: any) => `${p.first_name.toLowerCase()}|${p.last_name.toLowerCase()}`)
      );

      console.log(`${allDeparted.length} departed, ${csvSet.size} CSV players`);

      // Find matches
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

      console.log(`Found ${matches.length} matches`);

      if (step === "fix" && matches.length > 0) {
        const predIds = matches.map(m => m.pred_id);
        // Restore in batches
        for (let i = 0; i < predIds.length; i += 100) {
          const batch = predIds.slice(i, i + 100);
          const { error } = await supabase
            .from("player_predictions")
            .update({ status: "active" })
            .in("id", batch);
          if (error) throw error;
        }

        // Also fix xstats variants
        const playerIds = [...new Set(matches.map(m => m.player_id))];
        for (let i = 0; i < playerIds.length; i += 100) {
          const batch = playerIds.slice(i, i + 100);
          const { error } = await supabase
            .from("player_predictions")
            .update({ status: "active" })
            .in("player_id", batch)
            .eq("status", "departed")
            .eq("model_type", "returner");
          if (error) throw error;
        }

        return new Response(JSON.stringify({
          message: `Fixed ${matches.length} predictions (restored to active)`,
          players: matches.map(m => `${m.first_name} ${m.last_name} (${m.team}) [${m.variant}]`),
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        message: `Found ${matches.length} departed players that appear in the CSV`,
        csvPlayerCount: csvSet.size,
        departedTotal: allDeparted.length,
        matches: matches.map(m => `${m.first_name} ${m.last_name} (${m.team}) [${m.variant}]`),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid step. Use step=load, step=check, or step=fix" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
