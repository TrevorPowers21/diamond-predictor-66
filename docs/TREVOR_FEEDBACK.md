# Trevor's Feedback on Peyton's Architecture Proposals

**Date:** 2026-04-01

---

## Answers to Peyton's Questions

### Branch & Git
1. **Force-push was intentional.** Git was corrupted from Node v24 crashes. We re-cloned fresh and force-pushed to get a clean baseline. The wiped commits (hitter seed migration, useHitterSeedData hook, UUID linking, CSV utils) were already incorporated into the working code before the force-push.
2. **Yes, branches have diverged.** testing-trevor is the production base. Peyton's features should be ported over individually, not merged.

### Features
3. **Compare tab hidden intentionally for demo.** Code exists but wasn't tested enough. Keeping "Coming Soon" until verified.
4. **Lock/unlock toggle** — fine to add back, not critical for demos.
5. **useHitterSeedData hook still exists** in the codebase. It queries Supabase first with pagination, falls back to JSON. The CSV import pipeline is for admin bulk imports — different purpose.
6. **Supabase pitching/hitting tables are populated with real data.** 896 pitchers, 2,299 hitters, all linked by player_id UUID.
7. **Park factors from master CSVs.** Accuracy being verified. Moving to Supabase is in progress.

---

## Architecture Feedback

### Agree With
- [ ] Adopt the branch strategy (main, develop, feature branches, no force-pushes on shared branches)
- [ ] Add docs/ directory to repo for architecture, pipeline, and formula documentation
- [ ] Merge Peyton's docs (ARCHITECTURE.md, TRUMEDIA_PIPELINE.md, PROJECTION_FORMULAS.md) into docs/
- [ ] TruMedia pipeline design is solid — build it after tables are stable

### Defer / Disagree With

#### FastAPI Backend — Not Now
- [ ] Discuss with Peyton: the prediction engine already works in TypeScript in the app. Rebuilding it in Python means doing the same work twice and keeping both versions in sync during migration. The bottleneck right now is data organization in Supabase, not compute power. We don't need pandas/numpy for the math we're doing.
- [ ] Revisit FastAPI only when there's a specific feature that requires a separate backend (batch processing that Supabase Edge Functions can't handle, ML model training, etc.)

#### Repo Restructure — Not Now
- [ ] Discuss with Peyton: moving everything into a frontend/ folder breaks every import path, Vite config, and deployment setup. That's days of work fixing things that already work, with zero user-facing value. Do it when we actually spin up a backend, not before.

#### Separate Deployment Target — Not Now
- [ ] Discuss with Peyton: Supabase already has Edge Functions for background processing. Same result as FastAPI on Cloud Run, but no extra server to manage, deploy, or pay for. We can always add a separate backend later if we outgrow Supabase.

---

## What We Should Do Right Now (Priority Order)

1. **Finish Supabase table design** — conferences (done), conference_stats (done), teams (adding conference_id), park_factors (next), hitter_master, pitcher_master
2. **Wire up the app** to read from new Supabase tables instead of hardcoded data
3. **Kill localStorage dependencies** — everything reads from Supabase
4. **Fix remaining bugs** — hitter target board crash, Jake Brown, park factor accuracy
5. **Re-enable Compare tab** once it's tested
6. **Add lock/unlock UI toggle** back from Peyton's branch
7. **Adopt branch strategy** — set up develop branch, PR workflow
8. **Build TruMedia pipeline** — only after tables are finalized
9. **Consider FastAPI/monorepo** — only when a feature demands it

---

## Summary

The architecture ideas are good long-term thinking. But building them now slows us down. Get the tables right, get the data clean, get the demos working. Infrastructure upgrades come after the product works.
