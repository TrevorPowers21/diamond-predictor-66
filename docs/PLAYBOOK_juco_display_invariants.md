# JUCO Display Invariants & Common Regressions

Why this exists: the same class of bugs has surfaced in JUCO display surfaces multiple times.
The D1 stored-vs-live audit (May 2026) settled this for D1 and the same rules apply to JUCO,
but the JUCO panel was added later and didn't inherit them. Document so the next regression
gets caught at code review instead of in a coach's screen.

Affected surface today: `src/components/JucoPlayerDashboardPanel.tsx` (hitter + pitcher tabs).
Apply the same rules to any new JUCO surface (target board JUCO subtab, JUCO simulator, etc).

---

## Invariant 1 — Stored values only, no live re-compute

The dashboard reads `p_avg`, `p_obp`, `p_slg`, `p_iso`, `p_ops`, `p_wrc_plus` (and pitcher
equivalents) **directly** from `player_predictions`. Never re-derive from raw rates.

**Anti-pattern (causes regressions):**
```ts
// WRONG: live wRC+ from raw rates
const wrcPlus = r.p_wrc_plus != null ? Number(r.p_wrc_plus) : computeWrcPlus(avg, obp, slg, iso);

// WRONG: ISO = SLG - AVG fallback
const iso = r.p_iso != null ? Number(r.p_iso) : (avg != null && slg != null ? slg - avg : null);

// WRONG: OPS = OBP + SLG fallback
const ops = r.p_ops != null ? Number(r.p_ops) : (obp != null && slg != null ? obp + slg : null);

// WRONG (pitcher side): pRV+ from rates
const prvPlus = r.p_rv_plus != null ? Number(r.p_rv_plus) : computePrvPlus(...);
```

**Correct:**
```ts
const wrcPlus = r.p_wrc_plus != null ? Number(r.p_wrc_plus) : null;
const iso = r.p_iso != null ? Number(r.p_iso) : null;
```

Null displays as blank. The fix is upstream (run the backfill) — not in the read layer.

---

## Invariant 2 — Deterministic row order across reloads

Postgres returns rows in undefined order without `ORDER BY`. When the panel deduplicates
multiple variants per player (`regular` vs `precomputed`), the "winner" depends on insertion
order into the dedupe Map, which depends on DB return order. That causes row order flicker.

**Anti-pattern:**
```ts
const q = supabase.from("player_predictions").select(...).in("variant", ["regular", "precomputed"]);
// No ORDER BY → flicker on each reload
const byPlayer = new Map();
for (const r of preds) {
  const existing = byPlayer.get(r.player_id);
  const isTeamScoped = r.customer_team_id != null && r.variant === "precomputed";
  if (!existing || isTeamScoped) byPlayer.set(r.player_id, r); // last-wins race
}
```

**Correct:**
```ts
const q = supabase
  .from("player_predictions")
  .select(...)
  .in("variant", ["regular", "precomputed"])
  // Team-scoped rows first, so take-first picks them automatically.
  .order("customer_team_id", { ascending: false, nullsFirst: false })
  .order("player_id", { ascending: true });

const byPlayer = new Map();
for (const r of preds) {
  if (!byPlayer.has(r.player_id)) byPlayer.set(r.player_id, r);
}
```

---

## Invariant 3 — Sort tie-breaker

Client-side sort must include a stable tie-breaker. Without one, equal sort values stay in
insertion order, which depends on the (non-deterministic) DB return order.

**Anti-pattern:**
```ts
rows.sort((a, b) => {
  if (av == null && bv == null) return 0; // ← ties drift
  if (av == null) return 1;
  if (bv == null) return -1;
  return (Number(av) - Number(bv)) * mul;
});
```

**Correct:**
```ts
rows.sort((a, b) => {
  let cmp = 0;
  if (av == null && bv == null) cmp = 0;
  else if (av == null) cmp = 1;
  else if (bv == null) cmp = -1;
  else cmp = (Number(av) - Number(bv)) * mul;
  if (cmp !== 0) return cmp;
  return (a.source_player_id || "").localeCompare(b.source_player_id || ""); // tie-breaker
});
```

---

## Invariant 4 — Position-based filtering at the query

JUCO source data occasionally misclassifies hitters as `position="P"` and pitchers
as a hitter position. The hitter dashboard must exclude pitcher positions (unless
flagged `is_twp=true`), and vice versa.

