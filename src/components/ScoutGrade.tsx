// A single scouting-grade tile: raw stat + 0–100 percentile + tier label,
// color-coded by the percentile. Shared by the hitter Projections page and the
// player-hub Overview. Value 0/null renders as a muted N/A tile.

function ordinalSuffix(n: number): string {
  const r = Math.round(n);
  const mod100 = r % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${r}th`;
  switch (r % 10) {
    case 1: return `${r}st`;
    case 2: return `${r}nd`;
    case 3: return `${r}rd`;
    default: return `${r}th`;
  }
}

function ordinalSuffixOnly(n: number): string {
  const r = Math.round(n);
  const mod100 = r % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (r % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

export function ScoutGrade({ label, value, fullLabel, rawStat, unit }: {
  label: string;
  value: number | null;
  fullLabel: string;
  rawStat?: number | null;
  unit?: string;
}) {
  // Treat 0 as missing — percentile scores are 0-100, and a literal 0 is almost
  // always a missing-data sentinel (e.g., JUCO arms whose pipeline computed
  // ev_score from an exit_vel that defaulted to 0). Showing "0 / Poor" for
  // someone we have no data on is more misleading than just rendering N/A.
  if (value == null || value === 0) {
    return (
      <div className="rounded-lg border border-[#162241] bg-[#0d1a30] p-3">
        <div className="text-xs font-medium text-[#8a94a6]">{fullLabel}</div>
        <div className="text-2xl font-bold mt-1 text-[#8a94a6]">—</div>
        <div className="text-xs font-semibold mt-0.5 text-[#5a6478]">N/A</div>
      </div>
    );
  }
  const tier =
    value >= 90 ? "bg-[hsl(142,71%,45%,0.15)] text-[hsl(142,71%,45%)] border-[hsl(142,71%,45%,0.30)]" :
    value >= 75 ? "bg-[hsl(188,90%,42%,0.15)] text-[hsl(188,90%,48%)] border-[hsl(188,90%,42%,0.30)]" :
    value >= 60 ? "bg-[hsl(200,80%,50%,0.12)] text-[hsl(200,80%,42%)] border-[hsl(200,80%,50%,0.25)]" :
    value >= 45 ? "bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))] border-[hsl(var(--warning)/0.3)]" :
    value >= 35 ? "bg-[hsl(25,90%,50%,0.12)] text-[hsl(25,90%,38%)] border-[hsl(25,90%,50%,0.25)]" :
    "bg-destructive/15 text-destructive border-destructive/30";
  const grade =
    value >= 90 ? "Elite" :
    value >= 75 ? "Plus-Plus" :
    value >= 60 ? "Plus" :
    value >= 45 ? "Average" :
    value >= 35 ? "Below Avg" : "Poor";
  return (
    <div className={`rounded-lg border p-3 ${tier}`}>
      <div className="text-xs font-medium opacity-80">{fullLabel}</div>
      {rawStat != null ? (
        <>
          <div className="text-2xl font-bold mt-1 leading-none">
            {rawStat.toFixed(1)}
            <span className="text-sm font-semibold opacity-75 ml-0.5">{unit ?? "%"}</span>
          </div>
          <div className="border-t border-current opacity-20 mt-1.5 mb-1" />
          <div className="text-xs font-bold leading-tight">{ordinalSuffix(value)} percentile</div>
          <div className="text-[10px] font-medium opacity-65 leading-tight">{grade}</div>
        </>
      ) : (
        <>
          <div className="text-2xl font-bold mt-1 leading-none">
            {Math.round(value)}<span className="text-sm font-semibold opacity-65 ml-0.5">{ordinalSuffixOnly(value)}</span>
          </div>
          <div className="text-[10px] font-medium opacity-45 mt-0.5 leading-none">percentile</div>
          <div className="border-t border-current opacity-20 mt-1.5 mb-1" />
          <div className="text-xs font-semibold leading-tight">{grade}</div>
        </>
      )}
    </div>
  );
}
