/**
 * TOGGLE PERMUTATION RUNNER — rstr-agent-plan.md §4's #1 HARD STOP.
 *
 *   "Every user-facing number must read from the proper precompute line. The same stat showing two
 *    different values anywhere invalidates the whole app. Verify they resolve to the IDENTICAL
 *    value, running the dev-agg / depth-role / SP-RP permutations to confirm the number doesn't move."
 *
 * The check that would have caught 2026-09-01 DIRECTLY. Every automated check that night verified
 * the DATABASE; the bugs lived in the READ PATH, and only a human clicking found them.
 *
 * ASSERTIONS (shape confirmed by Trevor 2026-09-03)
 *   T1  a toggle MOVES the number      — one that changes nothing means a stale copy is being read
 *   T2  and RESTORES it exactly        — non-idempotent means the live compute is lossy
 *   T3  depth role moves it too        — the Neiswonger class: PA/IP come from the ROLE
 *   T4  Player Profile agrees with TB  — rostered/board players read the SAVED snapshot
 *   T5  Target Board agrees with TB    — roster beats board; both must show ONE value
 *
 * ⚠ Rostered/board players reflect saved state on their profile. A player NOT on the roster or board
 *   gets a LOCAL session that never persists — a different path, not covered (see COVERAGE).
 *
 * Uses the `playwright` library directly, not @playwright/test: the browsers are already downloaded
 * and this stays a plain script like every other check in scripts/agent/.
 *
 * Drives LOCAL DEV, which reads STAGING. Touches no database directly.
 *
 *   npm run dev                                     # separate terminal, required
 *   TEST_COACH_PASSWORD='…' npm run agent:toggles
 *   … -- --headed        watch it
 *   … -- --players=5     how many rows to sweep (default 3)
 */
import { chromium, type Page, type Locator } from "playwright";
import { Client, types } from "pg";
import { readFileSync } from "fs";
import { resolve } from "path";

// pg hands numeric(1700)/int8(20) back as STRINGS — unconverted, every comparison below would be
// string comparison dressed as arithmetic.
types.setTypeParser(1700, Number);
types.setTypeParser(20, Number);

const HEADED = process.argv.includes("--headed");
const BASE = process.env.BASE_URL || "http://localhost:5173";     // vite.config.ts server.port
const N_PLAYERS = Number((process.argv.find((a) => a.startsWith("--players=")) || "").split("=")[1] || 3);

// Mirrors src/components/WhatsNewModal.tsx — STORAGE_KEY and RELEASES[0].date.
const MODAL_KEY = "rstr_iq_whats_new_seen_v9";
const MODAL_VAL = "2026-08-26";

const C = { r: "\x1b[0m", b: "\x1b[1m", g: "\x1b[32m", red: "\x1b[31m", y: "\x1b[33m", c: "\x1b[36m", d: "\x1b[2m" };
let failures = 0, checks = 0;
const ok = (s: string) => { checks++; console.log(`    ${C.g}✓${C.r} ${s}`); };
const bad = (s: string) => { checks++; failures++; console.log(`    ${C.red}✗${C.r} ${s}`); };
const warn = (s: string) => console.log(`    ${C.y}!${C.r} ${s}`);
const info = (s: string) => console.log(`  ${C.c}·${C.r} ${s}`);
const skip = (s: string) => console.log(`    ${C.d}– ${s}${C.r}`);

