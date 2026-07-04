# Staging ↔ Production Environment Separation
## Reference: RSTR IQ (diamond-predictor-66)

> **Purpose:** How this Vite + Supabase + Vercel app keeps staging and prod cleanly separated.
> Use the "Template" section at the bottom to copy this pattern to another project.

---

## 1. Branching & Deploy Flow

### Branch Map

| Branch | Purpose | Deploys to |
|---|---|---|
| `feature/*` | Feature development | local dev only |
| `staging` | Integration / testing branch | Vercel preview (if configured) |
| `main` | Production | Vercel production — `portal.rstriq.com` |

**No GitHub Actions or automated CI/CD exist.** Deploys are triggered by Vercel's Git integration watching the `main` branch. There are no branch protection rules or required status checks committed to the repo.

### Flow

```
feature/* → staging (manual PR/merge) → main (manual PR/merge) → Vercel auto-deploy
```

Data migrations and backfill scripts are **not wired to CI**. They run manually from a developer's local machine using the `npm run <script>` or `npm run <script>:prod` commands documented in §1 of Scripts below.

---

## 2. Frontend Hosting (Vercel, not Cloudflare)

### Platform

The frontend is a **Vercel** deployment — not Cloudflare Workers/Pages.
Evidence: [`vercel.json`](../vercel.json) at project root:

```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

The single rewrite rule converts Vercel into an SPA host (all routes → `index.html`).

No `wrangler.toml`, `wrangler.jsonc`, or Cloudflare Pages config was found in the repository.

### Build Command

```bash
npm run build   # → vite build (uses .env for prod Supabase keys baked in)
```

Vite bakes `import.meta.env.VITE_*` values into the JavaScript bundle **at build time**. The bundle that Vercel deploys to production contains the production Supabase anon key hardcoded. There is no runtime config injection.

### Preview Deployments

Vercel creates automatic preview deployments for any PR/push — but only if the Vercel project is configured to watch a GitHub repo (not confirmed from code alone). The build command is identical; which Supabase project gets used depends on which environment variables are set in the Vercel dashboard for that branch.

---

## 3. Environment Variables — How Staging vs Prod Differ

### File Loading Order (Vite)

Vite loads env files in this order, later files overriding earlier ones:

```
.env                  ← always loaded (git-tracked)
.env.local            ← always loaded, git-ignored (*.local in .gitignore)
.env.[mode]           ← loaded when --mode <mode> is set
.env.[mode].local     ← loaded when --mode <mode> is set, git-ignored
```

### What's in Each File

**`.env`** — Git-tracked, public anon keys only, production project:
```
# .env  (committed — safe because these are public anon keys)
VITE_SUPABASE_PROJECT_ID="trbvxuoliwrfowibatkm"
VITE_SUPABASE_URL="https://trbvxuoliwrfowibatkm.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_YR8l4neda98iEFz675e8Jg_yFBvhP_v"
VITE_POSTHOG_KEY="phc_ydv5C8EDahk8FRm8JeWMjz3jjZMS5frPgcQmNYE58gHn"
VITE_POSTHOG_HOST="https://us.i.posthog.com"
```

**`.env.local`** — Git-ignored (`*.local`), staging project for local dev:
```
# .env.local  (git-ignored — contains service-role key)
SUPABASE_URL=https://slrxowawbijbjrkozqlj.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...    # staging service-role key
VITE_SUPABASE_PROJECT_ID=slrxowawbijbjrkozqlj
VITE_SUPABASE_URL=https://slrxowawbijbjrkozqlj.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGci...    # staging anon key
```

**`.env.staging.local`** — Same as `.env.local` but scoped to `--mode staging`:
```
VITE_SUPABASE_PROJECT_ID="slrxowawbijbjrkozqlj"
VITE_SUPABASE_URL="https://slrxowawbijbjrkozqlj.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="eyJhbGci..."
```

**`.env.production.local`** — Must be created manually by each developer; never committed:
```
# .env.production.local  (create locally — git-ignored — for running :prod scripts)
SUPABASE_URL=https://trbvxuoliwrfowibatkm.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<prod service-role key>   # from Supabase dashboard
```

### Variable Summary

| Variable | Staging value | Prod value | Used by |
|---|---|---|---|
| `VITE_SUPABASE_URL` | `https://slrxowawbijbjrkozqlj...` | `https://trbvxuoliwrfowibatkm...` | Browser (baked at build) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | staging anon JWT | prod anon JWT | Browser (baked at build) |
| `SUPABASE_URL` | staging URL | prod URL | Node CLI scripts |
| `SUPABASE_SERVICE_ROLE_KEY` | staging service-role JWT | prod service-role JWT | Node CLI scripts |
| `VITE_POSTHOG_KEY` | same key (not split) | prod key | Analytics (PostHog) |

