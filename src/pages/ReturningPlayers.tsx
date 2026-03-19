import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Users,
  ArrowUpDown,
  Search,
  BarChart3,
  Activity,
  Pencil,
  Save,
  X,
} from "lucide-react";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell } from "recharts";
import { toast } from "sonner";
import { recalculatePredictionById } from "@/lib/predictionEngine";
import storage2025Seed from "@/data/storage_2025_seed.json";
import powerRatings2025Seed from "@/data/power_ratings_2025_seed.json";
import {
  DEFAULT_NIL_TIER_MULTIPLIERS,
  getProgramTierMultiplierByConference,
  getPositionValueMultiplier,
} from "@/lib/nilProgramSpecific";
import { readPitchingWeights } from "@/lib/pitchingEquations";
import { profileRouteFor } from "@/lib/profileRoutes";

type SortKey =
  | "name"
  | "p_avg"
  | "p_obp"
  | "p_slg"
  | "p_ops"
  | "p_iso"
  | "p_wrc_plus"
  | "p_war"
  | "p_nil";
type SortDir = "asc" | "desc";
const FAST_DB_SORT_KEYS: SortKey[] = ["p_avg", "p_obp", "p_slg", "p_ops", "p_iso", "p_wrc_plus", "p_war"];

interface ReturnerPlayer {
  id: string;
  prediction_id: string;
  first_name: string;
  last_name: string;
  team: string | null;
  conference: string | null;
  position: string | null;
  class_year: string | null;
  transfer_portal?: boolean | null;
  model_type: "returner" | "transfer";
  status: "active" | "departed" | "archived";
  nil_value: number | null;
  prediction: {
    from_avg: number | null;
    from_obp: number | null;
    from_slg: number | null;
    class_transition: string | null;
    dev_aggressiveness: number | null;
    p_avg: number | null;
    p_obp: number | null;
    p_slg: number | null;
    p_ops: number | null;
    p_iso: number | null;
    p_wrc_plus: number | null;
    power_rating_plus: number | null;
    ev_score: number | null;
    barrel_score: number | null;
    contact_score: number | null;
    chase_score: number | null;
  };
}

interface PitchingDashboardRow {
  id: string;
  playerName: string;
  team: string | null;
  conference: string | null;
  handedness: string | null;
  stuff_score: number | null;
  whiff_score: number | null;
  bb_score: number | null;
  barrel_score: number | null;
  era: number | null;
  fip: number | null;
  whip: number | null;
  k9: number | null;
  bb9: number | null;
  hr9: number | null;
  class_transition: "FS" | "SJ" | "JS" | "GR";
  dev_aggressiveness: number;
  era_pr_plus: number | null;
  fip_pr_plus: number | null;
  whip_pr_plus: number | null;
  k9_pr_plus: number | null;
  bb9_pr_plus: number | null;
  hr9_pr_plus: number | null;
  p_era: number | null;
  p_fip: number | null;
  p_whip: number | null;
  p_k9: number | null;
  p_bb9: number | null;
  p_hr9: number | null;
  p_rv_plus: number | null;
}

const statFormat = (v: number | null | undefined, decimals = 3) => {
  if (v == null) return "—";
  return v >= 1 && decimals === 3 ? v.toFixed(3) : v.toFixed(decimals);
};

const pctFormat = (v: number | null | undefined) => {
  if (v == null) return "—";
  return Math.round(v).toString();
};
const compactDollar = new Intl.NumberFormat("en-US", {
  notation: "compact",
  compactDisplay: "short",
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 1,
});

const moneyFormat = (v: number | null | undefined) => {
  if (v == null) return "—";
  return compactDollar.format(v).replace("k", "K").replace("m", "M").replace("b", "B");
};
const toNum = (v: string | null | undefined) => {
  if (v == null) return null;
  const n = Number(String(v).replace(/[%,$]/g, "").trim());
  return Number.isFinite(n) ? n : null;
};

const PITCHING_POWER_RATING_WEIGHT = 0.7;
const PITCHING_DEV_FACTOR = 0.06;
const DEFAULT_PITCHING_CLASS_TRANSITION: "FS" | "SJ" | "JS" | "GR" = "SJ";
const DEFAULT_PITCHING_DEV_AGGRESSIVENESS = 0;

const toPitchingClassAdj = (
  classTransition: "FS" | "SJ" | "JS" | "GR",
  fs: number,
  sj: number,
  js: number,
  gr: number,
) => {
  const pct = classTransition === "FS" ? fs : classTransition === "SJ" ? sj : classTransition === "JS" ? js : gr;
  return Number.isFinite(pct) ? pct / 100 : 0;
};

const dampFactorForProjected = (projected: number, thresholds: number[], impacts: number[]) => {
  for (let i = 0; i < thresholds.length; i++) {
    if (projected < thresholds[i]) return impacts[i] ?? 1;
  }
  return impacts[thresholds.length] ?? impacts[impacts.length - 1] ?? 1;
};

