# Knowledge — DB Safety & Process

> Bootstrap draft, 2026-07-20. Drafted by the agent from session memory + the GM launch. **Trevor: react/correct — every record is `draft` until you confirm.**

---

### verify-target-db: Confirm which database before any change
- **Rule:** Before any DB write, confirm the target — staging (`.env.local`) vs prod (`.env.production.local`) — and state it out loud.
- **Why / protecting against:** Changes landing on the wrong database. The single easiest catastrophic mistake; cheap to prevent by naming the target every time.
- **Scope:** Every migration, SQL run, import, backfill, precompute.
- **Supersedes:** —
- **Origin:** Design conversation 2026-07-18.
- **Status:** draft

### branch-flow: main → staging → feature, and back up through two PRs
- **Rule:** Every change starts from a clean lineage — branch `main → staging → feature`. Work on the feature branch, then open a **feature→staging PR** (the test step), merge to staging, then a **staging→main PR** (usually clean by then) to ship code to prod.
- **Why / protecting against:** Drift and untested changes. The two-PR path means nothing reaches prod without passing through staging and a review point, and the lineage keeps everything clean.
- **Scope:** All app changes (code, migrations, RLS). Everyone follows it. Lead-discretion exception → see `lead-discretion`.
- **Supersedes:** the old "always open a PR, even for staging" phrasing.
- **Origin:** Standing rules + process walkthrough 2026-07-20.
- **Status:** confirmed

### prod-confirmation: Explicit "prod, now?" before prod writes
- **Rule:** Never write to prod on an ambiguous go-ahead. Get an explicit confirmation ("prod, now?") first. Approval in one context doesn't carry to the next.
- **Why / protecting against:** Accidental prod writes from a vague "yes." Prod is irreversible-ish; the confirmation is the last gate.
- **Scope:** All prod DB writes.
- **Supersedes:** —
- **Origin:** Standing rule (memory: explicit-prod-confirmation).
- **Status:** draft

### pr-preview-is-prod-db: The feature→staging PR preview runs on the PROD database
- **Rule:** The Vercel PR preview is wired to the **prod** database (local dev uses staging). So the feature→staging PR *is* the real test environment — it shows actual user impact on real data. Test thoroughly there before merging.
- **Why / protecting against:** It's the only place a change is seen against real users before it ships — and it's what forces the migration timing below.
- **Scope:** Every feature→staging PR.
- **Supersedes:** —
- **Origin:** Process walkthrough 2026-07-20 (memory: preview-verification-loop).
- **Status:** confirmed

