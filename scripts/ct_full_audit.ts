/**
 * Comprehensive class_transition audit.
 * Read-only. Run against staging AND prod.
 *
 * Dimensions checked:
 *  (1) Row-level mismatch: stored ct != expected ct (per prod's canonical mapping)
 *  (2) Per-player inconsistency: same player has differing ct across variants/teams
 *  (3) Unknown class_year buckets: rows skipped (transfers, missing data, etc.)
 */
import { createClient } from "@supabase/supabase-js";

const STAGING = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const PROD = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Canonical mapping — PROD convention (redshirts collapse to base class)
function expected(cy: string | null | undefined): string | null {
  switch (cy) {
    case "FR": case "R-FR": return "FS";
    case "SO": case "R-SO": return "SJ";
    case "JR": case "R-JR": return "JS";
    case "SR": return "GR";
    default: return null;
  }
}

type Row = {
  player_id: string;
  customer_team_id: string | null;
  variant: string;
  class_transition: string | null;
  players: { class_year: string | null; first_name: string; last_name: string } | null;
};

async function pullAll(sb: any): Promise<Row[]> {
  const all: Row[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("player_predictions")
      .select("player_id, customer_team_id, variant, class_transition, players!inner(class_year, first_name, last_name)")
      .eq("season", 2027)
      .order("id")
      .range(from, from + 999);
    if (error) { console.log("err", error.message); break; }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

async function audit(label: string, sb: any) {
  console.log(`\n========== ${label} ==========`);
  const rows = await pullAll(sb);
  console.log(`Total 2027 rows: ${rows.length}`);

  // (1) Row-level mismatches
  let mismatch = 0, match = 0, unknown = 0;
  const mismatchSamples: any[] = [];
  const unknownCyBuckets: Record<string, number> = {};
  for (const r of rows) {
    const cy = r.players?.class_year;
    const exp = expected(cy);
    if (exp == null) {
      unknown++;
      const k = cy ?? "NULL";
      unknownCyBuckets[k] = (unknownCyBuckets[k] || 0) + 1;
      continue;
    }
    if (r.class_transition === exp) match++;
    else {
      mismatch++;
      if (mismatchSamples.length < 10) mismatchSamples.push({
        name: `${r.players?.first_name} ${r.players?.last_name}`,
        cy, stored: r.class_transition, expected: exp, variant: r.variant, team: r.customer_team_id?.slice(0,8) ?? "(global)",
      });
    }
  }
  console.log(`\n(1) Row-level mismatches: ${mismatch} / ${match + mismatch} known-class rows`);
  for (const s of mismatchSamples) console.log(`    ${s.name.padEnd(28)} cy=${s.cy?.padEnd(5)} stored=${s.stored?.padEnd(3)} expected=${s.expected} variant=${s.variant.padEnd(11)} team=${s.team}`);

  // (2) Per-player consistency — same player, differing ct across rows
  const byPlayer: Record<string, Set<string>> = {};
  const playerMeta: Record<string, { name: string; cy: string | null }> = {};
  for (const r of rows) {
    const k = r.player_id;
    if (!byPlayer[k]) byPlayer[k] = new Set();
    byPlayer[k].add(r.class_transition ?? "NULL");
    if (!playerMeta[k]) playerMeta[k] = { name: `${r.players?.first_name} ${r.players?.last_name}`, cy: r.players?.class_year ?? null };
  }
  let inconsistentPlayers = 0;
  const inconsistentSamples: any[] = [];
  for (const [pid, set] of Object.entries(byPlayer)) {
    if (set.size > 1) {
      inconsistentPlayers++;
      if (inconsistentSamples.length < 10) inconsistentSamples.push({
        name: playerMeta[pid].name, cy: playerMeta[pid].cy, values: Array.from(set).join("/"),
      });
    }
  }
  console.log(`\n(2) Players with INCONSISTENT class_transition across their rows: ${inconsistentPlayers} / ${Object.keys(byPlayer).length}`);
  for (const s of inconsistentSamples) console.log(`    ${s.name.padEnd(28)} cy=${s.cy?.padEnd(5)} values={${s.values}}`);

  // (3) Unknown class_year buckets
  console.log(`\n(3) Unknown class_year buckets (${unknown} rows skipped):`);
  for (const [k, v] of Object.entries(unknownCyBuckets).sort((a,b)=>b[1]-a[1])) {
    console.log(`    ${k.padEnd(10)} ${v}`);
  }
}

await audit("STAGING", STAGING);
await audit("PROD", PROD);
