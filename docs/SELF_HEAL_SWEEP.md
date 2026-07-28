# Self-heal sweep — Phase-B snapshot guard

Background guard for the Phase-B model. Display values (`team_build_players.player_snapshot`,
`target_board.transfer_snapshot`) are defined as `f(neutral, production_notes)` — the
immutable dev_agg=0 neutral line put through the saved toggles. If a **toggle race**
(e.g. flip dev-agg to 1.0 then back to 0 before the debounced save settles) or a
**neutral re-precompute** ever leaves a snapshot out of sync, this sweep re-derives it
and writes it back.

It is safe by construction: it only ever writes `f(neutral, notes)` — a value computed
purely from the immutable neutral + the saved toggles via `src/lib/projectEffective.ts`
(the exact recompute the Team Builder toggle uses, incl. SP↔RP role transitions and the
null-depth `projected_ip` fallback). It cannot invent or corrupt data, and it's
idempotent — a clean DB heals 0 rows and pings nothing.

## Pieces
- `scripts/heal-stale-snapshots.ts` — the heal (dry-run by default; `--apply` to write).
  Prod `--apply` is gated behind `RSTR_AUTOMATION_TOKEN` (unattended) or `--yes`.
- `scripts/self_heal_sweep.sh` — launchd wrapper: runs `--prod --all --apply`, logs to
  `~/Library/Logs/rstr-iq-self-heal.log`, notifies only when it heals >0 rows or errors.
- `scripts/com.rstriq.self-heal.plist` — launchd schedule (daily 04:15).

## ⚠ Prerequisite (run order matters)
The sweep reads each row's stored `neutral_snapshot`, so **prod must first have**:
1. the `neutral_snapshot` column migration (`20260724130000_neutral_snapshot.sql`), and
2. the `scripts/backfill-neutral-snapshot.ts --prod --apply` populate.

Both are in the branch prod-promotion batch (handoff §11). **Do not enable the sweep
on prod until those have run** — without stored neutrals it would skip every row (never
corrupt, but useless).

## Verify before enabling (always dry-run first)
```bash
cd ~/dev-main/diamond-predictor-66
export SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...   # or rely on .env.production.local
npx tsx scripts/heal-stale-snapshots.ts --prod --all    # DRY-RUN — lists drift, writes nothing
```
Expect a small, explainable list (or 0). Spot-check a couple against the neutral before
letting it write. Then a one-off manual apply:
```bash
RSTR_AUTOMATION_TOKEN=1 npx tsx scripts/heal-stale-snapshots.ts --prod --all --apply
npx tsx scripts/verify-all.ts    # (point env at prod) → 0 issues
```

## Enable the schedule (macOS launchd)
```bash
cp scripts/com.rstriq.self-heal.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.rstriq.self-heal.plist
launchctl start com.rstriq.self-heal      # run once now to confirm
tail -n 40 ~/Library/Logs/rstr-iq-self-heal.log
```

## Disable / tune
- Disable: `launchctl unload ~/Library/LaunchAgents/com.rstriq.self-heal.plist`
- Tighter cadence: edit `StartCalendarInterval` in the plist (e.g. add more `Hour`
  entries, or switch to `StartInterval` seconds), then unload + load again.

## What a healthy log looks like
```
=== <date> ===
### DB: .env.production.local  APPLY=true ###
===== HEAL v2: 0 rows  (noConf 0) =====
HEAL_SUMMARY env=prod dryrun=false healed=0 errors=0
Done.
```
A non-zero `healed=` is fine and expected occasionally (it just fixed a drifted row);
the macOS notification tells you when it did. Persistent large heals every run would be
a smell — it'd mean something upstream keeps re-staling snapshots (investigate the neutral
finalization propagation, handoff §5).