> **Footgun:** `VITE_POSTHOG_KEY` is the **same key** in both environments. Staging user sessions appear in the production PostHog dashboard.

---

## 4. Supabase Setup — The Central Question

### Answer: Two Separate Supabase Projects

| | Staging | Production |
|---|---|---|
| **Project ID** | `slrxowawbijbjrkozqlj` | `trbvxuoliwrfowibatkm` |
| **URL** | `https://slrxowawbijbjrkozqlj.supabase.co` | `https://trbvxuoliwrfowibatkm.supabase.co` |
| **Auth users** | Separate user pool | Separate user pool |
| **Data** | Staging data (seeded from prod snapshots manually) | Live production data |
| **RLS** | Same policies (from same migration files) | Same policies |

A third project ID (`kfkuhdmpchxyffmnowgj`) appears in `supabase/config.toml`. This is the **Supabase CLI linked project** used for running `supabase db push`. Its relationship to staging vs prod is managed by running `supabase link --project-ref <id>` before each migration push.

### Client Initialization ([`src/integrations/supabase/client.ts`](../src/integrations/supabase/client.ts))

The client auto-detects its context:

```typescript
const IS_NODE = typeof window === "undefined" && typeof process !== "undefined"
  && !!process.versions?.node;

if (IS_NODE) {
  // CLI scripts: use service-role key from process.env (loaded via --env-file-if-exists)
  SUPABASE_URL = (env.SUPABASE_URL || env.VITE_SUPABASE_URL) ?? "";
  SUPABASE_KEY = (env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY) ?? "";
  // auth: { persistSession: false, autoRefreshToken: false }
} else {
  // Browser: use Vite-injected values (baked at build time)
  SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
  SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  // auth: { storage: localStorage, persistSession: true, autoRefreshToken: true }
}
```

- **Browser** always uses the anon key (subject to RLS).
- **CLI scripts** use the service-role key (bypasses RLS; needed for backfills).

### Auth Configuration

- **Separate user pools**: Each Supabase project has its own `auth.users` table. A staging account does not exist in production. Developers mirror their prod account to staging with:
  ```bash
  npm run mirror-auth-user    # copies auth user record to staging
  npm run mirror-user-context # copies user context/org data to staging
  ```
- **Redirect URLs and Site URL** are configured per-project in the Supabase dashboard (not in code). Production is set to `https://portal.rstriq.com`.

### Schema Migrations

**83 migration files** live at `supabase/migrations/` with timestamp-prefixed names:
```
supabase/migrations/
  20260211141609_6f5d348f-3710-4901-83dc-179a077efc7d.sql
  20260612000000_default_build_architecture.sql
  ...  (83 total)
```

- **Applied via**: `supabase db push` (Supabase CLI) after `supabase link --project-ref <target-project-id>`
- **Pattern**: All migrations use `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` — idempotent
- **RLS policies**: Versioned inside migration files, promoted the same way

To apply to staging:
```bash
supabase link --project-ref slrxowawbijbjrkozqlj
supabase db push
```

To apply to production:
```bash
supabase link --project-ref trbvxuoliwrfowibatkm
supabase db push
```

No migration-diff tooling or automated promotion pipeline exists. The developer runs both commands manually.

### Data Seeding

Staging data is **not automatically synced from prod**. A few scripts exist for manual selective sync:
```bash
npm run sync-ids-from-prod    # copies D1 IDs from prod → staging
npm run mirror-auth-user      # copies auth account to staging
npm run mirror-user-context   # copies user_context row to staging
```

Large data (players, predictions, teams) is populated in staging separately via import scripts.

---

