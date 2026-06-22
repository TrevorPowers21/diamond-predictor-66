import type {
  PitchLogHitterTotalsRow,
  PitchLogPitcherTotalsRow,
} from "@/savant/hooks/usePitchLogTotals";
import type { PitchLogByPitchTypeRow } from "@/savant/hooks/usePitchLogByPitchType";
import type { PitchLogHitterByPitchTypeRow } from "@/savant/hooks/usePitchLogHitterByPitchType";
import type {
  HitterMasterHistoricalRow,
  PitcherMasterHistoricalRow,
} from "@/savant/hooks/usePlayerHistoricalMaster";

export type PitchLogDimensionKey =
  | "all"
  | "vs_lhp"
  | "vs_rhp"
  | "vs_92plus"
  | "vs_fastball"
  | "vs_breaking_ball"
  | "vs_offspeed"
  | "vs_top_hitters"
  | "vs_stuff_100plus"
  | "vs_stuff_105plus";

export interface DimensionOption {
  key: PitchLogDimensionKey;
  label: string;
}

// Pitcher-only dimensions (no vs_92plus — meaningless for pitchers since
// most never throw 92+; we use vs_top_hitters instead to gauge them
// against elite bats).
export const PITCHER_DIMENSIONS: readonly DimensionOption[] = [
  { key: "all", label: "All Pitches" },
  { key: "vs_lhp", label: "vs LHH" },
  { key: "vs_rhp", label: "vs RHH" },
  { key: "vs_fastball", label: "Fastballs" },
  { key: "vs_breaking_ball", label: "Breaking Balls" },
  { key: "vs_offspeed", label: "Offspeed" },
  { key: "vs_top_hitters", label: "vs Top Hitters" },
];

// Hitter-only dimensions (no vs_top_hitters — that's about which hitters
// a pitcher faces; meaningless for the hitter's own row).
export const HITTER_DIMENSIONS: readonly DimensionOption[] = [
  { key: "all", label: "All Pitches" },
  { key: "vs_lhp", label: "vs LHP" },
  { key: "vs_rhp", label: "vs RHP" },
  { key: "vs_92plus", label: "vs 92+ mph" },
  { key: "vs_stuff_100plus", label: "vs Stuff+ 100" },
  { key: "vs_stuff_105plus", label: "vs Stuff+ 105" },
  { key: "vs_fastball", label: "vs Fastballs" },
  { key: "vs_breaking_ball", label: "vs Breaking Balls" },
  { key: "vs_offspeed", label: "vs Offspeed" },
];

export const safeDiv = (n: number | null | undefined, d: number | null | undefined) => {
  const num = n ?? 0;
  const den = d ?? 0;
  return den > 0 ? num / den : null;
};

/** Minimum total_pitches in a dimension before a pitcher is "qualified" for percentile ranking. */
export const PITCHER_QUALIFIED_PITCHES = 100;

/** Minimum PA in a dimension before a hitter is "qualified" for percentile ranking. */
export const HITTER_QUALIFIED_PA = 30;

export interface PitcherRates {
  // Production-against
  avgAgainst: number | null;
  obpAgainst: number | null;
  slgAgainst: number | null;
  opsAgainst: number | null;
  isoAgainst: number | null;
  babipAgainst: number | null;
  // Plate discipline
  kPct: number | null;
  bbPct: number | null;
  strikePct: number | null;
  zonePct: number | null;
  whiffPct: number | null;
  chasePct: number | null;
  contactPct: number | null;
  izWhiffPct: number | null;
  calledStrikePct: number | null;
  // Stuff+ rolled up
  stuffPlus: number | null;
  // Sample sizes
  totalPitches: number;
  totalDataPitches: number;
  dataReliabilityPct: number | null;
  totalBf: number;
}

