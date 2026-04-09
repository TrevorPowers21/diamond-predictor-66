import { Link } from "react-router-dom";

const NAVY_CARD = "#0D1B3E";
const NAVY_BORDER = "#1a2950";
const GOLD = "#D4AF37";

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
 * Compact leaderboard card for the Savant home page. Shows the top 5 of a
 * single metric with rank, name, team, and value. Click-through to player
 * profile via the entry href.
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
      className="border transition-colors duration-200 hover:border-[#D4AF37]/40"
      style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
    >
      <div className="border-b px-5 py-3" style={{ borderColor: NAVY_BORDER }}>
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.25em]" style={{ color: GOLD }}>
              {title}
            </div>
            {subtitle && (
              <div className="mt-0.5 text-[10px] uppercase tracking-wider text-white/45">{subtitle}</div>
            )}
          </div>
          {unit && (
            <div className="text-[10px] uppercase tracking-wider text-white/40">{unit}</div>
          )}
        </div>
      </div>
      <div className="divide-y" style={{ borderColor: NAVY_BORDER }}>
        {sorted.length === 0 && (
          <div className="px-5 py-6 text-center text-xs text-white/40">{emptyMessage}</div>
        )}
        {sorted.map((entry, idx) => {
          const rankColor = idx === 0 ? GOLD : "rgba(255,255,255,0.5)";
          const row = (
            <div
              className="group flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-white/[0.03]"
              style={{ borderColor: NAVY_BORDER }}
            >
              <div
                className="w-5 text-right font-mono text-xs font-bold tabular-nums"
                style={{ color: rankColor }}
              >
                {idx + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-white group-hover:text-[#D4AF37]">
                  {entry.name}
                </div>
                <div className="truncate text-[10px] uppercase tracking-wider text-white/45">
                  {entry.team || "—"}
                </div>
              </div>
              <div className="font-mono text-base font-bold tabular-nums text-white">
                {entry.value != null ? format(entry.value) : "—"}
              </div>
            </div>
          );
          return entry.href && entry.id ? (
            <Link key={`${title}-${entry.id}-${idx}`} to={entry.href}>
              {row}
            </Link>
          ) : (
            <div key={`${title}-${entry.id ?? entry.name}-${idx}`} style={{ borderColor: NAVY_BORDER }}>
              {row}
            </div>
          );
        })}
      </div>
    </div>
  );
}
