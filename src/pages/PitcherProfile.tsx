import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, Target, TrendingUp, Star } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { PROJECTION_SEASON } from "@/lib/seasonConstants";
import { pickPreferredPrediction } from "@/lib/teamScopedPredictions";
import { readPitchingWeights } from "@/lib/pitchingEquations";
import { usePlayerOverrides } from "@/hooks/usePlayerOverrides";
import { getProgramTierMultiplierByConference } from "@/lib/nilProgramSpecific";
import { resolveMetricParkFactor } from "@/lib/parkFactors";
import { useParkFactors } from "@/hooks/useParkFactors";
import { useTeamsTable } from "@/hooks/useTeamsTable";
import { usePitchingSeedData } from "@/hooks/usePitchingSeedData";
import { useTargetBoard } from "@/hooks/useTargetBoard";
import { useHighFollow } from "@/hooks/useHighFollow";
import { useConferenceStats } from "@/hooks/useConferenceStats";
import { downloadSinglePlayerReport, type ReportPlayer } from "@/components/ScoutingReport";
import { AiScoutingReportBody } from "@/components/AiScoutingReport";
import { useScoutingReport } from "@/hooks/useScoutingReport";
import CoachNotes from "@/components/CoachNotes";
import { ABSComparisonTable } from "@/components/ABSComparisonTable";
import { useCoachNotes } from "@/hooks/useCoachNotes";
import { generateCoachNotesPdf, generateReportPdf } from "@/lib/pdfGenerator";
import { assessPitcherRisk } from "@/lib/playerRisk";
import { RiskAssessmentCardRSTR } from "@/components/RiskAssessmentCard";
import { JucoPitcherRiskCard } from "@/components/JucoRiskCards";
import { isThinSamplePitcher } from "@/lib/combinedStats";
import { usePitchingEquationWeights } from "@/hooks/usePitchingEquationWeights";
import { usePitcherRoleOverrides } from "@/hooks/usePitcherRoleOverrides";
import { computePrvPlus } from "@/savant/lib/prvPlus";
import { generatePitcherReport } from "@/lib/scoutingReportGenerator";
import { recalculatePredictionById } from "@/lib/predictionEngine";
import { PortalStatusBadge, PortalContactButton } from "@/components/PortalStatus";
import { MarketPayLogButton } from "@/components/MarketPayLogButton";
import PlayerPageTabs from "@/components/PlayerPageTabs";
import { PortalTeamCards } from "@/components/PortalTeamCards";
import {
  computePitcherWar,
  computePitcherMarketValue,
  pitcherExpectedIp,
  pitcherRoleFromDepthRole,
  getPitchingPvfForRole,
  type PitcherDepthRole,
} from "@/lib/depthRoles";
import { defaultPitcherDepthRoleFromIp } from "@/pages/team-builder/helpers";
import { pickPitcherMarketValue } from "@/lib/twpMarketValue";

const fmt = (v: number | null | undefined, digits = 3) => (v == null ? "—" : Number(v).toFixed(digits));
const fmtWhole = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toString());
const normalize = (v: string | null | undefined) =>
  (v || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const parkToIndex = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return 100;
  return Math.abs(v) <= 3 ? v * 100 : v;
};
const PITCHER_TEAM_ALIASES: Record<string, string> = {
  "unc charlotte": "Charlotte",
  "louisiana state university": "Louisiana State",
  "university of mississippi": "Ole Miss",
  "florida international university": "Florida International",
  "florida internation": "Florida International",
  "university of hawaii manoa": "University of Hawaii",
  "university of hawaii, manoa": "University of Hawaii",
  "university of california": "California",
  ucla: "University of California Los Angeles",
  "samford university": "Samford",
};
const normalizePitcherTeamName = (team: string | null | undefined) => {
  const raw = String(team || "").trim();
  if (!raw) return "";
  const alias = PITCHER_TEAM_ALIASES[normalize(raw)];
  return alias || raw;
};
const isUuid = (v: string | undefined) =>
  !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const STORAGE_PREFIX = "storage__";
const parseBaseballInnings = (v: string | null | undefined) => {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const whole = Math.trunc(n);
  const frac = Math.round((n - whole) * 10);
  if (frac === 1) return whole + (1 / 3);
  if (frac === 2) return whole + (2 / 3);
  return n;
};


const nilFormat = (v: number | null | undefined) => {
  if (v == null) return "—";
  return `$${Math.round(v).toLocaleString()}`;
};

const OVERALL_PITCHER_POWER_WEIGHTS = {
  era: 0.15,
  fip: 0.25,
  whip: 0.1,
  k9: 0.2,
  bb9: 0.15,
  hr9: 0.15,
} as const;

type PitchArsenalRow = {
  season: number | null;
  source_player_id: string | null;
  player_name: string | null;
  hand: string | null;
  pitch_type: string | null;
  stuff_plus: number | null;
  usage_pct: number | null;
  whiff_pct: number | null;
  total_pitches: number | null;
  total_pitches_all: number | null;
  overall_stuff_plus: number | null;
};

const PITCH_TYPE_LABELS: Record<string, string> = {
  "4S": "4-Seam FB",
  "4S FB": "4-Seam FB",
  "FOUR-SEAM": "4-Seam FB",
  "FF": "4-Seam FB",
  SI: "Sinker",
  SINKER: "Sinker",
  Sinker: "Sinker",
  SL: "Slider",
  SLIDER: "Slider",
  Slider: "Slider",
  SWP: "Sweeper",
  SWEEPER: "Sweeper",
  Sweeper: "Sweeper",
  "GYRO SLIDER": "Gyro Slider",
  "Gyro Slider": "Gyro Slider",
  CB: "Curveball",
  CURVEBALL: "Curveball",
  Curveball: "Curveball",
  CU: "Curveball",
  CT: "Cutter",
  CUTTER: "Cutter",
  Cutter: "Cutter",
  FC: "Cutter",
  CH: "Changeup",
  "CHANGE-UP": "Changeup",
  "Change-up": "Changeup",
  CHANGEUP: "Changeup",
  SP: "Splitter",
  SPLITTER: "Splitter",
  Splitter: "Splitter",
  FS: "Splitter",
};

const PITCH_DISPLAY_ORDER = ["4S", "4S FB", "SI", "SINKER", "Sinker", "CT", "CUTTER", "Cutter", "GYRO SLIDER", "Gyro Slider", "SL", "SLIDER", "Slider", "SWP", "SWEEPER", "Sweeper", "CB", "CURVEBALL", "Curveball", "CH", "CHANGE-UP", "Change-up", "SP", "SPLITTER", "Splitter"] as const;

const PITCHER_PROFILE_STORAGE_OVERRIDE_KEY = "pitcher_profile_projection_overrides_v1";
const getPitchingPvfForRole = (
  role: "SP" | "RP" | "SM",
  eq: ReturnType<typeof readPitchingWeights>,
) => (role === "RP" ? eq.market_pvf_reliever : role === "SM" ? eq.market_pvf_weekday_sp : eq.market_pvf_weekend_sp);
const canShowPitchingMarketValue = (team: string | null | undefined, conference: string | null | undefined) => {
  const conf = String(conference || "").trim().toLowerCase();
  const tm = String(team || "").trim().toLowerCase();
  if (!conf) return false;
  const isIndependent = conf === "independent" || conf.includes("independent");
  if (!isIndependent) return true;
  return tm === "oregon state" || tm.includes("oregon state");
};
const toPitchingRole = (raw: string | null | undefined): "SP" | "RP" | "SM" | null => {
  const v = String(raw || "").trim().toUpperCase();
  if (v === "SP" || v === "RP" || v === "SM") return v;
  return null;
};
const applyRoleTransitionAdjustment = (
  value: number | null,
  pct: number,
  fromRole: "SP" | "RP" | "SM" | null,
  toRole: "SP" | "RP" | "SM" | null,
  lowerIsBetter: boolean,
  rpToSpLowBetterCurve?: {
    tier1Max: number;
    tier2Max: number;
    tier3Max: number;
    tier1Mult: number;
    tier2Mult: number;
    tier3Mult: number;
  },
) => {
  if (value == null || !Number.isFinite(value)) return null;
  if (!fromRole || !toRole || fromRole === toRole) return value;
  const rank: Record<"SP" | "SM" | "RP", number> = { SP: 0, SM: 1, RP: 2 };
  const step = rank[toRole] - rank[fromRole];
  if (step === 0) return value;
  const movingTowardStarter = rank[toRole] < rank[fromRole];

  // Extra RP->SP penalty curve so elite reliever lines do not stay unrealistically low as starters.
  const starterRegressionBoost = (() => {
    if (!movingTowardStarter) return 1;
    if (lowerIsBetter) {
      const c = rpToSpLowBetterCurve;
      if (!c) return 1;
      if (value <= c.tier1Max) return c.tier1Mult;
      if (value <= c.tier2Max) return c.tier2Mult;
      if (value <= c.tier3Max) return c.tier3Mult;
      return 1.0;
    }
    // Keep K/9 and other higher-is-better metrics at the base role-change impact.
    return 1.0;
  })();

  // Role change direction controls up/down; admin % is treated as magnitude.
  const pctMagnitude = Math.abs(pct);
  const factor = 1 + ((pctMagnitude / 100) * (Math.abs(step) / 2) * starterRegressionBoost);
  if (!Number.isFinite(factor) || factor <= 0) return value;
  if (lowerIsBetter) {
    return step > 0 ? value / factor : value * factor;
  }
  return step > 0 ? value * factor : value / factor;
};


const calcPitchingPlus = (
  value: number | null,
  ncaaAvg: number,
  ncaaSd: number,
  scale: number,
  higherIsBetter = false,
) => {
  if (value == null || !Number.isFinite(value) || !Number.isFinite(ncaaAvg) || !Number.isFinite(ncaaSd) || ncaaSd === 0) return null;
  const core = higherIsBetter ? ((value - ncaaAvg) / ncaaSd) : ((ncaaAvg - value) / ncaaSd);
  const raw = 100 + (core * scale);
  return Number.isFinite(raw) ? raw : null;
};

const normalizedWeightedSum = (items: Array<{ value: number; weight: number }>) => {
  const weighted = items.reduce((sum, item) => sum + (item.value * item.weight), 0);
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return null;
  return weighted / totalWeight;
};

function MetricCard({ title, value, subtitle }: { title: string; value: string; subtitle?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold tracking-tight">{value}</div>
        {subtitle ? <p className="text-xs text-muted-foreground mt-1">{subtitle}</p> : null}
      </CardContent>
    </Card>
  );
}

function ScoutGrade({ value, fullLabel }: { value: number | null; fullLabel: string }) {
  // Treat 0 as missing — percentile scores are 0-100 and a literal 0 is almost
  // always a missing-data sentinel (e.g., JUCO arms with exit_vel = 0).
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
      <div className="text-2xl font-bold mt-1">{Math.round(value)}</div>
      <div className="text-xs font-semibold mt-0.5">{grade}</div>
    </div>
  );
}


