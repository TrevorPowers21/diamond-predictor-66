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
2. **Mobile add surface = the target board.** The mobile page is a **quick coach tool** — see a player already on the board, **add a new player**, consolidate notes, "from the car" — that syncs to the **team-shared** target board so the head coach / other assistants see it on the web. Writes to `target_board`, NOT `gm_recruits`. HS/JUCO recruit profiles are a separate later concern. The add-new path still needs resolve-or-create (target board's NOT NULL FK).
   - **Dependency:** "other staff see it on the web" requires `target_board` to be **team-shared** (program-scoped read) — it is (`reference_rls_scoping`); the `unique(user_id, …)` means rows are user-owned but program-readable. Verify during build.
3. **`player_external_ids` RLS = app-wide readable.** Identity is global and the crosswalk holds only identity↔vendor-key mappings (no program-private data), so no bleed-over. Writes controlled (service / authenticated-with-care).

## Build sequence (Trevor, 2026-07-28)
1. **Storage foundation** — ✅ **BUILT + verified on staging 2026-07-28.** Migrations `20260728120000` (crosswalk + `data_status='prospect'`) and `20260728121000` (`resolve_or_create_prospect` RPC) on `feature/recruit-ids-mobile-board`. Round-trip verified in-DB (mint → prospect row + rstr/pbr crosswalk → same-external-key resolves w/o dup → fresh-mint fallback → empty-name guard). **Not on prod yet** — promotes with the feature PR (Trevor drives the main merge).
2. **Agree this spec** — ✅ open questions resolved.
3. **Mobile add page** — ⏳ NEXT: coach's logged-in phone view (NOT a public share link — Trevor). View team-shared target board, add a new player via the RPC, jot notes. Stitch-first (UI change).

## Verified facts from the build (2026-07-28)
- **`resolve_or_create_prospect` enforces confirm-don't-guess IN SQL:** it auto-resolves an identity ONLY when an exact `(source, external_id)` crosswalk key already exists (e.g. a shared PBR profile). It has **no name-based matching at all** — picking an existing player from a name search stays the UI's job (coach-confirmed). This is the load-bearing safety property: the writer physically cannot silently merge a coach's add onto a wrong same-name player.
- **The rstr key lives in the same space as `source_player_id`:** a minted prospect gets `players.source_player_id = 'rstr-<uuid-hex>'` AND a `('rstr', same)` crosswalk row (`= players.source_player_id`). This is Trevor's "same structure … carries in from freshman" — the id is real from day one; when TruMedia data later arrives, linking reconciles (add `('trumedia', …)`; keep or repoint per the linking policy).
- **Cross-program de-dup without a fuzzy match:** if a second program pastes the same external profile key, the RPC's exact-key branch resolves to the SAME identity — the multi-team "one person, two private boards" outcome, achieved by a deterministic key, not a guess.
- **`target_board` is already team-shared** (`target_board_select` = `is_team_member(customer_team_id)`), so a coach's mobile add is visible to the whole staff on the web with no RLS change. Rows are user-owned (`unique(user_id, customer_team_id, player_id, …)`) but program-readable.
