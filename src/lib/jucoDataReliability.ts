/**
 * JUCO data reliability — derived from TrackMan pitches captured per player.
 *
 * JUCO TrackMan coverage is selection-biased: only top events / venues have
 * the equipment. A player's `trackman_pitches` count is the truest available
 * proxy for "how much of their season was actually measured." Coaches need
 * this signal next to the projection so a green-tier .350 line reads
 * differently from a stats-only .350 line.
 *
 * Thresholds locked 2026-05-17. Verified bar is intentionally tight (~2% of
 * JUCO) — green should mean "trust this profile," not "well, more than zero."
 *
 * Pitches-per-PA in college baseball averages ~3.8, so:
 *   - 500 pitches ≈ 130 PA tracked = solid season-long coverage
 *   - 100 pitches ≈ 26 PA tracked = enough to register a profile direction
 *   - <100 pitches = noise, treat as stats-only
 */

export type DataReliabilityTier = "verified" | "partial" | "stats-only" | "none";

export type DataReliabilityRead = {
  tier: DataReliabilityTier;
  label: string;
  description: string;
  /** Tailwind class hint for the chip background — keep brand-neutral. */
  chipClass: string;
  trackmanPitches: number;
  pa: number | null;
  coverageRatio: number | null;
};

const NONE: DataReliabilityRead = {
  tier: "none",
  label: "No TrackMan",
  description: "Zero TrackMan pitches captured. Stats-only profile — no biometric verification of swing decisions, contact quality, or exit velo.",
  chipClass: "bg-zinc-700/30 text-zinc-300 ring-1 ring-zinc-500/30",
  trackmanPitches: 0,
  pa: null,
  coverageRatio: null,
};

export function computeDataReliability(
  trackmanPitches: number | null | undefined,
  pa: number | null | undefined,
): DataReliabilityRead {
  const tm = Number.isFinite(Number(trackmanPitches)) ? Number(trackmanPitches) : 0;
  const paCount = Number.isFinite(Number(pa)) ? Number(pa) : null;
  const ratio = paCount && paCount > 0 ? tm / paCount : null;
  const base = { trackmanPitches: tm, pa: paCount, coverageRatio: ratio };

  if (tm >= 500) {
    return {
      ...base,
      tier: "verified",
      label: "Verified",
      description: "Heavy TrackMan coverage. Scouting metrics are well-supported by event volume; treat projection as a high-confidence baseline.",
      chipClass: "bg-emerald-600/15 text-emerald-400 ring-1 ring-emerald-500/30",
    };
  }
  if (tm >= 100) {
    return {
      ...base,
      tier: "partial",
      label: "Partial",
      description: "Some TrackMan coverage. Scouting direction is established but sample is light; profile may swing on additional data.",
      chipClass: "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30",
    };
  }
  if (tm >= 1) {
    return {
      ...base,
      tier: "stats-only",
      label: "Stats Only",
      description: "Minimal TrackMan capture. Effectively stats-only — chase, EV, barrel% are noise-level. Project carefully.",
      chipClass: "bg-rose-600/15 text-rose-400 ring-1 ring-rose-500/30",
    };
  }
  return NONE;
}

/** Render-friendly: "234 TrackMan pitches across 198 PA (1.18 p/PA)". */
export function formatReliabilityDetail(r: DataReliabilityRead): string {
  if (r.tier === "none") return "0 TrackMan pitches captured";
  const ratio = r.coverageRatio != null ? `${r.coverageRatio.toFixed(2)} p/PA` : "no PA";
  return `${r.trackmanPitches.toLocaleString()} TrackMan pitches across ${r.pa ?? 0} PA (${ratio})`;
}
