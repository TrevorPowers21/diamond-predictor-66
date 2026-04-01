# Diamond Predictor — Architecture Recommendation

## Current State

- **Frontend:** React + Vite + TypeScript, deployed via Vercel/Netlify
- **Backend (BaaS):** Supabase (PostgreSQL, Auth, Row Level Security)
- **Data:** Mix of Supabase tables, static JSON seed files (~1.6MB), and localStorage
- **Team:** 2 developers (Peyton + Trevor)

---

## Recommendation: Monorepo

One repo. Frontend and backend live together. Deploy independently.

### Why monorepo over separate repos

| Factor | Monorepo | Separate Repos |
|--------|----------|----------------|
| Cross-repo coordination | None needed | Constant version syncing |
| Atomic changes | Backend API + frontend consumer in one PR | Two PRs, hope they deploy in order |
| Shared types/constants | Import directly | Publish packages or duplicate |
| Seed data & scripts | One location | Which repo owns the data? |
| CI/CD | One pipeline, path-based triggers | Two pipelines, two configs |
| Onboarding | Clone one repo, done | Clone two repos, match versions |
| Team size fit | Perfect for 2 people | Designed for separate teams |

**Do not use git submodules.** They add complexity with no upside at this scale.

---

## Proposed Directory Structure

```
diamond-predictor-66/
│
├── frontend/                    # React + Vite + TypeScript
│   ├── src/
│   │   ├── components/          # UI components
│   │   ├── hooks/               # React hooks (useHitterSeedData, etc.)
│   │   ├── integrations/        # Supabase client + types
│   │   ├── lib/                 # Prediction engine, projections, utils
│   │   ├── pages/               # Route-level page components
│   │   ├── data/                # Static seed JSON (temporary, migrating out)
│   │   └── App.tsx
│   ├── public/
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   └── package.json
│
├── backend/                     # Python API (FastAPI)
│   ├── app/
│   │   ├── api/
│   │   │   ├── v1/
│   │   │   │   ├── projections.py    # Offensive + pitching projection endpoints
│   │   │   │   ├── seed_data.py      # Seed data processing + import
│   │   │   │   ├── analytics.py      # Heavy compute (WAR, NIL, comparisons)
│   │   │   │   └── health.py
│   │   │   └── router.py
│   │   ├── core/
│   │   │   ├── config.py             # Environment, Supabase connection
│   │   │   ├── security.py           # Supabase JWT validation
│   │   │   └── database.py           # Direct Postgres connection (SQLAlchemy/asyncpg)
│   │   ├── models/
│   │   │   ├── player.py
│   │   │   ├── prediction.py
│   │   │   └── team.py
│   │   ├── services/
│   │   │   ├── prediction_engine.py  # Core projection math (currently in frontend lib/)
│   │   │   ├── transfer_sim.py       # Transfer scenario simulation
│   │   │   ├── nil_valuation.py      # NIL budget allocation
│   │   │   └── seed_processor.py     # CSV/JSON → Supabase pipeline
│   │   └── main.py                   # FastAPI app entry point
│   ├── tests/
│   ├── alembic/                      # DB migrations (if needed beyond Supabase)
│   ├── requirements.txt
│   └── pyproject.toml
│
├── supabase/                    # Supabase project config
│   ├── migrations/              # SQL migration files
│   ├── functions/               # Edge functions (lightweight webhooks, auth hooks)
│   ├── seed.sql                 # Initial data seeding
│   └── config.toml
│
├── data/                        # Shared seed data + processing scripts
│   ├── raw/                     # Source CSVs from scouts/feeds
│   ├── processed/               # Cleaned data ready for import
│   └── scripts/                 # Python scripts for data cleaning/transforms
│
├── .github/
│   └── workflows/
│       ├── frontend.yml         # Build + deploy frontend (trigger: frontend/**)
│       ├── backend.yml          # Test + deploy backend (trigger: backend/**)
│       └── migrations.yml       # Run Supabase migrations (trigger: supabase/**)
│
├── ARCHITECTURE.md              # This file
└── README.md
```

---

## What Goes Where

### Frontend (React) — reads and displays
- All UI components, pages, routing
- Supabase client SDK for **simple reads** (player lookups, team lists, auth)
- React Query for caching and state management
- localStorage for draft state (target board, equation tweaks)

### Backend (FastAPI) — computes and processes
- **Projection engine** — move `predictionEngine.ts` and `pitchingEquations.ts` logic to Python
  - Enables pandas/numpy for statistical modeling
  - Single source of truth for projection math (no frontend/backend drift)
  - Unlocks batch processing, backtesting, model training
