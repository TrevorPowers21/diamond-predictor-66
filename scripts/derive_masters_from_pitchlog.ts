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
import { readFileSync, existsSync } from "node:fs";
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
// 🛑 2026-08-30 — THIS LIST IS NOW WRONG FOR ERA AND IP, and the "never written" wording below is misleading.
// `scripts/drs/output/pitcher_line.csv` ALREADY carries pitch-log-derived `full_ERA`, `full_IP` (+ the complete
// matching `reg_*` set), and `pitch_log_pitcher_totals.ip` exists in the DB. So ERA and IP ARE derivable from the
// pitch log — they are simply not written yet. Only G/GS genuinely lack a pitch-log source.
// Per the architecture directive (Trevor): THIS script must write ALL stats from the pitch log, with the monthly
// TruMedia Master sheet acting only as a CHECK/OVERRIDE for the known-weak fields (stolen bases, ERA).
// See the "WAR MUST READ THE DB MASTERS" block in docs/PIPELINE_pitch_log_to_projections.md.
const PITCHER_UNMAPPED = ["G", "GS", "Role"];   // ★ 2026-08-30: ERA, IP (and bf) are now WRITTEN from the engine accrual

const eps = (kind: FieldSpec<any>["kind"]) =>
  kind === "rate" ? 0.0005 : kind === "mph" ? 0.05 : kind === "per9" ? 0.05 : 0.05;

// Per-pitcher IP now comes from the pitch_log_pitcher_totals.ip column (migration
// populates it via the accurate per-PA out-attribution: outs on a PA = next PA's
// start-outs − this PA's start-outs, last PA = max(outs)+1 − start; credited to
// that PA's pitcher). Read (t as any).ip — no live per-pitcher scan needed.

// ── paginated fetch ──────────────────────────────────────────────────
// ★ STAGE-0 FIX (2026-08-29): this paginated ~2.5M rows with an UNORDERED .range(), which silently drops and
// duplicates rows (PostgREST gives no stable order without ORDER BY) -> corrupt Master stat lines / WAR.
// orderCol defaults to "id"; callers on tables with a different PK must pass it explicitly.
async function fetchAll<T>(table: string, select: string, filters: (q: any) => any, orderCol = "id"): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = (sb as any).from(table).select(select).order(orderCol, { ascending: true }).range(from, from + PAGE - 1);
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
  // ★ STAGE-0: the totals tables have NO "id" column (keyed pitcher_id / batter_id), so the ordered
  // pagination must sort on keyCol — passing "id" here would hard-error. VERIFIED 2026-08-29.
  const rows = await fetchAll<any>(table, "*", (q) => q.eq("season", SEASON).eq("dimension_key", "all"), keyCol);
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

