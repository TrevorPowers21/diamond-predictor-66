import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useEffectiveSchool } from "@/hooks/useEffectiveSchool";
import { profileRouteFor } from "@/lib/profileRoutes";
import { pickPreferredPrediction } from "@/lib/teamScopedPredictions";
import { cn } from "@/lib/utils";

const PROJECTION_SEASON = 2027;

/* ─── types ─── */
type PlayerLite = {
  id: string;
  first_name: string;
  last_name: string;
  position: string | null;
  team: string | null;
  conference: string | null;
};

type PredictionRow = {
  id: string;
  player_id: string;
  customer_team_id: string | null;
  variant: "regular" | "precomputed" | string;
  model_type: "returner" | "transfer" | string;
  status: string;
  p_avg: number | null;
  p_obp: number | null;
  p_slg: number | null;
  p_ops: number | null;
  p_iso: number | null;
  p_wrc_plus: number | null;
  o_war: number | null;
  p_era: number | null;
  p_fip: number | null;
  p_whip: number | null;
  p_k9: number | null;
  p_bb9: number | null;
  p_hr9: number | null;
  p_rv_plus: number | null;
  p_war: number | null;
  market_value: number | null;
  pitcher_role: "SP" | "RP" | "SM" | null;
};

/* ─── format helpers ─── */
const stat = (v: number | null | undefined, d = 3) => (v == null ? "—" : v.toFixed(d));
const whole = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toString());
const money = (v: number | null | undefined) => (v == null ? "—" : `$${Math.round(v).toLocaleString("en-US")}`);

const heroColor = (val: number | null | undefined, goodCut: number, avgCut: number) => {
  if (val == null) return "border-border bg-muted/10";
  return val >= goodCut
    ? "border-emerald-500 bg-emerald-500/10"
    : val >= avgCut
      ? "border-blue-500 bg-blue-500/10"
      : "border-rose-500 bg-rose-500/10";
};

const tierStyle = (tier: "good" | "avg" | "bad") =>
  tier === "good"
    ? "border-emerald-500/40 bg-emerald-500/5"
    : tier === "avg"
      ? "border-blue-500/40 bg-blue-500/5"
      : "border-rose-500/40 bg-rose-500/5";

const hitterStatTier = (
  key: "avg" | "obp" | "slg" | "ops" | "iso",
  value: number | null | undefined,
): "good" | "avg" | "bad" => {
  if (value == null) return "avg";
  const cuts: Record<string, [number, number]> = {
    avg: [0.310, 0.270],
    obp: [0.395, 0.355],
    slg: [0.500, 0.430],
    ops: [0.880, 0.790],
    iso: [0.200, 0.150],
  };
  const [good, avg] = cuts[key];
  return value >= good ? "good" : value >= avg ? "avg" : "bad";
};

const pitcherStatTier = (
  key: "era" | "fip" | "whip" | "k9" | "bb9" | "hr9",
  value: number | null | undefined,
): "good" | "avg" | "bad" => {
  if (value == null) return "avg";
  // lower is better for era/fip/whip/bb9/hr9; higher is better for k9
  const cuts: Record<string, { good: number; avg: number; higherBetter: boolean }> = {
    era: { good: 3.50, avg: 4.50, higherBetter: false },
    fip: { good: 3.80, avg: 4.80, higherBetter: false },
    whip: { good: 1.20, avg: 1.40, higherBetter: false },
    k9: { good: 10.0, avg: 8.0, higherBetter: true },
    bb9: { good: 2.80, avg: 4.00, higherBetter: false },
    hr9: { good: 0.80, avg: 1.20, higherBetter: false },
  };
  const c = cuts[key];
  if (c.higherBetter) return value >= c.good ? "good" : value >= c.avg ? "avg" : "bad";
  return value <= c.good ? "good" : value <= c.avg ? "avg" : "bad";
};

