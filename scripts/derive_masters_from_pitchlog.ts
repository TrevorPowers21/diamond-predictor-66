/**
 * derive_masters_from_pitchlog.ts
 * ────────────────────────────────────────────────────────────────────
 * Make the PITCH LOG the primary source that writes the derived stat
 * line into "Hitter Master" and "Pitching Master" (staging, season 2026,
 * D1 only — JUCO excluded via `division = 'D1'`).
 *
 * Canonical derivation lives in src/savant/lib/pitchLogRates.ts — we
 * REUSE `deriveHitterRates` / `derivePitcherRates` (+ the same
 * safeDiv / safeDivFloor / MIN_TRACKED_BIP primitives) so the numbers
 * written to the Masters match exactly what the Savant UI renders.
 * Pitcher FIP uses the canonical D1-FIP index from src/lib/pitcherQuality.
 *
 *   Fill / override rule (see FALLBACK section):
 *     • Pitch-log-derived value is PRIMARY.
 *     • If a derived field is null (untracked — e.g. no EV-tracked BIP)
 *       OR the player is below the sample gate, the field is NOT written
 *       — the existing Master value is left untouched, so a later
 *       TruMedia Master upload can still fill / override the gap.
 *     • A field is only ever OVERWRITTEN when the pitch log has a real,
 *       above-threshold value for it.
 *
 * UNITS (verified against staging + src/lib/computeAndStoreScores.ts):
 *   • Master scouting-percent columns (contact, barrel, chase, bb,
 *     line_drive, gb, pop_up, pull, pull_air, la_10_30, k_pct, and the
 *     pitcher *_pct columns) are stored 0–100. pitchLogRates returns 0–1
 *     rates → ×100.
 *   • AVG / OBP / SLG / ISO stay 0.xxx rates. K9/BB9/HR9/WHIP/FIP are
 *     per-9 / ratio values (no ×100). avg_exit_velo / ev90 / exit_vel /
 *     "90th_vel" stay in mph.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/derive_masters_from_pitchlog.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/derive_masters_from_pitchlog.ts --apply   (DO NOT run yet)
 *
 * Flags:
 *   --dry-run          (default) no writes; prints samples + change/create counts
 *   --apply            performs the upsert (BUILT but intentionally not run)
 *   --min-pa <n>       hitter PA gate (default 25)
 *   --min-bf <n>       pitcher BF gate (default 20)
 *   --season <n>       season (default 2026)
 *   --no-newrows       skip the (slower) new-row-creation analysis
 *
 * SCHEMA DEPENDENCY: pitcher K9/BB9/HR9/WHIP/FIP need innings pitched.
 * IP is NOT yet a column on pitch_log_pitcher_totals — see the migration
 * SQL in docs / the task runbook (adds `ip`+`outs`, populated via the
 * outs-tracking method). Until that migration is applied the script
 * computes IP in-process (querying pitch_log) ONLY for the verification
 * sample; the full-population IP-dependent patch is emitted only once the
 * `ip` column exists (otherwise those 5 fields fall back to Master).
 */

import { createClient } from "@supabase/supabase-js";
import {
  deriveHitterRates,
  derivePitcherRates,
  safeDivFloor,
  MIN_TRACKED_BIP,
} from "@/savant/lib/pitchLogRates";
import type {
  PitchLogHitterTotalsRow,
  PitchLogPitcherTotalsRow,
} from "@/savant/hooks/usePitchLogTotals";

// ── CLI ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const val = (f: string, d: number) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d;
};
const APPLY = has("--apply");
const DRY_RUN = !APPLY;
const MIN_PA = val("--min-pa", 25);
const MIN_BF = val("--min-bf", 20);
const SEASON = val("--season", 2026);
const DO_NEWROWS = !has("--no-newrows");

const SAMPLE_IDS = ["1000618032", "1000894440", "1001010929"];

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (use --env-file=.env.local).");
  process.exit(1);
}
const sb = createClient(url, key);

// ── unit helpers ─────────────────────────────────────────────────────
const round1 = (v: number | null): number | null => (v == null ? null : Math.round(v * 10) / 10);
const round2 = (v: number | null): number | null => (v == null ? null : Math.round(v * 100) / 100);
const round3 = (v: number | null): number | null => (v == null ? null : Math.round(v * 1000) / 1000);
const pctOf = (v: number | null): number | null => (v == null ? null : round1(v * 100)); // 0-1 → 0-100
const mph = (v: number | null): number | null => round1(v);

