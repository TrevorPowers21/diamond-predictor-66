import { supabase } from "@/integrations/supabase/client";
import { fetchParkFactorsMap, resolveMetricParkFactor } from "@/lib/parkFactors";

const CHUNK = 200;

type Result = {
  predictionsCreated: number;
  internalsCreated: number;
  errors: string[];
};

/**
 * Create returner predictions + internals for all players in the players table
 * who don't have predictions yet. Uses Hitter Master for stats and power ratings.
 */
export async function createPredictionsFromMaster(season = 2025): Promise<Result> {
  const result: Result = { predictionsCreated: 0, internalsCreated: 0, errors: [] };

  // ─── Load all players ────────────────────────────────────────────────
  console.log("[createPredictions] Loading players...");
  const allPlayers: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("players")
      .select("id, source_player_id, first_name, last_name, team, team_id, from_team, position")
      .range(from, from + 999);
    if (error) { result.errors.push(`Load players: ${error.message}`); return result; }
    allPlayers.push(...(data || []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  console.log(`[createPredictions] ${allPlayers.length} players loaded`);

  // ─── Load existing 2025 predictions (returner + transfer), indexed by player_id ───
  // We need the prediction id (to update), not just whether one exists.
  const existingPredByPlayerId = new Map<string, { id: string; from_avg: number | null }>();
  from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("player_predictions")
      .select("id, player_id, from_avg")
      .eq("season", season)
      .in("model_type", ["returner", "transfer"])
      .eq("variant", "regular")
      .range(from, from + 999);
    if (error) break;
    for (const r of data || []) {
      if ((r as any).player_id) existingPredByPlayerId.set((r as any).player_id, { id: (r as any).id, from_avg: (r as any).from_avg ?? null });
    }
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  console.log(`[createPredictions] ${existingPredByPlayerId.size} existing 2025 predictions`);

  // ─── Load Hitter Master with canonical scores by source_player_id ────
  // Read ba_plus/obp_plus/iso_plus directly (already computed by Compute Scores)
  // instead of recomputing here — keeps internals in sync with master.
  const hitterBySourceId = new Map<string, any>();
  const hitterByNameTeam = new Map<string, any>();
  from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("Hitter Master")
      .select("source_player_id, playerFullName, Team, TeamID, AVG, OBP, SLG, ba_plus, obp_plus, iso_plus, overall_plus, combined_used, blended_avg, blended_obp, blended_slg, blended_from_team, blended_from_team_id")
      .eq("Season", season)
      .range(from, from + 999);
    if (error) break;
    for (const r of data || []) {
      if (r.source_player_id) hitterBySourceId.set(r.source_player_id, r);
      const key = `${(r.playerFullName || "").toLowerCase().trim()}|${(r.Team || "").toLowerCase().trim()}`;
      hitterByNameTeam.set(key, r);
    }
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  console.log(`[createPredictions] ${hitterBySourceId.size} hitters loaded from master`);

  // ─── Load conference stats + park factors for transfer context ────────
  // Used when a noise-floor player transferred (blended_from_team ≠ current team)
  const { data: confStatsRaw } = await supabase
    .from("Conference Stats")
    .select(`"conference abbreviation", conference_id, season, AVG, OBP, ISO, Stuff_plus`)
    .eq("season", season);
  const confByAbbrev = new Map<string, { avg: number | null; obp: number | null; iso: number | null; stuff_plus: number | null }>();
  for (const row of (confStatsRaw || []) as any[]) {
    const key = (row["conference abbreviation"] || "").trim().toLowerCase();
    // Index by multiple normalizations to handle "A-10" vs "A10" etc.
    const keyNoDash = key.replace(/-/g, "");
    const entry = { avg: row.AVG, obp: row.OBP, iso: row.ISO, stuff_plus: row.Stuff_plus };
    if (key) confByAbbrev.set(key, entry);
    if (keyNoDash !== key) confByAbbrev.set(keyNoDash, entry);
  }

  // Teams Table for conference lookup by team name
  const { data: teamsRaw } = await supabase
    .from("Teams Table")
    .select("id, full_name, abbreviation, conference");
  const teamConfByName = new Map<string, string>();
  const teamConfById = new Map<string, string>();
  const teamIdByName = new Map<string, string>();
  for (const t of (teamsRaw || []) as any[]) {
    const abbr = (t.abbreviation || "").trim().toLowerCase();
    const full = (t.full_name || "").trim().toLowerCase();
    if (abbr && t.conference) teamConfByName.set(abbr, t.conference);
    if (full && t.conference) teamConfByName.set(full, t.conference);
    if (t.id && t.conference) teamConfById.set(t.id, t.conference);
    if (abbr && t.id) teamIdByName.set(abbr, t.id);
    if (full && t.id) teamIdByName.set(full, t.id);
  }

  const parkMap = await fetchParkFactorsMap();

  // Conference name → abbreviation aliases (Teams Table uses full names, Conference Stats uses abbreviations)
  const CONF_ALIASES: Record<string, string> = {
    "atlantic 10": "a-10", "atlantic 10 conference": "a-10", "a10": "a-10",
    "american athletic conference": "american", "american athletic": "american", "aac": "american",
    "atlantic coast conference": "acc",
    "southeastern conference": "sec",
    "big east conference": "big east",
    "big south conference": "big south",
    "southern conference": "socon",
    "metro atlantic athletic conference": "maac",
    "mid american conference": "mac", "mid-american conference": "mac",
    "missouri valley conference": "mvc",
    "northeast conference": "nec",
    "ohio valley conference": "ovc",
    "conference usa": "cusa",
    "southwestern athletic conference": "swac",
    "west coast conference": "wcc",
    "western athletic conference": "wac",
    "atlantic sun conference": "asun",
    "southland conference": "southland",
    "sun belt conference": "sbc", "sun belt": "sbc",
    "mountain west conference": "mwc", "mountain west": "mwc",
    "horizon league": "horizon",
    "patriot league": "patriot",
    "summit league": "the summit", "summit": "the summit",
    "coastal athletic association": "caa", "coastal athletic conference": "caa", "coastal athletic": "caa",
    "colonial athletic association": "caa",
    "big 12 conference": "big 12",
    "big ten conference": "big ten",
    "pac-12 conference": "pac-12",
  };

  const resolveConfKey = (conf: string | null): string | null => {
    if (!conf) return null;
    const key = conf.trim().toLowerCase();
    // Direct match first
    if (confByAbbrev.has(key)) return key;
    // Try without dashes
    const noDash = key.replace(/-/g, "");
    if (confByAbbrev.has(noDash)) return noDash;
    // Try alias
    const alias = CONF_ALIASES[key];
    if (alias && confByAbbrev.has(alias)) return alias;
    return null;
  };

  const getConfPlus = (team: string | null, stat: "avg" | "obp" | "iso" | "stuff_plus", teamId?: string | null) => {
    if (!team && !teamId) return null;
    // Try team ID first, then name
    const conf = (teamId ? teamConfById.get(teamId) : null) ?? (team ? teamConfByName.get(team.trim().toLowerCase()) : null);
    if (!conf) return null;
    const confKey = resolveConfKey(conf);
    if (!confKey) return null;
    const row = confByAbbrev.get(confKey);
    if (!row) return null;
    if (stat === "stuff_plus") return row.stuff_plus;
    const val = row[stat];
    return val != null ? Math.round((val / (stat === "avg" ? 0.280 : stat === "obp" ? 0.385 : 0.162)) * 100) : null;
  };

  const getAvgPark = (team: string | null, teamId?: string | null) => {
    if (!team && !teamId) return null;
    return resolveMetricParkFactor(teamId ?? null, "avg", parkMap, team);
  };

  // ─── Build update + insert plans ─────────────────────────────────────
  const predsToInsert: any[] = [];
  const predsToUpdate: Array<{ id: string; patch: any }> = [];
  const internalsByPredId = new Map<string, { avg_power_rating: number | null; obp_power_rating: number | null; slg_power_rating: number | null }>();
  const playerFromTeamUpdates: Array<{ id: string; from_team: string }> = [];

  for (const player of allPlayers) {
    const hitter = (player.source_player_id ? hitterBySourceId.get(player.source_player_id) : null)
      ?? hitterByNameTeam.get(`${player.first_name} ${player.last_name}`.toLowerCase().trim() + "|" + (player.team || "").toLowerCase().trim());

    if (!hitter) continue;

    const existing = existingPredByPlayerId.get(player.id);
    const baPlus = (hitter as any).ba_plus ?? null;
    const obpPlus = (hitter as any).obp_plus ?? null;
    const isoPlus = (hitter as any).iso_plus ?? null;
    const overallPlus = (hitter as any).overall_plus ?? null;

    // If blended_from_team exists and differs from player's current from_team, queue update
    const blendedFromTeam = (hitter as any).blended_from_team as string | null;
    const blendedFromTeamId = (hitter as any).blended_from_team_id as string | null;
    if (blendedFromTeam && blendedFromTeam !== player.from_team) {
      playerFromTeamUpdates.push({ id: player.id, from_team: blendedFromTeam });
    }

    // Determine if this is a noise-floor transfer (blended data from a different team)
    const isNoiseFloorTransfer = blendedFromTeam != null && blendedFromTeam.toLowerCase() !== (player.team || "").toLowerCase();
    const playerTeamId = player.team_id as string | null;

    if (existing) {
      const useBlended = !!(hitter as any).combined_used;
      const targetAvg = useBlended ? ((hitter as any).blended_avg ?? hitter.AVG) : hitter.AVG;
      const targetObp = useBlended ? ((hitter as any).blended_obp ?? hitter.OBP) : hitter.OBP;
      const targetSlg = useBlended ? ((hitter as any).blended_slg ?? hitter.SLG) : hitter.SLG;

      // Update from_avg/from_obp/from_slg if missing OR if blended stats differ from stored
      const needsStatUpdate = existing.from_avg == null || useBlended;
      if (needsStatUpdate) {
        const patch: any = {
          from_avg: targetAvg,
          from_obp: targetObp,
          from_slg: targetSlg,
          power_rating_plus: overallPlus != null ? Math.round(overallPlus) : null,
          locked: false,
        };
        // Flip to transfer model and populate conference/park context
        if (isNoiseFloorTransfer) {
          patch.model_type = "transfer";
          patch.from_avg_plus = getConfPlus(blendedFromTeam, "avg", blendedFromTeamId);
          patch.to_avg_plus = getConfPlus(player.team, "avg", playerTeamId);
          patch.from_obp_plus = getConfPlus(blendedFromTeam, "obp", blendedFromTeamId);
          patch.to_obp_plus = getConfPlus(player.team, "obp", playerTeamId);
          patch.from_slg_plus = getConfPlus(blendedFromTeam, "iso", blendedFromTeamId);
          patch.to_slg_plus = getConfPlus(player.team, "iso", playerTeamId);
          patch.from_stuff_plus = getConfPlus(blendedFromTeam, "stuff_plus", blendedFromTeamId);
          patch.to_stuff_plus = getConfPlus(player.team, "stuff_plus", playerTeamId);
          patch.from_park_factor = getAvgPark(blendedFromTeam, blendedFromTeamId);
          patch.to_park_factor = getAvgPark(player.team, playerTeamId);
        }
        predsToUpdate.push({ id: existing.id, patch });
      }
      internalsByPredId.set(existing.id, {
        avg_power_rating: baPlus,
        obp_power_rating: obpPlus,
        slg_power_rating: isoPlus,
      });
    } else {
      // No prediction at all — insert one
      const useBlended = !!(hitter as any).combined_used;
      const newPred: any = {
        player_id: player.id,
        model_type: isNoiseFloorTransfer ? "transfer" : "returner",
        variant: "regular",
        season,
        status: "active",
        locked: false,
        class_transition: "SJ",
        dev_aggressiveness: 0.0,
        from_avg: useBlended ? ((hitter as any).blended_avg ?? hitter.AVG) : hitter.AVG,
        from_obp: useBlended ? ((hitter as any).blended_obp ?? hitter.OBP) : hitter.OBP,
        from_slg: useBlended ? ((hitter as any).blended_slg ?? hitter.SLG) : hitter.SLG,
        power_rating_plus: overallPlus != null ? Math.round(overallPlus) : null,
      };
      if (isNoiseFloorTransfer) {
        newPred.from_avg_plus = getConfPlus(blendedFromTeam, "avg", blendedFromTeamId);
        newPred.to_avg_plus = getConfPlus(player.team, "avg", playerTeamId);
        newPred.from_obp_plus = getConfPlus(blendedFromTeam, "obp", blendedFromTeamId);
        newPred.to_obp_plus = getConfPlus(player.team, "obp", playerTeamId);
        newPred.from_slg_plus = getConfPlus(blendedFromTeam, "iso", blendedFromTeamId);
        newPred.to_slg_plus = getConfPlus(player.team, "iso", playerTeamId);
        newPred.from_stuff_plus = getConfPlus(blendedFromTeam, "stuff_plus", blendedFromTeamId);
        newPred.to_stuff_plus = getConfPlus(player.team, "stuff_plus", playerTeamId);
        newPred.from_park_factor = getAvgPark(blendedFromTeam, blendedFromTeamId);
        newPred.to_park_factor = getAvgPark(player.team, playerTeamId);
      }
      predsToInsert.push(newPred);
    }
  }

  // ─── INSERT new predictions ──────────────────────────────────────────
  const insertedPreds: Array<{ id: string; player_id: string }> = [];
  for (let i = 0; i < predsToInsert.length; i += CHUNK) {
    const chunk = predsToInsert.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("player_predictions")
      .insert(chunk)
      .select("id, player_id");
    if (error) {
      result.errors.push(`Prediction insert chunk ${i}: ${error.message}`);
    } else {
      insertedPreds.push(...(data || []));
      result.predictionsCreated += (data || []).length;
    }
  }
  // Map newly-inserted predictions back to player → internals
  const playerIdToHitter = new Map<string, any>();
  for (const player of allPlayers) {
    const hitter = player.source_player_id ? hitterBySourceId.get(player.source_player_id) : null;
    if (hitter) playerIdToHitter.set(player.id, hitter);
  }
  for (const pred of insertedPreds) {
    const hitter = playerIdToHitter.get(pred.player_id);
    if (hitter) {
      internalsByPredId.set(pred.id, {
        avg_power_rating: (hitter as any).ba_plus ?? null,
        obp_power_rating: (hitter as any).obp_plus ?? null,
        slg_power_rating: (hitter as any).iso_plus ?? null,
      });
    }
  }

  // ─── UPDATE existing stubs (with retry to bypass lock trigger) ───────
  console.log(`[createPredictions] Updating ${predsToUpdate.length} existing stubs...`);
  for (const u of predsToUpdate) {
    let success = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error } = await supabase
        .from("player_predictions")
        .update(u.patch)
        .eq("id", u.id);
      if (!error) { success = true; break; }
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
    if (success) {
      result.predictionsCreated += 1;
    } else {
      result.errors.push(`Update stub ${u.id} failed`);
    }
  }

  // ─── UPSERT internals for everything we touched ──────────────────────
  console.log(`[createPredictions] Upserting ${internalsByPredId.size} internals rows...`);
  const internalsRows = Array.from(internalsByPredId.entries()).map(([prediction_id, vals]) => ({
    prediction_id,
    ...vals,
  }));
  for (let i = 0; i < internalsRows.length; i += CHUNK) {
    const chunk = internalsRows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("player_prediction_internals")
      .upsert(chunk, { onConflict: "prediction_id" });
    if (error) {
      result.errors.push(`Internals chunk ${i}: ${error.message}`);
    } else {
      result.internalsCreated += chunk.length;
    }
  }

  // ─── UPDATE player from_team for blended players ─────────────────────
  if (playerFromTeamUpdates.length > 0) {
    console.log(`[createPredictions] Updating from_team for ${playerFromTeamUpdates.length} blended players...`);
    for (const u of playerFromTeamUpdates) {
      await supabase.from("players").update({ from_team: u.from_team }).eq("id", u.id);
    }
  }

  console.log(`[createPredictions] Done!`, result);
  return result;
}

/**
 * Create stub predictions for EVERY player (hitter or pitcher, current or
 * departed) so class_transition has a row to live on. Skips players who
 * already have a 2025 returner/regular prediction. Idempotent.
 */
export async function createStubPredictionsForAllPlayers(season = 2025): Promise<{ created: number; errors: string[] }> {
  const errors: string[] = [];
  let created = 0;

  console.log("[createStubPredictions] Loading players...");
  const allPlayers: Array<{ id: string }> = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("players")
      .select("id")
      .range(from, from + 999);
    if (error) { errors.push(`Load players: ${error.message}`); return { created, errors }; }
    allPlayers.push(...((data || []) as any));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  console.log(`[createStubPredictions] ${allPlayers.length} players loaded`);

  console.log("[createStubPredictions] Loading existing predictions to skip...");
  const existing = new Set<string>();
  from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("player_predictions")
      .select("player_id")
      .eq("season", season)
      .eq("model_type", "returner")
      .eq("variant", "regular")
      .range(from, from + 999);
    if (error) break;
    for (const r of data || []) existing.add(r.player_id);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  console.log(`[createStubPredictions] ${existing.size} existing predictions, will skip those`);

  const stubs = allPlayers
    .filter((p) => !existing.has(p.id))
    .map((p) => ({
      player_id: p.id,
      model_type: "returner",
      variant: "regular",
      season,
      status: "active",
      locked: false,
    }));

  console.log(`[createStubPredictions] Inserting ${stubs.length} stub predictions...`);
  for (let i = 0; i < stubs.length; i += CHUNK) {
    const chunk = stubs.slice(i, i + CHUNK);
    const { error } = await supabase.from("player_predictions").insert(chunk);
    if (error) {
      errors.push(`Stub chunk ${i}: ${error.message}`);
    } else {
      created += chunk.length;
    }
  }

  console.log(`[createStubPredictions] Done. Created ${created}, errors ${errors.length}`);
  return { created, errors };
}
