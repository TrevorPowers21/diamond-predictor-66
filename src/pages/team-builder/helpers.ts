import type { BuildPlayer, PitcherDepthRole, TransferSnapshot, TeamMetricInputs, TeamPowerPlus } from "./types";
import { normalizeName } from "@/lib/nameUtils";
export { normalizeName };

const LEGACY_PITCHING_ROLE_OVERRIDE_KEY = "pitching_role_overrides_v1";

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

// TWP rows are spawned as a hitter+pitcher PAIR (see returners flatMap and
// addPlayerFromTargetSearch). Each row's position_slot tells us which side
// it represents — pitcher slots (SP/RP/CL/LHP/RHP/P) = the pitcher row,
// anything else = the hitter row. Without this discriminator both rows
// would show in both tabs and the position column would render "SP" on
// hitter tab for TWPs like Kenny Ishikawa.
const isPitcherSlot = (slot: string | null | undefined): boolean =>
  !!slot && /^(SP|RP|CL|LHP|RHP|P)$/i.test(slot);

export const hitterEligible = (p: BuildPlayer): boolean => {
  if (isTwp(p)) return !isPitcherSlot(p.position_slot);
  return !isPitcher(p);
};

export const pitcherEligible = (p: BuildPlayer): boolean => {
  if (isTwp(p)) return isPitcherSlot(p.position_slot);
  return isPitcher(p);
};

export const depthKey = (slot: string, depth: number) => `${slot}:${depth}`;

export const slotMatchesPosition = (posRaw: string | null | undefined, slot: string): boolean => {
  const pos = (posRaw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!pos) return false;
  if (slot === "C") return pos === "C";
  if (slot === "1B") return pos === "1B";
  if (slot === "2B") return pos === "2B";
  if (slot === "3B") return pos === "3B";
  if (slot === "SS") return pos === "SS";
  if (slot === "LF") return pos === "LF";
  if (slot === "CF") return pos === "CF";
  if (slot === "RF") return pos === "RF";
  if (slot === "DH") return pos === "DH";
  return false;
};

// Class color reads the player's CURRENT class_year (FR/SO/JR/SR/GR).
// class_transition encodes the year-to-year move ("SJ" = sophomore-to-junior),
// so a SJ-tagged player is currently a junior — don't color them as SO.
export const classColor = (cy: string | null | undefined, isPlaceholder?: boolean): string => {
  if (isPlaceholder) return "border-blue-500 bg-blue-100 text-blue-900";
  const c = (cy || "").toUpperCase().replace(/^R-/, "");
  if (!c) return "border-slate-300 bg-white text-black";
  if (c === "FR") return "border-blue-500 bg-blue-100 text-blue-900";
  if (c === "SO") return "border-green-600 bg-green-200 text-green-900";
  if (c === "JR") return "border-yellow-500 bg-yellow-100 text-yellow-900";
  if (c === "SR" || c === "GR") return "border-red-500 bg-red-100 text-red-900";
  return "border-slate-300 bg-white text-black";
};

// Derive the player's current class for color coding. Prefer canonical
// class_year; fall back to the second letter of class_transition (SJ → J → JR).
export const playerCurrentClass = (p: BuildPlayer | null | undefined): string | null => {
  if (!p) return null;
  const cy = (p.player?.class_year || "").toUpperCase();
  if (cy) return cy;
  const ct = String(p.class_transition || "").toUpperCase();
  if (ct === "FS") return "SO";
  if (ct === "SJ") return "JR";
  if (ct === "JS") return "SR";
  if (ct === "GR") return "GR";
  return null;
};

// ---------------------------------------------------------------------------
// Functions migrated from TeamBuilder.tsx inline — canonical home is here.
// Import these in useLoadBuild and any other hook that needs them.
// ---------------------------------------------------------------------------

export const isUuid = (value: string | null | undefined): boolean =>
  !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value).trim(),
  );

const splitFullName = (fullName: string): { first: string; last: string } => {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
};

const teamNameVariants = (team: string | null | undefined): string[] => {
  const base = (team || "").trim();
  if (!base) return [];
  const out = new Set<string>([base]);
  const lower = base.toLowerCase();
  if (lower.endsWith(" university")) out.add(base.replace(/\s+university$/i, "").trim());
  else out.add(`${base} University`);
  if (lower.startsWith("university of ")) out.add(base.replace(/^university of\s+/i, "").trim());
  else out.add(`University of ${base}`.trim());
  if (lower === "west virginia" || lower === "west virginia university" || lower === "wvu") {
    out.add("WVU");
    out.add("West Virginia");
    out.add("West Virginia University");
  }
  return Array.from(out).filter(Boolean);
};

