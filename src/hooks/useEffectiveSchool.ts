import { useMemo } from "react";
import { useAuth } from "./useAuth";
import { useTeamsTable } from "./useTeamsTable";

/**
 * Bridges the auth `effectiveTeamId` (a customer_team UUID) to the school
 * the user is currently viewing as. This is the post-DEMO_SCHOOL replacement
 * — surfaces that previously read DEMO_SCHOOL.name now read this hook's
 * `schoolName` so they auto-default to the impersonated team.
 *
 * Resolution chain:
 *   effectiveTeamId
 *     → customer_teams row (via availableTeams)
 *     → school_team_id (Teams Table UUID, current season)
 *     → Teams Table row
 *     → name (abbreviation when present, else full_name)
 *
 * Returns nulls when nothing is impersonated AND the user has no team —
 * e.g. a fresh superadmin with no impersonation set. Surfaces should treat
 * a null `schoolName` as "no auto-default; let the user pick."
 */
export function useEffectiveSchool() {
  const { effectiveTeamId, availableTeams } = useAuth();
  const { teams } = useTeamsTable();

  return useMemo(() => {
    if (!effectiveTeamId) {
      return { schoolName: null, schoolFullName: null, schoolTeamId: null };
    }
    const customerTeam = availableTeams.find((t) => t.id === effectiveTeamId);
    if (!customerTeam) {
      return { schoolName: null, schoolFullName: null, schoolTeamId: null };
    }
    const schoolTeamId = customerTeam.school_team_id;
    if (!schoolTeamId) {
      // Customer team exists but isn't linked to a D1 program (admin
      // didn't pick one). Fall back to the customer team's display name.
      return { schoolName: customerTeam.name, schoolFullName: customerTeam.name, schoolTeamId: null };
    }
    const schoolRow = teams.find((t) => t.id === schoolTeamId);
    if (!schoolRow) {
      // Team Builder etc. expect the abbreviation/full_name string used in
      // their pickers. If the school row isn't loaded yet, fall back to the
      // customer team name so we still set _something_.
      return { schoolName: customerTeam.name, schoolFullName: customerTeam.name, schoolTeamId };
    }
    return {
      schoolName: schoolRow.name,
      schoolFullName: schoolRow.fullName,
      schoolTeamId,
    };
  }, [effectiveTeamId, availableTeams, teams]);
}
