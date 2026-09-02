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
  rebuild-twp-target-rows, fix-returner-twp-hitter-market, clean-twp-sides 🗑️DELETED-2026-08-31,
  backfill-target-transfer-snapshots — add a `--prod` env swap before running.

---

## Phase 0 — Schema migrations (SAFE to pre-apply before the deploy)
**Verified 2026-07-27 against prod:** missing = `target_board.production_notes`,
`target_board.position_slot`, `target_board.neutral_snapshot`, `team_build_players.neutral_snapshot`.
(`target_board.transfer_snapshot`, `team_build_players.player_snapshot`/`production_notes` already exist.)
**Safe to run BEFORE the main merge:** columns are additive; the unique-constraint swap is safe
because current prod code (`origin/main` useTargetBoard) uses `.insert()`, NOT `.upsert(onConflict)`,
so no ON CONFLICT clause references the dropped constraints, and the new slot-aware index still
dedupes its null-slot inserts. Paste this block (Supabase SQL editor → PROD):
```sql
-- target_board.production_notes (added ad-hoc on staging 2026-07-22; no migration file)
ALTER TABLE public.target_board ADD COLUMN IF NOT EXISTS production_notes jsonb;

-- TWP two-row (migration 20260724120000): position_slot + slot-aware uniqueness
ALTER TABLE public.target_board ADD COLUMN IF NOT EXISTS position_slot text;
DO $$ DECLARE cname text; BEGIN
  FOR cname IN SELECT conname FROM pg_constraint
    WHERE conrelid='public.target_board'::regclass AND contype='u'
  LOOP EXECUTE format('ALTER TABLE public.target_board DROP CONSTRAINT IF EXISTS %I', cname); END LOOP;
END $$;
DROP INDEX IF EXISTS public.target_board_user_team_player_slot_uidx;
CREATE UNIQUE INDEX target_board_user_team_player_slot_uidx
  ON public.target_board (user_id, customer_team_id, player_id, coalesce(position_slot, ''));

-- neutral_snapshot (migration 20260724130000)
ALTER TABLE public.team_build_players ADD COLUMN IF NOT EXISTS neutral_snapshot jsonb;
ALTER TABLE public.target_board        ADD COLUMN IF NOT EXISTS neutral_snapshot jsonb;

NOTIFY pgrst, 'reload schema';
```
Verify: re-run the 4 column probes → all exist.

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
12. `clean-twp-sides.ts 🗑️ DELETED 2026-08-31 --apply` — **LAST of the TWP set**: every TWP snapshot own-side only + rebake twp_ markets.

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
18. `verify-all.ts` (prod env) → **0 issues across all programs**. Now includes **§5 no-zeroed-markets**
    (roster + target, both sides) — a green run *guarantees* no positive-WAR player is stuck at $0
    market (the Cespedes class). If §5 flags anything, re-run the heal (#17) — it auto-fixes the zeroed case.
19. `audit-georgia.ts` (prod env) → **0 inconsistencies**.
20. Full-row consistency spot check → snapshot == f(neutral,notes).
- **Note:** the neutral backfill (#16) now carries the pitcher `market_value`, so the live toggle
  recompute passes the market-eligibility gate on prod too (no $0 on a rostered transfer). This was a
  staging-only bug (prod's predictionMap fallback already had market_value) — but run the FIXED backfill.

## Phase 6 — Enable the self-heal sweep (ONLY after Phase 4)
21. Follow `docs/SELF_HEAL_SWEEP.md`: dry-run on prod, one manual `--apply`, then
    `launchctl load` the plist. Do **not** enable before #16 (needs stored neutrals).

---

## Merge sequence (Trevor drives)
1. Merge PR #157 (feature → **staging**).
2. Open + merge staging → **main** (`gh pr create`, Trevor clicks).
3. Run Phases 0–5 against prod (this doc).
4. Enable the sweep (Phase 6).
