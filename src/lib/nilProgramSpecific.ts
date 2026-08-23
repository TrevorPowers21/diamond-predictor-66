// PROGRAM TIER MULTIPLIERS (PTM) — market value = WAR × $/WAR × PTM × PVM.
// SINGLE SOURCE OF TRUTH = model_config `nil_tier_*` keys (read via resolveNilTiersFromConfig);
// these are the code fallback + the correct current values. Reverse-engineered 2026-08-21 from
// real roster spend (SEC top roster ~44 WAR × $25k × 4.0 ≈ $4.4M ≈ ~$100k/win). See
// docs/AGENT_LEARNINGS_market_value_reverse_engineer_2026_08_21.md. ACC split out of Big12.
export const DEFAULT_NIL_TIER_MULTIPLIERS = {
  sec: 4.0,
  acc: 1.5,
  p4: 1.2, // Big12 (+ any other P4-ish); ACC now has its own `acc` key
  bigTen: 1.0,
  strongMid: 0.8,
  lowMajor: 0.5,
  juco: 0.35,
};

type NilTierMultipliers = typeof DEFAULT_NIL_TIER_MULTIPLIERS;

// The default $/WAR base (model_config key `nil_base_per_owar`).
export const DEFAULT_NIL_BASE_PER_WAR = 25000;

// SINGLE-SOURCE reader: build the PTM tiers object from model_config values (admin_ui overlay),
// falling back to the code defaults above. Used by BOTH the hitter and pitcher WRITE paths + the
// edge fn so there is ONE source and no drift. Pass the flat {config_key: value} map.
export function resolveNilTiersFromConfig(
  config: Record<string, number | string | null | undefined> | null | undefined,
): NilTierMultipliers {
  const c = config ?? {};
  const val = (k: string, fallback: number): number => {
    const n = c[k] == null ? NaN : Number(c[k]);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    sec:       val("nil_tier_sec",        DEFAULT_NIL_TIER_MULTIPLIERS.sec),
    acc:       val("nil_tier_acc",        DEFAULT_NIL_TIER_MULTIPLIERS.acc),
    p4:        val("nil_tier_p4",         DEFAULT_NIL_TIER_MULTIPLIERS.p4),
    bigTen:    val("nil_tier_big_ten",    DEFAULT_NIL_TIER_MULTIPLIERS.bigTen),
    strongMid: val("nil_tier_strong_mid", DEFAULT_NIL_TIER_MULTIPLIERS.strongMid),
    lowMajor:  val("nil_tier_low_major",  DEFAULT_NIL_TIER_MULTIPLIERS.lowMajor),
    juco:      val("nil_tier_juco",       DEFAULT_NIL_TIER_MULTIPLIERS.juco),
  };
}

export function resolveNilBasePerWar(
  config: Record<string, number | string | null | undefined> | null | undefined,
): number {
  const n = config?.["nil_base_per_owar"] == null ? NaN : Number(config["nil_base_per_owar"]);
  return Number.isFinite(n) ? n : DEFAULT_NIL_BASE_PER_WAR;
}

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

  // JUCO districts: stored as "NJCAA D1 <District>" / "NJCAA D1 <District> District".
  // Detect by the "njcaa" substring so we never fall through to a D1 tier.
  if (key.includes("njcaa")) return multipliers.juco;
  if (key.includes("southeasternconference") || key === "sec") return multipliers.sec;
  if (key.includes("bigten")) return multipliers.bigTen;
  // ACC has its own tier (split from Big12, 2026-08-21) — branch BEFORE the big12 check.
  if (key.includes("atlanticcoastconference") || key === "acc") return multipliers.acc;
  if (key.includes("big12")) return multipliers.p4;
  if (STRONG_MID_KEYS.has(key)) return multipliers.strongMid;
  return multipliers.lowMajor;
};

export const getPositionValueMultiplier = (position: string | null | undefined): number => {
  const pos = (position || "").trim().toUpperCase();

  if (["C", "CATCHER", "SS", "SHORTSTOP", "CF", "CENTER FIELD", "CENTERFIELD"].includes(pos)) return 1.3;
  if (["2B", "SECOND BASE", "SECONDBASE", "3B", "THIRD BASE", "THIRDBASE", "IF", "INF", "INFIELD", "LF", "RF", "CORNER OUTFIELD", "COF", "OF", "OUTFIELD"].includes(pos)) return 1.1;
  if (["1B", "FIRST BASE", "FIRSTBASE", "DH", "DESIGNATED HITTER", "DESIGNATEDHITTER", "UT", "UTL", "UTIL", "UTILITY"].includes(pos)) return 1.0;
  if (["BENCH", "BENCH UTILITY", "BENCHUTILITY"].includes(pos)) return 0.8;

  // default neutral multiplier when position is unknown
  return 1.0;
};

export const calcPlayerScore = ({
  owar,
  programTierMultiplier,
}: {
  owar: number | null | undefined;
  programTierMultiplier: number;
}): number => {
  // Player score = WAR × PTM. PVM (positional value) is REMOVED from the score
  // per docs/RSTR_IQ_NIL_Allocation_Spec.md §1: scarcity must never inflate a
  // player's rank on his own roster. Positional value is priced in the pricing
  // layer instead — §7.2 always-on positional premium + §4 need premium — via
  // the derived cliff scarcity index, not baked into the allocation score.
  const safeOwar = Number(owar) || 0;
  const ptm = Number(programTierMultiplier) || 0;
  return safeOwar * ptm;
};

// calcProgramSpecificAllocation + DEFAULT_PROGRAM_TOTAL_PLAYER_SCORE (68) retired
// 2026-08-16 — the old proportional NIL split is replaced everywhere by the
// roster-level allocateNil curve (src/lib/nilAllocation.ts), and the tier-color
// helper (projectedNilTierClass) now keys off the average paid allocation.