- **Seed data pipeline** — CSV upload → clean → validate → upsert to Supabase
  - Replace the admin "Sync Seed Data" button with a proper pipeline
  - Scheduled ingestion for recurring data feeds
- **Heavy analytics** — WAR calculations, NIL modeling, conference strength computations
  - These are CPU-bound and benefit from Python's data science ecosystem
- **Supabase JWT validation** — backend verifies the same Supabase auth tokens, no separate auth system

### Supabase — stores and secures
- PostgreSQL database (all tables, RLS policies)
- Auth (login, session management, JWT issuance)
- Edge Functions (lightweight: webhooks, triggered notifications, auth hooks only)
- Migrations (schema versioning)

### Data — shared assets
- Raw CSVs from scouting feeds
- Processing scripts (Python) that clean and normalize data
- Processed output ready for backend import endpoints

---

## Data Flow

```
                 ┌─────────────────────────────────────┐
                 │          Supabase (PostgreSQL)       │
                 │  players, predictions, teams,        │
                 │  conference_stats, park_factors,     │
                 │  hitter_stats_storage, etc.          │
                 └──────────┬──────────┬───────────────┘
                            │          │
                    Direct reads   Direct reads/writes
                    (simple CRUD)  (via service role)
                            │          │
                 ┌──────────▼──┐  ┌────▼──────────────┐
                 │  Frontend   │  │  Backend (FastAPI) │
                 │  (React)    │  │                    │
                 │             │◄─┤  /api/v1/project   │
                 │  Displays   │  │  /api/v1/transfer  │
                 │  data +     │  │  /api/v1/seed      │
                 │  user input │  │  /api/v1/analytics  │
                 └─────────────┘  └────────────────────┘
                                          ▲
                                          │
                                   ┌──────┴──────┐
                                   │  data/      │
                                   │  CSV/JSON   │
                                   │  processing │
                                   └─────────────┘
```

**Simple reads** (player list, team lookup, auth check) go directly from frontend → Supabase.
**Computed results** (projections, WAR, NIL, transfer sims) go frontend → backend API → Supabase.

---

## Migration Plan (Current → Monorepo)

### Phase 1 — Restructure repo (no functionality change)
1. Move all current files into `frontend/`
2. Move `supabase/` to repo root
3. Create empty `backend/` and `data/` directories
4. Update CI/CD paths
5. Verify frontend still builds and deploys

### Phase 2 — Stand up backend
1. Create FastAPI skeleton in `backend/`
2. Add Supabase connection (direct Postgres via `asyncpg` + Supabase JWT validation)
3. Port `predictionEngine.ts` → `prediction_engine.py` (single source of truth)
4. Add `/api/v1/health` endpoint
5. Deploy to Cloud Run (you already have this pattern from NF-BE)

### Phase 3 — Migrate frontend to call backend
1. Replace frontend prediction math with API calls to backend
2. Keep Supabase direct reads for simple CRUD (no change)
3. Move seed data processing from AdminDashboard button → backend endpoint
4. Move remaining JSON seed files to `data/` with backend import pipeline

### Phase 4 — Finish seed data migration
1. All seed JSON → Supabase tables (hitter stats: done, power ratings: done, exit positions: TODO, pitching: TODO)
2. Delete `frontend/src/data/` directory
3. Admin uploads go through backend → Supabase (not frontend → Supabase)

---

## Deployment

| Component | Platform | Trigger |
|-----------|----------|---------|
| Frontend | Vercel or Netlify | Push to `frontend/**` |
| Backend | Google Cloud Run | Push to `backend/**` |
| Supabase | Supabase CLI | Push to `supabase/migrations/**` |

All three deploy independently from the same repo. A change to the backend doesn't redeploy the frontend, and vice versa.

---

## Why FastAPI (not Node/Express)

- You already run FastAPI on NF-BE — known stack, known deployment (Cloud Run)
- Python data science ecosystem (pandas, numpy, scipy) is unmatched for analytics
- Projection math benefits from statistical libraries
- Supabase has a Python client (`supabase-py`) for direct integration
- FastAPI's automatic OpenAPI docs make frontend integration straightforward

---

## Key Principles

1. **Frontend is a display layer.** It reads data and renders UI. It does not compute projections.
2. **Backend is the computation layer.** All projection math, statistical modeling, and data processing lives here. One source of truth.
3. **Supabase is the data layer.** All persistent state lives in PostgreSQL. RLS enforces access control. No application-level auth reimplementation.
4. **Seed data flows one direction:** `data/raw/` → processing script → `backend/api/seed` → Supabase tables. Never frontend → Supabase for bulk data.
5. **Deploy independently, develop together.** One repo, path-based CI triggers, separate deploy targets.
