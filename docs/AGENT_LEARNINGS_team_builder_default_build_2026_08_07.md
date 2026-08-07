# Agent learnings — Team Builder default-build + returners (UCSB bug, 2026-08-07)

Captured for the **RSTR IQ dev agent**. A new customer team (UCSB) was set up, the precompute ran, but
"start a build" did nothing on both the eval and roster-management sides. Root cause was a **cluster of
name-vs-ID lookups** plus one **wrong storage mechanism** — all surfaced by UCSB being the first team whose
`team` text differs from its abbreviation. Record shape: **rule — why — what it protects against.**

## The bug cluster (all one theme: IDs over names)

- **Returner lookup by team NAME silently skips the whole build.** `createOrRefreshDefaultBuild`
  (supabase/functions/process-precompute-jobs) found returners via `players.team ILIKE schoolName`, where
  `schoolName` = the Teams Table **abbreviation** ("UCSB"). UCSB's players store the **full name**
  ("UC Santa Barbara") in `team`, so it matched **0** returners → `return null` → **no default build**. The
  precompute itself worked because it finds the roster by **`source_team_id`** (the canonical id). *Fix:*
  look up returners by `source_team_id` (resolve `Teams Table.source_id` from `school_team_id`), never the
  `team` text. *Protects against:* one code path using ids and its sibling using names — the classic drift
  that only breaks on the first team where name≠abbreviation.

- **Build-player toggle state is SERIALIZED JSON in `production_notes`, NOT top-level columns.** The same
  function tried to write `roster_status`/`class_transition`/`dev_aggressiveness`/`class_transition_overridden`/
  `dev_aggressiveness_overridden`/`depth_role` as **columns** on `team_build_players` — which **don't exist**
  (verified absent on BOTH staging AND prod; `PGRST204/42703`). So the player insert failed → build deleted →
  null. The app stores all of that inside a single `production_notes` JSON blob tagged
  `__team_builder_metrics_v1`, via `serializeBuildPlayerMeta`/`parseBuildPlayerMeta`
  (src/pages/team-builder/helpers.ts). *Fix:* the edge function now serializes into `production_notes` in that
  exact shape (`buildPlayerMetaJson`), matching the app. *Protects against:* an edge function drifting ahead
  of the schema by inventing columns the app never had — it had silently failed for every new team since the
  code was added (last working default build was ~a month prior; the next new team, UCSB, surfaced it).

- **The frontend `returners` query has the SAME name-fragility.** `useTeamBuilderData.ts` loads returners by
  `team_id` (primary) or `team` name (fallback/merge). On staging UCSB has `team_id = null` (stale copy) AND
  `team = "UC Santa Barbara"` ≠ selectedTeam "UCSB" → **0 returners** → the "New Build → start from default
  roster" button (`newBuild()` builds from `returners`) produced an **empty roster = "nothing happens."**
  *Protects against:* assuming a backend fix is complete — the same name lookup lived in the client.

## The data anomaly that exposed it all

- **Every team's roster stores the ABBREVIATION in `players.team`; UCSB stored the full name.** BYU→"BYU",
  Georgia→"Georgia", Cal Poly→"Cal Poly", but UCSB→"UC Santa Barbara" (abbr "UCSB"). So UCSB's roster import
  set `team` wrong. *Fix (data):* `update players set team='UCSB' where source_team_id='730364160' and
  team='UC Santa Barbara';` — aligns UCSB with the convention and unblocks the frontend name-fallback.
  *Protects against:* treating the symptom (each broken lookup) instead of the shared cause (one bad `team`
  value). Correcting the data fixes multiple name-based paths at once.

## Method notes (transferable)

- **Test the actual insert to get the REAL error — don't infer.** I first *inferred* the missing-column
  failure from a column-existence probe; the definitive proof was attempting the exact `team_build_players`
  insert (with vs without the 6 keys) → `PGRST204: could not find 'class_transition'` vs SUCCEEDED. Inference
  named the right cause but the insert test *proved* it in one call.
- **"Certified/works elsewhere" ≠ "schema is present" — check BOTH environments.** I nearly called the 6
  columns a staging-staleness issue (like `team_id` null, which IS staging-only — prod has it populated,
  verified 29/29, 34/34…). But a read-only prod check showed the 6 columns are missing on **prod too** — so
  it was code-ahead-of-schema everywhere, not a stale copy. Always confirm the assumed-good environment.
- **Target-board rows legitimately have `production_notes`/`player_snapshot` = null** and use
  `transfer_snapshot`/`neutral_snapshot` instead (checked across all rows). Don't flag a null as a bug without
  the norm.
- **A row-count delta between two data sources is not necessarily duplication** (see the dRS over-count doc):
  content-match / verify before concluding.

## Status (2026-08-07)
Edge-function fixes (source_team_id returner lookup + `buildPlayerMetaJson`) deployed to STAGING + verified:
UCSB default build = 33 players, all JSON-filled; Rowan Kelly dev_aggressiveness=1 persisted; Josiah Overbeek
on the target board. The `players.team='UCSB'` data fix + New-Build retest are Trevor's to run. **Prod carries
the same edge-function bug** — the fix rides to prod with Push 1's Step-4 edge deploy (prod's older function
predates the phantom-column code, so existing prod builds are unaffected). **Follow-up (tracked):** harden the
frontend `returners` query (and `team_builds.team`) to resolve by `source_team_id`/id, never team name — the
deferred IDs-over-names refactor (Trevor: "it should never use a lookup by team name … the whole purpose of
building UUID for everything").
