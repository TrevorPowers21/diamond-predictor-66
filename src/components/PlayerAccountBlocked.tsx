import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Shown when a session has no coach access (no superadmin/team role) — the
// shape a player.rstriq.com account takes, since it shares the same
// auth.users table. Rendered in place rather than redirected externally, so
// there's no risk of a bounce loop if the player app's own auth ever links
// back here.
const PLAYER_APP_URL = import.meta.env.VITE_PLAYER_APP_URL || "https://player.rstriq.com";

export default function PlayerAccountBlocked() {
  const { signOut } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border/50">
        <CardHeader className="text-center space-y-3">
          <CardTitle>This account isn't set up for RSTR IQ coach access</CardTitle>
          <CardDescription>
            This looks like a player account. Head to the RSTR IQ player app to log in there instead.
          </CardDescription>
        </CardHeader>
        <div className="flex flex-col gap-3 px-6 pb-6">
          <Button asChild className="cursor-pointer">
            <a href={PLAYER_APP_URL}>Go to the player app</a>
          </Button>
          <Button variant="outline" className="cursor-pointer" onClick={() => signOut()}>
            Sign out
          </Button>
        </div>
      </Card>
    </div>
  );
}
