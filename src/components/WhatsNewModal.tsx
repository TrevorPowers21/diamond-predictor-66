import { useEffect, useState } from "react";
import { Sparkles, ArrowLeft } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "rstr_iq_whats_new_seen_v2";

type Feature = {
  title: string;
  tagline: string;
  details: string[];
};

type Release = {
  date: string;       // YYYY-MM-DD
  headline: string;   // One-line summary used in the history view
  features: Feature[];
  whatElse: string[];
};

const RELEASES: Release[] = [
  {
    date: "2026-05-20",
    headline: "Handedness-aware park factors, daily portal updates, sharper projections",
    features: [
      {
        title: "Park Factors by Handedness",
        tagline:
          "Transfer projections now account for how a park actually plays for left-handed vs right-handed hitters, not just the team's overall park factor. A LHB pulling to a pull-friendly right field gets credit for that fit; an RHB doesn't.",
        details: [
          "Every D1 park factor refreshed against the 2026 NCAA baseline using the standard methodology: your hitters at home plus opponents at home, averaged to remove team-quality bias.",
          "LHB hitters apply LHB-specific AVG, OBP, and ISO factors. RHB hitters apply RHB factors. Switch hitters use the combined.",
          "Wired into the Transfer Portal simulator, Team Builder transfer projections, target board adds, and player compare. Every destination move now uses the right handedness.",
        ],
      },
      {
        title: "Daily Portal Updates",
        tagline:
          "Portal entries flow into RSTR IQ daily. Players who enter, commit, or withdraw update on their profile as it happens, so your board reflects today's reality.",
        details: [
          "Every D1 portal entry gets a live status badge and updated commit destination on the profile.",
          "Contact info on the player profile: phone, email, GPA, athletic aid, and roster link, all in one tap.",
          "Players who drop out of the portal are flagged automatically so your board stays current.",
        ],
      },
      {
        title: "Portal Status on Every Row",
        tagline:
          "Color-coded chips on the Player Dashboard make portal entries obvious at a scan. Same visual language as the profile-page badge so it reads the same everywhere.",
        details: [
          "New \"In Portal\" filter on the Player Dashboard. Flip it on and you only see portal players, including mid-season entries that don't meet the usual playing-time threshold.",
          "PRT, CMT, WCH, and WDN chips sit next to the position so you can spot portal status while sorting by any stat.",
          "Filter saves alongside Class, Bats, and Conference so you can stay locked in on a slice.",
        ],
      },
      {
        title: "Recent Portal Activity Feed",
        tagline:
          "Bigger, scrollable feed on your overview that surfaces the portal news that matters to you first.",
        details: [
          "Players you're Following or have On Board show up at the top.",
          "Then top available portal players ranked by projected wRC+, with the pWRC+ number on each row so you can scan talent fast.",
          "Sorted newest portal entry first, and the feed holds for 48 hours so it doesn't clear the moment you click in.",
        ],
      },
    ],
    whatElse: [
      "Transfer Portal Simulator: JUCO projections now pull the right district context every time. Numbers line up with what you'd expect from a power-conference landing spot.",
      "Release History: a new \"See all releases\" link on this popup lets you scroll past updates by date in case you missed one.",
    ],
  },
  {
    date: "2026-05-19",
    headline: "JUCO live across the app, Program Analytics, 2026 final season locked",
    features: [
      {
        title: "JUCO Players Live Across the App",
        tagline:
          "Every qualified NJCAA D1 hitter and pitcher is in RSTR IQ and fully wired into the Transfer Portal simulator.",
        details: [
          "Run JUCO-to-D1 transfer projections for any player, any destination, with district-specific competition baked in.",
          "JUCO subtab on the Player Dashboard with leaderboards, district filter, and target board support.",
          "JUCO player and pitcher profile pages built out with 2026 actuals and scouting grades.",
        ],
      },
      {
        title: "Program Analytics",
        tagline:
          "A Team Builder analytics view that grades your roster position-by-position and tier-by-tier (lineup, rotation, bullpen) alongside championship benchmarks.",
        details: [
          "Year-over-year compare card shows where this build stands against your 2025 roster.",
          "Championship benchmark dropdown to compare against any 2025 conference champ or the national title team.",
          "Tier labels reworked so a 1.8 pWAR starter reads \"Contributor,\" not \"Below.\"",
        ],
      },
      {
        title: "2026 Final Regular Season Stats",
        tagline:
          "Final end-of-regular-season D1 refresh complete. Hitters, pitchers, conference aggregates, and Stuff+ are all the latest numbers.",
        details: [
          "Every projection, power rating, and scouting grade recomputed against the fresh season totals.",
          "2026 conference champions are flagged on Program Analytics for benchmarking next year's build.",
          "Postseason updates roll in after the College World Series wraps.",
        ],
      },
    ],
    whatElse: [
      "Team Builder: tier distribution fixed. Players now spread across cornerstone / everyday / platoon / utility / bench like you'd expect.",
      "Team Builder: depth-chart class colors read the player's current year (R-JR shows as JR).",
      "Team Builder: \"Class Adj\" column removed from the build table to clean up clutter.",
      "Risk Assessment: Stuff+ now factors into pitcher risk profiles when TrackMan data is available.",
    ],
  },
];

