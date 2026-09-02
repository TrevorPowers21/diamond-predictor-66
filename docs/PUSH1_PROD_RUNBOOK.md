# PUSH 1 — Prod Runbook (dRS + wSB + composite, ÷10 additive)

**Target:** PROD `trbvxuoliwrfowibatkm`. **oWAR/pWAR UNCHANGED** (÷10). Goal: get the composite pipeline
live + running on prod, additive, before any recalibration (Push 2 = 10→13.1).

**SAFETY:** every write step is gated on Trevor's explicit **"prod, now?"**. Executed **one step at a
time**, verify gate passing before the next. DDL = paste-SQL in the **prod SQL editor**. Data loads/backfills
= prod-pointed scripts (`.env.production.local`), target verified in-script. Edge deploy = explicit
`--project-ref trbvxuoliwrfowibatkm`. Nothing here has run yet.

**Prod state confirmed by read-only audit (2026-08-07):**
- `player_predictions`: has `o_war`/`p_war`/`market_value`; **lacks** `d_war`/`bsr_war`/`total_hitter_war`;
  **no `total_war`** (so add-only, no rename — differs from staging).
- `player_season_defense` / `player_season_baserunning`: **do NOT exist** (must create + load).
- `pitch_log`: has tracking/shape half; **lacks** attribution (`atbat_desc`/`short_stop`/`hang_time`/`runs`).

**Coverage caveat (accepted, Option A):** dRS is missing 79 untracked pitchers (~0.14% of pitches),
inherent + unrecoverable (re-export test 0/79). Not a blocker. See `PITCH_LOG_COMBINED_EXPORT_SPEC.md`.

---

## PREP (before any prod write)
- **P1.** Make prod-pointed copies of the backfill scripts (they hardcode `.env.local` + a staging guard):
  `backfill_pitch_log_attribution.mjs` and `drive_pitch_log_backfill.mjs` → read `.env.production.local`,
  guard `URL.includes("trbvxuoliwrfowibatkm")`. (I'll create `*_prod.mjs` variants at execution time.)
- **P2.** Confirm the certified aggregate CSVs are current: `scripts/drs/output/player_season_defense.csv`
  (13,465 rows) + the wSB output. These are the exact files certified 13454/13454 vs staging.
- **P3.** Prod-point the aggregate loader (`load-drs-wsb-staging.ts` → prod env + guard), OR load via a
  `.env.production.local` mjs mirroring it.

---

## STEP 1 — Schema migrations (prod SQL editor, DDL) — needs "prod, now?"

**1a. Create the aggregate tables** (prod-targeted copy of `20260805_player_season_defense_baserunning.sql`).
Run that file's full `create table if not exists player_season_defense (...)` +
`create table if not exists player_season_baserunning (...)` (+ any indexes) in the prod editor.

**1b. Add composite columns to `player_predictions`** (ADD-ONLY — no rename on prod):
```sql
alter table player_predictions
  add column if not exists d_war            numeric,
  add column if not exists bsr_war          numeric,
  add column if not exists total_hitter_war numeric;
```

**1c. Create `refresh_composite_war()`** (the perf-fixed version — statement_timeout lifted + change-guard):
```sql
create or replace function refresh_composite_war() returns void
language sql set statement_timeout = '180000' as $$
  update player_predictions p set
    d_war   = dd.dw, bsr_war = dd.bw,
    total_hitter_war = case when p.o_war is not null then p.o_war + dd.dw + dd.bw else null end
  from (
    select pp.id, pp.o_war, coalesce(d.dw,0) dw, coalesce(b.bw,0) bw
    from player_predictions pp
    left join (select player_id, sum(drs_floor)/10.0 dw from player_season_defense
               where season=2026 and position<>'P' group by player_id) d on d.player_id=pp.player_id
    left join (select player_id, wsb_runs_reg/10.0 bw from player_season_baserunning
               where season=2026) b on b.player_id=pp.player_id
  ) dd
  where p.id = dd.id
    and ( p.d_war is distinct from dd.dw or p.bsr_war is distinct from dd.bw
       or p.total_hitter_war is distinct from
            (case when dd.o_war is not null then dd.o_war+dd.dw+dd.bw else null end) );
$$;
```

**1d. Widen `pitch_log`** (prod copy of `20260806_pitch_log_widen_attribution.sql`) — the
`alter table pitch_log add column if not exists atbat_desc text, ... runs numeric;` block (26 cols).

**VERIFY 1 (read-only):** re-run the audit script vs prod → the 3 new `player_predictions` cols present,
both aggregate tables exist (0 rows), `pitch_log` attribution cols present.

---

## STEP 2 — Load the certified aggregates (prod-pointed script) — needs "prod, now?"

Run the prod-pointed aggregate loader → inserts `player_season_defense` (13,465) + `player_season_baserunning`.
**VERIFY 2:** row counts match the CSVs; spot-check Helfrick `drs_floor` ≈ known value; `position<>'P'` sums sane.

---

## STEP 3 — pitch_log widen backfill (BATCHED — never the monolithic UPDATE) — needs "prod, now?"

The monolithic `UPDATE ... FROM` dies on the editor's disconnect even with `statement_timeout=0` (confirmed
twice on staging). Use the batched server-side function driven from a script.

