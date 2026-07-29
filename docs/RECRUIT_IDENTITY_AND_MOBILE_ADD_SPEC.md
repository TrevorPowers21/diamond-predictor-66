# Spec — Player Identity, "Add a Player" storage, & the mobile add flow

> Status: **DRAFT for Trevor's review.** Worked through 2026-07-28. This is the "acknowledge how we do that" before we build. Nothing here is built yet. Sequenced: (1) get the storage right, (2) agree this spec, (3) build the mobile add page.

## Why this exists (the problem, from the code)

Trevor's core requirement: **when a coach adds a player — especially from a phone — it must store in the database *properly*.** Not as an orphan, not as a duplicate, not as a throwaway. Today it can't:

- **`target_board.player_id` is `uuid NOT NULL references players(id)`** (`create_target_board.sql:5`). You cannot add a player to the target board unless they already exist in `players`. A brand-new player (a recruit, a name a coach jots down at a game) is **blocked by the FK**.
- **Team Builder's only path for a not-in-DB player is a `localPlayer` JSON blob** in `team_build_players.production_notes` + a `custom_name` column ("for manually typed portal targets", `20260223013218_…sql:32`). It's an **ephemeral placeholder** — no real `players` row, no id, can't carry TrackMan/NewtForce/compliance data, can't be de-duped, can't be linked to the person when they show up for real.

So there is no clean way to add a new player and have it become a real, durable, linkable entity. That's the gap.

## The reframe — separate three things `source_player_id` currently conflates

Today `source_player_id` is doing three jobs: the person's **identity**, TruMedia's **vendor key**, and the **join key** everything uses. That conflation is what makes multi-team recruiting and vendor-agnosticism hard. Split them:

1. **Identity (global, ours, vendor-neutral):** `players.id` (UUID we already generate). The single canonical "who is this human." Not TruMedia's, not any vendor's.
2. **Program tracking (private, team-scoped):** `target_board`, `gm_recruits`, notes, offers, etc. — RLS by `customer_team_id`/`user_id`, exactly as today. Two programs tracking the same kid = two private rows, **by design**. This is consistent with the existing rule that program-uploaded player data is program-owned and tenant-locked (memory `project_player_dev_data_ownership`).
3. **Vendor keys (a crosswalk, many-per-player):** a new `player_external_ids` table — `(player_id, source, external_id)`, `UNIQUE(source, external_id)`. TruMedia's numeric id becomes one row `('trumedia','123456')`. A PBR/PG profile becomes `('pbr', …)`. Our synthetic ids become `('rstr', …)`. **Ingest any scouting site by adding a `source`, never by changing identity.** TruMedia stays a major input; it stops being the thing everything is chained to.

`players.source_player_id` stays as a back-compat/convenience column during migration (= the `('trumedia', …)` crosswalk value), so nothing existing breaks.

## Precedent already in the code

