import { memo } from "react";
import { Link } from "react-router-dom";
import { TableRow, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus, Check } from "lucide-react";
import { formatWithCommas, parseCommaNumber } from "@/lib/utils";
import { profileRouteFor } from "@/lib/profileRoutes";
import { assessHitterRisk, assessPitcherRisk } from "@/lib/playerRisk";
import type { BuildPlayer, PitcherDepthRole } from "./types";
import {
  effectivePitcherRoleForBuild,
  isPitcher,
  normalizeName,
  normalizeKey,
  getPlayerName,
  projectedNilTierClass,
  pitcherRoleFromSlot,
  normalizePitcherDepthRole,
  storagePitcherRouteFor,
  writeLegacyPitchingRoleOverride,
} from "./helpers";

const POSITION_SLOTS = ["C", "1B", "2B", "SS", "3B", "LF", "CF", "RF", "DH"] as const;
const PITCHER_SLOTS = ["SP1", "SP2", "SP3", "SP4", "SP5", "RP1", "RP2", "RP3", "RP4", "CL"] as const;
const DEV_AGGRESSIVENESS_OPTIONS = [0, 0.5, 1] as const;

export interface PlayerTableRowSharedProps {
  allPlayersById: Map<string, unknown>;
  pitchingSourceMap: Map<string, { role?: string | null }>;
  // Raw pitcher skill metrics from Pitching Master (stuffPlus, whiff%, etc).
  // Used by the target board Risk badge for pitcher rows. Keys: source_player_id
  // (preferred), then normalized "name|team".
  pitcherSkillByKey: {
    bySourceId: Map<string, {
      stuffPlus: number | null;
      whiffPct: number | null;
      bbPct: number | null;
      hardHit: number | null;
      izWhiff: number | null;
      ip: number | null;
    }>;
    byNameTeam: Map<string, {
      stuffPlus: number | null;
      whiffPct: number | null;
      bbPct: number | null;
      hardHit: number | null;
      izWhiff: number | null;
      ip: number | null;
    }>;
  };
  thinSampleMap: Map<string, boolean>;
  powerLookup: Map<string, {
    chase?: number | null;
    contact?: number | null;
    barrel?: number | null;
    lineDrive?: number | null;
    avgExitVelo?: number | null;
    ev90?: number | null;
    pull?: number | null;
    gb?: number | null;
    bb?: number | null;
  }>;
  confByKey: Map<string, { stuff_plus?: number | null }>;
  hitterMasterPaMap: Map<string, number>;
  exitPositions: Record<string, string>;
  totalBudget: number;
  fallbackRosterTotalPlayerScore: number;
  selectedTeam: string | null;
  returnTo: string;
  playerProjection: (p: BuildPlayer, side: "hitter" | "pitcher") => {
    owar: number | null;
    pwar: number | null;
    shown: unknown;
    sim: unknown;
  };
  simulateTransferProjection: (p: BuildPlayer, side: "hitter" | "pitcher") => {
    owar: number | null;
    nil_valuation: number | null;
    pWrcPlus: number | null;
    p_rv_plus: number | null;
  } | null;
  projectedNilForPlayer: (p: BuildPlayer, side: "hitter" | "pitcher") => number | null;
  projectedBudgetValue: (p: BuildPlayer) => number | null;
  resolveTeamBuilderPlayer: (
    id: string | null,
    name: string,
    team: string,
    isPitcherArg: boolean,
  ) => { id: string } | null;
  updatePlayer: (idx: number, updates: Partial<BuildPlayer>) => void;
  updatePlayerWithRecalc: (idx: number, updates: Partial<BuildPlayer>) => void;
  removePlayer: (idx: number) => void;
  markPlayerLeaving: (idx: number, name: string) => void;
  updatePlayerOverrideFn: (playerId: string, overrides: { position?: string | null }) => void;
  setSupabaseRole: (playerId: string, role: "SP" | "RP" | null) => void;
}

