// Edge Function: get-pending-purchase-status
//
// Public, unauthenticated status check for a purchase made through the
// anonymous checkout flow (no Supabase account exists yet at that point, so
// there's no session to read player_entitlements through RLS). The
// /checkout/complete page polls this with the subscriptionId returned from
// create-athlete-monitoring-intent.
//
// Returns ONLY a status string — never email or other row data — since this
// endpoint takes no proof of identity beyond knowing the (unguessable)
// subscription id.
//
// verify_jwt = false is set in supabase/config.toml for this function.
//
// Deploy:
//   supabase functions deploy get-pending-purchase-status

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

  let body: { subscriptionId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!body.subscriptionId) return json({ error: "subscriptionId is required" }, 400);

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  // Already claimed into a real account — player_entitlements is the row
  // of record at that point, not pending_player_purchases.
  const { data: claimed } = await adminClient
    .from("player_entitlements")
    .select("status")
    .eq("stripe_subscription_id", body.subscriptionId)
    .maybeSingle();
  if (claimed) return json({ status: claimed.status, claimed: true });

  const { data: pending } = await adminClient
    .from("pending_player_purchases")
    .select("status")
    .eq("stripe_subscription_id", body.subscriptionId)
    .maybeSingle();
  if (pending) return json({ status: pending.status, claimed: false });

  return json({ status: "not_found", claimed: false });
});
