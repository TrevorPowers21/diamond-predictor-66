# PostHog Analytics Setup — 2026-06-02

## What's Live

PostHog is fully integrated on `portal.rstriq.com` as of 2026-06-02.

**Project:** RSTR IQ  
**Project Token:** `phc_ydv5C8EDahk8FRm8JeWMjz3jjZMS5frPgcQmNYE58gHn`  
**Host:** `https://us.i.posthog.com`  
**Project ID:** 451057  
**Authorized Domain:** `https://portal.rstriq.com`

---

## What's Being Tracked

### Automatic
- **Page views** on every React Router navigation (`$pageview`)
- **Page leave** on route change, tab close, and visibility hidden (`$pageleave`) → enables time-on-page
- **Web Vitals** (INP, LCP, CLS, FCP, TTFB) → PostHog Web Vitals tab
- **Session recordings** (all inputs masked for privacy)
- **Autocapture** — clicks, form submits, rage clicks

### User Identification
- Fires after login via `posthog.identify(userId, { email, team, team_role, is_superadmin })`
- Resets on sign out
- Ties every event to a specific coach's email and program

### Custom Events
| Event | When it fires | Properties |
|-------|--------------|------------|
| `pdf_exported` | Coach exports scouting report or coach notes | `type`, `player`, `mode` |
| `player_added_to_board` | Coach adds player to Target Board | `player`, `team` |
| `player_added_to_high_follow` | Coach adds player to High Follow list | `player`, `team` |

---

## Dashboards

### RSTR IQ — Coach Activity (ID: 1658919)
General usage and feature adoption. Set to auto-refresh every 5 minutes.

| Insight | What it shows |
|---------|--------------|
| Page Views Over Time | Daily traffic trends (30d) |
| Unique Coaches Per Week | Weekly retention signal (60d) |
| Top Pages | Most visited pages ranked by views |
| Feature Adoption — Key Pages | Dashboard / Returning / Portal / Team Builder / Player Profile by week |
| PDF Exports | Export activity over time |
| Target Board + High Follow Additions | Value moment tracking |
| Page Views by Team | Which programs are most active |
| Coaches by State | Geographic map breakdown by `$geoip_subdivision_1_name` |
| Sessions Per Coach | Power user identification by email |
| Funnel: Dashboard → Profile → Board Add | Conversion from browse to action |

### RSTR IQ — Sales Intelligence (ID: 1658958)
Open before demos or prospect follow-up calls. Set to auto-refresh every 5 minutes.

| Insight | What it shows |
|---------|--------------|
| Active Coaches — Last 24h | Hourly activity today |
| Player Profiles Viewed Today | Which coach viewed which profiles |
| PDF Exports — High Intent Signal | Export activity by email (last 7d) |
| Pages Per Coach — Last 7 Days | Full activity breakdown per coach email |
| Target Board Activity by Coach | Who is actively building rosters |

---

## Architecture

### Files Changed
| File | What it does |
|------|-------------|
| `src/lib/posthog.ts` | Init, identify, reset, trackEvent, capturePageView, capturePageLeave, captureWebVital |
| `src/main.tsx` | Calls `initPostHog()` on app load |
| `src/hooks/useAuth.tsx` | Calls `identifyUser()` after login, `resetPostHog()` on sign out |
| `src/App.tsx` | `PostHogPageView` component — fires pageview/pageleave on every route change |
| `src/lib/reportWebVitals.ts` | Sends INP/LCP/CLS/FCP/TTFB to PostHog via `captureWebVital()` |
| `src/pages/PlayerProfile.tsx` | Custom events for PDF export, target board add, high follow add |

### Key Config Decisions
- `capture_pageview: false` — we fire manually so SPA route changes are tracked
- `capture_pageleave: false` — we fire manually with `prevPath` ref for accurate time-on-page
- `person_profiles: "identified_only"` — only create profiles for logged-in coaches
- `autocapture: true` — capture all clicks and form interactions
- `maskAllInputs: true` in session recording — hides sensitive input values

### Vercel Env Vars Required
| Variable | Value |
|----------|-------|
| `VITE_POSTHOG_KEY` | `phc_ydv5C8EDahk8FRm8JeWMjz3jjZMS5frPgcQmNYE58gHn` |
| `VITE_POSTHOG_HOST` | `https://us.i.posthog.com` |

⚠️ These are baked in at build time by Vite. After changing them in Vercel, a manual redeploy is required.

---

## Known Limitations

- **Web Analytics tab** does not auto-refresh — manual refresh required. Custom dashboards auto-refresh every 5 min.
- **Anonymous sessions** — coaches who visit `/auth` before logging in appear as UUID until they identify. PostHog merges the session retroactively on login.
- **Historical gap** — events before 2026-06-02 ~4pm ET are missing (wrong key was set in Vercel).

---

## Identified Work (Not Yet Done)

### More Custom Events to Add
These would significantly improve insight into feature adoption:

| Event | Where to add | Why |
|-------|-------------|-----|
| `team_builder_scenario_run` | TeamBuilder.tsx | High-value action — know which teams are building rosters |
| `transfer_portal_filter_applied` | TransferPortal.tsx | Understand what coaches are searching for |
| `player_comparison_viewed` | PlayerComparison.tsx | Feature adoption signal |
| `search_query` | ReturningPlayers.tsx | What are coaches searching? |
| `portal_player_contact_viewed` | TransferPortal.tsx | Strong intent signal |
| `scouting_report_viewed` | PlayerProfile.tsx | AI scouting adoption |

### PostHog Improvements
- **Cohorts** — create a "Power Users" cohort (5+ sessions/week) and "At Risk" cohort (no login in 7 days)
- **Alerts** — set up email alert when a new coach logs in for the first time (new user detection)
- **Survey** — PostHog supports in-app surveys; consider NPS survey after 5th session
- **Second project** — when NewtForce coach/player app is ready, add a second PostHog project with its own key

### Trevor Follow-Up
- Wire `feature/site-tracking` branch changes into awareness — all analytics changes are on `main`
- Consider adding PostHog to the landing page (`rstriq.com`) separately with same project key to track marketing-to-signup funnel
