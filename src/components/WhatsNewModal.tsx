import { useEffect, useState } from "react";
import { Sparkles, ArrowLeft } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "rstr_iq_whats_new_seen";

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
    date: "2026-05-19",
    headline: "Full JUCO upload, Program Analytics, 2026 final regular season locked",
    features: [
      {
        title: "Full JUCO Player Upload + Transfer Portal",
        tagline:
          "Every qualified NJCAA D1 hitter and pitcher is now live in RSTR IQ, fully wired into the Transfer Portal simulator.",
        details: [
          "Run JUCO-to-D1 transfer projections for any player, any destination. Calibrated weights, district-specific competition, JUCO-specific risk model.",
          "New JUCO subtab on the Player Dashboard with leaderboards, district filter, and target board.",
          "Dedicated JUCO player + pitcher profile pages with 2026 actuals and scouting grades.",
        ],
      },
      {
        title: "Program Analytics",
        tagline:
          "A full Team Builder analytics view that grades your roster position-by-position, tier-by-tier, broken out by lineup, rotation, and bullpen WAR with championship benchmarks alongside.",
        details: [
          "Year-over-year compare and championship benchmark cards quantify exactly where the build stands.",
          "Pitcher and hitter tier labels reworked. A 1.8 pWAR starter now reads \"Contributor,\" not \"Below.\"",
          "2026 regular-season WAR snapshot live (308 D1 teams + 34 conference champions flagged).",
        ],
      },
      {
        title: "2026 Final Regular Season Stats Locked",
        tagline:
          "Full end-of-regular-season D1 refresh. Hitters, pitchers, every Stuff+ input, and conference aggregates are now the latest available numbers.",
        details: [
          "All projections, power ratings, and scouting grades recomputed against fresh 2026 NCAA averages.",
          "Per-pitch Stuff+ re-rolled across 26K+ rows. Per-conference Stuff+ and env-rate plusses (BA+/OBP+/ISO+/SLG+) refreshed for every league.",
          "Postseason updates (CWS, national champion) will land once the bracket plays out.",
        ],
      },
    ],
    whatElse: [
      "Team Builder: bench-everywhere default fixed. Tiers now distribute correctly.",
      "Team Builder: depth-chart class colors read the current class year (R-JR shows as JR, etc.).",
      "Team Builder: redundant \"Class Adj\" column removed (equation still applies).",
      "Risk Assessment: Stuff+ added as a factor. Pitcher Skillset falls back to K/9 · BB/9 · HR/9 when TrackMan is missing.",
      "Data: DOB and class year columns added to the master tables (D1 backfill comes with 2026 final stats).",
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