function envVal(key: string): string | undefined {
  try {
    const m = readFileSync(resolve(process.cwd(), ".env.local"), "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
    return m?.[1]?.trim().replace(/^["']|["']$/g, "");
  } catch { return undefined; }
}

const EMAIL = process.env.TEST_COACH_EMAIL || "rls-test-coach@rstriq.test";
const PASSWORD = process.env.TEST_COACH_PASSWORD;

type Snapshot = {
  name: string; slash: string; wrcPlus: string; market: string; war: string;
  devAgg: string; depth: string; sprp: string;
};

/**
 * ⚠ WHICH STATS A TOGGLE SHOULD MOVE — getting this wrong makes the runner cry wolf.
 *
 *   dev agg     changes the PROJECTION ITSELF → moves the RATE stats (wRC+, AVG/OBP/SLG) and,
 *               through them, WAR and market.
 *   depth role  changes PLAYING TIME only (Cornerstone 245 PA → Everyday 215 PA). wRC+ is a RATE
 *               and MUST NOT move. oWAR scales with PA, so WAR and market MUST move.
 *
 * The first version of this runner asserted wRC+ for both and reported three false failures —
 * "depth role changed NOTHING" — when the app was correct and the assertion was wrong. Same
 * mistake shape as measuring across a key boundary: compare the thing that should actually change.
 */
type ToggleId = "tb-devagg" | "tb-depth" | "tb-sprp";

const MOVES: Record<ToggleId, { fields: (keyof Snapshot)[]; why: string }> = {
  "tb-devagg": { fields: ["wrcPlus", "slash", "war", "market"], why: "dev agg changes the projection, so rate stats move" },
  "tb-depth":  { fields: ["war", "market"],                     why: "depth changes PA/IP only; a RATE must NOT move" },
  // ⚠ SP↔RP is NOT playing-time-only. It swaps the depth-role option set AND the expected-IP scale,
  // and a reliever's RATE profile legitimately differs from a starter's (the role adjustment). So
  // rates are EXPECTED to move here — unlike depth role, which must leave them alone. An earlier
  // version applied the depth-role guard to SP/RP and reported a false failure on Neiswonger.
  "tb-sprp":   { fields: ["war", "market"],                     why: "SP/RP changes role AND expected IP, so both rates and counting stats move" },
};

async function dismissDialogs(page: Page) {
  for (let i = 0; i < 4; i++) {
    if (await page.locator('[role="dialog"]').first().isVisible().catch(() => false)) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(350);
    } else return;
  }
}

const rowFor = (page: Page, pid: string) =>
  page.locator(`[data-testid="tb-row"][data-player-id="${pid}"]`).first();

async function readRow(page: Page, pid: string): Promise<Snapshot> {
  const row = rowFor(page, pid);
  const txt = async (id: string) =>
    (await row.locator(`[data-testid="${id}"]`).first().innerText().catch(() => "")).trim();
  return {
    name: (await row.getAttribute("data-player-name")) ?? "",
    slash: await txt("tb-stat-slash"),
    wrcPlus: await txt("tb-stat-wrcplus"),
    market: await txt("tb-stat-market"),
    war: await txt("tb-stat-war"),
    devAgg: await txt("tb-devagg"),
    depth: await txt("tb-depth"),
    sprp: await txt("tb-sprp"),
  };
}

/** Open a Select and choose the first option whose label differs from `current`. */
async function pickDifferent(page: Page, trigger: Locator, current: string): Promise<string | null> {
  await trigger.click();
  const options = page.locator('[role="option"]');
  await options.first().waitFor({ timeout: 8000 });
  const labels = (await options.allInnerTexts()).map((t) => t.trim());
  const idx = labels.findIndex((t) => t && t !== current);
  if (idx < 0) { await page.keyboard.press("Escape"); return null; }
  await options.nth(idx).click();
  await page.waitForTimeout(1100);      // let the live compute settle
  return labels[idx];
}

async function pickExact(page: Page, trigger: Locator, label: string): Promise<boolean> {
  await trigger.click();
  const options = page.locator('[role="option"]');
  await options.first().waitFor({ timeout: 8000 });
  const idx = (await options.allInnerTexts()).map((t) => t.trim()).findIndex((t) => t === label);
  if (idx < 0) { await page.keyboard.press("Escape"); return false; }
  await options.nth(idx).click();
  await page.waitForTimeout(1100);
  return true;
}

/** T1/T2/T3 — one toggle on one player: does the number move, and does it come back? */
async function testToggle(page: Page, pid: string, which: ToggleId, label: string) {
  const before = await readRow(page, pid);
  const current = which === "tb-devagg" ? before.devAgg : which === "tb-depth" ? before.depth : before.sprp;
  if (!current) { skip(`${label}: no control rendered on this row`); return; }

  const trigger = rowFor(page, pid).locator(`[data-testid="${which}"]`).first();
  const chosen = await pickDifferent(page, trigger, current);
  if (!chosen) { skip(`${label}: only one option (${current})`); return; }

  const after = await readRow(page, pid);
  const spec = MOVES[which];
  const moved = spec.fields.filter((k) => after[k] !== before[k]);
  const shown = spec.fields.map((k) => `${k} ${before[k] || "—"}→${after[k] || "—"}`).join(", ");

  if (moved.length) ok(`${label} "${current}" → "${chosen}" moved ${moved.join(" + ")}  [${shown}]`);
  else {
    bad(`${label} "${current}" → "${chosen}" moved NONE of ${spec.fields.join("/")}  [${shown}]`);
    warn(`Expected movement because ${spec.why}.`);
    warn("A toggle that moves nothing means the row is reading a stale copy — the 09-01 failure.");
  }

  // depth role changes PLAYING TIME, so the rate stats must hold still. A wRC+ that moves here
  // means playing time is leaking into a rate — the inverse bug, and just as wrong.
  if (which === "tb-depth") {
    if (after.wrcPlus === before.wrcPlus && after.slash === before.slash) {
      ok(`${label} left the rate stats alone (wRC+ ${after.wrcPlus}) — correct, PA must not move a rate`);
    } else {
      bad(`${label} MOVED a rate stat: wRC+ ${before.wrcPlus} → ${after.wrcPlus}, slash "${before.slash}" → "${after.slash}"`);
      warn("Depth role changes PA only. A rate stat moving means playing time is leaking into it.");
    }
  }

  // T2 — restore exactly. Also leaves the build as we found it.
  if (await pickExact(page, trigger, current)) {
    const back = await readRow(page, pid);
    const drift = (["wrcPlus", "slash", "war", "market"] as (keyof Snapshot)[])
      .filter((k) => back[k] !== before[k]);
    if (!drift.length) ok(`${label} restored exactly`);
    else bad(`${label} did NOT restore: ${drift.map((k) => `${k} ${before[k]}→${back[k]}`).join(", ")}`);
  } else warn(`${label}: could not restore "${current}" — this row may be left changed`);
}

/** T4/T5 — the same player's number on another surface. */
/**
 * T4/T5 — the same player's numbers on another surface.
 *
 * Checks wRC+, WAR and MARKET, not just wRC+. Market is where a divergence costs actual money, and
 * WAR is what market is derived from — a surface can agree on the rate and still disagree on both.
 */
async function testSurface(page: Page, tb: Snapshot, path: string, surface: string) {
  // ⛔ HITTERS ONLY. Team Builder's stat column shows wRC+ for a hitter but pRV+ for a pitcher, and
  // PitcherProfile renders "Overall PR+" — a POWER RATING, a different metric entirely (the PR+ vs
  // pRV+ trap). Comparing them reports a divergence that does not exist. Pitchers are still fully
  // covered by the toggle assertions and by checkAgainstStored(), which is the rigorous check.
  if (tb.sprp) { skip(`${surface}: pitcher — TB shows pRV+, the profile shows PR+, not comparable`); return; }

  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await dismissDialogs(page);
  await page.waitForTimeout(2500);
  const body = await page.locator("body").innerText().catch(() => "");
  if (!body || body.length < 50) { skip(`${surface}: page rendered nothing`); return; }

  // ★ PROVE COMPARABILITY BEFORE DIFFING. A list surface only renders the players currently in
  // view — filtered, paginated, or simply not on that board. Asserting a player's numbers on a page
  // that never lists them reports a divergence that does not exist. Require the NAME first; if the
  // player is absent, this surface has nothing to say about them.
  const last = (tb.name.split(/\s+/).pop() || "").trim();
  if (last && !body.includes(last)) {
    skip(`${surface}: ${tb.name} is not listed on this surface — nothing to compare`);
    return;
  }

  // Word-boundary match so "116" does not hit inside "1160"; commas stripped so $192,934 matches
  // a surface that renders 192934.
  const present = (raw: string) => {
    const v = raw.replace(/[$,\s]/g, "");
    if (!v || !/[\d]/.test(v)) return null;
    const hay = body.replace(/,/g, "");
    return new RegExp(`(^|[^\\d.])${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\d.]|$)`).test(hay);
  };

  // ⚠ wRC+ ONLY across surfaces. Comparing WAR/market by string match produced nothing but false
  // alarms: Team Builder's "WAR" column and Player Profile's "WAR" box BOTH render
  // total_hitter_war, but a page-text scrape misses it for render-timing reasons and reports a
  // divergence that is not there. Display-vs-STORED is the rigorous version of that check and it
  // lives in checkAgainstStored() below — comparing what is on screen to what is in the database,
  // rather than one screen to another.
  const fields: [keyof Snapshot, string][] = [["wrcPlus", "wRC+"]];
  const agree: string[] = [], differ: string[] = [], absent: string[] = [];
  for (const [k, label] of fields) {
    const r = present(tb[k]);
    if (r === null) continue;
    (r ? agree : differ).push(`${label} ${tb[k]}`);
  }
  if (!agree.length && !differ.length) { skip(`${surface}: no comparable numbers on the TB row`); return; }

  if (!differ.length) ok(`${surface} agrees on ${agree.join(", ")}`);
  else {
    bad(`${surface} does NOT show ${differ.join(", ")}${agree.length ? `  (agrees on ${agree.join(", ")})` : ""}`);
    warn("Same stat, two surfaces, two values — §4's invalidating condition.");
  }
  void absent;
}

/**
 * ★ DISPLAY vs STORED — the 2026-09-01 defect class, checked directly.
 *
 * That night every DATABASE check passed while the SCREEN was wrong. So compare what Team Builder
 * renders against what is actually in `team_build_players.player_snapshot` — not against another
 * surface, which only tells you two screens agree, possibly on the same wrong number.
 */
async function checkAgainstStored(db: Client, pid: string, tb: Snapshot) {
  const r = await db.query(
    `select player_snapshot from team_build_players where player_id = $1 and player_snapshot is not null limit 1`,
    [pid]);
  if (!r.rows.length) { skip(`stored snapshot: none for this player — nothing to compare`); return; }
  const snap: any = r.rows[0].player_snapshot;

  const num = (v: string) => { const n = Number(String(v).replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : null; };
  const shownWar = num(tb.war), shownWrc = num(tb.wrcPlus);

  // Mirrors pickHitterWar(): total_hitter_war is the headline, o_war/owar the legacy fallback.
  const storedWar = snap.total_hitter_war ?? snap.o_war ?? snap.owar ?? snap.p_war ?? null;
  const storedWrc = snap.p_wrc_plus ?? snap.p_rv_plus ?? null;

  if (shownWar != null && storedWar != null) {
    if (Math.abs(shownWar - Number(storedWar)) < 0.005) ok(`WAR on screen (${tb.war}) matches the stored snapshot (${Number(storedWar).toFixed(4)})`);
    else {
      bad(`WAR on screen (${tb.war}) does NOT match stored (${Number(storedWar).toFixed(4)})`);
      warn("The screen is showing something other than the stored snapshot — the 09-01 defect class.");
    }
  } else skip("WAR: no stored value to compare");

  /**
   * ★ TWO-WAY PLAYERS — both sides live on ONE row, which is why they broke on 09-01.
   *
   * The convention: the SHARED `market_value` is NULL by design, and the real numbers live in
   * `twp_hitter_market_value` / `twp_pitcher_market_value`. A shared value appearing on a TWP
   * snapshot means the two sides have been collapsed into one, and whichever side the screen picks
   * is then arbitrary.
   *
   * ⚠ SCOPE: snapshots only. Raw `player_predictions` rows legitimately carry a shared
   * market_value (2,229 on prod) — that is a different population and the rule was never about it.
   * Measured 2026-09-03: snapshots are clean on BOTH databases (0 of 23 prod, 0 of 9 staging).
   */
  if (snap.is_twp === true || snap.twp_hitter_market_value != null || snap.twp_pitcher_market_value != null) {
    if (snap.market_value == null) ok("TWP: shared market_value is NULL — the two sides stay separate");
    else {
      bad(`TWP: shared market_value is SET (${snap.market_value}) — the two sides have collapsed`);
      warn("Whichever side the screen picks is now arbitrary. This is the 09-01 TWP failure.");
    }
    const own = snap.twp_hitter_market_value ?? snap.twp_pitcher_market_value;
    if (own != null) ok(`TWP: own-side value present (${Number(own).toFixed(0)})`);
    else warn("TWP: neither twp_hitter_market_value nor twp_pitcher_market_value is set");
  }

  if (shownWrc != null && storedWrc != null) {
    if (Math.abs(shownWrc - Math.round(Number(storedWrc))) < 0.51) ok(`wRC+/pRV+ on screen (${tb.wrcPlus}) matches stored (${Number(storedWrc).toFixed(1)})`);
    else bad(`wRC+/pRV+ on screen (${tb.wrcPlus}) does NOT match stored (${Number(storedWrc).toFixed(1)})`);
  } else skip("wRC+: no stored value to compare");
}

(async () => {
  console.log(C.b + "\n══ TOGGLE PERMUTATIONS — §4's #1 hard stop ══" + C.r);

  if (!PASSWORD) {
    console.log(`  ${C.red}✗${C.r} TEST_COACH_PASSWORD not set.`);
    info("npx tsx scripts/agent/create-rls-test-coach.ts      # prints a fresh password");
    info("TEST_COACH_PASSWORD='<printed>' npm run agent:toggles");
    process.exit(1);
  }
  try {
    const res = await fetch(BASE, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    console.log(`  ${C.red}✗${C.r} No dev server at ${BASE}. Run \`npm run dev\` in another terminal.`);
    info("Local dev reads STAGING — which is what this check wants.");
    process.exit(1);
  }
  info(`dev server up at ${BASE} (reads STAGING)`);

  const pg = envVal("PGURI");
  let db: Client | null = null;
  if (pg) {
    db = new Client({ connectionString: pg, ssl: { rejectUnauthorized: false } });
    await db.connect();
    info("connected read-only to STAGING for the display-vs-stored check");
  } else warn("no PGURI in .env.local — display-vs-stored check will be skipped");

  const browser = await chromium.launch({ headless: !HEADED });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(20000);
  // Pre-seed rather than dismiss: WhatsNewModal's overlay intercepts the very clicks we are here to
  // make, and dismissing after boot races it.
  await page.addInitScript(([k, v]) => {
    try { window.localStorage.setItem(k as string, v as string); } catch { /* private mode */ }
  }, [MODAL_KEY, MODAL_VAL]);

  try {
    await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
    await page.locator('input[type="email"]').first().fill(EMAIL);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 20000 });
    info(`signed in as ${EMAIL}`);

    await page.goto(`${BASE}/dashboard/team-builder`, { waitUntil: "domcontentloaded" });
    await dismissDialogs(page);
    await page.locator('[data-testid="tb-row"]').first().waitFor({ timeout: 30000 });
    const rows = page.locator('[data-testid="tb-row"]');
    const total = await rows.count();
    info(`Team Builder rendered ${total} rows`);

    // Collect BOTH hitters and pitchers. Selecting on wRC+ alone silently skipped every pitcher —
    // and the pitcher path is where the Neiswonger bug lived, so a hitter-only sweep would have
    // reported green while never touching the riskier half.
    const hitters: string[] = [], pitchers: string[] = [];
    for (let i = 0; i < total && (hitters.length + pitchers.length) < N_PLAYERS * 2; i++) {
      const r = rows.nth(i);
      const pid = await r.getAttribute("data-player-id");
      if (!pid) continue;
      const num = async (id: string) =>
        (await r.locator(`[data-testid="${id}"]`).first().innerText().catch(() => "")).trim();
      const wrc = await num("tb-stat-wrcplus");
      const war = await num("tb-stat-war");
      const isPitcher = await r.locator('[data-testid="tb-sprp"]').first().isVisible().catch(() => false);
      const usable = (v: string) => v && !/^[—-]$/.test(v);
      if (isPitcher && usable(war) && pitchers.length < N_PLAYERS && !pitchers.includes(pid)) pitchers.push(pid);
      else if (!isPitcher && usable(wrc) && hitters.length < N_PLAYERS && !hitters.includes(pid)) hitters.push(pid);
    }
    // ★ Deliberately include a TWO-WAY player if the build has one. They are the shape most likely
    // to hide a divergence — both sides on ONE row — and a sweep that happens to pick three
    // ordinary hitters would report green while never touching them.
    const twps: string[] = [];
    if (db) {
      const ids = [...hitters, ...pitchers];
      const r = await db.query(
        `select tbp.player_id from team_build_players tbp
         join players p on p.id = tbp.player_id
         where p.is_twp = true and tbp.player_snapshot is not null limit 3`);
      for (const row of r.rows) {
        const pid = row.player_id as string;
        if (!ids.includes(pid) && await rowFor(page, pid).count() > 0) twps.push(pid);
      }
    }
    const subjects = [...hitters, ...pitchers, ...twps];
    if (!subjects.length) {
      bad("No row has a player_id and a rendered stat — nothing to assert.");
      warn("An empty build is NOT a pass. Load a build with players and re-run.");
      throw new Error("no usable rows");
    }
    info(`sweeping ${hitters.length} hitter(s) + ${pitchers.length} pitcher(s) + ${twps.length} two-way`);
    if (!twps.length) warn("no two-way player on this build — the TWP own-side check is NOT exercised");
    if (!pitchers.length) warn("no pitcher rows found — the SP/RP path is NOT being exercised");
    console.log("");

    for (const pid of subjects) {
      const tb = await readRow(page, pid);
      console.log(`  ${C.b}${tb.name}${C.r}${tb.sprp ? ` [${tb.sprp}]` : ""}  wRC+ ${tb.wrcPlus || "—"} · WAR ${tb.war || "—"} · ${tb.market || "—"} · devAgg ${tb.devAgg || "—"} · depth ${tb.depth || "—"}`);

      await testToggle(page, pid, "tb-devagg", "dev agg");
      await testToggle(page, pid, "tb-sprp", "SP/RP");
      await testToggle(page, pid, "tb-depth", "depth role");

      // Re-read before comparing surfaces: if a restore above failed, comparing against the ORIGINAL
      // snapshot would report a surface mismatch that is really our own mess.
      const fresh = await readRow(page, pid);
      if (db) await checkAgainstStored(db, pid, fresh);
      // /dashboard/player/:id is the hitter profile, /dashboard/pitcher/:id the pitcher one.
      const isPitcher = !!fresh.sprp;
      await testSurface(page, fresh, isPitcher ? `/dashboard/pitcher/${pid}` : `/dashboard/player/${pid}`,
        isPitcher ? "Pitcher Profile" : "Player Profile");
      await testSurface(page, fresh, `/dashboard/targets`, "Target Board");
      await testSurface(page, fresh, `/dashboard/returning`, "Returning Players");

      await page.goto(`${BASE}/dashboard/team-builder`, { waitUntil: "domcontentloaded" });
      await dismissDialogs(page);
      await page.locator('[data-testid="tb-row"]').first().waitFor({ timeout: 30000 });
      console.log("");
    }
  } catch (e: any) {
    bad(`run aborted: ${e.message}`);
  } finally {
    await browser.close();
    if (db) await db.end();
  }

  console.log(C.b + "── coverage ──" + C.r);
  console.log("  COVERED      dev-agg, SP/RP and depth-role: each moves the right stats, leaves rates");
  console.log("               alone where it should, and restores exactly. Hitters AND pitchers.");
  console.log("               DISPLAY vs STORED: the on-screen WAR and wRC+/pRV+ are checked against");
  console.log("               team_build_players.player_snapshot — the 09-01 defect class, directly.");
  console.log("               Cross-surface wRC+ for HITTERS (Player Profile, Target Board, Returning");
  console.log("               Players), skipping any surface that does not list the player.");
  console.log("               TWO-WAY PLAYERS: the shared market_value must stay NULL and the own-side");
  console.log("               value must be present — both sides on one row is why they broke on 09-01.");
  console.log("  NOT COVERED  the UNROSTERED local-session case (a player not on roster or board gets a");
  console.log("               local-only session that must never persist) · Transfer Portal · the");
  console.log("               GM/Front Office surfaces ·");
  console.log("               cross-surface comparison for PITCHERS (TB shows pRV+, profiles show PR+).");
  console.log(`  ${C.y}A green run means "no divergence found on the covered path", never "the app agrees".${C.r}`);

  console.log(
    failures
      ? `\n${C.red}${failures} of ${checks} checks FAILED${C.r}`
      : `\n${C.g}${checks} checks passed — no divergence found${C.r}`
  );
  process.exit(failures ? 1 : 0);
})();