## 5. CLI Script Pattern — How Prod/Staging Is Enforced

Every data-mutating script follows this pattern (`scripts/backfill-build-snapshots.ts` lines 65–95):

```typescript
const isProd = process.argv.includes("--prod");
const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").toLowerCase();

// Detect prod by known project ID substring in URL
const looksLikeProd =
  supabaseUrl.includes("trbvxuoliwrfowibatkm") ||
  supabaseUrl.includes("prod");

// Refuse to write if env doesn't match intent
if (looksLikeProd && !isProd) {
  console.error("✗ SUPABASE_URL looks like PROD but --prod was not passed. Refusing to write.");
  process.exit(1);
}
if (isProd && !looksLikeProd) {
  console.error("✗ --prod passed but SUPABASE_URL doesn't look like prod. Refusing to write.");
  process.exit(1);
}
```

### `package.json` Script Pairing

Every destructive script has two entries:

```json
"backfill-build-snapshots":       "tsx --env-file-if-exists=.env.local        scripts/backfill-build-snapshots.ts",
"backfill-build-snapshots:prod":  "tsx --env-file-if-exists=.env.production.local scripts/backfill-build-snapshots.ts --prod"
```

- Plain `npm run <script>` → loads `.env.local` (staging) → no `--prod` flag → script safe to run
- `npm run <script>:prod` → loads `.env.production.local` (prod service-role key) → passes `--prod` → script applies to prod

The guard is **double-keyed**: the env file determines which DB you hit, the `--prod` flag is a required explicit acknowledgment. Neither alone is sufficient.

---

## 6. Data Isolation & Cost

| Dimension | State |
|---|---|
| Staging DB data | **Isolated** from prod — separate Supabase project |
| Staging auth users | **Isolated** — separate `auth.users` per project |
| PostHog analytics | **Shared** — same key (staging events appear in prod dashboard) |
| Vercel deployments | Per-branch previews share the prod Supabase if `VITE_SUPABASE_*` is not overridden in Vercel dashboard |
| Edge Functions | Deployed per-project via `supabase functions deploy` (must be done for both) |

**Cost:** Supabase's free tier allows up to 2 free projects per organization. RSTR IQ uses one project for staging and one for prod — both within the free tier limit (if on the Supabase free/Pro plan).

---

## 7. Gotchas

1. **Vite bakes env at build time, not runtime.** If you `npm run build` without `.env.local` overriding, you get prod keys baked in. Vercel's prod build always uses the prod keys from the Vercel dashboard. A staging Vercel preview must have its own environment variable overrides set in the Vercel project settings.

2. **`.env.local` overrides require a dev-server restart.** Vite does not hot-reload env file changes. After editing `.env.local`, stop and restart `npm run dev`. Browser hard-refresh is not enough.

3. **No automatic staging ↔ prod schema sync.** If you add a migration and only push to staging, prod drifts. The workflow requires manually running `supabase db push` against each project. No drift detection exists.

4. **`supabase/config.toml` has a third project ID** (`kfkuhdmpchxyffmnowgj`) — this is the project the Supabase CLI currently has linked. Before pushing migrations, always verify which project is linked: `supabase projects list`.

5. **Edge Functions must be re-deployed to each project.** `supabase functions deploy` targets the linked project only. If you update an Edge Function, you must link to staging, deploy, then link to prod, deploy.

6. **Auth redirect URLs must be kept current in both Supabase dashboards.** If you add a new auth flow or local dev port, update the `Redirect URLs` list in both projects' Auth settings.

7. **Service-role keys are never committed.** `.env.production.local` is in `.gitignore` (`*.local`). Every developer must obtain the prod service-role key from the Supabase dashboard or a secrets manager and create this file locally.

8. **`mirror-auth-user` only mirrors one user.** The script copies a single user's auth record and context to staging. Team members each need to run it for themselves.

---

## Template: Applying This Pattern to FastAPI + Cloud Run + Cloudflare Workers + Supabase

**Target:** A FastAPI backend on Cloud Run, one or more Cloudflare Workers frontends, and a currently-shared Supabase project that needs to be split into staging and prod.

### Step 0: Decision — Split the Supabase Project

