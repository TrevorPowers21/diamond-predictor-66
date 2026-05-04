import { useEffect, useRef, useState } from "react";
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
import { Plus, UserPlus, Users, Palette } from "lucide-react";
import { inviteUserToTeam } from "@/lib/inviteUser";
import { CURRENT_SEASON } from "@/lib/seasonConstants";
import { lookupSchoolColors } from "@/lib/schoolColors";
import { extractColorsFromFile } from "@/lib/extractLogoColors";

interface SchoolRow {
  id: string;
  full_name: string;
  abbreviation: string | null;
  conference: string | null;
  source_id: string | null;
  Mascot: string | null;
}

interface AdminTeamRow {
  id: string;
  name: string;
  school_team_id: string | null;
  savant_enabled: boolean;
  active: boolean;
  created_at: string;
  logo_url: string | null;
  display_name: string | null;
  mascot: string | null;
  primary_color: string | null;
  secondary_color: string | null;
}

const NO_SCHOOL = "__none__";
const DEFAULT_PRIMARY_COLOR = "#0051BA";
const DEFAULT_SECONDARY_COLOR = "#E8000D";

/**
 * Derives a one-line display banner from the Teams Table full_name. Strips
 * the trailing mascot (when known) so "Georgia Bulldogs" / "Bulldogs" →
 * "GEORGIA". Falls back to the first word when no mascot is available.
 */
function deriveDisplayName(fullName: string, mascot: string | null): string {
  if (!fullName) return "";
  const trimmed = fullName.trim();
  if (mascot && mascot.trim()) {
    const mascotLower = mascot.trim().toLowerCase();
    const lower = trimmed.toLowerCase();
    if (lower.endsWith(` ${mascotLower}`)) {
      return trimmed.slice(0, trimmed.length - mascotLower.length).trim().toUpperCase();
    }
  }
  // No mascot to strip — use the leading word(s) before the last space, which
  // covers most "<School Name> <Mascot>" combos. Single-word names pass through.
  const lastSpace = trimmed.lastIndexOf(" ");
  if (lastSpace === -1) return trimmed.toUpperCase();
  return trimmed.slice(0, lastSpace).toUpperCase();
}

