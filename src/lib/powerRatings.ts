/**
 * Shared power rating computation — single source of truth.
 * Computes BA+, OBP+, ISO+ (and overall+) from raw sub-metrics in Hitter Master.
 * Computes ERA+, FIP+, WHIP+, K9+, BB9+, HR9+ from raw pitching metrics in Pitching Master.
 */

// ─── Math helpers ──────────────────────────────────────────────────────
const erf = (x: number) => {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
};

/** CDF-based percentile score: 0–100 scale, 50 = average */
export const scoreFromNormal = (x: number | null, mean: number, sd: number, invert = false): number | null => {
  if (x == null || sd <= 0) return null;
  const cdf = 0.5 * (1 + erf((x - mean) / (sd * Math.SQRT2)));
  const pct = cdf * 100;
  return invert ? 100 - pct : pct;
};

// ─── Hitter sub-metric defaults (NCAA D1 2025) ────────────────────────
const HITTER_DEFAULTS = {
  contact:    { mean: 77.1, sd: 6.6 },
  lineDrive:  { mean: 20.9, sd: 4.31 },
  avgExitVelo:{ mean: 86.2, sd: 4.28 },
  popUp:      { mean: 7.9,  sd: 3.37, invert: true },
  bb:         { mean: 11.4, sd: 3.57 },
  chase:      { mean: 23.1, sd: 5.58, invert: true },
  barrel:     { mean: 17.3, sd: 7.89 },
  ev90:       { mean: 103.1, sd: 3.97 },
  pull:       { mean: 36.5, sd: 8.03 },
  la10_30:    { mean: 29,   sd: 6.81 },
  gb:         { mean: 43.2, sd: 8.0,  invert: true },
} as const;

export type HitterSubMetrics = {
  contact: number | null;
  lineDrive: number | null;
  avgExitVelo: number | null;
  popUp: number | null;
  bb: number | null;
  chase: number | null;
  barrel: number | null;
  ev90: number | null;
  pull: number | null;
  la10_30: number | null;
  gb: number | null;
};

export type HitterScores = {
  contactScore: number | null;
  lineDriveScore: number | null;
  avgEVScore: number | null;
  popUpScore: number | null;
  bbScore: number | null;
  chaseScore: number | null;
  barrelScore: number | null;
  ev90Score: number | null;
  pullScore: number | null;
  laScore: number | null;
  gbScore: number | null;
};

export type HitterPowerRatings = HitterScores & {
  baPlus: number | null;
  obpPlus: number | null;
  isoPlus: number | null;
  overallPlus: number | null;
};

/** Compute all hitter power ratings from raw sub-metrics */
export function computeHitterPowerRatings(raw: HitterSubMetrics): HitterPowerRatings {
  const d = HITTER_DEFAULTS;
  const contactScore = scoreFromNormal(raw.contact, d.contact.mean, d.contact.sd);
  const lineDriveScore = scoreFromNormal(raw.lineDrive, d.lineDrive.mean, d.lineDrive.sd);
  const avgEVScore = scoreFromNormal(raw.avgExitVelo, d.avgExitVelo.mean, d.avgExitVelo.sd);
  const popUpScore = scoreFromNormal(raw.popUp, d.popUp.mean, d.popUp.sd, true);
  const bbScore = scoreFromNormal(raw.bb, d.bb.mean, d.bb.sd);
  const chaseScore = scoreFromNormal(raw.chase, d.chase.mean, d.chase.sd, true);
  const barrelScore = scoreFromNormal(raw.barrel, d.barrel.mean, d.barrel.sd);
  const ev90Score = scoreFromNormal(raw.ev90, d.ev90.mean, d.ev90.sd);
  const pullScore = scoreFromNormal(raw.pull, d.pull.mean, d.pull.sd);
  const laScore = scoreFromNormal(raw.la10_30, d.la10_30.mean, d.la10_30.sd);
  const gbScore = scoreFromNormal(raw.gb, d.gb.mean, d.gb.sd, true);

  const baPower = contactScore == null || lineDriveScore == null || avgEVScore == null || popUpScore == null
    ? null : (0.4 * contactScore) + (0.25 * lineDriveScore) + (0.2 * avgEVScore) + (0.15 * popUpScore);
  const obpPower = contactScore == null || lineDriveScore == null || avgEVScore == null || popUpScore == null || bbScore == null || chaseScore == null
    ? null : (0.35 * contactScore) + (0.2 * lineDriveScore) + (0.15 * avgEVScore) + (0.1 * popUpScore) + (0.15 * bbScore) + (0.05 * chaseScore);
  const isoPower = barrelScore == null || ev90Score == null || pullScore == null || laScore == null || gbScore == null
    ? null : (0.45 * barrelScore) + (0.3 * ev90Score) + (0.15 * pullScore) + (0.05 * laScore) + (0.05 * gbScore);

  const toPlus = (v: number | null) => (v == null ? null : (v / 50) * 100);
  const baPlus = toPlus(baPower);
  const obpPlus = toPlus(obpPower);
  const isoPlus = toPlus(isoPower);
  const overallPlus = baPlus == null || obpPlus == null || isoPlus == null
    ? null : (0.25 * baPlus) + (0.4 * obpPlus) + (0.35 * isoPlus);

  return {
    contactScore, lineDriveScore, avgEVScore, popUpScore, bbScore, chaseScore,
    barrelScore, ev90Score, pullScore, laScore, gbScore,
    baPlus, obpPlus, isoPlus, overallPlus,
  };
}

