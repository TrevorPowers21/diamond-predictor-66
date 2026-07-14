// Marketability score (0–100) from a player's total social following. Log-scaled
// because follower counts are heavy-tailed — the jump 1K→10K matters far more
// than 400K→410K. Anchored so ~500K total followers ≈ 100. This is the starting
// formula; it's the single source so it can grow to fold in engagement, media,
// and market signals without touching call sites.
const MARKETABILITY_ANCHOR = 500_000;

export function marketabilityScore(totalFollowers: number | null | undefined): number | null {
  const t = Number(totalFollowers ?? 0);
  if (!Number.isFinite(t) || t <= 0) return null;
  const score = (Math.log10(t + 1) / Math.log10(MARKETABILITY_ANCHOR + 1)) * 100;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function marketabilityTier(score: number | null | undefined): string {
  if (score == null) return "—";
  if (score >= 85) return "Elite";
  if (score >= 65) return "High";
  if (score >= 40) return "Moderate";
  return "Emerging";
}