export default function AdminTeams() {
  const qc = useQueryClient();
  const { user, impersonateTeam, refreshTeams } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [inviteForTeam, setInviteForTeam] = useState<CustomerTeam | null>(null);
  const [brandingForTeam, setBrandingForTeam] = useState<AdminTeamRow | null>(null);

  const teamsQuery = useQuery({
    queryKey: ["admin-customer-teams"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_teams")
        .select("id, name, school_team_id, savant_enabled, active, created_at, logo_url, display_name, mascot, primary_color, secondary_color")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AdminTeamRow[];
    },
  });

  const schoolsQuery = useQuery({
    queryKey: ["admin-d1-schools", CURRENT_SEASON],
    queryFn: async () => {
      // Teams Table holds one row per (program × season). Without filtering by
      // Season, every school shows up multiple times in the picker (Georgia
      // 2023, Georgia 2024, Georgia 2025, Georgia 2026). Filter to the current
      // season so each program appears exactly once.
      // NOTE: school_team_id stored on customer_teams will be this season's
      // UUID. Year-rollover work (punch list item 2) needs to re-point these
      // to the new season's UUIDs via source_id.
      const { data, error } = await (supabase as any)
        .from("Teams Table")
        .select("id, full_name, abbreviation, conference, source_id, Mascot")
        .eq("Season", CURRENT_SEASON)
        .order("full_name");
      if (error) throw error;
      return (data || []) as SchoolRow[];
    },
  });

  const memberCountsQuery = useQuery({
    queryKey: ["admin-team-member-counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_team_access")
        .select("customer_team_id");
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const row of data ?? []) {
        counts.set(row.customer_team_id, (counts.get(row.customer_team_id) ?? 0) + 1);
      }
      return counts;
    },
  });

  const updateTeam = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<{ savant_enabled: boolean; active: boolean }> }) => {
      const { error } = await supabase
        .from("customer_teams")
        .update(patch)
        .eq("id", id);
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
                              onClick={() => setBrandingForTeam(team)}
                            >
                              <Palette className="h-3.5 w-3.5" /> Branding
                            </Button>
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
          refreshTeams();
          setCreateOpen(false);
        }}
      />

      <InviteAdminDialog
        team={inviteForTeam}
        onOpenChange={(open) => !open && setInviteForTeam(null)}
      />

      <BrandingDialog
        team={brandingForTeam}
        onOpenChange={(open) => !open && setBrandingForTeam(null)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["admin-customer-teams"] });
          refreshTeams();
          setBrandingForTeam(null);
        }}
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
  const [logoUrl, setLogoUrl] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [mascot, setMascot] = useState("");
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_PRIMARY_COLOR);
  const [secondaryColor, setSecondaryColor] = useState(DEFAULT_SECONDARY_COLOR);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setName("");
    setSchoolTeamId(NO_SCHOOL);
    setSavantEnabled(false);
    setLogoUrl("");
    setDisplayName("");
    setMascot("");
    setPrimaryColor(DEFAULT_PRIMARY_COLOR);
    setSecondaryColor(DEFAULT_SECONDARY_COLOR);
  };

  // When the superadmin links a D1 program, auto-derive as much of the team
  // as we can from Teams Table + the school colors lookup. The user can
  // still override anything afterwards. Picking a different program later
  // re-applies the same derivation so branding stays in sync with the link.
  const handleSchoolChange = (newSchoolTeamId: string) => {
    setSchoolTeamId(newSchoolTeamId);
    if (newSchoolTeamId === NO_SCHOOL) return;
    const school = schools.find((s) => s.id === newSchoolTeamId);
    if (!school) return;
    if (!name.trim()) setName(school.full_name);
    setDisplayName(deriveDisplayName(school.full_name, school.Mascot));
    if (school.Mascot) setMascot(school.Mascot.toUpperCase());
    const colors = lookupSchoolColors(school.full_name);
    if (colors) {
      setPrimaryColor(colors.primary);
      setSecondaryColor(colors.secondary);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    const trimmedLogo = logoUrl.trim();
    const trimmedDisplay = displayName.trim();
    const trimmedMascot = mascot.trim();
    const { error } = await supabase
      .from("customer_teams")
      .insert({
        name: name.trim(),
        school_team_id: schoolTeamId === NO_SCHOOL ? null : schoolTeamId,
        savant_enabled: savantEnabled,
        active: true,
        created_by: createdById,
        logo_url: trimmedLogo || null,
        display_name: trimmedDisplay || null,
        mascot: trimmedMascot || null,
        primary_color: trimmedDisplay || trimmedMascot ? primaryColor : null,
        secondary_color: trimmedDisplay || trimmedMascot ? secondaryColor : null,
      });
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
            <Select value={schoolTeamId} onValueChange={handleSchoolChange}>
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

          <BrandingFields
            logoUrl={logoUrl}
            setLogoUrl={setLogoUrl}
            displayName={displayName}
            setDisplayName={setDisplayName}
            mascot={mascot}
            setMascot={setMascot}
            primaryColor={primaryColor}
            setPrimaryColor={setPrimaryColor}
            secondaryColor={secondaryColor}
            setSecondaryColor={setSecondaryColor}
          />

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

function BrandingFields({
  logoUrl,
  setLogoUrl,
  displayName,
  setDisplayName,
  mascot,
  setMascot,
  primaryColor,
  setPrimaryColor,
  secondaryColor,
  setSecondaryColor,
}: {
  logoUrl: string;
  setLogoUrl: (v: string) => void;
  displayName: string;
  setDisplayName: (v: string) => void;
  mascot: string;
  setMascot: (v: string) => void;
  primaryColor: string;
  setPrimaryColor: (v: string) => void;
  secondaryColor: string;
  setSecondaryColor: (v: string) => void;
}) {
  return (
    <div className="space-y-3 rounded-md border border-border/60 px-3 py-3">
      <div>
        <Label className="text-sm">Branding (optional)</Label>
        <p className="text-xs text-muted-foreground">
          Drives the styled banner. Upload a logo and primary + secondary colors auto-detect from the image. All five fields are required for the styled layout — leave blank for the default RSTR IQ banner.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="logo-url" className="text-xs">Logo</Label>
        <LogoUploader
          logoUrl={logoUrl}
          setLogoUrl={setLogoUrl}
          onColorsExtracted={({ primary, secondary }) => {
            setPrimaryColor(primary);
            setSecondaryColor(secondary);
          }}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-2">
          <Label htmlFor="display-name" className="text-xs">Display name</Label>
          <Input
            id="display-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="KANSAS"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mascot" className="text-xs">Mascot</Label>
          <Input
            id="mascot"
            value={mascot}
            onChange={(e) => setMascot(e.target.value)}
            placeholder="JAYHAWKS"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-2">
          <Label htmlFor="primary-color" className="text-xs">Primary color (top line)</Label>
          <div className="flex items-center gap-2">
            <Input
              id="primary-color"
              type="color"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              className="h-9 w-14 cursor-pointer p-1"
            />
            <Input
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              placeholder="#0051BA"
              className="flex-1"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="secondary-color" className="text-xs">Secondary color (mascot line)</Label>
          <div className="flex items-center gap-2">
            <Input
              id="secondary-color"
              type="color"
              value={secondaryColor}
              onChange={(e) => setSecondaryColor(e.target.value)}
              className="h-9 w-14 cursor-pointer p-1"
            />
            <Input
              value={secondaryColor}
              onChange={(e) => setSecondaryColor(e.target.value)}
              placeholder="#E8000D"
              className="flex-1"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function LogoUploader({
  logoUrl,
  setLogoUrl,
  onColorsExtracted,
}: {
  logoUrl: string;
  setLogoUrl: (v: string) => void;
  onColorsExtracted?: (colors: { primary: string; secondary: string }) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = async (file: File) => {
    setUploading(true);
    // Run color extraction on the local File in parallel with the upload —
    // they're independent operations, no reason to serialize them. If
    // extraction fails (rare), we fall through silently and the user keeps
    // whatever colors are currently in the form.
    const extractionPromise = onColorsExtracted ? extractColorsFromFile(file) : Promise.resolve(null);
    try {
      // Path = unique filename (timestamp + sanitized original) so a re-upload
      // doesn't clobber existing logos. We bust the public URL cache with the
      // path itself, so each upload returns a fresh URL.
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const safeBase = file.name.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "-");
      const path = `${Date.now()}-${safeBase}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("school-logos")
        .upload(path, file, { cacheControl: "3600", upsert: false });
      if (uploadErr) throw uploadErr;
      const { data } = supabase.storage.from("school-logos").getPublicUrl(path);
      setLogoUrl(data.publicUrl);
      const extracted = await extractionPromise;
      if (extracted && onColorsExtracted) {
        onColorsExtracted(extracted);
        toast.success("Logo uploaded — colors auto-detected");
      } else {
        toast.success("Logo uploaded");
      }
    } catch (e: any) {
      toast.error(`Upload failed: ${e?.message ?? "unknown error"}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt="Logo preview"
            className="h-12 w-12 rounded border border-border/60 object-contain bg-background"
          />
        ) : (
          <div className="h-12 w-12 rounded border border-dashed border-border/60 flex items-center justify-center text-muted-foreground text-[10px]">
            no logo
          </div>
        )}
        <div className="flex-1 space-y-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="gap-1.5"
          >
            {uploading ? "Uploading…" : logoUrl ? "Replace logo" : "Upload logo"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          {logoUrl && (
            <button
              type="button"
              className="block text-[10px] text-muted-foreground hover:text-foreground"
              onClick={() => setLogoUrl("")}
            >
              Remove
            </button>
          )}
        </div>
      </div>
      <Input
        value={logoUrl}
        onChange={(e) => setLogoUrl(e.target.value)}
        placeholder="/Kansas Logo.svg or pasted URL"
        className="text-xs"
      />
    </div>
  );
}

function BrandingDialog({
  team,
  onOpenChange,
  onSaved,
}: {
  team: AdminTeamRow | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [logoUrl, setLogoUrl] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [mascot, setMascot] = useState("");
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_PRIMARY_COLOR);
  const [secondaryColor, setSecondaryColor] = useState(DEFAULT_SECONDARY_COLOR);
  const [submitting, setSubmitting] = useState(false);

  // Reset fields whenever a new team is opened so we're never showing the
  // previous team's values for a fresh edit.
  const teamId = team?.id ?? null;
  useEffect(() => {
    if (!team) return;
    setLogoUrl(team.logo_url ?? "");
    setDisplayName(team.display_name ?? "");
    setMascot(team.mascot ?? "");
    setPrimaryColor(team.primary_color ?? DEFAULT_PRIMARY_COLOR);
    setSecondaryColor(team.secondary_color ?? DEFAULT_SECONDARY_COLOR);
  }, [teamId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!team) return;
    setSubmitting(true);
    const trimmedLogo = logoUrl.trim();
    const trimmedDisplay = displayName.trim();
    const trimmedMascot = mascot.trim();
    const { error } = await supabase
      .from("customer_teams")
      .update({
        logo_url: trimmedLogo || null,
        display_name: trimmedDisplay || null,
        mascot: trimmedMascot || null,
        primary_color: trimmedDisplay || trimmedMascot ? primaryColor : null,
        secondary_color: trimmedDisplay || trimmedMascot ? secondaryColor : null,
      })
      .eq("id", team.id);
    setSubmitting(false);
    if (error) {
      toast.error(`Could not update branding: ${error.message}`);
      return;
    }
    toast.success(`Saved branding for ${team.name}`);
    onSaved();
  };

  const handleClear = async () => {
    if (!team) return;
    setSubmitting(true);
    const { error } = await supabase
      .from("customer_teams")
      .update({
        logo_url: null,
        display_name: null,
        mascot: null,
        primary_color: null,
        secondary_color: null,
      })
      .eq("id", team.id);
    setSubmitting(false);
    if (error) {
      toast.error(`Could not clear branding: ${error.message}`);
      return;
    }
    toast.success(`Cleared branding for ${team.name}`);
    onSaved();
  };

  return (
    <Dialog open={team !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Edit branding</DialogTitle>
            <DialogDescription>
              {team ? `Customize the styled banner for ${team.name}.` : ""}
            </DialogDescription>
          </DialogHeader>

          <BrandingFields
            logoUrl={logoUrl}
            setLogoUrl={setLogoUrl}
            displayName={displayName}
            setDisplayName={setDisplayName}
            mascot={mascot}
            setMascot={setMascot}
            primaryColor={primaryColor}
            setPrimaryColor={setPrimaryColor}
            secondaryColor={secondaryColor}
            setSecondaryColor={setSecondaryColor}
          />

          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="ghost" onClick={handleClear} disabled={submitting}>
              Clear branding
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving…" : "Save branding"}
              </Button>
            </div>
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
      if (result.alreadyMember) {
        toast.info(`${email.trim()} is already a team admin of ${team.name}`);
      } else if (result.isExisting) {
        toast.success(`Added existing user ${email.trim()} as team admin (no email sent — they already have an account)`);
      } else {
        toast.success(`Invited ${email.trim()} as team admin of ${team.name}`);
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
