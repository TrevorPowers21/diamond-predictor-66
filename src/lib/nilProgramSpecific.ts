export const DEFAULT_PROGRAM_TOTAL_PLAYER_SCORE = 68;

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

  const denominator = (Number(rosterTotalPlayerScore) || 0) > 0
    ? rosterTotalPlayerScore
    : fallbackTotalPlayerScore;

  if (denominator <= 0) return 0;
  return (playerScore / denominator) * budget;
};
