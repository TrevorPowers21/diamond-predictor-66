import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PROJECTION_SEASON } from "@/lib/seasonConstants";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PortalTeamCards } from "@/components/PortalTeamCards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Download, Pencil, Save, X, TrendingUp, TrendingDown, ShieldCheck, Target, Star } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useHitterSeedData } from "@/hooks/useHitterSeedData";
import { computeHitterPowerRatings } from "@/lib/powerRatings";
import { recalculatePredictionById } from "@/lib/predictionEngine";
import { PortalStatusBadge, PortalContactButton } from "@/components/PortalStatus";
import { usePlayerOverrides } from "@/hooks/usePlayerOverrides";
import { useTeamsTable } from "@/hooks/useTeamsTable";
import { useTargetBoard } from "@/hooks/useTargetBoard";
import { useHighFollow } from "@/hooks/useHighFollow";
import { downloadSinglePlayerReport, type ReportPlayer } from "@/components/ScoutingReport";
import { AiScoutingReportBody } from "@/components/AiScoutingReport";
import { useScoutingReport } from "@/hooks/useScoutingReport";
import CoachNotes from "@/components/CoachNotes";
import { useCoachNotes } from "@/hooks/useCoachNotes";
// pdfGenerator is loaded on demand — jspdf (350KB) excluded from initial bundle
const getPdfGenerator = () => import("@/lib/pdfGenerator");
import { trackEvent } from "@/lib/posthog";
import { assessHitterRisk } from "@/lib/playerRisk";
import { generateHitterReport } from "@/lib/scoutingReportGenerator";
import { RiskAssessmentCardRSTR } from "@/components/RiskAssessmentCard";
import { JucoHitterRiskCard } from "@/components/JucoRiskCards";
import { useConferenceStats } from "@/hooks/useConferenceStats";
import { isThinSampleHitter } from "@/lib/combinedStats";
import { computeOWarFromWrcPlus } from "@/lib/playerCalcs";
import { normalizeName, nameTeamKey, normalizeTeamForKey, getNameVariants } from "@/lib/nameUtils";
import { useSeedDataMaps } from "@/hooks/useSeedDataMaps";
import { useTransferPortalContext } from "@/hooks/useTransferPortalContext";
import {
  paForHitterDepthRole,
  defaultHitterDepthRoleFromActualPa,
  type HitterDepthRole,
} from "@/lib/depthRoles";
import { useNilValuation } from "@/hooks/useNilValuation";

const statFormat = (v: number | null | undefined, decimals = 3) => {
  if (v == null) return "—";
  return v >= 1 && decimals === 3 ? v.toFixed(3) : v.toFixed(decimals);
};

const pctFormat = (v: number | null | undefined) => {
  if (v == null) return "—";
  return Math.round(v).toString();
};

const computeDerived = (avg: number | null, obp: number | null, slg: number | null) => {
  const ncaaAvgWrc = 0.364;
  const ops = obp != null && slg != null ? obp + slg : null;
  const iso = slg != null && avg != null ? slg - avg : null;
  const wrc = avg != null && obp != null && slg != null && iso != null
    ? (0.45 * obp) + (0.3 * slg) + (0.15 * avg) + (0.1 * iso)
    : null;
  const wrcPlus = wrc != null && ncaaAvgWrc !== 0 ? (wrc / ncaaAvgWrc) * 100 : null;
  return { ops, iso, wrc, wrcPlus };
};


const warTierClass = (value: number | null | undefined) => {
  if (value == null) return "text-muted-foreground";
  if (value >= 2) return "text-[hsl(var(--success))]";
  if (value >= 1) return "text-[hsl(var(--warning))]";
  return "text-destructive";
};

const powerTierClass = (value: number | null | undefined) => {
  if (value == null) return "text-muted-foreground";
  if (value >= 120) return "text-[hsl(var(--success))]";
  if (value >= 100) return "text-[hsl(var(--warning))]";
  return "text-destructive";
};

const computePowerRatings = computeHitterPowerRatings;


const classTransitionLabel: Record<string, string> = {
  FS: "Freshman → Sophomore",
  SJ: "Sophomore → Junior",
  JS: "Junior → Senior",
  GR: "Graduate",
};

const classTransitionToYear: Record<string, string> = {
  FS: "So",
  SJ: "Jr",
  JS: "Sr",
  GR: "Gr",
};

// Inverse: maps a class_transition to the player's CURRENT class (the source
// side of the arrow). Used when a coach picks a transition in the form to
// keep player.class_year aligned with what the player is THIS season.
const classTransitionToCurrentYear: Record<string, string> = {
  FS: "FR",
  SJ: "SO",
  JS: "JR",
  GR: "GR",
};

function ScoutGrade({ label, value, fullLabel }: { label: string; value: number | null; fullLabel: string }) {
  // Treat 0 as missing — percentile scores are 0-100, and a literal 0 is almost
  // always a missing-data sentinel (e.g., JUCO arms whose pipeline computed
  // ev_score from an exit_vel that defaulted to 0). Showing "0 / Poor" for
  // someone we have no data on is more misleading than just rendering N/A.
  if (value == null || value === 0) {
    return (
      <div className="rounded-lg border border-[#162241] bg-[#0d1a30] p-3">
        <div className="text-xs font-medium text-[#8a94a6]">{fullLabel}</div>
        <div className="text-2xl font-bold mt-1 text-[#8a94a6]">—</div>
        <div className="text-xs font-semibold mt-0.5 text-[#5a6478]">N/A</div>
      </div>
    );
  }
  const tier =
    value >= 90 ? "bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))] border-[hsl(var(--success)/0.3)]" :
    value >= 75 ? "bg-[hsl(142,71%,45%,0.12)] text-[hsl(142,71%,35%)] border-[hsl(142,71%,45%,0.25)]" :
    value >= 60 ? "bg-[hsl(200,80%,50%,0.12)] text-[hsl(200,80%,35%)] border-[hsl(200,80%,50%,0.25)]" :
    value >= 45 ? "bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))] border-[hsl(var(--warning)/0.3)]" :
    value >= 35 ? "bg-[hsl(25,90%,50%,0.12)] text-[hsl(25,90%,38%)] border-[hsl(25,90%,50%,0.25)]" :
    "bg-destructive/15 text-destructive border-destructive/30";
  const grade =
    value >= 90 ? "Elite" :
    value >= 75 ? "Plus-Plus" :
    value >= 60 ? "Plus" :
    value >= 45 ? "Average" :
    value >= 35 ? "Below Avg" : "Poor";
  return (
    <div className={`rounded-lg border p-3 ${tier}`}>
      <div className="text-xs font-medium opacity-80">{fullLabel}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      <div className="text-xs font-semibold mt-0.5">{grade}</div>
    </div>
  );
}

function StatRow({ label, from, predicted }: { label: string; from: number | null; predicted: number | null }) {
  const diff = from != null && predicted != null ? predicted - from : null;
  const diffColor = diff != null ? (diff > 0.005 ? "text-[hsl(var(--success))]" : diff < -0.005 ? "text-destructive" : "text-muted-foreground") : "";
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-4">
        <span className="text-sm font-mono text-muted-foreground w-16 text-right">{statFormat(from)}</span>
        <span className="text-xs text-muted-foreground">→</span>
        <span className={`text-sm font-mono font-bold w-16 text-right ${diffColor}`}>
          {statFormat(predicted)}
          {diff != null && Math.abs(diff) > 0.001 && (
            diff > 0 ? <TrendingUp className="inline h-3 w-3 ml-1" /> : <TrendingDown className="inline h-3 w-3 ml-1" />
          )}
        </span>
      </div>
    </div>
  );
}

