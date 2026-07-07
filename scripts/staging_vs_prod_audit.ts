/**
 * Staging vs Prod data audit.
 *
 * Counts rows in every meaningful table on both DBs and reports the diff.
 * Adds known-issue column-population checks where we've previously
 * spotted gaps (Hitter Master power ratings, etc.).
 *
 * Run twice with different envs:
 *   npx tsx --env-file-if-exists=.env.local scripts/staging_vs_prod_audit.ts > /tmp/staging.json
 *   npx tsx --env-file-if-exists=.env.production.local scripts/staging_vs_prod_audit.ts > /tmp/prod.json
 *
 * Or — for a single-pass report — see the diff loop at the bottom which
 * shells out via env vars.
 */
import { createClient } from "@supabase/supabase-js";

const STAGING_URL = "https://slrxowawbijbjrkozqlj.supabase.co";
const PROD_URL = "https://trbvxuoliwrfowibatkm.supabase.co";

// Need both service-role keys. Pull from env if present.
const stagingKey = process.env.STAGING_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const prodKey = process.env.PROD_SERVICE_ROLE_KEY;

if (!stagingKey || !prodKey) {
  console.error("Need both STAGING_SERVICE_ROLE_KEY and PROD_SERVICE_ROLE_KEY in env");
  console.error("Helper: cat .env.local .env.production.local | grep SERVICE_ROLE");
  process.exit(1);
}

const staging = createClient(STAGING_URL, stagingKey, { auth: { persistSession: false } });
const prod = createClient(PROD_URL, prodKey, { auth: { persistSession: false } });

type CountSpec = {
  table: string;
  /** Optional per-season scoping */
  season?: number;
  /** Optional filter — written as SQL eq pairs */
  filter?: Record<string, any>;
  /** Optional column name to count non-null on (for population checks) */
  nonNullCol?: string;
  /** Friendly label for the report */
  label?: string;
};

const SPECS: CountSpec[] = [
  // Core entities
  { table: "players", label: "players (total)" },
  { table: "players", filter: { division: "D1" }, label: "players (D1)" },
  { table: "players", filter: { division: "NJCAA_D1" }, label: "players (JUCO)" },
  { table: "players", filter: { transfer_portal: true }, label: "players (in portal)" },

  // Predictions
  { table: "player_predictions", label: "player_predictions (all)" },
  { table: "player_predictions", season: 2026, label: "player_predictions (2026)" },
  { table: "player_predictions", season: 2027, label: "player_predictions (2027)" },
  { table: "player_predictions", season: 2027, filter: { variant: "regular" }, label: "player_predictions (2027 regular)" },
  { table: "player_predictions", season: 2027, filter: { variant: "precomputed" }, label: "player_predictions (2027 precomputed)" },
  { table: "player_predictions", season: 2027, filter: { status: "active" }, label: "player_predictions (2027 active)" },
  { table: "player_predictions", season: 2027, filter: { status: "stale" }, label: "player_predictions (2027 stale)" },

  // Master stat tables
  { table: "Hitter Master", season: 2026, label: "Hitter Master 2026" },
  { table: "Hitter Master", season: 2026, nonNullCol: "overall_power_rating", label: "  └ with overall_power_rating" },
  { table: "Hitter Master", season: 2026, nonNullCol: "barrel_score", label: "  └ with barrel_score" },
  { table: "Hitter Master", season: 2026, nonNullCol: "contact_score", label: "  └ with contact_score" },
  { table: "Hitter Master", season: 2026, nonNullCol: "chase_score", label: "  └ with chase_score" },
  { table: "Hitter Master", season: 2026, nonNullCol: "ev_score", label: "  └ with ev_score" },
  { table: "Pitching Master", season: 2026, label: "Pitching Master 2026" },
  { table: "Pitching Master", season: 2026, nonNullCol: "overall_pr_plus", label: "  └ with overall_pr_plus" },
  { table: "Pitching Master", season: 2026, nonNullCol: "stuffPlus", label: "  └ with stuffPlus" },

  // Per-pitch + scouting inputs
  { table: "pitcher_stuff_plus_inputs", season: 2026, label: "pitcher_stuff_plus_inputs (2026)" },
  { table: "pitcher_stuff_plus_ncaa", label: "pitcher_stuff_plus_ncaa" },

  // Aggregate / config tables
  { table: "Conference Stats", label: "Conference Stats" },
  { table: "Teams Table", label: "Teams Table" },
  { table: "teams", label: "teams" },
  { table: "customer_teams", label: "customer_teams" },
  { table: "park_factors", label: "park_factors" },
  { table: "ncaa_averages", label: "ncaa_averages" },
  { table: "model_config", label: "model_config" },
  { table: "team_war_snapshots", label: "team_war_snapshots" },

  // User-facing data
  { table: "nil_valuations", label: "nil_valuations" },
  { table: "target_board", label: "target_board" },
  { table: "high_follow", label: "high_follow" },
  { table: "season_stats", label: "season_stats" },
  { table: "coach_notes", label: "coach_notes" },
  { table: "ai_scouting_reports", label: "ai_scouting_reports" },
  { table: "player_overrides", label: "player_overrides" },
  { table: "player_prediction_internals", label: "player_prediction_internals" },

  // Portal
  { table: "portal_entries_unmatched", label: "portal_entries_unmatched" },

  // Team Builder
  { table: "builds", label: "builds" },
  { table: "team_build_players", label: "team_build_players" },
  { table: "team_build_players", nonNullCol: "player_snapshot", label: "  └ with player_snapshot" },

  // ABS (we just added these — staging should have data, prod should not)
  { table: "abs_hitter_stats", label: "abs_hitter_stats" },
  { table: "abs_pitcher_stats", label: "abs_pitcher_stats" },
];

