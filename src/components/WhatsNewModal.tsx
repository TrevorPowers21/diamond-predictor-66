import { useEffect, useState } from "react";
import { Sparkles, ArrowLeft } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "rstr_iq_whats_new_seen_v5";

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
    date: "2026-06-14",
    headline: "Team Builder target board is now a true shopping list",
    features: [
      {
        title: "Toggle Targets Onto the Roster One at a Time",
        tagline:
          "Searching a player onto the target board no longer auto-counts them in your roster math. Each target shows its own projection on its own line, and you click the + icon next to the name when you're ready to add them to your roster.",
        details: [
          "Every target row has a + icon to the left of the player name. Click it to add the player to your roster — the icon flips to a green ✓ and that player now flows into your Total WAR, Lineup oWAR, Rotation pWAR, Bullpen pWAR, NIL budget, depth chart, and Program Analytics.",
          "Click the ✓ to take them back off the roster — they stay on the target board with their individual projection visible, just no longer counted.",
          "While a player is off the roster (+), the Actual Value column on their row shows what their NIL share would be if they were your next signing — your individual evaluation of that player against the budget you have remaining.",
          "Trash icon still removes a target from the board entirely.",
        ],
      },
      {
        title: "Existing Saved Targets Now Show as Watching By Default",
        tagline:
          "Every target you had saved before today is now listed as + (watching) — nothing was deleted. Your Total WAR, NIL, and Program Analytics now reflect just your actual returners. Click + on any target you want counted back into the roster math.",
        details: [
          "Your saved target list is intact. Every player you were watching is still there, with the same projection, depth role, dev aggressiveness, and notes you set.",
          "If you were using the target board to plan your real 2026 roster (transfers you're confident in landing), click + on each of those targets and your numbers will return to where you remember them.",
          "If you were using the target board as a watch list (which most coaches are), the new lower numbers ARE your correct roster math — those targets shouldn't have been inflating your totals all along.",
        ],
      },
      {
        title: "Cleaner Target Board Layout",
        tagline:
          "The target board's Position column is now read-only (no dropdown), the Risk column now shows a proper pitcher risk grade for pitcher targets, and on-roster targets render with the same row style as your returners on the Roster tab.",
        details: [
          "Pitchers on the target board get a Risk grade tuned to pitcher-specific inputs (stuff+, whiff%, walk%, etc.) instead of borrowing the hitter risk calculation.",
          "Position assignment (the dropdown for slotting a player into your depth chart) lives only on the Roster tab now. The target board shows the player's natural position as text — you decide where they slot when you add them.",
          "When you ✓ a target into the roster, that player's row picks up the position dropdown and looks identical to your other roster rows.",
        ],
      },
    ],
    whatElse: [
      "Position dropdown on the Roster tab now defaults to '—' for newly added targets so you can pick their slot fresh instead of inheriting their old school's position.",
    ],
  },
  {
    date: "2026-06-10",
    headline: "Projected MLB Draft slot values now live on player profiles",
    features: [
      {
        title: "Draft Rank and Slot Value on the Player Profile",
        tagline:
          "Every draft-eligible college player in the 2026 class now carries a projected draft rank and slot dollar value, surfaced directly on their profile alongside the projection and portal tracking you already use.",
        details: [
          "Two new cells sit in the left column under Career Stats: '2026 Draft Rank' showing the player's industry-aggregated rank, and 'Draft Slot Value' showing the projected MLB Draft bonus.",
          "Coverage spans the full 2026 ranked college class, so any draft-eligible player you're tracking has the slot context attached.",
          "The framework is designed for annual refresh, so 2027 and 2028 draft classes can drop in as scouting consensus develops.",
        ],
      },
      {
        title: "Two-Way Player Valuations, Split By Side",
        tagline:
          "Two-way players now carry a dedicated hitter market value and pitcher market value across every surface. Each view surfaces the right number for the role you're evaluating.",
        details: [
          "Player Dashboard, Player Profile, Compare, Transfer Portal Simulator, and Team Builder all pull the correct side-specific value.",
          "Team Builder splits two-way targets into a hitter line and a pitcher line on add, each with its own projection and market value.",
        ],
      },
      {
        title: "Full Visibility on Committed Players",
        tagline:
          "Toggle Committed in the Player Dashboard Portal filter and you'll now see every player who's chosen a destination across the country. Recruiting time stays focused on the players who are still in play.",
        details: [
          "Home-page commit count and the table count now match exactly.",
          "Surfaces committed players regardless of where they signed, so the board reflects the full picture.",
        ],
      },
    ],
    whatElse: [
      "Pitcher profiles get the same Draft Rank and Slot Value treatment as hitter profiles.",
    ],
  },
  {
    date: "2026-06-09",
    headline: "Refined Two-Way Player valuations, full committed-player visibility, and live Team Builder pitching controls",
    features: [
      {
        title: "Two-Way Player Valuations, Split By Side",
        tagline:
          "Two-way players like Josiah Overbeek now carry a dedicated hitter market value and pitcher market value across every surface. Each view surfaces the right number for the role you're evaluating.",
        details: [
          "Player Dashboard, Player Profile, Compare, Transfer Portal Simulator, and Team Builder all pull the correct side-specific value.",
          "Team Builder splits two-way targets into a hitter line and a pitcher line on add, each with its own projection and market value.",
        ],
      },
      {
        title: "Full Visibility on Committed Players",
        tagline:
          "Toggle Committed in the Player Dashboard Portal filter and you'll now see every player who's chosen a destination across the country. Recruiting time stays focused on the players who are still in play.",
        details: [
          "Home-page commit count and the table count now match exactly.",
          "Surfaces committed players regardless of where they signed, so the board reflects the full picture.",
        ],
      },
      {
        title: "Live Team Builder Pitching Controls",
        tagline:
          "Move a pitcher's depth role, SP / RP role, or dev aggressiveness and pWAR, Market Value, and every rate stat update on the spot. Same instant feedback the hitter controls have.",
        details: [
          "Depth role adjusts pWAR and Market Value based on the implied IP load.",
          "SP ↔ RP toggle re-baselines rates with the elite-reliever progression curve so the projection reflects how the role actually translates.",
          "Dev aggressiveness scales every rate stat in the right direction and flows through to pRV+, pWAR, and Market Value.",
        ],
      },
    ],
    whatElse: [
      "Player Dashboard: the hitter-tab position column prioritizes the player's offensive position record for cleaner display.",
      "Team Builder: two-way players appear once on the hitter tab and once on the pitcher tab with the right position label on each.",
      "Portal sync: tightened source matching and adjusted to a three-hour cadence as portal activity has settled.",
    ],
  },
  {
    date: "2026-06-04",
    headline: "Smarter Team Builder hitter controls, faster Transfer Portal, expanded pitcher coverage",
    features: [
      {
        title: "Team Builder Hitter Controls Now Drive Projections in Real Time",
        tagline:
          "Slide a hitter's depth role, dev aggressiveness, or position and their oWAR and Market Value update on the spot. Stored projections stay the foundation, and your adjustments layer cleanly on top.",
        details: [
          "Depth changes scale oWAR and Market Value using the same PA-ratio math the Player Profile uses, so the numbers stay consistent across both surfaces.",
          "Dev aggressiveness flows through the slash stats (pAVG/pOBP/pSLG/pWRC+) and on into oWAR and Market Value together.",
          "Position changes adjust Market Value while leaving oWAR steady.",
          "Every player loads with their stored projection by default, so a coach who doesn't touch the knobs sees the pipeline's numbers as is.",
        ],
      },
      {
        title: "Transfer Portal Simulator: Instant Search, Full Pitcher Pool",
        tagline:
          "The Transfer Portal page is ready the moment it opens. The pitcher search now surfaces every D1 arm on file across the country.",
        details: [
          "Search results render immediately on page load, with the full pool available the second you start typing.",
          "Picking a player streams in their projection with a clean \"Loading projection...\" indicator.",
          "\"Previous\" season stats and projection numbers share the same stored-row source that powers the Player Compare page, keeping numbers consistent across surfaces.",
        ],
      },
      {
        title: "Refined Pricing for Swing-Role Pitchers",
        tagline:
          "Pitchers slotted into the Swing role on the rotation depth chart now price against the right role baseline, reflecting how versatile arms get used across a season.",
        details: [
          "Swing-role pitchers use the SM (swing-man) Position Value Factor, giving the depth chart the right shape from cornerstone weekend starter down through the rest of the rotation.",
        ],
      },
    ],
    whatElse: [
      "Team Builder: more precise precomputed pitcher projections for target players.",
      "Team Builder: target hitter stats appear instantly on add, no flash while the projection catches up.",
      "Team Builder: smoother depth-chart interactions on larger builds.",
      "Player Dashboard, Pitcher Profile, Team Builder pitcher search: expanded pitcher coverage across every surface that lists arms.",
    ],
  },
  {
    date: "2026-05-27",
    headline: "Budget control, program benchmarks, and a sharper team picker",
    features: [
      {
        title: "Pay What You Want, Watch the Rest Shift",
        tagline:
          "Type any number into Actual Value, including $0, and the rest of your projected budget redistributes across the roster in real time. Pay your bench guy nothing, see exactly how much more lands on your top hitter without re-running anything.",
        details: [
          "Empty the input to return that player to the projected share. Type 0 to lock them in at zero and reallocate.",
          "100% of your total budget always distributes. Sum of projected values stays inside what you've set, no more.",
          "Overrides persist with the saved build, so a coach decision from yesterday is still there tomorrow.",
        ],
      },
      {
        title: "Program Analytics, Built Around Hosting a Super Regional",
        tagline:
          "Replaced the National Champion benchmark with the National Seed range (top 8). It's the regular-season number that actually answers, what does it take to host a Super Regional. Postseason bracket variance isn't a roster-build target, so it's out.",
        details: [
          "New comparison row shows the min and max WAR profile across this season's top 8 seeds, plus the median for context.",
          "Conference Regular-Season Champion row stays, mapped to your conference automatically.",
          "Emulate any program through the new searchable dropdown. Sorted by total WAR descending, with each program's WAR shown inline.",
          "JUCO and community college programs are filtered out of the picker, so you only see your real D1 peers.",
        ],
      },
      {
        title: "Cleaner Exports for Sharing With Staff",
        tagline:
          "PDF scouting reports no longer include the 'assumes player returns to current school' footnote. The projection engine already runs the transfer portal scenario at your school, so the disclaimer was both misleading and unnecessary.",
        details: [
          "Hand the sheet to your HC or recruiting director and it speaks your program's numbers, no caveat needed.",
        ],
      },
    ],
    whatElse: [
      "Sparse-PA returners now show the correct cross-team WAR floor on per-program views. Stale precomputed rows that lost the tier-PA assignment have been refreshed.",
      "JUCO pitcher cross-team projections now populate. Earlier they showed dashes because the precompute path skipped JUCO arms.",
      "Pitcher profile pages default the role display to the stored projection (SP vs RP), no more toggle needed.",
    ],
  },
  {
    date: "2026-05-24",
    headline: "Fully customized projections for your program",
    features: [
      {
        title: "Every Projection Now Reflects Your Program",
        tagline:
          "RSTR IQ now precomputes every player's projection for your specific destination. Walk in tomorrow and the player dashboard, profile pages, target board, and exportable PDFs all show what each player would do at your school. No simulator step. No filters to set. Just open and read.",
        details: [
          "Player dashboard market values and oWAR now scale to your conference tier, your park, and your program. SEC schools see SEC pricing. Mid majors see mid major pricing. Same player, the right number for you.",
          "Profile pages pull stored projected stats instead of recomputing on the fly. Open the profile and the numbers match the dashboard exactly, every time.",
          "Target board additions reflect the projection at your school the moment you add a player. No second click into the simulator.",
          "PDF scouting reports export with your program's numbers baked in. Hand the coach a sheet that already speaks your program's language.",
        ],
      },
      {
        title: "Team Builder Stays Fully Live",
        tagline:
          "Team Builder still runs your roster simulations live. Adjust class transitions, dev aggressiveness, depth roles, or position slots and watch the build update in real time. Save the build and your changes persist for next time.",
        details: [
          "All knobs (class, dev agg, depth, position) keep working exactly as before in Team Builder.",
          "Profile page knobs are session-only previews now. Change them to see how a depth shift or dev tier would look, leave the page, the original numbers are still there.",
          "To persist a player's projection at a non-default role or dev level, save them in a Team Builder build.",
        ],
      },
      {
        title: "Full JUCO Precompute Live",
        tagline:
          "Every JUCO hitter and pitcher in the country now has a precomputed 2027 projection at your specific destination. Walk into the JUCO subtab, the leaderboard, the player profile, or a target board add and the numbers are already there. Powered by official NJCAA stats (Presto Sports) for accurate plate appearances, batting lines, and pitching peripherals.",
        details: [
          "JUCO Player Dashboard now reads stored 2027 projections instead of 2026 actuals, scaled to your program tier and impacted by district competition gap (NJCAA District → SEC tier delta).",
          "JUCO player + pitcher profiles show the same 2027 projected numbers as the dashboard, no more separate '2026 actuals only' card for JUCO.",
          "Target board additions populate immediately with the JUCO transfer projection for your school, no need to re-simulate.",
          "Stats refreshed from official NJCAA Presto Sports feed: TruMedia was undercounting JUCO PA by 10-30% and missing home runs, which has now been corrected.",
          "District-specific hitter talent calibration (NEC/SWAC tier through MWC tier) so JUCO pitcher projections reflect the real talent gap when moving up to D1.",
        ],
      },
    ],
    whatElse: [
      "Team Builder: faster load and snappier response when you change depth roles, dev tiers, and class adjustments. Big builds no longer lag when you swap players in and out.",
      "Team Builder: cleaner depth chart with steadier sorting and fewer redraws as you drag players between tiers.",
      "Team Builder: saved builds load reliably with all of your overrides and depth assignments intact.",
    ],
  },
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
