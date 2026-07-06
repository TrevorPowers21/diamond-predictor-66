/**
 * Compare prod's actual model_config values against the TypeScript defaults
 * that staging falls back to when model_config is empty.
 *
 * Approach: grep the codebase for eqNum("key", default) call sites, extract
 * each key + default, then compare against prod's stored value.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const PROD = createClient(
  "https://trbvxuoliwrfowibatkm.supabase.co",
  process.env.PROD_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

// Find all eqNum(key, default) calls in the codebase
const grepOutput = execSync(
  `grep -rEhno 'eqNum\\("([^"]+)", *([0-9eE.+\\-]+|TRANSFER_WEIGHT_DEFAULTS\\.[A-Za-z_]+)\\)' src/ --include="*.ts" --include="*.tsx" || true`,
  { cwd: process.cwd() },
).toString();

const tsDefaults: Record<string, string> = {};
for (const line of grepOutput.split("\n")) {
  const m = line.match(/eqNum\("([^"]+)", *([^)]+)\)/);
  if (m) {
    const key = m[1];
    const defaultLiteral = m[2].trim();
    if (!(key in tsDefaults)) tsDefaults[key] = defaultLiteral;
  }
}

// Resolve TRANSFER_WEIGHT_DEFAULTS lookups
let twdConsts: Record<string, number> = {};
try {
  const twdText = readFileSync("src/lib/transferWeightDefaults.ts", "utf8");
  // crude parse: look for `KEY: NUMERIC_LITERAL`
  for (const m of twdText.matchAll(/(\w+):\s*([0-9eE.+\-]+)/g)) {
    twdConsts[m[1]] = Number(m[2]);
  }
} catch {}

function resolveDefault(s: string): number | null {
  if (s.startsWith("TRANSFER_WEIGHT_DEFAULTS.")) {
    const name = s.replace("TRANSFER_WEIGHT_DEFAULTS.", "");
    return twdConsts[name] ?? null;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Fetch all prod model_config rows for 2026
const { data: prodRows } = await (PROD as any)
  .from("model_config")
  .select("config_key, config_value, model_type")
  .eq("season", 2026);
const prodMap: Record<string, number> = {};
for (const r of prodRows || []) prodMap[r.config_key] = Number(r.config_value);

// Now compare
const matches: string[] = [];
const diffs: { key: string; prod: number; tsDefault: number; pctDiff: string }[] = [];
const missingOnProd: string[] = [];
const unresolvedTs: string[] = [];

for (const [key, defLit] of Object.entries(tsDefaults).sort()) {
  const tsDef = resolveDefault(defLit);
  const prodVal = prodMap[key];
  if (tsDef == null) { unresolvedTs.push(`${key} (literal: ${defLit})`); continue; }
  if (!(key in prodMap)) { missingOnProd.push(key); continue; }
  if (Math.abs(prodVal - tsDef) < 1e-9) { matches.push(key); continue; }
  const pct = tsDef === 0 ? "∞" : ((prodVal - tsDef) / tsDef * 100).toFixed(1) + "%";
  diffs.push({ key, prod: prodVal, tsDefault: tsDef, pctDiff: pct });
}

console.log(`=== Summary ===`);
console.log(`  Total eqNum() keys found in source:     ${Object.keys(tsDefaults).length}`);
console.log(`  Keys present in prod model_config:      ${Object.keys(prodMap).length}`);
console.log(`  Matches (prod == TS default):           ${matches.length}`);
console.log(`  Differences (prod != TS default):       ${diffs.length}`);
console.log(`  In code but missing from prod:          ${missingOnProd.length}`);
console.log(`  TS default unresolved:                  ${unresolvedTs.length}`);

if (diffs.length > 0) {
  console.log(`\n=== Tuned values that differ from TS defaults ===`);
  console.log("KEY".padEnd(48), "PROD".padStart(12), "TS DEFAULT".padStart(14), "Δ%".padStart(8));
  for (const d of diffs) {
    console.log(d.key.padEnd(48), String(d.prod).padStart(12), String(d.tsDefault).padStart(14), d.pctDiff.padStart(8));
  }
}

if (missingOnProd.length > 0) {
  console.log(`\n=== Keys in code but missing from prod model_config ===`);
  for (const k of missingOnProd.slice(0, 20)) console.log("  " + k);
  if (missingOnProd.length > 20) console.log(`  ... and ${missingOnProd.length - 20} more`);
}
