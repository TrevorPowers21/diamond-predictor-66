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