Create a **second Supabase project** for staging. The shared-project model used by the NF Assessment Platform is a footgun (documented in `memory/reference_nf_shared_database.md` — prod data is at risk from staging migrations). The cost of a free tier staging project is zero.

1. Go to `supabase.com` → New Project → name it `<app>-staging`
2. Note the staging project ID, URL, anon key, and service-role key
3. Keep existing project as prod

### Step 1: Establish Migration Files

If you don't already have a `supabase/migrations/` directory:

```bash
supabase init          # creates supabase/ directory
supabase link --project-ref <PROD_PROJECT_ID>
supabase db pull       # generates initial migration from current prod schema
```

Now you have a baseline. Apply it to staging:

```bash
supabase link --project-ref <STAGING_PROJECT_ID>
supabase db push
```

Going forward, create new migrations with:
```bash
supabase migration new <description>   # creates supabase/migrations/<timestamp>_<description>.sql
# edit the file, then:
supabase db push   # applies to whichever project is linked
```

### Step 2: Environment Variables — FastAPI (Cloud Run)

Cloud Run environment variables are set per **service** and per **revision**. Create two Cloud Run services or use revision traffic splitting:

```
cloud-run-service-staging  ← revision tagged "staging"
cloud-run-service-prod     ← revision tagged "prod"
```

Set env vars per service in the Google Cloud Console or via `gcloud`:

```bash
# Staging service
gcloud run services update <service>-staging \
  --set-env-vars SUPABASE_URL=https://<staging-project-id>.supabase.co \
  --set-env-vars SUPABASE_SERVICE_ROLE_KEY=<staging-service-role-key> \
  --region us-central1

# Prod service
gcloud run services update <service>-prod \
  --set-env-vars SUPABASE_URL=https://<prod-project-id>.supabase.co \
  --set-env-vars SUPABASE_SERVICE_ROLE_KEY=<prod-service-role-key> \
  --region us-central1
```

Store service-role keys in **Google Secret Manager**, not as plain env vars:
```bash
echo -n "<key>" | gcloud secrets create SUPABASE_SERVICE_ROLE_KEY_STAGING --data-file=-
# In Cloud Run service definition: --set-secrets SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY_STAGING:latest
```

### Step 3: Environment Variables — Cloudflare Workers Frontend

For a Vite frontend deployed to Cloudflare Pages (or a Worker built from Vite):

**`wrangler.toml`** (if using Workers):
```toml
name = "my-app"
compatibility_date = "2024-01-01"

[vars]
VITE_API_URL = "https://api-prod.example.com"

[env.staging]
name = "my-app-staging"
[env.staging.vars]
VITE_API_URL = "https://api-staging.example.com"
```

For Cloudflare Pages (preferred for Vite apps), set env vars per branch in the Pages dashboard:
- **Production branch**: `main` → set prod Supabase URL/key
- **Preview branches**: all other branches → set staging Supabase URL/key

Because Vite bakes `VITE_*` vars at build time, Cloudflare Pages must inject them before the build runs. In Pages dashboard → Settings → Environment Variables, set variables for Production vs Preview separately.

