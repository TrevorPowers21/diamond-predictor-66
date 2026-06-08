import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { profileRouteFor } from "@/lib/profileRoutes";
import { pickHitterMarketValue } from "@/lib/twpMarketValue";
import { normalizeKey, normalizeName } from "../helpers";
// Pure helpers mirrored from TeamBuilder module scope
const statKey = (v: number | null | undefined) => (v == null ? "na" : Math.round(v * 1000) / 1000 === 0 ? "0.000" : (v).toFixed(3));
const toRate = (n: number) => (Math.abs(n) > 1 ? n / 100 : n);
const toWeight = (n: number) => (Math.abs(n) >= 10 ? n / 100 : n);
const normalizeParkToIndex = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return null;
  if (Math.abs(n) <= 5) return n;
  return n > 0 ? n / 100 : n;
};

const selectTransferPortalPreferredPrediction = (predictions: any[] | null | undefined) => {
  if (!predictions || predictions.length === 0) return null;
  const active = predictions.filter((p: any) => p.status === "active");
  const pool = active.length > 0 ? active : predictions;
  return pool.reduce((best: any, curr: any) => {
    if (!best) return curr;
    const bDate = new Date(best.updated_at || 0).getTime();
    const cDate = new Date(curr.updated_at || 0).getTime();
    return cDate > bDate ? curr : best;
  }, null);
};

interface CompareTabProps {
  allPlayersForSearch: any[];
  teams: any[];
  allPlayersById: Map<string, any>;
  resolveConferenceStats: (conference: string | null | undefined, conferenceId?: string | null) => any | null;
  teamByKey: { get: (key: string) => any | undefined };
  teamParkComponents: Record<string, any>;
  eqNum: (key: string, fallback: number) => number;
  seedByName: Map<string, any[]>;
}