export function derivePitcherRates(row: PitchLogPitcherTotalsRow | null): PitcherRates | null {
  if (!row) return null;
  // Pitcher totals don't store hits-against directly — derived from BF - (K + BB + HBP + outs).
  // We DON'T have outs in pitcher_totals, so AVG/OBP/SLG against would need pitch-by-pitch.
  // For v1, leave them null for pitchers (handled on hitter side from the matching at-bat).
  // The plate-discipline + Stuff+ rates ARE all derivable here.
  return {
    avgAgainst: null,
    obpAgainst: null,
    slgAgainst: null,
    opsAgainst: null,
    isoAgainst: null,
    babipAgainst: null,
    kPct: safeDiv(row.total_k, row.total_pa),
    bbPct: safeDiv(row.total_bb, row.total_pa),
    strikePct: safeDiv(row.total_strikes, row.total_pitches),
    zonePct: safeDiv(row.total_in_zone, row.total_pitches),
    whiffPct: safeDiv(row.total_whiffs, row.total_swings),
    chasePct: safeDiv(row.total_chases, row.total_swings),
    contactPct:
      row.total_swings > 0
        ? (row.total_swings - row.total_whiffs) / row.total_swings
        : null,
    izWhiffPct: safeDiv(row.total_in_zone_whiffs, row.total_in_zone_swings),
    calledStrikePct: safeDiv(row.total_called_strikes, row.total_pitches),
    stuffPlus: safeDiv(row.stuff_plus_sum, row.stuff_plus_data_pitches),
    totalPitches: row.total_pitches,
    totalDataPitches: row.total_data_pitches,
    dataReliabilityPct: safeDiv(row.total_data_pitches, row.total_pitches),
    totalBf: row.total_bf,
  };
}

export interface HitterRates {
  avg: number | null;
  obp: number | null;
  slg: number | null;
  ops: number | null;
  iso: number | null;
  babip: number | null;
  kPct: number | null;
  bbPct: number | null;
  hrRate: number | null;
  whiffPct: number | null;
  chasePct: number | null;
  contactPct: number | null;
  izWhiffPct: number | null;
  zonePct: number | null;
  groundBallPct: number | null;
  lineDrivePct: number | null;
  flyBallPct: number | null;
  popUpPct: number | null;
  hardHitPct: number | null;
  barrelPct: number | null;
  la1030Pct: number | null;
  avgEv: number | null;
  totalPitches: number;
  pa: number;
  dataReliabilityPct: number | null;
}

export function deriveHitterRates(row: PitchLogHitterTotalsRow | null): HitterRates | null {
  if (!row) return null;
  const hits = row.hits_single + row.hits_double + row.hits_triple + row.hits_hr;
  const tb =
    row.hits_single +
    2 * row.hits_double +
    3 * row.hits_triple +
    4 * row.hits_hr;
  const onBaseNumer = hits + row.bb + row.hbp;
  const onBaseDenom = row.ab + row.bb + row.hbp + row.sac;
  const avg = safeDiv(hits, row.ab);
  const obp = safeDiv(onBaseNumer, onBaseDenom);
  const slg = safeDiv(tb, row.ab);
  const ops = obp !== null && slg !== null ? obp + slg : null;
  const iso = avg !== null && slg !== null ? slg - avg : null;
  // BABIP = (H - HR) / (AB - K - HR + SF). We don't separate SF from SAC
  // in our aggregations — close enough for v1 to use SAC in place of SF.
  const babipNumer = hits - row.hits_hr;
  const babipDenom = row.ab - row.k - row.hits_hr + row.sac;
  return {
    avg,
    obp,
    slg,
    ops,
    iso,
    babip: safeDiv(babipNumer, babipDenom),
    kPct: safeDiv(row.k, row.pa),
    bbPct: safeDiv(row.bb, row.pa),
    hrRate: safeDiv(row.hits_hr, row.pa),
    whiffPct: safeDiv(row.total_whiffs, row.total_swings),
    chasePct: safeDiv(row.total_chases, row.total_swings),
    contactPct:
      row.total_swings > 0
        ? (row.total_swings - row.total_whiffs) / row.total_swings
        : null,
    izWhiffPct: safeDiv(row.total_in_zone_whiffs, row.total_in_zone_swings),
    zonePct: safeDiv(row.total_in_zone, row.total_pitches),
    groundBallPct: safeDiv(row.batted_ground_balls, row.batted_balls_in_play),
    lineDrivePct: safeDiv(row.batted_line_drives, row.batted_balls_in_play),
    flyBallPct: safeDiv(row.batted_fly_balls, row.batted_balls_in_play),
    popUpPct: safeDiv(row.batted_pop_ups, row.batted_balls_in_play),
    hardHitPct: safeDiv(row.batted_hard_hit, row.batted_balls_in_play),
    barrelPct: safeDiv(row.batted_barrels, row.batted_balls_in_play),
    la1030Pct: safeDiv(row.batted_la_10_to_30, row.batted_balls_in_play),
    avgEv: safeDiv(row.ev_sum, row.batted_balls_with_ev),
    totalPitches: row.total_pitches,
    pa: row.pa,
    dataReliabilityPct: safeDiv(row.total_data_pitches, row.total_pitches),
  };
}

