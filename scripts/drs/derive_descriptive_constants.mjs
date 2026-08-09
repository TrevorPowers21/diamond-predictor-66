// derive_descriptive_constants.mjs
// -----------------------------------------------------------------------------
// WAR-system redesign, Step 2: derive the DESCRIPTIVE-side constants from D1.
// Descriptive pitcher WAR = (replRA9 − descRA9) · IP/9 / RPW
//   where descRA9 = w·(RA9 + dRS_behind) + (1−w)·FIP·E2T
//
// Doctrine (Trevor):
//   * lgERA comes FROM THE MASTER (= Baseball Reference), not the pitch log.
//   * Every pitcher line is NOT equal weight: lgERA = ΣER / ΣIP (IP-weighted),
//     which equals Σ(ERAᵢ·IPᵢ)/ΣIPᵢ because ERAᵢ = 9·ERᵢ/IPᵢ. We read the
//     Master's authoritative ERA column and IP-weight it — that is ΣER/ΣIP with
//     the Master's own numbers, and lands lgERA = 6.08 (matches Trevor's target).
//   * Replacement level = a SINGLE level (no SP/RP split). College RP being worse
//     than SP is real (more roster spots, more mop-up arms) but does not warrant
//     overhauling the data with a role-split replacement.
//
// Outputs a stamped fixture: output/descriptive_constants.json
// -----------------------------------------------------------------------------
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";

const SEASON = 2026;
const RPW = 13.1; // Pythag 2R at R≈6.54; the one already-solid constant.

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function all(t, c) {
  let a = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from(t).select(c).eq("Season", SEASON).range(f, f + 999);
    if (error) { console.error(error.message); process.exit(1); }
    a = a.concat(data);
    if (data.length < 1000) break;
  }
  return a;
}

// --- Master table: authoritative ERA + IP (D1 only) --------------------------
const master = (await all("Pitching Master", "source_player_id,IP,ERA,Role,division"))
  .filter((p) => p.division === "D1" && p.IP > 0 && p.ERA != null);

const sumIP = master.reduce((s, p) => s + p.IP, 0);
const lgERA = master.reduce((s, p) => s + p.ERA * p.IP, 0) / sumIP; // = ΣER/ΣIP

// --- Export CSV: R and ER (for the earned→total ratio E2T) --------------------
const exp = {};
{
  const rows = readFileSync("docs/drs-reference/Full Season Pitching Master Stats.csv", "utf8").split("\n");
  const H = rows[0].split(",");
  const gi = (k) => H.indexOf(k);
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i]) continue;
    const c = rows[i].split(",");
    exp[(c[gi("playerId")] || "").trim()] = {
      R: parseFloat(c[gi("R")] || 0),
      ER: parseFloat(c[gi("ER")] || 0),
      IP: parseFloat(c[gi("IP")] || 0),
    };
  }
}
let sumR = 0, sumER = 0;
for (const p of master) {
  const e = exp[String(p.source_player_id)];
  if (e) { sumR += e.R; sumER += e.ER; }
}
const E2T = sumR / sumER;            // total runs per earned run
const lgRA9 = lgERA * E2T;           // league total-runs-allowed per 9

// --- Single replacement level (no SP/RP split) -------------------------------
// Win%-anchor (industry-standard, single transparent knob — no IP floor / cutoff).
// A replacement-level team wins ~.380. At league-average run scoring (RS = lgRA9),
// Pythag(2): w = RS² / (RS² + RA²)  ⇒  replRA9 = lgRA9·√(1/w − 1).
const REPL_WINPCT = 0.380;
const replRA9 = lgRA9 * Math.sqrt(1 / REPL_WINPCT - 1);

// --- Report + stamp ----------------------------------------------------------
console.log(`D1 pitchers: ${master.length}   ΣIP: ${sumIP.toFixed(0)}`);
console.log(`  lgERA (Master ERA col, IP-weighted = ΣER/ΣIP) = ${lgERA.toFixed(3)}`);
console.log(`  E2T   (ΣR/ΣER)                                = ${E2T.toFixed(4)}`);
console.log(`  lgRA9 (lgERA × E2T)                           = ${lgRA9.toFixed(3)}`);
console.log(`  RPW                                           = ${RPW}`);
console.log(`  replacement RA9 (win%-anchor .${REPL_WINPCT * 1000}, single level) = ${replRA9.toFixed(2)}`);

const fixture = {
  _meta: {
    script: "scripts/drs/derive_descriptive_constants.mjs",
    season: SEASON,
    derived_at: process.env.STAMP || "SET_STAMP",
    source: "Pitching Master (ERA/IP authoritative) + Full Season export (R/ER for E2T)",
    doctrine: "lgERA from Master, IP-weighted ΣER/ΣIP; single replacement level (no SP/RP split); replacement = win%-anchor .380 (no IP floor / empirical cutoff)",
  },
  RPW,
  lgERA: Number(lgERA.toFixed(3)),
  E2T: Number(E2T.toFixed(4)),
  lgRA9: Number(lgRA9.toFixed(3)),
  replacement_RA9: Number(replRA9.toFixed(2)),
  replacement_method: { type: "winpct_anchor", winpct: REPL_WINPCT },
  reliability_curve_w: null, // Step 2 remaining — gated out-of-sample derivation
};
mkdirSync("output", { recursive: true });
writeFileSync("output/descriptive_constants.json", JSON.stringify(fixture, null, 2));
console.log("\nwrote output/descriptive_constants.json");
