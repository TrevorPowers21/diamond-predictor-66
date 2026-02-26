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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Pencil, Save, X, RefreshCw, Scale, Sliders, Trophy, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

// ─── Equation Constants Tab ───────────────────────────────────────────────────

function EquationConstantsTab() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const { data: configs = [], isLoading } = useQuery({
    queryKey: ["model_config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("model_config")
        .select("*")
        .order("model_type")
        .order("config_key");
      if (error) throw error;
      return data;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: number }) => {
      const { error } = await supabase.from("model_config").update({ config_value: value }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["model_config"] });
      toast.success("Constant updated");
      setEditingId(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSave = (id: string) => {
    const v = parseFloat(editValue);
    if (isNaN(v)) {
      toast.error("Invalid number");
      return;
    }
    updateMutation.mutate({ id, value: v });
  };

  // Group by model_type
  const grouped = configs.reduce((acc, c) => {
    if (!acc[c.model_type]) acc[c.model_type] = [];
    acc[c.model_type].push(c);
    return acc;
  }, {} as Record<string, typeof configs>);

  // Friendly label mapping
  const labelMap: Record<string, string> = {
    class_base_fs_avg: "FR→SO AVG Growth",
    class_base_fs_obp: "FR→SO OBP Growth",
    class_base_fs_slg: "FR→SO SLG Growth",
    class_base_sj_avg: "SO→JR AVG Growth",
    class_base_sj_obp: "SO→JR OBP Growth",
    class_base_sj_slg: "SO→JR SLG Growth",
    class_base_js_avg: "JR→SR AVG Growth",
    class_base_js_obp: "JR→SR OBP Growth",
    class_base_js_slg: "JR→SR SLG Growth",
    class_base_gr_avg: "Graduate AVG Growth",
    class_base_gr_obp: "Graduate OBP Growth",
    class_base_gr_slg: "Graduate SLG Growth",
    dampening_divisor_avg: "Dampening Divisor (AVG)",
    dampening_divisor_obp: "Dampening Divisor (OBP)",
    dampening_divisor_slg: "Dampening Divisor (SLG)",
    dev_coeff_avg: "Dev Coefficient (AVG)",
    dev_coeff_obp: "Dev Coefficient (OBP)",
    dev_coeff_slg: "Dev Coefficient (SLG)",
    ncaa_avg: "NCAA Base AVG",
    ncaa_obp: "NCAA Base OBP",
    ncaa_slg: "NCAA Base SLG",
    ncaa_wrc: "NCAA Base wRC",
    ncaa_power_rating: "NCAA Base Power Rating",
    conference_weight: "Conference Weight",
    power_weight: "Power Rating Weight",
  };

  const categoryOrder = [
    "Class Growth Bases",
    "Development Coefficients",
    "Dampening Divisors",
    "NCAA Baselines",
    "Weights",
  ];

  const categorize = (key: string) => {
    if (key.startsWith("class_base_")) return "Class Growth Bases";
    if (key.startsWith("dev_coeff_")) return "Development Coefficients";
    if (key.startsWith("dampening_")) return "Dampening Divisors";
    if (key.startsWith("ncaa_")) return "NCAA Baselines";
    return "Weights";
  };

  if (isLoading) return <p className="text-muted-foreground py-8 text-center">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Equation Constants</h3>
        <p className="text-sm text-muted-foreground">
          These values drive the returning player projection formula. Changes take effect on the next recalculation.
        </p>
      </div>

      {Object.entries(grouped).map(([modelType, items]) => {
        // Sub-group by category
        const byCategory = items.reduce((acc, item) => {
          const cat = categorize(item.config_key);
          if (!acc[cat]) acc[cat] = [];
          acc[cat].push(item);
          return acc;
        }, {} as Record<string, typeof items>);

        return (
          <Card key={modelType}>
            <CardHeader>
              <CardTitle className="text-base capitalize">{modelType} Model</CardTitle>
              <CardDescription>Season {items[0]?.season}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {categoryOrder.map((cat) => {
                const catItems = byCategory[cat];
                if (!catItems?.length) return null;
                return (
                  <div key={cat}>
                    <h4 className="text-sm font-semibold text-muted-foreground mb-2">{cat}</h4>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {catItems.map((c) => (
                        <div
                          key={c.id}
                          className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                        >
                          <div className="min-w-0 mr-2">
                            <p className="text-sm font-medium truncate">
                              {labelMap[c.config_key] || c.config_key}
                            </p>
                          </div>
                          {editingId === c.id ? (
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                step="0.001"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                className="w-24 h-7 text-sm"
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleSave(c.id)}
                                disabled={updateMutation.isPending}
                              >
                                <Save className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => setEditingId(null)}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1">
                              <span className="font-mono text-sm font-bold">
                                {Number(c.config_value).toFixed(3)}
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => {
                                  setEditingId(c.id);
                                  setEditValue(c.config_value.toString());
                                }}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ─── Power Ratings Tab ────────────────────────────────────────────────────────

function PowerRatingsTab() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRating, setEditRating] = useState("");
  const [search, setSearch] = useState("");

  const { data: ratings = [], isLoading } = useQuery({
    queryKey: ["power_ratings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("power_ratings")
        .select("*")
        .order("rating", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, rating }: { id: string; rating: number }) => {
      const { error } = await supabase.from("power_ratings").update({ rating }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["power_ratings"] });
      toast.success("Rating updated");
      setEditingId(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const filtered = search
    ? ratings.filter((r) => r.conference.toLowerCase().includes(search.toLowerCase()))
    : ratings;

  if (isLoading) return <p className="text-muted-foreground py-8 text-center">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Conference Power Ratings</h3>
          <p className="text-sm text-muted-foreground">{ratings.length} conferences loaded</p>
        </div>
        <Input
          placeholder="Search conference…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-48"
        />
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Conference</TableHead>
                  <TableHead className="text-right">Rating</TableHead>
                  <TableHead>Season</TableHead>
                  <TableHead className="text-right">AVG+</TableHead>
                  <TableHead className="text-right">OBP+</TableHead>
                  <TableHead className="text-right">SLG+</TableHead>
                  <TableHead className="text-right">OPS+</TableHead>
                  <TableHead className="text-right">wRC+</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r, idx) => {
                  let parsed: any = {};
                  try {
                    parsed = typeof r.notes === "string" ? JSON.parse(r.notes) : r.notes || {};
                  } catch {}

                  return (
                    <TableRow key={r.id}>
                      <TableCell className="text-muted-foreground text-xs">{idx + 1}</TableCell>
                      <TableCell className="font-medium text-sm">{r.conference}</TableCell>
                      <TableCell className="text-right">
                        {editingId === r.id ? (
                          <div className="flex items-center justify-end gap-1">
                            <Input
                              type="number"
                              step="0.1"
                              value={editRating}
                              onChange={(e) => setEditRating(e.target.value)}
                              className="w-20 h-7 text-sm"
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => {
                                const v = parseFloat(editRating);
                                if (!isNaN(v)) updateMutation.mutate({ id: r.id, rating: v });
                              }}
                            >
                              <Save className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingId(null)}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <span className="font-mono font-bold">{Number(r.rating).toFixed(0)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">{r.season}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{parsed.avg_plus ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{parsed.obp_plus ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{parsed.slg_plus ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{parsed.ops_plus ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{parsed.wrc_plus ?? "—"}</TableCell>
                      <TableCell>
                        {editingId !== r.id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => {
                              setEditingId(r.id);
                              setEditRating(r.rating.toString());
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Dev Weights Tab ──────────────────────────────────────────────────────────

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

type WeightForm = {
  position: string;
  from_class: string;
  to_class: string;
  stat_category: string;
  weight: string;
  notes: string;
};

const emptyForm: WeightForm = { position: "", from_class: "", to_class: "", stat_category: "overall", weight: "1.000", notes: "" };

function DevWeightsTab() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<WeightForm>(emptyForm);
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
    mutationFn: async (formData: WeightForm) => {
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
    onError: (e) => toast.error(e.message),
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
    onError: (e) => toast.error(e.message),
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

  if (isLoading) return <p className="text-muted-foreground py-8 text-center">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Developmental Weights</h3>
          <p className="text-sm text-muted-foreground">
            {weights.length} weights across {uniquePositions.length} positions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filterPosition} onValueChange={setFilterPosition}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Positions</SelectItem>
              {uniquePositions.map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="gap-1"
            onClick={() => { setEditingId(null); setForm(emptyForm); setDialogOpen(true); }}
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="text-center py-12">
              <Scale className="mx-auto h-10 w-10 text-muted-foreground/40" />
              <p className="mt-3 text-muted-foreground">No developmental weights configured.</p>
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
                        <span className={
                          Number(w.weight) > 1 ? "text-[hsl(var(--success))]"
                            : Number(w.weight) < 1 ? "text-destructive"
                            : "text-muted-foreground"
                        }>
                          {Number(w.weight).toFixed(3)}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-muted-foreground text-sm">{w.notes || "—"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(w)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteMutation.mutate(w.id)}>
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

      <Dialog open={dialogOpen} onOpenChange={(o) => (o ? setDialogOpen(true) : closeDialog())}>
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
              <Input type="number" step="0.001" min="0" max="5" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} />
              <p className="text-xs text-muted-foreground">1.000 = no adjustment. &gt;1 = positive. &lt;1 = regression.</p>
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
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
  );
}

// ─── Quick Actions Tab ────────────────────────────────────────────────────────

function QuickActionsTab() {
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ updated: number; errors: number; total: number } | null>(null);

  const runBulkRecalculate = async () => {
    setBulkLoading(true);
    setBulkResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const res = await supabase.functions.invoke("recalculate-prediction", {
        body: { action: "bulk_recalculate" },
      });
      const result = res.data;
      if (result?.success) {
        setBulkResult({ updated: result.updated, errors: result.errors, total: result.total });
        toast.success(`Recalculated ${result.updated} of ${result.total} predictions`);
      } else {
        toast.error(result?.error ?? "Failed");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Quick Actions</h3>
        <p className="text-sm text-muted-foreground">Run bulk operations after changing constants or weights.</p>
      </div>
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div>
            <p className="font-medium">Bulk Recalculate Returner Predictions</p>
            <p className="text-sm text-muted-foreground">
              Re-run the formula on all active returner predictions using the latest equation constants and power ratings.
            </p>
          </div>
          <Button onClick={runBulkRecalculate} disabled={bulkLoading} className="gap-2">
            {bulkLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {bulkLoading ? "Recalculating…" : "Recalculate All"}
          </Button>
          {bulkResult && (
            <p className="text-sm text-muted-foreground">
              Updated {bulkResult.updated} of {bulkResult.total} predictions
              {bulkResult.errors > 0 ? `, ${bulkResult.errors} errors` : ""}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Admin Dashboard ─────────────────────────────────────────────────────

export default function AdminDashboard() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const isStaff = hasRole("staff");

  if (!isAdmin && !isStaff) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">You don't have access to this page.</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Admin Dashboard</h2>
          <p className="text-muted-foreground">
            Manage equation constants, power ratings, and developmental weights in one place.
          </p>
        </div>

        <Tabs defaultValue="equations" className="space-y-4">
          <TabsList>
            <TabsTrigger value="equations" className="gap-1.5">
              <Sliders className="h-4 w-4" />
              Equations
            </TabsTrigger>
            <TabsTrigger value="power" className="gap-1.5">
              <Trophy className="h-4 w-4" />
              Power Ratings
            </TabsTrigger>
            <TabsTrigger value="weights" className="gap-1.5">
              <Scale className="h-4 w-4" />
              Dev Weights
            </TabsTrigger>
            <TabsTrigger value="actions" className="gap-1.5">
              <RefreshCw className="h-4 w-4" />
              Actions
            </TabsTrigger>
          </TabsList>

          <TabsContent value="equations">
            <EquationConstantsTab />
          </TabsContent>
          <TabsContent value="power">
            <PowerRatingsTab />
          </TabsContent>
          <TabsContent value="weights">
            <DevWeightsTab />
          </TabsContent>
          <TabsContent value="actions">
            <QuickActionsTab />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
