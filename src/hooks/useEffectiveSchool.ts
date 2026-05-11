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
// Customer teams that can pick any team from the in-app team dropdowns
// (Transfer Portal Destination, Team Builder Team, Compare To-Team, etc.).
// Used by RST All Americans, our internal test/demo account that needs to
// validate functionality across every team. Every other customer is locked
// to their own school via useEffectiveSchool().allowAllTeams = false.
// If this list grows beyond a handful, move it to a column on customer_teams.
const UNRESTRICTED_CUSTOMER_TEAM_NAMES = new Set<string>([
  "RST All Americans",
]);

export function useEffectiveSchool() {
  const { effectiveTeamId, availableTeams } = useAuth();
  const { teams } = useTeamsTable();

  return useMemo(() => {
    const empty = { schoolName: null, schoolFullName: null, schoolTeamId: null, logoUrl: null, branding: null as SchoolBranding | null, allowAllTeams: false };
    if (!effectiveTeamId) return empty;
    const customerTeam = availableTeams.find((t) => t.id === effectiveTeamId);
    if (!customerTeam) return empty;
    const branding = buildBranding(customerTeam);
    const allowAllTeams = UNRESTRICTED_CUSTOMER_TEAM_NAMES.has(customerTeam.name);
    const schoolTeamId = customerTeam.school_team_id;
    if (!schoolTeamId) {
      return {
        schoolName: customerTeam.name,
        schoolFullName: customerTeam.name,
        schoolTeamId: null,
        logoUrl: branding?.logoUrl ?? null,
        branding,
        allowAllTeams,
      };
    }
    const schoolRow = teams.find((t) => t.id === schoolTeamId);
    if (!schoolRow) {
      // The customer team IS linked to a Teams Table row, but useTeamsTable
      // hasn't loaded the row yet (initial mount race). Return null name
      // rather than falling back to customer_teams.name — that fallback
      // has a different shape ("Georgia Bulldogs" vs the abbreviation
      // "Georgia"), which breaks downstream Teams Table lookups in the
      // TransferPortal simulator and any other surface that resolves the
      // school name back to a Teams Table row. Caller should wait for the
      // hook to resolve to a real schoolRow.
      return {
        schoolName: null,
        schoolFullName: null,
        schoolTeamId,
        logoUrl: branding?.logoUrl ?? null,
        branding,
        allowAllTeams,
      };
    }
    return {
      schoolName: schoolRow.name,
      schoolFullName: schoolRow.fullName,
      schoolTeamId,
      logoUrl: branding?.logoUrl ?? null,
      branding,
      allowAllTeams,
    };
  }, [effectiveTeamId, availableTeams, teams]);
}
