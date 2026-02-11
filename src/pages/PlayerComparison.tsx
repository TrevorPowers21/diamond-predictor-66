import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GitCompare, Plus, X } from "lucide-react";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from "recharts";

interface ComparePlayer {
  id: string;
  player_id: string;
  label: string;
  team: string | null;
  position: string | null;
  class_year: string | null;
  model_type: string;
  variant: string;
  p_avg: number | null;
  p_obp: number | null;
  p_slg: number | null;
  p_ops: number | null;
  p_iso: number | null;
  p_wrc_plus: number | null;
  power_rating_plus: number | null;
  ev_score: number | null;
  barrel_score: number | null;
  whiff_score: number | null;
  chase_score: number | null;
}

const COLORS = [
  "hsl(210, 100%, 55%)",
  "hsl(38, 100%, 55%)",
  "hsl(142, 76%, 36%)",
  "hsl(0, 72%, 51%)",
  "hsl(280, 70%, 55%)",
];

const statFormat = (v: number | null | undefined, decimals = 3) => {
  if (v == null) return "—";
  return v >= 1 && decimals === 3 ? v.toFixed(3) : v.toFixed(decimals);
};

const pctFormat = (v: number | null | undefined) => {
  if (v == null) return "—";
  return Math.round(v).toString();
};