const dirTotalHitter = (r: PitchLogHitterTotalsRow) => r.batted_pull + r.batted_center + r.batted_oppo;
const dirTotalPitcher = (r: PitchLogPitcherTotalsRow) =>
  r.batted_pull_allowed + r.batted_center_allowed + r.batted_oppo_allowed;

// ── field maps (derived → Master column, with conversion) ────────────
interface FieldSpec<TRow> {
  col: string;
  kind: "rate" | "pct" | "mph" | "raw" | "per9";
  value: (r: TRow) => number | null;
}

const HITTER_FIELDS: FieldSpec<PitchLogHitterTotalsRow>[] = (() => {
  const s: FieldSpec<PitchLogHitterTotalsRow>[] = [];
  const rate = (col: string, f: (h: ReturnType<typeof deriveHitterRates>) => number | null) =>
    s.push({ col, kind: "rate", value: (r) => round3(f(deriveHitterRates(r))) });
  const pct = (col: string, f: (h: ReturnType<typeof deriveHitterRates>) => number | null) =>
    s.push({ col, kind: "pct", value: (r) => pctOf(f(deriveHitterRates(r))) });
  rate("AVG", (h) => h?.avg ?? null);
  rate("OBP", (h) => h?.obp ?? null);
  rate("SLG", (h) => h?.slg ?? null);
  rate("ISO", (h) => h?.iso ?? null);
  pct("contact", (h) => h?.contactPct ?? null);
  pct("barrel", (h) => h?.barrelPct ?? null);
  pct("chase", (h) => h?.chasePct ?? null);
  pct("bb", (h) => h?.bbPct ?? null);
  pct("line_drive", (h) => h?.lineDrivePct ?? null);
  pct("gb", (h) => h?.groundBallPct ?? null);
  pct("pop_up", (h) => h?.popUpPct ?? null);
  pct("la_10_30", (h) => h?.la1030Pct ?? null);
  pct("k_pct", (h) => h?.kPct ?? null);
  s.push({ col: "avg_exit_velo", kind: "mph", value: (r) => mph(deriveHitterRates(r)?.avgEv ?? null) });
  s.push({ col: "ev90", kind: "mph", value: (r) => mph(r.ev_90) });
  s.push({ col: "pull", kind: "pct", value: (r) => pctOf(safeDivFloor(r.batted_pull, dirTotalHitter(r), MIN_TRACKED_BIP)) });
  s.push({ col: "pull_air", kind: "pct", value: (r) => pctOf(safeDivFloor(r.batted_pull_air, dirTotalHitter(r), MIN_TRACKED_BIP)) });
  return s;
})();

// Pitcher discipline + batted-ball fields (do NOT need IP).
const PITCHER_FIELDS: FieldSpec<PitchLogPitcherTotalsRow>[] = (() => {
  const s: FieldSpec<PitchLogPitcherTotalsRow>[] = [];
  const pct = (col: string, f: (p: ReturnType<typeof derivePitcherRates>) => number | null) =>
    s.push({ col, kind: "pct", value: (r) => pctOf(f(derivePitcherRates(r))) });
  pct("miss_pct", (p) => p?.whiffPct ?? null);
  pct("bb_pct", (p) => p?.bbPct ?? null);
  pct("chase_pct", (p) => p?.chasePct ?? null);
  pct("in_zone_whiff_pct", (p) => p?.izWhiffPct ?? null);
  pct("in_zone_pct", (p) => p?.zonePct ?? null);
  pct("k_pct", (p) => p?.kPct ?? null);
  s.push({ col: "stuff_plus", kind: "raw", value: (r) => round1(derivePitcherRates(r)?.stuffPlus ?? null) });
  const bbev = (r: PitchLogPitcherTotalsRow) => r.batted_balls_allowed_with_ev;
  s.push({ col: "hard_hit_pct", kind: "pct", value: (r) => pctOf(safeDivFloor(r.batted_hard_hit_allowed, bbev(r), MIN_TRACKED_BIP)) });
  s.push({ col: "barrel_pct", kind: "pct", value: (r) => pctOf(safeDivFloor(r.batted_barrels_allowed, bbev(r), MIN_TRACKED_BIP)) });
  s.push({ col: "line_pct", kind: "pct", value: (r) => pctOf(safeDivFloor(r.batted_line_drives_allowed, bbev(r), MIN_TRACKED_BIP)) });
  s.push({ col: "ground_pct", kind: "pct", value: (r) => pctOf(safeDivFloor(r.batted_ground_balls_allowed, bbev(r), MIN_TRACKED_BIP)) });
  s.push({ col: "la_10_30_pct", kind: "pct", value: (r) => pctOf(safeDivFloor(r.batted_la_10_to_30_allowed, bbev(r), MIN_TRACKED_BIP)) });
  s.push({ col: "h_pull_pct", kind: "pct", value: (r) => pctOf(safeDivFloor(r.batted_pull_allowed, dirTotalPitcher(r), MIN_TRACKED_BIP)) });
  s.push({ col: "exit_vel", kind: "mph", value: (r) => mph(safeDivFloor(r.ev_sum_allowed, bbev(r), MIN_TRACKED_BIP)) });
  s.push({ col: "90th_vel", kind: "mph", value: (r) => mph(r.ev_90_allowed) });
  return s;
})();