export interface PitchTypeBreakdown {
  pitchType: string;
  pitches: number;
  usagePct: number | null;
  velo: number | null;
  ivb: number | null;
  hb: number | null;
  extension: number | null;
  spin: number | null;
  relHeight: number | null;
  relSide: number | null;
  stuffPlus: number | null;
  whiffPct: number | null;
  chasePct: number | null;
  izWhiffPct: number | null;
  calledStrikePct: number | null;
  /** CSW% = (called strikes + whiffs) / pitches. Coach standard for "missed bats and stolen strikes." */
  cswPct: number | null;
}

// ───────────────────────────────────────────────────────────────────
// Metric definitions for percentile-bar rendering
// ───────────────────────────────────────────────────────────────────

export interface MetricDef<TRow> {
  /** Label displayed on the percentile bar. */
  label: string;
  /** Compute the rate from one aggregation row. */
  derive: (row: TRow) => number | null;
  /** Lower is better (e.g., BB%, whiff% for hitters, AVG-against for pitchers). */
  invert?: boolean;
  /** Formatter for the raw value display on the right of the bar. */
  format: (v: number) => string;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const slash = (v: number) => v.toFixed(3).replace(/^0+/, "");
const one = (v: number) => v.toFixed(1);
const two = (v: number) => v.toFixed(2);

export const PITCHER_METRICS_DISCIPLINE: MetricDef<PitchLogPitcherTotalsRow>[] = [
  { label: "K%", derive: (r) => safeDiv(r.total_k, r.total_pa), format: pct },
  { label: "BB%", derive: (r) => safeDiv(r.total_bb, r.total_pa), invert: true, format: pct },
  { label: "Strike%", derive: (r) => safeDiv(r.total_strikes, r.total_pitches), format: pct },
  { label: "Zone%", derive: (r) => safeDiv(r.total_in_zone, r.total_pitches), format: pct },
  { label: "Called Strike%", derive: (r) => safeDiv(r.total_called_strikes, r.total_pitches), format: pct },
  { label: "Whiff%", derive: (r) => safeDiv(r.total_whiffs, r.total_swings), format: pct },
  // O-Swing%: chase swings / out-of-zone pitches (cs_prob < 0.50).
  // Matches Hitter/Pitching Master's `chase` definition. Was previously
  // (chases / total swings) which inflated the rate significantly.
  { label: "Chase%", derive: (r) => safeDiv(r.total_chases, r.total_pitches - r.total_in_zone), format: pct },
  { label: "IZ Whiff%", derive: (r) => safeDiv(r.total_in_zone_whiffs, r.total_in_zone_swings), format: pct },
  {
    label: "Contact% Allowed",
    derive: (r) =>
      r.total_swings > 0 ? (r.total_swings - r.total_whiffs) / r.total_swings : null,
    invert: true,
    format: pct,
  },
  {
    label: "Stuff+",
    derive: (r) => safeDiv(r.stuff_plus_sum, r.stuff_plus_data_pitches),
    format: one,
  },
];

export const HITTER_METRICS_SLASH: MetricDef<PitchLogHitterTotalsRow>[] = [
  {
    label: "AVG",
    derive: (r) => safeDiv(r.hits_single + r.hits_double + r.hits_triple + r.hits_hr, r.ab),
    format: slash,
  },
  {
    label: "OBP",
    derive: (r) => {
      const h = r.hits_single + r.hits_double + r.hits_triple + r.hits_hr;
      return safeDiv(h + r.bb + r.hbp, r.ab + r.bb + r.hbp + r.sac);
    },
    format: slash,
  },
  {
    label: "SLG",
    derive: (r) =>
      safeDiv(
        r.hits_single + 2 * r.hits_double + 3 * r.hits_triple + 4 * r.hits_hr,
        r.ab,
      ),
    format: slash,
  },
  {
    label: "OPS",
    derive: (r) => {
      const h = r.hits_single + r.hits_double + r.hits_triple + r.hits_hr;
      const obp = safeDiv(h + r.bb + r.hbp, r.ab + r.bb + r.hbp + r.sac);
      const slg = safeDiv(
        r.hits_single + 2 * r.hits_double + 3 * r.hits_triple + 4 * r.hits_hr,
        r.ab,
      );
      return obp !== null && slg !== null ? obp + slg : null;
    },
    format: slash,
  },
  {
    label: "ISO",
    derive: (r) => {
      const avg = safeDiv(r.hits_single + r.hits_double + r.hits_triple + r.hits_hr, r.ab);
      const slg = safeDiv(
        r.hits_single + 2 * r.hits_double + 3 * r.hits_triple + 4 * r.hits_hr,
        r.ab,
      );
      return avg !== null && slg !== null ? slg - avg : null;
    },
    format: slash,
  },
  {
    label: "BABIP",
    derive: (r) => {
      const h = r.hits_single + r.hits_double + r.hits_triple + r.hits_hr;
      return safeDiv(h - r.hits_hr, r.ab - r.k - r.hits_hr + r.sac);
    },
    format: slash,
  },
];

export const HITTER_METRICS_DISCIPLINE: MetricDef<PitchLogHitterTotalsRow>[] = [
  {
    label: "Contact%",
    derive: (r) =>
      r.total_swings > 0 ? (r.total_swings - r.total_whiffs) / r.total_swings : null,
    format: pct,
  },
  // O-Swing%: chase swings / out-of-zone pitches. Matches Hitter Master's
  // `chase` definition; was previously (chases / swings) which inflated.
  { label: "Chase%", derive: (r) => safeDiv(r.total_chases, r.total_pitches - r.total_in_zone), invert: true, format: pct },
  { label: "IZ Whiff%", derive: (r) => safeDiv(r.total_in_zone_whiffs, r.total_in_zone_swings), invert: true, format: pct },
  { label: "Zone%", derive: (r) => safeDiv(r.total_in_zone, r.total_pitches), format: pct },
  { label: "K%", derive: (r) => safeDiv(r.k, r.pa), invert: true, format: pct },
  { label: "BB%", derive: (r) => safeDiv(r.bb, r.pa), format: pct },
  { label: "HR%", derive: (r) => safeDiv(r.hits_hr, r.pa), format: pct },
];

export const HITTER_METRICS_CONTACT: MetricDef<PitchLogHitterTotalsRow>[] = [
  { label: "Avg EV", derive: (r) => safeDiv(r.ev_sum, r.batted_balls_with_ev), format: one },
  { label: "Hard Hit%", derive: (r) => safeDiv(r.batted_hard_hit, r.batted_balls_in_play), format: pct },
  { label: "Barrel%", derive: (r) => safeDiv(r.batted_barrels, r.batted_balls_in_play), format: pct },
  { label: "LA 10-30%", derive: (r) => safeDiv(r.batted_la_10_to_30, r.batted_balls_in_play), format: pct },
  { label: "GB%", derive: (r) => safeDiv(r.batted_ground_balls, r.batted_balls_in_play), invert: true, format: pct },
  { label: "LD%", derive: (r) => safeDiv(r.batted_line_drives, r.batted_balls_in_play), format: pct },
  { label: "FB%", derive: (r) => safeDiv(r.batted_fly_balls, r.batted_balls_in_play), format: pct },
];

void two; // (reserved for future metrics that need 2-decimal formatting)

// ───────────────────────────────────────────────────────────────────
// Historical-season mappers (Hitter Master / Pitching Master)
// ───────────────────────────────────────────────────────────────────
// These map a stored Hitter/Pitching Master row → the same metric value
// our pitch_log MetricDef.derive returns. Used for the year-over-year
// rows in the Stats page rate tables (2025/2024/2023/2022 alongside
// 2026 pitch_log row).
//
// A metric label that isn't in the map = no historical data → "—" in
// the table. That's expected for pitch-log-only metrics like
// IZ Whiff% / Zone% on the hitter side, or Strike% / Zone% on the
// pitcher side, which Hitter/Pitching Master don't store.

// Hitter Master / Pitching Master store rates as 0-100 percentages
// (e.g. `75` = 75%), but our pct() formatter expects 0-1 decimals (and
// multiplies by 100 itself). Divide by 100 here to normalize. Non-rate
// fields (Avg EV, Stuff+) pass through unchanged.
const fromPct = (v: number | null) => (v == null ? null : v / 100);

export const HISTORICAL_HITTER_VALUES: Record<
  string,
  (r: HitterMasterHistoricalRow) => number | null
> = {
  "Contact%": (r) => fromPct(r.contact),
  "Chase%": (r) => fromPct(r.chase),
  "K%": (r) => fromPct(r.k_pct),
  "BB%": (r) => fromPct(r.bb),
  "Avg EV": (r) => r.avg_exit_velo,
  "Barrel%": (r) => fromPct(r.barrel),
  "LA 10-30%": (r) => fromPct(r.la_10_30),
  "GB%": (r) => fromPct(r.gb),
  "LD%": (r) => fromPct(r.line_drive),
};

export const HISTORICAL_PITCHER_VALUES: Record<
  string,
  (r: PitcherMasterHistoricalRow) => number | null
> = {
  "BB%": (r) => fromPct(r.bb_pct),
  "Whiff%": (r) => fromPct(r.miss_pct),
  "Chase%": (r) => fromPct(r.chase_pct),
  "IZ Whiff%": (r) => fromPct(r.in_zone_whiff_pct),
  "Stuff+": (r) => r.stuff_plus,
  "Contact% Allowed": (r) =>
    r.miss_pct != null ? 1 - r.miss_pct / 100 : null,
};


// ───────────────────────────────────────────────────────────────────
// Hitter per-pitch-type batting line (Savant "vs FB / vs SL" panel)
// ───────────────────────────────────────────────────────────────────

export interface HitterPitchTypeBreakdown {
  pitchType: string;
  pitches: number;
  avg: number | null;
  obp: number | null;
  slg: number | null;
  ops: number | null;
  iso: number | null;
  whiffPct: number | null;
  chasePct: number | null;
  hardHitPct: number | null;
  avgEv: number | null;
}

export function deriveHitterPitchTypeBreakdowns(
  rows: PitchLogHitterByPitchTypeRow[],
): HitterPitchTypeBreakdown[] {
  return rows.map((r) => {
    const hits = r.hits_single + r.hits_double + r.hits_triple + r.hits_hr;
    const tb = r.hits_single + 2 * r.hits_double + 3 * r.hits_triple + 4 * r.hits_hr;
    const avg = safeDiv(hits, r.ab);
    const obp = safeDiv(hits + r.bb + r.hbp, r.ab + r.bb + r.hbp);
    const slg = safeDiv(tb, r.ab);
    return {
      pitchType: r.pitch_type_reclassified,
      pitches: r.pitches,
      avg,
      obp,
      slg,
      ops: obp !== null && slg !== null ? obp + slg : null,
      iso: avg !== null && slg !== null ? slg - avg : null,
      whiffPct: safeDiv(r.whiffs, r.swings),
      chasePct: safeDiv(r.chases, r.pitches - r.in_zone),
      hardHitPct: safeDiv(r.batted_hard_hit, r.batted_balls_in_play),
      avgEv: safeDiv(r.ev_sum, r.batted_balls_with_ev),
    };
  });
}

export function derivePitchTypeBreakdowns(
  rows: PitchLogByPitchTypeRow[],
): PitchTypeBreakdown[] {
  const totalPitches = rows.reduce((sum, r) => sum + r.pitches, 0);
  return rows.map((r) => ({
    pitchType: r.pitch_type_reclassified,
    pitches: r.pitches,
    usagePct: safeDiv(r.pitches, totalPitches),
    velo: safeDiv(r.velo_sum, r.velo_pitches),
    ivb: safeDiv(r.ivb_sum, r.data_pitches),
    hb: safeDiv(r.hb_sum, r.data_pitches),
    extension: safeDiv(r.extension_sum, r.data_pitches),
    spin: safeDiv(r.spin_sum, r.data_pitches),
    relHeight: safeDiv(r.rel_height_sum, r.data_pitches),
    relSide: safeDiv(r.rel_side_sum, r.data_pitches),
    stuffPlus: safeDiv(r.stuff_plus_sum, r.data_pitches),
    whiffPct: safeDiv(r.whiffs, r.swings),
    chasePct: safeDiv(r.chases, r.pitches - r.in_zone),
    izWhiffPct: safeDiv(r.in_zone_whiffs, r.in_zone_swings),
    calledStrikePct: safeDiv(r.called_strikes, r.pitches),
    cswPct: safeDiv(r.called_strikes + r.whiffs, r.pitches),
  }));
}
