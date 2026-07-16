/**
 * Roster scraper — annual spring backfill of players.headshot_url PLUS the
 * universal bio the roster page exposes (hometown, high/last school, height,
 * weight), from school athletics roster pages. All bio is written fill-null
 * (never clobbers existing scouting data); the headshot refreshes on re-run
 * (fill-null under --missing-only). Fields land on the shared `players` row, so
 * every team sees them via the player-hub's `players` fallback.
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
 * Three CMS families are auto-detected from the roster HTML (parseRoster):
 *   A. Sidearm "nextgen" — headshots on the LIST page (images.sidearmdev.com),
 *      player name encoded in the filename. (Kansas, FAU, TCU, Gardner-Webb, Georgia)
 *   B. WMT WordPress — server-rendered <table>, bio link /roster/<slug>/; photo on
 *      the bio page as a "…_1x1" wp-content/uploads crop. (Arkansas)
 *   C. Nuxt/Pinia roster-table — bio link /sports/<sport>/roster/player/<first-last>;
 *      photo is the bio page's og:image. (Penn State, Arizona State, Vanderbilt,
 *      BYU, Virginia Tech)
 * B and C are two-step (list → bio page → photo) but stay fetch-only — no headless
 * browser. Unknown layouts report CMS "unknown"; add a variant then.
 */
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const [rosterUrl, sourceTeamId] = process.argv.slice(2);
const WRITE = process.argv.includes("--write");
const MISSING_ONLY = process.argv.includes("--missing-only");
// --only <id,id,…> restricts the DB player set to specific players (the incoming
// transfers), so we fill just them off their old school's page, not the whole roster.
const onlyArg = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1]
  ?? (process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : undefined);
