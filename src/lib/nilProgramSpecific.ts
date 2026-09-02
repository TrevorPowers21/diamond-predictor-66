// PROGRAM TIER MULTIPLIERS (PTM) — market value = WAR × $/WAR × PTM × PVM.
// PER-CONFERENCE, EXACT-CODE lookup (2026-08-21) — keyed by the normalized conference CODE
// (the controlled ~30-value set in players.conference / Teams Table.conference), NOT fuzzy name
// matching, per the IDs-over-names rule. Only conferences that differ from low-major are listed;
// everything else defaults to NIL_LOW_MAJOR. SINGLE SOURCE OF TRUTH = model_config `nil_tier_<code>`
// keys (read via resolveNilTiersFromConfig); this map is the code fallback + the correct values.
// Reverse-engineered from real roster spend (SEC top roster ~44 WAR × $25k × 4.0 ≈ $4.4M ≈ ~$100k/win).
// See docs/AGENT_LEARNINGS_market_value_reverse_engineer_2026_08_21.md.
export const DEFAULT_NIL_TIER_MULTIPLIERS: Record<string, number> = {
  sec: 4.0,
  acc: 1.5,
  big12: 1.2,
  bigten: 1.0,
  independent: 1.0, // Oregon State etc. — former power, priced ~Big Ten (NOT low-major)
  // strong mid-majors (0.8) — list every code form that appears in the data
  americanathleticconference: 0.8,
  aac: 0.8,
  sunbelt: 0.8,
  bigwest: 0.8,
  mountainwest: 0.8,
};
export const NIL_LOW_MAJOR = 0.5; // default for any known D1 conf not listed above
export const NIL_JUCO = 0.35; // NJCAA districts

// The default $/WAR base (model_config key `nil_base_per_owar`).
export const DEFAULT_NIL_BASE_PER_WAR = 25000;

// A per-conference PTM map: normalized conference code → multiplier. Special keys `_lowMajor`
// (unknown-conference default) and `_juco` (NJCAA). This is what the resolver + WRITE paths pass.
export type NilTiersByConference = Record<string, number>;

// SINGLE-SOURCE reader: overlay model_config `nil_tier_<code>` values on top of the code defaults.
// `nil_tier_default` overrides the low-major fallback; `nil_tier_juco` overrides NJCAA. Pass the
// flat {config_key: value} map (model_config admin_ui). Used by BOTH hitter + pitcher WRITE paths
// + the edge fn so there is ONE source, keyed by exact code, no drift.
export function resolveNilTiersFromConfig(
  config: Record<string, number | string | null | undefined> | null | undefined,
): NilTiersByConference {
  const merged: NilTiersByConference = { ...DEFAULT_NIL_TIER_MULTIPLIERS, _lowMajor: NIL_LOW_MAJOR, _juco: NIL_JUCO };
  const c = config ?? {};
  for (const [k, v] of Object.entries(c)) {
    // model_config keys look like `nil_tier_sec`, `nil_tier_big12`, `nil_tier_default`, `nil_tier_juco`
    const m = /^nil_tier_(.+)$/.exec(k);
    if (!m) continue;
    const n = v == null ? NaN : Number(v);
    if (!Number.isFinite(n)) continue;
    const code = m[1] === "default" ? "_lowMajor" : m[1] === "juco" ? "_juco" : m[1];
    merged[code] = n;
  }
  return merged;
}

export function resolveNilBasePerWar(
  config: Record<string, number | string | null | undefined> | null | undefined,
): number {
  const n = config?.["nil_base_per_owar"] == null ? NaN : Number(config["nil_base_per_owar"]);
  return Number.isFinite(n) ? n : DEFAULT_NIL_BASE_PER_WAR;
}

const normalizeConferenceKey = (conference: string | null | undefined): string =>
  (conference || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// EXACT per-conference-code lookup (2026-08-21). No fuzzy name matching: the conference field is a
// controlled code set (SEC/ACC/Big 12/Big Ten/Independent/…). Normalize → look up the exact code →
// low-major default for any unlisted D1 conf, JUCO for NJCAA districts. `tiersByConference` comes
// from resolveNilTiersFromConfig(model_config) or the DEFAULT map.
export const getProgramTierMultiplierByConference = (
  conference: string | null | undefined,
  tiersByConference: NilTiersByConference = DEFAULT_NIL_TIER_MULTIPLIERS,
): number => {
  const lowMajor = tiersByConference["_lowMajor"] ?? NIL_LOW_MAJOR;
  const key = normalizeConferenceKey(conference);
  if (!key) return lowMajor;
  // JUCO districts: "NJCAA D1 <District>" — detect by the "njcaa" substring.
  if (key.includes("njcaa")) return tiersByConference["_juco"] ?? NIL_JUCO;
  return tiersByConference[key] ?? lowMajor;
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
