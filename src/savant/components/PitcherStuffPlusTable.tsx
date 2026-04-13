import { useEffect, useMemo, useRef, useState } from "react";
import type { PitcherStuffPlusRow } from "@/savant/hooks/usePitcherStuffPlus";

const NAVY_CARD = "#0a1428";
const NAVY_BORDER = "#1f2d52";
const NAVY_BG = "#040810";
const GOLD = "#D4AF37";

const fmt1 = (v: number | null) => (v == null ? "—" : v.toFixed(1));
const fmt2 = (v: number | null) => (v == null ? "—" : v.toFixed(2));
const fmtInt = (v: number | null) => (v == null ? "—" : `${Math.round(v)}`);
const fmtPct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);

interface PitcherStuffPlusTableProps {
  rows: PitcherStuffPlusRow[];
  selectedSeason: number;
  availableSeasons: number[];
  onSeasonChange: (s: number) => void;
}

/**
 * Per-pitch Stuff+ inputs table for the savant pitcher profile.
 * Reads from `pitcher_stuff_plus_inputs` (new Supabase table the user is
 * still building manually). Empty state until populated.
 *
 * Includes a season picker matching the percentile rankings dropdown style.
 * Only shows seasons that have data — going forward only, no historical
 * backfill (Stuff+ data didn't exist before 2025).
 */
export default function PitcherStuffPlusTable({
  rows,
  selectedSeason,
  availableSeasons,
  onSeasonChange,
}: PitcherStuffPlusTableProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const opts = useMemo(
    () => (availableSeasons.length > 0 ? availableSeasons : [selectedSeason]),
    [availableSeasons, selectedSeason],
  );

  return (
    <section className="border" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
      <div className="flex items-center gap-2 border-b px-6 py-3" style={{ borderColor: NAVY_BORDER }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: GOLD }} />
        <h2
          className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em]"
          style={{ color: GOLD, fontFamily: "'Oswald', sans-serif" }}
        >
          {/* Inline season picker matches the percentile rankings header */}
          <div ref={ref} className="relative">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex cursor-pointer items-center gap-1 bg-transparent text-xs font-bold uppercase tracking-[0.22em] text-[#D4AF37] transition-colors duration-150 hover:text-[#E8C24E] focus:outline-none"
              style={{ fontFamily: "'Oswald', sans-serif" }}
            >
              <span>{selectedSeason}</span>
              <svg
                width="8"
                height="8"
                viewBox="0 0 12 12"
                fill="none"
                className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                style={{ color: GOLD }}
              >
                <path
                  d="M2 4l4 4 4-4"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {open && (
              <div
                className="absolute left-0 top-full z-20 mt-1 min-w-full overflow-hidden border shadow-[0_8px_24px_-12px_rgba(0,0,0,0.6)]"
                style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
              >
                {opts.map((s) => {
                  const isActive = s === selectedSeason;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        onSeasonChange(s);
                        setOpen(false);
                      }}
                      className="block w-full cursor-pointer px-4 py-2 text-left font-[Oswald] text-sm font-bold leading-none transition-colors duration-150 hover:bg-[#D4AF37]/[0.1]"
                      style={{
                        color: isActive ? GOLD : "#FFFFFF",
                        backgroundColor: isActive ? "rgba(212,175,55,0.06)" : "transparent",
                      }}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          Stuff+
        </h2>
      </div>

      {rows.length === 0 ? (
        <div className="px-6 py-10 text-center text-xs italic text-white/45">
          No Stuff+ data for {selectedSeason} yet. Populated as the input table fills in.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-white">
                <th className="px-4 py-2">Pitch</th>
                <th className="px-3 py-2 text-right">#</th>
                <th className="px-3 py-2 text-right">Velo</th>
                <th className="px-3 py-2 text-right">IVB</th>
                <th className="px-3 py-2 text-right">HB</th>
                <th className="px-3 py-2 text-right">Rel H</th>
                <th className="px-3 py-2 text-right">Rel S</th>
                <th className="px-3 py-2 text-right">Ext</th>
                <th className="px-3 py-2 text-right">Spin</th>
                <th className="px-3 py-2 text-right">VAA</th>
                <th className="px-3 py-2 text-right">Whiff</th>
                <th className="px-3 py-2 pr-4 text-right">Stuff+</th>
              </tr>
            </thead>
            <tbody>
              {rows.filter((r) => (r.pitches ?? 0) >= 5).map((r, i) => (
                <tr
                  key={`${r.pitch_type}-${r.hand}-${i}`}
                  className="border-t text-white transition-colors hover:bg-white/[0.025]"
                  style={{ borderColor: NAVY_BORDER }}
                >
                  <td className="px-4 py-2 font-semibold text-white">
                    {r.rstr_pitch_class ?? r.pitch_type}
                    {r.hand && <span className="ml-1 text-[10px] text-white/55">vs {r.hand}</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.pitches)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt1(r.velocity)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt1(r.ivb)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt1(r.hb)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt2(r.rel_height)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt2(r.rel_side)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt2(r.extension)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.spin)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-white/50">
                    {(r.rstr_pitch_class ?? r.pitch_type) === "4S FB" ? fmt1(r.vaa) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPct(r.whiff_pct)}</td>
                  <td className="px-3 py-2 pr-4 text-right tabular-nums font-semibold" style={{ color: r.stuff_plus != null ? "#D4AF37" : undefined }}>
                    {r.stuff_plus != null ? fmtInt(r.stuff_plus) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
