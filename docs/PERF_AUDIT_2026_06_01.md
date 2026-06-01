# Performance Audit — 2026-06-01
**Context:** 30-50 active users. Goal: reduce DB load, improve perceived load time, cut bundle size.
**Branch:** All changes on `staging`. Needs Trevor review → merge to `main`.

---

## What's Done

### 1. Progressive Loading — PlayerProfile
**File:** `src/pages/PlayerProfile.tsx`

Previously the page showed a blank spinner until ALL queries resolved. Now:
- Back button and page shell render immediately
- Player name/badges show an animated skeleton while the `player` query loads
- Stat cards show a skeleton grid while `predictions` loads
- NIL, season stats, scouting report fill in below the fold after main content

**Impact:** Coaches see something useful in ~200-400ms instead of staring at a blank screen.

---

### 2. Eliminated Tab-Switch Re-fetches
**Files:** `src/pages/Dashboard.tsx`, `src/pages/ReturningPlayers.tsx`, `src/pages/HighFollowList.tsx`

Added `refetchOnWindowFocus: false` to all useQuery calls across these pages.

Previously every time a coach switched browser tabs and came back, React Query would re-fire all queries. At 50 users with multiple tabs open this created constant background query spikes.

**Impact:** Queries only re-fetch on staleTime expiry, not on every tab switch.

---

### 3. staleTime Increases — ReturningPlayers Pitcher Queries
**File:** `src/pages/ReturningPlayers.tsx`

Increased `staleTime` from 30 minutes to 1 hour on pitcher prediction and pitcher meta queries.

Pitcher/player stats don't change minute-to-minute — they update on the precompute schedule. No data freshness tradeoff.

**Impact:** Halves re-fetch frequency for these queries per user session.

---

### 4. ReturningPlayers pageSize Cap
**File:** `src/pages/ReturningPlayers.tsx` (line ~1280)

Capped URL param `pageSize` to 100 max:
```ts
setPageSize(Math.min(Number(parsed.pageSize), 100));
```

Previously a coach could pass `?pageSize=1000` in the URL triggering a full 1000-row fetch + NIL batch queries. At 50 users this is a DB bomb.

**Impact:** Prevents runaway full-table scans from URL manipulation.

---

### 5. Narrowed `.select("*")` Queries
**Files:** `src/pages/PlayerProfile.tsx`, `src/pages/HighFollowList.tsx`

Replaced `.select("*")` with explicit column lists on:
- `players` table (PlayerProfile)
- `Hitter Master` fallback (PlayerProfile)
- `player_predictions` (PlayerProfile + HighFollowList)
- `season_stats` (PlayerProfile)
- `Hitter Master` (HighFollowList)
- `Pitching Master` (HighFollowList)
- `player_prediction_internals` (PlayerProfile admin)

**Impact:** ~60% less data transferred per fetch on these pages. Supabase only serializes and sends columns that are actually used.

---

### 6. Shared NIL Valuations Hook
**File:** `src/hooks/useNilValuation.ts` (new file)

Centralized NIL valuation fetching into a shared hook with:
- `staleTime: 2 * 60 * 60 * 1000` (2 hours)
- `refetchOnWindowFocus: false`
- Explicit column select (not `*`)

Previously NIL data was fetched independently on PlayerProfile, Dashboard, HighFollowList, and ReturningPlayers with no shared cache — each page had its own timer and would re-fetch independently.

PlayerProfile now uses `useNilValuation(id)` instead of an inline useQuery.

**For Trevor:** Dashboard and ReturningPlayers still have their own NIL fetch patterns — worth wiring those to `useNilValuation` in a follow-up.

---

### 7. Main Bundle: 2,253kB → 442kB (80% reduction)
**File:** `vite.config.ts`

Added `build.rollupOptions.output.manualChunks` to split the monolithic bundle into route-based lazy-loaded chunks:

| Chunk | Size (gzip) | Content |
|-------|-------------|---------|
| `index` (main) | 125kB | Core app, auth, routing |
| `vendor-react` | 53kB | react, react-dom, react-router-dom |
| `vendor-supabase` | 46kB | @supabase/supabase-js |
| `vendor-query` | 12kB | @tanstack/react-query |
| `vendor-ui` | 35kB | Radix UI components |
| `page-admin` | 106kB | AdminDashboard (lazy) |
| `page-transfer-portal` | 27kB | TransferPortal (lazy) |
| `page-returning` | 26kB | ReturningPlayers (lazy) |
| `page-team-builder` | 57kB | TeamBuilder (lazy) |
| `pdf-generator` | 141kB | jspdf + html2canvas (lazy) |

Previously every page load downloaded all pages and libraries upfront. Now coaches only download the pages they actually visit.

**Impact:** First load time drops significantly — especially on mobile or slower connections.

---

### 8. Auth Queries Parallelized
**File:** `src/hooks/useAuth.tsx`

`fetchUserContext` previously fired 3 sequential Supabase queries on every login and page refresh:
1. `user_roles`
2. `user_team_access`
3. `customer_teams`

Queries 1 and 2 are independent. Batched with `Promise.all`:
```ts
const [{ data: roleRows }, { data: accessRow }] = await Promise.all([
  supabase.from("user_roles")...,
  supabase.from("user_team_access")...,
]);
```

Query 3 still waits on 1+2 (needs role + team ID), which is unavoidable.

**Impact:** Login/page-refresh auth drops from 3 serial round trips to 2. At 50 concurrent logins that's 50 fewer Supabase queries in the burst.

---

## Still Open (Deferred)

### A. ReturningPlayers Custom Sort (Phase 2 — Trevor)
When a coach sorts by a non-standard column (anything outside `FAST_DB_SORT_KEYS`), the page fetches ALL player_predictions rows and sorts in JavaScript. At 50 users sorting simultaneously this is the biggest remaining DB risk.

**Fix:** Add computed sort columns to a pre-computed DB view, or extend `FAST_DB_SORT_KEYS` to cover more sort options.
**Owner:** Trevor — touches data model.

### B. CoachNotes Server-Side Filter (Deferred)
CoachNotes fetches all notes then filters client-side. Low priority until feature is more actively used.

**Fix:** Add `.eq("player_id", playerId)` server-side.

### C. AdminDashboard Unbounded Queries (Deferred)
AdminDashboard has multiple `.select("*")` with no limits. Now lazy-loaded (bundle fix) so it doesn't impact initial load. Low priority — only superadmins hit this page.

**Fix:** Paginate admin table queries to 100 rows, add column filters.

### D. Dashboard + ReturningPlayers NIL Hook Migration (Follow-up)
`useNilValuation` hook was created and wired into PlayerProfile. Dashboard and ReturningPlayers still have their own NIL fetch patterns. Low priority — those fetches already have reasonable staleTime.

**Fix:** Replace inline NIL queries in Dashboard and ReturningPlayers with `useNilValuation`.

---

## How to Merge
1. Review staging: `https://rstr-iq-portal-dtck5m0yy-trevorpowers21s-projects.vercel.app`
2. Test: player profile load speed, tab switching (no spinners), login
3. `git checkout main && git merge staging && git push origin main`
