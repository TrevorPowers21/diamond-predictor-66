/**
 * Park-factor seasonal backfill + rolling rebuild (staging).
 *
 * Reads the archived single-season TruMedia park CSVs (2024/2025/2026) from
 *   /Users/danielleogonowski/RSTR IQ Data/park-factors/<year>/
 * and writes, per team per season, into "Park Factors":
 *   - *_seasonal columns  = that season's SINGLE-SEASON factor (the stored input)
 *   - main factor columns = the STORED value readers consume:
 *       · historical years (2024/2025) → = their own single-season (degenerate)
 *       · current season (2026)        → = the 3-YR ROLLING (avg of 2024/25/26)
 *
 * Method (per cohort per metric, per team):
 *   raw       = mean(hitter_file_value, pitcher_file_value)      # both sides cancel team quality
 *   leagueAvg = mean of that raw across all teams in the SAME year+cohort+metric
 *   factor    = raw / leagueAvg * 100                            # self-normalized to that year's league
 * Sparse handed-cohort fallback: if a team's LHB/RHB cohort is missing/near-empty
 *   (raw null, or R/G ~0), that handed factor falls back to the COMBINED factor.
 *
 * Rolling (2026, regular season complete → g=1, equal weight):
 *   rolling = mean(seasonal_2024, seasonal_2025, seasonal_2026)  # per metric
 *   (the games-weighted handoff applies only to a LIVE in-progress season; g=1 here.)
 *
 * whip_factor = obp-based, hr9_factor = iso-based (mirrors import-park-factors-2026.ts).
 *
 * Usage:
 *   npx tsx scripts/backfill_park_factors_seasonal.ts           # DRY RUN (prints, no writes)
 *   npx tsx scripts/backfill_park_factors_seasonal.ts --apply   # writes staging
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const ROOT = "/Users/danielleogonowski/RSTR IQ Data/park-factors";
const SEASONS = [2024, 2025, 2026] as const;
const CURRENT = 2026;

const url = "https://slrxowawbijbjrkozqlj.supabase.co";
const key = readFileSync(".env.local", "utf-8")
  .split("\n").find(l => l.startsWith("SUPABASE_SERVICE_ROLE_KEY="))?.split("=", 2)[1] ?? "";
const sb = createClient(url, key);

type Cohort = "combined" | "lhb" | "rhb";
type Side = "hit" | "pit";
type Metric = "avg" | "obp" | "iso" | "rg";
const METRICS: Metric[] = ["avg", "obp", "iso", "rg"];

const normTeam = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

/** Classify a filename in a year dir → {cohort, side}. Robust to TruMedia's
 *  inconsistent naming ("Factor" vs "Factors", "Pitching" vs "Pitcher"). */
function classify(fname: string): { cohort: Cohort; side: Side } | null {
  const f = fname.toLowerCase();
  if (!f.endsWith(".csv") || !f.includes("park factor")) return null;
  const side: Side = f.includes("pitch") ? "pit" : f.includes("hitter") ? "hit" : (null as any);
  if (side == null) return null;
  const cohort: Cohort = f.includes("left") ? "lhb" : f.includes("right") ? "rhb" : f.includes("combined") ? "combined" : (null as any);
  if (cohort == null) return null;
  return { cohort, side };
}

type TeamRow = { team: string; key: string; avg?: number; obp?: number; iso?: number; rg?: number };

/** Quote-aware CSV line split (RFC4180-ish): commas inside "..." are literal.
 *  Required — some rows have a quoted teamFullName with an embedded comma
 *  (e.g. "University of Hawaii, Manoa"), which naive split(",") column-shifts. */
function splitCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsv(file: string): TeamRow[] {
  const lines = readFileSync(file, "utf-8").split("\n").filter(Boolean);
  const headers = splitCsvLine(lines[0]).map(h => h.trim());
  const ix = (h: string) => headers.indexOf(h);
  const num = (s: string | undefined) => { const n = parseFloat(String(s)); return Number.isFinite(n) ? n : undefined; };
  const out: TeamRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = splitCsvLine(lines[i]);
    const team = (c[ix("team")] || "").trim();
    if (!team) continue;
    out.push({ team, key: normTeam(team), avg: num(c[ix("AVG")]), obp: num(c[ix("OBP")]), iso: num(c[ix("ISO")]), rg: num(c[ix("R/G")]) });
  }
  return out;
}

const meanPair = (a?: number, b?: number) =>
  a == null && b == null ? null : a == null ? b! : b == null ? a : (a + b) / 2;

// per-year, per-cohort: teamKey → {metric → raw (hitter+pitcher)/2}
type RawMap = Map<string, Partial<Record<Metric, number>>>;

function loadYear(year: number): { raw: Record<Cohort, RawMap>; names: Map<string, string> } {
  const dir = `${ROOT}/${year}`;
  const files = readdirSync(dir);
  const bySide: Record<Cohort, Partial<Record<Side, TeamRow[]>>> = { combined: {}, lhb: {}, rhb: {} };
  for (const fn of files) {
    const cls = classify(fn);
    if (!cls) continue;
    bySide[cls.cohort][cls.side] = parseCsv(`${dir}/${fn}`);
  }
  const names = new Map<string, string>();
  const raw: Record<Cohort, RawMap> = { combined: new Map(), lhb: new Map(), rhb: new Map() };
  for (const cohort of ["combined", "lhb", "rhb"] as Cohort[]) {
    const hit = new Map((bySide[cohort].hit ?? []).map(r => [r.key, r]));
    const pit = new Map((bySide[cohort].pit ?? []).map(r => [r.key, r]));
    const keys = new Set<string>([...hit.keys(), ...pit.keys()]);
    for (const k of keys) {
      const h = hit.get(k); const p = pit.get(k);
      names.set(k, h?.team || p?.team || k);
      const m: Partial<Record<Metric, number>> = {};
      for (const metric of METRICS) {
        const v = meanPair(h?.[metric], p?.[metric]);
        if (v != null) m[metric] = v;
      }
      raw[cohort].set(k, m);
    }
  }
  return { raw, names };
}

// league mean per cohort+metric (across teams that have the value)
function leagueMeans(raw: RawMap): Partial<Record<Metric, number>> {
  const sum: Partial<Record<Metric, number>> = {}; const cnt: Partial<Record<Metric, number>> = {};
  for (const m of raw.values()) for (const metric of METRICS) {
    if (m[metric] != null) { sum[metric] = (sum[metric] ?? 0) + m[metric]!; cnt[metric] = (cnt[metric] ?? 0) + 1; }
  }
  const out: Partial<Record<Metric, number>> = {};
  for (const metric of METRICS) if (cnt[metric]) out[metric] = sum[metric]! / cnt[metric]!;
  return out;
}

const r2 = (x: number | null) => x == null ? null : Math.round(x * 100) / 100;

// Per-team seasonal FACTORS for one year. Handed cohorts fall back to combined
// when the handed raw is missing or R/G ~0 (near-empty sample).
type Factors = {
  avg: number | null; obp: number | null; iso: number | null; rg: number | null;
  lhb_avg: number | null; lhb_obp: number | null; lhb_iso: number | null;
  rhb_avg: number | null; rhb_obp: number | null; rhb_iso: number | null;
};

