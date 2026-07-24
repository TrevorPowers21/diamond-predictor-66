# PROD runbook — eligibility-class-consistency branch

Coordinated prod promotion for PR #157. Everything here already ran on the **staging DB**
(verify-all 0). This is the ordered prod execution. **Trevor drives every merge + the
active-build confirmation.** Consolidated from handoff §8/§9/§10/§11 — see those for the
per-script rationale + staging counts.

## Rules for this run
- **Dry-run every script first** (omit `--apply`), eyeball the count, then `--apply`.
- **Verify via the catalog / a fresh SELECT**, never the "OK" a write returns (stale-cache risk).
- ⚠ **Env caveat:** some scripts hardcode `.env.local` (staging). Those must be pointed at
  prod — either they support `--prod` (heal-stale-snapshots, backfill-neutral-snapshot,
  audit-neutral-predictions, triple-check-neutral) OR you run them with prod env vars
  exported from `.env.production.local`. **Confirm each script's DB banner prints the PROD
  URL before `--apply`.** Scripts known to hardcode `.env.local`: resync-target-snapshots,
  resync-build-snapshot-markets, fix-pitcher-market-pvf, verify-all, audit-georgia,
  set-active-builds, backfill-target-notes-from-roster, backfill-rostered-target-consistency,
  rebuild-twp-target-rows, fix-returner-twp-hitter-market, clean-twp-sides,
  backfill-target-transfer-snapshots — add a `--prod` env swap before running.

---

## Phase 0 — Schema migrations (apply first; columns the data ops need)
1. `target_board` add `player_snapshot`, `production_notes` (if not already on prod).
2. `supabase/migrations/20260724120000_target_board_twp_two_row.sql` — `position_slot` +
   drop ALL unique constraints + slot-aware unique index.
3. `supabase/migrations/20260724130000_neutral_snapshot.sql` — `neutral_snapshot jsonb` on
   `team_build_players` + `target_board`.

## Phase 1 — WAR / market base fixes (handoff §8 + §9)
4. Prod SQL batch: pRV+/wRC+ rounding + `p_war`/`o_war` recompute + `projected_ip`=depth-role
   IP + market recompute (the pERA/WAR/market foundation).
5. `fix-pitcher-market-pvf.ts --apply` — canonical pitcher `market_value`/`twp_pitcher` =
   pWar×25000×tier, no PVF, all teams. Slow (row-by-row), idempotent.
6. `resync-target-snapshots.ts --all --apply` — target market from stored WAR at program tier + stamp depth roles.
7. `resync-build-snapshot-markets.ts --all --apply` — floor non-positive-WAR build markets to $0.

## Phase 2 — TWP + target snapshots (handoff §8 + §10; order-sensitive)
8. `fix-returner-twp-hitter-market.ts --apply` (~137 prod rows) — **MUST precede the
   transfer_snapshot backfill** (recomputes returner-TWP `twp_hitter_market_value` + nulls the shared `market_value`).
9. `backfill-target-transfer-snapshots.ts --apply` — expect noPrediction=0 (any >0 → STOP, that's the pagination-order bug, not a gap).
10. `rebuild-twp-target-rows.ts --apply` — 2 own-side rows per TWP on a board (**after** the Phase-0 TWP migration).
11. `backfill-rostered-target-consistency.ts --apply` — board `transfer_snapshot` ← active roster `player_snapshot` (1:1).
12. `clean-twp-sides.ts --apply` — **LAST of the TWP set**: every TWP snapshot own-side only + rebake twp_ markets.

## Phase 3 — Active build + notes recipe (handoff §10)
13. `set-active-builds.ts --apply` — ⚠ **CONFIRM EACH PROGRAM'S LIVE BUILD WITH TREVOR
    FIRST** (prod activity ≠ staging). Exactly one active build per team.
14. `backfill-target-notes-from-roster.ts --apply` — mirror rostered-target notes ← active roster notes.
15. `backfill-rostered-target-consistency.ts --apply` — **RE-RUN** now that all programs have an active build.

## Phase 4 — Neutral + self-heal (handoff §11)
16. `backfill-neutral-snapshot.ts --prod --apply` — populate `neutral_snapshot` on every
    build/target row from the gatekept neutral (own-side for TWP). Needs Phase 0 #3.
17. `heal-stale-snapshots.ts --prod --all --apply` — re-derive `snapshot = f(neutral,notes)`
    for any drift. Dry-run first; confirm the count + spot-check Flukey/Kenny/Farley. (Prod
    `--apply` needs `RSTR_AUTOMATION_TOKEN` or `--yes`.)

## Phase 5 — Verify (must be 0)
18. `verify-all.ts` (prod env) → **0 issues across all programs**.
19. `audit-georgia.ts` (prod env) → **0 inconsistencies**.
20. Full-row consistency spot check → snapshot == f(neutral,notes).

## Phase 6 — Enable the self-heal sweep (ONLY after Phase 4)
21. Follow `docs/SELF_HEAL_SWEEP.md`: dry-run on prod, one manual `--apply`, then
    `launchctl load` the plist. Do **not** enable before #16 (needs stored neutrals).

---

## Merge sequence (Trevor drives)
1. Merge PR #157 (feature → **staging**).
2. Open + merge staging → **main** (`gh pr create`, Trevor clicks).
3. Run Phases 0–5 against prod (this doc).
4. Enable the sweep (Phase 6).
