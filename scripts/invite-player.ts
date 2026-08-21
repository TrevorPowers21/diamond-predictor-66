// Sends a player-app invite: creates the auth.users row via Supabase's admin
// invite API (magic link, no password yet) and tags it with
// raw_user_meta_data.app = 'player' so the handle_new_player_account() DB
// trigger creates the matching player_accounts row.
//
// The player clicks the emailed link, lands on the player app's
// /set-password route with a recovery-type session, and sets their password
// there (same UX as the coach app's invite flow in src/pages/Auth.tsx).
//
// Usage:
//   npm run invite-player -- player@example.com "First" "Last"

import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const playerAppUrl = process.env.PLAYER_APP_URL || "https://player.rstriq.com";

if (!url || !serviceRoleKey) {
  console.error("Missing VITE_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const [email, firstName, lastName] = process.argv.slice(2);
if (!email) {
  console.error('Usage: npm run invite-player -- player@example.com "First" "Last"');
  process.exit(1);
}

const adminClient = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

async function main() {
  const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${playerAppUrl}/set-password`,
    data: { app: "player", first_name: firstName ?? null, last_name: lastName ?? null },
  });

  if (error) {
    console.error(`Invite failed: ${error.message}`);
    process.exit(1);
  }

  console.log(`Invited ${email} (user_id: ${data.user?.id}). They'll receive a magic-link email.`);
}

main();
