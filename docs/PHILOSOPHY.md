# RSTR IQ — Engineering Philosophy

> **What this is.** How we decide something is *true* here. Not rules — `CLAUDE.md` holds those. Not
> this codebase's specifics — `docs/knowledge/` holds those. This is the layer above both: the
> reasoning that survives when the subsystem changes.
>
> **Every principle below was paid for.** Each one names the failure that produced it. Nothing here
> is a good idea someone had; it is all scar tissue, and the citation is the point — a rule you can
> trace to a real outage gets followed, and one you cannot gets rationalised away at 11pm.
>
> ⚠️ **Business and market reasoning is NOT here.** `RSTR_IQ_Master_Reference` is the living source
> of truth for that. A copy in the repo would be a second place the same reasoning lives, which is
> exactly the defect this document's §1 is about.

---

## 1. A rule that only lives in prose is advisory

**The most important thing on this page, and the least comfortable.**

Over 2026-09-02/03, building the very tooling meant to prevent it, an agent produced six wrong
conclusions. Not from missing knowledge — **every rule broken was already written down**, in this
file, in `CLAUDE.md`, and in the learnings index. All loaded. All read.

What actually caught them: **one question from Trevor**, and a hardcoded `division = 'D1'` inside a
script.

**⇒ Prose degrades silently under momentum.** A plausible pattern in the data, a narrative already
half-written, the wish for the finding to be interesting. Mechanical checks have no such failure
mode. `rstr-agent-plan.md` §7 calls the deterministic checks "the mechanical floor" and the voice
"the higher value"; **this document argues that ordering is backwards.**

**How to apply.** When a rule proves it matters, graduate it from sentence to gate:

| was prose | is now |
|---|---|
| "never compute a user-facing number" | the `read-path` CI job |
| "the repo must describe the database" | the `drift` CI job |
| "a formula change must not move a player" | the anchor suite in CI |
| "the same stat must agree everywhere" | `npm run agent:toggles` |

Not everything can graduate — *"read a table's unique constraints before aggregating"* is judgment,
not a job. But **anywhere the doctrine is only written down, assume it will be violated**, and pick
the rule that bit you most recently to convert next.

---

## 2. Read the key before you aggregate

Every one of those six wrong conclusions was **an aggregate grouped without a key column.**

| grouped without | produced |
|---|---|
| `division` | JUCO reproduces at 0.1%, D1 at 97.8%. An unfiltered sample reported ~60% and a fabricated "regression to the mean" theory. **This is cause C1 repeating** — the same omission that made ERAs run 4% low. |
| `updated_at` | stale rows read as an implementation disagreement, costing hours |
| `season` | 2026 and 2027 rows read as duplicates. Nearly became a recommendation to **delete 7,255 legitimate rows**, described as the safe option. |

Each missing column was one query away:

```sql
select indexname, indexdef from pg_indexes where tablename = '<t>' and indexdef ilike '%unique%';
```

**⇒ Before any `GROUP BY`, `count(*)`, "duplicate" or "divergence" claim, read the table's unique
constraints.** If your grouping key does not contain one, either fix the grouping or say out loud why
it does not.

---

## 3. Prove two things are comparable before you diff them

The corollary of §2, and it caught three more:

- **Same generation** — compare `updated_at`. Stale-vs-fresh is indistinguishable from an
  implementation disagreement.
- **Same side** — a two-way player carries BOTH sides on ONE row; `coalesce(o_war, p_war)` silently
  mixes them.
- **Same field name** — `market_value` is stored as `nil_valuation` on board snapshots.
- **Same metric** — Team Builder shows pRV+ for a pitcher while the profile shows *PR+*, a power
  rating. Two different numbers, both correctly labelled, compared as if they were one.
- **Same population** — the TWP own-side rule governs SNAPSHOTS. Asserted against raw
  `player_predictions` it reports 2,229 prod "violations" that are not violations.

**⇒ A divergence report is a claim about two things being the same thing. Establish that first.**

---

## 4. Verify the thing works, not that the command returned

- `exec_sql` reported OK while the transaction rolled back and `gm_contracts` never existed on prod.
- **An RLS-blocked write returns SUCCESS with 0 rows and no error.** Remove-access "succeeded" while
  deleting nothing. Testing the master-table lockdown, a `delete … where false` was written as proof
  — it affects 0 rows whether or not RLS blocks it, so it proved nothing. **Count affected rows
  against what would have matched.**
- A PostgREST read can be a stale-cache false positive. Use `to_regclass` or a DDL probe.
- A role can be created successfully and still be unusable — Supabase's pooler needs the tenant in
  the username, which only the connect-as-the-new-role step revealed.

**⇒ Verify against the catalog, or by doing the thing. Never against the runner's return value.**

---

