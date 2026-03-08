# Future Notes

## Project: diamond-predictor-66

Status: In testing phase. Defer cleanup until testing is complete.

### Post-testing cleanup tasks

1. Update README placeholders with real values.
- Replace `REPLACE_WITH_PROJECT_ID`.
- Replace `<YOUR_GIT_URL>`.
- Replace `<YOUR_PROJECT_NAME>`.
- Ensure setup/deploy instructions match the actual repo.

2. Add runtime env checks for Supabase config.
- Validate `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` before client creation.
- Show a clear error message if either value is missing.

3. Replace placeholder tests with meaningful coverage.
- Remove/replace the trivial `example.test.ts`.
- Add at least smoke tests for core routes/components.
- Add at least one auth flow test and one data-loading behavior test.

4. Remove temporary Teams Admin action buttons added during testing.
- Delete one-off migration/cleanup buttons before release (for example: `Reset Team Import`, `Reset Teams to Seed`, `Apply Locked Standards`, plus any other temporary backfill/reset controls).
- Keep only long-term production-safe controls.

5. Conference timeline note (2026).
- LaSalle was manually added under Atlantic 10 / A-10 in this testing setup.
- Confirm and handle first-year-in-2026 conference membership timing logic when production conference sync rules are finalized.

6. Team-private in-season data uploads (fall + preseason).
- Build a secure workflow for programs to upload their own player data points during fall/preseason.
- Enforce tenant-level privacy so only that team/program can view and use its uploaded data.
- Use those private inputs in future player prediction calculations while preventing cross-team access.

7. Transfer Portal automation by team account profile.
- Auto-set destination team in Transfer Portal simulations from the logged-in team account/profile.
- Restrict team users to their own program context and keep cross-program data access blocked.
- Keep manual team override available for admin-only testing.

### Resume Here (Latest Work)

1. Teams conference backfill is blocked at edge function deploy step.
- New function was created: `supabase/functions/scrape-team-conferences/index.ts`.
- UI button already added in Admin Teams tab: `Scrape Conferences`.
- Deploy failed from terminal and needs retry/debug.

2. Next step to resume.
- Try deploy again:
  `npx supabase functions deploy scrape-team-conferences --project-ref trbvxuoliwrfowibatkm`
- If deploy keeps failing, implement CSV conference import fallback in Teams tab (in-house only), then import team+conference CSV directly.

3. Equation follow-up to implement next.
- Update Batting Average equation with the new dampening model changes.
- Apply the same dampening-model style update to On-Base Percentage equation.
- Apply the same dampening-model style update to Isolated Power equation.
