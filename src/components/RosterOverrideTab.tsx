/**
 * Admin — Roster Override Tab
 *
 * Search for a player by name or source_player_id, then assign them to a team.
 * Handles injured players (TJ returns), late additions, roster corrections.
 *
 * Updates the `players` table directly:
 *  - Sets team, team_id, conference, transfer_portal = false
 *  - If no `players` row exists, creates one from Pitching/Hitter Master history
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTeamsTable } from "@/hooks/useTeamsTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Search, UserPlus, Check, X } from "lucide-react";

interface PlayerResult {
  id: string;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  team: string | null;
  conference: string | null;
  team_id: string | null;
  source_player_id: string | null;
  transfer_portal: boolean;
}

export default function RosterOverrideTab() {
  const queryClient = useQueryClient();
  const { teams } = useTeamsTable();
  const [search, setSearch] = useState("");
  const [searchById, setSearchById] = useState("");
  const [results, setResults] = useState<PlayerResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerResult | null>(null);
  const [targetTeam, setTargetTeam] = useState("");
  const [overrideNotes, setOverrideNotes] = useState("");

  // Search by name
  const handleSearch = async () => {
    if (!search.trim() && !searchById.trim()) return;
    setSearching(true);
    try {
      let data: any[] = [];

      if (searchById.trim()) {
        // Search by source_player_id
        const { data: byId } = await supabase
          .from("players")
          .select("id, first_name, last_name, position, team, conference, team_id, source_player_id, transfer_portal")
          .eq("source_player_id", searchById.trim());
        data = byId || [];
      }

      if (data.length === 0 && search.trim()) {
        // Search by name (ilike)
        const terms = search.trim().split(/\s+/);
        let query = supabase
          .from("players")
          .select("id, first_name, last_name, position, team, conference, team_id, source_player_id, transfer_portal");

        if (terms.length >= 2) {
          query = query
            .ilike("first_name", `%${terms[0]}%`)
            .ilike("last_name", `%${terms.slice(1).join(" ")}%`);
        } else {
          query = query.or(`first_name.ilike.%${terms[0]}%,last_name.ilike.%${terms[0]}%`);
        }

        const { data: byName } = await query.limit(20);
        data = byName || [];
      }

      // If still nothing, check Pitching Master + Hitter Master for historical records
      if (data.length === 0 && (search.trim() || searchById.trim())) {
        const historicalResults: PlayerResult[] = [];

        if (searchById.trim()) {
          const { data: hm } = await (supabase as any).from("Hitter Master").select("source_player_id, playerFullName, Team, Conference").eq("source_player_id", searchById.trim()).limit(1);
          const { data: pm } = await (supabase as any).from("Pitching Master").select("source_player_id, playerFullName, Team, Conference").eq("source_player_id", searchById.trim()).limit(1);
          const row = hm?.[0] || pm?.[0];
          if (row) {
            const nameParts = (row.playerFullName || "").split(" ");
            historicalResults.push({
              id: "",
              first_name: nameParts[0] || null,
              last_name: nameParts.slice(1).join(" ") || null,
              position: null,
              team: row.Team,
              conference: row.Conference,
              team_id: null,
              source_player_id: row.source_player_id,
              transfer_portal: false,
            });
          }
        }

        if (historicalResults.length > 0) {
          data = historicalResults;
        }
      }

      setResults(data as PlayerResult[]);
      if (data.length === 0) toast.info("No players found");
    } catch (err: any) {
      toast.error(`Search failed: ${err.message}`);
    } finally {
      setSearching(false);
    }
  };

  // Assign player to team
  const assignMutation = useMutation({
    mutationFn: async ({ player, teamName }: { player: PlayerResult; teamName: string }) => {
      const team = teams.find((t) =>
        t.abbreviation === teamName || t.fullName === teamName || t.name === teamName
      );

      const updates: Record<string, any> = {
        team: team?.abbreviation || team?.fullName || teamName,
        team_id: team?.id || null,
        conference: team?.conference || null,
        transfer_portal: false,
      };

      if (player.id) {
        // Update existing player row
        const { error } = await supabase
          .from("players")
          .update(updates)
          .eq("id", player.id);
        if (error) throw error;
      } else if (player.source_player_id) {
        // Player exists in Master tables but not in players table — create a row
        // First check if they already exist by source_player_id
        const { data: existing } = await supabase
          .from("players")
          .select("id")
          .eq("source_player_id", player.source_player_id)
          .maybeSingle();

        if (existing) {
          const { error } = await supabase
            .from("players")
            .update(updates)
            .eq("id", existing.id);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from("players")
            .insert({
              first_name: player.first_name,
              last_name: player.last_name,
              position: player.position,
              source_player_id: player.source_player_id,
              ...updates,
            });
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      toast.success(`Player assigned to ${targetTeam}`);
      setSelectedPlayer(null);
      setTargetTeam("");
      setOverrideNotes("");
      queryClient.invalidateQueries({ queryKey: ["team-roster"] });
      // Re-search to show updated data
      handleSearch();
    },
    onError: (err: any) => {
      toast.error(`Failed to assign: ${err.message}`);
    },
  });

  const sortedTeams = [...teams].sort((a, b) =>
    (a.abbreviation || a.fullName || "").localeCompare(b.abbreviation || b.fullName || "")
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Roster Override</CardTitle>
        <p className="text-sm text-muted-foreground">
          Search for a player and assign them to a team. Use this for injured players returning, late additions, or roster corrections.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Search */}
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Search by Name</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  placeholder="e.g. Griffin Steig"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Search by Player ID</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  placeholder="e.g. 1310417920"
                  value={searchById}
                  onChange={(e) => setSearchById(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                />
              </div>
            </div>
          </div>
          <Button onClick={handleSearch} disabled={searching} size="sm">
            <Search className="h-4 w-4 mr-1.5" />
            {searching ? "Searching..." : "Search"}
          </Button>
        </div>

        {/* Results */}
        {results.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Position</TableHead>
                <TableHead>Current Team</TableHead>
                <TableHead>Conference</TableHead>
                <TableHead>Portal</TableHead>
                <TableHead>ID</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r, i) => (
                <TableRow key={r.id || `hist-${i}`}>
                  <TableCell className="font-medium">{r.first_name} {r.last_name}</TableCell>
                  <TableCell>{r.position || "—"}</TableCell>
                  <TableCell>{r.team || <span className="text-muted-foreground italic">None</span>}</TableCell>
                  <TableCell>{r.conference || "—"}</TableCell>
                  <TableCell>
                    {r.transfer_portal ? (
                      <Badge variant="destructive" className="text-[10px]">Portal</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">Active</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">{r.source_player_id || "—"}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant={selectedPlayer?.source_player_id === r.source_player_id ? "default" : "outline"}
                      onClick={() => setSelectedPlayer(r)}
                    >
                      <UserPlus className="h-3.5 w-3.5 mr-1" />
                      Assign
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Assign to team */}
        {selectedPlayer && (
          <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
            <div className="text-sm font-semibold">
              Assign {selectedPlayer.first_name} {selectedPlayer.last_name} to a team
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Target Team</Label>
                <Select value={targetTeam} onValueChange={setTargetTeam}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select team..." />
                  </SelectTrigger>
                  <SelectContent>
                    {sortedTeams.map((t) => (
                      <SelectItem key={t.id} value={t.abbreviation || t.fullName || t.id}>
                        {t.abbreviation || t.fullName} {t.conference ? `(${t.conference})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Notes (optional)</Label>
                <Input
                  className="mt-1"
                  placeholder="e.g. Returning from TJ, missed 2025"
                  value={overrideNotes}
                  onChange={(e) => setOverrideNotes(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!targetTeam || assignMutation.isPending}
                onClick={() => assignMutation.mutate({ player: selectedPlayer, teamName: targetTeam })}
              >
                <Check className="h-4 w-4 mr-1" />
                {assignMutation.isPending ? "Assigning..." : "Confirm Assignment"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setSelectedPlayer(null); setTargetTeam(""); }}>
                <X className="h-4 w-4 mr-1" />
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
