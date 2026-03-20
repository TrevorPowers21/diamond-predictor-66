export const PLAYER_OVERRIDES_STORAGE_KEY = "team_builder_player_overrides_v1";

export type PlayerOverride = {
  position?: string | null;
  pitcher_role?: "SP" | "RP" | "SM" | null;
  class_transition?: "FS" | "SJ" | "JS" | "GR" | null;
  dev_aggressiveness?: number | null;
};

export type PlayerOverridesMap = Record<string, PlayerOverride>;

export const readPlayerOverrides = (): PlayerOverridesMap => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PLAYER_OVERRIDES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PlayerOverridesMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

export const writePlayerOverrides = (next: PlayerOverridesMap) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PLAYER_OVERRIDES_STORAGE_KEY, JSON.stringify(next));
};

export const updatePlayerOverride = (
  playerId: string | null | undefined,
  updates: PlayerOverride,
) => {
  if (!playerId) return;
  const current = readPlayerOverrides();
  const prev = current[playerId] || {};
  const merged: PlayerOverride = { ...prev, ...updates };
  current[playerId] = merged;
  writePlayerOverrides(current);
};
