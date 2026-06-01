#!/bin/bash
# Auto portal pull — fetches today's VA transfers CSV and runs import:prod.
# Designed for launchd; see docs/PORTAL_AUTO_PULL.md for setup.
#
# Failure modes (exit codes):
#   0   — success (CSV downloaded + imported)
#   2   — VA session expired (re-run scripts/fetch_va_portal.ts --setup)
#   1   — anything else
#
# Logs go to ~/Library/Logs/rstr-iq-portal-pull.log

set -eo pipefail

REPO="$HOME/dev-main/diamond-predictor-66"
LOG="$HOME/Library/Logs/rstr-iq-portal-pull.log"
mkdir -p "$(dirname "$LOG")"

echo "=== $(date) ===" >> "$LOG"
cd "$REPO"

# Make npm + node accessible to launchd (which has a minimal PATH).
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export RSTR_AUTOMATION_TOKEN="yes-promote-to-prod"

set +e
npx tsx scripts/fetch_va_portal.ts >> "$LOG" 2>&1
FETCH_EXIT=$?
set -e

if [ "$FETCH_EXIT" = "2" ]; then
  /usr/bin/osascript -e 'display notification "VA login expired. Run scripts/fetch_va_portal.ts --setup" with title "RSTR IQ portal pull" sound name "Basso"' || true
  echo "VA session expired." >> "$LOG"
  exit 2
fi
if [ "$FETCH_EXIT" != "0" ]; then
  /usr/bin/osascript -e 'display notification "Fetch failed — see ~/Library/Logs/rstr-iq-portal-pull.log" with title "RSTR IQ portal pull" sound name "Basso"' || true
  echo "Fetch failed (exit $FETCH_EXIT)." >> "$LOG"
  exit 1
fi

# Run the importer unattended. The RSTR_AUTOMATION_TOKEN env var unlocks the
# --prod confirm bypass; if it's not set, the importer will hang on the prompt.
npm run import:prod -- --yes >> "$LOG" 2>&1 || {
  /usr/bin/osascript -e 'display notification "Import failed — see ~/Library/Logs/rstr-iq-portal-pull.log" with title "RSTR IQ portal pull" sound name "Basso"' || true
  echo "Import failed." >> "$LOG"
  exit 1
}

echo "Done." >> "$LOG"
exit 0
