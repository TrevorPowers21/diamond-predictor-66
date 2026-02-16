import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

// Parse pipe-delimited table text into player objects
function parseRawText(text: string): Array<{ firstName: string; lastName: string; team: string }> {
  const lines = text.split("\n").filter(l => l.trim().startsWith("|") && !l.includes("---"));
  const players: Array<{ firstName: string; lastName: string; team: string }> = [];
  
  for (const line of lines) {
    const cols = line.split("|").map(c => c.trim()).filter(c => c);
    if (cols.length < 6) continue;
    // Skip header row
    if (cols[0] === "playerFullName") continue;
    // cols: [playerFullName, player(lastName), playerFirstName, pos, newestTeamName, newestTeamLocation]
    const lastName = cols[1];
    const firstName = cols[2];
    const team = cols[5]; // newestTeamLocation is the short name
    if (firstName && lastName && team) {
      players.push({ firstName, lastName, team });
    }
  }
  return players;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json();
    const { players: listPlayers, rawText, dryRun = true } = body;

    // Accept either structured players array or raw pipe-delimited text
    const parsedPlayers = listPlayers || (rawText ? parseRawText(rawText) : null);

    if (!parsedPlayers || !Array.isArray(parsedPlayers) || parsedPlayers.length === 0) {
      return new Response(JSON.stringify({ error: "players array or rawText required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build lookup: normalized "first|last" → team from list
    const listLookup = new Map<string, string>();
    for (const p of parsedPlayers) {
      const key = `${normalizeName(p.firstName)}|${normalizeName(p.lastName)}`;
      listLookup.set(key, p.team);
    }

    // Get all active returner predictions
    const { data: returners, error: retErr } = await supabase
      .from("player_predictions")
      .select(`
        id, player_id, variant, model_type, status, locked,
        p_avg, p_obp, p_slg, p_ops, p_iso, p_wrc, p_wrc_plus,
        from_avg, from_obp, from_slg, ev_score, barrel_score,
        whiff_score, chase_score, power_rating_plus, power_rating_score,
        from_park_factor, from_stuff_plus, from_avg_plus, from_obp_plus,
        from_slg_plus, dev_aggressiveness, class_transition,
        players!inner(id, first_name, last_name, team, conference, from_team)
      `)
      .eq("model_type", "returner")
      .eq("status", "active");

    if (retErr) throw retErr;

    // Group predictions by player and find mismatches
    const playerPreds = new Map<string, typeof returners>();
    for (const r of returners || []) {
      const pid = (r as any).players.id;
      if (!playerPreds.has(pid)) playerPreds.set(pid, []);
      playerPreds.get(pid)!.push(r);
    }

    const mismatches: Array<{
      playerId: string;
      firstName: string;
      lastName: string;
      currentTeam: string;
      newTeam: string;
      predictionIds: string[];
    }> = [];

    for (const [playerId, preds] of playerPreds) {
      const player = (preds[0] as any).players;
      const key = `${normalizeName(player.first_name)}|${normalizeName(player.last_name)}`;
      
      if (!listLookup.has(key)) continue;
      
      const listTeam = listLookup.get(key)!;
      const dbTeam = player.team || "";
      
      if (normalizeTeam(dbTeam) === normalizeTeam(listTeam)) continue;
      
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
        totalParsed: parsedPlayers.length,
        returnersChecked: playerPreds.size,
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

    const { data: allTeams } = await supabase.from("teams").select("name, conference");
    const teamConferenceMap = new Map<string, string>();
    for (const t of allTeams || []) {
      teamConferenceMap.set(normalizeTeam(t.name), t.conference || "");
      teamConferenceMap.set(t.name.toLowerCase(), t.conference || "");
    }

    for (const m of mismatches) {
      try {
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
            from_team: m.currentTeam,
            team: m.newTeam,
            conference: newConference || null,
          })
          .eq("id", m.playerId);

        if (playerErr) throw playerErr;

        // 2. Snapshot locked stats from returner predictions before deleting
        const statsByVariant = new Map<string, Record<string, unknown>>();
        for (const pred of preds) {
          const p = pred as any;
          statsByVariant.set(p.variant, {
            p_avg: p.p_avg, p_obp: p.p_obp, p_slg: p.p_slg, p_ops: p.p_ops,
            p_iso: p.p_iso, p_wrc: p.p_wrc, p_wrc_plus: p.p_wrc_plus,
            from_avg: p.from_avg, from_obp: p.from_obp, from_slg: p.from_slg,
            ev_score: p.ev_score, barrel_score: p.barrel_score,
            whiff_score: p.whiff_score, chase_score: p.chase_score,
            power_rating_plus: p.power_rating_plus, power_rating_score: p.power_rating_score,
            from_park_factor: p.from_park_factor, from_stuff_plus: p.from_stuff_plus,
            from_avg_plus: p.from_avg_plus, from_obp_plus: p.from_obp_plus,
            from_slg_plus: p.from_slg_plus, dev_aggressiveness: p.dev_aggressiveness,
            class_transition: p.class_transition,
          });
        }

        // 3. Delete returner predictions
        const { error: delErr } = await supabase
          .from("player_predictions")
          .delete()
          .in("id", m.predictionIds);

        if (delErr) throw delErr;

        // 4. Create transfer predictions carrying over locked stats
        for (const variant of ["regular", "xstats"]) {
          const stats = statsByVariant.get(variant) || {};
          const { error: insErr } = await supabase
            .from("player_predictions")
            .insert({
              player_id: m.playerId,
              model_type: "transfer",
              variant,
              status: "active",
              season: 2025,
              locked: true,
              ...stats,
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
