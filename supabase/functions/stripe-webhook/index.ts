// Edge Function: stripe-webhook
//
// Public endpoint — called only by Stripe, never by the player app directly.
// This is the SOLE writer of player_entitlements.status = 'active'; no
// client-side code path may set that. Every DB write here is authoritative
// only because the Stripe signature has just been verified.
//
// Deno-specific requirements (not optional, these are the real gotchas):
//   - Verify with constructEventAsync + createSubtleCryptoProvider(). The
//     sync constructEvent() relies on Node's crypto module, unavailable in
//     the Deno edge runtime the same way.
//   - Construct the Stripe client with httpClient: createFetchHttpClient().
//   - Read the raw body as text via req.text() BEFORE verifying — parsing
//     to JSON first invalidates the signature.
//
// Required env vars:
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided; no anon key
//     needed, this function never verifies a caller JWT)
//   - STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
//
// Register in Stripe Dashboard -> Webhooks against the deployed URL for:
//   invoice.paid, invoice.payment_failed,
//   customer.subscription.updated, customer.subscription.deleted
//
// No payment_intent.* events are handled here — every membership is a
// Subscription, so its invoice's PaymentIntent always has `.invoice` set;
// invoice.paid/invoice.payment_failed own that path entirely. There is no
// one-time-purchase path in this product.
//
// Deploy (verify_jwt = false is set in supabase/config.toml for this function):
//   supabase functions deploy stripe-webhook

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@16.9.0?target=deno";

const PRODUCT = "athlete_monitoring";

function toISO(unixSeconds: number | null | undefined): string | null {
  return typeof unixSeconds === "number" ? new Date(unixSeconds * 1000).toISOString() : null;
}

function mapSubscriptionStatus(stripeStatus: string): "active" | "past_due" | "canceled" | "pending" {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "pending";
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!supabaseUrl || !serviceRoleKey || !stripeSecretKey || !webhookSecret) {
    return new Response("Server is misconfigured (missing env vars)", { status: 500 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing stripe-signature header", { status: 400 });

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: "2024-06-20",
    httpClient: Stripe.createFetchHttpClient(),
  });

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch (err) {
    return new Response(`Signature verification failed: ${(err as Error).message}`, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  // Idempotency: Stripe delivery is at-least-once. If this event_id was
  // already recorded, this is a retry — acknowledge without reprocessing.
  const { data: inserted, error: ledgerErr } = await adminClient
    .from("player_billing_events")
    .upsert(
      { stripe_event_id: event.id, event_type: event.type, payload: event as unknown as Record<string, unknown> },
      { onConflict: "stripe_event_id", ignoreDuplicates: true },
    )
    .select("stripe_event_id");
  if (ledgerErr) {
    return new Response(`Could not record webhook event: ${ledgerErr.message}`, { status: 500 });
  }
  if (!inserted || inserted.length === 0) {
    return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 });
  }

  // Applies an entitlement update, guarded against out-of-order delivery:
  // skip if a newer event has already been applied to this row.
  async function applyEntitlementUpdate(
    userId: string,
    patch: Record<string, unknown>,
  ): Promise<{ error: string | null }> {
    const { data: current } = await adminClient
      .from("player_entitlements")
      .select("last_event_created_at")
      .eq("user_id", userId)
      .eq("product", PRODUCT)
      .maybeSingle();

    if (current?.last_event_created_at && new Date(current.last_event_created_at) > new Date(event.created * 1000)) {
      return { error: null }; // stale event, skip silently
    }

    const { error } = await adminClient.from("player_entitlements").upsert(
      {
        user_id: userId,
        product: PRODUCT,
        last_event_created_at: toISO(event.created),
        ...patch,
      },
      { onConflict: "user_id,product" },
    );
    return { error: error?.message ?? null };
  }

  async function userIdForSubscription(subscriptionId: string): Promise<string | null> {
    const { data } = await adminClient
      .from("player_entitlements")
      .select("user_id")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();
    return data?.user_id ?? null;
  }

  let writeError: string | null = null;

  switch (event.type) {
    case "invoice.paid":
    case "invoice.payment_failed": {
      // current_period_end is intentionally NOT set here — invoice line
      // order isn't guaranteed once the Polar Loop add-on's one-time
      // invoice items are mixed in with the recurring plan line, and
      // customer.subscription.updated (which always fires alongside these
      // events) is the reliable source for it instead.
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
      if (!subscriptionId) break;
      const userId = await userIdForSubscription(subscriptionId);
      if (!userId) break;
      const status = event.type === "invoice.paid" ? "active" : "past_due";
      const result = await applyEntitlementUpdate(userId, {
        status,
        stripe_subscription_id: subscriptionId,
      });
      writeError = result.error;
      break;
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = await userIdForSubscription(subscription.id);
      if (!userId) break;
      const status = event.type === "customer.subscription.deleted" ? "canceled" : mapSubscriptionStatus(subscription.status);
      // Recent Stripe API versions moved current_period_end from the
      // subscription itself to its item(s) — add_invoice_items don't
      // create subscription items, so this subscription always has
      // exactly one item (the plan), making items.data[0] reliable here.
      // Fall back to the legacy top-level field for older API versions.
      const item = subscription.items.data[0] as (Stripe.SubscriptionItem & { current_period_end?: number }) | undefined;
      const currentPeriodEnd = item?.current_period_end ?? subscription.current_period_end;
      const result = await applyEntitlementUpdate(userId, {
        status,
        stripe_subscription_id: subscription.id,
        current_period_end: toISO(currentPeriodEnd),
        cancel_at: toISO(subscription.cancel_at),
      });
      writeError = result.error;
      break;
    }

    default:
      break; // unhandled event types are acknowledged, not errors
  }

  if (writeError) {
    return new Response(`Could not apply entitlement update: ${writeError}`, { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});
