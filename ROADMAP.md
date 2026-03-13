# Diamond Predictor — Roadmap & Working Context

## Stitch Design References

Generated designs live in Google Stitch. Open https://labs.google/fx/tools/stitch to view.

| Project Name | Page | Status |
|---|---|---|
| Diamond Overview V2 | Overview (Dashboard) | Ready — implement first |
| Diamond - Player Dashboard | Player Dashboard | Review later |
| Diamond - Transfer Portal | Transfer Portal | Review later |
| Diamond - Player Profile | Player Profile | Review later |
| Diamond - Team Builder | Team Builder | Review later |
| Diamond - Compare Players | Compare Players | Review later |
| Diamond - Admin + Account | Admin / Account | Review later |

**Next step:** Implement the "College Baseball Overview Dashboard" screen from Diamond Overview V2 into `src/pages/Dashboard.tsx`.

---

## Decisions (answered March 12)

1. **Page responsiveness** — BOTH: mobile/tablet layout issues AND re-render performance/sluggishness
2. **Search on Player Dashboard** — Improve the existing search bar on `/dashboard/returning` (bigger, more prominent, sticky)
3. **Chart on player page** — The wRC+ top 10 bar chart on the Player Dashboard. Rethink it — replace with summary cards. Design in Stitch
4. **Sort by NIL** — Part of the Player Dashboard rethink (summary cards, not the current bar chart)
5. **NIL Valuations page** — Don't scrap or rebuild. Move it down in the nav and add a "Coming Soon" label. Future: manage team NIL budgets or let sports agents get a pulse on values
6. **Compare view** — Flexible: tabs for Current Roster / Target Board / All Players, then compare up to 4-5 players at a time. Trevor has WIP compare tab to build on
7. **AI target board** — Future idea only. No AI integration yet. Use Trevor's logic + available data to identify good fits based on team needs and budgets. Needs more thinking on how "needs" are identified or learned
8. **Teams page** — Move inside Admin entirely. Remove from main nav
9. **Account page** — Profile (name/email) + access management (invite/remove users, assign roles). Data uploads live in Admin/Data Sync, gated by role

---

## Work Items

### Priority 1 — Immediate UI/UX

- [ ] **Implement Overview design from Stitch** — Update `Dashboard.tsx` to match Diamond Overview V2 Stitch screen
- [ ] **Move Team Builder above Player Dashboard** in sidebar nav (`DashboardLayout.tsx` navItems order)
- [ ] **Transfer Portal layout reorder** — Search at top → Projected Outcomes → Context below metrics
- [ ] **Transfer Portal CTAs** — "View Player Page" and "Add to Target Board" buttons close together
- [ ] **Player Profile — Add to Roster / Add to Target Board buttons** prominently placed
- [ ] **Show Work — admin only** — Gate "Show Work (pAVG)" in TransferPortal behind admin check; collapse all admin-only sections by default for demo
- [ ] **Player Dashboard — improve search** — Make existing search bar bigger, more prominent, sticky at top of `/dashboard/returning`
- [ ] **Player Dashboard — rethink wRC+ chart** — Replace top 10 bar chart with summary cards. Design in Stitch first
- [ ] **NIL Valuations — move down + Coming Soon** — Move lower in nav, add "Coming Soon" badge label

### Priority 2 — Feature Changes

- [ ] **NIL vs Rev Share distinction** — Differentiate between direct NIL and revenue share (off balance sheet). Attach to player. Think Opex (rev share/recurring) vs Capex (one-time NIL)
- [ ] **Set Budget button** — Coaches allot specific NIL, rev share, and scholarship amounts per player. Once set, hidden from Team Builder dashboard. Must manually go in to adjust. Locks budget to prevent accidental edits
- [ ] **Compare view in Team Builder** — Build on Trevor's WIP. Add tabs: Current Roster / Target Board / All Players. Compare up to 4-5 players side by side
- [ ] **Logic for adding to Team Builder** — Auto-assign depth role by class: upperclassmen → starter (1.0x), freshmen → bench (0.3x)
- [ ] **Page responsiveness** — Audit mobile/tablet layouts AND re-render performance across all pages

### Priority 3 — Admin & Infrastructure

- [ ] **Teams page → inside Admin** — Remove from main nav, make it a section within Admin Dashboard
- [ ] **Review Data Sync page** — Ensure all functionality covered in Admin, then delete standalone page. Data uploads admin/role-gated only
- [ ] **Account page** — New page: name, email, role badge. Access management: invite/remove users, assign roles (admin/agent/viewer)
- [ ] **Consolidate admin sections** — Teams, Data Sync, equation weights, user management all under Admin

### Priority 4 — AI Features (Future)

- [ ] **AI-generated target board** — Net new. Use Trevor's projection logic + available data to identify good fits based on team needs and budgets. Needs definition of how "needs" are identified/learned (positional holes, budget gaps, oWAR targets)
- [ ] **Team needs input** — Future design for how coaches define what they need

---

## Trevor's Recent Work (merged March 12)

- **Compare Tab (WIP)** in Team Builder — two side-by-side panels with player/destination search, context, projected outcomes
- **Conference mapping utility** — `src/lib/conferenceMapping.ts` for normalizing conference names
- **Equation persistence** — Stabilized how admin equation weights are saved/loaded
- **wRC+ baseline guardrail** — Safety check in `predictionEngine.ts` for returner projections

---

## Completed (March 10-11)

- [x] Transfer Portal 400 Bad Request fix (trailing comma)
- [x] Prediction selection alignment (TeamBuilder matches Transfer Portal)
- [x] Non-deterministic tie-breaking fix (updated_at sort)
- [x] Ranking formula alignment (modelMatchBoost, variantBoost)
- [x] oWAR/NIL display mismatch fix (raw values for targets)
- [x] Debug log cleanup ([TB-sim], [TB-cands], [TP-sim])
- [x] Collapsible Projected NIL Equation card
- [x] Collapsible Team Metrics Upload card
- [x] Overview page redesign (metric tabs, pool dropdown, ranked list + chart)
