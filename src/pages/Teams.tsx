import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import ConferenceStatsTable from "@/components/ConferenceStatsTable";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Search, Building2, Edit2, Check, X, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface Team {
  id: string;
  name: string;
  conference: string | null;
  division: string | null;
  park_factor: number | null;
}

const CONFERENCES = [
  "ACC", "AAC", "A-10", "America East", "ASUN", "Big 12", "Big East", "Big Sky",
  "Big South", "Big Ten", "Big West", "CAA", "CUSA", "Horizon League", "Ivy League",
  "MAAC", "MAC", "MEAC", "Mountain West", "MVC", "NEC", "OVC", "Pac-12",
  "Patriot League", "SoCon", "Southland", "Summit League", "Sun Belt", "SWAC",
  "WAC", "WCC",
];

export default function Teams() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [confFilter, setConfFilter] = useState<string>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editConf, setEditConf] = useState("");
  const [editName, setEditName] = useState("");
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamConf, setNewTeamConf] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  const { data: teams = [], isLoading } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      let allData: any[] = [];
      let from = 0;
      const PAGE_SIZE = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("teams")
          .select("*")
          .order("name")
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        allData = allData.concat(data || []);
        if (!data || data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
      return allData as Team[];
    },
  });

  const updateTeam = useMutation({
    mutationFn: async ({ id, name, conference }: { id: string; name: string; conference: string }) => {
      const { error } = await supabase
        .from("teams")
        .update({ name, conference })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      setEditingId(null);
      toast.success("Team updated");
    },
    onError: (e) => toast.error(`Failed: ${e.message}`),
  });

  const deleteTeam = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("teams").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      toast.success("Team deleted");
    },
    onError: (e) => toast.error(`Failed: ${e.message}`),
  });

  const addTeam = useMutation({
    mutationFn: async ({ name, conference }: { name: string; conference: string }) => {
      const { error } = await supabase
        .from("teams")
        .insert({ name, conference: conference || null });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      setNewTeamName("");
      setNewTeamConf("");
      setShowAddForm(false);
      toast.success("Team added");
    },
    onError: (e) => toast.error(`Failed: ${e.message}`),
  });

  const filtered = useMemo(() => {
    let list = teams;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          (t.conference || "").toLowerCase().includes(q)
      );
    }
    if (confFilter !== "all") {
      if (confFilter === "unassigned") {
        list = list.filter((t) => !t.conference);
      } else {
        list = list.filter((t) => t.conference === confFilter);
      }
    }
    return list;
  }, [teams, search, confFilter]);

  const confCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    teams.forEach((t) => {
      const c = t.conference || "Unassigned";
      counts[c] = (counts[c] || 0) + 1;
    });
    return counts;
  }, [teams]);

  const uniqueConfs = useMemo(() => {
    return [...new Set(teams.map((t) => t.conference).filter(Boolean))].sort() as string[];
  }, [teams]);

  const startEdit = (team: Team) => {
    setEditingId(team.id);
    setEditConf(team.conference || "");
    setEditName(team.name);
  };

  const saveEdit = (id: string) => {
    updateTeam.mutate({ id, name: editName, conference: editConf });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Teams & Conferences</h2>
            <p className="text-muted-foreground">Manage team-to-conference mappings for the transfer portal</p>
          </div>
          <Button onClick={() => setShowAddForm(!showAddForm)} size="sm" className="gap-1">
            <Plus className="h-4 w-4" />
            Add Team
          </Button>
        </div>

        {/* Summary */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Teams</CardTitle>
              <Building2 className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{teams.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Conferences</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{uniqueConfs.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Unassigned</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{confCounts["Unassigned"] || 0}</div>
            </CardContent>
          </Card>
        </div>

        {/* Add team form */}
        {showAddForm && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <label className="text-sm font-medium text-muted-foreground mb-1 block">Team Name</label>
                  <Input
                    value={newTeamName}
                    onChange={(e) => setNewTeamName(e.target.value)}
                    placeholder="e.g. University of Example"
                  />
                </div>
                <div className="w-48">
                  <label className="text-sm font-medium text-muted-foreground mb-1 block">Conference</label>
                  <Select value={newTeamConf} onValueChange={setNewTeamConf}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent>
                      {CONFERENCES.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={() => addTeam.mutate({ name: newTeamName, conference: newTeamConf })}
                  disabled={!newTeamName.trim()}
                  size="sm"
                >
                  Add
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowAddForm(false)}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Table */}
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">All Teams</CardTitle>
            <div className="flex gap-2">
              <Select value={confFilter} onValueChange={setConfFilter}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Conferences</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {uniqueConfs.map((c) => (
                    <SelectItem key={c} value={c}>{c} ({confCounts[c] || 0})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search teams..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">Loading teams…</div>
            ) : filtered.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">No teams found</div>
            ) : (
              <div className="overflow-auto max-h-[60vh]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[250px]">Team</TableHead>
                      <TableHead className="min-w-[100px] text-center">Park Factor</TableHead>
                      <TableHead className="min-w-[180px]">Conference</TableHead>
                      <TableHead className="w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((team) => (
                      <TableRow key={team.id}>
                        <TableCell className="font-medium">
                          {editingId === team.id ? (
                            <Input
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="h-8 w-full max-w-[280px]"
                            />
                          ) : (
                            team.name
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="text-sm tabular-nums">
                            {Math.round((team.park_factor ?? 1.000) * 100)}
                          </span>
                        </TableCell>
                        <TableCell>
                          {editingId === team.id ? (
                            <Select value={editConf} onValueChange={setEditConf}>
                              <SelectTrigger className="w-44 h-8">
                                <SelectValue placeholder="Select conference" />
                              </SelectTrigger>
                              <SelectContent>
                                {CONFERENCES.map((c) => (
                                  <SelectItem key={c} value={c}>{c}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            team.conference ? (
                              <Badge variant="secondary">{team.conference}</Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground italic">Unassigned</span>
                            )
                          )}
                        </TableCell>
                        <TableCell>
                          {editingId === team.id ? (
                            <div className="flex gap-1">
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => saveEdit(team.id)}>
                                <Check className="h-3.5 w-3.5 text-[hsl(var(--success))]" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingId(null)}>
                                <X className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            </div>
                          ) : (
                            <div className="flex gap-1">
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(team)}>
                                <Edit2 className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                onClick={() => {
                                  if (confirm(`Delete "${team.name}"?`)) deleteTeam.mutate(team.id);
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Conference Stats */}
        <ConferenceStatsTable />
      </div>
    </DashboardLayout>
  );
}
