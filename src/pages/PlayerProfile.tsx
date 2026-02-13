import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Pencil, Save, X, TrendingUp, TrendingDown } from "lucide-react";
import { toast } from "sonner";

const statFormat = (v: number | null | undefined, decimals = 3) => {
  if (v == null) return "—";
  return v >= 1 && decimals === 3 ? v.toFixed(3) : v.toFixed(decimals);
};

const pctFormat = (v: number | null | undefined) => {
  if (v == null) return "—";
  return Math.round(v).toString();
};

const classTransitionLabel: Record<string, string> = {
  FS: "Freshman → Sophomore",
  SJ: "Sophomore → Junior",
  JS: "Junior → Senior",
  GR: "Graduate",
};

function ScoutGrade({ label, value, fullLabel }: { label: string; value: number | null; fullLabel: string }) {
  if (value == null) return null;
  const tier =
    value >= 80 ? "bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))] border-[hsl(var(--success)/0.3)]" :
    value >= 50 ? "bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))] border-[hsl(var(--warning)/0.3)]" :
    "bg-destructive/15 text-destructive border-destructive/30";
  const grade =
    value >= 80 ? "Elite" :
    value >= 70 ? "Plus-Plus" :
    value >= 60 ? "Plus" :
    value >= 50 ? "Average" :
    value >= 40 ? "Below Avg" : "Poor";
  return (
    <div className={`rounded-lg border p-3 ${tier}`}>
      <div className="text-xs font-medium opacity-80">{fullLabel}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      <div className="text-xs font-semibold mt-0.5">{grade}</div>
    </div>
  );
}

function StatRow({ label, from, predicted }: { label: string; from: number | null; predicted: number | null }) {
  const diff = from != null && predicted != null ? predicted - from : null;
  const diffColor = diff != null ? (diff > 0.005 ? "text-[hsl(var(--success))]" : diff < -0.005 ? "text-destructive" : "text-muted-foreground") : "";
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-4">
        <span className="text-sm font-mono text-muted-foreground w-16 text-right">{statFormat(from)}</span>
        <span className="text-xs text-muted-foreground">→</span>
        <span className={`text-sm font-mono font-bold w-16 text-right ${diffColor}`}>
          {statFormat(predicted)}
          {diff != null && Math.abs(diff) > 0.001 && (
            diff > 0 ? <TrendingUp className="inline h-3 w-3 ml-1" /> : <TrendingDown className="inline h-3 w-3 ml-1" />
          )}
        </span>
      </div>
    </div>
  );
}