function seasonalFactors(year: number) {
  const { raw, names } = loadYear(year);
  const lm = { combined: leagueMeans(raw.combined), lhb: leagueMeans(raw.lhb), rhb: leagueMeans(raw.rhb) };
  const teamKeys = new Set<string>([...raw.combined.keys()]);
  const result = new Map<string, Factors>();
  let fallbackCells = 0;
  const factor = (cohort: Cohort, metric: Metric, key: string): number | null => {
    const rawv = raw[cohort].get(key)?.[metric];
    const mean = lm[cohort][metric];
    if (rawv == null || mean == null || mean === 0) return null;
    return r2((rawv / mean) * 100);
  };
  // a handed cohort is "usable" for a team if it has an R/G raw that isn't ~0
  const handedUsable = (cohort: Cohort, key: string) => {
    const rg = raw[cohort].get(key)?.rg;
    return rg != null && rg > 0.5; // R/G near 0 = essentially no handed sample
  };
  for (const key of teamKeys) {
    const comb = { avg: factor("combined", "avg", key), obp: factor("combined", "obp", key), iso: factor("combined", "iso", key), rg: factor("combined", "rg", key) };
    const handed = (cohort: "lhb" | "rhb", metric: Metric) => {
      if (!handedUsable(cohort, key)) { fallbackCells++; return comb[metric]; }
      const f = factor(cohort, metric, key);
      if (f == null) { fallbackCells++; return comb[metric]; }
      return f;
    };
    result.set(key, {
      avg: comb.avg, obp: comb.obp, iso: comb.iso, rg: comb.rg,
      lhb_avg: handed("lhb", "avg"), lhb_obp: handed("lhb", "obp"), lhb_iso: handed("lhb", "iso"),
      rhb_avg: handed("rhb", "avg"), rhb_obp: handed("rhb", "obp"), rhb_iso: handed("rhb", "iso"),
    });
  }
  return { result, names, leagueMeans: lm, fallbackCells, teamCount: teamKeys.size };
}

const avg3 = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? r2(v.reduce((a, b) => a + b, 0) / v.length) : null;
};

