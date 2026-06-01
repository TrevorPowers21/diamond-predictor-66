# Portal Auto-Pull — Setup + Operations

Hourly-ish automated pull of the Verified Athletics portal entries CSV, with auto-import to prod.

**Cadence:** hourly at :00. Dial back to a sparser schedule once portal activity calms — edit `StartCalendarInterval` in `scripts/com.rstriq.portal-pull.plist`, then re-copy + `launchctl unload && launchctl load`.
**Host:** local Mac via `launchd`. Only runs while your Mac is awake.

## First-time setup

1. **Install deps** (once, from the repo root):
   ```bash
   npm install
   npx playwright install chromium
   ```

2. **Log in to VA in the persistent browser profile** (creates the saved session):
   ```bash
   npx tsx scripts/fetch_va_portal.ts --setup
   ```
   A real Chromium window opens. Log in to Verified Athletics normally. Close the window when done. Your session is saved to `~/.rstr_iq/va-profile/`.

3. **Verify a headless fetch works:**
   ```bash
   npx tsx scripts/fetch_va_portal.ts
   ```
   You should see `Saved /Users/<you>/RSTR IQ Data/inbox/transfers_<timestamp>.csv`. If you see "VA session expired", re-run step 2.

4. **Install the launchd job:**
   ```bash
   cp scripts/com.rstriq.portal-pull.plist ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/com.rstriq.portal-pull.plist
   ```

5. **Sanity test the full pipeline manually:**
   ```bash
   ./scripts/auto_pull_portal.sh
   tail -50 ~/Library/Logs/rstr-iq-portal-pull.log
   ```

## Daily operations

- **Logs:** `~/Library/Logs/rstr-iq-portal-pull.log` (full output of each run)
- **Notifications:** macOS notification fires on any failure (fetch error, session expired, import error). Click to investigate.
- **Manual trigger:**
  ```bash
  ./scripts/auto_pull_portal.sh
  ```

## When the VA session expires (every ~30 days)

A notification fires saying "VA login expired." To fix:

```bash
npx tsx scripts/fetch_va_portal.ts --setup
```

Log in again. The launchd job picks back up at the next scheduled time.

## Pausing / disabling

```bash
launchctl unload ~/Library/LaunchAgents/com.rstriq.portal-pull.plist
```

Re-enable with `launchctl load`.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "Could not find Export/Download button" | VA renamed the button | Update the `candidates` list in `scripts/fetch_va_portal.ts` |
| Notification: VA login expired | Cookies aged out | Re-run `--setup` |
| Import hangs at confirmation prompt | `RSTR_AUTOMATION_TOKEN` not set in wrapper | Verify `auto_pull_portal.sh` exports it before calling `npm run import:prod` |
| Job not firing | Mac was asleep at scheduled time | Expected — launchd skips runs while Mac is asleep. Manually run `./scripts/auto_pull_portal.sh` to catch up |

## What gets written each run

- One CSV → `~/RSTR IQ Data/inbox/transfers_YYYY-MM-DD-HHMM.csv`
- Importer matches against `players` table, writes:
  - `portal_status`, `transfer_portal`, `portal_entry_date`, `commit_school`, `commit_date`, contact fields
  - **Manually-overridden players preserve their status** ([portal_manual_override](feature_portal_manual_override.md) flag)
- Unmatched rows → `portal_entries_unmatched` table (review via Admin → Portal Review tab)
- CSV moves to `~/RSTR IQ Data/imported/YYYY-MM-DD/` after successful import

## Security notes

- No VA password is stored. The browser profile at `~/.rstr_iq/va-profile/` contains session cookies; revoking them = log out of VA on web, that profile invalidates.
- The `RSTR_AUTOMATION_TOKEN` env var only unlocks the prod confirmation bypass when set to the exact phrase. A normal shell session won't have it set, so manual `npm run import:prod` still prompts.
