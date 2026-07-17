// Marketability score (0–100): an additive "scorecard" (like the risk model —
// tier-in, points-out; not percentile-driven). Two mains dominate so a player
// strong on BOTH already scores high on their own; draft + legacy are additive
// bonuses under a hard 100 cap.
//
//   Program & Community  0–45   (hand-set per program; the always-present base)
//   Social Following     0–45   (from entered follower counts; main signal)
//   University Connection 0–20  (manual legacy/alumni ties; "icing")
//   Draft Context        0–15   (annual draft board; nearly binary — ranked = notable)
//   score = min(100, program + social + connection + draft)

export type ConnectionTier = "family_notable" | "family_alum" | "local" | null;

export interface MarketabilityInputs {
  totalFollowers: number | null | undefined;
  programTier: number | null | undefined;   // 1–5; null → neutral default
  draftRank: number | null | undefined;      // national draft rank; null = unranked
  connectionTier: ConnectionTier | undefined;
}

export interface MarketabilityBreakdown {
  program: number;
  social: number;
  connection: number;
  draft: number;
  score: number;
  tier: string;
  programWasDefaulted: boolean; // program tier unset → neutral placeholder used
}

// Program tier 1–5 → points (0–45). Unset → neutral (tier 3) so a pre-config
// roster still scores sensibly, flagged so the UI can nudge a real value.
const PROGRAM_POINTS: Record<number, number> = { 1: 9, 2: 18, 3: 27, 4: 36, 5: 45 };

function programPoints(tier: number | null | undefined): { pts: number; defaulted: boolean } {
  if (tier == null || !PROGRAM_POINTS[tier]) return { pts: PROGRAM_POINTS[3], defaulted: true };
  return { pts: PROGRAM_POINTS[tier], defaulted: false };
}

// Total social following → points (0–45).
function socialPoints(total: number | null | undefined): number {
  const t = Number(total ?? 0);
  if (!Number.isFinite(t) || t < 1000) return 0;
  if (t < 2500) return 11;
  if (t < 10000) return 20;
  if (t < 50000) return 29;
  if (t < 150000) return 38;
  return 45;
}

// Connection tier → points (0–20).
const CONNECTION_POINTS: Record<string, number> = { family_notable: 20, family_alum: 12, local: 8 };
function connectionPoints(tier: ConnectionTier | undefined): number {
  return tier ? (CONNECTION_POINTS[tier] ?? 0) : 0;
}

// National draft rank → points (0–15). Any ranked player is notable (their team's
// best), so it's nearly binary with a small bump for top-100.
function draftPoints(rank: number | null | undefined): number {
  if (rank == null || !Number.isFinite(Number(rank))) return 0;
  return Number(rank) <= 100 ? 15 : 11;
}

export function computeMarketability(inp: MarketabilityInputs): MarketabilityBreakdown {
  const prog = programPoints(inp.programTier);
  const program = prog.pts;
  const social = socialPoints(inp.totalFollowers);
  const connection = connectionPoints(inp.connectionTier);
  const draft = draftPoints(inp.draftRank);
  const score = Math.min(100, program + social + connection + draft);
  return { program, social, connection, draft, score, tier: marketabilityTier(score), programWasDefaulted: prog.defaulted };
}

export function marketabilityTier(score: number | null | undefined): string {
  if (score == null) return "—";
  if (score >= 85) return "Elite";
  if (score >= 65) return "High";
  if (score >= 40) return "Moderate";
  return "Emerging";
}

// Tier → display color (hex), tuned for the dark UI. Elite = brand gold.
export function marketabilityTierColor(tier: string): string {
  switch (tier) {
    case "Elite": return "#22d3ee";
    case "High": return "#34d399";
    case "Moderate": return "#fbbf24";
    case "Emerging": return "#94a3b8";
    default: return "#94a3b8";
  }
}
