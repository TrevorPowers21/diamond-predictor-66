/**
 * Admin — Portal Override Tab
 *
 * Search for a player by name or source_player_id and edit their portal fields
 * directly: status, entry date, commit school, commit date. Writes to the
 * `players` table — both `portal_status` (enum) and `transfer_portal` (boolean)
 * stay in sync so the Dashboard portal feed and the Transfer Portal simulator
 * both pick up the change.
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { PortalStatusEditor, type PortalFields } from "@/components/PortalStatus";

interface PortalPlayerRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  team: string | null;
  conference: string | null;
  portal_status: string | null;
  portal_entry_date: string | null;
  commit_school: string | null;
  commit_date: string | null;
  transfer_portal: boolean | null;
  source_player_id: string | null;
}

const PORTAL_SELECT =
  "id, first_name, last_name, position, team, conference, portal_status, portal_entry_date, commit_school, commit_date, transfer_portal, source_player_id";

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function PortalOverrideTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [searchById, setSearchById] = useState("");
  const [results, setResults] = useState<PortalPlayerRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [recent, setRecent] = useState<PortalPlayerRow[]>([]);

  const loadRecent = async () => {
    const { data } = await supabase
      .from("players")
      .select(PORTAL_SELECT)
      .in("portal_status", ["IN PORTAL", "COMMITTED", "WITHDRAWN", "WATCHING"])
      .order("portal_entry_date", { ascending: false, nullsFirst: false })
      .limit(15);
    setRecent((data || []) as PortalPlayerRow[]);
  };

  const handleSearch = async () => {
    if (!search.trim() && !searchById.trim()) return;
    setSearching(true);
    try {
      let data: any[] = [];
      if (searchById.trim()) {
        const { data: byId } = await supabase
          .from("players")
          .select(PORTAL_SELECT)
          .eq("source_player_id", searchById.trim());
        data = byId || [];
      }
      if (data.length === 0 && search.trim()) {
        const terms = search.trim().split(/\s+/);
        let query = supabase.from("players").select(PORTAL_SELECT);
        if (terms.length >= 2) {
          query = query
            .ilike("first_name", `%${terms[0]}%`)
            .ilike("last_name", `%${terms.slice(1).join(" ")}%`);
        } else {
          query = query.or(`first_name.ilike.%${terms[0]}%,last_name.ilike.%${terms[0]}%`);
        }
        const { data: byName } = await query.limit(25);
        data = byName || [];
      }
      setResults(data as PortalPlayerRow[]);
      if (data.length === 0) toast.info("No players found");
    } catch (err: any) {
      toast.error(`Search failed: ${err.message}`);
    } finally {
      setSearching(false);
    }
  };

  const saveFields = async (playerId: string, fields: PortalFields) => {
    const { error } = await supabase
      .from("players")
      .update({
        portal_status: fields.portal_status,
        transfer_portal: fields.portal_status === "IN PORTAL",
        portal_entry_date: fields.portal_entry_date,
        commit_school: fields.commit_school,
        commit_date: fields.commit_date,
      } as any)
      .eq("id", playerId);
    if (error) {
      toast.error(`Save failed: ${error.message}`);
      throw error;
    }
    toast.success("Portal status updated");
    // Patch in place so the badge reflects new state immediately
    const patch = (rows: PortalPlayerRow[]) =>
      rows.map((r) =>
        r.id === playerId
          ? {
              ...r,
              portal_status: fields.portal_status,
              portal_entry_date: fields.portal_entry_date,
              commit_school: fields.commit_school,
              commit_date: fields.commit_date,
              transfer_portal: fields.portal_status === "IN PORTAL",
            }
          : r,
      );
    setResults(patch);
    setRecent(patch);
    queryClient.invalidateQueries({ queryKey: ["target-board"] });
    queryClient.invalidateQueries({ queryKey: ["player-profile", playerId] });
  };

  const renderRow = (p: PortalPlayerRow) => (
    <TableRow key={p.id}>
      <TableCell className="font-medium">
        {p.first_name} {p.last_name}
        {p.source_player_id && (
          <div className="text-[10px] text-muted-foreground font-mono">{p.source_player_id}</div>
        )}
      </TableCell>
      <TableCell className="text-xs">{p.team || "—"}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{p.position || "—"}</TableCell>
      <TableCell>
        <PortalStatusEditor player={p} onSave={(f) => saveFields(p.id, f)} />
      </TableCell>
      <TableCell className="text-xs">{formatDate(p.portal_entry_date)}</TableCell>
      <TableCell className="text-xs">
        {p.commit_school ? (
          <>
            {p.commit_school}
            <div className="text-[10px] text-muted-foreground">{formatDate(p.commit_date)}</div>
          </>
        ) : (
          "—"
        )}
      </TableCell>
    </TableRow>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          Portal Override
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Set portal status, entry date, and commit destination for any player. Writes go to{" "}
          <code className="text-[10px]">players.portal_status</code> and keep{" "}
          <code className="text-[10px]">transfer_portal</code> in sync so the Dashboard portal feed
          and Transfer Portal simulator both reflect the change.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div className="space-y-1.5">
            <Label className="text-xs">Player name</Label>
            <Input
              placeholder="e.g. Carson Bowman"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">source_player_id</Label>
            <Input
              placeholder="exact ID"
              value={searchById}
              onChange={(e) => setSearchById(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSearch} disabled={searching} className="gap-2">
              <Search className="h-4 w-4" />
              {searching ? "Searching…" : "Search"}
            </Button>
            <Button variant="outline" onClick={loadRecent}>Show current portal players</Button>
          </div>
        </div>

        {(results.length > 0 || recent.length > 0) && (
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Player</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Pos</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Entered</TableHead>
                  <TableHead>Commit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.length > 0 ? results.map(renderRow) : recent.map(renderRow)}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
