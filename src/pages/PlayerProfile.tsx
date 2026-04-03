import { useMemo, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Pencil, Save, X, TrendingUp, TrendingDown, ShieldCheck, Target } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useHitterSeedData } from "@/hooks/useHitterSeedData";
import { computeHitterPowerRatings } from "@/lib/powerRatings";
import { recalculatePredictionById } from "@/lib/predictionEngine";
import {
  DEFAULT_NIL_TIER_MULTIPLIERS,
  getPositionValueMultiplier,
  getProgramTierMultiplierByConference,
} from "@/lib/nilProgramSpecific";
import { readPlayerOverrides } from "@/lib/playerOverrides";
import { useTeamsTable } from "@/hooks/useTeamsTable";

const TARGET_BOARD_STORAGE_KEY = "team_builder_target_board_v1";
type TargetBoardEntry = {
  playerId: string;
  playerName: string;
  destinationTeam: string;
  fromTeam: string | null;
  fromConference: string | null;
  pAvg: number | null;
  pObp: number | null;
  pSlg: number | null;
  pWrcPlus: number | null;
  owar: number | null;
  nilValuation: number | null;
  createdAt: string;
};
const readTargetBoard = (): TargetBoardEntry[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(TARGET_BOARD_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};
const writeTargetBoard = (rows: TargetBoardEntry[]) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TARGET_BOARD_STORAGE_KEY, JSON.stringify(rows));
};

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

