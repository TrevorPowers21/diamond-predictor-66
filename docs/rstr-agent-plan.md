# RSTR IQ Dev Agent — Plan

> Status: **design complete, not built.** We'll build it on this branch (`docs/rstr-agent-plan`), starting with the bootstrap knowledge pass. No rush.
>
> ★ **THIS DOCUMENT + `AGENT_PHASE_ONE_SCOPE.md` ARE THE SOURCE OF TRUTH** (Trevor, 2026-09-02). A
> separate working plan drafted 2026-09-02 was folded in below (§7a layering, §7b compaction) and its
> stale assumptions corrected in §7c. Where any other note disagrees with this file, this file wins.
> Authored 2026-07-17; design worked through with Trevor 2026-07-18 around "a consistent voice across every change."

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

## 4. The oversight protocol — what a change must clear

The agent interrogates whoever's making a change (including Trevor) and only "signs off" once the change holds up. Ordered by severity.

**Hard stops (block the change):**
- **Data consistency — the #1 rule.** Every user-facing number must read from the **proper precompute / returner line**. The agent pushes work to **never calculate live**; when live is unavoidable, the value **must be identical across every place it appears for the user — including under dev-aggressiveness, depth role, and SP/RP toggle.** The same stat showing two different values anywhere invalidates the whole app. This is the thing it guards hardest.
  - **Enforcement = map-level (chosen).** The agent maintains a living **map of each stat → every surface it renders on**, and verifies they resolve to the *identical* value, running the dev-agg / depth-role / SP-RP toggle permutations to confirm the number doesn't move. Not just "flag live calc at the source" — the full stat-by-stat map is the goal. (Builds on the stored-vs-live audit + `storedVsLive.test.ts`.)
- **DB safety.**
  - **Verify which database** before any change — confirm the target (staging vs prod) so changes never land on the wrong one.
  - **Staging first, always.** Additive changes promoted to prod are low-worry; **destructive changes or function changes are meticulous** and get extra scrutiny.
  - **RLS is part of everything** — all data, especially anything big. Maintain a **saved, living analysis of how RLS works** (per table + actor: what each policy allows) so correctness is provable, not assumed.
  - **Migration ritual:** dry-run apply first → run for real → **verify the objects/effects after (catalog, not `exec_sql OK`)** → **brief and question the operator** through it. Explicitly guards the "many migrations run, none re-checked, usage never tested before push" failure (the gm_contract silent rollback).

**Questions it always asks (warn / push back, may block on a weak answer):**
- **Intent** — what are you changing, and why?
- **Process match** — does this follow how we've made and executed prior decisions?
- **Prior decisions** — does it contradict anything in the decision records? (agent names the conflict)
- **Proof** — data verified, and did the code actually reach the end / complete?

**Soft / adaptive (guidance, not gates):**
- **Terminology** — adapt to each operator's own words (not everyone prompts as precisely as Trevor); keep *user-facing* app terms consistent.
- **Reuse** — prefer our existing patterns/utils, but don't hold anyone to the fire on it. (The *calc*-logic side of reuse is covered by the data-consistency hard stop — forking a formula is what creates divergent numbers.)

**Enforcement — tiered, and hard blocks are a discussion, not a wall.**
- **Soft items** are advisory: flag, suggest, move on.
- **Hard stops don't slam a gate shut.** When the agent senses a non-negotiable is at risk, it *opens a conversation* — surfaces the concern, asks the editor for the *why* behind the action, and they work through it together until it's resolved in a **protected** way: nothing breaks, the progress is sound, and the reasoning is on record. An editor can work through *any* issue; what's required is the deliberate working-through, not silent approval. If they proceed past a hard stop, the resolution/override is **recorded and attributed**. The goal is protected collaboration, not "computer says no."

## 5. How the knowledge gets captured — the loop

You never author rules from a blank page. Capture is a **react-and-correct loop**:

**The agent reads → proposes the rule it infers → you react → your correction becomes the record.**

- **From the code:** the agent reads the codebase + git history and drafts the *observable* rules (money flow, precompute/returner reads, terminology).
- **From talking:** it shows you that draft; you correct it ("the real reason is Y"); the correction is what's saved. Wrong guesses are the fastest way to pull the real reasoning out of your head — which is exactly how this whole plan was captured.

**Two phases:** a **bootstrap** pass (agent mines the whole codebase + git history + existing session memory, presents everything it believes the rules are, you confirm/correct over a few sessions → the starting knowledge base), then **ongoing** capture on every change via the same loop, plus occasional deliberate philosophy drop-ins.

**Record shape:** what / why / scope / supersedes / origin — and especially **what it was protecting against** (the failure mode), because that's what lets the agent extrapolate *the way you would* to situations you never explicitly ruled on. The agent mines these from the discussion; nobody fills a template.

## 6. The mechanical floor — deterministic checks

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

