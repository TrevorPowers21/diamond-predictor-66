import { percentileColor, percentileMarkerColor } from "@/savant/lib/percentile";

interface PercentileBarProps {
  label: string;
  value: number | null;
  percentile: number | null;
  format?: (v: number) => string;
}

/**
 * Single Savant-style percentile row: label, filled bar from 0 → percentile
 * in the rainbow color, circle marker with the percentile number at the end,
 * raw value on the right. Stacks vertically into a rainbow panel.
 *
 * Per RSTR IQ guardrails: no skeletons or spinners. Missing data renders dim.
 */
export default function PercentileBar({ label, value, percentile, format }: PercentileBarProps) {
  const hasData = value != null && percentile != null;
  const fillColor = hasData ? percentileColor(percentile!) : "#3a3a3a";
  const markerColor = hasData ? percentileMarkerColor(percentile!) : "#3a3a3a";
  const display = hasData ? (format ? format(value!) : String(value)) : "—";
  const pct = hasData ? Math.max(2, percentile!) : 0; // floor to keep marker visible at 0

  return (
    <div className="grid grid-cols-[130px_1fr_60px] items-center gap-3 py-2">
      <div className="whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.12em] text-white">
        {label}
      </div>

      <div className="relative h-3 w-full rounded-full bg-white/10">
        {hasData && (
          <>
            {/* filled portion */}
            <div
              className="absolute left-0 top-0 h-full rounded-full transition-all duration-200"
              style={{ width: `${pct}%`, backgroundColor: fillColor }}
            />
            {/* end-cap marker with percentile number */}
            <div
              className="absolute top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-[12px] font-extrabold text-white shadow-md"
              style={{
                left: `${pct}%`,
                backgroundColor: markerColor,
                borderColor: "#0D1B3E",
              }}
            >
              {percentile}
            </div>
          </>
        )}
      </div>

      <div className="text-right text-sm font-semibold tabular-nums text-white">
        {display}
      </div>
    </div>
  );
}
