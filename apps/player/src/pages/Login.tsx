import { useState } from "react";
import { Navigate } from "react-router-dom";
import { usePlayerAuth } from "@/hooks/usePlayerAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader } from "@/components/ui/card";
import BrandHeader from "@/components/BrandHeader";

export default function Login() {
  const { session, isRecoveringPassword, signIn } = usePlayerAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // A session from an invite link needs a password set before anything else.
  if (session && isRecoveringPassword) return <Navigate to="/set-password" replace />;
  if (session) return <Navigate to="/plans" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error: signInError } = await signIn(email, password);
    if (signInError) setError(signInError.message);
    setSubmitting(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-8">
        <BrandHeader subtitle="Log in to your player account" />

        <Card className="border-border/50">
          <CardHeader />
          <form onSubmit={handleSubmit} className="space-y-4 px-6 pb-6">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full cursor-pointer" disabled={submitting}>
              {submitting ? "Logging in..." : "Log in"}
            </Button>
          </form>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          Accounts are created by invite only. Check with your program for access.
        </p>
      </div>
    </div>
  );
}
