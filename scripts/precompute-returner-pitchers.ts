#!/usr/bin/env node
/**
 * Returner Pitcher Pre-compute. Batch updates EVERY D1 pitcher's returner
 * projection row in `player_predictions`:
 *   (model_type='returner', variant='regular', customer_team_id=NULL, season)
 *
 * Writes p_era, p_fip, p_whip, p_k9, p_bb9, p_hr9, p_rv_plus, p_war,
 * market_value, projected_ip, pitcher_role. Does NOT touch class_transition or
 * dev_aggressiveness (those are coach-owned).
 *
 * Math goes through `computePitcherProjection` in src/lib/pitcherProjection.ts
 * — same engine PitcherProfile / the live recalc path use. Equation weights
 * come from `readPitchingWeights()` (Supabase + defaults; localStorage is
 * unavailable in Node so the localStorage layer is skipped). Power-rating
 * weights come from `loadPitchingPowerEq()` (model_config + defaults), copied
 * inline here so we don't import predictionEngine.
 *
 * UPSERT key: (player_id, customer_team_id, model_type, variant, season).
 * The unique constraint is NULLS NOT DISTINCT
 * (migration 20260520210000) so a NULL customer_team_id resolves cleanly.
 *
 * Usage:
 *   npm run precompute-returner-pitchers
 *   npm run precompute-returner-pitchers -- --dry-run
 *   npm run precompute-returner-pitchers:prod
 */

import { supabase } from "@/integrations/supabase/client";
import { CURRENT_SEASON, PROJECTION_SEASON } from "@/lib/seasonConstants";
import { fetchParkFactorsMap, resolveMetricParkFactor } from "@/lib/parkFactors";
import { readPitchingWeights } from "@/lib/pitchingEquations";
import {
  computePitcherProjection,
  type PitcherProjectionInput,
} from "@/lib/pitcherProjection";
import { pitcherExpectedIp } from "@/lib/depthRoles";
import { PITCHING_EQ_DEFAULTS } from "@/hooks/usePitchingEquationWeights";

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

function normalizeName(s: string | null | undefined): string {
  return String(s || "").toLowerCase().trim().replace(/\s+/g, " ");
}

// Mirror of loadPitchingPowerEq() in predictionEngine.ts so the script doesn't
// pull in the live engine module. Same model_config query + defaults +
// p_whip_chase_pct_weight lock.
async function loadPitchingPowerEq(season = CURRENT_SEASON): Promise<Record<string, number>> {
  const merged: Record<string, number> = { ...(PITCHING_EQ_DEFAULTS as Record<string, number>) };
  try {
    const { data } = await supabase
      .from("model_config")
      .select("config_key, config_value")
      .eq("model_type", "admin_ui")
      .eq("season", season);
    for (const row of (data || []) as Array<{ config_key: string | null; config_value: any }>) {
      const key = row.config_key;
      if (key?.startsWith("p_")) {
        const n = Number(row.config_value);
        if (Number.isFinite(n)) merged[key] = n;
      }
    }
  } catch {
    // Fall back to defaults.
  }
  merged.p_whip_chase_pct_weight = 0.05;
  return merged;
}

