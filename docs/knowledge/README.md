# RSTR IQ — Knowledge Base

This is the **repo-resident brain** for the RSTR IQ agent (see `../rstr-agent-plan.md`). It's the set of decisions, rules, and reasoning the agent loads so it can be a consistent voice across every change — and so anyone working through it makes changes the way we've decided to.

It is **portable on purpose**: plain markdown, no harness lock-in. Any agent/harness can read it.

## How this gets built and stays current

The **react-and-correct loop** (never authored from a blank page):

> The agent reads the code + git history → drafts the rule it infers → **Trevor reacts/corrects** → the correction becomes the record.

- **Bootstrap:** the agent drafts records domain-by-domain from the codebase, git history, and existing session memory. Trevor reviews and corrects. That's the starting knowledge base.
- **Ongoing:** every change runs the same loop — a new/updated record, with contradictions to prior records flagged for a `Supersedes`.

**Only Trevor confirms a new record or a supersede** (for now). Drafts are marked `status: draft` until he does.

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
- `data-and-numbers.md` — the #1 rule: precompute/returner lines, no live calc, identical stat everywhere incl. toggles. *(to draft)*
- `money-and-budget.md` — Actual Pay/finalize, vendors, allocations↔contracts, committed-only totals. *(to draft)*
- `projections-and-scouting.md` — WAR/wRC+/Stuff+, JUCO baselines, risk framework, competition translation. *(to draft)*
- `access-and-tenancy.md` — RBAC, user_team_access, customer_teams, the active build. *(to draft)*
- `terminology-and-ux.md` — user-facing wording, shared components, UX guardrails. *(to draft)*

## Status

**Bootstrap in progress (started 2026-07-20).** `db-safety-and-process.md` is the first domain drafted for review.
