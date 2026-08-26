import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { usePlayerAuth } from "@/hooks/usePlayerAuth";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader } from "@/components/ui/card";
import BrandHeader from "@/components/BrandHeader";
import { cn } from "@/lib/utils";
import { Check, X } from "lucide-react";

const createAccountSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type CreateAccountForm = z.infer<typeof createAccountSchema>;

// Shown right after a successful public checkout (see CheckoutComplete) —
// the payment already went through under just an email; this is what turns
// that into a real, logged-in account. complete-player-signup verifies the
// subscriptionId matches the email before creating anything, so a stranger
// who happens to know the email can't claim someone else's purchase.
export default function CreateAccount() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signIn } = usePlayerAuth();
  const state = location.state as { subscriptionId?: string; email?: string } | null;
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateAccountForm>({ resolver: zodResolver(createAccountSchema) });
  const password = watch("password");
  const confirmPassword = watch("confirmPassword");
  const showMatchIndicator = password && confirmPassword;
  const passwordsMatch = password === confirmPassword;

  if (!state?.subscriptionId || !state?.email) return <Navigate to="/plans" replace />;
  const { subscriptionId, email } = state;

  const onSubmit = async (values: CreateAccountForm) => {
    setSubmitError(null);
    const { data, error } = await supabase.functions.invoke("complete-player-signup", {
      body: { email, password: values.password, subscriptionId },
    });
    if (error || !data?.success) {
      setSubmitError(data?.error ?? error?.message ?? "Could not create your account.");
      return;
    }
    const { error: signInError } = await signIn(email, values.password);
    if (signInError) {
      // Account was created successfully — a sign-in hiccup right after
      // isn't a reason to make them retry the whole flow, just log in.
      navigate("/login", { replace: true });
      return;
    }
    navigate("/plans", { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-8">
        <BrandHeader subtitle="You're in — set a password to access your account" />

        <Card className="border-border/50">
          <CardHeader />
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-6 pb-6">
            <div className="space-y-2">
              <Label>Email</Label>
              <p className="text-sm text-muted-foreground">{email}</p>
            </div>

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

            {submitError && (
              <p className="text-sm text-destructive">
                {submitError}{" "}
                {submitError.toLowerCase().includes("logging in") && (
                  <Link to="/login" className="underline">
                    Log in
                  </Link>
                )}
              </p>
            )}

            <Button type="submit" className="w-full cursor-pointer" disabled={isSubmitting}>
              {isSubmitting ? "Creating account..." : "Create account"}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