const ONLY = onlyArg ? onlyArg.split(",").map((s) => s.trim()).filter(Boolean) : null;
if (!rosterUrl || !sourceTeamId) {
  console.error("usage: scrape_headshots.ts <rosterUrl> <sourceTeamId> [--write] [--missing-only] [--only <id,id>]");
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

// Universal biographical facts we harvest alongside the headshot. All optional —
// a parser fills what its CMS exposes. Written to `players` (fill-null).
interface PlayerBio { home_state?: string | null; high_school?: string | null; height_inches?: number | null; weight?: number | null }
interface RosterEntry { tokens: string[]; headshotUrl: string | null; raw: string; bio?: PlayerBio }

const stripTags = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&rsquo;|&#8217;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
// "6-3" / "6'3\"" / "6' 3" → total inches; null if unparseable.
function heightToInches(s: string | null | undefined): number | null {
  const m = (s ?? "").match(/(\d)\s*(?:-|'|’|\s)\s*(\d{1,2})/);
  if (!m) return null;
  const ft = +m[1], inch = +m[2];
  return ft >= 4 && ft <= 7 && inch < 12 ? ft * 12 + inch : null;
}
const weightToNum = (s: string | null | undefined) => { const m = (s ?? "").match(/\b(1[5-9]\d|2[0-9]\d|3[0-4]\d)\b/); return m ? +m[1] : null; };
// A square, face-cropped headshot via Sidearm's crop service — so every Sidearm
// image (nextgen or legacy portrait) lands as a 400×400 square that fills the
// circular avatar cleanly. gravity=north keeps the head, not the chest.
const sidearmSquare = (fullImageUrl: string) =>
  `https://images.sidearmdev.com/crop?url=${encodeURIComponent(fullImageUrl)}&width=400&height=400&gravity=north&type=webp`;

// ── Sidearm-nextgen roster: server-rendered person cards. Each card carries the
// player's name (aria-label), headshot crop, hometown and high-school — so we
// match on the real name and harvest bio in one pass. (Height/weight/class live
// only in the page's index-encoded JSON payload — deferred.) ─────────────────
function parseSidearmRoster(html: string): RosterEntry[] {
  const out: RosterEntry[] = [];
  const seen = new Set<string>();
  // One chunk per list-view card; grid/table duplicates use a different root id.
  const cards = html.split(/data-test-id="s-person-card-list__root"/).slice(1);
  for (const card of cards) {
    // Full split element = exactly this card's content (its location region sits
    // before the next card's root marker), so first-match per field is this card's.
    const chunk = card;
    const name = chunk.match(/aria-label="([^"]+?)\s+jersey number[^"]*full bio"/i)?.[1]?.trim()
              ?? chunk.match(/\/sports\/[a-z0-9-]+\/roster\/([a-z0-9-]+)\/\d+"/i)?.[1]?.replace(/-/g, " ");
    if (!name) continue;
    const cropM = chunk.match(/images\.sidearmdev\.com\/crop\?url=([^"&]+)/);
    let headshotUrl: string | null = null;
    if (cropM) { try { headshotUrl = sidearmSquare(decodeURIComponent(cropM[1])); } catch { /* skip */ } }
    // Each location item is: <span …hometown><svg/><span class="sr-only">Label</span> VALUE </span>
    // — the value is the bare text node after the label span's close.
    const grabLoc = (marker: string, max: number) => {
      const m = chunk.match(new RegExp(`content-location-person-${marker}[a-z-]*"[\\s\\S]*?<\\/span>\\s*([^<]+?)\\s*<\\/span>`, "i"));
      const v = m ? stripTags(m[1]) : "";
      return v.length >= 2 && v.length <= max ? v : null;
    };
    const home_state = grabLoc("hometown", 60);
    const high_school = grabLoc("high", 80);
    const tokens = norm(name).length ? name.split(/\s+/).map(norm).filter((t) => t.length > 1) : [];
    if (tokens.length < 2 || tokens.length > 4) continue;
    const key = tokens.join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ tokens, headshotUrl, raw: name, bio: { home_state, high_school } });
  }
  return out;
}

const UA = "Mozilla/5.0 (compatible; rstriq-headshots)";
const fetchText = async (url: string): Promise<string | null> => {
  try { const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" }); return r.ok ? await r.text() : null; }
  catch { return null; }
};
// Polite bounded-concurrency map for the per-bio-page fetches.
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}
const tokensFromSlug = (slug: string) => slug.split(/[-_]/).map(norm).filter((t) => t.length > 1);

// ── Legacy Sidearm roster (classic `.sidearm-roster-player` template — the
// `roster.less` / #sidearm-roster-coaches layout, distinct from nextgen cards).
// Everything is inline per player: image, height, weight, hometown, high school. ─
function parseLegacySidearmRoster(rosterUrl: string, html: string): RosterEntry[] {
  const origin = new URL(rosterUrl).origin;
  const out: RosterEntry[] = [];
  const seen = new Set<string>();
  for (const b of html.split(/class="sidearm-roster-player[ "]/).slice(1)) {
    const name = b.match(/aria-label="([^"]+?)\s*-\s*View Full Bio"/i)?.[1]?.trim()
              ?? b.match(/data-player-url="\/sports\/[^"]*\/roster\/([a-z0-9-]+)\//i)?.[1]?.replace(/-/g, " ");
    if (!name) continue;
    let headshotUrl: string | null = null;
    const imgM = b.match(/sidearm-roster-player-image[\s\S]{0,600}?(?:data-src|src)="([^"]+\.(?:jpe?g|png)[^"]*)"/i);
    if (imgM && !/default|silhouette|blank|placeholder|missing/i.test(imgM[1])) {
      // Strip the resize query → original full-res, then square it through the
      // same crop service the nextgen URLs use (legacy raw images are portrait).
      const raw = imgM[1].replace(/&amp;/g, "&").split("?")[0];
      headshotUrl = sidearmSquare(raw.startsWith("http") ? raw : origin + raw);
    }
    const field = (cls: string) => stripTags(b.match(new RegExp(`sidearm-roster-player-${cls}"[^>]*>([\\s\\S]*?)<\\/span>`, "i"))?.[1] ?? "") || null;
    const hs = field("highschool");
    const tokens = name.split(/\s+/).map(norm).filter((t) => t.length > 1);
    if (tokens.length < 2 || tokens.length > 4) continue;
    const key = tokens.join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ tokens, headshotUrl, raw: name, bio: {
      home_state: field("hometown"),
      high_school: hs && hs.length <= 80 ? hs : null,
      height_inches: heightToInches(field("height")),
      weight: weightToNum(field("weight")),
    } });
  }
  return out;
}

