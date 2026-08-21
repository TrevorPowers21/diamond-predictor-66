import { useState } from "react";
import { Navigate } from "react-router-dom";
import { usePlayerAuth } from "@/hooks/usePlayerAuth";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity } from "lucide-react";

export default function ProtectedPlayerRoute({ children }: { children: React.ReactNode }) {
  const { session, loading, isRecoveringPassword, hasPlayerProfile, createOwnPlayerProfile, signOut } =
    usePlayerAuth();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Activity className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Must come before the hasPlayerProfile check below — with no session,
  // hasPlayerProfile is always null (there's no user to check a profile
  // for) and will never resolve to anything else. Checking it first meant
  // a signed-out session got stuck on the spinner forever instead of ever
  // reaching this redirect.
  if (!session) return <Navigate to="/login" replace />;

  // A session from an invite link that hasn't set a password yet must not
  // reach any of these pages, even by direct URL entry.
  if (isRecoveringPassword) return <Navigate to="/set-password" replace />;

  // Session exists but the profile check is still in flight — distinct
  // from "no session at all" above, and from "checked, no profile" below.
  if (hasPlayerProfile === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Activity className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // A coach account (same auth.users pool) has no player_accounts row,
  // since the signup trigger only fires for app: 'player' signups. Offer to
  // create one rather than treating this as an error — it grants no
  // coach-side data access either way.
  if (!hasPlayerProfile) {
    const handleCreate = async () => {
      setCreating(true);
      setCreateError(null);
      const { error } = await createOwnPlayerProfile();
      // Never surface the raw DB error (e.g. a stale/deleted-account
      // session hitting the FK constraint) — sign-out-and-retry is the
      // correct recovery for any failure here, so just point at that.
      if (error) setCreateError("Something went wrong. Try signing out and logging back in.");
      setCreating(false);
    };

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md border-border/50">
          <CardHeader className="text-center space-y-3">
            <CardTitle>Finish setting up your player profile</CardTitle>
            <CardDescription>
              This account doesn't have a player profile yet. Create one to continue.
            </CardDescription>
          </CardHeader>
          <div className="flex flex-col gap-3 px-6 pb-6">
            {createError && <p className="text-sm text-destructive">{createError}</p>}
            <Button className="cursor-pointer" disabled={creating} onClick={handleCreate}>
              {creating ? "Creating..." : "Create player profile"}
            </Button>
            <Button variant="outline" className="cursor-pointer" onClick={() => signOut()}>
              Sign out
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
