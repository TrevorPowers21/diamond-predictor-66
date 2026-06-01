/**
 * Verified Athletics portal CSV fetcher.
 *
 * Headless Playwright run that loads a persistent browser profile (so the
 * VA login session carries across runs), navigates to /transfers, clicks
 * the Export CSV button, and saves the download to ~/RSTR IQ Data/inbox/.
 *
 * First-time setup:
 *   npx tsx scripts/fetch_va_portal.ts --setup
 *
 * That opens a real Chromium window with the persistent profile attached.
 * Log in once, close the window. Cookies stay in the profile.
 *
 * Headless run (used by the launchd job):
 *   npx tsx scripts/fetch_va_portal.ts
 *
 * If the session expires (~30 days), the headless run exits non-zero
 * with code 2 — the launchd wrapper surfaces that as a "needs re-login"
 * notification so you can run --setup again.
 *
 * Exit codes:
 *   0 — CSV downloaded successfully
 *   1 — generic error (network, page changed, etc.)
 *   2 — session expired (redirected to login)
 */
import { chromium, type BrowserContext } from "playwright";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, renameSync } from "node:fs";

const VA_URL = "https://app.verifiedathletics.com/transfers";
const PROFILE_DIR = join(homedir(), ".rstr_iq", "va-profile");
const INBOX_DIR = join(homedir(), "RSTR IQ Data", "inbox");
const SETUP = process.argv.includes("--setup");

function todayStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}-${h}${min}`;
}

async function ensureLoggedIn(ctx: BrowserContext): Promise<"ok" | "needs_login"> {
  const page = await ctx.newPage();
  await page.goto(VA_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  // Give the SPA a beat to redirect to login if the session died.
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  const url = page.url();
  await page.close();
  if (/login|signin|auth/i.test(url)) return "needs_login";
  return "ok";
}

async function downloadCsv(ctx: BrowserContext): Promise<string> {
  const page = await ctx.newPage();
  await page.goto(VA_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

  // Give the SPA's button a moment to mount after data loads.
  await page.waitForTimeout(2000);

  // VA renders an Ant Design <button> with text "Export". Direct text
  // selector is more reliable than getByRole here.
  const exportBtn = page.locator('button:has-text("Export")').first();
  try {
    await exportBtn.waitFor({ state: "visible", timeout: 30000 });
  } catch {
    await page.close();
    throw new Error("Could not find Export button on /transfers — VA UI may have changed");
  }

  const downloadPromise = page.waitForEvent("download", { timeout: 60000 });
  await exportBtn.click();

  const download = await downloadPromise;
  const stamp = todayStamp();
  const filename = `transfers_${stamp}.csv`;
  const destPath = join(INBOX_DIR, filename);
  mkdirSync(INBOX_DIR, { recursive: true });
  await download.saveAs(destPath);
  await page.close();
  return destPath;
}

async function main() {
  mkdirSync(PROFILE_DIR, { recursive: true });

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: !SETUP,
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
    args: [
      // Quiet a few automation tells. Doesn't fully defeat detection but is
      // sufficient for vendors that don't actively bot-block.
      "--disable-blink-features=AutomationControlled",
    ],
  });

  if (SETUP) {
    console.log("Opening a real browser with the persistent profile.");
    console.log("Log in to Verified Athletics, then close the browser window.");
    console.log("Your session will persist for future headless runs.");
    const page = await ctx.newPage();
    await page.goto(VA_URL);
    await ctx.waitForEvent("close", { timeout: 0 });
    return;
  }

  const status = await ensureLoggedIn(ctx);
  if (status === "needs_login") {
    console.error("VA session expired. Re-run with --setup to log in.");
    await ctx.close();
    process.exit(2);
  }

  try {
    const path = await downloadCsv(ctx);
    console.log(`Saved ${path}`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    await ctx.close();
    process.exit(1);
  }
  await ctx.close();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
