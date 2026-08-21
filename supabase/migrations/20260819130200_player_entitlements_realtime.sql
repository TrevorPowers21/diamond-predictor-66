-- Player app: enable realtime on player_entitlements so the checkout-
-- complete page can subscribe to its own row flipping to 'active' instead
-- of relying solely on polling. RLS still applies to realtime changefeeds,
-- so this grants no broader read access than the existing SELECT policy.
ALTER PUBLICATION supabase_realtime ADD TABLE public.player_entitlements;
