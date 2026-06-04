import { supabase } from "@/integrations/supabase/client";
import { classTransitionFromYearOrDefault } from "@/lib/classTransitionUtils";
import { CURRENT_SEASON, PROJECTION_SEASON } from "@/lib/seasonConstants";

const CHUNK = 200;

type Result = {
  predictionsCreated: number;
  internalsCreated: number;
  errors: string[];
};

/**
 * Create returner predictions + internals for all players in the players table
 * who don't have predictions yet. Uses Hitter Master for stats and power ratings.
 *
 * Season convention (locked 2026-05-23):
 * - `dataSeason`       — which Hitter/Pitching Master snapshot to READ (actuals on the field, default CURRENT_SEASON)
 * - `projectionSeason` — which year to WRITE predictions FOR (forward-looking, default PROJECTION_SEASON)
 *
 * Legacy callers that pass a single positional arg get treated as `dataSeason`
 * — that matches their intent (they were passing the actuals year). The
 * projectionSeason defaults forward to the next year automatically.
 */
export async function createPredictionsFromMaster(
  dataSeason: number = CURRENT_SEASON,
  projectionSeason: number = PROJECTION_SEASON,
): Promise<Result> {
  // `season` retained as a local name throughout the body to minimize diff;
  // it now refers to the WRITE season (projection year). All Master-table
  // reads explicitly use `dataSeason`.
  const season = projectionSeason;
  const result: Result = { predictionsCreated: 0, internalsCreated: 0, errors: [] };
  console.time("[CreatePreds] TOTAL");

  // ─── Load all players ────────────────────────────────────────────────
  console.time("[CreatePreds] 1. load players");
  console.log("[createPredictions] Loading players...");
  const allPlayers: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("players")
      .select("id, source_player_id, first_name, last_name, team, team_id, from_team, position, class_year, division")
      .range(from, from + 999);
    if (error) { result.errors.push(`Load players: ${error.message}`); return result; }
    allPlayers.push(...(data || []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  console.log(`[createPredictions] ${allPlayers.length} players loaded`);
  console.timeEnd("[CreatePreds] 1. load players");

  // ─── Load existing 2025 predictions (returner + transfer), indexed by player_id ───
  console.time("[CreatePreds] 2. load existing predictions");
  // We need the prediction id (to update), not just whether one exists.
  const existingPredByPlayerId = new Map<string, { id: string; from_avg: number | null; from_era: number | null }>();
  from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("player_predictions")
      .select("id, player_id, from_avg, from_era")
      .eq("season", season)
      .in("model_type", ["returner", "transfer"])
      .eq("variant", "regular")
      .range(from, from + 999);
    if (error) break;
    for (const r of data || []) {
      if ((r as any).player_id) existingPredByPlayerId.set((r as any).player_id, { id: (r as any).id, from_avg: (r as any).from_avg ?? null, from_era: (r as any).from_era ?? null });
    }
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  console.log(`[createPredictions] ${existingPredByPlayerId.size} existing 2025 predictions`);
  console.timeEnd("[CreatePreds] 2. load existing predictions");

  // ─── Load Hitter Master with canonical scores by source_player_id ────
  console.time("[CreatePreds] 3. load Hitter Master");
  // Read ba_power_rating/obp_power_rating/iso_power_rating directly (already computed by Compute Scores)
  // instead of recomputing here — keeps internals in sync with master.
  const hitterBySourceId = new Map<string, any>();
  const hitterByNameTeam = new Map<string, any>();
  from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("Hitter Master")
      .select("source_player_id, playerFullName, Team, TeamID, AVG, OBP, SLG, ba_power_rating, obp_power_rating, iso_power_rating, overall_power_rating, combined_used, blended_avg, blended_obp, blended_slg, blended_from_team, blended_from_team_id")
      .eq("Season", dataSeason)
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
  console.timeEnd("[CreatePreds] 3. load Hitter Master");

  // ─── Load Pitching Master with canonical scores by source_player_id ──
  console.time("[CreatePreds] 4. load Pitching Master");
  const pitcherBySourceId = new Map<string, any>();
  const pitcherByNameTeam = new Map<string, any>();
  from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("Pitching Master")
      .select("source_player_id, playerFullName, Team, TeamID, ERA, FIP, WHIP, K9, BB9, HR9, era_pr_plus, fip_pr_plus, whip_pr_plus, overall_pr_plus, combined_used, blended_era, blended_fip, blended_whip, blended_k9, blended_bb9, blended_hr9, blended_from_team, blended_from_team_id")
      .eq("Season", dataSeason)
      .range(from, from + 999);
    if (error) break;
    for (const r of data || []) {
      if (r.source_player_id) pitcherBySourceId.set(r.source_player_id, r);
      const key = `${(r.playerFullName || "").toLowerCase().trim()}|${(r.Team || "").toLowerCase().trim()}`;
      pitcherByNameTeam.set(key, r);
    }
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  console.log(`[createPredictions] ${pitcherBySourceId.size} pitchers loaded from master`);
  console.timeEnd("[CreatePreds] 4. load Pitching Master");

  // ─── Build update + insert plans ─────────────────────────────────────
  console.time("[CreatePreds] 6. build update+insert plans (in-memory)");
  const predsToInsert: any[] = [];
  const predsToUpdate: Array<{ id: string; patch: any }> = [];
  // Track queued inserts by player_id so the pitcher loop can merge its
  // from_era / from_fip / ... fields into the same row for two-way players
  // (otherwise we'd insert two rows per TWP).
  const pendingInsertByPlayerId = new Map<string, any>();
  const internalsByPredId = new Map<string, { avg_power_rating: number | null; obp_power_rating: number | null; slg_power_rating: number | null }>();
  const playerFromTeamUpdates: Array<{ id: string; from_team: string }> = [];

  for (const player of allPlayers) {
    const hitter = (player.source_player_id ? hitterBySourceId.get(player.source_player_id) : null)
      ?? hitterByNameTeam.get(`${player.first_name} ${player.last_name}`.toLowerCase().trim() + "|" + (player.team || "").toLowerCase().trim());

    if (!hitter) continue;

    const existing = existingPredByPlayerId.get(player.id);
    // JUCO hitters: Hitter Master PRs are computed but NOT usable inputs for
    // the D1 returner equation. Skip writing them so recalcReturner has
    // nothing to mistakenly multiply against; the JUCO returner branch in
    // backfill-2027-hitter-returners.ts will passthrough actuals instead.
    const isJuco = (player as any).division === "NJCAA_D1";
    const baPlus = isJuco ? null : ((hitter as any).ba_power_rating ?? null);
    const obpPlus = isJuco ? null : ((hitter as any).obp_power_rating ?? null);
    const isoPlus = isJuco ? null : ((hitter as any).iso_power_rating ?? null);
    const overallPlus = isJuco ? null : ((hitter as any).overall_power_rating ?? null);

    // If blended_from_team exists and differs from player's current from_team, queue update.
    // Note: blend math runs upstream (combineStats) and writes to blended_avg/blended_era/etc.
    // We propagate blended_from_team to players.from_team so the profile/UI can show prior school,
    // but we DO NOT flip the prediction to model_type="transfer" — every player stays a returner
    // by default. Transfer rows are created only by coach-triggered actions (target board / portal sim).
    // JUCO: blend columns are intentionally never populated for JUCO Hitter Master rows
    // (no usable prior-school data), so this skip is a no-op for JUCO but explicit for safety.
    const blendedFromTeam = isJuco ? null : ((hitter as any).blended_from_team as string | null);
    if (blendedFromTeam && blendedFromTeam !== player.from_team) {
      playerFromTeamUpdates.push({ id: player.id, from_team: blendedFromTeam });
    }

    // JUCO: force useBlended=false unconditionally so we never pick up stale or
    // garbage blended_* values. Also force from_* refresh every run so the raw
    // 2026 actuals stay the source of truth.
    if (existing) {
      const useBlended = isJuco ? false : !!(hitter as any).combined_used;
      const targetAvg = useBlended ? ((hitter as any).blended_avg ?? hitter.AVG) : hitter.AVG;
      const targetObp = useBlended ? ((hitter as any).blended_obp ?? hitter.OBP) : hitter.OBP;
      const targetSlg = useBlended ? ((hitter as any).blended_slg ?? hitter.SLG) : hitter.SLG;

      // Update from_avg/from_obp/from_slg if missing OR if blended stats differ from stored.
      // JUCO always refreshes so stale from_* from prior blended runs gets overwritten.
      const needsStatUpdate = isJuco || existing.from_avg == null || useBlended;
      if (needsStatUpdate) {
        const patch: any = {
          from_avg: targetAvg,
          from_obp: targetObp,
          from_slg: targetSlg,
          power_rating_plus: overallPlus != null ? Math.round(overallPlus) : null,
          locked: false,
        };
        predsToUpdate.push({ id: existing.id, patch });
      }
      internalsByPredId.set(existing.id, {
        ...(internalsByPredId.get(existing.id) ?? {}),
        avg_power_rating: baPlus,
        obp_power_rating: obpPlus,
        slg_power_rating: isoPlus,
      });
    } else {
      // No prediction at all — insert one as a returner.
      const useBlended = isJuco ? false : !!(hitter as any).combined_used;
      const newPred: any = {
        player_id: player.id,
        model_type: "returner",
        variant: "regular",
        season,
        status: "active",
        locked: false,
        class_transition: classTransitionFromYearOrDefault((player as any).class_year),
        dev_aggressiveness: 0.0,
        from_avg: useBlended ? ((hitter as any).blended_avg ?? hitter.AVG) : hitter.AVG,
        from_obp: useBlended ? ((hitter as any).blended_obp ?? hitter.OBP) : hitter.OBP,
        from_slg: useBlended ? ((hitter as any).blended_slg ?? hitter.SLG) : hitter.SLG,
        power_rating_plus: overallPlus != null ? Math.round(overallPlus) : null,
      };
      predsToInsert.push(newPred);
      pendingInsertByPlayerId.set(player.id, newPred);
    }
  }

  // ─── Pitcher loop — mirrors hitter logic exactly ──────────────────────
  // Runs for EVERY player with Pitching Master data, even when the hitter
  // loop already touched the row. For two-way players (is_twp on `players`)
  // we want both halves on the same prediction row so the engine + UI can
  // read canonical hitter AND pitcher projections from one record.
  for (const player of allPlayers) {
    const pitcher = (player.source_player_id ? pitcherBySourceId.get(player.source_player_id) : null)
      ?? pitcherByNameTeam.get(`${player.first_name} ${player.last_name}`.toLowerCase().trim() + "|" + (player.team || "").toLowerCase().trim());

    if (!pitcher) continue;

    const existing = existingPredByPlayerId.get(player.id);
    const eraPrPlus = (pitcher as any).era_pr_plus ?? null;
    const fipPrPlus = (pitcher as any).fip_pr_plus ?? null;
    const whipPrPlus = (pitcher as any).whip_pr_plus ?? null;
    const overallPrPlus = (pitcher as any).overall_pr_plus ?? null;

    // Propagate blended_from_team to players.from_team for display only. As in
    // the hitter loop, we never flip model_type to "transfer" from the cascade.
    const blendedFromTeam = (pitcher as any).blended_from_team as string | null;
    if (blendedFromTeam && blendedFromTeam !== player.from_team) {
      playerFromTeamUpdates.push({ id: player.id, from_team: blendedFromTeam });
    }

    if (existing) {
      const useBlended = !!(pitcher as any).combined_used;
      const targetEra = useBlended ? ((pitcher as any).blended_era ?? pitcher.ERA) : pitcher.ERA;
      const targetFip = useBlended ? ((pitcher as any).blended_fip ?? pitcher.FIP) : pitcher.FIP;
      const targetWhip = useBlended ? ((pitcher as any).blended_whip ?? pitcher.WHIP) : pitcher.WHIP;
      const targetK9 = useBlended ? ((pitcher as any).blended_k9 ?? pitcher.K9) : pitcher.K9;
      const targetBb9 = useBlended ? ((pitcher as any).blended_bb9 ?? pitcher.BB9) : pitcher.BB9;
      const targetHr9 = useBlended ? ((pitcher as any).blended_hr9 ?? pitcher.HR9) : pitcher.HR9;

      const needsStatUpdate = (existing as any).from_era == null || useBlended;
      if (needsStatUpdate) {
        const patch: any = {
          from_era: targetEra,
          from_fip: targetFip,
          from_whip: targetWhip,
          from_k9: targetK9,
          from_bb9: targetBb9,
          from_hr9: targetHr9,
          power_rating_plus: overallPrPlus != null ? Math.round(overallPrPlus) : null,
          locked: false,
        };
        predsToUpdate.push({ id: existing.id, patch });
      }
      internalsByPredId.set(existing.id, {
        ...(internalsByPredId.get(existing.id) ?? {}),
        era_power_rating: eraPrPlus,
        fip_power_rating: fipPrPlus,
        whip_power_rating: whipPrPlus,
      } as any);
    } else {
      const useBlended = !!(pitcher as any).combined_used;
      const pitcherFields: any = {
        from_era: useBlended ? ((pitcher as any).blended_era ?? pitcher.ERA) : pitcher.ERA,
        from_fip: useBlended ? ((pitcher as any).blended_fip ?? pitcher.FIP) : pitcher.FIP,
        from_whip: useBlended ? ((pitcher as any).blended_whip ?? pitcher.WHIP) : pitcher.WHIP,
        from_k9: useBlended ? ((pitcher as any).blended_k9 ?? pitcher.K9) : pitcher.K9,
        from_bb9: useBlended ? ((pitcher as any).blended_bb9 ?? pitcher.BB9) : pitcher.BB9,
        from_hr9: useBlended ? ((pitcher as any).blended_hr9 ?? pitcher.HR9) : pitcher.HR9,
      };
      // If the hitter loop already queued an insert for this player (TWP),
      // merge the pitcher fields onto the same record instead of pushing a
      // second row. Otherwise queue a new pitcher-only insert.
      const pendingHitterInsert = pendingInsertByPlayerId.get(player.id);
      if (pendingHitterInsert) {
        Object.assign(pendingHitterInsert, pitcherFields);
        if (overallPrPlus != null) {
          // Prefer pitcher overall_pr_plus when both sides have a value — it
          // tracks the run-prevention side which the projection engine reads
          // for K9/BB9/HR9 fallbacks.
          pendingHitterInsert.power_rating_plus = Math.round(overallPrPlus);
        }
        continue;
      }
      const newPred: any = {
        player_id: player.id,
        model_type: "returner",
        variant: "regular",
        season,
        status: "active",
        locked: false,
        class_transition: classTransitionFromYearOrDefault((player as any).class_year),
        dev_aggressiveness: 0.0,
        ...pitcherFields,
        power_rating_plus: overallPrPlus != null ? Math.round(overallPrPlus) : null,
      };
      predsToInsert.push(newPred);
    }
  }

  console.timeEnd("[CreatePreds] 6. build update+insert plans (in-memory)");

  // ─── INSERT new predictions ──────────────────────────────────────────
  console.time("[CreatePreds] 7. INSERT new predictions");
  const insertedPreds: Array<{ id: string; player_id: string }> = [];
  for (let i = 0; i < predsToInsert.length; i += CHUNK) {
    const chunk = predsToInsert.slice(i, i + CHUNK);
    // UPSERT instead of INSERT — the partial unique index on
    // (player_id, model_type, variant, season) WHERE customer_team_id IS NULL
    // prevents duplicate regular rows. ignoreDuplicates:false means we update
    // the existing row if there's a conflict (e.g. re-run after CSV correction).
    const { data, error } = await supabase
      .from("player_predictions")
      .upsert(chunk, { onConflict: "player_id,model_type,variant,season", ignoreDuplicates: false })
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
  const playerIdToPitcher = new Map<string, any>();
  for (const player of allPlayers) {
    const hitter = player.source_player_id ? hitterBySourceId.get(player.source_player_id) : null;
    if (hitter) playerIdToHitter.set(player.id, hitter);
    const pitcher = player.source_player_id ? pitcherBySourceId.get(player.source_player_id) : null;
    if (pitcher) playerIdToPitcher.set(player.id, pitcher);
  }
  for (const pred of insertedPreds) {
    // Build one merged partial so two-way players get BOTH hitter and pitcher
    // power-rating columns on the same internals row. Either-or earlier (with
    // a `continue` after the hitter case) silently left TWPs with no
    // pitcher-side internals on insert — the mirror of the Map-overwrite bug
    // above on the update path.
    const partial: any = {};
    const hitter = playerIdToHitter.get(pred.player_id);
    if (hitter) {
      partial.avg_power_rating = (hitter as any).ba_power_rating ?? null;
      partial.obp_power_rating = (hitter as any).obp_power_rating ?? null;
      partial.slg_power_rating = (hitter as any).iso_power_rating ?? null;
    }
    const pitcher = playerIdToPitcher.get(pred.player_id);
    if (pitcher) {
      partial.era_power_rating = (pitcher as any).era_pr_plus ?? null;
      partial.fip_power_rating = (pitcher as any).fip_pr_plus ?? null;
      partial.whip_power_rating = (pitcher as any).whip_pr_plus ?? null;
    }
    if (hitter || pitcher) internalsByPredId.set(pred.id, partial);
  }

  console.timeEnd("[CreatePreds] 7. INSERT new predictions");

  // ─── UPDATE existing stubs (with retry to bypass lock trigger) ───────
  console.time("[CreatePreds] 8. UPDATE existing stubs (sequential)");
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

  console.timeEnd("[CreatePreds] 8. UPDATE existing stubs (sequential)");

  // ─── UPSERT internals for everything we touched ──────────────────────
  console.time("[CreatePreds] 9. UPSERT internals");
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

  console.timeEnd("[CreatePreds] 9. UPSERT internals");

  // ─── UPDATE player from_team for blended players ─────────────────────
  console.time("[CreatePreds] 10. UPDATE blended player from_team");
  if (playerFromTeamUpdates.length > 0) {
    console.log(`[createPredictions] Updating from_team for ${playerFromTeamUpdates.length} blended players...`);
    for (const u of playerFromTeamUpdates) {
      await supabase.from("players").update({ from_team: u.from_team }).eq("id", u.id);
    }
  }

  console.timeEnd("[CreatePreds] 10. UPDATE blended player from_team");
  console.timeEnd("[CreatePreds] TOTAL");

  console.log(`[createPredictions] Done!`, result);
  return result;
}

/**
 * Create stub predictions for EVERY player (hitter or pitcher, current or
 * departed) so class_transition has a row to live on. Skips players who
 * already have a returner/regular prediction at the projection season.
 * Idempotent.
 *
 * Single-season call (legacy callers): treat the arg as the WRITE season
 * (projection year). Defaults to PROJECTION_SEASON.
 */
export async function createStubPredictionsForAllPlayers(
  projectionSeason: number = PROJECTION_SEASON,
): Promise<{ created: number; errors: string[] }> {
  const season = projectionSeason;
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
