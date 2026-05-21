import type { BuildPlayer } from "./types";

export const asPitcherRole = (raw: string | null | undefined): "SP" | "RP" | null => {
  const v = String(raw || "").toUpperCase();
  if (v.startsWith("SP") || v === "STARTER" || v === "SM") return "SP";
  if (v.startsWith("RP") || v === "RELIEVER" || v === "CL" || v === "CLOSER") return "RP";
  return null;
};

export const effectivePitcherRoleForBuild = (
  p: BuildPlayer,
  pitchingMasterRole: string | null | undefined,
): "SP" | "RP" => {
  const slotRole = asPitcherRole(p.position_slot);
  if (slotRole) return slotRole;
  if (p.player?.is_twp) {
    const pmRole = asPitcherRole(pitchingMasterRole);
    if (pmRole) return pmRole;
    return "RP";
  }
  return asPitcherRole(p.player?.position ?? null) || asPitcherRole(pitchingMasterRole) || "RP";
};

export const isPitcher = (p: BuildPlayer): boolean => {
  const pos = p.position_slot || p.player?.position || "";
  return /^(SP|RP|CL|P|LHP|RHP)/i.test(pos);
};

export const isTwp = (p: BuildPlayer): boolean => !!p.player?.is_twp;

export const hitterEligible = (p: BuildPlayer): boolean => !isPitcher(p) || isTwp(p);

export const pitcherEligible = (p: BuildPlayer): boolean => isPitcher(p) || isTwp(p);
