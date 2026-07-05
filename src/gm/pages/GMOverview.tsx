import { useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";

/**
 * GM Roster (index) — Phase 0 scaffold, proves the shell + team context.
 *
 * Target (per gm-interface-spec): a near-duplicate of Team Builder — one
 * row-per-player money dashboard, hitters and pitchers in separate stacked
 * sections, sorted by WAR. Columns: Name/Pos · Eligibility · Projected WAR
 * (ref) · Market Value (ref) · Revenue Share · NIL · Other · Actual Pay
 * (source of truth) · Social Following · Finalize. A per-bucket budget summary
 * (used/total) sits in the header. Actual Pay is a typed source of truth that
 * the buckets do NOT auto-sum into.
 *
 * Build order (spec §14): audit schema → per-program roster table → DESIGN
 * REVIEW against Team Builder → build the table. So this stays a shell until
 * the design is confirmed and the roster table exists.
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
            ? `Managing ${teamName}. Money, WAR, market value, and eligibility — no stat projections.`
            : isSuperadmin
              ? "Pick a team in the switcher above to load its front-office roster."
              : "No team in scope."}
        </p>
      </div>

      <Card>
        <CardContent className="py-10 text-center">
          <div className="text-sm font-semibold text-foreground">Money dashboard coming next</div>
          <p className="mx-auto mt-2 max-w-xl text-xs leading-relaxed text-muted-foreground">
            A Team-Builder-style roster (hitters and pitchers stacked, sorted by WAR) with per-player
            pay broken into Revenue Share / NIL / Other, an Actual Pay source-of-truth, eligibility,
            social following, and a per-bucket budget summary up top — two-way synced with the coach's
            Team Builder. Pending the schema audit, the per-year program roster table, and a design
            review against Team Builder.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
