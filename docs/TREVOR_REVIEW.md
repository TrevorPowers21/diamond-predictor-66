# Branch Review & Alignment — Trevor Action Items

**Date:** 2026-04-01
**From:** Peyton
**Context:** I audited both branches (`testing-peyton` and `testing-trevor`) using Claude. The branches have fully diverged after your force-push on March 30. This doc summarizes what I found and what I need answers on before we proceed.

---

## Questions for Trevor (answer inline or in a separate doc)

### Branch & Git

1. **Why did you force-push `testing-trevor`?** Was this intentional or accidental? The force-push wiped 4 commits we had merged (hitter seed migration, `useHitterSeedData` hook, UUID-based player linking, shared CSV/conference utils). Those are gone from your branch now.

2. **Are you aware the branches have no common ancestor anymore?** A normal `git merge` won't work. We need to pick one branch as the base and port changes from the other.

### Features

3. **Was the Compare tab hidden intentionally for the demo?** Your TeamBuilder has a fully implemented compare panel in a `compare-hidden` tab, but the visible tab says "Coming Soon." The Compare page is also disabled in the sidebar nav. Was this a demo decision or is something broken?

4. **Lock/unlock predictions — is the UI toggle intentionally removed?** The backend logic exists (auto-locks during updates), but there's no user-facing button to manually lock/unlock a player's prediction. My branch had this. Do you want it back?

5. **Is the `useHitterSeedData` hook work superseded?** You built a CSV import pipeline in AdminDashboard that upserts to `hitter_stats_storage`. The hook I merged (which queried Supabase first, fell back to JSON) got wiped in the force-push. Is your CSV pipeline the replacement, or do we need the hook pattern too?

6. **What's the state of `pitching_stats_storage` in Supabase?** Is it populated with real data, or still empty/test data? Same question for `hitting_power_ratings_storage`.

7. **The 330-team pitching park factors hardcoded in `parkFactors.ts` — where did this data come from?** Is it from TruMedia? Is it accurate for 2025-2026? Should this live in Supabase instead of being hardcoded?

### Architecture

8. **What's your vision for the backend?** Are you planning to keep everything in Supabase (tables + edge functions), or do you see a need for a separate Python/Node API? I've drafted an architecture doc (`ARCHITECTURE.md`) recommending a monorepo with a FastAPI backend — read it and let me know your thoughts.

9. **The DataSync page — is this production or dev tooling?** Should it be user-facing or admin-only? What's the long-term plan for data ingestion?

---

## What I Found: Feature Audit

### Your branch has everything except:

| Feature | Status on your branch | Action needed |
|---------|----------------------|---------------|
| Pitcher Compare tab | Code exists but **hidden** | Re-enable `compare-hidden` → `compare` |
| Team Builder Compare panels | Same — hidden behind "Coming Soon" | Flip the tab visibility |
| Compare page in sidebar | **Disabled** | Change `disabled: true` → `false` in DashboardLayout |
| Lock/Unlock prediction UI | Backend only, **no user toggle** | Add toggle button to PlayerProfile + ReturningPlayers |
| Multi-select compact display | **Missing** | Low priority — standard selects work fine |
| `useHitterSeedData` hook | **Gone** (force-push wiped it) | May not need if CSV pipeline replaces it — confirm |

### Your branch is ahead on:

| Area | What you built |
|------|----------------|
| Pitching DB tables | `pitching_stats_storage` in Supabase — proper persistence |
| Player-Team linking | `team_id` FK + `source_player_id` on players table |
| Pitching park factors | 330 NCAA teams hardcoded in parkFactors.ts |
| CSV import pipeline | ~970 lines in AdminDashboard for master hitter CSV → Supabase |
| DataSync page | Dedicated page for Google Sheets sync + bulk imports |
| Prediction engine fallback | Derives power from `hitting_power_ratings_storage` when internal ratings are missing |
| Conference resolution | Fuzzy team-name fallback from teams table when player.conference is null |

### My branch is ahead on:

| Area | What I built |
|------|--------------|
| Documentation | ARCHITECTURE.md, TRUMEDIA_PIPELINE.md, PROJECTION_FORMULAS.md, ROADMAP.md |
| Compare page enabled | Fully functional in sidebar + all tabs visible |
| Lock/unlock UI | User-facing toggle on profiles and returning players |

### Both branches have (no gaps):

- Target Board (full UI + persistence)
- returnTo back-navigation on all profile links
- Pitching Equations editor (admin tab)
- Stuff+ Storage tab
- NIL program-specific tier/position multipliers
- Pitcher role transitions (SP/RP/SM bidirectional)
- Dev Weights CRUD
- Class transition + dev aggressiveness in prediction engine
- Identical styling, theming, auth flow, routes

---

## The Plan Going Forward

### Step 1: Answer the questions above

Before any code changes. I need your answers to align on what's intentional vs accidental.

### Step 2: Establish branch strategy

**No more force-pushes on shared branches.** Here's the new structure:

```
main              ← production (protected, PR-only)
develop           ← integration branch (PRs from feature branches)
feature/trevor-*  ← Trevor's working branches
feature/peyton-*  ← Peyton's working branches
```

- All merges to `develop` via PR
- All merges to `main` via PR from `develop`
- Never force-push `develop` or `main`

### Step 3: Monorepo restructure

Before building new features, reorganize the repo:

```
diamond-predictor-66/
├── frontend/          ← current React app (move everything here)
├── backend/           ← new FastAPI service (empty for now)
├── supabase/          ← migrations + edge functions (already exists)
├── data/              ← seed CSVs, processing scripts
├── docs/              ← architecture, pipeline, formulas docs
└── README.md
```

This is a one-time restructure. Read `ARCHITECTURE.md` for the full rationale.

### Step 4: Merge branches

After the restructure, we consolidate:
1. Your branch (`testing-trevor`) becomes the base — your DB infrastructure is the right foundation
2. I port my docs into `docs/`
3. We re-enable Compare tab, add lock/unlock UI toggle
4. We verify all features work end-to-end
5. This becomes the first commit on `develop`

### Step 5: Audit + Roadmap

Once we're on a single branch with clean history, we do a full audit:
- What features are production-ready
- What needs polish
- What's missing
- Data pipeline priorities (TruMedia automation, seed data migration)
- Backend priorities (what moves from frontend → FastAPI)

We'll create a prioritized roadmap from that audit and divide work.

---

## Documents to Read

All in the repo on `testing-peyton`:

1. **`ARCHITECTURE.md`** — Monorepo structure, what goes where, migration plan, deployment strategy
2. **`docs/TRUMEDIA_PIPELINE.md`** — Automated TruMedia CSV scraping pipeline (Playwright + Cloud Run + cron)
3. **`docs/PROJECTION_FORMULAS.md`** — Prediction math documentation (if you have questions about my engine changes)

Review these and let me know where you agree/disagree. We'll align before writing any more code.
