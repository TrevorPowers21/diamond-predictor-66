import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Bump this when a new release ships. Users whose stored seen-version is
 * older than this will see the modal on next dashboard load. Format:
 * `YYYY-MM-DD` keeps the version stable and self-documenting.
 */
const CURRENT_RELEASE = "2026-05-18";
const STORAGE_KEY = "rstr_iq_whats_new_seen";

type Section = {
  title: string;
  items: string[];
};

const SECTIONS: Section[] = [
  {
    title: "JUCO support",
    items: [
      "JUCO subtab on the Player Dashboard with leaderboards for qualified hitters (PA ≥ 75) and pitchers (IP ≥ 20) — district filter, position chips, target board column.",
      "Transfer Portal simulator now has a JUCO division toggle, JUCO-specific risk cards, and a 5-factor risk model tailored to JUCO data reliability.",
      "JUCO player + pitcher profiles show 2026 actuals card and the same scouting grade tiles as D1.",
      "163 Presto-only JUCO pitchers added so the simulator covers every qualified arm.",
    ],
  },
  {
    title: "Team Builder",
    items: [
      "JUCO portal targets land on the target board with full transfer projections (matches simulator math exactly).",
      "Bench-everywhere bug fixed — returner tiers now distribute correctly across cornerstone / everyday / platoon / utility / bench.",
      "Depth chart class colors now read class_year directly (so R-JR colors as JR, R-SO as SO, etc.) instead of inferring from the transition code.",
      "\"Class Adj\" column removed from returner + portal tables (equation still applies internally).",
    ],
  },
  {
    title: "Program Analytics",
    items: [
      "Pitcher tier labels reworked — a 1.8 pWAR SP now reads \"Contributor\" instead of \"Below\". New tiers: Elite / Starter / Contributor / Below.",
      "Hitter tier rows use the same updated framing.",
    ],
  },
  {
    title: "Risk assessment",
    items: [
      "Stuff+ factor added to both hitter and pitcher risk cards.",
      "Pitcher Skillset falls back to K/9, BB/9, HR/9 when TrackMan data is missing (instead of marking the whole card as unreliable).",
      "Stuff+ shows a small bar for elite-but-untracked arms to differentiate from N/A.",
    ],
  },
  {
    title: "Data",
    items: [
      "DOB and class_year columns added to Hitter Master + Pitching Master (JUCO populated; D1 backfill coming with 2026 final stat upload).",
    ],
  },
];

export function WhatsNewModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      const seen = localStorage.getItem(STORAGE_KEY);
      if (seen !== CURRENT_RELEASE) setOpen(true);
    } catch {
      // localStorage unavailable (private mode, SSR, etc.) — silently skip.
    }
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, CURRENT_RELEASE);
    } catch {
      // ignore
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) dismiss(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[#D4AF37] text-xl" style={{ fontFamily: "'Oswald', sans-serif" }}>
            What&apos;s New — {CURRENT_RELEASE}
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Changes since the last beta release.
          </p>
        </DialogHeader>
        <div className="space-y-5 mt-2">
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#D4AF37] mb-2">
                {section.title}
              </h3>
              <ul className="space-y-1.5 text-sm">
                {section.items.map((item, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-[#D4AF37] mt-1.5 shrink-0">·</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <DialogFooter className="mt-4">
          <Button onClick={dismiss} className="bg-[#D4AF37] text-black hover:bg-[#A08820]">
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
