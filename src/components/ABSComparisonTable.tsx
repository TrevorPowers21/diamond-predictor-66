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

  // Hard gates — render nothing if any of these fail.
  if (!isGeorgia) return null;
  if (!sourcePlayerId) return null;
  if (isLoading) return null;
  if (!data) return null;

  const rows: Row[] = playerType === "hitter" ? hitterRows(data as HitterRow) : pitcherRows(data as PitcherRow);
  // Suppress the card entirely if every row has both sides null.
  const anyData = rows.some((r) => r.current != null || r.abs != null);
  if (!anyData) return null;

  return (
    <Card className="overflow-visible border-border/70 shadow-sm bg-card">
      <CardHeader className="pb-2 border-b bg-muted/20">
        <CardTitle
          className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]"
          style={{ fontFamily: "'Oswald', sans-serif" }}
        >
          ABS Strike Zone Comparison
        </CardTitle>
        <p className="text-[10px] text-muted-foreground mt-1">
          Current NCAA zone vs the larger Automated Ball-Strike zone coming to the SEC.
        </p>
      </CardHeader>
      <CardContent className="pt-3">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr className="border-b">
              <th className="text-left font-semibold py-2">Stat</th>
              <th className="text-right font-semibold py-2">Current</th>
              <th className="text-right font-semibold py-2">ABS</th>
              <th className="text-right font-semibold py-2">Δ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <ComparisonRow key={r.label} row={r} />
            ))}
          </tbody>
        </table>
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
    <tr className="border-b last:border-b-0 hover:bg-muted/30">
      <td className="py-1.5 text-xs">{row.label}</td>
      <td className="py-1.5 text-right tabular-nums text-xs">{fmt(row.current)}</td>
      <td className="py-1.5 text-right tabular-nums text-xs font-semibold">{fmt(row.abs)}</td>
      <td className={`py-1.5 text-right tabular-nums text-xs ${deltaColor}`}>{deltaStr}</td>
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

function pitcherRows(d: PitcherRow): Row[] {
  return [
    { label: "CSW %", current: d.csw_pct, abs: d.abs_csw_pct, suffix: "%" },
    { label: "Strike %", current: d.strike_pct, abs: d.abs_strike_pct, suffix: "%" },
    { label: "In-Zone %", current: d.in_zone_pct, abs: d.abs_in_zone_pct, suffix: "%" },
  ];
}
