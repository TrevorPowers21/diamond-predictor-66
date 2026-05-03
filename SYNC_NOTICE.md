# Hey Peyton — read this before you push

**Your `feature/auth` branch is behind `staging`.** On 2026-05-03, your auth + admin work was integrated with Trevor's `feature/2026-launch-prep` work via [PR #1](https://github.com/TrevorPowers21/diamond-predictor-66/pull/1) and merged into `staging`. `staging` is now the shared integration point going forward.

If you commit and push to `feature/auth` without syncing first, you'll diverge from staging and we'll have to merge again. Sync first, then work. **Don't force-push.**

## Sync your branch

```bash
# from your terminal, on feature/auth:
git fetch origin
git merge origin/staging

# resolve any conflicts (shouldn't be many — your auth code already
# merged cleanly through PR #1, this just brings the integrated
# version onto your local feature/auth)

git push
```

After that, `feature/auth` has every commit that's on `staging` plus anything you continue to add.

## What's on staging now (your auth + Trevor's launch prep)

**From your branch (12 commits):** Multi-tenant schema, RLS policies, useAuth refactor, /admin/teams + /admin/users, invite-user-to-team Edge Function, Forgot Password flow, TeamSwitcher, get_team_member_emails SECURITY DEFINER, all the polish from Apr 28-29.

**From Trevor's branch:** Stitch v2 PDF redesigns, season standardization (`CURRENT_SEASON`/`PRIOR_SEASON` constants), source_team_id architecture cleanup, Park Factors rekey on `(source_team_id, season)`, pitcher returners projection fix (PR+ now reads from Pitching Master columns), TeamBuilder polish.

**Merge resolutions worth knowing about:**
- `demoSchool.ts` is gone. Trevor's old DEMO_SCHOOL system is fully replaced by your `impersonateTeam` + `effectiveTeamId` mechanism.
- New `useEffectiveSchool` hook (`src/hooks/useEffectiveSchool.ts`) bridges `effectiveTeamId` → school name. Wired into TeamBuilder, TransferPortal, and PlayerComparison so impersonating a customer team auto-defaults the team picker. Same UX DEMO_SCHOOL provided pre-merge, now driven by your auth.
- AdminTeams "Linked D1 Program" dropdown filters to current-season Teams Table rows so each program appears once instead of duplicated per-season.

## Known gaps (deferred, fair game for you to tackle if you want)

1. **SchoolBanner logo on impersonation.** `resolvedSchoolName` updates correctly via your auth wiring, but `resolvedSchoolLogo` only reads from the prop. Needs a `logo_url` column on `customer_teams` + admin UI to populate. Migration + auth select update + AdminTeams form input. ~30-45 min of work.
2. **Migrations need to run on each Supabase project before auth works end-to-end.** The 9 migrations from your branch (`20260428*` through `20260429*`) are now on staging in source. Apply with `supabase db push` against the target project.

## Branch flow going forward

```
feature/auth ────► staging ◄──── feature/2026-launch-prep
   (you)                              (trevor)
```

- Both branches are long-lived. Keep working on yours.
- When you have a chunk ready to ship, PR `feature/auth` → `staging`.
- Periodically, pull staging back into `feature/auth` to stay synced (`git merge origin/staging`).
- Use merge commits, never rebase or force-push on shared branches. (The March incident with `testing-peyton` / `testing-trevor` was caused by a force-push — let's not repeat that.)

## When you're done

Delete this file (`SYNC_NOTICE.md`) after you've synced. It's just a one-time heads-up — no need to keep it around.

```bash
rm SYNC_NOTICE.md
git add SYNC_NOTICE.md
git commit -m "Sync feature/auth with staging; remove sync notice"
git push
```

Welcome back. Holler if anything looks off after the sync.
