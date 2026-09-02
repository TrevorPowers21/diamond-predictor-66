# STAGING CLICK-THROUGH — one continuous pass (2026-08-26)

One ordered path through the app on **staging**. Do it top to bottom. Each step: the action, what you
should SEE (✓), and the red flag (✗). Anchored to real staging players. Data behind these is DB-verified;
this pass confirms the DISPLAY. If any ✗ hits, stop and note the step.

**Log in as an SEC program (e.g. Arkansas)** so conference pricing is obvious (SEC = 4.0× tier).

---

1. **Overview / home** (`/dashboard`)
   ✓ "Top Available Players" panel lists best uncommitted by projected value; the Top-5 and Target-Board card titles are clickable and navigate.
   ✗ Old "Recent Portal Activity" title, or dead card titles.

2. **Player Dashboard** (`/dashboard/returning`)
   ✓ Hitter table header reads **WAR** (not "oWAR"); a player with nonzero defense/baserunning shows a value ≠ his offense-only oWAR; sorting the column is monotonic (no lower-WAR row above a higher one).
   ✗ Header still "oWAR", or sort out of order.

3. **Open Nolan Souza** (Arkansas IF, a returner)
   ✓ Headline WAR box reads **WAR ≈ 1.20** (total, not offense-only). Bio shows **2027 Class**.
   ✗ Box says "oWAR" or shows ~0.96 (offense only).

4. **Souza — Market Value**
   ✓ Market ≈ **$131,800** (SEC 4.0 × IF 1.10 on total 1.20). Priced at YOUR program's conference.
   ✗ ~$50k (old SEC-1.5 stale price) or origin-school pricing.

5. **Souza → Season Stats tab**
   ✓ Savant-style display loads; the banner (AVG/OBP/…); to the RIGHT a **VALUE** panel of 3 colored bars — **Batting −6.8, Defensive −2.0, Baserunning +1.2** — its bottom flush with the line under the Stats/Visuals selector; same width/font as Batted Ball Data.
   ✗ VALUE panel missing, wrong width/font, or dead space below it.

6. **Souza — change the split** (dimension picker → e.g. vs RHP)
   ✓ The VALUE panel **disappears** (it only shows on the full-season, unfiltered view).
   ✗ VALUE panel stays / shows stale numbers.

7. **Transfer Portal** (`/transfer-portal`) — open **Gavin O'Brien** (LF)
   ✓ WAR tile reads **WAR** (= total); his market reflects **YOUR** SEC conference (high), not his MAC origin.
   ✗ "oWAR", or origin-school pricing.

8. **A two-way player — Kyle Johnson** (search him)
   ✓ Appears with a gold **TWP** badge; shows BOTH a hitter side and a pitcher side (hitWAR ≈ 1.26, pWAR ≈ 1.05) with per-side market (~$47k hit / ~$39k pit).
   ✗ Shows once / one side only.

9. **Team Builder** (`/team-builder`, your team) — Default Roster
   ✓ Dropdown shows "Default Roster" first (current season only); WAR column header reads **WAR**; sort monotonic; Souza's row market matches his profile (~$131.8k).
   ✗ Header "oWAR", sort broken, or market disagrees with the profile.

10. **Team Builder — dev-agg toggle** on one hitter
    ✓ Value updates live for ~20s, then the snapshot saves; reload the build → the row reads the STORED value (no drift on repeated toggles).
    ✗ Value keeps drifting on repeated toggles, or reverts to a different number on reload.

11. **Team Builder — a TWP on the roster**
    ✓ Occupies both a hitter and a pitcher slot, each with its own per-side WAR; a returner pitcher's pWAR/market is not blank; a coach depth-role override survives reload.
    ✗ One slot only, blank pWAR, or override lost on reload.

12. **Target Board** (`/dashboard/targets`)
    ✓ WAR column header reads **WAR**; a known TWP shows in BOTH the hitter and pitcher sub-tabs (two rows); portal-status badge matches the player's profile (Committed = blue, not blanket "Watching").
    ✗ TWP once only, or wrong status badge.

13. **Pitcher Profile** — open any 2026 pitcher
    ✓ pWAR + Market via canonical projection, market at YOUR conference; no "Stuff+ Overview" card; arsenal names mixed-case ("4-Seam Fastball") with 2026 usage%. Bio **2027 Class**.
    ✗ Market at origin, Stuff+ Overview card present, or arsenal missing pitches.

14. **GM budget invariant** (`/gm` → `/gm/roster` → `/gm/allocations` → `/gm/analytics`)
    ✓ "Budget used" is IDENTICAL across Home, Roster, Funding Sources, Analytics for the same build. Allocate a vendor $10k → Remaining drops $10k AND the player's Roster NIL rises $10k (no double-count).
    ✗ Any two pages disagree on "used", or the allocation double-counts.

15. **What's-New modal** (hard refresh to trigger — storage key is v9)
    ✓ Newest release **2026-08-26** shows first with FOUR features — Complete WAR · Market Valuations · Run Values · Sharper Projections — each headline + bullets, no em-dashes; dismiss lands on `/dashboard/returning`.
    ✗ Modal doesn't fire on refresh, a feature missing/garbled, em-dashes, or wrong landing.

---
**If all ✓:** the display layer matches the DB-verified data. **Any ✗:** note the step number — that's the one to fix before the push.
