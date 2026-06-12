#!/usr/bin/env node
/**
 * Create Default Builds — seeds one `is_default=true` build per active
 * customer team. Each build contains every returner for that team (players
 * in `players` whose `team` matches the customer team's school name), with
 * `player_snapshot` populated from precomputed `player_predictions` so the
 * Team Builder can display stats on first load with zero extra queries.
 *
 * Idempotent: skips any team that already has an `is_default=true` build for
 * the target academic year. Use --force to replace existing default builds.
 *
 * Usage:
 *   npm run create-default-builds                        # staging, dry-run
 *   npm run create-default-builds -- --apply            # staging, write
 *   npm run create-default-builds:prod -- --apply       # prod, write
 *   npm run create-default-builds:prod -- --apply --force  # replace existing
 *   npm run create-default-builds -- --apply --team <uuid>  # single team
 *
 * Requires: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or VITE_ prefix).
 * Pass --prod to write to production (env-detection guard enforces this).
 */

import { createClient } from "@supabase/supabase-js";
import { PROJECTION_SEASON } from "@/lib/seasonConstants";
import { classTransitionFromYearOrDefault } from "@/lib/classTransitionUtils";
import {
  defaultHitterDepthRoleFromPa,
  defaultPitcherDepthRoleFromIp,
  serializeBuildPlayerMeta,
} from "@/pages/team-builder/helpers";

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

