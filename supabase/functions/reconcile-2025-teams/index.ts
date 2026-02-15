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
}

function parseMarkdownTable(raw: string): FilePlayer[] {
  const lines = raw.split("\n").filter(l => l.trim().startsWith("|") && !l.includes("---"));
  if (lines.length < 2) return [];
  const header = lines[0].split("|").map(s => s.trim()).filter(Boolean);
  const firstNameIdx = header.findIndex(h => h.toLowerCase() === "playerfirstname");
  const lastNameIdx = header.findIndex(h => h.toLowerCase() === "player");
  const teamIdx = header.findIndex(h => h.toLowerCase() === "newestteamlocation");
  const posIdx = header.findIndex(h => h.toLowerCase() === "pos");
  if (firstNameIdx < 0 || lastNameIdx < 0 || teamIdx < 0) throw new Error("Missing columns");
  const players: FilePlayer[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("|").map(s => s.trim()).filter(Boolean);
    if (cols.length < Math.max(firstNameIdx, lastNameIdx, teamIdx) + 1) continue;
    const firstName = cols[firstNameIdx];
    const lastName = cols[lastNameIdx];
    const team2025 = cols[teamIdx];
    const position = posIdx >= 0 ? cols[posIdx] : "";
    if (firstName && lastName && team2025) players.push({ firstName, lastName, team2025, position });
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
    const action = body.action || "reconcile";
    const dryRun = body.dryRun === true;

    if (action === "flag_unflagged") {
      // Find NOT_FLAGGED players and flag them as transfers
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
        if (player.transfer_portal) continue; // already flagged

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

            // Mark returner prediction as departed
            await db.from("player_predictions")
              .update({ status: "departed" })
              .eq("player_id", player.id)
              .eq("model_type", "returner")
              .eq("season", 2025);

            // Create transfer prediction if none exists
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
