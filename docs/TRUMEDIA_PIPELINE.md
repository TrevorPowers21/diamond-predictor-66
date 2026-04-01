# TruMedia Automated Data Pipeline

## Overview

Automate the current manual workflow: **Login to TruMedia → Export CSV → Process → Upload to Supabase** — running on a recurring schedule (multiple times per day) without human intervention.

---

## Current Manual Process

```
Peyton/Trevor
    │
    ├── 1. Open browser, go to TruMedia
    ├── 2. Log in with credentials
    ├── 3. Navigate to reports/exports
    ├── 4. Select filters (season, stats, players)
    ├── 5. Click "Export CSV"
    ├── 6. Download CSV to local machine
    ├── 7. Open Admin Dashboard
    └── 8. Upload CSV via sync button
```

**Problems:** Manual, error-prone, can't run overnight, doesn't scale to multiple-times-per-day freshness.

---

## Automated Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloud Scheduler (cron)                    │
│              e.g. every 6 hours: 6am, 12pm, 6pm, 12am      │
└──────────────────────────┬──────────────────────────────────┘
                           │ triggers
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Agent Service (Cloud Run Job)                   │
│                                                             │
│  ┌───────────────────────────────────────────────────┐      │
│  │  Step 1: AUTHENTICATE                             │      │
│  │  - Launch headless browser (Playwright)           │      │
│  │  - Navigate to TruMedia login                     │      │
│  │  - Enter credentials from Secret Manager          │      │
│  │  - Handle MFA if required (TOTP from secret)      │      │
│  │  - Verify login success (check for dashboard)     │      │
│  │  - Store session cookies for reuse                │      │
│  └──────────────────────┬────────────────────────────┘      │
│                         │                                    │
│  ┌──────────────────────▼────────────────────────────┐      │
│  │  Step 2: NAVIGATE + EXPORT                        │      │
│  │  - Go to reports/export page                      │      │
│  │  - Set filters (season, date range, stat type)    │      │
│  │  - Click export/download button                   │      │
│  │  - Wait for CSV download to complete              │      │
│  │  - Repeat for each report type:                   │      │
│  │    • Hitter stats (AVG, OBP, SLG, wRC+)          │      │
│  │    • Power ratings (EV, barrel%, launch angle)    │      │
│  │    • Pitching stats (ERA, FIP, WHIP, K/9)        │      │
│  │    • Stuff+ / pitch-level data                    │      │
│  └──────────────────────┬────────────────────────────┘      │
│                         │                                    │
│  ┌──────────────────────▼────────────────────────────┐      │
│  │  Step 3: VALIDATE + TRANSFORM                     │      │
│  │  - Verify CSV is not empty / not an error page    │      │
│  │  - Check row count against expected range          │      │
│  │  - Parse CSV with standard column mapping          │      │
│  │  - Normalize names (strip accents, fix encoding)  │      │
│  │  - Normalize team/conference names (use canonical) │      │
│  │  - Flag new players not in existing database       │      │
│  │  - Compute deltas from last import                │      │
│  └──────────────────────┬────────────────────────────┘      │
│                         │                                    │
│  ┌──────────────────────▼────────────────────────────┐      │
│  │  Step 4: LOAD TO SUPABASE                         │      │
│  │  - Upsert hitter_stats_storage                    │      │
│  │  - Upsert hitting_power_ratings_storage           │      │
│  │  - Upsert pitching_power_ratings_storage          │      │
│  │  - Link player_id UUIDs where match exists         │      │
│  │  - Log import stats (rows inserted/updated/skipped)│      │
│  └──────────────────────┬────────────────────────────┘      │
│                         │                                    │
│  ┌──────────────────────▼────────────────────────────┐      │
│  │  Step 5: NOTIFY + LOG                             │      │
│  │  - Write import report to Supabase log table      │      │
│  │  - Send Slack/email notification with summary     │      │
│  │  - Alert on failures or anomalies:                │      │
│  │    • Login failed                                 │      │
│  │    • CSV empty or malformed                       │      │
│  │    • Row count dropped significantly              │      │
│  │    • New unmatched players above threshold         │      │
│  └───────────────────────────────────────────────────┘      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Component | Tool | Why |
|-----------|------|-----|
| Browser automation | **Playwright** (Python) | Headless Chrome, async, built-in wait/retry, better than Selenium/Puppeteer for scraping |
| Runtime | **Cloud Run Job** | Runs on demand or cron, scales to zero, no idle cost, you already use Cloud Run |
| Scheduler | **Cloud Scheduler** | GCP-native cron, triggers Cloud Run Jobs via HTTP |
| Secrets | **GCP Secret Manager** | TruMedia credentials, Supabase service key — never in code or env vars |
| Database | **Supabase (PostgreSQL)** | Already your data layer — upsert directly |
| Notifications | **Slack webhook** or **email via SendGrid** | Failure alerts + daily summary |
| Monitoring | **Cloud Logging** | Structured logs from each pipeline step |

