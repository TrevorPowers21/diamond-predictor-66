# RSTR IQ — Multi-Tenant Auth Plan

**Status:** Approved, ready to execute
**Branch:** `staging` (no prod deploys until Phase 6 gate passes)
**Owners:** Trevor + Peyton
**Updated:** 2026-04-23

---

## 1. What we're building

RSTR IQ is a college baseball roster intelligence platform. Today it runs as a single-tenant internal tool — whoever logs in sees all data for a demo school (hardcoded `DEMO_SCHOOL`). Before the first paying customer, we need multi-tenant isolation: every customer school (team) sees only their own data, with no way to peek into another school's recruiting board, notes, or roster plans.

This plan covers the auth, access-control, and data-scoping work.

**Out of scope:** payments/billing, SSO, audit logging, SMS magic links, mobile app. Any of those become Phase 2 work after the first customer is live.

---

## 2. Role model

Three tiers, invite-only (no open signup):

| Tier | Who | Scope | Capabilities |
|------|-----|-------|--------------|
| **Superadmin** | Trevor, Peyton, any NewtForce-level person we add | Cross-team (global) | Create teams, create team admins, impersonate any team, full read/write on everything, bypass all RLS |
| **Team admin** | Head coach or recruiting coordinator at the customer school | Single team | Invite/remove general users on their team, full read/write on their team's data |
| **General user** | Assistant coaches, analysts | Single team | Read/write their team's recruiting data (targeting, notes, team builds), cannot invite others or change team settings |

**Account creation flow:**
1. Superadmin creates team + assigns team admin by email
2. Team admin clicks magic-link invite, sets password, logs in — auto-scoped to their team
3. Team admin invites assistants by email → same flow → auto-scoped to admin's team

**No open signup page.** The `/auth` route is login-only. Signup is disabled for end users; only the superadmin-gated admin panel + team-admin invite UI can create accounts.

**Multi-team users:** Not supported in v1. One user = one team. Superadmins are the exception and bypass the table entirely.

---

## 3. Data scoping decisions

Tables split into two buckets:

### Shared (no RLS — all authenticated users can read)
The RSTR IQ data platform. This is what every customer pays for access to.
- `Hitter Master`, `Pitching Master`, `Teams Table`, `Conference Stats`, `Park Factors`, `Conference Names`, `NCAA Averages`
- `Equation Weights`, `model_config` — **global defaults**; customized per team via the overlay table below
- `pitcher_stuff_plus_inputs`, `pitcher_stuff_plus_ncaa`
- `pitcher_role_overrides` (global overrides, debatable — current plan keeps it global)
- `player_predictions` — **kept global in v1**. Class transition and dev aggressiveness are objective facts about the player, not team-specific beliefs. If teams later want their own overrides, add a `team_prediction_overrides` layer on top. Don't over-engineer now.

### Team-scoped (RLS required)
Tables where coaches store team-specific work. These need a `team_id` column and RLS policies.
- `target_board` — per-team recruiting list
- `coach_notes` — scouting notes on players
- `team_builds` / `team_builds_members` — Team Builder saved drafts (if the tables exist yet)
- `nil_valuations` — if per-team (confirm current use)
- `team_equation_overrides` — **Tier 3 (custom equations) overlay**. Created empty in v1; populated when the Custom Equations UI ships post-launch. At compute time, projection engine reads per-team overrides first, falls back to global `Equation Weights` defaults.

Any table we add post-launch that holds per-coach-team data follows the same pattern.

### Customization architecture (for Peyton)
This is how we offer per-program equation customization without spinning up separate Supabase projects per customer. **Global defaults + per-team overlay.** Pattern used by Stripe, Linear, Notion, essentially every multi-tenant SaaS. Data platform stays one source of truth, customizations stack on top.

When Tier 3 (custom equations) ships, a team admin opens a Custom Equations page, tweaks weight sliders, saves → rows land in `team_equation_overrides`. No data duplication. When RSTR IQ pushes an update to the global equations, their overrides stay intact — anything they haven't customized picks up the update, anything they have sticks.

---

## 4. Schema

### New table: `teams` (customer teams)
Distinct from the existing `Teams Table` (which is the D1 roster data). This is the "customer account" for a school.

