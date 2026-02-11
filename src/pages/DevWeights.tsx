import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Scale } from "lucide-react";

const POSITIONS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH", "UTIL", "RHP", "LHP"];
const CLASS_YEARS = ["FR", "SO", "JR", "SR", "Graduate"];
const STAT_CATEGORIES = ["overall", "batting_avg", "on_base_pct", "slugging_pct", "ops", "wrc_plus", "era", "whip"];

type DevWeight = {
  id: string;
  position: string;
  from_class: string;
  to_class: string;
  stat_category: string;
  weight: number;
  notes: string | null;
};

type FormData = {
  position: string;
  from_class: string;
  to_class: string;
  stat_category: string;
  weight: string;
  notes: string;
};

const emptyForm: FormData = { position: "", from_class: "", to_class: "", stat_category: "overall", weight: "1.000", notes: "" };

export default function DevWeights() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [filterPosition, setFilterPosition] = useState<string>("all");

  const { data: weights = [], isLoading } = useQuery({
    queryKey: ["developmental_weights"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("developmental_weights")
        .select("*")
        .order("position")
        .order("from_class")
        .order("to_class");
      if (error) throw error;
      return data as DevWeight[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const payload = {
        position: formData.position,
        from_class: formData.from_class,
        to_class: formData.to_class,
        stat_category: formData.stat_category,
        weight: parseFloat(formData.weight),
        notes: formData.notes || null,
      };

      if (editingId) {
        const { error } = await supabase.from("developmental_weights").update(payload).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("developmental_weights").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["developmental_weights"] });
      toast.success(editingId ? "Weight updated" : "Weight added");
      closeDialog();
    },
    onError: (e) => toast.error(`Failed to save: ${e.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("developmental_weights").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["developmental_weights"] });
      toast.success("Weight deleted");
    },
    onError: (e) => toast.error(`Failed to delete: ${e.message}`),
  });

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const openEdit = (w: DevWeight) => {
    setEditingId(w.id);
    setForm({
      position: w.position,
      from_class: w.from_class,
      to_class: w.to_class,
      stat_category: w.stat_category,
      weight: w.weight.toString(),
      notes: w.notes || "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.position || !form.from_class || !form.to_class) {
      toast.error("Position and class transitions are required");
      return;
    }
    const w = parseFloat(form.weight);
    if (isNaN(w) || w < 0 || w > 5) {
      toast.error("Weight must be between 0 and 5");
      return;
    }
    saveMutation.mutate(form);
  };

  const filtered = filterPosition === "all" ? weights : weights.filter((w) => w.position === filterPosition);

  const uniquePositions = [...new Set(weights.map((w) => w.position))];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Developmental Weights</h2>
            <p className="text-muted-foreground">
              Configure how much weight each class transition carries for player projections
            </p>
          </div>

          <Dialog open={dialogOpen} onOpenChange={(o) => (o ? setDialogOpen(true) : closeDialog())}>
            <DialogTrigger asChild>
              <Button className="gap-2" onClick={() => { setEditingId(null); setForm(emptyForm); }}>
                <Plus className="h-4 w-4" /> Add Weight
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingId ? "Edit" : "Add"} Developmental Weight</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Position</Label>
                    <Select value={form.position} onValueChange={(v) => setForm({ ...form, position: v })}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        {POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Stat Category</Label>
                    <Select value={form.stat_category} onValueChange={(v) => setForm({ ...form, stat_category: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STAT_CATEGORIES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>From Class</Label>
                    <Select value={form.from_class} onValueChange={(v) => setForm({ ...form, from_class: v })}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        {CLASS_YEARS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>To Class</Label>
                    <Select value={form.to_class} onValueChange={(v) => setForm({ ...form, to_class: v })}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        {CLASS_YEARS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Weight (0–5)</Label>
                  <Input
                    type="number"
                    step="0.001"
                    min="0"
                    max="5"
                    value={form.weight}
                    onChange={(e) => setForm({ ...form, weight: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    1.000 = no adjustment. &gt;1 = positive development expected. &lt;1 = regression expected.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Notes (optional)</Label>
                  <Textarea
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    placeholder="e.g. historically strong FR→SO jump for catchers"
                    rows={2}
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={closeDialog}>Cancel</Button>
                  <Button type="submit" disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? "Saving…" : editingId ? "Update" : "Add"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Summary cards */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Weights</CardDescription>
              <CardTitle className="text-3xl">{weights.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Positions Covered</CardDescription>
              <CardTitle className="text-3xl">{uniquePositions.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Avg Weight</CardDescription>
              <CardTitle className="text-3xl">
                {weights.length > 0 ? (weights.reduce((s, w) => s + Number(w.weight), 0) / weights.length).toFixed(3) : "—"}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Filter + table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Scale className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Weight Table</CardTitle>
              </div>
              <Select value={filterPosition} onValueChange={setFilterPosition}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Positions</SelectItem>
                  {uniquePositions.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-muted-foreground py-8 text-center">Loading…</p>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12">
                <Scale className="mx-auto h-10 w-10 text-muted-foreground/40" />
                <p className="mt-3 text-muted-foreground">No developmental weights configured yet.</p>
                <p className="text-sm text-muted-foreground">Click "Add Weight" to get started.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Position</TableHead>
                      <TableHead>From → To</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Weight</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="w-20" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((w) => (
                      <TableRow key={w.id}>
                        <TableCell className="font-medium">{w.position}</TableCell>
                        <TableCell>{w.from_class} → {w.to_class}</TableCell>
                        <TableCell className="capitalize">{w.stat_category.replace(/_/g, " ")}</TableCell>
                        <TableCell className="text-right font-mono">
                          <span
                            className={
                              Number(w.weight) > 1
                                ? "text-[hsl(var(--success))]"
                                : Number(w.weight) < 1
                                ? "text-destructive"
                                : "text-muted-foreground"
                            }
                          >
                            {Number(w.weight).toFixed(3)}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-muted-foreground text-sm">{w.notes || "—"}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(w)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => deleteMutation.mutate(w.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
