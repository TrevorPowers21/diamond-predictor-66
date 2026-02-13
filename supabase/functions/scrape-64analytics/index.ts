import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { startPage = 1, endPage = 222 } = await req.json().catch(() => ({}));

    // 1. Load all returning players (transfer_portal = false)
    console.log("Loading returning players from database...");
    let allPlayers: any[] = [];
    let from = 0;
    const PAGE_SIZE = 1000;
    while (true) {
      const { data, error } = await supabase
        .from("players")
        .select("id, first_name, last_name, position, team")
        .eq("transfer_portal", false)
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      allPlayers = allPlayers.concat(data || []);
      if (!data || data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    console.log(`Loaded ${allPlayers.length} returning players`);

    // Build lookup map: "firstname lastname" -> player record
    const playerMap = new Map<string, any[]>();
    for (const p of allPlayers) {
      const key = `${p.first_name.trim().toLowerCase()} ${p.last_name.trim().toLowerCase()}`;
      if (!playerMap.has(key)) playerMap.set(key, []);
      playerMap.get(key)!.push(p);
    }

    // 2. Scrape 64analytics pages
    let totalMatched = 0;
    let totalScraped = 0;
    const updates: { id: string; position: string; team: string }[] = [];

    const actualEnd = Math.min(endPage, 222);
    console.log(`Scraping pages ${startPage} to ${actualEnd}...`);

    for (let page = startPage; page <= actualEnd; page++) {
      try {
        const url = `https://www.64analytics.com/players?page=${page}&division=D-I&sport=Baseball`;
        const resp = await fetch(url);
        if (!resp.ok) {
          console.error(`Page ${page} failed: ${resp.status}`);
          continue;
        }
        const html = await resp.text();

        // Parse table rows from HTML
        // Each row has: Name, Team, Conference, Class, Pos, Transfer, Previous Team
        const rowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
        const rows = html.match(rowRegex) || [];

        for (const row of rows) {
          // Skip header rows
          if (row.includes("<th")) continue;

          // Extract cells
          const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
          const cells: string[] = [];
          let cellMatch;
          while ((cellMatch = cellRegex.exec(row)) !== null) {
            // Strip HTML tags to get text content
            const text = cellMatch[1]
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim();
            cells.push(text);
          }

          if (cells.length < 5) continue;

          const name = cells[0].trim();
          const team = cells[1].trim();
          const pos = cells[4].trim();

          if (!name || !pos) continue;

          totalScraped++;

          // Match against our players
          const nameLower = name.toLowerCase();
          const matched = playerMap.get(nameLower);

          if (matched) {
            for (const player of matched) {
              updates.push({ id: player.id, position: pos, team });
            }
            totalMatched += matched.length;
          }
        }

        if (page % 20 === 0) {
          console.log(`Scraped page ${page}/${actualEnd}, matched so far: ${totalMatched}`);
        }

        // Small delay to be respectful
        if (page < actualEnd) {
          await new Promise((r) => setTimeout(r, 100));
        }
      } catch (e) {
        console.error(`Error on page ${page}:`, e);
      }
    }

    console.log(`Scraping complete. Total scraped: ${totalScraped}, Total matched: ${totalMatched}`);

    // 3. Batch update matched players
    let updated = 0;
    const BATCH = 200;
    for (let i = 0; i < updates.length; i += BATCH) {
      const batch = updates.slice(i, i + BATCH);
      for (const u of batch) {
        const { error } = await supabase
          .from("players")
          .update({ position: u.position, team: u.team })
          .eq("id", u.id);
        if (error) {
          console.error(`Update failed for ${u.id}:`, error.message);
        } else {
          updated++;
        }
      }
    }

    console.log(`Updated ${updated} players`);

    return new Response(
      JSON.stringify({
        success: true,
        totalScraped,
        totalMatched,
        totalUpdated: updated,
        pagesProcessed: actualEnd - startPage + 1,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
