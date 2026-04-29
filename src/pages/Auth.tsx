import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Activity, Eye, EyeOff } from "lucide-react";

export default function Auth() {
  const { session, loading, devBypassed, disableDevBypass, enableDevBypass, isDevBypassAllowed } = useAuth();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Activity className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (session && !devBypassed) return <Navigate to="/dashboard" replace />;

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
            <CardTitle className="text-lg">Welcome back</CardTitle>
            <CardDescription>Sign in to your account</CardDescription>
            <LoginForm />
          </CardHeader>
        </Card>

        {isDevBypassAllowed && (
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

function LoginForm() {
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
        <Label htmlFor="login-password">Password</Label>
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
