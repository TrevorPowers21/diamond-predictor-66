# Session Log — 2026-06-29 → 06-30 (for rollback reference)

Git's reflog is the master undo log (`git reflog`). Nothing below is lost — any
branch can be reset to any commit here. This doc is the human-readable map.

## 1. Branch: `feature/pitch-log-location-spray` (pitch-log Stats + Visuals)
Commits made this session (oldest → newest):
- `a2744b4` Hitter Visuals + per-pitch cross-tab aggregation + pitch-log migrations
- `2513b97` Merge origin/main
- `ed8522a` Fix stale transfer-weight test (D2 → JUCO)
- `38bdfb3` Add untracked SprayFieldPanel + BaseballField (fixed Vercel build)
- `b1aedb5` What's New modal 2026-06-29
- **Pushed to `origin/staging`.** → **PR #140 (staging → main) MERGED** to main as `27e1577`.

## 2. Branch: `hotfix/slot-value-prod` (War Room duplicate fix)
- `959fce0` Dedupe player_slot_values + add unique index (amended from `eb5c99a`)
- **Pushed.** → **PR #141 (→ main) MERGED.**

## 3. Branch: `feature/default-build-architecture` (current)
- Was `85d0d8c` (the one feature commit).
- Merged `origin/staging` in → **`503afee`** (catch-up; 0 conflicts).
- **Pushed** `85d0d8c..503afee` to origin.

## 4. PROD DATABASE (trbvxuoliwrfowibatkm) — NOT reverted by git
- Migrations 06-27, 06-28, #16 applied (additive, `IF NOT EXISTS`).
- Ingested 30 numeric pitch-log CSVs (~2,575,749 rows; idempotent upsert).
- Backfilled spray + pitch_zone labels (2,342,700).
- Re-aggregated all dimensions.
- **Slot value:** deleted duplicate `player_slot_values` rows (kept one per player)
  + added `player_slot_values_uniq` index. The KEPT rows are intact; the deleted
  rows were exact/near duplicates. (Re-importing the slot CSV would repopulate.)

## HOW TO GO BACKWARDS
- **Inspect any prior state:** `git reflog` (or `git show <hash>`).
- **Undo the default-build catch-up merge (local):**
  `git checkout feature/default-build-architecture && git reset --hard 85d0d8c`
  then `git push --force-with-lease origin feature/default-build-architecture`
  (returns the branch to before the staging merge).
- **Revert a merged PR on main** (#140 or #141): `git revert -m 1 <merge-commit>`
  on a branch → PR to main. (Don't force-push main.)
- **Recover a "lost" commit:** find it in `git reflog`, then `git cherry-pick` or
  `git branch recover <hash>`.
- **Stashes preserved:** `stash@{0}` slot-value migration tweak; `stash@{1}` old
  pitch-log WIP (team_build_players migration). `git stash show -p stash@{N}`.

## NOTE on the "New Build → clone" feature
Searched exhaustively (all branches, all commits via pickaxe, both stashes, full
reflog, dangling/orphaned commits via `git fsck`): **it does not exist anywhere in
this repo's git history**, and no committed work was lost this session. If it ran
yesterday it was uncommitted local work that was never committed/pushed here.
