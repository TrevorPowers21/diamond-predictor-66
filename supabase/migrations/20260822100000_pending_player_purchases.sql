-- Holds a Stripe subscription created BEFORE a Supabase account exists —
-- the new public checkout flow collects only an email and takes payment
-- first, then the player sets a password afterward to create their real
-- account. This table is the bridge between those two moments.
--
-- Service-role only, same as player_billing_customers/player_entitlements:
-- no client (authenticated or anon) may read or write it directly. The
-- create-athlete-monitoring-intent function writes the initial row,
-- stripe-webhook keeps its status current while unclaimed, and
-- complete-player-signup deletes it once the row's data has been copied
-- into player_billing_customers/player_entitlements for the new user.
CREATE TABLE public.pending_player_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  plan text NOT NULL CHECK (plan IN ('six_month', 'twelve_month')),
  stripe_customer_id text NOT NULL,
  stripe_subscription_id text NOT NULL UNIQUE,
  stripe_payment_intent_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'past_due', 'canceled')),
  current_period_end timestamptz,
  cancel_at timestamptz,
  last_event_created_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pending_player_purchases_email ON public.pending_player_purchases(email);

ALTER TABLE public.pending_player_purchases ENABLE ROW LEVEL SECURITY;
