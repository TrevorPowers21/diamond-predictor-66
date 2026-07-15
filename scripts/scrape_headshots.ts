/**
 * Headshot scraper — annual spring backfill of players.headshot_url from school
 * athletics roster pages (Sidearm-powered).
 *
 * Scope (agreed): only players who are actually rostered somewhere. Returners
 * come from the customer's own school; added/portal players from their source
 * school. So we only ever hit the handful of schools that have rostered players,
 * never all ~300.
 *
 * Runs:
 *   npx tsx --env-file-if-exists=.env.local scripts/scrape_headshots.ts <rosterUrl> <sourceTeamId> [--write] [--missing-only]
 *
 * Default is a DRY RUN (report only). Add --write to persist. --missing-only
 * scopes to players with a null headshot_url (the periodic portal sweep).
 *
 * The parser targets Sidearm "nextgen" roster pages, where the player name is
 * encoded in the headshot filename (Last_First). Other Sidearm variants / CMSes
 * will show as unmatched in the report — adapt the parser per variant later.
 */
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const [rosterUrl, sourceTeamId] = process.argv.slice(2);
const WRITE = process.argv.includes("--write");
const MISSING_ONLY = process.argv.includes("--missing-only");
if (!rosterUrl || !sourceTeamId) {
  console.error("usage: scrape_headshots.ts <rosterUrl> <sourceTeamId> [--write] [--missing-only]");
  process.exit(1);
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
// Last name minus generational suffix (Max Soliz Jr. → soliz).
const normLast = (s: string | null | undefined) => norm((s ?? "").replace(/\b(jr|sr|ii|iii|iv|v)\.?\b/gi, ""));

// Levenshtein (short strings) for 1-char spelling drift (Thomson/Tomson).
function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 9;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
const closeLast = (t: string, l: string) => t === l || (Math.min(t.length, l.length) >= 4 && lev(t, l) === 1);
const closeFirst = (t: string, f: string) =>
  t === f
  || (Math.min(t.length, f.length) >= 3 && (t.startsWith(f) || f.startsWith(t))) // Dom/Dominic, Josh/Joshua
  || (Math.min(t.length, f.length) >= 3 && lev(t, f) === 1);                      // Landon/Landen

// ── Parse a Sidearm-nextgen roster page → [{ tokens, headshotUrl }] ──────────
interface RosterEntry { tokens: string[]; headshotUrl: string; raw: string }
function parseSidearmRoster(html: string): RosterEntry[] {
  const seen = new Map<string, RosterEntry>();
  for (const m of html.matchAll(/images\.sidearmdev\.com\/crop\?url=([^"&]+)/g)) {
    let cloud: string;
    try { cloud = decodeURIComponent(m[1]); } catch { continue; }
    const fileM = cloud.match(/\/([^/?]+?)\.(?:jpe?g|png)(?:\.(?:jpe?g|png))?$/i);
    if (!fileM) continue;
    let file = fileM[1];
    // strip leading jersey number ("8_") and trailing ids / years / staff roles
    file = file.replace(/^\d+[-_]/, "")
               .replace(/[-_](?:20\d\d|\d{2,5}|director|coach|analytics|assistant|head|volunteer|staff|of)[\w-]*$/i, "");
    const tokens = file.split(/[-_]/).map(norm).filter((t) => t.length > 1);
    if (tokens.length < 2 || tokens.length > 4) continue; // skip logos / staff banners
    if (seen.has(cloud)) continue;
    // Store Sidearm's optimized square crop (small webp) rather than the multi-MB
    // original — ready for the circular avatar.
    const headshotUrl = `https://images.sidearmdev.com/crop?url=${encodeURIComponent(cloud)}&width=400&height=400&type=webp`;
    seen.set(cloud, { tokens, headshotUrl, raw: file });
  }
  return [...seen.values()];
}

// ── Match a roster entry to a DB player: a token close to the last name and a
// different token close to the first name. Returns "exact" | "fuzzy" | null. ──
function matchQuality(entry: RosterEntry, first: string, last: string): "exact" | "fuzzy" | null {
  const f = norm(first), l = normLast(last);
  if (!f || !l) return null;
  const li = entry.tokens.findIndex((t) => closeLast(t, l));
  if (li < 0) return null;
  const fi = entry.tokens.findIndex((t, i) => i !== li && closeFirst(t, f));
  if (fi < 0) return null;
  const exact = entry.tokens[li] === l && entry.tokens[fi] === f;
  return exact ? "exact" : "fuzzy";
}

async function main() {
  console.log(`Fetching ${rosterUrl} …`);
  const res = await fetch(rosterUrl, { headers: { "User-Agent": "Mozilla/5.0 (compatible; rstriq-headshots)" }, redirect: "follow" });
  if (!res.ok) { console.error(`  roster fetch failed: ${res.status}`); process.exit(1); }
  const roster = parseSidearmRoster(await res.text());
  console.log(`  parsed ${roster.length} roster headshots`);

  let q = sb.from("players").select("id, first_name, last_name, headshot_url").eq("source_team_id", sourceTeamId);
  if (MISSING_ONLY) q = q.is("headshot_url", null);
  const { data: players, error } = await q;
  if (error) { console.error("  players query failed:", error.message); process.exit(1); }
  console.log(`  ${players?.length ?? 0} DB players for source_team_id=${sourceTeamId}${MISSING_ONLY ? " (missing headshot)" : ""}`);

  const matched: { id: string; name: string; url: string; q: "exact" | "fuzzy" }[] = [];
  const usedEntries = new Set<RosterEntry>();
  // Exact pass first so a fuzzy candidate can't steal an entry from an exact match.
  for (const pass of ["exact", "fuzzy"] as const) {
    for (const p of players ?? []) {
      if (matched.some((m) => m.id === p.id)) continue;
      const hit = roster.find((e) => !usedEntries.has(e) && matchQuality(e, p.first_name, p.last_name) === pass);
      if (hit) { usedEntries.add(hit); matched.push({ id: p.id, name: `${p.first_name} ${p.last_name}`, url: hit.headshotUrl, q: pass }); }
    }
  }
  const unmatchedDb = (players ?? []).filter((p) => !matched.some((m) => m.id === p.id)).map((p) => `${p.first_name} ${p.last_name}`);
  const unmatchedRoster = roster.filter((e) => !usedEntries.has(e)).map((e) => e.raw);

  console.log(`\n  MATCHED ${matched.length} (≈ = fuzzy, review):`);
  for (const m of matched) console.log(`    ${m.q === "fuzzy" ? "≈" : "✓"} ${m.name}`);
  console.log(`\n  DB players NOT on roster (${unmatchedDb.length}):`, unmatchedDb.join(", ") || "(none)");
  console.log(`  Roster headshots NOT matched (${unmatchedRoster.length}):`, unmatchedRoster.join(", ") || "(none)");

  if (WRITE && matched.length) {
    console.log(`\n  Writing ${matched.length} headshot_url values…`);
    for (const m of matched) {
      const { error: e } = await sb.from("players").update({ headshot_url: m.url }).eq("id", m.id);
      if (e) console.error(`    write failed ${m.name}: ${e.message}`);
    }
    console.log("  done.");
  } else {
    console.log(`\n  DRY RUN — re-run with --write to persist.`);
  }
}
main();
