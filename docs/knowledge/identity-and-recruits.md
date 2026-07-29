# Knowledge — Player Identity, Vendor-Agnosticism & Recruits

> Bootstrap draft, 2026-07-28. Captured **live** as Trevor and I worked through the recruit-ID / mobile-add design (still in progress — open questions below are unresolved). Full working spec: `docs/RECRUIT_IDENTITY_AND_MOBILE_ADD_SPEC.md` on branch `feature/recruit-ids-mobile-board`. Facts are code/schema-verified (cited); the model rules are Trevor's judgment, some still `draft` pending his final confirm. Cross-refs [[data-and-numbers]], [[player-dev-data-ownership]] (program-owned data).

The one sentence: **the person's identity is ours and vendor-neutral (`players.id`); vendor IDs are just keys that point at it; a program's tracking/eval data is private and never defines identity.**

---

## The design (Trevor's judgment — some still draft)

### crosswalk-identity: `players.id` is the canonical, vendor-neutral identity; vendor keys live in a crosswalk
- **Rule:** The single source of truth for "who is this human" is **`players.id`** (the UUID we already generate). Every external vendor key — TruMedia's `source_player_id`, a PBR/Perfect Game profile, a future scouting site — is **one row in a `player_external_ids` crosswalk** `(player_id, source, external_id)` with `UNIQUE(source, external_id)`, NOT the identity itself. TruMedia stays a major input; it stops being the spine everything chains to.
- **Why / protecting against:** today `source_player_id` conflates three jobs — identity, TruMedia's key, and the universal join key. That conflation is what blocks (a) **vendor-agnostic ingest** (adding PBR/PG/NCAA means adding a `source`, not re-keying the app) and (b) **de-duplication** (`UNIQUE(source, external_id)` stops one vendor id attaching to two people). Coupling identity to one vendor breaks the moment we ingest a second.
- **Scope:** all player identity + any new data-source ingest. `players.source_player_id` stays as a back-compat column (= the `('trumedia', …)` crosswalk value) during migration so nothing existing breaks.
- **Origin:** Trevor, 2026-07-28 — "we need to be vendor agnostic … able to ingest any scouting site."
- **Status:** draft (Trevor likes it, "especially if it cleans up with the upload and linking").

### identity-shared-tracking-private: separate identity (global) from program tracking (private) from vendor keys (crosswalk)
- **Rule:** Three distinct layers, never conflated: **identity** = global `players.id` (shared app-wide); **program tracking** = `target_board`, `gm_recruits`, notes, offers, dev data (RLS by `customer_team_id`/`user_id`, private per program); **vendor keys** = the crosswalk. Two programs tracking the same recruit keep **two private rows** that merely *point at* the same `players.id`.
- **Why / protecting against:** this is what lets multiple programs recruit the same kid without leaking one program's evals/pricing to another, AND without minting duplicate identities. It's the same principle as [[player-dev-data-ownership]] — program-uploaded data is program-owned and tenant-locked; here the *identity pointer* is the only shared thing. Two separate recruit profiles for one kid is **correct**, not a bug — a future agent must not "fix" it by merging them.
- **Scope:** recruiting board, target board, all program-scoped player data.
- **Origin:** Trevor, 2026-07-28 (RLS/program-specific pressing).
- **Status:** draft.

### add-must-resolve-or-create-a-real-player: an "add a player" never stores a throwaway placeholder
- **Rule:** When a coach adds a player, the flow is **search existing → if found use that `players.id` → if not, resolve-or-create a REAL `players` row** (fresh id + a minted `('rstr', …)` crosswalk id + a `data_status` marking it not-yet-real). The add then stores against a real `player_id`. The old `localPlayer`-JSON-blob path is retired for new adds.
- **Why / protecting against (the whole reason this work exists):** today an add of a not-in-DB player either (a) is **blocked** — `target_board.player_id` is `uuid NOT NULL references players(id)` (`create_target_board.sql:5`), so you can't target anyone not already in `players`; or (b) becomes an **ephemeral blob** — Team Builder stashes a `localPlayer` object in `team_build_players.production_notes` + a `custom_name` column (`20260223013218_…sql:32`), which carries no id, can't hold TrackMan/NewtForce/compliance data, can't be de-duped, can't be linked. Neither "stores properly." Trevor's #1 requirement: an add must land as a durable, linkable entity.
- **Scope:** every "add a player" surface — mobile add, target board, recruiting board, Team Builder.
- **Cite:** `create_target_board.sql:5` (NOT NULL FK); `team-builder/helpers.ts:369-470` (localPlayer blob), `custom_name` column.
- **Origin:** Trevor, 2026-07-28 — "ensure that when a coach adds a player … it stores in the database properly."
- **Status:** draft.

