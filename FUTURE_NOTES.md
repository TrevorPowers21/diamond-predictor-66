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

8. Team upload template/product decision (protect model IP).
- Before finalizing Team Builder upload templates, collect and review real team-provided files to understand actual field formats.
- Rework templates/UI after that review so teams can upload needed data without exposing internal power-rating or predictive metric design.
- Keep any public/customer-facing template limited to required input fields only (no internal calculation hints, weights, or score components).

9. Team Builder PTM + equation exposure review.
- Current Team Builder uses conference dropdown to set Program Tier Multiplier (PTM).
- Consider auto-pulling PTM directly from team/conference context so users do not need to select it manually.
- Review whether Program-Specific NIL equation details should remain visible on-page or be hidden/minimized to avoid exposing internal modeling logic.

10. Team Builder program-scoped access enforcement.
- When program access is granted (example: Penn State), auto-bind Team Builder context to that assigned program.
- Program users should only see and edit their own program data: team, conference, program tier, returners, targets, and all other team-specific records tied to that program.
- Block visibility of other programs' Team Builder data for non-admin users by default.

11. Potential coach input: D-WAR fill-in.
- Consider adding a coach-editable D-WAR input in Team Builder.
- Use as an optional manual defensive adjustment field when coaches want to include defense context not captured in offensive model outputs.

12. Depth chart tiering for plate appearance/at-bat scaling.
- Add depth chart tiers that map players to projected plate appearance (PA) / at-bat buckets.
- Use those tiers to scale projections so part-time players do not skew team outputs.
- Ensure NIL and oWAR calculations use tier-adjusted playing-time assumptions to prevent inflated valuation from full-time assumptions.

13. Add 2025 team WAR benchmark ranges for roster-building context.
- Capture and store 2025 total team WAR metrics for each program.
- Expose comparison benchmarks in Team Builder (for example, team-level totals like Arkansas and LSU) so staff can target realistic WAR ranges.
- Use those ranges as reference bands during roster construction and budget planning.

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

4. Add non-active player projection equation path.
- Add a dedicated equation path for non-active players using preseason, fall, and inter-squad metrics.
- In that path, set the power-rating weight to `1.0` (not `0.7`).

### Latest Session Notes (2026-03-09)

1. Transfer Portal player access + linking
- Keep Transfer Simulator player pool aligned to full Player Dashboard population (all players selectable).
- Keep player-profile deep link available from Transfer Portal projected outcomes after a simulation runs.

2. Conference Stats editing focus
- Keep `Stuff+` editable with one decimal place.
- Keep Conference Stats table focused on rows that already have base `AVG/OBP/SLG` values (no extra noise rows during manual Stuff+ workflow).

3. Duplicate conference handling
- Prevent alias-driven conference duplication in Conference Stats (for example, AAC vs American Athletic Conference, A-10 vs Atlantic 10, CAA vs Coastal Athletic Association).
- Keep canonical conference naming consistent during manual edits/imports.

- Data QA note (2026-03-12): 2025 player stats and team assignments look accurate, but multiple power rating inputs are misaligned from prior CSV line/order issues. Re-import accurate power metrics and recalculate all power ratings before next projection pass. Known incorrect example: Tre Phelps power ratings.

- Player Dashboard design note (2026-03-12): revisit regression color styling. Current regression color makes too many players look overly poor; tone down/redesign negative-state color treatment.
- Compare workflow note (2026-03-12): Compare was moved to the Compare Dashboard route (redirecting into Team Builder compare view). Re-evaluate whether Compare should move back into Team Builder tabs later.
- Equation QA note (2026-03-16): re-validate and potentially adjust the weighted runs created plus (wRC+) equation/baseline so projected outputs stay aligned with expected benchmarks.
- Next session start point (2026-03-16): begin on the Player Dashboard and clean up the top section by removing the table + graph area.
- WAR modeling scope note (2026-03-17): build both a plate-appearance impact for offensive WAR and an innings-pitched impact for bullpen arms and starting pitchers in P-WAR; this should flow through the RAA and RPA components of the WAR equation.
- WAR constant note (2026-03-17): update both WAR conversion constants to `10.7` long-term; keep them set to `10` for now during current testing.
- Pitching conference model note (2026-03-17): Hitter Talent+ should be calculated from conference-by-conference overall hitter power rating combined with quality of stuff faced.
- Pitcher profile expansion note (2026-03-17): add a pitch-level table on every pitcher dashboard showing each pitch type thrown, usage, Stuff+, and whiff percentage.
- Next session start point (2026-03-17): start on Pitching Power Ratings Storage and debug why some pitcher player profiles are not fully populating.
- NIL dashboard note (2026-03-19): `NIL Valuations` dashboard/nav route is intentionally commented out in app navigation and routing during testing. Rework and reintegrate later instead of deleting.
- Scouting tier scale note (2026-03-19): consider translating percentile-style scouting outputs to a baseball-standard 20-80 scale for display/communication; keep 50 anchored as average.