**Correct:**
```ts
// Hitter dashboard
.or("position.not.in.(SP,RP,CL,P,LHP,RHP),is_twp.eq.true", { referencedTable: "players" })

// Pitcher dashboard
.or("position.in.(SP,RP,CL,P,LHP,RHP),is_twp.eq.true", { referencedTable: "players" })
```

This is a defense-in-depth filter, not the primary fix. The primary fix is the data
reclass (see "Position reclass" below).

---

## Invariant 5 — JUCO never goes through the D1 engine

JUCO returner pitchers must be passthrough (verbatim 2026 actuals → 2027 projections).
The D1 engine math (park factors, conference env+, NCAA-baseline regression) produces
nonsense for JUCO rates.

Code branches must check `division === "NJCAA_D1"` before calling `recalcPitcher`,
`recalcReturner`, or any other D1-baselined function.

Canonical JUCO branches today:
- `src/lib/jucoReturnerProjection.ts` — hitter returner passthrough
- `src/lib/jucoReturnerPitcherProjection.ts` — pitcher returner passthrough
- `src/lib/predictionEngine.ts` `bulkRecalculatePredictionsLocal` — both branches added 2026-06-11
- `scripts/backfill-2027-hitter-returners.ts` — branch at line 202
- `scripts/precompute-returner-pitchers.ts` — branch at line 285

Any new code path that writes `p_avg` or `p_era` on JUCO rows MUST branch and use the
passthrough function. Failing to branch silently regresses the verbatim invariant.

---

## Invariant 6 — Conference resolution must handle JUCO district fallback

Conference Stats keys JUCO districts as `"NJCAA D1 <District> District"`, but
`players.conference` stores `"NJCAA D1 <District>"`. Conference resolvers must apply
the district fallback or all JUCO projections will block on missing "From AVG+" /
"From Stuff+" inputs.

Canonical fallback:
```ts
const direct = lookupByName(name);
if (direct) return direct;
const jucoName = jucoDistrictNameFromConference(name);
if (jucoName) {
  const jucoId = JUCO_DISTRICT_CONFERENCE_ID[jucoName];
  if (jucoId) return lookupById(jucoId);
}
return null;
```

Currently present in:
- `scripts/precompute-transfer-projections.ts`
- `scripts/precompute-pitchers.ts`
- `supabase/functions/process-precompute-jobs/index.ts` (added 2026-06-11)

---

## Common regression recipes (and the actual fixes)

### Row order flickers
Apply Invariant 2 + Invariant 3.

### JUCO projections inflate/deflate (look like D1 math)
Apply Invariant 5. Re-run the relevant backfill (`backfill-2027-hitter-returners` or
`precompute-returner-pitchers`) to overwrite any prior D1-tainted values.

### JUCO hitter precompute blocks 99%+ players
Apply Invariant 6. Then re-fire JUCO scope precompute for all customer teams.

### Pitchers (or hitters) appearing on the wrong tab
Apply Invariant 4 to the query. Then audit the data: any player with `position="P"`
but real PA and no IP needs `position` updated (usually → `UTL`) and JUCO precompute
re-fired so they appear in the transfer pool.

---

## Position reclass procedure

When JUCO source data has misclassified pitchers-that-are-actually-hitters:

```sql
-- Find candidates (staging or prod):
SELECT id, first_name, last_name, team, position, pa, ip
FROM players
WHERE division = 'NJCAA_D1'
  AND position IN ('P','SP','RP','LHP','RHP','CL')
  AND pa >= 75
  AND (ip IS NULL OR ip < 20)
  AND is_twp = false;

-- Update them to UTL:
UPDATE players
SET position = 'UTL'
WHERE id IN ( ... ids ... );
```

Then re-fire JUCO hitter precompute for each active customer team so the newly-eligible
players get team-scoped transfer projections:
```bash
# Per-team via edge function, scope=juco. See scripts/_check_slots.ts in branch
# feature/war-room-draftiq for the invocation pattern.
```

Or run the bulk script: `npm run precompute-transfer-projections -- --division JUCO`.

---

## Related docs

- `docs/AUDIT_stored_vs_live_2026-05-24.md` — the original D1 stored-first audit
- `CLAUDE.md` "Stored-first audit" section — phase status
- Memory: `project_stored_derived_values_architecture.md`, `project_juco_*.md`

---

_Last revised 2026-06-11 after the JUCO Player Dashboard flicker + position-leak regression on staging._
