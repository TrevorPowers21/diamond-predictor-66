import { useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { GOLD, NAVY_CARD, NAVY_BORDER } from "@/gm/lib/theme";

/**
 * GM Roster (index). Phase 0 scaffold — proves the shell + team context.
 * Phase 1 replaces this with the money-first roster table (WAR, 100% market
 * value, actual pay, eligibility) read from the team's active/default build.
 * The screen design goes through Stitch before the real UI is built.
 */
export default function GMOverview() {
  const { effectiveTeamId, availableTeams, isSuperadmin } = useAuth();

  const teamName = useMemo(
    () => availableTeams?.find((t) => t.id === effectiveTeamId)?.name ?? null,
    [availableTeams, effectiveTeamId],
  );

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: GOLD }}>
          Roster · Front Office View
        </div>
        <p className="mt-1 text-sm text-white/60">
          {teamName
            ? `Managing ${teamName}. Money, WAR, market value, and eligibility — no projections.`
            : isSuperadmin
              ? "Pick a team in the switcher above to load its front-office roster."
              : "No team in scope."}
        </p>
      </div>

      <div
        className="rounded-lg border px-5 py-8 text-center"
        style={{ borderColor: NAVY_BORDER, backgroundColor: NAVY_CARD }}
      >
        <div className="text-sm font-semibold text-white/80">Roster view coming next</div>
        <p className="mx-auto mt-2 max-w-lg text-xs leading-relaxed text-white/45">
          This shares the same roster the coach builds — as players are added or dropped there, they
          flow here. Next phase: per-player WAR, 100% market value, actual pay (broken into Rev Share /
          NIL / Other), and eligibility, plus team budget totals. Screen design goes through Stitch first.
        </p>
      </div>
    </div>
  );
}