- **3a.** (prod editor) `create table pitch_log_attr (...)` — the 26-col temp landing table.
- **3b.** `node scripts/backfill_pitch_log_attribution_prod.mjs --apply` — loads ~2.58M attribution rows into
  `pitch_log_attr` (~13 min). **VERIFY:** `pitch_log_attr` count ≈ table size.
- **3c.** (prod editor) create `backfill_pitch_log_attr_batch(_after,_lim)` (the `set statement_timeout=0` fn).
- **3d.** `node scripts/drive_pitch_log_backfill_prod.mjs` — batched UPDATE, ~105 calls × 25k (~27 min).
  Observable; probe committed chunks mid-run.
- **3e.** (prod editor) create + call `pl_verify()` (coverage) then `pl_finish()` (dedup — expect 0 removed on
  prod too if same clean ids; + `UNIQUE(uniq_pitch_id)`). **VERIFY:** `with_atbat`/`with_shortstop` sane;
  `has_unique=true`.
- **3f.** (prod editor) `drop table pitch_log_attr; drop function backfill_pitch_log_attr_batch(text,int);
  drop function pl_verify(); drop function pl_finish();`

NOTE: if prod `pitch_log` has the same ~untracked/junk un-attributed rows, that's expected (Option A) — do NOT
delete them here.

---

## STEP 4 — Deploy edge function to prod — needs "prod, now?"
```
supabase functions deploy process-precompute-jobs --project-ref trbvxuoliwrfowibatkm
```
(Verify the deploy output names `trbvxuoliwrfowibatkm`, NOT staging.) The fn's `refresh_composite_war()` call
is non-fatal if anything's off, so this is safe to deploy before the first refresh.

---

## STEP 5 — Populate + verify the composite — needs "prod, now?"

- **5a.** (prod editor) `select refresh_composite_war();` — first run updates ~93k hitter rows (change-guard;
  ~10-30s, under the editor limit). Populates `total_hitter_war = o+d+bsr`.
- **5b. VERIFY 5 (read-only, prod):** identity `total_hitter_war = o_war+d_war+bsr_war` on a 1–2k sample
  (expect 100%); pure pitchers → `total_hitter_war` null, `p_war` intact; leaderboard sane; `d_war` non-zero
  on a healthy share. (Mirror the staging verify that returned 1000/1000.)
- **5c.** Trigger one real precompute on prod (or wait for the cron) → confirm the edge fn's
  `refresh_composite_war()` call fires and `total_hitter_war` tracks fresh `o_war` (the self-healing test,
  prod-pointed).

---

## ROLLBACK (per step, if a verify gate fails)
- S1: `alter table player_predictions drop column d_war, drop column bsr_war, drop column total_hitter_war;`
  `drop table player_season_defense, player_season_baserunning; drop function refresh_composite_war();`
  `alter table pitch_log drop column atbat_desc, ...;` (all additive → clean drop).
- S2/S3: truncate/`delete` the loaded rows; the widen columns stay null (harmless).
- oWAR/pWAR/market_value are **never touched**, so a rollback restores the prior prod exactly.

## POST-PUSH
- Update `PROD_MIGRATIONS_TODO.md` (append each applied migration).
- Push 1 done → branch for Push 2 (10→13.1 + `o_war → total_hitter_war` display swap; note prod has no
  `total_war` so the swap is display-only).
