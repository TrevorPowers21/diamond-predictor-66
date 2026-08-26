// Edge Function: complete-player-signup
//
// Public, unauthenticated. Claims a pending_player_purchases row (created by
// create-athlete-monitoring-intent's anonymous mode) into a real Supabase
// account — this is the "set your password" step shown right after a
// successful public checkout.
//
// Security: an email address alone is not proof of purchase — anyone could
// type in someone else's email. The caller must also present the exact
// Stripe subscription id created during that checkout, which is
// unguessable and was only ever handed to the browser that completed the
// payment. Matching BOTH email and subscriptionId to the same
// pending_player_purchases row is what prevents a stranger from claiming
// someone else's paid membership before the real buyer sets a password.
//
// On success: creates the auth.users row via admin.createUser (which fires
// the existing handle_new_player_account() trigger to create the
// player_accounts row), copies the pending purchase's billing/entitlement
// state into player_billing_customers/player_entitlements for the new
// user_id, then deletes the pending_player_purchases row — from that point
// on, stripe-webhook routes future events for this subscription through
// player_entitlements normally, same as an invited member's account always
// has.
//
// Required env vars:
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided)
//
// verify_jwt = false is set in supabase/config.toml for this function.
//
// Deploy:
//   supabase functions deploy complete-player-signup

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PRODUCT = "athlete_monitoring";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface RequestBody {
  email?: string;
  password?: string;
  subscriptionId?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Server is misconfigured (missing env vars)" }, 500);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const { email, password, subscriptionId } = body;
  if (!email || !password || !subscriptionId) {
    return json({ error: "email, password, and subscriptionId are required" }, 400);
  }
  if (password.length < 8) {
    return json({ error: "Password must be at least 8 characters" }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: pending, error: pendingErr } = await adminClient
    .from("pending_player_purchases")
    .select("*")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();
  if (pendingErr) return json({ error: `Could not look up purchase: ${pendingErr.message}` }, 500);
  if (!pending) {
    return json({ error: "No matching purchase found. It may have already been claimed — try logging in instead." }, 404);
  }
  if (pending.email.toLowerCase() !== email.toLowerCase()) {
    return json({ error: "That email doesn't match this purchase." }, 400);
  }

  const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { app: "player" },
  });
  if (createErr || !created.user) {
    const alreadyExists = createErr?.message?.toLowerCase().includes("already registered");
    return json(
      {
        error: alreadyExists
          ? "An account already exists for this email. Try logging in instead."
          : `Could not create account: ${createErr?.message ?? "unknown error"}`,
      },
      alreadyExists ? 409 : 500,
    );
  }
  const userId = created.user.id;

  const { error: billingErr } = await adminClient
    .from("player_billing_customers")
    .insert({ user_id: userId, stripe_customer_id: pending.stripe_customer_id });
  if (billingErr) {
    return json({ error: `Account created, but could not link billing: ${billingErr.message}` }, 500);
  }

  const { error: entitlementErr } = await adminClient.from("player_entitlements").upsert(
    {
      user_id: userId,
      product: PRODUCT,
      status: pending.status,
      plan: pending.plan,
      stripe_subscription_id: pending.stripe_subscription_id,
      stripe_payment_intent_id: pending.stripe_payment_intent_id,
      current_period_end: pending.current_period_end,
      cancel_at: pending.cancel_at,
      last_event_created_at: pending.last_event_created_at,
    },
    { onConflict: "user_id,product" },
  );
  if (entitlementErr) {
    return json({ error: `Account created, but could not link membership: ${entitlementErr.message}` }, 500);
  }

  // Best-effort cleanup — the row has already been fully copied above, so
  // leaving it behind on failure here would be a harmless orphan, not a
  // correctness problem.
  await adminClient.from("pending_player_purchases").delete().eq("id", pending.id);

  return json({ success: true });
});
