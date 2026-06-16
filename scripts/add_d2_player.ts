#!/usr/bin/env node
/**
 * Surgical D2 player add — Kansas D2 onboarding (Logan Harrell + Jake Berkland).
 *
 * Reads CSVs from `~/RSTR IQ Data/inbox/kansas_d2/<player>/`, inserts at most
 * ONE row each across these tables for a SINGLE player:
 *   1. Conference Stats (Gulf South Conference, UPSERT — idempotent)
 *   2. players
 *   3. Pitching Master   (skipped for bio-only players like Jake)
 *   4. player_predictions  (skipped for bio-only)
 *   5. target_board       (only if --target-team-id + --target-user-id given)
 *
 * Safety constraints by design:
 *   - NO bulk operations, NO loops over other players
 *   - NO calls to the precompute edge function or any worker
 *   - Dry-run by default, must pass --apply to write
 *   - --env required: 'staging' or 'prod' (asserts the SUPABASE_URL matches)
 *   - Module-scope guard prevents accidental auto-run on import
 *     (mirrors the lesson from the ABS / generate-scouting-reports gotcha
 *     captured in `project_d2_pdf_workflow` memory)
 *
 * Usage:
 *   npm run add-d2-player -- --player logan_harrell --env staging
 *   npm run add-d2-player -- --player logan_harrell --env staging --apply
 *   npm run add-d2-player -- --player logan_harrell --env prod --apply \
 *     --target-team-id <uuid> --target-user-id <uuid>
 *
 *   npm run add-d2-player -- --player jake_berkland --env staging --apply
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import { CURRENT_SEASON, PROJECTION_SEASON } from "../src/lib/seasonConstants";

const INBOX_ROOT = join(homedir(), "RSTR IQ Data", "inbox", "kansas_d2");

// Hardcoded player baselines — captured verbatim from coach chat so a CSV
// drop never overwrites the canonical outcome stats. CSV layer is additive.
type PitcherBaseline = {
  type: "pitcher";
  first_name: string; last_name: string;
  position: string; bats_hand: string; throws_hand: string; handedness: string;
  class_year: string; height_inches: number | null; weight: number | null;
  from_team: string; from_conference: string; from_division: string;
  ip: number; era: number; fip: number; whip: number;
  k9: number; bb9: number; hr9: number;
};
type BioOnlyBaseline = {
  type: "bio_only";
  first_name: string; last_name: string;
  position: string | null; bats_hand: string | null; throws_hand: string | null;
  handedness: string | null; class_year: string | null;
  height_inches: number | null; weight: number | null;
  from_team: string | null; from_conference: string | null; from_division: string;
};
type Baseline = PitcherBaseline | BioOnlyBaseline;

const PLAYER_BASELINES: Record<string, Baseline> = {
  logan_harrell: {
    type: "pitcher",
    first_name: "Logan", last_name: "Harrell",
    position: "SP", bats_hand: "R", throws_hand: "R", handedness: "R",
    class_year: "JR", height_inches: 76, weight: 205,
    from_team: "Trevecca Nazarene University",
    from_conference: "Gulf South Conference",
    from_division: "D2",
    ip: 93.0, era: 3.48, fip: 3.13, whip: 1.13,
    k9: 9.39, bb9: 1.94, hr9: 0.87,
  },
  jake_berkland: {
    type: "bio_only",
    first_name: "Jake", last_name: "Berkland",
    position: null, bats_hand: null, throws_hand: null, handedness: null,
    class_year: null, height_inches: null, weight: null,
    from_team: null, from_conference: null,
    from_division: "D2",
  },
};

// Gulf South Conference seed (D2). OPR=76 back-derives HTP=66 with
// Stuff+=92, WRC+=100 via HTP = OPR + 1.25(Stuff+ - 100) + 0.75(100 - WRC+).
// HTP 66 = NEC floor of D1 per coach calibration 2026-06-16.
const GULF_SOUTH_CONF = {
  season: CURRENT_SEASON,
  division: "D2",
  "conference abbreviation": "Gulf South Conference",
  ERA: 5.94, FIP: 4.85, WHIP: 1.65,
  K9: 7.59, BB9: 4.44, HR9: 0.95,
  Overall_Power_Rating: 76,
  Stuff_plus: 92,
  WRC_plus: 100,
} as const;

const STAGING_URL_FRAG = "slrxowawbijbjrkozqlj";
const PROD_URL_FRAG = "trbvxuoliwrfowibatkm";

const COLOR = {
  reset: "\x1b[0m", bold: "\x1b[1m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m",
};
const ok = (s: string) => console.log(`  ${COLOR.green}✓${COLOR.reset} ${s}`);
const warn = (s: string) => console.log(`  ${COLOR.yellow}!${COLOR.reset} ${s}`);
const err = (s: string) => console.log(`  ${COLOR.red}✗${COLOR.reset} ${s}`);
const info = (s: string) => console.log(`  ${COLOR.cyan}·${COLOR.reset} ${s}`);
const step = (s: string) => console.log(`\n${COLOR.bold}→${COLOR.reset} ${s}`);

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name: string): string | null => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? (args[i + 1] || null) : null;
  };
  return {
    player: get("player"),
    env: get("env"),
    targetTeamId: get("target-team-id"),
    targetUserId: get("target-user-id"),
    apply: args.includes("--apply"),
  };
}

function syntheticSourceId(name: string, team: string): string {
  const hash = createHash("sha1").update(`d2:${name.trim()}:${team.trim()}`).digest("hex").slice(0, 16);
  return `d2-${hash}`;
}

function parseCsvSingleRow(path: string): Record<string, string> | null {
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, "utf-8").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;
  const headers = lines[0].split(",").map((h) => h.trim());
  const values = lines[1].split(",").map((v) => v.trim());
  const out: Record<string, string> = {};
  headers.forEach((h, i) => { out[h] = values[i] ?? ""; });
  return out;
}

// Per zero-is-missing rule: treat 0 as null on every numeric input that
// could plausibly be a missing-data sentinel.
function numOrNull(raw: string | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return null;
  return n;
}

async function main() {
  const { player, env, targetTeamId, targetUserId, apply } = parseArgs();

  if (!player) { err("--player <slug> required (e.g. logan_harrell)"); process.exit(1); }
  if (!env || (env !== "staging" && env !== "prod")) {
    err("--env required: 'staging' or 'prod'");
    process.exit(1);
  }
  const baseline = PLAYER_BASELINES[player];
  if (!baseline) {
    err(`Unknown player slug: '${player}'. Known: ${Object.keys(PLAYER_BASELINES).join(", ")}`);
    err("Add a baseline to PLAYER_BASELINES in scripts/add_d2_player.ts before re-running.");
    process.exit(1);
  }

  const inboxDir = join(INBOX_ROOT, player);
  if (!existsSync(inboxDir)) { err(`Inbox folder not found: ${inboxDir}`); process.exit(1); }

  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    err("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required in env (use --env-file flag on npm run)");
    process.exit(1);
  }
  const isStaging = url.includes(STAGING_URL_FRAG);
  const isProd = url.includes(PROD_URL_FRAG);
  if (env === "staging" && !isStaging) {
    err(`--env staging requested but SUPABASE_URL points elsewhere:\n   ${url}`);
    process.exit(1);
  }
  if (env === "prod" && !isProd) {
    err(`--env prod requested but SUPABASE_URL points elsewhere:\n   ${url}`);
    process.exit(1);
  }

  console.log(`${COLOR.bold}\n══ Add D2 Player: ${player} ══${COLOR.reset}`);
  console.log(`Target DB:   ${isProd ? `${COLOR.red}PROD${COLOR.reset}` : "staging"} (${url})`);
  console.log(`Inbox:       ${inboxDir}`);
  console.log(`Player type: ${baseline.type}`);
  console.log(`Mode:        ${apply ? `${COLOR.red}APPLY (will write)${COLOR.reset}` : "dry-run (no writes)"}`);

  const sb = createClient(url, key, { auth: { persistSession: false } });

  // ── 1. Conference Stats — Gulf South Conference ──────────────────────
  step("Step 1: Conference Stats (Gulf South Conference)");
  {
    const { data: existing, error: selErr } = await sb.from("Conference Stats")
      .select("conference_id")
      .eq("season", CURRENT_SEASON)
      .eq("division", "D2")
      .eq("conference abbreviation", "Gulf South Conference")
      .maybeSingle();
    if (selErr) { err(`Conference Stats lookup: ${selErr.message}`); process.exit(1); }
    if (existing) {
      ok(`Gulf South row already exists (conference_id=${existing.conference_id})`);
    } else {
      const conferenceId = randomUUID();
      const row = { conference_id: conferenceId, ...GULF_SOUTH_CONF };
      if (apply) {
        const { error } = await sb.from("Conference Stats").insert(row);
        if (error) { err(`Conference Stats insert: ${error.message}`); process.exit(1); }
        ok(`Inserted Gulf South row (conference_id=${conferenceId})`);
      } else {
        info(`[dry-run] Would INSERT Conference Stats row`);
        info(`           ${JSON.stringify({ conference_id: conferenceId, ...GULF_SOUTH_CONF })}`);
      }
    }
  }

  // ── 2. players row ───────────────────────────────────────────────────
  step("Step 2: players");
  const fullName = `${baseline.first_name} ${baseline.last_name}`;
  const sourcePlayerId = syntheticSourceId(fullName, baseline.from_team || "unknown");
  let playerId: string | null = null;
  {
    const { data: existing, error: selErr } = await sb.from("players")
      .select("id, source_player_id")
      .eq("source_player_id", sourcePlayerId)
      .maybeSingle();
    if (selErr) { err(`players lookup: ${selErr.message}`); process.exit(1); }
    if (existing) {
      warn(`players row already exists (id=${existing.id}) — skipping insert.`);
      playerId = existing.id;
    } else {
      playerId = randomUUID();
      const row: Record<string, unknown> = {
        id: playerId,
        source_player_id: sourcePlayerId,
        first_name: baseline.first_name,
        last_name: baseline.last_name,
        position: baseline.position,
        bats_hand: baseline.bats_hand,
        throws_hand: baseline.throws_hand,
        handedness: baseline.handedness,
        class_year: baseline.class_year,
        height_inches: baseline.height_inches,
        weight: baseline.weight,
        team: baseline.from_team,
        from_team: baseline.from_team,
        conference: baseline.from_conference,
        division: baseline.from_division,
        portal_status: "COMMITTED",
        transfer_portal: true,
        data_status: "manual",
      };
      if (apply) {
        const { error } = await sb.from("players").insert(row);
        if (error) { err(`players insert: ${error.message}`); process.exit(1); }
        ok(`Inserted players row (id=${playerId})`);
      } else {
        info(`[dry-run] Would INSERT players row`);
        info(`           ${JSON.stringify({ id: playerId, name: fullName, division: baseline.from_division, portal_status: "COMMITTED" })}`);
      }
    }
  }

  // ── 3. Pitching Master — pitchers only ───────────────────────────────
  if (baseline.type === "pitcher") {
    step("Step 3: Pitching Master");
    const pmCsv = parseCsvSingleRow(join(inboxDir, "pitching_master.csv"));
    if (!pmCsv) {
      warn(`pitching_master.csv not found in inbox — G/GS/BF will be null, Role inferred from G/GS at projection time`);
    } else {
      info(`pitching_master.csv loaded — keys: ${Object.keys(pmCsv).join(", ")}`);
    }
    const { data: existing, error: selErr } = await sb.from("Pitching Master")
      .select("id")
      .eq("source_player_id", sourcePlayerId)
      .eq("Season", CURRENT_SEASON)
      .maybeSingle();
    if (selErr) { err(`Pitching Master lookup: ${selErr.message}`); process.exit(1); }
    if (existing) {
      warn(`Pitching Master row already exists (id=${existing.id}) — skipping.`);
    } else {
      const pmRow: Record<string, unknown> = {
        id: randomUUID(),
        source_player_id: sourcePlayerId,
        Season: CURRENT_SEASON,
        playerFullName: fullName,
        Team: baseline.from_team,
        Conference: baseline.from_conference,
        division: "D2",
        Pos: baseline.position,
        ThrowHand: baseline.throws_hand,
        IP: baseline.ip,
        ERA: baseline.era,
        FIP: baseline.fip,
        WHIP: baseline.whip,
        K9: baseline.k9,
        BB9: baseline.bb9,
        HR9: baseline.hr9,
      };
      if (pmCsv) {
        const G = numOrNull(pmCsv.G);
        const GS = numOrNull(pmCsv.GS);
        const BF = numOrNull(pmCsv.BF);
        if (G != null) pmRow.G = G;
        if (GS != null) pmRow.GS = GS;
        if (BF != null) pmRow.bf = BF;
        const roleRaw = (pmCsv.Role || "").trim();
        if (roleRaw && roleRaw !== "0") pmRow.Role = roleRaw;
      }
      if (apply) {
        const { error } = await sb.from("Pitching Master").insert(pmRow);
        if (error) { err(`Pitching Master insert: ${error.message}`); process.exit(1); }
        ok(`Inserted Pitching Master row`);
      } else {
        info(`[dry-run] Would INSERT Pitching Master row`);
        info(`           ${JSON.stringify({ name: fullName, IP: baseline.ip, ERA: baseline.era, K9: baseline.k9, BB9: baseline.bb9 })}`);
      }
    }
  } else {
    step("Step 3: Pitching Master — SKIPPED (bio-only player)");
  }

  // ── 4. player_predictions — pitchers only (returner baseline) ────────
  if (baseline.type === "pitcher" && playerId) {
    step("Step 4: player_predictions (returner baseline)");
    const { data: existing, error: selErr } = await sb.from("player_predictions")
      .select("id")
      .eq("player_id", playerId)
      .eq("season", PROJECTION_SEASON)
      .eq("variant", "regular")
      .is("customer_team_id", null)
      .maybeSingle();
    if (selErr) { err(`player_predictions lookup: ${selErr.message}`); process.exit(1); }
    if (existing) {
      warn(`player_predictions row already exists (id=${existing.id}) — skipping.`);
    } else {
      const predRow: Record<string, unknown> = {
        id: randomUUID(),
        player_id: playerId,
        customer_team_id: null,
        model_type: "returner",
        variant: "regular",
        season: PROJECTION_SEASON,
        status: "active",
        from_era: baseline.era,
        from_fip: baseline.fip,
        from_whip: baseline.whip,
        from_k9: baseline.k9,
        from_bb9: baseline.bb9,
        from_hr9: baseline.hr9,
        pitcher_role: null,
        projected_ip: null,
      };
      if (apply) {
        const { error } = await sb.from("player_predictions").insert(predRow);
        if (error) { err(`player_predictions insert: ${error.message}`); process.exit(1); }
        ok(`Inserted player_predictions row`);
      } else {
        info(`[dry-run] Would INSERT player_predictions row (returner baseline, p_* NULL — engine computes on add)`);
        info(`           ${JSON.stringify({ player_id: playerId, from_era: baseline.era, from_fip: baseline.fip, from_k9: baseline.k9 })}`);
      }
    }
  } else if (baseline.type === "bio_only") {
    step("Step 4: player_predictions — SKIPPED (bio-only player, no projection inputs)");
  }

  // ── 5. Optional target_board row ─────────────────────────────────────
  if (targetTeamId && targetUserId && playerId) {
    step("Step 5: target_board");
    const { data: existing, error: selErr } = await sb.from("target_board")
      .select("id")
      .eq("player_id", playerId)
      .eq("user_id", targetUserId)
      .eq("customer_team_id", targetTeamId)
      .maybeSingle();
    if (selErr) { err(`target_board lookup: ${selErr.message}`); process.exit(1); }
    if (existing) {
      warn(`target_board row already exists (id=${existing.id}) — skipping.`);
    } else {
      const row = {
        id: randomUUID(),
        player_id: playerId,
        user_id: targetUserId,
        customer_team_id: targetTeamId,
        added_at: new Date().toISOString(),
      };
      if (apply) {
        const { error } = await sb.from("target_board").insert(row);
        if (error) { err(`target_board insert: ${error.message}`); process.exit(1); }
        ok(`Inserted target_board row`);
      } else {
        info(`[dry-run] Would INSERT target_board row`);
        info(`           ${JSON.stringify(row)}`);
      }
    }
  } else {
    step("Step 5: target_board — SKIPPED");
    info("Pass --target-team-id <uuid> --target-user-id <uuid> to add to a coach's board.");
  }

  console.log(`${COLOR.bold}${COLOR.green}\n══ DONE ══${COLOR.reset}`);
  console.log(`Player:  ${fullName}${playerId ? ` (${playerId})` : ""}`);
  console.log(`Mode:    ${apply ? "APPLIED" : "dry-run"}\n`);
}

// Module-scope guard — only execute when run as a script, never on import.
// Prevents the auto-trigger gotcha that hit ABS / generate-scouting-reports.
const isMainEntry = (() => {
  try {
    const argv1 = process.argv[1] || "";
    return argv1.endsWith("add_d2_player.ts") || argv1.endsWith("add_d2_player.js");
  } catch { return false; }
})();

if (isMainEntry) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