```sql
CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,                              -- Display name, e.g. "UCSB Gauchos"
  school_team_id uuid REFERENCES "Teams Table"(id),-- Which D1 program they are
  savant_enabled boolean DEFAULT false,            -- Mid-tier add-on flag
  active boolean DEFAULT true,                     -- Soft-delete support
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

CREATE INDEX idx_teams_school_team_id ON teams(school_team_id);
```

### New table: `user_team_access`
Join table — who belongs to which team, with their role on that team.

```sql
CREATE TABLE user_team_access (
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id uuid REFERENCES teams(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('team_admin', 'general_user')),
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  PRIMARY KEY (user_id, team_id)
);

CREATE INDEX idx_user_team_access_user_id ON user_team_access(user_id);
CREATE INDEX idx_user_team_access_team_id ON user_team_access(team_id);
```

### Existing table: `user_roles`
Already exists. Reuse for the global **superadmin** flag only. Team-level roles live in `user_team_access`.

```sql
-- Seed superadmins (replace UUIDs with actual auth.users IDs)
INSERT INTO user_roles (user_id, role) VALUES
  ('<trevor-uuid>', 'superadmin'),
  ('<peyton-uuid>', 'superadmin');
```

Drop any obsolete roles (`scout`, `external`, etc.) from the CHECK constraint or ignore them — cleanup later.