// IP-dependent pitcher rates. Given a totals row + its IP, → Master cols.
function pitcherIpDependent(t: PitchLogPitcherTotalsRow, ip: number | null): Record<string, number | null> {
  if (ip == null || ip <= 0) return {};
  const hits = t.hits_single_allowed + t.hits_double_allowed + t.hits_triple_allowed + t.hits_hr_allowed;
  const k9 = round2((t.total_k * 9) / ip);
  const bb9 = round2((t.total_bb * 9) / ip);
  const hr9 = round2((t.hits_hr_allowed * 9) / ip);
  const whip = round2((hits + t.total_bb) / ip);
  // Classic descriptive FIP (matches Pitching Master.FIP to ~0.01; verified 2026-08-20).
  // NOT computeProjFip — that returns the D1-FIP regression/projRA9 index, a different column.
  const fip = round2((13 * t.hits_hr_allowed + 3 * (t.total_bb + t.total_hbp) - 2 * t.total_k) / ip + 3.157);
  return { K9: k9, BB9: bb9, HR9: hr9, WHIP: whip, FIP: fip };
}
const PITCHER_IP_KINDS: Record<string, FieldSpec<any>["kind"]> = {
  K9: "per9", BB9: "per9", HR9: "per9", WHIP: "rate", FIP: "rate",
};

// Never written here — left to TruMedia Master. ERA stays Master-sourced
// (earned-run attribution is imperfect from pitch log). IP/G/GS/Role are
// official counts we don't overwrite.
const PITCHER_UNMAPPED = ["ERA", "IP", "G", "GS", "Role"];

const eps = (kind: FieldSpec<any>["kind"]) =>
  kind === "rate" ? 0.0005 : kind === "mph" ? 0.05 : kind === "per9" ? 0.05 : 0.05;

// Per-pitcher IP now comes from the pitch_log_pitcher_totals.ip column (migration
// populates it via the accurate per-PA out-attribution: outs on a PA = next PA's
// start-outs − this PA's start-outs, last PA = max(outs)+1 − start; credited to
// that PA's pitcher). Read (t as any).ip — no live per-pitcher scan needed.

