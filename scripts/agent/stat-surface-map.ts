/**
 * STAT → SURFACE MAP — rstr-agent-plan.md §10 step 5, and §4's #1 hard stop:
 *
 *   "Every user-facing number must read from the proper precompute line. The same stat showing two
 *    different values anywhere invalidates the whole app."
 *
 * This is the check that would have caught 2026-09-01 directly. Every automated check that night
 * verified the DATABASE; the bugs lived in the READ PATH — which stored field each surface reaches
 * for, and in what order.
 *
 * WHAT IT DOES
 *   Scans the source for reads of each user-facing stat and records WHICH SOURCE each surface reads
 *   it from. Then flags:
 *     ERROR  a stat read from `.prediction` — NOT a snapshot. It is `snapshot ?? predictionMap[...]`
 *            and degrades to a raw prediction row once the snapshot is missing. This is THE defect
 *            class from 09-01.
 *     WARN   a stat read from 2+ different sources in the same file — the two can disagree.
 *     INFO   the `??` fallback chains, so the precedence is visible and reviewable.
 *
 * WHAT IT IS NOT
 *   Static analysis of identifier text, not a type-aware AST pass. It finds candidate divergences
 *   for a human to judge; it cannot prove two reads resolve to the same value at runtime. A clean
 *   run means "no obvious divergence", never "the surfaces agree".
 *
 *   npx tsx scripts/agent/stat-surface-map.ts [--md]
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

/** The numbers a coach actually reads off a screen. */
const STATS = [
  "p_avg", "p_obp", "p_slg", "p_ops", "p_iso", "p_wrc_plus",
  "o_war", "p_war", "d_war", "bsr_war", "total_hitter_war",
  "market_value", "twp_hitter_market_value", "twp_pitcher_market_value",
  "p_era", "p_fip", "p_whip", "p_k9", "p_bb9", "p_hr9", "p_rv_plus",
  "projected_ip", "projected_pa",
];

/**
 * Sources a stat can be read from, in the order the doctrine prefers them.
 * `prediction` is deliberately listed as a source so it shows up as an ERROR when used.
 */
const SOURCES: { key: string; re: RegExp; verdict: "ok" | "error" | "neutral"; note: string }[] = [
  { key: "player_snapshot",   re: /player_snapshot/,   verdict: "ok",      note: "the roster snapshot — correct for a rostered player" },
  { key: "transfer_snapshot", re: /transfer_snapshot/, verdict: "ok",      note: "the board snapshot — correct for a target" },
  { key: "neutral_snapshot",  re: /neutral_snapshot/,  verdict: "neutral", note: "dev_agg=0 BASE — a checkpoint, never a display source" },
  { key: "prediction",        re: /\bprediction\b/,    verdict: "error",   note: "NOT a snapshot: `snapshot ?? predictionMap[...]`, degrades to a raw row" },
];

type Hit = { file: string; line: number; stat: string; source: string; kind: string; text: string };

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === "dist" || e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e) && !/\.(test|spec)\./.test(e)) out.push(p);
  }
  return out;
}

const hits: Hit[] = [];
const chains: { file: string; line: number; text: string }[] = [];

for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  // types.ts and the picker define shapes rather than render them
  if (/integrations\/supabase\/types\.ts$/.test(rel)) continue;
  const isSavant = /^src\/savant\//.test(rel);
  /**
   * ⚠ `.prediction` is only dangerous in the TEAM-BUILDER row shape, where useLoadBuild sets
   *   `prediction: activePred ?? null`  and  `activePred = snapshot ?? predictionMap[...]`
   * — a chain that silently degrades to a raw prediction row.
   *
   * Elsewhere the same field name means something else entirely. ReturningPlayers builds
   * `prediction: { p_avg: row.p_avg, ... }` — a literal assembled from the ALREADY-PICKED row
   * (via dedupePreferredPerPlayer). Reading that is correct.
   *
   * Flagging on the name alone produced 9 false positives out of 11. The rule is about the row
   * SHAPE, not the identifier.
   */
  const teamBuilderRowShape =
    /^src\/pages\/(TeamBuilder\.tsx|team-builder\/|targets\/)/.test(rel);

  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line.startsWith("//") || line.startsWith("*")) return;   // comments describe, they don't read

    for (const stat of STATS) {
      // `something?.p_avg` / `something.p_avg` — capture the accessor to its left
      const re = new RegExp(`([A-Za-z_$][\\w$.?\\[\\]"']*)\\??\\.${stat}\\b`, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(raw))) {
        const accessor = m[1];
        const src = SOURCES.find((s) => s.re.test(accessor));
        if (!src) continue;
        // Classify the READ, because not every mention is a rendered number:
        //   presence  `x?.p_avg != null`  — a has-data check, harmless
        //   sort      inside a comparator — DANGEROUS: the list can sort by one source
        //             while the cells render another, so the order contradicts the numbers
        //   display   everything else
        const presence = new RegExp(`\\.${stat}\\b\\s*[!=]==?\\s*null`).test(raw);
        const sort = /sortKey|comparator|sortBy|\.sort\(|localeCompare|=> *[ab]\b/.test(raw);
        let kind = presence ? "presence" : sort ? "sort" : "display";
        // outside the team-builder row shape, a `.prediction` read is a naming coincidence
        if (src.key === "prediction" && !teamBuilderRowShape) kind = `other-shape-${kind}`;
        hits.push({ file: rel, line: i + 1, stat, source: src.key, kind: isSavant ? `savant-${kind}` : kind, text: line.slice(0, 150) });
      }
      // a `??` chain across two different snapshot sources is where precedence hides
      if (raw.includes("??") && raw.includes(stat)) {
        const named = SOURCES.filter((s) => s.re.test(raw)).map((s) => s.key);
        if (named.length >= 2) chains.push({ file: rel, line: i + 1, text: line.slice(0, 160) });
      }
    }
  });
}

