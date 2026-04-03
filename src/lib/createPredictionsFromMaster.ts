import { supabase } from "@/integrations/supabase/client";
import { computeHitterPowerRatings } from "@/lib/powerRatings";

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
      .select("id, source_player_id, first_name, last_name, team, position")
      .range(from, from + 999);
    if (error) { result.errors.push(`Load players: ${error.message}`); return result; }
    allPlayers.push(...(data || []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  console.log(`[createPredictions] ${allPlayers.length} players loaded`);

  // ─── Load existing prediction player_ids to skip ─────────────────────
  const existingPredPlayerIds = new Set<string>();
  from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("player_predictions")
      .select("player_id")
      .eq("season", season)
      .range(from, from + 999);
    if (error) break;
    for (const r of data || []) existingPredPlayerIds.add(r.player_id);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  console.log(`[createPredictions] ${existingPredPlayerIds.size} existing predictions to skip`);

  // ─── Load Hitter Master by source_player_id ──────────────────────────
  const hitterBySourceId = new Map<string, any>();
  const hitterByNameTeam = new Map<string, any>();
  from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("Hitter Master")
      .select("source_player_id, playerFullName, Team, AVG, OBP, SLG, contact, line_drive, avg_exit_velo, pop_up, bb, chase, barrel, ev90, pull, la_10_30, gb")
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

  // ─── Determine which players are pitchers ────────────────────────────
  const isPitcher = (pos: string | null) => {
    if (!pos) return false;
    return /^(SP|RP|CL|P|LHP|RHP|TWP)$/i.test(pos.trim());
  };

  // ─── Create predictions ──────────────────────────────────────────────
  const predsToInsert: any[] = [];
  const powerByPlayerId = new Map<string, { baPlus: number | null; obpPlus: number | null; isoPlus: number | null; overallPlus: number | null }>();

  for (const player of allPlayers) {
    if (existingPredPlayerIds.has(player.id)) continue;
    if (isPitcher(player.position)) continue; // Pitching projections are computed on the fly

    // Find hitter data
    const hitter = (player.source_player_id ? hitterBySourceId.get(player.source_player_id) : null)
      ?? hitterByNameTeam.get(`${player.first_name} ${player.last_name}`.toLowerCase().trim() + "|" + (player.team || "").toLowerCase().trim());

    if (!hitter) continue;

    // Compute power ratings
    const power = computeHitterPowerRatings({
      contact: hitter.contact, lineDrive: hitter.line_drive,
      avgExitVelo: hitter.avg_exit_velo, popUp: hitter.pop_up,
      bb: hitter.bb, chase: hitter.chase,
      barrel: hitter.barrel, ev90: hitter.ev90,
      pull: hitter.pull, la10_30: hitter.la_10_30, gb: hitter.gb,
    });

    powerByPlayerId.set(player.id, power);

    predsToInsert.push({
      player_id: player.id,
      model_type: "returner",
      variant: "regular",
      season,
      status: "active",
      locked: true,
      class_transition: "SJ",
      dev_aggressiveness: 0.0,
      from_avg: hitter.AVG,
      from_obp: hitter.OBP,
      from_slg: hitter.SLG,
      power_rating_plus: power.overallPlus != null ? Math.round(power.overallPlus) : 100,
    });
  }

  console.log(`[createPredictions] Creating ${predsToInsert.length} predictions...`);

  const insertedPreds: Array<{ id: string; player_id: string }> = [];
  for (let i = 0; i < predsToInsert.length; i += CHUNK) {
    const chunk = predsToInsert.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("player_predictions")
      .insert(chunk)
      .select("id, player_id");
    if (error) {
      result.errors.push(`Prediction chunk ${i}: ${error.message}`);
    } else {
      insertedPreds.push(...(data || []));
      result.predictionsCreated += (data || []).length;
    }
  }

  // ─── Create internals (power ratings per prediction) ─────────────────
  console.log(`[createPredictions] Creating ${insertedPreds.length} internals...`);

  const internalsToInsert = insertedPreds.map((pred) => {
    const power = powerByPlayerId.get(pred.player_id);
    return {
      prediction_id: pred.id,
      avg_power_rating: power?.baPlus ?? null,
      obp_power_rating: power?.obpPlus ?? null,
      slg_power_rating: power?.isoPlus ?? null,
    };
  });

  for (let i = 0; i < internalsToInsert.length; i += CHUNK) {
    const chunk = internalsToInsert.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("player_prediction_internals")
      .upsert(chunk, { onConflict: "prediction_id" });
    if (error) {
      result.errors.push(`Internals chunk ${i}: ${error.message}`);
    } else {
      result.internalsCreated += chunk.length;
    }
  }

  console.log(`[createPredictions] Done!`, result);
  return result;
}
