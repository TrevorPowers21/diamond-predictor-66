import type { PlayerPredictionRow } from "@/savant/hooks/usePlayerPrediction";

const NAVY_CARD = "#0a1428";
const NAVY_BORDER = "#1f2d52";
const GOLD = "#D4AF37";

const fmt3 = (v: number | null) => (v == null ? "—" : v.toFixed(3));
const fmtInt = (v: number | null) => (v == null ? "—" : `${Math.round(v)}`);

interface PredictionCardProps {
  prediction: PlayerPredictionRow | null;
  targetSeason?: number;
}

/**
 * Next-season projection card for the savant hitter profile. Renders the
 * model's projected slash line + key derived metrics.
 *
 * Hidden when the player has no prediction (departed players, low-PA seasons,
 * or pure pitchers without a hitter row).
 */
export default function PredictionCard({ prediction, targetSeason = 2026 }: PredictionCardProps) {
  if (!prediction || prediction.p_avg == null) return null;

  const tiles: Array<{ label: string; value: number | null; format: (v: number | null) => string }> = [
    { label: "AVG", value: prediction.p_avg, format: fmt3 },
    { label: "OBP", value: prediction.p_obp, format: fmt3 },
    { label: "SLG", value: prediction.p_slg, format: fmt3 },
    { label: "OPS", value: prediction.p_ops, format: fmt3 },
    { label: "ISO", value: prediction.p_iso, format: fmt3 },
    { label: "WRC+", value: prediction.p_wrc_plus, format: fmtInt },
  ];

  return (
    <section
      className="border"
      style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
    >
      <div className="flex items-baseline justify-between border-b px-6 py-3" style={{ borderColor: NAVY_BORDER }}>
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: GOLD }} />
          <h2 className="text-xs font-bold uppercase tracking-[0.22em]" style={{ color: GOLD, fontFamily: "'Oswald', sans-serif" }}>
            {targetSeason} Projection
          </h2>
        </div>
        {prediction.class_transition && (
          <div className="text-[11px] uppercase tracking-wider text-white/55">
            Class · {prediction.class_transition}
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 gap-px sm:grid-cols-6" style={{ backgroundColor: NAVY_BORDER }}>
        {tiles.map((t) => (
          <div
            key={t.label}
            className="px-3 py-3 transition-colors duration-200 hover:bg-white/[0.03]"
            style={{ backgroundColor: NAVY_CARD }}
          >
            <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#D4AF37]/80">
              {t.label}
            </div>
            <div
              className="mt-1 font-[Oswald] text-2xl font-bold tabular-nums text-white"
              style={{ textShadow: "0 0 12px rgba(212,175,55,0.15)" }}
            >
              {t.format(t.value)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
