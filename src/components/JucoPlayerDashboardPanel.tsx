/**
 * JUCO Player Dashboard — sister surface to the D1 Player Dashboard
 * (ReturningPlayers.tsx). Reads 2027 projections from player_predictions:
 *   - When impersonating a customer team: reads precomputed (team-scoped
 *     transfer projection from eager precompute).
 *   - Otherwise: reads regular (cross-team returner row, Option A verbatim
 *     copy of 2026 actuals → 2027 projection columns).
 * Metadata (team, position, district, class, hand) comes from the joined
 * players row. Qualified-only via Hitter PA ≥ 75 / Pitcher IP ≥ 20.
 *
 * Column set + spacing + filter shape + title banner all mirror D1, EXCEPT:
 *   - No Value / oWAR / Scouting columns (no projection pipeline outputs)
 *   - No Bulk Edit (nothing to bulk-edit on raw actuals — JUCO doesn't have
 *     editable player_predictions rows for class/dev customization yet)
 *   - "Conference" is labeled "District" since JUCO conferences are districts
 *
 * wRC+ uses the locked D1 formula (CLAUDE.md):
 *   wRC+ = ((0.45·OBP + 0.30·SLG + 0.15·AVG + 0.10·ISO) / 0.364) · 100
 *
 * Qualifier thresholds match the simulator + add-new flows:
 *   - Hitters: PA ≥ 75
 *   - Pitchers: IP ≥ 20
 */
import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ArrowUpDown, Search, X, ChevronDown, Check, Target } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { profileRouteFor } from "@/lib/profileRoutes";
import { cn } from "@/lib/utils";
import { useTargetBoard } from "@/hooks/useTargetBoard";
import { useAuth } from "@/hooks/useAuth";

const HITTER_PA_THRESHOLD = 75;
const PITCHER_IP_THRESHOLD = 20;
const SEASON = 2026;
const PAGE_SIZE = 50;
const HITTER_POSITION_TOKENS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "IF", "OF", "TWP"];

const fmt3 = (v: number | null | undefined) => (v == null || !Number.isFinite(Number(v)) ? "—" : Number(v).toFixed(3).replace(/^0/, ""));
const fmt2 = (v: number | null | undefined) => (v == null || !Number.isFinite(Number(v)) ? "—" : Number(v).toFixed(2));
const fmt1 = (v: number | null | undefined) => (v == null || !Number.isFinite(Number(v)) ? "—" : Number(v).toFixed(1));
const fmtInt = (v: number | null | undefined) => (v == null || !Number.isFinite(Number(v)) ? "—" : String(Math.round(Number(v))));

const computeWrcPlus = (avg: number | null, obp: number | null, slg: number | null, iso: number | null): number | null => {
  if (avg == null || obp == null || slg == null) return null;
  const isoVal = iso != null ? iso : (slg - avg);
  return ((0.45 * obp + 0.30 * slg + 0.15 * avg + 0.10 * isoVal) / 0.364) * 100;
};

// pRV+ uses the D1 formula weights from CLAUDE.md:
//   pRV+ = 0.30·FIP⁺ + 0.25·ERA⁺ + 0.15·WHIP⁺ + 0.15·K9⁺ + 0.10·BB9⁺ + 0.05·HR9⁺
// Each component is a ratio-based env+ (lgValue / pitcherValue × 100 for
// lower-is-better; pitcherValue / lgValue × 100 for K/9). Uses JUCO 2026
// league averages so an average JUCO pitcher centers at 100 (rather than
// scoring below 100 against D1 baseline — that's the simulator's job, not
// the leaderboard's).
const JUCO_LG = { era: 7.4, fip: 7.4, whip: 1.8, k9: 9.5, bb9: 5.0, hr9: 1.0 };
const computePrvPlus = (
  era: number | null, fip: number | null, whip: number | null,
  k9: number | null, bb9: number | null, hr9: number | null,
): number | null => {
  if (era == null || fip == null || whip == null || k9 == null || bb9 == null || hr9 == null) return null;
  if (era <= 0 || fip <= 0 || whip <= 0 || k9 <= 0 || bb9 <= 0 || hr9 <= 0) return null;
  // Cap individual components at 250 so a single outlier rate (e.g. tiny HR/9
  // from a 20-IP reliever) can't dominate the composite. 250 is well above
  // realistic D1 leader ranges (~200 top end) so it only kicks in for noise.
  const cap = (v: number) => Math.max(0, Math.min(250, v));
  const eraPlus = cap((JUCO_LG.era / era) * 100);
  const fipPlus = cap((JUCO_LG.fip / fip) * 100);
  const whipPlus = cap((JUCO_LG.whip / whip) * 100);
  const k9Plus = cap((k9 / JUCO_LG.k9) * 100);
  const bb9Plus = cap((JUCO_LG.bb9 / bb9) * 100);
  const hr9Plus = cap((JUCO_LG.hr9 / hr9) * 100);
  return 0.30 * fipPlus + 0.25 * eraPlus + 0.15 * whipPlus + 0.15 * k9Plus + 0.10 * bb9Plus + 0.05 * hr9Plus;
};

