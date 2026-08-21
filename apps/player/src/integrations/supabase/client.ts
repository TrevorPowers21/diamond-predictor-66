import { createClient } from "@supabase/supabase-js";

// Same Supabase project as the coach app (shared player_* tables, isolated
// by RLS) — separate env values here since there's no shared workspace
// config, but they point at the same project URL/anon key.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
    // usePlayerAuth.tsx parses invite/recovery hash tokens and calls
    // setSession() itself. Leaving the built-in auto-detection on races
    // that manual call: refresh tokens are single-use/rotating, so
    // whichever consumer processes the hash second gets a 401. Disabling
    // it here makes our own code the sole consumer.
    detectSessionInUrl: false,
  },
});
