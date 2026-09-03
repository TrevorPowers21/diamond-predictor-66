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

const EMAIL = process.env.TEST_COACH_EMAIL || "rls-test-coach@rstriq.test";
const PASSWORD = process.env.TEST_COACH_PASSWORD;

type Snapshot = {
  name: string; slash: string; wrcPlus: string; market: string; war: string; devAgg: string; depth: string;
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
const MOVES: Record<"tb-devagg" | "tb-depth", { fields: (keyof Snapshot)[]; why: string }> = {
  "tb-devagg": { fields: ["wrcPlus", "slash", "war", "market"], why: "dev agg changes the projection, so rate stats move" },
  "tb-depth":  { fields: ["war", "market"],                     why: "depth changes PA only; wRC+ is a rate and must NOT move" },
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
async function testToggle(page: Page, pid: string, which: "tb-devagg" | "tb-depth", label: string) {
  const before = await readRow(page, pid);
  const current = which === "tb-devagg" ? before.devAgg : before.depth;
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
async function testSurface(page: Page, tb: Snapshot, path: string, surface: string) {
  const wrc = tb.wrcPlus.replace(/[^\d.]/g, "");
  if (!wrc) { skip(`${surface}: no numeric wRC+ on the Team Builder row to compare`); return; }
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await dismissDialogs(page);
  await page.waitForTimeout(2500);
  const body = await page.locator("body").innerText().catch(() => "");
  if (!body || body.length < 50) { skip(`${surface}: page rendered nothing`); return; }
  // Word-boundary match so "116" does not match inside "1160".
  if (new RegExp(`(^|[^\\d.])${wrc}([^\\d.]|$)`).test(body)) ok(`${surface} shows the same wRC+ (${wrc})`);
  else {
    bad(`${surface} does NOT show Team Builder's wRC+ (${wrc})`);
    warn("Same stat, two surfaces, two values — §4's invalidating condition.");
  }
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

    const subjects: string[] = [];
    for (let i = 0; i < total && subjects.length < N_PLAYERS; i++) {
      const r = rows.nth(i);
      const pid = await r.getAttribute("data-player-id");
      const wrc = (await r.locator('[data-testid="tb-stat-wrcplus"]').first().innerText().catch(() => "")).trim();
      if (pid && wrc && !/^[—-]$/.test(wrc) && !subjects.includes(pid)) subjects.push(pid);
    }
    if (!subjects.length) {
      bad("No row has both a player_id and a rendered wRC+ — nothing to assert.");
      warn("An empty build is NOT a pass. Load a build with players and re-run.");
      throw new Error("no usable rows");
    }
    info(`sweeping ${subjects.length} player(s)\n`);

    for (const pid of subjects) {
      const tb = await readRow(page, pid);
      console.log(`  ${C.b}${tb.name}${C.r}  wRC+ ${tb.wrcPlus} · WAR ${tb.war || "—"} · ${tb.market || "—"} · devAgg ${tb.devAgg || "—"} · depth ${tb.depth || "—"}`);

      await testToggle(page, pid, "tb-devagg", "dev agg");
      await testToggle(page, pid, "tb-depth", "depth role");

      // Re-read before comparing surfaces: if a restore above failed, comparing against the ORIGINAL
      // snapshot would report a surface mismatch that is really our own mess.
      const fresh = await readRow(page, pid);
      await testSurface(page, fresh, `/dashboard/player/${pid}`, "Player Profile");
      await testSurface(page, fresh, `/dashboard/targets`, "Target Board");

      await page.goto(`${BASE}/dashboard/team-builder`, { waitUntil: "domcontentloaded" });
      await dismissDialogs(page);
      await page.locator('[data-testid="tb-row"]').first().waitFor({ timeout: 30000 });
      console.log("");
    }
  } catch (e: any) {
    bad(`run aborted: ${e.message}`);
  } finally {
    await browser.close();
  }

  console.log(C.b + "── coverage ──" + C.r);
  console.log("  COVERED      dev-agg and depth-role move + restore; Team Builder vs Player Profile");
  console.log("               and Target Board; swept across multiple players.");
  console.log("  NOT COVERED  SP/RP on pitcher rows · the UNROSTERED local-session case (a player not");
  console.log("               on roster or board gets a local-only session that must never persist) ·");
  console.log("               Returning Players and Transfer Portal · whether surfaces agree on");
  console.log("               MARKET VALUE and WAR, not just wRC+.");
  console.log(`  ${C.y}A green run means "no divergence found on the covered path", never "the app agrees".${C.r}`);

  console.log(
    failures
      ? `\n${C.red}${failures} of ${checks} checks FAILED${C.r}`
      : `\n${C.g}${checks} checks passed — no divergence found${C.r}`
  );
  process.exit(failures ? 1 : 0);
})();
