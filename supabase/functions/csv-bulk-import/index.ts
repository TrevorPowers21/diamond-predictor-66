import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parsePercent(val: string | undefined): number | null {
  if (!val) return null;
  const cleaned = val.replace("%", "").trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function parseNum(val: string | undefined): number | null {
  if (!val) return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

/** Derive class transition from class year string */
function deriveClassTransition(classYear: string | null): string {
  if (!classYear) return "SJ";
  const cy = classYear.toLowerCase().trim();
  if (cy.startsWith("fr")) return "FS";
  if (cy.startsWith("so")) return "SJ";
  if (cy.startsWith("jr") || cy.startsWith("ju")) return "JS";
  if (cy.startsWith("sr") || cy.startsWith("se") || cy.startsWith("gr") || cy.startsWith("gs")) return "GR";
  return "SJ";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceKey);

    const { csv_data, model_type = "returner", season = 2025, mark_missing_departed = false } = await req.json();

    if (!csv_data || typeof csv_data !== "string") {
      return new Response(
        JSON.stringify({ error: "csv_data is required as a string" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate model_type
    if (!["returner", "transfer"].includes(model_type)) {
      return new Response(
        JSON.stringify({ error: "model_type must be 'returner' or 'transfer'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const lines = csv_data.split(/\r?\n/).filter((l: string) => l.trim());
    if (lines.length < 2) {
      return new Response(
        JSON.stringify({ error: "CSV must have a header row and at least one data row" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const headers = parseCsvLine(lines[0]).map((h: string) => h.toLowerCase().trim());

    // Auto-detect column indices
    const colMap: Record<string, number> = {};
    for (let i = 0; i < headers.length; i++) {
      colMap[headers[i]] = i;
    }

    // Determine first/last name columns
    const firstNameIdx = colMap["playerfirstname"] ?? colMap["firstname"] ?? colMap["first_name"] ?? colMap["first name"] ?? -1;
    const lastNameIdx = colMap["player"] ?? colMap["lastname"] ?? colMap["last_name"] ?? colMap["last name"] ?? -1;
    const fullNameIdx = colMap["playerfullname"] ?? colMap["formattedname"] ?? colMap["full_name"] ?? colMap["name"] ?? -1;

    if (firstNameIdx === -1 && fullNameIdx === -1) {
      return new Response(
        JSON.stringify({ error: "CSV must have name columns (playerFirstName/player or playerFullName)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Stat columns
    const baIdx = colMap["ba"] ?? colMap["batting_avg"] ?? colMap["avg"] ?? -1;
    const obpIdx = colMap["obp"] ?? colMap["on_base_pct"] ?? -1;
    const slgIdx = colMap["slg"] ?? colMap["slugging_pct"] ?? -1;
    const evIdx = colMap["exitvel"] ?? colMap["exit_vel"] ?? colMap["ev"] ?? -1;
    const barrelIdx = colMap["barrel%"] ?? colMap["barrel_pct"] ?? colMap["barrel"] ?? -1;
    const missIdx = colMap["miss%"] ?? colMap["whiff%"] ?? colMap["miss_pct"] ?? colMap["whiff_pct"] ?? -1;
    const chaseIdx = colMap["chase%"] ?? colMap["chase_pct"] ?? colMap["chase"] ?? -1;
    const posIdx = colMap["pos"] ?? colMap["position"] ?? -1;
    const teamIdx = colMap["newestteamname"] ?? colMap["team"] ?? -1;
    const teamAbbrIdx = colMap["newestteamabbrevname"] ?? colMap["team_abbr"] ?? -1;
    const batsIdx = colMap["batshand"] ?? colMap["handedness"] ?? colMap["bats"] ?? -1;
    const classIdx = colMap["class_year"] ?? colMap["class"] ?? colMap["year"] ?? colMap["eligibility"] ?? -1;

    // Fetch all existing players for matching
    const { data: existingPlayers } = await db
      .from("players")
      .select("id, first_name, last_name, team, class_year");

    const playerMap = new Map<string, { id: string; class_year: string | null }>();
    for (const p of existingPlayers || []) {
      const key = `${p.first_name.toLowerCase()}|${p.last_name.toLowerCase()}`;
      playerMap.set(key, { id: p.id, class_year: p.class_year });
    }

    let created = 0;
    let matched = 0;
    let skipped = 0;
    let predictions_created = 0;
    let departed_count = 0;
    const importedPlayerIds = new Set<string>();
    const errors: string[] = [];

    // Process in batches
    const dataRows = lines.slice(1);
    const BATCH_SIZE = 50;

    for (let batchStart = 0; batchStart < dataRows.length; batchStart += BATCH_SIZE) {
      const batch = dataRows.slice(batchStart, batchStart + BATCH_SIZE);

      for (const line of batch) {
        const cols = parseCsvLine(line);
        if (cols.length < 3) { skipped++; continue; }

        let firstName = "";
        let lastName = "";

        if (firstNameIdx !== -1 && lastNameIdx !== -1) {
          firstName = cols[firstNameIdx] || "";
          lastName = cols[lastNameIdx] || "";
        } else if (fullNameIdx !== -1) {
          const parts = (cols[fullNameIdx] || "").split(/\s+/);
          firstName = parts[0] || "";
          lastName = parts.slice(1).join(" ") || "";
        }

        if (!firstName || !lastName) { skipped++; continue; }

        const matchKey = `${firstName.toLowerCase()}|${lastName.toLowerCase()}`;
        let playerId: string;
        let classYear: string | null = classIdx !== -1 ? cols[classIdx] || null : null;

        const existing = playerMap.get(matchKey);
        if (existing) {
          playerId = existing.id;
          matched++;
          // Use existing class_year if CSV doesn't have one
          if (!classYear) classYear = existing.class_year;
        } else {
          // Create player
          const playerRecord: Record<string, unknown> = {
            first_name: firstName,
            last_name: lastName,
            position: posIdx !== -1 ? cols[posIdx] || null : null,
            team: teamIdx !== -1 ? cols[teamIdx] || null : (teamAbbrIdx !== -1 ? cols[teamAbbrIdx] || null : null),
            handedness: batsIdx !== -1 ? cols[batsIdx] || null : null,
            class_year: classYear,
            transfer_portal: model_type === "transfer",
          };

          const { data: newPlayer, error: pErr } = await db
            .from("players")
            .insert(playerRecord)
            .select("id")
            .single();

          if (pErr || !newPlayer) {
            errors.push(`Failed to create player ${firstName} ${lastName}: ${pErr?.message}`);
            skipped++;
            continue;
          }
          playerId = newPlayer.id;
          playerMap.set(matchKey, { id: playerId, class_year: classYear });
          created++;
        }

        // Build prediction
        const ba = parseNum(cols[baIdx]);
        const obp = parseNum(cols[obpIdx]);
        const slg = parseNum(cols[slgIdx]);
        const ev = parseNum(cols[evIdx]);
        const barrel = parsePercent(cols[barrelIdx]);
        const miss = parsePercent(cols[missIdx]);
        const chase = parsePercent(cols[chaseIdx]);

        const classTransition = deriveClassTransition(classYear);

        const predRecord: Record<string, unknown> = {
          player_id: playerId,
          model_type,
          variant: "regular",
          season,
          status: "active",
          class_transition: classTransition,
          dev_aggressiveness: 0.5,
          from_avg: ba,
          from_obp: obp,
          from_slg: slg,
          ev_score: ev,
          barrel_score: barrel,
          whiff_score: miss,
          chase_score: chase,
          p_avg: ba,
          p_obp: obp,
          p_slg: slg,
          p_ops: obp != null && slg != null ? Math.round((obp + slg) * 1000) / 1000 : null,
          p_iso: ba != null && slg != null ? Math.round((slg - ba) * 1000) / 1000 : null,
        };

        importedPlayerIds.add(playerId);

        const { error: predErr } = await db
          .from("player_predictions")
          .upsert(predRecord, {
            onConflict: "player_id,model_type,variant,season",
          });

        if (predErr) {
          errors.push(`Prediction for ${firstName} ${lastName}: ${predErr.message}`);
        } else {
          predictions_created++;
        }
      }
    }

    // Mark missing players as departed if requested
    if (mark_missing_departed && importedPlayerIds.size > 0) {
      // Get all active predictions for this model_type/season/variant
      const { data: allPreds } = await db
        .from("player_predictions")
        .select("id, player_id")
        .eq("model_type", model_type)
        .eq("variant", "regular")
        .eq("season", season)
        .eq("status", "active");

      const toDepart = (allPreds || []).filter(
        (p: { id: string; player_id: string }) => !importedPlayerIds.has(p.player_id)
      );

      if (toDepart.length > 0) {
        const departIds = toDepart.map((p: { id: string }) => p.id);
        // Update in chunks of 100
        for (let i = 0; i < departIds.length; i += 100) {
          const chunk = departIds.slice(i, i + 100);
          await db
            .from("player_predictions")
            .update({ status: "departed" })
            .in("id", chunk);
        }
        departed_count = toDepart.length;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        players_matched: matched,
        players_created: created,
        predictions_created,
        departed: departed_count,
        skipped,
        total_rows: dataRows.length,
        errors: errors.slice(0, 20),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("csv-bulk-import error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