const computeOWarFromWrcPlus = (wrcPlus: number | null, actualPa?: number | null) => {
  if (wrcPlus == null) return null;
  const pa = actualPa ?? 260;
  const runsPerPa = 0.13;
  const replacementRuns = (pa / 600) * 25;
  const offValue = (wrcPlus - 100) / 100;
  const raa = offValue * pa * runsPerPa;
  const rar = raa + replacementRuns;
  return rar / 10;
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

const normalizeName = (value: string | null | undefined) =>
  (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const FIRST_NAME_ALIASES: Record<string, string[]> = {
  christopher: ["chris"],
  matthew: ["matt"],
  michael: ["mike"],
  joseph: ["joe"],
  alexander: ["alex"],
};
const getNameVariants = (fullName: string) => {
  const cleaned = normalizeName(fullName);
  if (!cleaned) return [];
  const parts = cleaned.split(" ").filter(Boolean);
  if (parts.length < 2) return [cleaned];
  const [first, ...rest] = parts;
  const restJoined = rest.join(" ");
  const variants = new Set<string>([cleaned]);
  const aliases = FIRST_NAME_ALIASES[first] || [];
  for (const a of aliases) variants.add(`${a} ${restJoined}`.trim());
  if (first.length > 1) variants.add(`${first[0]} ${restJoined}`.trim());
  return Array.from(variants);
};
const normalizeTeamForKey = (team: string | null | undefined) => {
  const t = normalizeName(team);
  return t.replace(/\buniversity\b/g, "").replace(/\bof\b/g, "").replace(/\s+/g, " ").trim();
};
const nameTeamKey = (name: string | null | undefined, team: string | null | undefined) =>
  `${normalizeName(name)}|${normalizeTeamForKey(team)}`;

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

function ScoutGrade({ label, value, fullLabel }: { label: string; value: number | null; fullLabel: string }) {
  if (value == null) return null;
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
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const { hitterStats, powerRatings: powerRatingsData, exitPositions } = useHitterSeedData();

  const [storageByName, storageByNameTeam, storageByPlayerId] = useMemo(() => {
    const byName = new Map<string, Array<any>>();
    const byNameTeam = new Map<string, any>();
    const byPlayerId = new Map<string, any>();
    for (const row of hitterStats) {
      const key = normalizeName(row.playerName);
      const arr = byName.get(key) || [];
      arr.push(row);
      byName.set(key, arr);
      const ntKey = nameTeamKey(row.playerName, row.team);
      if (!byNameTeam.has(ntKey)) byNameTeam.set(ntKey, row);
      if (row.player_id) byPlayerId.set(row.player_id, row);
    }
    return [byName, byNameTeam, byPlayerId];
  }, [hitterStats]);

  const [powerByName, powerByNameTeam, powerByPlayerId] = useMemo(() => {
    const byName = new Map<string, Array<any>>();
    const byNameTeam = new Map<string, any>();
    const byPlayerId = new Map<string, any>();
    for (const row of powerRatingsData) {
      const key = normalizeName(row.playerName);
      const arr = byName.get(key) || [];
      arr.push(row);
      byName.set(key, arr);
      const ntKey = nameTeamKey(row.playerName, row.team);
      if (!byNameTeam.has(ntKey)) byNameTeam.set(ntKey, row);
      if (row.player_id) byPlayerId.set(row.player_id, row);
    }
    return [byName, byNameTeam, byPlayerId];
  }, [powerRatingsData]);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, any>>({});
  const [editingPrediction, setEditingPrediction] = useState(false);
  const [predForm, setPredForm] = useState<{ class_transition: string; dev_aggressiveness: string }>({ class_transition: "", dev_aggressiveness: "0.5" });

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

  const { data: predictions = [] } = useQuery({
    queryKey: ["player-predictions", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_predictions")
        .select("*")
        .eq("player_id", id!)
        .eq("status", "active");
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

  const { teams: teamsForConference } = useTeamsTable();

  const { data: nilValuation } = useQuery({
    queryKey: ["player-nil", id],
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
    enabled: !!id,
  });

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
          class_transition: updates.class_transition,
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

  const regularPred = predictions.find((p) => p.variant === "regular");
  const isTransferPortal = player?.transfer_portal && predictions.some((p) => p.model_type === "transfer");
  const isReturner = predictions.some((p) => p.model_type === "returner");
  const playerOverride = useMemo(
    () => (id ? readPlayerOverrides()[id] : undefined),
    [id],
  );
  const effectivePosition = playerOverride?.position ?? player?.position ?? null;

  const startPredEdit = () => {
    setPredForm({
      class_transition: regularPred?.class_transition || "",
      dev_aggressiveness: regularPred?.dev_aggressiveness?.toString() ?? "0.5",
    });
    setEditingPrediction(true);
  };

  const savePredEdit = () => {
    const returnerPreds = predictions.filter((p) => p.model_type === "returner");
    if (returnerPreds.length === 0) return;
    const updates: Record<string, any> = {
      class_transition: predForm.class_transition || null,
      dev_aggressiveness: predForm.dev_aggressiveness !== "" ? Number(predForm.dev_aggressiveness) : null,
    };
    // Also update the player's class_year to match the transition target
    if (predForm.class_transition && classTransitionToYear[predForm.class_transition]) {
      supabase.from("players").update({ class_year: classTransitionToYear[predForm.class_transition] }).eq("id", id!).then(() => {
        queryClient.invalidateQueries({ queryKey: ["player-profile", id] });
      });
    }
    updatePrediction.mutate({ predictionIds: returnerPreds.map((p) => p.id), updates });
  };

  const { data: fromTeamData } = useQuery({
    queryKey: ["from-team-conference", player?.from_team],
    queryFn: async () => {
      const fromTeam = player!.from_team!;
      // Handle "Unknown (Conference)" pattern
      const unknownMatch = fromTeam.match(/^Unknown \((.+)\)$/);
      if (unknownMatch) return { conference: unknownMatch[1] };
      // Try exact match first
      let { data } = await supabase
        .from("teams")
        .select("conference")
        .eq("name", fromTeam)
        .maybeSingle();
      if (data) return data;
      // Try contains match (short name within full formal name)
      const { data: fuzzy } = await supabase
        .from("teams")
        .select("conference")
        .ilike("name", `%${fromTeam}%`)
        .limit(1)
        .maybeSingle();
      return fuzzy;
    },
    enabled: !!player?.from_team && !!isTransferPortal,
  });

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-20 text-muted-foreground">Loading player…</div>
      </DashboardLayout>
    );
  }

  if (!player) {
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
  const fullName = normalizeName(`${player.first_name} ${player.last_name}`);
  const fullNameRaw = `${player.first_name} ${player.last_name}`;
  const statCandidates = storageByName.get(fullName) || [];
  const round3 = (v: number | null | undefined) => (v == null ? null : Math.round(v * 1000) / 1000);
  const resolvedSeedStatRow = (() => {
    // Fast path: UUID match (instant, unambiguous)
    const byId = id ? storageByPlayerId.get(id) : undefined;
    if (byId) return byId;
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
    // Fast path: UUID match (instant, unambiguous)
    const byId = id ? powerByPlayerId.get(id) : undefined;
    if (byId) return byId;
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
  const displayTeam2025 = seedStatRow?.team || player.from_team || player.team || null;
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
  const projectedOWar = computeOWarFromWrcPlus(regularPred?.p_wrc_plus ?? null);
  const historicalOWar = computeOWarFromWrcPlus(seedDerived?.wrcPlus ?? null, (player as any)?.pa ?? null);
  const displayOWar =
    projectedOWar ??
    ((nilValuation as any)?.war as number | null) ??
    historicalOWar;
  const nilBasePerOWar = 25000;
  const resolvedConference = (() => {
    if (player.conference) return player.conference;
    const norm = (v: string) => (v || "").trim().toLowerCase().replace(/\b(university|college|of)\b/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
    return teamsForConference.find(t => norm(t.name) === norm(player.team || ""))?.conference || null;
  })();
  const fallbackNilValuation = (() => {
    if (displayOWar == null) return null;
    const ptm = getProgramTierMultiplierByConference(resolvedConference, DEFAULT_NIL_TIER_MULTIPLIERS);
    const pvm = getPositionValueMultiplier(effectivePosition);
    return displayOWar * nilBasePerOWar * ptm * pvm;
  })();
  const displayNilValuation = (nilValuation as any)?.estimated_value ?? fallbackNilValuation;
  const predFromAvg = seedStatRow?.avg ?? regularPred?.from_avg ?? null;
  const predFromObp = seedStatRow?.obp ?? regularPred?.from_obp ?? null;
  const predFromSlg = seedStatRow?.slg ?? regularPred?.from_slg ?? null;
  const projectedAvg = regularPred?.p_avg ?? null;
  const projectedObp = regularPred?.p_obp ?? null;
  const projectedSlg = regularPred?.p_slg ?? null;
  const fromDerived = computeDerived(predFromAvg, predFromObp, predFromSlg);
  const projectedDerived = computeDerived(projectedAvg, projectedObp, projectedSlg);
  const projectedWrcPlus = regularPred?.p_wrc_plus ?? null;

  return (
    <DashboardLayout>
      <div className="space-y-4 max-w-[1400px] mx-auto">
        {/* Back + Header */}
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
              {displayTeam2025 && <Badge variant="outline">{displayTeam2025}</Badge>}
              {(() => {
                const norm = (v: string) => (v || "").trim().toLowerCase().replace(/\b(university|college|of)\b/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
                const teamConf = teamsForConference.find(t => norm(t.name) === norm(player.team || ""))?.conference;
                const conf = player.conference || teamConf || null;
                return conf ? <Badge variant="outline" className="text-muted-foreground">{conf}</Badge> : null;
              })()}
              {player.transfer_portal && <Badge className="bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))] border-[hsl(var(--warning)/0.3)]">Transfer Portal</Badge>}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const board = readTargetBoard();
              if (board.some((e) => e.playerId === player.id)) {
                toast.info("Already on target board");
                return;
              }
              const pred = regularPred;
              board.push({
                playerId: player.id,
                playerName: `${player.first_name} ${player.last_name}`,
                destinationTeam: "",
                fromTeam: player.from_team || player.team || null,
                fromConference: player.conference || null,
                pAvg: pred?.p_avg ?? null,
                pObp: pred?.p_obp ?? null,
                pSlg: pred?.p_slg ?? null,
                pWrcPlus: pred?.p_wrc_plus ?? null,
                owar: null,
                nilValuation: null,
                createdAt: new Date().toISOString(),
              });
              writeTargetBoard(board);
              toast.success("Added to Target Board");
            }}
          >
            <Target className="mr-2 h-3.5 w-3.5" />Target Board
          </Button>
          {!editing ? (
            <Button variant="outline" size="sm" onClick={startEdit}>
              <Pencil className="mr-2 h-3.5 w-3.5" />Edit
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
                <X className="mr-1 h-3.5 w-3.5" />Cancel
              </Button>
              <Button size="sm" onClick={saveEdit} disabled={updatePlayer.isPending}>
                <Save className="mr-1 h-3.5 w-3.5" />Save
              </Button>
            </div>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-1 space-y-4">
            {/* Player Info Card */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Player Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
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
                  <div className="space-y-2">
                  <InfoRow label="Team" value={displayTeam2025} />
                  <InfoRow label="Conference" value={player.conference} />
                  <InfoRow label="Position" value={effectivePosition} />
                  <InfoRow label="Class Year" value={
                    isReturner && regularPred?.class_transition
                      ? classTransitionToYear[regularPred.class_transition] || player.class_year
                      : player.class_year
                  } />
                  <InfoRow label="Age" value={(player as any).age?.toString()} />
                  <InfoRow label="Bats" value={(player as any).bats_hand === "R" ? "Right" : (player as any).bats_hand === "L" ? "Left" : (player as any).bats_hand === "S" ? "Switch" : (player as any).bats_hand} />
                  <InfoRow label="Throws" value={(player as any).throws_hand === "R" ? "Right" : (player as any).throws_hand === "L" ? "Left" : (player as any).throws_hand} />
                  <InfoRow label="Height" value={formatHeight(player.height_inches)} />
                  <InfoRow label="Weight" value={player.weight ? `${player.weight} lbs` : null} />
                  <InfoRow label="Home State" value={player.home_state} />
                  <InfoRow label="High School" value={player.high_school} />
                  {player.notes && (
                    <>
                      <Separator className="my-2" />
                      <div>
                        <span className="text-xs text-muted-foreground">Notes</span>
                        <p className="text-sm mt-1">{player.notes}</p>
                      </div>
                    </>
                  )}
                  </div>
                )}
              </CardContent>
            </Card>

            {isAdmin && seedStatRow && seedDerived && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">2025 Stats</CardTitle>
                  <CardDescription>Imported 2025 stats and in-system derived metrics.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><span className="text-muted-foreground">PA</span><div className="font-bold">{(player as any)?.pa ?? "—"}</div></div>
                    <div><span className="text-muted-foreground">AVG</span><div className="font-bold">{statFormat(seedStatRow.avg)}</div></div>
                    <div><span className="text-muted-foreground">OBP</span><div className="font-bold">{statFormat(seedStatRow.obp)}</div></div>
                    <div><span className="text-muted-foreground">SLG</span><div className="font-bold">{statFormat(seedStatRow.slg)}</div></div>
                    <div><span className="text-muted-foreground">OPS</span><div className="font-bold">{statFormat(seedDerived.ops)}</div></div>
                    <div><span className="text-muted-foreground">ISO</span><div className="font-bold">{statFormat(seedDerived.iso)}</div></div>
                    <div><span className="text-muted-foreground">wRC+</span><div className="font-bold">{pctFormat(seedDerived.wrcPlus)}</div></div>
                    <div><span className="text-muted-foreground">2025 oWAR</span><div className="font-bold">{historicalOWar != null ? historicalOWar.toFixed(2) : "—"}</div></div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Predictions & Scouting */}
          <div className="lg:col-span-2 space-y-4">
            {/* Top Metrics */}
            <div className="grid gap-3 md:grid-cols-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Market Value</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="text-3xl font-bold text-[hsl(var(--success))]">
                    {displayNilValuation != null
                      ? `$${Math.round(displayNilValuation).toLocaleString()}`
                      : "—"}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">oWAR</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className={`text-3xl font-bold ${warTierClass(displayOWar)}`}>
                    {displayOWar != null ? displayOWar.toFixed(1) : "—"}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Overall Power Rating</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className={`text-3xl font-bold ${powerTierClass(seedPowerDerived?.overallPlus ?? null)}`}>
                    {pctFormat(seedPowerDerived?.overallPlus ?? null)}
                  </div>
                </CardContent>
              </Card>
            </div>

            {isTransferPortal && (
              <div className="grid grid-cols-2 gap-3">
                <Card>
                  <CardContent className="pt-3 pb-2.5">
                    <div className="text-xs font-medium text-muted-foreground">2025 Team</div>
                    <div className={`text-lg font-bold mt-1 ${displayTeam2025 ? "" : "text-muted-foreground"}`}>{displayTeam2025 || "TBD"}</div>
                    {fromTeamData?.conference && <div className="text-xs text-muted-foreground">{fromTeamData.conference}</div>}
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-3 pb-2.5">
                    <div className="text-xs font-medium text-muted-foreground">2026 Team</div>
                    <div className="text-lg font-bold mt-1">{player.team || "Unknown"}</div>
                    {player.conference && <div className="text-xs text-muted-foreground">{player.conference}</div>}
                  </CardContent>
                </Card>
              </div>
            )}

              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Predicted Stats</CardTitle>
                    {isReturner && regularPred && !editingPrediction && (
                      <Button variant="outline" size="sm" onClick={startPredEdit}>
                        <Pencil className="mr-1 h-3 w-3" />Edit
                      </Button>
                    )}
                    {editingPrediction && regularPred && (
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setEditingPrediction(false)}>
                          <X className="mr-1 h-3 w-3" />Cancel
                        </Button>
                        <Button size="sm" onClick={savePredEdit} disabled={updatePrediction.isPending}>
                          <Save className="mr-1 h-3 w-3" />Save
                        </Button>
                      </div>
                    )}
                  </div>
                  {editingPrediction && regularPred ? (
                    <div className="flex items-center gap-4 mt-2">
                      <div>
                        <Label className="text-xs">Class Transition</Label>
                        <Select value={predForm.class_transition || "none"} onValueChange={(v) => setPredForm({ ...predForm, class_transition: v === "none" ? "" : v })}>
                          <SelectTrigger className="h-8 text-sm w-[180px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">—</SelectItem>
                            <SelectItem value="FS">Freshman → Sophomore</SelectItem>
                            <SelectItem value="SJ">Sophomore → Junior</SelectItem>
                            <SelectItem value="JS">Junior → Senior</SelectItem>
                            <SelectItem value="GR">Graduate</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Dev Confidence</Label>
                        <Select value={predForm.dev_aggressiveness} onValueChange={(v) => setPredForm({ ...predForm, dev_aggressiveness: v })}>
                          <SelectTrigger className="h-8 text-sm w-[160px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="0">0.0 — Stable</SelectItem>
                            <SelectItem value="0.5">0.5 — Expected</SelectItem>
                            <SelectItem value="1">1.0 — Aggressive</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  ) : (
                    <CardDescription>
                      {regularPred?.class_transition && classTransitionLabel[regularPred.class_transition]}
                      {regularPred?.dev_aggressiveness != null && ` · Dev Confidence: ${regularPred.dev_aggressiveness}`}
                      {!regularPred && "Using available 2025 source stats until a prediction row is created."}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent className="pt-0">
                  <div>
                    <div>
                      <div className="divide-y divide-border">
                        <StatRow label="AVG" from={predFromAvg} predicted={projectedAvg} />
                        <StatRow label="OBP" from={predFromObp} predicted={projectedObp} />
                        <StatRow label="SLG" from={predFromSlg} predicted={projectedSlg} />
                        <StatRow label="OPS" from={fromDerived.ops} predicted={projectedDerived.ops} />
                        <StatRow label="ISO" from={fromDerived.iso} predicted={projectedDerived.iso} />
                        <div className="flex items-center justify-between py-2">
                          <span className="text-sm text-muted-foreground">wRC+</span>
                          <div className="flex items-center gap-4">
                            <span className="text-sm font-mono text-muted-foreground w-16 text-right">{pctFormat(fromDerived.wrcPlus)}</span>
                            <span className="text-xs text-muted-foreground">→</span>
                            <span className={`text-sm font-mono font-bold w-16 text-right ${fromDerived.wrcPlus != null && projectedWrcPlus != null ? (projectedWrcPlus - fromDerived.wrcPlus > 0.5 ? "text-[hsl(var(--success))]" : projectedWrcPlus - fromDerived.wrcPlus < -0.5 ? "text-destructive" : "text-muted-foreground") : ""}`}>
                              {pctFormat(projectedWrcPlus)}
                              {fromDerived.wrcPlus != null && projectedWrcPlus != null && Math.abs(projectedWrcPlus - fromDerived.wrcPlus) > 0.5 && (
                                projectedWrcPlus > fromDerived.wrcPlus ? <TrendingUp className="inline h-3 w-3 ml-1" /> : <TrendingDown className="inline h-3 w-3 ml-1" />
                              )}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

            {/* Scouting Grades */}
            {isAdmin && seedPowerDerived && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Scouting Grades</CardTitle>
                  <CardDescription>
                    2025 percentile scores (color-coded)
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                    <ScoutGrade label="Brl" value={seedPowerDerived.barrelScore != null ? Math.round(seedPowerDerived.barrelScore) : null} fullLabel="Barrel % Score" />
                    <ScoutGrade label="EV" value={seedPowerDerived.avgEVScore != null ? Math.round(seedPowerDerived.avgEVScore) : null} fullLabel="Avg Exit Velocity Score" />
                    <ScoutGrade label="Con" value={seedPowerDerived.contactScore != null ? Math.round(seedPowerDerived.contactScore) : null} fullLabel="Contact % Score" />
                    <ScoutGrade label="Chs" value={seedPowerDerived.chaseScore != null ? Math.round(seedPowerDerived.chaseScore) : null} fullLabel="Chase % Score" />
                  </div>
                  {isAdmin && seedPowerDerived && (
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
                          <div className="text-2xl font-bold font-mono mt-1">{pctFormat(seedPowerDerived.overallPlus)}</div>
                        </div>
                        <div className="rounded-lg border border-border bg-muted/50 p-3">
                          <div className="text-xs font-medium text-muted-foreground">Batting Average Power Rating</div>
                          <div className="text-2xl font-bold font-mono mt-1">{pctFormat(seedPowerDerived.baPlus)}</div>
                        </div>
                        <div className="rounded-lg border border-border bg-muted/50 p-3">
                          <div className="text-xs font-medium text-muted-foreground">OBP Power Rating</div>
                          <div className="text-2xl font-bold font-mono mt-1">{pctFormat(seedPowerDerived.obpPlus)}</div>
                        </div>
                        <div className="rounded-lg border border-border bg-muted/50 p-3">
                          <div className="text-xs font-medium text-muted-foreground">ISO Power Rating</div>
                          <div className="text-2xl font-bold font-mono mt-1">{pctFormat(seedPowerDerived.isoPlus)}</div>
                        </div>
                      </div>
                      {seedPowerRow && (
                        <>
                          <Separator className="my-4" />
                          <div className="text-xs font-medium text-muted-foreground mb-3">2025 Input Metrics</div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                            <div className="rounded-lg border border-border bg-muted/50 p-3">
                              <div className="text-xs font-medium text-muted-foreground">Contact %</div>
                              <div className="text-xl font-bold font-mono mt-1">{seedPowerRow.contact?.toFixed(1)}%</div>
                            </div>
                            <div className="rounded-lg border border-border bg-muted/50 p-3">
                              <div className="text-xs font-medium text-muted-foreground">Line Drive %</div>
                              <div className="text-xl font-bold font-mono mt-1">{seedPowerRow.lineDrive?.toFixed(1)}%</div>
                            </div>
                            <div className="rounded-lg border border-border bg-muted/50 p-3">
                              <div className="text-xs font-medium text-muted-foreground">Pop-Up %</div>
                              <div className="text-xl font-bold font-mono mt-1">{seedPowerRow.popUp?.toFixed(1)}%</div>
                            </div>
                            <div className="rounded-lg border border-border bg-muted/50 p-3">
                              <div className="text-xs font-medium text-muted-foreground">BB %</div>
                              <div className="text-xl font-bold font-mono mt-1">{seedPowerRow.bb?.toFixed(1)}%</div>
                            </div>
                            <div className="rounded-lg border border-border bg-muted/50 p-3">
                              <div className="text-xs font-medium text-muted-foreground">Chase %</div>
                              <div className="text-xl font-bold font-mono mt-1">{seedPowerRow.chase?.toFixed(1)}%</div>
                            </div>
                            <div className="rounded-lg border border-border bg-muted/50 p-3">
                              <div className="text-xs font-medium text-muted-foreground">Barrel %</div>
                              <div className="text-xl font-bold font-mono mt-1">{seedPowerRow.barrel?.toFixed(1)}%</div>
                            </div>
                            <div className="rounded-lg border border-border bg-muted/50 p-3">
                              <div className="text-xs font-medium text-muted-foreground">Pull %</div>
                              <div className="text-xl font-bold font-mono mt-1">{seedPowerRow.pull?.toFixed(1)}%</div>
                            </div>
                            <div className="rounded-lg border border-border bg-muted/50 p-3">
                              <div className="text-xs font-medium text-muted-foreground">LA 10-30 %</div>
                              <div className="text-xl font-bold font-mono mt-1">{seedPowerRow.la10_30?.toFixed(1)}%</div>
                            </div>
                            <div className="rounded-lg border border-border bg-muted/50 p-3">
                              <div className="text-xs font-medium text-muted-foreground">GB %</div>
                              <div className="text-xl font-bold font-mono mt-1">{seedPowerRow.gb?.toFixed(1)}%</div>
                            </div>
                            <div className="rounded-lg border border-border bg-muted/50 p-3">
                              <div className="text-xs font-medium text-muted-foreground">Avg Exit Velo</div>
                              <div className="text-xl font-bold font-mono mt-1">{seedPowerRow.avgExitVelo?.toFixed(1)} mph</div>
                            </div>
                            <div className="rounded-lg border border-border bg-muted/50 p-3">
                              <div className="text-xs font-medium text-muted-foreground">EV90</div>
                              <div className="text-xl font-bold font-mono mt-1">{seedPowerRow.ev90?.toFixed(1)} mph</div>
                            </div>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Season Stats */}
            {seasonStats.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Season Stats</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">Season</th>
                          <th className="text-right px-2 py-2 font-medium text-muted-foreground">G</th>
                          <th className="text-right px-2 py-2 font-medium text-muted-foreground">AB</th>
                          <th className="text-right px-2 py-2 font-medium text-muted-foreground">H</th>
                          <th className="text-right px-2 py-2 font-medium text-muted-foreground">HR</th>
                          <th className="text-right px-2 py-2 font-medium text-muted-foreground">RBI</th>
                          <th className="text-right px-2 py-2 font-medium text-muted-foreground">AVG</th>
                          <th className="text-right px-2 py-2 font-medium text-muted-foreground">OBP</th>
                          <th className="text-right px-2 py-2 font-medium text-muted-foreground">SLG</th>
                          <th className="text-right px-2 py-2 font-medium text-muted-foreground">OPS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {seasonStats.map((s) => (
                          <tr key={s.id} className="border-b border-border last:border-0">
                            <td className="px-4 py-2 font-medium">{s.season}</td>
                            <td className="text-right px-2 py-2 font-mono">{s.games ?? "—"}</td>
                            <td className="text-right px-2 py-2 font-mono">{s.at_bats ?? "—"}</td>
                            <td className="text-right px-2 py-2 font-mono">{s.hits ?? "—"}</td>
                            <td className="text-right px-2 py-2 font-mono">{s.home_runs ?? "—"}</td>
                            <td className="text-right px-2 py-2 font-mono">{s.rbi ?? "—"}</td>
                            <td className="text-right px-2 py-2 font-mono">{statFormat(s.batting_avg)}</td>
                            <td className="text-right px-2 py-2 font-mono">{statFormat(s.on_base_pct)}</td>
                            <td className="text-right px-2 py-2 font-mono">{statFormat(s.slugging_pct)}</td>
                            <td className="text-right px-2 py-2 font-mono font-bold">{statFormat(s.ops)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
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
