#!/usr/bin/env node
/**
 * PHASE F — end-to-end safety audit. Static code scan rather than data
 * audit. Verifies the launch-readiness contract Trevor locked in:
 *
 *   1. No display-layer code accidentally writes to stored prediction /
 *      valuation / power-rating fields (would trigger drift).
 *   2. Find every read site for Pitching Master.stuff_plus (Switch #3
 *      target — switching this to pitch_log Stuff+ will affect these).
 *   3. Find every read site for Hitter Master AVG/OBP/SLG for 2026
 *      (Switch #6 target).
 *   4. Find every read site for the X_score scouting grades (Switch #5
 *      already shipped on PlayerProfile — make sure other surfaces also
 *      need updating or are OK as-is).
 *
 * Usage:
 *   npm run audit-phase-f
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

const WRITE_TARGETS_PROTECTED = [
  "player_predictions",
  "nil_valuations",
  "overall_power_rating",
  "ba_power_rating",
  "obp_power_rating",
  "iso_power_rating",
];

const READ_TARGETS_FOR_SWITCHES = {
  "Switch #3 (Stuff+)": ["stuff_plus", "Stuff+", "blended_stuff_plus"],
  "Switch #6 (Slash)": ['"AVG"', '"OBP"', '"SLG"', "Hitter Master"],
  "Switch #5 (Scouting Grades)": ["barrel_score", "avg_ev_score", "contact_score", "chase_score"],
};

interface Hit {
  file: string;
  line: number;
  text: string;
}

function* walkFiles(dir: string): Generator<string> {
  const entries = readdirSync(dir);
  for (const name of entries) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) {
      if (name === "node_modules" || name === ".git" || name === "dist") continue;
      yield* walkFiles(full);
    } else if (s.isFile() && (name.endsWith(".ts") || name.endsWith(".tsx"))) {
      yield full;
    }
  }
}

function findInFile(filePath: string, pattern: string): Hit[] {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const hits: Hit[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(pattern)) {
      hits.push({ file: filePath.replace(ROOT + "/", ""), line: i + 1, text: lines[i].trim().slice(0, 120) });
    }
  }
  return hits;
}

function classify(hit: Hit): "write" | "read" | "comment" | "test" {
  if (hit.file.includes(".test.")) return "test";
  const t = hit.text;
  if (/^\s*(\/\/|\*)/.test(t)) return "comment";
  // .upsert(/.insert(/.update(/.delete(
  if (/\.(upsert|insert|update|delete)\(/.test(t)) return "write";
  return "read";
}

async function main() {
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log("  PHASE F — end-to-end code path safety scan");
  console.log("══════════════════════════════════════════════════════════════════════\n");

  const allFiles = [...walkFiles(SRC)];
  console.log(`Scanning ${allFiles.length} .ts / .tsx files in src/\n`);

  // ── 1. Protected write targets ─────────────────────────────────────
  console.log("── 1. Protected stored-state writes (must be admin/precompute only) ──\n");
  for (const target of WRITE_TARGETS_PROTECTED) {
    const allHits: Hit[] = [];
    for (const f of allFiles) allHits.push(...findInFile(f, target));
    const writes = allHits.filter((h) => classify(h) === "write");
    const isOk = writes.length === 0 || writes.every((h) =>
      h.file.includes("computeAndStore") ||
      h.file.includes("precompute") ||
      h.file.includes("AdminDashboard") ||
      h.file.includes("Importer") ||
      h.file.includes("scripts/") ||
      h.file.includes("targetBoard") ||
      h.file.includes("MarketPayLogButton") ||
      h.file.includes("storeProjection")
    );
    console.log(`  ${isOk ? "✓" : "✗"} ${target.padEnd(30)} ${writes.length} write site(s)`);
    if (!isOk) for (const w of writes.slice(0, 3)) console.log(`        ${w.file}:${w.line}`);
  }

  // ── 2. Switch targets — readers we'll need to update ───────────────
  for (const [switchName, patterns] of Object.entries(READ_TARGETS_FOR_SWITCHES)) {
    console.log(`\n── 2. ${switchName} — sites that read these patterns ───────`);
    const fileHits = new Map<string, number>();
    for (const p of patterns) {
      for (const f of allFiles) {
        const hits = findInFile(f, p);
        const reads = hits.filter((h) => classify(h) === "read");
        if (reads.length > 0) {
          fileHits.set(reads[0].file, (fileHits.get(reads[0].file) ?? 0) + reads.length);
        }
      }
    }
    // Sort by hit count
    const sorted = [...fileHits.entries()].sort((a, b) => b[1] - a[1]);
    const pageHits = sorted.filter(([f]) => f.startsWith("src/pages/") || f.startsWith("src/components/"));
    console.log(`  ${pageHits.length} display-layer file(s) read this. Top 5:`);
    for (const [file, n] of pageHits.slice(0, 5)) {
      console.log(`    ${n.toString().padStart(3)} reads · ${file}`);
    }
  }

  // ── 3. New pitch_log hooks — verify isolation ──────────────────────
  console.log(`\n── 3. New pitch_log hooks — confirm display-only (no writes) ──`);
  const hookFiles = allFiles.filter((f) => /usePitchLog|PitchLogSection/.test(f));
  console.log(`  Found ${hookFiles.length} pitch_log hook / component files`);
  let writeViolations = 0;
  for (const f of hookFiles) {
    const content = readFileSync(f, "utf-8");
    const writePatterns = /\.(upsert|insert|update|delete)\(\s*['"`]/g;
    const matches = content.match(writePatterns);
    if (matches) {
      writeViolations++;
      console.log(`    ✗ ${f.replace(ROOT + "/", "")} has ${matches.length} write call(s)`);
    }
  }
  console.log(`  ${writeViolations === 0 ? "✓" : "✗"} All pitch_log hooks are display-only (no Supabase writes)`);

  console.log("\n══════════════════════════════════════════════════════════════════════");
  console.log("  Phase F complete.");
  console.log("══════════════════════════════════════════════════════════════════════");
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