async function count(sb: any, spec: CountSpec): Promise<number | string> {
  try {
    let q = sb.from(spec.table).select("*", { count: "exact", head: true });
    if (spec.season != null) {
      // Hitter Master / Pitching Master / Conference Stats use "Season"; everything else uses "season"
      const seasonCol = (spec.table === "Hitter Master" || spec.table === "Pitching Master" || spec.table === "Conference Stats") ? "Season" : "season";
      q = q.eq(seasonCol, spec.season);
    }
    if (spec.filter) {
      for (const [k, v] of Object.entries(spec.filter)) q = q.eq(k, v);
    }
    if (spec.nonNullCol) {
      q = q.not(spec.nonNullCol, "is", null);
    }
    const { count, error } = await q;
    if (error) return `ERR: ${error.message}`;
    return count ?? 0;
  } catch (e: any) {
    return `THROW: ${e?.message ?? String(e)}`;
  }
}

const fmt = (n: number | string): string => typeof n === "number" ? n.toLocaleString() : n;
const pad = (s: string, w: number): string => s.length >= w ? s : s + " ".repeat(w - s.length);

console.log("Table".padEnd(48), "Staging".padStart(14), "Prod".padStart(14), "Diff".padStart(14));
console.log("=".repeat(48 + 14 * 3 + 6));

for (const spec of SPECS) {
  const label = spec.label || `${spec.table}${spec.season ? ` (${spec.season})` : ""}${spec.nonNullCol ? ` [${spec.nonNullCol} not null]` : ""}`;
  const [s, p] = await Promise.all([count(staging, spec), count(prod, spec)]);
  let diff = "";
  if (typeof s === "number" && typeof p === "number") {
    const d = s - p;
    diff = d === 0 ? "0" : d > 0 ? `+${d.toLocaleString()}` : `${d.toLocaleString()}`;
  } else {
    diff = "?";
  }
  console.log(pad(label, 48), fmt(s).padStart(14), fmt(p).padStart(14), diff.padStart(14));
}
