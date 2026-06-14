import { useCallback } from "react";
import type { MutableRefObject } from "react";
import { supabase } from "@/integrations/supabase/client";
import { applyTeamScopeFilter, pickPreferredPrediction } from "@/lib/teamScopedPredictions";
import { PROJECTION_SEASON } from "@/lib/seasonConstants";
import { normalizeName } from "@/lib/nameUtils";
import { scorePredictionLikeDashboard } from "./useTeamBuilderData";
import {
  isUuid,
  readStoragePitcherLocalPlayers,
  parseBuildPlayerMeta,
  asPitcherRole,
  defaultPitcherDepthRoleFromIp,
  defaultHitterDepthRoleFromPa,
} from "../helpers";

type PitchingStatsByNameTeam = {
  byKey: Map<string, { ip: number | null }>;
  bySourceId: Map<string, { ip: number | null }>;
  byName: Map<string, Array<{ ip: number | null }>>;
};

type SeasonUsage = {
  hitterAb?: Map<string, number>;
  hitterAbByNameTeam?: Map<string, number>;
  thinSample?: Map<string, boolean>;
};

type LoadBuildParams = {
  builds: any[];
  allPlayersForSearch: any[];
  selectedTeam: string;
  selectedTeamId: string | null;
  effectiveTeamId: string | null;
  pitchingMasterRows: any[];
  pitchingStatsByNameTeam: PitchingStatsByNameTeam;
  seasonUsage: SeasonUsage;
  resolveTeamBuilderPlayer: (
    id: string | null,
    name: string,
    team: string | null,
    pitcherOnly: boolean,
  ) => any;
  getSupabaseRole: (id: string) => string | null;
  // State setters
  setSelectedBuildId: (id: string) => void;
  setBuildName: (name: string) => void;
  setTotalBudget: (budget: number) => void;
  setSelectedTeam: (team: string) => void;
  setDepthAssignments: (d: Record<string, number>) => void;
  setDepthPlaceholders: (d: Record<string, "freshman" | "transfer">) => void;
  setRosterPlayers: (players: any[]) => void;
  setDirty: (dirty: boolean) => void;
  // Refs
  lastDepthTeamRef: MutableRefObject<string | null>;
  skipAutoSeedOnceRef: MutableRefObject<boolean>;
  autoSeededTeamRef: MutableRefObject<string>;
  // Optional: ref kept here only to keep the prior signature stable for
  // callers that already pass it. The actual "build load done" signal that
  // unblocks the Supabase target-board sync effect comes from setBuildLoadDone.
  buildLoadDoneRef?: MutableRefObject<boolean>;
  // Flipped to true after loadBuild finishes setting rosterPlayers. Lets the
  // sync effect re-fire (state, not ref) once the saved build has populated.
  setBuildLoadDone?: (done: boolean) => void;
};

// True when the position_slot (or player position) indicates a pitcher row.
const isPitcherSlot = (slot: string | null | undefined): boolean =>
  /^(SP|RP|CL|P|LHP|RHP)/i.test(String(slot || ""));

