// Reformat the calibrate-xstats output (one pair per line) to the
// existing pitchLogRates.ts style (4 pairs per line), then swap each
// array in place.
import { readFileSync, writeFileSync } from "node:fs";

const CALIB_LOG = "/tmp/calibrate.log";
const TARGET = "src/savant/lib/pitchLogRates.ts";

const calib = readFileSync(CALIB_LOG, "utf8");

function extractArray(name: string): Array<[number, number]> {
  const re = new RegExp(`const ${name}: ReadonlyArray<readonly \\[number, number\\]> = \\[\\s*([\\s\\S]*?)\\];`, "m");
  const m = calib.match(re);
  if (!m) throw new Error(`Could not extract ${name}`);
  const body = m[1];
  const pairs: Array<[number, number]> = [];
  const pairRe = /\[\s*([\d.]+)\s*,\s*([\d.]+)\s*\]/g;
  let pm;
  while ((pm = pairRe.exec(body)) !== null) {
    pairs.push([parseFloat(pm[1]), parseFloat(pm[2])]);
  }
  return pairs;
}

function formatArray(pairs: Array<[number, number]>, indent = "  "): string {
  const entries = pairs.map(([a, b]) => `[${a.toFixed(4)}, ${b.toFixed(4)}]`);
  const lines: string[] = [];
  for (let i = 0; i < entries.length; i += 4) {
    const chunk = entries.slice(i, i + 4);
    lines.push(indent + chunk.join(", ") + (i + 4 < entries.length ? "," : ","));
  }
  return lines.join("\n");
}

const arrays = [
  "HITTER_XBA_LOOKUP",
  "HITTER_XSLG_LOOKUP",
  "HITTER_XWOBA_LOOKUP",
  "PITCHER_XBA_LOOKUP",
  "PITCHER_XSLG_LOOKUP",
];

let source = readFileSync(TARGET, "utf8");

for (const name of arrays) {
  const pairs = extractArray(name);
  console.log(`${name}: ${pairs.length} pairs extracted`);
  const newBody = formatArray(pairs);
  // Replace existing block: `const NAME: ... = [\n  ...\n];`
  const re = new RegExp(`(const ${name}: ReadonlyArray<readonly \\[number, number\\]> = \\[)\\n[\\s\\S]*?\\n(\\];)`, "m");
  if (!source.match(re)) throw new Error(`Could not find ${name} in target`);
  source = source.replace(re, `$1\n${newBody}\n$2`);
}

writeFileSync(TARGET, source);
console.log(`\n✅ Updated 5 lookup arrays in ${TARGET}`);