export default function PlayerComparison() {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [modelFilter, setModelFilter] = useState<"all" | "returner" | "transfer">("all");

  const { data: allPredictions = [] } = useQuery({
    queryKey: ["compare-predictions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_predictions")
        .select(`
          *,
          players!inner(id, first_name, last_name, team, position, class_year)
        `)
        .eq("variant", "regular");

      if (error) throw error;

      return (data || []).map((row: any) => ({
        id: row.id,
        player_id: row.player_id,
        label: `${row.players.first_name} ${row.players.last_name}`,
        team: row.players.team,
        position: row.players.position,
        class_year: row.players.class_year,
        model_type: row.model_type,
        variant: row.variant,
        p_avg: row.p_avg,
        p_obp: row.p_obp,
        p_slg: row.p_slg,
        p_ops: row.p_ops,
        p_iso: row.p_iso,
        p_wrc_plus: row.p_wrc_plus,
        power_rating_plus: row.power_rating_plus,
        ev_score: row.ev_score,
        barrel_score: row.barrel_score,
        whiff_score: row.whiff_score,
        chase_score: row.chase_score,
      })) as ComparePlayer[];
    },
  });

  const availablePlayers = useMemo(() => {
    let list = allPredictions;
    if (modelFilter !== "all") list = list.filter((p) => p.model_type === modelFilter);
    return list.sort((a, b) => a.label.localeCompare(b.label));
  }, [allPredictions, modelFilter]);

  const selected = useMemo(
    () => selectedIds.map((id) => allPredictions.find((p) => p.id === id)).filter(Boolean) as ComparePlayer[],
    [selectedIds, allPredictions]
  );

  const addPlayer = (id: string) => {
    if (!selectedIds.includes(id) && selectedIds.length < 5) {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const removePlayer = (id: string) => {
    setSelectedIds(selectedIds.filter((s) => s !== id));
  };

  // Radar chart data — normalize stats to 0-100 scale
  const radarData = useMemo(() => {
    if (selected.length === 0) return [];
    const stats = [
      { key: "p_avg", label: "AVG", max: 0.400 },
      { key: "p_obp", label: "OBP", max: 0.550 },
      { key: "p_slg", label: "SLG", max: 0.800 },
      { key: "p_iso", label: "ISO", max: 0.350 },
      { key: "p_wrc_plus", label: "wRC+", max: 180 },
      { key: "power_rating_plus", label: "PWR+", max: 160 },
    ];

    return stats.map((s) => {
      const point: Record<string, any> = { stat: s.label };
      selected.forEach((p, i) => {
        const raw = (p as any)[s.key] ?? 0;
        point[`player${i}`] = Math.min(100, (raw / s.max) * 100);
        point[`player${i}Raw`] = raw;
      });
      return point;
    });
  }, [selected]);

  const chartConfig = useMemo(() => {
    const config: Record<string, { label: string; color: string }> = {};
    selected.forEach((p, i) => {
      config[`player${i}`] = { label: p.label, color: COLORS[i] };
    });
    return config;
  }, [selected]);

  const statRows = [
    { label: "pAVG", key: "p_avg", fmt: statFormat },
    { label: "pOBP", key: "p_obp", fmt: statFormat },
    { label: "pSLG", key: "p_slg", fmt: statFormat },
    { label: "pOPS", key: "p_ops", fmt: statFormat },
    { label: "pISO", key: "p_iso", fmt: statFormat },
    { label: "wRC+", key: "p_wrc_plus", fmt: pctFormat },
    { label: "PWR+", key: "power_rating_plus", fmt: pctFormat },
    { label: "EV Score", key: "ev_score", fmt: pctFormat },
    { label: "Barrel Score", key: "barrel_score", fmt: pctFormat },
    { label: "Whiff Score", key: "whiff_score", fmt: pctFormat },
    { label: "Chase Score", key: "chase_score", fmt: pctFormat },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Player Comparison</h2>
          <p className="text-muted-foreground">Side-by-side comparison across all model dimensions</p>
        </div>

        {/* Player selector */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <GitCompare className="h-4 w-4" />
              Select Players (up to 5)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3 flex-wrap items-center">
              <Select value={modelFilter} onValueChange={(v) => setModelFilter(v as any)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Models</SelectItem>
                  <SelectItem value="returner">Returning</SelectItem>
                  <SelectItem value="transfer">Transfer Portal</SelectItem>
                </SelectContent>
              </Select>

              {selectedIds.length < 5 && (
                <Select value="" onValueChange={addPlayer}>
                  <SelectTrigger className="w-64">
                    <SelectValue placeholder="Add a player..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availablePlayers
                      .filter((p) => !selectedIds.includes(p.id))
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label} ({p.model_type === "returner" ? "RET" : "TP"})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {selected.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {selected.map((p, i) => (
                  <Badge
                    key={p.id}
                    variant="secondary"
                    className="gap-1 py-1.5 pl-3 pr-1.5"
                    style={{ borderLeft: `3px solid ${COLORS[i]}` }}
                  >
                    {p.label}
                    <span className="text-[10px] text-muted-foreground ml-1">
                      {p.model_type === "returner" ? "RET" : "TP"}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-4 w-4 p-0 ml-1 hover:bg-destructive/20"
                      onClick={() => removePlayer(p.id)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {selected.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <GitCompare className="h-10 w-10 mb-3 opacity-40" />
              <p>Select at least two players to compare</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Radar chart */}
            {selected.length >= 2 && radarData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Radar Comparison</CardTitle>
                  <CardDescription>Stats normalized to 0–100 scale for visual comparison</CardDescription>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={chartConfig} className="h-[350px]">
                    <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="75%">
                      <PolarGrid stroke="hsl(var(--border))" />
                      <PolarAngleAxis dataKey="stat" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                      <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                      {selected.map((_, i) => (
                        <Radar
                          key={i}
                          name={selected[i].label}
                          dataKey={`player${i}`}
                          stroke={COLORS[i]}
                          fill={COLORS[i]}
                          fillOpacity={0.1}
                          strokeWidth={2}
                        />
                      ))}
                      <ChartTooltip content={<ChartTooltipContent />} />
                    </RadarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            )}

            {/* Stat table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Stat Comparison</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left p-3 font-medium text-muted-foreground">Stat</th>
                        {selected.map((p, i) => (
                          <th key={p.id} className="text-right p-3 font-medium" style={{ color: COLORS[i] }}>
                            {p.label.split(" ").pop()}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {statRows.map((row) => {
                        const values = selected.map((p) => (p as any)[row.key] as number | null);
                        const best = Math.max(...values.filter((v): v is number => v != null));
                        return (
                          <tr key={row.key} className="border-b border-border/50">
                            <td className="p-3 text-muted-foreground font-medium">{row.label}</td>
                            {selected.map((p, i) => {
                              const val = (p as any)[row.key] as number | null;
                              const isBest = val != null && val === best && selected.length > 1;
                              return (
                                <td
                                  key={p.id}
                                  className={`p-3 text-right font-mono ${isBest ? "font-bold text-[hsl(var(--success))]" : ""}`}
                                >
                                  {row.fmt(val)}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                      <tr className="border-b border-border/50">
                        <td className="p-3 text-muted-foreground font-medium">Model</td>
                        {selected.map((p) => (
                          <td key={p.id} className="p-3 text-right">
                            <Badge variant="secondary" className="text-[10px]">
                              {p.model_type === "returner" ? "Returning" : "Transfer"}
                            </Badge>
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
