#!/bin/zsh
cd ~/dev-main/diamond-predictor-66
TEAMS=($(grep -oE '"[a-f0-9-]{36}:[A-Za-z]+"' scripts/_run_step2_all.sh | tr -d '"'))
for entry in $TEAMS; do
  uuid="${entry%%:*}"; name="${entry##*:}"
  echo "===== $name HITTER (total_hitter_war fill) ====="
  npx tsx --env-file-if-exists=.env.local scripts/precompute-transfer-projections.ts --team "$uuid" 2>&1 | grep -iE "Result:|computed|error" | head -2
done
echo "===== HITTER RE-RUN ALL DONE ====="
