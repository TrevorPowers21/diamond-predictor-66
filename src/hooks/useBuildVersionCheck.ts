import { useEffect, useRef } from "react";
import { reloadIfNewBuild, markBuildHealthy } from "@/lib/buildVersion";

/** How long a tab must be hidden before returning to it counts as "coming back fresh". */
const IDLE_MS = 30 * 60 * 1000;

/** Time on the current build before we consider it good and clear the loop guard. */
const HEALTHY_MS = 60 * 1000;

/**
 * Reloads a stale session onto the current deploy at two moments:
 *
 *   1. On mount — which covers signing in, since login lands on the dashboard.
 *   2. On returning to a tab that has been hidden for 30+ minutes.
 *
 * The idle threshold is the point: checking on every tab focus would reload
 * someone who alt-tabbed to Excel for ten seconds. Thirty minutes means the
 * coach genuinely left and is coming back to it, which is the case that goes
 * stale — in practice nobody signs out, so a session can run for days across
 * several deploys.
 */
export function useBuildVersionCheck(): void {
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    void reloadIfNewBuild();

    // Surviving a minute on this build means it loaded fine; clear the guard so
    // a genuine new deploy later in the session can still trigger a reload.
    const healthy = window.setTimeout(markBuildHealthy, HEALTHY_MS);

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
        return;
      }
      const since = hiddenAt.current;
      hiddenAt.current = null;
      if (since !== null && Date.now() - since >= IDLE_MS) {
        void reloadIfNewBuild();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(healthy);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}
