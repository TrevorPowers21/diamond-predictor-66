# RSTR IQ Dev Agent — Plan

> Status: **planned, not built.** Design doc for a dev-side tool. We'll build it on this branch (`docs/rstr-agent-plan`).
> Authored 2026-07-17; reframed 2026-07-18 around "a consistent voice across every change."

## 1. What it is

**A single, fully-informed voice that reviews every change we make against everything RSTR IQ knows about itself — so the system stays coherent as it grows.**

It's the thing that holds the whole picture in its head at once — the code, both databases, the domain rules, and the *why* behind past decisions — so no individual change quietly contradicts another. We invoke it around any meaningful change (before a push, before a prod migration, after a deploy) and it gives one grounded read: is this consistent with who we've decided RSTR IQ is?

The DB/schema verification is the **mechanical floor** — the hard, provable base it always checks. The higher value is that it speaks with *one voice, every time, with the full history loaded*, instead of us re-deriving context each session.

## 2. "All the information possible" — what it draws on

Every change is checked against the full body of knowledge:

- **The codebase** — conventions, shared utilities, the refactoring policy (don't fork math that lives in `src/lib`), naming, component patterns (`CurrencyInput`, etc.).
- **The schema + live data** — staging *and* prod, plus migration history.
- **The domain rules** — WAR / wRC+ / Stuff+ formulas, the budget model, projection math, the scouting framework, RBAC.
- **The decision history (the *why*)** — e.g. notes filed as reports not a column; vendors are canonical; Actual Pay only moves on finalize; committed totals count only committed/signed; "Willing" → "Agreed" on commit; team_admin manages their own team. Captured today only as ad-hoc memory.
- **The terminology** — the app says "Actual Pay," "Agreed," "Front Office," consistently.

## 3. "Consistent voice" — what it actually catches

Not just "does this table exist," but:

- **Contradiction** — "this change makes budget behave differently than the rule we set weeks ago."
- **Drift** — "this new money input doesn't use `CurrencyInput`, so it'll have the caret bug we already fixed."
- **Duplication** — "this projection math already exists in `useTeamBuilderSimulation`; you're forking it."
- **Terminology** — "this reads 'Willing' but for committed recruits the rest of the app says 'Agreed.'"
- **Invariants** — the money / allocation / active-build / RLS checks (the mechanical floor below).
- **Cross-surface impact** — "changing this formula breaks the stored-vs-live precompute parity."

The floor is verifiable facts; this layer is judgment against the full context.

## 4. The mechanical floor — deterministic checks

Every check traces to a real bug from the GM launch. This is the provable base the voice stands on.

| Failure we hit | What it catches |
|---|---|
| `gm_contracts.sql` reported `exec_sql OK` but silently rolled back — table never existed on prod | Verify objects exist via the **catalog** (`to_regclass`, DDL probe), never trust `exec_sql OK` or PostgREST reads |
| PostgREST returned "✓ table ok" for a table that didn't exist (stale cache) | Authoritative catalog checks, not `.from().select()` |
| Remove-access silently deleted 0 rows (RLS blocked it, no error) | **RLS write-path coverage** — every table has policies for its intended actors |
| Vendor allocations could double-count against contracts | **Money / consistency invariants** |
| Migrations applied on staging but not prod; column drift | **staging ⇄ prod drift** diff |
| Committed totals counting non-committed recruits | **Business-rule assertions** on derived numbers |

**Check groups:**
- **Migration integrity** — every `CREATE TABLE`/`ADD COLUMN` in the branch exists on the target (catalog, per-object); flag owner-restricted ops (`storage.*`, `GRANT`, `ALTER OWNER`) that roll back the whole file through `exec_sql`; additivity gate before prod (no `DROP`/`ALTER COLUMN`/`DELETE`/`SET NOT NULL`).
- **Schema / RLS** — RLS enabled + a policy per table; write-path coverage per actor (superadmin / team_admin / member); self-referencing policies without a `SECURITY DEFINER` helper.
- **staging ⇄ prod drift** — diff tables/columns/policies/indexes; list what's on staging but not prod and vice-versa.
- **Data invariants** — allocations ↔ contracts (no double-count, no orphan vendors); budget = base + Σ derived; recruiting committed money/scholarship only from committed/signed; exactly one `is_active` build per team.
- **Code ↔ data** — columns the app selects exist in the target's PostgREST cache; stored-vs-live parity hooks (ties to `src/lib/storedVsLive.test.ts`).

## 5. Where it lives / how it's invoked

- A `scripts/agent/` folder + a thin CLI: `npm run rstr-check -- <command>`.
- Reuses the existing `scripts/_run_sql_file.ts` / service-client pattern and both `.env.local` (staging) + `.env.production.local` (prod), read-only for catalog checks.
- **Voice layer** = a Claude Code **custom subagent** (`agentType: rstr-check`) whose system prompt encodes the decision history + the hard-won rules (below), with the deterministic scripts as its toolkit. It reads the git diff, runs the relevant checks, and writes a plain-English report.

## 6. Output

- Human report (terminal + optional markdown file): the consistency read up top, then ✅/❌ per mechanical check with the failing object and a suggested fix.
- Non-zero exit on hard failures so it can gate a pre-push hook or CI later.
- Flags: `--target staging|prod`, `--scope migrations|rls|drift|data|voice|all`, `--branch <name>`.

## 7. Phasing

- **Phase 1 (MVP):** the mechanical floor — migration integrity + staging⇄prod drift + RLS coverage. Highest ROI; these are the ones that bit us. Deterministic scripts only.
- **Phase 2:** data invariants + the **voice layer** (diff-aware review against decision history, terminology, duplication, cross-surface impact).
- **Phase 3:** wire into the workflow — pre-push on migration-touching branches, a pre-prod-migrate gate, post-deploy smoke.

## 8. Open questions

1. **Invocation:** manual CLI, or auto-gated (pre-push git hook / CI on the PR)? Recommend starting manual.
2. **Prod access:** it needs the prod service key for read-only catalog checks (same `.env.production.local` used today). Keep it read-only-by-convention, or mint a separate read-only key?
3. **Where does the "decision history" live** so the voice layer can load it? Options: this repo's memory/docs, a structured decisions file, or a sync from the assistant's memory. This is the crux of "all the information possible" — the voice is only as good as the history it can read.
4. **Report destination:** terminal only, or also a dated report file / posted to the PR?

## Guardrails the agent must encode (lessons from the GM launch)

- `exec_sql` runs each migration file as **one transaction** — any failed statement rolls back the whole file (incl. its `CREATE TABLE`). Runner success is **not** proof the objects exist.
- A PostgREST / `.from().select()` read can be a **stale-cache false positive** — use `to_regclass` / a DDL probe (`COMMENT ON TABLE …` errors if absent) for authoritative existence.
- A Supabase write filtered by RLS returns **success with 0 rows affected**, no error — always `.select()` the affected rows when correctness matters.
- Storage (`storage.objects` / `storage.buckets`) and other owner-restricted DDL can't run via the service-role runner — those go through the dashboard.
