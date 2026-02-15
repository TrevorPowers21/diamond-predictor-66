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

    const { startPage = 1, endPage = 222, dryRun = false, skipDeparted = false, markDepartedOnly = false } = await req.json().catch(() => ({}));

    // 1. Load all active returning players (those with returner predictions, status=active)
    console.log("Loading active returning players...");
    let returningPlayers: any[] = [];
    let from = 0;
    const PAGE_SIZE = 1000;
    while (true) {
      const { data, error } = await supabase
        .from("player_predictions")
        .select("id, player_id, players!inner(id, first_name, last_name, team, position, conference)")
        .eq("model_type", "returner")
        .eq("variant", "regular")
        .eq("status", "active")
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      returningPlayers = returningPlayers.concat(data || []);
      if (!data || data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    console.log(`Loaded ${returningPlayers.length} active returning players`);

    // Build lookup map: normalized name -> returning player records
    function normalizeName(first: string, last: string): string {
      let f = first.trim().toLowerCase()
        .replace(/[.''\-]/g, "")
        .replace(/\s+/g, " ");
      let l = last.trim().toLowerCase()
        .replace(/\s+(jr\.?|sr\.?|iii|ii|iv|v|2nd year)$/i, "")
        .replace(/[.''\-]/g, "")
        .replace(/\s+/g, " ");
      return `${f} ${l}`;
    }

    // Normalize team names so "Kansas St." matches "Kansas State", etc.
    function normalizeTeam(team: string): string {
      let t = team.trim()
        // Decode HTML entities - &amp; FIRST so &amp;#39; becomes &#39; then decoded
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .toLowerCase();
      
      // Convert parenthetical state codes to words BEFORE stripping
      const stateMap: Record<string, string> = {
        "fl": "florida", "oh": "ohio", "ny": "new york", "mn": "minnesota",
        "pa": "pennsylvania", "tx": "texas", "ca": "california", "il": "illinois",
      };
      t = t.replace(/\s*\(([^)]*)\)\s*/g, (_, code) => {
        const mapped = stateMap[code.trim().toLowerCase()];
        return mapped ? ` ${mapped} ` : " ";
      }).trim();
      
      // Strip "university of" prefix and trailing "university"
      t = t.replace(/^university of\s+/i, "").trim();
      t = t.replace(/\s+university$/i, "").trim();

      // State/direction abbreviation expansions
      t = t.replace(/\bky\.\s*/g, "kentucky ");
      t = t.replace(/\bmich\.\s*/g, "michigan ");
      t = t.replace(/\bla\.\s*/g, "louisiana ");
      t = t.replace(/\bga\.\s*/g, "georgia ");
      t = t.replace(/\bfla\.\s*/g, "florida ");
      t = t.replace(/\bill\.\s*/g, "illinois ");
      t = t.replace(/\bala\.\s*/g, "alabama ");
      t = t.replace(/\bmiss\.\s*/g, "mississippi ");
      t = t.replace(/\btenn\.\s*/g, "tennessee ");
      t = t.replace(/\bconn\.\s*/g, "connecticut ");
      t = t.replace(/\bminn\.\s*/g, "minnesota ");
      t = t.replace(/\bcaro\.\s*/g, "carolina ");
      t = t.replace(/\bind\.\s*/g, "indiana ");
      t = t.replace(/\bval\.\s*/g, "valley ");
      t = t.replace(/\bark\.\s*/g, "arkansas ");
      t = t.replace(/\bcol\.\s*/g, "college ");
      t = t.replace(/\bmo\.\s*/g, "missouri ");
      t = t.replace(/\bwis\.\s*/g, "wisconsin ");
      t = t.replace(/\bneb\.\s*/g, "nebraska ");
      t = t.replace(/\bso\.\s*/g, "southern ");
      t = t.replace(/\bno\.\s*/g, "northern ");
      t = t.replace(/\bn\.c\.\s*/g, "north carolina ");
      t = t.replace(/\bs\.c\.\s*/g, "south carolina ");

      // "St." handling: at end = "state", otherwise = "saint"
      t = t.replace(/\bst\.\s*$/g, "state");
      t = t.replace(/\bst\.\s+/g, "saint ");

      // "U." = "university"
      t = t.replace(/\bu\.\s*$/g, "university");

      // Remove punctuation for cleaner matching
      let cleaned = t.replace(/[.''\-&]/g, " ").replace(/\s+/g, " ").trim();

      const aliases: Record<string, string> = {
        // Major acronyms
        "usc": "southern california",
        "ole miss": "mississippi",
        "umass": "massachusetts",
        "uconn": "connecticut",
        "ucf": "central florida",
        "unlv": "nevada las vegas",
        "utsa": "texas san antonio",
        "utep": "texas el paso",
        "unc": "north carolina",
        "lsu": "louisiana state",
        "tcu": "texas christian",
        "smu": "southern methodist",
        "byu": "brigham young",
        "vcu": "virginia commonwealth",
        "fiu": "florida international",
        "fau": "florida atlantic",
        "uab": "alabama birmingham",
        "ualr": "arkansas little rock",
        "liu": "long island",
        "pitt": "pittsburgh",
        "nc state": "north carolina state",
        // Regional state university aliases
        "etsu": "east tennessee state",
        "mtsu": "middle tennessee state",
        "utrgv": "texas rio grande valley",
        "ut rio grande valley": "texas rio grande valley",
        "umes": "maryland eastern shore",
        "csun": "cal state northridge",
        "csu northridge": "cal state northridge",
        "cal saint fullerton": "cal state fullerton",
        "csu fullerton": "cal state fullerton",
        "csu bakersfield": "cal state bakersfield",
        // Southern/small schools
        "siue": "southern illinois edwardsville",
        "siu edwardsville": "southern illinois edwardsville",
        "southern illinois edwardsville": "southern illinois edwardsville",
        "siu": "southern illinois",
        "niu": "northern illinois",
        "uic": "illinois chicago",
        "army west point": "army",
        "nicholls": "nicholls state",
        "sam houston": "sam houston state",
        "south carolina upstate": "usc upstate",
        "usc upstate": "usc upstate",
        "southern university": "southern",
        "southern": "southern",
        // Conference name variants
        "queens charlotte": "queens",
        "queens university of charlotte": "queens",
        "nc a t": "north carolina a t",
        "north carolina a t": "north carolina a t",
        "texas a m corpus christi": "texas a m corpus christi",
        "a m corpus christi": "texas a m corpus christi",
        "unc wilmington": "north carolina wilmington",
        "unc greensboro": "north carolina greensboro",
        "unc asheville": "north carolina asheville",
        "western kentucky": "western kentucky",
        "western michigan": "western michigan",
        "western georgia": "west georgia",
        "west georgia": "west georgia",
        "southeastern louisiana": "southeastern louisiana",
        "miami ohio": "miami ohio",
        "miami": "miami florida",
        "south fla": "south florida",
        "south florida": "south florida",
        // === NEW: false-positive fixes ===
        // Southeast Missouri State
        "southeast missouri state": "southeast missouri state",
        "southeast missouri": "southeast missouri state",
        "semo": "southeast missouri state",
        // Grambling
        "grambling": "grambling state",
        "grambling state": "grambling state",
        // McNeese
        "mcneese": "mcneese state",
        "mcneese state": "mcneese state",
        // Stephen F. Austin
        "sfa": "stephen f austin",
        "stephen f austin": "stephen f austin",
        "stephen f austin state": "stephen f austin",
        // Penn vs Penn State
        "penn": "pennsylvania",
        "pennsylvania": "pennsylvania",
        "penn state": "penn state",
        // FDU
        "fdu": "fairleigh dickinson",
        "fairleigh dickinson": "fairleigh dickinson",
        // ULM
        "ulm": "louisiana monroe",
        "louisiana monroe": "louisiana monroe",
        // UIW
        "uiw": "incarnate word",
        "incarnate word": "incarnate word",
        // UNO
        "uno": "new orleans",
        "new orleans": "new orleans",
        // UMKC
        "umkc": "kansas city",
        "kansas city": "kansas city",
        // Prairie View
        "prairie view": "prairie view a m",
        "prairie view a m": "prairie view a m",
        "pvamu": "prairie view a m",
        // Alcorn
        "alcorn": "alcorn state",
        "alcorn state": "alcorn state",
        // Coppin
        "coppin": "coppin state",
        "coppin state": "coppin state",
        // Morgan
        "morgan": "morgan state",
        "morgan state": "morgan state",
        // Norfolk
        "norfolk": "norfolk state",
        "norfolk state": "norfolk state",
        // Savannah
        "savannah": "savannah state",
        "savannah state": "savannah state",
        // Delaware State
        "delaware state": "delaware state",
        "del state": "delaware state",
        // Jackson State
        "jackson state": "jackson state",
        "jackson": "jackson state",
        // Alabama State
        "alabama state": "alabama state",
        // Southeast Louisiana => southeastern louisiana
        "se louisiana": "southeastern louisiana",
        // Tarleton
        "tarleton": "tarleton state",
        "tarleton state": "tarleton state",
        // Cal Baptist => california baptist
        "cal baptist": "california baptist",
        "california baptist": "california baptist",
        "cbu": "california baptist",
        // Central Connecticut
        "ccsu": "central connecticut state",
        "central connecticut": "central connecticut state",
        "central connecticut state": "central connecticut state",
        // Sacred Heart
        "sacred heart": "sacred heart",
        "shu": "sacred heart",
        // Stony Brook
        "stony brook": "stony brook",
        // NJIT
        "njit": "njit",
        // LIU Brooklyn
        "liu brooklyn": "long island",
        // Southern Miss
        "southern miss": "southern mississippi",
        "southern mississippi": "southern mississippi",
        // App State
        "app state": "appalachian state",
        "appalachian state": "appalachian state",
        // Coastal Carolina
        "coastal carolina": "coastal carolina",
        "coastal": "coastal carolina",
        // Gardner-Webb
        "gardner webb": "gardner webb",
        // UNI
        "uni": "northern iowa",
        "northern iowa": "northern iowa",
        // IUPUI / IU Indy
        "iupui": "iupui",
        "iu indianapolis": "iupui",
        // IPFW / Purdue Fort Wayne
        "purdue fort wayne": "purdue fort wayne",
        "ipfw": "purdue fort wayne",
        // UT Martin
        "ut martin": "tennessee martin",
        "tennessee martin": "tennessee martin",
        // UT Arlington
        "ut arlington": "texas arlington",
        "uta": "texas arlington",
        "texas arlington": "texas arlington",
        // UMBC
        "umbc": "maryland baltimore county",
        // Central Arkansas
        "uca": "central arkansas",
        "central arkansas": "central arkansas",
        // Lamar
        "lamar": "lamar",
        // Abilene Christian
        "acu": "abilene christian",
        "abilene christian": "abilene christian",
        // Oral Roberts
        "oru": "oral roberts",
        "oral roberts": "oral roberts",
        // LMU / Loyola Marymount
        "lmu": "loyola marymount",
        "loyola marymount": "loyola marymount",
        // UNCW
        "uncw": "north carolina wilmington",
        // UNCA
        "unca": "north carolina asheville",
        // UNCG
        "uncg": "north carolina greensboro",
        // Fort Wayne
        "fort wayne": "purdue fort wayne",
        // Illinois Chicago
        "illinois chicago": "illinois chicago",
        // UL Monroe
        "ul monroe": "louisiana monroe",
        // Mississippi Valley State
        "mississippi valley state": "mississippi valley state",
        // Arkansas Pine Bluff
        "arkansas pine bluff": "arkansas pine bluff",
        // College of Charleston
        "college of charleston": "college of charleston",
        // Miami Florida vs Miami Ohio
        "miami florida": "miami florida",
        "miami ohio": "miami ohio",
        // North Alabama
        "north alabama": "north alabama",
        // San Diego State (distinct from San Diego)
        "san diego state": "san diego state",
        "san diego": "san diego",
        // Long Beach State
        "long beach state": "long beach state",
        // Mount Saint Marys
        "mount saint marys": "mount saint marys",
        // Saint Johns
        "saint johns": "saint johns",
        "saint johns new york": "saint johns",
        // Cal Poly
        "cal poly": "cal poly",
        // Sacramento State
        "sacramento state": "sacramento state",
        "sac state": "sacramento state",
        // Weber State
        "weber state": "weber state",
        // Utah Tech
        "utah tech": "utah tech",
        // Utah Valley
        "utah valley": "utah valley",
        // Partial state name expansions (after abbreviation expansion)
        "middle tennessee": "middle tennessee state",
        "middle tennessee state": "middle tennessee state",
        "mississippi valley": "mississippi valley state",
        "mississippi valley state": "mississippi valley state",
        "southeast missouri": "southeast missouri state",
        "southeast missouri state": "southeast missouri state",
        "eastern kentucky": "eastern kentucky",
        "eastern illinois": "eastern illinois",
        "eastern michigan": "eastern michigan",
        "western carolina": "western carolina",
        "southern indiana": "southern indiana",
        "southern ind": "southern indiana",
        "northern kentucky": "northern kentucky",
        // St. Thomas disambiguation
        "saint thomas minnesota": "saint thomas",
        "saint thomas": "saint thomas",
        // CSU Fullerton normalization
        "csu fullerton": "cal state fullerton",
        "cal state fullerton": "cal state fullerton",
        // UMass Lowell
        "umass lowell": "umass lowell",
        "massachusetts lowell": "umass lowell",
      };
      if (aliases[cleaned]) cleaned = aliases[cleaned];
      return cleaned;
    }

    const playerMap = new Map<string, any[]>();
    for (const p of returningPlayers) {
      const key = normalizeName(p.players.first_name, p.players.last_name);
      if (!playerMap.has(key)) playerMap.set(key, []);
      playerMap.get(key)!.push(p);
    }

    // markDepartedOnly mode: skip scraping, just mark all remaining active returner predictions as departed
    if (markDepartedOnly) {
      const predIds = returningPlayers.map((p: any) => p.id);
      let departedCount = 0;
      const BATCH_SIZE = 100;
      for (let i = 0; i < predIds.length; i += BATCH_SIZE) {
        const batch = predIds.slice(i, i + BATCH_SIZE);
        const { error } = await supabase
          .from("player_predictions")
          .update({ status: "departed" })
          .in("id", batch);
        if (error) {
          console.error(`Error marking departed batch:`, error.message);
        } else {
          departedCount += batch.length;
        }
      }
      console.log(`Marked ${departedCount} remaining predictions as departed`);
      return new Response(
        JSON.stringify({ success: true, markDepartedOnly: true, departedCount, totalRemaining: predIds.length }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Scrape 64analytics for 2026 roster data
    // Track which returning players we find on 64analytics
    const foundPlayerIds = new Set<string>();
    const transfers: { playerId: string; predictionId: string; oldTeam: string | null; newTeam: string; position: string }[] = [];
    const unmatchedScrapedNames: { name: string; team: string; normalized: string }[] = [];
    const sameTeam: { playerId: string }[] = [];

    let totalScraped = 0;
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

          if (cells.length < 5) continue;

          const name = cells[0].trim();
          const currentTeam = cells[1].trim();
          const pos = cells[4].trim();

          if (!name || !currentTeam) continue;
          totalScraped++;

          const nameParts = name.split(/\s+/);
          if (nameParts.length < 2) continue;
          const scrapedFirst = nameParts[0];
          const scrapedLast = nameParts.slice(1).join(" ");
          const nameLower = normalizeName(scrapedFirst, scrapedLast);
          const matched = playerMap.get(nameLower);
          if (!matched) {
            unmatchedScrapedNames.push({ name, team: currentTeam, normalized: nameLower });
            continue;
          }

          for (const returner of matched) {
            const playerId = returner.players.id;
            foundPlayerIds.add(playerId);

            const normalizedDbTeam = normalizeTeam(returner.players.team || "");
            const normalizedScrapedTeam = normalizeTeam(currentTeam);

            if (normalizedDbTeam && normalizedDbTeam !== normalizedScrapedTeam) {
              transfers.push({
                playerId,
                predictionId: returner.id,
                oldTeam: returner.players.team,
                newTeam: currentTeam,
                position: pos || returner.players.position || "",
              });
            } else {
              sameTeam.push({ playerId });
            }
          }
        }

        if (page % 20 === 0) {
          console.log(`Scraped page ${page}/${actualEnd}, found: ${foundPlayerIds.size}, transfers: ${transfers.length}`);
        }

        if (page < actualEnd) {
          await new Promise((r) => setTimeout(r, 50));
        }
      } catch (e) {
        console.error(`Error on page ${page}:`, e);
      }
    }

    console.log(`Scraping complete. Total scraped: ${totalScraped}`);
    console.log(`Found ${foundPlayerIds.size} returning players on 64analytics`);
    console.log(`Transfers detected: ${transfers.length}`);

    if (dryRun) {
      // Collect unmatched scraped names for debugging
      const unmatchedNames: { name: string; team: string; normalized: string }[] = [];
      // Re-scrape to collect unmatched (we already have the data from above, but let's track during scrape)
      // Actually, let's track during the main loop - we need to modify the loop above
      // For now, return what we have plus a sample of returner names for comparison
      const sampleReturners = returningPlayers.slice(0, 20).map(p => ({
        dbName: `${p.players.first_name} ${p.players.last_name}`,
        normalized: normalizeName(p.players.first_name, p.players.last_name),
        team: p.players.team,
      }));
      return new Response(
        JSON.stringify({
          success: true,
          dryRun: true,
          totalScraped,
          totalReturningPlayers: returningPlayers.length,
          foundOnRoster: foundPlayerIds.size,
          sameTeam: sameTeam.length,
          transfersDetected: transfers.length,
          transfers: transfers.map(t => ({
            playerId: t.playerId,
            oldTeam: t.oldTeam,
            newTeam: t.newTeam,
          })),
          unmatchedScraped: unmatchedScrapedNames.slice(0, 100),
          sampleReturners,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    // 4. Mark departed players (skip if skipDeparted is true)
    let departedCount = 0;
    if (!skipDeparted) {
      const departedPredictions: string[] = [];
      for (const p of returningPlayers) {
        if (!foundPlayerIds.has(p.players.id)) {
          departedPredictions.push(p.id);
        }
      }
      const BATCH_SIZE = 100;
      for (let i = 0; i < departedPredictions.length; i += BATCH_SIZE) {
        const batch = departedPredictions.slice(i, i + BATCH_SIZE);
        const { error } = await supabase
          .from("player_predictions")
          .update({ status: "departed" })
          .in("id", batch);
        if (error) {
          console.error(`Error marking departed batch:`, error.message);
        } else {
          departedCount += batch.length;
        }
      }
      console.log(`Marked ${departedCount} predictions as departed`);
    } else {
      console.log(`Skipping departed marking (skipDeparted=true)`);
    }

    // 5. Process transfers: move to portal
    let transferCount = 0;
    for (const t of transfers) {
      // Update player: set transfer_portal=true, from_team=old team, team=new team
      const { error: playerErr } = await supabase
        .from("players")
        .update({
          transfer_portal: true,
          from_team: t.oldTeam,
          team: t.newTeam,
          position: t.position,
        })
        .eq("id", t.playerId);

      if (playerErr) {
        console.error(`Error updating player ${t.playerId}:`, playerErr.message);
        continue;
      }

      // Change the returner prediction status to departed
      const { error: predErr } = await supabase
        .from("player_predictions")
        .update({ status: "departed" })
        .eq("id", t.predictionId);

      if (predErr) {
        console.error(`Error updating prediction for ${t.playerId}:`, predErr.message);
      }

      // Create a new transfer prediction with no stats (to be manually filled)
      const { error: insertErr } = await supabase
        .from("player_predictions")
        .insert({
          player_id: t.playerId,
          model_type: "transfer",
          variant: "regular",
          status: "active",
          season: 2025,
        });

      if (insertErr) {
        console.error(`Error creating transfer prediction for ${t.playerId}:`, insertErr.message);
      } else {
        transferCount++;
      }
    }
    console.log(`Processed ${transferCount} transfers to portal`);

    return new Response(
      JSON.stringify({
        success: true,
        totalScraped,
        totalReturningPlayers: returningPlayers.length,
        foundOnRoster: foundPlayerIds.size,
        sameTeam: sameTeam.length,
        departedCount,
        transferCount,
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
