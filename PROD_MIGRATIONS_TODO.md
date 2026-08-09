# Prod migration checklist — `feature/general-manager-interface`

Every schema change on this branch that is **not yet on prod**, in apply order. Run
these against prod at push time (staging already has them). Most use
`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, so re-running is safe —
but **verify each against prod first and skip any already applied out of band.**

Apply in filename (timestamp) order. Runner used on staging:
`npx tsx --env-file-if-exists=.env.production.local scripts/_run_sql_file.ts <file>`
(⚠️ prod = `.env.production.local` → `trbvxuoliwrfowibatkm`. Requires explicit go.)

## Migrations (chronological = apply order)

- [ ] `20260705120000_gm_front_office_finance.sql`
- [ ] `20260706120000_gm_scholarship.sql`
- [ ] `20260707120000_gm_scholarship_total.sql`
- [ ] `20260707130000_gm_other_breakdown.sql`
- [ ] `20260707140000_gm_finance_per_build.sql`  — gm_player_finance re-keyed to build_player_id (+ roster_status/departure_reason)
- [ ] `20260707150000_gm_recruits.sql`
- [ ] `20260707160000_gm_recruits_stage.sql`
- [ ] `20260707170000_gm_recruit_events.sql`
- [ ] `20260707180000_gm_recruits_report_date.sql`
- [ ] `20260707190000_gm_recruit_reports.sql`
- [ ] `20260707200000_gm_recruits_tier.sql`
- [ ] `20260707210000_gm_recruit_contact.sql`
- [ ] `20260707220000_gm_recruit_report_tier.sql`
- [ ] `20260707230000_team_builds_gm_notes.sql`
- [ ] `20260708120000_gm_player_finance_notes.sql`
- [ ] `20260708130000_gm_player_finance_notes_date.sql`
- [ ] `20260708140000_gm_player_notes.sql`
- [ ] `20260708150000_gm_recruits_pricing.sql`
- [ ] `20260708160000_gm_activity.sql`
- [ ] `20260708170000_gm_recruits_level.sql`
- [ ] `20260708180000_gm_recruits_extra_contacts.sql`
- [ ] `20260709120000_gm_activity_link.sql`
- [ ] `20260709130000_gm_recruiting_budget.sql`
- [ ] `20260709140000_gm_activity_ref.sql`
- [ ] `20260709150000_gm_target_board.sql`
- [ ] `20260709160000_gm_target_asking.sql`
- [ ] `20260709170000_gm_allocations.sql`  — gm_allocation_source + gm_allocation (funding sources)
- [ ] `20260710120000_gm_allocations_per_build.sql`
- [ ] `20260710130000_gm_scholarship_mode.sql`
- [ ] `20260713120000_gm_contracts.sql`  — gm_contract + gm_contract_obligation + gm-contracts storage bucket
- [ ] `20260713140000_team_builds_is_active.sql`  — the live/active build flag
- [ ] `20260714120000_gm_player_info.sql`
- [ ] `20260714150000_gm_player_info_social.sql`
- [ ] `20260714170000_marketability.sql`
- [ ] `20260714190000_marketability_youtube.sql`

### Vendor unification (project_gm_vendor_unification)
- [ ] `20260716120000_gm_vendor.sql`  — slice 1: program-level vendor directory (staging 2026-07-16)
- [ ] `20260716130000_gm_contract_vendor_link.sql`  — slice 3a: gm_contract.vendor_id + gm_allocation_source.vendor_id + backfill directory + link (staging 2026-07-16)
- [ ] `20260716150000_gm_source_funding_mode.sql`  — slice 4a: gm_allocation_source.funding_mode + base_offset (new-money vs carve accounting) (staging 2026-07-16)
- [ ] `20260716170000_gm_contract_funding.sql`  — slice 4b: gm_contract.funding_mode + base_offset + allocation_id (staging 2026-07-16)

## Non-migration prod steps (from memory)
- ~~Deploy the `parse-contract` edge function + `ANTHROPIC_API_KEY`~~ — NOT needed: contract PDFs are read entirely in the browser (`extractContractPdf`, pdfjs, no AI/network). The AI `parse` path in useGmContracts is dead code (nothing calls it) — remove it.
- [ ] Headshot scrape: run the roster scraper against prod customer teams after push (returners + incoming transfers).
- [ ] **Contract funding backfill** (AFTER the 4 vendor migrations): `npx tsx --env-file-if-exists=.env.production.local scripts/backfill_contract_funding.ts --write` — syncs existing NIL/Other contracts into funding sources/allocations (idempotent; dry-run first without `--write`).

- [ ] 20260717120000_user_team_access_team_admin_modify.sql — RLS: team_admins can modify their own team user_team_access (fixes admin remove-access)

### Recruit identity + mobile recruiting + scouting v2 (`feature/recruit-ids-mobile-board`)
Apply in order at push time. All additive/idempotent. Staging dates noted.
> **✅ APPLIED TO PROD 2026-07-30** — all 4 migrations + backfill run against prod (`trbvxuoliwrfowibatkm`) via `supabase db query --linked`, catalog-verified. BYU had 4 recruits → 4 `prospect` identities minted (Nixon Warren LF→OF normalized first). CODE still pending staging→main (PR #159).
- [x] `20260728120000_player_external_ids_and_prospect.sql` — vendor-agnostic identity crosswalk (`player_external_ids`) + `data_status='prospect'` (staging 2026-07-28, catalog-verified)
- [x] `20260728121000_resolve_or_create_prospect.sql` — `resolve_or_create_prospect()` SECURITY DEFINER writer; exact-external-key auto-link only (staging 2026-07-28, round-trip verified)
- [x] `20260729120000_scout_grades_and_template.sql` — `gm_recruit_reports.grades` JSONB + `gm_scout_template` (per-team customizable scouting template) (staging 2026-07-29)
- [x] `20260730120000_gm_recruits_player_identity.sql` — adds `gm_recruits.player_id` FK → `players(id)` (the recruit↔RSTR IQ identity link; minted at add via `resolve_or_create_prospect`) (staging 2026-07-30, verified)

**Non-migration prod steps for this feature (append as they arise):**
- [ ] Scouting v2 storage: create the `recruit-video` bucket + retention/lifecycle via the Supabase dashboard (owner-restricted — can't go through the SQL runner). [pending 1d]
- [x] Recruit identity backfill (AFTER `20260730120000`): run `supabase/queries/backfill_gm_recruits_player_id.sql` — mints/attaches an identity for every pre-existing recruit (idempotent; only touches `player_id IS NULL`). Staging 2026-07-30: 9/9 linked, 0 orphaned.

- [ ] 20260808_pitch_log_add_sequence.sql — add pitch_num_in_game/ab_num_in_game/pitch_num_in_ab + backfill (scripts/sql/pitch_log_sequence_backfill_steps.sql). APPLIED STAGING 2026-08-08 (2,576,230 rows). PROD pending.

- [ ] team_drs_store.sql (scripts/sql/) — add team_drs column to team_war_snapshots + populate 308 D1 teams (re-centered dRS, season 2026). APPLIED STAGING 2026-08-09 (308 rows, sum ~0). PROD pending. Regenerate values via scripts/drs/derive_team_drs.mjs against prod.
