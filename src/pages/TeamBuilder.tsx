import { useState, useMemo, useCallback, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Plus, Save, Trash2, Users, DollarSign, Search, X } from "lucide-react";

const POSITION_SLOTS = ["C", "1B", "2B", "SS", "3B", "LF", "CF", "RF", "DH"] as const;
const PITCHER_SLOTS = ["SP1", "SP2", "SP3", "SP4", "SP5", "RP1", "RP2", "RP3", "RP4", "CL"] as const;
const MAX_DEPTH = 3;

type BuildPlayer = {
  id?: string;
  player_id: string | null;
  source: "returner" | "portal";
  custom_name: string | null;
  position_slot: string | null;
  depth_order: number;
  nil_value: number;
  production_notes: string | null;
  // joined
  player?: {
    first_name: string;
    last_name: string;
    position: string | null;
    team: string | null;
    from_team: string | null;
  } | null;
  prediction?: {
    p_avg: number | null;
    p_obp: number | null;
    p_slg: number | null;
    p_ops: number | null;
    p_wrc_plus: number | null;
  } | null;
  nilVal?: number | null;
};

export default function TeamBuilder() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedBuildId, setSelectedBuildId] = useState<string | null>(null);
  const [buildName, setBuildName] = useState("My Team Build");
  const [selectedTeam, setSelectedTeam] = useState<string>("");
  const [totalBudget, setTotalBudget] = useState<number>(0);
  const [rosterPlayers, setRosterPlayers] = useState<BuildPlayer[]>([]);
  const [portalSearch, setPortalSearch] = useState("");
  const [showPortalSearch, setShowPortalSearch] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Fetch teams
  const { data: teams = [] } = useQuery({
    queryKey: ["teams-list"],
    queryFn: async () => {
      const { data } = await supabase.from("teams").select("name, conference").order("name");
      return data ?? [];
    },
  });

  // Fetch existing builds
  const { data: builds = [] } = useQuery({
    queryKey: ["team-builds"],
    queryFn: async () => {
      const { data } = await supabase
        .from("team_builds")
        .select("*")
        .order("updated_at", { ascending: false });
      return data ?? [];
    },
  });

  // Fetch returners for selected team
  const { data: returners = [] } = useQuery({
    queryKey: ["team-returners", selectedTeam],
    enabled: !!selectedTeam,
    queryFn: async () => {
      const { data } = await supabase
        .from("players")
        .select(`
          id, first_name, last_name, position, team, from_team,
          player_predictions!inner(p_avg, p_obp, p_slg, p_ops, p_wrc_plus, model_type, status),
          nil_valuations(estimated_value)
        `)
        .eq("team", selectedTeam)
        .eq("transfer_portal", false)
        .eq("player_predictions.status", "active");
      return data ?? [];
    },
  });

  // Portal player search
  const { data: portalResults = [] } = useQuery({
    queryKey: ["portal-search", portalSearch],
    enabled: portalSearch.length >= 2,
    queryFn: async () => {
      const { data } = await supabase
        .from("players")
        .select(`
          id, first_name, last_name, position, team, from_team,
          player_predictions(p_avg, p_obp, p_slg, p_ops, p_wrc_plus, model_type, status),
          nil_valuations(estimated_value)
        `)
        .eq("transfer_portal", true)
        .or(`first_name.ilike.%${portalSearch}%,last_name.ilike.%${portalSearch}%`)
        .limit(20);
      return data ?? [];
    },
  });

  // Load a saved build
  const loadBuild = useCallback(async (buildId: string) => {
    const build = builds.find((b) => b.id === buildId);
    if (!build) return;
    setSelectedBuildId(buildId);
    setBuildName(build.name);
    setSelectedTeam(build.team);
    setTotalBudget(Number(build.total_budget) || 0);

    const { data: players } = await supabase
      .from("team_build_players")
      .select("*")
      .eq("build_id", buildId);

    if (players) {
      // Fetch player details for each
      const playerIds = players.filter((p) => p.player_id).map((p) => p.player_id!);
      let playerMap: Record<string, any> = {};
      if (playerIds.length > 0) {
        const { data: pData } = await supabase
          .from("players")
          .select(`
            id, first_name, last_name, position, team, from_team,
            player_predictions(p_avg, p_obp, p_slg, p_ops, p_wrc_plus, model_type, status),
            nil_valuations(estimated_value)
          `)
          .in("id", playerIds);
        (pData ?? []).forEach((p) => {
          playerMap[p.id] = p;
        });
      }

      setRosterPlayers(
        players.map((bp) => {
          const pd = bp.player_id ? playerMap[bp.player_id] : null;
          const activePred = pd?.player_predictions?.find((pr: any) => pr.status === "active");
          return {
            id: bp.id,
            player_id: bp.player_id,
            source: bp.source as "returner" | "portal",
            custom_name: bp.custom_name,
            position_slot: bp.position_slot,
            depth_order: bp.depth_order ?? 1,
            nil_value: Number(bp.nil_value) || 0,
            production_notes: bp.production_notes,
            player: pd ? { first_name: pd.first_name, last_name: pd.last_name, position: pd.position, team: pd.team, from_team: pd.from_team } : null,
            prediction: activePred ?? null,
            nilVal: pd?.nil_valuations?.[0]?.estimated_value ?? null,
          };
        })
      );
    }
    setDirty(false);
  }, [builds]);

  // Auto-load returners when team changes and it's a new build
  useEffect(() => {
    if (!selectedTeam || selectedBuildId) return;
    const mapped: BuildPlayer[] = returners.map((r: any) => {
      const activePred = r.player_predictions?.find((pr: any) => pr.status === "active");
      return {
        player_id: r.id,
        source: "returner" as const,
        custom_name: null,
        position_slot: null,
        depth_order: 1,
        nil_value: r.nil_valuations?.[0]?.estimated_value ? Number(r.nil_valuations[0].estimated_value) : 0,
        production_notes: null,
        player: { first_name: r.first_name, last_name: r.last_name, position: r.position, team: r.team, from_team: r.from_team },
        prediction: activePred ?? null,
        nilVal: r.nil_valuations?.[0]?.estimated_value ?? null,
      };
    });
    setRosterPlayers(mapped);
    setDirty(true);
  }, [returners, selectedTeam, selectedBuildId]);

  // Save build
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not logged in");
      let buildId = selectedBuildId;

      if (buildId) {
        await supabase.from("team_builds").update({ name: buildName, team: selectedTeam, total_budget: totalBudget }).eq("id", buildId);
        await supabase.from("team_build_players").delete().eq("build_id", buildId);
      } else {
        const { data, error } = await supabase.from("team_builds").insert({
          user_id: user.id,
          name: buildName,
          team: selectedTeam,
          total_budget: totalBudget,
        }).select("id").single();
        if (error) throw error;
        buildId = data.id;
      }

      if (rosterPlayers.length > 0) {
        const rows = rosterPlayers.map((rp) => ({
          build_id: buildId!,
          player_id: rp.player_id,
          source: rp.source,
          custom_name: rp.custom_name,
          position_slot: rp.position_slot,
          depth_order: rp.depth_order,
          nil_value: rp.nil_value,
          production_notes: rp.production_notes,
        }));
        const { error } = await supabase.from("team_build_players").insert(rows);
        if (error) throw error;
      }

      setSelectedBuildId(buildId);
      setDirty(false);
      return buildId;
    },
    onSuccess: () => {
      toast({ title: "Build saved" });
      queryClient.invalidateQueries({ queryKey: ["team-builds"] });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const deleteBuildMutation = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("team_builds").delete().eq("id", id);
    },
    onSuccess: () => {
      setSelectedBuildId(null);
      setRosterPlayers([]);
      setBuildName("My Team Build");
      setSelectedTeam("");
      setTotalBudget(0);
      queryClient.invalidateQueries({ queryKey: ["team-builds"] });
      toast({ title: "Build deleted" });
    },
  });

  // Add portal player to roster
  const addPortalPlayer = (player: any) => {
    const activePred = player.player_predictions?.find((pr: any) => pr.status === "active");
    const newP: BuildPlayer = {
      player_id: player.id,
      source: "portal",
      custom_name: null,
      position_slot: null,
      depth_order: 1,
      nil_value: player.nil_valuations?.[0]?.estimated_value ? Number(player.nil_valuations[0].estimated_value) : 0,
      production_notes: null,
      player: { first_name: player.first_name, last_name: player.last_name, position: player.position, team: player.team, from_team: player.from_team },
      prediction: activePred ?? null,
      nilVal: player.nil_valuations?.[0]?.estimated_value ?? null,
    };
    setRosterPlayers((prev) => [...prev, newP]);
    setPortalSearch("");
    setShowPortalSearch(false);
    setDirty(true);
  };

  const addCustomPortalPlayer = () => {
    const newP: BuildPlayer = {
      player_id: null,
      source: "portal",
      custom_name: portalSearch || "TBD Portal Target",
      position_slot: null,
      depth_order: 1,
      nil_value: 0,
      production_notes: null,
      player: null,
      prediction: null,
      nilVal: null,
    };
    setRosterPlayers((prev) => [...prev, newP]);
    setPortalSearch("");
    setShowPortalSearch(false);
    setDirty(true);
  };

  const removePlayer = (idx: number) => {
    setRosterPlayers((prev) => prev.filter((_, i) => i !== idx));
    setDirty(true);
  };

  const updatePlayer = (idx: number, updates: Partial<BuildPlayer>) => {
    setRosterPlayers((prev) => prev.map((p, i) => (i === idx ? { ...p, ...updates } : p)));
    setDirty(true);
  };

  // Split into position players and pitchers
  const isPitcher = (p: BuildPlayer) => {
    const pos = p.position_slot || p.player?.position || "";
    return /^(SP|RP|CL|P|LHP|RHP)/i.test(pos);
  };

  const positionPlayers = rosterPlayers.filter((p) => !isPitcher(p));
  const pitchers = rosterPlayers.filter((p) => isPitcher(p));

  const totalNil = rosterPlayers.reduce((sum, p) => sum + (p.nil_value || 0), 0);
  const budgetRemaining = totalBudget - totalNil;

  // Depth chart computation
  const depthChart = useMemo(() => {
    const chart: Record<string, BuildPlayer[]> = {};
    [...POSITION_SLOTS, ...PITCHER_SLOTS].forEach((slot) => {
      chart[slot] = rosterPlayers
        .filter((p) => p.position_slot === slot)
        .sort((a, b) => a.depth_order - b.depth_order);
    });
    return chart;
  }, [rosterPlayers]);

  const getPlayerName = (p: BuildPlayer) =>
    p.player ? `${p.player.first_name} ${p.player.last_name}` : p.custom_name || "TBD";

  const newBuild = () => {
    setSelectedBuildId(null);
    setRosterPlayers([]);
    setBuildName("My Team Build");
    setSelectedTeam("");
    setTotalBudget(0);
    setDirty(false);
  };

  const renderPlayerRow = (p: BuildPlayer, idx: number, globalIdx: number) => (
    <TableRow key={globalIdx}>
      <TableCell className="font-medium">
        <div className="flex items-center gap-2">
          {getPlayerName(p)}
          <Badge variant={p.source === "portal" ? "default" : "secondary"} className="text-xs">
            {p.source === "portal" ? "Portal" : "Returner"}
          </Badge>
        </div>
      </TableCell>
      <TableCell>{p.player?.position || "—"}</TableCell>
      <TableCell>
        {p.prediction ? (
          <span className="text-xs font-mono">
            {p.prediction.p_avg?.toFixed(3) || "—"} / {p.prediction.p_obp?.toFixed(3) || "—"} / {p.prediction.p_slg?.toFixed(3) || "—"}
          </span>
        ) : "—"}
      </TableCell>
      <TableCell>
        {p.prediction?.p_wrc_plus != null ? p.prediction.p_wrc_plus.toFixed(0) : "—"}
      </TableCell>
      <TableCell>
        <Input
          type="number"
          className="w-24 h-8"
          value={p.nil_value || ""}
          onChange={(e) => updatePlayer(globalIdx, { nil_value: Number(e.target.value) || 0 })}
        />
      </TableCell>
      <TableCell>
        <Select
          value={p.position_slot || "none"}
          onValueChange={(v) => updatePlayer(globalIdx, { position_slot: v === "none" ? null : v })}
        >
          <SelectTrigger className="w-20 h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">—</SelectItem>
            {[...POSITION_SLOTS, ...PITCHER_SLOTS].map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Select
          value={String(p.depth_order)}
          onValueChange={(v) => updatePlayer(globalIdx, { depth_order: Number(v) })}
        >
          <SelectTrigger className="w-16 h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: MAX_DEPTH }, (_, i) => (
              <SelectItem key={i + 1} value={String(i + 1)}>{i + 1}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removePlayer(globalIdx)}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </TableCell>
    </TableRow>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Team Builder</h2>
            <p className="text-muted-foreground text-sm">Build rosters, track NIL budget, and manage depth charts.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={newBuild}>
              <Plus className="h-4 w-4 mr-1" /> New Build
            </Button>
            <Button onClick={() => saveMutation.mutate()} disabled={!selectedTeam || saveMutation.isPending}>
              <Save className="h-4 w-4 mr-1" /> {saveMutation.isPending ? "Saving…" : "Save"}
              {dirty && <span className="ml-1 text-xs opacity-70">•</span>}
            </Button>
          </div>
        </div>

        {/* Build selector & config */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <Label className="text-xs mb-1 block">Load Saved Build</Label>
            <Select value={selectedBuildId || "new"} onValueChange={(v) => v === "new" ? newBuild() : loadBuild(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select build…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">+ New Build</SelectItem>
                {builds.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name} ({b.team})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs mb-1 block">Build Name</Label>
            <Input value={buildName} onChange={(e) => { setBuildName(e.target.value); setDirty(true); }} />
          </div>
          <div>
            <Label className="text-xs mb-1 block">Team</Label>
            <Select value={selectedTeam} onValueChange={(v) => { setSelectedTeam(v); setSelectedBuildId(null); setDirty(true); }}>
              <SelectTrigger>
                <SelectValue placeholder="Select team…" />
              </SelectTrigger>
              <SelectContent>
                {teams.map((t) => (
                  <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs mb-1 block">Total NIL Budget ($)</Label>
            <Input type="number" value={totalBudget || ""} onChange={(e) => { setTotalBudget(Number(e.target.value) || 0); setDirty(true); }} />
          </div>
        </div>

        {/* Budget summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4 pb-4 flex items-center gap-3">
              <Users className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">{rosterPlayers.length}</p>
                <p className="text-xs text-muted-foreground">Total Players</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 flex items-center gap-3">
              <DollarSign className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">${totalNil.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Total NIL Spent</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 flex items-center gap-3">
              <DollarSign className={`h-5 w-5 ${budgetRemaining < 0 ? "text-destructive" : "text-muted-foreground"}`} />
              <div>
                <p className={`text-2xl font-bold ${budgetRemaining < 0 ? "text-destructive" : ""}`}>
                  ${budgetRemaining.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">Budget Remaining</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Add portal player */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Add Transfer Portal Player</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setShowPortalSearch(!showPortalSearch)}>
                {showPortalSearch ? <X className="h-4 w-4 mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
                {showPortalSearch ? "Close" : "Add Portal Player"}
              </Button>
            </div>
          </CardHeader>
          {showPortalSearch && (
            <CardContent>
              <div className="flex gap-2 mb-3">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search portal players…"
                    className="pl-9"
                    value={portalSearch}
                    onChange={(e) => setPortalSearch(e.target.value)}
                  />
                </div>
                <Button variant="secondary" size="sm" onClick={addCustomPortalPlayer}>
                  Add Custom
                </Button>
              </div>
              {portalResults.length > 0 && (
                <div className="border rounded-md max-h-48 overflow-auto">
                  {portalResults.map((p: any) => (
                    <button
                      key={p.id}
                      className="w-full text-left px-3 py-2 hover:bg-muted text-sm flex justify-between items-center border-b last:border-0"
                      onClick={() => addPortalPlayer(p)}
                    >
                      <span>{p.first_name} {p.last_name} — {p.position || "?"}</span>
                      <span className="text-xs text-muted-foreground">{p.from_team || p.team}</span>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          )}
        </Card>

        <Tabs defaultValue="roster">
          <TabsList>
            <TabsTrigger value="roster">Roster</TabsTrigger>
            <TabsTrigger value="depth">Depth Chart</TabsTrigger>
          </TabsList>

          <TabsContent value="roster" className="space-y-6">
            {/* Position Players */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Position Players ({positionPlayers.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Player</TableHead>
                      <TableHead>Pos</TableHead>
                      <TableHead>AVG/OBP/SLG</TableHead>
                      <TableHead>wRC+</TableHead>
                      <TableHead>NIL ($)</TableHead>
                      <TableHead>Slot</TableHead>
                      <TableHead>Depth</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {positionPlayers.length === 0 ? (
                      <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No position players added</TableCell></TableRow>
                    ) : (
                      positionPlayers.map((p, i) => {
                        const globalIdx = rosterPlayers.indexOf(p);
                        return renderPlayerRow(p, i, globalIdx);
                      })
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Pitchers */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Pitchers ({pitchers.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Player</TableHead>
                      <TableHead>Pos</TableHead>
                      <TableHead>AVG/OBP/SLG</TableHead>
                      <TableHead>wRC+</TableHead>
                      <TableHead>NIL ($)</TableHead>
                      <TableHead>Slot</TableHead>
                      <TableHead>Depth</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pitchers.length === 0 ? (
                      <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No pitchers added</TableCell></TableRow>
                    ) : (
                      pitchers.map((p, i) => {
                        const globalIdx = rosterPlayers.indexOf(p);
                        return renderPlayerRow(p, i, globalIdx);
                      })
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="depth">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Position depth chart */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Position Players</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">Slot</TableHead>
                        <TableHead>Starter</TableHead>
                        <TableHead>Backup</TableHead>
                        <TableHead>3rd</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {POSITION_SLOTS.map((slot) => (
                        <TableRow key={slot}>
                          <TableCell className="font-bold">{slot}</TableCell>
                          {[1, 2, 3].map((depth) => {
                            const player = depthChart[slot]?.find((p) => p.depth_order === depth);
                            return (
                              <TableCell key={depth} className={!player ? "text-muted-foreground" : ""}>
                                {player ? getPlayerName(player) : "—"}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* Pitcher depth chart */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Pitching Staff</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">Slot</TableHead>
                        <TableHead>Starter</TableHead>
                        <TableHead>Backup</TableHead>
                        <TableHead>3rd</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {PITCHER_SLOTS.map((slot) => (
                        <TableRow key={slot}>
                          <TableCell className="font-bold">{slot}</TableCell>
                          {[1, 2, 3].map((depth) => {
                            const player = depthChart[slot]?.find((p) => p.depth_order === depth);
                            return (
                              <TableCell key={depth} className={!player ? "text-muted-foreground" : ""}>
                                {player ? getPlayerName(player) : "—"}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        {/* Delete build */}
        {selectedBuildId && (
          <div className="flex justify-end">
            <Button variant="destructive" size="sm" onClick={() => deleteBuildMutation.mutate(selectedBuildId)}>
              <Trash2 className="h-4 w-4 mr-1" /> Delete Build
            </Button>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
