import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Normalize team names for comparison
function normalizeTeam(name: string | null): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/university of /g, "")
    .replace(/ university/g, "")
    .replace(/ college/g, "")
    .replace(/ state$/g, " st")
    .replace(/^the /g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { players: listPlayers, dryRun = true } = await req.json();
    // listPlayers: array of { firstName, lastName, team }

    if (!listPlayers || !Array.isArray(listPlayers)) {
      return new Response(JSON.stringify({ error: "players array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build lookup: normalized "first|last" → team from list
    const listLookup = new Map<string, string>();
    for (const p of listPlayers) {
      const key = `${normalizeName(p.firstName)}|${normalizeName(p.lastName)}`;
      listLookup.set(key, p.team);
    }

    // Get all active returner predictions (both variants)
    const { data: returners, error: retErr } = await supabase
      .from("player_predictions")
      .select(`
        id, player_id, variant, model_type, status, locked,
        from_avg, from_obp, from_slg, p_avg, p_obp, p_slg, p_ops, p_iso, p_wrc_plus,
        ev_score, barrel_score, whiff_score, chase_score,
        power_rating_score, power_rating_plus,
        from_park_factor, to_park_factor, from_stuff_plus, to_stuff_plus,
        from_avg_plus, from_obp_plus, from_slg_plus,
        to_avg_plus, to_obp_plus, to_slg_plus,
        dev_aggressiveness, class_transition,
        players!inner(id, first_name, last_name, team, conference, position, class_year, from_team)
      `)
      .eq("model_type", "returner")
      .eq("status", "active");

    if (retErr) throw retErr;

    // Find mismatches
    const mismatches: Array<{
      playerId: string;
      firstName: string;
      lastName: string;
      currentTeam: string;
      newTeam: string;
      predictionIds: string[];
    }> = [];

    // Group predictions by player
    const playerPreds = new Map<string, typeof returners>();
    for (const r of returners || []) {
      const pid = (r as any).players.id;
      if (!playerPreds.has(pid)) playerPreds.set(pid, []);
      playerPreds.get(pid)!.push(r);
    }

    for (const [playerId, preds] of playerPreds) {
      const player = (preds[0] as any).players;
      const key = `${normalizeName(player.first_name)}|${normalizeName(player.last_name)}`;
      
      if (!listLookup.has(key)) continue; // Not on list, skip
      
      const listTeam = listLookup.get(key)!;
      const dbTeam = player.team || "";
      
      // Compare normalized team names
      if (normalizeTeam(dbTeam) === normalizeTeam(listTeam)) continue; // Same team, skip
      
      mismatches.push({
        playerId,
        firstName: player.first_name,
        lastName: player.last_name,
        currentTeam: dbTeam,
        newTeam: listTeam,
        predictionIds: preds.map((p: any) => p.id),
      });
    }

    if (dryRun) {
      return new Response(JSON.stringify({
        mode: "dry_run",
        mismatchCount: mismatches.length,
        mismatches: mismatches.map(m => ({
          name: `${m.firstName} ${m.lastName}`,
          currentTeam: m.currentTeam,
          newTeam: m.newTeam,
        })),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Execute transitions
    const results: string[] = [];
    const errors: string[] = [];

    // Look up teams table for conference mapping
    const { data: allTeams } = await supabase.from("teams").select("name, conference");
    const teamConferenceMap = new Map<string, string>();
    for (const t of allTeams || []) {
      teamConferenceMap.set(normalizeTeam(t.name), t.conference || "");
      // Also add exact name
      teamConferenceMap.set(t.name.toLowerCase(), t.conference || "");
    }

    for (const m of mismatches) {
      try {
        // Find new conference from teams table
        let newConference = "";
        for (const [key, conf] of teamConferenceMap) {
          if (normalizeTeam(m.newTeam) === key || m.newTeam.toLowerCase() === key) {
            newConference = conf;
            break;
          }
        }

        // 1. Update player record
        const { error: playerErr } = await supabase
          .from("players")
          .update({
            transfer_portal: true,
            from_team: m.currentTeam,  // Lock in 2025 team
            team: m.newTeam,           // Set 2026 destination
            conference: newConference || null,
          })
          .eq("id", m.playerId);

        if (playerErr) throw playerErr;

        // 2. Delete returner predictions
        const { error: delErr } = await supabase
          .from("player_predictions")
          .delete()
          .in("id", m.predictionIds);

        if (delErr) throw delErr;

        // 3. Create blank transfer predictions (regular + xstats)
        for (const variant of ["regular", "xstats"]) {
          const { error: insErr } = await supabase
            .from("player_predictions")
            .insert({
              player_id: m.playerId,
              model_type: "transfer",
              variant,
              status: "active",
              season: 2025,
              locked: false,
            });

          if (insErr) throw insErr;
        }

        results.push(`${m.firstName} ${m.lastName}: ${m.currentTeam} → ${m.newTeam}`);
      } catch (err) {
        errors.push(`${m.firstName} ${m.lastName}: ${(err as Error).message}`);
      }
    }

    return new Response(JSON.stringify({
      mode: "execute",
      transitioned: results.length,
      results,
      errors,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
