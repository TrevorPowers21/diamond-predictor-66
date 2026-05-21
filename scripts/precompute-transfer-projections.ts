#!/usr/bin/env node
/**
 * Eager Transfer Pre-compute — batch hitter transfer projections for ONE
 * customer team into `player_predictions` (team-scoped).
 *
 * Population: every hitter currently flagged IN PORTAL.
 * Math: identical to the interactive TransferPortal simulator (same shared
 * input builder in src/lib/buildTransferProjectionInputs.ts).
 *
 * Usage:
 *   npm run precompute-transfers -- --team <customer_team_uuid>
 *   npm run precompute-transfers -- --team <uuid> --dry-run
 *   npm run precompute-transfers:prod -- --team <uuid>
 *
 * Writes one row per (player, customer_team, season) with:
 *   model_type='transfer', variant='precomputed', status='active'
 * UPSERT key: (player_id, customer_team_id, model_type, variant, season).
 */

import { supabase } from "@/integrations/supabase/client";
import { CURRENT_SEASON, PROJECTION_SEASON } from "@/lib/seasonConstants";
import { fetchParkFactorsMap, resolveMetricParkFactor } from "@/lib/parkFactors";
import { fetchConferenceStats } from "@/lib/supabaseQueries";
import { computeTransferProjection } from "@/lib/transferProjection";
import {
  buildHitterTransferInputs,
  applyTransferPostprocess,
  type ConferenceHittingStats,
} from "@/lib/buildTransferProjectionInputs";
const C = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m" };

function arg(name: string): string | undefined {
  const i = process.argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return undefined;
  const v = process.argv[i];
  if (v.includes("=")) return v.split("=").slice(1).join("=");
  return process.argv[i + 1];
}