### Team-scoping columns
Every team-scoped table needs a `team_id uuid REFERENCES teams(id)`. Add where missing, backfill from the existing data (most team-scoped rows currently have implicit DEMO_SCHOOL context — we'll backfill to the CCU team or whatever the internal demo team ends up being).

Tables to verify + add column if missing:
- `target_board` — check current schema
- `coach_notes` — check current schema
- `team_builds` / `team_builds_members` — check
- `nil_valuations` — check

### New table: `team_equation_overrides` (Tier 3 overlay)
Built empty in v1. Populated when the Custom Equations UI ships. Projection engine reads this first, falls back to global `Equation Weights`.

```sql
CREATE TABLE team_equation_overrides (
  team_id uuid REFERENCES teams(id) ON DELETE CASCADE,
  equation_key text NOT NULL,        -- matches a key in Equation Weights (e.g. "r_w_obp")
  value numeric NOT NULL,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  PRIMARY KEY (team_id, equation_key)
);

CREATE INDEX idx_team_equation_overrides_team_id ON team_equation_overrides(team_id);
```

RLS follows the standard team-scoped pattern (superadmin or team_admin of that team). General users can't modify equations.

---

## 5. Impersonation

**Superadmin viewing a customer team's exact experience** (for debugging "my data looks wrong" calls).

### How it works
- Superadmin toggles a team in the UI header
- Client-side `useAuth()` stores `impersonatedTeamId`
- All queries that would filter by the user's team now filter by `impersonatedTeamId ?? userTeamId`
- RLS still allows the query because superadmin role bypass is unconditional on the policy

### Why client-side
No session switching, no JWT re-issue, no server work. The superadmin still has their real token. They're just viewing data through a team-specific lens. Clearing the state (logout, close tab, click the "exit impersonation" button) returns to superadmin default view.

### Audit trail (deferred)
Log impersonation start/stop to a simple `impersonation_log` table post-launch if we ever need accountability. Not needed for v1.

---

## 6. RLS policies

Standard pattern for team-scoped tables:

```sql
ALTER TABLE target_board ENABLE ROW LEVEL SECURITY;

-- Read: superadmin OR member of the target team
CREATE POLICY "target_board_scoped_read" ON target_board
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid() AND role = 'superadmin'
    )
    OR team_id IN (
      SELECT team_id FROM user_team_access WHERE user_id = auth.uid()
    )
  );

-- Write (insert/update/delete): superadmin OR member of the target team
CREATE POLICY "target_board_scoped_write" ON target_board
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid() AND role = 'superadmin'
    )
    OR EXISTS (
      SELECT 1 FROM user_team_access
      WHERE user_id = auth.uid() AND team_id = target_board.team_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid() AND role = 'superadmin'
    )
    OR EXISTS (
      SELECT 1 FROM user_team_access
      WHERE user_id = auth.uid() AND team_id = target_board.team_id
    )
  );
```

Repeat for every team-scoped table. The policies are identical in shape — only the table name and (if the column isn't `team_id`) the FK column name changes.

### Shared tables
Enable RLS but with a blanket read policy for authenticated users:
```sql
ALTER TABLE "Hitter Master" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read" ON "Hitter Master"
  FOR SELECT USING (auth.role() = 'authenticated');

-- Writes: superadmin only (pipeline jobs run as superadmin service role)
CREATE POLICY "superadmin_write" ON "Hitter Master"
  FOR ALL USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'superadmin')
  );
```

---

## 7. Frontend changes

### `useAuth()` refactor
Current shape ([useAuth.tsx](src/hooks/useAuth.tsx)) has `session`, `user`, `roles[]`, `hasRole()`. Add:
- `isSuperadmin: boolean`
- `userTeamId: string | null` — the user's real team (for general users + team admins)
- `effectiveTeamId: string | null` — userTeamId for normal users, impersonatedTeamId for superadmins
- `role: 'superadmin' | 'team_admin' | 'general_user' | null`
- `availableTeams: Team[]` — all teams for superadmins, just the user's team for everyone else
- `impersonateTeam(teamId: string | null): void`

Bootstrap logic ("first user = admin") gets removed. Dev bypass mode gets gated to `import.meta.env.DEV` only.

### DEMO_SCHOOL removal
Four files reference `DEMO_SCHOOL.name` as initial state:
- [TeamBuilder.tsx](src/pages/TeamBuilder.tsx) — lines 941, 2005, 2158
- [PlayerComparison.tsx](src/pages/PlayerComparison.tsx) — lines 704, 706, 716, 718
- [TransferPortal.tsx](src/pages/TransferPortal.tsx) — lines 486, 487
- [SchoolBanner.tsx](src/components/SchoolBanner.tsx) — lines 12, 13

Each swaps to `useAuth().effectiveTeamId` + a `teams` table lookup to get the school name. Delete `src/lib/demoSchool.ts` once all references are gone.

### New routes
- `/admin/teams` (superadmin-gated) — create team, assign school, toggle `savant_enabled`, invite first team_admin
- `/admin/users` (team_admin-gated) — invite general users to their team by email

### Team switcher (header)
Shown only to superadmins when `impersonatedTeamId` is null (click to pick a team) or set (click to exit impersonation). Dropdown listing all teams from `availableTeams`.

### Invite flow
Use Supabase's admin API `supabase.auth.admin.inviteUserByEmail()`:
1. Admin enters email + selects role (team_admin if superadmin inviting; always general_user if team_admin inviting)
2. Server-side function (Supabase Edge Function or API route): `inviteUserByEmail(email)` + insert row into `user_team_access`
3. Invitee gets magic link → sets password → lands on `/` logged in, scoped correctly

Need a Supabase Edge Function for the admin API call (can't call `auth.admin.*` from the browser — requires service role key).

### Login page changes
- Signup form removed (login-only)
- Password reset link stays

---

## 8. Decisions already locked

1. **Invite-only, no open signup** ✓
2. **One user = one team** (except superadmins) ✓
3. **Savant is a team-level flag** (`teams.savant_enabled`) — Trevor assigns when ready ✓
4. **Superadmin impersonation = Option A** (view exactly what the team sees) ✓
5. **player_predictions stays global in v1** — team-specific overrides deferred ✓
6. **Existing `user_roles` table repurposed for superadmin only** — team roles live in new `user_team_access` table ✓
7. **Shared tables + RLS (not per-tenant Supabase projects)** — RSTR IQ data platform is one source of truth across all customers. One update, everyone benefits. ✓
8. **Per-team customization via overlay tables** — team_equation_overrides (Tier 3), team_prediction_overrides (future). Global defaults stay shared; per-team tweaks stack on top. No data duplication. ✓

---

## 9. Open decisions / items Peyton should weigh in on

1. **Email provider config** — Supabase default is fine for dev, but for production email deliverability we'll want either (a) SendGrid/Resend custom SMTP or (b) confirm Supabase's default SMTP is good enough for a low-volume invite use case. Recommend Resend, ~$20/month, much better deliverability than free-tier Supabase SMTP.

2. **First team admin account recovery** — if a team admin loses access and there's no other admin on that team, superadmin needs to either: (a) reset their password and hand it back, or (b) create a new team_admin from an assistant. Recommend (b) as the default process — documented in a runbook.

3. **Domain** — still "Peyton decides" per the launch plan. Auth redirect URLs need to know the prod domain. Preview deploys can use Vercel preview URLs during build.

4. **Team naming** — `teams.name` — should it be "UCSB Gauchos" or just "UCSB"? Pick a convention so the team switcher UI is consistent.

5. **Soft delete vs hard delete** — schema has `active boolean` for teams. If a customer churns, flip `active = false` and hide from UI? Or actually delete and cascade all their data? Recommend soft-delete + cleanup script at 90-day retention.

---

## 10. Execution order + estimates

Work happens on `feature/auth` branch off `staging`. PR into `staging` when each chunk is tested.

### Step 1 — Schema + seed (1 day)
- Create `teams`, `user_team_access`, and `team_equation_overrides` tables
- Add `team_id` column to every team-scoped table
- Backfill `team_id` on existing rows (demo school → one initial team)
- Seed superadmin rows in `user_roles`
- Create initial "UCSB" or whichever demo team in `teams`
- Move Trevor + Peyton into it as team_admin too for local testing
- Wire projection engine to read `team_equation_overrides` first, fall back to `Equation Weights` (reads always stay safe — empty overrides table means no change in behavior)

### Step 2 — useAuth refactor (half day)
- Add superadmin detection, effectiveTeamId, impersonation state
- Remove bootstrap-grants-admin logic
- Gate dev bypass to `import.meta.env.DEV`

### Step 3 — DEMO_SCHOOL removal + team switcher (half day)
- Swap initial state in 4 files to `useAuth().effectiveTeamId`
- Build team switcher component in header (superadmin-only visibility)
- Delete `src/lib/demoSchool.ts`

### Step 4 — RLS policies (1-2 days, careful work)
- Write + apply RLS for each team-scoped table
- Write + apply "authenticated read, superadmin write" RLS for each shared table
- Manually verify each policy in Supabase SQL editor before applying
- Run existing smoke tests — shouldn't break anything because superadmins bypass RLS

### Step 5 — Admin routes + invite flow (2-3 days)
- Build `/admin/teams` (create team, invite first admin)
- Build `/admin/users` (invite general users)
- Build Supabase Edge Function for `inviteUserByEmail` wrapper
- Disable signup on `/auth` page (login + password reset only)
- Test invite flow end-to-end with real emails

### Step 6 — Phase 6 isolation test (1 day, HARD GATE)
- Create 2 test teams in Supabase
- Seed each with different target boards, coach notes, team builds
- 2 test users (one per team) logged in simultaneously in different browsers
- Verify user A cannot see user B's data from any route
- Verify direct Supabase queries from the browser blocked by RLS
- Write Playwright test covering the core isolation scenarios
- Integrate into CI — no merge to `main` without passing

**Total: ~1.5 to 2 weeks focused.**

---

## 11. Acceptance criteria (Phase 6 gate)

All of these must pass before the auth work is considered done:

- [ ] Superadmin can log in, see cross-team admin panel, create a new team
- [ ] Superadmin can invite a team admin by email → invitee receives magic link → sets password → lands scoped to their team
- [ ] Team admin can invite a general user → same flow → general user scoped to same team
- [ ] Team admin from Team A cannot see Team B's target board, coach notes, or team builds — verified in UI AND via direct Supabase queries from browser console
- [ ] General user cannot invite other users (UI doesn't show the option, and API calls are rejected)
- [ ] General user cannot change team settings (e.g., toggle savant_enabled)
- [ ] Superadmin impersonation works: click a team, see their view, click exit, return to superadmin view
- [ ] Signup is disabled on `/auth` — only existing invited users can log in
- [ ] Dev bypass mode only activates in local development, never in staging or prod builds
- [ ] RLS policies reviewed by both Trevor and Peyton in Supabase SQL editor before merge to `main`
- [ ] Playwright isolation test suite passes and is wired into CI

---

## 12. Post-auth — what comes next

Once this gates through, remaining Phase 4 (Vercel prod) + Phase 7 (2026 ingest) + Phase 8 (pre-launch checklist) work is mostly admin/config, not code. Reference [project_consolidated_launch_plan.md](../.claude/projects/-Users-danielleogonowski/memory/project_consolidated_launch_plan.md) for the full launch sequence.

First customer target: TBD (set after this work is done and we know the launch date).
