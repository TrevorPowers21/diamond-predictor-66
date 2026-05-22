/**
 * Name and team normalization utilities — shared across TeamBuilder, PlayerProfile,
 * and data pipelines.
 *
 * POLICY: Use these instead of defining local normalizeName/nameTeamKey in pages.
 * helpers.ts re-exports normalizeName from here for backward compat.
 */

export const normalizeName = (value: string | null | undefined): string =>
  (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const FIRST_NAME_ALIASES: Record<string, string[]> = {
  christopher: ["chris"],
  matthew: ["matt"],
  michael: ["mike"],
  joseph: ["joe"],
  alexander: ["alex"],
};

export const getNameVariants = (fullName: string): string[] => {
  const cleaned = normalizeName(fullName);
  if (!cleaned) return [];
  const parts = cleaned.split(" ").filter(Boolean);
  if (parts.length < 2) return [cleaned];
  const [first, ...rest] = parts;
  const restJoined = rest.join(" ");
  const variants = new Set<string>([cleaned]);
  const aliases = FIRST_NAME_ALIASES[first] || [];
  for (const a of aliases) variants.add(`${a} ${restJoined}`.trim());
  if (first.length > 1) variants.add(`${first[0]} ${restJoined}`.trim());
  return Array.from(variants);
};

export const normalizeTeamForKey = (team: string | null | undefined): string => {
  const t = normalizeName(team);
  return t.replace(/\buniversity\b/g, "").replace(/\bof\b/g, "").replace(/\s+/g, " ").trim();
};

export const nameTeamKey = (
  name: string | null | undefined,
  team: string | null | undefined,
): string => `${normalizeName(name)}|${normalizeTeamForKey(team)}`;
