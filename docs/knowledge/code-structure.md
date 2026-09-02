# Knowledge — code structure and shared logic

> Refactoring **rules** are in `CLAUDE.md`. This is the reference detail, moved out 2026-09-02.
> ⚠ Line counts drift — they are indicative, not assertions. Measure before relying on one.

## Canonical locations for shared functions

Each of these was duplicated somewhere and consolidated. **Import from the canonical file; do not
re-implement.**

| Function | Canonical file | Had been duplicated in |
|---|---|---|
| `computeOWarFromWrcPlus` | `src/lib/playerCalcs.ts` | TeamBuilder, PlayerProfile, ReturningPlayers, useTeamBuilderSimulation |
| `normalizeName` | `src/lib/nameUtils.ts` (re-exported from `helpers.ts`) | TeamBuilder, PlayerProfile |
| `nameTeamKey`, `normalizeTeamForKey`, `getNameVariants` | `src/lib/nameUtils.ts` | PlayerProfile |
| `isUuid`, `readStoragePitcherLocalPlayers`, `parseBuildPlayerMeta`, `serializeBuildPlayerMeta` | `src/pages/team-builder/helpers.ts` | TeamBuilder (inline) |
| `defaultHitterDepthRoleFromPa`, `defaultPitcherDepthRoleFromIp` | `src/pages/team-builder/helpers.ts` | TeamBuilder (inline) |
| `asPitcherRole` | `src/pages/team-builder/helpers.ts` | TeamBuilder had a duplicate — removed |
| Prediction selection (`pickPreferredPrediction`, team-scoped) | `src/lib/teamScopedPredictions.ts` | — |
| `depthKey`, `slotMatchesPosition`, `classColor`, `playerCurrentClass` | `src/pages/team-builder/helpers.ts` | — |

## Deferred extraction — `addPlayerFromTargetSearch`

**Difficulty: CRITICAL.** Three interleaved async paths. It stays in `TeamBuilder.tsx` until a **4th**
player-add path is needed — that is the forcing function, and inventing one early costs more than the
duplication.

⚠ Its transfer-projection duplication was ~130 lines. **That live compute was DELETED on 2026-09-01** —
the add path now reads the stored precomputed row. Do not reintroduce a live compute here.

## Hook extraction guideline

When a function closes over **8+ dependencies** and has **5+ logical sections**, extract it as a `use*`
hook that takes deps as a typed params object and returns the callback. Keep the dep array accurate —
omit values not read inside the body.

## Key files

| File | Role |
|---|---|
| `src/pages/TeamBuilder.tsx` | the large page; one hard extraction remains (`addPlayerFromTargetSearch`) |
| `src/pages/team-builder/hooks/useTeamBuilderSimulation.ts` | projection math + WAR sort + the toggle guardrails |
| `src/pages/team-builder/hooks/useLoadBuild.ts` | build load; **exposes `player_snapshot` + `_snapshotBacked`** |
| `src/pages/team-builder/helpers.ts` | shared team-builder utils (table above) |
| `src/pages/team-builder/tabs/DepthTab.tsx` | self-contained depth render logic |
| `src/hooks/useTargetBoard.ts` | board reads/writes; all three snapshot shapes |

## Watch out for

- `depthAssignments` / `depthPlaceholders` state stays in `TeamBuilder.tsx` and is passed to `DepthTab`
  as props — **not** moved there. It persists to Supabase.
- Merging `staging` into a long-lived refactor branch reliably conflicts on `TeamBuilder.tsx`.
  Cherry-picking individual commits is usually less painful.
- `types.ts` is **stale** — it doesn't know `customer_team_id` exists on `player_predictions`, which has
  forced two `as any` casts. Regenerate it.
- `node-postgres` returns `numeric` (OID 1700) as a **STRING**. A script that writes one back
  unconverted puts a string in a numeric column, and the UI then dies on `.toFixed is not a function`.
  Set `pg.types.setTypeParser(1700, Number)` (and `20` for int8).

## The three guardrails in `useTeamBuilderSimulation`

Load-bearing, and the reason toggles behave correctly during a live change:

```ts
const snapshotBacked = !!(p as any)._snapshotBacked && !(p as any)._dirty;
const devAggScale    = snapshotBacked ? 1 : (storedMult > 0 ? sessionMult / storedMult : 1);
const shownFinal     = ((p as any)._dirty && shown != null && devAggScale !== 1) ? { ...scaled } : shown;
```

A clean row returns early, reading `player_snapshot ?? transfer_snapshot`. The live compute exists
**only** to bridge the moment between a toggle change and the snapshot being rewritten — it is not a
general compute path. See `docs/knowledge/snapshots-and-recompute.md`.
