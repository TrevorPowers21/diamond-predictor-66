# ▶️ HANDOFF — 2026-09-02. Where we are, and what's next. **START HERE.**

Written at the end of the 2026-09-01 session. Covers: what shipped, what is verified, what is
knowingly open, and the five workstreams queued next (coach agent display · team comparison with
2027 roster upload · JUCO · Track B / agent-as-resource · player development).

---

## 🟢 WHERE WE ARE

### Shipped and merged
- **PR #171 → `staging`** — merged. The WAR recalibration, edge-function fixes, and the whole Team
  Builder read/write path.
- **PR #172 `staging` → `main`** — **OPEN, Trevor merges.** Code only; prod data is already repaired.
- **Edge function v23 live on prod** — deployed and verified before the PR.

### Prod data — repaired and verified 2026-09-01
```
returners   7,720 pitchers · 8,232 hitters
transfers   13/14 teams          (RSTR IQ All-Americans has no school_team_id → 0 rows, never had any)
snapshots   744 re-baked · 23 TWP own-side · 47 board←roster synced
verify      hitter oWAR vs role-PA   608 consistent / 0 inconsistent
            TWP rows with a shared market_value: 0
            rostered-on-board rows still differing: 0
            model_config calibration keys: 41
named       Lauaki Jr.  wRC+ 113 → 101 · market $24,260 → $9,671
            Neiswonger  85 IP · pWAR 3.329 · $332,852
```

### The two solved gates
- **Gate B** — prod's returner wRC+ ran a *different equation* (legacy `"Equation Weights"` @2025
  overrode the code). Proven 5,122/5,122 vs 1,164 canonical. Table renamed `_LEGACY_2025` on both DBs.
- **C1** — ERAs ~4% low: no division filter (477 JUCO = 27% of the sample) + a z-shift assuming PR+
  centres at 100 when the true D1/IP≥40 centres are 109.73–123.16.

### The doctrine that came out of it
**One defect class caused every symptom: a stored copy nobody recomputes, behind a `??` chain that
silently changes which source wins once a field becomes populated.** Full detail in Track B
(`docs/PIPELINE_pitch_log_to_projections.md`) — read that section before touching snapshots.

---

## 🔴 OPEN — carry these forward

| # | item | state | notes |
|---|---|---|---|
| 1 | **10 staging / 18 prod pitchers, unverifiable pWAR** | skipped, NOT guessed | the canonical formula can't reproduce their own neutral row (role-dependent constants). Needs the real `computePitcherPwar`. |
| 2 | **1 wrong-side neutral** | reported | slot says pitcher, `neutral_snapshot` is a hitter row. Rebuild that row's neutral on the correct side. |
| 3 | **JUCO transfers pre-fix** | parked | ~62% stale on prod vs 12% staging — the `no_from_conf` blocks. See workstream C. |
| 4 | **JUCO PTM** (Hayden Blair) | known | JUCO precomputes never picked up the new PTM. |
| 5 | **Removal-from-roster semantics** | UNDEFINED | nothing rewrites `transfer_snapshot` when a player comes OFF the roster. Current behaviour is inertia, not design. **Decide this.** |
| 6 | **`propagate_pitcher_scores_to_predictions` times out** | cost, not correctness | idempotent full-table copy of 10 columns × ~110k rows. Scores measured **99.97% in sync**. Fix = add a `WHERE` clause so it only updates rows that differ. |
| 7 | **66 hardcoded constants** | deferred by plan | 49 of 115 `DEFAULT_PITCHING_WEIGHTS` are tunable, 66 are not — incl. **9 market/$-per-WAR** and **3 projected-IP-per-depth-role**. Loud fallbacks shipped as the interim mitigation. ⛔ Seeding needs a NAMING decision first: `loadPitchingPowerEq` takes only `p_`-prefixed keys and `market_*` is shared with the hitter path. |
| 8 | **Gate A — Georgia Tech onboarding** | not run | the edge function is deployed and diff-verified on hitters (7,814/7,814) but **no job has been fired through it on prod**. |
| 9 | **`types.ts` is stale** | nuisance | doesn't know `customer_team_id` exists on `player_predictions`; has forced two `as any` casts. Regenerate. |

### ⭐ THE DURABLE FIX (highest-value refactor)
**One save path that owns every derived copy together.** Every failure on 2026-09-01 was a stored copy
nobody recomputed: snapshots after a precompute, market after a WAR change, `transfer_snapshot` after a
save, `player_snapshot` after a local state update. Tonight's scripts are **repairs**, not architecture.
Until this exists, each new surface adds another copy that can drift.

---

## 🗺️ WHAT'S NEXT — five workstreams

### A. Coach-facing agent display  ([[project_front_office_agent_page]], [[project_rstr_dev_agent]])
An agent surface coaches actually use, not a dev tool.

**Decide first**
1. **Scope** — read-only Q&A over the roster/board, or can it *act* (add a target, set a depth role)?
   Acting means it needs the same guardrails as the UI, and every write must go through the one save
   path (see the durable fix) or it becomes another copy that drifts.
2. **Grounding** — it must read **stored snapshots**, never recompute. Same rule as every surface:
   `player_snapshot ?? transfer_snapshot`, never `p.prediction`.
3. **Scoping/RLS** — program-scoped by `customer_team_id` ([[reference_rls_scoping]]). A super-admin
   "all clients" view is backend-gated ([[reference_super_admin_all_clients_backend_gated]]).