export const teamMatchesSelectedTeam = (
  candidateTeam: string | null | undefined,
  selectedTeam: string | null | undefined,
): boolean => {
  const candidate = (candidateTeam || "").trim();
  const selected = (selectedTeam || "").trim();
  if (!candidate || !selected) return false;
  const candidateVariants = teamNameVariants(candidate);
  const selectedVariants = teamNameVariants(selected);
  const selectedNorms = new Set(selectedVariants.map((v) => normalizeName(v)));
  for (const variant of candidateVariants) {
    if (selectedNorms.has(normalizeName(variant))) return true;
  }
  return false;
};

export const splitFullNameExport = splitFullName;

export const readStoragePitcherLocalPlayers = (
  teamName: string | null | undefined,
  masterRows: Array<{
    playerName: string;
    team: string | null;
    teamId?: string | null;
    throwHand: string | null;
    role: string | null;
    conference: string | null;
  }> = [],
  selectedTeamId?: string | null,
): Array<{
  first_name: string;
  last_name: string;
  position: string | null;
  team: string | null;
  from_team: string | null;
  conference: string | null;
  role: "SP" | "RP" | null;
}> => {
  if (!teamName && !selectedTeamId) return [];
  const out: Array<{
    first_name: string;
    last_name: string;
    position: string | null;
    team: string | null;
    from_team: string | null;
    conference: string | null;
    role: "SP" | "RP" | null;
  }> = [];
  for (const r of masterRows) {
    const playerName = (r.playerName || "").trim();
    const rowTeam = (r.team || "").trim();
    if (!playerName || !rowTeam) continue;
    const teamMatch =
      selectedTeamId && (r as any).teamId
        ? (r as any).teamId === selectedTeamId
        : teamMatchesSelectedTeam(rowTeam, teamName);
    if (!teamMatch) continue;
    const hand = (r.throwHand || "").trim().toUpperCase();
    const roleRaw = (r.role || "").trim().toUpperCase();
    const role: "SP" | "RP" | null = roleRaw === "SP" || roleRaw === "RP" ? roleRaw : null;
    const position = hand === "RHP" || hand === "LHP" ? hand : role || "P";
    const split = splitFullName(playerName);
    out.push({ first_name: split.first, last_name: split.last, position, team: rowTeam, from_team: null, conference: r.conference || null, role });
  }
  return out;
};

export const defaultHitterDepthRoleFromPa = (
  pa: number | null | undefined,
): "cornerstone" | "everyday_starter" | "platoon_starter" | "utility" | "bench" => {
  const safePa = Number.isFinite(Number(pa)) ? Number(pa) : 0;
  if (safePa >= 220) return "cornerstone";
  if (safePa >= 130) return "everyday_starter";
  if (safePa >= 50) return "platoon_starter";
  if (safePa >= 15) return "utility";
  return "bench";
};

export const defaultPitcherDepthRoleFromIp = (
  ip: number | null | undefined,
  role: "SP" | "RP",
): "weekend_starter" | "weekday_starter" | "swing_starter" | "workhorse_reliever" | "high_leverage_reliever" | "mid_leverage_reliever" | "low_impact_reliever" | "specialist_reliever" => {
  const ipNum = Number(ip);
  if (!Number.isFinite(ipNum) || ipNum <= 0) {
    return role === "SP" ? "weekend_starter" : "high_leverage_reliever";
  }
  if (role === "SP") {
    if (ipNum >= 65) return "weekend_starter";
    if (ipNum >= 35) return "weekday_starter";
    return "swing_starter";
  }
  if (ipNum >= 40) return "workhorse_reliever";
  if (ipNum >= 25) return "high_leverage_reliever";
  if (ipNum >= 15) return "mid_leverage_reliever";
  if (ipNum >= 8) return "low_impact_reliever";
  return "specialist_reliever";
};

type DepthRole =
  | "cornerstone" | "everyday_starter" | "platoon_starter" | "utility" | "bench" | "starter"
  | "weekend_starter" | "weekday_starter" | "swing_starter" | "workhorse_reliever"
  | "high_leverage_reliever" | "mid_leverage_reliever" | "low_impact_reliever" | "specialist_reliever";

