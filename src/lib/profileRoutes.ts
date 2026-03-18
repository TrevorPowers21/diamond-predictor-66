const normalize = (v: string | null | undefined) => (v || "").trim().toLowerCase();

export const isPitcherPosition = (position: string | null | undefined) => {
  const pos = normalize(position);
  if (!pos) return false;
  if (["p", "sp", "rp", "lhp", "rhp", "cl", "closer", "twp"].includes(pos)) return true;
  return /(^|[\/,\s-])(p|sp|rp|lhp|rhp|cl|twp)($|[\/,\s-])/.test(pos);
};

export const isPitcherProfile = (
  position: string | null | undefined,
  handedness?: string | null | undefined,
) => {
  if (isPitcherPosition(position)) return true;
  const hand = normalize(handedness);
  return hand === "rhp" || hand === "lhp";
};

export const profileRouteFor = (
  playerId: string,
  position: string | null | undefined,
  handedness?: string | null | undefined,
) => (isPitcherProfile(position, handedness) ? `/dashboard/pitcher/${playerId}` : `/dashboard/player/${playerId}`);