## 5. An empty result looks exactly like nothing being wrong

- `LIKE 'gm[_]%'` — bracket classes are SQL Server, not Postgres. Matched zero rows and nearly
  printed as a clean bill of health.
- `information_schema` is **privilege-filtered**. Run as a least-privilege role it returns nothing,
  and a scoping audit built on it reports clean while checking nothing.
- A CI baseline built from a script that predates its own `--porcelain` flag produced "58 fixed, 2
  new" when nothing had changed.

**⇒ A result that matches expectation too neatly deserves one check too.** Ask what a non-empty
result would have looked like, and whether the query could ever have produced one.

---

## 6. Escalate on the first surprise, not the fifth

When a result contradicts what you expected: **stop and report the contradiction.** Say what you
expected, what you got, and what you would check next.

Investigating four more times and presenting a conclusion is how a hypothesis becomes a claim nobody
asked for. `AGENT_PHASE_ONE_SCOPE.md` §7 already says this; it was skipped anyway, five times.

> **The cost of asking is seconds. The cost of guessing is a paying program seeing wrong numbers.**

---

## 7. Say what you did not check, unprompted

Split **FIXED / DETECTED / UNVERIFIED** and never let a hypothesis wear the clothes of a finding.

- **FIXED** — changed and verified.
- **DETECTED** — real, unaddressed, and you can say precisely what is wrong.
- **UNVERIFIED** — you have a hypothesis. Say so, and say what would settle it.

A green check means *"no known problem"*, never *"correct"*. Say which one you mean. Volunteer the
scope you narrowed, the assumption you made to keep moving, and the place you were surprised and
proceeded anyway.

---

## 8. Verify config on BOTH databases

**Gate B:** prod ran a *different wRC+ equation* for weeks because a legacy `"Equation Weights"` table
existed there and not on staging. Same code, two databases, two answers. Across 5,122 D1 returner
hitters the legacy formula reproduced the stored value for 5,122; the canonical one for 1,164.

**It repeated on 2026-09-02.** An RLS finding measured on staging was reported as a prod security
hole. Prod was never exposed — `npm run agent:rls` **defaults to staging**.

⚠ **Staging is not a faithful rehearsal of prod.** Measured: staging has **no season-2026 rows**,
**14 fewer indexes** (five on `player_predictions`), and **one user who is a superadmin** — and a
superadmin satisfies every RLS policy, so they cannot test one.

---

## 9. The screen is the product, not the database

On 2026-09-01 **every automated check passed while the UI was wrong.** Helfrick rendered 2.32 instead
of 4.94. Neiswonger showed 1.14 pWAR instead of 3.329. Every check verified the DATABASE; the bugs
lived in the READ PATH.

**Triage: is it wrong in the DATABASE, or only on SCREEN?** Database → re-bake. Screen only → read
path, and the first question is *which stored field does that surface actually read.*

**⇒ Never compute a user-facing number.** Read `player_snapshot ?? transfer_snapshot` — never
`p.prediction`, which is `snapshot ?? predictionMap[...]` and degrades to a raw row. The moment a
surface derives, it becomes a fourth implementation alongside the batch, the edge function, and the UI.

---

## 10. One save path owning every derived copy

**The defect class behind every symptom of 2026-09-01: a stored copy nobody recomputes, behind a
`??` chain that silently changes which source wins once a field becomes populated.**

Snapshots stale after a precompute · market stale after a WAR change · `transfer_snapshot` stale
after a save · `player_snapshot` stale after a local update. Each fix exposed the next, because **the
chain was the defect, not any single link.**

⭐ Every repair script in `scripts/` is a *repair*, not architecture. Until one save path owns every
derived copy together, each new surface adds another copy that can drift.

**The same shape outside the database:** a migration that matched one laptop but not the repo, for
three months. `pg` resolving locally as an extraneous package and vanishing under `npm ci`. **It
worked everywhere it was tried and failed the first time it ran somewhere clean.**

---

## 11. Deliverables must compound, not age

A findings document nobody indexes ages exactly like a static assessment binder — out of date the day
it is written, with nothing underneath so nothing accumulates.

**⇒ Ask of any output: does this feed back into something, or does it terminate?** It is why the
learnings files have an index and a supersession chain, why corrections go **inline and in order**
rather than appended, and why a wrong conclusion stays in the history with its correction rather than
being quietly rewritten. The record of being wrong is what stops the next person repeating it.

---

## ✍️ WHAT'S UNSETTLED

**§1's claim that the plan has a priority inverted** is the live question. The counter-argument is
real: the voice layer is *why* the checks got built at all, and a floor with no voice is a linter.
The current wording may be overcorrecting from two bad days.

Everything else on this page has a citation. If a principle here cannot name the failure that
produced it, it does not belong.
