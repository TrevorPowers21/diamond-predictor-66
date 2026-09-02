# PROD promotion — live handoff (eligibility-class-consistency branch)

**Date:** 2026-07-27. **Status:** mid prod-data promotion. Code NOT yet merged to main
(PR #157 = feature→staging, open). Trevor is testing the **preview against the prod DB**,
so prod data is being populated ahead of the merge. Trevor drives all merges + confirms
prod writes. **Roster safety is paramount** — never reset `production_notes` (toggles:
prod roster has 154 dev-agg + 1,441 depth-role toggles).

## Env / plumbing (how to run scripts on prod)
- Prod creds in `.env.production.local`. Scripts either take a `--prod` flag OR read
  `process.env.SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (export those from
  `.env.production.local` first — needed anyway because the imported app supabase client
  reads process.env).
- Export block used every run:
  ```
  export SUPABASE_URL="$(grep '^VITE_SUPABASE_URL=' .env.production.local|cut -d= -f2-|tr -d '\"')"
  export SUPABASE_SERVICE_ROLE_KEY="$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.production.local|cut -d= -f2-|tr -d '\"')"
  ```
- `verify-all.ts`, `heal-stale-snapshots.ts`, `resync-target-snapshots.ts`, `rebuild-twp-target-rows.ts`
  now support `--prod`. `heal --prod --apply` is gated → pass `--yes` (or RSTR_AUTOMATION_TOKEN).
- verify-all/heal are SLOW on prod (per-player fetches) — use a long tool timeout (~570000ms).

## KEY BUG FIXED THIS SESSION (do not regress)
`map(c => String(c.school_team_id)).filter(Boolean)` let a NULL school_team_id become the
string `"null"`, which broke the whole `.in("id", …)` Teams-Table query (invalid UUID) →
`teamConf` empty → **every row `noConf`** → all market/depth recomputes silently skipped.
Fixed to `map(c => c.school_team_id).filter(Boolean).map(String)` in: resync-target-snapshots,
resync-build-snapshot-markets, fix-pitcher-market-pvf, verify-all, heal-stale-snapshots.
(RSTR IQ has null school_team_id → this only bit prod, not staging.) Conf now resolves (ctConf=13).

## DONE on prod (applied, verified)
1. **Schema (Phase 0)** — Trevor pasted: added `target_board.{production_notes, position_slot,
   neutral_snapshot}` + `team_build_players.neutral_snapshot`; dropped old target_board unique
   constraints + added slot-aware unique index `(user_id, customer_team_id, player_id,
   coalesce(position_slot,''))`. Verified all 4 cols exist, 174 target rows intact.
2. **Active builds** — `scripts/apply-active-builds-prod.ts --apply` (Trevor's confirmed picks;
   RSTR IQ intentionally 0 active; BYU pinned to `9bb9cc93`; PSU pinned `9df074dc`).
   Verified: 13 programs exactly-1-active, RSTR IQ 0 (intended).
3. **Target-side backfills (applied):** neutral (bp=1251, tb=173), transfer_snapshot (173),
   rebuild-twp (3 TWPs), notes-from-roster (48), rostered-consistency (47).
4. **resync-target-snapshots --all --prod --apply (150 rows)** — ⚠ this was a MISTAKE: it
   naive-stamps depth roles and mis-fit role-transition pitchers, taking verify-all 11→33.
   Heal (below) recomputes these correctly and supersedes it.

## IN PROGRESS / NEXT (the plan Trevor approved: "make everything consistent")
Order:
1. **`heal-stale-snapshots.ts --prod --all --apply --yes`** — recomputes snapshot=f(neutral,notes)
   via projectEffective (rounds pRV+, models SP↔RP transitions). Dry-run showed **drift=568**,
   almost all tiny ROSTER pRV+ rounding (rv+96.91→97, WAR ±0.02). Preserves all toggles (reads
   production_notes, never writes it). This is the "Phase-1 rounding" fix + fixes the resync damage.
   Trevor explicitly approved touching the ~568 roster rows (tiny, toggle-preserving).
2. **`clean-twp-sides.ts 🗑️ DELETED 2026-08-31 --apply`** (uses process.env) — own-side TWP snapshots. Dry-run: 26
   roster + 4 target rows. Nulls OFF-side fields only (no toggle reset). Fixes Kenny §4.
3. **`verify-all.ts --prod`** — recheck. EXPECT residual, all explainable:
   - RSTR IQ + "undefined" program: 0 active build → INTENTIONAL (Trevor: RSTR IQ skip; undefined
     = orphaned null-customer_team_id builds).
   - Role-transition pitchers (Cespedes/Neiswonger/etc.): §2 uses naive computePitcherWar(rv,IP)
     which can't model SP↔RP, so it flags the (correct) transitioned pWAR. **verify-all limitation,
     not a real bug.** Confirm the flagged pWAR == projectEffective's value before dismissing.

## ✅ FINAL STATE (2026-07-27) — prod consistent, verify-all = 4 (all explained)
Root-caused and fixed at the source instead of churning the pipeline:
1. **wRC+/oWAR consistency (49 rows)** — dev-agg-toggled hitters stored NEUTRAL wRC+ against
   an ADJUSTED oWAR. Fixed: `projectEffective` now returns `hitterRates` (adjusted slash + wRC+);
   `heal` writes that + detects wRC+ drift. Cleared the whole §2 hitter false-positive class.
2. **Market migration to canonical f(WAR) (74 rows)** — `heal --market` (opt-in flag). Hitters
   +posMult (IF 1.1 etc.), pitchers −PVF. Both are INTENDED formula changes from this push
   (posMult since 387a891 on main; PVF-drop new in 06ae521). WAR + toggles byte-identical.
3. **Side-detection by data shape, not slot** — heal + verify-all §3 now classify a row's side
   by its snapshot/neutral data shape, so a mis-slotted hitter (Newman in "RP4") heals + checks
   as a hitter. (`scripts/heal` side calc + verify §3 `rpIsPit`.)
4. **Kenny Ishikawa true two-way** (`scripts/fix-prod-residuals.ts`) — added a real pitcher row to
   the active Georgia build + rewrote his board SP row with his canonical pitcher line.
   **CRITICAL:** pitcher IP/pWAR come from the DEPTH ROLE (swing_starter = 30 IP), NOT the stored
   `projected_ip` (his returner-global row wrongly says 85). See memory `feedback_projected_ip_from_depth_role`.
5. **Newman** — his active-build row's neutral was a null PITCHER neutral (written because he sat in
   a pitcher slot); overwrote it with his hitter neutral, then heal recomputed him to match the board.

**verify-all --prod = 4, all accounted for:**
- §1 ×2: RSTR IQ + "undefined" — 0 active build, INTENTIONAL.
- §2 ×1: Preston Allen — market 5000 vs f=4167, residual PVF his JUCO eligibility-gate makes heal
  skip. $833 cosmetic on a 0.11-pWAR fringe JUCO transfer. Known residual, not worth touching the gate.
- §3 ×1: Jaxon Grossman — empty player, NO projection data at all (no neutral). Trevor: leave as-is.

## (historical) ⚠ 2026-07-27 earlier — STOPPED CHURNING
- **ROSTER IS DONE + SAFE.** heal --prod --apply rounded ~568 roster snapshots (tiny pRV+
  rounding, WAR ±0.02), toggles preserved. The roster is internally consistent. Do NOT
  re-run roster-touching ops without cause.
- **TARGET BOARD is NOT clean yet (~43 verify-all issues) and I made it worse by iterating**
  (25 → 51 → 43). STOP re-running the target pipeline blindly — each pass shifts the set.
- **Root of the residual (diagnose before fixing):** target snapshot **depth LABEL vs WAR**
  inconsistency + **rostered-target market**. Two mechanisms:
  1. heal recomputes WAR at the NEUTRAL's depth but SKIPS no-WAR-drift rows, so it never
     rewrites their `hitter_depth_role`/`pitcher_depth_role` label → verify-all §2 (which
     uses the stored label) flags oWAR≠recompute(label). e.g. Manny Marin oWAR 0.980 vs
     everyday_starter 0.896.
  2. `backfill-rostered-target-consistency` copies the ROSTER's depth+WAR+market onto the
     board; heal then recomputes the board from the neutral → they diverge; market ends up
     ~10-15% off f(WAR) (Aiden Mouton 43645 vs 48010).
  3. **Kenny Ishikawa (Georgia TWP)** is still broken — pitcher row carries hitter data /
     missing p_war, roster(1.499 cornerstone) ≠ board(0.887). clean-twp-sides 🗑️DELETED-2026-08-31 + rebuild-twp
     didn't fully resolve him. Needs a manual look.
  4. Role-transition pitchers (Cespedes/Neiswonger) — §2 can't model SP↔RP, always flags. Not real.
- **These are TARGET-BOARD cosmetic inconsistencies (depth label / ~10% market), NOT
  coach-breaking.** Roster is fine.
- **NEXT (careful, not churning):** pick ONE flagged rostered target (Manny Marin), trace
  roster snapshot vs board transfer_snapshot vs neutral_snapshot, decide the single correct
  source of truth for a rostered target's board line (should MIRROR the roster snapshot 1:1,
  incl. its depth label + market — not be re-healed off the neutral). Likely fix: for
  rostered targets, the board line should be a straight copy of the roster player_snapshot
  (rostered-consistency), and heal should EXCLUDE rostered targets (they mirror the roster,
  which is already consistent). Verify on staging logic first. Then verify-all --prod → aim
  low (residual = role-transition pitchers + 2 intentional active-build only).

## After prod data is consistent
- Trevor merges **PR #157** (feature→staging), then opens/merges **staging→main** (deploys code).
- Enable self-heal sweep (`docs/SELF_HEAL_SWEEP.md`) — only after neutral backfill (done).
- Commit + push the script fixes made this session (the `.in()` null fix, `--prod` flags,
  `apply-active-builds-prod.ts`, set-active-builds null/multi-active guard). NOT yet committed.

## Known prod data notes (not blockers)
- `players.team_id`: prod ~50% null = 15,706 real players from a 2026-05-14 D1 stats import that
  came in team-less (blank team). Inert (no team → invisible to team-scoped views). See memory
  `project_players_team_id_null`.
- Cross-program read leak (target profile read-only) fixed in PlayerHub (scope to effectiveTeamId).

## Guardrails
Dry-run every prod write first. Verify in the DB, never punt to browser. Roster toggles
(production_notes) are sacred — heal/clean-twp read them, never rewrite. Trevor clicks merges.
