#!/bin/bash
# Self-heal sweep — re-derives snapshot = f(neutral, notes) for any drifted build/
# target row and persists it. This is the background guard for the Phase-B snapshot
# model: if a toggle race (e.g. flip dev-agg to 1.0 then back to 0 fast) or a neutral
# re-precompute ever leaves a snapshot out of sync, the next sweep silently fixes it.
# It only ever writes a value it can prove — snapshot == f(immutable neutral, saved
# toggles) — so it cannot corrupt anything; it's idempotent (a clean DB heals 0 rows).
# Designed for launchd; see docs/SELF_HEAL_SWEEP.md for setup.
#
# Exit codes: 0 success · 1 heal error(s) · 3 prod-apply gate not satisfied
# Logs → ~/Library/Logs/rstr-iq-self-heal.log

set -eo pipefail

REPO="$HOME/dev-main/diamond-predictor-66"
LOG="$HOME/Library/Logs/rstr-iq-self-heal.log"
mkdir -p "$(dirname "$LOG")"

echo "=== $(date) ===" >> "$LOG"
cd "$REPO"

# launchd has a minimal PATH — make node/npm reachable.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
# Unlocks the prod --apply gate for unattended runs (same pattern as import:prod).
export RSTR_AUTOMATION_TOKEN="yes-heal-prod"

TMP=$(mktemp /tmp/rstr-iq-self-heal.XXXXXX)
set +e
npx tsx scripts/heal-stale-snapshots.ts --prod --all --apply > "$TMP" 2>&1
EXIT=$?
set -e
cat "$TMP" >> "$LOG"

SUMMARY=$(grep -aoE "HEAL_SUMMARY .*" "$TMP" | tail -1 || echo "HEAL_SUMMARY (no summary line)")
HEALED=$(echo "$SUMMARY" | grep -aoE "healed=[0-9]+" | cut -d= -f2 || echo "0")

if [ "$EXIT" != "0" ]; then
  /usr/bin/osascript -e 'display notification "Self-heal error — see ~/Library/Logs/rstr-iq-self-heal.log" with title "RSTR IQ self-heal" sound name "Basso"' || true
  echo "FAILED (exit $EXIT). $SUMMARY" >> "$LOG"
  rm -f "$TMP"; exit "$EXIT"
fi

# Only ping on a non-trivial heal — a 0-row sweep is the normal, quiet case.
if [ -n "$HEALED" ] && [ "$HEALED" -gt 0 ] 2>/dev/null; then
  /usr/bin/osascript -e "display notification \"Healed $HEALED drifted snapshot(s)\" with title \"RSTR IQ self-heal\"" || true
fi

echo "Done. $SUMMARY" >> "$LOG"
rm -f "$TMP"
exit 0