### synthetic-source-id-one-helper-minted-once: mint our own id in the same key space, from ONE helper, stored not re-derived
- **Fact + rule:** We already mint our own `source_player_id`s for non-TruMedia players via `syntheticSourceId(name, team)` → `d2-<sha1(name:team)[:16]>` — but it's **copy-pasted in 4 add scripts** (`add_d2_player.ts`, `add-presto-missing-{hitters,pitchers}.ts`, `add_d2_pitcher_stuff.ts`). Formalizing identity means: (1) **one shared `src/lib/` helper** (per the refactoring policy / [[data-and-numbers]] `one-canonical-formula`); (2) mint an id that is **stored once**, NOT re-derived from mutable `name+team` — a recruit's team changes between commit and enrollment, so a name+team hash would produce a *different* id and break carry-through. Persist the id on the row; never recompute it.
- **Why / protecting against:** 4 copies of an id-minting rule will drift (the "same structure" stops being the same). A re-derived id silently changes when the inputs change — fatal for an identity meant to carry from recruit → freshman → college.
- **Cite:** `scripts/add_d2_player.ts:190` (+ 3 copies).
- **Origin:** Trevor's "use the same structure [as the masters' unique IDs] … that will be the one that carries in from freshman," 2026-07-28.
- **Status:** draft.

### linking-is-confirm-not-guess: never silently auto-merge a recruit to a player without a shared key
- **Rule:** Matching a recruit to an arriving real player can **never be certain** without a shared key (we have **no DOB**). So bias entirely to confirmation, three tiers: **Certain** (shared unambiguous external id — same PBR/PG URL, or same crosswalk id → auto-link, guarded by `UNIQUE(source, external_id)`); **Probable** (name + high school + grad year + "committed to us" align → **suggest, coach confirms**, never silent); **Unknown** (no signal → **start fresh**, new canonical player, recruit profile untouched). Linking happens **lazily** when real data arrives (Hitter/Pitching Master upload or pitch-log recognition), with the coach's **"committed" click as the trigger/hook**.
- **Why / protecting against:** the asymmetry — a wrong auto-merge corrupts a shared identity (bad, hard to unwind); a missed match just means starting fresh (**Trevor's explicitly accepted worst case**). Confirm-don't-guess trades a tolerable failure (start fresh) to avoid an intolerable one (wrong person). The commit click means identity is confirmed by someone who actually knows, not a fuzzy string match.
- **Scope:** all recruit→player resolution.
- **Origin:** Trevor, 2026-07-28 — "how does it know for a fact its the right player?" + "worst case … if it doesnt match up they start fresh" + "rely simply on what program clicks on as committed."
- **Status:** draft.

### recruit-profiles-are-rich-and-program-owned: recruits are first-class player profiles, not just a name on a board
- **Rule (direction, next phase — not this branch):** A recruit is a **rich, program-owned profile** that exists and accrues data *before* they're ever a college player — TrackMan, NewtForce, compliance, offers, admissions status, draft info. The identity spine (above) is what lets that data hang off a stable entity and best-effort follow the person into college. Program-owned per [[player-dev-data-ownership]] (tenant-locked, doesn't cross programs).
- **Why / protecting against:** Trevor's "main worry" — the whole point isn't an ID string, it's that a recruit profile can hold real dev/compliance/recruiting data. Designing identity without this in mind would produce an ID that carries nothing useful.
- **Scope:** future recruit-profile build; pulls in NewtForce + compliance threads.
- **Origin:** Trevor, 2026-07-28 — "we are going to want detailed player profiles for recruits … applications, offers, admissions information, draft info, etc."
- **Status:** draft (vision; scoped build comes after the identity spine).

