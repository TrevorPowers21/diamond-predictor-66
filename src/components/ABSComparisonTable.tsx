/**
 * ABS Comparison Table — Georgia-only.
 *
 * Shows each player's plate-discipline + contact stats under the current
 * NCAA strike zone alongside the new ABS (Automated Ball-Strike) zone
 * coming to the SEC. The two columns sit side-by-side with a delta column
 * so coaches can see at a glance how a target's profile shifts.
 *
 * Data lives in two new tables (abs_hitter_stats, abs_pitcher_stats) keyed
 * on (source_player_id, season). JUCO players never get rows there — the
 * comparison doesn't apply. Until the CSV lands, every player will return
 * zero rows and this component renders nothing.
 *
 * Gates:
 *   - Customer team must be Georgia (effective school).
 *   - source_player_id must be set on the player.
 *   - Row must exist for the (source_player_id, season) pair, otherwise
 *     the component hides itself entirely (no half-baked panel).
 */
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { supabase } from "@/integrations/supabase/client";
import { useEffectiveSchool } from "@/hooks/useEffectiveSchool";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const GEORGIA_SCHOOL_NAME = "Georgia";
const DEFAULT_SEASON = 2026;

type HitterRow = {
  chase_pct: number | null;
  csw_pct: number | null;
  contact_pct: number | null;
  in_zone_contact_pct: number | null;
  abs_chase_pct: number | null;
  abs_csw_pct: number | null;
  abs_contact_pct: number | null;
  abs_in_zone_contact_pct: number | null;
  avg_exit_velo: number | null;
  ev_in_zone: number | null;
  ev_outskirts: number | null;
  barrel_pct: number | null;
  abs_avg_exit_velo: number | null;
  abs_ev_in_zone: number | null;
  abs_ev_outskirts: number | null;
  abs_barrel_pct: number | null;
};

type PitcherRow = {
  csw_pct: number | null;
  strike_pct: number | null;
  in_zone_pct: number | null;
  abs_csw_pct: number | null;
  abs_strike_pct: number | null;
  abs_in_zone_pct: number | null;
};

type Row = { label: string; current: number | null; abs: number | null; suffix?: string; decimals?: number };

export function ABSComparisonTable(props: {
  sourcePlayerId: string | null | undefined;
  playerType: "hitter" | "pitcher";
  season?: number;
}) {
  const { sourcePlayerId, playerType } = props;
  const season = props.season ?? DEFAULT_SEASON;
  const { schoolName } = useEffectiveSchool();
  const isGeorgia = schoolName === GEORGIA_SCHOOL_NAME;

  // TEMP layout preview — append ?abs_preview=1 to any profile URL to
  // bypass the Georgia gate AND the empty-data gate, rendering the table
  // with placeholder numbers. Remove before merging the data-load CSV.
  const [searchParams] = useSearchParams();
  const previewMode = searchParams.get("abs_preview") === "1";

  const { data, isLoading } = useQuery({
    queryKey: ["abs-stats", playerType, sourcePlayerId, season],
    enabled: isGeorgia && !!sourcePlayerId,
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!sourcePlayerId) return null;
      const table = playerType === "hitter" ? "abs_hitter_stats" : "abs_pitcher_stats";
      const { data, error } = await (supabase as any)
        .from(table)
        .select("*")
        .eq("source_player_id", sourcePlayerId)
        .eq("season", season)
        .maybeSingle();
      if (error) {
        // Table may not exist yet in this environment — fail silently
        // and hide the component.
        console.debug(`ABS comparison query (${table}) returned error:`, error.message);
        return null;
      }
      return data ?? null;
    },
  });

  // Hard gates — render nothing if any of these fail. Preview mode skips
  // all of them so designers can review the layout without a seeded DB.
  if (!previewMode) {
    if (!isGeorgia) return null;
    if (!sourcePlayerId) return null;
    if (isLoading) return null;
    if (!data) return null;
  }

  const sourceData = previewMode
    ? (playerType === "hitter" ? PREVIEW_HITTER : PREVIEW_PITCHER)
    : data;
  const rows: Row[] = playerType === "hitter"
    ? hitterRows(sourceData as HitterRow)
    : pitcherRows(sourceData as PitcherRow);
  // Suppress the card entirely if every row has both sides null.
  const anyData = rows.some((r) => r.current != null || r.abs != null);
  if (!anyData) return null;

  return (
    <Card className="overflow-visible border-l-[3px] border-l-[#D4AF37] border-t border-r border-b border-border/60 shadow-sm bg-card">
      <CardHeader className="pb-2 border-b bg-muted/20">
        <div className="flex items-baseline justify-between gap-3">
          <CardTitle
            className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]"
            style={{ fontFamily: "'Oswald', sans-serif" }}
          >
            ABS Strike Zone Comparison
          </CardTitle>
          <span className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
            SEC · Georgia
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1 leading-snug">
          Current NCAA zone vs the larger Automated Ball-Strike zone coming to the SEC.
        </p>
      </CardHeader>
      <CardContent className="pt-2 pb-2">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
              <tr className="border-b">
                <th className="text-left font-semibold py-1.5 pr-2">Stat</th>
                <th className="text-right font-semibold py-1.5 px-2 w-[80px]">Current</th>
                <th className="text-right font-semibold py-1.5 px-2 w-[80px]">ABS</th>
                <th className="text-right font-semibold py-1.5 pl-2 w-[64px]">Δ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <ComparisonRow key={r.label} row={r} />
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function ComparisonRow({ row }: { row: Row }) {
  const dec = row.decimals ?? 1;
  const suf = row.suffix ?? "";
  const fmt = (v: number | null) => (v == null ? "—" : `${v.toFixed(dec)}${suf}`);
  const delta = row.current != null && row.abs != null ? row.abs - row.current : null;
  const deltaStr = delta == null
    ? "—"
    : `${delta >= 0 ? "+" : ""}${delta.toFixed(dec)}${suf}`;
  const deltaColor = delta == null
    ? "text-muted-foreground"
    : delta > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : delta < 0
        ? "text-rose-600 dark:text-rose-400"
        : "text-muted-foreground";
  return (
    <tr className="border-b last:border-b-0 hover:bg-muted/30 transition-colors duration-150">
      <td className="py-1.5 pr-2 text-xs">{row.label}</td>
      <td className="py-1.5 px-2 text-right tabular-nums text-xs text-muted-foreground">{fmt(row.current)}</td>
      <td className="py-1.5 px-2 text-right tabular-nums text-xs font-semibold">{fmt(row.abs)}</td>
      <td className={`py-1.5 pl-2 text-right tabular-nums text-xs font-medium ${deltaColor}`}>{deltaStr}</td>
    </tr>
  );
}