function arg(name: string): string | undefined {
  const i = process.argv.findIndex(
    (a) => a === `--${name}` || a.startsWith(`--${name}=`)
  );
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

function normalizeTeam(s: string | null | undefined): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isPitcherPosition(pos: string | null | undefined): boolean {
  return /^(SP|RP|CL|P|LHP|RHP)/i.test(String(pos || ""));
}

async function main() {
  const isProd = process.argv.includes("--prod");
  const apply = process.argv.includes("--apply");
  const force = process.argv.includes("--force");
  const singleTeamId = arg("team");
  const academicYear = Number(arg("year") || PROJECTION_SEASON);

  const supabaseUrl = (
    process.env.VITE_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    ""
  ).toLowerCase();
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
    "";

  const looksLikeProd =
    supabaseUrl.includes("trbvxuoliwrfowibatkm") ||
    supabaseUrl.includes("prod");

  if (looksLikeProd && !isProd) {
    console.error(
      `${C.red}✗ SUPABASE_URL looks like PROD but --prod was not passed. Refusing to write.${C.reset}`
    );
    process.exit(1);
  }
  if (isProd && !looksLikeProd) {
    console.error(
      `${C.red}✗ --prod passed but SUPABASE_URL doesn't look like prod. Refusing to write.${C.reset}`
    );
    process.exit(1);
  }

  const ENV_LABEL = looksLikeProd ? "PROD" : "STAGING";
  const sb = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  console.log(`\n${"=".repeat(64)}`);
  console.log(`  Create Default Builds`);
  console.log(`${"=".repeat(64)}`);
  console.log(`  Env:          ${ENV_LABEL}`);
  console.log(`  Academic year:${academicYear}`);
  console.log(`  Mode:         ${apply ? "APPLY" : "DRY-RUN"}`);
  if (force) console.log(`  Force:        yes (will replace existing default builds)`);
  if (singleTeamId) console.log(`  Team filter:  ${singleTeamId}`);
  console.log("");

  // Load customer teams
  let teamsQuery = sb
    .from("customer_teams")
    .select("id, name, school_team_id")
    .eq("active", true)
    .not("name", "ilike", "%All-Americans%")
    .order("name");
  if (singleTeamId) teamsQuery = teamsQuery.eq("id", singleTeamId);
  const { data: customerTeams, error: teamsErr } = await teamsQuery;
  if (teamsErr || !customerTeams?.length) {
    console.error("Failed to load customer_teams:", teamsErr);
    process.exit(1);
  }
  console.log(`Loaded ${customerTeams.length} customer team(s)`);

  // Load Teams Table to resolve school abbreviation for player matching
  const schoolTeamIds = customerTeams
    .map((t: any) => t.school_team_id)
    .filter(Boolean);
  const { data: teamsTableRows } = await sb
    .from("Teams Table")
    .select("id, abbreviation, full_name")
    .in("id", schoolTeamIds);
  const teamsTableMap = new Map<string, string>(
    (teamsTableRows || []).map((r: any) => [r.id, r.abbreviation || r.full_name])
  );

  // Load all existing default builds for the target year so we can skip/force
  const { data: existingDefaults } = await sb
    .from("team_builds")
    .select("id, customer_team_id, academic_year")
    .eq("is_default", true)
    .eq("academic_year", academicYear);
  const existingDefaultsByTeam = new Map<string, string>(
    (existingDefaults || []).map((b: any) => [b.customer_team_id, b.id])
  );

  // Summary counters
  let created = 0;
  let skipped = 0;
  let replaced = 0;
  let failed = 0;

  for (const team of customerTeams) {
    const teamLabel = `${team.name} (${team.id})`;
    const existingId = existingDefaultsByTeam.get(team.id);

    if (existingId && !force) {
      console.log(
        `  ${C.dim}SKIP${C.reset}  ${teamLabel} — default build already exists (${existingId})`
      );
      skipped++;
      continue;
    }

    // Resolve school abbreviation from Teams Table for player matching
    const schoolName = teamsTableMap.get((team as any).school_team_id) || team.name;
    const { data: returners, error: returnersErr } = await sb
      .from("players")
      .select(
        "id, first_name, last_name, position, is_twp, class_year, pa, ip, team, conference, transfer_portal"
      )
      .ilike("team", schoolName)
      .order("last_name");

    if (returnersErr) {
      console.error(`  ${C.red}✗ FAIL${C.reset}  ${teamLabel}: ${returnersErr.message}`);
      failed++;
      continue;
    }

    const activeReturners = (returners || []).filter(
      (p: any) => !p.transfer_portal
    );

    if (!activeReturners.length) {
      console.log(
        `  ${C.yellow}WARN${C.reset}  ${teamLabel} — no returners found (school name: "${schoolName}")`
      );
      skipped++;
      continue;
    }

    // Load predictions for all returners in one batch
    const playerIds = activeReturners.map((p: any) => p.id);
    const predictions = await loadAllPaged<any>(() =>
      sb
        .from("player_predictions")
        .select(
          "player_id, customer_team_id, variant, model_type, p_avg, p_obp, p_slg, p_wrc_plus, o_war, market_value, twp_hitter_market_value, twp_pitcher_market_value, hitter_depth_role, p_era, p_fip, p_whip, p_k9, p_bb9, p_hr9, p_rv_plus, p_war, pitcher_role, pitcher_depth_role, projected_ip"
        )
        .in("player_id", playerIds)
        .eq("season", academicYear - 1) // returner season = current season
        .in("status", ["active", "departed"])
    );

    // Build prediction map: prefer team-scoped precomputed, fallback to global regular
    const predMap = new Map<string, any>();
    for (const pred of predictions) {
      const key = pred.player_id;
      const existing = predMap.get(key);
      const isTeamScoped =
        pred.customer_team_id === team.id &&
        pred.variant === "precomputed";
      const isGlobalReturner =
        pred.customer_team_id == null && pred.variant === "regular";
      if (!existing) {
        predMap.set(key, pred);
      } else if (isTeamScoped) {
        predMap.set(key, pred);
      } else if (isGlobalReturner && existing.variant !== "precomputed") {
        predMap.set(key, pred);
      }
    }

    // Build player rows for the build
    const validHitterDepths = [
      "cornerstone",
      "everyday_starter",
      "platoon_starter",
      "utility",
      "bench",
    ];
    const validPitcherDepths = [
      "weekend_starter",
      "weekday_starter",
      "swing_starter",
      "workhorse_reliever",
      "high_leverage_reliever",
      "mid_leverage_reliever",
      "low_impact_reliever",
      "specialist_reliever",
    ];

    const playerRows: any[] = [];
    for (const p of activeReturners) {
      const pred = predMap.get(p.id) ?? null;
      const isTwp = !!p.is_twp;
      const isPitcher = isPitcherPosition(p.position);
      const classTransition = classTransitionFromYearOrDefault(p.class_year);

      // Build snapshot from prediction
      const snapshot: Record<string, any> = {};
      if (pred) {
        if (!isPitcher || isTwp) {
          snapshot.p_avg = pred.p_avg ?? null;
          snapshot.p_obp = pred.p_obp ?? null;
          snapshot.p_slg = pred.p_slg ?? null;
          snapshot.p_wrc_plus = pred.p_wrc_plus ?? null;
          snapshot.o_war = pred.o_war ?? null;
          snapshot.market_value = isTwp
            ? (pred.twp_hitter_market_value ?? pred.market_value ?? null)
            : (pred.market_value ?? null);
          snapshot.hitter_depth_role = pred.hitter_depth_role ?? null;
        }
        if (isPitcher || isTwp) {
          snapshot.p_era = pred.p_era ?? null;
          snapshot.p_fip = pred.p_fip ?? null;
          snapshot.p_whip = pred.p_whip ?? null;
          snapshot.p_k9 = pred.p_k9 ?? null;
          snapshot.p_bb9 = pred.p_bb9 ?? null;
          snapshot.p_hr9 = pred.p_hr9 ?? null;
          snapshot.p_rv_plus = pred.p_rv_plus ?? null;
          snapshot.p_war = pred.p_war ?? null;
          snapshot.pitcher_depth_role = pred.pitcher_depth_role ?? null;
          snapshot.pitcher_role = pred.pitcher_role ?? null;
        }
      }

      // Determine depth role
      let depthRole: string;
      if (isPitcher) {
        const role: "SP" | "RP" =
          pred?.pitcher_role === "SP" ? "SP" : "RP";
        const storedDepth = pred?.pitcher_depth_role;
        depthRole = validPitcherDepths.includes(storedDepth)
          ? storedDepth
          : defaultPitcherDepthRoleFromIp(p.ip ?? null, role);
      } else {
        const storedDepth = pred?.hitter_depth_role;
        depthRole = validHitterDepths.includes(storedDepth)
          ? storedDepth
          : defaultHitterDepthRoleFromPa(p.pa ?? null);
      }

      const customName = `${p.first_name || ""} ${p.last_name || ""}`.trim() || null;
      const localPlayer = {
        first_name: p.first_name || "",
        last_name: p.last_name || "",
        position: p.position ?? null,
        team: p.team ?? null,
        from_team: p.team ?? null,
        conference: p.conference ?? null,
      };

      // For TWPs, emit two rows: one hitter, one pitcher
      if (isTwp) {
        const hitterDepth = validHitterDepths.includes(pred?.hitter_depth_role)
          ? pred.hitter_depth_role
          : defaultHitterDepthRoleFromPa(p.pa ?? null);
        const pitcherRole: "SP" | "RP" =
          pred?.pitcher_role === "SP" ? "SP" : "RP";
        const pitcherDepth = validPitcherDepths.includes(pred?.pitcher_depth_role)
          ? pred.pitcher_depth_role
          : defaultPitcherDepthRoleFromIp(p.ip ?? null, pitcherRole);

        playerRows.push({
          player_id: p.id,
          source: "returner",
          custom_name: customName,
          position_slot: p.position && !isPitcherPosition(p.position) ? p.position : null,
          depth_order: 1,
          nil_value: 0,
          production_notes: serializeBuildPlayerMeta(
            null, null, null, "returner", hitterDepth as any,
            classTransition, 0, false, false, null, localPlayer
          ),
          player_snapshot: pred ? {
            p_avg: pred.p_avg, p_obp: pred.p_obp, p_slg: pred.p_slg,
            p_wrc_plus: pred.p_wrc_plus, o_war: pred.o_war,
            market_value: pred.twp_hitter_market_value ?? pred.market_value,
            hitter_depth_role: pred.hitter_depth_role,
          } : null,
        });

        playerRows.push({
          player_id: p.id,
          source: "returner",
          custom_name: customName,
          position_slot: pitcherRole,
          depth_order: 1,
          nil_value: 0,
          production_notes: serializeBuildPlayerMeta(
            null, null, null, "returner", pitcherDepth as any,
            classTransition, 0, false, false, null,
            { ...localPlayer, position: pitcherRole }
          ),
          player_snapshot: pred ? {
            p_era: pred.p_era, p_fip: pred.p_fip, p_whip: pred.p_whip,
            p_k9: pred.p_k9, p_bb9: pred.p_bb9, p_hr9: pred.p_hr9,
            p_rv_plus: pred.p_rv_plus, p_war: pred.p_war,
            pitcher_role: pred.pitcher_role, pitcher_depth_role: pred.pitcher_depth_role,
            market_value: pred.twp_pitcher_market_value ?? pred.market_value,
          } : null,
        });
      } else {
        const positionSlot = isPitcher
          ? (pred?.pitcher_role === "SP" ? "SP" : "RP")
          : (p.position ?? null);
        playerRows.push({
          player_id: p.id,
          source: "returner",
          custom_name: customName,
          position_slot: positionSlot,
          depth_order: 1,
          nil_value: 0,
          production_notes: serializeBuildPlayerMeta(
            null, null, null, "returner", depthRole as any,
            classTransition, 0, false, false, null, localPlayer
          ),
          player_snapshot: Object.keys(snapshot).length > 0 ? snapshot : null,
        });
      }
    }

    const buildName = `${academicYear} Default Roster`;
    console.log(
      `  ${C.cyan}BUILD${C.reset} ${teamLabel}: ${activeReturners.length} returners → ${playerRows.length} rows (${buildName})`
    );

    if (!apply) {
      created++;
      continue;
    }

    // Delete existing default build if force
    if (existingId && force) {
      await sb.from("team_build_players").delete().eq("build_id", existingId);
      await sb.from("team_builds").delete().eq("id", existingId);
      replaced++;
    }

    // Create the build
    const { data: newBuild, error: buildErr } = await sb
      .from("team_builds")
      .insert({
        customer_team_id: team.id,
        team: schoolName,
        name: buildName,
        user_id: null,
        total_budget: 0,
        depth_assignments: {},
        depth_placeholders: {},
        is_default: true,
        academic_year: academicYear,
      })
      .select("id")
      .single();

    if (buildErr || !newBuild) {
      console.error(
        `  ${C.red}✗ FAIL${C.reset}  ${teamLabel}: build insert failed: ${buildErr?.message}`
      );
      failed++;
      continue;
    }

    // Insert player rows in chunks of 500
    const buildId = (newBuild as any).id as string;
    const rows = playerRows.map((r) => ({ ...r, build_id: buildId }));
    const CHUNK = 500;
    let insertFailed = false;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error: insertErr } = await sb
        .from("team_build_players")
        .insert(chunk);
      if (insertErr) {
        console.error(
          `  ${C.red}✗ FAIL${C.reset}  ${teamLabel}: player insert failed at chunk ${i}: ${insertErr.message}`
        );
        await sb.from("team_builds").delete().eq("id", buildId);
        failed++;
        insertFailed = true;
        break;
      }
    }

    if (!insertFailed) {
      console.log(
        `  ${C.green}✓ OK${C.reset}   ${teamLabel}: created build ${buildId} with ${rows.length} player rows`
      );
      created++;
    }
  }

  console.log(`\n${"=".repeat(64)}`);
  console.log(`  Summary`);
  console.log(`${"=".repeat(64)}`);
  if (!apply) {
    console.log(
      `  ${C.yellow}DRY-RUN — no changes written. Pass --apply to execute.${C.reset}`
    );
    console.log(`  Would create: ${created}`);
  } else {
    console.log(`  Created:  ${created}`);
    if (replaced) console.log(`  Replaced: ${replaced}`);
  }
  console.log(`  Skipped:  ${skipped}`);
  if (failed) console.log(`  ${C.red}Failed:   ${failed}${C.reset}`);
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
