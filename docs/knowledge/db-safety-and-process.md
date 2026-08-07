# Knowledge — DB Safety & Process

> Originally a bootstrap draft, 2026-07-20, drafted by the agent from session memory and the GM
> launch. Records marked `confirmed` have been through the react-and-correct loop with Trevor.

> **The most recent conversation is the truth.** These records are point-in-time. Processes change,
> and a record can be correctly confirmed and later superseded — or can have captured a
> misinterpretation that only surfaced when it was applied. When a record and a recent conversation
> disagree, the conversation wins; update the record and note what it supersedes rather than leaving
> both standing. `confirmed` means "confirmed when written," not "still true."
>
> *(Principle added 2026-08-07, after two records were found stale: the merge rule had been
> broadened and a prod-connection claim was an agent inference that never matched Trevor's process.)*

---

### verify-target-db: Confirm which database before any change
- **Rule:** Before any DB write, confirm the target — staging (`.env.local`) vs prod (`.env.production.local`) — and state it out loud.
- **Why / protecting against:** Changes landing on the wrong database. The single easiest catastrophic mistake; cheap to prevent by naming the target every time.
- **Scope:** Every migration, SQL run, import, backfill, precompute.
- **Supersedes:** —
- **Origin:** Design conversation 2026-07-18.
- **Status:** confirmed

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
- **Status:** confirmed

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

### trevor-clicks-merges: Trevor clicks the final merge on every PR
- **Rule:** The agent preps every PR up to mergeable/green (conflicts resolved, checks passing) and hands it off — **Trevor clicks merge.** Applies to ALL merges, feature→staging and staging→main alike, not just prod. Don't merge a PR unless Trevor explicitly says merge it now.
- **Why / protecting against:** **Not a permission lock — a verification step.** The Vercel PR preview runs on the PROD database, so clicking merge is the moment Trevor has actually loaded the pages and confirmed they work against real user data before anything reaches prod and breaks something. The click is where that check happens; treating it as an approval gate misses the point of it.
- **Scope:** All PR merges. The agent preps and hands off; it does not enforce this against Trevor or narrate it as a blocker.
- **Supersedes:** the prod-only "trevor-drives-prod-merge" version.
- **Origin:** 2026-07-17 (agent merged #153) + broadened by Trevor 2026-07-20 ("I prefer to make the click on everything") + reason clarified 2026-08-07.
- **Status:** confirmed

### write-execution-is-per-task: Talked through first; either party can run it
- **Rule:** The gate on a DB write is that it was **talked through first** — not who executes it. After that, execution is assigned per task: Trevor pastes some, the agent runs others. Bigger multi-statement work tends to go to the agent, since hand-pasting a long migration is the more error-prone path. Applies to staging and prod alike.
- **Why / protecting against:** An earlier version of this rule said every write, always, comes to Trevor as raw SQL to paste, with prod additionally requiring a specific confirmation phrase. That was stricter than the actual process and got the risk backwards — it pushed the largest, most failure-prone migrations into the least reliable execution path.
- **Scope:** All DB writes, both databases.
- **How it interacts with MCP:** MCP stays `read_only=true` on both servers. When the agent executes a write it goes through the repo's scripted migration path, not MCP — because `migration-ritual` and `catalog-not-postgrest` live there. An MCP write would return a bare success with no catalog verification, which is the `exec_sql OK` trap that lost `gm_contract` on prod.
- **Supersedes:** the absolute "all writes come to Trevor as raw SQL to paste" phrasing, and the "prod writes require the literal phrase *prod, now?*" phrasing.
- **Origin:** 2026-08-07 (Trevor: "sometimes I run them, sometimes for bigger stuff you run it — we have done both").
- **Status:** confirmed

### migration-ritual: Dry-run → apply → verify-after → brief the operator
- **Rule:** Run migrations as a ritual: (1) verify target DB, (2) dry-run/apply-check first, (3) run for real, (4) **verify the objects/effects actually exist afterward via the catalog**, (5) brief + question the operator through it. When many migrations run at once, each one still gets checked — don't assume a batch worked.
- **Why / protecting against:** The gm_contract failure — a migration reported OK, silently rolled back, and nobody re-checked or tested the usage before pushing. Batches are where individual failures hide.
- **Scope:** All migrations, staging and prod.
- **Origin:** 2026-07-17 GM launch (gm_contract never created on prod).
- **Status:** confirmed

### exec-sql-one-txn: `exec_sql` runner success ≠ objects exist
- **Rule:** `exec_sql` runs each migration file as ONE transaction — any failed statement rolls back the whole file, including its `CREATE TABLE`. "exec_sql OK" is not proof the objects exist. Verify via the catalog.
- **Why / protecting against:** A storage-policy failure at the end of `gm_contracts.sql` rolled back the table creation every time; the runner still looked fine.
- **Scope:** Anything run through `scripts/_run_sql_file.ts` / `exec_sql`.
- **Origin:** 2026-07-17.
- **Status:** confirmed

### catalog-not-postgrest: Verify existence via the catalog, not a PostgREST read
- **Rule:** To prove a table/column exists, use the Postgres catalog (`to_regclass`, or a DDL probe like `COMMENT ON TABLE …` which errors if absent). A `.from().select()` read can be a **stale-cache false positive**.
- **Why / protecting against:** PostgREST reported "✓ table ok" for `gm_contract` when it did not physically exist — the schema cache lied.
- **Scope:** Any existence/shape verification.
- **Origin:** 2026-07-17.
- **Status:** confirmed

### rls-writes-return-zero: An RLS-blocked write succeeds with 0 rows
- **Rule:** A Supabase write filtered by RLS returns **success with 0 rows affected and no error**. When correctness matters, `.select()` the affected rows and treat an empty result as failure.
- **Why / protecting against:** The admin remove-access bug — a delete blocked by RLS returned no error, so the UI falsely reported "removed."
- **Scope:** Any write where "did it actually happen" matters (deletes, role changes, removals).
- **Origin:** 2026-07-17 (team-admin remove-access fix).
- **Status:** confirmed

### tenant-isolation: Every program's data is walled off from every other program
- **Rule:** Every table holding program data has RLS enabled, with **write** policies scoped tight to the right actors (superadmin / team_admin / member) and **read** policies tenant-scoped so a program can only ever see its *own* data. Reference/lookup tables (D1 teams, conference stats, park factors, scouting constants) still have RLS *on* — typically read-open-to-authenticated, no writes. The agent maintains a **living, verified analysis** of read/write access per table per actor.
- **Why / protecting against:** **13 users = 13 separate college programs**, each holding highly sensitive competitive data — contracts, financial planning, target boards, team builds, and soon program-local player development + program-specific recomputes. One program seeing another's contracts or targets is **existential**: competitive damage and a broken trust promise, not a minor bug. Also guards the silent-access-failure class (remove-access bug).
- **Scope:** All app tables. Program data = tenant-locked; reference data = read-open, RLS still on.
- **Supersedes:** old "rls-everywhere" record.
- **Origin:** Design conversation 2026-07-18 + remove-access bug; stakes framed by Trevor 2026-07-20.
- **Status:** confirmed. Coverage **audited 2026-07-20** → `rls-audit.md` (RLS on all 75 tables; one open-read finding on `player_predictions`). Re-audit on schema changes.

### program-owns-uploaded-data: Uploaded program data belongs to the program and does NOT follow a transferring player
- **Rule:** Anything a program uploads or creates about a player — **player development, NewtForce assessments, program-local evaluations, program-specific recomputes** — is **owned by that program** and tenant-locked to it. It does **not** travel with the player. If a player transfers Arkansas → Georgia, Georgia's staff cannot see Arkansas's uploaded data on that player; Arkansas keeps it.
- **Why / protecting against:** A program's proprietary development work leaking to a competitor via player transfer. Arkansas invests in developing a player; Georgia must never inherit that work. Player-transfer is the exact leak vector, and it's non-obvious because we instinctively think of it as "the player's data."
- **Scope:** All program-uploaded / program-created player data (player dev, NewtForce, program-local evals + recomputes). NOT shared reference/model data. **Forward-looking — bake into the RLS from day one of the player-development build.**
- **Supersedes:** —
- **Origin:** Trevor 2026-07-20 (note for the player-development build).
- **Status:** confirmed (forward rule)

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
- **Status:** confirmed

### send-sql-to-paste: Hand data-fixes go as SQL to paste, not scripts I run
- **Rule:** For one-off/hand data fixes on Supabase, give Trevor the raw SQL to paste into the editor rather than a TS script the agent runs. (The migration/verification *runner* scripts are fine.)
- **Why / protecting against:** Keeps Trevor in control of hand mutations; he runs them himself.
- **Scope:** Ad-hoc data fixes (not migrations).
- **Origin:** Standing rule (memory: send-sql-to-paste).
- **Status:** confirmed

### check-schema-before-sql: Read the captured schema before writing SQL
- **Rule:** Before writing SQL against a table, check its captured schema (`reference_schema_<table>` / the schemas index). Don't guess columns.
- **Why / protecting against:** Wrong column names / wrong assumptions (e.g. `team_build_players.build_id` not `team_build_id`, which cost a whole investigation loop this session).
- **Scope:** Any hand-written SQL.
- **Origin:** Standing rule + the build_id mixup 2026-07-17.
- **Status:** confirmed

### verify-gate-blind-to-reference-errors: `tsc --noEmit` is a NO-OP; the build gate can't see component crashes
- **Rule:** The standing verify command `./node_modules/.bin/tsc --noEmit` type-checks **ZERO files** and always "passes." Root `tsconfig.json` has `files:[]` + project references, and plain `tsc --noEmit` does not traverse references (that needs `tsc -b`). `vite build` uses esbuild (transpile-only, no type errors) and `npm test` runs only unit tests. So **none of the three catch an undefined identifier / bad type in a page or component** — that class of bug only surfaces by loading the page in the browser. The real type check is `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit`, but the app carries ~198 pre-existing errors, so you can't gate on "zero." To check a file you edited: run that and `grep '<File>.tsx'`, confirming no NEW error line vs the base branch.
- **Why / protecting against:** This exact gap shipped a runtime crash. Deleting a `const classTransition` in ReturningPlayers left one live reference (`class_transition: classTransition` in the row object); tsc/vite/tests all passed green, but the pitcher dashboard threw "classTransition is not defined" on load. The `tsc -p tsconfig.app.json` check *did* flag it (TS2552) — it was just never run. The lesson: **green build ≠ it runs.** For any page/component change, load it locally (or exercise the exact affected view) before calling it verified. Mirrors the DB rule "`exec_sql` OK ≠ objects exist, verify the real thing."
- **Scope:** Every code change to a page/component/hook. Especially dead-code deletion (check ALL references of a removed symbol) and anything not covered by a unit test.
- **Origin:** 2026-07-21, the live-pERA cleanup — I introduced and then caught a reference-error crash the build gate missed. CLAUDE.md verify guidance corrected in the same pass.
- **Status:** confirmed
