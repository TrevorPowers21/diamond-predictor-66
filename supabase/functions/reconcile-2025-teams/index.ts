import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface FilePlayer {
  firstName: string;
  lastName: string;
  team2025: string;
  position: string;
  batsHand: string;
  throwsHand: string;
  age: number;
  ab: number;
  ba: number;
  obp: number;
  slg: number;
  ops: number;
  iso: number;
}

function parseMarkdownTable(raw: string): FilePlayer[] {
  const lines = raw.split("\n").filter(l => l.trim().startsWith("|") && !l.includes("---"));
  if (lines.length < 2) return [];
  const header = lines[0].split("|").map(s => s.trim()).filter(Boolean);
  const idx = (name: string) => header.findIndex(h => h.toLowerCase() === name.toLowerCase());
  const firstNameIdx = idx("playerfirstname");
  const lastNameIdx = idx("player");
  const teamIdx = idx("newestteamlocation");
  const posIdx = idx("pos");
  const batsIdx = idx("batshand");
  const throwsIdx = idx("throwshand");
  const ageIdx = idx("age");
  const abIdx = idx("ab");
  const baIdx = idx("ba");
  const obpIdx = idx("obp");
  const slgIdx = idx("slg");
  const opsIdx = idx("ops");
  const isoIdx = idx("iso");

  if (firstNameIdx < 0 || lastNameIdx < 0 || teamIdx < 0) throw new Error("Missing columns");
  const players: FilePlayer[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("|").map(s => s.trim()).filter(Boolean);
    if (cols.length < Math.max(firstNameIdx, lastNameIdx, teamIdx) + 1) continue;
    const firstName = cols[firstNameIdx];
    const lastName = cols[lastNameIdx];
    const team2025 = cols[teamIdx];
    if (!firstName || !lastName || !team2025) continue;
    players.push({
      firstName,
      lastName,
      team2025,
      position: posIdx >= 0 ? cols[posIdx] : "",
      batsHand: batsIdx >= 0 ? cols[batsIdx] : "",
      throwsHand: throwsIdx >= 0 ? cols[throwsIdx] : "",
      age: ageIdx >= 0 ? parseInt(cols[ageIdx]) || 0 : 0,
      ab: abIdx >= 0 ? parseInt(cols[abIdx]) || 0 : 0,
      ba: baIdx >= 0 ? parseFloat(cols[baIdx]) || 0 : 0,
      obp: obpIdx >= 0 ? parseFloat(cols[obpIdx]) || 0 : 0,
      slg: slgIdx >= 0 ? parseFloat(cols[slgIdx]) || 0 : 0,
      ops: opsIdx >= 0 ? parseFloat(cols[opsIdx]) || 0 : 0,
      iso: isoIdx >= 0 ? parseFloat(cols[isoIdx]) || 0 : 0,
    });
  }
  return players;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const action = body.action || "populate_stats";
    const dryRun = body.dryRun === true;

    if (action === "populate_stats") {
      // Load the parsed stats file from storage
      const { data: fileData, error: fileError } = await db.storage.from("imports").download("2025-transfer-stats.txt");
      if (fileError) throw new Error(`Storage error: ${fileError.message}`);
      const rawText = await fileData.text();
      const filePlayers = parseMarkdownTable(rawText);
      console.log(`Parsed ${filePlayers.length} players from file`);

      // Get all transfer portal players with their active transfer predictions
      let allTransfers: any[] = [];
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await db.from("players")
          .select("id, first_name, last_name, team, from_team, conference")
          .eq("transfer_portal", true)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        allTransfers = allTransfers.concat(data || []);
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }
      console.log(`Found ${allTransfers.length} transfer portal players`);

      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
      const playerMap = new Map<string, any[]>();
      for (const p of allTransfers) {
        const key = normalize(p.first_name) + "|" + normalize(p.last_name);
        if (!playerMap.has(key)) playerMap.set(key, []);
        playerMap.get(key)!.push(p);
      }

      let matched = 0;
      let skipped = 0;
      const actions: string[] = [];
      const updates: Promise<any>[] = [];

      for (const fp of filePlayers) {
        const key = normalize(fp.firstName) + "|" + normalize(fp.lastName);
        const matches = playerMap.get(key);
        if (!matches || matches.length !== 1) { skipped++; continue; }
        const player = matches[0];

        matched++;
        actions.push(`MATCH: ${fp.firstName} ${fp.lastName} → BA:${fp.ba} OBP:${fp.obp} SLG:${fp.slg} OPS:${fp.ops}`);

        if (!dryRun) {
          // Update player metadata
          const playerUpdate: any = {};
          if (fp.batsHand && fp.batsHand !== "0") playerUpdate.bats_hand = fp.batsHand;
          if (fp.throwsHand && fp.throwsHand !== "0") playerUpdate.throws_hand = fp.throwsHand;
          if (fp.age > 0) playerUpdate.age = fp.age;
          if (fp.position) playerUpdate.position = fp.position;
          if (Object.keys(playerUpdate).length > 0) {
            updates.push(db.from("players").update(playerUpdate).eq("id", player.id));
          }

          // Update transfer prediction with actual 2025 stats
          // Put actual stats in both from_* (prior) and p_* (displayed) fields
          updates.push(
            db.from("player_predictions").update({
              from_avg: fp.ba,
              from_obp: fp.obp,
              from_slg: fp.slg,
              p_avg: fp.ba,
              p_obp: fp.obp,
              p_slg: fp.slg,
              p_ops: fp.ops,
              p_iso: fp.iso,
            })
            .eq("player_id", player.id)
            .eq("model_type", "transfer")
            .eq("season", 2025)
            .eq("status", "active")
          );

          // Batch execute every 50
          if (updates.length >= 50) {
            await Promise.all(updates.splice(0, 50));
          }
        }
      }

      // Flush remaining
      if (updates.length > 0) await Promise.all(updates);

      return new Response(JSON.stringify({ success: true, dryRun, matched, skipped, total: filePlayers.length, actions: actions.slice(0, 50) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "populate_scouting") {
      // Load the power ratings CSV from storage
      const { data: fileData, error: fileError } = await db.storage.from("imports").download("2025-power-ratings.csv");
      if (fileError) throw new Error(`Storage error: ${fileError.message}`);
      const rawText = await fileData.text();
      const lines = rawText.split("\n");

      // Parse CSV: skip header rows (conferences, max/min), player rows start after "Min" row
      // Format: Name, AvgEV, Barrel%, Whiff%, Chase%, EVScore(F), BarrelScore(G), WhiffScore(H), ChaseScore(I), OffPwrRating(J), PwrRating(K)
      interface ScoutRow { name: string; variant: string; evScore: number; barrelScore: number; whiffScore: number; chaseScore: number; offPwrRating: number; pwrRating: number; }
      const scoutRows: ScoutRow[] = [];
      let pastMin = false;
      for (const line of lines) {
        const cols = line.split(",").map(s => s.trim());
        if (!cols[0]) continue;
        if (cols[0] === "Min") { pastMin = true; continue; }
        if (!pastMin) continue;
        if (cols[0].startsWith("25 ") || cols[0] === "Max" || cols[0] === "NCAA") continue;
        const name = cols[0];
        const evScore = parseFloat(cols[5]) || 0;
        const barrelScore = parseFloat(cols[6]) || 0;
        const whiffScore = parseFloat(cols[7]) || 0;
        const chaseScore = parseFloat(cols[8]) || 0;
        const offPwrRating = parseFloat(cols[9]) || 0;
        const pwrRating = parseFloat(cols[10]) || 0;
        if (evScore === 0 && barrelScore <= 1 && offPwrRating === 0) continue;
        const isXstats = name.toLowerCase().endsWith(" xstats");
        const cleanName = isXstats ? name.replace(/ xstats$/i, "") : name;
        scoutRows.push({ name: cleanName, variant: isXstats ? "xstats" : "regular", evScore, barrelScore, whiffScore, chaseScore, offPwrRating, pwrRating });
      }
      console.log(`Parsed ${scoutRows.length} scouting rows from CSV`);

      // Load all transfer portal players
      let allTransfers: any[] = [];
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await db.from("players")
          .select("id, first_name, last_name")
          .eq("transfer_portal", true)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        allTransfers = allTransfers.concat(data || []);
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }
      console.log(`Found ${allTransfers.length} transfer portal players`);

      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
      const playerMap = new Map<string, any[]>();
      for (const p of allTransfers) {
        const key = normalize(p.first_name) + " " + normalize(p.last_name);
        if (!playerMap.has(key)) playerMap.set(key, []);
        playerMap.get(key)!.push(p);
      }

      let matched = 0;
      let skipped = 0;
      const actions: string[] = [];
      const updates: Promise<any>[] = [];

      for (const sr of scoutRows) {
        // Parse first/last name from CSV name
        const nameParts = sr.name.trim().split(/\s+/);
        if (nameParts.length < 2) { skipped++; continue; }
        const firstName = normalize(nameParts[0]);
        const lastName = normalize(nameParts.slice(1).join(""));
        const key = firstName + " " + lastName;
        const matches = playerMap.get(key);
        if (!matches || matches.length !== 1) { skipped++; continue; }
        const player = matches[0];

        matched++;
        actions.push(`MATCH: ${sr.name} (${sr.variant}) → EV:${sr.evScore} BBL:${sr.barrelScore} WH:${sr.whiffScore} CH:${sr.chaseScore} OPR:${sr.offPwrRating} PWR+:${sr.pwrRating}`);

        if (!dryRun) {
          updates.push(
            db.from("player_predictions").update({
              ev_score: sr.evScore,
              barrel_score: sr.barrelScore,
              whiff_score: sr.whiffScore,
              chase_score: sr.chaseScore,
              power_rating_score: sr.offPwrRating,
              power_rating_plus: sr.pwrRating,
            })
            .eq("player_id", player.id)
            .eq("model_type", "transfer")
            .eq("season", 2025)
            .eq("variant", sr.variant)
            .eq("status", "active")
          );

          if (updates.length >= 50) {
            await Promise.all(updates.splice(0, 50));
          }
        }
      }

      if (updates.length > 0) await Promise.all(updates);

      return new Response(JSON.stringify({ success: true, dryRun, matched, skipped, total: scoutRows.length, actions: actions.slice(0, 50) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "flag_unflagged") {
      // Original flag_unflagged logic preserved
      const { data: fileData, error: fileError } = await db.storage.from("imports").download("2025-teams-parsed.txt");
      if (fileError) throw new Error(`Storage error: ${fileError.message}`);
      const rawText = await fileData.text();
      const filePlayers = parseMarkdownTable(rawText);

      let allPlayers: any[] = [];
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await db.from("players").select("id, first_name, last_name, team, conference, from_team, transfer_portal")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        allPlayers = allPlayers.concat(data || []);
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }

      let allTeams: any[] = [];
      from = 0;
      while (true) {
        const { data, error } = await db.from("teams").select("name, conference").range(from, from + PAGE - 1);
        if (error) throw error;
        allTeams = allTeams.concat(data || []);
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }
      const teamConfMap: Record<string, string> = {};
      for (const t of allTeams) { if (t.conference) teamConfMap[t.name.toLowerCase()] = t.conference; }

      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
      const playerMap = new Map<string, any[]>();
      for (const p of allPlayers) {
        const key = normalize(p.first_name) + "|" + normalize(p.last_name);
        if (!playerMap.has(key)) playerMap.set(key, []);
        playerMap.get(key)!.push(p);
      }
      const teamAliases: Record<string, string> = {
        "florida gulf coast": "fgcu",
        "dallas baptist": "dbu",
        "loyola marymount": "lmu ca",
        "lmu (ca)": "lmu ca",
        "central connecticut state": "central conn st",
        "central conn. st.": "central conn st",
        "southeastern louisiana": "southeastern la",
        "southeastern la.": "southeastern la",
        "stephen f. austin state": "sfa",
        "stephen f austin": "sfa",
        "ut arlington": "ut arlington",
        "texas-arlington": "ut arlington",
        "ut martin": "ut martin",
        "tennessee-martin": "ut martin",
        "mcneese state": "mcneese",
        "utah tech": "utah tech",
      };
      const normalizeTeam = (t: string) => {
        let n = t.toLowerCase().replace(/university|college|of|the/gi, "").replace(/[^a-z\s().]/g, "").replace(/\s+/g, " ").trim();
        if (teamAliases[t.toLowerCase()]) return teamAliases[t.toLowerCase()];
        n = n.replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
        return n;
      };

      let flagged = 0;
      const actions: string[] = [];

      for (const fp of filePlayers) {
        const key = normalize(fp.firstName) + "|" + normalize(fp.lastName);
        const matches = playerMap.get(key);
        if (!matches || matches.length !== 1) continue;
        const player = matches[0];
        if (player.transfer_portal) continue;

        const fileTeamNorm = normalizeTeam(fp.team2025);
        const currentTeamNorm = normalizeTeam(player.team || "");
        const sameTeam = currentTeamNorm === fileTeamNorm || currentTeamNorm.includes(fileTeamNorm) || fileTeamNorm.includes(currentTeamNorm);

        if (!sameTeam && player.team && fp.team2025) {
          flagged++;
          const destConf = teamConfMap[player.team?.toLowerCase() || ""] || player.conference;
          actions.push(`FLAG: ${fp.firstName} ${fp.lastName} from ${fp.team2025} → ${player.team} (conf: ${destConf})`);
          
          if (!dryRun) {
            await db.from("players").update({
              transfer_portal: true,
              from_team: fp.team2025,
              conference: destConf,
            }).eq("id", player.id);

            await db.from("player_predictions")
              .update({ status: "departed" })
              .eq("player_id", player.id)
              .eq("model_type", "returner")
              .eq("season", 2025);

            const { data: existing } = await db.from("player_predictions")
              .select("id")
              .eq("player_id", player.id)
              .eq("model_type", "transfer")
              .eq("season", 2025)
              .limit(1);

            if (!existing?.length) {
              await db.from("player_predictions").insert({
                player_id: player.id,
                model_type: "transfer",
                season: 2025,
                variant: "regular",
                status: "active",
              });
            }
          }
        }
      }

      return new Response(JSON.stringify({ success: true, dryRun, flagged, actions }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: false, error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