## 7. Where it lives / how it's invoked

- A `scripts/agent/` folder + a thin CLI: `npm run rstr-check -- <command>`.
- Reuses the existing `scripts/_run_sql_file.ts` / service-client pattern and both `.env.local` (staging) + `.env.production.local` (prod), read-only for catalog checks.
- **Voice layer** = a Claude Code **custom subagent** (`agentType: rstr-check`) whose system prompt encodes the decision history + the hard-won rules (below), with the deterministic scripts as its toolkit. It reads the git diff, runs the relevant checks, and writes a plain-English report.

**Architecture: Option A — build ON a coding-agent harness, don't rebuild one.** The harness (agent loop, tools, code editing, git, context management) is inherited; we pour effort into the RSTR-IQ-specific layer (knowledge base, oversight protocol, consistency map, DB rituals). **Claude Code is the primary / blessed harness.** But the brain is kept **portable, not Claude-Code-locked** — the knowledge lives as repo docs (markdown) and the checks as plain scripts/CLI, so a different harness can load the same rules + run the same tools. The Claude-Code-specific config (instructions, sub-agents, skills) is the blessed default; the underlying knowledge + tools are harness-agnostic.

## 7a. Layering — what loads when (folded in 2026-09-02)

The knowledge is not one file. Each layer has a different load cost, so each has a different job.

| layer | lives in | loaded | holds |
|---|---|---|---|
| **Rules** | `CLAUDE.md` (repo root) | **every session** | technical facts + hard rules, one line each. ⚠ Currently ~280 lines and narrative — **needs trimming to terse rules**; the prose belongs in `docs/knowledge/`. |
| **Engineering philosophy** | ✅ `docs/PHILOSOPHY.md` *(rewritten 2026-09-03 — engineering only)* | every session | how we decide something is TRUE. Every principle cites the failure that produced it. ⚠ BUSINESS reasoning is deliberately NOT here — `RSTR_IQ_Master_Reference` is the living source for that, and a repo copy would be a second place the same reasoning lives. |
| **State** | `.claude/state/current.md` *(does not exist)* | every session + **after compaction** | *where things stand right now.* Overwritten, never appended. The file the agent re-reads to snap back. |
| **Technical judgment** | `docs/knowledge/*.md` | on demand | the named principles (`p-prediction-is-not-a-snapshot`, `prove-comparable-before-diffing`, …). Already exists, 7 files. |
| **History** | `docs/AGENT_LEARNINGS_INDEX.md` + 17 files | on demand | what was tried, what worked, what superseded what. Already exists. |
| **Roadmap** | `docs/HANDOFF_2026_09_02_STATE_AND_ROADMAP.md` | on demand | where we're heading. Already exists. |
| **Subagents** | `.claude/agents/*.md` | on invoke | specialists *underneath* the one voice — never separate top-level agents with no shared judgment. |

⚠ **Everything above is committed to the REPO, never personal `~/.claude/` config.** The point is that
it is the same agent for everyone, including a future hire. Session memory in `~/.claude/` is recall
for one operator — useful, but **never the source of truth**.

**Subagent order:** data first (prove it end to end), then code, then future-ideas. The ideas/
brainstorming subagent should not have repo write access.

## 7b. The compaction problem (folded in 2026-09-02)

**Compaction replaces real conversation history with a lossy summary, and nothing forces the agent to
re-ground afterwards.** That is the "off voice for a while" feeling — and it is not cosmetic here: if
the deliverable is *a consistent voice*, losing it after every compaction defeats the whole point.

⚠ **This is observed, not theoretical.** The 2026-09-01 session compacted mid-work and the summary is
what carried forward.

**Fix — try existing packages before building:**
- `cc-compact` (PyPI) — lightweight; preserves task state, prompts a re-read. **Try first.**
- `claude-compact-controller` (GitHub) — heavier, more state tracking.
- **Custom mechanism if needed:** `PreCompact` hook saves a state snapshot → `PostCompact` cannot
  inject context directly (known limitation) → it drops a **marker** → the next `UserPromptSubmit` /
  `SessionStart(compact)` detects the marker, forces a re-read of `.claude/state/current.md`, then
  clears it (one-shot).

## 7c. Corrections — assumptions that are no longer true

Recorded so they do not resurface in a future plan:

- ❌ *"No MCP connected yet; agents can only see repo files."* **Supabase MCP IS connected** — two
  named servers, `supabase-staging` and `supabase-prod`, both `read_only=true`, each pinned to its own
  `project_ref`, read-only enforced by a Postgres role. Prod being connected is what makes
  staging↔prod drift checks possible at all. See the Database Access Boundary in `CLAUDE.md`.
- ❌ *"CI does not exist"* (§8 below still said this) — **`.github/workflows/ci.yml` exists** and gates
  PRs with vitest + `tsc` delta-vs-base. It caught a real bug on PR #171 that an error **count**
  comparison had hidden. Sequencing item 3 is **done**.
