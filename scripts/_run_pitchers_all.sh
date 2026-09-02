#!/bin/zsh
cd ~/dev-main/diamond-predictor-66
TEAMS=(ea255751-261b-4300-9bb5-fb49efc18dac 6a6f19c8-9f99-4d84-a636-1781524aec34 39fa8d00-4121-4041-b5d6-2c0990767ba4 d2c62120-964d-4ae6-a6ff-bafc4eb8c803 3b1cc0e2-4acd-4a27-a7bc-d345c347f18d 05b486db-3a9b-4e41-bdd8-e15d111586db 1d1a8a72-b917-4287-b8b9-39d685f94a48 1b01e663-117d-438d-8734-193b532a878e b5b69a75-3082-4d26-b6c9-14cdb9b8e335 aeb1d7f2-a4e6-4ada-a840-a4653e0f2667 8829bcbc-f3c9-475b-bd2a-d1c344b9f31a ee947a80-a37e-46d7-bb83-629ee338cfa6 6deca66a-b4c0-403f-9614-a9d32f1d5994 3c8de28f-52f3-4e45-b931-df30f8492e41 b565ce8b-2dac-42f1-ba28-3465ca097459 189202f9-2700-4cc2-a274-eaedc3a40136 299d321d-d0eb-4be7-88b2-e561060c9fdf)
i=0
for uuid in $TEAMS; do
  i=$((i+1)); echo "===== team $i/17 ($uuid) PITCHER ====="
  npx tsx --env-file-if-exists=.env.local scripts/precompute-pitchers.ts --team "$uuid" 2>&1 | grep -iE "Result:|error" | head -2
done
echo "===== PITCHER RE-RUN (stored HTP) ALL DONE ====="
