import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Mail, KeyRound } from "lucide-react";

export default function Settings() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [changing, setChanging] = useState(false);

  const [sendingReset, setSendingReset] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const email = user?.email ?? "";

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast({ title: "Too short", description: "Password must be at least 8 characters.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Mismatch", description: "New passwords don't match.", variant: "destructive" });
      return;
    }
    if (newPassword === currentPassword) {
      toast({ title: "Same password", description: "New password must differ from current.", variant: "destructive" });
      return;
    }
    if (!email) {
      toast({ title: "No email on account", description: "Use the reset link option instead.", variant: "destructive" });
      return;
    }

    setChanging(true);
    // Re-verify current password by signing in again. Supabase will refresh
    // the session; the current logged-in state is preserved.
    const { error: verifyErr } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
    if (verifyErr) {
      setChanging(false);
      toast({ title: "Current password incorrect", description: verifyErr.message, variant: "destructive" });
      return;
    }
    const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword });
    setChanging(false);
    if (updateErr) {
      toast({ title: "Couldn't update password", description: updateErr.message, variant: "destructive" });
      return;
    }
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    toast({ title: "Password updated", description: "Use your new password the next time you sign in." });
  }

  async function handleSendResetLink() {
    if (!email) {
      toast({ title: "No email on account", variant: "destructive" });
      return;
    }
    setSendingReset(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth`,
    });
    setSendingReset(false);
    if (error) {
      toast({ title: "Couldn't send link", description: error.message, variant: "destructive" });
      return;
    }
    setResetSent(true);
    toast({ title: "Reset link sent", description: `Check ${email}. Link expires in one hour.` });
  }

  return (
    <DashboardLayout>
      <div className="container mx-auto max-w-3xl px-4 py-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" style={{ fontFamily: "Oswald, sans-serif" }}>
            Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your account and security.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Mail className="h-4 w-4" />
              Account
            </CardTitle>
            <CardDescription>Signed in as</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-sm font-medium text-foreground">{email || "—"}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <KeyRound className="h-4 w-4" />
              Change Password
            </CardTitle>
            <CardDescription>
              Update your password while signed in. Requires your current password.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current-password">Current password</Label>
                <div className="relative">
                  <Input
                    id="current-password"
                    type={showCurrent ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="pr-12"
                  />
                  <button
                    type="button"
                    aria-label={showCurrent ? "Hide password" : "Show password"}
                    onClick={() => setShowCurrent((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showNew ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                    className="pr-12"
                  />
                  <button
                    type="button"
                    aria-label={showNew ? "Hide password" : "Show password"}
                    onClick={() => setShowNew((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  type={showNew ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>

              <Button
                type="submit"
                className="w-full cursor-pointer"
                disabled={changing || !currentPassword || !newPassword || !confirmPassword}
              >
                {changing ? "Updating..." : "Update password"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Mail className="h-4 w-4" />
              Forgot your current password?
            </CardTitle>
            <CardDescription>
              We'll email a reset link to your account address. The link expires in one hour.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {resetSent ? (
              <p className="text-sm text-muted-foreground">
                Reset link sent to <span className="font-medium text-foreground">{email}</span>. Check your inbox.
              </p>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="w-full cursor-pointer"
                disabled={sendingReset || !email}
                onClick={handleSendResetLink}
              >
                {sendingReset ? "Sending..." : `Send reset link to ${email || "your email"}`}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
