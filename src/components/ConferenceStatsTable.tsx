import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Search, Edit2, Check, X, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface ConferenceStat {
  id: string;
  conference: string;
  season: number;
  avg: number | null;
  obp: number | null;
  slg: number | null;
  ops: number | null;
  iso: number | null;
  wrc: number | null;
  ev_score: number | null;
  barrel_score: number | null;
  whiff_score: number | null;
  chase_score: number | null;
  offensive_power_rating: number | null;
  avg_plus: number | null;
  obp_plus: number | null;
  slg_plus: number | null;
  ops_plus: number | null;
  iso_plus: number | null;
  wrc_plus: number | null;
  power_rating_plus: number | null;
  stuff_plus: number | null;
}

type EditFields = Omit<ConferenceStat, "id" | "created_at" | "updated_at">;

const NUM_FIELDS: (keyof EditFields)[] = [
  "avg", "obp", "slg", "ops", "iso", "wrc",
  "avg_plus", "obp_plus", "slg_plus", "ops_plus", "iso_plus", "wrc_plus", "stuff_plus",
];

const LABELS: Record<string, string> = {
  avg: "AVG", obp: "OBP", slg: "SLG", ops: "OPS", iso: "ISO", wrc: "WRC",
  avg_plus: "AVG+", obp_plus: "OBP+", slg_plus: "SLG+",
  ops_plus: "OPS+", iso_plus: "ISO+", wrc_plus: "WRC+", stuff_plus: "Stuff+",
};

export default function ConferenceStatsTable() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editData, setEditData] = useState<Partial<EditFields>>({});

  const { data: stats = [], isLoading } = useQuery({
    queryKey: ["conference_stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conference_stats")
        .select("*")
        .order("conference");
      if (error) throw error;
      return data as ConferenceStat[];
    },
  });

  const updateStat = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<EditFields> }) => {
      const { error } = await supabase
        .from("conference_stats")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conference_stats"] });
      setEditingId(null);
      toast.success("Conference stats updated");
    },
    onError: (e) => toast.error(`Failed: ${e.message}`),
  });

  const deleteStat = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("conference_stats").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conference_stats"] });
      toast.success("Conference stats deleted");
    },
    onError: (e) => toast.error(`Failed: ${e.message}`),
  });

  const { ncaaRow, filtered } = useMemo(() => {
    let list = stats;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((s) => s.conference.toLowerCase().includes(q));
    }
    const ncaa = list.find((s) => s.conference.toLowerCase().includes("ncaa"));
    const rest = list.filter((s) => !s.conference.toLowerCase().includes("ncaa"));
    return { ncaaRow: ncaa || null, filtered: rest };
  }, [stats, search]);

  const startEdit = (stat: ConferenceStat) => {
    setEditingId(stat.id);
    setEditName(stat.conference);
    const fields: Record<string, number | null> = {};
    NUM_FIELDS.forEach((f) => { fields[f] = stat[f] as number | null; });
    setEditData(fields);
  };

  const handleFieldChange = (field: keyof EditFields, value: string) => {
    setEditData((prev) => ({
      ...prev,
      [field]: value === "" ? null : parseFloat(value),
    }));
  };

  const fmt = (val: number | null, isPlus = false) => {
    if (val === null || val === undefined) return "—";
    return isPlus ? val.toFixed(0) : val.toFixed(3);
  };

  const renderRow = (stat: ConferenceStat, pinned = false) => (
    <TableRow key={stat.id} className={pinned ? "bg-muted/50 font-semibold sticky bottom-0 z-10 border-t-2 border-primary/20" : ""}>
      <TableCell className={`font-medium sticky left-0 z-10 ${pinned ? "bg-muted/50" : "bg-background"}`}>
        {editingId === stat.id ? (
          <Input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="h-7 w-full max-w-[160px] text-xs"
          />
        ) : (
          stat.conference
        )}
      </TableCell>
      {NUM_FIELDS.map((f) => (
        <TableCell key={f} className="text-center">
          {editingId === stat.id ? (
            <Input
              type="number"
              step={f.includes("plus") || f === "offensive_power_rating" ? "1" : "0.001"}
              value={editData[f] ?? ""}
              onChange={(e) => handleFieldChange(f, e.target.value)}
              className="h-7 w-[70px] text-center text-xs"
            />
          ) : (
            <span className="text-sm tabular-nums">
              {fmt(stat[f] as number | null, f.includes("plus") || f === "offensive_power_rating")}
            </span>
          )}
        </TableCell>
      ))}
      <TableCell>
        {editingId === stat.id ? (
          <div className="flex gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => updateStat.mutate({ id: stat.id, updates: { ...editData, conference: editName } })}
            >
              <Check className="h-3.5 w-3.5 text-primary" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingId(null)}>
              <X className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        ) : (
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(stat)}>
              <Edit2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => {
                if (confirm(`Delete stats for "${stat.conference}"?`)) deleteStat.mutate(stat.id);
              }}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-base">Conference Stats (2025)</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Plus stats (AVG+ through WRC+) drive the transfer portal equation
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search conferences..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">Loading…</div>
        ) : filtered.length === 0 && !ncaaRow ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            No conference stats found. Run "Import Conference Stats" from Data Sync.
          </div>
        ) : (
          <div className="overflow-auto max-h-[60vh]">
            <Table>
              <TableHeader className="sticky top-0 z-20 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
                <TableRow>
                  <TableHead className="min-w-[160px] sticky left-0 bg-background z-10">Conference</TableHead>
                  {NUM_FIELDS.map((f) => (
                    <TableHead key={f} className="min-w-[70px] text-center">{LABELS[f]}</TableHead>
                  ))}
                  <TableHead className="w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((stat) => renderRow(stat))}
                {ncaaRow && renderRow(ncaaRow, true)}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
