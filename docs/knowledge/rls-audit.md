# RLS / Tenant-Isolation Audit — PROD

> **Verified fact, not word-of-mouth** (per the two-kinds-of-knowledge rule). Read-only audit of the prod DB catalog (`pg_class`, `pg_policies`, `information_schema`).
> First run: **2026-07-20.** Re-run when tables/policies change.

## Method

Query the catalog for: (1) tables with RLS off, (2) tables with RLS on but zero policies, (3) program tables (have `customer_team_id`) whose read policy isn't tenant/user/staff-scoped, (4) program tables missing a policy for any command. Then **read the actual policy `qual` on every flagged table** — a heuristic flag is a hypothesis, not a finding.

## Result (2026-07-20)

- **75 public tables. 29 are program-scoped** (have `customer_team_id`).
- **RLS is ON on all 75 tables.** ✅ Nothing wide open.
- **No write-path gaps** on any live program table. ✅ (The remove-access class of bug — a page open to an actor the write policy excludes — is a *policy-condition* gap, not a missing-policy gap; that needs per-actor simulation, tracked below.)

### Findings

| Table | State | Verdict |
|---|---|---|
| `player_predictions` | `[SELECT] USING: true` on a `customer_team_id` table | ⚠️ **Open cross-tenant read** — any authenticated user reads every row, incl. team-scoped precomputes. **Decision needed** (below). |
| `high_follow` | `[ALL] USING (auth.uid() = user_id)` | ✅ Safe — user-scoped (own list only). |
| `precompute_jobs` | `[ALL]` admin/staff only, no public SELECT | ✅ Safe — staff-only, not readable by program users. |
| `target_board_bak_20260704`, `target_board_bak_pre_surgical_20260704`, `team_build_players_bak_20260704`, `team_builds_bak_20260704` | RLS on, **zero policies** (locked to service role only) | 🧹 Dead July-4 backup tables. Not a leak (locked), but should be **dropped** as cleanup. |

### Decision (2026-07-20)

- **`player_predictions`: tenant-scope each row's read — LOW priority (cleanup).** Trevor: not worrisome shared information (won't break anything), but each line should be protected — it tidies how it's stored. Global/model rows stay readable; team-scoped rows should lock to the owning program. Do it when convenient; not urgent.
- **Related forward rule:** `program-owns-uploaded-data` (db-safety-and-process.md) — program-uploaded player data (player dev, NewtForce) is program-owned and must NOT follow a transferring player. Bake into RLS from day one of the player-development build.

## Heuristic lessons (fold into the audit tool)

A read policy is **safe** if it's scoped by *any* of: **tenant** (`is_team_member` / `customer_team_id` / `is_team_admin_of`), **user** (`auth.uid() = user_id`), or **staff-only** (`has_role(...)` with no broad public SELECT). The v1 flag only recognized tenant-scoping, so it false-positived on `high_follow` (user) and `precompute_jobs` (staff). "Unscoped" = a `USING: true` (or absent) SELECT on a program table — that's the only true leak signal.

## Still to build (for the full living map)

- **Per-actor write simulation** — the remove-access bug wasn't a missing policy, it was a policy whose *condition* excluded the intended actor. Detecting that class needs simulating a write as each actor (superadmin / team_admin / member) and checking rows-affected, not just policy presence.
- **Full per-table read/write matrix** by actor, kept current on every migration.
