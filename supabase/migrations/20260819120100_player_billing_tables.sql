-- Player app: Stripe billing tables.
--
-- Split into three tables (rather than columns on player_accounts) so the
-- "never trust the client" boundary is a whole-table RLS boundary — no
-- policy at all grants `authenticated` write access to any of these. The
-- only writer is the stripe-webhook Edge Function's service-role client.

-- Stripe Customer mapping, 1:1 with player_accounts.
CREATE TABLE public.player_billing_customers (
  user_id uuid PRIMARY KEY REFERENCES public.player_accounts(user_id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.player_billing_customers ENABLE ROW LEVEL SECURITY;

-- Current-state entitlement — the single row the player app polls/subscribes
-- to in order to know whether Year Round Programming/Monitoring is unlocked.
-- Decouples "which membership they're on" from "do they have access right
-- now." status only ever transitions via the stripe-webhook function; the
-- create-athlete-monitoring-intent function may only set it to 'pending'.
--
-- Both membership options are Stripe Subscriptions billed monthly — there is
-- no one-time purchase. They differ by term length and price (12-month:
-- $250/mo, 6-month: $300/mo) and neither auto-renews, which is enforced by
-- setting cancel_at at creation (see the edge function) rather than a
-- Subscription Schedule — a fixed end date is all this product needs.
CREATE TABLE public.player_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.player_accounts(user_id) ON DELETE CASCADE,
  product text NOT NULL DEFAULT 'athlete_monitoring',
  status text NOT NULL DEFAULT 'inactive'
    CHECK (status IN ('inactive', 'pending', 'active', 'past_due', 'canceled')),
  plan text CHECK (plan IN ('six_month', 'twelve_month')),
  stripe_subscription_id text UNIQUE,
  stripe_payment_intent_id text,
  current_period_end timestamptz,
  -- When this membership stops billing (term end — it does not auto-renew).
  cancel_at timestamptz,
  -- Guards against an out-of-order webhook delivery clobbering newer state
  -- with a stale retry. Stripe's webhook delivery is at-least-once and does
  -- not guarantee ordering.
  last_event_created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, product)
);

ALTER TABLE public.player_entitlements ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_player_entitlements_updated_at
  BEFORE UPDATE ON public.player_entitlements
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Raw webhook ledger. Idempotency key (stripe_event_id) + audit trail. Not
-- queried by the player app itself — superadmin-only, for support debugging
-- (it contains full Stripe event payloads).
CREATE TABLE public.player_billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.player_billing_events ENABLE ROW LEVEL SECURITY;
