# STAGING UX WALKTHROUGH — feature/war-recalibration (2026-08-26)

A guided, sit-down-and-do-it test on **staging**, in the order a coach actually uses the product. ~20–30 min. Each step
says what to DO and what should be TRUE (✅) / red flag (🚩). This is the human happy-path test; the exhaustive
per-page reference is `STAGING_DISPLAY_TEST_CHECKLIST_2026_08_26.md`. Run it logged in as a **real customer program**
(e.g. an SEC or ACC team) so market/conference logic is exercised.

---

## 0. Log in
Log into staging as a customer program. Note which program — market values below should reflect ITS conference.

## 1. Dashboard / Overview  (`/dashboard`)
- **Do:** land on the overview.
- ✅ The panel that used to be "Recent Portal Activity" now reads **"Top Available Players"** and lists uncommitted
  players by projected value.
- ✅ "Top 5 Hitters / Pitchers / Target Board" card titles are **clickable** and navigate.
- ✅ Target Board rows show real portal status (Committed = blue, etc.), not a blanket "Watching".
- 🚩 Any card title inert, or every target says "Watching".

## 2. A returning hitter's profile  (Dashboard → click a returning hitter)
- **Do:** open a returning position player.
- ✅ Headline WAR box reads **"WAR"** (not "oWAR"), and the number = his **total** (offense+defense+baserunning) — for a
  good defender it should differ from his offense-only number.
- ✅ **Market Value** is priced at **your program's conference** (e.g. SEC dollars), not his current school's.
- ✅ Bio shows **"2027 Class"** (advanced one year), "2026 Team", "2026 Conference".
- ✅ Scout-grade tiles show a raw stat + an ordinal percentile ("87th percentile") + tier; a metric with no data shows
  **—/N/A**, never "0 / Poor".
- 🚩 Header still says "oWAR"; market uses his origin school; a 0-data tile shows "Poor".

## 3. The Season Stats tab (the "savant-style" display)
- **Do:** on that profile, click the **Season Stats** tab.
- ✅ The savant-style panels render (Batted Ball, Plate Discipline, Ball Flight, **Inferred Bat Speed / Squared-Up%**),
  with a "2026 vs NCAA Avg" row; the **Visuals** toggle shows spray + 13-zone heat maps.
- ✅ An untracked player shows "No pitch-log data linked" (not a broken/blank grid).
- 🚩 Panels blank for a tracked 2026 player, or the tab 404s.

## 4. A pitcher's profile  (open a returning pitcher)
- ✅ pWAR + Market at **your** conference; toggling role/dev recomputes.
- ✅ Projected rates look sane — **HR9 is never negative**, elite ERA isn't impossibly low (~1.8–2.5 floor).
- ✅ Arsenal is mixed-case ("4-Seam Fastball") with 2026 usage%; "Stuff+ Overview" card is **gone** from the left column.
- ✅ Season Stats tab: Quality of Stuff / movement plot / usage pie (~100%) / tracking badge (FULL/PARTIAL/LOW).
- 🚩 A negative HR9, a weak-stuff arm topping projections, or a blank arsenal.

## 5. A two-way player (TWP)  (find one — e.g. search a known two-way name, or a target flagged TWP)
- ✅ Profile shows a gold **TWP** badge; the player has **both** a hitting projection and a pitching projection.
- ✅ Combined NIL makes sense (hitter market + pitcher market).
- 🚩 Only one side shows, or no TWP badge on a known two-way player.

## 6. Team Builder  (`/team-builder`)
- **Do:** open your program's build (or the auto-seeded default roster).
- ✅ Dropdown shows **"Default Roster" first**, current-season builds only; a no-build team shows returners, not blank.
- ✅ **Sort the roster by WAR** — ordering is monotonic (no lower-WAR player sitting above a higher one), for both hitters and pitchers.
- ✅ Convert a reliever to a starter — he should **not** suddenly outrank an equivalent true starter (PVF removed).
- ✅ Type an **Actual Value** on one player → **Budget Used** rises by exactly that amount; untouched rows contribute $0.
- ✅ A rostered **TWP** occupies **two slots** (a hitter row + a pitcher row), each with its own WAR/market; reload the
  build — both sides persist and a pitcher-returner TWP shows pWAR (not blank).
- ✅ **Compare tab is gone.**
- 🚩 WAR sort inverted; Budget Used = old sum-of-all-projected; a TWP shows once; Compare tab still present.

## 7. Transfer Portal  (`/transfer-portal`)
- ✅ The WAR tile reads **"WAR"** = total (o+d+bsr), color thresholds on the total.
- ✅ A simulated transfer's projection + market reflect **your** conference.
- 🚩 Tile says "oWAR" / offense-only.

## 8. Target Board  (`/dashboard/targets`)
- ✅ WAR column reads **"WAR"** = total.
- ✅ A known **TWP appears in BOTH the Hitters and Pitchers sub-tabs** (two rows), each its own market.
- ✅ Portal status badges match the player's profile exactly.
- 🚩 A TWP appears only once; badges say "Watching" for a committed player.

## 9. Historical player table → a pitcher  (the fix from this session)
- **Do:** find a Historical player table (e.g. a season-stats/leaderboard historical view) and **click a pitcher**.
- ✅ It opens the **correct pitcher** profile in PlayerHub (not misclassified as a hitter, not a blank page).
- ✅ The **Season Stats tab shows his savant-style display** if he has 2026 pitch_log (a pre-2026 alumni correctly
  shows "No pitch-log data linked").
- 🚩 Opens a hitter profile for a pitcher, blank header, or a dead page.

## 10. GM / Front Office  (`/gm`, if you have GM access)
- **Do:** open `/gm` → Roster.
- ✅ Type **$8,000 NIL** on a player → shows "$8,000", Actual Pay recomputes, the budget "used" total updates.
- ✅ Home, Roster, Funding Sources, and Analytics all agree on the same build's "used" total.
- ✅ Funding Sources: create a **$50k vendor pool**, allocate **$10k** to a player → Remaining shows **$40k** AND that
  player's Roster NIL rises **$10k** (money isn't double-counted or lost).
- ✅ Contracts: upload a PDF → value/dates auto-fill; the "reviewed" checkbox blocks save until checked.
- ✅ Analytics: WAR Comparison card populates vs prior-season benchmark for a team with a snapshot; $/win = pay ÷ WAR.
- 🚩 Budget totals disagree between GM pages; vendor money double-counts; a team with snapshots shows "No benchmarks".

## 11. What's-New modal
- **Do:** open the What's-New modal.
- ✅ Six new entries render (headline + bullets), no formatting glitches; the top "Introducing the Front Office" entry's
  dismiss lands a GM-access user on `/gm`.

---

## Cross-cutting sanity (keep an eye out the whole time)
- Every **"oWAR" label should now read "WAR"** and show the composite total, everywhere it appears.
- **Transfer/target market always reflects the logged-in program's conference**, never the player's origin school.
- **No negative projected HR9** anywhere; no impossibly-elite pitching projections.
- **A player's WAR + market agree across surfaces** (Dashboard, profile, Team Builder, Target Board) — no surface shows a
  different number for the same player in the same context.

## If anything red-flags
Note the page + player + what you saw vs expected. The per-page detail (with the exact code path) is in
`STAGING_DISPLAY_TEST_CHECKLIST_2026_08_26.md`; the data/formula behind any number is in the Calculation Reference in
`PROD_PUSH_STEPS_2026_08_26.md`.