export default function PitcherProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { hasRole, effectiveTeamId } = useAuth();
  const { getRole: getSupabaseRole, setRole: setSupabaseRole } = usePitcherRoleOverrides();
  const isAdmin = hasRole("admin");
  const queryClient = useQueryClient();
  const { isOnBoard, addPlayer: addToBoard, removePlayer: removeFromBoard } = useTargetBoard();
  const { isOnList: isOnHighFollow, addPlayer: addToHighFollow, removePlayer: removeFromHighFollow } = useHighFollow();
  const { notes: coachNotesForExport } = useCoachNotes(id ?? null);

  const updatePortalStatus = useMutation({
    mutationFn: async (args: { playerId: string; portal_status: string; portal_entry_date: string | null; commit_school: string | null; commit_date: string | null }) => {
      const { error } = await supabase
        .from("players")
        .update({
          portal_status: args.portal_status,
          transfer_portal: args.portal_status === "IN PORTAL",
          portal_entry_date: args.portal_entry_date,
          commit_school: args.commit_school,
          commit_date: args.commit_date,
          portal_manual_override: true,
        } as any)
        .eq("id", args.playerId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pitcher-profile"] });
      queryClient.invalidateQueries({ queryKey: ["target-board"] });
      toast.success("Portal status updated");
    },
    onError: (e: any) => toast.error(`Portal status update failed: ${e.message}`),
  });
  const isStorageRoute = !!id && id.startsWith(STORAGE_PREFIX);
  const isDbRoute = isUuid(id);
  const storageRef = useMemo(() => {
    if (!isStorageRoute || !id) return null;
    const raw = id.slice(STORAGE_PREFIX.length);
    const [nameEnc = "", teamEnc = ""] = raw.split("__");
    const playerName = decodeURIComponent(nameEnc || "");
    const teamName = decodeURIComponent(teamEnc || "");
    return { playerName, teamName };
  }, [id, isStorageRoute]);

  const { data: player, isLoading } = useQuery({
    queryKey: ["pitcher-profile-player", id],
    enabled: !!id,
    queryFn: async () => {
      // Try by UUID first
      if (isDbRoute) {
        const { data } = await supabase
          .from("players")
          .select("*")
          .eq("id", id!)
          .maybeSingle();
        if (data) return data;
      }
      // Fallback: look up by source_player_id (numeric IDs)
      if (/^\d+$/.test(id || "")) {
        const { data: bySource } = await supabase
          .from("players")
          .select("*")
          .eq("source_player_id", id!)
          .maybeSingle();
        if (bySource) return bySource;
      }
      // Fallback: storage route — look up by name in Pitching Master, then players table
      if (storageRef?.playerName) {
        const { data: pmRow } = await supabase
          .from("Pitching Master")
          .select("*")
          .ilike("playerFullName", storageRef.playerName)
          .limit(1)
          .maybeSingle();
        if (pmRow?.source_player_id) {
          const { data: bySource } = await supabase
            .from("players")
            .select("*")
            .eq("source_player_id", pmRow.source_player_id)
            .maybeSingle();
          if (bySource) return bySource;
        }
        if (pmRow) {
          const parts = (pmRow.playerFullName || "").trim().split(/\s+/);
          return {
            id: pmRow.source_player_id || pmRow.id,
            first_name: parts[0] || "",
            last_name: parts.slice(1).join(" ") || "",
            team: pmRow.Team,
            from_team: pmRow.Team,
            conference: pmRow.Conference,
            position: pmRow.Role || "P",
            throws_hand: pmRow.ThrowHand,
            class_year: null,
            transfer_portal: false,
            source_player_id: pmRow.source_player_id,
            source_team_id: pmRow.TeamID,
            age: null, height_inches: null, weight: null, high_school: null, home_state: null,
            headshot_url: null, notes: null, portal_entry_date: null, handedness: null, team_id: pmRow.TeamID,
            created_at: "", updated_at: "",
          } as any;
        }
      }
      return null;
    },
  });

  const { data: aiScoutingReport } = useScoutingReport(player?.id, "pitcher");

  const { data: seasonStats = [] } = useQuery({
    queryKey: ["pitcher-profile-season-stats", id],
    enabled: !!id && isDbRoute,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("season_stats")
        .select("*")
        .eq("player_id", id!)
        .order("season", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch all Pitching Master rows across seasons (linked by source_player_id).
  // Falls back to the URL `id` for cases where the player record is missing
  // but the URL itself is a numeric source_player_id (historical-only pitchers
  // who have no row in the `players` table).
  const _playerName = player ? `${player.first_name || ""} ${player.last_name || ""}`.trim() : null;
  const { data: pitcherMasterSeasons = [] } = useQuery({
    queryKey: ["pitcher-profile-master-seasons", id, (player as any)?.source_player_id, _playerName],
    queryFn: async () => {
      const sourceId = (player as any)?.source_player_id || (id && /^\d+$/.test(id) ? id : null);
      if (sourceId) {
        const { data, error } = await supabase
          .from("Pitching Master")
          .select("*")
          .eq("source_player_id", sourceId)
          .order("Season", { ascending: false });
        if (!error && data && data.length > 0) return data;
      }
      if (_playerName) {
        const { data } = await (supabase as any)
          .from("Pitching Master")
          .select("*")
          .ilike("playerFullName", _playerName)
          .order("Season", { ascending: false });
        if (data && data.length > 0) return data;
      }
      return [];
    },
    enabled: !!id,
  });

  // Detect two-way: does this pitcher also have meaningful at-bats?
  const { data: hasHittingData = false } = useQuery({
    queryKey: ["pitcher-has-hitting", id, (player as any)?.source_player_id],
    queryFn: async () => {
      const sourceId = (player as any)?.source_player_id || (id && /^\d+$/.test(id) ? id : null);
      if (!sourceId) return false;
      const { data } = await supabase
        .from("Hitter Master")
        .select("ab")
        .eq("source_player_id", sourceId)
        .gte("ab", 1)
        .limit(1);
      return (data?.length || 0) > 0;
    },
    enabled: !!id,
  });

  const availableSeasons = useMemo(() => {
    const set = new Set<number>();
    for (const r of pitcherMasterSeasons) if ((r as any).Season != null) set.add(Number((r as any).Season));
    for (const s of seasonStats) if ((s as any).season != null) set.add(Number((s as any).season));
    return [...set].sort((a, b) => b - a);
  }, [pitcherMasterSeasons, seasonStats]);

  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const defaultSeason = availableSeasons.includes(2026) ? 2026 : (availableSeasons[0] ?? 2026);
  const effectiveSeason = selectedSeason ?? defaultSeason;
  const historicalRow = useMemo(() => {
    return (pitcherMasterSeasons as any[]).find((r) => Number(r.Season) === effectiveSeason) || null;
  }, [pitcherMasterSeasons, effectiveSeason]);

  const currentPitcherRow = useMemo(() => {
    return (pitcherMasterSeasons as any[]).find((r) => Number(r.Season) === 2026) || null;
  }, [pitcherMasterSeasons]);
  const combinedUsed = !!(currentPitcherRow as any)?.combined_used;
  const combinedIp = (currentPitcherRow as any)?.combined_ip as number | null | undefined;
  const combinedSeasonsLabel = (currentPitcherRow as any)?.combined_seasons as string | null | undefined;

  // Use the resolved player UUID when available, falling back to the URL id
  // for direct UUID routes. Storage routes (`storage__Name__Team`) resolve the
  // player via the player query above; this read must wait for that resolve
  // and then query by the actual UUID, not the URL slug. Otherwise predictions
  // never load and the profile shows "no stats" for legit storage-route hits.
  const predictionLookupId: string | null = isDbRoute
    ? (id ?? null)
    : (typeof (player as any)?.id === "string" && isUuid((player as any).id) ? (player as any).id : null);
  const { data: predictions = [] } = useQuery({
    queryKey: ["pitcher-profile-predictions", predictionLookupId],
    enabled: !!predictionLookupId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_predictions")
        .select("*")
        .eq("player_id", predictionLookupId!)
        .eq("season", PROJECTION_SEASON)
        .eq("status", "active");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: nilValuation } = useQuery({
    queryKey: ["pitcher-profile-nil", id],
    enabled: !!id && isDbRoute,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nil_valuations")
        .select("*")
        .eq("player_id", id!)
        .order("season", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  // MLB Draft slot value (most recent draft cycle for this pitcher).
  const { data: slotValueRow } = useQuery({
    queryKey: ["pitcher-slot-value", id],
    enabled: !!id && isDbRoute,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_slot_values" as any)
        .select("draft_year, rank, slot_value")
        .eq("player_id", id!)
        .order("draft_year", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return data as unknown as { draft_year: number; rank: number | null; slot_value: number } | null;
    },
  });
  const { teams: teamDirectory } = useTeamsTable();
  const { conferenceStatsByKey } = useConferenceStats(2026);
  const lookupPlayerName = useMemo(() => {
    if (storageRef?.playerName) return storageRef.playerName;
    const fullName = `${player?.first_name || ""} ${player?.last_name || ""}`.trim();
    return fullName || "";
  }, [player?.first_name, player?.last_name, storageRef?.playerName]);
  const lookupTeamName = useMemo(() => {
    if (storageRef?.teamName) return storageRef.teamName;
    return normalizePitcherTeamName(player?.team || "");
  }, [player?.team, storageRef?.teamName]);
  // Blend-aware arsenal: if this season's row is a pullback candidate (combined_used),
  // fetch rows from the blended priors too and aggregate per pitch type.
  const arsenalCombineSeasons = useMemo(() => {
    const row = (pitcherMasterSeasons as any[]).find((r) => Number(r.Season) === effectiveSeason);
    if (!row?.combined_used) return { combined: false, seasons: [effectiveSeason], label: null as string | null };
    const combinedStr = String(row.combined_seasons ?? "");
    const extra = combinedStr.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
    const seasons = Array.from(new Set([effectiveSeason, ...extra])).sort((a, b) => b - a);
    return { combined: seasons.length > 1, seasons, label: seasons.join(" & ") };
  }, [pitcherMasterSeasons, effectiveSeason]);

  const { data: pitchArsenalRows = [] } = useQuery({
    queryKey: ["pitcher-profile-pitch-arsenal", id, lookupPlayerName, (player as any)?.source_player_id, effectiveSeason, arsenalCombineSeasons.seasons.join(",")],
    enabled: !!lookupPlayerName || !!(player as any)?.source_player_id || !!id,
    queryFn: async () => {
      // Resolve the source_player_id that pitcher_stuff_plus_inputs uses.
      // Strategy: get it from the Pitching Master row (same source Savant uses).
      const playerSourceId = (player as any)?.source_player_id;
      const urlId = id && /^\d+$/.test(id) ? id : null;

      // If we have a source_player_id from the player record, try it first.
      // If that's a UUID (not numeric), look up the numeric one from Pitching Master.
      let sourceId = playerSourceId || urlId;

      // Always try to get the canonical source_player_id from Pitching Master
      // since that's what pitcher_stuff_plus_inputs is keyed on
      if (lookupPlayerName) {
        const { data: masterRow } = await (supabase as any)
          .from("Pitching Master")
          .select("source_player_id")
          .eq("Season", effectiveSeason)
          .ilike("playerFullName", lookupPlayerName)
          .limit(1)
          .maybeSingle();
        if (masterRow?.source_player_id) sourceId = masterRow.source_player_id;
      }

      if (!sourceId) return [] as PitchArsenalRow[];

      const seasonsToQuery = arsenalCombineSeasons.seasons;

      // Primary: pull from pitcher_stuff_plus_inputs across all blended seasons
      const { data: stuffRows, error } = await (supabase as any)
        .from("pitcher_stuff_plus_inputs")
        .select("season, source_player_id, hand, pitch_type, pitches, whiff_pct, stuff_plus")
        .eq("source_player_id", sourceId)
        .in("season", seasonsToQuery)
        .order("pitches", { ascending: false });

      if (!error && stuffRows && stuffRows.length > 0) {
        // Aggregate per (pitch_type, hand): sum pitches, pitch-weighted stuff_plus and whiff_pct
        type Agg = { season: number; source_player_id: string; pitch_type: string; hand: string; pitches: number; wStuff: number; wWhiff: number };
        const aggMap = new Map<string, Agg>();
        for (const r of stuffRows as any[]) {
          const pt = String(r.pitch_type || "").trim();
          if (!pt) continue;
          const key = `${pt}::${r.hand}`;
          if (!aggMap.has(key)) {
            aggMap.set(key, { season: effectiveSeason, source_player_id: r.source_player_id, pitch_type: pt, hand: r.hand, pitches: 0, wStuff: 0, wWhiff: 0 });
          }
          const agg = aggMap.get(key)!;
          const p = Number(r.pitches ?? 0);
          agg.pitches += p;
          if (r.stuff_plus != null) agg.wStuff += Number(r.stuff_plus) * p;
          if (r.whiff_pct != null) agg.wWhiff += Number(r.whiff_pct) * p;
        }
        const aggregated = Array.from(aggMap.values()).filter((a) => a.pitches >= 5);
        const totalPitchesAll = aggregated.reduce((s, a) => s + a.pitches, 0);
        return aggregated.map((a) => ({
          season: a.season,
          source_player_id: a.source_player_id,
          player_name: null,
          hand: a.hand,
          pitch_type: a.pitch_type,
          stuff_plus: a.pitches > 0 ? a.wStuff / a.pitches : null,
          usage_pct: null,
          whiff_pct: a.pitches > 0 ? a.wWhiff / a.pitches : null,
          total_pitches: a.pitches,
          total_pitches_all: totalPitchesAll,
          overall_stuff_plus: null,
        })) as PitchArsenalRow[];
      }

      // Fallback: legacy Pitch Arsenal table
      const bySourceId = async () => {
        if (!sourceId) return [];
        const { data, error } = await supabase
          .from("Pitch Arsenal")
          .select("season, source_player_id, player_name, hand, pitch_type, stuff_plus, whiff_pct, total_pitches, total_pitches_all, overall_stuff_plus")
          .eq("source_player_id", sourceId)
          .eq("season", effectiveSeason)
          .order("total_pitches", { ascending: false });
        if (error) throw error;
        return (data || []).map((r: any) => ({ ...r, usage_pct: null })) as PitchArsenalRow[];
      };
      const byPlayerName = async () => {
        if (!lookupPlayerName) return [];
        const { data, error } = await supabase
          .from("Pitch Arsenal")
          .select("season, source_player_id, player_name, hand, pitch_type, stuff_plus, whiff_pct, total_pitches, total_pitches_all, overall_stuff_plus")
          .eq("player_name", lookupPlayerName)
          .eq("season", effectiveSeason)
          .order("total_pitches", { ascending: false });
        if (error) throw error;
        return (data || []).map((r: any) => ({ ...r, usage_pct: null })) as PitchArsenalRow[];
      };
      const firstPass = await bySourceId();
      if (firstPass.length > 0) return firstPass;
      return byPlayerName();
    },
  });
  // ── Pitching Master ──
  // Pull from the unfiltered profile-scoped query (pitcherMasterSeasons) so
  // low-IP pitchers (e.g. two-way players) still load. The shared
  // usePitchingSeedData hook applies an IP >= 20 dashboard filter that would
  // hide them from individual profile pages.
  const { pitchers: pitchingMasterRows } = usePitchingSeedData();
  const masterRow = useMemo(() => {
    // Prefer the unfiltered pitcher seasons row for the current selected season
    const fromSeasons = (pitcherMasterSeasons as any[]).find((r) => Number(r.Season) === effectiveSeason)
      ?? (pitcherMasterSeasons as any[])[0];
    if (fromSeasons) {
      // When combined_used=true (below IP threshold with prior-season blend), anchor
      // projections on blended stats so the noisy small-sample values don't distort pEra.
      const combinedUsed = !!fromSeasons.combined_used;
      // Map raw DB shape into the seed-data shape downstream code expects
      return {
        source_player_id: fromSeasons.source_player_id ?? null,
        playerName: fromSeasons.playerFullName ?? "",
        team: fromSeasons.Team ?? null,
        teamId: fromSeasons.TeamID ?? null,
        conference: fromSeasons.Conference ?? null,
        conferenceId: fromSeasons.conference_id ?? null,
        throwHand: fromSeasons.ThrowHand ?? null,
        role: fromSeasons.Role ?? null,
        ip: fromSeasons.IP ?? null,
        g: fromSeasons.G ?? null,
        gs: fromSeasons.GS ?? null,
        era: combinedUsed ? (fromSeasons.blended_era ?? fromSeasons.ERA) : fromSeasons.ERA,
        fip: combinedUsed ? (fromSeasons.blended_fip ?? fromSeasons.FIP) : fromSeasons.FIP,
        whip: combinedUsed ? (fromSeasons.blended_whip ?? fromSeasons.WHIP) : fromSeasons.WHIP,
        k9: combinedUsed ? (fromSeasons.blended_k9 ?? fromSeasons.K9) : fromSeasons.K9,
        bb9: combinedUsed ? (fromSeasons.blended_bb9 ?? fromSeasons.BB9) : fromSeasons.BB9,
        hr9: combinedUsed ? (fromSeasons.blended_hr9 ?? fromSeasons.HR9) : fromSeasons.HR9,
        // Scouting metrics — swap to blended when combined_used so downstream consumers
        // (internalPowerRatings, risk assessment, scouting report PDF) see the pullback
        // sample instead of noisy small-sample current-season values
        miss_pct: combinedUsed ? (fromSeasons.blended_miss_pct ?? fromSeasons.miss_pct) : fromSeasons.miss_pct,
        bb_pct: combinedUsed ? (fromSeasons.blended_bb_pct ?? fromSeasons.bb_pct) : fromSeasons.bb_pct,
        hard_hit_pct: combinedUsed ? (fromSeasons.blended_hard_hit_pct ?? fromSeasons.hard_hit_pct) : fromSeasons.hard_hit_pct,
        in_zone_whiff_pct: combinedUsed ? (fromSeasons.blended_in_zone_whiff_pct ?? fromSeasons.in_zone_whiff_pct) : fromSeasons.in_zone_whiff_pct,
        chase_pct: combinedUsed ? (fromSeasons.blended_chase_pct ?? fromSeasons.chase_pct) : fromSeasons.chase_pct,
        barrel_pct: combinedUsed ? (fromSeasons.blended_barrel_pct ?? fromSeasons.barrel_pct) : fromSeasons.barrel_pct,
        line_pct: combinedUsed ? (fromSeasons.blended_line_pct ?? fromSeasons.line_pct) : fromSeasons.line_pct,
        exit_vel: combinedUsed ? (fromSeasons.blended_exit_vel ?? fromSeasons.exit_vel) : fromSeasons.exit_vel,
        ground_pct: combinedUsed ? (fromSeasons.blended_ground_pct ?? fromSeasons.ground_pct) : fromSeasons.ground_pct,
        in_zone_pct: combinedUsed ? (fromSeasons.blended_in_zone_pct ?? fromSeasons.in_zone_pct) : fromSeasons.in_zone_pct,
        h_pull_pct: combinedUsed ? (fromSeasons.blended_h_pull_pct ?? fromSeasons.h_pull_pct) : fromSeasons.h_pull_pct,
        la_10_30_pct: combinedUsed ? (fromSeasons.blended_la_10_30_pct ?? fromSeasons.la_10_30_pct) : fromSeasons.la_10_30_pct,
        vel_90th: combinedUsed ? (fromSeasons.blended_90th_vel ?? fromSeasons["90th_vel"]) : fromSeasons["90th_vel"],
        // Stored scouting scores (already blended-based if pipeline ran with combined_used)
        whiff_score: fromSeasons.whiff_score ?? null,
        bb_score: fromSeasons.bb_score ?? null,
        hh_score: fromSeasons.hh_score ?? null,
        iz_whiff_score: fromSeasons.iz_whiff_score ?? null,
        chase_score: fromSeasons.chase_score ?? null,
        barrel_score: fromSeasons.barrel_score ?? null,
        ld_score: fromSeasons.ld_score ?? null,
        ev_score: fromSeasons.ev_score ?? null,
        gb_score: fromSeasons.gb_score ?? null,
        iz_score: fromSeasons.iz_score ?? null,
        ev90_score: fromSeasons.ev90_score ?? null,
        pull_score: fromSeasons.pull_score ?? null,
        la_score: fromSeasons.la_score ?? null,
        combined_used: combinedUsed,
        combined_seasons: fromSeasons.combined_seasons ?? null,
        combined_ip: fromSeasons.combined_ip ?? null,
        stuffPlus: combinedUsed ? (fromSeasons.blended_stuff_plus ?? fromSeasons.stuff_plus ?? null) : (fromSeasons.stuff_plus ?? null),
        // Division is the key for JUCO-vs-D1 branching downstream (projection
        // card, risk card). Was missing from the mapping — caused the JUCO
        // branches to never fire because `masterRow.division` was undefined.
        division: fromSeasons.division ?? null,
        trackman_pitches: fromSeasons.trackman_pitches ?? null,
        bf: fromSeasons.bf ?? null,
        class_year: fromSeasons.class_year ?? null,
        dob: fromSeasons.dob ?? null,
      } as any;
    }
    // Fallback: legacy hook lookup (kept so name-only routes still resolve)
    if (!lookupPlayerName && !id) return null;
    if (isDbRoute && id) {
      const byId = pitchingMasterRows.find((r) => r.source_player_id === id);
      if (byId) return byId;
    }
    const normName = normalize(lookupPlayerName);
    if (!normName) return null;
    const byName = pitchingMasterRows.filter((r) => normalize(r.playerName) === normName);
    if (byName.length === 0) return null;
    if (byName.length === 1) return byName[0];
    const normTeam = normalize(lookupTeamName);
    const exactTeam = byName.find((r) => normalize(r.team) === normTeam);
    return exactTeam || byName[0];
  }, [pitcherMasterSeasons, effectiveSeason, pitchingMasterRows, id, isDbRoute, lookupPlayerName, lookupTeamName]);

  const storageRow = useMemo(() => {
    if (!masterRow) return null;
    const m = masterRow;
    // Build the same shape the downstream code expects:
    // [0]=name, [1]=team, [2]=hand, [3]=role, [4]=ip, [5]=g, [6]=gs,
    // [7]=era, [8]=fip, [9]=whip, [10]=k9, [11]=bb9, [12]=hr9
    return [
      m.playerName || "", m.team || "", m.throwHand || "", m.role || "",
      String(m.ip ?? ""), String(m.g ?? ""), String(m.gs ?? ""),
      String(m.era ?? ""), String(m.fip ?? ""), String(m.whip ?? ""),
      String(m.k9 ?? ""), String(m.bb9 ?? ""), String(m.hr9 ?? ""),
    ] as string[];
  }, [masterRow]);
  const powerRatingsRow = useMemo(() => {
    if (!masterRow) return null;
    const m = masterRow as any;
    // [0]=name, [1]=team,
    // [2..15] = raw metrics (uses blended values when combined_used=true via masterRow mapping)
    // [16..29] = stored scouting scores (computed by pipeline from blended inputs)
    return [
      m.playerName || "", m.team || "",
      String(m.stuffPlus ?? ""), String(m.miss_pct ?? ""), String(m.bb_pct ?? ""), String(m.hard_hit_pct ?? ""),
      String(m.in_zone_whiff_pct ?? ""), String(m.chase_pct ?? ""), String(m.barrel_pct ?? ""), String(m.line_pct ?? ""),
      String(m.exit_vel ?? ""), String(m.ground_pct ?? ""), String(m.in_zone_pct ?? ""), String(m.vel_90th ?? ""),
      String(m.h_pull_pct ?? ""), String(m.la_10_30_pct ?? ""),
      /* stuff score: no dedicated column, computed from stuffPlus */ "",
      String(m.whiff_score ?? ""), String(m.bb_score ?? ""), String(m.hh_score ?? ""),
      String(m.iz_whiff_score ?? ""), String(m.chase_score ?? ""), String(m.barrel_score ?? ""),
      String(m.ld_score ?? ""), String(m.ev_score ?? ""), String(m.gb_score ?? ""),
      String(m.iz_score ?? ""), String(m.ev90_score ?? ""), String(m.pull_score ?? ""),
      String(m.la_score ?? ""),
    ] as string[];
  }, [masterRow]);

  const pitchingEq = usePitchingEquationWeights();

  const parseNum = (v: string | undefined) => {
    const s = (v || "").replace(/[%,$]/g, "").trim();
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  const normalCdf = (x: number) => {
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x) / Math.sqrt(2);
    const t = 1 / (1 + 0.3275911 * ax);
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const erf = sign * (1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-ax * ax));
    return 0.5 * (1 + erf);
  };
  const scoreFromMetric = (value: number | null, avg: number, sd: number, lowerIsBetter = false) => {
    if (value == null || !Number.isFinite(sd) || sd <= 0) return null;
    const pct = normalCdf((value - avg) / sd) * 100;
    return lowerIsBetter ? 100 - pct : pct;
  };
  const safe = (v: number | null | undefined) => (v == null ? null : Number(v));

  const internalPowerRatings = useMemo(() => {
    if (!powerRatingsRow) return null;
    const metrics = {
      stuff: parseNum(powerRatingsRow[2]),
      whiff: parseNum(powerRatingsRow[3]),
      bb: parseNum(powerRatingsRow[4]),
      hh: parseNum(powerRatingsRow[5]),
      izWhiff: parseNum(powerRatingsRow[6]),
      chase: parseNum(powerRatingsRow[7]),
      barrel: parseNum(powerRatingsRow[8]),
      ld: parseNum(powerRatingsRow[9]),
      avgEv: parseNum(powerRatingsRow[10]),
      gb: parseNum(powerRatingsRow[11]),
      iz: parseNum(powerRatingsRow[12]),
      ev90: parseNum(powerRatingsRow[13]),
      pull: parseNum(powerRatingsRow[14]),
      la1030: parseNum(powerRatingsRow[15]),
    };
    const storedScores = {
      stuff: parseNum(powerRatingsRow[16]),
      whiff: parseNum(powerRatingsRow[17]),
      bb: parseNum(powerRatingsRow[18]),
      hh: parseNum(powerRatingsRow[19]),
      izWhiff: parseNum(powerRatingsRow[20]),
      chase: parseNum(powerRatingsRow[21]),
      barrel: parseNum(powerRatingsRow[22]),
      ld: parseNum(powerRatingsRow[23]),
      avgEv: parseNum(powerRatingsRow[24]),
      gb: parseNum(powerRatingsRow[25]),
      iz: parseNum(powerRatingsRow[26]),
      ev90: parseNum(powerRatingsRow[27]),
      pull: parseNum(powerRatingsRow[28]),
      la1030: parseNum(powerRatingsRow[29]),
    };
    const scores = {
      // Stuff+ has no dedicated stored score column in Pitching Master — always
      // compute from raw stuff+. Guarded on equation constants so a misconfigured
      // model_config row can't accidentally leak the raw value through.
      stuff: (() => {
        const avg = Number.isFinite(pitchingEq.p_ncaa_avg_stuff_plus) ? pitchingEq.p_ncaa_avg_stuff_plus : 100;
        const sd = Number.isFinite(pitchingEq.p_sd_stuff_plus) && pitchingEq.p_sd_stuff_plus > 0 ? pitchingEq.p_sd_stuff_plus : 3.97;
        return scoreFromMetric(metrics.stuff, avg, sd);
      })(),
      whiff: storedScores.whiff ?? scoreFromMetric(metrics.whiff, pitchingEq.p_ncaa_avg_whiff_pct, pitchingEq.p_sd_whiff_pct),
      bb: storedScores.bb ?? scoreFromMetric(metrics.bb, pitchingEq.p_ncaa_avg_bb_pct, pitchingEq.p_sd_bb_pct, true),
      hh: storedScores.hh ?? scoreFromMetric(metrics.hh, pitchingEq.p_ncaa_avg_hh_pct, pitchingEq.p_sd_hh_pct, true),
      izWhiff: storedScores.izWhiff ?? scoreFromMetric(metrics.izWhiff, pitchingEq.p_ncaa_avg_in_zone_whiff_pct, pitchingEq.p_sd_in_zone_whiff_pct),
      chase: storedScores.chase ?? scoreFromMetric(metrics.chase, pitchingEq.p_ncaa_avg_chase_pct, pitchingEq.p_sd_chase_pct),
      barrel: storedScores.barrel ?? scoreFromMetric(metrics.barrel, pitchingEq.p_ncaa_avg_barrel_pct, pitchingEq.p_sd_barrel_pct, true),
      ld: storedScores.ld ?? scoreFromMetric(metrics.ld, pitchingEq.p_ncaa_avg_ld_pct, pitchingEq.p_sd_ld_pct, true),
      avgEv: storedScores.avgEv ?? scoreFromMetric(metrics.avgEv, pitchingEq.p_ncaa_avg_avg_ev, pitchingEq.p_sd_avg_ev, true),
      gb: storedScores.gb ?? scoreFromMetric(metrics.gb, pitchingEq.p_ncaa_avg_gb_pct, pitchingEq.p_sd_gb_pct),
      iz: storedScores.iz ?? scoreFromMetric(metrics.iz, pitchingEq.p_ncaa_avg_in_zone_pct, pitchingEq.p_sd_in_zone_pct),
      ev90: storedScores.ev90 ?? scoreFromMetric(metrics.ev90, pitchingEq.p_ncaa_avg_ev90, pitchingEq.p_sd_ev90, true),
      pull: storedScores.pull ?? scoreFromMetric(metrics.pull, pitchingEq.p_ncaa_avg_pull_pct, pitchingEq.p_sd_pull_pct, true),
      la1030: storedScores.la1030 ?? scoreFromMetric(metrics.la1030, pitchingEq.p_ncaa_avg_la_10_30_pct, pitchingEq.p_sd_la_10_30_pct, true),
    };

    const hasEraInputs = [scores.stuff, scores.whiff, scores.bb, scores.hh, scores.izWhiff, scores.chase, scores.barrel].every((v) => v != null);
    const hasWhipInputs = [scores.bb, scores.ld, scores.avgEv, scores.whiff, scores.gb, scores.chase].every((v) => v != null);
    const hasK9Inputs = [scores.whiff, scores.stuff, scores.izWhiff, scores.chase].every((v) => v != null);
    const hasBb9Inputs = [scores.bb, scores.iz, scores.chase].every((v) => v != null);
    const hasHr9Inputs = [scores.barrel, scores.ev90, scores.gb, scores.pull, scores.la1030].every((v) => v != null);

    const era = hasEraInputs
      ? (safe(scores.stuff)! * pitchingEq.p_era_stuff_plus_weight) +
        (safe(scores.whiff)! * pitchingEq.p_era_whiff_pct_weight) +
        (safe(scores.bb)! * pitchingEq.p_era_bb_pct_weight) +
        (safe(scores.hh)! * pitchingEq.p_era_hh_pct_weight) +
        (safe(scores.izWhiff)! * pitchingEq.p_era_in_zone_whiff_pct_weight) +
        (safe(scores.chase)! * pitchingEq.p_era_chase_pct_weight) +
        (safe(scores.barrel)! * pitchingEq.p_era_barrel_pct_weight)
      : null;
    const whip = hasWhipInputs
      ? normalizedWeightedSum([
          { value: safe(scores.bb)!, weight: pitchingEq.p_whip_bb_pct_weight },
          { value: safe(scores.ld)!, weight: pitchingEq.p_whip_ld_pct_weight },
          { value: safe(scores.avgEv)!, weight: pitchingEq.p_whip_avg_ev_weight },
          { value: safe(scores.whiff)!, weight: pitchingEq.p_whip_whiff_pct_weight },
          { value: safe(scores.gb)!, weight: pitchingEq.p_whip_gb_pct_weight },
          { value: safe(scores.chase)!, weight: pitchingEq.p_whip_chase_pct_weight },
        ])
      : null;
    const k9 = hasK9Inputs
      ? (safe(scores.whiff)! * pitchingEq.p_k9_whiff_pct_weight) +
        (safe(scores.stuff)! * pitchingEq.p_k9_stuff_plus_weight) +
        (safe(scores.izWhiff)! * pitchingEq.p_k9_in_zone_whiff_pct_weight) +
        (safe(scores.chase)! * pitchingEq.p_k9_chase_pct_weight)
      : null;
    const bb9 = hasBb9Inputs
      ? (safe(scores.bb ?? storedScores.bb)! * pitchingEq.p_bb9_bb_pct_weight) +
        (safe(scores.iz ?? storedScores.iz)! * pitchingEq.p_bb9_in_zone_pct_weight) +
        (safe(scores.chase ?? storedScores.chase)! * pitchingEq.p_bb9_chase_pct_weight)
      : null;
    const hr9 = hasHr9Inputs
      ? (safe(scores.barrel ?? storedScores.barrel)! * pitchingEq.p_hr9_barrel_pct_weight) +
        (safe(scores.ev90 ?? storedScores.ev90)! * pitchingEq.p_hr9_ev90_weight) +
        (safe(scores.gb ?? storedScores.gb)! * pitchingEq.p_hr9_gb_pct_weight) +
        (safe(scores.pull ?? storedScores.pull)! * pitchingEq.p_hr9_pull_pct_weight) +
        (safe(scores.la1030 ?? storedScores.la1030)! * pitchingEq.p_hr9_la_10_30_pct_weight)
      : null;

    const eraPlus = era == null ? null : (era / pitchingEq.p_era_ncaa_avg_power_rating) * 100;
    const whipPlus = whip == null ? null : (whip / pitchingEq.p_ncaa_avg_whip_power_rating) * 100;
    const k9Plus = k9 == null ? null : (k9 / pitchingEq.p_ncaa_avg_k9_power_rating) * 100;
    const bb9Plus = bb9 == null ? null : (bb9 / pitchingEq.p_ncaa_avg_bb9_power_rating) * 100;
    const hr9Plus = hr9 == null ? null : (hr9 / pitchingEq.p_ncaa_avg_hr9_power_rating) * 100;
    const fipPlus = hr9Plus == null || bb9Plus == null || k9Plus == null
      ? null
      : (hr9Plus * pitchingEq.p_fip_hr9_power_rating_plus_weight) +
        (bb9Plus * pitchingEq.p_fip_bb9_power_rating_plus_weight) +
        (k9Plus * pitchingEq.p_fip_k9_power_rating_plus_weight);
    const overallPlus =
      eraPlus == null || fipPlus == null || whipPlus == null || k9Plus == null || bb9Plus == null || hr9Plus == null
        ? null
        : (OVERALL_PITCHER_POWER_WEIGHTS.era * eraPlus) +
          (OVERALL_PITCHER_POWER_WEIGHTS.fip * fipPlus) +
          (OVERALL_PITCHER_POWER_WEIGHTS.whip * whipPlus) +
          (OVERALL_PITCHER_POWER_WEIGHTS.k9 * k9Plus) +
          (OVERALL_PITCHER_POWER_WEIGHTS.bb9 * bb9Plus) +
          (OVERALL_PITCHER_POWER_WEIGHTS.hr9 * hr9Plus);

    return { metrics, scores, eraPlus, whipPlus, k9Plus, bb9Plus, hr9Plus, fipPlus, overallPlus };
  }, [pitchingEq, powerRatingsRow]);

  const latestStats = useMemo(() => seasonStats[0] || null, [seasonStats]);
  // Use the same prediction picker TB uses (pickPreferredPrediction):
  //   1. Team-scoped precomputed row if effectiveTeamId is set + a precomputed
  //      row exists for that team.
  //   2. Otherwise the global returner-regular row (customer_team_id IS NULL).
  //   3. Last-resort any precomputed row.
  // Replaces the prior `predictions[0]` which was non-deterministic — Postgres
  // could return any of a player's 13 prediction rows (1 regular + 12
  // precomputed) first, so the displayed projection depended on row order.
  const activePrediction = useMemo(
    () => pickPreferredPrediction(predictions as any[], effectiveTeamId) ?? null,
    [predictions, effectiveTeamId],
  );
  const conferenceByTeam = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of teamDirectory as Array<{ name: string | null; conference: string | null; park_factor: number | null }>) {
      const key = normalize(row.name);
      if (!key || !row.conference) continue;
      if (!map.has(key)) map.set(key, row.conference);
    }
    return map;
  }, [teamDirectory]);
  const teamByName = useMemo(() => {
    const map = new Map<string, { name: string; conference: string | null; park_factor: number | null }>();
    for (const row of teamDirectory as Array<{ name: string | null; conference: string | null; park_factor: number | null }>) {
      const key = normalize(row.name);
      if (!key || !row.name) continue;
      if (!map.has(key)) map.set(key, { name: row.name, conference: row.conference, park_factor: row.park_factor });
    }
    return map;
  }, [teamDirectory]);
  // Lookup maps for career stats Team column display.
  // Prefer TeamID (holds Teams Table UUID id); fall back to aggressive name normalization.
  const teamAbbrevById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of teamDirectory as Array<{ id: string | null; source_team_id: string | number | null; abbreviation: string | null; fullName: string | null; name: string | null }>) {
      const abbrev = t.abbreviation || t.name || t.fullName;
      if (!abbrev) continue;
      if (t.id) map.set(String(t.id), abbrev);
      if (t.source_team_id != null) map.set(String(t.source_team_id), abbrev);
    }
    return map;
  }, [teamDirectory]);
  const teamAbbrevByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of teamDirectory as Array<{ name: string | null; fullName: string | null; abbreviation: string | null }>) {
      const abbrev = t.abbreviation || t.name || t.fullName;
      if (!abbrev) continue;
      const keys = [t.fullName, t.name, t.abbreviation].filter(Boolean) as string[];
      for (const k of keys) {
        const norm = normalize(k);
        if (norm && !map.has(norm)) map.set(norm, abbrev);
      }
    }
    return map;
  }, [teamDirectory]);
  const teamAbbrev = (name: string | null | undefined, teamId?: string | number | null): string => {
    if (teamId != null) {
      const byId = teamAbbrevById.get(String(teamId));
      if (byId) return byId;
    }
    if (!name) return "—";
    const hit = teamAbbrevByName.get(normalize(name));
    return hit || name;
  };
  const { parkMap: teamParkComponents } = useParkFactors();
  // Look up the most recent Pitching Master row by source_player_id as fallback
  const anyPitcherMasterRow = (pitcherMasterSeasons as any[])[0] || null;
  const fullName =
    `${player?.first_name || ""} ${player?.last_name || ""}`.trim() ||
    anyPitcherMasterRow?.playerFullName ||
    storageRef?.playerName ||
    "Pitcher";
  const displayTeam = normalizePitcherTeamName(player?.team || masterRow?.team || anyPitcherMasterRow?.Team || storageRef?.teamName || "") || "—";
  const { getOverride } = usePlayerOverrides();
  const playerOverride = isDbRoute && id ? getOverride(id) : null;
  const storageOverrideKey = useMemo(
    () => `${normalize(lookupPlayerName)}|${normalize(displayTeam)}`,
    [lookupPlayerName, displayTeam],
  );
  const storageProjectionOverride = useMemo(() => {
    if (isDbRoute) return undefined;
    try {
      const raw = localStorage.getItem(PITCHER_PROFILE_STORAGE_OVERRIDE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, { pitcher_role?: "SP" | "RP" | "SM"; class_transition?: "FS" | "SJ" | "JS" | "GR"; dev_aggressiveness?: number }>) : {};
      return parsed?.[storageOverrideKey];
    } catch {
      return undefined;
    }
  }, [isDbRoute, storageOverrideKey]);
  // Resolve conference: use conference_id from masterRow/team → conference stats lookup, or fall back to player.conference
  const displayConference = (() => {
    // Try masterRow conference_id → Conference Stats (returns abbreviation)
    const confId = masterRow?.conferenceId;
    if (confId && conferenceStatsByKey.get(confId)) {
      return conferenceStatsByKey.get(confId)!.conference;
    }
    // Try team's conference_id
    const teamRow = teamByName.get(normalize(displayTeam));
    if (teamRow && (teamRow as any).conference_id && conferenceStatsByKey.get((teamRow as any).conference_id)) {
      return conferenceStatsByKey.get((teamRow as any).conference_id)!.conference;
    }
    // Fall back to player conference, team conference, or any master row
    return player?.conference || masterRow?.conference || (anyPitcherMasterRow as any)?.Conference || conferenceByTeam.get(normalize(displayTeam)) || "—";
  })();
  const displayHandedness = player?.handedness || masterRow?.throwHand || (anyPitcherMasterRow as any)?.ThrowHand || storageRow?.[2] || "—";
  const confStatsRow = (() => {
    const confName = displayConference !== "—" ? displayConference : null;
    if (!confName) return null;
    return conferenceStatsByKey.get(confName.toLowerCase().trim()) || null;
  })();
  const displayClass = (() => {
    if (player?.class_year) return player.class_year;
    // Fall back to Pitching Master row's class_year (Presto upload populates
    // class_year on the master tables directly; players.class_year may be
    // empty until a synced backfill writes it).
    const fromMaster = (masterRow as any)?.class_year ?? null;
    if (fromMaster) return fromMaster;
    const seasons = (pitcherMasterSeasons as any[]).length;
    if (seasons >= 5) return "Gr";
    if (seasons === 4) return "Sr";
    if (seasons === 3) return "Jr";
    if (seasons === 2) return "So";
    if (seasons === 1) return "Fr";
    return null;
  })();
  // Projection source row: always the latest season (2026) with blending applied so
  // changing the Scouting Grades / Input Metrics dropdown does NOT move projections.
  // Projections represent 2027 expectation, always anchored to most recent actuals.
  const projectionSourceRow = useMemo(() => {
    const row = (pitcherMasterSeasons as any[]).find((r) => Number(r.Season) === 2026);
    if (!row) return masterRow;  // fallback: if no 2026 data, use whatever we have
    const combinedUsed = !!row.combined_used;
    return {
      era: combinedUsed ? (row.blended_era ?? row.ERA) : row.ERA,
      fip: combinedUsed ? (row.blended_fip ?? row.FIP) : row.FIP,
      whip: combinedUsed ? (row.blended_whip ?? row.WHIP) : row.WHIP,
      k9: combinedUsed ? (row.blended_k9 ?? row.K9) : row.K9,
      bb9: combinedUsed ? (row.blended_bb9 ?? row.BB9) : row.BB9,
      hr9: combinedUsed ? (row.blended_hr9 ?? row.HR9) : row.HR9,
      ip: combinedUsed ? (row.combined_ip ?? row.IP) : row.IP,
      combined_ip: row.combined_ip ?? null,
      g: row.G ?? null,
      gs: row.GS ?? null,
      role: row.Role ?? null,
      // Stored PR+ values (pipeline computed these from blended inputs when combined_used)
      era_pr_plus: row.era_pr_plus ?? null,
      fip_pr_plus: row.fip_pr_plus ?? null,
      whip_pr_plus: row.whip_pr_plus ?? null,
      k9_pr_plus: row.k9_pr_plus ?? null,
      bb9_pr_plus: row.bb9_pr_plus ?? null,
      hr9_pr_plus: row.hr9_pr_plus ?? null,
      overall_pr_plus: row.overall_pr_plus ?? null,
      p_rv_plus: row.p_rv_plus ?? null,
      // Scouting metrics — always blended when combined_used so risk/scouting reports
      // anchor on the 2025 blended sample regardless of historical dropdown selection
      stuffPlus: combinedUsed ? (row.blended_stuff_plus ?? row.stuff_plus) : row.stuff_plus,
      miss_pct: combinedUsed ? (row.blended_miss_pct ?? row.miss_pct) : row.miss_pct,
      bb_pct: combinedUsed ? (row.blended_bb_pct ?? row.bb_pct) : row.bb_pct,
      hard_hit_pct: combinedUsed ? (row.blended_hard_hit_pct ?? row.hard_hit_pct) : row.hard_hit_pct,
      in_zone_whiff_pct: combinedUsed ? (row.blended_in_zone_whiff_pct ?? row.in_zone_whiff_pct) : row.in_zone_whiff_pct,
      chase_pct: combinedUsed ? (row.blended_chase_pct ?? row.chase_pct) : row.chase_pct,
      barrel_pct: combinedUsed ? (row.blended_barrel_pct ?? row.barrel_pct) : row.barrel_pct,
      exit_vel: combinedUsed ? (row.blended_exit_vel ?? row.exit_vel) : row.exit_vel,
      ground_pct: combinedUsed ? (row.blended_ground_pct ?? row.ground_pct) : row.ground_pct,
      combined_used: combinedUsed,
    };
  }, [pitcherMasterSeasons, masterRow]);

  // Thin sample: current 2025 IP below the noise floor with no prior seasons to
  // blend in. Projections for these pitchers are speculative — flag with *.
  const isThinSample = isThinSamplePitcher(projectionSourceRow);

  // Read pitching stats from projectionSourceRow so projections stay pinned to 2025
  const storageEra = projectionSourceRow?.era ?? null;
  const storageFip = projectionSourceRow?.fip ?? null;
  const storageWhip = projectionSourceRow?.whip ?? null;
  const storageK9 = projectionSourceRow?.k9 ?? null;
  const storageBb9 = projectionSourceRow?.bb9 ?? null;
  const storageHr9 = projectionSourceRow?.hr9 ?? null;
  const storageIp = parseBaseballInnings(projectionSourceRow?.ip != null ? String(projectionSourceRow.ip) : null);
  const storageGames = projectionSourceRow?.g ?? null;
  const storageGamesStarted = projectionSourceRow?.gs ?? null;
  const derivedRole = (() => {
    const roleRaw = toPitchingRole(masterRow?.role);
    if (roleRaw) return roleRaw;
    if (storageGames != null && storageGames > 0 && storageGamesStarted != null) {
      return (storageGamesStarted / storageGames) < 0.5 ? "RP" : "SP";
    }
    return null;
  })();
  const supabaseRole = id ? getSupabaseRole(id) : null;
  // Role priority: manual override → stored prediction role (written by
  // precompute) → legacy localStorage override → derived from GS/G ratio →
  // SM fallback. Adding the stored prediction role keeps the profile in
  // sync with the precomputed pitcher_role so coaches don't have to toggle.
  const storedPredictionRole = (() => {
    const raw = (activePrediction as any)?.pitcher_role;
    return raw === "SP" || raw === "RP" || raw === "SM" ? (raw as "SP" | "RP" | "SM") : null;
  })();
  const initialProjectedRole = supabaseRole || storedPredictionRole || storageProjectionOverride?.pitcher_role || derivedRole || "SM";
  const effectiveRoleDisplay = supabaseRole || derivedRole;
  // Class transition is now auto-derived from class_year in createPredictionsFromMaster,
  // so the stored row is the source of truth. No UI editor — read it from the
  // active prediction (or fall back to SJ for the live-recompute fallback path).
  const projectedClassTransition: "FS" | "SJ" | "JS" | "GR" = (() => {
    const raw = String(activePrediction?.class_transition || playerOverride?.class_transition || storageProjectionOverride?.class_transition || "SJ").toUpperCase();
    return raw === "FS" || raw === "SJ" || raw === "JS" || raw === "GR" ? (raw as "FS" | "SJ" | "JS" | "GR") : "SJ";
  })();
  const initialProjectedDevAggressiveness = Number.isFinite(Number(activePrediction?.dev_aggressiveness))
    ? Number(activePrediction?.dev_aggressiveness)
    : (Number.isFinite(Number(playerOverride?.dev_aggressiveness ?? storageProjectionOverride?.dev_aggressiveness))
        ? Number(playerOverride?.dev_aggressiveness ?? storageProjectionOverride?.dev_aggressiveness)
        : 0);
  const [projectedRole, setProjectedRole] = useState<"SP" | "RP" | "SM">(initialProjectedRole as "SP" | "RP" | "SM");
  const [projectedDevAggressiveness, setProjectedDevAggressiveness] = useState<number>(initialProjectedDevAggressiveness);
  // Session-only depth role overlay. Prefer stored pitcher_depth_role (written
  // by the precompute worker / bulkRecalc); fall back to deriving from stored
  // pitcher_role + sample IP for older rows. Drives the displayed pWAR +
  // market_value via the depthRoles helpers.
  const initialDepthRole: PitcherDepthRole = (() => {
    const stored = (activePrediction as any)?.pitcher_depth_role;
    const validDepths: PitcherDepthRole[] = [
      "weekend_starter", "weekday_starter", "swing_starter",
      "workhorse_reliever", "high_leverage_reliever", "mid_leverage_reliever",
      "low_impact_reliever", "specialist_reliever",
    ];
    if (validDepths.includes(stored)) return stored as PitcherDepthRole;
    return defaultPitcherDepthRoleFromIp(
      storageIp,
      (effectiveRoleDisplay === "SP" || effectiveRoleDisplay === "RP") ? effectiveRoleDisplay : "RP",
    );
  })();
  const [depthRole, setDepthRole] = useState<PitcherDepthRole>(initialDepthRole);
  useEffect(() => {
    setProjectedRole(initialProjectedRole as "SP" | "RP" | "SM");
    setProjectedDevAggressiveness(initialProjectedDevAggressiveness);
    setDepthRole(initialDepthRole);
  }, [initialProjectedRole, initialProjectedDevAggressiveness, initialDepthRole]);
  // Session-only display overlay. Profile dropdowns (depth role, dev agg,
  // pitcher role) are NEVER persisted — the coach can preview "what if this
  // pitcher started weekends and was developed aggressively" without
  // touching stored values. To make any of these stick, the coach uses Team
  // Builder + target board.
  const updateProjectedInputs = async (updates: { pitcher_role?: "SP" | "RP" | "SM"; dev_aggressiveness?: number }) => {
    if (updates.pitcher_role) setProjectedRole(updates.pitcher_role);
    if (Number.isFinite(Number(updates.dev_aggressiveness))) setProjectedDevAggressiveness(Number(updates.dev_aggressiveness));
  };
  const projectedPitching = useMemo(() => {
    const eq = readPitchingWeights();
    const roleCurve = {
      tier1Max: eq.rp_to_sp_low_better_tier1_max,
      tier2Max: eq.rp_to_sp_low_better_tier2_max,
      tier3Max: eq.rp_to_sp_low_better_tier3_max,
      tier1Mult: eq.rp_to_sp_low_better_tier1_mult,
      tier2Mult: eq.rp_to_sp_low_better_tier2_mult,
      tier3Mult: eq.rp_to_sp_low_better_tier3_mult,
    };

    // Stored-first: prefer the team-scoped precomputed row whenever the
    // active customer team has one — that's the projection coaches want to see
    // ("what would this pitcher look like at our program"). Falls back to the
    // global returner row when no team-scoped row exists.
    const storedTeamRow = effectiveTeamId
      ? (predictions as any[]).find((p) => p.customer_team_id === effectiveTeamId && p.variant === "precomputed")
      : null;
    const storedReturnerRow = (predictions as any[]).find((p) => p.model_type === "returner" && p.variant === "regular" && p.customer_team_id == null);
    const stored = storedTeamRow ?? storedReturnerRow ?? null;

    const overlayIp = pitcherExpectedIp(depthRole, eq);
    const storedDevAgg = Number.isFinite(Number((stored as any)?.dev_aggressiveness)) ? Number((stored as any).dev_aggressiveness) : 0;
    const sessionDevAggNum = Number.isFinite(Number(projectedDevAggressiveness)) ? Number(projectedDevAggressiveness) : 0;
    const devAggDelta = (sessionDevAggNum - storedDevAgg) * 0.06;
    const devAggUnchanged = sessionDevAggNum === storedDevAgg;

    // Base role for transition math: prefer stored pitcher_role, fall back to
    // derivedRole (Pitching Master Role + G/GS heuristic) so the transition
    // fires even when the precompute didn't write pitcher_role.
    const validRole = (r: any): "SP" | "RP" | "SM" | null =>
      r === "SP" || r === "RP" || r === "SM" ? r : null;
    const storedRole = validRole((stored as any)?.pitcher_role) ?? validRole(derivedRole) ?? null;
    const sessionRole = validRole(projectedRole) ?? "RP";
    const roleChanged = storedRole != null && storedRole !== sessionRole;
    // Apply role transition first (mirrors transferPitcherProjection.ts lines 399-404)
    const rtEra = roleChanged ? applyRoleTransitionAdjustment(stored?.p_era ?? null, eq.sp_to_rp_reg_era_pct, storedRole, sessionRole, true, roleCurve) : (stored?.p_era ?? null);
    const rtFip = roleChanged ? applyRoleTransitionAdjustment(stored?.p_fip ?? null, eq.sp_to_rp_reg_fip_pct, storedRole, sessionRole, true, roleCurve) : (stored?.p_fip ?? null);
    const rtWhip = roleChanged ? applyRoleTransitionAdjustment(stored?.p_whip ?? null, eq.sp_to_rp_reg_whip_pct, storedRole, sessionRole, true, roleCurve) : (stored?.p_whip ?? null);
    const rtK9 = roleChanged ? applyRoleTransitionAdjustment(stored?.p_k9 ?? null, eq.sp_to_rp_reg_k9_pct, storedRole, sessionRole, false, roleCurve) : (stored?.p_k9 ?? null);
    const rtBb9 = roleChanged ? applyRoleTransitionAdjustment(stored?.p_bb9 ?? null, eq.sp_to_rp_reg_bb9_pct, storedRole, sessionRole, true, roleCurve) : (stored?.p_bb9 ?? null);
    const rtHr9 = roleChanged ? applyRoleTransitionAdjustment(stored?.p_hr9 ?? null, eq.sp_to_rp_reg_hr9_pct, storedRole, sessionRole, true, roleCurve) : (stored?.p_hr9 ?? null);

    // Re-derive pRV+ from role-adjusted rates (only when role changed; otherwise use stored)
    const rolePRvPlus = roleChanged && [rtEra, rtFip, rtWhip, rtK9, rtBb9, rtHr9].every((v) => v != null)
      ? (() => {
          const eraPlusRA = calcPitchingPlus(rtEra, eq.era_plus_ncaa_avg, eq.era_plus_ncaa_sd, eq.era_plus_scale, false);
          const fipPlusRA = calcPitchingPlus(rtFip, eq.fip_plus_ncaa_avg, eq.fip_plus_ncaa_sd, eq.fip_plus_scale, false);
          const whipPlusRA = calcPitchingPlus(rtWhip, eq.whip_plus_ncaa_avg, eq.whip_plus_ncaa_sd, eq.whip_plus_scale, false);
          const k9PlusRA = calcPitchingPlus(rtK9, eq.k9_plus_ncaa_avg, eq.k9_plus_ncaa_sd, eq.k9_plus_scale, true);
          const bb9PlusRA = calcPitchingPlus(rtBb9, eq.bb9_plus_ncaa_avg, eq.bb9_plus_ncaa_sd, eq.bb9_plus_scale, false);
          const hr9PlusRA = calcPitchingPlus(rtHr9, eq.hr9_plus_ncaa_avg, eq.hr9_plus_ncaa_sd, eq.hr9_plus_scale, false);
          if ([eraPlusRA, fipPlusRA, whipPlusRA, k9PlusRA, bb9PlusRA, hr9PlusRA].some((v) => v == null)) return stored?.p_rv_plus ?? null;
          return (Number(eraPlusRA) * eq.era_plus_weight)
            + (Number(fipPlusRA) * eq.fip_plus_weight)
            + (Number(whipPlusRA) * eq.whip_plus_weight)
            + (Number(k9PlusRA) * eq.k9_plus_weight)
            + (Number(bb9PlusRA) * eq.bb9_plus_weight)
            + (Number(hr9PlusRA) * eq.hr9_plus_weight);
        })()
      : (stored?.p_rv_plus ?? null);

    const overlayPRvPlus = rolePRvPlus == null
      ? null
      : devAggUnchanged
        ? rolePRvPlus
        : 100 + ((rolePRvPlus - 100) * (1 + devAggDelta));
    // PlayerProfile pattern: stored × overlayScale, no `noOverlay` branch.
    // overlayScale is a single multiplier built from IP ratio (depth knob) +
    // devAgg ratio + role-transition PVF ratio. When all knobs match stored,
    // every ratio defaults to 1, so the displayed values equal stored. As
    // soon as the coach moves a knob, the corresponding ratio shifts and
    // the displayed pWAR + market_value update accordingly.
    const newRoleBucket = pitcherRoleFromDepthRole(depthRole);
    const storedRoleBucket = (storedRole as "SP" | "RP" | "SM" | null) ?? newRoleBucket;
    const storedProjectedIp = Number((stored as any)?.projected_ip);
    const ipScale = Number.isFinite(storedProjectedIp) && storedProjectedIp > 0
      ? overlayIp / storedProjectedIp
      : 1;
    const pvfStored = getPitchingPvfForRole(storedRoleBucket, eq);
    const pvfNew = getPitchingPvfForRole(newRoleBucket, eq);
    const pvfRatio = pvfStored > 0 ? pvfNew / pvfStored : 1;
    const devAggScale = devAggUnchanged ? 1 : (1 + devAggDelta);
    const overlayScale = ipScale * pvfRatio * devAggScale;
    const overlayPWar = stored?.p_war != null ? Number(stored.p_war) * overlayScale : null;
    // TWP-aware: for is_twp=true rows, stored.market_value is NULL by design;
    // pull from twp_pitcher_market_value via the helper. Non-TWPs unchanged.
    const storedPitcherMv = pickPitcherMarketValue(stored as any, !!(player as any)?.is_twp);
    const overlayMarketValue = storedPitcherMv != null ? storedPitcherMv * overlayScale : null;
    const scaleLow = (v: number | null | undefined) =>
      v == null ? null : devAggUnchanged ? v : v * (1 - devAggDelta);
    const scaleHigh = (v: number | null | undefined) =>
      v == null ? null : devAggUnchanged ? v : v * (1 + devAggDelta);

    return {
      pEra: scaleLow(rtEra),
      pFip: scaleLow(rtFip),
      pWhip: scaleLow(rtWhip),
      pK9: scaleHigh(rtK9),
      pBb9: scaleLow(rtBb9),
      pHr9: scaleLow(rtHr9),
      pRvPlus: overlayPRvPlus,
      pWar: overlayPWar,
      marketValue: overlayMarketValue,
      projectedIp: overlayIp,
      // Stored scouting scores from the picked prediction row — read the
      // domain-scoped pitcher_*_score columns first (canonical source after
      // 2026-06-03 split migration), fall back to legacy columns for rows
      // written before propagation function was updated.
      whiffScore: (stored as any)?.pitcher_whiff_score ?? (stored as any)?.whiff_score ?? null,
      bbScore: (stored as any)?.pitcher_bb_score ?? (stored as any)?.bb_score ?? null,
      barrelScore: (stored as any)?.pitcher_barrel_score ?? (stored as any)?.barrel_score ?? null,
    };
  }, [
    projectedDevAggressiveness,
    depthRole,
    displayConference,
    derivedRole,
    projectedRole,
    predictions,
    effectiveTeamId,
    displayTeam,
  ]);

  const pitching2025 = useMemo(() => {
    const eq = readPitchingWeights();
    const era2025 = latestStats?.era ?? storageEra;
    const fip2025 = storageFip;
    const whip2025 = latestStats?.whip ?? storageWhip;
    const k92025 = storageK9;
    const bb92025 = storageBb9;
    const hr92025 = storageHr9;

    const eraPlus = calcPitchingPlus(era2025, eq.era_plus_ncaa_avg, eq.era_plus_ncaa_sd, eq.era_plus_scale);
    const fipPlus = calcPitchingPlus(fip2025, eq.fip_plus_ncaa_avg, eq.fip_plus_ncaa_sd, eq.fip_plus_scale);
    const whipPlus = calcPitchingPlus(whip2025, eq.whip_plus_ncaa_avg, eq.whip_plus_ncaa_sd, eq.whip_plus_scale);
    const k9Plus = calcPitchingPlus(k92025, eq.k9_plus_ncaa_avg, eq.k9_plus_ncaa_sd, eq.k9_plus_scale, true);
    const bb9Plus = calcPitchingPlus(bb92025, eq.bb9_plus_ncaa_avg, eq.bb9_plus_ncaa_sd, eq.bb9_plus_scale);
    const hr9Plus = calcPitchingPlus(hr92025, eq.hr9_plus_ncaa_avg, eq.hr9_plus_ncaa_sd, eq.hr9_plus_scale);
    const pRvPlus2025 = [eraPlus, fipPlus, whipPlus, k9Plus, bb9Plus, hr9Plus].every((v) => v != null)
      ? (Number(eraPlus) * eq.era_plus_weight) +
        (Number(fipPlus) * eq.fip_plus_weight) +
        (Number(whipPlus) * eq.whip_plus_weight) +
        (Number(k9Plus) * eq.k9_plus_weight) +
        (Number(bb9Plus) * eq.bb9_plus_weight) +
        (Number(hr9Plus) * eq.hr9_plus_weight)
      : null;
    const pWar2025 = pRvPlus2025 == null || storageIp == null || eq.pwar_runs_per_win === 0
      ? null
      : (((((pRvPlus2025 - 100) / 100) * (storageIp / 9) * eq.pwar_r_per_9) + ((storageIp / 9) * eq.pwar_replacement_runs_per_9)) / eq.pwar_runs_per_win);

    return { pRvPlus2025, pWar2025 };
  }, [
    latestStats?.era,
    latestStats?.whip,
    storageBb9,
    storageEra,
    storageFip,
    storageHr9,
    storageK9,
    storageWhip,
  ]);
  const pitchArsenal = useMemo(() => {
    const sourceRows = pitchArsenalRows || [];

    const normalized = sourceRows
      .map((row) => {
        const totalAll = row.total_pitches_all == null ? null : Number(row.total_pitches_all);
        const pitchCount = row.total_pitches == null ? null : Number(row.total_pitches);
        const usagePct = pitchCount != null && totalAll != null && totalAll > 0 ? (pitchCount / totalAll) * 100 : null;
        return {
          pitchType: String(row.pitch_type || "").trim().toUpperCase(),
          hand: row.hand ?? null,
          stuffPlus: row.stuff_plus == null ? null : Number(row.stuff_plus),
          usagePct,
          whiffPct: row.whiff_pct == null ? null : Number(row.whiff_pct),
          pitchCount,
          totalPitches: totalAll,
          overallStuffPlus: row.overall_stuff_plus == null ? null : Number(row.overall_stuff_plus),
        };
      })
      .filter((r) => r.pitchType.length > 0 && (r.pitchCount == null || r.pitchCount >= 5))
      .filter((r) => r.usagePct == null || r.usagePct >= 5);

    const byPitch = new Map<string, typeof normalized[number]>();
    for (const row of normalized) byPitch.set(row.pitchType, row);
    const sorted = Array.from(byPitch.values()).sort((a, b) => {
      const ai = PITCH_DISPLAY_ORDER.indexOf(a.pitchType as any);
      const bi = PITCH_DISPLAY_ORDER.indexOf(b.pitchType as any);
      const aOrder = ai === -1 ? 999 : ai;
      const bOrder = bi === -1 ? 999 : bi;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return (b.pitchCount || 0) - (a.pitchCount || 0);
    });

    const maxTotalPitches = sorted.reduce<number | null>((acc, row) => {
      if (row.totalPitches == null || !Number.isFinite(row.totalPitches)) return acc;
      if (acc == null) return row.totalPitches;
      return Math.max(acc, row.totalPitches);
    }, null);
    const overallStuffPlus =
      sorted.find((r) => r.overallStuffPlus != null)?.overallStuffPlus ??
      (() => {
        const valid = sorted.filter((r) => r.stuffPlus != null && r.usagePct != null);
        if (valid.length === 0) return null;
        const weighted = valid.reduce((sum, row) => sum + Number(row.stuffPlus) * Number(row.usagePct), 0);
        const usage = valid.reduce((sum, row) => sum + Number(row.usagePct), 0);
        if (!Number.isFinite(usage) || usage <= 0) return null;
        return weighted / usage;
      })();
    const usageTotal = sorted.reduce((sum, row) => sum + (row.usagePct || 0), 0);
    const overallWhiffPct = (() => {
      const valid = sorted.filter((r) => r.whiffPct != null && r.usagePct != null);
      if (valid.length === 0) return null;
      const weighted = valid.reduce((sum, row) => sum + Number(row.whiffPct) * Number(row.usagePct), 0);
      const usage = valid.reduce((sum, row) => sum + Number(row.usagePct), 0);
      if (!Number.isFinite(usage) || usage <= 0) return null;
      return weighted / usage;
    })();

    return { rows: sorted, overallStuffPlus, usageTotal: usageTotal > 0 ? usageTotal : null, overallWhiffPct, totalPitches: maxTotalPitches };
  }, [pitchArsenalRows]);

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="p-6 text-muted-foreground">Loading pitcher profile…</div>
      </DashboardLayout>
    );
  }

  const activePitcherRow = (effectiveSeason !== 2026) ? historicalRow : currentPitcherRow;
  const currentIp = (currentPitcherRow as any)?.IP;
  if (currentPitcherRow != null && (currentIp == null || Number(currentIp) === 0)) {
    return (
      <DashboardLayout>
        <div className="p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h2 className="text-2xl font-bold tracking-tight">
              {player?.first_name} {player?.last_name}
            </h2>
          </div>
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No pitching stats available.
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto">
        {id && <PlayerPageTabs playerId={id} kind="pitcher" />}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              const returnTo = (location.state as { returnTo?: string } | null)?.returnTo;
              if (returnTo) {
                navigate(returnTo);
                return;
              }
              navigate(-1);
            }}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h2 className="text-2xl font-bold tracking-tight">{fullName}</h2>
            {hasHittingData && (
              <Button
                variant="outline"
                size="sm"
                className="mt-1 mb-1"
                onClick={() => navigate(`/dashboard/player/${id}`)}
              >
                View Hitting Profile →
              </Button>
            )}
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge variant="outline">{displayTeam}</Badge>
              <Badge variant="outline" className="text-muted-foreground">{displayConference}</Badge>
              <Badge variant="secondary">{displayHandedness === "R" ? "RHP" : displayHandedness === "L" ? "LHP" : displayHandedness}</Badge>
              {player && (player as any).is_twp && (
                <Badge
                  variant="outline"
                  className="text-[10px] font-semibold uppercase tracking-wider border-[#D4AF37]/40 bg-[#D4AF37]/10 text-[#D4AF37]"
                  title="Two-way player — also appears in the hitter pool"
                >
                  TWP
                </Badge>
              )}
              {player && (
                <>
                  <PortalStatusBadge
                    player={player as any}
                    isAdmin={isAdmin}
                    onSave={(fields) => updatePortalStatus.mutateAsync({ playerId: player.id, ...fields })}
                  />
                  <PortalContactButton player={player as any} />
                  <MarketPayLogButton playerId={player?.id ?? null} />
                </>
              )}
              {combinedUsed && (
                <Badge
                  variant="outline"
                  className="text-[10px] font-semibold uppercase tracking-wider"
                  title={`Projection blends ${combinedSeasonsLabel} (${combinedIp} IP total)`}
                >
                  Combined: {combinedSeasonsLabel} ({combinedIp} IP)
                </Badge>
              )}
            </div>
          </div>
          {player && (
            <>
              <CoachNotes
                playerId={player.id}
                playerName={`${player.first_name || ""} ${player.last_name || ""}`.trim() || lookupPlayerName}
                onExportPdf={(notes, format, mode = "download") => {
                  const hand = displayHandedness === "R" ? "RHP" : displayHandedness === "L" ? "LHP" : effectiveRoleDisplay || "P";
                  if (format === "full") {
                    const rp: ReportPlayer = {
                      id: player.id,
                      player_type: "pitcher",
                      ai_scouting_report: aiScoutingReport?.body ?? null,
                      pitcher_role: effectiveRoleDisplay || null,
                      name: `${player.first_name || ""} ${player.last_name || ""}`.trim() || lookupPlayerName,
                      school: displayTeam,
                      position: hand,
                      class_year: displayClass || undefined,
                      bats_throws: player.throws_hand ? `${player.throws_hand}/${player.throws_hand}` : undefined,
                      conference: displayConference !== "—" ? displayConference : undefined,
                      height: player.height_inches ? `${Math.floor(player.height_inches / 12)}'${player.height_inches % 12}"` : undefined,
                      weight: player.weight,
                      hometown: [player.home_state, player.high_school].filter(Boolean).join(", ") || undefined,
                      p_era: projectedPitching.pEra, p_fip: projectedPitching.pFip,
                      p_whip: projectedPitching.pWhip, p_k9: projectedPitching.pK9,
                      p_bb9: projectedPitching.pBb9, p_hr9: projectedPitching.pHr9,
                      p_war: projectedPitching.pWar,
                      p_rv_plus: projectedPitching.pRvPlus,
                      market_value: projectedPitching.marketValue,
                      nil_value: projectedPitching.marketValue,
                      overall_pr_plus: internalPowerRatings?.overallPlus,
                      stuff_plus: (masterRow as any)?.stuffPlus ?? pitchArsenal.overallStuffPlus,
                      whiff_pct: (masterRow as any)?.miss_pct ?? pitchArsenal.overallWhiffPct,
                      // Stf+ stays client-computed until next computeAndStoreScores
                      // populates stuff_score. Other 3 read from pred (1=1).
                      stuff_score: internalPowerRatings?.scores?.stuff,
                      whiff_score: projectedPitching.whiffScore ?? null,
                      bb_score: projectedPitching.bbScore ?? null,
                      barrel_score: projectedPitching.barrelScore ?? null,
                      career_seasons: pitcherMasterSeasons as any[],
                      pitches: pitchArsenal.rows.map((r) => ({
                        pitch_name: r.pitchType, usage: r.usagePct,
                        whiff: r.whiffPct, stuff_plus: r.stuffPlus,
                      })),
                      scouting_notes: (() => {
                        if ((player as any).notes) return (player as any).notes;
                        const pitchesForReport = pitchArsenal.rows.map((r) => ({
                          name: r.pitchType || "",
                          count: r.count ?? null,
                          velocity: r.velocity ?? null,
                          ivb: r.ivb ?? null,
                          hb: r.hb ?? null,
                          whiffPct: r.whiffPct ?? null,
                          stuffPlus: r.stuffPlus ?? null,
                          relHeight: r.relHeight ?? null,
                          extension: r.extension ?? null,
                          vaa: r.vaa ?? null,
                        }));
                        return generatePitcherReport({
                          throwHand: (masterRow as any)?.throwHand || player?.throws_hand || displayHandedness,
                          role: effectiveRoleDisplay || (masterRow as any)?.role,
                          conference: displayConference !== "—" ? displayConference : undefined,
                          era: (masterRow as any)?.era, fip: (masterRow as any)?.fip,
                          whip: (masterRow as any)?.whip, k9: (masterRow as any)?.k9,
                          bb9: (masterRow as any)?.bb9, hr9: (masterRow as any)?.hr9,
                          ip: (masterRow as any)?.combined_ip ?? (masterRow as any)?.ip ?? (masterRow as any)?.IP,
                          stuffPlus: (projectionSourceRow as any)?.stuffPlus ?? (masterRow as any)?.stuffPlus ?? pitchArsenal.overallStuffPlus,
                          whiffPct: (projectionSourceRow as any)?.miss_pct ?? (masterRow as any)?.miss_pct ?? pitchArsenal.overallWhiffPct,
                          izWhiffPct: (projectionSourceRow as any)?.in_zone_whiff_pct ?? internalPowerRatings?.metrics?.izWhiff,
                          chasePct: (projectionSourceRow as any)?.chase_pct ?? internalPowerRatings?.metrics?.chase,
                          bbPct: (projectionSourceRow as any)?.bb_pct ?? internalPowerRatings?.metrics?.bb,
                          hardHitPct: (projectionSourceRow as any)?.hard_hit_pct ?? internalPowerRatings?.metrics?.hh,
                          barrelPct: (projectionSourceRow as any)?.barrel_pct ?? internalPowerRatings?.metrics?.barrel,
                          exitVel: (projectionSourceRow as any)?.exit_vel ?? internalPowerRatings?.metrics?.avgEv,
                          gbPct: (projectionSourceRow as any)?.ground_pct ?? internalPowerRatings?.metrics?.gb,
                          pitches: pitchesForReport,
                        }, "rstriq", "full");
                      })(),
                      coach_notes: notes,
                    };
                    const prvForRisk = computePrvPlus(
                      (historicalRow as any)?.era_pr_plus ?? null,
                      (historicalRow as any)?.fip_pr_plus ?? null,
                      (historicalRow as any)?.whip_pr_plus ?? null,
                      (historicalRow as any)?.k9_pr_plus ?? null,
                      (historicalRow as any)?.bb9_pr_plus ?? null,
                      (historicalRow as any)?.hr9_pr_plus ?? null,
                    );
                    const riskResult = assessPitcherRisk({
                      conference: displayConference !== "—" ? displayConference : undefined,
                      projectedPrvPlus: prvForRisk,
                      confHitterTalentPlus: confStatsRow?.overall_power_rating != null && confStatsRow?.stuff_plus != null && confStatsRow?.wrc_plus != null
                        ? confStatsRow.overall_power_rating + (1.25 * (confStatsRow.stuff_plus - 100)) + (0.75 * (100 - confStatsRow.wrc_plus))
                        : null,
                      careerSeasons: pitcherMasterSeasons as any[],
                      ip: (masterRow as any)?.combined_ip ?? (masterRow as any)?.ip ?? (masterRow as any)?.IP ?? null,
                      classYear: displayClass || undefined,
                      stuffPlus: (projectionSourceRow as any)?.stuffPlus ?? (masterRow as any)?.stuffPlus ?? pitchArsenal.overallStuffPlus,
                      whiffPct: (projectionSourceRow as any)?.miss_pct ?? (masterRow as any)?.miss_pct ?? pitchArsenal.overallWhiffPct,
                      bbPct: (projectionSourceRow as any)?.bb_pct ?? internalPowerRatings?.metrics?.bb,
                      chase: (projectionSourceRow as any)?.chase_pct ?? internalPowerRatings?.metrics?.chase,
                      barrel: (projectionSourceRow as any)?.barrel_pct ?? internalPowerRatings?.metrics?.barrel,
                      hardHit: (projectionSourceRow as any)?.hard_hit_pct ?? internalPowerRatings?.metrics?.hh,
                      gb: (projectionSourceRow as any)?.ground_pct ?? internalPowerRatings?.metrics?.gb,
                    });
                    rp.risk_grade = riskResult.grade;
                    rp.risk_score = riskResult.overall;
                    rp.risk_trajectory = riskResult.trajectory;
                    rp.risk_summary = riskResult.summary;
                    rp.risk_factors = riskResult.factors.map((f) => ({ label: f.label, score: f.score, detail: f.detail }));
                    const url = generateReportPdf([rp]);
                    if (mode === "preview") {
                      window.open(url, "_blank");
                    } else {
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = `${(player.first_name || "").replace(/\s+/g, "")}_${(player.last_name || "").replace(/\s+/g, "")}_Scouting_Report.pdf`;
                      link.click();
                    }
                  } else {
                    const rp: ReportPlayer = {
                      id: player.id,
                      player_type: "pitcher",
                      ai_scouting_report: aiScoutingReport?.body ?? null,
                      pitcher_role: effectiveRoleDisplay || null,
                      name: `${player.first_name || ""} ${player.last_name || ""}`.trim() || lookupPlayerName,
                      school: displayTeam,
                      position: hand,
                      class_year: displayClass || undefined,
                      conference: displayConference !== "—" ? displayConference : undefined,
                      p_era: projectedPitching.pEra, p_fip: projectedPitching.pFip,
                      p_whip: projectedPitching.pWhip, p_k9: projectedPitching.pK9,
                      p_bb9: projectedPitching.pBb9, p_hr9: projectedPitching.pHr9,
                      p_war: projectedPitching.pWar,
                      p_rv_plus: projectedPitching.pRvPlus,
                      overall_pr_plus: internalPowerRatings?.overallPlus,
                      coach_notes: notes,
                    };
                    const url = generateCoachNotesPdf(rp, notes);
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
                    addToHighFollow({ playerId: player.id, playerType: "pitcher" });
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
                  const hand = displayHandedness === "R" ? "RHP" : displayHandedness === "L" ? "LHP" : effectiveRoleDisplay || "P";
                  const rp: ReportPlayer = {
                    id: player.id,
                    player_type: "pitcher",
                    ai_scouting_report: aiScoutingReport?.body ?? null,
                    name: `${player.first_name || ""} ${player.last_name || ""}`.trim() || lookupPlayerName,
                    school: displayTeam,
                    position: hand,
                    class_year: displayClass || undefined,
                    bats_throws: player.throws_hand ? `${player.throws_hand}/${player.throws_hand}` : undefined,
                    // Bio
                    conference: displayConference !== "—" ? displayConference : undefined,
                    height: player.height_inches ? `${Math.floor(player.height_inches / 12)}'${player.height_inches % 12}"` : undefined,
                    weight: player.weight,
                    hometown: [player.home_state, player.high_school].filter(Boolean).join(", ") || undefined,
                    // Projected
                    p_era: projectedPitching.pEra, p_fip: projectedPitching.pFip,
                    p_whip: projectedPitching.pWhip, p_k9: projectedPitching.pK9,
                    p_bb9: projectedPitching.pBb9, p_hr9: projectedPitching.pHr9,
                    p_war: projectedPitching.pWar,
                    p_rv_plus: projectedPitching.pRvPlus,
                    // Valuation
                    market_value: projectedPitching.marketValue,
                    nil_value: projectedPitching.marketValue,
                    overall_pr_plus: internalPowerRatings?.overallPlus,
                    // Scouting scores
                    stuff_plus: (masterRow as any)?.stuffPlus ?? pitchArsenal.overallStuffPlus,
                    whiff_pct: (masterRow as any)?.miss_pct ?? pitchArsenal.overallWhiffPct,
                    // Stf+ stays client-computed until next computeAndStoreScores
                    // populates stuff_score. Other 3 read from pred (1=1).
                    stuff_score: internalPowerRatings?.scores?.stuff,
                    whiff_score: projectedPitching.whiffScore ?? null,
                    bb_score: projectedPitching.bbScore ?? null,
                    barrel_score: projectedPitching.barrelScore ?? null,
                    // Scouting grades (20-80 for PDF) — derive from scores
                    grade_fb: internalPowerRatings?.scores?.stuff != null ? Math.min(80, Math.max(20, Math.round(internalPowerRatings.scores.stuff))) : undefined,
                    grade_ctrl: internalPowerRatings?.scores?.bb != null ? Math.min(80, Math.max(20, Math.round(internalPowerRatings.scores.bb))) : undefined,
                    grade_cmd: internalPowerRatings?.scores?.whiff != null ? Math.min(80, Math.max(20, Math.round(internalPowerRatings.scores.whiff))) : undefined,
                    grade_del: undefined,
                    grade_proj: undefined,
                    grade_ofp: internalPowerRatings?.overallPlus != null ? Math.min(80, Math.max(20, Math.round(internalPowerRatings.overallPlus / 2.5 + 20))) : undefined,
                    // Data
                    career_seasons: pitcherMasterSeasons as any[],
                    pitches: pitchArsenal.rows.map((r) => ({
                      pitch_name: r.pitchType, usage: r.usagePct,
                      whiff: r.whiffPct, stuff_plus: r.stuffPlus,
                    })),
                    scouting_notes: (() => {
                      if ((player as any).notes) return (player as any).notes;
                      const pitchesForReport = pitchArsenal.rows.map((r) => ({
                        name: r.pitchType || "",
                        count: r.count ?? null,
                        velocity: r.velocity ?? null,
                        ivb: r.ivb ?? null,
                        hb: r.hb ?? null,
                        whiffPct: r.whiffPct ?? null,
                        stuffPlus: r.stuffPlus ?? null,
                        relHeight: r.relHeight ?? null,
                        extension: r.extension ?? null,
                        vaa: r.vaa ?? null,
                      }));
                      return generatePitcherReport({
                        throwHand: (masterRow as any)?.throwHand || player?.throws_hand || displayHandedness,
                        role: effectiveRoleDisplay || (masterRow as any)?.role,
                        conference: displayConference !== "—" ? displayConference : undefined,
                        era: (masterRow as any)?.era, fip: (masterRow as any)?.fip,
                        whip: (masterRow as any)?.whip, k9: (masterRow as any)?.k9,
                        bb9: (masterRow as any)?.bb9, hr9: (masterRow as any)?.hr9,
                        ip: (masterRow as any)?.combined_ip ?? (masterRow as any)?.ip ?? (masterRow as any)?.IP,
                        stuffPlus: (projectionSourceRow as any)?.stuffPlus ?? (masterRow as any)?.stuffPlus ?? pitchArsenal.overallStuffPlus,
                        whiffPct: (projectionSourceRow as any)?.miss_pct ?? (masterRow as any)?.miss_pct ?? pitchArsenal.overallWhiffPct,
                        izWhiffPct: (projectionSourceRow as any)?.in_zone_whiff_pct ?? internalPowerRatings?.metrics?.izWhiff,
                        chasePct: (projectionSourceRow as any)?.chase_pct ?? internalPowerRatings?.metrics?.chase,
                        bbPct: (projectionSourceRow as any)?.bb_pct ?? internalPowerRatings?.metrics?.bb,
                        hardHitPct: (projectionSourceRow as any)?.hard_hit_pct ?? internalPowerRatings?.metrics?.hh,
                        barrelPct: (projectionSourceRow as any)?.barrel_pct ?? internalPowerRatings?.metrics?.barrel,
                        exitVel: (projectionSourceRow as any)?.exit_vel ?? internalPowerRatings?.metrics?.avgEv,
                        gbPct: (projectionSourceRow as any)?.ground_pct ?? internalPowerRatings?.metrics?.gb,
                        pitches: pitchesForReport,
                      }, "rstriq", "full");
                    })(),
                  };
                  // Attach risk assessment
                  const prvForRisk = computePrvPlus(
                    (historicalRow as any)?.era_pr_plus ?? null,
                    (historicalRow as any)?.fip_pr_plus ?? null,
                    (historicalRow as any)?.whip_pr_plus ?? null,
                    (historicalRow as any)?.k9_pr_plus ?? null,
                    (historicalRow as any)?.bb9_pr_plus ?? null,
                    (historicalRow as any)?.hr9_pr_plus ?? null,
                  );
                  const riskResult = assessPitcherRisk({
                    conference: displayConference !== "—" ? displayConference : undefined,
                    projectedPrvPlus: prvForRisk,
                    confHitterTalentPlus: confStatsRow?.overall_power_rating != null && confStatsRow?.stuff_plus != null && confStatsRow?.wrc_plus != null
                      ? confStatsRow.overall_power_rating + (1.25 * (confStatsRow.stuff_plus - 100)) + (0.75 * (100 - confStatsRow.wrc_plus))
                      : null,
                    careerSeasons: pitcherMasterSeasons as any[],
                    ip: (masterRow as any)?.combined_ip ?? (masterRow as any)?.ip ?? (masterRow as any)?.IP ?? null,
                    classYear: displayClass || undefined,
                    stuffPlus: (projectionSourceRow as any)?.stuffPlus ?? (masterRow as any)?.stuffPlus ?? pitchArsenal.overallStuffPlus,
                    whiffPct: (projectionSourceRow as any)?.miss_pct ?? (masterRow as any)?.miss_pct ?? pitchArsenal.overallWhiffPct,
                    bbPct: (projectionSourceRow as any)?.bb_pct ?? internalPowerRatings?.metrics?.bb,
                    chase: (projectionSourceRow as any)?.chase_pct ?? internalPowerRatings?.metrics?.chase,
                    barrel: (projectionSourceRow as any)?.barrel_pct ?? internalPowerRatings?.metrics?.barrel,
                    hardHit: (projectionSourceRow as any)?.hard_hit_pct ?? internalPowerRatings?.metrics?.hh,
                    gb: (projectionSourceRow as any)?.ground_pct ?? internalPowerRatings?.metrics?.gb,
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
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-1 space-y-4">
            <Card className="border-[#162241] bg-[#0a1428]">
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-sm font-semibold tracking-wide uppercase text-[#D4AF37]" style={{ fontFamily: "Oswald, sans-serif" }}>Pitcher Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5 text-sm px-4 pb-4">
                {[
                  ["Team", displayTeam],
                  ["Conference", displayConference],
                  ["Class", displayClass || "—"],
                  ["Role", effectiveRoleDisplay || "—"],
                  ["Throws", player?.throws_hand || displayHandedness || "—"],
                ].map(([label, val]) => (
                  <div key={label} className="flex items-center justify-between border-b border-[#162241]/40 pb-1.5 last:border-0 last:pb-0">
                    <span className="text-xs uppercase tracking-wider text-[#8a94a6]">{label}</span>
                    <span className="font-semibold text-slate-100">{val}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            {(() => {
              const sp = (masterRow as any)?.stuffPlus ?? pitchArsenal.overallStuffPlus;
              const combinedUsedForOverview = !!(masterRow as any)?.combined_used;
              const wp = combinedUsedForOverview
                ? (pitchArsenal.overallWhiffPct ?? (masterRow as any)?.miss_pct ?? null)
                : ((masterRow as any)?.miss_pct ?? pitchArsenal.overallWhiffPct);
              const hasArsenal = pitchArsenal.rows.length > 0;
              const hasAnySignal = sp != null || wp != null || hasArsenal;
              if (!hasAnySignal) {
                // No TrackMan capture at all — render a single full-width N/A
                // card instead of hiding the section entirely. Common for the
                // ~79% of JUCO arms without per-pitch data.
                return (
                  <Card className="border-[#162241] bg-[#0a1428]">
                    <CardHeader className="pb-1 pt-3 px-4">
                      <CardTitle className="text-sm font-semibold tracking-wide uppercase text-[#D4AF37]" style={{ fontFamily: "Oswald, sans-serif" }}>Stuff+ Overview</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                      <div className="rounded-lg border border-[#162241] bg-[#0d1a30] p-4 text-center min-h-[94px] flex flex-col justify-center">
                        <div className="text-[11px] uppercase tracking-wider font-semibold text-[#8a94a6]">Stuff+</div>
                        <div className="text-3xl font-bold tracking-tight mt-1 text-[#8a94a6]">N/A</div>
                        <div className="text-[10px] text-[#5a6478] mt-1">No TrackMan capture for this pitcher</div>
                      </div>
                    </CardContent>
                  </Card>
                );
              }
              return null;
            })()}

            {pitchArsenal.rows.length > 0 && (
              <Card className="border-[#162241] bg-[#0a1428]">
                <CardHeader className="pb-1 pt-3 px-4">
                  <CardTitle className="text-sm font-semibold tracking-wide uppercase text-[#D4AF37]" style={{ fontFamily: "Oswald, sans-serif" }}>Stuff+ Overview</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="grid grid-cols-2 gap-3">
                    {(() => {
                      const sp = (masterRow as any)?.stuffPlus ?? pitchArsenal.overallStuffPlus;
                      const tierStyle = sp == null ? { border: "#162241", bg: "#0d1a30", text: "#8a94a6" }
                        : sp >= 103 ? { border: "hsl(142,71%,45%,0.3)", bg: "hsl(142,71%,45%,0.12)", text: "hsl(142,71%,35%)" }
                        : sp >= 98 ? { border: "hsl(200,80%,50%,0.3)", bg: "hsl(200,80%,50%,0.12)", text: "hsl(200,80%,35%)" }
                        : sp >= 93 ? { border: "hsl(var(--warning)/0.3)", bg: "hsl(var(--warning)/0.15)", text: "hsl(var(--warning))" }
                        : { border: "hsl(0,72%,51%,0.3)", bg: "hsl(0,72%,51%,0.12)", text: "hsl(0,72%,41%)" };
                      return (
                        <div className="rounded-lg border p-4 text-center" style={{ borderColor: tierStyle.border, backgroundColor: tierStyle.bg }}>
                          <div className="text-[11px] uppercase tracking-wider font-semibold text-[#8a94a6]">Stuff+</div>
                          <div className="text-3xl font-bold tracking-tight mt-1" style={{ color: tierStyle.text }}>{sp == null ? "N/A" : Math.round(sp).toString()}</div>
                          <div className="text-[10px] text-[#5a6478] mt-1">Avg: 100</div>
                        </div>
                      );
                    })()}
                    {(() => {
                      // For pullback pitchers (combined_used), prefer arsenal-derived whiff% which is blend-aware.
                      const combinedUsedForOverview = !!(masterRow as any)?.combined_used;
                      const wp = combinedUsedForOverview
                        ? (pitchArsenal.overallWhiffPct ?? (masterRow as any)?.miss_pct ?? null)
                        : ((masterRow as any)?.miss_pct ?? pitchArsenal.overallWhiffPct);
                      const tierStyle = wp == null ? { border: "#162241", bg: "#0d1a30", text: "#8a94a6" }
                        : wp >= 27 ? { border: "hsl(142,71%,45%,0.3)", bg: "hsl(142,71%,45%,0.12)", text: "hsl(142,71%,35%)" }
                        : wp >= 21 ? { border: "hsl(200,80%,50%,0.3)", bg: "hsl(200,80%,50%,0.12)", text: "hsl(200,80%,35%)" }
                        : wp >= 16 ? { border: "hsl(var(--warning)/0.3)", bg: "hsl(var(--warning)/0.15)", text: "hsl(var(--warning))" }
                        : { border: "hsl(0,72%,51%,0.3)", bg: "hsl(0,72%,51%,0.12)", text: "hsl(0,72%,41%)" };
                      return (
                        <div className="rounded-lg border p-4 text-center" style={{ borderColor: tierStyle.border, backgroundColor: tierStyle.bg }}>
                          <div className="text-[11px] uppercase tracking-wider font-semibold text-[#8a94a6]">Whiff%</div>
                          <div className="text-3xl font-bold tracking-tight mt-1" style={{ color: tierStyle.text }}>{wp == null ? "—" : `${wp.toFixed(1)}%`}</div>
                          <div className="text-[10px] text-[#5a6478] mt-1">Avg: 22.9%</div>
                        </div>
                      );
                    })()}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Career Stats Table */}
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
                        <th className="text-right py-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">IP</th>
                        <th className="text-right py-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">ERA</th>
                        <th className="text-right py-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">FIP</th>
                        <th className="text-right py-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">WHIP</th>
                        <th className="text-right py-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">K/9</th>
                        <th className="text-right py-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">BB/9</th>
                        <th className="text-right py-1.5 pl-1 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">HR/9</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(pitcherMasterSeasons as any[])
                        .sort((a, b) => Number(a.Season) - Number(b.Season))
                        .map((row: any, i: number) => (
                        <tr key={row.Season} className={`border-b border-[#162241]/60 last:border-0 transition-colors duration-150 hover:bg-[#162241]/40 ${i % 2 === 1 ? "bg-[#0d1a30]" : ""}`}>
                          <td className="py-1.5 pr-1 font-semibold text-white">{row.Season}</td>
                          <td className="py-1.5 px-1 text-[#8a94a6] truncate max-w-[60px]">{teamAbbrev(row.Team, row.TeamID)}</td>
                          <td className="py-1.5 px-1 text-right tabular-nums text-slate-200">{fmt(row.IP, 1)}</td>
                          <td className="py-1.5 px-1 text-right tabular-nums text-slate-200">{fmt(row.ERA, 2)}</td>
                          <td className="py-1.5 px-1 text-right tabular-nums text-slate-200">{fmt(row.FIP, 2)}</td>
                          <td className="py-1.5 px-1 text-right tabular-nums text-slate-200">{fmt(row.WHIP, 2)}</td>
                          <td className="py-1.5 px-1 text-right tabular-nums text-slate-200">{fmt(row.K9, 1)}</td>
                          <td className="py-1.5 px-1 text-right tabular-nums text-slate-200">{fmt(row.BB9, 1)}</td>
                          <td className="py-1.5 pl-1 text-right tabular-nums text-slate-200">{fmt(row.HR9, 1)}</td>
                        </tr>
                      ))}
                      {(pitcherMasterSeasons as any[]).length > 1 && (() => {
                        const rows = pitcherMasterSeasons as any[];
                        const totalIp = rows.reduce((s, r) => s + (Number(r.IP) || 0), 0);
                        if (totalIp === 0) return null;
                        const wAvg = (field: string) => {
                          let sv = 0, sw = 0;
                          for (const r of rows) { const v = Number(r[field]); const w = Number(r.IP) || 0; if (Number.isFinite(v) && w > 0) { sv += v * w; sw += w; } }
                          return sw > 0 ? sv / sw : null;
                        };
                        return (
                          <tr className={`border-t border-[#D4AF37]/30 ${rows.length % 2 === 1 ? "bg-[#0d1a30]" : ""}`}>
                            <td className="py-1.5 pr-1 font-bold text-[#D4AF37]">Career</td>
                            <td className="py-1.5 px-1"></td>
                            <td className="py-1.5 px-1 text-right tabular-nums font-semibold text-white">{fmt(totalIp, 1)}</td>
                            <td className="py-1.5 px-1 text-right tabular-nums font-semibold text-white">{fmt(wAvg("ERA"), 2)}</td>
                            <td className="py-1.5 px-1 text-right tabular-nums font-semibold text-white">{fmt(wAvg("FIP"), 2)}</td>
                            <td className="py-1.5 px-1 text-right tabular-nums font-semibold text-white">{fmt(wAvg("WHIP"), 2)}</td>
                            <td className="py-1.5 px-1 text-right tabular-nums font-semibold text-white">{fmt(wAvg("K9"), 1)}</td>
                            <td className="py-1.5 px-1 text-right tabular-nums font-semibold text-white">{fmt(wAvg("BB9"), 1)}</td>
                            <td className="py-1.5 pl-1 text-right tabular-nums font-semibold text-white">{fmt(wAvg("HR9"), 1)}</td>
                          </tr>
                        );
                      })()}
                    </tbody>
                  </table>
              </CardContent>
            </Card>

            {/* MLB Draft slot — left column, between Career Stats and Portal Move */}
            {slotValueRow && (
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-[#162241] bg-[#0d1a30] p-4 text-center min-h-[94px] flex flex-col justify-center">
                  <div className="text-[11px] uppercase tracking-wider font-semibold text-[#8a94a6]">{slotValueRow.draft_year} Draft Rank</div>
                  <div className="text-2xl font-bold tracking-tight mt-1 leading-tight text-white">
                    {slotValueRow.rank != null ? `#${slotValueRow.rank}` : "—"}
                  </div>
                </div>
                <div className="rounded-lg border border-[#162241] bg-[#0d1a30] p-4 text-center min-h-[94px] flex flex-col justify-center">
                  <div className="text-[11px] uppercase tracking-wider font-semibold text-[#8a94a6]">Draft Slot Value</div>
                  <div className="text-2xl font-bold tracking-tight mt-1 leading-tight text-[#D4AF37]">
                    ${Math.round(slotValueRow.slot_value).toLocaleString()}
                  </div>
                </div>
              </div>
            )}

            {/* Portal Move — same compact card style as Career Stats */}
            {player && (player.transfer_portal || ["IN PORTAL", "COMMITTED", "WITHDRAWN"].includes(String((player as any).portal_status || "").toUpperCase())) && (
              <PortalTeamCards player={player as any} />
            )}

            {player && (
              <ABSComparisonTable
                sourcePlayerId={(player as any).source_player_id ?? null}
                playerType="pitcher"
              />
            )}

            {isAdmin && internalPowerRatings ? (
              <Card className="border-[#162241] bg-[#0a1428]">
                <CardHeader className="pt-3 px-4 pb-2">
                  <CardTitle className="text-sm font-semibold tracking-wide uppercase text-[#D4AF37] flex items-center gap-2" style={{ fontFamily: "Oswald, sans-serif" }}>
                    Internal Power Ratings
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wide border-[#D4AF37]/30 text-[#D4AF37]/70">Admin</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 px-4 pb-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                    {[
                      ["Overall PR+", internalPowerRatings?.overallPlus],
                      ["ERA PR+", internalPowerRatings?.eraPlus],
                      ["WHIP PR+", internalPowerRatings?.whipPlus],
                      ["K/9 PR+", internalPowerRatings?.k9Plus],
                      ["BB/9 PR+", internalPowerRatings?.bb9Plus],
                      ["HR/9 PR+", internalPowerRatings?.hr9Plus],
                      ["FIP PR+", internalPowerRatings?.fipPlus],
                    ].map(([label, val]) => (
                      <div key={label as string} className="rounded-lg border border-[#162241] bg-[#0d1a30] p-3">
                        <div className="text-[10px] uppercase tracking-wider font-semibold text-[#8a94a6]">{label as string}</div>
                        <div className="text-3xl font-bold tracking-tight mt-1 text-white tabular-nums">{fmtWhole(val as number | null | undefined)}</div>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-[#162241] pt-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#8a94a6] mb-3">2025 Input Metrics</p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                      {[
                        ["Stuff+", internalPowerRatings?.metrics.stuff],
                        ["Whiff%", internalPowerRatings?.metrics.whiff],
                        ["BB%", internalPowerRatings?.metrics.bb],
                        ["HH%", internalPowerRatings?.metrics.hh],
                        ["IZ Whiff%", internalPowerRatings?.metrics.izWhiff],
                        ["Chase%", internalPowerRatings?.metrics.chase],
                        ["Barrel%", internalPowerRatings?.metrics.barrel],
                        ["LD%", internalPowerRatings?.metrics.ld],
                        ["Avg EV", internalPowerRatings?.metrics.avgEv],
                        ["GB%", internalPowerRatings?.metrics.gb],
                        ["IZ%", internalPowerRatings?.metrics.iz],
                        ["EV90", internalPowerRatings?.metrics.ev90],
                        ["Pull%", internalPowerRatings?.metrics.pull],
                        ["LA 10-30%", internalPowerRatings?.metrics.la1030],
                      ].map(([label, val]) => (
                        <div key={label as string} className="rounded-lg border border-[#162241] bg-[#0d1a30] p-3">
                          <div className="text-[10px] uppercase tracking-wider font-semibold text-[#8a94a6]">{label as string}</div>
                          <div className="font-semibold text-2xl mt-1 text-slate-100 tabular-nums">{fmt(val as number | null | undefined, 1)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : null}

          </div>

          <div className="lg:col-span-2 space-y-4">
            <div className="grid gap-3 grid-cols-3">
              <div className="rounded-lg border border-[#162241] bg-[#0a1428] p-4 text-center">
                <div className="text-[11px] uppercase tracking-wider font-semibold text-[#8a94a6]">pWAR</div>
                <div className="text-3xl font-bold tracking-tight mt-1 text-white">{fmt(projectedPitching.pWar, 2)}</div>
              </div>
              <div className="rounded-lg border border-[#162241] bg-[#0a1428] p-4 text-center">
                <div className="text-[11px] uppercase tracking-wider font-semibold text-[#8a94a6]">Market Value</div>
                <div className="text-2xl font-bold tracking-tight mt-1 text-[#D4AF37]">{nilFormat(projectedPitching.marketValue ?? nilValuation?.projected_value ?? null)}</div>
              </div>
              <div className="rounded-lg border border-[#162241] bg-[#0a1428] p-4 text-center">
                <div className="text-[11px] uppercase tracking-wider font-semibold text-[#8a94a6]">Power Rating</div>
                <div className="text-3xl font-bold tracking-tight mt-1 text-white">{fmtWhole(internalPowerRatings?.overallPlus)}</div>
              </div>
            </div>

            {(() => {
              // 2026-05-24: JUCO branch removed. JUCO arms now have populated
              // player_predictions rows (returner-regular = 2026 verbatim per
              // Option A, precomputed = team-scoped transfer projection from
              // eager precompute). The D1 path below reads from `stored` via
              // projectedPitching, which handles both correctly.
              return (
                <Card className="border-[#162241] bg-[#0a1428]">
                  <CardHeader className="pb-2 pt-3 px-4">
                    <div className="flex items-center gap-3 flex-wrap">
                      <CardTitle className="text-sm font-semibold tracking-wide uppercase text-[#D4AF37] flex items-center gap-2" style={{ fontFamily: "Oswald, sans-serif" }}><TrendingUp className="h-4 w-4" />2027 Projected Stats{isThinSample ? "*" : ""}</CardTitle>
                      <div className="flex items-center gap-1.5">
                        <Select value={projectedRole === "SM" ? "SP" : projectedRole} onValueChange={(v) => {
                          const newRole = v as "SP" | "RP";
                          updateProjectedInputs({ pitcher_role: newRole });
                          // Snap depth role into the new role's allowed set
                          const spDepths: PitcherDepthRole[] = ["weekend_starter", "weekday_starter", "swing_starter"];
                          const rpDepths: PitcherDepthRole[] = ["swing_starter", "workhorse_reliever", "high_leverage_reliever", "mid_leverage_reliever", "low_impact_reliever", "specialist_reliever"];
                          const allowed = newRole === "SP" ? spDepths : rpDepths;
                          if (!allowed.includes(depthRole)) {
                            setDepthRole(newRole === "SP" ? "weekend_starter" : "high_leverage_reliever");
                          }
                        }}>
                          <SelectTrigger className="h-7 w-[65px] text-xs border-[#162241] bg-[#0d1a30] text-slate-200"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="SP">SP</SelectItem>
                            <SelectItem value="RP">RP</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select value={depthRole} onValueChange={(v) => setDepthRole(v as PitcherDepthRole)}>
                          <SelectTrigger className="h-7 w-[160px] text-xs border-[#162241] bg-[#0d1a30] text-slate-200" title="Depth role — session-only display overlay; not saved"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {projectedRole === "SP" ? (
                              <>
                                <SelectItem value="weekend_starter">Weekend Starter</SelectItem>
                                <SelectItem value="weekday_starter">Weekday Starter</SelectItem>
                                <SelectItem value="swing_starter">Swing Starter</SelectItem>
                              </>
                            ) : (
                              <>
                                <SelectItem value="swing_starter">Swing Starter</SelectItem>
                                <SelectItem value="workhorse_reliever">Workhorse Reliever</SelectItem>
                                <SelectItem value="high_leverage_reliever">High-Leverage Reliever</SelectItem>
                                <SelectItem value="mid_leverage_reliever">Mid-Leverage Reliever</SelectItem>
                                <SelectItem value="low_impact_reliever">Low-Impact Reliever</SelectItem>
                                <SelectItem value="specialist_reliever">Specialist Reliever</SelectItem>
                              </>
                            )}
                          </SelectContent>
                        </Select>
                        <Select value={String(projectedDevAggressiveness)} onValueChange={(v) => updateProjectedInputs({ dev_aggressiveness: Number(v) })}>
                          <SelectTrigger className="h-7 w-[65px] text-xs border-[#162241] bg-[#0d1a30] text-slate-200"><SelectValue /></SelectTrigger>
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
                    <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                      {[
                        ["ERA", fmt(projectedPitching.pEra, 2)],
                        ["FIP", fmt(projectedPitching.pFip, 2)],
                        ["WHIP", fmt(projectedPitching.pWhip, 2)],
                        ["K/9", fmt(projectedPitching.pK9, 2)],
                        ["BB/9", fmt(projectedPitching.pBb9, 2)],
                        ["HR/9", fmt(projectedPitching.pHr9, 2)],
                      ].map(([label, val]) => (
                        <div key={label} className="rounded-lg border border-[#162241] bg-[#0d1a30] p-3 text-center">
                          <div className="text-[10px] uppercase tracking-wider font-semibold text-[#8a94a6]">{label}</div>
                          <div className="text-xl font-bold mt-0.5 text-white tabular-nums">{val}</div>
                        </div>
                      ))}
                    </div>
                    {isThinSample && (
                      <p className="mt-2 text-[10px] text-[#8a94a6]">*thin sample — fewer than 5 IP with no prior-season data; projection is speculative</p>
                    )}
                  </CardContent>
                </Card>
              );
            })()}

            <Card className="border-[#162241] bg-[#0a1428]">
              <CardHeader className="pb-2 pt-3 px-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold tracking-wide uppercase text-[#D4AF37]" style={{ fontFamily: "Oswald, sans-serif" }}>Scouting Grades</CardTitle>
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
                <div className="grid grid-cols-4 gap-2">
                  <ScoutGrade value={internalPowerRatings?.scores?.stuff ?? null} fullLabel="Stuff+" />
                  <ScoutGrade value={internalPowerRatings?.scores?.whiff ?? null} fullLabel="Whiff%" />
                  <ScoutGrade value={internalPowerRatings?.scores?.bb ?? null} fullLabel="BB%" />
                  <ScoutGrade value={internalPowerRatings?.scores?.barrel ?? null} fullLabel="Barrel%" />
                </div>
              </CardContent>
            </Card>

            {pitchArsenal.rows.length > 0 && (
              <Card className="border-[#162241] bg-[#0a1428]">
                <CardHeader className="pb-1 pt-3 px-4">
                  <CardTitle className="text-sm font-semibold tracking-wide uppercase text-[#D4AF37]" style={{ fontFamily: "Oswald, sans-serif" }}>Pitch Arsenal</CardTitle>
                  {arsenalCombineSeasons.combined && (
                    <div className="text-[10px] text-white/50 italic mt-0.5">*combined {arsenalCombineSeasons.label} metrics</div>
                  )}
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <table className="w-full text-sm" style={{ fontFamily: "Inter, sans-serif" }}>
                    <thead>
                      <tr className="border-b border-[#162241]">
                        <th className="text-left py-1.5 pr-3 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">Pitch</th>
                        <th className="text-right py-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">Usage</th>
                        <th className="text-right py-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">Whiff%</th>
                        <th className="text-right py-1.5 pl-2 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">Stuff+</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pitchArsenal.rows.map((row, i) => {
                        const wp = row.whiffPct;
                        const pt = row.pitchType;
                        const isFB = pt === "4S FB" || pt === "SINKER" || pt === "4-SEAM" || pt === "FOUR-SEAM" || pt === "SI" || pt === "FF";
                        const isCutter = pt === "CUTTER" || pt === "FC" || pt === "CT";
                        const isBreaking = pt === "SLIDER" || pt === "CURVEBALL" || pt === "SWEEPER" || pt === "GYRO SLIDER" || pt === "SL" || pt === "CB" || pt === "CU" || pt === "SW";
                        const isOffspeed = pt === "CHANGE-UP" || pt === "SPLITTER" || pt === "CH" || pt === "FS" || pt === "CHANGEUP";
                        const [wGreen, wBlue, wYellow] = isFB ? [22, 15, 10] : isCutter ? [30, 20, 14] : isBreaking ? [38, 28, 20] : isOffspeed ? [40, 30, 20] : [35, 25, 18];
                        const whiffColor = wp == null ? "text-[#8a94a6]" : wp >= wGreen ? "text-[hsl(142,71%,35%)]" : wp >= wBlue ? "text-[hsl(200,80%,35%)]" : wp >= wYellow ? "text-[hsl(var(--warning))]" : "text-[hsl(0,72%,41%)]";
                        const sp = row.stuffPlus;
                        const stuffColor = sp == null ? "text-[#8a94a6]" : sp >= 103 ? "text-[hsl(142,71%,35%)]" : sp >= 98 ? "text-[hsl(200,80%,35%)]" : sp >= 93 ? "text-[hsl(var(--warning))]" : "text-[hsl(0,72%,41%)]";
                        return (
                          <tr key={`arsenal-${row.pitchType}`} className={`border-b border-[#162241]/60 last:border-0 transition-colors duration-150 hover:bg-[#162241]/40 ${i % 2 === 1 ? "bg-[#0d1a30]" : ""}`}>
                            <td className="py-2 pr-3 font-semibold text-slate-100">{PITCH_TYPE_LABELS[row.pitchType] || row.pitchType}</td>
                            <td className="py-2 px-2 text-right tabular-nums text-[#8a94a6]">{row.usagePct == null ? "—" : `${row.usagePct.toFixed(1)}%`}</td>
                            <td className={`py-2 px-2 text-right tabular-nums font-bold ${whiffColor}`}>{wp == null ? "—" : `${wp.toFixed(1)}%`}</td>
                            <td className={`py-2 pl-2 text-right tabular-nums font-bold ${stuffColor}`}>{sp == null ? "N/A" : Math.round(sp).toString()}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}

            {/* Risk Assessment */}
            {(() => {
              const prvForRisk = computePrvPlus(
                (historicalRow as any)?.era_pr_plus ?? null,
                (historicalRow as any)?.fip_pr_plus ?? null,
                (historicalRow as any)?.whip_pr_plus ?? null,
                (historicalRow as any)?.k9_pr_plus ?? null,
                (historicalRow as any)?.bb9_pr_plus ?? null,
                (historicalRow as any)?.hr9_pr_plus ?? null,
              );
              const confHTP = confStatsRow?.overall_power_rating != null && confStatsRow?.stuff_plus != null && confStatsRow?.wrc_plus != null
                ? confStatsRow.overall_power_rating + (1.25 * (confStatsRow.stuff_plus - 100)) + (0.75 * (100 - confStatsRow.wrc_plus))
                : null;
              const isJucoSrc = (masterRow as any)?.division === "NJCAA_D1";

              if (isJucoSrc) {
                // JUCO profile — slimmed 5-factor JUCO risk card (same as TP sim).
                // Trajectory / Sample Size / Workload / Durability dropped; Stuff+
                // shows arsenal-quality tier (N/A if no TrackMan).
                return <JucoPitcherRiskCard input={{
                  projectedPrvPlus: prvForRisk,
                  stuffPlus: (projectionSourceRow as any)?.stuffPlus ?? (masterRow as any)?.stuffPlus ?? pitchArsenal.overallStuffPlus,
                  missPct: (projectionSourceRow as any)?.miss_pct ?? (masterRow as any)?.miss_pct ?? pitchArsenal.overallWhiffPct,
                  bbPct: (projectionSourceRow as any)?.bb_pct ?? internalPowerRatings?.metrics?.bb ?? null,
                  chasePct: (projectionSourceRow as any)?.chase_pct ?? internalPowerRatings?.metrics?.chase ?? null,
                  barrelPct: (projectionSourceRow as any)?.barrel_pct ?? internalPowerRatings?.metrics?.barrel ?? null,
                  hardHitPct: (projectionSourceRow as any)?.hard_hit_pct ?? internalPowerRatings?.metrics?.hh ?? null,
                  groundPct: (projectionSourceRow as any)?.ground_pct ?? internalPowerRatings?.metrics?.gb ?? null,
                  inZoneWhiffPct: (projectionSourceRow as any)?.in_zone_whiff_pct ?? internalPowerRatings?.metrics?.izWhiff ?? null,
                  k9: (masterRow as any)?.k9 ?? (masterRow as any)?.K9 ?? null,
                  bb9: (masterRow as any)?.bb9 ?? (masterRow as any)?.BB9 ?? null,
                  hr9: (masterRow as any)?.hr9 ?? (masterRow as any)?.HR9 ?? null,
                  trackmanPitches: (masterRow as any)?.trackman_pitches ?? 0,
                  bf: (masterRow as any)?.bf ?? null,
                  sourceConference: displayConference !== "—" ? displayConference : null,
                  sourceHitterTalentPlus: confHTP,
                }} />;
              }

              const risk = assessPitcherRisk({
                conference: displayConference !== "—" ? displayConference : undefined,
                projectedPrvPlus: prvForRisk,
                confHitterTalentPlus: confHTP,
                careerSeasons: pitcherMasterSeasons as any[],
                ip: (masterRow as any)?.combined_ip ?? (masterRow as any)?.ip ?? (masterRow as any)?.IP ?? null, classYear: displayClass || undefined,
                stuffPlus: (projectionSourceRow as any)?.stuffPlus ?? (masterRow as any)?.stuffPlus ?? pitchArsenal.overallStuffPlus,
                whiffPct: (projectionSourceRow as any)?.miss_pct ?? (masterRow as any)?.miss_pct ?? pitchArsenal.overallWhiffPct,
                bbPct: (projectionSourceRow as any)?.bb_pct ?? internalPowerRatings?.metrics?.bb,
                chase: (projectionSourceRow as any)?.chase_pct ?? internalPowerRatings?.metrics?.chase,
                barrel: (projectionSourceRow as any)?.barrel_pct ?? internalPowerRatings?.metrics?.barrel,
                hardHit: (projectionSourceRow as any)?.hard_hit_pct ?? internalPowerRatings?.metrics?.hh,
                gb: (projectionSourceRow as any)?.ground_pct ?? internalPowerRatings?.metrics?.gb,
                izWhiff: (projectionSourceRow as any)?.in_zone_whiff_pct ?? internalPowerRatings?.metrics?.izWhiff,
              });
              return <RiskAssessmentCardRSTR risk={risk} />;
            })()}

            {/* Scouting Report */}
            {(() => {
              const pitchesForReport = pitchArsenal.rows.map((r) => ({
                name: r.pitchType || "",
                count: r.count ?? null,
                velocity: r.velocity ?? null,
                ivb: r.ivb ?? null,
                hb: r.hb ?? null,
                whiffPct: r.whiffPct ?? null,
                stuffPlus: r.stuffPlus ?? null,
                relHeight: r.relHeight ?? null,
                extension: r.extension ?? null,
                vaa: r.vaa ?? null,
              }));

              const report = generatePitcherReport({
                throwHand: (masterRow as any)?.throwHand || player?.throws_hand || displayHandedness,
                role: effectiveRoleDisplay || (masterRow as any)?.role,
                conference: displayConference !== "—" ? displayConference : undefined,
                era: (masterRow as any)?.era, fip: (masterRow as any)?.fip,
                whip: (masterRow as any)?.whip, k9: (masterRow as any)?.k9,
                bb9: (masterRow as any)?.bb9, hr9: (masterRow as any)?.hr9,
                ip: (masterRow as any)?.combined_ip ?? (masterRow as any)?.ip ?? (masterRow as any)?.IP,
                stuffPlus: (projectionSourceRow as any)?.stuffPlus ?? (masterRow as any)?.stuffPlus ?? pitchArsenal.overallStuffPlus,
                whiffPct: (projectionSourceRow as any)?.miss_pct ?? (masterRow as any)?.miss_pct ?? pitchArsenal.overallWhiffPct,
                izWhiffPct: (projectionSourceRow as any)?.in_zone_whiff_pct ?? internalPowerRatings?.metrics?.izWhiff,
                chasePct: (projectionSourceRow as any)?.chase_pct ?? internalPowerRatings?.metrics?.chase,
                bbPct: (projectionSourceRow as any)?.bb_pct ?? internalPowerRatings?.metrics?.bb,
                hardHitPct: (projectionSourceRow as any)?.hard_hit_pct ?? internalPowerRatings?.metrics?.hh,
                barrelPct: (projectionSourceRow as any)?.barrel_pct ?? internalPowerRatings?.metrics?.barrel,
                exitVel: (projectionSourceRow as any)?.exit_vel ?? internalPowerRatings?.metrics?.avgEv,
                gbPct: (projectionSourceRow as any)?.ground_pct ?? internalPowerRatings?.metrics?.gb,
                pitches: pitchesForReport,
              }, "rstriq", "short");

              return (
                <Card className="border-[#162241] bg-[#0a1428]">
                  <CardHeader className="pb-2 pt-3 px-4">
                    <CardTitle className="text-sm font-semibold tracking-wide uppercase text-[#D4AF37]" style={{ fontFamily: "Oswald, sans-serif" }}>
                      Scouting Report
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    {aiScoutingReport?.body ? (
                      <AiScoutingReportBody body={aiScoutingReport.body} generatedAt={aiScoutingReport.generated_at} />
                    ) : (
                      <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">{report}</p>
                    )}
                  </CardContent>
                </Card>
              );
            })()}

          </div>
        </div>

      </div>
    </DashboardLayout>
  );
}

// ─── Historical Pitcher View ─────────────────────────────────────────
function HistoricalPitcherView({
  row, season, isAdmin,
}: {
  row: any | null;
  season: number;
  isAdmin: boolean;
}) {
  if (!row) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No {season} season data available for this pitcher.
        </CardContent>
      </Card>
    );
  }
  const fmt = (v: number | null | undefined, d = 2) => v == null ? "—" : Number(v).toFixed(d);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Left: pitcher info */}
      <div className="lg:col-span-1 space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{season} Season</CardTitle>
            <CardDescription className="text-xs">Actual stats and scouting grades</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Team</span><span className="text-sm font-semibold">{row.Team || "—"}</span></div>
            <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Conference</span><span className="text-sm font-semibold">{row.Conference || "—"}</span></div>
            <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Throws</span><span className="text-sm font-semibold">{row.ThrowHand || "—"}</span></div>
            <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">IP</span><span className="text-sm font-semibold tabular-nums">{row.IP == null ? "—" : Number(row.IP).toFixed(1)}</span></div>
            <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">G</span><span className="text-sm font-semibold tabular-nums">{row.G ?? "—"}</span></div>
            <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">GS</span><span className="text-sm font-semibold tabular-nums">{row.GS ?? "—"}</span></div>
          </CardContent>
        </Card>
      </div>

      {/* Middle + right: stats and scouting */}
      <div className="lg:col-span-2 space-y-4">
        {/* Headline pitching stats */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{season} Pitching Stats</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">ERA</div>
                <div className="text-2xl font-bold mt-1 tabular-nums">{fmt(row.ERA)}</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">FIP</div>
                <div className="text-2xl font-bold mt-1 tabular-nums">{fmt(row.FIP)}</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">WHIP</div>
                <div className="text-2xl font-bold mt-1 tabular-nums">{fmt(row.WHIP)}</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">K/9</div>
                <div className="text-2xl font-bold mt-1 tabular-nums">{fmt(row.K9)}</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">BB/9</div>
                <div className="text-2xl font-bold mt-1 tabular-nums">{fmt(row.BB9)}</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">HR/9</div>
                <div className="text-2xl font-bold mt-1 tabular-nums">{fmt(row.HR9)}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Scouting grades — public 4 + admin extras (mirrors hitter profile) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{season} Scouting Grades</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <HistoricalPitcherGrade value={row.whiff_score} fullLabel="Whiff%" />
              <HistoricalPitcherGrade value={row.bb_score} fullLabel="BB%" />
              <HistoricalPitcherGrade value={row.barrel_score} fullLabel="Barrel%" />
              <HistoricalPitcherGrade value={row.hh_score} fullLabel="Hard Hit%" />
            </div>
            {isAdmin && (
              <>
                <Separator className="my-4" />
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm font-semibold text-primary">Internal Power Ratings</span>
                  <Badge variant="outline" className="text-xs">Admin Only</Badge>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                  <div className="rounded-lg border border-border bg-muted/50 p-3">
                    <div className="text-xs font-medium text-muted-foreground">Overall PR+</div>
                    <div className="text-2xl font-bold font-mono mt-1">{row.overall_pr_plus != null ? Math.round(row.overall_pr_plus) : "—"}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/50 p-3">
                    <div className="text-xs font-medium text-muted-foreground">ERA PR+</div>
                    <div className="text-2xl font-bold font-mono mt-1">{row.era_pr_plus != null ? Math.round(row.era_pr_plus) : "—"}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/50 p-3">
                    <div className="text-xs font-medium text-muted-foreground">FIP PR+</div>
                    <div className="text-2xl font-bold font-mono mt-1">{row.fip_pr_plus != null ? Math.round(row.fip_pr_plus) : "—"}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/50 p-3">
                    <div className="text-xs font-medium text-muted-foreground">WHIP PR+</div>
                    <div className="text-2xl font-bold font-mono mt-1">{row.whip_pr_plus != null ? Math.round(row.whip_pr_plus) : "—"}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/50 p-3">
                    <div className="text-xs font-medium text-muted-foreground">K/9 PR+</div>
                    <div className="text-2xl font-bold font-mono mt-1">{row.k9_pr_plus != null ? Math.round(row.k9_pr_plus) : "—"}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/50 p-3">
                    <div className="text-xs font-medium text-muted-foreground">BB/9 PR+</div>
                    <div className="text-2xl font-bold font-mono mt-1">{row.bb9_pr_plus != null ? Math.round(row.bb9_pr_plus) : "—"}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/50 p-3">
                    <div className="text-xs font-medium text-muted-foreground">HR/9 PR+</div>
                    <div className="text-2xl font-bold font-mono mt-1">{row.hr9_pr_plus != null ? Math.round(row.hr9_pr_plus) : "—"}</div>
                  </div>
                </div>
                <Separator className="my-4" />
                <div className="text-xs font-medium text-muted-foreground mb-3">{season} Input Metrics</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                  <PitchInputMetric label="Whiff %" value={row.miss_pct} suffix="%" />
                  <PitchInputMetric label="Chase %" value={row.chase_pct} suffix="%" />
                  <PitchInputMetric label="In-Zone Whiff %" value={row.in_zone_whiff_pct} suffix="%" />
                  <PitchInputMetric label="BB %" value={row.bb_pct} suffix="%" />
                  <PitchInputMetric label="Barrel %" value={row.barrel_pct} suffix="%" />
                  <PitchInputMetric label="Hard Hit %" value={row.hard_hit_pct} suffix="%" />
                  <PitchInputMetric label="Avg Exit Velo" value={row.exit_vel} suffix=" mph" />
                  <PitchInputMetric label="EV90 Against" value={row["90th_vel"]} suffix=" mph" />
                  <PitchInputMetric label="GB %" value={row.ground_pct} suffix="%" />
                  <PitchInputMetric label="In-Zone %" value={row.in_zone_pct} suffix="%" />
                  <PitchInputMetric label="Pull % Against" value={row.h_pull_pct} suffix="%" />
                  <PitchInputMetric label="LA 10-30 %" value={row.la_10_30_pct} suffix="%" />
                  <PitchInputMetric label="Line Drive %" value={row.line_pct} suffix="%" />
                  <PitchInputMetric label="Stuff+" value={row.stuff_plus} />
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function HistoricalPitcherGrade({ value, fullLabel }: { value: number | null; fullLabel: string }) {
  if (value == null) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-3" title={fullLabel}>
        <div className="text-xs font-medium opacity-80">{fullLabel}</div>
        <div className="text-2xl font-bold mt-1 text-muted-foreground">—</div>
        <div className="text-xs font-semibold mt-0.5 text-muted-foreground">No Data</div>
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
      <div className="text-2xl font-bold mt-1">{Math.round(value)}</div>
      <div className="text-xs font-semibold mt-0.5">{grade}</div>
    </div>
  );
}

function PitchInputMetric({ label, value, suffix }: { label: string; value: number | null | undefined; suffix?: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/50 p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-xl font-bold font-mono mt-1">
        {value == null ? "—" : `${Number(value).toFixed(1)}${suffix || ""}`}
      </div>
    </div>
  );
}
