# RSTR IQ Dev Agent — Plan

> Status: **planned, not built.** A design doc for an upcoming dev-side tool.
> Authored 2026-07-17 out of the failure modes hit during the GM / Front Office launch.

## 1. What it is

A **command-line agent that cross-checks code + Supabase state before and after we make changes.** It's the automated version of the ad-hoc verification we run by hand — migration audits, schema-cache probes, data-consistency checks, RLS audits. Invoke it around risky operations (before a push, before a prod migration, after a deploy) and it reports what's *actually* true vs. what the tooling *claims*.

Two layers:

- **Deterministic check library** — scripts that query the DB catalog + code and return pass/fail facts.
- **Agent layer** — a Claude Code subagent that runs the relevant checks for a given change, interprets results, and writes a plain-English report (e.g. "gm_contract never actually created on prod; here's the fix").

## 2. Why — every check traces to a real bug

| Failure we hit | What the agent catches |
|---|---|
| `gm_contracts.sql` reported `exec_sql OK` but silently rolled back (storage step) — the table never existed on prod | Verify objects exist via the **catalog** (`to_regclass`, DDL probe), never trust `exec_sql OK` or PostgREST reads |
| PostgREST returned "✓ table ok" for a table that didn't exist (stale schema cache) | Authoritative catalog checks, not `.from().select()` |
| Remove-access silently deleted 0 rows (RLS blocked it, no error) | **RLS coverage audit** — every table has policies for its intended write actors |
| Vendor allocations could double-count against contracts | **Money / consistency invariants** (allocations ↔ contracts, budget = Σ parts) |
| Migrations applied on staging but not prod; column-shape drift | **staging ⇄ prod drift** diff |
| Willing/committed totals counting non-committed players | **Business-rule assertions** on derived numbers |

## 3. Where it lives / how it's invoked

- A `scripts/agent/` folder in the repo + a thin CLI: `npm run rstr-check -- <command>`.
- Reuses the existing `scripts/_run_sql_file.ts` / service-client pattern and both `.env.local` (staging) + `.env.production.local` (prod).
- Agent mode = a Claude Code **custom subagent** (`agentType: rstr-check`) whose system prompt encodes the hard-won rules ("never trust `exec_sql OK`; verify via catalog; a PostgREST read is not proof a table exists"), with these scripts as its toolkit.

## 4. Check catalog

### A. Migration integrity
- Every `CREATE TABLE` / `ADD COLUMN` in the branch's migrations exists on the target DB (catalog, per-object) — the audit that caught gm_contract.
- Flag migrations containing owner-restricted ops (`storage.*`, `GRANT`, `ALTER ... OWNER`, `CREATE EXTENSION`) that will roll back the whole file through `exec_sql` → "run this part in the dashboard."
- Additivity check before prod: no `DROP TABLE/COLUMN`, `ALTER COLUMN`, `DELETE FROM`, `SET NOT NULL`.

### B. Schema / RLS
- RLS enabled + at least one policy on every app table.
- **Write-path coverage:** for each table + intended actor (superadmin / team_admin / member), is there an `INSERT/UPDATE/DELETE` policy? (Would have flagged the remove-access bug before it shipped.)
- Recursion check: policies that self-reference their table without a `SECURITY DEFINER` helper.

### C. staging ⇄ prod drift
- Diff tables / columns / policies / indexes between the two DBs; list what's on staging but not prod (migration backlog) and vice-versa.

### D. Data consistency (business invariants)
- Vendor allocations vs contracts (no double-count; orphan vendors; sources with no `vendor_id`).
- Budget math: `gm_budget` caps = base + Σ derived; recruiting committed money/scholarship only from committed/signed recruits.
- Active-build integrity: exactly one `is_active` per customer team.

### E. Code ↔ data
- Columns the app selects actually exist in the target DB's PostgREST cache (catches the "page read errors on a missing column" class — the funding-page failure).
- Stored-vs-live parity hooks (ties to the existing `src/lib/storedVsLive.test.ts`).

## 5. Output

- Human report (terminal + optional markdown file): ✅/❌ per check, with the failing object and a suggested fix.
- Non-zero exit on failures so it can gate a pre-push hook or CI later.
- Flags: `--target staging|prod`, `--scope migrations|rls|drift|data|all`, `--branch <name>`.

## 6. Phasing

- **Phase 1 (MVP):** Migration integrity + staging⇄prod drift + RLS coverage. Highest ROI — these are the ones that bit us. Deterministic scripts only.
- **Phase 2:** Data-consistency invariants (money, active build, recruiting) + the agent / report layer.
- **Phase 3:** Wire into the workflow — pre-push check on migration-touching branches, a "pre-prod-migrate" gate, post-deploy smoke.

## 7. Open questions

1. **Invocation:** a plain CLI run manually, or auto-gated (pre-push git hook / CI on the PR)? Recommend starting manual.
2. **Prod access:** the agent needs the prod service key for read-only catalog checks (same `.env.production.local` used today). Keep it read-only-by-convention, or mint a separate read-only key?
3. **Scope of "cross-check changes":** schema + DB-state only (recommended for Phase 1), or also *diff-aware* (read the git diff and reason "this migration adds X; is X consistent with the code that reads it")?
4. **Report destination:** terminal only, or also drop a dated report file / post to the PR?

## Guardrails the agent must encode (lessons from this session)

- `exec_sql` runs each migration file as **one transaction** — any failed statement rolls back the whole file (incl. its `CREATE TABLE`). Success of the runner is **not** proof the objects exist.
- A PostgREST/`.from().select()` read can be a **stale-cache false positive** — use `to_regclass` / a DDL probe (`COMMENT ON TABLE …` errors if absent) for authoritative existence.
- A Supabase write filtered by RLS returns **success with 0 rows affected**, no error — always `.select()` the affected rows when correctness matters.
- Storage (`storage.objects` / `storage.buckets`) and other owner-restricted DDL can't run via the service-role runner — those go through the dashboard.
