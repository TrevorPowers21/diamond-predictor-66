// Edge Function: create-athlete-monitoring-intent
//
// Creates (or reuses) the Stripe Customer and starts a fixed-term membership
// Subscription — either:
//   - six_month:   $300/mo, includes an initial assessment + 1 retest
//   - twelve_month: $250/mo, includes 4 two-hour assessments
// Both bill monthly and do NOT auto-renew — enforced by setting cancel_at at
// creation to (now + term length). A Subscription Schedule would also model
// this, but a fixed cancel_at is simpler and sufficient for a flat N-month
// term with no phase changes.
//
// Returns the first invoice's PaymentIntent client_secret for the embedded
// Stripe PaymentElement to confirm. save_default_payment_method:
// 'on_subscription' is required — without it, month-2+ invoices have no
// payment method attached and silently fail.
//
// This function never marks a membership 'active' — it only ever records
// 'pending'. Only the stripe-webhook function (reacting to a verified
// Stripe event) may flip status to 'active'. That split is the actual
// security boundary of this payment flow.
//
// Two calling modes, both handled here since the Stripe subscription-build
// logic (pricing, Polar Loop add-on) is identical either way:
//   - Authenticated (Authorization header with a valid player session): an
//     existing member buying/renewing. Writes go to player_entitlements,
//     keyed by user_id, same as before self-serve checkout existed.
//   - Anonymous (no valid session, `email` required in the body): the
//     public checkout flow — no Supabase account exists yet. Writes go to
//     pending_player_purchases, keyed by the Stripe subscription id, and
//     get claimed into a real account later by complete-player-signup once
//     the player sets a password.
//
// Optional Polar Loop add-on: a one-time physical-good purchase attached to
// the SAME first invoice as the membership's first month, via
// subscriptions.create's add_invoice_items — no separate charge/checkout.
// Includes a separately-itemized card-processing-fee passthrough line (not
// folded into the item price) so it's disclosed, not hidden. Whether a
// card surcharge like this is even legal varies by U.S. state — this is a
// business/compliance call, not something this function decides.
//
// Required env vars:
//   - SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (auto-provided)
//   - STRIPE_SECRET_KEY
//   - STRIPE_PRICE_SIX_MONTH, STRIPE_PRICE_TWELVE_MONTH (Stripe Price IDs,
//     not amounts — set from the Stripe Dashboard/API, no redeploy needed to
//     change pricing for future signups; existing subscribers keep their
//     original Price, which is how "locked-in" pricing works here)
//   - STRIPE_PRICE_POLAR_LOOP, STRIPE_PRICE_POLAR_LOOP_SHIPPING
//   - STRIPE_PRODUCT_PROCESSING_FEE (a Product id — the fee's Price is
//     computed per-request via price_data, since its amount depends on the
//     order total, not a fixed catalog price)
//
// verify_jwt = false is set in supabase/config.toml for this function — it
// must accept calls with no session at all (the anonymous mode above).
//
// Deploy:
//   supabase functions deploy create-athlete-monitoring-intent

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@16.9.0?target=deno";