async function main() {
  console.log(`MODE: ${APPLY ? "APPLY (writes staging)" : "DRY RUN"}  target=STAGING\n`);

  const perYear = new Map<number, ReturnType<typeof seasonalFactors>>();
  for (const y of SEASONS) {
    const s = seasonalFactors(y);
    perYear.set(y, s);
    console.log(`${y}: ${s.teamCount} teams | league R/G mean=${r2(s.leagueMeans.combined.rg ?? 0)} AVG=${r2(s.leagueMeans.combined.avg ?? 0)} OBP=${r2(s.leagueMeans.combined.obp ?? 0)} ISO=${r2(s.leagueMeans.combined.iso ?? 0)} | handed-fallback cells=${s.fallbackCells}`);
  }

  // Team lookup from Teams Table (season 2026) for ids
  const { data: teams } = await (sb as any).from("Teams Table").select("id, abbreviation, full_name, source_id").eq("Season", 2026);
  const lookup = new Map<string, any>();
  for (const t of teams ?? []) { if (t.abbreviation) lookup.set(normTeam(t.abbreviation), t); if (t.full_name) lookup.set(normTeam(t.full_name), t); }

  // 2026 rolling = mean of the three seasonal factors, per metric, per team
  const cur = perYear.get(CURRENT)!;
  type Rolling = Factors;
  const rolling = new Map<string, Rolling>();
  for (const key of cur.result.keys()) {
    const f2024 = perYear.get(2024)!.result.get(key);
    const f2025 = perYear.get(2025)!.result.get(key);
    const f2026 = cur.result.get(key)!;
    const pick = (m: keyof Factors) => avg3([f2024?.[m] ?? null, f2025?.[m] ?? null, f2026[m]]);
    rolling.set(key, {
      avg: pick("avg"), obp: pick("obp"), iso: pick("iso"), rg: pick("rg"),
      lhb_avg: pick("lhb_avg"), lhb_obp: pick("lhb_obp"), lhb_iso: pick("lhb_iso"),
      rhb_avg: pick("rhb_avg"), rhb_obp: pick("rhb_obp"), rhb_iso: pick("rhb_iso"),
    });
  }

  // DIFF new 2026 rolling vs existing "Park Factors" 2026 rows (sanity check)
  const { data: existing } = await (sb as any).from("Park Factors").select("team_name, source_team_id, avg_factor, obp_factor, iso_factor, rg_factor").eq("season", 2026);
  const exByKey = new Map<string, any>();
  for (const e of existing ?? []) { const k = normTeam(e.team_name || ""); if (k) exByKey.set(k, e); }
  const diffs: Record<Metric, number[]> = { avg: [], obp: [], iso: [], rg: [] };
  const worst: { team: string; metric: Metric; neu: number; old: number; d: number }[] = [];
  for (const [key, roll] of rolling) {
    const ex = exByKey.get(key); if (!ex) continue;
    for (const metric of METRICS) {
      const neu = (roll as any)[metric]; const old = ex[`${metric}_factor`];
      if (neu == null || old == null) continue;
      const d = neu - old; diffs[metric].push(Math.abs(d));
      worst.push({ team: cur.names.get(key) || key, metric, neu, old, d });
    }
  }
  console.log(`\n2026 rolling vs existing "Park Factors" 2026 (sanity — expect close; neutral-site parks the divergence points):`);
  for (const m of METRICS) {
    const arr = diffs[m]; if (!arr.length) continue;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    console.log(`  ${m.toUpperCase()}  mean|Δ|=${r2(mean)}  max|Δ|=${r2(Math.max(...arr))}  (n=${arr.length})`);
  }
  worst.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  console.log(`  worst 8: ${worst.slice(0, 8).map(w => `${w.team}/${w.metric} ${w.old}→${w.neu}`).join("  ·  ")}`);

  // sample teams
  console.log(`\nGeorgia rolling:`, JSON.stringify(rolling.get(normTeam("georgia"))));

  if (!APPLY) { console.log("\nDRY RUN — no writes. Re-run with --apply to write."); return; }

  // WRITE: delete + reinsert 2024/2025/2026 with _seasonal + main columns
  const rows: any[] = [];
  for (const y of SEASONS) {
    const sy = perYear.get(y)!;
    for (const [key, sf] of sy.result) {
      const tm = lookup.get(key);
      const isCur = y === CURRENT;
      const main = isCur ? rolling.get(key)! : sf; // current → rolling; historical → its own seasonal
      rows.push({
        team_name: sy.names.get(key) || key,
        team_id: tm?.id ?? null,
        source_team_id: tm?.source_id ?? null,
        season: y,
        // main factor columns (readers) — rolling for current, seasonal for historical
        avg_factor: main.avg, obp_factor: main.obp, iso_factor: main.iso, rg_factor: main.rg,
        whip_factor: main.obp, hr9_factor: main.iso, // derived (mirror importer)
        lhb_avg_factor: main.lhb_avg, lhb_obp_factor: main.lhb_obp, lhb_iso_factor: main.lhb_iso,
        rhb_avg_factor: main.rhb_avg, rhb_obp_factor: main.rhb_obp, rhb_iso_factor: main.rhb_iso,
        // seasonal input columns (always this year's single-season)
        avg_factor_seasonal: sf.avg, obp_factor_seasonal: sf.obp, iso_factor_seasonal: sf.iso, rg_factor_seasonal: sf.rg,
        lhb_avg_factor_seasonal: sf.lhb_avg, lhb_obp_factor_seasonal: sf.lhb_obp, lhb_iso_factor_seasonal: sf.lhb_iso,
        rhb_avg_factor_seasonal: sf.rhb_avg, rhb_obp_factor_seasonal: sf.rhb_obp, rhb_iso_factor_seasonal: sf.rhb_iso,
      });
    }
  }
  for (const y of SEASONS) {
    const { error } = await (sb as any).from("Park Factors").delete().eq("season", y);
    if (error) { console.error(`delete ${y} failed`, error); process.exit(1); }
  }
  const PAGE = 200; let ins = 0;
  for (let i = 0; i < rows.length; i += PAGE) {
    const { error } = await (sb as any).from("Park Factors").insert(rows.slice(i, i + PAGE));
    if (error) { console.error("insert failed at", i, error); process.exit(1); }
    ins += Math.min(PAGE, rows.length - i);
  }
  console.log(`\n✓ Wrote ${ins} rows across ${SEASONS.join("/")} (seasonal + main).`);
}

main().catch(e => { console.error(e); process.exit(1); });
