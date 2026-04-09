import { supabase } from "@/integrations/supabase/client";

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

  // ─── Load existing 2025 returner predictions, indexed by player_id ───
  // We need the prediction id (to update), not just whether one exists.
  const existingPredByPlayerId = new Map<string, { id: string; from_avg: number | null }>();
  from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("player_predictions")
      .select("id, player_id, from_avg")
      .eq("season", season)
      .eq("model_type", "returner")
      .eq("variant", "regular")
      .range(from, from + 999);
    if (error) break;
    for (const r of data || []) {
      if ((r as any).player_id) existingPredByPlayerId.set((r as any).player_id, { id: (r as any).id, from_avg: (r as any).from_avg ?? null });
    }
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  console.log(`[createPredictions] ${existingPredByPlayerId.size} existing 2025 returner predictions`);

  // ─── Load Hitter Master with canonical scores by source_player_id ────
  // Read ba_plus/obp_plus/iso_plus directly (already computed by Compute Scores)
  // instead of recomputing here — keeps internals in sync with master.
  const hitterBySourceId = new Map<string, any>();
  const hitterByNameTeam = new Map<string, any>();
  from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("Hitter Master")
      .select("source_player_id, playerFullName, Team, AVG, OBP, SLG, ba_plus, obp_plus, iso_plus, overall_plus")
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

  // ─── Build update + insert plans ─────────────────────────────────────
  // - INSERT: a brand new prediction row for any hitter who doesn't have one
  // - UPDATE: backfill from_avg/from_obp/from_slg for existing stub predictions
  //   that have no inputs yet
  // Doesn't touch predictions that already have from_avg populated.
  const predsToInsert: any[] = [];
  const predsToUpdate: Array<{ id: string; patch: any }> = [];
  const internalsByPredId = new Map<string, { avg_power_rating: number | null; obp_power_rating: number | null; slg_power_rating: number | null }>();

  for (const player of allPlayers) {
    const hitter = (player.source_player_id ? hitterBySourceId.get(player.source_player_id) : null)
      ?? hitterByNameTeam.get(`${player.first_name} ${player.last_name}`.toLowerCase().trim() + "|" + (player.team || "").toLowerCase().trim());

    if (!hitter) continue;

    const existing = existingPredByPlayerId.get(player.id);
    const baPlus = (hitter as any).ba_plus ?? null;
    const obpPlus = (hitter as any).obp_plus ?? null;
    const isoPlus = (hitter as any).iso_plus ?? null;
    const overallPlus = (hitter as any).overall_plus ?? null;

    if (existing) {
      // Backfill stub if from_avg is missing
      if (existing.from_avg == null) {
        predsToUpdate.push({
          id: existing.id,
          patch: {
            from_avg: hitter.AVG,
            from_obp: hitter.OBP,
            from_slg: hitter.SLG,
            power_rating_plus: overallPlus != null ? Math.round(overallPlus) : null,
            locked: false,
          },
        });
        internalsByPredId.set(existing.id, {
          avg_power_rating: baPlus,
          obp_power_rating: obpPlus,
          slg_power_rating: isoPlus,
        });
      } else {
        // Already has inputs but maybe not internals — refresh internals only
        internalsByPredId.set(existing.id, {
          avg_power_rating: baPlus,
          obp_power_rating: obpPlus,
          slg_power_rating: isoPlus,
        });
      }
    } else {
      // No prediction at all — insert one
      predsToInsert.push({
        player_id: player.id,
        model_type: "returner",
        variant: "regular",
        season,
        status: "active",
        locked: false,
        class_transition: "SJ",
        dev_aggressiveness: 0.0,
        from_avg: hitter.AVG,
        from_obp: hitter.OBP,
        from_slg: hitter.SLG,
        power_rating_plus: overallPlus != null ? Math.round(overallPlus) : null,
      });
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
