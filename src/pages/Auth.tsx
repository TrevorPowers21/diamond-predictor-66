import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Activity, Eye, EyeOff, ArrowLeft } from "lucide-react";

type Mode = "signin" | "forgot" | "recovery";

function detectInitialMode(): Mode {
  if (typeof window === "undefined") return "signin";
  // Supabase recovery links land with #type=recovery in the URL fragment.
  if (window.location.hash.includes("type=recovery")) return "recovery";
  return "signin";
}

export default function Auth() {
  const { session, loading, devBypassed, disableDevBypass, enableDevBypass, isDevBypassAllowed } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>(detectInitialMode);

  // If a PASSWORD_RECOVERY auth event fires after page load (e.g. tab focus),
  // switch to the recovery form so the user can set a new password.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("recovery");
    });
    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Activity className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Don't redirect away from /auth while we're showing the recovery form —
  // the user is technically signed in (recovery session) but needs to set
  // a password before being kicked into the dashboard.
  if (session && !devBypassed && mode !== "recovery") {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-8">
        {devBypassed && (
          <div className="text-right">
            <button
              onClick={() => {
                disableDevBypass();
                window.location.reload();
              }}
              className="text-xs text-red-500 underline"
            >
              Clear bypass
            </button>
          </div>
        )}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-3">
            <svg width="44" height="44" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="30" y="30" width="140" height="140" fill="none" stroke="#D4AF37" strokeWidth="2.5" transform="rotate(45 100 100)" />
              <rect x="50" y="50" width="100" height="100" fill="none" stroke="#D4AF37" strokeWidth="1.8" transform="rotate(45 100 100)" />
              <text x="100" y="105" textAnchor="middle" dominantBaseline="middle" fill="#D4AF37" fontSize="80" fontWeight="600" fontFamily="'Cormorant Garamond', serif">R</text>
            </svg>
            <span className="text-3xl font-bold tracking-wider" style={{ fontFamily: "'Oswald', sans-serif", color: "#D4AF37" }}>RSTR IQ</span>
          </div>
          <p className="text-muted-foreground text-sm tracking-[0.3em] uppercase">Everyday GM</p>
        </div>

        <Card className="border-border/50">
          <CardHeader className="pb-4">
            {mode === "signin" && (
              <>
                <CardTitle className="text-lg">Welcome back</CardTitle>
                <CardDescription>Sign in to your account</CardDescription>
                <LoginForm onForgot={() => setMode("forgot")} />
              </>
            )}
            {mode === "forgot" && (
              <>
                <CardTitle className="text-lg">Reset your password</CardTitle>
                <CardDescription>We'll email you a link to set a new password.</CardDescription>
                <ForgotPasswordForm onBack={() => setMode("signin")} />
              </>
            )}
            {mode === "recovery" && (
              <>
                <CardTitle className="text-lg">Set a new password</CardTitle>
                <CardDescription>Enter a new password for your account.</CardDescription>
                <SetNewPasswordForm onDone={() => navigate("/dashboard")} />
              </>
            )}
          </CardHeader>
        </Card>

        {isDevBypassAllowed && mode === "signin" && (
          <div className="text-center">
            <Button
              variant="ghost"
              className="text-muted-foreground text-sm"
              onClick={() => {
                enableDevBypass();
                navigate("/dashboard");
              }}
            >
              Continue without signing in (dev)
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function LoginForm({ onForgot }: { onForgot: () => void }) {
  const { signIn } = useAuth();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await signIn(email, password);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 mt-4">
      <div className="space-y-2">
        <Label htmlFor="login-email">Email</Label>
        <Input id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="login-password">Password</Label>
          <button
            type="button"
            onClick={onForgot}
            className="text-xs text-muted-foreground hover:text-[#D4AF37] transition-colors"
          >
            Forgot password?
          </button>
        </div>
        <div className="relative">
          <Input
            id="login-password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="••••••••"
            className="pr-12"
          />
          <button
            type="button"
            aria-label={showPassword ? "Hide password" : "Show password"}
            onClick={() => setShowPassword((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-700 z-0"
          >
            {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Signing in..." : "Sign In"}
      </Button>
    </form>
  );
}

function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth`,
    });
    setLoading(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="space-y-4 mt-4">
        <p className="text-sm text-muted-foreground">
          If an account exists for <span className="font-medium text-foreground">{email}</span>,
          a password reset link is on its way. The link expires in one hour.
        </p>
        <Button variant="ghost" size="sm" className="w-full gap-1.5" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 mt-4">
      <div className="space-y-2">
        <Label htmlFor="reset-email">Email</Label>
        <Input id="reset-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" autoFocus />
      </div>
      <Button type="submit" className="w-full" disabled={loading || !email}>
        {loading ? "Sending..." : "Send reset link"}
      </Button>
      <Button type="button" variant="ghost" size="sm" className="w-full gap-1.5" onClick={onBack}>
        <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
      </Button>
    </form>
  );
}

function SetNewPasswordForm({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast({ title: "Too short", description: "Password must be at least 8 characters.", variant: "destructive" });
      return;
    }
    if (password !== confirm) {
      toast({ title: "Mismatch", description: "Passwords don't match.", variant: "destructive" });
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Password updated", description: "You're all set." });
    onDone();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 mt-4">
      <div className="space-y-2">
        <Label htmlFor="new-password">New password</Label>
        <div className="relative">
          <Input
            id="new-password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="At least 8 characters"
            className="pr-12"
            autoFocus
          />
          <button
            type="button"
            aria-label={showPassword ? "Hide password" : "Show password"}
            onClick={() => setShowPassword((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-700 z-0"
          >
            {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm-password">Confirm password</Label>
        <Input
          id="confirm-password"
          type={showPassword ? "text" : "password"}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          placeholder="Repeat the new password"
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Updating..." : "Update password"}
      </Button>
    </form>
  );
}