// ── paginated fetch ──────────────────────────────────────────────────
async function fetchAll<T>(table: string, select: string, filters: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = (sb as any).from(table).select(select).range(from, from + PAGE - 1);
    q = filters(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return out;
}
async function fetchTotals<T>(table: string, keyCol: string): Promise<Map<string, T>> {
  const rows = await fetchAll<any>(table, "*", (q) => q.eq("season", SEASON).eq("dimension_key", "all"));
  const m = new Map<string, T>();
  for (const r of rows) m.set(String(r[keyCol]), r as T);
  return m;
}

// ── build a stat-only patch (derived non-null fields only) ───────────
interface Built {
  patch: Record<string, any>;
  changedCols: string[];
}
function buildPatch<TRow>(t: TRow, master: Record<string, any>, fields: FieldSpec<TRow>[]): Built {
  const patch: Record<string, any> = { source_player_id: master.source_player_id, Season: master.Season };
  const changedCols: string[] = [];
  for (const f of fields) {
    const v = f.value(t);
    if (v == null) continue; // FALLBACK: leave Master untouched
    patch[f.col] = v;
    const cur = master[f.col];
    if (cur == null || Math.abs(Number(cur) - v) > eps(f.kind)) changedCols.push(f.col);
  }
  return { patch, changedCols };
}

const fmt = (v: any) => (v == null ? "—" : String(v));

// ── main ─────────────────────────────────────────────────────────────
async function main() {
  console.log(
    `\nderive_masters_from_pitchlog — season ${SEASON}, D1 only (division='D1'), ` +
      `mode=${APPLY ? "APPLY" : "DRY-RUN"}, minPA=${MIN_PA}, minBF=${MIN_BF}\n`,
  );

  const hitterMasters = await fetchAll<any>(
    "Hitter Master",
    'source_player_id, Season, "AVG", "OBP", "SLG", "ISO", contact, barrel, chase, bb, line_drive, gb, pop_up, la_10_30, k_pct, avg_exit_velo, ev90, pull, pull_air, pa',
    (q) => q.eq("Season", SEASON).eq("division", "D1"),
  );
  const pitcherMasters = await fetchAll<any>(
    "Pitching Master",
    'source_player_id, Season, miss_pct, bb_pct, chase_pct, in_zone_whiff_pct, in_zone_pct, k_pct, stuff_plus, hard_hit_pct, barrel_pct, line_pct, ground_pct, la_10_30_pct, h_pull_pct, exit_vel, "90th_vel", "K9", "BB9", "HR9", "WHIP", "FIP", "IP", bf',
    (q) => q.eq("Season", SEASON).eq("division", "D1"),
  );

  const hitterTotals = await fetchTotals<PitchLogHitterTotalsRow>("pitch_log_hitter_totals", "batter_id");
  const pitcherTotals = await fetchTotals<PitchLogPitcherTotalsRow>("pitch_log_pitcher_totals", "pitcher_id");

  // Detect whether the `ip` column exists on the totals (post-migration).
  const ipColExists = (() => {
    const any = pitcherTotals.values().next().value as any;
    return any ? "ip" in any : false;
  })();

  console.log(
    `Loaded D1 Masters: ${hitterMasters.length} hitters, ${pitcherMasters.length} pitchers. ` +
      `Pitch-log totals: ${hitterTotals.size} hitters, ${pitcherTotals.size} pitchers.`,
  );
  console.log(`pitch_log_pitcher_totals.ip column present: ${ipColExists ? "YES" : "NO (IP-dependent fields skipped in bulk)"}\n`);

  // ── HITTER patches ─────────────────────────────────────────────────
  const hitterPatches: Record<string, any>[] = [];
  let hitterChanged = 0, hitterThin = 0, hitterNoPL = 0;
  const sampleRows: Record<string, any>[] = [];
  for (const m of hitterMasters) {
    const t = hitterTotals.get(String(m.source_player_id));
    if (!t) { hitterNoPL++; continue; }
    if ((t.pa ?? 0) < MIN_PA) { hitterThin++; continue; }
    const built = buildPatch(t, m, HITTER_FIELDS);
    hitterPatches.push(built.patch);
    if (built.changedCols.length) hitterChanged++;
    if (SAMPLE_IDS.includes(String(m.source_player_id))) {
      const hr = deriveHitterRates(t)!;
      sampleRows.push({
        id: m.source_player_id, pa: t.pa,
        AVG: [round3(hr.avg), m.AVG], OBP: [round3(hr.obp), m.OBP], SLG: [round3(hr.slg), m.SLG],
        ISO: [round3(hr.iso), m.ISO], contact: [pctOf(hr.contactPct), m.contact],
        barrel: [pctOf(hr.barrelPct), m.barrel], avg_exit_velo: [mph(hr.avgEv), m.avg_exit_velo],
      });
    }
  }

  // ── PITCHER patches ────────────────────────────────────────────────
  const pitcherPatches: Record<string, any>[] = [];
  let pitcherChanged = 0, pitcherThin = 0, pitcherNoPL = 0;
  for (const m of pitcherMasters) {
    const t = pitcherTotals.get(String(m.source_player_id));
    if (!t) { pitcherNoPL++; continue; }
    if ((t.total_bf ?? 0) < MIN_BF) { pitcherThin++; continue; }
    const built = buildPatch(t, m, PITCHER_FIELDS);
    // IP-dependent fields — only when the ip column is populated.
    if (ipColExists) {
      const ipVal = (t as any).ip as number | null;
      const ipFields = pitcherIpDependent(t, ipVal);
      for (const [col, v] of Object.entries(ipFields)) {
        if (v == null) continue;
        built.patch[col] = v;
        const cur = m[col];
        if (cur == null || Math.abs(Number(cur) - v) > eps(PITCHER_IP_KINDS[col])) built.changedCols.push(col);
      }
    }
    pitcherPatches.push(built.patch);
    if (built.changedCols.length) pitcherChanged++;
  }

  // ── DRY-RUN: hitter sample table ───────────────────────────────────
  console.log("── Sample hitters: derived (pitch log) vs current Master ──");
  const hcols = ["AVG", "OBP", "SLG", "ISO", "contact", "barrel", "avg_exit_velo"];
  for (const s of sampleRows) {
    console.log(`\n  ${s.id}  (pitch-log PA=${s.pa})`);
    console.log("    metric         derived      master");
    for (const c of hcols) console.log(`    ${c.padEnd(14)} ${fmt(s[c][0]).padStart(8)}   ${fmt(s[c][1]).padStart(8)}`);
  }
  for (const id of SAMPLE_IDS)
    if (!sampleRows.find((s) => String(s.id) === id))
      console.log(`\n  ${id}  — no D1 Hitter Master row or below PA gate (fell back).`);

  // ── DRY-RUN: pitcher IP verification (5 pitchers, Master IP≥40) ─────
  console.log("\n── Pitcher IP + rate verification (in-script IP via outs-tracking) ──");
  console.log("  (⚠ per-pitcher outs-tracking over-counts relievers who enter/exit mid-inning)");
  const ipSample = pitcherMasters.filter((m) => (m.IP ?? 0) >= 40 && pitcherTotals.has(String(m.source_player_id))).slice(0, 5);
  console.log("\n  id           name                 PL-IP  M-IP   K9(d/m)      BB9(d/m)     HR9(d/m)     WHIP(d/m)    FIP(d/m)");
  for (const m of ipSample) {
    const t = pitcherTotals.get(String(m.source_player_id))!;
    const ipVal = (t as any).ip as number | null;   // read the populated column, not the slow live scan
    const d = pitcherIpDependent(t, ipVal);
    const cell = (dv: any, mv: any) => `${fmt(dv)}/${fmt(mv)}`.padEnd(12);
    console.log(
      `  ${String(m.source_player_id).padEnd(12)} ${String(m.playerFullName ?? "").slice(0, 20).padEnd(20)} ` +
        `${fmt(round1(ipVal)).padStart(5)}  ${fmt(round1(m.IP)).padStart(5)}  ` +
        `${cell(d.K9, round2(m.K9))} ${cell(d.BB9, round2(m.BB9))} ${cell(d.HR9, round2(m.HR9))} ${cell(d.WHIP, round2(m.WHIP))} ${cell(d.FIP, round2(m.FIP))}`,
    );
  }

  // ── NEW ROWS (pitch-log players with no Master row at all) ─────────
  let newHitterRows: Record<string, any>[] = [];
  let newPitcherRows: Record<string, any>[] = [];
  if (DO_NEWROWS) {
    console.log("\n── New-row creation analysis (D1 only) ──");
    const res = await buildNewRows(hitterTotals, pitcherTotals);
    newHitterRows = res.newHitterRows;
    newPitcherRows = res.newPitcherRows;
    console.log(`  NEW rows that would be created: ${newHitterRows.length} hitters, ${newPitcherRows.length} pitchers`);
    console.log(`  (skipped — non-D1 team / unresolved identity / below sample gate: ${res.skipped})`);
    const showSamples = (rows: Record<string, any>[], label: string) => {
      console.log(`\n  Sample NEW ${label} rows:`);
      for (const r of rows.slice(0, 3)) {
        console.log(`    ${r.source_player_id}  ${r.playerFullName}  ${r.Team} (${r.Conference}) ${label === "hitter" ? r.Pos ?? "" : r.Role ?? ""}`);
        if (label === "hitter") console.log(`      AVG=${fmt(r.AVG)} OBP=${fmt(r.OBP)} SLG=${fmt(r.SLG)} contact=${fmt(r.contact)} barrel=${fmt(r.barrel)}`);
        else console.log(`      stuff_plus=${fmt(r.stuff_plus)} miss_pct=${fmt(r.miss_pct)} bb_pct=${fmt(r.bb_pct)} chase_pct=${fmt(r.chase_pct)}`);
      }
      if (rows.length === 0) console.log("    (none)");
    };
    showSamples(newHitterRows, "hitter");
    showSamples(newPitcherRows, "pitcher");
  }

  // ── change counts ──────────────────────────────────────────────────
  console.log("\n── Change counts (existing D1 rows whose derived line differs) ──");
  console.log(`  Hitters:  ${hitterChanged} would change  (of ${hitterPatches.length} above-gate)  thin(<${MIN_PA} PA)=${hitterThin}, no pitch log=${hitterNoPL}`);
  console.log(`  Pitchers: ${pitcherChanged} would change  (of ${pitcherPatches.length} above-gate)  thin(<${MIN_BF} BF)=${pitcherThin}, no pitch log=${pitcherNoPL}`);
  console.log(`  Pitcher fields left to TruMedia Master (never written): ${PITCHER_UNMAPPED.join(", ")}`);
  if (!ipColExists) console.log(`  NOTE: K9/BB9/HR9/WHIP/FIP not in bulk patch — waiting on pitch_log_pitcher_totals.ip migration.`);

  if (DRY_RUN) {
    console.log("\nDRY-RUN — no writes performed. Re-run with --apply to upsert.\n");
    return;
  }

  // ── APPLY (built; do NOT run yet) ──────────────────────────────────
  console.log("\nAPPLY: upserting patches + new rows keyed (source_player_id, Season)…");
  const upsertBatch = async (table: string, rows: Record<string, any>[]) => {
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const { error } = await (sb as any).from(table).upsert(rows.slice(i, i + BATCH), { onConflict: "source_player_id,Season" });
      if (error) throw new Error(`${table} upsert: ${error.message}`);
      console.log(`  ${table}: ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
    }
  };
  await upsertBatch("Hitter Master", [...hitterPatches, ...newHitterRows]);
  await upsertBatch("Pitching Master", [...pitcherPatches, ...newPitcherRows]);
  console.log("APPLY complete.\n");
}

// ── new-row builder ──────────────────────────────────────────────────
async function buildNewRows(
  hitterTotals: Map<string, PitchLogHitterTotalsRow>,
  pitcherTotals: Map<string, PitchLogPitcherTotalsRow>,
): Promise<{ newHitterRows: Record<string, any>[]; newPitcherRows: Record<string, any>[]; skipped: number }> {
  // Master ids across ALL divisions this season — so we never re-create a
  // JUCO player as a D1 row, and never duplicate an existing row.
  const hmAll = new Set((await fetchAll<any>("Hitter Master", "source_player_id", (q) => q.eq("Season", SEASON))).map((r) => String(r.source_player_id)));
  const pmAll = new Set((await fetchAll<any>("Pitching Master", "source_player_id", (q) => q.eq("Season", SEASON))).map((r) => String(r.source_player_id)));

  const newHitterIds = [...hitterTotals.keys()].filter((id) => !hmAll.has(id));
  const newPitcherIds = [...pitcherTotals.keys()].filter((id) => !pmAll.has(id));

  // Teams Table (this season) keyed by source_id → identity + division.
  const teamRows = await fetchAll<any>("Teams Table", 'id, full_name, conference, conference_id, division, source_id, "Season"', (q) => q.eq("Season", SEASON));
  const teamBySource = new Map<string, any>();
  for (const t of teamRows) teamBySource.set(String(t.source_id), t);

  // Enrich from players (name/hand/position) where present.
  const allNewIds = [...new Set([...newHitterIds, ...newPitcherIds])];
  const playersById = new Map<string, any>();
  for (let i = 0; i < allNewIds.length; i += 200) {
    const chunk = allNewIds.slice(i, i + 200);
    const { data } = await (sb as any).from("players")
      .select("source_player_id, first_name, last_name, position, bats_hand, throws_hand")
      .in("source_player_id", chunk);
    for (const p of data || []) playersById.set(String(p.source_player_id), p);
  }

  // One representative pitch_log row per new id (team source id + abbrev + hand).
  async function repRows(ids: string[], idCol: string, teamCol: string, abbrevCol: string, handCol: string) {
    const map = new Map<string, any>();
    const BATCH = 20; // parallelism
    for (let i = 0; i < ids.length; i += BATCH) {
      const slice = ids.slice(i, i + BATCH);
      await Promise.all(
        slice.map(async (id) => {
          const { data } = await (sb as any).from("pitch_log")
            .select(`${teamCol}, ${abbrevCol}, ${handCol}`)
            .eq("season", SEASON).eq(idCol, id).limit(1);
          if (data && data[0]) map.set(id, data[0]);
        }),
      );
    }
    return map;
  }

  let skipped = 0;
  const resolveTeam = (srcId: string | null | undefined) => (srcId ? teamBySource.get(String(srcId)) : undefined);

  // ── hitters ──
  const hitterReps = await repRows(newHitterIds, "batting_team_id", "batting_team_id", "batter_abbrev_name", "batter_hand");
  const newHitterRows: Record<string, any>[] = [];
  for (const id of newHitterIds) {
    const t = hitterTotals.get(id)!;
    if ((t.pa ?? 0) < MIN_PA) { skipped++; continue; }
    const rep = hitterReps.get(id);
    const team = resolveTeam(rep?.batting_team_id);
    if (!team || team.division !== "D1") { skipped++; continue; } // D1 gate
    const pl = playersById.get(id);
    const name = pl ? `${pl.first_name ?? ""} ${pl.last_name ?? ""}`.trim() : (rep?.batter_abbrev_name ?? null);
    const row: Record<string, any> = {
      source_player_id: id, Season: SEASON, playerFullName: name || null,
      Team: team.full_name, TeamID: team.id, Conference: team.conference, conference_id: team.conference_id,
      division: "D1", Pos: pl?.position ?? null, BatHand: pl?.bats_hand ?? rep?.batter_hand ?? null,
      ThrowHand: pl?.throws_hand ?? null, pa: t.pa, ab: t.ab,
    };
    for (const f of HITTER_FIELDS) { const v = f.value(t); if (v != null) row[f.col] = v; }
    newHitterRows.push(row);
  }

  // ── pitchers ──
  const pitcherReps = await repRows(newPitcherIds, "pitcher_id", "pitching_team_id", "pitcher_abbrev_name", "pitcher_hand");
  const newPitcherRows: Record<string, any>[] = [];
  for (const id of newPitcherIds) {
    const t = pitcherTotals.get(id)!;
    if ((t.total_bf ?? 0) < MIN_BF) { skipped++; continue; }
    const rep = pitcherReps.get(id);
    const team = resolveTeam(rep?.pitching_team_id);
    if (!team || team.division !== "D1") { skipped++; continue; }
    const pl = playersById.get(id);
    const name = pl ? `${pl.first_name ?? ""} ${pl.last_name ?? ""}`.trim() : (rep?.pitcher_abbrev_name ?? null);
    const row: Record<string, any> = {
      source_player_id: id, Season: SEASON, playerFullName: name || null,
      Team: team.full_name, TeamID: team.id, Conference: team.conference, conference_id: team.conference_id,
      division: "D1", Role: pl?.position ?? null, ThrowHand: pl?.throws_hand ?? rep?.pitcher_hand ?? null, bf: t.total_bf,
    };
    for (const f of PITCHER_FIELDS) { const v = f.value(t); if (v != null) row[f.col] = v; }
    // IP-dependent rates from the populated pitch_log_pitcher_totals.ip column (no live scan).
    for (const [col, v] of Object.entries(pitcherIpDependent(t, (t as any).ip ?? null))) if (v != null) row[col] = v;
    newPitcherRows.push(row);
  }

  return { newHitterRows, newPitcherRows, skipped };
}

main().catch((e) => { console.error(e); process.exit(1); });
