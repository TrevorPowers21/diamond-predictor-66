const normalize = (v: string | null | undefined) => (v || "").trim().toLowerCase();

export const isPitcherPosition = (position: string | null | undefined) => {
  const pos = normalize(position);
  if (!pos) return false;
  // TWP intentionally excluded — defaults to hitter profile per TeamBuilder convention.
  if (["p", "sp", "rp", "lhp", "rhp", "cl", "closer"].includes(pos)) return true;
  return /(^|[\/,\s-])(p|sp|rp|lhp|rhp|cl)($|[\/,\s-])/.test(pos);
};

export const isPitcherProfile = (
  position: string | null | undefined,
  handedness?: string | null | undefined,
) => {
  if (isPitcherPosition(position)) return true;
  const hand = normalize(handedness);
  return hand === "rhp" || hand === "lhp";
};

// The deep scouting profile (projections + season stats) — hitter vs pitcher.
// Reached from the player hub's "Full scouting profile" link, not clicked directly.
export const scoutingRouteFor = (
  playerId: string,
  position: string | null | undefined,
  handedness?: string | null | undefined,
) => (isPitcherProfile(position, handedness) ? `/dashboard/pitcher/${playerId}` : `/dashboard/player/${playerId}`);

// Canonical "go to this player" route: the universal player hub. Every player
// name/avatar click across the app routes here (the hub then deep-links into
// the scouting profile for the full analysis).
export const profileRouteFor = (
  playerId: string,
  _position?: string | null | undefined,
  _handedness?: string | null | undefined,
) => `/player/${playerId}`;

