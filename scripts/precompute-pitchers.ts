#!/usr/bin/env node
/**
 * Eager Transfer Pre-compute — PITCHERS. Batch pitcher transfer projections
 * for ONE customer team into `player_predictions` (team-scoped).
 *
 * Mirrors scripts/precompute-transfer-projections.ts (hitter version) so the
 * two never drift. Math: identical to the interactive TransferPortal +
 * TeamBuilder simulator (same shared input builder in
 * src/lib/buildTransferPitcherInputs.ts).
 *
 * Usage:
 *   npm run precompute-pitchers -- --team <customer_team_uuid>
 *   npm run precompute-pitchers -- --team <uuid> --dry-run
 *   npm run precompute-pitchers:prod -- --team <uuid>
 *
 * Writes one row per (player, customer_team, season) with:
 *   model_type='transfer', variant='precomputed', status='active'
 * UPSERT key: (player_id, customer_team_id, model_type, variant, season).
 */

import { supabase } from "@/integrations/supabase/client";
import { CURRENT_SEASON, PROJECTION_SEASON } from "@/lib/seasonConstants";
import { fetchParkFactorsMap, resolveMetricParkFactor } from "@/lib/parkFactors";
import { fetchConferenceStats } from "@/lib/supabaseQueries";
import { readPitchingWeights } from "@/lib/pitchingEquations";
import { getConferenceAliases } from "@/lib/conferenceMapping";
import {
  buildTransferPitcherInputs,
  applyTransferPitcherPostprocess,
  computeTransferPitcherProjection,
  type PitchingConfStats,
  type PitcherStatsRow,
  type PitcherPowerRow,
} from "@/lib/buildTransferPitcherInputs";

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

