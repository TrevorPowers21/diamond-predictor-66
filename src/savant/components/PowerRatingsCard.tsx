import type { SavantHitterRow } from "@/savant/hooks/useSavantHitters";

const NAVY_CARD = "#0a1428";
const NAVY_BORDER = "#1f2d52";
const GOLD = "#D4AF37";

const fmtInt = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v)}`);

interface PowerRatingsCardProps {
  player: SavantHitterRow & {
    ba_plus?: number | null;
    obp_plus?: number | null;
    iso_plus?: number | null;
    overall_plus?: number | null;
  };
}

/**
 * 2025 internal power ratings card. Mirrors the PredictionCard tile style.
 * 100 = NCAA average, higher is better. Hidden if no ratings exist.
 */
export default function PowerRatingsCard({ player }: PowerRatingsCardProps) {
  const tiles: Array<{ label: string; value: number | null | undefined }> = [
    { label: "BA+", value: player.ba_plus },
    { label: "OBP+", value: player.obp_plus },
    { label: "ISO+", value: player.iso_plus },
    { label: "Overall+", value: player.overall_plus },
  ];

  const hasAny = tiles.some((t) => t.value != null);
  if (!hasAny) return null;

  return (
    <section
      className="border"
      style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
    >
      <div className="flex items-baseline justify-between border-b px-6 py-3" style={{ borderColor: NAVY_BORDER }}>
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: GOLD }} />
          <h2 className="text-xs font-bold uppercase tracking-[0.22em]" style={{ color: GOLD, fontFamily: "'Oswald', sans-serif" }}>
            {player.Season ?? ""} Power Ratings
          </h2>
        </div>
        <div className="text-[11px] uppercase tracking-wider text-white/55">100 · NCAA Avg</div>
      </div>
      <div className="grid grid-cols-2 gap-px sm:grid-cols-4" style={{ backgroundColor: NAVY_BORDER }}>
        {tiles.map((t) => {
          const isOverall = t.label === "Overall+";
          return (
            <div
              key={t.label}
              className="px-3 py-3 transition-colors duration-200 hover:bg-white/[0.03]"
              style={{ backgroundColor: NAVY_CARD }}
            >
              <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#D4AF37]/80">
                {t.label}
              </div>
              <div
                className="mt-1 font-[Oswald] text-2xl font-bold tabular-nums"
                style={{
                  color: isOverall ? GOLD : "#FFFFFF",
                  textShadow: isOverall
                    ? "0 0 12px rgba(212,175,55,0.35)"
                    : "0 0 12px rgba(212,175,55,0.12)",
                }}
              >
                {fmtInt(t.value)}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
