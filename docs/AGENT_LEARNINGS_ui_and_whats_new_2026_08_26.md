# AGENT LEARNINGS — UI + What's New + copy decisions (2026-08-26)

> ⚠ **Read `docs/AGENT_LEARNINGS_INDEX.md` first.** These files were written in sequence during the
> WAR recalibration and **later ones correct earlier ones** — the index says which are superseded.


Companion to `AGENT_LEARNINGS_hitter_run_values_2026_08_26.md`. Covers the display/frontend + release-note work
done this session and the copy decisions behind it (reusable).

## What's New modal — new 2026-08-26 release
`src/components/WhatsNewModal.tsx`. Added a release at the TOP of `RELEASES` (newest first) and bumped
`STORAGE_KEY` **v8 → v9** so it fires for everyone on next load / hard refresh. Four features + two "what else":
1. **Complete WAR: Offense, Defense, and Baserunning Together** — total WAR combines o+d+bsr on every surface.
2. **Market Valuations, Informed by Research** — improved market values, scaled by program tier (see copy rule below).
3. **Run Values on Every Hitter's Season Stats** — the new VALUE panel.
4. **Sharper Projections for Every Hitter and Pitcher** — rebuilt on the full 2026 season, competition-faced aware.
Landing route `/dashboard/returning`. **Zero em-dashes** in the new release (old entries left as-is per Trevor).

## ★ COPY LEARNINGS (reusable — Trevor iterated hard on these)
- **Market valuations: never overclaim.** Do NOT say values are exact / "line up with the real market" / a "strong
  starting point." Frame simply: an improved market value, **informed by research** and **scaled by program tier**.
  Trevor's liked title: **"Market Valuations, Informed by Research."**
- **Don't sound self-critical.** "refined with coach feedback through this first cycle" / "the numbers keep improving"
  read as *admitting the values aren't good yet* → cut. The market model IS still calibrating on coach feedback
  ([[project_market_calibration_research_phase]]), but the release note must not say so.
- **Never disparage past work.** "built from pitch-by-pitch data, **not just box-score totals**" was cut — it implies
  the old models were box-score-only. State the new capability positively; don't contrast against a weaker past.
- Standing modal rules: coach-focused, positive, no revealed shortcomings, **no em-dashes** in new entries
  ([[feedback_no_em_dashes_modal]]).

## Other UI changes this session
- **Run-value VALUE panel** — hitter Season Stats banner. Full detail: `AGENT_LEARNINGS_hitter_run_values_2026_08_26.md`.
- **"oWAR" → "WAR" relabel** — `RosterTab.tsx` + `TargetBoardTab.tsx` headers (value was already `total_hitter_war`).
- **PlayerHub historical fix** — `PlayerHub.tsx` identity query resolves a UUID OR a `source_player_id`, so a historical
  pitcher opens the correct pitcher profile (not misclassified as hitter) with header + Season Stats.
- **Snapshot market re-price** — stale old-SEC-1.5 snapshot dollars re-baked; full detail in `PROD_MIGRATIONS_TODO.md`
  (step 42b) + the market-re-price ledger entry.

## Verification
One ordered UI pass: `docs/STAGING_CLICKTHROUGH_2026_08_26.md` (15 steps, anchored to DB-verified staging players).

## Prod note
These are frontend/code changes — they ship when the branch merges to main (Vercel prod build), NO separate prod DB
step, EXCEPT the run-value migrations + `populate_hitter_run_values` (runbook step 13b). The What's New v9 release fires
for all users on deploy; that IS the "post-push WhatsNewModal note" the older docs deferred — it is now in the branch.

## Commits (feature/war-recalibration)
`ec33bd1` run-value display · `d2cf258`/`8af02e5`/`dfc47e2`/`9a75fe2` What's New release + copy · `a5a7895` UI relabel +
PlayerHub · `70d6d58` market re-price · `e23036c` click-through doc.
