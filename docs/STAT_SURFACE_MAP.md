# Stat → Surface Map

7 files read a tracked stat · 46 reads · 23 stats tracked

## ERROR — stat read from `.prediction` (2)

  `.prediction` is NOT a snapshot. It is `snapshot ?? predictionMap[...]` and silently
  degrades to a raw prediction row. This is the 2026-09-01 defect class.

  [DISPLAY] src/pages/team-builder/PlayerTableRow.tsx:325  p_rv_plus
      const prv = p.prediction?.p_rv_plus ?? p.transfer_snapshot?.p_rv_plus ?? sim?.p_rv_plus ?? null;
  [DISPLAY] src/pages/team-builder/PlayerTableRow.tsx:354  p_wrc_plus
      p.prediction?.p_wrc_plus ?? p.transfer_snapshot?.p_wrc_plus ?? sim?.pWrcPlus ?? null;

## OK — presence checks only, not rendered (4)

  src/pages/TeamBuilder.tsx:380  p_avg
  src/pages/TeamBuilder.tsx:381  p_obp
  src/pages/TeamBuilder.tsx:382  p_slg
  src/pages/TeamBuilder.tsx:383  p_wrc_plus

## NOT APPLICABLE — `.prediction` outside the team-builder row shape (9)

  ReturningPlayers builds `prediction: { p_avg: row.p_avg, ... }` from the ALREADY-PICKED
  row. Same identifier, different meaning — reading it is correct.
  src/pages/ReturningPlayers.tsx:1875  p_avg
  src/pages/ReturningPlayers.tsx:1876  p_obp
  src/pages/ReturningPlayers.tsx:1877  p_slg
  src/pages/ReturningPlayers.tsx:1878  p_ops
  src/pages/ReturningPlayers.tsx:1879  p_iso
  src/pages/ReturningPlayers.tsx:1880  p_wrc_plus
  … 3 more

## SEPARATE — src/savant/** has its own conventions (8)

  The savant module renders a prediction row directly by design. Reported, not failed.
  src/savant/components/PredictionCard.tsx:22  p_avg
  src/savant/components/PredictionCard.tsx:25  p_avg
  src/savant/components/PredictionCard.tsx:26  p_obp
  src/savant/components/PredictionCard.tsx:27  p_slg
  src/savant/components/PredictionCard.tsx:28  p_ops
  src/savant/components/PredictionCard.tsx:29  p_iso
  src/savant/components/PredictionCard.tsx:30  p_wrc_plus
  src/savant/pages/HitterPage.tsx:255  p_wrc_plus

## WARN — same stat, multiple sources in one file (2)

  Two sources for one stat can disagree. Confirm the precedence is deliberate.

  src/pages/team-builder/PlayerTableRow.tsx  p_rv_plus                prediction  ??  transfer_snapshot
  src/pages/team-builder/PlayerTableRow.tsx  p_wrc_plus               prediction  ??  transfer_snapshot

## INFO — `??` precedence chains (2)

  src/pages/team-builder/PlayerTableRow.tsx:325
      const prv = p.prediction?.p_rv_plus ?? p.transfer_snapshot?.p_rv_plus ?? sim?.p_rv_plus ?? null;
  src/pages/team-builder/PlayerTableRow.tsx:354
      p.prediction?.p_wrc_plus ?? p.transfer_snapshot?.p_wrc_plus ?? sim?.pWrcPlus ?? null;

## COVERAGE — what this does NOT prove

  Text matching, not type-aware analysis. It surfaces CANDIDATE divergences for a human
  to judge. It cannot prove two reads resolve to the same value at runtime, and it does
  not exercise the dev-aggressiveness / depth-role / SP-RP toggle permutations that
  rstr-agent-plan.md §4 asks for — those need a running app.
  A clean run means 'no obvious divergence', NEVER 'the surfaces agree'.