export function useLoadBuild({
  builds,
  allPlayersForSearch,
  selectedTeam,
  selectedTeamId,
  effectiveTeamId,
  pitchingMasterRows,
  pitchingStatsByNameTeam,
  seasonUsage,
  resolveTeamBuilderPlayer,
  getSupabaseRole,
  setSelectedBuildId,
  setBuildName,
  setTotalBudget,
  setSelectedTeam,
  setDepthAssignments,
  setDepthPlaceholders,
  setRosterPlayers,
  setDirty,
  lastDepthTeamRef,
  skipAutoSeedOnceRef,
  autoSeededTeamRef,
  buildLoadDoneRef,
  setBuildLoadDone,
}: LoadBuildParams) {
  return useCallback(
    async (buildId: string) => {
      const build = builds.find((b) => b.id === buildId);
      if (!build) return;
      setSelectedBuildId(buildId);
      setBuildName(build.name);
      // Pre-record the team in the depth-clear ref so the team-change effect
      // doesn't wipe the depth chart we're about to restore.
      lastDepthTeamRef.current = build.team || null;
      // Suppress the next auto-seed pass — loadBuild has already supplied the
      // returner+target rows. Without this guard, the returners query refetches
      // when selectedTeam changes and auto-seed wipes the loaded roster.
      skipAutoSeedOnceRef.current = true;
      autoSeededTeamRef.current = normalizeName(build.team || "");
      setSelectedTeam(build.team);
      setTotalBudget(Number(build.total_budget) || 0);
      const savedDepthAssignments =
        build.depth_assignments &&
        typeof build.depth_assignments === "object" &&
        !Array.isArray(build.depth_assignments)
          ? (build.depth_assignments as Record<string, number>)
          : {};
      const savedDepthPlaceholders =
        build.depth_placeholders &&
        typeof build.depth_placeholders === "object" &&
        !Array.isArray(build.depth_placeholders)
          ? (build.depth_placeholders as Record<string, "freshman" | "transfer">)
          : {};
      setDepthAssignments(savedDepthAssignments);
      setDepthPlaceholders(savedDepthPlaceholders);

      const { data: players } = await supabase
        .from("team_build_players")
        .select("*")
        .eq("build_id", buildId);

      if (players) {
        const playerIds = players
          .map((p) =>
            typeof p.player_id === "string" ? p.player_id.trim() : p.player_id,
          )
          .filter((id): id is string => isUuid(id));

        let playerMap: Record<string, any> = {};
        // Keyed as `${player_id}|H` or `${player_id}|P` so each side of a TWP
        // (two-way player) stores and retrieves its own snapshot/prediction
        // independently. Non-TWP players have exactly one entry.
        let predictionMap: Record<string, any> = {};

        // ── Snapshot map ──────────────────────────────────────────────────────
        // player_snapshot is populated at build-save time (and at default build
        // creation). When present and non-empty, it lets us skip the live
        // player_predictions query entirely for that player row.
        //
        // Key scheme: `${pid}|H` for hitter rows, `${pid}|P` for pitcher rows.
        // This prevents TWP sides from overwriting each other.
        const snapshotMap: Record<string, any> = {};
        for (const bp of players) {
          const pid = typeof bp.player_id === "string" ? bp.player_id.trim() : bp.player_id;
          if (!pid) continue;
          const snap = bp.player_snapshot as any;
          // Reject snapshots saved before predictions resolved (all-null stats).
          // Exclude o_war alone — a stale partial snapshot can write o_war=0
          // while leaving p_avg/p_era null, which would falsely pass this gate.
          const hasData = snap && (
            snap.p_avg != null || snap.p_era != null || snap.p_war != null
          );
          if (hasData) {
            const side = isPitcherSlot(bp.position_slot) ? "P" : "H";
            snapshotMap[`${pid}|${side}`] = snap;
          }
        }

        // Only fetch player_predictions for rows that don't have a valid snapshot.
        const idsNeedingPred = [...new Set(
          players
            .filter((bp) => {
              const pid = typeof bp.player_id === "string" ? bp.player_id.trim() : bp.player_id;
              if (!isUuid(pid)) return false;
              const side = isPitcherSlot(bp.position_slot) ? "P" : "H";
              return !snapshotMap[`${pid}|${side}`];
            })
            .map((bp) => typeof bp.player_id === "string" ? bp.player_id.trim() : bp.player_id)
            .filter((id): id is string => isUuid(id))
        )];

        if (playerIds.length > 0) {
          const { data: pData, error: pErr } = await supabase
            .from("players")
            .select(`
              id, first_name, last_name, position, is_twp, class_year, throws_hand, bats_hand, team, from_team, conference,
              player_predictions(id, from_avg, from_obp, from_slg, from_era, from_fip, from_whip, from_k9, from_bb9, from_hr9, p_avg, p_obp, p_slg, p_ops, p_iso, p_wrc_plus, p_era, p_fip, p_whip, p_k9, p_bb9, p_hr9, p_rv_plus, pitcher_role, power_rating_plus, class_transition, dev_aggressiveness, model_type, status, variant, updated_at),
              nil_valuations(estimated_value, component_breakdown)
            `)
            .in("id", playerIds);
          if (pErr) {
            console.error("TeamBuilder loadBuild players fetch failed:", pErr);
          }
          (pData ?? []).forEach((p) => {
            playerMap[p.id] = p;
          });

          if (idsNeedingPred.length > 0) {
            let predQuery = supabase
              .from("player_predictions")
              .select(
                "id, player_id, customer_team_id, from_avg, from_obp, from_slg, from_era, from_fip, from_whip, from_k9, from_bb9, from_hr9, p_avg, p_obp, p_slg, p_ops, p_iso, p_wrc_plus, p_era, p_fip, p_whip, p_k9, p_bb9, p_hr9, p_rv_plus, pitcher_role, power_rating_plus, class_transition, dev_aggressiveness, model_type, status, variant, updated_at, o_war, market_value, hitter_depth_role",
              )
              .eq("season", PROJECTION_SEASON)
              .in("player_id", idsNeedingPred)
              .in("variant", ["regular", "precomputed"])
              .in("status", ["active", "departed"]);
            predQuery = applyTeamScopeFilter(predQuery as any, effectiveTeamId);
            const { data: predData, error: predErr } = await predQuery;
            if (predErr) {
              console.error("TeamBuilder loadBuild predictions fetch failed:", predErr);
            }

            // ── Prediction map ────────────────────────────────────────────────
            // Group rows by player_id, then store under a side-keyed key:
            //   `${pid}|H` → hitter prediction (pitcher_role = null)
            //   `${pid}|P` → pitcher prediction (pitcher_role = 'SP'/'RP')
            //
            // For TWPs this gives each side its own prediction.
            // For non-TWPs we infer the side from the player's natural position
            // (not from pitcher_role, which can be null even for pitcher players).
            const grouped = new Map<string, any[]>();
            for (const row of predData || []) {
              const pid = String(row.player_id || "");
              if (!pid) continue;
              const list = grouped.get(pid) || [];
              list.push(row);
              grouped.set(pid, list);
            }

            // Pick the best row from a candidate set using team-scoped then
            // global scoring, mirroring the dashboard preference order.
            const pickBest = (rows: any[]): any | null => {
              if (rows.length === 0) return null;
              const teamRow = effectiveTeamId
                ? rows.find((r: any) => r.customer_team_id === effectiveTeamId && r.variant === "precomputed")
                : null;
              if (teamRow) return teamRow;
              const globals = rows.filter(
                (r: any) => r.variant === "regular" && (r.status === "active" || r.status === "departed"),
              );
              if (globals.length === 0) return rows[0] ?? null;
              let best = globals[0];
              for (const row of globals) {
                if (!best) { best = row; continue; }
                const rowScore = scorePredictionLikeDashboard(row, false);
                const bestScore = scorePredictionLikeDashboard(best, false);
                if (rowScore > bestScore) best = row;
                else if (rowScore === bestScore) {
                  if (new Date(row.updated_at || 0).getTime() > new Date(best.updated_at || 0).getTime()) {
                    best = row;
                  }
                }
              }
              return best;
            };

            for (const [pid, rows] of grouped.entries()) {
              const player = playerMap[pid];
              if (!player) continue;
              const isTwp = (player as any)?.is_twp ?? false;
              // Split on pitcher_role for all players, not just TWPs. Without
              // this, scorePredictionLikeDashboard picks the hitter-model row
              // for pure pitchers (it scores higher because p_avg etc. are
              // populated), leaving p_era null on the pitcher slot.
              const hitterRows = rows.filter((r: any) => r.pitcher_role == null);
              const pitcherRows = rows.filter((r: any) => r.pitcher_role != null);
              if (isTwp) {
                // TWP: each side gets its own prediction. Fall back to the full
                // row set when a dedicated side-specific row doesn't exist — the
                // pitcher-model row carries both hitter and pitcher stats for TWPs.
                const hPick = pickBest(hitterRows.length > 0 ? hitterRows : rows);
                const pPick = pickBest(pitcherRows.length > 0 ? pitcherRows : rows);
                if (hPick) predictionMap[`${pid}|H`] = hPick;
                if (pPick) predictionMap[`${pid}|P`] = pPick;
              } else {
                // Non-TWP: infer side from the player's natural position.
                const playerPos = String((player as any)?.position ?? "");
                const side = isPitcherSlot(playerPos) ? "P" : "H";
                // Prefer the model row matching the side; fall back to full set.
                const candidates = side === "P"
                  ? (pitcherRows.length > 0 ? pitcherRows : rows)
                  : (hitterRows.length > 0 ? hitterRows : rows);
                const best = pickBest(candidates);
                if (best) predictionMap[`${pid}|${side}`] = best;
              }
            }
          }
        }

        const fallbackPitchers = readStoragePitcherLocalPlayers(
          build.team || selectedTeam || "",
          pitchingMasterRows,
          selectedTeamId,
        );
        const usedFallbackIndices = new Set<number>();

        const reserveFallbackIndexByName = (fullName: string) => {
          const key = normalizeName(fullName);
          if (!key) return;
          for (let i = 0; i < fallbackPitchers.length; i += 1) {
            if (usedFallbackIndices.has(i)) continue;
            const fp = fallbackPitchers[i];
            const fpName = normalizeName(`${fp.first_name || ""} ${fp.last_name || ""}`);
            if (fpName === key) {
              usedFallbackIndices.add(i);
              return;
            }
          }
        };

        const claimFallbackPitcher = (preferredRole: "SP" | "RP" | null) => {
          const pick = (idx: number) => {
            usedFallbackIndices.add(idx);
            const fp = fallbackPitchers[idx];
            return {
              first_name: fp.first_name,
              last_name: fp.last_name,
              position: fp.position,
              team: fp.team,
              from_team: fp.from_team,
              conference: fp.conference,
            };
          };
          if (preferredRole) {
            for (let i = 0; i < fallbackPitchers.length; i += 1) {
              if (usedFallbackIndices.has(i)) continue;
              if (fallbackPitchers[i].role === preferredRole) return pick(i);
            }
          }
          for (let i = 0; i < fallbackPitchers.length; i += 1) {
            if (!usedFallbackIndices.has(i)) return pick(i);
          }
          return null;
        };

        setRosterPlayers(
          players
            .map((bp: any) => {
              try {
                const meta = parseBuildPlayerMeta(bp.production_notes);
                const fallbackName = (() => {
                  if (bp.custom_name && bp.custom_name.trim()) return bp.custom_name.trim();
                  if (meta.notes && meta.notes.trim()) return meta.notes.trim();
                  if (!meta.localPlayer) return null;
                  const full =
                    `${meta.localPlayer.first_name || ""} ${meta.localPlayer.last_name || ""}`.trim();
                  return full || null;
                })();
                const fallbackTeam = meta.localPlayer?.team ?? build.team ?? selectedTeam ?? null;
                const fallbackPosition = meta.localPlayer?.position ?? bp.position_slot ?? null;
                const fallbackPitcherLike = /^(SP|RP|CL|P|LHP|RHP)/i.test(
                  String(fallbackPosition || ""),
                );
                const normalizedPlayerIdRaw =
                  typeof bp.player_id === "string" ? bp.player_id.trim() : bp.player_id;
                const recoveredPlayer =
                  !normalizedPlayerIdRaw && fallbackName
                    ? resolveTeamBuilderPlayer(
                        null,
                        fallbackName,
                        fallbackTeam,
                        fallbackPitcherLike ? true : false,
                      )
                    : null;
                const normalizedPlayerId =
                  normalizedPlayerIdRaw || recoveredPlayer?.id || null;
                const pd = normalizedPlayerId
                  ? playerMap[normalizedPlayerId] || recoveredPlayer || null
                  : null;

                // Side-keyed lookup: snapshot first (zero extra query), then
                // live prediction for rows where snapshot is absent or stale.
                const bpSide = isPitcherSlot(bp.position_slot) ? "P" : "H";
                const snapshot = normalizedPlayerId
                  ? snapshotMap[`${normalizedPlayerId}|${bpSide}`] ?? null
                  : null;
                const activePred = snapshot ?? (normalizedPlayerId
                  ? predictionMap[`${normalizedPlayerId}|${bpSide}`] ?? null
                  : null);

                const localPlayerRaw =
                  !pd && meta.localPlayer
                    ? {
                        first_name: (meta.localPlayer.first_name || "").trim(),
                        last_name: (meta.localPlayer.last_name || "").trim(),
                        position: meta.localPlayer.position ?? null,
                        team: meta.localPlayer.team ?? null,
                        from_team: meta.localPlayer.from_team ?? null,
                        conference: meta.localPlayer.conference ?? null,
                      }
                    : null;
                const overrideRole = asPitcherRole(
                  pd?.id ? getSupabaseRole(pd.id) || null : null,
                );
                const inferredRole = overrideRole || asPitcherRole(pd?.position || null);
                const positionForPitcherInference =
                  pd?.position || localPlayerRaw?.position || "";
                const isPitcherRow = /^(SP|RP|CL|P|LHP|RHP)/i.test(
                  String(positionForPitcherInference),
                );
                const fallbackRole: "SP" | "RP" | null =
                  bp.position_slot === "SP" || bp.position_slot === "RP"
                    ? bp.position_slot
                    : meta.depthRole === "weekend_starter" ||
                        meta.depthRole === "weekday_starter"
                      ? "SP"
                      : meta.depthRole === "high_leverage_reliever" ||
                          meta.depthRole === "low_impact_reliever"
                        ? "RP"
                        : null;

                if (pd) {
                  reserveFallbackIndexByName(
                    `${pd.first_name || ""} ${pd.last_name || ""}`.trim(),
                  );
                } else if (localPlayerRaw) {
                  reserveFallbackIndexByName(
                    `${localPlayerRaw.first_name || ""} ${localPlayerRaw.last_name || ""}`.trim(),
                  );
                } else if (fallbackName) {
                  reserveFallbackIndexByName(fallbackName);
                }

                const recoveredPitcher =
                  !pd && !localPlayerRaw && isPitcherRow
                    ? claimFallbackPitcher(fallbackRole)
                    : null;
                const resolvedLocalPlayer = localPlayerRaw || recoveredPitcher;
                const resolvedName =
                  fallbackName ||
                  (resolvedLocalPlayer
                    ? `${resolvedLocalPlayer.first_name || ""} ${resolvedLocalPlayer.last_name || ""}`.trim() ||
                      null
                    : null) ||
                  (pd
                    ? `${pd.first_name || ""} ${pd.last_name || ""}`.trim() || null
                    : null);

                return {
                  ...(bp as any),
                  id: bp.id,
                  player_id: normalizedPlayerId ?? null,
                  source: bp.source as "returner" | "portal",
                  custom_name: resolvedName || null,
                  position_slot:
                    bp.position_slot || (isPitcherRow ? inferredRole || "RP" : null),
                  depth_order: bp.depth_order ?? 1,
                  nil_value: Number(bp.nil_value) || 0,
                  // Target-board "shopping list" flag. Defaults true if the
                  // column is missing (rows saved before the migration), so
                  // existing builds keep counting everything toward roster
                  // totals the same way they always have.
                  included_in_roster: (bp as any).included_in_roster ?? true,
                  production_notes: meta.notes,
                  roster_status:
                    meta.rosterStatus ??
                    ((bp.source as string) === "portal" ? "target" : "returner"),
                  depth_role: (() => {
                    // Coach override always wins.
                    if (meta.depthRole) return meta.depthRole;
                    if (isPitcherRow) {
                      const ip =
                        pd?.source_player_id
                          ? pitchingStatsByNameTeam.bySourceId.get(pd.source_player_id)?.ip ?? null
                          : null;
                      return defaultPitcherDepthRoleFromIp(
                        ip,
                        inferredRole === "SP" ? "SP" : "RP",
                      );
                    }
                    // For hitters: prefer hitter_depth_role from snapshot — it
                    // reflects the tier used at precompute time so the overlay
                    // starts at 1× with no PA mismatch.
                    if (snapshot?.hitter_depth_role) return snapshot.hitter_depth_role;
                    const hNameKey = pd
                      ? `${normalizeName(`${pd.first_name || ""} ${pd.last_name || ""}`.trim())}|${normalizeName(pd.team || "")}`
                      : null;
                    const hitterAb =
                      (pd?.id ? seasonUsage.hitterAb?.get(pd.id) : null) ??
                      (hNameKey ? seasonUsage.hitterAbByNameTeam?.get(hNameKey) : null) ??
                      null;
                    if (hitterAb != null && hitterAb > 0) return defaultHitterDepthRoleFromPa(hitterAb);
                    return "everyday_starter";
                  })(),
                  class_transition: meta.classTransitionOverridden
                    ? meta.classTransition ?? "SJ"
                    : activePred?.class_transition ?? "SJ",
                  dev_aggressiveness: meta.devAggressivenessOverridden
                    ? meta.devAggressiveness ?? 0
                    : activePred?.dev_aggressiveness ?? 0,
                  class_transition_overridden: meta.classTransitionOverridden,
                  dev_aggressiveness_overridden: meta.devAggressivenessOverridden,
                  projection_tier: meta.projectionTier ?? null,
                  nil_value_overridden: meta.nilValueOverridden,
                  transfer_snapshot: meta.transferSnapshot ?? null,
                  player: pd
                    ? {
                        first_name: pd.first_name,
                        last_name: pd.last_name,
                        position: pd.position,
                        is_twp: (pd as any).is_twp ?? false,
                        class_year: (pd as any).class_year ?? null,
                        throws_hand: (pd as any).throws_hand ?? null,
                        bats_hand: (pd as any).bats_hand ?? null,
                        team: pd.team,
                        from_team: pd.from_team,
                        conference: pd.conference ?? null,
                      }
                    : resolvedLocalPlayer || null,
                  prediction: activePred ?? null,
                  nilVal: pd?.nil_valuations?.[0]?.estimated_value ?? null,
                  nil_owar: pd?.nil_valuations?.[0]?.component_breakdown?.ncaa_owar ?? null,
                  team_metrics: meta.metrics,
                  team_power_plus: meta.power,
                };
              } catch (err) {
                if (import.meta.env.DEV) {
                  console.warn("[TeamBuilder] Failed to process roster player:", err, bp);
                }
                return null;
              }
            })
            .filter(Boolean) as any[],
        );
      }
      setDirty(false);
      if (buildLoadDoneRef) buildLoadDoneRef.current = true;
      if (setBuildLoadDone) setBuildLoadDone(true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [builds, allPlayersForSearch, selectedTeam, resolveTeamBuilderPlayer],
  );
}