function hitterRows(d: HitterRow): Row[] {
  return [
    { label: "Chase %", current: d.chase_pct, abs: d.abs_chase_pct, suffix: "%" },
    { label: "Contact %", current: d.contact_pct, abs: d.abs_contact_pct, suffix: "%" },
    { label: "In-Zone Contact %", current: d.in_zone_contact_pct, abs: d.abs_in_zone_contact_pct, suffix: "%" },
    { label: "CSW %", current: d.csw_pct, abs: d.abs_csw_pct, suffix: "%" },
    { label: "Barrel %", current: d.barrel_pct, abs: d.abs_barrel_pct, suffix: "%" },
    { label: "Avg Exit Velo", current: d.avg_exit_velo, abs: d.abs_avg_exit_velo, suffix: " mph" },
    { label: "EV In Zone", current: d.ev_in_zone, abs: d.abs_ev_in_zone, suffix: " mph" },
    { label: "EV Outskirts", current: d.ev_outskirts, abs: d.abs_ev_outskirts, suffix: " mph" },
  ];
}

// Placeholder values for ?abs_preview=1 — for design review only.
const PREVIEW_HITTER: HitterRow = {
  chase_pct: 22.5, csw_pct: 28.5, contact_pct: 78.2, in_zone_contact_pct: 84.1,
  abs_chase_pct: 25.1, abs_csw_pct: 31.2, abs_contact_pct: 76.8, abs_in_zone_contact_pct: 81.3,
  avg_exit_velo: 88.4, ev_in_zone: 90.1, ev_outskirts: 84.2, barrel_pct: 12.5,
  abs_avg_exit_velo: 88.4, abs_ev_in_zone: 90.1, abs_ev_outskirts: 84.2, abs_barrel_pct: 12.5,
};

const PREVIEW_PITCHER: PitcherRow = {
  csw_pct: 28.5, strike_pct: 64.2, in_zone_pct: 48.7,
  abs_csw_pct: 31.8, abs_strike_pct: 66.9, abs_in_zone_pct: 53.1,
};

function pitcherRows(d: PitcherRow): Row[] {
  return [
    { label: "CSW %", current: d.csw_pct, abs: d.abs_csw_pct, suffix: "%" },
    { label: "Strike %", current: d.strike_pct, abs: d.abs_strike_pct, suffix: "%" },
    { label: "In-Zone %", current: d.in_zone_pct, abs: d.abs_in_zone_pct, suffix: "%" },
  ];
}
