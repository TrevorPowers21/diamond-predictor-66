import { useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";

/**
 * GM Roster (index). Phase 0 scaffold — proves the shell + team context.
 * Phase 1 replaces this with the money-first roster table (WAR, 100% market
 * value, actual pay, eligibility) read from the team's active/default build,
 * designed to match the attached document.
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
        <h2 className="text-lg font-semibold text-foreground">Roster</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {teamName
            ? `Managing ${teamName}. Money, WAR, market value, and eligibility — no projections.`
            : isSuperadmin
              ? "Pick a team in the switcher above to load its front-office roster."
              : "No team in scope."}
        </p>
      </div>

      <Card>
        <CardContent className="py-10 text-center">
          <div className="text-sm font-semibold text-foreground">Roster view coming next</div>
          <p className="mx-auto mt-2 max-w-lg text-xs leading-relaxed text-muted-foreground">
            This shares the same roster the coach builds — as players are added or dropped there, they
            flow here. Next phase: per-player WAR, 100% market value, actual pay (Rev Share / NIL / Other),
            and eligibility, plus team budget totals — built to match the attached design.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