const stripDistrictLabel = (conf: string | null): string => {
  if (!conf) return "";
  return conf.replace(/^NJCAA D1 /, "").replace(/ District$/, "");
};

// Slim inline MultiSelectFilter — mirrors D1 component shape so visual feel
// is identical. Self-contained here so we don't have to refactor the 3,000-line
// ReturningPlayers to export its internal helper.
function MiniMultiSelect({ label, options, selected, onToggle, onClear }: {
  label: string;
  options: { value: string; label: string }[];
  selected: Set<string>;
  onToggle: (v: string) => void;
  onClear: () => void;
}) {
  const count = selected.size;
  const summary = count === 0 ? "All" : count === 1 ? options.find((o) => o.value === Array.from(selected)[0])?.label ?? `${count}` : `${count} selected`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "h-8 inline-flex items-center justify-between gap-2 rounded-md border px-2.5 text-xs font-medium transition-colors duration-150 cursor-pointer",
            count > 0 ? "border-[#D4AF37]/60 bg-[#D4AF37]/10 text-[#D4AF37] hover:bg-[#D4AF37]/15" : "border-border bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
          )}
        >
          <span className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.08em] opacity-80">{label}</span>
            <span className="font-semibold">{summary}</span>
          </span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-56 p-2">
        <div className="flex items-center justify-between mb-1.5 px-1">
          <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{label}</span>
          {count > 0 && (
            <button type="button" onClick={onClear} className="text-[10px] uppercase tracking-[0.08em] text-[#D4AF37] hover:text-[#c49e2e] transition-colors cursor-pointer">
              Clear
            </button>
          )}
        </div>
        <div className="flex flex-col max-h-[300px] overflow-y-auto">
          {options.map((opt) => {
            const checked = selected.has(opt.value);
            return (
              <button
                type="button"
                key={opt.value}
                onClick={() => onToggle(opt.value)}
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 rounded-sm text-xs transition-colors duration-150 cursor-pointer text-left",
                  checked ? "bg-[#D4AF37]/10 text-foreground" : "text-foreground hover:bg-muted/60",
                )}
              >
                <span className={cn("h-3.5 w-3.5 inline-flex items-center justify-center rounded-sm border", checked ? "bg-[#D4AF37] border-[#D4AF37] text-[#040810]" : "border-border bg-background")}>
                  {checked && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                </span>
                <span className="font-medium">{opt.label}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

type HitterSortKey = "name" | "avg" | "obp" | "slg" | "ops" | "iso" | "wrcPlus";
type PitcherSortKey = "name" | "ip" | "era" | "fip" | "whip" | "k9" | "bb9" | "hr9" | "prvPlus";

type HitterRow = {
  id: string;
  source_player_id: string;
  name: string;
  team: string | null;
  pos: string | null;
  bats: string | null;
  classYear: string | null;
  district: string | null;
  avg: number | null;
  obp: number | null;
  slg: number | null;
  ops: number | null;
  iso: number | null;
  wrcPlus: number | null;
  player_id: string | null;
};

type PitcherRow = {
  id: string;
  source_player_id: string;
  name: string;
  team: string | null;
  throws: string | null;
  role: string | null;
  classYear: string | null;
  district: string | null;
  ip: number | null;
  era: number | null;
  fip: number | null;
  whip: number | null;
  k9: number | null;
  bb9: number | null;
  hr9: number | null;
  prvPlus: number | null;
  player_id: string | null;
};

function SortButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-auto p-0 font-medium text-muted-foreground hover:text-foreground -ml-1 cursor-pointer"
      onClick={onClick}
    >
      <span className={active ? "text-foreground font-semibold" : ""}>{label}</span>
      <ArrowUpDown className={`ml-1 h-3 w-3 ${active ? "text-foreground" : ""}`} />
    </Button>
  );
}

const positionMatchesFilter = (pos: string | null, filters: Set<string>): boolean => {
  if (filters.size === 0) return true;
  const p = (pos || "").toUpperCase().trim();
  for (const f of filters) {
    if (f === "IF" && /^(1B|2B|3B|SS|IF)$/.test(p)) return true;
    if (f === "OF" && /^(LF|CF|RF|OF)$/.test(p)) return true;
    if (f === "TWP" && p === "TWP") return true; // future: cross-check is_twp from players table
    if (f === p) return true;
  }
  return false;
};

export function JucoPlayerDashboardPanel({ view }: { view: "hitting" | "pitching" }) {
  const location = useLocation();
  const { isOnBoard, addPlayer: addToBoard, removePlayer: removeFromBoard } = useTargetBoard();
  const [search, setSearch] = useState("");
  const [positionFilters, setPositionFilters] = useState<Set<string>>(new Set());
  const [classFilters, setClassFilters] = useState<Set<string>>(new Set());
  const [batsFilters, setBatsFilters] = useState<Set<string>>(new Set());
  const [throwsFilters, setThrowsFilters] = useState<Set<string>>(new Set());
  const [districtFilters, setDistrictFilters] = useState<Set<string>>(new Set());
  const [hitterSort, setHitterSort] = useState<{ key: HitterSortKey; dir: "asc" | "desc" }>({ key: "wrcPlus", dir: "desc" });
  const [pitcherSort, setPitcherSort] = useState<{ key: PitcherSortKey; dir: "asc" | "desc" }>({ key: "prvPlus", dir: "desc" });
  const [page, setPage] = useState(1);

  const toggleSetMember = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) => (v: string) => {
    setter((cur) => {
      const next = new Set(cur);
      if (next.has(v)) next.delete(v); else next.add(v);
      return next;
    });
    setPage(1);
  };

  // ── Queries ──────────────────────────────────────────────────────────
  // Reads from player_predictions (2027 projections), not Hitter/Pitching Master.
  // - When impersonating a customer team: reads precomputed (team-scoped transfer projection)
  // - Otherwise: reads regular (cross-team returner row = 2026 verbatim per Option A)
  // Metadata (team / position / district / class / hand) comes from the joined players row.
  const { effectiveTeamId } = useAuth();

  const { data: hitterRows = [], isLoading: hittersLoading } = useQuery({
    queryKey: ["juco-hitter-dashboard", SEASON, effectiveTeamId],
    enabled: view === "hitting",
    queryFn: async (): Promise<HitterRow[]> => {
      // Pull BOTH team-scoped precomputed (when impersonating) AND global
      // regular-variant rows. Then prefer precomputed per player. This way a
      // newly-onboarded customer team (autofire only runs D1 scope) still sees
      // JUCO via the global rows until manual JUCO precompute runs.
      const preds: any[] = [];
      let from = 0;
      while (true) {
        let q: any = supabase
          .from("player_predictions")
          .select(`player_id, customer_team_id, model_type, variant, p_avg, p_obp, p_slg, p_iso, p_ops, p_wrc_plus, players!inner(id, source_player_id, first_name, last_name, team, position, conference, class_year, bats_hand, pa, division)`)
          .eq("players.division", "NJCAA_D1")
          .not("p_wrc_plus", "is", null)
          .gte("players.pa", HITTER_PA_THRESHOLD)
          .in("variant", ["regular", "precomputed"])
          .in("model_type", ["returner", "transfer"]);
        if (effectiveTeamId) {
          q = q.or(`customer_team_id.is.null,customer_team_id.eq.${effectiveTeamId}`);
        } else {
          q = q.is("customer_team_id", null);
        }
        const { data, error } = await q.range(from, from + 999);
        if (error) throw error;
        preds.push(...(data || []));
        if (!data || data.length < 1000) break;
        from += 1000;
      }
      // Dedupe per player: prefer team-scoped precomputed over global regular.
      const byPlayer = new Map<string, any>();
      for (const r of preds) {
        const key = r.player_id;
        const existing = byPlayer.get(key);
        const isTeamScoped = r.customer_team_id != null && r.variant === "precomputed";
        if (!existing || isTeamScoped) byPlayer.set(key, r);
      }
      return Array.from(byPlayer.values()).map((r: any): HitterRow => {
        const p = r.players;
        const avg = r.p_avg != null ? Number(r.p_avg) : null;
        const obp = r.p_obp != null ? Number(r.p_obp) : null;
        const slg = r.p_slg != null ? Number(r.p_slg) : null;
        const iso = r.p_iso != null ? Number(r.p_iso) : (avg != null && slg != null ? slg - avg : null);
        const ops = r.p_ops != null ? Number(r.p_ops) : (obp != null && slg != null ? obp + slg : null);
        const wrcPlus = r.p_wrc_plus != null ? Number(r.p_wrc_plus) : computeWrcPlus(avg, obp, slg, iso);
        return {
          id: p?.source_player_id ?? p?.id ?? Math.random().toString(),
          source_player_id: p?.source_player_id ?? "",
          name: `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim(),
          team: p?.team ?? null,
          pos: p?.position ?? null,
          bats: p?.bats_hand ?? null,
          classYear: p?.class_year ?? null,
          district: stripDistrictLabel(p?.conference) || null,
          avg, obp, slg, ops, iso, wrcPlus,
          player_id: p?.id ?? null,
        };
      });
    },
  });

  const { data: pitcherRows = [], isLoading: pitchersLoading } = useQuery({
    queryKey: ["juco-pitcher-dashboard", SEASON, effectiveTeamId],
    enabled: view === "pitching",
    queryFn: async (): Promise<PitcherRow[]> => {
      // Pull BOTH team-scoped precomputed (when impersonating) AND global
      // regular-variant rows. Prefer precomputed per player. Same pattern as
      // hitter query — falls back to global when team has no precomputed JUCO.
      const preds: any[] = [];
      let from = 0;
      while (true) {
        let q: any = supabase
          .from("player_predictions")
          .select(`player_id, customer_team_id, model_type, variant, p_era, p_fip, p_whip, p_k9, p_bb9, p_hr9, p_rv_plus, projected_ip, pitcher_role, players!inner(id, source_player_id, first_name, last_name, team, position, conference, class_year, throws_hand, ip, division)`)
          .eq("players.division", "NJCAA_D1")
          .not("p_era", "is", null)
          .gte("players.ip", PITCHER_IP_THRESHOLD)
          .in("variant", ["regular", "precomputed"])
          .in("model_type", ["returner", "transfer"]);
        if (effectiveTeamId) {
          q = q.or(`customer_team_id.is.null,customer_team_id.eq.${effectiveTeamId}`);
        } else {
          q = q.is("customer_team_id", null);
        }
        const { data, error } = await q.range(from, from + 999);
        if (error) throw error;
        preds.push(...(data || []));
        if (!data || data.length < 1000) break;
        from += 1000;
      }
      const byPlayer = new Map<string, any>();
      for (const r of preds) {
        const key = r.player_id;
        const existing = byPlayer.get(key);
        const isTeamScoped = r.customer_team_id != null && r.variant === "precomputed";
        if (!existing || isTeamScoped) byPlayer.set(key, r);
      }
      return Array.from(byPlayer.values()).map((r: any): PitcherRow => {
        const p = r.players;
        const era = r.p_era != null ? Number(r.p_era) : null;
        const fip = r.p_fip != null ? Number(r.p_fip) : null;
        const whip = r.p_whip != null ? Number(r.p_whip) : null;
        const k9 = r.p_k9 != null ? Number(r.p_k9) : null;
        const bb9 = r.p_bb9 != null ? Number(r.p_bb9) : null;
        const hr9 = r.p_hr9 != null ? Number(r.p_hr9) : null;
        const ip = r.projected_ip != null ? Number(r.projected_ip) : (p?.ip != null ? Number(p.ip) : null);
        const prvPlus = r.p_rv_plus != null ? Number(r.p_rv_plus) : computePrvPlus(era, fip, whip, k9, bb9, hr9);
        return {
          id: p?.source_player_id ?? p?.id ?? Math.random().toString(),
          source_player_id: p?.source_player_id ?? "",
          name: `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim(),
          team: p?.team ?? null,
          throws: p?.throws_hand ?? null,
          role: r.pitcher_role ?? null,
          classYear: p?.class_year ?? null,
          district: stripDistrictLabel(p?.conference) || null,
          ip, era, fip, whip, k9, bb9, hr9, prvPlus,
          player_id: p?.id ?? null,
        };
      });
    },
  });

  // ── Available filter options ────────────────────────────────────────
  const hitterDistricts = useMemo(() => {
    const s = new Set<string>();
    for (const r of hitterRows) if (r.district) s.add(r.district);
    return Array.from(s).sort().map((v) => ({ value: v, label: v }));
  }, [hitterRows]);
  const pitcherDistricts = useMemo(() => {
    const s = new Set<string>();
    for (const r of pitcherRows) if (r.district) s.add(r.district);
    return Array.from(s).sort().map((v) => ({ value: v, label: v }));
  }, [pitcherRows]);
  const hitterClasses = useMemo(() => {
    const s = new Set<string>();
    for (const r of hitterRows) if (r.classYear) s.add(r.classYear);
    return Array.from(s).sort().map((v) => ({ value: v, label: v }));
  }, [hitterRows]);
  const pitcherClasses = useMemo(() => {
    const s = new Set<string>();
    for (const r of pitcherRows) if (r.classYear) s.add(r.classYear);
    return Array.from(s).sort().map((v) => ({ value: v, label: v }));
  }, [pitcherRows]);
  const hitterBats = useMemo(() => {
    const s = new Set<string>();
    for (const r of hitterRows) if (r.bats) s.add(r.bats);
    return Array.from(s).sort().map((v) => ({ value: v, label: v }));
  }, [hitterRows]);
  const pitcherThrows = useMemo(() => {
    const s = new Set<string>();
    for (const r of pitcherRows) if (r.throws) s.add(r.throws);
    return Array.from(s).sort().map((v) => ({ value: v, label: v }));
  }, [pitcherRows]);

  // ── Filters + sort + pagination ────────────────────────────────────
  const filteredHitters = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = hitterRows.filter((r) => {
      if (q && !`${r.name} ${r.team ?? ""}`.toLowerCase().includes(q)) return false;
      if (!positionMatchesFilter(r.pos, positionFilters)) return false;
      if (classFilters.size > 0 && (!r.classYear || !classFilters.has(r.classYear))) return false;
      if (batsFilters.size > 0 && (!r.bats || !batsFilters.has(r.bats))) return false;
      if (districtFilters.size > 0 && (!r.district || !districtFilters.has(r.district))) return false;
      return true;
    });
    const { key, dir } = hitterSort;
    const mul = dir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const av = a[key as keyof HitterRow] as any;
      const bv = b[key as keyof HitterRow] as any;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * mul;
      return (Number(av) - Number(bv)) * mul;
    });
    return rows;
  }, [hitterRows, search, positionFilters, classFilters, batsFilters, districtFilters, hitterSort]);

  const filteredPitchers = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = pitcherRows.filter((r) => {
      if (q && !`${r.name} ${r.team ?? ""}`.toLowerCase().includes(q)) return false;
      if (classFilters.size > 0 && (!r.classYear || !classFilters.has(r.classYear))) return false;
      if (throwsFilters.size > 0 && (!r.throws || !throwsFilters.has(r.throws))) return false;
      if (districtFilters.size > 0 && (!r.district || !districtFilters.has(r.district))) return false;
      return true;
    });
    const { key, dir } = pitcherSort;
    const mul = dir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const av = a[key as keyof PitcherRow] as any;
      const bv = b[key as keyof PitcherRow] as any;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * mul;
      return (Number(av) - Number(bv)) * mul;
    });
    return rows;
  }, [pitcherRows, search, classFilters, throwsFilters, districtFilters, pitcherSort]);

  const filtered = view === "hitting" ? filteredHitters : filteredPitchers;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pagedHitters = useMemo(() => filteredHitters.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE), [filteredHitters, safePage]);
  const pagedPitchers = useMemo(() => filteredPitchers.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE), [filteredPitchers, safePage]);

  const togglePosition = (pos: string) => { toggleSetMember(setPositionFilters)(pos); };
  const toggleHitterSort = (key: HitterSortKey) => {
    setHitterSort((cur) => cur.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" });
  };
  const togglePitcherSort = (key: PitcherSortKey) => {
    setPitcherSort((cur) => {
      if (cur.key === key) return { key, dir: cur.dir === "asc" ? "desc" : "asc" };
      const higherBetter = key === "ip" || key === "k9" || key === "prvPlus";
      return { key, dir: key === "name" ? "asc" : (higherBetter ? "desc" : "asc") };
    });
  };

  // Pagination visible-pages (compact ellipsis)
  const visiblePages = useMemo(() => {
    const pages: number[] = [];
    const range = (a: number, b: number) => { for (let i = a; i <= b; i++) pages.push(i); };
    if (totalPages <= 7) { range(1, totalPages); return pages; }
    range(1, 2);
    if (safePage > 4) pages.push(-1);
    range(Math.max(3, safePage - 1), Math.min(totalPages - 2, safePage + 1));
    if (safePage < totalPages - 3) pages.push(-1);
    range(totalPages - 1, totalPages);
    return Array.from(new Set(pages));
  }, [safePage, totalPages]);

  const isLoading = view === "hitting" ? hittersLoading : pitchersLoading;

  return (
    <div className="space-y-2">
      {/* Search bar — same shape as D1 */}
      <div className="space-y-2">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder={view === "hitting" ? "Search JUCO hitters..." : "Search JUCO pitchers..."}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9 pr-8 h-9 text-sm rounded-lg border-border/60 focus-visible:ring-primary/30"
          />
          {search && (
            <button onClick={() => { setSearch(""); setPage(1); }} className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Filter chips row — mirrors D1 layout */}
        <div className="flex flex-wrap gap-1.5 items-center">
          {view === "hitting" ? (
            <>
              <button
                onClick={() => { setPositionFilters(new Set()); setPage(1); }}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium rounded-md transition-colors duration-150 cursor-pointer",
                  positionFilters.size === 0 ? "bg-[#D4AF37]/15 text-[#D4AF37] ring-1 ring-[#D4AF37]/40" : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
                )}
                title="Show all positions"
              >
                All
              </button>
              {HITTER_POSITION_TOKENS.map((pos) => {
                const active = positionFilters.has(pos);
                const isGroup = pos === "IF" || pos === "OF" || pos === "TWP";
                return (
                  <button
                    key={pos}
                    onClick={() => togglePosition(pos)}
                    className={cn(
                      "px-2.5 py-1 text-xs font-medium rounded-md transition-colors duration-150 cursor-pointer",
                      isGroup && "border border-dashed border-border/70",
                      active ? "bg-[#D4AF37]/15 text-[#D4AF37] ring-1 ring-[#D4AF37]/40" : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
                    )}
                    title={pos === "IF" ? "Infield: 1B, 2B, 3B, SS" : pos === "OF" ? "Outfield: LF, CF, RF, OF" : pos === "TWP" ? "Two-way players" : pos}
                  >
                    {pos}
                  </button>
                );
              })}
              <div className="h-5 w-px bg-border/60 mx-1" aria-hidden />
              <MiniMultiSelect label="Class" options={hitterClasses} selected={classFilters} onToggle={toggleSetMember(setClassFilters)} onClear={() => { setClassFilters(new Set()); setPage(1); }} />
              <MiniMultiSelect label="Bats" options={hitterBats} selected={batsFilters} onToggle={toggleSetMember(setBatsFilters)} onClear={() => { setBatsFilters(new Set()); setPage(1); }} />
              <MiniMultiSelect label="District" options={hitterDistricts} selected={districtFilters} onToggle={toggleSetMember(setDistrictFilters)} onClear={() => { setDistrictFilters(new Set()); setPage(1); }} />
            </>
          ) : (
            <>
              <MiniMultiSelect label="Throws" options={pitcherThrows} selected={throwsFilters} onToggle={toggleSetMember(setThrowsFilters)} onClear={() => { setThrowsFilters(new Set()); setPage(1); }} />
              <MiniMultiSelect label="Class" options={pitcherClasses} selected={classFilters} onToggle={toggleSetMember(setClassFilters)} onClear={() => { setClassFilters(new Set()); setPage(1); }} />
              <MiniMultiSelect label="District" options={pitcherDistricts} selected={districtFilters} onToggle={toggleSetMember(setDistrictFilters)} onClear={() => { setDistrictFilters(new Set()); setPage(1); }} />
            </>
          )}
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle
            className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]"
            style={{ fontFamily: "'Oswald', sans-serif" }}
          >
            Player Projections
          </CardTitle>
          {totalPages > 1 && (
            <div className="flex items-center gap-1 overflow-x-auto max-w-[360px]">
              {visiblePages.map((p, i) => p === -1 ? (
                <span key={`gap-${i}`} className="px-1 text-muted-foreground text-xs">…</span>
              ) : (
                <Button
                  key={p}
                  size="sm"
                  variant={p === safePage ? "default" : "ghost"}
                  className="h-7 w-7 p-0 text-xs"
                  onClick={() => setPage(p)}
                >
                  {p}
                </Button>
              ))}
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">Loading 2027 projections…</div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">No qualified JUCO {view === "hitting" ? "hitters" : "pitchers"} match.</div>
          ) : (
            <div className="overflow-x-auto [&::-webkit-scrollbar]:hidden overflow-y-auto max-h-[70vh]" style={{ scrollbarWidth: "none" }}>
              <Table>
                {view === "hitting" ? (
                  <>
                    <TableHeader className="sticky top-0 z-20 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
                      <TableRow>
                        <TableHead className="w-[200px] sticky left-0 z-30 bg-background">
                          <SortButton label="Player" active={hitterSort.key === "name"} onClick={() => toggleHitterSort("name")} />
                        </TableHead>
                        <TableHead className="text-right text-xs w-[70px]"><SortButton label="AVG" active={hitterSort.key === "avg"} onClick={() => toggleHitterSort("avg")} /></TableHead>
                        <TableHead className="text-right text-xs w-[70px]"><SortButton label="OBP" active={hitterSort.key === "obp"} onClick={() => toggleHitterSort("obp")} /></TableHead>
                        <TableHead className="text-right text-xs w-[70px]"><SortButton label="SLG" active={hitterSort.key === "slg"} onClick={() => toggleHitterSort("slg")} /></TableHead>
                        <TableHead className="text-right text-xs w-[70px]"><SortButton label="OPS" active={hitterSort.key === "ops"} onClick={() => toggleHitterSort("ops")} /></TableHead>
                        <TableHead className="text-right text-xs w-[70px]"><SortButton label="ISO" active={hitterSort.key === "iso"} onClick={() => toggleHitterSort("iso")} /></TableHead>
                        <TableHead className="text-right text-xs w-[70px]"><SortButton label="wRC+" active={hitterSort.key === "wrcPlus"} onClick={() => toggleHitterSort("wrcPlus")} /></TableHead>
                        <TableHead className="w-[36px] text-center text-xs p-0"><Target className="h-3.5 w-3.5 mx-auto text-muted-foreground" /></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedHitters.map((r) => (
                        <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50 transition-colors">
                          <TableCell className="font-medium whitespace-nowrap sticky left-0 z-10 bg-background w-[200px]">
                            <div className="min-w-0">
                              {r.player_id ? (
                                <Link
                                  to={profileRouteFor(r.player_id, r.pos)}
                                  state={{ returnTo: `${location.pathname}${location.search}${location.hash}` }}
                                  className="hover:text-primary hover:underline transition-colors"
                                >
                                  {r.name}
                                </Link>
                              ) : r.name}
                              <div className="text-xs text-muted-foreground">
                                {[r.pos, r.team].filter(Boolean).join(" · ") || "—"}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{fmt3(r.avg)}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{fmt3(r.obp)}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{fmt3(r.slg)}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{fmt3(r.ops)}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{fmt3(r.iso)}</TableCell>
                          <TableCell className="text-right text-sm font-semibold tabular-nums">{fmtInt(r.wrcPlus)}</TableCell>
                          <TableCell className="text-center p-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!r.player_id) return;
                                if (isOnBoard(r.player_id)) removeFromBoard(r.player_id);
                                else addToBoard({ playerId: r.player_id });
                              }}
                              disabled={!r.player_id}
                              className={cn(
                                "inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors",
                                !r.player_id ? "text-muted-foreground/20 cursor-not-allowed" :
                                isOnBoard(r.player_id)
                                  ? "bg-primary/10 text-primary hover:bg-destructive/10 hover:text-destructive cursor-pointer"
                                  : "text-muted-foreground/40 hover:bg-primary/10 hover:text-primary cursor-pointer"
                              )}
                              title={!r.player_id ? "No player_id on file" : (isOnBoard(r.player_id) ? "Remove from Target Board" : "Add to Target Board")}
                            >
                              {r.player_id && isOnBoard(r.player_id) ? <Check className="h-3.5 w-3.5" /> : <Target className="h-3.5 w-3.5" />}
                            </button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </>
                ) : (
                  <>
                    <TableHeader className="sticky top-0 z-20 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
                      <TableRow>
                        <TableHead className="w-[200px] sticky left-0 z-30 bg-background">
                          <SortButton label="Player" active={pitcherSort.key === "name"} onClick={() => togglePitcherSort("name")} />
                        </TableHead>
                        <TableHead className="text-right text-xs w-[60px]"><SortButton label="IP" active={pitcherSort.key === "ip"} onClick={() => togglePitcherSort("ip")} /></TableHead>
                        <TableHead className="text-right text-xs w-[70px]"><SortButton label="ERA" active={pitcherSort.key === "era"} onClick={() => togglePitcherSort("era")} /></TableHead>
                        <TableHead className="text-right text-xs w-[70px]"><SortButton label="FIP" active={pitcherSort.key === "fip"} onClick={() => togglePitcherSort("fip")} /></TableHead>
                        <TableHead className="text-right text-xs w-[70px]"><SortButton label="WHIP" active={pitcherSort.key === "whip"} onClick={() => togglePitcherSort("whip")} /></TableHead>
                        <TableHead className="text-right text-xs w-[70px]"><SortButton label="K/9" active={pitcherSort.key === "k9"} onClick={() => togglePitcherSort("k9")} /></TableHead>
                        <TableHead className="text-right text-xs w-[70px]"><SortButton label="BB/9" active={pitcherSort.key === "bb9"} onClick={() => togglePitcherSort("bb9")} /></TableHead>
                        <TableHead className="text-right text-xs w-[70px]"><SortButton label="HR/9" active={pitcherSort.key === "hr9"} onClick={() => togglePitcherSort("hr9")} /></TableHead>
                        <TableHead className="text-right text-xs w-[70px]"><SortButton label="pRV+" active={pitcherSort.key === "prvPlus"} onClick={() => togglePitcherSort("prvPlus")} /></TableHead>
                        <TableHead className="w-[36px] text-center text-xs p-0"><Target className="h-3.5 w-3.5 mx-auto text-muted-foreground" /></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedPitchers.map((r) => (
                        <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50 transition-colors">
                          <TableCell className="font-medium whitespace-nowrap sticky left-0 z-10 bg-background w-[200px]">
                            <div className="min-w-0">
                              {r.player_id ? (
                                <Link
                                  to={profileRouteFor(r.player_id, r.role || "P", r.throws)}
                                  state={{ returnTo: `${location.pathname}${location.search}${location.hash}` }}
                                  className="hover:text-primary hover:underline transition-colors"
                                >
                                  {r.name}
                                </Link>
                              ) : r.name}
                              <div className="text-xs text-muted-foreground">
                                {[r.role, r.team].filter(Boolean).join(" · ") || "—"}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{fmt1(r.ip)}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{fmt2(r.era)}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{fmt2(r.fip)}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{fmt2(r.whip)}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{fmt1(r.k9)}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{fmt1(r.bb9)}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{fmt2(r.hr9)}</TableCell>
                          <TableCell className="text-right text-sm font-semibold tabular-nums">{fmtInt(r.prvPlus)}</TableCell>
                          <TableCell className="text-center p-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!r.player_id) return;
                                if (isOnBoard(r.player_id)) removeFromBoard(r.player_id);
                                else addToBoard({ playerId: r.player_id });
                              }}
                              disabled={!r.player_id}
                              className={cn(
                                "inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors",
                                !r.player_id ? "text-muted-foreground/20 cursor-not-allowed" :
                                isOnBoard(r.player_id)
                                  ? "bg-primary/10 text-primary hover:bg-destructive/10 hover:text-destructive cursor-pointer"
                                  : "text-muted-foreground/40 hover:bg-primary/10 hover:text-primary cursor-pointer"
                              )}
                              title={!r.player_id ? "No player_id on file" : (isOnBoard(r.player_id) ? "Remove from Target Board" : "Add to Target Board")}
                            >
                              {r.player_id && isOnBoard(r.player_id) ? <Check className="h-3.5 w-3.5" /> : <Target className="h-3.5 w-3.5" />}
                            </button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </>
                )}
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground px-1">
        {filtered.length} qualified {view === "hitting" ? `hitters · PA ≥ ${HITTER_PA_THRESHOLD}` : `pitchers · IP ≥ ${PITCHER_IP_THRESHOLD}`}
        {totalPages > 1 ? ` · page ${safePage} of ${totalPages}` : ""}
      </div>
    </div>
  );
}
