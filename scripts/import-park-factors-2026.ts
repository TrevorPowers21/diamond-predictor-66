/**
 * One-shot 2026 park factor loader.
 *
 * Methodology:
 *   For each team, every park-factor stat is computed as the mean of the
 *   hitter file (the team's offense at home) and the pitcher file (opponents'
 *   stats at that home park), then divided by the 2026 NCAA average constant
 *   and multiplied by 100. This removes team-quality bias by capturing both
 *   sides of how the park plays.
 *
 *     factor = ((team_at_home + opponents_at_home) / 2) / NCAA_constant × 100
 *
 *   Combined factors come from the Combined hitter + Combined pitcher CSVs.
 *   LHB factors come from the LHB hitter + LHB pitcher CSVs.
 *   RHB factors come from the RHB hitter + RHB pitcher CSVs.
 *
 *   Same NCAA constant is used across every cohort and team — it's a league
 *   baseline, not the cohort mean.
 *
 * Usage:
 *   npx tsx scripts/import-park-factors-2026.ts          # staging (.env.local)
 *   npx tsx scripts/import-park-factors-2026.ts --prod   # prod
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const isProd = process.argv.includes("--prod");
const STAGING_DIR = "/Users/danielleogonowski/RSTR IQ Data/staging";
const SEASON = 2026;

// 2026 NCAA averages. AVG/OBP/ISO come from ncaa_averages table; R/G is a
// user-supplied constant matching the 2026 league baseline.
const NCAA = {
  rg: 6.65,
  avg: 0.278,
  obp: 0.383,
  iso: 0.158,
};

const url = isProd
  ? "https://trbvxuoliwrfowibatkm.supabase.co"
  : "https://slrxowawbijbjrkozqlj.supabase.co";
const envFile = isProd ? ".env.production.local" : ".env.local";
const key = readFileSync(envFile, "utf-8")
  .split("\n")
  .find(l => l.startsWith("SUPABASE_SERVICE_ROLE_KEY="))
  ?.split("=", 2)[1] ?? "";

const sb = createClient(url, key);

type Row = { team: string; teamFullName: string; rg?: number; avg?: number; obp?: number; iso?: number };

function parseCsv(file: string, hasRG: boolean): Row[] {
  const text = readFileSync(file, "utf-8");
  const lines = text.split("\n").filter(Boolean);
  const headers = lines[0].split(",");
  const idx = (h: string) => headers.indexOf(h);
  const out: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",");
    const num = (s: string) => {
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : undefined;
    };
    out.push({
      team: cells[idx("team")] || "",
      teamFullName: cells[idx("teamFullName")] || "",
      rg: hasRG ? num(cells[idx("R/G")]) : undefined,
      avg: num(cells[idx("AVG")]),
      obp: num(cells[idx("OBP")]),
      iso: num(cells[idx("ISO")]),
    });
  }
  return out;
}

const meanPair = (a?: number, b?: number) => {
  if (a == null && b == null) return null;
  if (a == null) return b ?? null;
  if (b == null) return a;
  return (a + b) / 2;
};

const toFactor = (raw: number | null, ncaa: number) =>
  raw == null ? null : Math.round((raw / ncaa) * 100 * 100) / 100;

const normalizeTeam = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

async function main() {
  console.log(`Target: ${isProd ? "PROD" : "STAGING"} (${url})`);
  console.log(`Season: ${SEASON}`);
  console.log(`NCAA constants: R/G=${NCAA.rg} AVG=${NCAA.avg} OBP=${NCAA.obp} ISO=${NCAA.iso}`);

  const combinedHit = new Map(parseCsv(`${STAGING_DIR}/${SEASON} Combined Hitter Park Factors 3YR 0518.csv`, true).map(r => [normalizeTeam(r.team), r]));
  const combinedPit = new Map(parseCsv(`${STAGING_DIR}/${SEASON} Combined Pitcher Park Factors 3YR 0518.csv`, true).map(r => [normalizeTeam(r.team), r]));
  const lhbHit = new Map(parseCsv(`${STAGING_DIR}/${SEASON} LHB Hitter Park Factors 3YR 0518.csv`, false).map(r => [normalizeTeam(r.team), r]));
  const lhbPit = new Map(parseCsv(`${STAGING_DIR}/${SEASON} LHB Pitcher Park Factors 3YR 0518.csv`, false).map(r => [normalizeTeam(r.team), r]));
  const rhbHit = new Map(parseCsv(`${STAGING_DIR}/${SEASON} RHB Hitter Park Factors 3YR 0518.csv`, false).map(r => [normalizeTeam(r.team), r]));
  const rhbPit = new Map(parseCsv(`${STAGING_DIR}/${SEASON} RHB Pitcher Park Factors 3YR 0518.csv`, false).map(r => [normalizeTeam(r.team), r]));

  console.log(`Loaded ${combinedHit.size}/${combinedPit.size}/${lhbHit.size}/${lhbPit.size}/${rhbHit.size}/${rhbPit.size} rows from the 6 CSVs.`);

  // Look up team_id + source_team_id from Teams Table for season 2026
  const { data: teams } = await (sb as any).from("Teams Table").select("id, abbreviation, full_name, source_id").eq("Season", SEASON);
  console.log(`Loaded ${teams?.length ?? 0} 2026 Teams Table rows.`);
  const teamLookup = new Map<string, { id: string; abbreviation: string; full_name: string | null; source_id: string | null }>();
  for (const t of teams ?? []) {
    if (t.abbreviation) teamLookup.set(normalizeTeam(t.abbreviation), t);
    if (t.full_name) teamLookup.set(normalizeTeam(t.full_name), t);
  }

  const rows: any[] = [];
  const skipped: string[] = [];
  const unionTeams = new Set<string>([...combinedHit.keys(), ...combinedPit.keys()]);
  for (const key of unionTeams) {
    const ch = combinedHit.get(key);
    const cp = combinedPit.get(key);
    const lh = lhbHit.get(key);
    const lp = lhbPit.get(key);
    const rh = rhbHit.get(key);
    const rp = rhbPit.get(key);

    const displayName = ch?.team || cp?.team || "";
    const teamMatch = teamLookup.get(key);

    rows.push({
      team_name: displayName,
      team_id: teamMatch?.id ?? null,
      source_team_id: teamMatch?.source_id ?? null,
      season: SEASON,
      // Combined factors (used by pitchers + switch-hitters)
      rg_factor: toFactor(meanPair(ch?.rg, cp?.rg), NCAA.rg),
      avg_factor: toFactor(meanPair(ch?.avg, cp?.avg), NCAA.avg),
      obp_factor: toFactor(meanPair(ch?.obp, cp?.obp), NCAA.obp),
      iso_factor: toFactor(meanPair(ch?.iso, cp?.iso), NCAA.iso),
      // Per user spec, pitcher WHIP uses OBP factor, pitcher HR9 uses ISO factor.
      // Storing them as separate columns lets existing code paths keep reading
      // whip_factor/hr9_factor without immediate rewiring.
      whip_factor: toFactor(meanPair(ch?.obp, cp?.obp), NCAA.obp),
      hr9_factor: toFactor(meanPair(ch?.iso, cp?.iso), NCAA.iso),
      // LHB factors
      lhb_avg_factor: toFactor(meanPair(lh?.avg, lp?.avg), NCAA.avg),
      lhb_obp_factor: toFactor(meanPair(lh?.obp, lp?.obp), NCAA.obp),
      lhb_iso_factor: toFactor(meanPair(lh?.iso, lp?.iso), NCAA.iso),
      // RHB factors
      rhb_avg_factor: toFactor(meanPair(rh?.avg, rp?.avg), NCAA.avg),
      rhb_obp_factor: toFactor(meanPair(rh?.obp, rp?.obp), NCAA.obp),
      rhb_iso_factor: toFactor(meanPair(rh?.iso, rp?.iso), NCAA.iso),
    });

    if (!teamMatch) skipped.push(displayName);
  }

  console.log(`\n${rows.length} factor rows computed.`);
  if (skipped.length > 0) {
    console.log(`⚠️  ${skipped.length} teams couldn't be linked to a 2026 Teams Table row (factors still written, team_id/source_team_id null):`);
    for (const s of skipped.slice(0, 20)) console.log(`     ${s}`);
    if (skipped.length > 20) console.log(`     ...and ${skipped.length - 20} more`);
  }

  // Production confirmation
  if (isProd) {
    process.stdout.write("\n⚠️  PRODUCTION MODE — overwrites all 2026 Park Factors rows.\nType \"yes-promote-to-prod\" to proceed: ");
    const line = await new Promise<string>((resolve) => {
      let buf = "";
      process.stdin.on("data", (d) => {
        buf += d.toString();
        if (buf.includes("\n")) resolve(buf.split("\n")[0]);
      });
    });
    if (line.trim() !== "yes-promote-to-prod") {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  console.log(`\nDeleting existing ${SEASON} rows...`);
  const { error: delErr } = await (sb as any).from("Park Factors").delete().eq("season", SEASON);
  if (delErr) {
    console.error("Delete failed:", delErr);
    process.exit(1);
  }

  console.log(`Inserting ${rows.length} new rows...`);
  const PAGE = 200;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += PAGE) {
    const chunk = rows.slice(i, i + PAGE);
    const { error: insErr } = await (sb as any).from("Park Factors").insert(chunk);
    if (insErr) {
      console.error("Insert failed at chunk", i, ":", insErr);
      process.exit(1);
    }
    inserted += chunk.length;
  }
  console.log(`✓ Inserted ${inserted} rows for season ${SEASON}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