### lead-discretion: The process binds everyone; the lead can make organizational exceptions
- **Rule:** The full branch+PR flow applies to everyone. Trevor, as project lead, can make deliberate exceptions for organizational reasons (e.g. committing a planning doc straight to staging so an idea isn't lost, rather than spinning up a feature branch that gets lost). Others shouldn't make a habit of it.
- **Why / protecting against:** Keeps the process clean for the team while letting the lead move pragmatically. A lead's exception is a decision, not a loophole for everyone.
- **Scope:** Process exceptions. The agent holds non-leads to the full process and flags when an exception is being taken.
- **Supersedes:** —
- **Origin:** 2026-07-20 (Trevor committing the URL-migration doc straight to staging).
- **Status:** confirmed

### trevor-drives-prod-merge: Trevor clicks the final prod merge
- **Rule:** The agent preps the staging→main PR up to mergeable/green, then hands it to Trevor to click merge. Don't merge a `--base main` PR unless Trevor says merge it now. Merging feature→staging is fine for the agent to do.
- **Why / protecting against:** The prod deploy is Trevor's call to pull the trigger on.
- **Scope:** staging→main (production) merges.
- **Origin:** 2026-07-17 (agent merged #153; Trevor meant to click it himself).
- **Status:** draft

### migration-ritual: Dry-run → apply → verify-after → brief the operator
- **Rule:** Run migrations as a ritual: (1) verify target DB, (2) dry-run/apply-check first, (3) run for real, (4) **verify the objects/effects actually exist afterward via the catalog**, (5) brief + question the operator through it. When many migrations run at once, each one still gets checked — don't assume a batch worked.
- **Why / protecting against:** The gm_contract failure — a migration reported OK, silently rolled back, and nobody re-checked or tested the usage before pushing. Batches are where individual failures hide.
- **Scope:** All migrations, staging and prod.
- **Origin:** 2026-07-17 GM launch (gm_contract never created on prod).
- **Status:** draft

### exec-sql-one-txn: `exec_sql` runner success ≠ objects exist
- **Rule:** `exec_sql` runs each migration file as ONE transaction — any failed statement rolls back the whole file, including its `CREATE TABLE`. "exec_sql OK" is not proof the objects exist. Verify via the catalog.
- **Why / protecting against:** A storage-policy failure at the end of `gm_contracts.sql` rolled back the table creation every time; the runner still looked fine.
- **Scope:** Anything run through `scripts/_run_sql_file.ts` / `exec_sql`.
- **Origin:** 2026-07-17.
- **Status:** draft

### catalog-not-postgrest: Verify existence via the catalog, not a PostgREST read
- **Rule:** To prove a table/column exists, use the Postgres catalog (`to_regclass`, or a DDL probe like `COMMENT ON TABLE …` which errors if absent). A `.from().select()` read can be a **stale-cache false positive**.
- **Why / protecting against:** PostgREST reported "✓ table ok" for `gm_contract` when it did not physically exist — the schema cache lied.
- **Scope:** Any existence/shape verification.
- **Origin:** 2026-07-17.
- **Status:** draft

### rls-writes-return-zero: An RLS-blocked write succeeds with 0 rows
- **Rule:** A Supabase write filtered by RLS returns **success with 0 rows affected and no error**. When correctness matters, `.select()` the affected rows and treat an empty result as failure.
- **Why / protecting against:** The admin remove-access bug — a delete blocked by RLS returned no error, so the UI falsely reported "removed."
- **Scope:** Any write where "did it actually happen" matters (deletes, role changes, removals).
- **Origin:** 2026-07-17 (team-admin remove-access fix).
- **Status:** draft

### rls-everywhere: RLS is part of everything
- **Rule:** All data tables have RLS enabled with policies covering the intended actors (superadmin / team_admin / member) for the writes they need. Maintain a living analysis of what each policy allows. Anything big is RLS.
- **Why / protecting against:** Silent access failures and tenancy leaks. RLS gaps are invisible until someone can't do their job (or can do too much).
- **Scope:** All app tables.
- **Origin:** Design conversation 2026-07-18 + the remove-access bug.
- **Status:** draft

### migration-timing: Migrations hit prod BEFORE the PR — additive freely, destructive with urgency
- **Rule:** Because the PR preview reads the prod DB, migrations must be applied to **prod before the PR/testing**.
  - **Additive** (`CREATE`/`ADD COLUMN IF NOT EXISTS`, guarded backfills): run before the PR, low worry — invisible to current users until the code ships.
  - **Destructive** (DROP/ALTER COLUMN/DELETE/SET NOT NULL) or **function changes**: **test as much as possible locally on the feature branch (against staging DB) first, then migrate and move quickly.** Real urgency — prod sits in a changed state ahead of the code that catches up to it, so minimize that window. Still before the PRs, but with a stopwatch running.
- **Why / protecting against:** Additive can't break current prod reads; destructive can break prod *right now*, before anything's merged. The danger is the gap between a destructive prod change and the code catching up.
- **Scope:** All prod migrations.
- **Supersedes:** old "additive-to-prod" record.
- **Origin:** Process walkthrough 2026-07-20.
- **Status:** confirmed

### storage-ddl-dashboard: Owner-restricted DDL goes through the dashboard
- **Rule:** `storage.objects` / `storage.buckets` policies and other owner-restricted DDL can't run via the service-role runner (`must be owner of table objects`). Split those out and run them in the Supabase dashboard SQL editor; run the table/RLS DDL via the runner.
- **Why / protecting against:** The storage step is exactly what rolled back `gm_contracts.sql`. Splitting it prevents the rollback.
- **Scope:** Migrations touching storage or other owner-restricted objects.
- **Origin:** 2026-07-17.
- **Status:** draft

### send-sql-to-paste: Hand data-fixes go as SQL to paste, not scripts I run
- **Rule:** For one-off/hand data fixes on Supabase, give Trevor the raw SQL to paste into the editor rather than a TS script the agent runs. (The migration/verification *runner* scripts are fine.)
- **Why / protecting against:** Keeps Trevor in control of hand mutations; he runs them himself.
- **Scope:** Ad-hoc data fixes (not migrations).
- **Origin:** Standing rule (memory: send-sql-to-paste).
- **Status:** draft

### check-schema-before-sql: Read the captured schema before writing SQL
- **Rule:** Before writing SQL against a table, check its captured schema (`reference_schema_<table>` / the schemas index). Don't guess columns.
- **Why / protecting against:** Wrong column names / wrong assumptions (e.g. `team_build_players.build_id` not `team_build_id`, which cost a whole investigation loop this session).
- **Scope:** Any hand-written SQL.
- **Origin:** Standing rule + the build_id mixup 2026-07-17.
- **Status:** draft