// ─── Pitching sub-metric defaults (NCAA D1 2025) ──────────────────────
const PITCHING_DEFAULTS = {
  miss_pct:          { mean: 22.9,  sd: 5.476 },
  bb_pct:            { mean: 11.3,  sd: 2.920, invert: true },
  hard_hit_pct:      { mean: 36,    sd: 6.474, invert: true },
  in_zone_whiff_pct: { mean: 16.4,  sd: 4.299 },
  chase_pct:         { mean: 23.1,  sd: 4.619 },
  barrel_pct:        { mean: 17.3,  sd: 4.988, invert: true },
  line_pct:          { mean: 20.9,  sd: 3.581, invert: true },
  exit_vel:          { mean: 86.2,  sd: 2.363, invert: true },
  ground_pct:        { mean: 43.2,  sd: 6.959 },
  in_zone_pct:       { mean: 47.2,  sd: 3.325 },
  vel_90th:          { mean: 103.1, sd: 1.767 },
  h_pull_pct:        { mean: 36.5,  sd: 5.357, invert: true },
  la_10_30_pct:      { mean: 29,    sd: 5.774, invert: true },
} as const;

export type PitchingSubMetrics = {
  miss_pct: number | null;
  bb_pct: number | null;
  hard_hit_pct: number | null;
  in_zone_whiff_pct: number | null;
  chase_pct: number | null;
  barrel_pct: number | null;
  line_pct: number | null;
  exit_vel: number | null;
  ground_pct: number | null;
  in_zone_pct: number | null;
  vel_90th: number | null;
  h_pull_pct: number | null;
  la_10_30_pct: number | null;
};

export type PitchingScores = {
  whiffScore: number | null;
  bbScore: number | null;
  hhScore: number | null;
  izWhiffScore: number | null;
  chaseScore: number | null;
  barrelScore: number | null;
  ldScore: number | null;
  evScore: number | null;
  gbScore: number | null;
  izScore: number | null;
  ev90Score: number | null;
  pullScore: number | null;
  laScore: number | null;
};

/** Compute pitching percentile scores from raw sub-metrics */
export function computePitchingScores(raw: PitchingSubMetrics): PitchingScores {
  const d = PITCHING_DEFAULTS;
  return {
    whiffScore:   scoreFromNormal(raw.miss_pct, d.miss_pct.mean, d.miss_pct.sd),
    bbScore:      scoreFromNormal(raw.bb_pct, d.bb_pct.mean, d.bb_pct.sd, true),
    hhScore:      scoreFromNormal(raw.hard_hit_pct, d.hard_hit_pct.mean, d.hard_hit_pct.sd, true),
    izWhiffScore: scoreFromNormal(raw.in_zone_whiff_pct, d.in_zone_whiff_pct.mean, d.in_zone_whiff_pct.sd),
    chaseScore:   scoreFromNormal(raw.chase_pct, d.chase_pct.mean, d.chase_pct.sd),
    barrelScore:  scoreFromNormal(raw.barrel_pct, d.barrel_pct.mean, d.barrel_pct.sd, true),
    ldScore:      scoreFromNormal(raw.line_pct, d.line_pct.mean, d.line_pct.sd, true),
    evScore:      scoreFromNormal(raw.exit_vel, d.exit_vel.mean, d.exit_vel.sd, true),
    gbScore:      scoreFromNormal(raw.ground_pct, d.ground_pct.mean, d.ground_pct.sd),
    izScore:      scoreFromNormal(raw.in_zone_pct, d.in_zone_pct.mean, d.in_zone_pct.sd),
    ev90Score:    scoreFromNormal(raw.vel_90th, d.vel_90th.mean, d.vel_90th.sd),
    pullScore:    scoreFromNormal(raw.h_pull_pct, d.h_pull_pct.mean, d.h_pull_pct.sd, true),
    laScore:      scoreFromNormal(raw.la_10_30_pct, d.la_10_30_pct.mean, d.la_10_30_pct.sd, true),
  };
}

// ─── Pitching power rating weights ────────────────────────────────────
const ERA_WEIGHTS = {
  whiff: 0.23, bb: 0.17, hh: 0.07, izWhiff: 0.12, chase: 0.08, barrel: 0.12, stuff: 0.21,
};
const WHIP_WEIGHTS = { bb: 0.25, ld: 0.2, ev: 0.15, whiff: 0.25, gb: 0.1, chase: 0.05 };
const K9_WEIGHTS = { whiff: 0.35, stuff: 0.3, izWhiff: 0.25, chase: 0.1 };
const BB9_WEIGHTS = { bb: 0.55, iz: 0.3, chase: 0.15 };
const HR9_WEIGHTS = { barrel: 0.32, ev90: 0.24, gb: 0.18, pull: 0.14, la: 0.12 };
const FIP_WEIGHTS = { hr9: 0.45, bb9: 0.3, k9: 0.25 };