export const parseBuildPlayerMeta = (raw: string | null | undefined): {
  notes: string | null;
  metrics: TeamMetricInputs | null;
  power: TeamPowerPlus | null;
  rosterStatus: "returner" | "leaving" | "target" | null;
  depthRole: DepthRole | null;
  classTransition: string | null;
  devAggressiveness: number | null;
  classTransitionOverridden: boolean;
  devAggressivenessOverridden: boolean;
  transferSnapshot: TransferSnapshot | null;
  localPlayer: {
    first_name: string; last_name: string; position: string | null;
    team: string | null; from_team: string | null; conference: string | null;
  } | null;
  projectionTier: "developmental" | "role_player" | "contributor" | "immediate_impact" | null;
  nilValueOverridden: boolean;
} => {
  if (!raw) {
    return {
      notes: null, metrics: null, power: null, rosterStatus: null, depthRole: null,
      classTransition: null, devAggressiveness: null, classTransitionOverridden: false,
      devAggressivenessOverridden: false, transferSnapshot: null, localPlayer: null,
      projectionTier: null, nilValueOverridden: false,
    };
  }
  try {
    const obj = JSON.parse(raw);
    if (obj && obj.__team_builder_metrics_v1) {
      const VALID_DEPTH_ROLES: DepthRole[] = [
        "cornerstone", "everyday_starter", "platoon_starter", "starter", "utility", "bench",
        "weekend_starter", "weekday_starter", "swing_starter", "workhorse_reliever",
        "high_leverage_reliever", "mid_leverage_reliever", "low_impact_reliever", "specialist_reliever",
      ];
      return {
        notes: typeof obj.notes === "string" ? obj.notes : null,
        metrics: (obj.metrics ?? null) as TeamMetricInputs | null,
        power: (obj.power ?? null) as TeamPowerPlus | null,
        rosterStatus:
          obj.rosterStatus === "returner" || obj.rosterStatus === "leaving" || obj.rosterStatus === "target"
            ? obj.rosterStatus : null,
        depthRole: VALID_DEPTH_ROLES.includes(obj.depthRole) ? obj.depthRole : null,
        classTransition: typeof obj.classTransition === "string" ? obj.classTransition : null,
        devAggressiveness: Number.isFinite(Number(obj.devAggressiveness)) ? Number(obj.devAggressiveness) : null,
        classTransitionOverridden: Boolean(obj.classTransitionOverridden),
        devAggressivenessOverridden: Boolean(obj.devAggressivenessOverridden),
        transferSnapshot: (obj.transferSnapshot ?? null) as TransferSnapshot | null,
        localPlayer: obj.localPlayer && typeof obj.localPlayer === "object"
          ? {
              first_name: String(obj.localPlayer.first_name || ""),
              last_name: String(obj.localPlayer.last_name || ""),
              position: obj.localPlayer.position != null ? String(obj.localPlayer.position) : null,
              team: obj.localPlayer.team != null ? String(obj.localPlayer.team) : null,
              from_team: obj.localPlayer.from_team != null ? String(obj.localPlayer.from_team) : null,
              conference: obj.localPlayer.conference != null ? String(obj.localPlayer.conference) : null,
            }
          : null,
        projectionTier: obj.projectionTier === "developmental" || obj.projectionTier === "role_player" || obj.projectionTier === "contributor" || obj.projectionTier === "immediate_impact"
          ? obj.projectionTier : null,
        nilValueOverridden: Boolean(obj.nilValueOverridden),
      };
    }
  } catch {
    // legacy free-text note
  }
  return {
    notes: raw, metrics: null, power: null, rosterStatus: null, depthRole: null,
    classTransition: null, devAggressiveness: null, classTransitionOverridden: false,
    devAggressivenessOverridden: false, transferSnapshot: null, localPlayer: null,
    projectionTier: null, nilValueOverridden: false,
  };
};

export const serializeBuildPlayerMeta = (
  notes: string | null,
  metrics: TeamMetricInputs | null,
  power: TeamPowerPlus | null,
  rosterStatus: "returner" | "leaving" | "target" | null | undefined,
  depthRole: DepthRole | null | undefined,
  classTransition: string | null | undefined,
  devAggressiveness: number | null | undefined,
  classTransitionOverridden: boolean | null | undefined,
  devAggressivenessOverridden: boolean | null | undefined,
  transferSnapshot: TransferSnapshot | null | undefined,
  localPlayer: {
    first_name: string; last_name: string; position: string | null;
    team: string | null; from_team: string | null; conference: string | null;
  } | null | undefined,
  projectionTier?: "developmental" | "role_player" | "contributor" | "immediate_impact" | null,
  nilValueOverridden?: boolean,
): string | null => {
  if (!notes && !metrics && !power && !rosterStatus && !depthRole && !classTransition && devAggressiveness == null && !transferSnapshot && !localPlayer && !projectionTier && !nilValueOverridden) return null;
  return JSON.stringify({
    __team_builder_metrics_v1: true,
    notes: notes ?? null,
    metrics: metrics ?? null,
    power: power ?? null,
    rosterStatus: rosterStatus ?? null,
    depthRole: depthRole ?? null,
    classTransition: classTransition ?? null,
    devAggressiveness: devAggressiveness ?? null,
    classTransitionOverridden: Boolean(classTransitionOverridden),
    devAggressivenessOverridden: Boolean(devAggressivenessOverridden),
    transferSnapshot: transferSnapshot ?? null,
    localPlayer: localPlayer ?? null,
    projectionTier: projectionTier ?? null,
    nilValueOverridden: Boolean(nilValueOverridden),
  });
};
