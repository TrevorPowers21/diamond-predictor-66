# CSV Importer

Local Node CLI that ingests TruMedia stat exports + runs the full RSTR IQ projection cascade.

## Quick reference

```bash
# Test against your staging Supabase branch (safe, write-free until you confirm)
npm run import:dry         # detection preview only
npm run import             # full run, prompts y/N

# Run against production (requires typed "yes-promote-to-prod")
npm run import:prod:dry    # detection preview only
npm run import:prod        # full run, prompts for exact phrase
```

## Environment files

Two files in the repo root (both gitignored via `*.local`):

| File | Use | Read by |
|---|---|---|
| `.env.local` | Staging Supabase branch credentials | `npm run import` / `import:dry` |
| `.env.production.local` | Production Supabase credentials | `npm run import:prod` / `import:prod:dry` |

Each file contains:
```
SUPABASE_URL=https://<project-or-branch-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role-secret>
```

When you create a new Supabase branch:
1. Open the branch in the Supabase dashboard
2. Project Settings → API → copy the branch's `service_role` key + URL
3. Paste into `.env.local` (overwriting the previous branch's creds)
4. `npm run import` now writes to the new branch

## Weekly workflow

```
1. Drop CSVs in ~/RSTR IQ Data/inbox/
2. npm run import           ← runs on staging branch
3. Successful files auto-archive to ~/RSTR IQ Data/imported/<YYYY-MM-DD>/
4. Spot-check the staging app
5. (Optional) re-export the same files into inbox if promoting to prod
6. npm run import:prod       ← runs on production, type "yes-promote-to-prod"
7. Done
```

**Stuff+ Inputs filenames:** `<Pitch Type> <Hand>.csv` — e.g., `4S FB RHP.csv`,
`Slider LHP.csv`, `Gyro Slider RHP.csv`. The importer reads pitch type and
hand from the filename, so no manual CSV-column edits required. CSV
`throwsHand` column is sanity-checked against the filename — a mismatch
warns but doesn't abort.

**Failed files stay in inbox** — they'll get picked up on the next run.
Re-run with `--keep-files` to skip the archive step if you want to leave
successful files in place (e.g., for re-running with the same data).

## What gets run (cascade order)

1. **Master imports** — Hitter Master, Pitching Master (delete-and-insert by season)
2. **Stuff+ rollup** — restores `Pitching Master.stuff_plus` from `pitcher_stuff_plus_inputs`
3. **Role derivation** — SP/RP from G/GS ratio (≥0.5 = SP)
4. **`addMissingPlayers`** — non-destructive, only adds players new to the table
5. **`computeAndStoreNcaaAverages`** — refreshes NCAA baselines
6. **`computeAndStoreAllScores`** — recomputes ba_plus / era_pr_plus / etc.
7. **`createPredictionsFromMaster`** — populates internals (reads scores from step 6)
8. **`bulkRecalculatePredictionsLocal`** — fills p_avg / p_obp / p_wrc_plus / p_era / etc.
9. **ClassYear blank-fill** — only fills `players.class_year` where currently NULL

## Detection rules

Files are classified by **column headers** (case-insensitive), with filename as tiebreaker. Each type has a list of required + signature columns in `registry.ts`.

Currently supported types:
- `hitter_master` — TruMedia Hitter Master export
- `pitching_master` — TruMedia Pitching Master export
- `pitcher_stuff_inputs` — per-pitch-per-hand Stuff+ inputs (Phase C, importer pending)
- `class_data` — standalone class data (rarely used now that ClassYear is in masters)

Unknown files are listed as "Unknown" in the preview and skipped during the run.

## Safety features

- **Dry-run preview** — `--dry-run` shows what will happen without writing anything
- **Same-type dedupe** — multiple files of the same type are flagged; only the newest by mtime is queued
- **Prod confirmation guard** — `--prod` requires typing `yes-promote-to-prod` exactly. `--yes` does NOT bypass this
- **Non-destructive cascade** — `syncMasterToPlayers` (which wipes the players table) is intentionally excluded from the routine cascade. It stays available via the AdminDashboard button for explicit metadata refreshes.

## Branching workflow (~$0.32/day per branch)

Supabase Database Branching (Pro plan feature) provides isolated test databases that mirror prod schema.

```bash
# Via Supabase CLI (recommended)
supabase branches create stat-update-MMDD       # ~5 sec
# ... copy the branch's service_role key + URL into .env.local
npm run import                                   # runs on branch
# Verify in staging app, then promote
npm run import:prod                              # runs on production
supabase branches delete stat-update-MMDD       # stop the daily charge
```

Or use the **Branches** sidebar in the Supabase dashboard for click-driven branch management.

## Troubleshooting

- **"Supabase credentials missing"** → check the relevant `.env*.local` file exists and has both `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
- **"Unknown" CSV type** → header didn't match any registered type. Either rename the file or add a new entry to `registry.ts`
- **Network-bound slowness** → expected; the cascade does many small Supabase round-trips. Total time should be ~3-5 min on a normal connection