// ── ENGINE COUNTING-STAT SOURCE (2026-08-30) ─────────────────────────────────
// The Masters' COUNTING columns (pa/ab/IP/ERA/bf) and the REGULAR-SEASON anchors
// (regular_season_pa / regular_season_ip) come from the dRS engine's accrual output, which splits the
// pitch log at the season boundary (scripts/drs/drs_engine/season_config.py → 2026 regular_season_end 2026-05-18).
//   hitter_accrued.csv : PA AB … + reg_PA reg_AB …
//   pitcher_line.csv   : full_IP full_ERA full_BF … + reg_IP reg_ERA …
// ⚠ TEMPORARY FILE DEPENDENCY — TRACK B MUST REPLACE THIS. The long-term source is the accumulator:
//   • full-season pa/ab ARE already in pitch_log_hitter_totals (verified: median Δ 0.00 vs engine PA/AB)
//   • full BF is already in pitch_log_pitcher_totals.total_bf (median Δ 0.00)
//   • ⛔ pitch_log_pitcher_totals.ip is **0/5,509 on PROD** (staging 5,415) and has **NO COMMITTED PRODUCER** —
//     which is also why K9/BB9/HR9/WHIP/FIP are NOT pitch-log-derived on prod today (the ip-dependent
//     branch silently returns {} when ip is null). Track B must compute `ip` in the totals build.
//   • ⛔ there is no `reg` dimension_key yet, so the regular-season split can ONLY come from these files.
// 🛑 BOTH WINDOWS ARE WRITTEN IN THE SAME UPSERT. Depth-role tiering reads `regular_season_pa ?? pa`
//    (useTeamBuilderData.ts:239,:254) — a full-season `pa` with a NULL `regular_season_pa` silently feeds
//    postseason-inflated volume into tier classification and pushes playoff teams up a tier.
const NO_COUNTS = process.argv.includes("--no-counts");
function loadEngineCsv(path: string): Map<string, Record<string, string>> {
  const m = new Map<string, Record<string, string>>();
  // ★ do NOT blanket-catch here: a missing file is an expected state, but a parse/permission error must be LOUD.
  // (This loader originally swallowed a ReferenceError from a missing import and reported it as "file not found".)
  if (!existsSync(path)) { console.warn(`  ⚠ engine CSV absent: ${path}`); return m; }
  const text = readFileSync(path, "utf8");
  const lines = text.trim().split("\n");
  const H = lines[0].split(",").map((s) => s.trim());
  const idIdx = H.indexOf("source_player_id");
  if (idIdx < 0) return m;
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const id = (cells[idIdx] || "").trim();
    if (!id) continue;
    const row: Record<string, string> = {};
    H.forEach((h, i) => { row[h] = (cells[i] ?? "").trim(); });
    m.set(id, row);
  }
  return m;
}
const numOrNull = (v: string | undefined): number | null => {
  if (v == null || v === "" || v === "None") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

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

  // engine accrual (counting stats + the regular-season split) — see the ENGINE COUNTING-STAT SOURCE note
  const hitAcc = NO_COUNTS ? new Map() : loadEngineCsv("scripts/drs/output/hitter_accrued.csv");
  const pitLine = NO_COUNTS ? new Map() : loadEngineCsv("scripts/drs/output/pitcher_line.csv");
  const countsAvailable = hitAcc.size > 0 && pitLine.size > 0;
  console.log(
    NO_COUNTS
      ? "counting stats: SKIPPED (--no-counts)"
      : countsAvailable
        ? `counting stats: engine accrual loaded — ${hitAcc.size} hitters, ${pitLine.size} pitchers ` +
          `(writes pa/ab/regular_season_pa · IP/regular_season_ip/ERA/bf)`
        : "⚠ counting stats: engine CSVs NOT FOUND — pa/IP/ERA/bf/regular_season_* will NOT be written",
  );

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
    // ★ 2026-08-30 — PATCH GATE REMOVED (Trevor: "follow the slashline and fill it for everyone").
    // MIN_PA still gates NEW-ROW CREATION in buildNewRows() — that floor MUST stay, or --create-new would
    // manufacture a Master row for every 1-PA appearance (763 candidates on prod instead of 1).
    // Previously `if ((t.pa ?? 0) < MIN_PA) { hitterThin++; continue; }` skipped ~963 hitters entirely,
    // leaving their k_pct / pull_air permanently stale while the slash line (written elsewhere) was full.
    if ((t.pa ?? 0) < MIN_PA) hitterThin++;   // counted for reporting only — NO LONGER SKIPPED
    const built = buildPatch(t, m, HITTER_FIELDS);
    // counting stats + the regular-season anchor, from the engine accrual (BOTH windows, same upsert)
    const acc = hitAcc.get(String(m.source_player_id));
    if (acc) {
      const pa = numOrNull(acc.PA), ab = numOrNull(acc.AB), regPa = numOrNull(acc.reg_PA);
      if (pa != null) built.patch.pa = pa;
      if (ab != null) built.patch.ab = ab;
      if (regPa != null) built.patch.regular_season_pa = regPa;
      if (pa != null && pa !== Number(m.pa)) built.changedCols.push("pa");
    }
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
    // ★ 2026-08-30 — PATCH GATE REMOVED (see the hitter loop). MIN_BF still gates NEW-ROW creation.
    if ((t.total_bf ?? 0) < MIN_BF) pitcherThin++;   // counted for reporting only — NO LONGER SKIPPED
    const built = buildPatch(t, m, PITCHER_FIELDS);
    // counting stats + the regular-season anchor, from the engine accrual (BOTH windows, same upsert)
    const line = pitLine.get(String(m.source_player_id));
    let ipFromEngine: number | null = null;
    if (line) {
      const fullIp = numOrNull(line.full_IP), regIp = numOrNull(line.reg_IP);
      const era = numOrNull(line.full_ERA), bf = numOrNull(line.full_BF);
      if (fullIp != null) { built.patch.IP = fullIp; ipFromEngine = fullIp; }
      if (regIp != null) built.patch.regular_season_ip = regIp;
      if (era != null) built.patch.ERA = era;
      if (bf != null) built.patch.bf = bf;
      if (fullIp != null && Math.abs(fullIp - Number(m.IP)) > 0.01) built.changedCols.push("IP");
    }
    // IP-dependent fields (K9/BB9/HR9/WHIP/FIP). Prefer the totals `ip`; fall back to the engine's full_IP.
    // ⚠ On PROD `pitch_log_pitcher_totals.ip` is 0/5,509 (no committed producer), so WITHOUT this fallback
    //   these five columns silently stay at their stale CSV values — which is the state prod is in today.
    {
      const ipVal = (ipColExists ? ((t as any).ip as number | null) : null) ?? ipFromEngine;
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
    // Dedupe by the upsert conflict key (source_player_id, Season) and skip null
    // ids — a batch can't contain two rows with the same conflict key (Postgres:
    // "ON CONFLICT DO UPDATE command cannot affect row a second time"). Last wins.
    const seen = new Map<string, Record<string, any>>();
    for (const r of rows) {
      const sid = r.source_player_id;
      if (sid == null || sid === "") continue;
      seen.set(`${sid}|${r.Season}`, r);
    }
    const deduped = [...seen.values()];
    if (deduped.length !== rows.length) console.log(`  ${table}: deduped ${rows.length} → ${deduped.length} (${rows.length - deduped.length} dropped: dup key or null id)`);
    for (let i = 0; i < deduped.length; i += BATCH) {
      const { error } = await (sb as any).from(table).upsert(deduped.slice(i, i + BATCH), { onConflict: "source_player_id,Season" });
      if (error) throw new Error(`${table} upsert: ${error.message}`);
      console.log(`  ${table}: ${Math.min(i + BATCH, deduped.length)}/${deduped.length}`);
    }
  };
  // ★ SAFETY GATE (2026-08-30, Trevor): new-row creation is now OPT-IN and OFF by default.
  // It used to be spread into this same upsert, so --apply silently INSERTED invented Master rows.
  // Why that is dangerous: the Masters are the TruMedia season-stat source of truth and this script only
  // marries pitch-log derivations onto EXISTING rows — it never writes ERA/IP/G/GS/Role. A row created from
  // pitch_log alone is therefore a HALF-POPULATED player that downstream code treats as real with missing
  // stats. Worse, these are exactly the pitchers present in pitch_log but absent from the Master, i.e. the
  // identity-resolution gaps and non-TruMedia teams you least want silently materialized.
  const CREATE_NEW = process.argv.includes("--create-new");
  if (!CREATE_NEW && (newHitterRows.length || newPitcherRows.length)) {
    console.log(`\n  ⛔ SKIPPING new-row creation: ${newHitterRows.length} hitters + ${newPitcherRows.length} pitchers NOT inserted.`);
    console.log(`     Only EXISTING rows are being patched. Pass --create-new to also insert them (review the list first).`);
  }
  await upsertBatch("Hitter Master", CREATE_NEW ? [...hitterPatches, ...newHitterRows] : hitterPatches);
  await upsertBatch("Pitching Master", CREATE_NEW ? [...pitcherPatches, ...newPitcherRows] : pitcherPatches);
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
  let repErrors = 0;
  async function repRows(ids: string[], idCol: string, teamCol: string, abbrevCol: string, handCol: string) {
    const map = new Map<string, any>();
    const BATCH = 20; // parallelism
    for (let i = 0; i < ids.length; i += BATCH) {
      const slice = ids.slice(i, i + BATCH);
      await Promise.all(
        slice.map(async (id) => {
          const { data, error } = await (sb as any).from("pitch_log")
            .select(`${teamCol}, ${abbrevCol}, ${handCol}`)
            .eq("season", SEASON).eq(idCol, id).limit(1);
          // ★ 2026-08-30: the error was previously DISCARDED, so a statement timeout was indistinguishable from
          // "this player has no pitch-log row" and the player was silently skipped. Count and surface it.
          if (error) { repErrors++; if (repErrors <= 5) console.error(`  ✗ repRows ${idCol}=${id}: ${error.message}`); return; }
          if (data && data[0]) map.set(id, data[0]);
        }),
      );
    }
    return map;
  }

  let skipped = 0;
  const resolveTeam = (srcId: string | null | undefined) => (srcId ? teamBySource.get(String(srcId)) : undefined);

  // ── hitters ──
  // 🐛 FIX 2026-08-30: this passed "batting_team_id" as idCol (the pitcher call at the bottom correctly passes
  // "pitcher_id"), so it queried pitch_log WHERE batting_team_id = <a player id> — matched nothing, EXCEEDED the
  // statement timeout over 2.5M rows, and repRows discarded the error ⇒ every hitter silently skipped ⇒ NO hitter
  // Master row could EVER be created. Track B needs this working (2027 opens with mostly new players).
  const hitterReps = await repRows(newHitterIds, "batter_id", "batting_team_id", "batter_abbrev_name", "batter_hand");
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