const CURRENT_RELEASE = RELEASES[0].date;

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}`;
}

/**
 * Bold the lead-in label (everything before the first colon) so list items
 * like "Team Builder: tiers now distribute correctly" read as
 * **Team Builder** + body.
 */
function formatWhatElse(line: string): React.ReactNode {
  const idx = line.indexOf(":");
  if (idx < 0) return line;
  const lead = line.slice(0, idx);
  const rest = line.slice(idx + 1);
  return (
    <>
      <span className="font-semibold text-[#D4AF37]">{lead}</span>
      <span className="text-slate-300">{rest}</span>
    </>
  );
}

export function WhatsNewModal() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"current" | "history">("current");

  useEffect(() => {
    try {
      const seen = localStorage.getItem(STORAGE_KEY);
      if (seen !== CURRENT_RELEASE) setOpen(true);
    } catch {
      // localStorage unavailable (private mode, SSR, etc.) silently skip.
    }
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, CURRENT_RELEASE);
    } catch {
      // ignore
    }
    setView("current");
    setOpen(false);
  };

  const currentRelease = RELEASES[0];
  const displayDate = formatDate(currentRelease.date);

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
              {view === "current" ? `What's New - ${displayDate}` : "Release History"}
            </DialogTitle>
          </div>
          <div className="flex items-center gap-3 mt-2 ml-[42px]">
            {view === "current" ? (
              <>
                <p className="text-[13px] text-slate-400">
                  Updates since the {displayDate} release.
                </p>
                {RELEASES.length > 1 && (
                  <button
                    onClick={() => setView("history")}
                    className="text-[12px] text-[#D4AF37] hover:text-[#A08820] underline-offset-2 hover:underline cursor-pointer transition-colors"
                  >
                    See all releases
                  </button>
                )}
              </>
            ) : (
              <button
                onClick={() => setView("current")}
                className="flex items-center gap-1 text-[12px] text-[#D4AF37] hover:text-[#A08820] cursor-pointer transition-colors"
              >
                <ArrowLeft className="w-3 h-3" />
                Back to latest
              </button>
            )}
          </div>
        </DialogHeader>

        {view === "current" ? (
          <div className="px-6 py-5 space-y-6">
            {currentRelease.features.map((feature, fi) => (
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

            {/* "What else" - same text weight/size as feature details for visual parity. */}
            <div>
              <h4
                className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#D4AF37] mb-2.5"
                style={{ fontFamily: "'Oswald', sans-serif" }}
              >
                What Else
              </h4>
              <ul className="space-y-1.5 text-[13px] leading-[1.55]">
                {currentRelease.whatElse.map((item, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="text-[#D4AF37] mt-[7px] shrink-0 inline-block w-1 h-1 rounded-full bg-[#D4AF37]" />
                    <span>{formatWhatElse(item)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-4">
            {RELEASES.map((rel) => (
              <div
                key={rel.date}
                className="rounded-md border border-white/10 border-l-[3px] border-l-[#D4AF37] bg-white/[0.02] p-4"
              >
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#D4AF37] mb-1.5"
                   style={{ fontFamily: "'Oswald', sans-serif" }}>
                  {formatDate(rel.date)}
                </p>
                <p className="text-[14px] leading-[1.55] text-slate-200 mb-2">{rel.headline}</p>
                <ul className="space-y-1 text-[12.5px] leading-[1.55] text-slate-300">
                  {rel.features.map((f) => (
                    <li key={f.title} className="flex gap-2">
                      <span className="text-[#D4AF37] shrink-0">·</span>
                      <span><span className="font-semibold text-slate-100">{f.title}.</span> {f.tagline}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="px-6 pb-5 pt-2 border-t border-white/10">
          <Button
            onClick={dismiss}
            className="w-auto px-5 bg-[#D4AF37] text-black hover:bg-[#A08820] font-semibold uppercase tracking-[0.06em]"
            style={{ fontFamily: "'Oswald', sans-serif" }}
          >
            Let's Go
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
