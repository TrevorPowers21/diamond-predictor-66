import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Bump this when a new release ships. Users whose stored seen-version is
 * older than this will see the modal on next dashboard load. Format:
 * `YYYY-MM-DD` keeps the version stable and self-documenting.
 */
const CURRENT_RELEASE = "2026-05-18";
const STORAGE_KEY = "rstr_iq_whats_new_seen";

type Feature = {
  title: string;
  tagline: string;
  details: string[];
};

const FEATURES: Feature[] = [
  {
    title: "Full JUCO Player Upload + Transfer Portal",
    tagline:
      "Every qualified NJCAA D1 hitter and pitcher is now live in RSTR IQ, fully wired into the Transfer Portal simulator.",
    details: [
      "Run JUCO-to-D1 transfer projections for any player, any destination — calibrated weights, district-specific competition, JUCO-specific risk model.",
      "New JUCO subtab on the Player Dashboard with leaderboards, district filter, and target board.",
      "Dedicated JUCO player + pitcher profile pages with 2026 actuals and scouting grades.",
    ],
  },
  {
    title: "Program Analytics",
    tagline:
      "A full Team Builder analytics view that grades your roster position-by-position, tier-by-tier — broken out by lineup, rotation, and bullpen WAR, with championship benchmarks alongside.",
    details: [
      "Year-over-year compare and championship benchmark cards quantify exactly where the build stands.",
      "Pitcher and hitter tier labels reworked — a 1.8 pWAR starter now reads \"Contributor,\" not \"Below.\"",
      "2026 comparison rolling in once the regular season is fully locked and conference champions are confirmed.",
    ],
  },
];

const WHAT_ELSE: string[] = [
  "Team Builder: bench-everywhere default fixed — tiers now distribute correctly.",
  "Team Builder: depth-chart class colors read the current class year (R-JR shows as JR, etc.).",
  "Team Builder: redundant \"Class Adj\" column removed (equation still applies).",
  "Risk Assessment: Stuff+ added as a factor; pitcher Skillset falls back to K/9 · BB/9 · HR/9 when TrackMan is missing.",
  "Data: DOB and class year columns added to the master tables (D1 backfill comes with 2026 final stats).",
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

  // Format: "MAY 18, 2026" — matches the Stitch design's display formatting
  // (Oswald uppercase tracked headline). Pulled from CURRENT_RELEASE so the
  // version bump stays in one place.
  const displayDate = (() => {
    const [y, m, d] = CURRENT_RELEASE.split("-");
    const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    return `${months[Number(m) - 1]} ${Number(d)}, ${y}`;
  })();

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) dismiss(); }}>
      <DialogContent
        className="max-w-[640px] max-h-[80vh] overflow-y-auto p-0 border-l-[3px] border-l-[#D4AF37] bg-[#070e1f] text-slate-100"
      >
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-md bg-[#D4AF37]/10 border border-[#D4AF37]/30">
              <Sparkles className="w-4 h-4 text-[#D4AF37]" />
            </div>
            <DialogTitle
              className="text-[#D4AF37] text-[18px] font-semibold uppercase tracking-[0.08em] leading-6"
              style={{ fontFamily: "'Oswald', sans-serif" }}
            >
              What&apos;s New — {displayDate}
            </DialogTitle>
          </div>
          <p className="text-[13px] text-slate-400 mt-2 ml-[42px]">
            Changes since the last beta release.
          </p>
        </DialogHeader>

        <div className="px-6 py-5 space-y-6">
          {FEATURES.map((feature, fi) => (
            <div
              key={feature.title}
              className="rounded-md border border-white/10 border-l-[3px] border-l-[#D4AF37] bg-white/[0.02] p-4"
            >
              <div className="flex items-baseline gap-2 mb-1.5">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#D4AF37]">
                  New · {fi === 0 ? "Headline" : "Feature"}
                </span>
              </div>
              <h3
                className="text-[18px] font-semibold uppercase tracking-[0.04em] text-white mb-2 leading-[1.25]"
                style={{ fontFamily: "'Oswald', sans-serif" }}
              >
                {feature.title}
              </h3>
              <p className="text-[14px] leading-[1.55] text-slate-200 mb-3">
                {feature.tagline}
              </p>
              <ul className="space-y-1.5 text-[13px] leading-[1.55] text-slate-300">
                {feature.details.map((item, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="text-[#D4AF37] mt-[7px] shrink-0 inline-block w-1 h-1 rounded-full bg-[#D4AF37]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* "What else" — smaller items, no card chrome, just a compact list */}
          <div>
            <h4
              className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400 mb-2"
              style={{ fontFamily: "'Oswald', sans-serif" }}
            >
              What else
            </h4>
            <ul className="space-y-1 text-[12.5px] leading-[1.5] text-slate-400">
              {WHAT_ELSE.map((item, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-slate-500 shrink-0">·</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <DialogFooter className="px-6 pb-5 pt-2 border-t border-white/10">
          <Button
            onClick={dismiss}
            className="w-[120px] bg-[#D4AF37] text-black hover:bg-[#A08820] font-medium"
          >
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