/* ─── page ─── */
export default function PlayerComparison() {
  const location = useLocation();
  const { effectiveTeamId, loading: authLoading } = useAuth();
  const { schoolName, schoolFullName } = useEffectiveSchool();
  const destTeamLabel = schoolName ?? schoolFullName ?? "";

  const [simType, setSimType] = useState<"hitting" | "pitching">("hitting");
  const [roleA, setRoleA] = useState<"SP" | "RP">("SP");
  const [roleB, setRoleB] = useState<"SP" | "RP">("SP");

  // Player A state
  const [aPlayerId, setAPlayerId] = useState<string | null>(null);
  const [aPlayerSearch, setAPlayerSearch] = useState("");
  const [aPlayerOpen, setAPlayerOpen] = useState(false);

  // Player B state
  const [bPlayerId, setBPlayerId] = useState<string | null>(null);
  const [bPlayerSearch, setBPlayerSearch] = useState("");
  const [bPlayerOpen, setBPlayerOpen] = useState(false);

  // Destination is always the active customer team (impersonation-aware).
  // No dropdown — the Compare page projects both players AT the coach's team.
  const destTeamId = effectiveTeamId;

  /* ─── players (search source) ─── */
  // For hitters: non-pitchers with active rows. For pitchers: pitcher-primary or TWP.
  const { data: allPlayers = [] } = useQuery({
    queryKey: ["compare-all-players"],
    queryFn: async () => {
      const all: PlayerLite[] = [];
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("players")
          .select("id, first_name, last_name, position, team, conference")
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = (data ?? []) as PlayerLite[];
        all.push(...rows.filter((p) => p.first_name && p.last_name));
        if (rows.length < PAGE) break;
        from += PAGE;
      }
      return all;
    },
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  /* ─── selected players ─── */
  const aPlayer = useMemo(() => allPlayers.find((p) => p.id === aPlayerId) ?? null, [allPlayers, aPlayerId]);
  const bPlayer = useMemo(() => allPlayers.find((p) => p.id === bPlayerId) ?? null, [allPlayers, bPlayerId]);

  /* ─── stored predictions for the two selected players ─── */
  const { data: predictions = [] } = useQuery({
    queryKey: ["compare-predictions", aPlayerId, bPlayerId],
    enabled: !authLoading && !!(aPlayerId || bPlayerId),
    queryFn: async (): Promise<PredictionRow[]> => {
      const ids = [aPlayerId, bPlayerId].filter(Boolean) as string[];
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from("player_predictions")
        .select(
          "id, player_id, customer_team_id, variant, model_type, status, p_avg, p_obp, p_slg, p_ops, p_iso, p_wrc_plus, o_war, p_era, p_fip, p_whip, p_k9, p_bb9, p_hr9, p_rv_plus, p_war, market_value, pitcher_role",
        )
        .in("player_id", ids)
        .eq("season", PROJECTION_SEASON)
        .in("status", ["active", "departed"])
        .in("variant", ["regular", "precomputed"]);
      if (error) throw error;
      return (data ?? []) as PredictionRow[];
    },
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  /* ─── pick the right row per (player, destination) ─── */
  const pickRow = (playerId: string | null, destTeamId: string | null): PredictionRow | null => {
    if (!playerId || !destTeamId) return null;
    const rows = predictions.filter((r) => r.player_id === playerId);
    if (rows.length === 0) return null;
    return pickPreferredPrediction(rows, destTeamId) as PredictionRow | null;
  };

  const aRow = useMemo(() => pickRow(aPlayerId, destTeamId), [aPlayerId, destTeamId, predictions]);
  const bRow = useMemo(() => pickRow(bPlayerId, destTeamId), [bPlayerId, destTeamId, predictions]);

  /* ─── player search filters ─── */
  const filterPlayersForMode = (q: string): PlayerLite[] => {
    const term = q.trim().toLowerCase();
    if (term.length < 2) return [];
    const isPitcherPos = (pos: string | null) =>
      /^(SP|RP|CL|P|LHP|RHP|SM)/i.test(String(pos || ""));
    return allPlayers
      .filter((p) => {
        const matches = `${p.first_name} ${p.last_name}`.toLowerCase().includes(term);
        if (!matches) return false;
        if (simType === "pitching") return isPitcherPos(p.position);
        return !isPitcherPos(p.position);
      })
      .slice(0, 15);
  };

  /* ─── source badge text ─── */
  const sourceBadge = (row: PredictionRow | null): string => {
    if (!row) return "";
    if (row.variant === "regular" && row.customer_team_id == null) return "Returner (current team)";
    if (row.variant === "precomputed" && row.customer_team_id != null) return "Transfer projection";
    return "";
  };

  /* ─── render ─── */
  return (
    <DashboardLayout>
      <div className="space-y-4 max-w-[1400px] mx-auto">
        <div className="rounded-lg border-l-[3px] border-l-[#D4AF37] border-t border-r border-b border-border/60 bg-muted/20 px-4 py-4 flex items-center justify-between gap-4">
          <div>
            <h2
              className="text-2xl font-bold tracking-[0.04em] uppercase leading-none"
              style={{ fontFamily: "'Oswald', sans-serif", color: "#D4AF37" }}
            >
              Compare Dashboard
            </h2>
            <p className="text-muted-foreground text-xs mt-1.5 tracking-wide">
              Side-by-side player comparison · stored projections, no live recompute
            </p>
          </div>
          <div className="flex gap-1 rounded-lg border border-border/60 bg-muted/40 p-1">
            {(["hitting", "pitching"] as const).map((m) => (
              <button
                key={m}
                className={cn(
                  "px-5 py-1.5 text-xs font-bold uppercase tracking-[0.1em] rounded-md transition-colors duration-150 cursor-pointer",
                  simType === m
                    ? "bg-[#D4AF37]/15 text-[#D4AF37] ring-1 ring-[#D4AF37]/30"
                    : "text-muted-foreground hover:text-foreground",
                )}
                style={{ fontFamily: "'Oswald', sans-serif" }}
                onClick={() => setSimType(m)}
              >
                {m === "hitting" ? "Hitting" : "Pitching"}
              </button>
            ))}
          </div>
        </div>

        {!destTeamId && !authLoading ? (
          <div className="rounded-lg border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
            Compare requires an active customer team. Pick a team from the sidebar impersonation dropdown.
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {simType === "hitting" ? (
              <>
                {renderHitterPanel("Player A", aPlayerSearch, setAPlayerSearch, aPlayerOpen, setAPlayerOpen, (p) => { setAPlayerId(p.id); setAPlayerSearch(`${p.first_name} ${p.last_name}`); setAPlayerOpen(false); }, aPlayer, aRow)}
                {renderHitterPanel("Player B", bPlayerSearch, setBPlayerSearch, bPlayerOpen, setBPlayerOpen, (p) => { setBPlayerId(p.id); setBPlayerSearch(`${p.first_name} ${p.last_name}`); setBPlayerOpen(false); }, bPlayer, bRow)}
              </>
            ) : (
              <>
                {renderPitcherPanel("Pitcher A", aPlayerSearch, setAPlayerSearch, aPlayerOpen, setAPlayerOpen, roleA, setRoleA, (p) => { setAPlayerId(p.id); setAPlayerSearch(`${p.first_name} ${p.last_name}`); setAPlayerOpen(false); }, aPlayer, aRow)}
                {renderPitcherPanel("Pitcher B", bPlayerSearch, setBPlayerSearch, bPlayerOpen, setBPlayerOpen, roleB, setRoleB, (p) => { setBPlayerId(p.id); setBPlayerSearch(`${p.first_name} ${p.last_name}`); setBPlayerOpen(false); }, bPlayer, bRow)}
              </>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );

  /* ─── panel renderers (inline so they close over filters above) ─── */

  function renderHitterPanel(
    title: string,
    playerSearch: string,
    setPlayerSearch: (v: string) => void,
    playerOpen: boolean,
    setPlayerOpen: (v: boolean) => void,
    onPickPlayer: (p: PlayerLite) => void,
    player: PlayerLite | null,
    row: PredictionRow | null,
  ) {
    return (
      <Card className="overflow-visible border-border/70 shadow-sm bg-card">
        <CardHeader className="pb-2 border-b bg-muted/20">
          <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={{ fontFamily: "'Oswald', sans-serif" }}>
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="relative">
              <Label className="text-xs mb-1 block">Player</Label>
              <Input
                className="h-8 text-sm"
                placeholder="Search hitter..."
                value={playerSearch}
                onChange={(e) => { setPlayerSearch(e.target.value); setPlayerOpen(true); }}
                onFocus={() => setPlayerOpen(true)}
                onBlur={() => setTimeout(() => setPlayerOpen(false), 150)}
              />
              {playerOpen && filterPlayersForMode(playerSearch).length > 0 && (
                <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-64 overflow-auto">
                  {filterPlayersForMode(playerSearch).map((p) => (
                    <div
                      key={p.id}
                      className="px-3 py-1.5 text-sm cursor-pointer hover:bg-accent flex justify-between"
                      onMouseDown={() => onPickPlayer(p)}
                    >
                      <span className="font-medium">{p.first_name} {p.last_name}</span>
                      <span className="text-muted-foreground text-[11px]">{p.team || "—"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <Label className="text-xs mb-1 block">To Team</Label>
              <Input className="h-8 text-sm cursor-not-allowed" value={destTeamLabel} disabled readOnly />
            </div>
          </div>

          {player && (
            <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
              <Link
                className="text-primary font-medium underline-offset-2 hover:underline"
                to={profileRouteFor(player.id, player.position)}
                state={{ returnTo: location.pathname }}
              >
                {player.first_name} {player.last_name}
              </Link>
              <span>{player.position || "—"} · {player.team || "—"}</span>
              {row && (
                <span className="text-[10px] uppercase tracking-wide font-semibold text-[#D4AF37]">
                  {sourceBadge(row)}
                </span>
              )}
            </div>
          )}

          {row ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className={`rounded-lg border-2 p-3 text-center ${heroColor(row.p_wrc_plus, 115, 90)}`}>
                  <div className="text-muted-foreground text-[10px] uppercase tracking-wide">pWRC+</div>
                  <div className="text-2xl font-bold tabular-nums">{whole(row.p_wrc_plus)}</div>
                </div>
                <div className={`rounded-lg border-2 p-3 text-center ${heroColor(row.o_war, 1.5, 0.5)}`}>
                  <div className="text-muted-foreground text-[10px] uppercase tracking-wide">oWAR</div>
                  <div className="text-2xl font-bold tabular-nums">{row.o_war?.toFixed(2) ?? "—"}</div>
                </div>
                <div className={`rounded-lg border-2 p-3 text-center ${heroColor(row.market_value, 75000, 25000)}`}>
                  <div className="text-muted-foreground text-[10px] uppercase tracking-wide">Market Value</div>
                  <div className="text-xl font-bold tabular-nums">{money(row.market_value)}</div>
                </div>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {([
                  ["AVG", row.p_avg, "avg"],
                  ["OBP", row.p_obp, "obp"],
                  ["SLG", row.p_slg, "slg"],
                  ["OPS", row.p_ops, "ops"],
                  ["ISO", row.p_iso, "iso"],
                ] as const).map(([label, val, key]) => (
                  <div key={label} className={`rounded border p-2 text-center ${tierStyle(hitterStatTier(key, val))}`}>
                    <div className="text-muted-foreground text-[10px] uppercase tracking-wide">{label}</div>
                    <div className="text-sm font-bold tabular-nums">{stat(val, 3)}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="rounded-md border border-dashed p-4 text-xs text-muted-foreground text-center">
              {!player ? "Select a hitter." : "No stored projection for this player at this team."}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  function renderPitcherPanel(
    title: string,
    playerSearch: string,
    setPlayerSearch: (v: string) => void,
    playerOpen: boolean,
    setPlayerOpen: (v: boolean) => void,
    roleOverride: "SP" | "RP",
    setRoleOverride: (v: "SP" | "RP") => void,
    onPickPlayer: (p: PlayerLite) => void,
    player: PlayerLite | null,
    row: PredictionRow | null,
  ) {
    return (
      <Card className="overflow-visible border-border/70 shadow-sm bg-card">
        <CardHeader className="pb-2 border-b bg-muted/20">
          <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={{ fontFamily: "'Oswald', sans-serif" }}>
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-3">
          <div className="grid grid-cols-5 gap-2">
            <div className="relative col-span-2">
              <Label className="text-xs mb-1 block">Pitcher</Label>
              <Input
                className="h-8 text-sm"
                placeholder="Search pitcher..."
                value={playerSearch}
                onChange={(e) => { setPlayerSearch(e.target.value); setPlayerOpen(true); }}
                onFocus={() => setPlayerOpen(true)}
                onBlur={() => setTimeout(() => setPlayerOpen(false), 150)}
              />
              {playerOpen && filterPlayersForMode(playerSearch).length > 0 && (
                <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-64 overflow-auto">
                  {filterPlayersForMode(playerSearch).map((p) => (
                    <div
                      key={p.id}
                      className="px-3 py-1.5 text-sm cursor-pointer hover:bg-accent flex justify-between"
                      onMouseDown={() => onPickPlayer(p)}
                    >
                      <span className="font-medium">{p.first_name} {p.last_name}</span>
                      <span className="text-muted-foreground text-[11px]">{p.team || "—"} · {p.position || "—"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="col-span-2">
              <Label className="text-xs mb-1 block">To Team</Label>
              <Input className="h-8 text-sm cursor-not-allowed" value={destTeamLabel} disabled readOnly />
            </div>
            <div>
              <Label className="text-xs mb-1 block">Role</Label>
              <Select value={roleOverride} onValueChange={(v) => setRoleOverride(v as "SP" | "RP")}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="SP">SP</SelectItem>
                  <SelectItem value="RP">RP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {player && (
            <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
              <Link
                className="text-primary font-medium underline-offset-2 hover:underline"
                to={profileRouteFor(player.id, player.position)}
                state={{ returnTo: location.pathname }}
              >
                {player.first_name} {player.last_name}
              </Link>
              <span>{player.position || "—"} · {player.team || "—"}</span>
              {row && (
                <span className="text-[10px] uppercase tracking-wide font-semibold text-[#D4AF37]">
                  {sourceBadge(row)} · {row.pitcher_role || roleOverride}
                </span>
              )}
            </div>
          )}

          {row ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className={`rounded-lg border-2 p-3 text-center ${heroColor(row.p_rv_plus, 110, 95)}`}>
                  <div className="text-muted-foreground text-[10px] uppercase tracking-wide">pRV+</div>
                  <div className="text-2xl font-bold tabular-nums">{whole(row.p_rv_plus)}</div>
                </div>
                <div className={`rounded-lg border-2 p-3 text-center ${heroColor(row.p_war, 1.5, 0.5)}`}>
                  <div className="text-muted-foreground text-[10px] uppercase tracking-wide">pWAR</div>
                  <div className="text-2xl font-bold tabular-nums">{row.p_war?.toFixed(2) ?? "—"}</div>
                </div>
                <div className={`rounded-lg border-2 p-3 text-center ${heroColor(row.market_value, 75000, 25000)}`}>
                  <div className="text-muted-foreground text-[10px] uppercase tracking-wide">Market Value</div>
                  <div className="text-xl font-bold tabular-nums">{money(row.market_value)}</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {([
                  ["ERA", row.p_era, "era"],
                  ["FIP", row.p_fip, "fip"],
                  ["WHIP", row.p_whip, "whip"],
                ] as const).map(([label, val, key]) => (
                  <div key={label} className={`rounded border p-2 text-center ${tierStyle(pitcherStatTier(key, val))}`}>
                    <div className="text-muted-foreground text-[10px] uppercase tracking-wide">{label}</div>
                    <div className="text-sm font-bold tabular-nums">{val?.toFixed(2) ?? "—"}</div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {([
                  ["K/9", row.p_k9, "k9"],
                  ["BB/9", row.p_bb9, "bb9"],
                  ["HR/9", row.p_hr9, "hr9"],
                ] as const).map(([label, val, key]) => (
                  <div key={label} className={`rounded border p-2 text-center ${tierStyle(pitcherStatTier(key, val))}`}>
                    <div className="text-muted-foreground text-[10px] uppercase tracking-wide">{label}</div>
                    <div className="text-sm font-bold tabular-nums">{val?.toFixed(2) ?? "—"}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="rounded-md border border-dashed p-4 text-xs text-muted-foreground text-center">
              {!player ? "Select a pitcher." : "No stored projection for this pitcher at this team."}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }
}