// ── Parse a WMT (WordPress) roster → bio pages → wp-content headshot. ─────────
// Roster is a server-rendered <table>; each row links to /roster/<slug>/. The
// player photo lives on the bio page as an "…_1x1" crop under wp-content/uploads.
async function parseWmtRoster(rosterUrl: string, html: string): Promise<RosterEntry[]> {
  const origin = new URL(rosterUrl).origin;
  // Scope to the roster table so nav / staff anchors don't leak in.
  const ti = html.search(/rost_field_/i);
  const tbl = ti < 0 ? html : html.slice(html.lastIndexOf("<table", ti), html.indexOf("</table>", ti) + 8);
  // One row per player: bio link + all the <td> cells, identified by content
  // (order varies slightly per WMT school, so match on shape not column index).
  interface Row { slug: string; bio: string; bioFields: PlayerBio }
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const rm of tbl.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const linkM = rm[1].match(/href="((?:https?:\/\/[^"]+)?\/roster\/([a-z0-9-]+)\/?)"/i);
    if (!linkM || seen.has(linkM[2])) continue;
    seen.add(linkM[2]);
    const cells = [...rm[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]));
    const htCell = cells.find((c) => /^\d-\d{1,2}$/.test(c));
    const home = cells.find((c) => /,\s*[A-Za-z]/.test(c) && !/\bHS\b|High|Academy|College|School/i.test(c)); // "Edmond, Okla."
    const homeI = home ? cells.indexOf(home) : -1;
    const hs = homeI >= 0 ? cells.slice(homeI + 1).find((c) => c && !/^https?:/i.test(c) && /[A-Za-z]/.test(c)) : undefined; // cell after hometown
    const htI = htCell ? cells.indexOf(htCell) : -1;
    rows.push({ slug: linkM[2], bio: linkM[1].startsWith("http") ? linkM[1] : origin + linkM[1], bioFields: {
      height_inches: heightToInches(htCell),
      weight: htI >= 0 ? weightToNum(cells[htI + 1]) : null, // weight column follows height
      home_state: home ?? null,
      high_school: hs && hs.length <= 80 ? hs : null,
    } });
  }
  const entries = await mapLimit(rows, 5, async (r) => {
    const page = await fetchText(r.bio);
    // Prefer the square "_1x1" player crop; fall back to any name-bearing upload.
    const imgs = page ? [...page.matchAll(/(?:src|data-src)="([^"]*\/wp-content\/uploads\/[^"]+\.(?:jpe?g|png|webp)[^"]*)"/gi)].map((x) => x[1]) : [];
    const logoish = /logo|hog_|text-logo|seat-?geek|tyson|sponsor|wordmark/i;
    const pick = imgs.find((u) => /1x1/i.test(u) && !logoish.test(u))
              ?? imgs.find((u) => r.slug.split("-").some((t) => t.length > 2 && u.toLowerCase().includes(t)) && !logoish.test(u));
    return { tokens: tokensFromSlug(r.slug), headshotUrl: pick ?? null, raw: r.slug, bio: r.bioFields } as RosterEntry;
  });
  return entries;
}

// ── Parse a Nuxt/Pinia roster (Penn State, ASU, Vandy, BYU, Va Tech) → bio →
// og:image headshot. List rows are server-rendered with bio links
// /sports/<sport>/roster/player/<first-last>; the slug is the name, and the
// bio page's og:image is the player headshot (imgproxy-hosted). ──────────────
async function parseNuxtRoster(rosterUrl: string, html: string): Promise<RosterEntry[]> {
  const origin = new URL(rosterUrl).origin;
  const links = new Map<string, string>(); // slug → bioUrl
  for (const m of html.matchAll(/href="(\/sports\/[a-z0-9-]+\/roster\/player\/([a-z0-9-]+))"/gi)) {
    if (!links.has(m[2])) links.set(m[2], origin + m[1]);
  }
  const entries = await mapLimit([...links], 5, async ([slug, bio]) => {
    const page = await fetchText(bio);
    if (!page) return null;
    const og = page.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)?.[1];
    if (!og || /placeholder|default|logo|social-share/i.test(og)) return null;
    return { tokens: tokensFromSlug(slug), headshotUrl: og, raw: slug } as RosterEntry;
  });
  return entries.filter((e): e is RosterEntry => !!e);
}

