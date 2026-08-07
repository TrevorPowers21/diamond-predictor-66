/**
 * Build-version check — reload a stale session onto the current deploy.
 *
 * THE GAP THIS FILLS: the only thing that refreshed a coach's session was
 * dismissing the What's New modal, which fires once per hand-written release
 * entry. Deploys happen far more often than release notes get written, so a
 * coach could sit on a build from several deploys ago — and in practice nobody
 * logs out, so the session never naturally restarts.
 *
 * HOW IT DETECTS A NEW BUILD: Vite content-hashes the entry bundle, so the
 * script filename in index.html changes on every deploy. Fetching index.html
 * with cache: "no-store" and comparing its entry filename against the one the
 * running page loaded is enough — no build-time version stamp, no config
 * change, no extra endpoint.
 *
 * WHAT IT DELIBERATELY WON'T DO: reload on a network error (a coach on bad wifi
 * would get reloaded repeatedly for no reason), reload twice in a row, or
 * reload while a dialog is open (someone mid-edit loses their work).
 */

const RELOAD_KEY = "rstr:version-reload-attempted";

/** Extract the entry module's src from an index.html string. Pure — unit tested. */
export function parseEntrySrc(html: string): string | null {
  // Vite emits a single <script type="module" ... src="/assets/index-HASH.js">.
  // Attribute order is not guaranteed, so match the tag then pull the src.
  const tags = html.match(/<script\b[^>]*\btype=["']module["'][^>]*>/gi);
  if (!tags) return null;
  for (const tag of tags) {
    const src = tag.match(/\bsrc=["']([^"']+)["']/i);
    if (src) return src[1];
  }
  return null;
}

/** The entry src the currently-running page was loaded with. */
export function getRunningEntrySrc(): string | null {
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
  return el?.getAttribute("src") ?? null;
}

function readFlag(): boolean {
  try {
    return sessionStorage.getItem(RELOAD_KEY) === "1";
  } catch {
    return false;
  }
}

function writeFlag(value: boolean): void {
  try {
    if (value) sessionStorage.setItem(RELOAD_KEY, "1");
    else sessionStorage.removeItem(RELOAD_KEY);
  } catch {
    /* private mode — the guard must never break the page it protects */
  }
}

/** True when a modal/dialog is open, so a reload would discard in-progress work. */
function isBusy(): boolean {
  return document.querySelector('[role="dialog"][data-state="open"]') !== null;
}

/**
 * Compare the deployed build against the running one and reload if they differ.
 * Returns true if a reload was triggered. Safe to call repeatedly.
 */
export async function reloadIfNewBuild(): Promise<boolean> {
  // Dev serves an unhashed entry (/src/main.tsx), so there is nothing to compare.
  if (import.meta.env.DEV) return false;
  if (readFlag() || isBusy()) return false;

  const running = getRunningEntrySrc();
  if (!running) return false;

  let deployed: string | null = null;
  try {
    const res = await fetch("/", { cache: "no-store" });
    if (!res.ok) return false;
    deployed = parseEntrySrc(await res.text());
  } catch {
    // Offline or blocked. Not a new build — do nothing.
    return false;
  }

  if (!deployed || deployed === running) {
    writeFlag(false);
    return false;
  }

  writeFlag(true);
  window.location.reload();
  return true;
}

/** Clear the loop guard once a session has run for a while on the current build. */
export function markBuildHealthy(): void {
  writeFlag(false);
}
