import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { UserPlus, Trash2 } from "lucide-react";
import { inviteUserToTeam } from "@/lib/inviteUser";

interface MemberRow {
  user_id: string;
  customer_team_id: string;
  role: "team_admin" | "general_user";
  created_at: string;
  display_name: string | null;
}

export default function AdminUsers() {
  const qc = useQueryClient();
  const { user, isSuperadmin, userTeamId, userTeamRole, effectiveTeamId, availableTeams } = useAuth();
  const currentUserId = user?.id ?? null;

  // Effective scope: superadmin uses impersonation, team_admin uses their own team.
  const scopedTeamId = isSuperadmin ? effectiveTeamId : userTeamId;
  const scopedTeam = scopedTeamId
    ? availableTeams.find((t) => t.id === scopedTeamId) ?? null
    : null;

  const [inviteOpen, setInviteOpen] = useState(false);

  const membersQuery = useQuery({
    queryKey: ["admin-team-members", scopedTeamId],
    enabled: !!scopedTeamId,
    queryFn: async () => {
      if (!scopedTeamId) return [];
      const { data: rows, error } = await supabase
        .from("user_team_access")
        .select("user_id, customer_team_id, role, created_at")
        .eq("customer_team_id", scopedTeamId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const accessRows = rows ?? [];

      const userIds = accessRows.map((r) => r.user_id);
      const profilesById = new Map<string, { display_name: string | null }>();
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", userIds);
        for (const p of profiles ?? []) {
          profilesById.set(p.user_id, { display_name: p.display_name });
        }
      }

      return accessRows.map<MemberRow>((r) => ({
        user_id: r.user_id,
        customer_team_id: r.customer_team_id,
        role: r.role as MemberRow["role"],
        created_at: r.created_at,
        display_name: profilesById.get(r.user_id)?.display_name ?? null,
      }));
    },
  });

  const removeMember = useMutation({
    mutationFn: async (userId: string) => {
      if (!scopedTeamId) throw new Error("No team selected");
      const { error } = await supabase
        .from("user_team_access")
        .delete()
        .eq("user_id", userId)
        .eq("customer_team_id", scopedTeamId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-team-members", scopedTeamId] });
      toast.success("Member removed");
    },
    onError: (e: any) => toast.error(`Could not remove: ${e.message}`),
  });

  // Cross-team superadmin without an impersonated team selected
  if (isSuperadmin && !scopedTeamId) {
    return (
      <DashboardLayout>
        <Card>
          <CardHeader>
            <CardTitle>Team Members</CardTitle>
            <CardDescription>
              Pick a team in the header switcher to manage its members.
            </CardDescription>
          </CardHeader>
        </Card>
      </DashboardLayout>
    );
  }

  if (!scopedTeam) {
    return (
      <DashboardLayout>
        <Card>
          <CardHeader>
            <CardTitle>No team</CardTitle>
            <CardDescription>You're not assigned to a team.</CardDescription>
          </CardHeader>
        </Card>
      </DashboardLayout>
    );
  }

  const members = membersQuery.data ?? [];
  // Team admins only see invite as 'general_user'. Superadmins can also create team_admins.
  const canInviteAdmins = isSuperadmin;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Team Members</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Managing: <span className="font-medium text-foreground">{scopedTeam.name}</span>
              {isSuperadmin && (
                <span className="ml-2 text-[10px] uppercase tracking-wider text-[#D4AF37]/80">
                  superadmin view
                </span>
              )}
            </p>
          </div>
          <Button onClick={() => setInviteOpen(true)} className="gap-2">
            <UserPlus className="h-4 w-4" /> Invite member
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Members ({members.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {membersQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : members.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No members yet. Invite one with the button above.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((m) => {
                    const isSelf = m.user_id === currentUserId;
                    return (
                      <TableRow key={m.user_id}>
                        <TableCell>
                          <div className="font-medium">
                            {m.display_name ?? "—"}
                            {isSelf && (
                              <span className="ml-2 text-[10px] uppercase tracking-wider text-[#D4AF37]/80">you</span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {m.user_id.slice(0, 8)}…
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs uppercase tracking-wider text-muted-foreground">
                            {m.role.replace("_", " ")}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(m.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={isSelf}
                            className="gap-1.5 h-8 text-muted-foreground hover:text-destructive disabled:opacity-30"
                            title={isSelf ? "You can't remove yourself" : undefined}
                            onClick={() => {
                              if (confirm(`Remove ${m.display_name ?? "this user"} from ${scopedTeam.name}?`)) {
                                removeMember.mutate(m.user_id);
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Remove
                          </Button>
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

      <InviteMemberDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        teamId={scopedTeam.id}
        teamName={scopedTeam.name}
        canInviteAdmins={canInviteAdmins}
      />
    </DashboardLayout>
  );
}

function InviteMemberDialog({
  open,
  onOpenChange,
  teamId,
  teamName,
  canInviteAdmins,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId: string;
  teamName: string;
  canInviteAdmins: boolean;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"team_admin" | "general_user">("general_user");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    const result = await inviteUserToTeam({
      email: email.trim(),
      customerTeamId: teamId,
      role,
    });
    setSubmitting(false);
    if (result.success) {
      if (result.alreadyMember) {
        toast.info(`${email.trim()} is already on ${teamName}`);
      } else if (result.isExisting) {
        toast.success(`Added existing user ${email.trim()} to ${teamName} (no email sent)`);
      } else {
        toast.success(`Invited ${email.trim()} to ${teamName}`);
      }
      setEmail("");
      onOpenChange(false);
    } else if (result.pending) {
      toast.warning(result.error ?? "Invite pending — Edge Function not deployed yet.");
    } else {
      toast.error(`Invite failed: ${result.error ?? "unknown error"}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Invite member</DialogTitle>
            <DialogDescription>
              Send a magic-link invite for {teamName}.
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

          {canInviteAdmins && (
            <div className="space-y-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general_user">General user</SelectItem>
                  <SelectItem value="team_admin">Team admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

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
