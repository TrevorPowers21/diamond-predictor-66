DEV Skip Login — TEMPORARY

What: A "Skip login" button in the local dev login screen enables a mock admin session so developers can access the app without authenticating.

Why: Useful for rapid testing and UI development while backend auth or test accounts are being prepared.

IMPORTANT (before launch):
- Remove the skip-login button and any dev bypass code from `src/hooks/useAuth.tsx` and `src/pages/Auth.tsx`.
- Ensure no mock sessions or hardcoded roles remain in the codebase.
- Confirm all RLS and production auth behaviors are enforced in staging and production.

How it works:
- The login button calls `enableDevBypass()` on the auth context; that sets a mock `session` and `user`, and assigns the `admin` role locally.
- This affects only the client-side auth context — it does NOT create real tokens on the Supabase backend.

Safety notes:
- Do NOT set `VITE_BYPASS_AUTH` or any environment variable enabling bypass in production.
- Audit commits to ensure this file and the bypass code are removed prior to release.

TODO (before launch):
- [ ] Remove `enableDevBypass` usage and the skip-login UI.
- [ ] Run full auth + RLS integration tests in staging.
