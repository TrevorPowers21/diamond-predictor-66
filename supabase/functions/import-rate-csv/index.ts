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

    const body = await req.json().catch(() => ({}));
    const { storagePath = "rate-import.csv" } = body;

    // Download CSV from storage bucket
    const { data: fileData, error: dlError } = await db.storage.from("imports").download(storagePath);
    if (dlError) throw new Error(`Download failed: ${dlError.message}`);
    const rawCsv = await fileData.text();
    console.log(`Downloaded CSV: ${rawCsv.length} chars`);

    // Parse CSV
    const lines = rawCsv.split("\n").filter((l: string) => l.trim());
    const headers = lines[0].split(",");
    
    const colIdx = {
      playerFirstName: headers.indexOf("playerFirstName"),
      player: headers.indexOf("player"),
      pos: headers.indexOf("pos"),
      newestTeamLocation: headers.indexOf("newestTeamLocation"),
      batsHand: headers.indexOf("batsHand"),
      throwsHand: headers.indexOf("throwsHand"),
      age: headers.indexOf("Age"),
    };
    console.log("Column indices:", colIdx);

    interface CsvRow { firstName: string; lastName: string; pos: string; team: string; batsHand: string; throwsHand: string; age: number | null }
    const csvRows: CsvRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(",");
      if (cells.length < 15) continue;
      
      const firstName = (cells[colIdx.playerFirstName] || "").trim();
      const lastName = (cells[colIdx.player] || "").trim();
      const pos = (cells[colIdx.pos] || "").trim();
      const team = (cells[colIdx.newestTeamLocation] || "").trim();
      const batsHand = (cells[colIdx.batsHand] || "").trim();
      const throwsHand = (cells[colIdx.throwsHand] || "").trim();
      const ageStr = (cells[colIdx.age] || "").trim();
      const age = ageStr ? parseInt(ageStr) : null;

      if (!firstName || !lastName) continue;
      csvRows.push({ firstName, lastName, pos, team, batsHand, throwsHand, age });
    }
    console.log(`Parsed ${csvRows.length} CSV rows`);

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

    // Match and build updates
    let matched = 0;
    const unmatched: string[] = [];
    const updateBatch: { id: string; data: Record<string, any> }[] = [];

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
        if (row.team) updates.team = row.team;
        if (row.pos) updates.position = row.pos;
        if (row.age != null && !isNaN(row.age) && row.age > 0) updates.age = row.age;
        if (row.batsHand) updates.bats_hand = row.batsHand;
        if (row.throwsHand) updates.throws_hand = row.throwsHand;
        if (Object.keys(updates).length > 0) {
          updateBatch.push({ id: player.id, data: updates });
        }
      }
    }

    console.log(`Matched: ${matched}, Updates queued: ${updateBatch.length}, Unmatched: ${unmatched.length}`);

    // Execute updates in parallel batches of 50
    let updated = 0;
    const BATCH = 50;
    for (let i = 0; i < updateBatch.length; i += BATCH) {
      const chunk = updateBatch.slice(i, i + BATCH);
      const results = await Promise.all(
        chunk.map(u => db.from("players").update(u.data).eq("id", u.id))
      );
      for (const r of results) {
        if (!r.error) updated++;
      }
      if ((i + BATCH) % 500 === 0) console.log(`Updated ${updated}/${updateBatch.length}...`);
    }

    console.log(`Updated ${updated} players`);

    return new Response(JSON.stringify({
      success: true,
      csvRows: csvRows.length,
      matched,
      updated,
      unmatchedCount: unmatched.length,
      unmatchedSample: unmatched.slice(0, 50),
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