---

## Detailed Step Breakdown

### Step 1: Authenticate

```python
# Pseudocode — Playwright login flow

async def authenticate(page: Page, credentials: dict) -> bool:
    """
    Login to TruMedia. Returns True if successful.
    Handles: normal login, session reuse, MFA (if applicable).
    """
    # Try session reuse first (skip login if cookies still valid)
    if saved_cookies_exist():
        await page.context.add_cookies(load_cookies())
        await page.goto(TRUMEDIA_DASHBOARD_URL)
        if await is_logged_in(page):
            log.info("Session reuse successful")
            return True

    # Fresh login
    await page.goto(TRUMEDIA_LOGIN_URL)
    await page.fill('input[name="email"]', credentials["email"])
    await page.fill('input[name="password"]', credentials["password"])
    await page.click('button[type="submit"]')

    # Wait for navigation — either dashboard or MFA prompt
    await page.wait_for_load_state("networkidle")

    # Handle MFA if present
    if await page.is_visible('input[name="mfa_code"]'):
        totp_secret = credentials["totp_secret"]
        code = generate_totp(totp_secret)
        await page.fill('input[name="mfa_code"]', code)
        await page.click('button[type="submit"]')
        await page.wait_for_load_state("networkidle")

    # Verify success
    if await is_logged_in(page):
        save_cookies(await page.context.cookies())
        return True

    raise AuthenticationError("Login failed — check credentials or page structure")
```

**Key considerations:**
- **Session reuse** — don't login every run; reuse cookies until they expire
- **MFA** — if TruMedia requires it, store TOTP seed in Secret Manager and generate codes programmatically
- **Rate limiting** — space runs apart (6hr default); don't hammer their login
- **Selector stability** — TruMedia may change their HTML; use data-testid or stable selectors where possible, fall back to text content matching

### Step 2: Navigate + Export

```python
async def export_csv(page: Page, report_type: str, filters: dict) -> Path:
    """
    Navigate to export page, apply filters, download CSV.
    Returns path to downloaded file.
    """
    await page.goto(TRUMEDIA_EXPORT_URL)

    # Apply filters
    if filters.get("season"):
        await select_dropdown(page, "season", filters["season"])
    if filters.get("date_range"):
        await set_date_range(page, filters["date_range"])
    if filters.get("stat_category"):
        await select_dropdown(page, "stat_category", filters["stat_category"])

    # Trigger download
    async with page.expect_download() as download_info:
        await page.click('button:has-text("Export")')  # Adjust selector
    download = await download_info.value

    # Save to temp directory
    dest = DOWNLOAD_DIR / f"{report_type}_{datetime.now().isoformat()}.csv"
    await download.save_as(dest)

    # Validate file exists and has content
    if not dest.exists() or dest.stat().st_size < 100:
        raise ExportError(f"Downloaded file is empty or missing: {dest}")

    log.info(f"Downloaded {report_type}: {dest} ({dest.stat().st_size} bytes)")
    return dest
```

**Report types to export (run sequentially per login session):**

| Report | Target Table | Key Columns |
|--------|-------------|-------------|
| Hitter batting stats | `hitter_stats_storage` | player_name, team, AVG, OBP, SLG |
| Hitter power metrics | `hitting_power_ratings_storage` | player_name, team, EV, barrel%, launch_angle, contact% |
| Pitcher stats | `pitching_power_ratings_storage` | player_name, team, ERA, FIP, WHIP, K/9, BB/9 |
| Stuff+ data | `pitching_stuff_plus_storage` | player_name, team, stuff+, pitch-level metrics |

