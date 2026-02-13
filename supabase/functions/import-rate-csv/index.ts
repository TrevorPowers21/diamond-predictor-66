import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function normalizeName(first: string, last: string): string {
  let f = first.trim().toLowerCase().replace(/[.''\-]/g, "").replace(/\s+/g, " ");
  let l = last.trim().toLowerCase()
    .replace(/\s+(jr\.?|sr\.?|iii|ii|iv|v)$/i, "")
    .replace(/[.''\-]/g, "")
    .replace(/\s+/g, " ");
  return `${f} ${l}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    
    // Accept compact format: array of [firstName, lastName, pos, team, batsHand, throwsHand, age]
    const { players: playerData } = body;
    if (!playerData || !Array.isArray(playerData)) throw new Error("Provide players array");

    const csvRows = playerData.map((p: any[]) => ({
      firstName: p[0],
      lastName: p[1], 
      pos: p[2],
      team: p[3],
      batsHand: p[4],
      throwsHand: p[5],
      age: p[6] ? parseInt(p[6]) : null,
    }));
    console.log(`Received ${csvRows.length} player rows`);

    // Load all players
    let allPlayers: any[] = [];
    let from = 0;
    const PAGE_SIZE = 1000;
    while (true) {
      const { data, error } = await db.from("players")
        .select("id, first_name, last_name, team, position")
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      allPlayers = allPlayers.concat(data || []);
      if (!data || data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    console.log(`Loaded ${allPlayers.length} players from DB`);

    // Build lookup map
    const playerMap = new Map<string, any[]>();
    for (const p of allPlayers) {
      const key = normalizeName(p.first_name, p.last_name);
      if (!playerMap.has(key)) playerMap.set(key, []);
      playerMap.get(key)!.push(p);
    }

    // Match and update
    let matched = 0;
    let updated = 0;
    let unmatched: string[] = [];

    for (const row of csvRows) {
      const key = normalizeName(row.firstName, row.lastName);
      const players = playerMap.get(key);
      if (!players) {
        unmatched.push(`${row.firstName} ${row.lastName}`);
        continue;
      }
      matched += players.length;

      for (const player of players) {
        const updates: Record<string, any> = {};
        
        // Always update team from CSV (this is 2025 data)
        if (row.team) updates.team = row.team;
        if (row.pos) updates.position = row.pos;
        if (row.age != null && !isNaN(row.age)) updates.age = row.age;
        if (row.batsHand) updates.bats_hand = row.batsHand;
        if (row.throwsHand) updates.throws_hand = row.throwsHand;

        if (Object.keys(updates).length > 0) {
          const { error } = await db.from("players").update(updates).eq("id", player.id);
          if (error) {
            console.error(`Update failed for ${player.id}:`, error.message);
          } else {
            updated++;
          }
        }
      }
    }

    console.log(`Matched: ${matched}, Updated: ${updated}, Unmatched: ${unmatched.length}`);

    return new Response(JSON.stringify({
      success: true,
      csvRows: csvRows.length,
      matched,
      updated,
      unmatchedCount: unmatched.length,
      unmatchedSample: unmatched.slice(0, 30),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
