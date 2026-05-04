import { useMemo } from "react";
import { useAuth } from "./useAuth";
import { useTeamsTable } from "./useTeamsTable";

// Branding shape exposed to consumers (SchoolBanner). Built from the
// per-team columns on customer_teams. Returned only when all five fields
// are populated — partial branding falls back to the global RSTR IQ banner
// rather than rendering a half-styled layout.
type SchoolBranding = {
  logoUrl: string;
  displayName: string;
  mascot: string;
  primaryColor: string;
  secondaryColor: string;
};

const buildBranding = (
  source: {
    logo_url: string | null;
    display_name: string | null;
    mascot: string | null;
    primary_color: string | null;
    secondary_color: string | null;
  } | null | undefined,
): SchoolBranding | null => {
  if (!source) return null;
  const { logo_url, display_name, mascot, primary_color, secondary_color } = source;
  if (!logo_url || !display_name || !mascot || !primary_color || !secondary_color) return null;
  return {
    logoUrl: logo_url,
    displayName: display_name,
    mascot,
    primaryColor: primary_color,
    secondaryColor: secondary_color,
  };
};

/**
 * Bridges the auth `effectiveTeamId` (a customer_team UUID) to the school
 * the user is currently viewing as. This is the post-DEMO_SCHOOL replacement
 * — surfaces that previously read DEMO_SCHOOL.name now read this hook's
 * `schoolName` so they auto-default to the impersonated team.
 *
 * Resolution chain:
 *   effectiveTeamId
 *     → customer_teams row (via availableTeams) — also carries branding
 *     → school_team_id (Teams Table UUID, current season)
 *     → Teams Table row (for canonical name + abbreviation)
 *
 * Returns nulls when nothing is impersonated AND the user has no team —
 * e.g. a fresh superadmin with no impersonation set. Surfaces should treat
 * a null `schoolName` as "no auto-default; let the user pick."
 */
export function useEffectiveSchool() {
  const { effectiveTeamId, availableTeams } = useAuth();
  const { teams } = useTeamsTable();

  return useMemo(() => {
    const empty = { schoolName: null, schoolFullName: null, schoolTeamId: null, logoUrl: null, branding: null as SchoolBranding | null };
    if (!effectiveTeamId) return empty;
    const customerTeam = availableTeams.find((t) => t.id === effectiveTeamId);
    if (!customerTeam) return empty;
    const branding = buildBranding(customerTeam);
    const schoolTeamId = customerTeam.school_team_id;
    if (!schoolTeamId) {
      return {
        schoolName: customerTeam.name,
        schoolFullName: customerTeam.name,
        schoolTeamId: null,
        logoUrl: branding?.logoUrl ?? null,
        branding,
      };
    }
    const schoolRow = teams.find((t) => t.id === schoolTeamId);
    if (!schoolRow) {
      return {
        schoolName: customerTeam.name,
        schoolFullName: customerTeam.name,
        schoolTeamId,
        logoUrl: branding?.logoUrl ?? null,
        branding,
      };
    }
    return {
      schoolName: schoolRow.name,
      schoolFullName: schoolRow.fullName,
      schoolTeamId,
      logoUrl: branding?.logoUrl ?? null,
      branding,
    };
  }, [effectiveTeamId, availableTeams, teams]);
}