async function loadAllPaged<T>(builder: () => any): Promise<T[]> {
  const PAGE = 1000;
  let out: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await builder().range(from, from + PAGE - 1);
    if (error) throw error;
    out = out.concat(data || []);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

function normalizeKey(s: string | null | undefined): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function main() {
  const isProd = process.argv.includes("--prod");
  const dryRun = process.argv.includes("--dry-run");
  const teamId = arg("team");
  const season = Number(arg("season") || PROJECTION_SEASON);

  if (!teamId) {
    console.error(`${C.red}✗ --team <customer_team_uuid> required${C.reset}`);
    process.exit(1);
  }

  console.log(`${C.bold}Eager Transfer Pre-compute${C.reset} on ${isProd ? "PROD" : "STAGING"}${dryRun ? ` ${C.yellow}[DRY RUN]${C.reset}` : ""}`);
  console.log(`  customer_team: ${teamId}`);
  console.log(`  season:        ${season} (data from ${CURRENT_SEASON})`);

  // 1. Customer team → destination team + conference
  const { data: ct, error: ctErr } = await supabase
    .from("customer_teams")
    .select("id, name, school_team_id")
    .eq("id", teamId)
    .maybeSingle();
  if (ctErr) throw ctErr;
  if (!ct || !ct.school_team_id) {
    console.error(`${C.red}✗ customer_team ${teamId} not found or missing school_team_id${C.reset}`);
    process.exit(1);
  }

  // Resolve the destination team row (this is the "to" school for every projection)
  const { data: toTeamRow, error: ttErr } = await (supabase as any)
    .from("Teams Table")
    .select("id, full_name, abbreviation, source_id, conference, Season")
    .eq("id", ct.school_team_id)
    .maybeSingle();
  if (ttErr) throw ttErr;
  if (!toTeamRow) {
    console.error(`${C.red}✗ no Teams Table row for source_id ${ct.school_team_id} season ${CURRENT_SEASON}${C.reset}`);
    process.exit(1);
  }
  const toTeam = { id: toTeamRow.id as string, name: (toTeamRow.full_name || toTeamRow.abbreviation) as string };
  const toConference = toTeamRow.conference as string | null;
  console.log(`  destination:   ${toTeam.name} (${toConference || "no conf"})`);

  // 2. Lookups (loaded once)
  console.log(`${C.cyan}→${C.reset} loading lookups...`);

  // 2a. Equation values: model_config admin_ui + per-team overrides overlay
  const { data: globalEq } = await supabase
    .from("model_config")
    .select("config_key, config_value")
    .eq("model_type", "admin_ui")
    .eq("season", CURRENT_SEASON);
  const remoteEquationValues: Record<string, number> = {};
  for (const r of globalEq || []) remoteEquationValues[(r as any).config_key] = Number((r as any).config_value);

  const { data: overrides } = await (supabase as any)
    .from("customer_team_equation_overrides")
    .select("model_type, config_key, config_value")
    .eq("customer_team_id", teamId)
    .in("model_type", ["transfer", "global", "admin_ui"]);
  for (const r of overrides || []) remoteEquationValues[r.config_key] = Number(r.config_value);
  console.log(`  ${remoteEquationValues && Object.keys(remoteEquationValues).length} equation keys (${(overrides || []).length} per-team overrides applied)`);

  // 2b. Conference hitting stats (quoted "Conference Stats" table)
  const confRows = await fetchConferenceStats(CURRENT_SEASON);
  const confByKey = new Map<string, ConferenceHittingStats>();
  const confById = new Map<string, ConferenceHittingStats>();
  for (const r of confRows) {
    const avg = (r as any).AVG;
    const obp = (r as any).OBP;
    const iso = (r as any).ISO;
    const stuff = (r as any).Stuff_plus;
    const row: ConferenceHittingStats = {
      avg_plus: avg != null ? Math.round((Number(avg) / 0.280) * 100) : null,
      obp_plus: obp != null ? Math.round((Number(obp) / 0.385) * 100) : null,
      iso_plus: iso != null ? Math.round((Number(iso) / 0.162) * 100) : null,
      stuff_plus: stuff != null ? Number(stuff) : null,
    };
    const confName = (r as any)["conference abbreviation"] as string | null;
    const confId = (r as any).conference_id as string | null;
    const key = normalizeKey(confName);
    if (key) confByKey.set(key, row);
    if (confId) confById.set(confId, row);
  }
  console.log(`  ${confRows.length} conference rows`);

  const resolveConferenceHitting = (conference: string | null, conferenceId?: string | null) => {
    if (conferenceId && confById.has(conferenceId)) return confById.get(conferenceId)!;
    const k = normalizeKey(conference);
    return k ? (confByKey.get(k) ?? null) : null;
  };

  // 2c. Park factors
  const parkMap = await fetchParkFactorsMap(CURRENT_SEASON);
  const resolveParkFactor = (
    teamIdArg: string | null | undefined,
    teamName: string | null | undefined,
    metric: "avg" | "obp" | "iso",
    handedness: string | null,
  ) => resolveMetricParkFactor(teamIdArg as any, metric as any, parkMap, teamName as any, undefined, undefined, handedness as any);

  // 2d. Teams Table — for resolving each player's from_team
  const allTeams = await loadAllPaged<any>(() =>
    (supabase as any).from("Teams Table").select("id, full_name, abbreviation, source_id, conference, Season").eq("Season", CURRENT_SEASON),
  );
  const teamByName = new Map<string, { id: string; name: string; conference: string | null }>();
  for (const t of allTeams) {
    const name = (t.full_name || t.abbreviation || "") as string;
    const row = { id: t.id as string, name, conference: (t.conference as string | null) ?? null };
    for (const k of [t.full_name, t.abbreviation, t.source_id]) {
      const nk = normalizeKey(k);
      if (nk) teamByName.set(nk, row);
    }
  }
  console.log(`  ${allTeams.length} Teams Table rows`);

  // 2e. Players (in portal only)
  const portalPlayers = await loadAllPaged<any>(() =>
    supabase
      .from("players")
      .select("id, first_name, last_name, position, team, from_team, conference, division, bats_hand, source_team_id, portal_status")
      .or("portal_status.eq.IN PORTAL,transfer_portal.eq.true"),
  );
  console.log(`  ${portalPlayers.length} portal players`);
  // Exclude pitchers (v1 = hitters only)
  const isPitcher = (pos: string | null | undefined) => /^(SP|RP|CL|P|LHP|RHP)/i.test(String(pos || ""));
  const hitters = portalPlayers.filter((p) => !isPitcher(p.position));
  console.log(`  ${hitters.length} hitters after pitcher filter`);

  // 2f. Latest active player_predictions per player (for from_avg/obp/slg + class)
  const playerIds = hitters.map((p) => p.id);
  const predRows = await loadAllPaged<any>(() =>
    supabase
      .from("player_predictions")
      .select("id, player_id, model_type, variant, status, updated_at, from_avg, from_obp, from_slg, class_transition, dev_aggressiveness")
      .in("player_id", playerIds)
      .in("model_type", ["returner", "transfer"])
      .is("customer_team_id", null),
  );
  const rank = (row: any) => {
    const hasFrom = row.from_avg != null || row.from_obp != null || row.from_slg != null;
    const statusBoost = row.status === "active" ? 2 : row.status === "departed" ? 1 : 0;
    const variantBoost = row.variant === "regular" ? 3 : 0;
    return (row.model_type === "transfer" ? 3 : 1) + variantBoost + statusBoost + (hasFrom ? 2 : 0);
  };
  const bestPredByPlayer = new Map<string, any>();
  for (const row of predRows) {
    const k = row.player_id as string;
    const existing = bestPredByPlayer.get(k);
    if (!existing || rank(row) > rank(existing)) bestPredByPlayer.set(k, row);
  }

  // 2g. Internals for the chosen predictions
  const predIds = Array.from(bestPredByPlayer.values()).map((r) => r.id);
  const internalsRows = predIds.length === 0 ? [] : await loadAllPaged<any>(() =>
    supabase
      .from("player_prediction_internals")
      .select("prediction_id, avg_power_rating, obp_power_rating, slg_power_rating")
      .in("prediction_id", predIds),
  );
  const internalsByPredId = new Map<string, any>();
  for (const r of internalsRows) internalsByPredId.set(r.prediction_id, r);

  // 3. Compute
  console.log(`${C.cyan}→${C.reset} computing projections...`);
  const upserts: any[] = [];
  let blocked = 0;
  let computed = 0;
  const blockReasons = new Map<string, number>();

  for (const p of hitters) {
    const pred = bestPredByPlayer.get(p.id);
    const internals = pred ? internalsByPredId.get(pred.id) : null;

    const fromTeamName = (p.from_team || p.team || "") as string;
    const fromTeamRow = teamByName.get(normalizeKey(fromTeamName)) || null;
    const fromConference = fromTeamRow?.conference ?? (p.conference as string | null) ?? null;

    const result = buildHitterTransferInputs({
      player: {
        first_name: p.first_name,
        last_name: p.last_name,
        position: p.position,
        bats_hand: p.bats_hand,
        division: p.division,
        class_transition: pred?.class_transition ?? null,
        dev_aggressiveness: Number.isFinite(Number(pred?.dev_aggressiveness)) ? Number(pred?.dev_aggressiveness) : null,
        from_avg: pred?.from_avg ?? null,
        from_obp: pred?.from_obp ?? null,
        from_slg: pred?.from_slg ?? null,
      },
      fromTeam: fromTeamRow ? { id: fromTeamRow.id, name: fromTeamRow.name } : { id: null, name: fromTeamName },
      toTeam,
      fromConference,
      toConference,
      internals,
      resolveConferenceHitting,
      resolveParkFactor,
      remoteEquationValues,
    });

    if (result.blocked) {
      blocked++;
      for (const m of result.missingInputs) blockReasons.set(m, (blockReasons.get(m) || 0) + 1);
      continue;
    }

    const projected = computeTransferProjection(result.inputs);
    const final = applyTransferPostprocess(projected, result.inputs, result.transferMultiplier);

    // oWAR + NIL are derived at read time from p_wrc_plus + position/conference,
    // so we don't persist them here — same as the rest of the prediction engine.

    upserts.push({
      player_id: p.id,
      customer_team_id: teamId,
      model_type: "transfer",
      variant: "precomputed",
      season,
      status: "active",
      from_avg: pred?.from_avg ?? null,
      from_obp: pred?.from_obp ?? null,
      from_slg: pred?.from_slg ?? null,
      class_transition: pred?.class_transition ?? null,
      dev_aggressiveness: pred?.dev_aggressiveness ?? null,
      p_avg: final.pAvg,
      p_obp: final.pObp,
      p_slg: final.pSlg,
      p_ops: final.pOps,
      p_iso: final.pIso,
      p_wrc: final.pWrc,
      p_wrc_plus: final.pWrcPlus,
      updated_at: new Date().toISOString(),
    });
    computed++;
  }

  console.log(`${C.bold}Result:${C.reset} ${C.green}${computed} computed${C.reset}, ${C.yellow}${blocked} blocked${C.reset}`);
  if (blocked > 0) {
    console.log(`${C.dim}Top block reasons:${C.reset}`);
    const sorted = Array.from(blockReasons.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [r, n] of sorted) console.log(`  ${n.toString().padStart(4)}  ${r}`);
  }

  if (dryRun) {
    console.log(`${C.yellow}[DRY RUN]${C.reset} would upsert ${upserts.length} rows. Sample:`);
    console.log(JSON.stringify(upserts.slice(0, 2), null, 2));
    return;
  }

  // 4. UPSERT in batches
  console.log(`${C.cyan}→${C.reset} upserting ${upserts.length} rows...`);
  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < upserts.length; i += BATCH) {
    const slice = upserts.slice(i, i + BATCH);
    const { error } = await (supabase as any)
      .from("player_predictions")
      .upsert(slice, { onConflict: "player_id,customer_team_id,model_type,variant,season" });
    if (error) {
      console.error(`${C.red}✗ batch ${i / BATCH + 1} failed: ${error.message}${C.reset}`);
      throw error;
    }
    written += slice.length;
    process.stdout.write(`\r  ${written}/${upserts.length}`);
  }
  console.log(`\n${C.green}✓ done${C.reset}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