async function main() {
  const isProd = process.argv.includes("--prod");
  const dryRun = process.argv.includes("--dry-run");
  const teamId = arg("team");
  const season = Number(arg("season") || PROJECTION_SEASON);
  const divisionArg = (arg("division") || "D1").toUpperCase();

  if (!teamId) {
    console.error(`${C.red}✗ --team <customer_team_uuid> required${C.reset}`);
    process.exit(1);
  }

  console.log(`${C.bold}Eager Pitcher Pre-compute${C.reset} on ${isProd ? "PROD" : "STAGING"}${dryRun ? ` ${C.yellow}[DRY RUN]${C.reset}` : ""}`);
  console.log(`  customer_team: ${teamId}`);
  console.log(`  season:        ${season} (data from ${CURRENT_SEASON})`);
  console.log(`  division:      ${divisionArg}`);

  // 1. Customer team → destination team
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

  const { data: toTeamRow, error: ttErr } = await (supabase as any)
    .from("Teams Table")
    .select("id, full_name, abbreviation, source_id, conference, conference_id, Season")
    .eq("id", ct.school_team_id)
    .maybeSingle();
  if (ttErr) throw ttErr;
  if (!toTeamRow) {
    console.error(`${C.red}✗ no Teams Table row for ${ct.school_team_id}${C.reset}`);
    process.exit(1);
  }
  const toTeam = {
    id: toTeamRow.id as string,
    name: (toTeamRow.full_name || toTeamRow.abbreviation) as string,
    conference: (toTeamRow.conference as string | null) ?? null,
    conference_id: (toTeamRow.conference_id as string | null) ?? null,
  };
  const toConference = toTeam.conference;
  const toConferenceId = toTeam.conference_id;
  const toSourceId = (toTeamRow.source_id as string | null) ?? null;
  console.log(`  destination:   ${toTeam.name} (${toConference || "no conf"}, source_id=${toSourceId})`);

  // 2. Lookups
  console.log(`${C.cyan}→${C.reset} loading lookups...`);
  const pitchingEq = readPitchingWeights();

  // 2a. Conference stats → pitching plus stats per conference
  const confRows = await fetchConferenceStats(CURRENT_SEASON);
  const pitchingConfByKey = new Map<string, PitchingConfStats>();
  const pitchingConfById = new Map<string, PitchingConfStats>();
  const toPlus = (
    value: number | null,
    ncaaAvg: number,
    ncaaSd: number,
    scale: number,
    higherIsBetter: boolean,
  ): number | null => {
    if (value == null || !Number.isFinite(value) || !Number.isFinite(ncaaAvg) || !Number.isFinite(ncaaSd) || ncaaSd === 0) return null;
    const core = higherIsBetter ? ((value - ncaaAvg) / ncaaSd) : ((ncaaAvg - value) / ncaaSd);
    const raw = 100 + (core * scale);
    return Number.isFinite(raw) ? raw : null;
  };
  for (const r of confRows) {
    const era = (r as any).ERA;
    const fip = (r as any).FIP;
    const whip = (r as any).WHIP;
    const k9 = (r as any).K9;
    const bb9 = (r as any).BB9;
    const hr9 = (r as any).HR9;
    const stuffPlus = (r as any).Stuff_plus ?? 100;
    const wrcPlus = (r as any).WRC_plus ?? 100;
    const overallPowerRating = (r as any).Overall_Power_Rating ?? 100;
    const eraPlus = toPlus(era, pitchingEq.era_plus_ncaa_avg, pitchingEq.era_plus_ncaa_sd, pitchingEq.era_plus_scale, false);
    const fipPlus = toPlus(fip, pitchingEq.fip_plus_ncaa_avg, pitchingEq.fip_plus_ncaa_sd, pitchingEq.fip_plus_scale, false);
    const whipPlus = toPlus(whip, pitchingEq.whip_plus_ncaa_avg, pitchingEq.whip_plus_ncaa_sd, pitchingEq.whip_plus_scale, false);
    const k9Plus = toPlus(k9, pitchingEq.k9_plus_ncaa_avg, pitchingEq.k9_plus_ncaa_sd, pitchingEq.k9_plus_scale, true);
    const bb9Plus = toPlus(bb9, pitchingEq.bb9_plus_ncaa_avg, pitchingEq.bb9_plus_ncaa_sd, pitchingEq.bb9_plus_scale, false);
    const hr9Plus = toPlus(hr9, pitchingEq.hr9_plus_ncaa_avg, pitchingEq.hr9_plus_ncaa_sd, pitchingEq.hr9_plus_scale, false);
    if (eraPlus == null || fipPlus == null || whipPlus == null || k9Plus == null || bb9Plus == null || hr9Plus == null) continue;
    const hitterTalentPlus = overallPowerRating + (1.25 * (stuffPlus - 100)) + (0.75 * (100 - wrcPlus));
    const entry: PitchingConfStats = {
      conference: (r as any)["conference abbreviation"],
      era_plus: Math.round(eraPlus),
      fip_plus: Math.round(fipPlus),
      whip_plus: Math.round(whipPlus),
      k9_plus: Math.round(k9Plus),
      bb9_plus: Math.round(bb9Plus),
      hr9_plus: Math.round(hr9Plus),
      hitter_talent_plus: Math.round(hitterTalentPlus * 10) / 10,
    };
    const confName = (r as any)["conference abbreviation"] as string | null;
    const confId = (r as any).conference_id as string | null;
    for (const alias of getConferenceAliases(confName || "")) {
      const k = String(alias || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
      if (k && !pitchingConfByKey.has(k)) pitchingConfByKey.set(k, entry);
    }
    if (confId) pitchingConfById.set(confId, entry);
  }
  console.log(`  ${pitchingConfById.size} pitching conference rows (by id)`);

  const resolvePitchingConfStats = (conf: string | null, confId?: string | null): PitchingConfStats => {
    if (confId && pitchingConfById.has(confId)) return pitchingConfById.get(confId)!;
    if (!conf) return null;
    for (const alias of getConferenceAliases(conf)) {
      const k = String(alias || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
      if (k && pitchingConfByKey.has(k)) return pitchingConfByKey.get(k)!;
    }
    return null;
  };

  // 2b. Park factors
  const parkMap = await fetchParkFactorsMap(CURRENT_SEASON);
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

  // 2c. Teams Table — resolve each player's from_team
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

  // 2d. Players — pitchers, excluding the customer team's own roster
  const allPlayers = await loadAllPaged<any>(() =>
    supabase
      .from("players")
      .select("id, first_name, last_name, position, team, from_team, team_id, conference, division, source_player_id, source_team_id, portal_status"),
  );
  console.log(`  ${allPlayers.length} total players`);
  const isPitcher = (pos: string | null | undefined) => {
    const p = String(pos || "").toUpperCase().trim();
    if (!p) return false;
    return /^(SP|RP|CL|P|LHP|RHP|SM)$/.test(p) || /P/.test(p) === false ? /^(SP|RP|CL|P|LHP|RHP|SM)$/.test(p) : true;
  };
  // Simpler + matches hitter script's symmetry
  const pitcherTest = (pos: string | null | undefined) => /^(SP|RP|CL|P|LHP|RHP|SM)/i.test(String(pos || ""));
  const matchesDivision = (div: string | null | undefined) => {
    if (divisionArg === "ALL") return true;
    if (divisionArg === "JUCO") return div === "NJCAA_D1";
    return div !== "NJCAA_D1";
  };
  const pitchers = allPlayers.filter((p) => {
    if (!pitcherTest(p.position)) return false;
    if (toSourceId && p.source_team_id === toSourceId) return false;
    if (!matchesDivision(p.division)) return false;
    return true;
  });
  void isPitcher;
  console.log(`  ${pitchers.length} pitchers after position + own-team + division=${divisionArg} filter`);

  // 2e. Pitching Master rows (pre-blended) — load once
  const pmRows = await loadAllPaged<any>(() =>
    (supabase as any)
      .from("Pitching Master")
      .select("*")
      .eq("Season", CURRENT_SEASON)
      .gte("IP", 1)
      .not("Role", "in", "(C,1B,2B,3B,SS,OF,LF,CF,RF,DH,IF,UT)"),
  );
  console.log(`  ${pmRows.length} Pitching Master rows`);

  // Index PM by source_player_id (canonical) + name+team fallback
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

  // Convert PM row → PitcherStatsRow (mirrors usePitchingSeedData blend logic)
  const pmToStats = (r: any): PitcherStatsRow => {
    const combinedUsed = !!r.combined_used;
    return {
      role: r.Role ?? null,
      g: r.G ?? null,
      gs: r.GS ?? null,
      ip: r.regular_season_ip ?? r.IP ?? null,
      era: combinedUsed ? (r.blended_era ?? r.ERA) ?? null : (r.ERA ?? null),
      fip: combinedUsed ? (r.blended_fip ?? r.FIP) ?? null : (r.FIP ?? null),
      whip: combinedUsed ? (r.blended_whip ?? r.WHIP) ?? null : (r.WHIP ?? null),
      k9: combinedUsed ? (r.blended_k9 ?? r.K9) ?? null : (r.K9 ?? null),
      bb9: combinedUsed ? (r.blended_bb9 ?? r.BB9) ?? null : (r.BB9 ?? null),
      hr9: combinedUsed ? (r.blended_hr9 ?? r.HR9) ?? null : (r.HR9 ?? null),
      teamId: r.TeamID ?? null,
    };
  };

  const pmToPower = (r: any): PitcherPowerRow => {
    // Use stored PR+ from Pitching Master (written by projection pipeline).
    // If all null, return null so JUCO branch can still proceed.
    const power = {
      eraPrPlus: r.era_pr_plus ?? null,
      fipPrPlus: r.fip_pr_plus ?? null,
      whipPrPlus: r.whip_pr_plus ?? null,
      k9PrPlus: r.k9_pr_plus ?? null,
      bb9PrPlus: r.bb9_pr_plus ?? null,
      hr9PrPlus: r.hr9_pr_plus ?? null,
    };
    const anyValue = Object.values(power).some((v) => v != null);
    return anyValue ? power : null;
  };

  // 2f. Latest active player_predictions per player (for class_transition + dev_aggressiveness)
  const PRED_ID_BATCH = 200;
  const playerIds = pitchers.map((p) => p.id);
  const predRows: any[] = [];
  for (let i = 0; i < playerIds.length; i += PRED_ID_BATCH) {
    const idsChunk = playerIds.slice(i, i + PRED_ID_BATCH);
    const chunk = await loadAllPaged<any>(() =>
      supabase
        .from("player_predictions")
        .select("id, player_id, model_type, variant, status, updated_at, class_transition, dev_aggressiveness")
        .in("player_id", idsChunk)
        .in("model_type", ["returner", "transfer"])
        .is("customer_team_id", null),
    );
    predRows.push(...chunk);
  }
  const rank = (row: any) => {
    const statusBoost = row.status === "active" ? 2 : row.status === "departed" ? 1 : 0;
    const variantBoost = row.variant === "regular" ? 3 : 0;
    return (row.model_type === "transfer" ? 3 : 1) + variantBoost + statusBoost;
  };
  const bestPredByPlayer = new Map<string, any>();
  for (const row of predRows) {
    const k = row.player_id as string;
    const existing = bestPredByPlayer.get(k);
    if (!existing || rank(row) > rank(existing)) bestPredByPlayer.set(k, row);
  }

  // 3. Compute
  console.log(`${C.cyan}→${C.reset} computing projections...`);
  const upserts: any[] = [];
  let blocked = 0;
  let computed = 0;
  const blockReasons = new Map<string, number>();
  const SAMPLES_PER_CATEGORY = 8;
  const blockSamples: Record<string, Array<{ name: string; team: string | null; conf: string | null; reason: string }>> = {
    "no_stats": [],
    "no_power": [],
    "no_from_conf": [],
    "no_to_conf": [],
    "no_from_team": [],
    "lib_blocked": [],
    "other": [],
  };
  const pushSample = (cat: string, name: string, team: string | null, conf: string | null, reason: string) => {
    const arr = blockSamples[cat] || blockSamples["other"];
    if (arr.length < SAMPLES_PER_CATEGORY) arr.push({ name, team, conf, reason });
  };
  const divCounters: Record<string, { total: number; computed: number; blocked: number }> = {};
  const bumpDiv = (div: string | null, key: "computed" | "blocked") => {
    const d = div || "UNKNOWN";
    if (!divCounters[d]) divCounters[d] = { total: 0, computed: 0, blocked: 0 };
    divCounters[d].total += 1;
    divCounters[d][key] += 1;
  };

  for (const p of pitchers) {
    const pred = bestPredByPlayer.get(p.id);
    const pmRow = findPm(p);

    // Resolve from team: prefer PM TeamID → players.team_id → name lookup
    const fromTeamRow: TeamRow | null = (() => {
      const pmTeamId = pmRow?.TeamID as string | undefined;
      if (pmTeamId) {
        if (teamById.has(pmTeamId)) return teamById.get(pmTeamId)!;
        if (teamBySourceId.has(pmTeamId)) return teamBySourceId.get(pmTeamId)!;
      }
      if (p.team_id && teamById.has(p.team_id)) return teamById.get(p.team_id)!;
      const nk = normalizeKey(p.from_team || p.team || "");
      if (nk && teamByName.has(nk)) return teamByName.get(nk)!;
      return null;
    })();
    const fromTeamName = (p.from_team || p.team || "") as string;
    const fromConference = fromTeamRow?.conference ?? (p.conference as string | null) ?? null;
    const fromConferenceId = fromTeamRow?.conference_id ?? null;

    const pitchingStats: PitcherStatsRow | null = pmRow ? pmToStats(pmRow) : null;
    const pitcherPowerRatings: PitcherPowerRow = pmRow ? pmToPower(pmRow) : null;

    const result = buildTransferPitcherInputs({
      player: {
        first_name: p.first_name,
        last_name: p.last_name,
        position: p.position,
        conference: p.conference,
        division: p.division,
        team: p.team,
        team_id: p.team_id,
        source_player_id: p.source_player_id,
        class_transition: pred?.class_transition ?? null,
        dev_aggressiveness: Number.isFinite(Number(pred?.dev_aggressiveness)) ? Number(pred?.dev_aggressiveness) : null,
      },
      fromTeam: fromTeamRow,
      toTeam,
      fromConference,
      fromConferenceId,
      toConference,
      toConferenceId,
      pitchingStats,
      pitcherPowerRatings,
      resolvePitchingConfStats,
      resolveParkFactor,
      pitchingEq,
    });

    if (result.blocked) {
      blocked++;
      bumpDiv(p.division, "blocked");
      blockReasons.set(result.blockedReason, (blockReasons.get(result.blockedReason) || 0) + 1);
      const cat = result.blockedReason === "no_stats"
        ? (pmRow ? "no_stats" : (fromTeamRow ? "no_stats" : "no_from_team"))
        : result.blockedReason;
      pushSample(cat, `${p.first_name} ${p.last_name}`, fromTeamName || null, fromConference, result.blockedReason);
      continue;
    }

    const projected = computeTransferPitcherProjection(result.input, result.ctx);
    if (projected.blocked) {
      blocked++;
      bumpDiv(p.division, "blocked");
      blockReasons.set("lib_blocked", (blockReasons.get("lib_blocked") || 0) + 1);
      pushSample("lib_blocked", `${p.first_name} ${p.last_name}`, fromTeamName || null, fromConference, projected.missingInputs.slice(0, 3).join(", "));
      continue;
    }

    const final = applyTransferPitcherPostprocess(projected, {
      classTransition: pred?.class_transition ?? null,
      devAggressiveness: pred?.dev_aggressiveness ?? null,
      isJucoSource: result.isJucoSource,
      pitchingEq,
    });

    bumpDiv(p.division, "computed");

    upserts.push({
      player_id: p.id,
      customer_team_id: teamId,
      model_type: "transfer",
      variant: "precomputed",
      season,
      status: "active",
      class_transition: pred?.class_transition ?? null,
      dev_aggressiveness: pred?.dev_aggressiveness ?? null,
      p_era: final.p_era,
      p_fip: final.p_fip,
      p_whip: final.p_whip,
      p_k9: final.p_k9,
      p_bb9: final.p_bb9,
      p_hr9: final.p_hr9,
      p_rv_plus: final.p_rv_plus,
      pitcher_role: final.pitcher_role,
      updated_at: new Date().toISOString(),
    });
    computed++;
  }

  console.log(`${C.bold}Result:${C.reset} ${C.green}${computed} computed${C.reset}, ${C.yellow}${blocked} blocked${C.reset}`);
  console.log(`${C.dim}By division:${C.reset}`);
  const divs = Object.entries(divCounters).sort((a, b) => b[1].total - a[1].total);
  for (const [d, c] of divs) {
    const pct = c.total === 0 ? "0" : ((c.computed / c.total) * 100).toFixed(0);
    console.log(`  ${d.padEnd(12)} total=${c.total.toString().padStart(5)}  computed=${c.computed.toString().padStart(5)}  blocked=${c.blocked.toString().padStart(5)}  (${pct}%)`);
  }
  if (blocked > 0) {
    console.log(`${C.dim}Top block reasons:${C.reset}`);
    const sorted = Array.from(blockReasons.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [r, n] of sorted) console.log(`  ${n.toString().padStart(4)}  ${r}`);
    console.log(`${C.dim}Sample blocked players (per category):${C.reset}`);
    for (const [cat, arr] of Object.entries(blockSamples)) {
      if (arr.length === 0) continue;
      console.log(`  [${cat}] (${arr.length} shown)`);
      for (const s of arr) console.log(`    ${s.name.padEnd(28)} team=${(s.team || "-").padEnd(28)} conf=${s.conf || "-"}  reason=${s.reason}`);
    }
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
