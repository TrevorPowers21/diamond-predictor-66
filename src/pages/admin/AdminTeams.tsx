import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, CustomerTeam } from "@/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, UserPlus, Users } from "lucide-react";
import { inviteUserToTeam } from "@/lib/inviteUser";

interface SchoolRow {
  id: string;
  full_name: string;
  abbreviation: string | null;
  conference: string | null;
}

const NO_SCHOOL = "__none__";

export default function AdminTeams() {
  const qc = useQueryClient();
  const { user, impersonateTeam } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [inviteForTeam, setInviteForTeam] = useState<CustomerTeam | null>(null);

  const teamsQuery = useQuery({
    queryKey: ["admin-customer-teams"],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("customer_teams" as any)
        .select("id, name, school_team_id, savant_enabled, active, created_at")
        .order("created_at", { ascending: false }) as any);
      if (error) throw error;
      return (data || []) as Array<CustomerTeam & { created_at: string }>;
    },
  });

  const schoolsQuery = useQuery({
    queryKey: ["admin-d1-schools"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Teams Table")
        .select("id, full_name, abbreviation, conference")
        .order("full_name");
      if (error) throw error;
      return (data || []) as SchoolRow[];
    },
  });

  const memberCountsQuery = useQuery({
    queryKey: ["admin-team-member-counts"],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("user_team_access" as any)
        .select("customer_team_id") as any);
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const row of (data || []) as Array<{ customer_team_id: string }>) {
        counts.set(row.customer_team_id, (counts.get(row.customer_team_id) ?? 0) + 1);
      }
      return counts;
    },
  });

  const updateTeam = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<{ savant_enabled: boolean; active: boolean }> }) => {
      const { error } = await (supabase
        .from("customer_teams" as any)
        .update(patch)
        .eq("id", id) as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-customer-teams"] });
    },
    onError: (e: any) => toast.error(`Could not update team: ${e.message}`),
  });

  const teams = teamsQuery.data ?? [];
  const schoolsById = new Map((schoolsQuery.data ?? []).map((s) => [s.id, s]));
  const memberCounts = memberCountsQuery.data ?? new Map<string, number>();

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Customer Teams</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Each row is one school that pays for RSTR IQ. Superadmin only.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> New team
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">All teams ({teams.length})</CardTitle>
            <CardDescription>Sorted by most recently created.</CardDescription>
          </CardHeader>
          <CardContent>
            {teamsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading teams…</p>
            ) : teams.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No teams yet. Create the first one — it will be your demo team.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>D1 Program</TableHead>
                    <TableHead className="text-center">Savant</TableHead>
                    <TableHead className="text-center">Active</TableHead>
                    <TableHead className="text-center">Members</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {teams.map((team) => {
                    const school = team.school_team_id ? schoolsById.get(team.school_team_id) : null;
                    const memberCount = memberCounts.get(team.id) ?? 0;
                    return (
                      <TableRow key={team.id}>
                        <TableCell className="font-medium">{team.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {school
                            ? `${school.full_name}${school.conference ? ` · ${school.conference}` : ""}`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            checked={team.savant_enabled}
                            onCheckedChange={(checked) =>
                              updateTeam.mutate({ id: team.id, patch: { savant_enabled: checked } })
                            }
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            checked={team.active}
                            onCheckedChange={(checked) =>
                              updateTeam.mutate({ id: team.id, patch: { active: checked } })
                            }
                          />
                        </TableCell>
                        <TableCell className="text-center text-muted-foreground">{memberCount}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1.5 h-8"
                              onClick={() => setInviteForTeam(team)}
                            >
                              <UserPlus className="h-3.5 w-3.5" /> Invite admin
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              asChild
                              className="gap-1.5 h-8"
                              onClick={() => impersonateTeam(team.id)}
                            >
                              <Link to="/dashboard/admin/users">
                                <Users className="h-3.5 w-3.5" /> Manage members
                              </Link>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <CreateTeamDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        schools={schoolsQuery.data ?? []}
        createdById={user?.id ?? null}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: ["admin-customer-teams"] });
          setCreateOpen(false);
        }}
      />

      <InviteAdminDialog
        team={inviteForTeam}
        onOpenChange={(open) => !open && setInviteForTeam(null)}
      />
    </DashboardLayout>
  );
}

function CreateTeamDialog({
  open,
  onOpenChange,
  schools,
  createdById,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schools: SchoolRow[];
  createdById: string | null;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [schoolTeamId, setSchoolTeamId] = useState<string>(NO_SCHOOL);
  const [savantEnabled, setSavantEnabled] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setName("");
    setSchoolTeamId(NO_SCHOOL);
    setSavantEnabled(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    const { error } = await (supabase
      .from("customer_teams" as any)
      .insert({
        name: name.trim(),
        school_team_id: schoolTeamId === NO_SCHOOL ? null : schoolTeamId,
        savant_enabled: savantEnabled,
        active: true,
        created_by: createdById,
      }) as any);
    setSubmitting(false);
    if (error) {
      toast.error(`Could not create team: ${error.message}`);
      return;
    }
    toast.success(`Created team "${name.trim()}"`);
    reset();
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Create customer team</DialogTitle>
            <DialogDescription>
              This becomes a tenant. Invite a head coach as team_admin after creation.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="team-name">Team name</Label>
            <Input
              id="team-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="UCSB Gauchos"
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="school-select">Linked D1 program (optional)</Label>
            <Select value={schoolTeamId} onValueChange={setSchoolTeamId}>
              <SelectTrigger id="school-select">
                <SelectValue placeholder="No linked program" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SCHOOL}>No linked program</SelectItem>
                {schools.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.full_name}
                    {s.abbreviation ? ` (${s.abbreviation})` : ""}
                    {s.conference ? ` · ${s.conference}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
            <div>
              <Label htmlFor="savant-toggle" className="text-sm">Enable Savant</Label>
              <p className="text-xs text-muted-foreground">Mid-tier add-on. Off by default.</p>
            </div>
            <Switch id="savant-toggle" checked={savantEnabled} onCheckedChange={setSavantEnabled} />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? "Creating…" : "Create team"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InviteAdminDialog({
  team,
  onOpenChange,
}: {
  team: CustomerTeam | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!team || !email.trim()) return;
    setSubmitting(true);
    const result = await inviteUserToTeam({
      email: email.trim(),
      customerTeamId: team.id,
      role: "team_admin",
    });
    setSubmitting(false);
    if (result.success) {
      toast.success(`Invited ${email.trim()} as team admin of ${team.name}`);
      setEmail("");
      onOpenChange(false);
    } else if (result.pending) {
      toast.warning(result.error ?? "Invite pending — Edge Function not deployed yet.");
    } else {
      toast.error(`Invite failed: ${result.error ?? "unknown error"}`);
    }
  };

  return (
    <Dialog open={team !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Invite team admin</DialogTitle>
            <DialogDescription>
              {team ? `Send a magic-link invite for ${team.name}.` : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="coach@school.edu"
              required
              autoFocus
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting || !email.trim()}>
              {submitting ? "Sending…" : "Send invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
