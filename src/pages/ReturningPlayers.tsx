import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
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

export default function ReturningPlayers() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [positionFilter, setPositionFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(100);
  const [sortKey, setSortKey] = useState<SortKey>("p_ops");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [bulkEditMode, setBulkEditMode] = useState(false);
  const [editedPlayers, setEditedPlayers] = useState<Record<string, { team?: string | null; position?: string | null }>>({});
  const [showMissingOnly, setShowMissingOnly] = useState(false);
  const normalize = (value: string | null | undefined) =>
    (value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

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
  });

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
  });

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

  const { data: players = [], isLoading } = useQuery({
    queryKey: ["returning-players-2025-unified"],
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

      // Fetch all regular prediction rows (returner + transfer, all statuses), then dedupe to one row/player.
      let allData: any[] = [];
      let from = 0;
      const PAGE_SIZE = 1000;

      while (true) {
        const query = supabase
          .from("player_predictions")
          .select(
            `
            *,
            players!inner(id, first_name, last_name, team, conference, position, class_year, transfer_portal)
          `,
          )
          .in("model_type", ["returner", "transfer"])
          .range(from, from + PAGE_SIZE - 1);

        const { data, error } = await query;
        if (error) throw error;

        allData = allData.concat(data || []);
        if (!data || data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      const playerIds = Array.from(new Set((allData || []).map((r: any) => r.player_id))).filter(Boolean);
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

      const byPlayer = new Map<string, any>();
      for (const row of allData || []) {
        const existing = byPlayer.get(row.players.id);
        if (!existing) {
          byPlayer.set(row.players.id, row);
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
          ((row.players.transfer_portal === true && row.model_type === "transfer") ||
            (row.players.transfer_portal !== true && row.model_type === "returner")
            ? 6
            : 0) +
          (rowHasPred ? 5 : 0) +
          (rowHasScout ? 2 : 0) +
          (row.model_type === "transfer" ? 3 : 0) +
          (row.status === "active" ? 2 : 0) +
          (rowHasFrom ? 1 : 0);
        const existingScore =
          ((existing.players.transfer_portal === true && existing.model_type === "transfer") ||
            (existing.players.transfer_portal !== true && existing.model_type === "returner")
            ? 6
            : 0) +
          (existingHasPred ? 5 : 0) +
          (existingHasScout ? 2 : 0) +
          (existing.model_type === "transfer" ? 3 : 0) +
          (existing.status === "active" ? 2 : 0) +
          (existingHasFrom ? 1 : 0);
        if (rowScore > existingScore) {
          byPlayer.set(row.players.id, row);
          continue;
        }
        if (rowScore === existingScore) {
          const rowTs = new Date(row.updated_at || 0).getTime();
          const existingTs = new Date(existing.updated_at || 0).getTime();
          if (rowTs > existingTs) byPlayer.set(row.players.id, row);
        }
      }

      return Array.from(byPlayer.values()).map((row: any) => {
        const fullName = `${row.players.first_name} ${row.players.last_name}`;
        const seedPowerRow =
          powerSeedByNameTeam.get(nameTeamKey(fullName, row.players.team)) ||
          (() => {
            const candidates = powerSeedByName.get(normalizeName(fullName)) || [];
            return candidates.length === 1 ? candidates[0] : null;
          })();
        const seedEvScore = scoreFromNormal(seedPowerRow?.avgExitVelo ?? null, 86.2, 4.28);
        const seedBarrelScore = scoreFromNormal(seedPowerRow?.barrel ?? null, 17.3, 7.89);
        const seedContactScore = scoreFromNormal(seedPowerRow?.contact ?? null, 77.1, 6.6);
        const seedChaseScore = scoreFromNormal(seedPowerRow?.chase ?? null, 23.1, 5.58, true);
        const candidates = statsByName.get(normalize(fullName)) || [];
        const byTeam = statsByNameTeam.get(nameTeamKey(fullName, row.players.team));
        const exactByStats = candidates.find((r) =>
          (r.avg == null || row.from_avg == null || Math.round(r.avg * 1000) === Math.round(Number(row.from_avg) * 1000)) &&
          (r.obp == null || row.from_obp == null || Math.round(r.obp * 1000) === Math.round(Number(row.from_obp) * 1000)) &&
          (r.slg == null || row.from_slg == null || Math.round(r.slg * 1000) === Math.round(Number(row.from_slg) * 1000))
        );
        const resolvedTeam2025 = byTeam?.team || exactByStats?.team || (candidates.length === 1 ? candidates[0].team : null) || row.players.team;

        return ({
        id: row.players.id,
        prediction_id: row.id,
        first_name: row.players.first_name,
        last_name: row.players.last_name,
        team: resolvedTeam2025,
        conference: row.players.conference,
        position: row.players.position,
        class_year: row.players.class_year,
        transfer_portal: row.players.transfer_portal,
        model_type: row.model_type,
        status: row.status,
        nil_value: nilByPlayer.get(row.players.id) ?? null,
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
      });
      }) as ReturnerPlayer[];
    },
  });

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
      return recalculatePredictionById(predictionId, { class_transition: value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["returning-players-2025-unified"] });
      toast.success("Class adjustment updated");
    },
    onError: (e) => toast.error(`Class adjustment failed: ${e.message}`),
  });

  const updateDevAgg = useMutation({
    mutationFn: async ({ predictionId, value }: { predictionId: string; value: number }) => {
      return recalculatePredictionById(predictionId, { dev_aggressiveness: value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["returning-players-2025-unified"] });
      toast.success("Dev aggressiveness updated");
    },
    onError: (e) => toast.error(`Dev aggressiveness failed: ${e.message}`),
  });

  const applyTemplateDefaults = useMutation({
    mutationFn: async () => {
      const returnerRows = players.filter((p) => p.model_type === "returner");
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

  const filtered = useMemo(() => {
    let list = players;
    if (positionFilter !== "all") {
      list = list.filter((p) => p.position === positionFilter);
    }
    if (showMissingOnly) {
      list = list.filter((p) => !p.team);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) ||
          (p.team || "").toLowerCase().includes(q) ||
          (p.conference || "").toLowerCase().includes(q),
      );
    }
    list.sort((a, b) => {
      let aVal: number | string | null;
      let bVal: number | string | null;
      if (sortKey === "name") {
        aVal = `${a.last_name} ${a.first_name}`;
        bVal = `${b.last_name} ${b.first_name}`;
        return sortDir === "asc"
          ? (aVal as string).localeCompare(bVal as string)
          : (bVal as string).localeCompare(aVal as string);
      }
      const ad = computeDerived(a.prediction.from_avg, a.prediction.from_obp, a.prediction.from_slg);
      const bd = computeDerived(b.prediction.from_avg, b.prediction.from_obp, b.prediction.from_slg);
      const aMetric: Record<SortKey, number | null> = {
        name: null,
        p_avg: a.prediction.p_avg,
        p_obp: a.prediction.p_obp,
        p_slg: a.prediction.p_slg,
        p_ops: a.prediction.p_ops ?? computeDerived(a.prediction.p_avg, a.prediction.p_obp, a.prediction.p_slg).ops,
        p_iso: a.prediction.p_iso ?? computeDerived(a.prediction.p_avg, a.prediction.p_obp, a.prediction.p_slg).iso,
        p_wrc_plus: a.prediction.p_wrc_plus,
        p_war: computeOWarFromWrcPlus(a.prediction.p_wrc_plus),
        p_nil: computeNilFallback({
          storedNil: a.nil_value,
          wrcPlus: a.prediction.p_wrc_plus,
          conference: a.conference,
          position: a.position,
        }),
      };
      const bMetric: Record<SortKey, number | null> = {
        name: null,
        p_avg: b.prediction.p_avg,
        p_obp: b.prediction.p_obp,
        p_slg: b.prediction.p_slg,
        p_ops: b.prediction.p_ops ?? computeDerived(b.prediction.p_avg, b.prediction.p_obp, b.prediction.p_slg).ops,
        p_iso: b.prediction.p_iso ?? computeDerived(b.prediction.p_avg, b.prediction.p_obp, b.prediction.p_slg).iso,
        p_wrc_plus: b.prediction.p_wrc_plus,
        p_war: computeOWarFromWrcPlus(b.prediction.p_wrc_plus),
        p_nil: computeNilFallback({
          storedNil: b.nil_value,
          wrcPlus: b.prediction.p_wrc_plus,
          conference: b.conference,
          position: b.position,
        }),
      };
      aVal = aMetric[sortKey] ?? -999;
      bVal = bMetric[sortKey] ?? -999;
      return sortDir === "asc" ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
    return list;
  }, [players, search, sortKey, sortDir, showMissingOnly, positionFilter]);

  useEffect(() => {
    setPage(1);
  }, [search, positionFilter, showMissingOnly, sortKey, sortDir, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedPlayers = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

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
            ) : filtered.length === 0 ? (
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
                        <TableHead className="text-right"><SortButton label="NIL" sortKeyVal="p_nil" /></TableHead>
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
                                to={`/dashboard/player/${p.id}`}
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
                      {filtered.length === 0 ? 0 : ((currentPage - 1) * pageSize) + 1}
                    </span>
                    {" "}-{" "}
                    <span className="font-medium text-foreground">
                      {Math.min(currentPage * pageSize, filtered.length)}
                    </span>
                    {" "}of{" "}
                    <span className="font-medium text-foreground">{filtered.length}</span>
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