**Build order**
- read-only over one build → cite the row it used (player + field + value) so answers are auditable
- add board/target context
- only then consider writes, and route them through the save path

⚠ **Do not let the agent compute WAR or market.** It reports stored values. The moment it derives, it
becomes a fourth implementation alongside the batch, the edge function, and the UI.

### B. Team comparison + 2027 roster upload  ([[project_team_comparison]])
Compare a build against another program's 2027 roster, with upload.

**Decide first**
1. **Upload shape** — CSV of names + positions? IDs? The [[feedback_id_over_name]] rule applies:
   name-matching is the Harrison Cook trap (two players, same name, one a D1 stub). If the upload is
   name-based it needs the same unique-match-or-skip guard as `relink-build-player-ids.ts`.
2. **What "comparison" means** — Total WAR, lineup oWAR (top 9), rotation/bullpen pWAR? The
   Year-Over-Year and Championship Benchmark cards already do this shape against
   `team_war_snapshots` — extend rather than invent.
3. **Where uploaded rosters live** — a new table, or `team_builds` with a flag? If they get snapshots,
   they inherit every copy-drift problem; prefer deriving on read from `player_predictions`.

**Reuse**: `useTeamWarSnapshot`, `useWarBenchmarks`, `supabase/queries/team_war_2025_aggregation.sql`.

### C. JUCO  ([[project_juco_restructure_planned]], `docs/JUCO_AUDIT_2026_05_24.md`)
Knowingly wrong and parked. Now quantified:
- **~62% of prod JUCO transfer rows are stale** (12% on staging) — the `no_from_conf` guard blocks
  JUCO sources whose origin conference has no stored env+, and blocked rows are never rewritten
- **JUCO PTM never updated** (Blair)
- **JUCO FIP was never calculated properly** — separate audit
- D1 is the consistency boundary; `division='D1'` gates the calibration

**Order**: fix the conference env+ coverage → re-run JUCO precomputes → then PTM → then FIP.
Do **not** start by re-running precomputes; blocked rows will just stay blocked.

### D. Track B + agent-as-resource
`docs/PIPELINE_pitch_log_to_projections.md` is the canonical build spec and is now large. Two jobs:
1. **Finish stage 5.5 autofill** — calibration + rating centres must run from the upload chain.
   **NOT BUILT.** Today it's a manual script run, so a new upload silently uses stale constants.
2. **Make Track B an agent resource** — it is already written as instructions-to-a-successor. Feeding
   it (plus the agent-learnings files) to the dev agent is the cheapest way to stop repeating
   2026-09-01. Highest-value sections: the read/write path, the three guardrails, and the
   "prove they're comparable before diffing" rule.

### E. Player development  ([[project_player_dev_data_ownership]], [[project_per_program_data]])
Program-owned data, distinct from projections.

**Decide first**
1. **Ownership/visibility** — program-owned means RLS by `customer_team_id` and *no* cross-program
   leakage, including for super-admins.
2. **Relationship to projections** — does dev data *feed* projections (a new input) or sit *beside*
   them (a separate view)? If it feeds them, it belongs in the precompute, not the UI.
3. **NewtForce overlap** — [[reference_newtforce_metrics]] already defines metrics; don't create a
   second vocabulary.

---

## ▶️ RECOMMENDED ORDER

1. **Merge PR #172** and run the 5-item verify list in its body
2. **Gate A** — fire one prod onboarding job, diff it against the local precompute (the check that
   caught the `IF` bug), then Georgia Tech
3. **The `propagate` `WHERE` clause** — small, removes a recurring failure
4. **Decide removal-from-roster semantics** — currently undefined behaviour in a coach-facing flow
5. **The durable fix** — one save path owning every derived copy. Everything above is cheaper after this.
6. Then the workstreams: **B (team comparison)** is the most self-contained; **A (agent)** benefits
   most from the durable fix landing first; **C (JUCO)** is independent; **E (player dev)** needs the
   ownership decision before any code.

---

## 📚 READ FIRST
| document | why |
|---|---|
| `docs/PIPELINE_pitch_log_to_projections.md` | **Track B** — canonical spec. The read/write path section is the expensive knowledge. |
| `docs/AGENT_LEARNINGS_snapshot_layers_2026_09_01.md` | why every automated check passed while the UI was wrong |
| `docs/HANDOFF_2026_09_01_CONFIG_SOURCES_AND_CALIBRATION.md` | the three config systems, both solved gates |
| `docs/JUCO_AUDIT_2026_05_24.md` | JUCO is knowingly wrong — don't chase it ad hoc |
| `PROD_MIGRATIONS_TODO.md` | every prod migration |
| `scripts/audit-snapshot-consistency.ts` | the gate: must print ✅ CLEAN |

## 🧰 THE SCRIPTS THAT REPAIR DATA
```bash
scripts/rebake-player-snapshot-toggles.ts      # neutral x saved toggle -> player_snapshot (hitters + pitchers)
scripts/sync-board-from-roster-snapshot.ts     # once rostered, the board reads the roster snapshot
scripts/backfill-neutral-snapshots.ts --refresh  # team_build_players neutral (VERBATIM pitcher shape)
scripts/backfill-neutral-snapshot.ts --target-board-only  # target_board neutral (NORMALIZED shape)
scripts/audit-snapshot-consistency.ts          # verify: every build, every target, every user
```
⛔ The two neutral scripts are **NOT interchangeable** — the tables use different snapshot shapes.
Each owns exactly one table.
