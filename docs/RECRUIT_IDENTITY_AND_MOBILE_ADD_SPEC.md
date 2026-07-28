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

## Resolved (Trevor, 2026-07-28)

- **`data_status` for a coach-added/not-yet-real player:** new dedicated **`'prospect'`** value (self-documenting; cleanly excluded from rankings/projections until real data links in). *Proceeding with this unless Trevor says otherwise — small CHECK-constraint migration + update the places that switch on `data_status`.*
- **Mobile add surface = the target board.** The mobile page is a **quick coach tool**: see a player already on the board, **add a new player**, and consolidate notes — "from the car." It syncs to the **team-shared** target board so the head coach and other assistants see it on the web version. So the mobile add writes to `target_board` (not the GM `gm_recruits` recruiting board). HS/JUCO recruit profiles stay a separate, later concern. The add-new path still needs the resolve-or-create storage foundation (target board's NOT NULL FK).
- **`player_external_ids` RLS = app-wide readable.** Identity is global, and the crosswalk holds only identity↔vendor-key mappings (no program-private data), so there's no bleed-over risk. Writes controlled (service / authenticated-with-care).

## Dependency to confirm during build
The mobile page's "other staff see it on the web" requires the **target board to be team-shared** (program-scoped read), which the RLS is (`reference_rls_scoping`: `target_board` scoped by `customer_team_id`). Verify a coach's mobile add is visible to the whole staff (the `unique(user_id, …)` on `target_board` means rows are user-owned but program-readable) before relying on it.
