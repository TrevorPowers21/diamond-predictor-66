import { Link } from "react-router-dom";

const NAVY_CARD = "#0a1428";
const NAVY_DEEP = "#040810";
const NAVY_BORDER = "#162241";
const GOLD = "#D4AF37";
const GOLD_DIM = "#A08820";

export interface LeaderboardEntry {
  id: string | null;
  name: string;
  team: string | null;
  value: number | null;
  href?: string | null;
}

interface LeaderboardCardProps {
  title: string;
  subtitle?: string;
  unit?: string;
  entries: LeaderboardEntry[];
  format: (v: number) => string;
  /** When true, lower values rank higher (e.g. ERA, chase%) */
  invert?: boolean;
  emptyMessage?: string;
}

/**
 * Leaderboard card for the Savant home. Shows the top 5 of a single metric
 * with rank, name, team, and a confidently-sized value. The #1 row is
 * elevated with a gold accent stripe and brighter type. Click-through to
 * the player profile via entry.href.
 */
export default function LeaderboardCard({
  title,
  subtitle,
  unit,
  entries,
  format,
  invert = false,
  emptyMessage = "No data yet",
}: LeaderboardCardProps) {
  const sorted = [...entries]
    .filter((e) => e.value != null && Number.isFinite(e.value))
    .sort((a, b) => {
      const av = a.value as number;
      const bv = b.value as number;
      return invert ? av - bv : bv - av;
    })
    .slice(0, 5);

  return (
    <div
      className="group relative overflow-hidden border transition-all duration-300 hover:-translate-y-0.5 hover:border-[#D4AF37]/50 hover:shadow-[0_8px_24px_-12px_rgba(212,175,55,0.25)]"
      style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
    >
      {/* Gold accent stripe along top edge */}
      <div
        className="absolute inset-x-0 top-0 h-[2px] opacity-60 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)` }}
      />

      {/* Header */}
      <div
        className="px-5 py-4"
        style={{
          borderBottom: `1px solid ${NAVY_BORDER}`,
          background: `linear-gradient(180deg, ${NAVY_CARD} 0%, ${NAVY_DEEP} 100%)`,
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div
              className="font-[Oswald] text-base font-bold uppercase tracking-[0.18em] leading-none"
              style={{ color: GOLD }}
            >
              {title}
            </div>
            {subtitle && (
              <div className="mt-1.5 text-[10px] uppercase tracking-wider text-white/40">
                {subtitle}
              </div>
            )}
          </div>
          {unit && (
            <div className="shrink-0 rounded-sm border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white/55"
                 style={{ borderColor: NAVY_BORDER }}>
              {unit}
            </div>
          )}
        </div>
      </div>

      {/* Rows */}
      <div>
        {sorted.length === 0 && (
          <div className="px-5 py-8 text-center text-xs italic text-white/40">{emptyMessage}</div>
        )}
        {sorted.map((entry, idx) => {
          const isTop = idx === 0;
          const row = (
            <div
              className="relative flex items-center gap-3 px-5 py-3 transition-colors duration-200 hover:bg-white/[0.04]"
              style={{
                borderTop: idx === 0 ? "none" : `1px solid ${NAVY_BORDER}`,
                background: isTop ? "linear-gradient(90deg, rgba(212,175,55,0.08), transparent)" : "transparent",
              }}
            >
              {/* Rank tile */}
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center font-mono text-xs font-bold tabular-nums"
                style={{
                  color: isTop ? "#0a1428" : "rgba(255,255,255,0.55)",
                  backgroundColor: isTop ? GOLD : "transparent",
                  border: isTop ? "none" : `1px solid ${NAVY_BORDER}`,
                }}
              >
                {idx + 1}
              </div>

              {/* Name + team */}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-white transition-colors duration-200 group-hover:text-white">
                  {entry.name}
                </div>
                <div className="truncate text-[10px] uppercase tracking-wider text-white/45">
                  {entry.team || "—"}
                </div>
              </div>

              {/* Value */}
              <div
                className="font-[Oswald] text-2xl font-bold tabular-nums leading-none"
                style={{
                  color: isTop ? GOLD : "#FFFFFF",
                  textShadow: isTop ? "0 0 12px rgba(212,175,55,0.35)" : "none",
                }}
              >
                {entry.value != null ? format(entry.value) : "—"}
              </div>
            </div>
          );
          return entry.href && entry.id ? (
            <Link key={`${title}-${entry.id}-${idx}`} to={entry.href} className="block cursor-pointer">
              {row}
            </Link>
          ) : (
            <div key={`${title}-${entry.id ?? entry.name}-${idx}`}>{row}</div>
          );
        })}
      </div>
    </div>
  );
}