- ❌ *"The agent learnings doc"* (singular) — it is **18 files + 7 knowledge files + Track B**, already
  split into history / roadmap / principles. The remaining work is trimming `CLAUDE.md`, not splitting.
- ⚠ **`AGENT_PHASE_ONE_SCOPE.md §4.1` is stale.** It says every DB write reaches Trevor as raw SQL to
  paste. `CLAUDE.md` now states the gate is **that the write was talked through first, not who runs
  it**, with execution assigned per task and multi-statement work often going to the agent through the
  repo's scripted migration path. **CLAUDE.md wins; §4.1 needs reconciling.**

## 8. Output

- Human report (terminal + optional markdown file): the consistency read up top, then ✅/❌ per mechanical check with the failing object and a suggested fix.
- Non-zero exit on hard failures so it can gate a pre-push hook or CI later.
- Flags: `--target staging|prod`, `--scope migrations|rls|drift|data|voice|all`, `--branch <name>`.

## 9. Scope & attribution

- **Scope = all activity.** Not just code changes — **every operation gets checks-and-balances at minimum**: code, migrations, CSV imports, precompute runs, scraping, portal pulls, hand SQL fixes. The data-ops are where silent damage happens (this session was half data-ops), so they're in scope, not an afterthought.
- **Attribution.** The agent should **know who made each change**, however we implement it (git author + a recorded sign-off is likely enough). Lightweight for now; matters more the moment there's a second person at the keyboard.

## 10. Build posture & starting point

**We build it right, not quick.** No throwaway MVP — the agent is a real system built to do the job properly from the start (Trevor: "if we are building an agent we should be doing it right"). The order below is *build sequence*, not "cheap version first" — each piece is done properly before it's relied on. **No rush.**

**Merged sequence (2026-09-02).** The bootstrap knowledge pass is now **largely done** — `docs/knowledge/`,
`AGENT_LEARNINGS_INDEX.md` and Track B's read/write section are exactly the react-and-correct output it
was meant to produce.

1. ✅ **`docs/PHILOSOPHY.md` — DRAFTED 2026-09-02**, mined from `RSTR_IQ_Master_Reference` (Internal,
   July 2026). 16 principles, each with *what it protects against*. ⚠️-marked lines are inference and
   **need Trevor's correction** — that correction is the record (§5). ★ Its §15 claims the business
   reasoning and the 09-01 engineering doctrine are **the same reasoning at different altitudes**;
   if that holds, it is the answer to "what is the consistent voice?"
2. **`.claude/state/current.md` + a compaction hook** (§7b). Cheap, and every session pays for its
   absence. Pulled ahead of the subagents deliberately.
3. **Trim `CLAUDE.md`** to terse rules; move its narrative into `docs/knowledge/`.
4. ★ **The anchor suite — task zero** (`AGENT_PHASE_ONE_SCOPE.md §2.0`). **The gate. Non-negotiable.**
   2026-09-01 is the argument: every formula test passed while Helfrick rendered 2.32 instead of 4.94
   and Neiswonger showed 1.14 pWAR instead of 3.329. Formula-constant tests cannot catch a stored
   value moving. **An agent with voice and no anchors is a confident reviewer that cannot tell when it
   broke something.**
5. **The guarantees:** the stat → surface map (with dev-agg / depth-role / SP-RP toggle permutations)
   and the DB-safety / RLS living analysis. ⚠ The stat→surface map is exactly what would have caught
   2026-09-01 — consider pulling it level with the anchors rather than after.
6. **One data subagent**, end to end, before any other.
7. **The gate + voice:** the oversight protocol wired into real workflow, with attribution.
8. Code + future-ideas subagents.

## 11. Still to decide (not blocking the start)

- **Prod access:** it needs the prod service key for read-only catalog checks (same `.env.production.local` used today). Keep it read-only-by-convention, or mint a separate read-only key?
- **Report / sign-off destination:** terminal only, or also a dated record file / posted to the PR?
- **Attribution mechanism:** git author is the free version; do we want an explicit per-change sign-off record too?

## Guardrails the agent must encode (lessons from the GM launch)

- `exec_sql` runs each migration file as **one transaction** — any failed statement rolls back the whole file (incl. its `CREATE TABLE`). Runner success is **not** proof the objects exist.
- A PostgREST / `.from().select()` read can be a **stale-cache false positive** — use `to_regclass` / a DDL probe (`COMMENT ON TABLE …` errors if absent) for authoritative existence.
- A Supabase write filtered by RLS returns **success with 0 rows affected**, no error — always `.select()` the affected rows when correctness matters.
- Storage (`storage.objects` / `storage.buckets`) and other owner-restricted DDL can't run via the service-role runner — those go through the dashboard.
