/**
 * Savant access allowlist.
 *
 * Savant is intentionally hidden from RSTR IQ. The only way to reach it is by
 * typing a /savant/* URL while signed in with an email on this list. Anyone
 * else (including RSTR IQ admins) gets a NotFound — we do not advertise that
 * Savant exists.
 *
 * To grant access: add the email (lowercase) to ALLOWED_EMAILS and redeploy.
 * Later this can move to Supabase or env vars; for now keep it simple.
 */
export const ALLOWED_EMAILS: ReadonlyArray<string> = [
  "backsidegb@gmail.com",
];

export function isSavantAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  return ALLOWED_EMAILS.includes(email.toLowerCase());
}