const PRODUCT = "athlete_monitoring";
const PLAN_TERM_MONTHS: Record<"six_month" | "twelve_month", number> = {
  six_month: 6,
  twelve_month: 12,
};
const CARD_PROCESSING_FEE_RATE = 0.035;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ShippingAddress {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface RequestBody {
  plan: "six_month" | "twelve_month";
  addPolarLoop?: boolean;
  shippingAddress?: ShippingAddress;
  email?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// now + N months, as a Unix seconds timestamp for Stripe's cancel_at.
function monthsFromNow(months: number): number {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + months);
  return Math.floor(d.getTime() / 1000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const priceSixMonth = Deno.env.get("STRIPE_PRICE_SIX_MONTH");
  const priceTwelveMonth = Deno.env.get("STRIPE_PRICE_TWELVE_MONTH");
  const pricePolarLoop = Deno.env.get("STRIPE_PRICE_POLAR_LOOP");
  const pricePolarLoopShipping = Deno.env.get("STRIPE_PRICE_POLAR_LOOP_SHIPPING");
  const productProcessingFee = Deno.env.get("STRIPE_PRODUCT_PROCESSING_FEE");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !stripeSecretKey || !priceSixMonth || !priceTwelveMonth) {
    return json({ error: "Server is misconfigured (missing env vars)" }, 500);
  }

  // Authenticated mode is opt-in via a real, verifiable session — a bare
  // anon apikey header (always present on supabase.functions.invoke calls)
  // does not count, only a session that actually resolves to a user.
  const authHeader = req.headers.get("Authorization");
  let caller: { id: string } | null = null;
  if (authHeader) {
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data } = await callerClient.auth.getUser();
    caller = data.user ? { id: data.user.id } : null;
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const { plan, addPolarLoop, shippingAddress } = body ?? ({} as RequestBody);
  if (plan !== "six_month" && plan !== "twelve_month") {
    return json({ error: "plan must be 'six_month' or 'twelve_month'" }, 400);
  }
  const priceId = plan === "six_month" ? priceSixMonth : priceTwelveMonth;

  if (addPolarLoop) {
    if (!pricePolarLoop || !pricePolarLoopShipping || !productProcessingFee) {
      return json({ error: "Server is misconfigured for the Polar Loop add-on (missing env vars)" }, 500);
    }
    if (
      !shippingAddress?.name ||
      !shippingAddress?.line1 ||
      !shippingAddress?.city ||
      !shippingAddress?.state ||
      !shippingAddress?.postal_code ||
      !shippingAddress?.country
    ) {
      return json({ error: "A complete shipping address is required to add a Polar Loop" }, 400);
    }
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  let email: string;
  if (caller) {
    const { data: playerAccount } = await adminClient
      .from("player_accounts")
      .select("email")
      .eq("user_id", caller.id)
      .maybeSingle();
    if (!playerAccount) {
      return json({ error: "No player account found for this user. Complete signup first." }, 400);
    }
    email = playerAccount.email;

    const { data: existingEntitlement } = await adminClient
      .from("player_entitlements")
      .select("status")
      .eq("user_id", caller.id)
      .eq("product", PRODUCT)
      .maybeSingle();
    if (existingEntitlement?.status === "active") {
      return json({ error: "A membership is already active on this account.", alreadyActive: true }, 409);
    }
  } else {
    if (!body.email || !EMAIL_RE.test(body.email)) {
      return json({ error: "A valid email is required" }, 400);
    }
    email = body.email;
  }

  // NOTE: pin an explicit apiVersion rather than trusting the Stripe
  // account's current default — confirm at implementation time whether
  // `latest_invoice.payment_intent` is still populated on whatever version
  // is pinned here, or whether `latest_invoice.confirmation_secret` should
  // be used instead (Stripe has moved this shape across API versions).
  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: "2024-06-20",
    httpClient: Stripe.createFetchHttpClient(),
  });

  let stripeCustomerId: string;
  if (caller) {
    const { data: billingCustomer } = await adminClient
      .from("player_billing_customers")
      .select("stripe_customer_id")
      .eq("user_id", caller.id)
      .maybeSingle();

    if (billingCustomer?.stripe_customer_id) {
      stripeCustomerId = billingCustomer.stripe_customer_id;
    } else {
      const customer = await stripe.customers.create({
        email,
        metadata: { supabase_user_id: caller.id },
      });
      stripeCustomerId = customer.id;
      const { error: insertCustomerErr } = await adminClient
        .from("player_billing_customers")
        .insert({ user_id: caller.id, stripe_customer_id: stripeCustomerId });
      if (insertCustomerErr) {
        return json({ error: `Could not record billing customer: ${insertCustomerErr.message}` }, 500);
      }
    }
  } else {
    // No account yet to key a reuse lookup off of — each anonymous
    // checkout attempt gets its own Stripe Customer. An abandoned attempt
    // just leaves a stray incomplete Customer/Subscription in Stripe,
    // which Stripe auto-expires; harmless.
    const customer = await stripe.customers.create({ email });
    stripeCustomerId = customer.id;
  }

  // Shipping lives on the Customer (visible in the Dashboard for order
  // fulfillment) rather than in our own schema — this is a one-off physical
  // shipment, not something the rest of the app needs to query.
  if (addPolarLoop && shippingAddress) {
    await stripe.customers.update(stripeCustomerId, {
      shipping: {
        name: shippingAddress.name,
        address: {
          line1: shippingAddress.line1,
          line2: shippingAddress.line2,
          city: shippingAddress.city,
          state: shippingAddress.state,
          postal_code: shippingAddress.postal_code,
          country: shippingAddress.country,
        },
      },
    });
  }

  const addInvoiceItems: NonNullable<Stripe.SubscriptionCreateParams["add_invoice_items"]> = [];
  if (addPolarLoop) {
    const polarLoopPrice = await stripe.prices.retrieve(pricePolarLoop!);
    const shippingPrice = await stripe.prices.retrieve(pricePolarLoopShipping!);
    const feeAmount = Math.round(((polarLoopPrice.unit_amount ?? 0) + (shippingPrice.unit_amount ?? 0)) * CARD_PROCESSING_FEE_RATE);
    addInvoiceItems.push(
      { price: pricePolarLoop! },
      { price: pricePolarLoopShipping! },
      {
        price_data: {
          currency: "usd",
          product: productProcessingFee!,
          unit_amount: feeAmount,
        },
      },
    );
  }

  const cancelAt = monthsFromNow(PLAN_TERM_MONTHS[plan]);
  const subscription = await stripe.subscriptions.create({
    customer: stripeCustomerId,
    items: [{ price: priceId }],
    add_invoice_items: addInvoiceItems.length > 0 ? addInvoiceItems : undefined,
    payment_behavior: "default_incomplete",
    payment_settings: { save_default_payment_method: "on_subscription" },
    cancel_at: cancelAt,
    expand: ["latest_invoice.payment_intent"],
    metadata: {
      ...(caller ? { supabase_user_id: caller.id } : { customer_email: email }),
      product: PRODUCT,
      plan,
      polar_loop: addPolarLoop ? "true" : "false",
    },
  });
  const invoice = subscription.latest_invoice;
  const paymentIntent =
    typeof invoice === "object" && invoice !== null ? (invoice as { payment_intent?: unknown }).payment_intent : null;
  if (typeof paymentIntent !== "object" || paymentIntent === null || !("client_secret" in paymentIntent)) {
    return json({ error: "Subscription did not return a payment intent client secret" }, 500);
  }
  const clientSecret = (paymentIntent as { client_secret: string | null; id: string }).client_secret;
  if (!clientSecret) {
    return json({ error: "Stripe did not return a client secret" }, 500);
  }

  if (caller) {
    const { error: upsertErr } = await adminClient.from("player_entitlements").upsert(
      {
        user_id: caller.id,
        product: PRODUCT,
        status: "pending",
        plan,
        stripe_subscription_id: subscription.id,
        stripe_payment_intent_id: (paymentIntent as { id: string }).id,
        cancel_at: new Date(cancelAt * 1000).toISOString(),
      },
      { onConflict: "user_id,product" },
    );
    if (upsertErr) {
      return json({ error: `Could not record pending entitlement: ${upsertErr.message}` }, 500);
    }
  } else {
    const { error: insertErr } = await adminClient.from("pending_player_purchases").insert({
      email,
      plan,
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: subscription.id,
      stripe_payment_intent_id: (paymentIntent as { id: string }).id,
      status: "pending",
      cancel_at: new Date(cancelAt * 1000).toISOString(),
    });
    if (insertErr) {
      return json({ error: `Could not record pending purchase: ${insertErr.message}` }, 500);
    }
  }

  return json({ clientSecret, plan, subscriptionId: subscription.id, email });
});
