/**
 * ABS Comparison Table — Georgia-only.
 *
 * Shows each player's plate-discipline + contact stats under the current
 * NCAA strike zone alongside the new ABS (Automated Ball-Strike) zone
 * coming to the SEC. The two columns sit side-by-side with a delta column
 * so coaches can see at a glance how a target's profile shifts.
 *
 * Data lives in two standalone tables (abs_hitter_stats, abs_pitcher_stats)
 * keyed on (source_player_id, season). JUCO players never get rows — the
 * comparison doesn't apply. Until the CSV lands for a given player, the
 * query returns null and this component renders nothing.
 *
 * Gates (component returns null if any fails — no half-baked panel):
 *   - Customer team must be Georgia — checked via schoolTeamId (stable
 *     across staging + prod) rather than the schoolName string.
 *   - source_player_id must be set on the player.
 *   - Row must exist for the (source_player_id, season) pair.
 *
 * RLS: tables have SELECT-to-authenticated policies (see migration).
 * Georgia gating is client-side; DB-level row filtering isn't needed.
 */
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useEffectiveSchool } from "@/hooks/useEffectiveSchool";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Georgia's school_team_id (Teams Table row UUID). Same on staging + prod.
// The customer_teams.id differs by environment, so we resolve via the
// stable school identifier instead.
const GEORGIA_SCHOOL_TEAM_ID = "76a3163b-39d0-44b0-97ec-4a3431fd5f3b";
const DEFAULT_SEASON = 2026;

type HitterRow = {
  iz_barrel_pct: number | null;
  abs_iz_barrel_pct: number | null;
  iz_swing_pct: number | null;
  abs_iz_swing_pct: number | null;
  iz_exit_velo: number | null;
  abs_iz_exit_velo: number | null;
  iz_whiff_pct: number | null;
  abs_iz_whiff_pct: number | null;
  chase_pct: number | null;
};

type PitcherRow = {
  chase_pct: number | null;
  abs_chase_pct: number | null;
  iz_whiff_pct: number | null;
  abs_iz_whiff_pct: number | null;
  csw_pct: number | null;
  abs_csw_pct: number | null;
  strike_pct: number | null;
  abs_strike_pct: number | null;
  iz_pct: number | null;
  abs_iz_pct: number | null;
};

type Row = {
  label: string;
  current: number | null;
  abs: number | null;
  suffix?: string;
  decimals?: number;
};

export function ABSComparisonTable(props: {
  sourcePlayerId: string | null | undefined;
  playerType: "hitter" | "pitcher";
  season?: number;
}) {
  const { sourcePlayerId, playerType } = props;
  const season = props.season ?? DEFAULT_SEASON;
  const { schoolTeamId } = useEffectiveSchool();
  const isGeorgia = schoolTeamId === GEORGIA_SCHOOL_TEAM_ID;

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

  // Hard gates — render nothing if any of these fail. No half-baked panel.
  if (!isGeorgia) return null;
  if (!sourcePlayerId) return null;
  if (isLoading) return null;
  if (!data) return null;

  const rows: Row[] = playerType === "hitter"
    ? buildHitterRows(data as HitterRow)
    : buildPitcherRows(data as PitcherRow);

  return (
    <Card className="border-l-[3px] border-l-[#D4AF37] transition-colors duration-150">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm font-semibold tracking-wide uppercase text-[#D4AF37]" style={{ fontFamily: "'Oswald', sans-serif" }}>
          ABS Zone Comparison
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-1.5 pr-1 font-semibold uppercase tracking-wider text-[#8a94a6]" style={{ fontSize: 10 }}>Metric</th>
              <th className="text-right py-1.5 px-1 font-semibold uppercase tracking-wider text-[#8a94a6]" style={{ fontSize: 10 }}>Current</th>
              <th className="text-right py-1.5 px-1 font-semibold uppercase tracking-wider text-[#8a94a6]" style={{ fontSize: 10 }}>ABS</th>
              <th className="text-right py-1.5 pl-1 font-semibold uppercase tracking-wider text-[#8a94a6]" style={{ fontSize: 10 }}>Δ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <ABSRow key={i} row={row} />
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function buildHitterRows(row: HitterRow): Row[] {
  return [
    { label: "Z-Swing%",  current: row.iz_swing_pct,  abs: row.abs_iz_swing_pct,  suffix: "%", decimals: 1 },
    { label: "Z-Whiff%",  current: row.iz_whiff_pct,  abs: row.abs_iz_whiff_pct,  suffix: "%", decimals: 1 },
    { label: "Z-Barrel%", current: row.iz_barrel_pct, abs: row.abs_iz_barrel_pct, suffix: "%", decimals: 1 },
    { label: "Z-EV",      current: row.iz_exit_velo,  abs: row.abs_iz_exit_velo,  suffix: "",  decimals: 1 },
    { label: "O-Swing%",  current: row.chase_pct,     abs: row.abs_chase_pct,     suffix: "%", decimals: 1 },
  ];
}

function buildPitcherRows(row: PitcherRow): Row[] {
  return [
    { label: "O-Swing%",  current: row.chase_pct,    abs: row.abs_chase_pct,    suffix: "%", decimals: 1 },
    { label: "In-Zone%",  current: row.iz_pct,       abs: row.abs_iz_pct,       suffix: "%", decimals: 1 },
    { label: "Strike%",   current: row.strike_pct,   abs: row.abs_strike_pct,   suffix: "%", decimals: 1 },
    { label: "CSW%",      current: row.csw_pct,      abs: row.abs_csw_pct,      suffix: "%", decimals: 1 },
    { label: "IZ-Whiff%", current: row.iz_whiff_pct, abs: row.abs_iz_whiff_pct, suffix: "%", decimals: 1 },
  ];
}

function ABSRow({ row }: { row: Row }) {
  const fmt = (v: number | null) => {
    if (v == null) return "—";
    const d = row.decimals ?? 1;
    return `${Number(v).toFixed(d)}${row.suffix ?? ""}`;
  };
  const delta = row.current != null && row.abs != null ? row.abs - row.current : null;
  const deltaColor =
    delta == null ? "text-muted-foreground"
    : Math.abs(delta) < 0.05 ? "text-muted-foreground"
    : delta > 0 ? "text-[hsl(var(--success))]"
    : "text-destructive";
  const deltaPrefix = delta == null ? "" : delta > 0 ? "+" : "";
  return (
    <tr className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors duration-150">
      <td className="py-1.5 pr-1 font-medium whitespace-nowrap">{row.label}</td>
      <td className="py-1.5 px-1 text-right font-mono tabular-nums whitespace-nowrap">{fmt(row.current)}</td>
      <td className="py-1.5 px-1 text-right font-mono tabular-nums whitespace-nowrap">{fmt(row.abs)}</td>
      <td className={`py-1.5 pl-1 text-right font-mono tabular-nums whitespace-nowrap ${deltaColor}`}>
        {delta == null ? "—" : `${deltaPrefix}${delta.toFixed(row.decimals ?? 1)}${row.suffix ?? ""}`}
      </td>
    </tr>
  );
}