export default function PlayerProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, any>>({});

  const { data: player, isLoading } = useQuery({
    queryKey: ["player-profile", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("players")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: predictions = [] } = useQuery({
    queryKey: ["player-predictions", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_predictions")
        .select("*")
        .eq("player_id", id!)
        .eq("status", "active");
      if (error) throw error;
      return data || [];
    },
    enabled: !!id,
  });

  const { data: seasonStats = [] } = useQuery({
    queryKey: ["player-season-stats", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("season_stats")
        .select("*")
        .eq("player_id", id!)
        .order("season", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!id,
  });

  const { data: nilValuation } = useQuery({
    queryKey: ["player-nil", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nil_valuations")
        .select("*")
        .eq("player_id", id!)
        .order("season", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const updatePlayer = useMutation({
    mutationFn: async (updates: Record<string, any>) => {
      const { error } = await supabase
        .from("players")
        .update(updates)
        .eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["player-profile", id] });
      queryClient.invalidateQueries({ queryKey: ["returning-players"] });
      toast.success("Player updated");
      setEditing(false);
    },
    onError: (e) => toast.error(`Update failed: ${e.message}`),
  });

  const startEdit = () => {
    if (!player) return;
    setEditForm({
      first_name: player.first_name,
      last_name: player.last_name,
      team: player.team || "",
      position: player.position || "",
      conference: player.conference || "",
      class_year: player.class_year || "",
      handedness: player.handedness || "",
      bats_hand: (player as any).bats_hand || "",
      throws_hand: (player as any).throws_hand || "",
      age: (player as any).age || "",
      height_inches: player.height_inches || "",
      weight: player.weight || "",
      home_state: player.home_state || "",
      high_school: player.high_school || "",
      notes: player.notes || "",
    });
    setEditing(true);
  };

  const saveEdit = () => {
    const updates: Record<string, any> = {};
    for (const [key, val] of Object.entries(editForm)) {
      if (val === "") {
        updates[key] = null;
      } else if (key === "height_inches" || key === "weight" || key === "age") {
        updates[key] = val ? Number(val) : null;
      } else {
        updates[key] = val;
      }
    }
    updatePlayer.mutate(updates);
  };

  const regularPred = predictions.find((p) => p.variant === "regular");
  const xstatsPred = predictions.find((p) => p.variant === "xstats");

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-20 text-muted-foreground">Loading player…</div>
      </DashboardLayout>
    );
  }

  if (!player) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <p className="text-muted-foreground">Player not found</p>
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="mr-2 h-4 w-4" />Go Back
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const formatHeight = (inches: number | null) => {
    if (!inches) return "—";
    return `${Math.floor(inches / 12)}'${inches % 12}"`;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-5xl mx-auto">
        {/* Back + Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h2 className="text-2xl font-bold tracking-tight">
              {player.first_name} {player.last_name}
            </h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {player.position && <Badge variant="secondary">{player.position}</Badge>}
              {player.team && <Badge variant="outline">{player.team}</Badge>}
              {player.conference && <Badge variant="outline" className="text-muted-foreground">{player.conference}</Badge>}
              {player.transfer_portal && <Badge className="bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))] border-[hsl(var(--warning)/0.3)]">Transfer Portal</Badge>}
            </div>
          </div>
          {!editing ? (
            <Button variant="outline" size="sm" onClick={startEdit}>
              <Pencil className="mr-2 h-3.5 w-3.5" />Edit
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
                <X className="mr-1 h-3.5 w-3.5" />Cancel
              </Button>
              <Button size="sm" onClick={saveEdit} disabled={updatePlayer.isPending}>
                <Save className="mr-1 h-3.5 w-3.5" />Save
              </Button>
            </div>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Player Info Card */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-base">Player Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {editing ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">First Name</Label>
                      <Input value={editForm.first_name} onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })} className="h-8 text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs">Last Name</Label>
                      <Input value={editForm.last_name} onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })} className="h-8 text-sm" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Team</Label>
                    <Input value={editForm.team} onChange={(e) => setEditForm({ ...editForm, team: e.target.value })} className="h-8 text-sm" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Position</Label>
                      <Input value={editForm.position} onChange={(e) => setEditForm({ ...editForm, position: e.target.value })} className="h-8 text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs">Conference</Label>
                      <Input value={editForm.conference} onChange={(e) => setEditForm({ ...editForm, conference: e.target.value })} className="h-8 text-sm" />
                    </div>
                  </div>
                   <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Class Year</Label>
                      <Input value={editForm.class_year} onChange={(e) => setEditForm({ ...editForm, class_year: e.target.value })} className="h-8 text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs">Age</Label>
                      <Input type="number" value={editForm.age} onChange={(e) => setEditForm({ ...editForm, age: e.target.value })} className="h-8 text-sm" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Bats</Label>
                      <Select value={editForm.bats_hand || "none"} onValueChange={(v) => setEditForm({ ...editForm, bats_hand: v === "none" ? "" : v })}>
                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          <SelectItem value="R">Right</SelectItem>
                          <SelectItem value="L">Left</SelectItem>
                          <SelectItem value="S">Switch</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Throws</Label>
                      <Select value={editForm.throws_hand || "none"} onValueChange={(v) => setEditForm({ ...editForm, throws_hand: v === "none" ? "" : v })}>
                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          <SelectItem value="R">Right</SelectItem>
                          <SelectItem value="L">Left</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Height (inches)</Label>
                      <Input type="number" value={editForm.height_inches} onChange={(e) => setEditForm({ ...editForm, height_inches: e.target.value })} className="h-8 text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs">Weight (lbs)</Label>
                      <Input type="number" value={editForm.weight} onChange={(e) => setEditForm({ ...editForm, weight: e.target.value })} className="h-8 text-sm" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Home State</Label>
                    <Input value={editForm.home_state} onChange={(e) => setEditForm({ ...editForm, home_state: e.target.value })} className="h-8 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">High School</Label>
                    <Input value={editForm.high_school} onChange={(e) => setEditForm({ ...editForm, high_school: e.target.value })} className="h-8 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">Notes</Label>
                    <Textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} className="text-sm min-h-[60px]" />
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <InfoRow label="Team" value={player.team} />
                  <InfoRow label="Conference" value={player.conference} />
                  <InfoRow label="Position" value={player.position} />
                  <InfoRow label="Class Year" value={player.class_year} />
                  <InfoRow label="Age" value={(player as any).age?.toString()} />
                  <InfoRow label="Bats" value={(player as any).bats_hand === "R" ? "Right" : (player as any).bats_hand === "L" ? "Left" : (player as any).bats_hand === "S" ? "Switch" : (player as any).bats_hand} />
                  <InfoRow label="Throws" value={(player as any).throws_hand === "R" ? "Right" : (player as any).throws_hand === "L" ? "Left" : (player as any).throws_hand} />
                  <InfoRow label="Height" value={formatHeight(player.height_inches)} />
                  <InfoRow label="Weight" value={player.weight ? `${player.weight} lbs` : null} />
                  <InfoRow label="Home State" value={player.home_state} />
                  <InfoRow label="High School" value={player.high_school} />
                  {player.notes && (
                    <>
                      <Separator className="my-2" />
                      <div>
                        <span className="text-xs text-muted-foreground">Notes</span>
                        <p className="text-sm mt-1">{player.notes}</p>
                      </div>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Predictions & Scouting */}
          <div className="lg:col-span-2 space-y-6">
            {/* Predicted Stats */}
            {(regularPred || xstatsPred) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Predicted Stats</CardTitle>
                  <CardDescription>
                    {regularPred?.class_transition && classTransitionLabel[regularPred.class_transition]}
                    {regularPred?.dev_aggressiveness != null && ` · Dev Confidence: ${regularPred.dev_aggressiveness}`}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-6 md:grid-cols-2">
                    {regularPred && (
                      <div>
                        <h4 className="text-sm font-semibold mb-2">Regular Stats</h4>
                        <div className="divide-y divide-border">
                          <StatRow label="AVG" from={regularPred.from_avg} predicted={regularPred.p_avg} />
                          <StatRow label="OBP" from={regularPred.from_obp} predicted={regularPred.p_obp} />
                          <StatRow label="SLG" from={regularPred.from_slg} predicted={regularPred.p_slg} />
                          <div className="flex items-center justify-between py-2">
                            <span className="text-sm font-semibold">OPS</span>
                            <span className="text-sm font-mono font-bold">{statFormat(regularPred.p_ops)}</span>
                          </div>
                          <div className="flex items-center justify-between py-2">
                            <span className="text-sm font-semibold">ISO</span>
                            <span className="text-sm font-mono font-bold">{statFormat(regularPred.p_iso)}</span>
                          </div>
                          <div className="flex items-center justify-between py-2">
                            <span className="text-sm font-semibold">wRC+</span>
                            <span className="text-sm font-mono font-bold">{pctFormat(regularPred.p_wrc_plus)}</span>
                          </div>
                        </div>
                      </div>
                    )}
                    {xstatsPred && (
                      <div>
                        <h4 className="text-sm font-semibold mb-2">xStats</h4>
                        <div className="divide-y divide-border">
                          <StatRow label="xAVG" from={xstatsPred.from_avg} predicted={xstatsPred.p_avg} />
                          <StatRow label="xOBP" from={xstatsPred.from_obp} predicted={xstatsPred.p_obp} />
                          <StatRow label="xSLG" from={xstatsPred.from_slg} predicted={xstatsPred.p_slg} />
                          <div className="flex items-center justify-between py-2">
                            <span className="text-sm font-semibold">xOPS</span>
                            <span className="text-sm font-mono font-bold">{statFormat(xstatsPred.p_ops)}</span>
                          </div>
                          <div className="flex items-center justify-between py-2">
                            <span className="text-sm font-semibold">xISO</span>
                            <span className="text-sm font-mono font-bold">{statFormat(xstatsPred.p_iso)}</span>
                          </div>
                          <div className="flex items-center justify-between py-2">
                            <span className="text-sm font-semibold">xWRC+</span>
                            <span className="text-sm font-mono font-bold">{pctFormat(xstatsPred.p_wrc_plus)}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Scouting Grades */}
            {regularPred && (regularPred.ev_score != null || regularPred.barrel_score != null || regularPred.whiff_score != null || regularPred.chase_score != null) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Scouting Grades</CardTitle>
                  <CardDescription>
                    Power Rating+: <span className="font-mono font-bold">{pctFormat(regularPred.power_rating_plus)}</span>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <ScoutGrade label="EV" value={regularPred.ev_score} fullLabel="Exit Velocity" />
                    <ScoutGrade label="Brl" value={regularPred.barrel_score} fullLabel="Barrel Rate" />
                    <ScoutGrade label="Whf" value={regularPred.whiff_score} fullLabel="Whiff Rate" />
                    <ScoutGrade label="Chs" value={regularPred.chase_score} fullLabel="Chase Rate" />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* NIL Valuation */}
            {nilValuation && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">NIL Valuation</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-6">
                    <div>
                      <div className="text-3xl font-bold text-[hsl(var(--success))]">
                        ${nilValuation.estimated_value?.toLocaleString() ?? "—"}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Season {nilValuation.season} · {nilValuation.model_version && `v${nilValuation.model_version}`}
                      </p>
                    </div>
                    {nilValuation.offensive_effectiveness != null && (
                      <div className="text-center">
                        <div className="text-xl font-bold">{nilValuation.offensive_effectiveness.toFixed(3)}</div>
                        <p className="text-xs text-muted-foreground">Offensive Effectiveness</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Season Stats */}
            {seasonStats.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Season Stats</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">Season</th>
                          <th className="text-right px-2 py-2 font-medium text-muted-foreground">G</th>
                          <th className="text-right px-2 py-2 font-medium text-muted-foreground">AB</th>
                          <th className="text-right px-2 py-2 font-medium text-muted-foreground">H</th>
                          <th className="text-right px-2 py-2 font-medium text-muted-foreground">HR</th>
                          <th className="text-right px-2 py-2 font-medium text-muted-foreground">RBI</th>
                          <th className="text-right px-2 py-2 font-medium text-muted-foreground">AVG</th>
                          <th className="text-right px-2 py-2 font-medium text-muted-foreground">OBP</th>
                          <th className="text-right px-2 py-2 font-medium text-muted-foreground">SLG</th>
                          <th className="text-right px-2 py-2 font-medium text-muted-foreground">OPS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {seasonStats.map((s) => (
                          <tr key={s.id} className="border-b border-border last:border-0">
                            <td className="px-4 py-2 font-medium">{s.season}</td>
                            <td className="text-right px-2 py-2 font-mono">{s.games ?? "—"}</td>
                            <td className="text-right px-2 py-2 font-mono">{s.at_bats ?? "—"}</td>
                            <td className="text-right px-2 py-2 font-mono">{s.hits ?? "—"}</td>
                            <td className="text-right px-2 py-2 font-mono">{s.home_runs ?? "—"}</td>
                            <td className="text-right px-2 py-2 font-mono">{s.rbi ?? "—"}</td>
                            <td className="text-right px-2 py-2 font-mono">{statFormat(s.batting_avg)}</td>
                            <td className="text-right px-2 py-2 font-mono">{statFormat(s.on_base_pct)}</td>
                            <td className="text-right px-2 py-2 font-mono">{statFormat(s.slugging_pct)}</td>
                            <td className="text-right px-2 py-2 font-mono font-bold">{statFormat(s.ops)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value || "—"}</span>
    </div>
  );
}