**Local dev** (copy this repo's `.env.local` pattern):
```
# .env (git-tracked — production VITE_ vars)
VITE_SUPABASE_URL="https://<prod-project-id>.supabase.co"
VITE_SUPABASE_KEY="<prod-anon-key>"
VITE_API_URL="https://api-prod.example.com"

# .env.local (git-ignored — staging VITE_ vars for local dev)
VITE_SUPABASE_URL=https://<staging-project-id>.supabase.co
VITE_SUPABASE_KEY=<staging-anon-key>
VITE_API_URL=http://localhost:8000
```

**`.gitignore`**: add `*.local` to ensure `.env.local` is never committed.

### Step 4: CLI / Data Scripts Guard Pattern

For any script that writes to a database, copy the double-key guard:

```python
# Python equivalent (for FastAPI/management scripts)
import os, sys

IS_PROD = "--prod" in sys.argv
supabase_url = os.environ.get("SUPABASE_URL", "").lower()
looks_like_prod = "<prod-project-id>" in supabase_url or "prod" in supabase_url

if looks_like_prod and not IS_PROD:
    print("✗ SUPABASE_URL looks like prod but --prod not passed. Refusing.")
    sys.exit(1)
if IS_PROD and not looks_like_prod:
    print("✗ --prod passed but SUPABASE_URL doesn't look like prod. Refusing.")
    sys.exit(1)
```

And in `Makefile` or `package.json`:
```makefile
backfill:
    SUPABASE_URL=$(shell cat .env.local | grep SUPABASE_URL | cut -d= -f2) \
    SUPABASE_KEY=$(shell cat .env.local | grep SERVICE_ROLE | cut -d= -f2) \
    python scripts/backfill.py

backfill-prod:
    SUPABASE_URL=$(shell cat .env.production.local | grep SUPABASE_URL | cut -d= -f2) \
    SUPABASE_KEY=$(shell cat .env.production.local | grep SERVICE_ROLE | cut -d= -f2) \
    python scripts/backfill.py --prod
```

### Step 5: Auth — Separate User Pools per Environment

In each Supabase project dashboard:
1. **Authentication → URL Configuration** → set `Site URL` to the environment-specific frontend URL
2. **Authentication → URL Configuration** → add environment-specific `Redirect URLs`
   - Prod: `https://app.example.com/**`
   - Staging: `https://staging.app.example.com/**`, `http://localhost:5173/**`
3. Do NOT add staging redirect URLs to the prod Supabase project (unnecessary surface area)

### Step 6: Edge Functions

If FastAPI uses Supabase Edge Functions for any operations:

```bash
# Deploy to staging
supabase link --project-ref <staging-project-id>
supabase functions deploy <function-name>

# Deploy to prod
supabase link --project-ref <prod-project-id>
supabase functions deploy <function-name>
```

Automate this in a Makefile or GitHub Actions:
```yaml
# .github/workflows/deploy-edge-functions.yml
- name: Deploy to staging
  run: |
    supabase link --project-ref ${{ secrets.STAGING_PROJECT_ID }}
    supabase functions deploy process-jobs
  if: github.ref == 'refs/heads/staging'

- name: Deploy to prod
  run: |
    supabase link --project-ref ${{ secrets.PROD_PROJECT_ID }}
    supabase functions deploy process-jobs
  if: github.ref == 'refs/heads/main'
```

### Step 7: Migrate Existing Shared Data to the New Staging Project

If you currently share one Supabase project across prod and staging (like the NF Assessment Platform), here is the migration order:

1. **Take a snapshot** of current shared DB: `supabase db dump -f shared_backup.sql`
2. **Create new staging project** (Step 0 above)
3. **Apply all migrations** to staging (Step 1 above)
4. **Restore non-prod data** to staging:
   ```bash
   # Dump only staging-relevant tables (not prod customer data)
   pg_dump --data-only -t players -t player_predictions ... \
     "postgres://postgres:<pass>@db.<shared-project-id>.supabase.co:5432/postgres" \
     > staging_seed.sql
   psql "postgres://postgres:<pass>@db.<staging-project-id>.supabase.co:5432/postgres" \
     < staging_seed.sql
   ```
5. **Update frontend staging env vars** to point to new staging project
6. **Update backend staging env vars** (Cloud Run staging service) to new staging project
7. **Remove staging users from prod project** auth (optional cleanup)
8. **Update Redirect URLs** in each Supabase project to match the new split

### Checklist

```
[ ] Created separate staging Supabase project
[ ] All migrations applied to both projects
[ ] Edge Functions deployed to both projects
[ ] Auth Site URL + Redirect URLs set per project
[ ] Cloud Run staging service uses staging SUPABASE_URL + key
[ ] Cloud Run prod service uses prod SUPABASE_URL + key
[ ] Cloudflare Pages: prod branch vars point to prod project
[ ] Cloudflare Pages: preview branch vars point to staging project
[ ] .env (prod VITE_ vars) committed, *.local gitignored
[ ] .env.local (staging VITE_ vars) on each dev machine
[ ] .env.production.local (prod service-role key) on each dev machine, never committed
[ ] All data scripts have --prod guard pattern
[ ] PostHog / analytics: separate projects per env (don't share)
[ ] supabase/config.toml: update project_id to whichever project is the CLI default
[ ] Documented which migrations have been applied to each project (or just always push both)
```
