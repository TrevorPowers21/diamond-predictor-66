export const DEFAULT_PROGRAM_TOTAL_PLAYER_SCORE = 68;

export const DEFAULT_NIL_TIER_MULTIPLIERS = {
  sec: 1.5,
  p4: 1.2, // ACC + Big12
  bigTen: 1.0,
  strongMid: 0.8,
  lowMajor: 0.5,
};

type NilTierMultipliers = typeof DEFAULT_NIL_TIER_MULTIPLIERS;

const normalizeConferenceKey = (conference: string | null | undefined): string =>
  (conference || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const STRONG_MID_KEYS = new Set([
  "americanathleticconference",
  "aac",
  "sunbeltconference",
  "sunbelt",
  "bigwestconference",
  "bigwest",
  "mountainwestconference",
  "mountainwest",
]);

export const getProgramTierMultiplierByConference = (
  conference: string | null | undefined,
  multipliers: NilTierMultipliers = DEFAULT_NIL_TIER_MULTIPLIERS,
): number => {
  const key = normalizeConferenceKey(conference);
  if (!key) return multipliers.lowMajor;

  if (key.includes("southeasternconference") || key === "sec") return multipliers.sec;
  if (key.includes("bigten")) return multipliers.bigTen;
  if (
    key.includes("atlanticcoastconference") ||
    key === "acc" ||
    key.includes("big12")
  ) {
    return multipliers.p4;
  }
  if (STRONG_MID_KEYS.has(key)) return multipliers.strongMid;
  return multipliers.lowMajor;
};

export const getPositionValueMultiplier = (position: string | null | undefined): number => {
  const pos = (position || "").trim().toUpperCase();

  if (["C", "CATCHER", "SS", "SHORTSTOP", "CF", "CENTER FIELD", "CENTERFIELD"].includes(pos)) return 1.3;
  if (["2B", "SECOND BASE", "SECONDBASE", "3B", "THIRD BASE", "THIRDBASE", "LF", "RF", "CORNER OUTFIELD", "COF"].includes(pos)) return 1.1;
  if (["1B", "FIRST BASE", "FIRSTBASE", "DH", "DESIGNATED HITTER", "DESIGNATEDHITTER"].includes(pos)) return 1.0;
  if (["UT", "UTIL", "UTILITY", "BENCH", "BENCH UTILITY", "BENCHUTILITY"].includes(pos)) return 0.8;

  // default neutral multiplier when position is unknown
  return 1.0;
};

export const calcPlayerScore = ({
  owar,
  programTierMultiplier,
  position,
}: {
  owar: number | null | undefined;
  programTierMultiplier: number;
  position: string | null | undefined;
}): number => {
  const safeOwar = Number(owar) || 0;
  const ptm = Number(programTierMultiplier) || 0;
  const pvm = getPositionValueMultiplier(position);
  return safeOwar * ptm * pvm;
};

export const calcProgramSpecificAllocation = ({
  playerScore,
  rosterTotalPlayerScore,
  nilBudget,
  fallbackTotalPlayerScore = DEFAULT_PROGRAM_TOTAL_PLAYER_SCORE,
}: {
  playerScore: number;
  rosterTotalPlayerScore: number;
  nilBudget: number;
  fallbackTotalPlayerScore?: number;
}): number => {
  const budget = Number(nilBudget) || 0;
  if (budget <= 0) return 0;

  // Keep 68 (or configured fallback) as the default denominator for partial rosters.
  // Only use the calculated roster score once it exceeds the fallback baseline.
  const calculatedTotal = Number(rosterTotalPlayerScore) || 0;
  const denominator = calculatedTotal > fallbackTotalPlayerScore
    ? calculatedTotal
    : fallbackTotalPlayerScore;

  if (denominator <= 0) return 0;
  return (playerScore / denominator) * budget;
};
