-- Player app: RLS policies for the tables created with RLS enabled but no
-- policies in the prior two migrations. Matches the two-step convention
-- used for customer_teams/user_team_access (see rls_tenancy_tables.sql).

-- ─────────────────────────────────────────────────────────────────────
-- player_accounts
--   Read/write: the player themselves, only their own row.
--   No DELETE policy — account deactivation is a service-role action, not
--   self-serve, in v1.
-- ─────────────────────────────────────────────────────────────────────
CREATE POLICY "player_accounts_select" ON public.player_accounts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "player_accounts_insert" ON public.player_accounts
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "player_accounts_update" ON public.player_accounts
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────
-- player_billing_customers
--   Read: the player themselves, only their own row.
--   Write: deliberately NO policy for `authenticated` at all — only the
--   stripe-webhook / create-athlete-monitoring-intent Edge Functions
--   (service-role client, bypasses RLS) may create or modify this row.
-- ─────────────────────────────────────────────────────────────────────
CREATE POLICY "player_billing_customers_select" ON public.player_billing_customers
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────
-- player_entitlements
--   Read: the player themselves, only their own row.
--   Write: deliberately NO policy for `authenticated` at all. This is the
--   load-bearing security property of the whole payment flow — a client
--   can never mark its own purchase 'active'. Only the stripe-webhook
--   function's service-role client writes this table.
-- ─────────────────────────────────────────────────────────────────────
CREATE POLICY "player_entitlements_select" ON public.player_entitlements
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────
-- player_billing_events
--   Contains full Stripe webhook payloads (billing address, etc).
--   Read: superadmin only, for support debugging. No policy for players.
--   Write: service role only (no policy for `authenticated`).
-- ─────────────────────────────────────────────────────────────────────
CREATE POLICY "player_billing_events_select_superadmin" ON public.player_billing_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::public.app_role));