export default function PlayerProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = (location.state as any)?.returnTo as string | undefined;
  const queryClient = useQueryClient();
  const { hasRole, effectiveTeamId } = useAuth();
  const isAdmin = hasRole("admin");
  const { isOnBoard, addPlayer: addToBoard, removePlayer: removeFromBoard } = useTargetBoard();
  const { isOnList: isOnHighFollow, addPlayer: addToHighFollow, removePlayer: removeFromHighFollow } = useHighFollow();
  const { notes: coachNotesForExport } = useCoachNotes(id ?? null);
  const { conferenceStatsByKey } = useConferenceStats(2026);
  const { hitterStats, powerRatings: powerRatingsData, exitPositions } = useHitterSeedData();

  const {
    storageByName, storageByNameTeam, storageByPlayerId,
    powerByName, powerByNameTeam, powerByPlayerId,
  } = useSeedDataMaps(hitterStats, powerRatingsData);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, any>>({});
  const [editingPrediction, setEditingPrediction] = useState(false);
  const [predForm, setPredForm] = useState<{ dev_aggressiveness: string }>({ dev_aggressiveness: "0.5" });
  // Session-only dev_aggressiveness overlay. Profile dropdown is preview-only —
  // changes never persist. Coach saves via Team Builder target board.
  // Default value initialized from stored row in a useEffect below once
  // predictions load (can't read it here because the query hasn't fired yet).
  const [sessionDevAgg, setSessionDevAgg] = useState<string>("0");
  // Session-only depth role overlay. Default = everyday_starter; no DB writes,
  // resets on navigation. Scales the displayed oWAR + market_value.
  const [depthRole, setDepthRole] = useState<HitterDepthRole>("everyday_starter");

  const { data: player, isLoading } = useQuery({
    queryKey: ["player-profile", id],
    queryFn: async () => {
      // Try players table first
      const { data, error } = await supabase
        .from("players")
        .select("*")
        .eq("id", id!)
        .maybeSingle();
      if (data) return data;
      // Fallback: look up in Hitter Master by source_player_id
      const { data: hmRow } = await supabase
        .from("Hitter Master")
        .select("*")
        .eq("source_player_id", id!)
        .limit(1)
        .maybeSingle();
      if (hmRow) {
        const parts = (hmRow.playerFullName || "").trim().split(/\s+/);
        return {
          id: hmRow.source_player_id || hmRow.id,
          first_name: parts[0] || "",
          last_name: parts.slice(1).join(" ") || "",
          team: hmRow.Team,
          from_team: hmRow.Team,
          conference: hmRow.Conference,
          position: hmRow.Pos,
          bats_hand: hmRow.BatHand,
          throws_hand: hmRow.ThrowHand,
          class_year: null,
          transfer_portal: false,
          source_player_id: hmRow.source_player_id,
          source_team_id: hmRow.TeamID,
          division: hmRow.division ?? null,
          age: null, height_inches: null, weight: null, high_school: null, home_state: null,
          headshot_url: null, notes: null, portal_entry_date: null, handedness: null, team_id: hmRow.TeamID,
          created_at: "", updated_at: "",
        } as any;
      }
      if (error) throw error;
      return null;
    },
    enabled: !!id,
  });

  const { data: aiScoutingReport } = useScoutingReport(player?.id, "hitter");

  const { data: predictions = [], isLoading: isPredictionsLoading } = useQuery({
    queryKey: ["player-predictions", id, effectiveTeamId],
    queryFn: async () => {
      // Load global rows (customer_team_id IS NULL) plus team-scoped rows
      // for the active customer team if any. The team-scoped row is preferred
      // downstream via regularPred selection so a coach sees "their numbers".
      // Season pinned to PROJECTION_SEASON so historical projection rows
      // (preserved as research material) don't leak into display.
      let query = supabase
        .from("player_predictions")
        .select("*")
        .eq("player_id", id!)
        .eq("season", PROJECTION_SEASON)
        .eq("status", "active");
      query = effectiveTeamId
        ? query.or(`customer_team_id.is.null,customer_team_id.eq.${effectiveTeamId}`)
        : query.is("customer_team_id", null);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!id,
  });

  const { data: seasonStats = [] } = useQuery({
    queryKey: ["player-season-stats", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("season_stats")
        .select("*")
        .eq("player_id", id!)
        .order("season", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!id,
  });

  // Fetch all Hitter Master rows across seasons (linked by source_player_id).
  // Falls back to the URL `id` if it's a numeric source_player_id (historical-only
  // players with no row in the `players` table).
  const { data: hitterMasterSeasons = [] } = useQuery({
    queryKey: ["player-hitter-master-seasons", id, (player as any)?.source_player_id],
    queryFn: async () => {
      const sourceId = (player as any)?.source_player_id || (id && /^\d+$/.test(id) ? id : null);
      if (!sourceId) return [];
      const { data, error } = await supabase
        .from("Hitter Master")
        .select("*")
        .eq("source_player_id", sourceId)
        .order("Season", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!id,
  });

  // Detect two-way: does this player have any meaningful pitching innings?
  const { data: hasPitchingData = false } = useQuery({
    queryKey: ["player-has-pitching", id, (player as any)?.source_player_id],
    queryFn: async () => {
      const sourceId = (player as any)?.source_player_id || (id && /^\d+$/.test(id) ? id : null);
      if (!sourceId) return false;
      const { data } = await supabase
        .from("Pitching Master")
        .select("IP")
        .eq("source_player_id", sourceId)
        .gte("IP", 1)
        .limit(1);
      return (data?.length || 0) > 0;
    },
    enabled: !!id,
  });

  const availableSeasons = useMemo(() => {
    const set = new Set<number>();
    for (const r of hitterMasterSeasons) if (r.Season != null) set.add(Number(r.Season));
    for (const s of seasonStats) if ((s as any).season != null) set.add(Number((s as any).season));
    return [...set].sort((a, b) => b - a);
  }, [hitterMasterSeasons, seasonStats]);

  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  // Default to 2026 if it's available, else the most recent season
  const defaultSeason = availableSeasons.includes(2026) ? 2026 : (availableSeasons[0] ?? 2026);
  const effectiveSeason = selectedSeason ?? defaultSeason;

  // Pick the 2026 Hitter Master row to check if combined stats were used
  // (badge only shows on the current season view, not historical)
  const currentHitterRow = useMemo(() => {
    return hitterMasterSeasons.find((r: any) => Number(r.Season) === 2026) || null;
  }, [hitterMasterSeasons]);
  const combinedUsed = !!(currentHitterRow as any)?.combined_used;
  const combinedPa = (currentHitterRow as any)?.combined_pa as number | null | undefined;
  const combinedSeasonsLabel = (currentHitterRow as any)?.combined_seasons as string | null | undefined;

  // Fetch NCAA wRC mean for the historical season (for wRC+ calculation)
  const { data: ncaaWrcForSeason } = useQuery({
    queryKey: ["ncaa-wrc-mean-profile", effectiveSeason],
    enabled: effectiveSeason !== 2026,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ncaa_averages" as any)
        .select("wrc")
        .eq("season", effectiveSeason)
        .maybeSingle();
      if (error) return null;
      return (data as any)?.wrc ?? null;
    },
  });

  const { teams: teamsForConference } = useTeamsTable();
  // Lookup maps for career stats Team column display.
  // Prefer TeamID (holds Teams Table UUID id); fall back to aggressive name normalization.
  const teamAbbrevById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of teamsForConference as Array<{ id: string | null; source_team_id: string | number | null; abbreviation: string | null; fullName: string | null; name: string | null }>) {
      const abbrev = t.abbreviation || t.name || t.fullName;
      if (!abbrev) continue;
      if (t.id) map.set(String(t.id), abbrev);
      if (t.source_team_id != null) map.set(String(t.source_team_id), abbrev);
    }
    return map;
  }, [teamsForConference]);
  const teamAbbrevByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of teamsForConference as Array<{ name: string | null; fullName: string | null; abbreviation: string | null }>) {
      const abbrev = t.abbreviation || t.name || t.fullName;
      if (!abbrev) continue;
      const keys = [t.fullName, t.name, t.abbreviation].filter(Boolean) as string[];
      for (const k of keys) {
        const norm = normalizeName(k);
        if (norm && !map.has(norm)) map.set(norm, abbrev);
      }
    }
    return map;
  }, [teamsForConference]);
  const teamAbbrev = (name: string | null | undefined, teamId?: string | number | null): string => {
    if (teamId != null) {
      const byId = teamAbbrevById.get(String(teamId));
      if (byId) return byId;
    }
    if (!name) return "—";
    const hit = teamAbbrevByName.get(normalizeName(name));
    return hit || name;
  };

  const { data: nilValuation } = useNilValuation(id);

  // Admin-only: fetch internal power ratings
  const { data: internalRatings } = useQuery({
    queryKey: ["player-internal-ratings", id],
    queryFn: async () => {
      const predIds = predictions.map((p) => p.id);
      if (predIds.length === 0) return null;
      const { data, error } = await supabase
        .from("player_prediction_internals" as any)
        .select("*")
        .in("prediction_id", predIds)
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return data as unknown as { avg_power_rating: number | null; obp_power_rating: number | null; slg_power_rating: number | null } | null;
    },
    enabled: !!id && isAdmin && predictions.length > 0,
  });

  const updatePortalStatus = useMutation({
    mutationFn: async (fields: { portal_status: string; portal_entry_date: string | null; commit_school: string | null; commit_date: string | null }) => {
      const { error } = await supabase
        .from("players")
        .update({
          portal_status: fields.portal_status,
          transfer_portal: fields.portal_status === "IN PORTAL",
          portal_entry_date: fields.portal_entry_date,
          commit_school: fields.commit_school,
          commit_date: fields.commit_date,
          portal_manual_override: true,
        } as any)
        .eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["player-profile", id] });
      queryClient.invalidateQueries({ queryKey: ["target-board"] });
      toast.success("Portal status updated");
    },
    onError: (e: any) => toast.error(`Portal status update failed: ${e.message}`),
  });

  const updatePlayer = useMutation({
    mutationFn: async (updates: Record<string, any>) => {
      const { error } = await supabase
        .from("players")
        .update(updates)
        .eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["player-profile", id] });
      queryClient.invalidateQueries({ queryKey: ["returning-players"] });
      queryClient.invalidateQueries({ queryKey: ["returning-players-2025-unified"] });
      toast.success("Player updated");
      setEditing(false);
    },
    onError: (e) => toast.error(`Update failed: ${e.message}`),
  });

  const updatePrediction = useMutation({
    mutationFn: async ({ predictionIds, updates }: { predictionIds: string[]; updates: Record<string, any> }) => {
      for (const predId of predictionIds) {
        // Unlock first (trigger blocks changes when locked=true)
        await supabase.from("player_predictions").update({ locked: false }).eq("id", predId);
        const { error } = await supabase
          .from("player_predictions")
          .update(updates)
          .eq("id", predId);
        if (error) throw error;
        await recalculatePredictionById(predId, {
          dev_aggressiveness: updates.dev_aggressiveness,
        });
        // Re-lock
        await supabase.from("player_predictions").update({ locked: true }).eq("id", predId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["player-predictions", id] });
      queryClient.invalidateQueries({ queryKey: ["returning-players"] });
      queryClient.invalidateQueries({ queryKey: ["returning-players-2025-unified"] });
      toast.success("Prediction updated & recalculated");
      setEditingPrediction(false);
    },
    onError: (e) => toast.error(`Update failed: ${e.message}`),
  });

  const startEdit = () => {
    if (!player) return;
    setEditForm({
      first_name: player.first_name,
      last_name: player.last_name,
      team: player.team || "",
      position: player.position || "",
      conference: player.conference || "",
      class_year: player.class_year || "",
      handedness: player.handedness || "",
      bats_hand: (player as any).bats_hand || "",
      throws_hand: (player as any).throws_hand || "",
      age: (player as any).age || "",
      height_inches: player.height_inches || "",
      weight: player.weight || "",
      home_state: player.home_state || "",
      high_school: player.high_school || "",
      notes: player.notes || "",
    });
    setEditing(true);
  };

  const saveEdit = () => {
    const updates: Record<string, any> = {};
    for (const [key, val] of Object.entries(editForm)) {
      if (val === "") {
        updates[key] = null;
      } else if (key === "height_inches" || key === "weight" || key === "age") {
        updates[key] = val ? Number(val) : null;
      } else {
        updates[key] = val;
      }
    }
    updatePlayer.mutate(updates);
  };

  // Prefer the team-scoped precomputed row when the current customer team has
  // one. Falls back to the canonical global "regular" row otherwise.
  const regularPred = (() => {
    if (effectiveTeamId) {
      const teamRow = predictions.find(
        (p: any) => p.customer_team_id === effectiveTeamId && p.variant === "precomputed",
      );
      if (teamRow) return teamRow;
    }
    return predictions.find((p: any) => p.variant === "regular" && p.customer_team_id == null);
  })();
  const { isTransferPortal, isReturner, fromTeamData } = useTransferPortalContext(
    player, predictions, effectiveTeamId,
  );
  // Sync session dev_agg dropdown to the stored row's value whenever the
  // prediction changes (player nav, impersonation switch, etc.). Default to
  // 0 when no stored value exists.
  useEffect(() => {
    const stored = regularPred?.dev_aggressiveness;
    setSessionDevAgg(Number.isFinite(Number(stored)) ? String(Number(stored)) : "0");
  }, [regularPred?.id, regularPred?.dev_aggressiveness]);
  // Sync session depth role to the stored hitter_depth_role; fall back to
  // auto-assignment from raw PA when no stored value (e.g. older rows pre-
  // schema-migration, or sub-threshold players).
  useEffect(() => {
    const stored = (regularPred as any)?.hitter_depth_role as HitterDepthRole | null | undefined;
    if (stored === "cornerstone" || stored === "everyday_starter" || stored === "platoon_starter" || stored === "utility" || stored === "bench") {
      setDepthRole(stored);
    } else {
      setDepthRole(defaultHitterDepthRoleFromActualPa((player as any)?.pa ?? null));
    }
  }, [regularPred?.id, (regularPred as any)?.hitter_depth_role, (player as any)?.pa]);
  const { getOverride } = usePlayerOverrides();
  const playerOverride = id ? getOverride(id) : null;
  const effectivePosition = playerOverride?.position ?? player?.position ?? null;

  const startPredEdit = () => {
    setPredForm({
      dev_aggressiveness: regularPred?.dev_aggressiveness?.toString() ?? "0.5",
    });
    setEditingPrediction(true);
  };

  const savePredEdit = () => {
    const returnerPreds = predictions.filter((p) => p.model_type === "returner");
    if (returnerPreds.length === 0) return;
    const updates: Record<string, any> = {
      dev_aggressiveness: predForm.dev_aggressiveness !== "" ? Number(predForm.dev_aggressiveness) : null,
    };
    updatePrediction.mutate({ predictionIds: returnerPreds.map((p) => p.id), updates });
  };

  // Pinned 2026 row — anchors projections, risk, and scouting report so they
  // don't shift when the scouting grades dropdown changes season. Substitutes
  // blended_* columns when combined_used (under-qualified 2026 sample).
  // MUST be declared before early returns to keep hook order stable.
  const projectionSourceRow = useMemo(() => {
    const row = (hitterMasterSeasons as any[]).find((r) => Number(r.Season) === 2026);
    if (!row) return null;
    const combinedUsed = !!row.combined_used;
    return {
      combined_used: combinedUsed,
      combined_pa: row.combined_pa ?? null,
      combined_seasons: row.combined_seasons ?? null,
      AVG: combinedUsed ? (row.blended_avg ?? row.AVG) : row.AVG,
      OBP: combinedUsed ? (row.blended_obp ?? row.OBP) : row.OBP,
      SLG: combinedUsed ? (row.blended_slg ?? row.SLG) : row.SLG,
      ISO: combinedUsed ? (row.blended_iso ?? row.ISO) : row.ISO,
      contact: combinedUsed ? (row.blended_contact ?? row.contact) : row.contact,
      line_drive: combinedUsed ? (row.blended_line_drive ?? row.line_drive) : row.line_drive,
      avg_exit_velo: combinedUsed ? (row.blended_avg_exit_velo ?? row.avg_exit_velo) : row.avg_exit_velo,
      pop_up: combinedUsed ? (row.blended_pop_up ?? row.pop_up) : row.pop_up,
      bb: combinedUsed ? (row.blended_bb ?? row.bb) : row.bb,
      chase: combinedUsed ? (row.blended_chase ?? row.chase) : row.chase,
      barrel: combinedUsed ? (row.blended_barrel ?? row.barrel) : row.barrel,
      ev90: combinedUsed ? (row.blended_ev90 ?? row.ev90) : row.ev90,
      pull: combinedUsed ? (row.blended_pull ?? row.pull) : row.pull,
      la_10_30: combinedUsed ? (row.blended_la_10_30 ?? row.la_10_30) : row.la_10_30,
      gb: combinedUsed ? (row.blended_gb ?? row.gb) : row.gb,
      ab: row.ab ?? null,
      pa: row.pa ?? null,
      // Stored power ratings — already computed from blended inputs by the pipeline
      overall_power_rating: row.overall_power_rating ?? null,
      ba_power_rating: row.ba_power_rating ?? null,
      obp_power_rating: row.obp_power_rating ?? null,
      iso_power_rating: row.iso_power_rating ?? null,
      barrel_score: row.barrel_score ?? null,
      avg_ev_score: row.avg_ev_score ?? null,
      contact_score: row.contact_score ?? null,
      chase_score: row.chase_score ?? null,
      bb_score: row.bb_score ?? null,
      line_drive_score: row.line_drive_score ?? null,
      pop_up_score: row.pop_up_score ?? null,
      ev90_score: row.ev90_score ?? null,
      pull_score: row.pull_score ?? null,
      la_score: row.la_score ?? null,
      gb_score: row.gb_score ?? null,
    };
  }, [hitterMasterSeasons]);

  const isThinSample = isThinSampleHitter(projectionSourceRow);

  // Early bail when player is undefined. Two cases:
  //   1. Still loading the player query → render page shell + skeleton.
  //      Avoids running the rest of the component body (76+ player.* accesses
  //      below would crash on undefined).
  //   2. Query resolved with no player → render "Player not found".
  if (!player) {
    if (isLoading) {
      return (
        <DashboardLayout>
          <div className="px-4 py-6 max-w-7xl mx-auto">
            <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4 cursor-pointer">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back
            </Button>
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="h-7 w-48 rounded bg-muted" />
                <div className="flex gap-2">
                  <div className="h-5 w-16 rounded bg-muted" />
                  <div className="h-5 w-24 rounded bg-muted" />
                  <div className="h-5 w-32 rounded bg-muted" />
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[0, 1, 2, 3].map((i) => (
                  <Card key={i} className="p-4">
                    <div className="h-4 w-24 rounded bg-muted mb-2" />
                    <div className="h-7 w-16 rounded bg-muted" />
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </DashboardLayout>
      );
    }
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <p className="text-muted-foreground">Player not found</p>
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="mr-2 h-4 w-4" />Go Back
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const formatHeight = (inches: number | null) => {
    if (!inches) return "—";
    return `${Math.floor(inches / 12)}'${inches % 12}"`;
  };
  const fullName = normalizeName(`${player?.first_name ?? ""} ${player?.last_name ?? ""}`);
  const fullNameRaw = `${player?.first_name ?? ""} ${player?.last_name ?? ""}`;
  const statCandidates = storageByName.get(fullName) || [];
  const round3 = (v: number | null | undefined) => (v == null ? null : Math.round(v * 1000) / 1000);
  const resolvedSeedStatRow = (() => {
    // Fast path: source_player_id match (instant, unambiguous)
    const sourceId = player?.source_player_id;
    const bySourceId = sourceId ? storageByPlayerId.get(sourceId) : undefined;
    if (bySourceId) return bySourceId;
    const byFromTeam = storageByNameTeam.get(nameTeamKey(fullNameRaw, player.from_team));
    if (byFromTeam) return byFromTeam;
    const byPlayerTeam = storageByNameTeam.get(nameTeamKey(fullNameRaw, player.team));
    if (byPlayerTeam) return byPlayerTeam;
    if (statCandidates.length === 0) return null;
    if (statCandidates.length === 1) return statCandidates[0];
    const byTeam = statCandidates.find((r) => (r.team || "") === (player.from_team || "")) ||
      statCandidates.find((r) => (r.team || "") === (player.team || ""));
    if (byTeam) return byTeam;
    const byStats = statCandidates.find((r) =>
      round3(r.avg) === round3(regularPred?.from_avg) &&
      round3(r.obp) === round3(regularPred?.from_obp) &&
      round3(r.slg) === round3(regularPred?.from_slg),
    );
    if (byStats) return byStats;
    // Ambiguous name with no reliable discriminator: do not guess.
    return null;
  })();
  const seedStatRow = resolvedSeedStatRow;
  const powerCandidates = powerByName.get(fullName) || [];
  const seedPowerRow = (() => {
    // Fast path: source_player_id match (instant, unambiguous)
    const sourceId = player?.source_player_id;
    const bySourceId = sourceId ? powerByPlayerId.get(sourceId) : undefined;
    if (bySourceId) return bySourceId;
    const bySeedTeam = powerByNameTeam.get(nameTeamKey(fullNameRaw, seedStatRow?.team));
    if (bySeedTeam) return bySeedTeam;
    const byFromTeam = powerByNameTeam.get(nameTeamKey(fullNameRaw, player.from_team));
    if (byFromTeam) return byFromTeam;
    const byPlayerTeam = powerByNameTeam.get(nameTeamKey(fullNameRaw, player.team));
    if (byPlayerTeam) return byPlayerTeam;
    if (powerCandidates.length === 1) return powerCandidates[0];
    if (powerCandidates.length > 1) {
      const bySeedTeamLoose = powerCandidates.find((r) => (r.team || "") === (seedStatRow?.team || ""));
      if (bySeedTeamLoose) return bySeedTeamLoose;
      const byPlayerTeamLoose = powerCandidates.find((r) => (r.team || "") === (player.from_team || "")) ||
        powerCandidates.find((r) => (r.team || "") === (player.team || ""));
      if (byPlayerTeamLoose) return byPlayerTeamLoose;
    }
    const variantCandidates = getNameVariants(fullNameRaw).flatMap((v) => powerByName.get(v) || []);
    if (variantCandidates.length > 0) {
      const byVariantSeedTeam = variantCandidates.find((r) => (r.team || "") === (seedStatRow?.team || ""));
      if (byVariantSeedTeam) return byVariantSeedTeam;
      const byVariantPlayerTeam = variantCandidates.find((r) => (r.team || "") === (player.from_team || "")) ||
        variantCandidates.find((r) => (r.team || "") === (player.team || ""));
      if (byVariantPlayerTeam) return byVariantPlayerTeam;
      if (variantCandidates.length === 1) return variantCandidates[0];
    }
    // Ambiguous name with no reliable discriminator: do not guess.
    return null;
  })();
  const displayTeamCurrent = seedStatRow?.team || player.from_team || player.team || null;
  const abbrevName = `${player.first_name?.[0] || ""}. ${player.last_name || ""}`.trim();
  const seedPos =
    exitPositions[`${player.first_name} ${player.last_name}|${player.team || ""}`] ||
    exitPositions[`${player.first_name} ${player.last_name}`] ||
    exitPositions[abbrevName] ||
    null;
  const seedDerived = seedStatRow ? computeDerived(seedStatRow.avg, seedStatRow.obp, seedStatRow.slg) : null;
  const seedPowerDerived = seedPowerRow ? computePowerRatings({
    contact: seedPowerRow.contact,
    lineDrive: seedPowerRow.lineDrive,
    avgExitVelo: seedPowerRow.avgExitVelo,
    popUp: seedPowerRow.popUp,
    bb: seedPowerRow.bb,
    chase: seedPowerRow.chase,
    barrel: seedPowerRow.barrel,
    ev90: seedPowerRow.ev90,
    pull: seedPowerRow.pull,
    la10_30: seedPowerRow.la10_30,
    gb: seedPowerRow.gb,
  }) : null;

  // Season-aware scouting grades + power ratings from Hitter Master
  // Falls back to seedPowerDerived (2025) when no Hitter Master row exists for the selected season
  const activeSeasonRow = (hitterMasterSeasons as any[]).find((r) => Number(r.Season) === effectiveSeason) || null;

  const activeSeasonScoutingGrades = activeSeasonRow ? {
    barrelScore: activeSeasonRow.barrel_score ?? seedPowerDerived?.barrelScore ?? null,
    avgEVScore: activeSeasonRow.avg_ev_score ?? seedPowerDerived?.avgEVScore ?? null,
    contactScore: activeSeasonRow.contact_score ?? seedPowerDerived?.contactScore ?? null,
    chaseScore: activeSeasonRow.chase_score ?? seedPowerDerived?.chaseScore ?? null,
    bbScore: activeSeasonRow.bb_score ?? seedPowerDerived?.bbScore ?? null,
    lineDriveScore: activeSeasonRow.line_drive_score ?? seedPowerDerived?.lineDriveScore ?? null,
    popUpScore: activeSeasonRow.pop_up_score ?? seedPowerDerived?.popUpScore ?? null,
    ev90Score: activeSeasonRow.ev90_score ?? seedPowerDerived?.ev90Score ?? null,
    pullScore: activeSeasonRow.pull_score ?? seedPowerDerived?.pullScore ?? null,
    laScore: activeSeasonRow.la_score ?? seedPowerDerived?.laScore ?? null,
    gbScore: activeSeasonRow.gb_score ?? seedPowerDerived?.gbScore ?? null,
    baPlus: activeSeasonRow.ba_power_rating ?? seedPowerDerived?.baPlus ?? null,
    obpPlus: activeSeasonRow.obp_power_rating ?? seedPowerDerived?.obpPlus ?? null,
    isoPlus: activeSeasonRow.iso_power_rating ?? seedPowerDerived?.isoPlus ?? null,
    overallPlus: activeSeasonRow.overall_power_rating ?? seedPowerDerived?.overallPlus ?? null,
  } : seedPowerDerived;
  // Carry 2025 PA forward as expected 2026 PA so projected WAR scales with
  // actual playing-time history. A fringe starter with 100 PA last year
  // projects to ~100 PA of WAR, not a full-time 260. Prevents misleading
  // 2 WAR / 90K valuations for limited-role returners.
  const carryForwardPa = projectionSourceRow?.pa ?? (player as any)?.pa ?? null;
  const resolvedConference = (() => {
    if (player.conference) return player.conference;
    const norm = (v: string) => (v || "").trim().toLowerCase().replace(/\b(university|college|of)\b/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
    return teamsForConference.find(t => norm(t.name) === norm(player.team || ""))?.conference || null;
  })();
  // Session dev_agg overlay scale (preview only, no DB writes). Mirrors
  // transferMultiplier shape: 1 + classAdj + devAgg * 0.06. Scale = ratio of
  // session multiplier to stored multiplier so projections re-derive on the
  // fly when the coach previews a different dev_agg setting.
  const devAggClassAdj = (() => {
    const ct = String(regularPred?.class_transition || "SJ").toUpperCase();
    if (ct === "FS") return 0.03;
    if (ct === "SJ") return 0.02;
    if (ct === "JS") return 0.015;
    if (ct === "GR") return 0.01;
    return 0.02;
  })();
  const storedDevAgg = Number.isFinite(Number(regularPred?.dev_aggressiveness)) ? Number(regularPred?.dev_aggressiveness) : 0;
  const sessionDevAggNum = Number(sessionDevAgg);
  const _storedMult = 1 + devAggClassAdj + (storedDevAgg * 0.06);
  const _sessionMult = 1 + devAggClassAdj + (sessionDevAggNum * 0.06);
  const devAggScale = _storedMult > 0 ? _sessionMult / _storedMult : 1;
  const applyDevScale = (v: number | null | undefined) =>
    v == null || !Number.isFinite(Number(v)) ? null : Number(v) * devAggScale;

  // Read stored values first — these reflect the active customer-team scoping
  // Stored values are the source of truth — D1 backfills populate o_war +
  // market_value on every row with p_wrc_plus. Null means data quality issue,
  // not a display fallback to paper over.
  const storedOWar = (regularPred as any)?.o_war as number | null | undefined;
  const storedMarketValue = (regularPred as any)?.market_value as number | null | undefined;
  const storedHitterDepthRole = ((regularPred as any)?.hitter_depth_role as HitterDepthRole | null | undefined) ?? defaultHitterDepthRoleFromActualPa((player as any)?.pa ?? null);
  const historicalOWar = computeOWarFromWrcPlus(seedDerived?.wrcPlus ?? null, (player as any)?.pa ?? null);
  // Session-only depth role overlay scales the projected/displayed oWAR
  // (and downstream market value) without touching the stored row. Math is
  // PA-tier ratio: session_PA / stored_PA. oWAR + market_value are linear in
  // PA so this gives the exact answer (not an approximation).
  const sessionPa = paForHitterDepthRole(depthRole);
  const storedPa = paForHitterDepthRole(storedHitterDepthRole);
  const depthScale = storedPa > 0 ? sessionPa / storedPa : 1;
  const overlayScale = depthScale * (devAggScale ?? 1);
  const projectedOWar = storedOWar != null ? storedOWar * overlayScale : null;
  const displayOWar = projectedOWar ?? (historicalOWar != null ? historicalOWar * overlayScale : null);
  const displayNilValuation = storedMarketValue != null ? storedMarketValue * overlayScale : null;
  const predFromAvg = seedStatRow?.avg ?? regularPred?.from_avg ?? null;
  const predFromObp = seedStatRow?.obp ?? regularPred?.from_obp ?? null;
  const predFromSlg = seedStatRow?.slg ?? regularPred?.from_slg ?? null;
  const projectedAvg = applyDevScale(regularPred?.p_avg);
  const projectedObp = applyDevScale(regularPred?.p_obp);
  const projectedSlg = applyDevScale(regularPred?.p_slg);
  const fromDerived = computeDerived(predFromAvg, predFromObp, predFromSlg);
  const projectedDerived = computeDerived(projectedAvg, projectedObp, projectedSlg);
  const projectedWrcPlus = applyDevScale(regularPred?.p_wrc_plus);

  // Always use 2025 row for determining if player has data — don't bail on historical year with no AB
  const activeMasterRow = currentHitterRow;
  const activeAb = (activeMasterRow as any)?.ab;
  const hasZeroAb = activeMasterRow != null && (activeAb == null || Number(activeAb) === 0);
  if (hasZeroAb) {
    return (
      <DashboardLayout>
        <div className="space-y-4 max-w-[1400px] mx-auto">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => returnTo ? navigate(returnTo) : navigate(-1)}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex-1">
              <h2 className="text-2xl font-bold tracking-tight">
                {player.first_name} {player.last_name}
              </h2>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {effectivePosition && <Badge variant="secondary">{effectivePosition}</Badge>}
                {(player as any).is_twp && (
                  <Badge
                    variant="outline"
                    className="text-[10px] font-semibold uppercase tracking-wider border-[#D4AF37]/40 bg-[#D4AF37]/10 text-[#D4AF37]"
                    title="Two-way player — also appears in the pitcher pool"
                  >
                    TWP
                  </Badge>
                )}
                {(activeMasterRow as any)?.Team && <Badge variant="outline">{(activeMasterRow as any).Team}</Badge>}
              </div>
            </div>
          </div>
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No hitting stats available.
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-4 max-w-[1400px] mx-auto">
        {/* Back + Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => returnTo ? navigate(returnTo) : navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            {isLoading ? (
              <div className="space-y-2">
                <div className="h-7 w-48 rounded bg-muted animate-pulse" />
                <div className="flex gap-2">
                  <div className="h-5 w-16 rounded bg-muted animate-pulse" />
                  <div className="h-5 w-24 rounded bg-muted animate-pulse" />
                </div>
              </div>
            ) : (
            <>
              <h2 className="text-2xl font-bold tracking-tight">
                {player!.first_name} {player!.last_name}
              </h2>
              {hasPitchingData && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-1"
                  onClick={() => navigate(`/dashboard/pitcher/${id}`)}
                >
                  View Pitching Profile →
                </Button>
              )}
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {effectivePosition && <Badge variant="secondary">{effectivePosition}</Badge>}
                {(player as any).is_twp && (
                  <Badge
                    variant="outline"
                    className="text-[10px] font-semibold uppercase tracking-wider border-[#D4AF37]/40 bg-[#D4AF37]/10 text-[#D4AF37]"
                    title="Two-way player — also appears in the pitcher pool"
                  >
                    TWP
                  </Badge>
                )}
                {displayTeamCurrent && <Badge variant="outline">{displayTeamCurrent}</Badge>}
                {(() => {
                  const norm = (v: string) => (v || "").trim().toLowerCase().replace(/\b(university|college|of)\b/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
                  const teamConf = teamsForConference.find(t => norm(t.name) === norm(player!.team || ""))?.conference;
                  const conf = player!.conference || teamConf || null;
                  return conf ? <Badge variant="outline" className="text-muted-foreground">{conf}</Badge> : null;
                })()}
                <PortalStatusBadge
                  player={player as any}
                  isAdmin={isAdmin}
                  onSave={(fields) => updatePortalStatus.mutateAsync(fields)}
                />
                <PortalContactButton player={player as any} />
                {combinedUsed && (
                  <Badge
                    variant="outline"
                    className="text-[10px] font-semibold uppercase tracking-wider"
                    title={`Projection blends ${combinedSeasonsLabel} (${combinedPa} PA total)`}
                  >
                    Combined: {combinedSeasonsLabel} ({combinedPa} PA)
                  </Badge>
                )}
              </div>
            </>
            )}
          </div>
          {!isLoading &&
            <>
              <CoachNotes
                playerId={player!.id}
                playerName={`${player.first_name} ${player.last_name}`}
                onExportPdf={async (notes, format, mode = "download") => {
                  if (format === "full") {
                    // Build same rich rp as Export Report button, plus coach notes
                    const rp: ReportPlayer = {
                      id: player.id,
                      player_type: "hitter",
                      ai_scouting_report: aiScoutingReport?.body ?? null,
                      name: `${player.first_name || ""} ${player.last_name || ""}`.trim(),
                      school: displayTeamCurrent || player.team,
                      position: effectivePosition,
                      class_year: player.class_year,
                      bats_throws: [(player as any).bats_hand, (player as any).throws_hand].filter(Boolean).join("/") || undefined,
                      conference: resolvedConference || player.conference,
                      height: player.height_inches ? `${Math.floor(player.height_inches / 12)}'${player.height_inches % 12}"` : undefined,
                      weight: player.weight,
                      hometown: [player.home_state, player.high_school].filter(Boolean).join(", ") || undefined,
                      p_avg: projectedAvg, p_obp: projectedObp, p_slg: projectedSlg,
                      p_ops: projectedDerived.ops, p_iso: projectedDerived.iso,
                      p_wrc_plus: projectedWrcPlus,
                      owar: displayOWar,
                      nil_value: displayNilValuation,
                      power_rating_plus: (projectionSourceRow as any)?.overall_power_rating ?? seedPowerDerived?.overallPlus,
                      // Prefer stored Hitter Master scores (match UI scouting grades);
                      // fall back to derived only if the stored value is null.
                      barrel_score: (projectionSourceRow as any)?.barrel_score ?? (seedPowerDerived?.barrelScore != null ? Math.round(seedPowerDerived.barrelScore) : undefined),
                      ev_score: (projectionSourceRow as any)?.avg_ev_score ?? (seedPowerDerived?.avgEVScore != null ? Math.round(seedPowerDerived.avgEVScore) : undefined),
                      contact_score: (projectionSourceRow as any)?.contact_score ?? (seedPowerDerived?.contactScore != null ? Math.round(seedPowerDerived.contactScore) : undefined),
                      chase_score: (projectionSourceRow as any)?.chase_score ?? (seedPowerDerived?.chaseScore != null ? Math.round(seedPowerDerived.chaseScore) : undefined),
                      // Raw rates for the IQ Hitting Metrics 3-column grid
                      contact_pct: projectionSourceRow?.contact ?? seedPowerRow?.contact ?? undefined,
                      bb_pct: projectionSourceRow?.bb ?? seedPowerRow?.bb ?? undefined,
                      chase_pct: projectionSourceRow?.chase ?? seedPowerRow?.chase ?? undefined,
                      avg_ev: projectionSourceRow?.avg_exit_velo ?? seedPowerRow?.avgExitVelo ?? undefined,
                      barrel_pct: projectionSourceRow?.barrel ?? seedPowerRow?.barrel ?? undefined,
                      ev90: projectionSourceRow?.ev90 ?? seedPowerRow?.ev90 ?? undefined,
                      ld_pct: projectionSourceRow?.line_drive ?? seedPowerRow?.lineDrive ?? undefined,
                      pull_pct: projectionSourceRow?.pull ?? seedPowerRow?.pull ?? undefined,
                      gb_pct: projectionSourceRow?.gb ?? seedPowerRow?.gb ?? undefined,
                      la_10_30_pct: projectionSourceRow?.la_10_30 ?? seedPowerRow?.la10_30 ?? undefined,
                      ev90_score: (projectionSourceRow as any)?.ev90_score ?? undefined,
                      ld_score: (projectionSourceRow as any)?.line_drive_score ?? undefined,
                      pull_score: (projectionSourceRow as any)?.pull_score ?? undefined,
                      gb_score: (projectionSourceRow as any)?.gb_score ?? undefined,
                      la_score: (projectionSourceRow as any)?.la_score ?? undefined,
                      bb_pct_score: (projectionSourceRow as any)?.bb_score ?? undefined,
                      career_seasons: hitterMasterSeasons as any[],
                      scouting_notes: (() => {
                        if ((player as any).notes) return (player as any).notes;
                        const p = projectionSourceRow;
                        if (!p && !seedPowerRow) return undefined;
                        return generateHitterReport({
                          batHand: (player as any).bats_hand,
                          position: effectivePosition,
                          conference: resolvedConference || player.conference,
                          avg: p?.AVG ?? seedStatRow?.avg, obp: p?.OBP ?? seedStatRow?.obp, slg: p?.SLG ?? seedStatRow?.slg,
                          iso: p?.ISO ?? seedDerived?.iso,
                          pa: p?.pa ?? (player as any).pa ?? seedPowerRow?.pa ?? null,
                          contact: p?.contact ?? seedPowerRow?.contact,
                          chase: p?.chase ?? seedPowerRow?.chase,
                          bb: p?.bb ?? seedPowerRow?.bb,
                          avgEv: p?.avg_exit_velo ?? seedPowerRow?.avgExitVelo,
                          ev90: p?.ev90 ?? seedPowerRow?.ev90,
                          barrel: p?.barrel ?? seedPowerRow?.barrel,
                          laSweet: p?.la_10_30 ?? seedPowerRow?.la10_30,
                          lineDrive: p?.line_drive ?? seedPowerRow?.lineDrive,
                          gb: p?.gb ?? seedPowerRow?.gb,
                          pull: p?.pull ?? seedPowerRow?.pull,
                          popUp: p?.pop_up ?? seedPowerRow?.popUp,
                        }, "rstriq", "full");
                      })(),
                      coach_notes: notes,
                    };
                    const p2 = projectionSourceRow;
                    const riskResult = assessHitterRisk({
                      conference: resolvedConference || player.conference,
                      projectedWrcPlus: projectedWrcPlus,
                      careerSeasons: hitterMasterSeasons as any[],
                      pa: p2?.pa ?? (player as any).pa ?? seedPowerRow?.pa ?? null,
                      chase: p2?.chase ?? seedPowerRow?.chase,
                      contact: p2?.contact ?? seedPowerRow?.contact,
                      whiff: seedPowerRow?.whiff,
                      barrel: p2?.barrel ?? seedPowerRow?.barrel,
                      lineDrive: p2?.line_drive ?? seedPowerRow?.lineDrive,
                      avgEv: p2?.avg_exit_velo ?? seedPowerRow?.avgExitVelo,
                      ev90: p2?.ev90 ?? seedPowerRow?.ev90,
                      gb: p2?.gb ?? seedPowerRow?.gb,
                      bb: p2?.bb ?? seedPowerRow?.bb,
                    });
                    rp.risk_grade = riskResult.grade;
                    rp.risk_score = riskResult.overall;
                    rp.risk_trajectory = riskResult.trajectory;
                    rp.risk_summary = riskResult.summary;
                    rp.risk_factors = riskResult.factors.map((f) => ({ label: f.label, score: f.score, detail: f.detail }));
                    const { generateReportPdf } = await getPdfGenerator();
                    const url = generateReportPdf([rp]);
                    trackEvent("pdf_exported", { type: "scouting_report", player: fullNameRaw, mode });
                    if (mode === "preview") {
                      window.open(url, "_blank");
                    } else {
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = `${(player.first_name || "").replace(/\s+/g, "")}_${(player.last_name || "").replace(/\s+/g, "")}_Scouting_Report.pdf`;
                      link.click();
                    }
                  } else {
                    // Coach notes only — minimal rp for the focused notes PDF
                    const rp: ReportPlayer = {
                      id: player.id,
                      player_type: "hitter",
                      name: `${player.first_name || ""} ${player.last_name || ""}`.trim(),
                      school: displayTeamCurrent || player.team,
                      position: effectivePosition,
                      class_year: player.class_year,
                      conference: resolvedConference || player.conference,
                      p_avg: projectedAvg, p_obp: projectedObp, p_slg: projectedSlg,
                      p_wrc_plus: projectedWrcPlus,
                      owar: displayOWar,
                      power_rating_plus: (projectionSourceRow as any)?.overall_power_rating ?? seedPowerDerived?.overallPlus,
                      coach_notes: notes,
                    };
                    const { generateCoachNotesPdf } = await getPdfGenerator();
                    const url = generateCoachNotesPdf(rp, notes);
                    trackEvent("pdf_exported", { type: "coach_notes", player: fullNameRaw, mode });
                    if (mode === "preview") {
                      window.open(url, "_blank");
                    } else {
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = `${(player.first_name || "").replace(/\s+/g, "")}_${(player.last_name || "").replace(/\s+/g, "")}_Coach_Notes.pdf`;
                      link.click();
                    }
                  }
                }}
              />
              <Button
                variant={isOnBoard(player.id) ? "default" : "outline"}
                size="sm"
                className="cursor-pointer"
                onClick={() => {
                  if (isOnBoard(player.id)) {
                    removeFromBoard(player.id);
                  } else {
                    addToBoard({ playerId: player.id });
                    trackEvent("player_added_to_board", { player: fullNameRaw, team: displayTeamCurrent });
                  }
                }}
              >
                <Target className="mr-2 h-3.5 w-3.5" />
                {isOnBoard(player.id) ? "On Board" : "Add to Target Board"}
              </Button>
              <Button
                variant={isOnHighFollow(player.id) ? "default" : "outline"}
                size="sm"
                className="cursor-pointer"
                onClick={() => {
                  if (isOnHighFollow(player.id)) {
                    removeFromHighFollow(player.id);
                  } else {
                    addToHighFollow({ playerId: player.id, playerType: "hitter" });
                    trackEvent("player_added_to_high_follow", { player: fullNameRaw, team: displayTeamCurrent });
                  }
                }}
              >
                <Star className="mr-2 h-3.5 w-3.5" />
                {isOnHighFollow(player.id) ? "On High Follow" : "Add to High Follow"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const rp: ReportPlayer = {
                    id: player.id,
                    player_type: "hitter",
                    ai_scouting_report: aiScoutingReport?.body ?? null,
                    name: `${player.first_name || ""} ${player.last_name || ""}`.trim(),
                    school: displayTeamCurrent || player.team,
                    position: effectivePosition,
                    class_year: player.class_year,
                    bats_throws: [(player as any).bats_hand, (player as any).throws_hand].filter(Boolean).join("/") || undefined,
                    // Bio
                    conference: resolvedConference || player.conference,
                    height: player.height_inches ? `${Math.floor(player.height_inches / 12)}'${player.height_inches % 12}"` : undefined,
                    weight: player.weight,
                    hometown: [player.home_state, player.high_school].filter(Boolean).join(", ") || undefined,
                    // Projected
                    p_avg: projectedAvg, p_obp: projectedObp, p_slg: projectedSlg,
                    p_ops: projectedDerived.ops, p_iso: projectedDerived.iso,
                    p_wrc_plus: projectedWrcPlus,
                    owar: displayOWar,
                    // Valuation
                    nil_value: displayNilValuation,
                    power_rating_plus: (projectionSourceRow as any)?.overall_power_rating ?? seedPowerDerived?.overallPlus,
                    // Scouting scores (for tables)
                    // Prefer stored Hitter Master scores (match UI scouting grades);
                    // fall back to derived only if the stored value is null.
                    barrel_score: (projectionSourceRow as any)?.barrel_score ?? (seedPowerDerived?.barrelScore != null ? Math.round(seedPowerDerived.barrelScore) : undefined),
                    ev_score: (projectionSourceRow as any)?.avg_ev_score ?? (seedPowerDerived?.avgEVScore != null ? Math.round(seedPowerDerived.avgEVScore) : undefined),
                    contact_score: (projectionSourceRow as any)?.contact_score ?? (seedPowerDerived?.contactScore != null ? Math.round(seedPowerDerived.contactScore) : undefined),
                    chase_score: (projectionSourceRow as any)?.chase_score ?? (seedPowerDerived?.chaseScore != null ? Math.round(seedPowerDerived.chaseScore) : undefined),
                    // Raw rates for the IQ Hitting Metrics 3-column grid
                    contact_pct: projectionSourceRow?.contact ?? seedPowerRow?.contact ?? undefined,
                    bb_pct: projectionSourceRow?.bb ?? seedPowerRow?.bb ?? undefined,
                    chase_pct: projectionSourceRow?.chase ?? seedPowerRow?.chase ?? undefined,
                    avg_ev: projectionSourceRow?.avg_exit_velo ?? seedPowerRow?.avgExitVelo ?? undefined,
                    barrel_pct: projectionSourceRow?.barrel ?? seedPowerRow?.barrel ?? undefined,
                    ev90: projectionSourceRow?.ev90 ?? seedPowerRow?.ev90 ?? undefined,
                    ld_pct: projectionSourceRow?.line_drive ?? seedPowerRow?.lineDrive ?? undefined,
                    pull_pct: projectionSourceRow?.pull ?? seedPowerRow?.pull ?? undefined,
                    gb_pct: projectionSourceRow?.gb ?? seedPowerRow?.gb ?? undefined,
                    la_10_30_pct: projectionSourceRow?.la_10_30 ?? seedPowerRow?.la10_30 ?? undefined,
                    ev90_score: (projectionSourceRow as any)?.ev90_score ?? undefined,
                    ld_score: (projectionSourceRow as any)?.line_drive_score ?? undefined,
                    pull_score: (projectionSourceRow as any)?.pull_score ?? undefined,
                    gb_score: (projectionSourceRow as any)?.gb_score ?? undefined,
                    la_score: (projectionSourceRow as any)?.la_score ?? undefined,
                    bb_pct_score: (projectionSourceRow as any)?.bb_score ?? undefined,
                    // Scouting grades (20-80 for PDF)
                    grade_hit: seedPowerDerived?.contactScore != null ? Math.round(seedPowerDerived.contactScore) : undefined,
                    grade_power: seedPowerDerived?.barrelScore != null ? Math.round(seedPowerDerived.barrelScore) : undefined,
                    grade_speed: undefined,
                    grade_field: undefined,
                    grade_arm: seedPowerDerived?.avgEVScore != null ? Math.round(seedPowerDerived.avgEVScore) : undefined,
                    grade_ofp: seedPowerDerived?.overallPlus != null ? Math.min(80, Math.max(20, Math.round(seedPowerDerived.overallPlus / 2.5 + 20))) : undefined,
                    career_seasons: hitterMasterSeasons as any[],
                    scouting_notes: (() => {
                      if ((player as any).notes) return (player as any).notes;
                      const p = projectionSourceRow;
                      if (!p && !seedPowerRow) return undefined;
                      return generateHitterReport({
                        batHand: (player as any).bats_hand,
                        position: effectivePosition,
                        conference: resolvedConference || player.conference,
                        avg: p?.AVG ?? seedStatRow?.avg, obp: p?.OBP ?? seedStatRow?.obp, slg: p?.SLG ?? seedStatRow?.slg,
                        iso: p?.ISO ?? seedDerived?.iso,
                        pa: p?.pa ?? (player as any).pa ?? seedPowerRow?.pa ?? null,
                        contact: p?.contact ?? seedPowerRow?.contact,
                        chase: p?.chase ?? seedPowerRow?.chase,
                        bb: p?.bb ?? seedPowerRow?.bb,
                        avgEv: p?.avg_exit_velo ?? seedPowerRow?.avgExitVelo,
                        ev90: p?.ev90 ?? seedPowerRow?.ev90,
                        barrel: p?.barrel ?? seedPowerRow?.barrel,
                        laSweet: p?.la_10_30 ?? seedPowerRow?.la10_30,
                        lineDrive: p?.line_drive ?? seedPowerRow?.lineDrive,
                        gb: p?.gb ?? seedPowerRow?.gb,
                        pull: p?.pull ?? seedPowerRow?.pull,
                        popUp: p?.pop_up ?? seedPowerRow?.popUp,
                      }, "rstriq", "full");
                    })(),
                  };
                  const p3 = projectionSourceRow;
                  const riskResult = assessHitterRisk({
                    conference: resolvedConference || player.conference,
                    projectedWrcPlus: projectedWrcPlus,
                    careerSeasons: hitterMasterSeasons as any[],
                    pa: p3?.pa ?? (player as any).pa ?? seedPowerRow?.pa ?? null,
                    chase: p3?.chase ?? seedPowerRow?.chase,
                    contact: p3?.contact ?? seedPowerRow?.contact,
                    whiff: seedPowerRow?.whiff,
                    barrel: p3?.barrel ?? seedPowerRow?.barrel,
                    lineDrive: p3?.line_drive ?? seedPowerRow?.lineDrive,
                    avgEv: p3?.avg_exit_velo ?? seedPowerRow?.avgExitVelo,
                    ev90: p3?.ev90 ?? seedPowerRow?.ev90,
                    gb: p3?.gb ?? seedPowerRow?.gb,
                    bb: p3?.bb ?? seedPowerRow?.bb,
                  });
                  rp.risk_grade = riskResult.grade;
                  rp.risk_score = riskResult.overall;
                  rp.risk_trajectory = riskResult.trajectory;
                  rp.risk_summary = riskResult.summary;
                  rp.risk_factors = riskResult.factors.map((f) => ({ label: f.label, score: f.score, detail: f.detail }));
                  rp.coach_notes = coachNotesForExport;
                  try { downloadSinglePlayerReport(rp); } catch (err: any) { toast.error(`Export failed: ${err.message}`); }
                }}
              >
                <Download className="mr-2 h-3.5 w-3.5" />
                Export Report
              </Button>
            </>
          }
        </div>

        {(isLoading || isPredictionsLoading) && (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-1 space-y-4">
              <div className="rounded-lg border border-[#162241] bg-[#0a1428] p-4 space-y-3">
                <div className="h-4 w-24 rounded bg-muted animate-pulse" />
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex justify-between">
                    <div className="h-3 w-20 rounded bg-muted animate-pulse" />
                    <div className="h-3 w-16 rounded bg-muted animate-pulse" />
                  </div>
                ))}
              </div>
            </div>
            <div className="lg:col-span-2 space-y-4">
              <div className="rounded-lg border border-[#162241] bg-[#0a1428] p-4 space-y-3">
                <div className="h-4 w-32 rounded bg-muted animate-pulse" />
                <div className="grid grid-cols-3 gap-3">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="rounded bg-muted/30 p-3 space-y-2">
                      <div className="h-3 w-12 rounded bg-muted animate-pulse" />
                      <div className="h-6 w-16 rounded bg-muted animate-pulse" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {!isLoading && !isPredictionsLoading && <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-1 space-y-4">
            {/* Player Info Card */}
            <Card className="border-[#162241] bg-[#0a1428]">
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-sm font-semibold tracking-wide uppercase text-[#D4AF37]" style={{ fontFamily: "Oswald, sans-serif" }}>Player Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-0 px-4 pb-4">
                {editing ? (
                  <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">First Name</Label>
                      <Input value={editForm.first_name} onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })} className="h-8 text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs">Last Name</Label>
                      <Input value={editForm.last_name} onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })} className="h-8 text-sm" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Team</Label>
                    <Input value={editForm.team} onChange={(e) => setEditForm({ ...editForm, team: e.target.value })} className="h-8 text-sm" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Position</Label>
                      <Input value={editForm.position} onChange={(e) => setEditForm({ ...editForm, position: e.target.value })} className="h-8 text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs">Conference</Label>
                      <Input value={editForm.conference} onChange={(e) => setEditForm({ ...editForm, conference: e.target.value })} className="h-8 text-sm" />
                    </div>
                  </div>
                   <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Class Year</Label>
                      <Input value={editForm.class_year} onChange={(e) => setEditForm({ ...editForm, class_year: e.target.value })} className="h-8 text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs">Age</Label>
                      <Input type="number" value={editForm.age} onChange={(e) => setEditForm({ ...editForm, age: e.target.value })} className="h-8 text-sm" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Bats</Label>
                      <Select value={editForm.bats_hand || "none"} onValueChange={(v) => setEditForm({ ...editForm, bats_hand: v === "none" ? "" : v })}>
                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          <SelectItem value="R">Right</SelectItem>
                          <SelectItem value="L">Left</SelectItem>
                          <SelectItem value="S">Switch</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Throws</Label>
                      <Select value={editForm.throws_hand || "none"} onValueChange={(v) => setEditForm({ ...editForm, throws_hand: v === "none" ? "" : v })}>
                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          <SelectItem value="R">Right</SelectItem>
                          <SelectItem value="L">Left</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Height (inches)</Label>
                      <Input type="number" value={editForm.height_inches} onChange={(e) => setEditForm({ ...editForm, height_inches: e.target.value })} className="h-8 text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs">Weight (lbs)</Label>
                      <Input type="number" value={editForm.weight} onChange={(e) => setEditForm({ ...editForm, weight: e.target.value })} className="h-8 text-sm" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Home State</Label>
                    <Input value={editForm.home_state} onChange={(e) => setEditForm({ ...editForm, home_state: e.target.value })} className="h-8 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">High School</Label>
                    <Input value={editForm.high_school} onChange={(e) => setEditForm({ ...editForm, high_school: e.target.value })} className="h-8 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">Notes</Label>
                    <Textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} className="text-sm min-h-[60px]" />
                  </div>
                  </div>
                ) : (
                  <div className="space-y-2.5 text-sm">
                  {[
                    ["Team", displayTeamCurrent || "—"],
                    ["Conference", resolvedConference || "—"],
                    ["Position", effectivePosition || "—"],
                    // Class fallback chain: players.class_year → Hitter Master row's class_year
                    // (Presto upload writes to master tables; players row may not be synced).
                    ["Class", player.class_year || (activeSeasonRow as any)?.class_year || "—"],
                    ["Bats", (player as any).bats_hand === "R" ? "Right" : (player as any).bats_hand === "L" ? "Left" : (player as any).bats_hand === "S" ? "Switch" : (player as any).bats_hand || "—"],
                    ["Throws", (player as any).throws_hand === "R" ? "Right" : (player as any).throws_hand === "L" ? "Left" : (player as any).throws_hand || "—"],
                  ].map(([label, val]) => (
                    <div key={label} className="flex items-center justify-between border-b border-[#162241]/40 pb-1.5 last:border-0 last:pb-0">
                      <span className="text-xs uppercase tracking-wider text-[#8a94a6]">{label}</span>
                      <span className="font-semibold text-slate-100">{val}</span>
                    </div>
                  ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Career Stats Table */}
            {(hitterMasterSeasons as any[]).length > 0 && (
              <Card className="border-[#162241] bg-[#0a1428]">
                <CardHeader className="pb-1 pt-3 px-4">
                  <CardTitle className="text-sm font-semibold tracking-wide uppercase text-[#D4AF37]" style={{ fontFamily: "Oswald, sans-serif" }}>Career Stats</CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                  <table className="w-full text-xs" style={{ fontFamily: "Inter, sans-serif" }}>
                    <thead>
                      <tr className="border-b border-[#162241]">
                        <th className="text-left py-1.5 pr-1 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">Year</th>
                        <th className="text-left py-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">Team</th>
                        <th className="text-right py-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">PA</th>
                        <th className="text-right py-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">AVG</th>
                        <th className="text-right py-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">OBP</th>
                        <th className="text-right py-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">SLG</th>
                        <th className="text-right py-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">OPS</th>
                        <th className="text-right py-1.5 pl-1 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">ISO</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(hitterMasterSeasons as any[])
                        .sort((a, b) => Number(a.Season) - Number(b.Season))
                        .map((row: any, i: number) => {
                          const ops = row.OBP != null && row.SLG != null ? (Number(row.OBP) + Number(row.SLG)) : null;
                          const iso = row.SLG != null && row.AVG != null ? (Number(row.SLG) - Number(row.AVG)) : null;
                          return (
                            <tr key={row.Season} className={`border-b border-[#162241]/60 last:border-0 transition-colors duration-150 hover:bg-[#162241]/40 ${i % 2 === 1 ? "bg-[#0d1a30]" : ""}`}>
                              <td className="py-1.5 pr-1 font-semibold text-white">{row.Season}</td>
                              <td className="py-1.5 px-1 text-[#8a94a6] truncate max-w-[60px]">{teamAbbrev(row.Team, row.TeamID)}</td>
                              <td className="py-1.5 px-1 text-right tabular-nums text-slate-200">{row.pa ?? "—"}</td>
                              <td className="py-1.5 px-1 text-right tabular-nums text-slate-200">{row.AVG != null ? Number(row.AVG).toFixed(3) : "—"}</td>
                              <td className="py-1.5 px-1 text-right tabular-nums text-slate-200">{row.OBP != null ? Number(row.OBP).toFixed(3) : "—"}</td>
                              <td className="py-1.5 px-1 text-right tabular-nums text-slate-200">{row.SLG != null ? Number(row.SLG).toFixed(3) : "—"}</td>
                              <td className="py-1.5 px-1 text-right tabular-nums text-slate-200">{ops != null ? ops.toFixed(3) : "—"}</td>
                              <td className="py-1.5 pl-1 text-right tabular-nums text-slate-200">{iso != null ? iso.toFixed(3) : "—"}</td>
                            </tr>
                          );
                        })}
                      {(hitterMasterSeasons as any[]).length > 1 && (() => {
                        const rows = hitterMasterSeasons as any[];
                        const totalPa = rows.reduce((s, r) => s + (Number(r.pa) || 0), 0);
                        if (totalPa === 0) return null;
                        const wAvg = (field: string) => {
                          let sv = 0, sw = 0;
                          for (const r of rows) { const v = Number(r[field]); const w = Number(r.pa) || 0; if (Number.isFinite(v) && w > 0) { sv += v * w; sw += w; } }
                          return sw > 0 ? sv / sw : null;
                        };
                        const cAvg = wAvg("AVG");
                        const cObp = wAvg("OBP");
                        const cSlg = wAvg("SLG");
                        const cOps = cObp != null && cSlg != null ? cObp + cSlg : null;
                        const cIso = cSlg != null && cAvg != null ? cSlg - cAvg : null;
                        return (
                          <tr className={`border-t border-[#D4AF37]/30 ${rows.length % 2 === 1 ? "bg-[#0d1a30]" : ""}`}>
                            <td className="py-1.5 pr-1 font-bold text-[#D4AF37]">Career</td>
                            <td className="py-1.5 px-1"></td>
                            <td className="py-1.5 px-1 text-right tabular-nums font-semibold text-white">{totalPa}</td>
                            <td className="py-1.5 px-1 text-right tabular-nums font-semibold text-white">{cAvg != null ? cAvg.toFixed(3) : "—"}</td>
                            <td className="py-1.5 px-1 text-right tabular-nums font-semibold text-white">{cObp != null ? cObp.toFixed(3) : "—"}</td>
                            <td className="py-1.5 px-1 text-right tabular-nums font-semibold text-white">{cSlg != null ? cSlg.toFixed(3) : "—"}</td>
                            <td className="py-1.5 px-1 text-right tabular-nums font-semibold text-white">{cOps != null ? cOps.toFixed(3) : "—"}</td>
                            <td className="py-1.5 pl-1 text-right tabular-nums font-semibold text-white">{cIso != null ? cIso.toFixed(3) : "—"}</td>
                          </tr>
                        );
                      })()}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}

            {/* Portal Move — shows under Career Stats for any portal-active player */}
            {isTransferPortal && <PortalTeamCards player={player as any} />}

            {/* Internal Power Ratings — admin only, fills left column space */}
            {isAdmin && seedPowerDerived && (
              <Card className="border-[#162241] bg-[#0a1428]">
                <CardHeader className="pb-1 pt-3 px-4">
                  <CardTitle className="text-sm font-semibold tracking-wide uppercase text-[#D4AF37] flex items-center gap-2" style={{ fontFamily: "Oswald, sans-serif" }}>
                    Internal Power Ratings
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wide border-[#D4AF37]/30 text-[#D4AF37]/70">Admin</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      ["Overall PR+", pctFormat(activeSeasonScoutingGrades?.overallPlus ?? seedPowerDerived?.overallPlus)],
                      ["AVG PR+", pctFormat(activeSeasonScoutingGrades?.baPlus ?? seedPowerDerived?.baPlus)],
                      ["OBP PR+", pctFormat(activeSeasonScoutingGrades?.obpPlus ?? seedPowerDerived?.obpPlus)],
                      ["ISO PR+", pctFormat(activeSeasonScoutingGrades?.isoPlus ?? seedPowerDerived?.isoPlus)],
                    ].map(([label, val]) => (
                      <div key={label} className="rounded-lg border border-[#162241] bg-[#0d1a30] p-3">
                        <div className="text-[10px] uppercase tracking-wider font-semibold text-[#8a94a6]">{label}</div>
                        <div className="text-2xl font-bold mt-1 text-white tabular-nums">{val}</div>
                      </div>
                    ))}
                  </div>
                  {(activeSeasonRow || seedPowerRow) && (
                      <div className="border-t border-[#162241] pt-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-[#8a94a6] mb-2">{effectiveSeason} Input Metrics</p>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            ["Contact %", activeSeasonRow ? (activeSeasonRow as any).contact : seedPowerRow?.contact, "%"],
                            ["Line Drive %", activeSeasonRow ? (activeSeasonRow as any).line_drive : seedPowerRow?.lineDrive, "%"],
                            ["Pop-Up %", activeSeasonRow ? (activeSeasonRow as any).pop_up : seedPowerRow?.popUp, "%"],
                            ["BB %", activeSeasonRow ? (activeSeasonRow as any).bb : seedPowerRow?.bb, "%"],
                            ["Chase %", activeSeasonRow ? (activeSeasonRow as any).chase : seedPowerRow?.chase, "%"],
                            ["Barrel %", activeSeasonRow ? (activeSeasonRow as any).barrel : seedPowerRow?.barrel, "%"],
                            ["Pull %", activeSeasonRow ? (activeSeasonRow as any).pull : seedPowerRow?.pull, "%"],
                            ["LA 10-30 %", activeSeasonRow ? (activeSeasonRow as any).la_10_30 : seedPowerRow?.la10_30, "%"],
                            ["GB %", activeSeasonRow ? (activeSeasonRow as any).gb : seedPowerRow?.gb, "%"],
                            ["Avg Exit Velo", activeSeasonRow ? (activeSeasonRow as any).avg_exit_velo : seedPowerRow?.avgExitVelo, " mph"],
                            ["EV90", activeSeasonRow ? (activeSeasonRow as any).ev90 : seedPowerRow?.ev90, " mph"],
                          ].map(([label, val, suffix]) => (
                            <div key={label as string} className="rounded-lg border border-[#162241] bg-[#0d1a30] p-2.5">
                              <div className="text-[9px] uppercase tracking-wider font-semibold text-[#8a94a6]">{label}</div>
                              <div className="font-semibold text-lg mt-0.5 text-slate-100 tabular-nums">{val != null ? `${Number(val).toFixed(1)}${suffix}` : "—"}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Predictions & Scouting */}
          <div className="lg:col-span-2 space-y-4">
            <div className="grid gap-3 grid-cols-3">
              <div className="rounded-lg border border-[#162241] bg-[#0a1428] p-4 text-center">
                <div className="text-[11px] uppercase tracking-wider font-semibold text-[#8a94a6]">oWAR{isThinSample ? "*" : ""}</div>
                <div className={`text-3xl font-bold tracking-tight mt-1 ${warTierClass(displayOWar)}`}>{displayOWar != null ? displayOWar.toFixed(1) : "—"}</div>
              </div>
              <div className="rounded-lg border border-[#162241] bg-[#0a1428] p-4 text-center">
                <div className="text-[11px] uppercase tracking-wider font-semibold text-[#8a94a6]">Market Value</div>
                <div className="text-2xl font-bold tracking-tight mt-1 text-[#D4AF37]">{displayNilValuation != null ? `$${Math.round(displayNilValuation).toLocaleString()}` : "—"}</div>
              </div>
              <div className="rounded-lg border border-[#162241] bg-[#0a1428] p-4 text-center">
                <div className="text-[11px] uppercase tracking-wider font-semibold text-[#8a94a6]">Power Rating{projectionSourceRow?.combined_used ? "*" : ""}</div>
                <div className={`text-3xl font-bold tracking-tight mt-1 ${powerTierClass(projectionSourceRow?.overall_power_rating ?? seedPowerDerived?.overallPlus ?? null)}`}>{pctFormat(projectionSourceRow?.overall_power_rating ?? seedPowerDerived?.overallPlus ?? null)}</div>
                {projectionSourceRow?.combined_used && (
                  <div className="mt-1 text-[9px] text-[#8a94a6]">*combined {projectionSourceRow.combined_seasons || "multi-season"}</div>
                )}
              </div>
            </div>


              {(() => {
                // 2026-05-24: JUCO branch removed. JUCO hitters now have populated
                // player_predictions rows (returner-regular = 2026 verbatim per
                // Option A, precomputed = team-scoped transfer projection from
                // eager precompute). D1 path below reads from regularPred which
                // handles both correctly.
                return (
                  <Card className="border-[#162241] bg-[#0a1428]">
                    <CardHeader className="pb-2 pt-3 px-4">
                      <div className="flex items-center gap-3 flex-wrap">
                        <CardTitle className="text-sm font-semibold tracking-wide uppercase text-[#D4AF37] flex items-center gap-2" style={{ fontFamily: "Oswald, sans-serif" }}><TrendingUp className="h-4 w-4" />2027 Projected Stats{isThinSample ? "*" : ""}</CardTitle>
                        <div className="flex items-center gap-1.5">
                          <Select value={depthRole} onValueChange={(v) => setDepthRole(v as HitterDepthRole)}>
                            <SelectTrigger className="h-7 w-[150px] text-xs border-[#162241] bg-[#0d1a30] text-slate-200" title="Depth role — session-only display overlay; not saved"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="cornerstone">Cornerstone (245 PA)</SelectItem>
                              <SelectItem value="everyday_starter">Everyday Starter (215 PA)</SelectItem>
                              <SelectItem value="platoon_starter">Platoon Starter (145 PA)</SelectItem>
                              <SelectItem value="utility">Utility (85 PA)</SelectItem>
                              <SelectItem value="bench">Bench (25 PA)</SelectItem>
                            </SelectContent>
                          </Select>
                          <Select
                            value={sessionDevAgg}
                            onValueChange={setSessionDevAgg}
                          >
                            <SelectTrigger className="h-7 w-[65px] text-xs border-[#162241] bg-[#0d1a30] text-slate-200" title="Dev aggressiveness — session preview only, not saved"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">0.0</SelectItem>
                              <SelectItem value="0.5">0.5</SelectItem>
                              <SelectItem value="1">1.0</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          ["AVG", statFormat(projectedAvg)],
                          ["OBP", statFormat(projectedObp)],
                          ["SLG", statFormat(projectedSlg)],
                          ["OPS", statFormat(projectedDerived.ops)],
                          ["ISO", statFormat(projectedDerived.iso)],
                          ["wRC+", pctFormat(projectedWrcPlus)],
                        ].map(([label, val]) => (
                          <div key={label} className="rounded-lg border border-[#162241] bg-[#0d1a30] p-3 text-center">
                            <div className="text-[10px] uppercase tracking-wider font-semibold text-[#8a94a6]">{label}</div>
                            <div className="text-xl font-bold mt-0.5 text-white tabular-nums">{val}</div>
                          </div>
                        ))}
                      </div>
                      {isThinSample && (
                        <p className="mt-2 text-[10px] text-[#8a94a6]">*thin sample — fewer than 15 AB with no prior-season data; projection is speculative</p>
                      )}
                    </CardContent>
                  </Card>
                );
              })()}

            {/* Scouting Grades */}
            {activeSeasonScoutingGrades && (
              <Card className="border-[#162241] bg-[#0a1428]">
                <CardHeader className="pb-2 pt-3 px-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold tracking-wide uppercase text-[#D4AF37]" style={{ fontFamily: "Oswald, sans-serif" }}>
                      Scouting Grades{effectiveSeason === 2026 && projectionSourceRow?.combined_used ? "*" : ""}
                    </CardTitle>
                    {availableSeasons.length > 1 && (
                      <Select value={String(effectiveSeason)} onValueChange={(v) => setSelectedSeason(Number(v))}>
                        <SelectTrigger className="h-8 w-[75px] text-xs font-semibold border-[#162241] bg-[#0d1a30] text-slate-200">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {availableSeasons.map((y) => (
                            <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <ScoutGrade label="Brl" value={activeSeasonScoutingGrades.barrelScore != null ? Math.round(activeSeasonScoutingGrades.barrelScore) : null} fullLabel="Barrel%" />
                    <ScoutGrade label="EV" value={activeSeasonScoutingGrades.avgEVScore != null ? Math.round(activeSeasonScoutingGrades.avgEVScore) : null} fullLabel="Exit Velo" />
                    <ScoutGrade label="Con" value={activeSeasonScoutingGrades.contactScore != null ? Math.round(activeSeasonScoutingGrades.contactScore) : null} fullLabel="Contact%" />
                    <ScoutGrade label="Chs" value={activeSeasonScoutingGrades.chaseScore != null ? Math.round(activeSeasonScoutingGrades.chaseScore) : null} fullLabel="Chase%" />
                  </div>
                  {effectiveSeason === 2026 && projectionSourceRow?.combined_used && (
                    <p className="mt-2 text-[10px] text-[#8a94a6]">*combined {projectionSourceRow.combined_seasons || "multi-season"} sample</p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Risk Assessment */}
            {(() => {
              const confKey = (resolvedConference || player.conference || "").toLowerCase().trim();
              const confRow = conferenceStatsByKey.get(confKey);
              const p = projectionSourceRow;
              const pa = p?.pa ?? (player as any).pa ?? seedPowerRow?.pa ?? null;
              const isJucoSrc = (player as any)?.division === "NJCAA_D1";

              if (isJucoSrc) {
                // JUCO profile — slimmed 4-factor hitter card (mirrors TP sim).
                // Trajectory / Sample Size dropped. Skillset uses TrackMan when
                // available, else falls back to AVG/OBP/SLG peripherals.
                // projectionSourceRow exposes CamelCase AVG/OBP/SLG/ISO.
                const avg = (p as any)?.AVG ?? null;
                const obp = (p as any)?.OBP ?? null;
                const slg = (p as any)?.SLG ?? null;
                const iso = (p as any)?.ISO ?? (avg != null && slg != null ? slg - avg : null);
                return (
                  <>
                    <JucoHitterRiskCard input={{
                      projectedWrcPlus,
                      chase: p?.chase ?? seedPowerRow?.chase ?? null,
                      contact: p?.contact ?? seedPowerRow?.contact ?? null,
                      whiff: seedPowerRow?.whiff ?? null,
                      barrel: p?.barrel ?? seedPowerRow?.barrel ?? null,
                      lineDrive: p?.line_drive ?? seedPowerRow?.lineDrive ?? null,
                      avgEv: p?.avg_exit_velo ?? seedPowerRow?.avgExitVelo ?? null,
                      ev90: p?.ev90 ?? seedPowerRow?.ev90 ?? null,
                      pull: p?.pull ?? seedPowerRow?.pull ?? null,
                      gb: p?.gb ?? seedPowerRow?.gb ?? null,
                      bb: p?.bb ?? seedPowerRow?.bb ?? null,
                      avg, obp, iso,
                      trackmanPitches: (p as any)?.trackman_pitches ?? (player as any)?.trackman_pitches ?? 0,
                      pa,
                      sourceConference: resolvedConference || player.conference || null,
                      sourceConfStuffPlus: confRow?.stuff_plus ?? null,
                    }} />
                    {projectionSourceRow?.combined_used && (
                      <div className="-mt-2 text-[10px] text-[#8a94a6]">*combined {projectionSourceRow.combined_seasons || "multi-season"} sample</div>
                    )}
                  </>
                );
              }

              // D1 profile — full assessor.
              const risk = assessHitterRisk({
                conference: resolvedConference || player.conference,
                projectedWrcPlus: projectedWrcPlus,
                confStuffPlus: confRow?.stuff_plus,
                careerSeasons: hitterMasterSeasons as any[],
                pa,
                chase: p?.chase ?? seedPowerRow?.chase,
                contact: p?.contact ?? seedPowerRow?.contact,
                whiff: seedPowerRow?.whiff,
                barrel: p?.barrel ?? seedPowerRow?.barrel,
                lineDrive: p?.line_drive ?? seedPowerRow?.lineDrive,
                avgEv: p?.avg_exit_velo ?? seedPowerRow?.avgExitVelo,
                ev90: p?.ev90 ?? seedPowerRow?.ev90,
                pull: p?.pull ?? seedPowerRow?.pull,
                gb: p?.gb ?? seedPowerRow?.gb,
                bb: p?.bb ?? seedPowerRow?.bb,
              });
              return (
                <>
                  <RiskAssessmentCardRSTR risk={risk} />
                  {projectionSourceRow?.combined_used && (
                    <div className="-mt-2 text-[10px] text-[#8a94a6]">*combined {projectionSourceRow.combined_seasons || "multi-season"} sample</div>
                  )}
                </>
              );
            })()}

            {/* Scouting Report */}
            {(projectionSourceRow || seedPowerRow) && (() => {
              const p = projectionSourceRow;
              const report = generateHitterReport({
                batHand: (player as any).bats_hand,
                position: seedPos || player.position,
                conference: resolvedConference || player.conference,
                avg: p?.AVG ?? seedStatRow?.avg, obp: p?.OBP ?? seedStatRow?.obp, slg: p?.SLG ?? seedStatRow?.slg,
                iso: p?.ISO ?? seedDerived?.iso,
                pa: p?.pa ?? (player as any).pa ?? seedPowerRow?.pa ?? null,
                contact: p?.contact ?? seedPowerRow?.contact,
                chase: p?.chase ?? seedPowerRow?.chase,
                bb: p?.bb ?? seedPowerRow?.bb,
                avgEv: p?.avg_exit_velo ?? seedPowerRow?.avgExitVelo,
                ev90: p?.ev90 ?? seedPowerRow?.ev90,
                barrel: p?.barrel ?? seedPowerRow?.barrel,
                laSweet: p?.la_10_30 ?? seedPowerRow?.la10_30,
                lineDrive: p?.line_drive ?? seedPowerRow?.lineDrive,
                gb: p?.gb ?? seedPowerRow?.gb,
                pull: p?.pull ?? seedPowerRow?.pull,
                popUp: p?.pop_up ?? seedPowerRow?.popUp,
              }, "rstriq", "short");

              return (
                <Card className="border-[#162241] bg-[#0a1428]">
                  <CardHeader className="pb-2 pt-3 px-4">
                    <CardTitle className="text-sm font-semibold tracking-wide uppercase text-[#D4AF37]" style={{ fontFamily: "Oswald, sans-serif" }}>
                      Scouting Report{projectionSourceRow?.combined_used ? "*" : ""}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    {aiScoutingReport?.body ? (
                      <AiScoutingReportBody body={aiScoutingReport.body} generatedAt={aiScoutingReport.generated_at} />
                    ) : (
                      <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">{report}</p>
                    )}
                    {projectionSourceRow?.combined_used && (
                      <p className="mt-2 text-[10px] text-[#8a94a6]">*combined {projectionSourceRow.combined_seasons || "multi-season"} sample</p>
                    )}
                  </CardContent>
                </Card>
              );
            })()}

            {/* Season Stats */}
            {seasonStats.length > 0 && (
              <Card className="border-[#162241] bg-[#0a1428]">
                <CardHeader className="pb-1 pt-3 px-4">
                  <CardTitle className="text-sm font-semibold tracking-wide uppercase text-[#D4AF37]" style={{ fontFamily: "Oswald, sans-serif" }}>Season Stats</CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                  <table className="w-full text-xs" style={{ fontFamily: "Inter, sans-serif" }}>
                    <thead>
                      <tr className="border-b border-[#162241]">
                        <th className="text-left py-1.5 pr-1 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">Season</th>
                        <th className="text-right py-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">G</th>
                        <th className="text-right py-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">AB</th>
                        <th className="text-right py-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">H</th>
                        <th className="text-right py-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">HR</th>
                        <th className="text-right py-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">RBI</th>
                        <th className="text-right py-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">AVG</th>
                        <th className="text-right py-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">OBP</th>
                        <th className="text-right py-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">SLG</th>
                        <th className="text-right py-1.5 pl-1 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">OPS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {seasonStats.map((s, i) => (
                        <tr key={s.id} className={`border-b border-[#162241]/60 last:border-0 transition-colors duration-150 hover:bg-[#162241]/40 ${i % 2 === 1 ? "bg-[#0d1a30]" : ""}`}>
                          <td className="py-1.5 pr-1 font-semibold text-white">{s.season}</td>
                          <td className="text-right py-1.5 px-1 tabular-nums text-slate-200">{s.games ?? "—"}</td>
                          <td className="text-right py-1.5 px-1 tabular-nums text-slate-200">{s.at_bats ?? "—"}</td>
                          <td className="text-right py-1.5 px-1 tabular-nums text-slate-200">{s.hits ?? "—"}</td>
                          <td className="text-right py-1.5 px-1 tabular-nums text-slate-200">{s.home_runs ?? "—"}</td>
                          <td className="text-right py-1.5 px-1 tabular-nums text-slate-200">{s.rbi ?? "—"}</td>
                          <td className="text-right py-1.5 px-1 tabular-nums text-slate-200">{statFormat(s.batting_avg)}</td>
                          <td className="text-right py-1.5 px-1 tabular-nums text-slate-200">{statFormat(s.on_base_pct)}</td>
                          <td className="text-right py-1.5 px-1 tabular-nums text-slate-200">{statFormat(s.slugging_pct)}</td>
                          <td className="text-right py-1.5 pl-1 tabular-nums font-bold text-white">{statFormat(s.ops)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}
          </div>
        </div>}

      </div>
    </DashboardLayout>
  );
}

// ─── Historical Hitter View ─────────────────────────────────────────
function HistoricalHitterView({
  player, row, season, ncaaWrc, isAdmin,
}: {
  player: any;
  row: any | null;
  season: number;
  ncaaWrc: number | null;
  isAdmin: boolean;
}) {
  if (!row) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No {season} season data available for this player.
        </CardContent>
      </Card>
    );
  }
  const fmt = (v: number | null | undefined, d = 3) => v == null ? "—" : Number(v).toFixed(d);
  const ops = row.OBP != null && row.SLG != null ? row.OBP + row.SLG : null;
  const wrcPlus = (() => {
    if (row.AVG == null || row.OBP == null || row.SLG == null || row.ISO == null || ncaaWrc == null || ncaaWrc <= 0) return null;
    const wrc = (0.45 * row.OBP) + (0.30 * row.SLG) + (0.15 * row.AVG) + (0.10 * row.ISO);
    return Math.round((wrc / ncaaWrc) * 100);
  })();

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Left: player info */}
      <div className="lg:col-span-1 space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{season} Season</CardTitle>
            <CardDescription className="text-xs">Actual stats and scouting grades</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Team</span><span className="text-sm font-semibold">{row.Team || "—"}</span></div>
            <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Conference</span><span className="text-sm font-semibold">{row.Conference || "—"}</span></div>
            <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Position</span><span className="text-sm font-semibold">{row.Pos || player.position || "—"}</span></div>
            <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Bats</span><span className="text-sm font-semibold">{row.BatHand || player.bats_hand || "—"}</span></div>
            <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">PA</span><span className="text-sm font-semibold tabular-nums">{row.pa ?? "—"}</span></div>
            <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">AB</span><span className="text-sm font-semibold tabular-nums">{row.ab ?? "—"}</span></div>
          </CardContent>
        </Card>
      </div>

      {/* Middle + right: stats and scouting */}
      <div className="lg:col-span-2 space-y-4">
        {/* Slash line + wRC+ hero row */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{season} Hitting Stats</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">AVG</div>
                <div className="text-2xl font-bold mt-1 tabular-nums">{fmt(row.AVG)}</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">OBP</div>
                <div className="text-2xl font-bold mt-1 tabular-nums">{fmt(row.OBP)}</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">SLG</div>
                <div className="text-2xl font-bold mt-1 tabular-nums">{fmt(row.SLG)}</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">OPS</div>
                <div className="text-2xl font-bold mt-1 tabular-nums">{fmt(ops)}</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">ISO</div>
                <div className="text-2xl font-bold mt-1 tabular-nums">{fmt(row.ISO)}</div>
              </div>
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-center">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">wRC+</div>
                <div className="text-2xl font-bold mt-1 tabular-nums text-primary">{wrcPlus ?? "—"}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Scouting grades — public 4 + admin extras (mirrors 2025) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{season} Scouting Grades</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <ScoutGrade label="Brl" value={row.barrel_score != null ? Math.round(row.barrel_score) : null} fullLabel="Barrel%" />
              <ScoutGrade label="EV"  value={row.avg_ev_score != null ? Math.round(row.avg_ev_score) : null} fullLabel="Exit Velo" />
              <ScoutGrade label="Con" value={row.contact_score != null ? Math.round(row.contact_score) : null} fullLabel="Contact%" />
              <ScoutGrade label="Chs" value={row.chase_score != null ? Math.round(row.chase_score) : null} fullLabel="Chase%" />
            </div>
            {isAdmin && (
              <>
                <Separator className="my-4" />
                <div className="flex items-center gap-2 mb-3">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold text-primary">Internal Power Ratings</span>
                  <Badge variant="outline" className="text-xs">Admin Only</Badge>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                  <div className="rounded-lg border border-border bg-muted/50 p-3">
                    <div className="text-xs font-medium text-muted-foreground">Overall Power Rating</div>
                    <div className="text-2xl font-bold font-mono mt-1">{row.overall_power_rating != null ? Math.round(row.overall_power_rating) : "—"}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/50 p-3">
                    <div className="text-xs font-medium text-muted-foreground">Batting Average Power Rating</div>
                    <div className="text-2xl font-bold font-mono mt-1">{row.ba_power_rating != null ? Math.round(row.ba_power_rating) : "—"}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/50 p-3">
                    <div className="text-xs font-medium text-muted-foreground">OBP Power Rating</div>
                    <div className="text-2xl font-bold font-mono mt-1">{row.obp_power_rating != null ? Math.round(row.obp_power_rating) : "—"}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/50 p-3">
                    <div className="text-xs font-medium text-muted-foreground">ISO Power Rating</div>
                    <div className="text-2xl font-bold font-mono mt-1">{row.iso_power_rating != null ? Math.round(row.iso_power_rating) : "—"}</div>
                  </div>
                </div>
                <Separator className="my-4" />
                <div className="text-xs font-medium text-muted-foreground mb-3">{season} Input Metrics</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                  <InputMetric label="Contact %" value={row.contact} suffix="%" />
                  <InputMetric label="Line Drive %" value={row.line_drive} suffix="%" />
                  <InputMetric label="Pop-Up %" value={row.pop_up} suffix="%" />
                  <InputMetric label="BB %" value={row.bb} suffix="%" />
                  <InputMetric label="Chase %" value={row.chase} suffix="%" />
                  <InputMetric label="Barrel %" value={row.barrel} suffix="%" />
                  <InputMetric label="Pull %" value={row.pull} suffix="%" />
                  <InputMetric label="LA 10-30 %" value={row.la_10_30} suffix="%" />
                  <InputMetric label="GB %" value={row.gb} suffix="%" />
                  <InputMetric label="Avg Exit Velo" value={row.avg_exit_velo} suffix=" mph" />
                  <InputMetric label="EV90" value={row.ev90} suffix=" mph" />
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function InputMetric({ label, value, suffix }: { label: string; value: number | null | undefined; suffix?: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/50 p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-xl font-bold font-mono mt-1">
        {value == null ? "—" : `${Number(value).toFixed(1)}${suffix || ""}`}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-bold">{value || "—"}</span>
    </div>
  );
}