### Step 3: Validate + Transform

```python
def validate_and_transform(csv_path: Path, report_type: str) -> pd.DataFrame:
    """
    Read CSV, validate structure, normalize data, compute deltas.
    """
    df = pd.read_csv(csv_path)

    # --- Structural validation ---
    expected_columns = COLUMN_MAPS[report_type]
    missing = set(expected_columns.keys()) - set(df.columns)
    if missing:
        raise ValidationError(f"Missing columns: {missing}")

    # Rename columns to match Supabase schema
    df = df.rename(columns=expected_columns)

    # --- Row count sanity check ---
    last_count = get_last_import_count(report_type)
    if last_count and len(df) < last_count * 0.5:
        raise ValidationError(
            f"Row count dropped {last_count} → {len(df)}. "
            "Possible export filter issue. Aborting."
        )

    # --- Data normalization ---
    df["player_name"] = df["player_name"].apply(normalize_name)
    df["team"] = df["team"].apply(normalize_team_name)
    df["conference"] = df["team"].apply(lookup_conference)  # from conferenceMapping

    # --- Flag new/unmatched players ---
    existing_names = get_existing_player_names()  # from Supabase
    df["is_new"] = ~df["player_name"].isin(existing_names)
    new_count = df["is_new"].sum()
    if new_count > 0:
        log.info(f"{new_count} new players found — will need UUID linking")

    # --- Compute deltas from last import ---
    last_df = get_last_import_data(report_type)
    if last_df is not None:
        df = compute_deltas(df, last_df, key_cols=["player_name", "team"])

    return df
```

**Column mapping example:**
```python
COLUMN_MAPS = {
    "hitter_stats": {
        "Player": "player_name",
        "Team": "team",
        "Conf": "conference",
        "BA": "avg",
        "OBP": "obp",
        "SLG": "slg",
    },
    "hitter_power": {
        "Player": "player_name",
        "Team": "team",
        "Avg EV": "avg_exit_velo",
        "Barrel%": "barrel",
        "Max EV": "ev90",
        "LA": "la_10_30",
        # ... etc
    },
}
```

### Step 4: Load to Supabase

```python
async def load_to_supabase(df: pd.DataFrame, table: str, conflict_key: list[str]):
    """
    Upsert dataframe to Supabase table.
    Links player_id UUIDs where possible.
    """
    # Attempt UUID linking
    players = await supabase.table("players").select("id, full_name, team").execute()
    player_map = {(p["full_name"], p["team"]): p["id"] for p in players.data}

    records = df.to_dict("records")
    linked = 0
    for record in records:
        key = (record["player_name"], record.get("team"))
        if key in player_map:
            record["player_id"] = player_map[key]
            linked += 1
        record["source"] = "trumedia_auto"
        record["updated_at"] = datetime.utcnow().isoformat()

    # Batch upsert (Supabase supports up to 1000 per call)
    for batch in chunked(records, 500):
        await supabase.table(table).upsert(
            batch,
            on_conflict=",".join(conflict_key)
        ).execute()

    return {"inserted_or_updated": len(records), "linked": linked}
```

### Step 5: Notify + Log

```python
async def notify_and_log(results: dict, errors: list[str]):
    """
    Log import results to Supabase and send Slack notification.
    """
    # Write to import_logs table
    await supabase.table("import_logs").insert({
        "timestamp": datetime.utcnow().isoformat(),
        "source": "trumedia_auto",
        "report_types": list(results.keys()),
        "summary": {
            report: {
                "rows": r["inserted_or_updated"],
                "linked": r["linked"],
            }
            for report, r in results.items()
        },
        "errors": errors,
        "status": "failed" if errors else "success",
    }).execute()

    # Slack notification
    message = format_slack_summary(results, errors)
    if errors:
        await send_slack(channel="#data-alerts", message=message, level="error")
    else:
        await send_slack(channel="#data-alerts", message=message, level="info")
```

**Example Slack message:**
```
✅ TruMedia Import Complete — 2026-04-01 12:00 UTC
  • Hitter stats: 2,312 rows (14 new players)
  • Power ratings: 2,299 rows (11 linked by UUID)
  • Pitching stats: 891 rows (3 new players)
  • Stuff+: 891 rows
  Next run: 6:00 PM UTC
```