---

## Facts (verified from schema/code 2026-07-28)

- `players.id` = UUID (`gen_random_uuid()`); `source_player_id` = text, TruMedia-assigned for TruMedia players, `UNIQUE` where non-null, the durable cross-season key today.
- `target_board.player_id` = `uuid NOT NULL references players(id)` (`create_target_board.sql:5`) — hard block on adding a non-`players` person.
- Not-in-DB adds today → `localPlayer` JSON in `team_build_players.production_notes` + `custom_name` text column (`20260223013218_…sql:32`). Ephemeral.
- `gm_recruits` (`20260707150000_gm_recruits.sql`) — team-scoped HS/JUCO prospect board, RLS by `customer_team_id`, **no FK to `players`** (orphaned from identity today). Related: `gm_recruit_events`, `gm_recruit_reports`.
- `players.data_status` CHECK: `complete | partial | no_data | outlier` (a `'prospect'` value would need adding).
- `syntheticSourceId` minted ids already exist in the `source_player_id` space (`d2-<hash>`), 4 copies.

## Resolved (Trevor, 2026-07-28)

1. **`data_status` for a coach-added/not-yet-real player = new `'prospect'` value** (self-documenting; cleanly excluded from rankings/projections until real data links in). Small CHECK-constraint migration + update `data_status` switch sites. *(Proceeding unless Trevor countermands.)*
2. **Mobile surface = the RECRUITING BOARD (`gm_recruits`), NOT the target board** — *corrected 2026-07-28.* Trevor: "this mobile version is only for freshman and juco recruiting board and notes. Portal is different." The mobile page is a phone-first view of the freshman/JUCO recruiting board (matches the original roadmap wording). It writes a **`gm_recruits`** row (program-owned recruit record); the transfer **portal / target board is a separate surface**, not on mobile. The identity foundation (`resolve_or_create_prospect`) is the **later linking spine** (used when the recruit's real data arrives) — NOT wired into the mobile add. `gm_recruits` is self-contained (no `players` FK needed), so the earlier "target-board NOT NULL FK → resolve-or-create" concern does not apply to this screen.
3. **`player_external_ids` RLS = app-wide readable.** Identity is global and the crosswalk holds only identity↔vendor-key mappings (no program-private data), so no bleed-over. Writes controlled (service / authenticated-with-care).

## Build sequence (Trevor, 2026-07-28)
1. **Storage foundation** — ✅ **BUILT + verified on staging 2026-07-28.** Migrations `20260728120000` (crosswalk + `data_status='prospect'`) and `20260728121000` (`resolve_or_create_prospect` RPC) on `feature/recruit-ids-mobile-board`. Round-trip verified in-DB (mint → prospect row + rstr/pbr crosswalk → same-external-key resolves w/o dup → fresh-mint fallback → empty-name guard). **Not on prod yet** — promotes with the feature PR (Trevor drives the main merge).
2. **Agree this spec** — ✅ open questions resolved.
3. **Mobile recruiting board** — ✅ **BUILT 2026-07-28.** `src/pages/mobile/MobileRecruiting.tsx`, route `/m/recruiting` (ProtectedRoute). Phone-first `gm_recruits` view: **year dropdown + position-group toggle** (replaces the desktop 3-column position-group layout — Trevor: "it just needs to fit"), scannable recruit list by name, condensed add, dated timeline notes. Reuses `useGmRecruits` wholesale. tsc clean. **Ships to prod WITH the identity foundation** — one feature PR (Trevor: design mobile before pushing to prod).

### mobile-is-a-condensed-capture-surface: trim to what matters in the car; web carries the rest
- **Rule (Trevor, 2026-07-28):** the mobile recruiting page is a *condensed* capture surface — identify the recruit + drop a dated note, fast. Mobile add fields = first/last name, position, level (HS/JUCO-FR/JUCO-SO), high school, optional PBR/PG link (stage defaults Evaluating). Everything richer (stage funnel, tier, contacts, travel org, state, asking price / target offer / scholarship %, scouting reports) is **web-only**. Layout swaps the desktop 3 position-group columns for a **position toggle**, and the year strip for a **year dropdown** — one column, phone-fit.
- **Why:** a coach at a game can't fill a 20-field form or navigate 3 columns on a phone; forcing it kills adoption. Condensed mobile + full web.
- **Status:** confirmed (Trevor).

### notes-are-a-dated-timeline-compliance: recruiting notes are an append-only dated contact log
- **Rule (Trevor, 2026-07-28):** recruiting notes must carry their **own date** — an append-only **timeline** of contact/recruitment entries ("called his coach", "unofficial visit"), for **compliance**. The store is **`gm_recruit_events`** (`event_date` DATE + `note` text, authored via `created_by_user_id`, team-scoped) — it already exists; nothing to add. `gm_recruit_reports` (fuller authored scouting reports) is the web-heavy surface, not the mobile focus. Mobile writes timeline entries via `useGmRecruits().addEvent(recruitId, eventDate, note)`; `event_date` is settable so a coach can log "called yesterday" accurately.
- **Why / protecting against:** compliance needs a defensible dated record of every contact; a single overwrite field destroys history. This supersedes the earlier (target-board-era) guess that pointed at `gm_target_notes`/`coach_notes` — those are for the target board, a different surface.
- **Status:** confirmed (Trevor). Supersedes the earlier `notes-are-a-dated-authored-log-compliance` target-board framing.

## Verified facts from the build (2026-07-28)
- **`resolve_or_create_prospect` enforces confirm-don't-guess IN SQL:** it auto-resolves an identity ONLY when an exact `(source, external_id)` crosswalk key already exists (e.g. a shared PBR profile). It has **no name-based matching at all** — picking an existing player from a name search stays the UI's job (coach-confirmed). This is the load-bearing safety property: the writer physically cannot silently merge a coach's add onto a wrong same-name player.
- **The rstr key lives in the same space as `source_player_id`:** a minted prospect gets `players.source_player_id = 'rstr-<uuid-hex>'` AND a `('rstr', same)` crosswalk row (`= players.source_player_id`). This is Trevor's "same structure … carries in from freshman" — the id is real from day one; when TruMedia data later arrives, linking reconciles (add `('trumedia', …)`; keep or repoint per the linking policy).
- **Cross-program de-dup without a fuzzy match:** if a second program pastes the same external profile key, the RPC's exact-key branch resolves to the SAME identity — the multi-team "one person, two private boards" outcome, achieved by a deterministic key, not a guess.
- **`target_board` is already team-shared** (`target_board_select` = `is_team_member(customer_team_id)`), so a coach's mobile add is visible to the whole staff on the web with no RLS change. Rows are user-owned (`unique(user_id, customer_team_id, player_id, …)`) but program-readable.

---

## Mobile Recruiting Board — BUILT (2026-07-29)

The `/m/recruiting` page (`src/pages/mobile/MobileRecruiting.tsx`, `feature/recruit-ids-mobile-board`) is a phone-first view of the GM recruiting board (`gm_recruits`), reusing `useGmRecruits` wholesale. Full detail: `docs/RECRUIT_IDENTITY_AND_MOBILE_ADD_SPEC.md` (feature branch) → "Mobile Recruiting Board — AS BUILT".

- Controls: class-year dropdown + **All/HS/JUCO** level filter (mirrors desktop `matchLevel` = `level==='hs'` vs not) + Hitters/Pitchers/Two-Way position toggle; defaults to nearest class (`years[0]`).
- Add dialog: name + **cell/email**, position as **6 GROUPS** (Catcher/Corner IF/Middle IF/OF/Pitcher/TWP; stores a representative position so the desktop board groups it), level, HS, PBR link; **live name dup-detection** (matching board recruits → "open instead" chips, no fuzzy silent merge); **＋Add Scouting Report** (gold) + **＋Add Notes** (green) via a shared composer popup, written on save via `useGmRecruits.addRecruit(recruit, initialReport, initialEvent)` (hook extended with `initialEvent`).
- Detail sheet: condensed one-line rows tap-to-expand for **reports** (`gm_recruit_reports`) + **timeline** (`gm_recruit_events`); app Popover+Calendar date picker (no native input); `autoComplete="new-password"` to kill Chrome autofill.
- Not on prod; ships with the feature PR. Distribution TBD (login-gated URL → home-screen bookmark or a nav link); superadmin must impersonate a team.

## Scouting Report v2 — grades / velo / consensus / video (DESIGN — not built)

> Full design in the spec (feature branch). Records here so the agent remembers the model + the open decisions. Trevor 2026-07-28→29. Applies to mobile grader AND the web GM report.

### grades-are-per-look-history-not-overwritten
- **Rule:** each dated report carries its own `grades` — new grades are entered **with every report** and are **never overwritten**, so a player accrues a **timeline** of evaluations (velo 88→91, Hit Above Avg→Plus). The **latest report = the "current" grade** (mirror the latest onto the recruit card, exactly as `projection_tier` is mirrored today). ＋Add Report **pre-fills the last report's grades** to nudge what changed — still saved as a NEW dated snapshot.
- **Why / protecting against:** a coach's fall read differs from spring; overwriting hides development. History is the point of scouting. Rejected the alternative (single "current grades" set that each report overwrites) because it loses progression.
- **Storage:** `grades` JSONB on `gm_recruit_reports` (per-report, "works like production notes"). Team field template = a `gm_scout_template` config (per team, per hitter/pitcher; ordered `{key,label,type:grade|text}`), RLS team-scoped, seeded with defaults → renameable/addable per staff.
- **Status:** confirmed (model). Field set/scale/sequencing = open decisions below.

### grade-scale-is-words-not-20-80
- **Rule:** grades use a **word scale** — `Below Avg · Average · Above Average · Plus · Elite` (open: add "Well Below" for 6). NOT the 20–80 scale (Trevor: baseball-specific, not every staff uses it). Defaults: **hitters** Hit/Power/Run/Field/Arm/Athleticism; **pitchers** Velocity (FREE TEXT — a number *or* range like `90–93`, NOT graded) + FB/Breaking/Change/Command/Athleticism. Keep the existing **tier** (Draft Prospect→Developmental). All optional/progressive.
- **Status:** confirmed direction; exact field list/scale pending final confirm.

### consensus-grade-designed-for-built-later
- **Rule:** individual dated reports = the **evidence/history**; a **consensus** = one **program-official grade per recruit**, set in a board meeting from the individual looks, reusing the same grader UI but written to a **recruit-level "Final Grade" slot** (editable), and it's what would drive the card badge/tier/rankings. **Not Phase 1** — but the JSONB grade shape makes it a drop-in (one consensus slot + a "Set Final Grade" action). Trevor unsure it's necessary; build if a program formalizes board meetings.
- **Why:** don't design the grade storage in a way that blocks a later program-consensus layer; per-report history + a recruit-level consensus slot cover both without rework.
- **Status:** parked (designed-for, built-later).

### OPEN DECISIONS (pick up here before Phase 1)
1. **Sequencing** — fixed defaults first (grades on mobile+web fast) vs. customizable template up front. *(lean: defaults-first.)*
2. **Customization depth + where edited** — rename-only vs. full add/remove/reorder + custom fields; web GM settings that mobile inherits. *(lean: full, web-edited, mobile inherits.)*
3. **Default fields + scale** — confirm 5 words (or 6) + the hitter/pitcher lists.
4. **Video** — LAST phase; storage bucket + `gm_recruit_video`; attach per-recruit (film library). *(lean: confirm.)*