async function main() {
  const isProd = process.argv.includes("--prod");
  const dryRun = process.argv.includes("--dry-run");
  const season = Number(arg("season") || PROJECTION_SEASON);

  // Env-detection guard: refuse to write prod unless --prod explicitly passed.
  const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").toLowerCase();
  const looksLikeProd = supabaseUrl.includes("ualmkgkdnoubccoieahf") || supabaseUrl.includes("prod");
  if (looksLikeProd && !isProd) {
    console.error(`${C.red}✗ SUPABASE_URL looks like PROD but --prod was not passed. Refusing to write.${C.reset}`);
    console.error(`  URL: ${supabaseUrl || "(unset)"}`);
    process.exit(1);
  }
  if (isProd && !looksLikeProd) {
    console.error(`${C.red}✗ --prod passed but SUPABASE_URL doesn't look like prod. Refusing to write.${C.reset}`);
    console.error(`  URL: ${supabaseUrl || "(unset)"}`);
    process.exit(1);
  }

  console.log(`${C.bold}Returner Pitcher Pre-compute${C.reset} on ${isProd ? "PROD" : "STAGING"}${dryRun ? ` ${C.yellow}[DRY RUN]${C.reset}` : ""}`);
  console.log(`  season:   ${season} (data from ${CURRENT_SEASON})`);
  console.log(`  scope:    D1 returners only (JUCO returner pitchers handled by a separate script)`);

  // 1. Load equation weights
  console.log(`${C.cyan}→${C.reset} loading equation weights...`);
  const pitchingEq = readPitchingWeights();
  const powerEq = await loadPitchingPowerEq(CURRENT_SEASON);

  // 2. Park factors
  const parkMap = await fetchParkFactorsMap(CURRENT_SEASON);

  // 3. Teams Table — for team match + conference + park lookup
  const allTeams = await loadAllPaged<any>(() =>
    (supabase as any).from("Teams Table").select("id, full_name, abbreviation, source_id, conference, conference_id, Season").eq("Season", CURRENT_SEASON),
  );
  type TeamRow = { id: string; name: string; conference: string | null; conference_id: string | null; source_id: string | null };
  const teamByName = new Map<string, TeamRow>();
  const teamById = new Map<string, TeamRow>();
  const teamBySourceId = new Map<string, TeamRow>();
  for (const t of allTeams) {
    const name = (t.full_name || t.abbreviation || "") as string;
    const row: TeamRow = {
      id: t.id as string,
      name,
      conference: (t.conference as string | null) ?? null,
      conference_id: (t.conference_id as string | null) ?? null,
      source_id: (t.source_id as string | null) ?? null,
    };
    teamById.set(t.id, row);
    if (t.source_id) teamBySourceId.set(t.source_id, row);
    for (const k of [t.full_name, t.abbreviation, t.source_id]) {
      const nk = normalizeKey(k);
      if (nk) teamByName.set(nk, row);
    }
  }
  console.log(`  ${allTeams.length} Teams Table rows`);

  // 4. D1 pitchers from players table
  const allPlayers = await loadAllPaged<any>(() =>
    supabase
      .from("players")
      .select("id, first_name, last_name, position, team, from_team, team_id, conference, division, source_player_id, source_team_id"),
  );
  console.log(`  ${allPlayers.length} total players`);
  const pitcherTest = (pos: string | null | undefined) => /^(SP|RP|CL|P|LHP|RHP|SM)/i.test(String(pos || ""));
  const isJuco = (div: string | null | undefined) => div === "NJCAA_D1";
  const pitchers = allPlayers.filter((p) => pitcherTest(p.position) && !isJuco(p.division));
  console.log(`  ${pitchers.length} D1 pitchers after position + non-JUCO filter`);

  // 5. Pitching Master rows (with scouting + stored PR+ values)
  const pmRows = await loadAllPaged<any>(() =>
    (supabase as any)
      .from("Pitching Master")
      .select("*")
      .eq("Season", CURRENT_SEASON)
      .gte("IP", 1)
      .not("Role", "in", "(C,1B,2B,3B,SS,OF,LF,CF,RF,DH,IF,UT)"),
  );
  console.log(`  ${pmRows.length} Pitching Master rows`);

  // Index PM by source_player_id + name+team
  const pmBySourceId = new Map<string, any>();
  const pmByNameTeam = new Map<string, any>();
  const pmByName = new Map<string, any[]>();
  for (const r of pmRows) {
    if (r.source_player_id) pmBySourceId.set(r.source_player_id, r);
    const nameKey = normalizeName(r.playerFullName);
    const teamKey = normalizeName(r.Team);
    if (nameKey && teamKey) pmByNameTeam.set(`${nameKey}|${teamKey}`, r);
    if (nameKey) {
      const list = pmByName.get(nameKey) || [];
      list.push(r);
      pmByName.set(nameKey, list);
    }
  }
  const findPm = (p: any): any | null => {
    if (p.source_player_id && pmBySourceId.has(p.source_player_id)) return pmBySourceId.get(p.source_player_id);
    const nk = normalizeName(`${p.first_name} ${p.last_name}`);
    const teamKey = normalizeName(p.team);
    const direct = pmByNameTeam.get(`${nk}|${teamKey}`);
    if (direct) return direct;
    const bucket = pmByName.get(nk) || [];
    return bucket.length === 1 ? bucket[0] : (bucket[0] || null);
  };

  // 6. Latest player_predictions returner rows — to preserve class_transition + dev_aggressiveness
  const PRED_ID_BATCH = 200;
  const playerIds = pitchers.map((p) => p.id);
  const predRows: any[] = [];
  for (let i = 0; i < playerIds.length; i += PRED_ID_BATCH) {
    const idsChunk = playerIds.slice(i, i + PRED_ID_BATCH);
    const chunk = await loadAllPaged<any>(() =>
      supabase
        .from("player_predictions")
        .select("id, player_id, model_type, variant, status, class_transition, dev_aggressiveness, pitcher_role")
        .in("player_id", idsChunk)
        .eq("model_type", "returner")
        .eq("variant", "regular")
        .is("customer_team_id", null),
    );
    predRows.push(...chunk);
  }
  const existingByPlayer = new Map<string, any>();
  for (const row of predRows) existingByPlayer.set(row.player_id, row);
  console.log(`  ${predRows.length} existing returner rows (model=returner, variant=regular, team=NULL)`);

  // 7. Compute
  console.log(`${C.cyan}→${C.reset} computing projections...`);
  const upserts: any[] = [];
  let blocked = 0;
  let computed = 0;
  const blockReasons = new Map<string, number>();
  const SAMPLES_PER_CATEGORY = 8;
  const blockSamples: Record<string, Array<{ name: string; team: string | null; reason: string }>> = {
    no_pm: [],
    no_team: [],
    no_projection: [],
  };
  const pushSample = (cat: keyof typeof blockSamples, name: string, team: string | null, reason: string) => {
    const arr = blockSamples[cat];
    if (arr.length < SAMPLES_PER_CATEGORY) arr.push({ name, team, reason });
  };

  // Park factor resolver — falls back to name-based lookup if team_id misses.
  const resolveParkFactor = (
    teamIdArg: string | null | undefined,
    names: Array<string | null | undefined>,
    metric: "era" | "whip" | "hr9",
  ): number | null => {
    if (teamIdArg) {
      const v = resolveMetricParkFactor(teamIdArg, metric as any, parkMap);
      if (v != null && Number.isFinite(v)) return v;
    }
    for (const name of names) {
      const v = resolveMetricParkFactor(null, metric as any, parkMap, name as any);
      if (v != null && Number.isFinite(v)) return v;
    }
    return null;
  };
  void resolveParkFactor; // Park is intentionally not applied on returner path (see pitcherProjection.ts:437).

  for (const p of pitchers) {
    const pred = existingByPlayer.get(p.id);
    const pmRow = findPm(p);

    if (!pmRow) {
      blocked++;
      blockReasons.set("no_pm_row", (blockReasons.get("no_pm_row") || 0) + 1);
      pushSample("no_pm", `${p.first_name} ${p.last_name}`, p.team || null, "no Pitching Master row");
      continue;
    }

    // Resolve team match: PM TeamID → players.team_id → name lookup
    const teamRow: TeamRow | null = (() => {
      const pmTeamId = pmRow?.TeamID as string | undefined;
      if (pmTeamId) {
        if (teamById.has(pmTeamId)) return teamById.get(pmTeamId)!;
        if (teamBySourceId.has(pmTeamId)) return teamBySourceId.get(pmTeamId)!;
      }
      if (p.team_id && teamById.has(p.team_id)) return teamById.get(p.team_id)!;
      const nk = normalizeKey(p.team || p.from_team || "");
      if (nk && teamByName.has(nk)) return teamByName.get(nk)!;
      return null;
    })();

    const conference = teamRow?.conference ?? (p.conference as string | null) ?? null;
    const teamName = teamRow?.name ?? (p.team as string | null) ?? null;

    // Use blended_* when combined_used is set (mirror precompute-pitchers.ts pmToStats).
    const combinedUsed = !!pmRow.combined_used;
    const pick = (blended: any, raw: any) => combinedUsed ? (blended ?? raw ?? null) : (raw ?? null);

    const input: PitcherProjectionInput = {
      era: Number.isFinite(Number(pick(pmRow.blended_era, pmRow.ERA))) ? Number(pick(pmRow.blended_era, pmRow.ERA)) : null,
      fip: Number.isFinite(Number(pick(pmRow.blended_fip, pmRow.FIP))) ? Number(pick(pmRow.blended_fip, pmRow.FIP)) : null,
      whip: Number.isFinite(Number(pick(pmRow.blended_whip, pmRow.WHIP))) ? Number(pick(pmRow.blended_whip, pmRow.WHIP)) : null,
      k9: Number.isFinite(Number(pick(pmRow.blended_k9, pmRow.K9))) ? Number(pick(pmRow.blended_k9, pmRow.K9)) : null,
      bb9: Number.isFinite(Number(pick(pmRow.blended_bb9, pmRow.BB9))) ? Number(pick(pmRow.blended_bb9, pmRow.BB9)) : null,
      hr9: Number.isFinite(Number(pick(pmRow.blended_hr9, pmRow.HR9))) ? Number(pick(pmRow.blended_hr9, pmRow.HR9)) : null,
      stuffPlus: pmRow.stuff_plus ?? null,
      miss_pct: pmRow.miss_pct ?? null,
      bb_pct: pmRow.bb_pct ?? null,
      hard_hit_pct: pmRow.hard_hit_pct ?? null,
      in_zone_whiff_pct: pmRow.in_zone_whiff_pct ?? null,
      chase_pct: pmRow.chase_pct ?? null,
      barrel_pct: pmRow.barrel_pct ?? null,
      line_pct: pmRow.line_pct ?? null,
      exit_vel: pmRow.exit_vel ?? null,
      ground_pct: pmRow.ground_pct ?? null,
      in_zone_pct: pmRow.in_zone_pct ?? null,
      vel_90th: pmRow["90th_vel"] ?? null,
      h_pull_pct: pmRow.h_pull_pct ?? null,
      la_10_30_pct: pmRow.la_10_30_pct ?? null,
      role: pmRow.Role ?? null,
      g: pmRow.G ?? null,
      gs: pmRow.GS ?? null,
      team: teamName,
      teamId: teamRow?.id ?? p.team_id ?? null,
      conference,
    };

    const storedPrPlus = {
      era: pmRow.era_pr_plus ?? null,
      fip: pmRow.fip_pr_plus ?? null,
      whip: pmRow.whip_pr_plus ?? null,
      k9: pmRow.k9_pr_plus ?? null,
      bb9: pmRow.bb9_pr_plus ?? null,
      hr9: pmRow.hr9_pr_plus ?? null,
    };

    const classTransition = (pred?.class_transition as "FS" | "SJ" | "JS" | "GR" | undefined) ?? "SJ";
    const devAggressiveness = Number.isFinite(Number(pred?.dev_aggressiveness)) ? Number(pred?.dev_aggressiveness) : 0;

    const result = computePitcherProjection(input, {
      eq: pitchingEq,
      powerEq,
      parkMap,
      teamMatch: teamRow ? { id: teamRow.id, name: teamRow.name, park_factor: null } : null,
      classTransition,
      devAggressiveness,
      storedPrPlus,
    });

    if (result.p_rv_plus == null && result.p_era == null && result.p_fip == null) {
      blocked++;
      blockReasons.set("no_projection", (blockReasons.get("no_projection") || 0) + 1);
      pushSample("no_projection", `${p.first_name} ${p.last_name}`, teamName, "all projection outputs null");
      continue;
    }

    // projected_ip from the engine's projected_role (matches transfer script).
    const projectedIp = pitcherExpectedIp(
      result.projected_role === "SP" ? "weekend_starter"
        : result.projected_role === "SM" ? "weekday_starter"
          : null, // RP fallback in pitcherExpectedIp returns pwar_ip_rp
      pitchingEq,
    );

    upserts.push({
      player_id: p.id,
      customer_team_id: null,
      model_type: "returner",
      variant: "regular",
      season,
      status: "active",
      p_era: result.p_era,
      p_fip: result.p_fip,
      p_whip: result.p_whip,
      p_k9: result.p_k9,
      p_bb9: result.p_bb9,
      p_hr9: result.p_hr9,
      p_rv_plus: result.p_rv_plus,
      p_war: result.p_war,
      market_value: result.market_value,
      projected_ip: projectedIp,
      pitcher_role: result.projected_role,
      // Unlock so future runs can refresh; trigger reverts rates when locked=true.
      locked: false,
      updated_at: new Date().toISOString(),
    });
    computed++;
  }

  console.log(`${C.bold}Result:${C.reset} ${C.green}${computed} computed${C.reset}, ${C.yellow}${blocked} blocked${C.reset} (of ${pitchers.length} D1 pitchers)`);
  if (blocked > 0) {
    console.log(`${C.dim}Block reasons:${C.reset}`);
    const sorted = Array.from(blockReasons.entries()).sort((a, b) => b[1] - a[1]);
    for (const [r, n] of sorted) console.log(`  ${n.toString().padStart(4)}  ${r}`);
    console.log(`${C.dim}Sample blocked players (per category):${C.reset}`);
    for (const [cat, arr] of Object.entries(blockSamples)) {
      if (arr.length === 0) continue;
      console.log(`  [${cat}] (${arr.length} shown)`);
      for (const s of arr) console.log(`    ${s.name.padEnd(28)} team=${(s.team || "-").padEnd(28)} reason=${s.reason}`);
    }
  }

  if (dryRun) {
    console.log(`${C.yellow}[DRY RUN]${C.reset} would upsert ${upserts.length} rows. Sample:`);
    console.log(JSON.stringify(upserts.slice(0, 2), null, 2));
    return;
  }

  // 8. UPSERT in batches
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
