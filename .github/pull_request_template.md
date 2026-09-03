<!--
These four questions are not ceremony. Each one is here because skipping it cost real time or shipped
a wrong number. Delete any section that genuinely does not apply — but delete it deliberately, not
because it was faster to leave blank.
-->

## What changed, and why

<!-- One or two sentences. What a reviewer needs before reading the diff. -->

## Which database?

<!--
STAGING · PROD · BOTH · none.

⚠ Gate B: prod ran a DIFFERENT wRC+ equation for weeks because a legacy table existed there and not
on staging. Same code, two databases, two answers. On 2026-09-02 it repeated — an RLS finding
measured on staging was reported as a prod security hole that never existed.

⚠ `npm run agent:rls` DEFAULTS TO STAGING. Vercel previews read PROD. Local dev reads STAGING.
⚠ Staging is NOT a faithful rehearsal: no season-2026 rows, 14 fewer indexes, one user and they are
   a superadmin (who satisfies every RLS policy and therefore cannot test one).
-->

## What did you NOT check?

<!--
Answer this even when the answer is "nothing" — say that explicitly.

Split FIXED / DETECTED / UNVERIFIED. A hypothesis wearing the clothes of a finding is how six false
alarms reached a reviewer on the agent branch. "Tests pass" is not the same as "this is correct".
-->

## Which check covers this?

<!--
Tick what you ran. If nothing covers the change, say so — that is useful information, not a failure.

- [ ] `npm test` — 305 tests incl. the ANCHOR SUITE (25 real prod players). Runs in CI automatically.
- [ ] `npm run agent:toggles` — ★ §4's #1 hard stop. Drives the real UI: toggles move the right
      stats, leave rates alone where they should, restore exactly, and the ON-SCREEN value is
      compared to the STORED snapshot. Run this for anything touching Team Builder, a projection,
      or a read path.
- [ ] `npm run agent:drift` — migrations vs the actual catalogs, BOTH databases. Run before a prod
      push and after applying a migration.
- [ ] `npm run agent:rls [--prod]` — RLS per table and actor. Run for auth, roles, or a new table.
- [ ] `npm run agent:rls-test-coach` — proves the team boundary as a NON-superadmin.
- [ ] `npm run agent:stat-map` — read-path scan. Runs in CI automatically (delta-vs-base).
- [ ] Nothing covers this. Explain why, and whether it should.
-->

---

<details>
<summary>Before merging — the traps that have actually bitten</summary>

- **Read a table's unique constraints before aggregating over it.** `player_predictions` is keyed on
  **five** columns *including `season`*. Grouping without one invents duplicates that do not exist —
  it nearly produced a recommendation to delete 7,255 legitimate rows.
- **Prove two things are comparable before diffing them.** Same generation (`updated_at`), same side
  (a two-way player carries BOTH on one row), same field name (`market_value` is `nil_valuation` on
  board snapshots), same metric (Team Builder shows pRV+ for pitchers; the profile shows PR+).
- **D1 is the consistency boundary.** JUCO is `NJCAA_D1`, is knowingly stale, and drags any
  cross-division measurement to a meaningless middle.
- **Never compute a user-facing number** — read `player_snapshot ?? transfer_snapshot`. Never
  `p.prediction`.
- **A DB check verifies the DATABASE.** Read-path bugs only appear in the UI. Triage: wrong in the
  DB, or only on SCREEN?
- **Prod writes need an explicit "prod, now?".** Trevor merges to `main`.

Full reasoning: `docs/PHILOSOPHY.md` §17 · `docs/knowledge/` · `CLAUDE.md`

</details>