// ── Dispatch on CMS family. A = Sidearm legacy (photos on the list page), B =
// WMT WordPress table, C = Nuxt roster-table. Both B and C are two-step
// (list → bio page → photo) but stay fetch-only — no headless browser. ───────
// Detect first so both the dispatcher and the log agree on the family.
function detectCms(html: string): "sidearm" | "sidearm-legacy" | "wmt" | "nuxt" | "unknown" {
  if (/s-person-card-list__root/.test(html)) return "sidearm";                 // nextgen cards
  if (/class="sidearm-roster-player[ "]/.test(html)) return "sidearm-legacy";  // classic template
  if (/rost_field_/i.test(html)) return "wmt";
  if (/\/roster\/player\//i.test(html)) return "nuxt";
  if (/images\.sidearmdev\.com\/crop/.test(html)) return "sidearm";            // nextgen fallback
  return "unknown";
}
async function parseRoster(rosterUrl: string, html: string): Promise<RosterEntry[]> {
  switch (detectCms(html)) {
    case "sidearm": return parseSidearmRoster(html);
    case "sidearm-legacy": return parseLegacySidearmRoster(rosterUrl, html);
    case "wmt": return parseWmtRoster(rosterUrl, html);
    case "nuxt": return parseNuxtRoster(rosterUrl, html);
    default: return [];
  }
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
  const res = await fetch(rosterUrl, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!res.ok) { console.error(`  roster fetch failed: ${res.status}`); process.exit(1); }
  const html = await res.text();
  const cms = detectCms(html);
  console.log(`  CMS: ${cms}${cms === "unknown" ? " (no parser — check the URL)" : ""}`);
  const roster = await parseRoster(rosterUrl, html);
  console.log(`  parsed ${roster.length} roster headshots`);

  // Pull the bio columns too so we can fill only the NULLs (never clobber scouting).
  let pq = sb.from("players")
    .select("id, first_name, last_name, headshot_url, home_state, high_school, height_inches, weight")
    .eq("source_team_id", sourceTeamId);
  if (ONLY) pq = pq.in("id", ONLY);
  const { data: players, error } = await pq;
  if (error) { console.error("  players query failed:", error.message); process.exit(1); }
  console.log(`  ${players?.length ?? 0} DB players for source_team_id=${sourceTeamId}`);

  type Row = { id: string; first_name: string; last_name: string; headshot_url: string | null; home_state: string | null; high_school: string | null; height_inches: number | null; weight: number | null };
  // Patch = the headshot (canonical source, refreshed on re-run) + any bio field
  // the player is currently missing. MISSING_ONLY keeps the headshot fill-null too.
  const buildPatch = (p: Row, e: RosterEntry) => {
    const patch: Record<string, any> = {};
    if (e.headshotUrl && (!MISSING_ONLY || !p.headshot_url)) patch.headshot_url = e.headshotUrl;
    const b = e.bio ?? {};
    if (b.home_state && !p.home_state) patch.home_state = b.home_state;
    if (b.high_school && !p.high_school) patch.high_school = b.high_school;
    if (b.height_inches && !p.height_inches) patch.height_inches = b.height_inches;
    if (b.weight && !p.weight) patch.weight = b.weight;
    return patch;
  };

  const matched: { p: Row; e: RosterEntry; q: "exact" | "fuzzy"; patch: Record<string, any> }[] = [];
  const usedEntries = new Set<RosterEntry>();
  for (const pass of ["exact", "fuzzy"] as const) {
    for (const p of (players ?? []) as Row[]) {
      if (matched.some((m) => m.p.id === p.id)) continue;
      const hit = roster.find((e) => !usedEntries.has(e) && matchQuality(e, p.first_name, p.last_name) === pass);
      if (hit) { usedEntries.add(hit); matched.push({ p, e: hit, q: pass, patch: buildPatch(p, hit) }); }
    }
  }
  const unmatchedDb = ((players ?? []) as Row[]).filter((p) => !matched.some((m) => m.p.id === p.id)).map((p) => `${p.first_name} ${p.last_name}`);
  const unmatchedRoster = roster.filter((e) => !usedEntries.has(e)).map((e) => e.raw);
  const fieldCount = (k: string) => matched.filter((m) => k in m.patch).length;

  console.log(`\n  MATCHED ${matched.length} (≈ = fuzzy, review):`);
  for (const m of matched) console.log(`    ${m.q === "fuzzy" ? "≈" : "✓"} ${m.p.first_name} ${m.p.last_name}  [${Object.keys(m.patch).map((k) => k.replace("headshot_url", "photo").replace("home_state", "hometown").replace("high_school", "HS").replace("height_inches", "ht")).join(", ") || "no new fields"}]`);
  console.log(`\n  Will set → photo:${fieldCount("headshot_url")} hometown:${fieldCount("home_state")} HS:${fieldCount("high_school")} ht:${fieldCount("height_inches")} wt:${fieldCount("weight")}`);
  console.log(`  DB players NOT on roster (${unmatchedDb.length}):`, unmatchedDb.join(", ") || "(none)");
  console.log(`  Roster rows NOT matched (${unmatchedRoster.length}):`, unmatchedRoster.join(", ") || "(none)");

  const writable = matched.filter((m) => Object.keys(m.patch).length > 0);
  if (WRITE && writable.length) {
    console.log(`\n  Writing ${writable.length} player rows…`);
    for (const m of writable) {
      const { error: e } = await sb.from("players").update(m.patch).eq("id", m.p.id);
      if (e) console.error(`    write failed ${m.p.first_name} ${m.p.last_name}: ${e.message}`);
    }
    console.log("  done.");
  } else {
    console.log(`\n  DRY RUN — re-run with --write to persist${writable.length ? "" : " (nothing new to write)"}.`);
  }
}
main();
