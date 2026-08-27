# AGENT LEARNINGS — executing the war-recalibration PROD push (2026-08-26/27)

Reusable lessons from running the push live against prod (`trbvxuoliwrfowibatkm`). Pair with the runbook
(`docs/PROD_PUSH_STEPS_2026_08_26.md`), the resume handoff (`docs/PROD_PUSH_HANDOFF_RESUME_2026_08_26.md`), and the
live ledger (`PROD_MIGRATIONS_TODO.md`).

## ★ THE #1 PATTERN — the runbook has ad-hoc gaps; reconstruct from staging, COMMIT, then apply
Several runbook steps reference ALTERs / backfills / helper tables that were done **by hand on staging with NO
committed migration or script**. When you hit one, DO NOT improvise blind and DO NOT skip:
1. Diff **staging** (the verified reference) against **prod** — column lists via `select * limit 1` → `Object.keys`;
   types via a temp `information_schema.columns` fn on staging (staging writes are OK).
2. Generate the exact DDL/SQL/script matching staging.
3. **Commit it** (close the gap permanently) → apply to prod → verify.
Already reconstructed + committed this way: `20260826160000_war_recalibration_gap_alters.sql` (A8 ConfStats
run_env_factor/hitter_talent_plus, A9 Park 10×`*_seasonal`, A11 pitcher `ip`); `20260826160500_masters_source_season_unique.sql`
(A11 Masters UNIQUE); `scripts/sql/fix_pitcher_full_names.sql` (C19); `scripts/backfill_park_code_load.ts` rewritten
prod-capable (C20). **Expect MORE in C21–C29 + beyond** (staging-hardcoded scripts, missing UPDATE-SQL, missing helper tables).

## ★ MECHANISMS (verified live)
- **Raise statement_timeout through `exec_sql`:** prepend `set local statement_timeout='900s';` to the SQL. CONFIRMED
  it overrides PostgREST's ~8s default (`pg_sleep(12)` completed under a `SET LOCAL 30s`). Use for every big UPDATE.
- **Gateway HTTP timeout ≠ rollback.** A long `exec_sql` call returns `upstream request timeout` to the client at ~125s,
  but the **DB transaction keeps running and COMMITS server-side** (single-statement txn = all-or-nothing). Always
  **verify with a separate read** after — don't assume failure. (C19's UPDATE looked "failed" but committed table-wide.)
- **Big UPDATEs: filter `is distinct from` in a SINGLE pass, never a scan-to-find + LIMIT batch loop.** The batched
  `... where col is distinct from correct limit N` approach re-scans the whole table each batch and TIMES OUT when few/no
  rows remain (worst case = an already-fixed table). A single `UPDATE … WHERE is distinct from …` (one pass, join on the
  PK/indexed key) is correct + idempotent (re-run = 0 rows).
- **Dup checks: paginate with a STABLE UNIQUE order (`id`).** `.range()` ordered by a non-unique column (or no order)
  repeats/skips rows at page boundaries → FALSE dups (A11 first showed 5/7 phantom dups; id-ordered scan showed 0).
- **PostgREST count() times out on huge tables** (pitch_log 2.5M). Use `count:"estimated"` (reltuples, instant) or an
  early-stop `.limit()` presence check; for an exact count on a filtered subset, have the operator run it in the SQL
  editor or use a temp fn with a raised local timeout.
- **PostgREST schema-cache staleness:** after `create table`/`function` via exec_sql, `NOTIFY pgrst,'reload schema'` +
  wait ~2.5s before `.from()`/`.rpc()` the new object. A "could not find table in schema cache" error ≠ the object is missing.
- **Staging-hardcoded scripts:** several backfill scripts hardcode the staging URL + read `.env.local`. Rewrite them
  env-driven with a `--prod` guard (`if IS_PROD ⟺ prod URL`) before running on prod.

## ★ VERIFIED-CLEAN prod facts (so we don't re-check)
- pitch_log is CURRENT (date range 2026-02-13→06-22 = full season, same as staging) + raw columns (velocity/ivb/hb/
  exit_velo/launch_angle/pitch_type/cs_prob) identical to staging. **No ingest needed.**
- Defensive data present + current (`player_season_defense` 13,454 / `player_season_baserunning` 10,432, engine 0.11.0;
  DRS CSVs in `scripts/drs/output/`). **No defensive/positioning upload needed** — Phase C/D only regenerate.
- model_config = **220 keys** on prod = staging (201 step8 seed + 19 calibration; the runbook's "201" was the seed count).
- pitcher_id in pitch_log = players.source_player_id (join key for the name fix).

## ★ SAFETY POSTURE
Displays pure-read stored predictions → prod shows OLD consistent numbers until Phase E recomputes; nothing half-broken.
Every prod write: dry-run/understand → "prod, now?" → apply → log the row in `PROD_MIGRATIONS_TODO.md` before moving on.
