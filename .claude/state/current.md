# ▶️ CURRENT STATE — where things stand right now

> **OVERWRITTEN, never appended to.** Not history (`docs/AGENT_LEARNINGS_INDEX.md`), not roadmap
> (`docs/HANDOFF_2026_09_02_STATE_AND_ROADMAP.md`). This is the snapshot the agent re-reads after
> compaction (`docs/rstr-agent-plan.md` §7b).
>
> Last updated: **2026-09-02**

---

## 🎯 RIGHT NOW

Agent build on branch **`docs/rstr-agent-plan`** → **PR #156 → staging, open, all CI green.**

| # | step | status |
|---|---|---|
| 1 | `docs/PHILOSOPHY.md` — voice layer | ✅ ⚠️ lines need Trevor's corrections, §15 and §17 first |
| 2 | `.claude/state/current.md` + compaction hooks | ✅ |
| 3 | `CLAUDE.md` 331 → 156 lines | ✅ |
| 4 | ★ anchor suite — 25 prod players, 8 shapes | ✅ 305 tests |
| 5 | stat→surface map (`npm run agent:stat-map`) | ✅ static half · toggle permutations NOT built |
| 5b | RLS analysis (`npm run agent:rls`) | ✅ |
| 6 | one data subagent | ⬜ next |
| 7 | oversight protocol + voice | ⬜ |

**To ship the GM fix to prod:** merge #156 → staging, then open `staging` → `main`. Trevor merges.

---

## 📌 RE-GROUND ON THESE

1. **Source of truth for the agent build** = `docs/rstr-agent-plan.md` + `docs/AGENT_PHASE_ONE_SCOPE.md`.
2. **The doctrine** = a stored copy nobody recomputes, behind a `??` chain. Read
   `docs/knowledge/snapshots-and-recompute.md` before touching snapshots. ⭐ The durable fix — one
   save path owning every derived copy — is still **NOT BUILT**.
3. **Never compute a user-facing number.** `player_snapshot ?? transfer_snapshot`, never
   `p.prediction`.
4. ★ **`player_predictions` is keyed on (player_id, customer_team_id, model_type, variant, SEASON).**
   Aggregating without a key column produced FIVE wrong conclusions on 2026-09-02. **Read a table's
   unique constraints before grouping over it.** See `docs/PHILOSOPHY.md` §17.

---

## 🟢 STATE

- **PR #172 merged** — the WAR recalibration is on `main`. Prod data verified 09-01
  (608 consistent / 0 inconsistent). Edge fn v23 live.
- **`player_predictions` RLS: staging and prod policies are now IDENTICAL** (cross-DB diff verified).
  ⚠ Prod was **never** unscoped — staging was. The migration is marked ⛔ DO NOT APPLY TO PROD.
- **Test coach accounts** — `rls-test-coach@rstriq.test`, `general_user`, no `user_roles` row:
  - staging → Arkansas (local dev reads staging)
  - prod → Gardner-Webb (**Vercel previews read PROD**) · remove: `--prod --cleanup`

## 🔴 OPEN

| item | note |
|---|---|
| ⚠ **masters publicly writable** | `Hitter Master` · `Pitching Master` · `Pitch Arsenal` · `Conference Stats` are `ALL` to `{public}` on **BOTH** DBs. Any authenticated user can DELETE a season. **The only confirmed prod RLS hole.** |
| `PlayerTableRow` 325/354 | risk inputs read `p.prediction` before `transfer_snapshot`; line 591 reads the opposite |
| JUCO | ~33.9k stale season-2027 NJCAA rows — workstream C, fix conference env+ coverage FIRST |
| toggle permutations | the half of step 5 that needs a running app |
| Gate A / Georgia Tech | never fired on prod |
| removal-from-roster semantics | UNDEFINED — currently inertia, not design |

---

## ⚖️ EASY TO LOSE AFTER A COMPACTION

- **Wait for an explicit go before any code or data change.** At a fork, stop and surface it.
- **Prod writes need an explicit "prod, now?"** · **Trevor merges to `main`.**
- **Verify config on BOTH databases** — Gate B, and it repeated on 09-02 when an RLS finding from
  staging was reported as prod. `npm run agent:rls` **defaults to staging**.
- **Vercel previews read PROD.** Local dev reads staging.
- **Split FIXED / DETECTED / UNVERIFIED**, and name what you did *not* check, unprompted.
- **The real type gate is `tsc -p tsconfig.app.json`**; CI uses a **set difference**, so an error
  *count* hides a swap.
- **A DB check verifies the DATABASE.** Read-path bugs only show in the UI.
- **Escalate on the FIRST failure, not the fifth** (`AGENT_PHASE_ONE_SCOPE.md` §7).
