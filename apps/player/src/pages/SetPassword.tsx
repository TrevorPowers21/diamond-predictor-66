import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { usePlayerAuth } from "@/hooks/usePlayerAuth";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader } from "@/components/ui/card";
import BrandHeader from "@/components/BrandHeader";
import { cn } from "@/lib/utils";
import { Activity, Check, X } from "lucide-react";

const setPasswordSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type SetPasswordForm = z.infer<typeof setPasswordSchema>;

// Landing page for an invite link (staff runs `npm run invite-player`,
// scripts/invite-player.ts). Mirrors the coach app's SetNewPasswordForm in
// src/pages/Auth.tsx — same underlying supabase.auth.updateUser() call.
export default function SetPassword() {
  const { session, loading, isRecoveringPassword, setPassword } = usePlayerAuth();
  const navigate = useNavigate();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SetPasswordForm>({ resolver: zodResolver(setPasswordSchema) });
  const password = watch("password");
  const confirmPassword = watch("confirmPassword");
  const showMatchIndicator = password && confirmPassword;
  const passwordsMatch = password === confirmPassword;

  // Wait for the auth hook to finish processing the invite link's session
  // (from the URL hash) before deciding there's nothing to do here — on the
  // very first render, before that resolves, session/isRecoveringPassword
  // are both still their initial falsy values.
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Activity className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // No invite session at all — this route is only reachable via a valid
  // invite link, so there's nothing to do here.
  if (!session && !isRecoveringPassword) return <Navigate to="/login" replace />;

  const onSubmit = async (values: SetPasswordForm) => {
    setSubmitError(null);
    const { error } = await setPassword(values.password);
    if (error) {
      setSubmitError(error.message);
      return;
    }
    navigate("/plans", { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-8">
        <BrandHeader subtitle="Set a password for your player account" />

        <Card className="border-border/50">
          <CardHeader />
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-6 pb-6">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <PasswordInput id="password" autoComplete="new-password" {...register("password")} />
              {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <PasswordInput id="confirmPassword" autoComplete="new-password" {...register("confirmPassword")} />
              {showMatchIndicator && (
                <p
                  className={cn(
                    "flex items-center gap-1 text-sm",
                    passwordsMatch ? "text-emerald-400" : "text-destructive",
                  )}
                >
                  {passwordsMatch ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                  {passwordsMatch ? "Passwords match" : "Passwords don't match"}
                </p>
              )}
            </div>

            {submitError && <p className="text-sm text-destructive">{submitError}</p>}

            <Button type="submit" className="w-full cursor-pointer" disabled={isSubmitting}>
              {isSubmitting ? "Setting password..." : "Set password"}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
