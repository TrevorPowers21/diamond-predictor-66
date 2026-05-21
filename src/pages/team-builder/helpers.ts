import type { BuildPlayer, PitcherDepthRole } from "./types";

const LEGACY_PITCHING_ROLE_OVERRIDE_KEY = "pitching_role_overrides_v1";

export const normalizeName = (value: string | null | undefined) =>
  (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const normalizeKey = (value: string | null | undefined) =>
  (value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

export const getPlayerName = (p: BuildPlayer): string =>
  p.player ? `${p.player.first_name} ${p.player.last_name}` : p.custom_name || "TBD";

export const projectedNilTierClass = (
  value: number | null | undefined,
  totalBudget: number,
  rosterScoreBaseline: number,
): string => {
  if (value == null) return "text-muted-foreground";
  const budget = Number(totalBudget) || 0;
  const baseline = Math.max(Number(rosterScoreBaseline) || 0, 1);
  if (budget <= 0) return "text-muted-foreground";
  const baselineShare = budget / baseline;
  if (value >= baselineShare * 1.2) return "text-[hsl(var(--success))]";
  if (value >= baselineShare * 0.8) return "text-[hsl(var(--warning))]";
  return "text-destructive";
};

export const pitcherRoleFromSlot = (slot: string | null | undefined): "SP" | "RP" | "SM" | null => {
  if (!slot) return null;
  const s = slot.toUpperCase();
  if (s.startsWith("SP")) return "SP";
  if (s.startsWith("RP") || s === "CL") return "RP";
  return "SM";
};

export const isPitcherDepthRole = (role: BuildPlayer["depth_role"]): role is PitcherDepthRole =>
  role === "weekend_starter" || role === "weekday_starter" || role === "swing_starter" ||
  role === "workhorse_reliever" || role === "high_leverage_reliever" || role === "mid_leverage_reliever" ||
  role === "low_impact_reliever" || role === "specialist_reliever";

export const normalizePitcherDepthRole = (
  role: BuildPlayer["depth_role"],
  pitcherRole: "SP" | "RP",
): PitcherDepthRole => {
  if (isPitcherDepthRole(role)) return role;
  if (role === "cornerstone" || role === "everyday_starter" || role === "starter") {
    return pitcherRole === "SP" ? "weekend_starter" : "high_leverage_reliever";
  }
  if (role === "platoon_starter") {
    return pitcherRole === "SP" ? "weekday_starter" : "mid_leverage_reliever";
  }
  if (role === "utility") return pitcherRole === "SP" ? "weekday_starter" : "mid_leverage_reliever";
  if (role === "bench") return pitcherRole === "SP" ? "swing_starter" : "low_impact_reliever";
  return pitcherRole === "SP" ? "weekend_starter" : "high_leverage_reliever";
};

export const storagePitcherRouteFor = (playerName: string, teamName: string | null | undefined) => {
  const nameEnc = encodeURIComponent((playerName || "").trim());
  const teamEnc = encodeURIComponent((teamName || "").trim());
  return `/dashboard/pitcher/storage__${nameEnc}__${teamEnc}`;
};

export const writeLegacyPitchingRoleOverride = (
  playerName: string | null | undefined,
  teamName: string | null | undefined,
  role: "SP" | "RP" | "SM" | null,
) => {
  if (typeof window === "undefined" || !playerName || !teamName) return;
  const key = `${normalizeName(playerName)}|${normalizeKey(teamName)}`;
  try {
    const raw = window.localStorage.getItem(LEGACY_PITCHING_ROLE_OVERRIDE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, "SP" | "RP" | "SM">) : {};
    if (role) parsed[key] = role;
    else delete parsed[key];
    window.localStorage.setItem(LEGACY_PITCHING_ROLE_OVERRIDE_KEY, JSON.stringify(parsed));
  } catch {
    // ignore localStorage failures
  }
};

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
