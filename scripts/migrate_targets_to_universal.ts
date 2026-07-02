#!/usr/bin/env node
/**
 * Migrate per-build WATCHLIST targets -> universal target_board.
 *
 * Background: historically, "targets" (shopping-list players a coach is
 * evaluating) were stored as team_build_players rows with roster_status='target'
 * and included_in_roster=false — one competing set PER BUILD. The universal
 * target_board (scoped by customer_team_id) is the correct home: one shared
 * board that appears on every build. This script moves the per-build watchlist
 * rows into target_board (deduped), then deletes them from the builds.
 *
 * SCOPE: only rows that are (a) a target (source='portal' OR notes.rosterStatus
 * ='target') AND (b) included_in_roster === false (pure watchlist). Targets a
 * coach has pulled onto a build's active roster (included_in_roster=true) are
 * real build-specific roster decisions and are LEFT UNTOUCHED.
 *
 * Idempotent + additive to target_board (check-then-insert, no constraint
 * assumption). Deletes only the exact team_build_players rows it migrates.
 *
 * Usage:
 *   npm run migrate-targets                       # staging, dry-run
 *   npm run migrate-targets -- --apply            # staging, write
 *   npm run migrate-targets:prod -- --apply       # prod, write
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or VITE_ prefix).
 */
import { createClient } from "@supabase/supabase-js";

const isUuid = (v: any): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

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

function isWatchlistTarget(r: any): boolean {
  if (r.included_in_roster !== false) return false; // on-roster or returner — leave it
  if (r.source === "portal") return true;
  try {
    const meta = JSON.parse(r.production_notes || "{}");
    return meta.rosterStatus === "target" || meta.roster_status === "target";
  } catch {
    return false;
  }
}

async function main() {
  const isProd = process.argv.includes("--prod");
  const apply = process.argv.includes("--apply");
  const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").toLowerCase();
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || "";
  const looksLikeProd = supabaseUrl.includes("trbvxuoliwrfowibatkm") || supabaseUrl.includes("prod");
  if (looksLikeProd && !isProd) { console.error("✗ SUPABASE_URL looks like PROD but --prod not passed. Refusing."); process.exit(1); }
  if (isProd && !looksLikeProd) { console.error("✗ --prod passed but SUPABASE_URL doesn't look like prod. Refusing."); process.exit(1); }
  const ENV = looksLikeProd ? "PROD" : "STAGING";
  const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  console.log(`\n=== Migrate watchlist targets -> universal target_board (${ENV}, ${apply ? "APPLY" : "DRY-RUN"}) ===\n`);

  // 1. build_id -> {customer_team_id, user_id}
  const builds = await loadAllPaged<any>(() => sb.from("team_builds").select("id, customer_team_id, user_id"));
  const buildMeta = new Map<string, { team: string; owner: string | null }>(
    builds.map((b: any) => [b.id, { team: b.customer_team_id, owner: b.user_id ?? null }]),
  );

  // 2. all team_build_players, filter to watchlist targets w/ real player_id + resolvable team
  const bps = await loadAllPaged<any>(() =>
    sb.from("team_build_players").select("id, build_id, player_id, source, included_in_roster, production_notes, custom_name"),
  );
  const targets = bps.filter(
    (r: any) => isWatchlistTarget(r) && isUuid(r.player_id) && buildMeta.get(r.build_id)?.team,
  );

  // 3. dedupe by (customer_team_id, player_id) — keep one, remember ALL row ids to delete
  type Group = { team: string; player_id: string; owner: string | null; notes: string | null; rowIds: string[] };
  const groups = new Map<string, Group>();
  for (const r of targets) {
    const meta = buildMeta.get(r.build_id)!;
    const key = `${meta.team}|${r.player_id}`;
    let g = groups.get(key);
    if (!g) { g = { team: meta.team, player_id: r.player_id, owner: meta.owner, notes: null, rowIds: [] }; groups.set(key, g); }
    if (!g.owner && meta.owner) g.owner = meta.owner;
    g.rowIds.push(r.id);
  }
  console.log(`Watchlist target rows: ${targets.length}  ->  ${groups.size} distinct (team,player)`);

  // 4. skip any already on target_board
  const tbSample = (await sb.from("target_board").select("*").limit(1)).data?.[0] ?? {};
  const hasNotes = "notes" in tbSample;
  const hasAddedAt = "added_at" in tbSample;
  const teamIds = [...new Set([...groups.values()].map((g) => g.team))];
  const existing = await loadAllPaged<any>(() =>
    sb.from("target_board").select("customer_team_id, player_id").in("customer_team_id", teamIds),
  );
  const existingKeys = new Set(existing.map((r: any) => `${r.customer_team_id}|${r.player_id}`));
  const toInsert = [...groups.values()].filter((g) => !existingKeys.has(`${g.team}|${g.player_id}`));
  const alreadyThere = groups.size - toInsert.length;

  console.log(`Already on target_board: ${alreadyThere} | to insert: ${toInsert.length}`);
  const allRowIds = [...groups.values()].flatMap((g) => g.rowIds);
  console.log(`team_build_players rows to delete: ${allRowIds.length}`);

  if (!apply) { console.log(`\n[dry-run] no writes. Re-run with --apply.`); return; }

  // 5. insert missing target_board rows
  const insertRows = toInsert.map((g) => {
    const row: any = { customer_team_id: g.team, player_id: g.player_id, user_id: g.owner };
    if (hasNotes) row.notes = g.notes;
    return row;
  });
  for (let i = 0; i < insertRows.length; i += 500) {
    const { error } = await sb.from("target_board").insert(insertRows.slice(i, i + 500));
    if (error) throw new Error(`target_board insert @${i}: ${error.message} | ${error.details ?? ""}`);
  }

  // 6. delete the migrated build rows
  for (let i = 0; i < allRowIds.length; i += 500) {
    const { error } = await sb.from("team_build_players").delete().in("id", allRowIds.slice(i, i + 500));
    if (error) throw new Error(`team_build_players delete @${i}: ${error.message}`);
  }

  console.log(`\n✅ inserted ${insertRows.length} target_board rows, deleted ${allRowIds.length} per-build watchlist rows. Targets are now universal.`);
  void hasAddedAt;
}

main().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