// ── report ───────────────────────────────────────────────────────────────────
const byFile = new Map<string, Hit[]>();
for (const h of hits) {
  const a = byFile.get(h.file) ?? [];
  a.push(h);
  byFile.set(h.file, a);
}

const pred = hits.filter((h) => h.source === "prediction");
const errors: Hit[] = pred.filter((h) => (h.kind === "display" || h.kind === "sort"));
const benign: Hit[] = pred.filter((h) => h.kind === "presence");
const otherShape: Hit[] = pred.filter((h) => h.kind.startsWith("other-shape"));
const savant: Hit[] = pred.filter((h) => h.kind.startsWith("savant"));
const multi: { file: string; stat: string; sources: string[] }[] = [];
for (const [file, hs] of byFile) {
  const byStat = new Map<string, Set<string>>();
  for (const h of hs) {
    const s = byStat.get(h.stat) ?? new Set();
    s.add(h.source);
    byStat.set(h.stat, s);
  }
  for (const [stat, srcs] of byStat) {
    if (srcs.size > 1) multi.push({ file, stat, sources: [...srcs].sort() });
  }
}

const md = process.argv.includes("--md");
const H = (s: string) => (md ? `\n## ${s}\n` : `\n══ ${s}`);

console.log(md ? "# Stat → Surface Map\n" : "STAT → SURFACE MAP");
console.log(`${byFile.size} files read a tracked stat · ${hits.length} reads · ${STATS.length} stats tracked`);

console.log(H(`ERROR — stat read from \`.prediction\` (${errors.length})`));
if (!errors.length) console.log("  none");
else {
  console.log("  `.prediction` is NOT a snapshot. It is `snapshot ?? predictionMap[...]` and silently");
  console.log("  degrades to a raw prediction row. This is the 2026-09-01 defect class.\n");
  for (const e of errors) console.log(`  [${e.kind.toUpperCase()}] ${e.file}:${e.line}  ${e.stat}\n      ${e.text}`);
}
console.log(H(`OK — presence checks only, not rendered (${benign.length})`));
for (const b of benign) console.log(`  ${b.file}:${b.line}  ${b.stat}`);
console.log(H(`NOT APPLICABLE — \`.prediction\` outside the team-builder row shape (${otherShape.length})`));
console.log("  ReturningPlayers builds `prediction: { p_avg: row.p_avg, ... }` from the ALREADY-PICKED");
console.log("  row. Same identifier, different meaning — reading it is correct.");
for (const o of otherShape.slice(0, 6)) console.log(`  ${o.file}:${o.line}  ${o.stat}`);
if (otherShape.length > 6) console.log(`  … ${otherShape.length - 6} more`);

console.log(H(`SEPARATE — src/savant/** has its own conventions (${savant.length})`));
console.log("  The savant module renders a prediction row directly by design. Reported, not failed.");
for (const v of savant.slice(0, 8)) console.log(`  ${v.file}:${v.line}  ${v.stat}`);

console.log(H(`WARN — same stat, multiple sources in one file (${multi.length})`));
if (!multi.length) console.log("  none");
else {
  console.log("  Two sources for one stat can disagree. Confirm the precedence is deliberate.\n");
  for (const m of multi.sort((a, b) => a.file.localeCompare(b.file))) {
    console.log(`  ${m.file}  ${m.stat.padEnd(24)} ${m.sources.join("  ??  ")}`);
  }
}

console.log(H(`INFO — \`??\` precedence chains (${chains.length})`));
for (const ch of chains.slice(0, 25)) console.log(`  ${ch.file}:${ch.line}\n      ${ch.text}`);
if (chains.length > 25) console.log(`  … ${chains.length - 25} more`);

console.log(H("COVERAGE — what this does NOT prove"));
console.log("  Text matching, not type-aware analysis. It surfaces CANDIDATE divergences for a human");
console.log("  to judge. It cannot prove two reads resolve to the same value at runtime, and it does");
console.log("  not exercise the dev-aggressiveness / depth-role / SP-RP toggle permutations that");
console.log("  rstr-agent-plan.md §4 asks for — those need a running app.");
console.log("  A clean run means 'no obvious divergence', NEVER 'the surfaces agree'.");

process.exit(errors.length ? 1 : 0);
