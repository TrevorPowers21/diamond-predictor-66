# Agent learnings — recruit identity + scouting reports + GM Settings (2026-07-30)

Captured for the **RSTR IQ dev agent** (memory `project_rstr_dev_agent`). These are
the decisions/corrections from the `feature/recruit-ids-mobile-board` session — the
react-and-correct records the agent should carry. **Fold into `docs/knowledge/`** on
the `docs/rstr-agent-plan` branch: mostly `projections-and-scouting.md` +
`access-and-tenancy.md` (both still-to-draft), some into `db-safety-and-process.md`.

Record shape: **rule — why — scope — what it protects against.**

## Scouting reports & grades (→ projections-and-scouting)

- **Grades store by stable field `key` + scale ORDINAL (1..N), never the visible
  label.** *Why:* a staff can rename a field or relabel the scale. *Protects against:*
  breaking every old graded report on a rename. Ad-hoc "+ Add Pitch/Metric" fields
  are per-report keys that carry their own label WITH the value (not in the template).
- **A new scouting report starts BLANK — no carry-forward of the previous report's
  grades/tier.** *Why (Trevor):* pre-filling the last look anchors the next
  evaluation. *Protects against:* evaluator bias. The previous report stays *visible*
  for reference; only auto-fill is removed.
- **Reports are per-look history; the latest report's tier mirrors onto the recruit's
  badge** (`gm_recruits.projection_tier`) via `addReport`/`updateReport`/`addRecruit`.
  *Protects against:* a recruit badge drifting from its authoring report.
- **"Add Pitch" (pitcher/TWP) vs "Add Metric" (position player)** — the ad-hoc custom
  field is labeled by player type. Position players don't add "pitches."
- Template = per-team `gm_scout_template` (fully customizable, per hitter/pitcher/TWP).
  Grader reads it; mobile + web render the SAME grader from it.

## Recruit identity spine (→ access-and-tenancy)

- **Mint a canonical identity AT ADD-TIME, not "later."** `gm_recruits.player_id` →
  a global `players` row minted by `resolve_or_create_prospect(name, pos, class,
  ext_source, ext_id)`; the PBR/PG link is captured as a crosswalk key
  (`player_external_ids`) right then. *Why (Trevor, changed from the spec's "later
  linking spine"):* if coaches add recruits now with no identity, you're later doing a
  fuzzy-match backfill across hundreds of orphaned rows. *Protects against:* retrofit
  debt + non-deterministic future linking. A shared PBR/PG key makes the later
  college-data link deterministic (exact-key auto-link) instead of a guess.
- **Confirm-never-guess matching** (the RPC): auto-links ONLY on an exact shared
  external key; otherwise mints a fresh `data_status='prospect'` row. Name matching is
  the UI's job (coach-confirmed). *Protects against:* a wrong auto-merge corrupting a
  shared identity (asymmetric: a missed match is recoverable, a bad merge is not).
- **`gm_recruits` stays program-private (RLS by `customer_team_id`); the `players`
  identity + `player_external_ids` crosswalk are GLOBAL/shared.** Two programs tracking
  the same kid = two private rows pointing at one shared identity. *Protects against:*
  cross-program data bleed while still enabling cross-program de-dup.

## No-drift shared-component pattern (→ process)

- **One editor, rendered in two places.** GM Settings central tabbed page AND each
  page's inline "GM Settings" dropdown render the SAME shared component
  (`SeasonBudgetFields`, `RecruitingBudgetEditor`, `ScoutingGradesEditor`,
  `ActiveRosterPicker`, `ScoutEntryComposer`, `ScoutGradeChips`/`Readout`,
  `MoneyInput`). *Protects against:* two copies drifting (Trevor: "combine them
  1000%"). Same principle drove the **focus-recruit drill-down**: the Add/Edit dialog
  AND the card "Reports" button run one list/view/composer flow off a single
  `focusRecruit = editingRecruit ?? reportsRecruit`.

## DB / process (→ db-safety-and-process, reinforces existing records)

- **Verify WHICH db before ANY write.** The CLI was linked to **prod**; re-linked to
  staging (`supabase link --project-ref slrxowawbijbjrkozqlj`), applied migration +
  backfill, **verified in-DB**, then **re-linked back to prod**. *Protects against:*
  an accidental prod write. (Reinforces the standing "staging-first / confirm which
  db" rule.)
- Migration applied via `supabase db query --linked --file`. Backfill = an idempotent
  `DO $$` block calling `resolve_or_create_prospect` with a `player_id IS NULL` guard
  (only touches un-minted rows). Verified: 9/9 recruits linked, `rstr` + `pbr`
  crosswalk keys present, `data_status='prospect'`.
- Grade values render **white** in the readout (labels white too — nothing blends on
  navy); the scale COLOR lives on the compact preview chips. Design authority =
  `design-system/rstr-iq/MASTER.md` (do NOT regenerate via ui-ux-pro-max — it pushes
  generic blue/amber; brand is navy/gold, Oswald/Inter, density > whitespace).

## Full-recompute reminders carried forward (from feature/eligibility)
The eligibility branch's recompute learnings still stand for #5 (full recompute):
whole-pRV+/wRC+ rounded at source; projected IP from depth role (IP<10 SP →
specialist_reliever); position-ownership guard for two-way market; role-transition ≠
drift (heal is the authority); small-sample fallback to last season; carry into
transfer + player snapshots WITHOUT changing toggles (`production_notes` sacred).
See `docs/PROD_RUNBOOK_eligibility_branch.md`.

## Video = FUTURE
See `docs/VIDEO_FILM_FUTURE.md`. Key agent-relevant learning: **"MP4 playable for
everyone" requires server-side transcoding, which Supabase Edge can't do — a managed
service (Cloudflare Stream / Mux) is the answer, not a Supabase bucket.**
