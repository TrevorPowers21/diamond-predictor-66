import { lazy, type ComponentType } from "react";

/**
 * Drop-in replacement for React.lazy that survives a deploy.
 *
 * THE PROBLEM: Vite content-hashes every chunk, so each deploy renames all of
 * them and deletes the previous set. A tab that was already open is still
 * running the old index.html, which holds the old chunk map — so the moment the
 * user navigates to a code-split route, the browser requests a filename that no
 * longer exists. Vercel's SPA fallback answers with index.html and a 200, the
 * browser tries to parse HTML as an ES module, and React Router surfaces
 * "Failed to fetch dynamically imported module".
 *
 * It only bites on navigation, never on first paint, so the app looks healthy
 * until someone clicks into a lazy route — then every lazy route fails at once.
 *
 * THE FIX: one reload. Fetching the current index.html gets the current chunk
 * map and the navigation proceeds normally.
 *
 * Guarded against a reload loop via sessionStorage: if we've already reloaded
 * once and the import still fails, the error is real (offline, chunk genuinely
 * missing, CDN fault) and gets rethrown so the UI can show it rather than
 * refreshing forever. The flag clears on any successful load.
 *
 * Vercel Skew Protection is the primary defence — it keeps prior deployments'
 * assets reachable so old tabs keep working. This is the backstop for when
 * skew protection has aged out or is unavailable.
 */

const RELOAD_KEY = "rstr:chunk-reload-attempted";

// sessionStorage throws in some privacy modes; never let the guard itself break
// the page it is protecting.
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
    /* no-op */
  }
}

export function lazyWithReload<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      const mod = await factory();
      writeFlag(false);
      return mod;
    } catch (err) {
      if (readFlag()) throw err;

      writeFlag(true);
      window.location.reload();

      // The reload takes over; this promise intentionally never settles so React
      // does not render an error state during the moment before navigation.
      return new Promise<{ default: T }>(() => {});
    }
  });
}
