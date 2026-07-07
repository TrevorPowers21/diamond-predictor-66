# Team Builder — Default Build Architecture Test Checklist

Branch: `feature/default-build-architecture` · Test on **http://localhost:5174/**
(Note: local reads the **staging** DB. Any "only-one-team" data oddities like
South Alabama pitcher scouting are staging-data gaps, not branch bugs.)

Run top to bottom — early failures flag the more fundamental issues first.

## 0. Smoke test (do first — App.tsx router conflict was resolved)
- [ ] App loads, no white screen
- [ ] Dashboard, a Player Profile, a Pitcher Profile, Team Builder, War Room all render
- [ ] `/savant` loads (if you have access) — confirms no route dropped in the merge

## 1. Fork preserves all changes (Bug 1)
- [ ] Log in as a team with **no saved coach builds** → Default Roster loads
- [ ] Change one player's **depth role** (e.g. Everyday → Cornerstone)
- [ ] Change a **different** player's **dev aggressiveness**
- [ ] Wait ~30s for the idle save → name the build → Save
- [ ] **Reload** → both the depth change AND the dev-agg change persist (check both)

## 2. Rename (Bug 2)
- [ ] On the **Default Roster**: there is **no Rename button**
- [ ] Load a **saved coach build** → **Rename button appears**
- [ ] Click Rename → modal opens **pre-filled with the current name**
- [ ] Edit name → Enter/Rename → name updates immediately, **no new build created** (count unchanged)
- [ ] Reload → new name persists

## 3. No spurious prompts / silent auto-save (Bug 3)
- [ ] Load a **saved (named) coach build**
- [ ] Add a target-board player OR change a depth role
- [ ] Wait ~30s → **auto-saves silently, NO name prompt**
- [ ] Make another change → navigate away (Dashboard/another page) → saves silently, no prompt
- [ ] (contrast) On a brand-new/Default build, the first idle SHOULD prompt for a name — correct, not a bug

## 4. Build picker filter + order (Bug 4)
- [ ] Open **Load Saved Build** dropdown
- [ ] **Default Roster is first**
- [ ] Coach builds below it, **most recently saved at top**
- [ ] Only **current-season** builds appear — no prior-year (2025/2026) builds if on 2027

## 5. Regression — existing coach build loads on login
- [ ] Log in as a coach who **has a saved build** → their saved build loads (not Default Roster)

## 6. Clone flow (newly added)
- [ ] Click **New Build** → asks what to clone (Clone current / from Default / start blank)
- [ ] Pick **Clone "{current build}"** → new build seeded from that roster, original untouched

---
**Most likely to trip:** #1 (confirm BOTH knobs persist, not just depth), #3 (truly silent
on named builds), #6 (the clone modal). On any failure, note the step + what you saw.
