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

    const { startPage = 1, endPage = 222, mode = "update_2025" } = await req.json().catch(() => ({}));

    // 1. Load players (only those missing team if mode is fill_missing)
    console.log("Loading players from database...");
    let allPlayers: any[] = [];
    let from = 0;
    const PAGE_SIZE = 1000;
    while (true) {
      let query = supabase
        .from("players")
        .select("id, first_name, last_name, position, team, transfer_portal");
      if (mode === "fill_missing") {
        query = query.is("team", null);
      }
      const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      allPlayers = allPlayers.concat(data || []);
      if (!data || data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    console.log(`Loaded ${allPlayers.length} players`);

    // Normalize name for matching: strip suffixes, periods, extra spaces
    function normalizeName(first: string, last: string): string {
      let f = first.trim().toLowerCase()
        .replace(/[.''\-]/g, "")  // strip apostrophes, periods, hyphens
        .replace(/\s+/g, " ");
      let l = last.trim().toLowerCase()
        .replace(/\s+(jr\.?|sr\.?|iii|ii|iv|v|2nd year)$/i, "")
        .replace(/[.''\-]/g, "")  // strip apostrophes, periods, hyphens
        .replace(/\s+/g, " ");
      return `${f} ${l}`;
    }

    // Build lookup map: normalized "firstname lastname" -> player records
    const playerMap = new Map<string, any[]>();
    for (const p of allPlayers) {
      const key = normalizeName(p.first_name, p.last_name);
      if (!playerMap.has(key)) playerMap.set(key, []);
      playerMap.get(key)!.push(p);
    }

    // 2. Scrape 64analytics pages
    let totalMatched = 0;
    let totalScraped = 0;
    const updates: { id: string; position: string; team: string }[] = [];

    const actualEnd = Math.min(endPage, 222);
    console.log(`Scraping pages ${startPage} to ${actualEnd} (mode: ${mode})...`);

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
        // Columns: Name(0), Team(1), Conference(2), Class(3), Pos(4), Transfer(5), Previous Team(6)
        const rowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
        const rows = html.match(rowRegex) || [];

        for (const row of rows) {
          if (row.includes("<th")) continue;

          const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
          const cells: string[] = [];
          let cellMatch;
          while ((cellMatch = cellRegex.exec(row)) !== null) {
            const text = cellMatch[1]
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim();
            cells.push(text);
          }

          if (cells.length < 7) continue;

          const name = cells[0].trim();
          const currentTeam = cells[1].trim();
          const pos = cells[4].trim();
          const isTransfer = cells[5].trim().toLowerCase();
          const previousTeam = cells[6].trim().replace(/^--$/, "").replace(/^-$/, "");

          if (!name || !pos) continue;
          totalScraped++;

          // Normalize scraped name: split into first/last, strip suffixes/periods
          const nameParts = name.split(/\s+/);
          if (nameParts.length < 2) continue;
          const scrapedFirst = nameParts[0];
          const scrapedLast = nameParts.slice(1).join(" ");
          const nameLower = normalizeName(scrapedFirst, scrapedLast);
          const matched = playerMap.get(nameLower);
          if (!matched) continue;

          // Determine the 2025 team:
          // If player transferred (has a previous team), use previous team as their 2025 team
          // If player didn't transfer, use current team as their 2025 team
          let team2025: string;
          if (previousTeam && previousTeam !== "" && previousTeam !== "--") {
            team2025 = previousTeam; // They transferred, so their 2025 team is the previous one
          } else {
            team2025 = currentTeam; // Didn't transfer, current = 2025 team
          }

          for (const player of matched) {
            updates.push({ id: player.id, position: pos, team: team2025 });
          }
          totalMatched += matched.length;
        }

        if (page % 20 === 0) {
          console.log(`Scraped page ${page}/${actualEnd}, matched so far: ${totalMatched}`);
        }

        if (page < actualEnd) {
          await new Promise((r) => setTimeout(r, 50));
        }
      } catch (e) {
        console.error(`Error on page ${page}:`, e);
      }
    }

    console.log(`Scraping complete. Total scraped: ${totalScraped}, Total matched: ${totalMatched}`);

    // 3. Batch update matched players
    let updated = 0;
    for (const u of updates) {
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