interface Props extends PlayerTableRowSharedProps {
  p: BuildPlayer;
  idx: number;
  globalIdx: number;
  pool?: "hitter" | "pitcher";
  // Which subtab is rendering this row. Some cells differ between the two:
  //   target board: Cell 3 = Risk badge, Cell 4 = static position text
  //   roster     : Cell 3 = Position text, Cell 4 = position dropdown
  // The +/✓ toggle, From: line, Status badge, and stat cells are identical
  // across both. Defaults to "roster" so existing call sites that don't pass
  // the prop yet stay on today's roster-style rendering.
  tableContext?: "roster" | "target";
}

function PlayerTableRow({
  p,
  idx: _idx,
  globalIdx,
  pool,
  tableContext = "roster",
  allPlayersById,
  pitchingSourceMap,
  pitcherSkillByKey,
  thinSampleMap,
  powerLookup,
  confByKey,
  hitterMasterPaMap,
  exitPositions,
  totalBudget,
  fallbackRosterTotalPlayerScore,
  returnTo,
  playerProjection,
  simulateTransferProjection,
  projectedNilForPlayer,
  projectedBudgetValue,
  resolveTeamBuilderPlayer,
  updatePlayer,
  updatePlayerWithRecalc,
  removePlayer,
  markPlayerLeaving,
  updatePlayerOverrideFn,
  setSupabaseRole,
}: Props) {
  const side: "hitter" | "pitcher" = pool ?? (isPitcher(p) ? "pitcher" : "hitter");
  const projection = playerProjection(p, side);
  const isTarget = (p.roster_status || "returner") === "target";
  const isPitcherRow = side === "pitcher";

  const linkedPlayerId = (() => {
    if (p.player_id) return p.player_id;
    const fullName = p.player
      ? `${p.player.first_name || ""} ${p.player.last_name || ""}`.trim()
      : (p.custom_name || "").trim();
    const teamName = p.player?.team || p.player?.from_team || "";
    const match = resolveTeamBuilderPlayer(null, fullName, teamName, isPitcherRow);
    return match?.id ?? null;
  })();

  const sourceId = (p.player as any)?.source_player_id ?? null;
  const pmRole = sourceId ? pitchingSourceMap.get(sourceId)?.role : null;
  const currentPitcherRole = effectivePitcherRoleForBuild(p, pmRole);
  const pitcherDepthRole = normalizePitcherDepthRole(p.depth_role, currentPitcherRole);
  const sim = isTarget ? simulateTransferProjection(p, side) : null;

  const projectedOwar = isTarget ? (sim?.owar ?? null) : (projection.owar ?? null);
  const projectedPwar = isPitcherRow ? projection.pwar : null;
  const projectedNilRaw = isPitcherRow
    ? projectedNilForPlayer(p, "pitcher")
    : (isTarget
        ? (sim?.nil_valuation ?? p.transfer_snapshot?.nil_valuation ?? projectedNilForPlayer(p, "hitter"))
        : projectedNilForPlayer(p, "hitter"));
  const projectedNil = (() => {
    const n = Number(projectedNilRaw);
    if (Number.isFinite(n)) return n;
    const source: any = projection.shown ?? projection.sim ?? p.transfer_snapshot ?? null;
    const fallback = Number(source?.nil_valuation ?? 0);
    return Number.isFinite(fallback) ? fallback : 0;
  })();

  return (
    <TableRow key={globalIdx}>
      <TableCell className="font-medium whitespace-nowrap sticky left-0 z-10 bg-background shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)] min-w-[180px]">
        <div className="flex items-center gap-2">
          {isTarget && (() => {
            const onRoster = (p as any).included_in_roster !== false;
            return (
              <button
                type="button"
                onClick={() => updatePlayer(globalIdx, { included_in_roster: !onRoster } as any)}
                title={onRoster ? "Remove from Roster" : "Add to Roster"}
                aria-label={onRoster ? "Remove from Roster" : "Add to Roster"}
                className={
                  onRoster
                    ? "inline-flex items-center justify-center w-4 h-4 rounded-sm text-emerald-600 hover:text-emerald-700 transition-colors"
                    : "inline-flex items-center justify-center w-4 h-4 rounded-sm text-muted-foreground hover:text-foreground transition-colors"
                }
              >
                {onRoster ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
              </button>
            );
          })()}
          {linkedPlayerId ? (
            <Link
              to={profileRouteFor(
                linkedPlayerId,
                isPitcherRow
                  ? currentPitcherRole
                  : (p.position_slot || p.player?.position || null),
                p.player?.position || null,
              )}
              state={{ returnTo }}
              className="hover:text-primary hover:underline transition-colors"
            >
              {getPlayerName(p)}
            </Link>
          ) : isPitcherRow ? (
            <Link
              to={storagePitcherRouteFor(getPlayerName(p), p.player?.team || null)}
              state={{ returnTo }}
              className="hover:text-primary hover:underline transition-colors"
            >
              {getPlayerName(p)}
            </Link>
          ) : (
            <span>{getPlayerName(p)}</span>
          )}
        </div>
        {isTarget && (
          <div className="text-[11px] text-muted-foreground">
            From: {p.transfer_snapshot?.from_team || p.player?.from_team || p.player?.team || "—"} ({p.transfer_snapshot?.from_conference || p.player?.conference || "—"})
          </div>
        )}
        {p.projection_tier && (
          <div className="text-[10px] uppercase tracking-[0.08em] font-semibold text-[#D4AF37]/90 mt-0.5">
            Freshman · {p.projection_tier === "developmental" ? "Developmental"
              : p.projection_tier === "role_player" ? "Role Player"
              : p.projection_tier === "contributor" ? "Contributor"
              : "Immediate Impact"}
          </div>
        )}
      </TableCell>

      <TableCell>
        {isTarget ? (
          (() => {
            const portalStatus = p.player_id
              ? (allPlayersById.get(p.player_id) as any)?.portal_status
              : null;
            const label =
              portalStatus === "IN PORTAL"
                ? "In Portal"
                : portalStatus === "COMMITTED"
                ? "Committed"
                : "Watching";
            const colors: Record<string, string> = {
              "In Portal": "text-emerald-600 bg-emerald-500/10 border-emerald-500/30",
              "Committed": "text-blue-600 bg-blue-500/10 border-blue-500/30",
              "Watching": "text-[#D4AF37] bg-[#D4AF37]/10 border-[#D4AF37]/30",
            };
            return (
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${colors[label] || ""}`}
              >
                {label}
              </span>
            );
          })()
        ) : (
          <Select
            value={p.roster_status || "returner"}
            onValueChange={(v) => {
              if (v === "leaving") {
                markPlayerLeaving(globalIdx, getPlayerName(p));
                return;
              }
              updatePlayer(globalIdx, { roster_status: "returner" });
            }}
          >
            <SelectTrigger className="w-[110px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="returner">Returner</SelectItem>
              <SelectItem value="leaving">Leaving</SelectItem>
            </SelectContent>
          </Select>
        )}
      </TableCell>

      <TableCell className={(isTarget && tableContext === "target") ? "text-center" : undefined}>
        {(isTarget && tableContext === "target") ? (
          (() => {
            const pName = p.player
              ? `${p.player.first_name || ""} ${p.player.last_name || ""}`.trim()
              : "";
            const pTeam = p.player?.from_team || p.player?.team || "";
            const pSourceId = p.player?.source_player_id || null;
            const originConf = p.player?.conference ?? p.transfer_snapshot?.from_conference ?? null;
            const colors: Record<string, string> = {
              Low: "text-[hsl(142,71%,35%)] bg-[hsl(142,71%,45%,0.12)]",
              Moderate: "text-[hsl(200,80%,35%)] bg-[hsl(200,80%,50%,0.12)]",
              Elevated: "text-[hsl(40,90%,38%)] bg-[hsl(40,90%,50%,0.12)]",
              High: "text-[hsl(0,72%,41%)] bg-[hsl(0,72%,51%,0.12)]",
            };

            if (isPitcherRow) {
              // Pitcher Risk: feed assessPitcherRisk with the same inputs
              // PitcherProfile / TransferPortal use. Skillset comes from
              // Pitching Master via pitcherSkillByKey; rate proxies come
              // from the stored prediction / transfer snapshot. careerSeasons
              // and confHitterTalentPlus aren't plumbed into TB today —
              // those factors fall back to defaults.
              const ptKey = `${normalizeName(pName)}|${normalizeName(pTeam)}`;
              const skill =
                (pSourceId ? pitcherSkillByKey.bySourceId.get(pSourceId) : null) ??
                pitcherSkillByKey.byNameTeam.get(ptKey) ??
                null;
              const prv = p.prediction?.p_rv_plus ?? p.transfer_snapshot?.p_rv_plus ?? sim?.p_rv_plus ?? null;
              const risk = assessPitcherRisk({
                conference: originConf,
                projectedPrvPlus: prv,
                confHitterTalentPlus: null,
                careerSeasons: undefined,
                ip: skill?.ip ?? null,
                stuffPlus: skill?.stuffPlus ?? null,
                whiffPct: skill?.whiffPct ?? null,
                izWhiff: skill?.izWhiff ?? null,
                bbPct: skill?.bbPct ?? null,
                hardHit: skill?.hardHit ?? null,
              });
              return (
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${colors[risk.grade] || ""}`}
                >
                  {risk.grade}
                </span>
              );
            }

            const spKey = `${normalizeName(pName)}|${normalizeName(pTeam)}`;
            const sp =
              (pSourceId ? powerLookup.get(`sid:${pSourceId}`) : null) ??
              powerLookup.get(spKey) ??
              powerLookup.get(normalizeName(pName)) ??
              null;
            const pureWrc =
              p.prediction?.p_wrc_plus ?? p.transfer_snapshot?.p_wrc_plus ?? sim?.pWrcPlus ?? null;
            const confRow = originConf ? confByKey.get(normalizeKey(originConf)) : null;
            const resolvedPa = p.player_id ? (hitterMasterPaMap.get(p.player_id) ?? null) : null;
            const risk = assessHitterRisk({
              conference: originConf,
              projectedWrcPlus: pureWrc,
              confStuffPlus: confRow?.stuff_plus,
              pa: resolvedPa,
              chase: sp?.chase,
              contact: sp?.contact,
              barrel: sp?.barrel,
              lineDrive: sp?.lineDrive,
              avgEv: sp?.avgExitVelo,
              ev90: sp?.ev90,
              pull: sp?.pull,
              gb: sp?.gb,
              bb: sp?.bb,
            });
            return (
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${colors[risk.grade] || ""}`}
              >
                {risk.grade}
              </span>
            );
          })()
        ) : isPitcherRow ? (
          (() => {
            const hand = String(p.player?.throws_hand || "").trim().toUpperCase();
            if (hand === "R") return "RHP";
            if (hand === "L") return "LHP";
            if (hand === "S") return "SHP";
            return "P";
          })()
        ) : (
          (() => {
            const dbPos = p.player?.position || "";
            // Reject pitcher-position lookups — TWPs whose Hitter Master row
            // still has Pos="P" (legacy) would otherwise override their real
            // hitter position from `players`. The hitter tab should never show
            // a pitcher position in this column.
            const isPitcherPos = (s: string) => /^(SP|RP|CL|LHP|RHP|P)$/i.test(s.trim());
            if (dbPos === "OF" || !dbPos) {
              const fullName = `${p.player?.first_name || ""} ${p.player?.last_name || ""}`.trim();
              const team = p.player?.team || "";
              const posMap = exitPositions as Record<string, string>;
              const exact = posMap[`${fullName}|${team}`] || posMap[fullName];
              if (exact && !isPitcherPos(exact)) return exact;
              const namePrefix = `${fullName}|`;
              for (const key of Object.keys(posMap)) {
                const v = posMap[key];
                if (key.startsWith(namePrefix) && v && !isPitcherPos(v)) return v;
              }
              return dbPos || "—";
            }
            return dbPos;
          })()
        )}
      </TableCell>

      <TableCell className={tableContext === "target" ? "text-center" : undefined}>
        {tableContext === "target" ? (
          // Target board renders the position as read-only text — the
          // "where do they slot in?" decision lives on the roster subtab,
          // where the dropdown still appears once the coach adds them in.
          (() => {
            if (isPitcherRow) return currentPitcherRole || "—";
            const slot = p.position_slot;
            if (slot && slot !== "none") return slot;
            return p.player?.position || "—";
          })()
        ) : isPitcherRow ? (
          <Select
            value={currentPitcherRole}
            onValueChange={(v) => {
              const nextRole = v as "SP" | "RP";
              const isTwpRow = !!p.player?.is_twp;
              updatePlayer(globalIdx, {
                ...(isTwpRow ? {} : { position_slot: nextRole }),
                depth_role: normalizePitcherDepthRole(p.depth_role, nextRole),
              });
              if (p.player_id) {
                if (!isTwpRow) updatePlayerOverrideFn(p.player_id, { position: nextRole });
                writeLegacyPitchingRoleOverride(getPlayerName(p), p.player?.team || null, nextRole);
                setSupabaseRole(p.player_id, nextRole);
              }
            }}
          >
            <SelectTrigger className="w-20 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="SP">SP</SelectItem>
              <SelectItem value="RP">RP</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <Select
            // Always default to "none" (renders as "—") when no slot is
            // assigned. The prior target-only fallback to the player's
            // natural position made on-roster targets look "stuck" on
            // their old position when they should be unassigned and
            // coach-selectable like any other roster slot.
            value={p.position_slot || "none"}
            onValueChange={(v) => {
              const nextSlot = v === "none" ? null : v;
              updatePlayer(globalIdx, { position_slot: nextSlot });
              if (p.player_id) {
                const isPitchSlot =
                  !!nextSlot &&
                  [...PITCHER_SLOTS].includes(nextSlot as (typeof PITCHER_SLOTS)[number]);
                const nextPitchRole = isPitchSlot ? pitcherRoleFromSlot(nextSlot) : null;
                updatePlayerOverrideFn(p.player_id, { position: nextSlot });
                writeLegacyPitchingRoleOverride(
                  getPlayerName(p),
                  p.player?.team || null,
                  nextPitchRole,
                );
                setSupabaseRole(p.player_id, nextPitchRole as "SP" | "RP" | null);
              }
            }}
          >
            <SelectTrigger className="w-20 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              {[...POSITION_SLOTS, ...PITCHER_SLOTS].map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </TableCell>

      {/* Class Adj column removed per user request 2026-05-18 — the underlying
          class_transition value still flows into the projection equation
          (auto-derived from class_year, override-able on the player profile
          page). Only the read-only display column was dropped. */}

      <TableCell>
        <Select
          value={String(
            p.dev_aggressiveness === 0 ||
            p.dev_aggressiveness === 0.5 ||
            p.dev_aggressiveness === 1
              ? p.dev_aggressiveness
              : 0,
          )}
          onValueChange={(v) =>
            // Profile-style: session-only update, no DB recalc round trip.
            // The session overlay in the simulation handles the math (same
            // formula PlayerProfile uses). One state change → one re-render →
            // values move and stay put. No multi-call flicker, no DB write.
            updatePlayer(globalIdx, {
              dev_aggressiveness: Number(v),
              dev_aggressiveness_overridden: true,
            })
          }
        >
          <SelectTrigger className="w-[90px] h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DEV_AGGRESSIVENESS_OPTIONS.map((v) => (
              <SelectItem key={v} value={String(v)}>
                {v.toFixed(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>

      <TableCell>
        {isPitcherRow ? (
          <Select
            value={pitcherDepthRole}
            onValueChange={(v) =>
              updatePlayer(globalIdx, { depth_role: v as PitcherDepthRole })
            }
          >
            <SelectTrigger className="w-[200px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {currentPitcherRole === "SP" ? (
                <>
                  <SelectItem value="weekend_starter">Weekend Starter (~80 IP)</SelectItem>
                  <SelectItem value="weekday_starter">Weekday Starter (~50 IP)</SelectItem>
                  <SelectItem value="swing_starter">Swing / Long Relief (~30 IP)</SelectItem>
                </>
              ) : (
                <>
                  <SelectItem value="workhorse_reliever">Workhorse RP (~50 IP)</SelectItem>
                  <SelectItem value="high_leverage_reliever">High Leverage (~33 IP)</SelectItem>
                  <SelectItem value="swing_starter">Swing / Long Relief (~30 IP)</SelectItem>
                  <SelectItem value="mid_leverage_reliever">Mid Leverage (~20 IP)</SelectItem>
                  <SelectItem value="low_impact_reliever">Low Impact (~12 IP)</SelectItem>
                  <SelectItem value="specialist_reliever">Specialist (~6 IP)</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        ) : (
          <Select
            value={p.depth_role === "starter" ? "everyday_starter" : (p.depth_role || "everyday_starter")}
            onValueChange={(v) =>
              updatePlayer(globalIdx, {
                depth_role: v as "cornerstone" | "everyday_starter" | "platoon_starter" | "utility" | "bench",
              })
            }
          >
            <SelectTrigger className="w-[140px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cornerstone">Cornerstone (245 PA)</SelectItem>
              <SelectItem value="everyday_starter">Everyday (215 PA)</SelectItem>
              <SelectItem value="platoon_starter">Platoon (145 PA)</SelectItem>
              <SelectItem value="utility">Utility (85 PA)</SelectItem>
              <SelectItem value="bench">Bench (25 PA)</SelectItem>
            </SelectContent>
          </Select>
        )}
      </TableCell>

      <TableCell className="text-center">
        {(() => {
          const shown: any = projection.shown ?? null;
          const thin = p.player_id ? thinSampleMap.get(p.player_id) === true : false;
          const thinCls = thin ? " opacity-60" : "";
          const suffix = thin ? "*" : "";
          if (isPitcherRow) {
            const source: any =
              shown ??
              ((p.roster_status === "target") ? p.transfer_snapshot : p.prediction) ??
              null;
            const pEra = source?.p_era ?? null;
            const pWhip = source?.p_whip ?? null;
            const pK9 = source?.p_k9 ?? null;
            const pBb9 = source?.p_bb9 ?? null;
            if (pEra == null && pWhip == null && pK9 == null && pBb9 == null) return "—";
            return (
              <span
                className={`inline-block whitespace-nowrap text-[12px] font-mono${thinCls}`}
                title={thin ? "Thin sample — under 5 IP with no prior-season data" : undefined}
              >
                {pEra != null ? Number(pEra).toFixed(2) : "—"} /{" "}
                {pWhip != null ? Number(pWhip).toFixed(2) : "—"} /{" "}
                {pK9 != null ? Number(pK9).toFixed(2) : "—"} /{" "}
                {pBb9 != null ? Number(pBb9).toFixed(2) : "—"}
                {suffix}
              </span>
            );
          }
          const projected = {
            p_avg: shown?.p_avg ?? null,
            p_obp: shown?.p_obp ?? null,
            p_slg: shown?.p_slg ?? null,
          };
          if (projected.p_avg == null && projected.p_obp == null && projected.p_slg == null)
            return "—";
          return (
            <span
              className={`inline-block whitespace-nowrap text-[12px] font-mono${thinCls}`}
              title={thin ? "Thin sample — under 15 AB with no prior-season data" : undefined}
            >
              {projected.p_avg?.toFixed(3) || "—"} / {projected.p_obp?.toFixed(3) || "—"} /{" "}
              {projected.p_slg?.toFixed(3) || "—"}
              {suffix}
            </span>
          );
        })()}
      </TableCell>

      <TableCell className="text-center">
        {(() => {
          const simVal = projection.sim ?? null;
          const shown: any = projection.shown ?? null;
          const thin = p.player_id ? thinSampleMap.get(p.player_id) === true : false;
          const shownMetric = isPitcherRow
            ? p.roster_status === "target"
              ? (shown?.p_rv_plus ??
                  shown?.p_wrc_plus ??
                  (simVal as any)?.p_rv_plus ??
                  p.transfer_snapshot?.p_rv_plus ??
                  p.transfer_snapshot?.p_wrc_plus ??
                  null)
              : (shown?.p_rv_plus ?? shown?.p_wrc_plus ?? p.transfer_snapshot?.p_rv_plus ?? null)
            : p.roster_status === "target"
            ? (shown?.p_wrc_plus ??
                (simVal as any)?.p_wrc_plus ??
                p.transfer_snapshot?.p_wrc_plus ??
                null)
            : (shown?.p_wrc_plus ?? null);
          if (shownMetric == null) return "—";
          return (
            <span className={thin ? "opacity-60" : ""}>
              {shownMetric.toFixed(0)}
              {thin ? "*" : ""}
            </span>
          );
        })()}
      </TableCell>

      <TableCell
        className={`text-center font-mono text-[12px] whitespace-nowrap ${
          (p.roster_status || "returner") === "leaving"
            ? "text-muted-foreground"
            : isPitcherRow
            ? "text-foreground"
            : projectedNilTierClass(projectedNil, totalBudget, fallbackRosterTotalPlayerScore)
        }`}
      >
        {(p.roster_status || "returner") === "leaving"
          ? "—"
          : `$${Math.max(0, Math.round(Number.isFinite(Number(projectedNil)) ? Number(projectedNil) : 0)).toLocaleString()}`}
      </TableCell>

      <TableCell className="text-center font-mono text-[12px] whitespace-nowrap">
        {(() => {
          if ((p.roster_status || "returner") === "leaving") return "—";
          const bv = projectedBudgetValue(p);
          return bv != null ? `$${Math.max(0, Math.round(bv)).toLocaleString()}` : "—";
        })()}
      </TableCell>

      <TableCell className="text-center">
        <Input
          type="text"
          inputMode="numeric"
          className="w-28 h-8 mx-auto text-center"
          // When the override flag is on, show whatever was typed (incl. "0").
          // formatWithCommas otherwise returns "" for 0, which hides the
          // coach's explicit "pay this player $0" decision.
          value={
            p.nil_value_overridden
              ? (Number.isFinite(Number(p.nil_value)) ? Number(p.nil_value).toLocaleString("en-US") : "")
              : formatWithCommas(p.nil_value)
          }
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (raw === "") {
              // Empty input clears the override and falls back to projection.
              updatePlayer(globalIdx, { nil_value: 0, nil_value_overridden: false });
              return;
            }
            updatePlayer(globalIdx, {
              nil_value: parseCommaNumber(raw),
              nil_value_overridden: true,
            });
          }}
        />
      </TableCell>

      <TableCell className="text-center font-mono text-[12px] whitespace-nowrap">
        {(p.roster_status || "returner") === "leaving"
          ? "—"
          : isPitcherRow
          ? projectedPwar != null
            ? projectedPwar.toFixed(2)
            : "—"
          : projectedOwar != null
          ? projectedOwar.toFixed(2)
          : "—"}
      </TableCell>

      <TableCell>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => removePlayer(globalIdx)}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

export default memo(PlayerTableRow);