---

## Scheduling

### Default Schedule (Cloud Scheduler)

| Schedule | Cron | Purpose |
|----------|------|---------|
| Morning refresh | `0 6 * * *` (6 AM CT) | Catch overnight stat updates |
| Midday refresh | `0 12 * * *` (12 PM CT) | Catch morning game data |
| Evening refresh | `0 18 * * *` (6 PM CT) | Catch afternoon games |
| Overnight refresh | `0 0 * * *` (12 AM CT) | End-of-day final stats |

### Game-day override
During heavy game days (weekends, tournaments), increase to every 3 hours:
```
0 */3 * * 6,0    # Every 3 hours on Sat/Sun
```

### Off-season
Reduce to once daily or pause entirely.

---

## Error Handling + Resilience

| Failure Mode | Detection | Recovery |
|-------------|-----------|----------|
| Login fails | Page doesn't reach dashboard | Retry once with fresh cookies → alert if still fails |
| MFA code rejected | MFA form reappears | Regenerate TOTP, retry once → alert |
| Export button missing | Selector not found | Screenshot page, alert with image |
| CSV empty/malformed | Row count < threshold | Abort import, alert, keep previous data |
| Supabase upsert fails | Exception on insert | Retry batch → alert with failed rows |
| TruMedia site down | Connection timeout | Retry in 30 min → alert if 2 consecutive failures |
| TruMedia UI changes | Selectors break | Screenshot + alert; requires manual selector update |

**Retry policy:** 1 automatic retry per step, 30-minute backoff. After 2 failures, alert and wait for next scheduled run.

**Screenshots on failure:** Every error captures a page screenshot and attaches it to the Slack alert for fast debugging.

---

## Security

- **Credentials** in GCP Secret Manager — never in code, env vars, or config files
- **Supabase service role key** in Secret Manager — used only by backend, never exposed to frontend
- **Cloud Run Job** runs in isolated container — no persistent filesystem, no SSH access
- **Minimal permissions** — Cloud Run service account only has Secret Manager access + outbound HTTPS
- **Cookie storage** — encrypted at rest in Secret Manager or ephemeral (regenerated each run)

---

## Future: API Migration

When TruMedia provides an API, the pipeline simplifies dramatically:

```
Current (scraping):                Future (API):

Playwright browser ─┐              HTTP client ─┐
  Login page        │                API key     │
  Navigate          │  ──────►      GET /stats   │
  Click export      │                            │
  Download CSV      │              JSON response │
  Parse CSV         ┘              Parse JSON    ┘
        │                                │
        ▼                                ▼
  Transform + Load (same)          Transform + Load (same)
```

**What stays the same:** Steps 3-5 (validate, load, notify) are identical. Only the data acquisition layer changes.

**Design for this now:**
- Keep the browser automation in its own module (`scraper.py`)
- Steps 3-5 accept a DataFrame — they don't care where it came from
- When the API arrives, swap `scraper.py` for `api_client.py`, everything else untouched

---

## File Layout (in monorepo)

```
backend/
├── app/
│   ├── pipeline/
│   │   ├── __init__.py
│   │   ├── scraper.py          # Step 1-2: Playwright login + export
│   │   ├── validator.py        # Step 3: CSV validation + normalization
│   │   ├── loader.py           # Step 4: Supabase upsert + UUID linking
│   │   ├── notifier.py         # Step 5: Slack + logging
│   │   ├── column_maps.py      # CSV column → Supabase column mappings
│   │   ├── runner.py           # Orchestrator: runs steps 1-5 in sequence
│   │   └── config.py           # Schedule, thresholds, report types
│   └── ...
├── Dockerfile                   # Includes Playwright browsers
└── requirements.txt             # playwright, pandas, supabase-py, httpx
```

---

## Implementation Priority

1. **Get one report working end-to-end** — pick hitter batting stats, automate login → download → upsert locally
2. **Add validation + error handling** — row count checks, column mapping, screenshots on failure
3. **Deploy to Cloud Run** — containerize with Playwright, test cron trigger
4. **Add remaining report types** — power ratings, pitching, stuff+
5. **Add notifications** — Slack webhook for success/failure
6. **Tune schedule** — start with 2x/day, increase based on data freshness needs
