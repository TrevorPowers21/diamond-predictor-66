# ▶️ CURRENT STATE — where things stand right now

> **OVERWRITTEN, never appended to.** Not history (`docs/AGENT_LEARNINGS_INDEX.md`), not roadmap
> (`docs/HANDOFF_2026_09_02_STATE_AND_ROADMAP.md`). The snapshot to re-read after compaction.
>
> Last updated: **2026-09-04**. ★ **Full picture: `docs/HANDOFF_2026_09_04.md`** — read that first.

---

## 🎯 STATUS: agent build done, steps 1–6. Step 7 deferred by decision.

| | |
|---|---|
| Steps 1–5b | ✅ **on prod** via PR #156 → #173 |
| Step 6 (`rstr-data` subagent) | ✅ built and **proven end to end** |
| Close-out | **PR #174 → staging, OPEN.** Zero runtime changes. |
| Step 7 (oversight protocol) | ⬜ **deferred** — an enforcement gate designed before the tooling has been used encodes assumptions, not friction |

⚠ **`rstr-data` needs a session restart to be invocable** — project agents load at session start.

---

## 🔍 THE CHECKS (full table + triggers: `docs/HANDOFF_2026_09_02_STATE_AND_ROADMAP.md`)

```
npm test                      305 tests + the ANCHOR SUITE — the only AUTOMATIC gate, runs in CI
npm run agent:drift           migrations vs actual catalogs, BOTH DBs
npm run agent:rls [--prod]    RLS per table + actor   ⚠ DEFAULTS TO STAGING
npm run agent:stat-map        which stored field each surface reads
npm run agent:toggles         ★ §4's #1 hard stop — drives the real UI, display-vs-STORED
npm run agent:drift           migrations vs actual catalogs, BOTH DBs
npm run agent:rls-test-coach  non-superadmin coach + boundary proof
@rstr-data                    read-only data questions
```

⚠ Everything except `npm test` is **manual** — drift/rls need DB credentials CI does not have.
Wiring them is a secrets decision, not a coding task. **A check nobody runs is prose.**

## ⛔ STAGING IS NOT A FAITHFUL REHEARSAL OF PROD — three measured divergences
- **No season-2026 rows** in staging `player_predictions` (2027 only, 215,108). Prod has both.
- **Prod has 14 indexes staging lacks**, five on `player_predictions`.
- **Staging has ONE user and they are a superadmin** — who cannot test RLS, since a superadmin
  satisfies every policy. Use `npm run agent:rls-test-coach`.

---

## 🔴 OPEN — priority order

| item | note |
|---|---|
| ⚠ **masters `ALL` to `{public}`** | `Hitter Master` · `Pitching Master` · `Pitch Arsenal` · `Conference Stats`, BOTH DBs. **Any authenticated user can DELETE a season.** The only confirmed prod hole. |
| `PlayerTableRow` 325/354 | risk inputs read `p.prediction` before `transfer_snapshot`; line 591 reads the opposite |
| `owar` field name | carries `total_hitter_war`, not oWAR. Its comment still describes a fallback that the 09-01 re-bake made obsolete. Built over instead of deleted — naming fix, not data. |
| TWP check unexercised | the runner's two-way assertion is correct but no TWP sits on the test build; it warns rather than passing |
| June migration | **in `git stash`**, findable by message. Repo says `ADD CONSTRAINT`, both DBs have a partial index. Only kind-mismatch in 326 objects. |
| 14 prod-only indexes | never written into a migration |
| `PHILOSOPHY.md` §1 | claims `rstr-agent-plan.md` has a priority inverted — deterministic checks over voice. Trevor's call; the counter-argument is in the file. |

**Left in place deliberately:** `rls-test-coach@rstriq.test` on **STAGING** (Arkansas, `general_user`)
— the only non-superadmin account there, needed for any future RLS work. The **prod** one was removed.

---

## ⚖️ EASY TO LOSE AFTER A COMPACTION

- **Wait for an explicit go before any code or data change.** At a fork, stop and surface it.
- **Prod writes need an explicit "prod, now?"** · **Trevor merges to `main`.**
- ★ **Read a table's unique constraints BEFORE aggregating over it.** Five wrong conclusions on
  2026-09-02 were all the same shape — `division`, then `updated_at`, then `season`.
  `player_predictions` is keyed on **five** columns including `season`.
- **Verify config on BOTH databases** (Gate B, and its 09-02 repeat).
- **Vercel previews read PROD.** Local dev reads staging.
- **Escalate on the FIRST surprise, not the fifth.**
- **Split FIXED / DETECTED / UNVERIFIED**, and say what you did NOT check, unprompted.
