import { useMemo } from "react";
import { useAuth } from "./useAuth";
import { useTeamsTable } from "./useTeamsTable";

// School branding lookup keyed by normalized school name. Drop a logo file
// in /public and add an entry here when onboarding a new customer team.
// Long-term this should move to columns on customer_teams; for now this
// keeps it close to a one-line edit per school.
//
// `displayName` + `mascot` drive the two-line styled banner (e.g. KANSAS /
// JAYHAWKS). `primaryColor` colors the top line; `secondaryColor` colors
// the larger bottom mascot line.
type SchoolBranding = {
  logoUrl: string;
  displayName: string;
  mascot: string;
  primaryColor: string;
  secondaryColor: string;
};

const SCHOOL_BRANDING: Record<string, SchoolBranding> = {
  "kansas jayhawks": {
    logoUrl: "/Kansas Logo.svg",
    displayName: "KANSAS",
    mascot: "JAYHAWKS",
    primaryColor: "#0051BA",   // KU Blue
    secondaryColor: "#E8000D", // KU Crimson
  },
  "georgia bulldogs": {
    logoUrl: "/Georgia_Athletics_logo.svg.webp",
    displayName: "GEORGIA",
    mascot: "BULLDOGS",
    primaryColor: "#BA0C2F",   // UGA Red
    secondaryColor: "#000000", // UGA Black
  },
};

const normalizeForLookup = (name: string | null | undefined) =>
  (name ?? "").toLowerCase().trim().replace(/\s+/g, " ");

const resolveBranding = (...candidates: Array<string | null | undefined>): SchoolBranding | null => {
  for (const c of candidates) {
    const key = normalizeForLookup(c);
    if (key && SCHOOL_BRANDING[key]) return SCHOOL_BRANDING[key];
  }
  return null;
};

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
    const empty = { schoolName: null, schoolFullName: null, schoolTeamId: null, logoUrl: null, branding: null as SchoolBranding | null };
    if (!effectiveTeamId) return empty;
    const customerTeam = availableTeams.find((t) => t.id === effectiveTeamId);
    if (!customerTeam) return empty;
    const schoolTeamId = customerTeam.school_team_id;
    if (!schoolTeamId) {
      const branding = resolveBranding(customerTeam.name);
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
      const branding = resolveBranding(customerTeam.name);
      return {
        schoolName: customerTeam.name,
        schoolFullName: customerTeam.name,
        schoolTeamId,
        logoUrl: branding?.logoUrl ?? null,
        branding,
      };
    }
    const branding = resolveBranding(schoolRow.fullName, schoolRow.name, customerTeam.name);
    return {
      schoolName: schoolRow.name,
      schoolFullName: schoolRow.fullName,
      schoolTeamId,
      logoUrl: branding?.logoUrl ?? null,
      branding,
    };
  }, [effectiveTeamId, availableTeams, teams]);
}
