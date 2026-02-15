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
  
  // First line is header
  const header = lines[0].split("|").map(s => s.trim()).filter(Boolean);
  const firstNameIdx = header.findIndex(h => h.toLowerCase() === "playerfirstname");
  const lastNameIdx = header.findIndex(h => h.toLowerCase() === "player"); // "player" column is last name
  const teamIdx = header.findIndex(h => h.toLowerCase() === "newestteamlocation");
  const posIdx = header.findIndex(h => h.toLowerCase() === "pos");
  
  if (firstNameIdx < 0 || lastNameIdx < 0 || teamIdx < 0) {
    throw new Error(`Could not find columns: firstName=${firstNameIdx}, lastName=${lastNameIdx}, team=${teamIdx}`);
  }
  
  const players: FilePlayer[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("|").map(s => s.trim()).filter(Boolean);
    if (cols.length < Math.max(firstNameIdx, lastNameIdx, teamIdx) + 1) continue;
    const firstName = cols[firstNameIdx];
    const lastName = cols[lastNameIdx];
    const team2025 = cols[teamIdx];
    const position = posIdx >= 0 ? cols[posIdx] : "";
    if (firstName && lastName && team2025) {
      players.push({ firstName, lastName, team2025, position });
    }
  }
  return players;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    let filePlayers: FilePlayer[];
    
    if (body.rawTable) {
      filePlayers = parseMarkdownTable(body.rawTable);
    } else if (body.players) {
      filePlayers = body.players;
    } else {
      throw new Error("Provide 'rawTable' (markdown) or 'players' (JSON array)");
    }
    
    if (!filePlayers.length) throw new Error("No player data parsed");

    // Dry run mode - just report what would happen
    const dryRun = body.dryRun === true;

    // Load all players from DB
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

    // Load teams lookup
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
    for (const t of allTeams) {
      if (t.conference) teamConfMap[t.name.toLowerCase()] = t.conference;
    }

    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
    const playerMap = new Map<string, any[]>();
    for (const p of allPlayers) {
      const key = normalize(p.first_name) + "|" + normalize(p.last_name);
      if (!playerMap.has(key)) playerMap.set(key, []);
      playerMap.get(key)!.push(p);
    }

    const normalizeTeam = (t: string) => t.toLowerCase()
      .replace(/university|college|of|the/gi, "")
      .replace(/[^a-z\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const stats = {
      totalFileRows: filePlayers.length,
      matched: 0,
      unmatched: 0,
      fromTeamFilled: 0,
      revertedToReturner: 0,
      confirmedTransferNotFlagged: 0,
      alreadyCorrect: 0,
      ambiguousSkipped: 0,
    };
    const actions: string[] = [];
    const unmatchedNames: string[] = [];

    for (const fp of filePlayers) {
      const key = normalize(fp.firstName) + "|" + normalize(fp.lastName);
      const matches = playerMap.get(key);

      if (!matches || matches.length === 0) {
        stats.unmatched++;
        if (unmatchedNames.length < 50) unmatchedNames.push(`${fp.firstName} ${fp.lastName} (${fp.team2025})`);
        continue;
      }

      let player = matches[0];
      if (matches.length > 1) {
        const fileTeamNorm = normalizeTeam(fp.team2025);
        const exact = matches.find(m =>
          normalizeTeam(m.team || "").includes(fileTeamNorm) ||
          fileTeamNorm.includes(normalizeTeam(m.team || "")) ||
          normalizeTeam(m.from_team || "").includes(fileTeamNorm) ||
          fileTeamNorm.includes(normalizeTeam(m.from_team || ""))
        );
        if (exact) {
          player = exact;
        } else {
          stats.ambiguousSkipped++;
          if (actions.length < 100) actions.push(`AMBIGUOUS: ${fp.firstName} ${fp.lastName} - ${matches.length} DB matches, file says ${fp.team2025}`);
          continue;
        }
      }

      stats.matched++;
      const fileTeamNorm = normalizeTeam(fp.team2025);
      const currentTeamNorm = normalizeTeam(player.team || "");

      // Check if same team (player stayed)
      const sameTeam = currentTeamNorm === fileTeamNorm ||
        currentTeamNorm.includes(fileTeamNorm) ||
        fileTeamNorm.includes(currentTeamNorm);

      if (sameTeam) {
        if (player.transfer_portal) {
          // WRONG - revert to returner
          if (!dryRun) {
            const conf = teamConfMap[player.team?.toLowerCase() || ""] || player.conference;
            await db.from("players").update({
              transfer_portal: false,
              from_team: null,
              conference: conf,
            }).eq("id", player.id);

            // Fix predictions
            await db.from("player_predictions")
              .update({ status: "departed" })
              .eq("player_id", player.id)
              .eq("model_type", "transfer")
              .eq("season", 2025);

            await db.from("player_predictions")
              .update({ status: "active" })
              .eq("player_id", player.id)
              .eq("model_type", "returner")
              .eq("season", 2025);
          }
          stats.revertedToReturner++;
          actions.push(`REVERT: ${fp.firstName} ${fp.lastName} → returner at ${player.team}`);
        } else {
          stats.alreadyCorrect++;
        }
      } else {
        // Different team = transfer
        if (player.transfer_portal) {
          if (!player.from_team || player.from_team.startsWith("Unknown")) {
            if (!dryRun) {
              await db.from("players").update({
                from_team: fp.team2025,
                conference: teamConfMap[player.team?.toLowerCase() || ""] || player.conference,
              }).eq("id", player.id);
            }
            stats.fromTeamFilled++;
            actions.push(`FILL: ${fp.firstName} ${fp.lastName} from_team=${fp.team2025} → ${player.team}`);
          } else {
            stats.alreadyCorrect++;
          }
        } else {
          stats.confirmedTransferNotFlagged++;
          actions.push(`NOT_FLAGGED: ${fp.firstName} ${fp.lastName} was at ${fp.team2025} now at ${player.team}`);
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      dryRun,
      stats,
      actions: actions.slice(0, 80),
      unmatchedSample: unmatchedNames.slice(0, 50),
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
