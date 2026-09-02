# ▶️ CURRENT STATE — where things stand right now

> **This file is OVERWRITTEN, never appended to.** It is not history and not a roadmap — it is the
> snapshot the agent re-reads to snap back after compaction (`docs/rstr-agent-plan.md` §7b).
> History lives in `docs/AGENT_LEARNINGS_INDEX.md`; the roadmap lives in
> `docs/HANDOFF_2026_09_02_STATE_AND_ROADMAP.md`. **If a section here grows past a screen, it belongs
> in one of those two instead.**
>
> Last updated: **2026-09-02**

---

## 🎯 WHAT I AM DOING RIGHT NOW

Building the RSTR IQ dev agent on branch **`docs/rstr-agent-plan`**, following the merged sequence in
`docs/rstr-agent-plan.md` §10.

| # | step | status |
|---|---|---|
| 1 | `docs/PHILOSOPHY.md` — the voice layer | ✅ drafted, **awaiting Trevor's corrections on the ⚠️ lines** |
| 2 | `.claude/state/current.md` + compaction hook | ◀ **IN PROGRESS — this file** |
| 3 | Trim `CLAUDE.md` to terse rules | pending |
| 4 | ★ Anchor suite (task zero) | pending — **the gate**; `src/test/anchors/` is empty |
| 5 | Stat→surface map + RLS living analysis | pending |
| 6 | One data subagent, end to end | pending |
| 7 | Gate + voice, then remaining subagents | pending |

---

## 📌 THE THREE THINGS TO RE-GROUND ON

1. **Source of truth for the agent build** = `docs/rstr-agent-plan.md` + `docs/AGENT_PHASE_ONE_SCOPE.md`.
   Where any other note disagrees, those two win (Trevor, 2026-09-02).
2. **The doctrine** = *a stored copy nobody recomputes, behind a `??` chain.* That single defect class
   caused every symptom of 2026-09-01. Read `docs/knowledge/snapshots-and-recompute.md` before
   touching snapshots. ⭐ The durable fix — **one save path owning every derived copy** — is still
   **NOT BUILT**; every script in `scripts/` is a repair, not architecture.
3. **Never compute a user-facing number.** Read the stored snapshot:
   `player_snapshot ?? transfer_snapshot`. **Never `p.prediction`** — that is a raw prediction row,
   not a snapshot.

---

## 🟢 STATE OF THE APP

- **PR #172 (`staging` → `main`) — MERGED** by Trevor 2026-09-02. Prod code and prod data are aligned.
- **Prod data** repaired + verified 2026-09-01: returners 7,720 pitchers / 8,232 hitters · transfers
  13/14 teams · 744 snapshots re-baked · **608 consistent / 0 inconsistent**.
- **Edge function v23** live on prod.
- Branch `docs/rstr-agent-plan` is rebased on staging and pushed; CI green.

## 🔴 OPEN — the short list

Full table in the handoff (9 items). The ones that bite soonest:

- **Gate A / Georgia Tech never fired on prod** — the edge fn is deployed and diff-verified on hitters
  (7,814/7,814) but **no job has been run through it on prod**.
- **Removal-from-roster semantics UNDEFINED** — nothing rewrites `transfer_snapshot` when a player
  comes off a roster. Current behaviour is inertia, not design. **Decide it.**
- **JUCO ~62% stale on prod** — fix conference env+ coverage FIRST; re-running precomputes leaves
  blocked rows blocked.
- 10 staging / 18 prod pitchers with unverifiable pWAR (**skipped, not guessed**) · 1 wrong-side
  neutral · `propagate_pitcher_scores_to_predictions` needs a `WHERE` clause · 66 hardcoded constants
  (naming decision first) · `types.ts` stale.

---

## ⚖️ RULES THAT ARE EASY TO LOSE AFTER A COMPACTION

- **Pause before changes.** Wait for an explicit go before any code or data change. At a fork, stop
  and surface it rather than picking.
- **Prod writes need an explicit "prod, now?"** — never on an ambiguous go. **Trevor merges to `main`.**
- **Split FIXED / DETECTED / UNVERIFIED**, and name what I did *not* check, unprompted.
- **The real type gate is `tsc -p tsconfig.app.json`** — and CI uses a **set-difference**, so an error
  *count* hides a swap.
- **DB checks verify the DATABASE.** Read-path bugs only appear in the UI. Triage: *wrong in the DB, or
  only on SCREEN?*
- **Before diffing two things, prove they are COMPARABLE** — same generation (`updated_at`), same side
  (a TWP carries both sides on one row), same field name.
- Both Supabase MCP servers are **read-only**. Writes go through the repo's scripted path, never MCP,
  and only after being talked through.