export default function CompareTab({
  allPlayersForSearch,
  teams,
  allPlayersById,
  resolveConferenceStats,
  teamByKey,
  teamParkComponents,
  eqNum,
  seedByName,
}: CompareTabProps) {
  const location = useLocation();

  const [compareAPlayerId, setCompareAPlayerId] = useState<string>("");
  const [compareAPlayerSearch, setCompareAPlayerSearch] = useState("");
  const [compareAPlayerOpen, setCompareAPlayerOpen] = useState(false);
  const [compareADestinationTeam, setCompareADestinationTeam] = useState<string>("");
  const [compareATeamSearch, setCompareATeamSearch] = useState("");
  const [compareATeamOpen, setCompareATeamOpen] = useState(false);

  const [compareBPlayerId, setCompareBPlayerId] = useState<string>("");
  const [compareBPlayerSearch, setCompareBPlayerSearch] = useState("");
  const [compareBPlayerOpen, setCompareBPlayerOpen] = useState(false);
  const [compareBDestinationTeam, setCompareBDestinationTeam] = useState<string>("");
  const [compareBTeamSearch, setCompareBTeamSearch] = useState("");
  const [compareBTeamOpen, setCompareBTeamOpen] = useState(false);

  const filterPlayersForCompare = useCallback((q: string) => {
    const nq = normalizeName(q);
    if (!nq) return [] as any[];
    return allPlayersForSearch
      .filter((p) => normalizeName(`${p.first_name} ${p.last_name} ${p.team || ""} ${p.position || ""}`).includes(nq))
      .slice(0, 25);
  }, [allPlayersForSearch]);

  const filteredCompareAPlayers = useMemo(() => filterPlayersForCompare(compareAPlayerSearch), [compareAPlayerSearch, filterPlayersForCompare]);
  const filteredCompareBPlayers = useMemo(() => filterPlayersForCompare(compareBPlayerSearch), [compareBPlayerSearch, filterPlayersForCompare]);

  const filterTeamsForCompare = useCallback((q: string) => {
    const nq = normalizeName(q);
    if (!nq) return [] as any[];
    return teams.filter((t: any) => normalizeName(`${t.name} ${t.conference || ""}`).includes(nq)).slice(0, 30);
  }, [teams]);

  const filteredCompareATeams = useMemo(() => filterTeamsForCompare(compareATeamSearch), [compareATeamSearch, filterTeamsForCompare]);
  const filteredCompareBTeams = useMemo(() => filterTeamsForCompare(compareBTeamSearch), [compareBTeamSearch, filterTeamsForCompare]);

  const inferFromTeamForPrediction = useCallback((
    firstName: string | null | undefined,
    lastName: string | null | undefined,
    fromAvg: number | null | undefined,
    fromObp: number | null | undefined,
    fromSlg: number | null | undefined,
  ): string | null => {
    const fullName = `${firstName || ""} ${lastName || ""}`.trim();
    const candidates = seedByName.get(normalizeKey(fullName)) || [];
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0].team;
    const key = `${statKey(fromAvg ?? null)}|${statKey(fromObp ?? null)}|${statKey(fromSlg ?? null)}`;
    const exact = candidates.find((r: any) => `${statKey(r.avg)}|${statKey(r.obp)}|${statKey(r.slg)}` === key);
    return exact?.team || candidates[0].team;
  }, [seedByName]);

  const compareAPlayer = useMemo(() => allPlayersById.get(compareAPlayerId) || null, [allPlayersById, compareAPlayerId]);
  const compareBPlayer = useMemo(() => allPlayersById.get(compareBPlayerId) || null, [allPlayersById, compareBPlayerId]);

  const compareAPrediction = useMemo(
    () => selectTransferPortalPreferredPrediction((compareAPlayer?.player_predictions || []).filter((pr: any) => pr.variant === "regular")),
    [compareAPlayer],
  );
  const compareBPrediction = useMemo(
    () => selectTransferPortalPreferredPrediction((compareBPlayer?.player_predictions || []).filter((pr: any) => pr.variant === "regular")),
    [compareBPlayer],
  );

  // Customer-team name → customer_team_id lookup so we can pick the right
  // precomputed transfer row when the coach selects a destination.
  const { data: customerTeamsByName } = useQuery({
    queryKey: ["compare-customer-teams"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customer_teams").select("id, name");
      if (error) throw error;
      const map = new Map<string, string>();
      for (const ct of (data || [])) {
        if (ct.name) map.set(normalizeKey(ct.name), ct.id);
      }
      return map;
    },
    staleTime: 30 * 60 * 1000,
  });

  // Stored-first: pick the precomputed transfer row for the destination
  // customer team and read every projected value from it. Mirrors the read
  // pattern in TransferPortal / PitcherProfile / Team Builder roster — no
  // live recompute. Falls back to the global returner row if the destination
  // isn't a customer team (no precomputed transfer row for it).
  const computeCompareSimulation = useCallback((
    player: any | null,
    destinationTeam: string,
  ) => {
    if (!player || !destinationTeam) return null;
    const destCustomerTeamId = customerTeamsByName?.get(normalizeKey(destinationTeam)) ?? null;
    const allPreds: any[] = player.player_predictions || [];
    const precomputedForDest = destCustomerTeamId
      ? allPreds.find((p) => p.customer_team_id === destCustomerTeamId && p.variant === "precomputed")
      : null;
    const returnerRegular = allPreds.find((p) => p.variant === "regular" && p.customer_team_id == null);
    const stored = precomputedForDest ?? returnerRegular ?? null;
    if (!stored) return null;

    const toTeamRow = teamByKey.get(normalizeKey(destinationTeam)) || null;
    const fromTeamName = player.from_team || player.team || null;
    const fromTeamRow = fromTeamName ? teamByKey.get(normalizeKey(fromTeamName)) || null : null;
    const fromConference = fromTeamRow?.conference || player.conference || null;
    const fromConfStats = resolveConferenceStats(fromConference);
    const toConfStats = resolveConferenceStats(toTeamRow?.conference || null);

    return {
      fromTeam: fromTeamName,
      fromConference,
      toConference: toTeamRow?.conference || null,
      fromAvgPlus: fromConfStats?.avg_plus ?? null,
      toAvgPlus: toConfStats?.avg_plus ?? null,
      fromObpPlus: fromConfStats?.obp_plus ?? null,
      toObpPlus: toConfStats?.obp_plus ?? null,
      fromIsoPlus: fromConfStats?.iso_plus ?? null,
      toIsoPlus: toConfStats?.iso_plus ?? null,
      fromStuff: fromConfStats?.stuff_plus ?? null,
      toStuff: toConfStats?.stuff_plus ?? null,
      pAvg: stored.p_avg ?? null,
      pObp: stored.p_obp ?? null,
      pSlg: stored.p_slg ?? null,
      pOps: stored.p_ops ?? null,
      pIso: stored.p_iso ?? null,
      pWrcPlus: stored.p_wrc_plus ?? null,
      owar: stored.o_war ?? null,
      // TWP-aware: raw market_value is NULL for is_twp=true rows; helper
      // routes to twp_hitter_market_value.
      nilValuation: pickHitterMarketValue(stored as any, !!(player as any)?.is_twp),
    };
  }, [customerTeamsByName, resolveConferenceStats, teamByKey]);

  const compareASimulation = useMemo(
    () => computeCompareSimulation(compareAPlayer, compareADestinationTeam),
    [compareAPlayer, compareADestinationTeam, computeCompareSimulation],
  );
  const compareBSimulation = useMemo(
    () => computeCompareSimulation(compareBPlayer, compareBDestinationTeam),
    [compareBPlayer, compareBDestinationTeam, computeCompareSimulation],
  );

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={{ fontFamily: "'Oswald', sans-serif" }}>Compare A</CardTitle>
          <CardDescription>Run Transfer Portal simulation inputs in a standalone panel.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Label className="text-xs mb-1 block">Player</Label>
            <Input
              placeholder="Search player by name, team, or position…"
              value={compareAPlayerSearch}
              onChange={(e) => { setCompareAPlayerSearch(e.target.value); setCompareAPlayerOpen(true); }}
              onFocus={() => setCompareAPlayerOpen(true)}
              onBlur={() => setTimeout(() => setCompareAPlayerOpen(false), 150)}
            />
            {compareAPlayerOpen && filteredCompareAPlayers.length > 0 && (
              <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-72 overflow-auto">
                {filteredCompareAPlayers.map((p) => (
                  <div
                    key={`compare-a-${p.id}`}
                    className="px-3 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground flex justify-between items-center gap-2"
                    onMouseDown={() => { setCompareAPlayerId(p.id); setCompareAPlayerSearch(`${p.first_name} ${p.last_name}`); setCompareAPlayerOpen(false); }}
                  >
                    <span className="font-medium">{p.first_name} {p.last_name}</span>
                    <span className="text-muted-foreground text-xs">{p.team || "—"} · {p.position || "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="relative">
            <Label className="text-xs mb-1 block">To Team</Label>
            <Input
              placeholder="Search destination team…"
              value={compareATeamSearch}
              onChange={(e) => { setCompareATeamSearch(e.target.value); setCompareATeamOpen(true); }}
              onFocus={() => setCompareATeamOpen(true)}
              onBlur={() => setTimeout(() => setCompareATeamOpen(false), 150)}
            />
            {compareATeamOpen && filteredCompareATeams.length > 0 && (
              <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-72 overflow-auto">
                {filteredCompareATeams.map((t: any) => (
                  <div
                    key={`compare-a-team-${t.name}`}
                    className="px-3 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground"
                    onMouseDown={() => { setCompareADestinationTeam(t.name); setCompareATeamSearch(t.name); setCompareATeamOpen(false); }}
                  >
                    {t.name} {t.conference ? `· ${t.conference}` : ""}
                  </div>
                ))}
              </div>
            )}
          </div>

          {compareAPlayer?.id && (
            <div className="text-xs text-muted-foreground">
              Selected:{" "}
              <Link
                className="underline underline-offset-2 text-primary"
                to={profileRouteFor(compareAPlayer.id, compareAPlayer.position ?? null)}
                state={{ returnTo: `${location.pathname}${location.search}${location.hash}` }}
              >
                {compareAPlayer.first_name} {compareAPlayer.last_name}
              </Link>
            </div>
          )}

          {compareASimulation ? (
            <div className="space-y-3">
              <div className="rounded-md border p-3 bg-muted/20">
                <p className="text-xs font-medium mb-2">Context + Multipliers Used</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div>From Team</div><div className="font-mono text-right">{compareASimulation.fromTeam || "—"}</div>
                  <div>From Conference</div><div className="font-mono text-right">{compareASimulation.fromConference || "—"}</div>
                  <div>To Conference</div><div className="font-mono text-right">{compareASimulation.toConference || "—"}</div>
                  <div>From Park Factor</div><div className="font-mono text-right">{compareASimulation.fromPark ?? "—"}</div>
                  <div>To Park Factor</div><div className="font-mono text-right">{compareASimulation.toPark ?? "—"}</div>
                  <div>AVG+ Delta</div><div className="font-mono text-right">{compareASimulation.fromAvgPlus} → {compareASimulation.toAvgPlus}</div>
                  <div>OBP+ Delta</div><div className="font-mono text-right">{compareASimulation.fromObpPlus} → {compareASimulation.toObpPlus}</div>
                  <div>ISO+ Delta</div><div className="font-mono text-right">{compareASimulation.fromIsoPlus} → {compareASimulation.toIsoPlus}</div>
                  <div>Stuff+ Delta</div><div className="font-mono text-right">{compareASimulation.fromStuff} → {compareASimulation.toStuff}</div>
                </div>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs font-medium mb-2">Projected Outcomes</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div>pAVG / pOBP / pSLG</div>
                  <div className="font-mono text-right">
                    {compareASimulation.pAvg?.toFixed(3) ?? "—"} / {compareASimulation.pObp?.toFixed(3) ?? "—"} / {compareASimulation.pSlg?.toFixed(3) ?? "—"}
                  </div>
                  <div>pOPS</div><div className="font-mono text-right">{compareASimulation.pOps?.toFixed(3) ?? "—"}</div>
                  <div>pISO</div><div className="font-mono text-right">{compareASimulation.pIso?.toFixed(3) ?? "—"}</div>
                  <div>pWRC+</div><div className="font-mono text-right">{compareASimulation.pWrcPlus?.toFixed(0) ?? "—"}</div>
                  <div>oWAR</div><div className="font-mono text-right">{compareASimulation.owar?.toFixed(2) ?? "—"}</div>
                  <div>Projected NIL</div><div className="font-mono text-right">{compareASimulation.nilValuation != null ? `$${Math.round(compareASimulation.nilValuation).toLocaleString()}` : "—"}</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              Select player and destination team to run comparison panel A.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={{ fontFamily: "'Oswald', sans-serif" }}>Compare B</CardTitle>
          <CardDescription>Independent panel. You can select the same player as Compare A.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Label className="text-xs mb-1 block">Player</Label>
            <Input
              placeholder="Search player by name, team, or position…"
              value={compareBPlayerSearch}
              onChange={(e) => { setCompareBPlayerSearch(e.target.value); setCompareBPlayerOpen(true); }}
              onFocus={() => setCompareBPlayerOpen(true)}
              onBlur={() => setTimeout(() => setCompareBPlayerOpen(false), 150)}
            />
            {compareBPlayerOpen && filteredCompareBPlayers.length > 0 && (
              <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-72 overflow-auto">
                {filteredCompareBPlayers.map((p) => (
                  <div
                    key={`compare-b-${p.id}`}
                    className="px-3 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground flex justify-between items-center gap-2"
                    onMouseDown={() => { setCompareBPlayerId(p.id); setCompareBPlayerSearch(`${p.first_name} ${p.last_name}`); setCompareBPlayerOpen(false); }}
                  >
                    <span className="font-medium">{p.first_name} {p.last_name}</span>
                    <span className="text-muted-foreground text-xs">{p.team || "—"} · {p.position || "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="relative">
            <Label className="text-xs mb-1 block">To Team</Label>
            <Input
              placeholder="Search destination team…"
              value={compareBTeamSearch}
              onChange={(e) => { setCompareBTeamSearch(e.target.value); setCompareBTeamOpen(true); }}
              onFocus={() => setCompareBTeamOpen(true)}
              onBlur={() => setTimeout(() => setCompareBTeamOpen(false), 150)}
            />
            {compareBTeamOpen && filteredCompareBTeams.length > 0 && (
              <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-72 overflow-auto">
                {filteredCompareBTeams.map((t: any) => (
                  <div
                    key={`compare-b-team-${t.name}`}
                    className="px-3 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground"
                    onMouseDown={() => { setCompareBDestinationTeam(t.name); setCompareBTeamSearch(t.name); setCompareBTeamOpen(false); }}
                  >
                    {t.name} {t.conference ? `· ${t.conference}` : ""}
                  </div>
                ))}
              </div>
            )}
          </div>

          {compareBPlayer?.id && (
            <div className="text-xs text-muted-foreground">
              Selected:{" "}
              <Link
                className="underline underline-offset-2 text-primary"
                to={profileRouteFor(compareBPlayer.id, compareBPlayer.position ?? null)}
                state={{ returnTo: `${location.pathname}${location.search}${location.hash}` }}
              >
                {compareBPlayer.first_name} {compareBPlayer.last_name}
              </Link>
            </div>
          )}

          {compareBSimulation ? (
            <div className="space-y-3">
              <div className="rounded-md border p-3 bg-muted/20">
                <p className="text-xs font-medium mb-2">Context + Multipliers Used</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div>From Team</div><div className="font-mono text-right">{compareBSimulation.fromTeam || "—"}</div>
                  <div>From Conference</div><div className="font-mono text-right">{compareBSimulation.fromConference || "—"}</div>
                  <div>To Conference</div><div className="font-mono text-right">{compareBSimulation.toConference || "—"}</div>
                  <div>From Park Factor</div><div className="font-mono text-right">{compareBSimulation.fromPark ?? "—"}</div>
                  <div>To Park Factor</div><div className="font-mono text-right">{compareBSimulation.toPark ?? "—"}</div>
                  <div>AVG+ Delta</div><div className="font-mono text-right">{compareBSimulation.fromAvgPlus} → {compareBSimulation.toAvgPlus}</div>
                  <div>OBP+ Delta</div><div className="font-mono text-right">{compareBSimulation.fromObpPlus} → {compareBSimulation.toObpPlus}</div>
                  <div>ISO+ Delta</div><div className="font-mono text-right">{compareBSimulation.fromIsoPlus} → {compareBSimulation.toIsoPlus}</div>
                  <div>Stuff+ Delta</div><div className="font-mono text-right">{compareBSimulation.fromStuff} → {compareBSimulation.toStuff}</div>
                </div>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs font-medium mb-2">Projected Outcomes</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div>pAVG / pOBP / pSLG</div>
                  <div className="font-mono text-right">
                    {compareBSimulation.pAvg?.toFixed(3) ?? "—"} / {compareBSimulation.pObp?.toFixed(3) ?? "—"} / {compareBSimulation.pSlg?.toFixed(3) ?? "—"}
                  </div>
                  <div>pOPS</div><div className="font-mono text-right">{compareBSimulation.pOps?.toFixed(3) ?? "—"}</div>
                  <div>pISO</div><div className="font-mono text-right">{compareBSimulation.pIso?.toFixed(3) ?? "—"}</div>
                  <div>pWRC+</div><div className="font-mono text-right">{compareBSimulation.pWrcPlus?.toFixed(0) ?? "—"}</div>
                  <div>oWAR</div><div className="font-mono text-right">{compareBSimulation.owar?.toFixed(2) ?? "—"}</div>
                  <div>Projected NIL</div><div className="font-mono text-right">{compareBSimulation.nilValuation != null ? `$${Math.round(compareBSimulation.nilValuation).toLocaleString()}` : "—"}</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              Select player and destination team to run comparison panel B.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