const projectPitchingRate = ({
  lastStat,
  prPlus,
  ncaaAvg,
  ncaaSd,
  prSd,
  classAdjustment,
  devAggressiveness,
  thresholds,
  impacts,
  lowerIsBetter,
}: {
  lastStat: number | null;
  prPlus: number | null;
  ncaaAvg: number;
  ncaaSd: number;
  prSd: number;
  classAdjustment: number;
  devAggressiveness: number;
  thresholds: number[];
  impacts: number[];
  lowerIsBetter: boolean;
}) => {
  if (
    lastStat == null ||
    prPlus == null ||
    !Number.isFinite(lastStat) ||
    !Number.isFinite(prPlus) ||
    !Number.isFinite(ncaaAvg) ||
    !Number.isFinite(ncaaSd) ||
    !Number.isFinite(prSd) ||
    prSd === 0
  ) {
    return null;
  }

  const zShift = ((prPlus - 100) / prSd) * ncaaSd;
  const powerAdjusted = lowerIsBetter ? (ncaaAvg - zShift) : (ncaaAvg + zShift);
  const blended = (lastStat * (1 - PITCHING_POWER_RATING_WEIGHT)) + (powerAdjusted * PITCHING_POWER_RATING_WEIGHT);
  const mult = lowerIsBetter
    ? (1 - classAdjustment - (devAggressiveness * PITCHING_DEV_FACTOR))
    : (1 + classAdjustment + (devAggressiveness * PITCHING_DEV_FACTOR));
  const projected = blended * mult;
  const delta = projected - lastStat;
  const dampFactor = dampFactorForProjected(projected, thresholds, impacts);
  return lastStat + (delta * dampFactor);
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

const computeDerived = (avg: number | null, obp: number | null, slg: number | null) => {
  const ncaaAvgWrc = 0.364;
  const ops = obp != null && slg != null ? obp + slg : null;
  const iso = slg != null && avg != null ? slg - avg : null;
  const wrc = avg != null && obp != null && slg != null && iso != null
    ? (0.45 * obp) + (0.3 * slg) + (0.15 * avg) + (0.1 * iso)
    : null;
  const wrcPlus = wrc != null && ncaaAvgWrc !== 0 ? (wrc / ncaaAvgWrc) * 100 : null;
  return { ops, iso, wrcPlus };
};

const computeOWarFromWrcPlus = (wrcPlus: number | null) => {
  if (wrcPlus == null) return null;
  const pa = 260;
  const runsPerPa = 0.13;
  const replacementRuns = (pa / 600) * 25;
  const offValue = (wrcPlus - 100) / 100;
  const raa = offValue * pa * runsPerPa;
  const rar = raa + replacementRuns;
  return rar / 10;
};

const computeNilFallback = ({
  storedNil,
  wrcPlus,
  conference,
  position,
}: {
  storedNil: number | null | undefined;
  wrcPlus: number | null | undefined;
  conference: string | null | undefined;
  position: string | null | undefined;
}) => {
  if (storedNil != null) return storedNil;
  const owar = computeOWarFromWrcPlus(wrcPlus ?? null);
  if (owar == null) return null;
  const ptm = getProgramTierMultiplierByConference(conference, DEFAULT_NIL_TIER_MULTIPLIERS);
  const pvm = getPositionValueMultiplier(position);
  return owar * 25000 * ptm * pvm;
};

const deltaClass = (from: number | null, to: number | null, threshold = 0.001) => {
  if (from == null || to == null) return "text-muted-foreground";
  const diff = to - from;
  if (diff > threshold) return "text-[hsl(var(--success))]";
  if (diff < -threshold) return "text-destructive";
  return "text-muted-foreground";
};

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
const nameTeamKey = (name: string | null | undefined, team: string | null | undefined) =>
  `${normalizeName(name)}|${normalizeName(team)}`;
const erf = (x: number) => {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
};
const scoreFromNormal = (x: number | null, mean: number, sd: number, invert = false) => {
  if (x == null || sd <= 0) return null;
  const cdf = 0.5 * (1 + erf((x - mean) / (sd * Math.SQRT2)));
  const pct = cdf * 100;
  return invert ? 100 - pct : pct;
};
const powerSeedByName = new Map<string, Array<any>>();
const powerSeedByNameTeam = new Map<string, any>();
for (const row of powerRatings2025Seed as Array<any>) {
  const key = normalizeName(row.playerName);
  const arr = powerSeedByName.get(key) || [];
  arr.push(row);
  powerSeedByName.set(key, arr);
  const ntKey = nameTeamKey(row.playerName, row.team);
  if (!powerSeedByNameTeam.has(ntKey)) powerSeedByNameTeam.set(ntKey, row);
}

const PITCHING_TEAM_ALIASES: Record<string, string> = {
  "unc charlotte": "Charlotte",
};

export default function ReturningPlayers() {
  const queryClient = useQueryClient();
  const applyPredictionPatchToCache = useCallback((predictionId: string, patch: Partial<ReturnerPlayer["prediction"]>) => {
    queryClient.setQueryData(
      { queryKey: ["returning-players-2025-unified"] },
      (prev: { rows: ReturnerPlayer[]; total: number } | undefined) => {
        if (!prev) return prev;
        return {
          ...prev,
          rows: prev.rows.map((row) =>
            row.prediction_id === predictionId
              ? {
                  ...row,
                  prediction: {
                    ...row.prediction,
                    ...patch,
                  },
                }
              : row,
          ),
        };
      },
    );
  }, [queryClient]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [positionFilter, setPositionFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(100);
  const [sortKey, setSortKey] = useState<SortKey>("p_wrc_plus");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [bulkEditMode, setBulkEditMode] = useState(false);
  const [editedPlayers, setEditedPlayers] = useState<Record<string, { team?: string | null; position?: string | null }>>({});
  const [showMissingOnly, setShowMissingOnly] = useState(false);
  const [dashboardView, setDashboardView] = useState<"hitting" | "pitching">("hitting");
  const [pitchingSearch, setPitchingSearch] = useState("");
  const [pitchingPage, setPitchingPage] = useState(1);
  const [pitchingPageSize, setPitchingPageSize] = useState<number>(100);
  const normalize = (value: string | null | undefined) =>
    (value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 220);
    return () => window.clearTimeout(t);
  }, [search]);

  // Fixed scrollbar refs & sync
  const scrollbarRef = useRef<HTMLDivElement>(null);
  const scrollbarInnerRef = useRef<HTMLDivElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const isSyncing = useRef(false);
  const [showFixedScrollbar, setShowFixedScrollbar] = useState(false);
  const [scrollbarPos, setScrollbarPos] = useState({ left: 0, width: 0 });

  // Track table visibility and position
  useEffect(() => {
    const el = tableContainerRef.current;
    if (!el) return;
    const updatePos = () => {
      const rect = el.getBoundingClientRect();
      setScrollbarPos({ left: rect.left, width: rect.width });
    };
    const obs = new IntersectionObserver(
      ([entry]) => {
        setShowFixedScrollbar(entry.isIntersecting);
        if (entry.isIntersecting) updatePos();
      },
      { threshold: 0 },
    );
    obs.observe(el);
    window.addEventListener("resize", updatePos);
    updatePos();
    return () => {
      obs.disconnect();
      window.removeEventListener("resize", updatePos);
    };
  }, []);

  // Sync scrollbar width
  useEffect(() => {
    const table = tableContainerRef.current;
    const inner = scrollbarInnerRef.current;
    if (!table || !inner) return;
    const sync = () => {
      inner.style.width = `${table.scrollWidth}px`;
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(table);
    return () => ro.disconnect();
  }, []);

  const handleScrollbarScroll = useCallback(() => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    if (tableContainerRef.current && scrollbarRef.current) {
      tableContainerRef.current.scrollLeft = scrollbarRef.current.scrollLeft;
    }
    requestAnimationFrame(() => {
      isSyncing.current = false;
    });
  }, []);

  const handleTableScroll = useCallback(() => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    if (scrollbarRef.current && tableContainerRef.current) {
      scrollbarRef.current.scrollLeft = tableContainerRef.current.scrollLeft;
    }
    requestAnimationFrame(() => {
      isSyncing.current = false;
    });
  }, []);

  const { data: playersResult, isLoading } = useQuery({
    queryKey: [
      "returning-players-2025-unified",
      {
        scope: sortKey === "name" || FAST_DB_SORT_KEYS.includes(sortKey) ? "paged" : "global",
        page: sortKey === "name" || FAST_DB_SORT_KEYS.includes(sortKey) ? page : null,
        pageSize: sortKey === "name" || FAST_DB_SORT_KEYS.includes(sortKey) ? pageSize : null,
        positionFilter,
        showMissingOnly,
        debouncedSearch,
        sortKey,
        sortDir,
      },
    ],
    queryFn: async () => {
      const nameTeamKey = (name: string, team: string | null | undefined) => `${normalize(name)}|${normalize(team || "")}`;
      const statSeedRows = storage2025Seed as Array<{
        playerName: string;
        team: string | null;
        avg: number | null;
        obp: number | null;
        slg: number | null;
      }>;
      const statsByName = new Map<string, typeof statSeedRows>();
      const statsByNameTeam = new Map<string, (typeof statSeedRows)[number]>();
      for (const row of statSeedRows) {
        const nk = normalize(row.playerName);
        const arr = statsByName.get(nk) || [];
        arr.push(row);
        statsByName.set(nk, arr);
        statsByNameTeam.set(nameTeamKey(row.playerName, row.team), row);
      }

      const toReturnerRow = (
        row: any,
        player: any,
        nilByPlayer: Map<string, number | null>,
      ): ReturnerPlayer => {
        const fullName = `${player.first_name} ${player.last_name}`;
        const seedPowerRow = (() => {
          const direct = powerSeedByNameTeam.get(nameTeamKey(fullName, player.team));
          if (direct) return direct;

          const directByName = powerSeedByName.get(normalizeName(fullName)) || [];
          if (directByName.length === 1) return directByName[0];

          // Fallback for common first-name variants (e.g., Christopher -> Chris).
          const variantCandidates = getNameVariants(fullName)
            .flatMap((v) => powerSeedByName.get(v) || []);
          if (variantCandidates.length === 0) return null;

          const byTeam = variantCandidates.filter(
            (c) => normalizeName(c.team) === normalizeName(player.team),
          );
          if (byTeam.length === 1) return byTeam[0];
          if (variantCandidates.length === 1) return variantCandidates[0];
          return null;
        })();
        const seedEvScore = scoreFromNormal(seedPowerRow?.avgExitVelo ?? null, 86.2, 4.28);
        const seedBarrelScore = scoreFromNormal(seedPowerRow?.barrel ?? null, 17.3, 7.89);
        const seedContactScore = scoreFromNormal(seedPowerRow?.contact ?? null, 77.1, 6.6);
        const seedChaseScore = scoreFromNormal(seedPowerRow?.chase ?? null, 23.1, 5.58, true);
        const candidates = statsByName.get(normalize(fullName)) || [];
        const byTeam = statsByNameTeam.get(nameTeamKey(fullName, player.team));
        const exactByStats = candidates.find((r) =>
          (r.avg == null || row.from_avg == null || Math.round(r.avg * 1000) === Math.round(Number(row.from_avg) * 1000)) &&
          (r.obp == null || row.from_obp == null || Math.round(r.obp * 1000) === Math.round(Number(row.from_obp) * 1000)) &&
          (r.slg == null || row.from_slg == null || Math.round(r.slg * 1000) === Math.round(Number(row.from_slg) * 1000))
        );
        const resolvedTeam2025 = byTeam?.team || exactByStats?.team || (candidates.length === 1 ? candidates[0].team : null) || player.team;

        return {
          id: player.id,
          prediction_id: row.id,
          first_name: player.first_name,
          last_name: player.last_name,
          team: resolvedTeam2025,
          conference: player.conference,
          position: player.position,
          class_year: player.class_year,
          transfer_portal: player.transfer_portal,
          model_type: row.model_type,
          status: row.status,
          nil_value: nilByPlayer.get(player.id) ?? null,
          prediction: {
            from_avg: row.from_avg,
            from_obp: row.from_obp,
            from_slg: row.from_slg,
            class_transition: row.class_transition,
            dev_aggressiveness: row.dev_aggressiveness,
            p_avg: row.p_avg,
            p_obp: row.p_obp,
            p_slg: row.p_slg,
            p_ops: row.p_ops,
            p_iso: row.p_iso,
            p_wrc_plus: row.p_wrc_plus,
            power_rating_plus: row.power_rating_plus,
            ev_score: seedEvScore ?? null,
            barrel_score: seedBarrelScore ?? null,
            contact_score: seedContactScore ?? null,
            chase_score: seedChaseScore ?? null,
          },
        };
      };

      // Fast path: server-side paging for sortable prediction columns when no extra filters are active.
      // This keeps the player dashboard responsive without loading the entire dataset.
      if (
        FAST_DB_SORT_KEYS.includes(sortKey) &&
        positionFilter === "all" &&
        !showMissingOnly &&
        !debouncedSearch
      ) {
        const orderColumn =
          sortKey === "p_war"
            ? "p_wrc_plus" // pWAR is monotonic from pWRC+ in current model
            : sortKey;
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;
        const { data: pageData, error: pageErr, count } = await supabase
          .from("player_predictions")
          .select("*, players!inner(id, first_name, last_name, team, conference, position, class_year, transfer_portal)", { count: "exact" })
          .in("model_type", ["returner", "transfer"])
          .eq("variant", "regular")
          .in("status", ["active", "departed"])
          .order(orderColumn, { ascending: sortDir === "asc", nullsFirst: false })
          .range(from, to);
        if (pageErr) throw pageErr;

        const playerIds = (pageData || []).map((r: any) => r.player_id).filter(Boolean);
        const nilByPlayer = new Map<string, number | null>();
        if (playerIds.length > 0) {
          const NIL_BATCH = 300;
          const nilRowsAll: Array<{ player_id: string; estimated_value: number | null; season: number | null }> = [];
          for (let i = 0; i < playerIds.length; i += NIL_BATCH) {
            const ids = playerIds.slice(i, i + NIL_BATCH);
            const { data: nilRows, error: nilErr } = await supabase
              .from("nil_valuations")
              .select("player_id, estimated_value, season")
              .in("player_id", ids);
            if (nilErr) continue;
            nilRowsAll.push(...((nilRows || []) as Array<{ player_id: string; estimated_value: number | null; season: number | null }>));
          }
          const bySeason = new Map<string, { season: number; value: number | null }>();
          for (const row of nilRowsAll) {
            const curr = bySeason.get(row.player_id);
            const season = Number(row.season) || 0;
            if (!curr || season > curr.season) bySeason.set(row.player_id, { season, value: row.estimated_value });
          }
          for (const [pid, val] of bySeason.entries()) nilByPlayer.set(pid, val.value);
        }

        const rows = (pageData || []).map((row: any) => toReturnerRow(row, row.players, nilByPlayer));
        return { rows, total: count ?? rows.length };
      }

      // For other stat-column sorts, compute sort globally, then page that sorted set.
      if (sortKey !== "name") {
        let allData: any[] = [];
        let predFrom = 0;
        const PRED_PAGE_SIZE = 1000;
        while (true) {
          const { data, error } = await supabase
            .from("player_predictions")
            .select("*, players!inner(id, first_name, last_name, team, conference, position, class_year, transfer_portal)")
            .in("model_type", ["returner", "transfer"])
            .eq("variant", "regular")
            .in("status", ["active", "departed"])
            .range(predFrom, predFrom + PRED_PAGE_SIZE - 1);
          if (error) throw error;
          allData = allData.concat(data || []);
          if (!data || data.length < PRED_PAGE_SIZE) break;
          predFrom += PRED_PAGE_SIZE;
        }

        const byPlayer = new Map<string, any>();
        for (const row of allData || []) {
          const pid = row.players.id;
          const existing = byPlayer.get(pid);
          if (!existing) {
            byPlayer.set(pid, row);
            continue;
          }
          const rowHasFrom = row.from_avg != null || row.from_obp != null || row.from_slg != null;
          const existingHasFrom = existing.from_avg != null || existing.from_obp != null || existing.from_slg != null;
          const rowHasPred =
            row.p_avg != null && row.p_obp != null && row.p_slg != null && row.p_ops != null && row.p_iso != null && row.p_wrc_plus != null;
          const existingHasPred =
            existing.p_avg != null && existing.p_obp != null && existing.p_slg != null && existing.p_ops != null && existing.p_iso != null && existing.p_wrc_plus != null;
          const rowHasScout = row.ev_score != null || row.barrel_score != null || row.whiff_score != null || row.chase_score != null;
          const existingHasScout = existing.ev_score != null || existing.barrel_score != null || existing.whiff_score != null || existing.chase_score != null;
          const rowScore =
            ((row.players.transfer_portal === true && row.model_type === "transfer") ||
              (row.players.transfer_portal !== true && row.model_type === "returner")
              ? 6 : 0) +
            (rowHasPred ? 5 : 0) +
            (rowHasScout ? 2 : 0) +
            (row.model_type === "transfer" ? 3 : 0) +
            (row.status === "active" ? 2 : 0) +
            (rowHasFrom ? 1 : 0);
          const existingScore =
            ((existing.players.transfer_portal === true && existing.model_type === "transfer") ||
              (existing.players.transfer_portal !== true && existing.model_type === "returner")
              ? 6 : 0) +
            (existingHasPred ? 5 : 0) +
            (existingHasScout ? 2 : 0) +
            (existing.model_type === "transfer" ? 3 : 0) +
            (existing.status === "active" ? 2 : 0) +
            (existingHasFrom ? 1 : 0);
          if (rowScore > existingScore) byPlayer.set(pid, row);
          else if (rowScore === existingScore) {
            const rowTs = new Date(row.updated_at || 0).getTime();
            const existingTs = new Date(existing.updated_at || 0).getTime();
            if (rowTs > existingTs) byPlayer.set(pid, row);
          }
        }

        const dedupedRows = Array.from(byPlayer.values());
        const playerIds = dedupedRows.map((r: any) => r.player_id).filter(Boolean);
        const nilByPlayer = new Map<string, number | null>();
        if (playerIds.length > 0) {
          const NIL_BATCH = 300;
          const nilRowsAll: Array<{ player_id: string; estimated_value: number | null; season: number | null }> = [];
          for (let i = 0; i < playerIds.length; i += NIL_BATCH) {
            const ids = playerIds.slice(i, i + NIL_BATCH);
            const { data: nilRows, error: nilErr } = await supabase
              .from("nil_valuations")
              .select("player_id, estimated_value, season")
              .in("player_id", ids);
            if (nilErr) continue;
            nilRowsAll.push(...((nilRows || []) as Array<{ player_id: string; estimated_value: number | null; season: number | null }>));
          }
          const bySeason = new Map<string, { season: number; value: number | null }>();
          for (const row of nilRowsAll) {
            const curr = bySeason.get(row.player_id);
            const season = Number(row.season) || 0;
            if (!curr || season > curr.season) bySeason.set(row.player_id, { season, value: row.estimated_value });
          }
          for (const [pid, val] of bySeason.entries()) nilByPlayer.set(pid, val.value);
        }

        let allRows = dedupedRows.map((row: any) => toReturnerRow(row, row.players, nilByPlayer));
        if (positionFilter !== "all") allRows = allRows.filter((p) => p.position === positionFilter);
        if (showMissingOnly) allRows = allRows.filter((p) => !p.team);
        if (debouncedSearch) {
          const q = debouncedSearch.toLowerCase();
          allRows = allRows.filter(
            (p) =>
              `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) ||
              (p.team || "").toLowerCase().includes(q) ||
              (p.conference || "").toLowerCase().includes(q),
          );
        }

        const metricFor = (p: ReturnerPlayer): number => {
          if (sortKey === "p_avg") return p.prediction.p_avg ?? -999;
          if (sortKey === "p_obp") return p.prediction.p_obp ?? -999;
          if (sortKey === "p_slg") return p.prediction.p_slg ?? -999;
          if (sortKey === "p_ops") return p.prediction.p_ops ?? computeDerived(p.prediction.p_avg, p.prediction.p_obp, p.prediction.p_slg).ops ?? -999;
          if (sortKey === "p_iso") return p.prediction.p_iso ?? computeDerived(p.prediction.p_avg, p.prediction.p_obp, p.prediction.p_slg).iso ?? -999;
          if (sortKey === "p_wrc_plus") return p.prediction.p_wrc_plus ?? -999;
          if (sortKey === "p_war") return computeOWarFromWrcPlus(p.prediction.p_wrc_plus) ?? -999;
          if (sortKey === "p_nil") return computeNilFallback({ storedNil: p.nil_value, wrcPlus: p.prediction.p_wrc_plus, conference: p.conference, position: p.position }) ?? -999;
          return -999;
        };
        allRows.sort((a, b) => {
          const av = metricFor(a);
          const bv = metricFor(b);
          return sortDir === "asc" ? av - bv : bv - av;
        });

        return { rows: allRows, total: allRows.length };
      }

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      let playersQuery = supabase
        .from("players")
        .select("id, first_name, last_name, team, conference, position, class_year, transfer_portal", { count: "exact" })
        .order("last_name", { ascending: true })
        .order("first_name", { ascending: true })
        .range(from, to);
      if (positionFilter !== "all") playersQuery = playersQuery.eq("position", positionFilter);
      if (showMissingOnly) playersQuery = playersQuery.is("team", null);
      if (debouncedSearch) {
        const q = debouncedSearch.replace(/[%]/g, "").trim();
        if (q) {
          playersQuery = playersQuery.or(
            `first_name.ilike.%${q}%,last_name.ilike.%${q}%,team.ilike.%${q}%,conference.ilike.%${q}%`,
          );
        }
      }
      const { data: playerRows, error: playersErr, count } = await playersQuery;
      if (playersErr) throw playersErr;

      const playerIds = (playerRows || []).map((r: any) => r.id).filter(Boolean);
      if (playerIds.length === 0) return { rows: [] as ReturnerPlayer[], total: count ?? 0 };

      const { data: allData, error: predErr } = await supabase
        .from("player_predictions")
        .select("*")
        .in("player_id", playerIds)
        .in("model_type", ["returner", "transfer"])
        .eq("variant", "regular")
        .in("status", ["active", "departed"]);
      if (predErr) throw predErr;

      const nilByPlayer = new Map<string, number | null>();
      if (playerIds.length > 0) {
        // Avoid oversized `in (...)` query strings by fetching NIL in chunks.
        const NIL_BATCH = 300;
        const nilRowsAll: Array<{ player_id: string; estimated_value: number | null; season: number | null }> = [];
        for (let i = 0; i < playerIds.length; i += NIL_BATCH) {
          const ids = playerIds.slice(i, i + NIL_BATCH);
          const { data: nilRows, error: nilErr } = await supabase
            .from("nil_valuations")
            .select("player_id, estimated_value, season")
            .in("player_id", ids);
          if (nilErr) {
            console.warn("NIL query failed for batch; continuing without NIL values for this chunk.", nilErr);
            continue;
          }
          nilRowsAll.push(...((nilRows || []) as Array<{ player_id: string; estimated_value: number | null; season: number | null }>));
        }
        const bySeason = new Map<string, { season: number; value: number | null }>();
        for (const row of nilRowsAll) {
          const curr = bySeason.get(row.player_id);
          const season = Number(row.season) || 0;
          if (!curr || season > curr.season) bySeason.set(row.player_id, { season, value: row.estimated_value });
        }
        for (const [pid, val] of bySeason.entries()) nilByPlayer.set(pid, val.value);
      }

      const playerById = new Map<string, any>();
      for (const p of playerRows || []) playerById.set(p.id, p);
      const byPlayer = new Map<string, any>();
      for (const row of allData || []) {
        const currentPlayer = playerById.get(row.player_id);
        if (!currentPlayer) continue;
        const existing = byPlayer.get(row.player_id);
        if (!existing) {
          byPlayer.set(row.player_id, row);
          continue;
        }
        const rowHasFrom = row.from_avg != null || row.from_obp != null || row.from_slg != null;
        const existingHasFrom = existing.from_avg != null || existing.from_obp != null || existing.from_slg != null;
        const rowHasPred =
          row.p_avg != null &&
          row.p_obp != null &&
          row.p_slg != null &&
          row.p_ops != null &&
          row.p_iso != null &&
          row.p_wrc_plus != null;
        const rowHasScout =
          row.ev_score != null ||
          row.barrel_score != null ||
          row.whiff_score != null ||
          row.chase_score != null;
        const existingHasPred =
          existing.p_avg != null &&
          existing.p_obp != null &&
          existing.p_slg != null &&
          existing.p_ops != null &&
          existing.p_iso != null &&
          existing.p_wrc_plus != null;
        const existingHasScout =
          existing.ev_score != null ||
          existing.barrel_score != null ||
          existing.whiff_score != null ||
          existing.chase_score != null;
        const rowScore =
          ((currentPlayer.transfer_portal === true && row.model_type === "transfer") ||
            (currentPlayer.transfer_portal !== true && row.model_type === "returner")
            ? 6
            : 0) +
          (rowHasPred ? 5 : 0) +
          (rowHasScout ? 2 : 0) +
          (row.model_type === "transfer" ? 3 : 0) +
          (row.status === "active" ? 2 : 0) +
          (rowHasFrom ? 1 : 0);
        const existingScore =
          ((currentPlayer.transfer_portal === true && existing.model_type === "transfer") ||
            (currentPlayer.transfer_portal !== true && existing.model_type === "returner")
            ? 6
            : 0) +
          (existingHasPred ? 5 : 0) +
          (existingHasScout ? 2 : 0) +
          (existing.model_type === "transfer" ? 3 : 0) +
          (existing.status === "active" ? 2 : 0) +
          (existingHasFrom ? 1 : 0);
        if (rowScore > existingScore) {
          byPlayer.set(row.player_id, row);
          continue;
        }
        if (rowScore === existingScore) {
          const rowTs = new Date(row.updated_at || 0).getTime();
          const existingTs = new Date(existing.updated_at || 0).getTime();
          if (rowTs > existingTs) byPlayer.set(row.player_id, row);
        }
      }

      const rows = (playerRows || []).map((player: any) => {
        const row = byPlayer.get(player.id);
        if (!row) return null;
        return toReturnerRow(row, player, nilByPlayer);
      }).filter(Boolean) as ReturnerPlayer[];

      return { rows, total: count ?? 0 };
    },
  });
  const players = playersResult?.rows ?? [];
  const totalCount = playersResult?.total ?? 0;

  const { data: teamsDirectory = [] } = useQuery({
    queryKey: ["teams-directory-for-player-dashboard-edit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("name, conference");
      if (error) throw error;
      return (data || []) as Array<{ name: string; conference: string | null }>;
    },
  });

  const bulkSave = useMutation({
    mutationFn: async () => {
      const entries = Object.entries(editedPlayers);
      if (entries.length === 0) return;
      const teamByNorm = new Map<string, { name: string; conference: string | null }>();
      for (const t of teamsDirectory) {
        const key = normalize(t.name);
        if (!key) continue;
        if (!teamByNorm.has(key)) teamByNorm.set(key, t);
      }

      const invalidTeams = new Set<string>();
      const updates: Array<{ playerId: string; payload: Record<string, string | null> }> = [];
      for (const [playerId, data] of entries) {
        const payload: Record<string, string | null> = {};
        if (Object.prototype.hasOwnProperty.call(data, "position")) {
          payload.position = data.position ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(data, "team")) {
          const rawTeam = (data.team || "").trim();
          if (!rawTeam) {
            payload.team = null;
            payload.conference = null;
          } else {
            const match = teamByNorm.get(normalize(rawTeam));
            if (!match) {
              invalidTeams.add(rawTeam);
            } else {
              payload.team = match.name;
              payload.conference = match.conference ?? null;
            }
          }
        }
        if (Object.keys(payload).length > 0) {
          updates.push({ playerId, payload });
        }
      }

      if (invalidTeams.size > 0) {
        const sample = Array.from(invalidTeams).slice(0, 8).join(", ");
        throw new Error(`Team name(s) not found in Teams dashboard: ${sample}`);
      }

      const results = await Promise.all(
        updates.map(({ playerId, payload }) => supabase.from("players").update(payload).eq("id", playerId)),
      );
      const errors = results.filter((r) => r.error);
      if (errors.length > 0) throw new Error(`${errors.length} updates failed`);
      return updates.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["returning-players-2025-unified"] });
      setEditedPlayers({});
      setBulkEditMode(false);
      toast.success(`Updated ${count} player(s)`);
    },
    onError: (e) => toast.error(`Bulk save failed: ${e.message}`),
  });

  const updateClassTransition = useMutation({
    mutationFn: async ({ predictionId, value }: { predictionId: string; value: string }) => {
      const result = await recalculatePredictionById(predictionId, { class_transition: value });
      return { predictionId, value, result };
    },
    onSuccess: ({ predictionId, value, result }) => {
      applyPredictionPatchToCache(predictionId, {
        class_transition: value,
        ...(result?.prediction || {}),
      } as Partial<ReturnerPlayer["prediction"]>);
      queryClient.invalidateQueries({ queryKey: ["returning-players-2025-unified"] });
      toast.success("Class adjustment updated");
    },
    onError: (e) => toast.error(`Class adjustment failed: ${e.message}`),
  });

  const updateDevAgg = useMutation({
    mutationFn: async ({ predictionId, value }: { predictionId: string; value: number }) => {
      const result = await recalculatePredictionById(predictionId, { dev_aggressiveness: value });
      return { predictionId, value, result };
    },
    onSuccess: ({ predictionId, value, result }) => {
      applyPredictionPatchToCache(predictionId, {
        dev_aggressiveness: value,
        ...(result?.prediction || {}),
      } as Partial<ReturnerPlayer["prediction"]>);
      queryClient.invalidateQueries({ queryKey: ["returning-players-2025-unified"] });
      toast.success("Dev aggressiveness updated");
    },
    onError: (e) => toast.error(`Dev aggressiveness failed: ${e.message}`),
  });

  const applyTemplateDefaults = useMutation({
    mutationFn: async () => {
      const { data: allReturnerPreds, error } = await supabase
        .from("player_predictions")
        .select("id")
        .eq("model_type", "returner")
        .eq("variant", "regular")
        .in("status", ["active", "departed"]);
      if (error) throw error;
      const returnerRows = (allReturnerPreds || []).map((r) => ({ prediction_id: r.id }));
      const BATCH = 40;
      for (let i = 0; i < returnerRows.length; i += BATCH) {
        const batch = returnerRows.slice(i, i + BATCH);
        await Promise.all(
          batch.map(async (p) => {
            await recalculatePredictionById(p.prediction_id, { class_transition: "SJ", dev_aggressiveness: 0.0 });
          }),
        );
      }
      return returnerRows.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["returning-players-2025-unified"] });
      toast.success(`Applied template to ${count} returner rows`);
    },
    onError: (e) => toast.error(`Template apply failed: ${e.message}`),
  });

  const handleEditField = (playerId: string, field: "team" | "position", value: string) => {
    setEditedPlayers((prev) => ({
      ...prev,
      [playerId]: { ...prev[playerId], [field]: value || null },
    }));
  };

  const positions = useMemo(() => {
    const set = new Set(players.map((p) => p.position).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [players]);

  const sortedRows = players;

  useEffect(() => {
    setPage(1);
  }, [search, positionFilter, showMissingOnly, sortKey, sortDir, pageSize]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedPlayers = useMemo(() => {
    if (sortKey === "name" || FAST_DB_SORT_KEYS.includes(sortKey)) return sortedRows;
    const from = (currentPage - 1) * pageSize;
    const to = from + pageSize;
    return sortedRows.slice(from, to);
  }, [sortKey, sortedRows, currentPage, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const visiblePages = useMemo(() => {
    if (totalPages <= 11) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages = new Set<number>([
      1, 2, 3, 4, 5,
      totalPages - 1, totalPages,
      currentPage - 2, currentPage - 1, currentPage, currentPage + 1, currentPage + 2,
    ]);
    return Array.from(pages)
      .filter((p) => p >= 1 && p <= totalPages)
      .sort((a, b) => a - b);
  }, [currentPage, totalPages]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const teamsByNorm = useMemo(() => {
    const map = new Map<string, { name: string; conference: string | null }>();
    for (const t of teamsDirectory) {
      const key = normalize(t.name);
      if (!key) continue;
      if (!map.has(key)) map.set(key, t);
    }
    return map;
  }, [teamsDirectory]);
  const normalizePitchingTeam = useCallback((team: string | null | undefined) => {
    const raw = (team || "").trim();
    if (!raw) return "";
    const alias = PITCHING_TEAM_ALIASES[normalize(raw)];
    return alias || raw;
  }, []);
  const pitchingRows = useMemo<PitchingDashboardRow[]>(() => {
    const eq = readPitchingWeights();
    const scoringByNameTeam = new Map<string, {
      stuff: number | null;
      whiff: number | null;
      bb: number | null;
      barrel: number | null;
      eraPrPlus: number | null;
      fipPrPlus: number | null;
      whipPrPlus: number | null;
      k9PrPlus: number | null;
      hr9PrPlus: number | null;
      bb9PrPlus: number | null;
    }>();
    const scoringByName = new Map<string, Array<{
      stuff: number | null;
      whiff: number | null;
      bb: number | null;
      barrel: number | null;
      eraPrPlus: number | null;
      fipPrPlus: number | null;
      whipPrPlus: number | null;
      k9PrPlus: number | null;
      hr9PrPlus: number | null;
      bb9PrPlus: number | null;
    }>>();
    try {
      const rawPower = localStorage.getItem("pitching_power_ratings_storage_2025_v1");
      if (rawPower) {
        const parsedPower = JSON.parse(rawPower) as { rows?: Array<{ values?: string[] }> };
        const powerRows = Array.isArray(parsedPower.rows) ? parsedPower.rows : [];
        for (const pr of powerRows) {
          const values = Array.isArray(pr.values) ? pr.values : [];
          const name = (values[0] || "").trim();
          const team = normalizePitchingTeam(values[1]);
          if (!name) continue;
          const scoreObj = {
            stuff: toNum(values[16]),
            whiff: toNum(values[17]),
            bb: toNum(values[18]),
            barrel: toNum(values[22]),
            eraPrPlus: toNum(values[30]),
            fipPrPlus: toNum(values[31]),
            whipPrPlus: toNum(values[32]),
            k9PrPlus: toNum(values[33]),
            hr9PrPlus: toNum(values[34]),
            bb9PrPlus: toNum(values[35]),
          };
          scoringByNameTeam.set(nameTeamKey(name, team), scoreObj);
          const nameKey = normalizeName(name);
          const bucket = scoringByName.get(nameKey) || [];
          bucket.push(scoreObj);
          scoringByName.set(nameKey, bucket);
        }
      }
    } catch {
      // ignore malformed local storage
    }

    const raw = localStorage.getItem("pitching_stats_storage_2025_v1");
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as { rows?: Array<{ id?: string; values?: string[] }> };
      const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
      return rows
        .map((r, idx) => {
          const values = Array.isArray(r.values) ? r.values : [];
          const playerName = (values[0] || "").trim();
          const normalizedTeam = normalizePitchingTeam(values[1]);
          const teamMatch = teamsByNorm.get(normalize(normalizedTeam));
          const era = toNum(values[3]);
          const fip = toNum(values[4]);
          const whip = toNum(values[5]);
          const k9 = toNum(values[6]);
          const bb9 = toNum(values[7]);
          const hr9 = toNum(values[8]);
          const byNameTeam = scoringByNameTeam.get(nameTeamKey(playerName, normalizedTeam));
          const byNameBucket = scoringByName.get(normalizeName(playerName)) || [];
          const byNameUnique = byNameBucket.length === 1 ? byNameBucket[0] : null;
          const chosenScores = byNameTeam || byNameUnique || null;
          const classTransition = DEFAULT_PITCHING_CLASS_TRANSITION;
          const devAggressiveness = DEFAULT_PITCHING_DEV_AGGRESSIVENESS;

          const classEraAdj = toPitchingClassAdj(classTransition, eq.class_era_fs, eq.class_era_sj, eq.class_era_js, eq.class_era_gr);
          const classFipAdj = toPitchingClassAdj(classTransition, eq.class_fip_fs, eq.class_fip_sj, eq.class_fip_js, eq.class_fip_gr);
          const classWhipAdj = toPitchingClassAdj(classTransition, eq.class_whip_fs, eq.class_whip_sj, eq.class_whip_js, eq.class_whip_gr);
          const classK9Adj = toPitchingClassAdj(classTransition, eq.class_k9_fs, eq.class_k9_sj, eq.class_k9_js, eq.class_k9_gr);
          const classBb9Adj = toPitchingClassAdj(classTransition, eq.class_bb9_fs, eq.class_bb9_sj, eq.class_bb9_js, eq.class_bb9_gr);
          const classHr9Adj = toPitchingClassAdj(classTransition, eq.class_hr9_fs, eq.class_hr9_sj, eq.class_hr9_js, eq.class_hr9_gr);

          const pEra = projectPitchingRate({
            lastStat: era,
            prPlus: chosenScores?.eraPrPlus ?? null,
            ncaaAvg: eq.era_plus_ncaa_avg,
            ncaaSd: eq.era_plus_ncaa_sd,
            prSd: eq.era_pr_sd,
            classAdjustment: classEraAdj,
            devAggressiveness,
            thresholds: eq.era_damp_thresholds,
            impacts: eq.era_damp_impacts,
            lowerIsBetter: true,
          });
          const pFip = projectPitchingRate({
            lastStat: fip,
            prPlus: chosenScores?.fipPrPlus ?? null,
            ncaaAvg: eq.fip_plus_ncaa_avg,
            ncaaSd: eq.fip_plus_ncaa_sd,
            prSd: eq.fip_pr_sd,
            classAdjustment: classFipAdj,
            devAggressiveness,
            thresholds: eq.fip_damp_thresholds,
            impacts: eq.fip_damp_impacts,
            lowerIsBetter: true,
          });
          const pWhip = projectPitchingRate({
            lastStat: whip,
            prPlus: chosenScores?.whipPrPlus ?? null,
            ncaaAvg: eq.whip_plus_ncaa_avg,
            ncaaSd: eq.whip_plus_ncaa_sd,
            prSd: eq.whip_pr_sd,
            classAdjustment: classWhipAdj,
            devAggressiveness,
            thresholds: eq.whip_damp_thresholds,
            impacts: eq.whip_damp_impacts,
            lowerIsBetter: true,
          });
          const pK9 = projectPitchingRate({
            lastStat: k9,
            prPlus: chosenScores?.k9PrPlus ?? null,
            ncaaAvg: eq.k9_plus_ncaa_avg,
            ncaaSd: eq.k9_plus_ncaa_sd,
            prSd: eq.k9_pr_sd,
            classAdjustment: classK9Adj,
            devAggressiveness,
            thresholds: eq.k9_damp_thresholds,
            impacts: eq.k9_damp_impacts,
            lowerIsBetter: false,
          });
          const pBb9 = projectPitchingRate({
            lastStat: bb9,
            prPlus: chosenScores?.bb9PrPlus ?? null,
            ncaaAvg: eq.bb9_plus_ncaa_avg,
            ncaaSd: eq.bb9_plus_ncaa_sd,
            prSd: eq.bb9_pr_sd,
            classAdjustment: classBb9Adj,
            devAggressiveness,
            thresholds: eq.bb9_damp_thresholds,
            impacts: eq.bb9_damp_impacts,
            lowerIsBetter: true,
          });
          const pHr9 = projectPitchingRate({
            lastStat: hr9,
            prPlus: chosenScores?.hr9PrPlus ?? null,
            ncaaAvg: eq.hr9_plus_ncaa_avg,
            ncaaSd: eq.hr9_plus_ncaa_sd,
            prSd: eq.hr9_pr_sd,
            classAdjustment: classHr9Adj,
            devAggressiveness,
            thresholds: eq.hr9_damp_thresholds,
            impacts: eq.hr9_damp_impacts,
            lowerIsBetter: true,
          });

          const eraPlus = calcPitchingPlus(pEra, eq.era_plus_ncaa_avg, eq.era_plus_ncaa_sd, eq.era_plus_scale, false);
          const fipPlus = calcPitchingPlus(pFip, eq.fip_plus_ncaa_avg, eq.fip_plus_ncaa_sd, eq.fip_plus_scale, false);
          const whipPlus = calcPitchingPlus(pWhip, eq.whip_plus_ncaa_avg, eq.whip_plus_ncaa_sd, eq.whip_plus_scale, false);
          const k9Plus = calcPitchingPlus(pK9, eq.k9_plus_ncaa_avg, eq.k9_plus_ncaa_sd, eq.k9_plus_scale, true);
          const bb9Plus = calcPitchingPlus(pBb9, eq.bb9_plus_ncaa_avg, eq.bb9_plus_ncaa_sd, eq.bb9_plus_scale, false);
          const hr9Plus = calcPitchingPlus(pHr9, eq.hr9_plus_ncaa_avg, eq.hr9_plus_ncaa_sd, eq.hr9_plus_scale, false);
          const pRvPlus = [eraPlus, fipPlus, whipPlus, k9Plus, bb9Plus, hr9Plus].every((v) => v != null)
            ? (Number(eraPlus) * eq.era_plus_weight) +
              (Number(fipPlus) * eq.fip_plus_weight) +
              (Number(whipPlus) * eq.whip_plus_weight) +
              (Number(k9Plus) * eq.k9_plus_weight) +
              (Number(bb9Plus) * eq.bb9_plus_weight) +
              (Number(hr9Plus) * eq.hr9_plus_weight)
            : null;

          return {
            id: r.id || `pitching-${idx}`,
            playerName,
            team: normalizedTeam || null,
            conference: teamMatch?.conference ?? null,
            handedness: (values[2] || "").trim() || null,
            class_transition: classTransition,
            dev_aggressiveness: devAggressiveness,
            stuff_score: chosenScores?.stuff ?? null,
            whiff_score: chosenScores?.whiff ?? null,
            bb_score: chosenScores?.bb ?? null,
            barrel_score: chosenScores?.barrel ?? null,
            era_pr_plus: chosenScores?.eraPrPlus ?? null,
            fip_pr_plus: chosenScores?.fipPrPlus ?? null,
            whip_pr_plus: chosenScores?.whipPrPlus ?? null,
            k9_pr_plus: chosenScores?.k9PrPlus ?? null,
            hr9_pr_plus: chosenScores?.hr9PrPlus ?? null,
            bb9_pr_plus: chosenScores?.bb9PrPlus ?? null,
            era,
            fip,
            whip,
            k9,
            bb9,
            hr9,
            p_era: pEra,
            p_fip: pFip,
            p_whip: pWhip,
            p_k9: pK9,
            p_bb9: pBb9,
            p_hr9: pHr9,
            p_rv_plus: pRvPlus,
          };
        })
        .filter((r) => !!r.playerName);
    } catch {
      return [];
    }
  }, [normalizePitchingTeam, teamsByNorm]);
  const filteredPitchingRows = useMemo(() => {
    const q = pitchingSearch.trim().toLowerCase();
    if (!q) return pitchingRows;
    return pitchingRows.filter((r) => {
      return (
        r.playerName.toLowerCase().includes(q) ||
        (r.team || "").toLowerCase().includes(q) ||
        (r.conference || "").toLowerCase().includes(q) ||
        (r.handedness || "").toLowerCase().includes(q)
      );
    });
  }, [pitchingRows, pitchingSearch]);
  useEffect(() => {
    setPitchingPage(1);
  }, [pitchingSearch, pitchingPageSize]);
  const pitchingTotal = filteredPitchingRows.length;
  const pitchingTotalPages = Math.max(1, Math.ceil(pitchingTotal / pitchingPageSize));
  const pitchingCurrentPage = Math.min(pitchingPage, pitchingTotalPages);
  const pagedPitchingRows = useMemo(() => {
    const from = (pitchingCurrentPage - 1) * pitchingPageSize;
    const to = from + pitchingPageSize;
    return filteredPitchingRows.slice(from, to);
  }, [filteredPitchingRows, pitchingCurrentPage, pitchingPageSize]);
  useEffect(() => {
    if (pitchingPage > pitchingTotalPages) setPitchingPage(pitchingTotalPages);
  }, [pitchingPage, pitchingTotalPages]);
  const pitchingVisiblePages = useMemo(() => {
    if (pitchingTotalPages <= 11) return Array.from({ length: pitchingTotalPages }, (_, i) => i + 1);
    const pages = new Set<number>([
      1, 2, 3, 4, 5,
      pitchingTotalPages - 1, pitchingTotalPages,
      pitchingCurrentPage - 2, pitchingCurrentPage - 1, pitchingCurrentPage, pitchingCurrentPage + 1, pitchingCurrentPage + 2,
    ]);
    return Array.from(pages)
      .filter((p) => p >= 1 && p <= pitchingTotalPages)
      .sort((a, b) => a - b);
  }, [pitchingCurrentPage, pitchingTotalPages]);
  const pitchingMissingTeamCount = useMemo(
    () => pitchingRows.filter((r) => !r.team || !r.team.trim()).length,
    [pitchingRows],
  );
  useEffect(() => {
    const key = "pitching_stats_storage_2025_v1";
    const raw = localStorage.getItem(key);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { headers?: string[]; rows?: Array<{ id?: string; values?: string[] }> };
      const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
      let changed = false;
      const nextRows = rows.map((r) => {
        const values = Array.isArray(r.values) ? [...r.values] : [];
        const before = (values[1] || "").trim();
        const after = normalizePitchingTeam(before);
        if (after !== before) {
          changed = true;
          values[1] = after;
        }
        return { ...r, values };
      });
      if (!changed) return;
      localStorage.setItem(key, JSON.stringify({ headers: parsed.headers, rows: nextRows }));
    } catch {
      // ignore localStorage parse errors
    }
  }, [normalizePitchingTeam]);

  // Summary stats
  const avgOps = players.length
    ? players.reduce((s, p) => s + (p.prediction.p_ops ?? computeDerived(p.prediction.p_avg, p.prediction.p_obp, p.prediction.p_slg).ops ?? 0), 0) / players.length
    : 0;
  const avgWrcPlus = players.length
    ? players.reduce((s, p) => s + (p.prediction.p_wrc_plus ?? 0), 0) / players.length
    : 0;
  const topPlayer = players.length
    ? [...players].sort((a, b) => {
      const aw = a.prediction.p_wrc_plus ?? 0;
      const bw = b.prediction.p_wrc_plus ?? 0;
      return bw - aw;
    })[0]
    : null;

  // Chart data — top 10 by pWRC+
  const chartData = useMemo(() => {
    return [...players]
      .map((p) => ({
        player: p,
        wrcPlus: p.prediction.p_wrc_plus,
      }))
      .filter((p) => p.wrcPlus != null)
      .sort((a, b) => (b.wrcPlus ?? 0) - (a.wrcPlus ?? 0))
      .slice(0, 10)
      .map(({ player, wrcPlus }) => ({
        name: `${player.first_name[0]}. ${player.last_name}`,
        wrcPlus: wrcPlus ?? 0,
      }));
  }, [players]);

  const chartConfig = {
    wrcPlus: { label: "Predicted wRC+", color: "hsl(var(--primary))" },
  };

  const SortButton = ({ label, sortKeyVal }: { label: string; sortKeyVal: SortKey }) => (
    <Button
      variant="ghost"
      size="sm"
      className="h-auto p-0 font-medium text-muted-foreground hover:text-foreground -ml-1"
      onClick={() => toggleSort(sortKeyVal)}
    >
      {label}
      <ArrowUpDown className="ml-1 h-3 w-3" />
    </Button>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">2025 Player Dashboard</h2>
            <p className="text-muted-foreground">Unified 2025 player dashboard (all players, including transferred and departed)</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              variant={showMissingOnly ? "default" : "outline"}
              className="h-9 text-xs"
              onClick={() => setShowMissingOnly(!showMissingOnly)}
            >
              {showMissingOnly ? "Show All" : "Missing Teams"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-9 text-xs"
              onClick={() => applyTemplateDefaults.mutate()}
              disabled={applyTemplateDefaults.isPending}
            >
              {applyTemplateDefaults.isPending ? "Applying Template…" : "Apply Template: SO→JR, 0.0"}
            </Button>
          </div>
        </div>

        <Tabs value={dashboardView} onValueChange={(v) => setDashboardView(v as "hitting" | "pitching")}>
          <TabsList>
            <TabsTrigger value="hitting">Hitting</TabsTrigger>
            <TabsTrigger value="pitching">Pitching</TabsTrigger>
          </TabsList>
        </Tabs>

        {dashboardView === "hitting" ? (
          <>
        {/* Summary cards */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">2025 Players</CardTitle>
              <Users className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{players.length}</div>
              <p className="text-xs text-muted-foreground mt-1">All 2025 players</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Avg Predicted wRC+</CardTitle>
              <BarChart3 className="h-4 w-4 text-accent" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{avgWrcPlus.toFixed(0)}</div>
              <p className="text-xs text-muted-foreground mt-1">Avg pOPS: {avgOps.toFixed(3)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Top Projected Player</CardTitle>
              <Activity className="h-4 w-4 text-[hsl(var(--success))]" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold truncate">
                {topPlayer ? `${topPlayer.first_name} ${topPlayer.last_name}` : "—"}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {topPlayer
                  ? `wRC+: ${pctFormat(topPlayer.prediction.p_wrc_plus)}`
                  : "No data"}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Chart — Top 10 by pWRC+ */}
        {chartData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top 10 wRC+</CardTitle>
              <CardDescription>Top 2025 weighted runs created plus (100 = NCAA average)</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig} className="h-[280px]">
                <BarChart data={chartData} layout="vertical" margin={{ left: 80, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" domain={[0, "auto"]} />
                  <YAxis type="category" dataKey="name" width={75} tick={{ fontSize: 12 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="wrcPlus" radius={[0, 4, 4, 0]} fill="hsl(var(--primary))">
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={i === 0 ? "hsl(var(--accent))" : "hsl(var(--primary))"} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        )}

        {/* Table */}
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Player Projections</CardTitle>
              <Select value={positionFilter} onValueChange={setPositionFilter}>
                <SelectTrigger className="w-36 h-8">
                  <SelectValue placeholder="Position" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Positions</SelectItem>
                  {positions.map((pos) => (
                    <SelectItem key={pos} value={pos}>
                      {pos}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {bulkEditMode ? (
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 text-xs"
                    onClick={() => bulkSave.mutate()}
                    disabled={Object.keys(editedPlayers).length === 0 || bulkSave.isPending}
                  >
                    <Save className="h-3 w-3 mr-1" />
                    Save {Object.keys(editedPlayers).length > 0 ? `(${Object.keys(editedPlayers).length})` : ""}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => {
                      setBulkEditMode(false);
                      setEditedPlayers({});
                    }}
                  >
                    <X className="h-3 w-3 mr-1" />
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setBulkEditMode(true)}>
                  <Pencil className="h-3 w-3 mr-1" />
                  Bulk Edit
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="flex items-center gap-1 overflow-x-auto max-w-[360px]">
                {visiblePages.map((p, i) => {
                  const prev = visiblePages[i - 1];
                  const showGap = i > 0 && prev != null && p - prev > 1;
                  return (
                    <div key={p} className="flex items-center gap-1">
                      {showGap ? <span className="px-1 text-muted-foreground text-xs">...</span> : null}
                      <Button
                        variant={p === currentPage ? "default" : "outline"}
                        size="sm"
                        className="h-6 min-w-6 px-1.5 text-[10px]"
                        onClick={() => setPage(p)}
                      >
                        {p}
                      </Button>
                    </div>
                  );
                })}
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search players, teams..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">Loading projections…</div>
            ) : pagedPlayers.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">No players found</div>
            ) : (
              <>
                <div
                  ref={tableContainerRef}
                  onScroll={handleTableScroll}
                  className="overflow-x-auto [&::-webkit-scrollbar]:hidden overflow-y-auto max-h-[70vh]"
                  style={{ scrollbarWidth: "none" }}
                >
                  <Table>
                    <TableHeader className="sticky top-0 z-20 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
                      <TableRow>
                        <TableHead className="min-w-[160px] sticky left-0 z-30 bg-background">
                          <SortButton label="Player" sortKeyVal="name" />
                        </TableHead>
                        <TableHead>Prior</TableHead>
                        <TableHead className="min-w-[120px]">Class Adjustment</TableHead>
                        <TableHead className="min-w-[140px]">Dev Aggressiveness</TableHead>
                        <TableHead className="text-right"><SortButton label="pAVG" sortKeyVal="p_avg" /></TableHead>
                        <TableHead className="text-right"><SortButton label="p OBP" sortKeyVal="p_obp" /></TableHead>
                        <TableHead className="text-right"><SortButton label="pSLG" sortKeyVal="p_slg" /></TableHead>
                        <TableHead className="text-right"><SortButton label="p OPS" sortKeyVal="p_ops" /></TableHead>
                        <TableHead className="text-right"><SortButton label="pISO" sortKeyVal="p_iso" /></TableHead>
                        <TableHead className="text-right"><SortButton label="wRC+" sortKeyVal="p_wrc_plus" /></TableHead>
                        <TableHead className="text-right"><SortButton label="oWAR" sortKeyVal="p_war" /></TableHead>
                        <TableHead className="text-right"><SortButton label="Market Value" sortKeyVal="p_nil" /></TableHead>
                        <TableHead className="text-center min-w-[180px]">Scouting</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedPlayers.map((p) => {
                        const pred = p.prediction;
                        return (
                          <TableRow key={p.prediction_id}>
                            <TableCell className="font-medium whitespace-nowrap sticky left-0 z-10 bg-background">
                              <Link
                                to={profileRouteFor(p.id, p.position)}
                                className="hover:text-primary hover:underline transition-colors"
                              >
                                {p.first_name} {p.last_name}
                              </Link>
                              {bulkEditMode ? (
                                <div className="mt-1 flex items-center gap-1">
                                  <Input
                                    className="h-6 w-[72px] text-[10px]"
                                    defaultValue={editedPlayers[p.id]?.position ?? p.position ?? ""}
                                    placeholder="Pos"
                                    onBlur={(e) => {
                                      const val = e.target.value.trim();
                                      if (val !== (p.position ?? "")) handleEditField(p.id, "position", val);
                                    }}
                                  />
                                  <Input
                                    className="h-6 w-[130px] text-[10px]"
                                    defaultValue={editedPlayers[p.id]?.team ?? p.team ?? ""}
                                    placeholder="Team"
                                    onBlur={(e) => {
                                      const val = e.target.value.trim();
                                      if (val !== (p.team ?? "")) handleEditField(p.id, "team", val);
                                    }}
                                  />
                                </div>
                              ) : (
                                <div className="text-xs text-muted-foreground">
                                  {[p.position, p.team].filter(Boolean).join(" · ") || "—"}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {statFormat(pred.from_avg)}/{statFormat(pred.from_obp)}/{statFormat(pred.from_slg)}
                            </TableCell>
                            <TableCell>
                              {p.model_type === "returner" ? (
                                <ClassAdjustmentSelector
                                  value={pred.class_transition || "SJ"}
                                  onChange={(v) => updateClassTransition.mutate({ predictionId: p.prediction_id, value: v })}
                                />
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {p.model_type === "returner" ? (
                                <DevAggSelector
                                  value={pred.dev_aggressiveness ?? 0.0}
                                  onChange={(v) => updateDevAgg.mutate({ predictionId: p.prediction_id, value: v })}
                                />
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className={`text-right font-mono text-sm font-bold ${deltaClass(pred.from_avg, pred.p_avg, 0.001)}`}>{statFormat(pred.p_avg)}</TableCell>
                            <TableCell className={`text-right font-mono text-sm font-bold ${deltaClass(pred.from_obp, pred.p_obp, 0.001)}`}>{statFormat(pred.p_obp)}</TableCell>
                            <TableCell className={`text-right font-mono text-sm font-bold ${deltaClass(pred.from_slg, pred.p_slg, 0.001)}`}>{statFormat(pred.p_slg)}</TableCell>
                            <TableCell className={`text-right font-mono text-sm font-bold ${deltaClass(computeDerived(pred.from_avg, pred.from_obp, pred.from_slg).ops, pred.p_ops ?? computeDerived(pred.p_avg, pred.p_obp, pred.p_slg).ops, 0.001)}`}>
                              {statFormat(pred.p_ops ?? computeDerived(pred.p_avg, pred.p_obp, pred.p_slg).ops)}
                            </TableCell>
                            <TableCell className={`text-right font-mono text-sm font-bold ${deltaClass(computeDerived(pred.from_avg, pred.from_obp, pred.from_slg).iso, pred.p_iso ?? computeDerived(pred.p_avg, pred.p_obp, pred.p_slg).iso, 0.001)}`}>
                              {statFormat(pred.p_iso ?? computeDerived(pred.p_avg, pred.p_obp, pred.p_slg).iso)}
                            </TableCell>
                            <TableCell className={`text-right font-mono text-sm font-bold ${deltaClass(computeDerived(pred.from_avg, pred.from_obp, pred.from_slg).wrcPlus, pred.p_wrc_plus, 0.5)}`}>
                              {pctFormat(pred.p_wrc_plus)}
                            </TableCell>
                            <TableCell className={`text-right font-mono text-sm font-bold ${deltaClass(computeOWarFromWrcPlus(computeDerived(pred.from_avg, pred.from_obp, pred.from_slg).wrcPlus), computeOWarFromWrcPlus(pred.p_wrc_plus), 0.05)}`}>
                              {statFormat(computeOWarFromWrcPlus(pred.p_wrc_plus), 2)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm font-bold">
                              {moneyFormat(
                                computeNilFallback({
                                  storedNil: p.nil_value,
                                  wrcPlus: p.prediction.p_wrc_plus,
                                  conference: p.conference,
                                  position: p.position,
                                }),
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              {pred.ev_score != null &&
                              pred.barrel_score != null &&
                              pred.contact_score != null &&
                              pred.chase_score != null ? (
                                <div className="flex gap-1 justify-center flex-wrap">
                                  <ScoutMiniBox label="EV" value={pred.ev_score} />
                                  <ScoutMiniBox label="Brl" value={pred.barrel_score} />
                                  <ScoutMiniBox label="Con" value={pred.contact_score} />
                                  <ScoutMiniBox label="Chs" value={pred.chase_score} />
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                {showFixedScrollbar && (
                  <div
                    ref={scrollbarRef}
                    onScroll={handleScrollbarScroll}
                    className="fixed bottom-0 z-50 overflow-x-auto overflow-y-hidden bg-background/95 backdrop-blur border-t border-border"
                    style={{
                      height: 18,
                      left: scrollbarPos.left,
                      width: scrollbarPos.width || "100%",
                    }}
                  >
                    <div ref={scrollbarInnerRef} style={{ height: 1 }} />
                  </div>
                )}
                <div className="flex flex-col gap-2 border-t px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-muted-foreground">
                    Showing{" "}
                    <span className="font-medium text-foreground">
                      {totalCount === 0 ? 0 : ((currentPage - 1) * pageSize) + 1}
                    </span>
                    {" "}-{" "}
                    <span className="font-medium text-foreground">
                      {Math.min(currentPage * pageSize, totalCount)}
                    </span>
                    {" "}of{" "}
                    <span className="font-medium text-foreground">{totalCount}</span>
                    {" "}players
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Rows</span>
                    <Select
                      value={String(pageSize)}
                      onValueChange={(v) => setPageSize(Number(v))}
                    >
                      <SelectTrigger className="h-8 w-[88px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="50">50</SelectItem>
                        <SelectItem value="100">100</SelectItem>
                        <SelectItem value="250">250</SelectItem>
                        <SelectItem value="500">500</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
          </>
        ) : (
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">Pitching Dashboard (2025)</CardTitle>
                <CardDescription>Prior stats with scouting grades from pitching power ratings storage.</CardDescription>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="flex items-center gap-1 overflow-x-auto max-w-[360px]">
                  {pitchingVisiblePages.map((p, i) => {
                    const prev = pitchingVisiblePages[i - 1];
                    const showGap = i > 0 && prev != null && p - prev > 1;
                    return (
                      <div key={p} className="flex items-center gap-1">
                        {showGap ? <span className="px-1 text-muted-foreground text-xs">...</span> : null}
                        <Button
                          variant={p === pitchingCurrentPage ? "default" : "outline"}
                          size="sm"
                          className="h-6 min-w-6 px-1.5 text-[10px]"
                          onClick={() => setPitchingPage(p)}
                        >
                          {p}
                        </Button>
                      </div>
                    );
                  })}
                </div>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search pitchers, teams..."
                    value={pitchingSearch}
                    onChange={(e) => setPitchingSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="px-4 pt-3 pb-2 text-xs text-muted-foreground">
                {pitchingMissingTeamCount === 0 ? (
                  <span>Team check: all pitchers have a team.</span>
                ) : (
                  <span className="text-destructive">Team check: {pitchingMissingTeamCount} pitcher(s) missing a team.</span>
                )}
              </div>
              {pagedPitchingRows.length === 0 ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground">No pitchers found</div>
              ) : (
                <>
                  <div className="overflow-x-auto overflow-y-auto max-h-[70vh]">
                    <Table>
                      <TableHeader className="sticky top-0 z-20 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
                        <TableRow>
                          <TableHead className="min-w-[160px] sticky left-0 z-30 bg-background">Player</TableHead>
                          <TableHead className="text-right">pERA</TableHead>
                          <TableHead className="text-right">pFIP</TableHead>
                          <TableHead className="text-right">pWHIP</TableHead>
                          <TableHead className="text-right">pK/9</TableHead>
                          <TableHead className="text-right">pBB/9</TableHead>
                          <TableHead className="text-right">pHR/9</TableHead>
                          <TableHead className="text-right">pRV+</TableHead>
                          <TableHead className="text-right">pWAR</TableHead>
                          <TableHead className="text-right">Market Value</TableHead>
                          <TableHead className="text-center min-w-[180px]">Scouting</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pagedPitchingRows.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="font-medium whitespace-nowrap sticky left-0 z-10 bg-background">
                              <Link
                                to={`/dashboard/pitcher/storage__${encodeURIComponent(r.playerName)}__${encodeURIComponent(r.team || "")}`}
                                className="hover:text-primary hover:underline transition-colors"
                              >
                                {r.playerName}
                              </Link>
                              <div className="text-xs text-muted-foreground">
                                {[r.handedness, r.team].filter(Boolean).join(" · ") || "—"}
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">{statFormat(r.p_era, 2)}</TableCell>
                            <TableCell className="text-right font-mono text-sm">{statFormat(r.p_fip, 2)}</TableCell>
                            <TableCell className="text-right font-mono text-sm">{statFormat(r.p_whip, 2)}</TableCell>
                            <TableCell className="text-right font-mono text-sm">{statFormat(r.p_k9, 2)}</TableCell>
                            <TableCell className="text-right font-mono text-sm">{statFormat(r.p_bb9, 2)}</TableCell>
                            <TableCell className="text-right font-mono text-sm">{statFormat(r.p_hr9, 2)}</TableCell>
                            <TableCell className="text-right font-mono text-sm">{r.p_rv_plus == null ? "—" : Math.round(r.p_rv_plus)}</TableCell>
                            <TableCell className="text-right font-mono text-sm text-muted-foreground">—</TableCell>
                            <TableCell className="text-right font-mono text-sm text-muted-foreground">—</TableCell>
                            <TableCell className="text-center">
                              {r.stuff_score != null &&
                              r.whiff_score != null &&
                              r.bb_score != null &&
                              r.barrel_score != null ? (
                                <div className="flex gap-1 justify-center flex-wrap">
                                  <ScoutMiniBox label="Stf+" value={r.stuff_score} />
                                  <ScoutMiniBox label="Whf" value={r.whiff_score} />
                                  <ScoutMiniBox label="BB%" value={r.bb_score} />
                                  <ScoutMiniBox label="Brl" value={r.barrel_score} />
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="flex flex-col gap-2 border-t px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-muted-foreground">
                      Showing{" "}
                      <span className="font-medium text-foreground">
                        {pitchingTotal === 0 ? 0 : ((pitchingCurrentPage - 1) * pitchingPageSize) + 1}
                      </span>
                      {" "}-{" "}
                      <span className="font-medium text-foreground">
                        {Math.min(pitchingCurrentPage * pitchingPageSize, pitchingTotal)}
                      </span>
                      {" "}of{" "}
                      <span className="font-medium text-foreground">{pitchingTotal}</span>
                      {" "}pitchers
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Rows</span>
                      <Select
                        value={String(pitchingPageSize)}
                        onValueChange={(v) => setPitchingPageSize(Number(v))}
                      >
                        <SelectTrigger className="h-8 w-[88px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="50">50</SelectItem>
                          <SelectItem value="100">100</SelectItem>
                          <SelectItem value="250">250</SelectItem>
                          <SelectItem value="500">500</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}

function ScoutMiniBox({ label, value }: { label: string; value: number }) {
  const tier =
    value >= 80
      ? "bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]"
      : value >= 50
        ? "bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]"
        : "bg-destructive/15 text-destructive";
  return (
    <div
      className={`inline-flex min-w-[34px] flex-col items-center rounded px-1 py-0.5 leading-tight ${tier}`}
      title={`${label}: ${value}`}
    >
      <span className="text-[9px] font-semibold">{label}</span>
      <span className="text-[10px] font-bold">{Math.round(value)}</span>
    </div>
  );
}

const CLASS_OPTIONS = [
  { value: "FS", label: "FR→SO" },
  { value: "SJ", label: "SO→JR" },
  { value: "JS", label: "JR→SR" },
  { value: "GR", label: "GR" },
] as const;

function ClassAdjustmentSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-7 w-[105px] px-2 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CLASS_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value} className="text-xs">
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const DEV_OPTIONS = [
  { value: 0, label: "0.0" },
  { value: 0.5, label: "0.5" },
  { value: 1, label: "1.0" },
] as const;

function DevAggSelector({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {DEV_OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded px-2 py-1 text-xs font-semibold transition-colors ${
              active
                ? opt.value === 0
                  ? "bg-destructive/15 text-destructive"
                  : opt.value === 0.5
                    ? "bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]"
                    : "bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
