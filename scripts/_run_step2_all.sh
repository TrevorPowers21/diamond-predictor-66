#!/bin/zsh
# Runs the per-team transfer precomputes (hitter + pitcher) for EVERY active
# customer team. The team list is read LIVE from `customer_teams` via
# scripts/list-customer-teams.ts — never hardcoded — so a newly-added team
# (e.g. North Carolina, added 2026-08-25) can't be silently skipped again.
#
#   zsh scripts/_run_step2_all.sh            # staging (.env.local)
#   zsh scripts/_run_step2_all.sh --prod     # prod (.env.production.local) — needs explicit go
cd ~/dev-main/diamond-predictor-66

if [[ "$1" == "--prod" ]]; then
  ENV_FILE=".env.production.local"; PROD_FLAG="--prod"; TARGET="PROD"
else
  ENV_FILE=".env.local"; PROD_FLAG=""; TARGET="STAGING"
fi

# Pull the live active customer-team list (uuid:Name per line).
TEAMS=("${(@f)$(npx tsx --env-file-if-exists=$ENV_FILE scripts/list-customer-teams.ts 2>/dev/null)}")
if [[ ${#TEAMS[@]} -eq 0 || -z "${TEAMS[1]}" ]]; then
  echo "✗ no customer teams returned from list-customer-teams.ts ($TARGET) — aborting."; exit 1
fi
echo "===== STEP 2 on $TARGET — ${#TEAMS[@]} active customer teams ====="

i=0
for entry in $TEAMS; do
  [[ -z "$entry" ]] && continue
  i=$((i+1))
  uuid="${entry%%:*}"; name="${entry##*:}"
  echo "===== [$i/${#TEAMS[@]}] $name HITTER ====="
  npx tsx --env-file-if-exists=$ENV_FILE scripts/precompute-transfer-projections.ts --team "$uuid" $PROD_FLAG 2>&1 | grep -iE "Result:|computed|error" | head -3
  echo "===== [$i/${#TEAMS[@]}] $name PITCHER ====="
  npx tsx --env-file-if-exists=$ENV_FILE scripts/precompute-pitchers.ts --team "$uuid" $PROD_FLAG 2>&1 | grep -iE "Result:|computed|overlaid|error" | head -3
done
echo "===== STEP 2 ALL DONE ($i teams on $TARGET) ====="
