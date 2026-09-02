# RSTR IQ — Knowledge Base

This is the **repo-resident brain** for the RSTR IQ agent (see `../rstr-agent-plan.md`). It's the set of decisions, rules, and reasoning the agent loads so it can be a consistent voice across every change — and so anyone working through it makes changes the way we've decided to.

It is **portable on purpose**: plain markdown, no harness lock-in. Any agent/harness can read it.

## How this gets built and stays current

The **react-and-correct loop** (never authored from a blank page):

> The agent reads the code + git history → drafts the rule it infers → **Trevor reacts/corrects** → the correction becomes the record.

- **Bootstrap:** the agent drafts records domain-by-domain from the codebase, git history, and existing session memory. Trevor reviews and corrects. That's the starting knowledge base.
- **Ongoing:** every change runs the same loop — a new/updated record, with contradictions to prior records flagged for a `Supersedes`.

**Only Trevor confirms a new record or a supersede** (for now). Drafts are marked `status: draft` until he does.

## Two kinds of knowledge — captured differently

- **Judgment / decisions** — Trevor is the source of truth ("vendors are canonical," "Actual Pay only on finalize"). The agent records his word.
- **Factual / technical state** — RLS coverage, what a policy actually allows, whether a column exists, how a number is computed. The agent must **verify this against the code + database and record what's *true* — never word-of-mouth.** Trevor's recollection is a hypothesis to go check, not a fact to store. Records of this kind note *how* they were verified. (This is the lesson from PostgREST claiming a table existed when it didn't — trust the catalog, not the recollection or the cache.)

## Record format

Each rule is one record. Keep them tight.

```
### <slug>: <one-line rule>
- **Rule:** what to do / not do.
- **Why / protecting against:** the reasoning — especially the failure mode it guards. This is what lets the agent extrapolate the way Trevor would to new situations.
- **Scope:** where it applies (and where it doesn't).
- **Supersedes:** prior record(s) this replaces, or "—".
- **Origin:** the change/session/person it came from.
- **Status:** confirmed | draft
```

The `Why / protecting against` line is the load-bearing one. A rule with no "what it protects against" is just a preference; with it, the agent can reason about cases we never explicitly ruled on.

## Domains

One file per domain. Current set (will grow):

- `db-safety-and-process.md` — migrations, staging→prod flow, RLS, PR/merge discipline, the runner gotchas.
- `data-and-numbers.md` — the #1 rule: precompute/returner lines, no live calc, identical stat everywhere incl. toggles. **Plus WHERE THE CONSTANTS LIVE (2026-09-01):** `model_config` is the single source, the legacy `"Equation Weights"` table that silently overrode the code on prod (Gate B), `<stat>_pr_center` (ratings are NOT centred at 100), a key not in the `fields` mapping is INERT, calibration is D1-only/per-row, and "a column you do not SELECT cannot be written".
- `snapshots-and-recompute.md` — the neutral/player/transfer snapshot model, the derived-cascade conventions (whole-rv+ rounding, depth-role IP, position-owned market), and the full-recompute process. Toggles are sacred. **Plus THE READ/WRITE PATH (2026-09-01) — read this before touching any snapshot:** `p.prediction` is not a snapshot · a `??` chain is not a precedence decision · the three guardrails · the save bakes neutral × the toggle · every local write refreshes every copy · `exhaustive-deps` off means stale closures · rostered beats board · slot is authoritative for side · TWP own-side only · market is stored not derived · verify TYPES not just values · prove comparable before diffing.
- `eligibility-and-class.md` — `class_year` as source of truth, `class_transition` derivation, the stale-`SJ` bug + verified prod audit.
- `identity-and-recruits.md` — the crosswalk identity model (vendor-agnostic), add-must-store-a-real-player, confirm-don't-guess linking, rich program-owned recruit profiles. *(live draft — design in progress)*
- `money-and-budget.md` — Actual Pay/finalize, vendors, allocations↔contracts, committed-only totals. *(to draft)*
- `projections-and-scouting.md` — WAR/wRC+/Stuff+, JUCO baselines, risk framework, competition translation. *(to draft)*
- `access-and-tenancy.md` — RBAC, user_team_access, customer_teams, the active build. *(to draft)*
- `terminology-and-ux.md` — user-facing wording, shared components, UX guardrails. *(to draft)*

## Status

**Bootstrap in progress (started 2026-07-20).** `db-safety-and-process.md` is the first domain drafted for review.
