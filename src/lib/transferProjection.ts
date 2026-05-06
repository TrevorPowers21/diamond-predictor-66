export type TransferProjectionInputs = {
  lastAvg: number;
  lastObp: number;
  lastSlg: number;
  baPR: number;
  obpPR: number;
  isoPR: number;
  fromAvgPlus: number;
  toAvgPlus: number;
  fromObpPlus: number;
  toObpPlus: number;
  fromIsoPlus: number;
  toIsoPlus: number;
  fromStuff: number;
  toStuff: number;
  fromPark: number;
  toPark: number;
  fromBaPark?: number;
  toBaPark?: number;
  fromObpPark?: number;
  toObpPark?: number;
  fromIsoPark?: number;
  toIsoPark?: number;
  ncaaAvgBA: number;
  ncaaAvgOBP: number;
  ncaaAvgISO: number;
  ncaaAvgWrc: number;
  baStdPower: number;
  baStdNcaa: number;
  obpStdPower: number;
  obpStdNcaa: number;
  baPowerWeight: number;
  obpPowerWeight: number;
  baConferenceWeight: number;
  obpConferenceWeight: number;
  isoConferenceWeight: number;
  baPitchingWeight: number;
  obpPitchingWeight: number;
  isoPitchingWeight: number;
  baParkWeight: number;
  obpParkWeight: number;
  isoParkWeight: number;
  isoStdPower: number;
  isoStdNcaa: number;
  // ISO power weight — matches baPowerWeight / obpPowerWeight semantics:
  // weight on the PR+-derived (scaled) value. Default 0.7 matches the
  // returner blend in predictionEngine.ts:recalcReturner so transfer ISO
  // produces the same baseline as returner ISO before context multipliers.
  // (Was hardcoded to 0.3 — the inverted weight gave 70% lastIso / 30% scaled,
  // inflating elite hitters' transfer ISO. Fixed 2026-05-06.)
  isoPowerWeight?: number;
  wObp: number;
  wSlg: number;
  wAvg: number;
  wIso: number;
  actualPa?: number | null;
};

export type TransferProjectionOutput = {
  pAvg: number;
  pObp: number;
  pIso: number;
  pSlg: number;
  pOps: number;
  pWrc: number;
  pWrcPlus: number | null;
  owar: number | null;
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function computeTransferProjection(input: TransferProjectionInputs): TransferProjectionOutput {
  const fromBaPark = input.fromBaPark ?? input.fromPark;
  const toBaPark = input.toBaPark ?? input.toPark;
  const fromObpPark = input.fromObpPark ?? input.fromPark;
  const toObpPark = input.toObpPark ?? input.toPark;
  const fromIsoPark = input.fromIsoPark ?? input.fromPark;
  const toIsoPark = input.toIsoPark ?? input.toPark;
  const safeBaStdPower = input.baStdPower === 0 ? 1 : input.baStdPower;
  const baScaled = input.ncaaAvgBA + (((input.baPR - 100) / safeBaStdPower) * input.baStdNcaa);
  const baBlended = input.lastAvg * (1 - input.baPowerWeight) + baScaled * input.baPowerWeight;
  const baMultiplier =
    1 +
    (input.baConferenceWeight * ((input.toAvgPlus - input.fromAvgPlus) / 100)) -
    (input.baPitchingWeight * ((input.toStuff - input.fromStuff) / 100)) +
    (input.baParkWeight * ((toBaPark - fromBaPark) / 100));
  const pAvgRaw = baBlended * baMultiplier;

  const safeObpStdPower = input.obpStdPower === 0 ? 1 : input.obpStdPower;
  const obpScaled = input.ncaaAvgOBP + (((input.obpPR - 100) / safeObpStdPower) * input.obpStdNcaa);
  const obpBlended = input.lastObp * (1 - input.obpPowerWeight) + obpScaled * input.obpPowerWeight;
  const obpMultiplier =
    1 +
    (input.obpConferenceWeight * ((input.toObpPlus - input.fromObpPlus) / 100)) -
    (input.obpPitchingWeight * ((input.toStuff - input.fromStuff) / 100)) +
    (input.obpParkWeight * ((toObpPark - fromObpPark) / 100));
  const pObpRaw = obpBlended * obpMultiplier;

  const lastIso = input.lastSlg - input.lastAvg;
  const ratingZ = input.isoStdPower > 0 ? (input.isoPR - 100) / input.isoStdPower : 0;
  const scaledIso = input.ncaaAvgISO + (ratingZ * input.isoStdNcaa);
  // Power-heavy blend (default 0.7) matches BA/OBP and the returner formula.
  // Old hardcoded 0.3 was inverted — it trusted lastIso 70% which double-counted
  // outlier seasons and made transfer pIso always higher than returner pIso for
  // the same player. Now: returner pIso × isoMultiplier ≈ transfer pIso.
  const isoPowerWeight = input.isoPowerWeight ?? 0.7;
  const isoBlended = (lastIso * (1 - isoPowerWeight)) + (scaledIso * isoPowerWeight);
  const isoMultiplier =
    1 +
    (input.isoConferenceWeight * ((input.toIsoPlus - input.fromIsoPlus) / 100)) -
    (input.isoPitchingWeight * ((input.toStuff - input.fromStuff) / 100)) +
    (input.isoParkWeight * ((toIsoPark - fromIsoPark) / 100));
  const pIsoRaw = isoBlended * isoMultiplier;

  const pSlgRaw = pAvgRaw + pIsoRaw;
  const pOpsRaw = pObpRaw + pSlgRaw;
  const pWrcRaw = (input.wObp * pObpRaw) + (input.wSlg * pSlgRaw) + (input.wAvg * pAvgRaw) + (input.wIso * pIsoRaw);
  const pWrcPlus = input.ncaaAvgWrc === 0 ? null : Math.round((pWrcRaw / input.ncaaAvgWrc) * 100);

  const offValue = pWrcPlus == null ? null : (pWrcPlus - 100) / 100;
  const pa = input.actualPa ?? 260;
  const runsPerPa = 0.13;
  const replacementRuns = (pa / 600) * 25;
  const raa = offValue == null ? null : offValue * pa * runsPerPa;
  const rar = raa == null ? null : raa + replacementRuns;
  const owar = rar == null ? null : rar / 10;

  return {
    pAvg: round3(pAvgRaw),
    pObp: round3(pObpRaw),
    pIso: round3(pIsoRaw),
    pSlg: round3(pSlgRaw),
    pOps: round3(pOpsRaw),
    pWrc: round3(pWrcRaw),
    pWrcPlus,
    owar,
  };
}