We already mint our own `source_player_id`s for non-TruMedia players via `syntheticSourceId(name, team)` → `d2-<sha1(name:team)[:16]>` (copy-pasted in 4 add scripts: `add_d2_player.ts`, `add-presto-missing-{hitters,pitchers}.ts`, `add_d2_pitcher_stuff.ts`). This is the "same structure" idea Trevor described — a synthetic id in the same text-key space. Formalizing it means: **one shared `src/lib/` helper** (per the refactoring policy — no more 4 copies), and minting an id that is **stored once**, not re-derived from mutable name+team (a recruit's team changes; a stored id must not).

## The "add a player" storage flow (resolve-or-create)

When a coach adds a player from any surface (mobile, target board, recruiting board):

1. **Search existing `players` first.** If they pick an existing player → use that `players.id`. Done (this already works).
2. **If not found → resolve-or-create a canonical `players` row** (this is the new part). Create a real `players` row with a fresh `id`, a minted `('rstr', …)` crosswalk id, `data_status` marking it a coach-added / prospect entity (the `data_status` CHECK already has `'partial'|'no_data'`; add a `'prospect'` value or reuse `'no_data'`), and the name/position/team/class the coach typed.
3. **Then the add stores against a real `player_id`** — target board FK is satisfied, the entity can carry data and be linked later. No more `localPlayer` blobs.

The `localPlayer`/`custom_name` path gets **replaced** by this for new adds (existing blobs migrate opportunistically, not urgently).

## Matching & linking — **confirm, don't guess**

The honest truth: without DOB, automatic matching can **never be certain**. The asymmetry decides the policy — a wrong auto-merge corrupts a shared identity (bad, hard to unwind); a missed match just means the recruit profile stands alone and the real player starts fresh (**acceptable worst case, per Trevor**). So bias entirely toward confirmation. Three tiers:

- **Certain → auto-link.** Only when a *shared unambiguous external id* exists on both sides — same PBR/PG profile URL, or the same crosswalk id. `UNIQUE(source, external_id)` makes it deterministic and blocks one vendor id from attaching to two people.
- **Probable → suggest, coach confirms.** name + high school + grad year + "committed to us" line up → the app asks "is this your recruit Johnny Smith?" Never silent.
- **Unknown → start fresh.** New canonical player; the recruit profile is untouched. The accepted worst case.

**The coach's "committed" click is the linking hook** — it's the coach asserting "this person will become our player," the natural human-verified moment to look for a match and be primed to link when real data (masters / pitch log) arrives. Identity is confirmed by someone who actually knows, not a string match.

**When linking happens:** lazily, at the moment real competition data arrives (Hitter/Pitching Master upload, or recognition from the pitch log), aided by the commit signal — not eagerly at add-time. (Trevor's call.)

## Recruit profiles — the real target (next phase, not this branch)

The bigger goal underneath the ID: **a recruit is a first-class, rich, program-owned profile** that exists and accrues data before they're ever a college player — TrackMan, NewtForce, compliance, offers, admissions status, draft info. The identity spine above is what lets that data hang off a stable entity and (best-effort) follow the person into college. This is its own scoped build after the spine + storage land; it pulls in the NewtForce and compliance threads.

## RLS / multi-team

Unchanged and central: `target_board` (by `user_id`/`customer_team_id`), `gm_recruits` (by `customer_team_id`) stay program-private. The **shared** thing is only the global `players` identity + the crosswalk; the private tracking/eval/dev data never crosses programs. Any new table (`player_external_ids`) needs its RLS defined explicitly (identity crosswalk is likely readable app-wide like `players`, writable by service/authenticated-with-care).

## Sequenced build plan

1. **Storage foundation** — ✅ **DONE + verified on staging (2026-07-28).** `player_external_ids` crosswalk (+ app-wide read RLS), `data_status='prospect'`, and `resolve_or_create_prospect()` RPC (single authoritative writer; exact-external-key auto-link only, else fresh mint). Migrations `20260728120000` + `20260728121000`. Round-trip verified in-DB (mint → prospect row + rstr/pbr crosswalk → same-key resolves, no dup → fresh mint fallback → empty-name guard). *Not yet on prod — promotes with the feature PR, Trevor drives.*
   - Remaining minor cleanup: consolidate the 4 `syntheticSourceId` copies into one `src/lib/` helper (the deterministic `d2-` import-script id — separate from the RPC's rstr mint; low priority).
2. **Agree this spec** — ✅ open questions resolved (see above).
3. **Mobile add page** — ⏳ NEXT: the phone-friendly coach tool — view the team-shared target board, **add a new player** (→ `resolve_or_create_prospect` → insert into `target_board`), consolidate notes. Built on #1 so every add stores correctly. Design via Stitch first (UI change).

## ⚠️ Surface correction (Trevor, 2026-07-28) — mobile = RECRUITING BOARD, not target board

The mobile page is the **freshman/JUCO recruiting board** (`gm_recruits`), NOT the transfer target board — **portal is a separate surface**. This snaps back to the original roadmap wording ("mobile link for the recruiting board"). Consequence: the mobile add writes a **`gm_recruits`** row (program-owned recruit record), and notes are the **dated contact TIMELINE** (`gm_recruit_events`: `event_date` + `note`) — which already exists, nothing to add. The identity foundation (`player_external_ids` / `resolve_or_create_prospect`) is the **later linking spine** (used when a recruit's real data arrives), NOT wired into the mobile add.

**BUILT 2026-07-28:** `src/pages/mobile/MobileRecruiting.tsx`, route `/m/recruiting` (ProtectedRoute). Year dropdown + position-group toggle (replaces desktop 3 columns), scannable recruit list, condensed add (first/last/position/level/HS + optional PBR link), dated timeline notes via `useGmRecruits().addEvent`. tsc clean. Reuses `useGmRecruits` wholesale.

## Mobile V1 — earlier target-board framing (SUPERSEDED by the correction above)

**Principle:** mobile is a *condensed* capture surface — "add the player, drop the note, from the car." The web version carries everything richer; mobile trims to what matters in the moment. The coach reviews/fills the rest on web.

**Mobile fields (add-new player):** first name, last name, **position**, **team / high school**, **note**, and an **optional PBR/PG link** (the de-dup anchor; kept for V1, may need user validation — Trevor isn't the end user). Status defaults to `WATCHING`. Adding an *existing* player (search hit) skips all of this — just tap and note.

**Notes are a dated, authored append-only LOG — compliance requirement (Trevor).** Every note carries its own date + author; never a single overwrite field. Reuse an existing dated log — `gm_target_notes` (has explicit `note_date DATE` + `author` + `created_at`, team-scoped `is_team_member`) or `coach_notes` (`content`, `user_id`, `created_at`). **Build task: confirm which one the web target board reads, and write mobile notes to that same log so mobile/web are consistent.**

**Web-only (carries more values, not on mobile):** stage funnel, projection tier, phone/email/guardian/coach contacts, travel org, state, level, asking price / target offer / scholarship %, offer amount, projection recipe. All keyed to the same `player_id`, so a mobile add is fully fleshed out later on web with nothing lost.

**Two motions on the screen:** (1) *see* the team-shared target board as a scannable phone list (name · position · team · status); (2) *add* (search existing → tap → note; or ＋new → the fields above). Note-first: tap any player → add a dated note.

**Ships to prod WITH the identity foundation** (Trevor: design mobile before we push this to prod) — one feature PR.

## Resolved (Trevor, 2026-07-28)

- **`data_status` for a coach-added/not-yet-real player:** new dedicated **`'prospect'`** value (self-documenting; cleanly excluded from rankings/projections until real data links in). *Proceeding with this unless Trevor says otherwise — small CHECK-constraint migration + update the places that switch on `data_status`.*
- **Mobile add surface = the target board.** The mobile page is a **quick coach tool**: see a player already on the board, **add a new player**, and consolidate notes — "from the car." It syncs to the **team-shared** target board so the head coach and other assistants see it on the web version. So the mobile add writes to `target_board` (not the GM `gm_recruits` recruiting board). HS/JUCO recruit profiles stay a separate, later concern. The add-new path still needs the resolve-or-create storage foundation (target board's NOT NULL FK).
- **`player_external_ids` RLS = app-wide readable.** Identity is global, and the crosswalk holds only identity↔vendor-key mappings (no program-private data), so there's no bleed-over risk. Writes controlled (service / authenticated-with-care).

## Dependency to confirm during build
The mobile page's "other staff see it on the web" requires the **target board to be team-shared** (program-scoped read), which the RLS is (`reference_rls_scoping`: `target_board` scoped by `customer_team_id`). Verify a coach's mobile add is visible to the whole staff (the `unique(user_id, …)` on `target_board` means rows are user-owned but program-readable) before relying on it.

---

# Mobile Recruiting Board — AS BUILT (2026-07-29)

Route **`/m/recruiting`** (ProtectedRoute), `src/pages/mobile/MobileRecruiting.tsx`, reuses `useGmRecruits` wholesale. Coach's phone tool; superadmin must impersonate a team. NOT on prod — ships with the feature PR. Distribution TBD (login-gated URL → home-screen bookmark, or a nav link).

- **Controls:** class-year dropdown + **All/HS/JUCO** level filter (blue, mirrors desktop `matchLevel`) + **Hitters/Pitchers/Two-Way** position toggle (gold). Defaults to the nearest class (`years[0]`).
- **Rows:** gold-initial chip · name · position/level/HS · stage badge · report/note count. Tap → detail sheet.
- **＋Add Recruit dialog** (matches desktop `Dialog` style): First/Last · **Cell Phone + Email** (contact info) · **Position GROUPS** (Catcher/Corner IF/Middle IF/OF/Pitcher/TWP — stores a representative position so the desktop board groups it) · Level · High School · PBR link. **Live dup-detection:** typing a name surfaces matching board recruits as "open instead" chips (avoids double-add). **＋Add Scouting Report** (gold) and **＋Add Notes** (green) open the *shared composer popup*; attach as editable chips; written on save via `addRecruit(recruit, initialReport, initialEvent)`.
- **Detail sheet:** condensed one-line rows (tap to expand) for **Scouting Reports** (`gm_recruit_reports`) + **Contact Timeline** (`gm_recruit_events`); ＋Add opens roomy composer popups; app **Popover+Calendar** date picker (no native date input); `autoComplete="new-password"` kills Chrome autofill.
- **Hook change:** `useGmRecruits.addRecruit` now also takes an optional `initialEvent` (writes a first `gm_recruit_events` row).

---

# Scouting Report v2 — grades / velo / consensus / video (DESIGN — not built; Trevor 2026-07-28→29)

The scouting report becomes the product's core: a coach on the road consolidates evaluations on a player. Applies to the **mobile grader AND the web GM report**.

## Model (settled)
- A report is a **detailed write-up (text) first, grades after.** All **optional/progressive** — save just text now, grade later. **Keep the tier** (Draft Prospect → Developmental).
- **Grades are word-based, NOT 20–80** (Trevor: 20–80 is baseball-specific, not every staff uses it). Scale: **Below Avg · Average · Above Average · Plus · Elite** (open: add a low-end "Well Below" for 6?).
- **Default fields** (a team can change them later):
  - **Hitters:** Hit, Power, Run, Field, Arm, Athleticism.
  - **Pitchers:** **Velocity** (FREE TEXT — accepts a number *or* a range like `90–93`, NOT graded) + FB, Breaking, Change, Command, Athleticism (word scale).
- **Grades are PER-LOOK HISTORY, never overwritten** ⭐ — each dated report carries its own `grades`, so you get a timeline (velo 88→91, Hit Above Avg→Plus). The **latest report = the "current" grade** (mirror the latest onto the recruit card, same as the tier is mirrored today). **Carry-forward UX:** ＋Add Report pre-fills the last report's grades so a coach nudges what changed — still saved as a NEW dated snapshot.

## Storage (recommended)
- **Grades** = a `grades` JSONB blob on `gm_recruit_reports` (the "works like production notes" model). One row = one dated look with text + grades.
- **Team template** = a `gm_scout_template` config (per team, per hitter/pitcher: ordered `{key, label, type: grade | text}`), seeded with the defaults — the thing that makes fields renameable/addable per staff, RLS team-scoped.

## Consensus final grade (DESIGNED-FOR, BUILT-LATER)
Individual dated reports = the **evidence/history**. A **consensus** = one **program-official grade per recruit** — the staff sits down in a board meeting, pulls the individual looks side by side, and sets one agreed grade. Reuses the **exact same grader UI**, just writes to a **recruit-level "Final Grade" slot** (editable when they re-meet); it's what would drive the card badge / tier / rankings. **Not Phase 1** — but the JSONB grade shape means it's a drop-in later (one consensus slot on the recruit, a "Set Final Grade" action). Trevor unsure it's necessary; flip on if a program formalizes board meetings.

## Video (LAST phase)
Store + share film on a recruit. Supabase **storage bucket** + a `gm_recruit_video` table (team-scoped). Lean: attach **per-recruit** (their film library), not per-report. Heaviest piece (upload/playback/hosting) → deferred to last.

## DECISIONS — RESOLVED (Trevor, 2026-07-29)
1. **Sequencing = fully-customizable template UP FRONT** (not defaults-first). Phase 1 includes the editable template.
2. **Customization = full.** Staff can **rename / add / remove / reorder** fields AND **rename the grade-scale words**. Separate templates per **hitter / pitcher / TWP**. TWP = hitter set ∪ pitcher set (all 10 fields) with a **single shared Athleticism**. Defaults seeded (below), all editable.
   - **Edited on WEB, under a new "GM Settings" area** — what's now the recruiting board's "Edit Budget" button moves under GM Settings, alongside **Scouting Template** and any future editable config. Mobile grader + web report both READ the one team template.
   - **Roles deferred** — team_admin/head coach in practice; no explicit gating now (folded into the later role-access pass).
3. **Scale = 5 words** (`Below Avg · Average · Above Average · Plus · Elite`), labels editable per team; no low-end 6th. **Default fields:** hitters Hit/Power/Run/Field/Arm/Athleticism; pitchers Velocity (free text) + FB/Breaking/Change/Command/Athleticism. Templates must let a staff **add pitches** (2nd breaking ball, splitter, cutter…). Keep the tier.
4. **Video = in scope, per-recruit, team-RLS'd (zero bleed-over), attached to the account** — but **NOT stored forever: auto-scrub after a set age** (retention/lifecycle from day one). Bucket + `gm_recruit_video` (recruit_id, customer_team_id, storage_path, created_at, expires_at). Owner-restricted storage setup goes through the dashboard.

### Storage guardrail (makes "customizable + history" safe)
Grades in the `grades` JSONB are keyed by a **stable field `key`** and store a **scale ordinal (1–5)**, NOT the visible label. Renaming a field or relabeling the scale only changes the template's `key→label` map — **old graded reports never break**. Velocity/free-text fields store their raw string.

### Template shape (`gm_scout_template`)
Per `(customer_team_id, player_type)`: an ordered list of fields `{ key, label, type: 'grade' | 'text', order }` + a per-team scale `[{ ordinal, label }]` (default 5 words). Seeded with the defaults; edited on the web GM Settings → Scouting Template screen. Both surfaces render the grader dynamically from this.

### Build sequence (Phase 1 = the whole customizable grader)
1. **Migrations (staging-first):** `gm_recruit_reports.grades` JSONB; `gm_scout_template` (+RLS team-scoped); seed defaults per existing team; `gm_recruit_video` (+RLS) + storage bucket with a lifecycle/expiry.
2. **Web GM Settings** area — house Budget (moved) + new **Scouting Template** editor (add/rename/remove/reorder fields, relabel scale, per hitter/pitcher/TWP).
3. **Dynamic grader** rendered from the team template — on the **mobile** report composer (grades after the write-up, per-look history, carry-forward prefill) AND the **web** GM report.
4. **Video** — per-recruit upload/list/playback with auto-scrub.
5. **(later)** consensus Final-Grade slot on the recruit (reuses the grader).
