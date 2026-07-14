// NCAA class → baseline years of eligibility remaining (redshirts adjusted by hand).
const CLASS_YEARS_LEFT: Record<string, number> = { FR: 4, SO: 3, JR: 2, SR: 1, GR: 0 };

export function classCode(classYr: string | null | undefined): "FR" | "SO" | "JR" | "SR" | "GR" | null {
  if (!classYr) return null;
  const c = classYr.trim().toUpperCase();
  if (c.startsWith("FR") || c === "FRESHMAN") return "FR";
  if (c.startsWith("SO") || c === "SOPHOMORE") return "SO";
  if (c.startsWith("JR") || c === "JUNIOR") return "JR";
  if (c.startsWith("SR") || c === "SENIOR") return "SR";
  if (c.startsWith("GR") || c.startsWith("GRAD") || c.startsWith("5")) return "GR";
  return null;
}

export function defaultEligibilityRemaining(classYr: string | null | undefined): number | null {
  const c = classCode(classYr);
  return c ? CLASS_YEARS_LEFT[c] : null;
}

// Draft-eligible after the junior year, or age 21 — whichever comes first. Returns
// the season year they first qualify (JUCO players qualify each year; edit manually).
export function defaultDraftYear(
  classYr: string | null | undefined,
  dob: string | null | undefined,
  season: number,
): number | null {
  const c = classCode(classYr);
  let byClass: number | null = null;
  if (c === "JR" || c === "SR" || c === "GR") byClass = season;
  else if (c === "SO") byClass = season + 1;
  else if (c === "FR") byClass = season + 2;

  let byAge: number | null = null;
  if (dob) {
    const y = Number(dob.slice(0, 4));
    if (Number.isFinite(y)) byAge = y + 21; // turns 21 within that season → eligible
  }

  if (byClass == null) return byAge;
  if (byAge == null) return byClass;
  return Math.min(byClass, byAge);
}