export type PitchingPowerRatings = PitchingScores & {
  eraPrPlus: number | null;
  fipPrPlus: number | null;
  whipPrPlus: number | null;
  k9PrPlus: number | null;
  bb9PrPlus: number | null;
  hr9PrPlus: number | null;
  overallPrPlus: number | null;
};

/** Compute pitching power ratings from raw sub-metrics. Stuff+ is optional —
 *  when missing, its weight redistributes proportionally to the other components
 *  rather than defaulting to a 50 (average) score, which previously suppressed
 *  ratings for players from sources that don't track Stuff+ (e.g., historical years). */
export function computePitchingPowerRatings(raw: PitchingSubMetrics, stuffPlus?: number | null): PitchingPowerRatings {
  const scores = computePitchingScores(raw);
  const s = (v: number | null) => v ?? 50; // fallback to 50 (average) when null
  const stuffScore = stuffPlus != null ? scoreFromNormal(stuffPlus, 100, 3.968) : null;

  // Weighted average that ignores items with null values entirely (instead of
  // substituting 50). The remaining weights renormalize automatically.
  const nws = (items: Array<{ v: number | null; w: number }>) => {
    const valid = items.filter((i) => i.v != null);
    const total = valid.reduce((a, i) => a + i.w, 0);
    return total > 0 ? valid.reduce((a, i) => a + ((i.v as number) * i.w), 0) / total : null;
  };

  const eraRaw = nws([
    { v: s(scores.whiffScore), w: ERA_WEIGHTS.whiff },
    { v: s(scores.bbScore), w: ERA_WEIGHTS.bb },
    { v: s(scores.hhScore), w: ERA_WEIGHTS.hh },
    { v: s(scores.izWhiffScore), w: ERA_WEIGHTS.izWhiff },
    { v: s(scores.chaseScore), w: ERA_WEIGHTS.chase },
    { v: s(scores.barrelScore), w: ERA_WEIGHTS.barrel },
    { v: stuffScore, w: ERA_WEIGHTS.stuff },
  ]);
  const eraPrPlus = eraRaw != null ? (eraRaw / 50) * 100 : null;

  const whipRaw = nws([
    { v: s(scores.bbScore), w: WHIP_WEIGHTS.bb },
    { v: s(scores.ldScore), w: WHIP_WEIGHTS.ld },
    { v: s(scores.evScore), w: WHIP_WEIGHTS.ev },
    { v: s(scores.whiffScore), w: WHIP_WEIGHTS.whiff },
    { v: s(scores.gbScore), w: WHIP_WEIGHTS.gb },
    { v: s(scores.chaseScore), w: WHIP_WEIGHTS.chase },
  ]);
  const whipPrPlus = whipRaw != null ? (whipRaw / 50) * 100 : null;

  const k9Raw = nws([
    { v: s(scores.whiffScore), w: K9_WEIGHTS.whiff },
    { v: stuffScore, w: K9_WEIGHTS.stuff },
    { v: s(scores.izWhiffScore), w: K9_WEIGHTS.izWhiff },
    { v: s(scores.chaseScore), w: K9_WEIGHTS.chase },
  ]);
  const k9PrPlus = k9Raw != null ? (k9Raw / 50) * 100 : null;

  const bb9Raw = nws([
    { v: s(scores.bbScore), w: BB9_WEIGHTS.bb },
    { v: s(scores.izScore), w: BB9_WEIGHTS.iz },
    { v: s(scores.chaseScore), w: BB9_WEIGHTS.chase },
  ]);
  const bb9PrPlus = bb9Raw != null ? (bb9Raw / 50) * 100 : null;

  const hr9Raw = nws([
    { v: s(scores.barrelScore), w: HR9_WEIGHTS.barrel },
    { v: s(scores.ev90Score), w: HR9_WEIGHTS.ev90 },
    { v: s(scores.gbScore), w: HR9_WEIGHTS.gb },
    { v: s(scores.pullScore), w: HR9_WEIGHTS.pull },
    { v: s(scores.laScore), w: HR9_WEIGHTS.la },
  ]);
  const hr9PrPlus = hr9Raw != null ? (hr9Raw / 50) * 100 : null;

  const fipRaw = (hr9PrPlus != null && bb9PrPlus != null && k9PrPlus != null)
    ? nws([
        { v: hr9PrPlus, w: FIP_WEIGHTS.hr9 },
        { v: bb9PrPlus, w: FIP_WEIGHTS.bb9 },
        { v: k9PrPlus, w: FIP_WEIGHTS.k9 },
      ])
    : null;
  const fipPrPlus = fipRaw;

  const overallPrPlus = eraPrPlus != null && fipPrPlus != null
    ? (eraPrPlus + fipPrPlus) / 2
    : eraPrPlus ?? fipPrPlus;

  return {
    ...scores,
    eraPrPlus, fipPrPlus, whipPrPlus, k9PrPlus, bb9PrPlus, hr9PrPlus, overallPrPlus,
  };
}
