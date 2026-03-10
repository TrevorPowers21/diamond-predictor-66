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
  ncaaAvgBA: number;
  ncaaAvgOBP: number;
  ncaaAvgISO: number;
  ncaaAvgWrc: number;
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
  wObp: number;
  wSlg: number;
  wAvg: number;
  wIso: number;
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
  const baPowerAdj = input.ncaaAvgBA * (input.baPR / 100);
  const baBlended = input.lastAvg * (1 - input.baPowerWeight) + baPowerAdj * input.baPowerWeight;
  const baMultiplier =
    1 +
    (input.baConferenceWeight * ((input.toAvgPlus - input.fromAvgPlus) / 100)) -
    (input.baPitchingWeight * ((input.toStuff - input.fromStuff) / 100)) +
    (input.baParkWeight * ((input.toPark - input.fromPark) / 100));
  const pAvgRaw = baBlended * baMultiplier;

  const obpPowerAdj = input.ncaaAvgOBP * (input.obpPR / 100);
  const obpBlended = input.lastObp * (1 - input.obpPowerWeight) + obpPowerAdj * input.obpPowerWeight;
  const obpMultiplier =
    1 +
    (input.obpConferenceWeight * ((input.toObpPlus - input.fromObpPlus) / 100)) -
    (input.obpPitchingWeight * ((input.toStuff - input.fromStuff) / 100)) +
    (input.obpParkWeight * ((input.toPark - input.fromPark) / 100));
  const pObpRaw = obpBlended * obpMultiplier;

  const lastIso = input.lastSlg - input.lastAvg;
  const ratingZ = input.isoStdPower > 0 ? (input.isoPR - 100) / input.isoStdPower : 0;
  const scaledIso = input.ncaaAvgISO + (ratingZ * input.isoStdNcaa);
  const isoBlended = (lastIso * (1 - 0.3)) + (scaledIso * 0.3);
  const isoMultiplier =
    1 +
    (input.isoConferenceWeight * ((input.toIsoPlus - input.fromIsoPlus) / 100)) -
    (input.isoPitchingWeight * ((input.toStuff - input.fromStuff) / 100)) +
    (input.isoParkWeight * ((input.toPark - input.fromPark) / 100));
  const pIsoRaw = isoBlended * isoMultiplier;

  const pSlgRaw = pAvgRaw + pIsoRaw;
  const pOpsRaw = pObpRaw + pSlgRaw;
  const pWrcRaw = (input.wObp * pObpRaw) + (input.wSlg * pSlgRaw) + (input.wAvg * pAvgRaw) + (input.wIso * pIsoRaw);
  const pWrcPlus = input.ncaaAvgWrc === 0 ? null : Math.round((pWrcRaw / input.ncaaAvgWrc) * 100);

  const offValue = pWrcPlus == null ? null : (pWrcPlus - 100) / 100;
  const pa = 260;
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
