import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, Search } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type PowerRow = {
  id: string;
  values: string[];
};

const BASE_IMPORT_COLS = 16; // A-P
const MAX_COLS = 37; // 16 base input + 14 scores + 6 PR+ + 1 overall
const START_ROW_INDEX = 7; // Row 8 (0-based)
const STORAGE_PREFIX = "storage__";
const PAGE_SIZE = 100;

const FIXED_HEADERS = [
  "Player",
  "Team",
  "Stuff+",
  "Whiff%",
  "BB%",
  "HH%",
  "IZ Whiff%",
  "Chase%",
  "Barrel%",
  "Line Drive%",
  "Avg Exit Velo",
  "GB%",
  "IZ%",
  "EV90",
  "Pull%",
  "LA 10-30%",
  "Stuff+ Score",
  "Whiff% Score",
  "BB% Score",
  "HH% Score",
  "IZ Whiff% Score",
  "Chase% Score",
  "Barrel% Score",
  "LD% Score",
  "Avg. EV Score",
  "GB% Score",
  "IZ% Score",
  "EV90 Score",
  "Pull% Score",
  "LA 10-30% Score",
  "ERA PR+",
  "FIP PR+",
  "WHIP PR+",
  "K/9 PR+",
  "HR/9 PR+",
  "BB/9 PR+",
  "Overall PR+",
];

const PITCHING_POWER_DEFAULTS: Record<string, number> = {
  p_ncaa_avg_stuff_plus: 100,
  p_ncaa_avg_whiff_pct: 22.9,
  p_ncaa_avg_bb_pct: 11.3,
  p_ncaa_avg_hh_pct: 36.0,
  p_ncaa_avg_in_zone_whiff_pct: 16.4,
  p_ncaa_avg_chase_pct: 23.1,
  p_ncaa_avg_barrel_pct: 17.3,
  p_ncaa_avg_ld_pct: 20.9,
  p_ncaa_avg_avg_ev: 86.2,
  p_ncaa_avg_gb_pct: 43.2,
  p_ncaa_avg_in_zone_pct: 47.2,
  p_ncaa_avg_ev90: 103.1,
  p_ncaa_avg_pull_pct: 36.5,
  p_ncaa_avg_la_10_30_pct: 29.0,
  p_sd_stuff_plus: 3.967566764,
  p_sd_whiff_pct: 5.476169924,
  p_sd_bb_pct: 2.92040411,
  p_sd_hh_pct: 6.474203457,
  p_sd_in_zone_whiff_pct: 4.299203457,
  p_sd_chase_pct: 4.619392309,
  p_sd_barrel_pct: 4.988140199,
  p_sd_ld_pct: 3.580670928,
  p_sd_avg_ev: 2.362900608,
  p_sd_gb_pct: 6.958760046,
  p_sd_in_zone_pct: 3.325412065,
  p_sd_ev90: 1.767350585,
  p_sd_pull_pct: 5.356686254,
  p_sd_la_10_30_pct: 5.773803471,
  p_era_ncaa_avg_power_rating: 50,
  p_ncaa_avg_whip_power_rating: 50,
  p_ncaa_avg_k9_power_rating: 50,
  p_ncaa_avg_bb9_power_rating: 50,
  p_ncaa_avg_hr9_power_rating: 50,
  p_era_stuff_plus_weight: 0.21,
  p_era_whiff_pct_weight: 0.23,
  p_era_bb_pct_weight: 0.17,
  p_era_hh_pct_weight: 0.07,
  p_era_in_zone_whiff_pct_weight: 0.12,
  p_era_chase_pct_weight: 0.08,
  p_era_barrel_pct_weight: 0.12,
  p_fip_hr9_power_rating_plus_weight: 0.45,
  p_fip_bb9_power_rating_plus_weight: 0.3,
  p_fip_k9_power_rating_plus_weight: 0.25,
  p_whip_bb_pct_weight: 0.25,
  p_whip_ld_pct_weight: 0.2,
  p_whip_avg_ev_weight: 0.15,
  p_whip_whiff_pct_weight: 0.25,
  p_whip_gb_pct_weight: 0.1,
  p_whip_chase_pct_weight: 0.05,
  p_k9_whiff_pct_weight: 0.35,
  p_k9_stuff_plus_weight: 0.3,
  p_k9_in_zone_whiff_pct_weight: 0.25,
  p_k9_chase_pct_weight: 0.1,
  p_bb9_bb_pct_weight: 0.55,
  p_bb9_in_zone_pct_weight: 0.3,
  p_bb9_chase_pct_weight: 0.15,
  p_hr9_barrel_pct_weight: 0.32,
  p_hr9_ev90_weight: 0.24,
  p_hr9_gb_pct_weight: 0.18,
  p_hr9_pull_pct_weight: 0.14,
  p_hr9_la_10_30_pct_weight: 0.12,
};

type ScoreMetric = {
  inputCol: number;
  scoreCol: number;
  avgKey: keyof typeof PITCHING_POWER_DEFAULTS;
  sdKey: keyof typeof PITCHING_POWER_DEFAULTS;
  lowerIsBetter?: boolean;
};

const SCORE_METRICS: ScoreMetric[] = [
  { inputCol: 2, scoreCol: 16, avgKey: "p_ncaa_avg_stuff_plus", sdKey: "p_sd_stuff_plus" },
  { inputCol: 3, scoreCol: 17, avgKey: "p_ncaa_avg_whiff_pct", sdKey: "p_sd_whiff_pct" },
  { inputCol: 4, scoreCol: 18, avgKey: "p_ncaa_avg_bb_pct", sdKey: "p_sd_bb_pct", lowerIsBetter: true },
  { inputCol: 5, scoreCol: 19, avgKey: "p_ncaa_avg_hh_pct", sdKey: "p_sd_hh_pct", lowerIsBetter: true },
  { inputCol: 6, scoreCol: 20, avgKey: "p_ncaa_avg_in_zone_whiff_pct", sdKey: "p_sd_in_zone_whiff_pct" },
  { inputCol: 7, scoreCol: 21, avgKey: "p_ncaa_avg_chase_pct", sdKey: "p_sd_chase_pct" },
  { inputCol: 8, scoreCol: 22, avgKey: "p_ncaa_avg_barrel_pct", sdKey: "p_sd_barrel_pct", lowerIsBetter: true },
  { inputCol: 9, scoreCol: 23, avgKey: "p_ncaa_avg_ld_pct", sdKey: "p_sd_ld_pct", lowerIsBetter: true },
  { inputCol: 10, scoreCol: 24, avgKey: "p_ncaa_avg_avg_ev", sdKey: "p_sd_avg_ev", lowerIsBetter: true },
  { inputCol: 11, scoreCol: 25, avgKey: "p_ncaa_avg_gb_pct", sdKey: "p_sd_gb_pct" },
  { inputCol: 12, scoreCol: 26, avgKey: "p_ncaa_avg_in_zone_pct", sdKey: "p_sd_in_zone_pct" },
  { inputCol: 13, scoreCol: 27, avgKey: "p_ncaa_avg_ev90", sdKey: "p_sd_ev90", lowerIsBetter: true },
  { inputCol: 14, scoreCol: 28, avgKey: "p_ncaa_avg_pull_pct", sdKey: "p_sd_pull_pct", lowerIsBetter: true },
  { inputCol: 15, scoreCol: 29, avgKey: "p_ncaa_avg_la_10_30_pct", sdKey: "p_sd_la_10_30_pct", lowerIsBetter: true },
];

const parseCsvLine = (line: string) => {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        cur += "\"";
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out.map((v) => v.replace(/^"(.*)"$/, "$1").trim());
};

const normalize = (v: string | null | undefined) =>
  (v || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const isPitcherPosition = (v: string | null | undefined) => /^(SP|RP|CL|P|RHP|LHP)/i.test((v || "").trim());
const parseNumeric = (raw: string | undefined) => {
  const value = (raw || "").trim();
  if (!value || value === "-") return null;
  const n = Number(value.replace(/[%,$]/g, ""));
  return Number.isFinite(n) ? n : null;
};

const splitPlayerName = (raw: string) => {
  const name = (raw || "").trim();
  if (!name) return { first: "", last: "" };
  if (name.includes(",")) {
    const [last, first] = name.split(",").map((s) => s.trim());
    return { first: first || "", last: last || "" };
  }
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
};

// Abramowitz-Stegun approximation for erf -> normal CDF.
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

const getPitchingEquationValues = () => {
  const merged = { ...PITCHING_POWER_DEFAULTS };
  try {
    const raw = localStorage.getItem("admin_dashboard_pitching_power_equation_values_v1");
    if (!raw) return merged;
    const parsed = JSON.parse(raw) as Record<string, string | number>;
    for (const key of Object.keys(PITCHING_POWER_DEFAULTS) as Array<keyof typeof PITCHING_POWER_DEFAULTS>) {
      const n = Number(parsed[key]);
      if (Number.isFinite(n)) merged[key] = n;
    }
  } catch {
    // ignore bad local storage payload
  }
  // Locked constant: Chase% contribution in WHIP PR is fixed at 5%.
  merged.p_whip_chase_pct_weight = 0.05;
  return merged;
};

const calculateScore = (value: number, avg: number, sd: number, lowerIsBetter = false) => {
  if (!Number.isFinite(value) || !Number.isFinite(avg) || !Number.isFinite(sd) || sd <= 0) return "-";
  const pct = normalCdf((value - avg) / sd) * 100;
  const score = lowerIsBetter ? 100 - pct : pct;
  return Math.round(Math.max(0, Math.min(100, score))).toString();
};

const toScore = (value: string | undefined) => {
  const n = Number((value || "").trim());
  return Number.isFinite(n) ? n : null;
};

const normalizedWeightedSum = (items: Array<{ value: number; weight: number }>) => {
  const weighted = items.reduce((sum, item) => sum + (item.value * item.weight), 0);
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return null;
  return weighted / totalWeight;
};

const computeScoreColumns = (sourceValues: string[]) => {
  const next = [...Array(MAX_COLS)].map((_, i) => sourceValues[i] || "");
  const eqValues = getPitchingEquationValues();
  for (const metric of SCORE_METRICS) {
    const value = parseNumeric(next[metric.inputCol]);
    if (value == null) {
      next[metric.scoreCol] = "-";
      continue;
    }
    next[metric.scoreCol] = calculateScore(value, eqValues[metric.avgKey], eqValues[metric.sdKey], !!metric.lowerIsBetter);
  }
  const stuffScore = toScore(next[16]);
  const whiffScore = toScore(next[17]);
  const bbScore = toScore(next[18]);
  const hhScore = toScore(next[19]);
  const izWhiffScore = toScore(next[20]);
  const chaseScore = toScore(next[21]);
  const barrelScore = toScore(next[22]);
  const ldScore = toScore(next[23]);
  const avgEvScore = toScore(next[24]);
  const gbScore = toScore(next[25]);
  const izScore = toScore(next[26]);
  const ev90Score = toScore(next[27]);
  const pullScore = toScore(next[28]);
  const la1030Score = toScore(next[29]);

  const eraPower =
    [stuffScore, whiffScore, bbScore, hhScore, izWhiffScore, chaseScore, barrelScore].every((v) => v != null)
      ? (stuffScore! * eqValues.p_era_stuff_plus_weight) +
        (whiffScore! * eqValues.p_era_whiff_pct_weight) +
        (bbScore! * eqValues.p_era_bb_pct_weight) +
        (hhScore! * eqValues.p_era_hh_pct_weight) +
        (izWhiffScore! * eqValues.p_era_in_zone_whiff_pct_weight) +
        (chaseScore! * eqValues.p_era_chase_pct_weight) +
        (barrelScore! * eqValues.p_era_barrel_pct_weight)
      : null;
  const whipPower =
    [bbScore, ldScore, avgEvScore, whiffScore, gbScore, chaseScore].every((v) => v != null)
      ? normalizedWeightedSum([
          { value: bbScore!, weight: eqValues.p_whip_bb_pct_weight },
          { value: ldScore!, weight: eqValues.p_whip_ld_pct_weight },
          { value: avgEvScore!, weight: eqValues.p_whip_avg_ev_weight },
          { value: whiffScore!, weight: eqValues.p_whip_whiff_pct_weight },
          { value: gbScore!, weight: eqValues.p_whip_gb_pct_weight },
          { value: chaseScore!, weight: eqValues.p_whip_chase_pct_weight },
        ])
      : null;
  const k9Power =
    [whiffScore, stuffScore, izWhiffScore, chaseScore].every((v) => v != null)
      ? (whiffScore! * eqValues.p_k9_whiff_pct_weight) +
        (stuffScore! * eqValues.p_k9_stuff_plus_weight) +
        (izWhiffScore! * eqValues.p_k9_in_zone_whiff_pct_weight) +
        (chaseScore! * eqValues.p_k9_chase_pct_weight)
      : null;
  const bb9Power =
    [bbScore, izScore, chaseScore].every((v) => v != null)
      ? (bbScore! * eqValues.p_bb9_bb_pct_weight) +
        (izScore! * eqValues.p_bb9_in_zone_pct_weight) +
        (chaseScore! * eqValues.p_bb9_chase_pct_weight)
      : null;
  const hr9Power =
    [barrelScore, ev90Score, gbScore, pullScore, la1030Score].every((v) => v != null)
      ? (barrelScore! * eqValues.p_hr9_barrel_pct_weight) +
        (ev90Score! * eqValues.p_hr9_ev90_weight) +
        (gbScore! * eqValues.p_hr9_gb_pct_weight) +
        (pullScore! * eqValues.p_hr9_pull_pct_weight) +
        (la1030Score! * eqValues.p_hr9_la_10_30_pct_weight)
      : null;

  const eraPlus = eraPower == null ? null : (eraPower / eqValues.p_era_ncaa_avg_power_rating) * 100;
  const whipPlus = whipPower == null ? null : (whipPower / eqValues.p_ncaa_avg_whip_power_rating) * 100;
  const k9Plus = k9Power == null ? null : (k9Power / eqValues.p_ncaa_avg_k9_power_rating) * 100;
  const bb9Plus = bb9Power == null ? null : (bb9Power / eqValues.p_ncaa_avg_bb9_power_rating) * 100;
  const hr9Plus = hr9Power == null ? null : (hr9Power / eqValues.p_ncaa_avg_hr9_power_rating) * 100;
  const fipPlus =
    hr9Plus == null || bb9Plus == null || k9Plus == null
      ? null
      : (hr9Plus * eqValues.p_fip_hr9_power_rating_plus_weight) +
        (bb9Plus * eqValues.p_fip_bb9_power_rating_plus_weight) +
        (k9Plus * eqValues.p_fip_k9_power_rating_plus_weight);

  const overallPower =
    eraPlus == null || fipPlus == null || whipPlus == null || k9Plus == null || bb9Plus == null || hr9Plus == null
      ? null
      : (0.15 * eraPlus) + (0.25 * fipPlus) + (0.1 * whipPlus) + (0.2 * k9Plus) + (0.15 * bb9Plus) + (0.15 * hr9Plus);
  next[30] = eraPlus == null ? "-" : Math.round(Math.max(0, eraPlus)).toString();
  next[31] = fipPlus == null ? "-" : Math.round(Math.max(0, fipPlus)).toString();
  next[32] = whipPlus == null ? "-" : Math.round(Math.max(0, whipPlus)).toString();
  next[33] = k9Plus == null ? "-" : Math.round(Math.max(0, k9Plus)).toString();
  next[34] = hr9Plus == null ? "-" : Math.round(Math.max(0, hr9Plus)).toString();
  next[35] = bb9Plus == null ? "-" : Math.round(Math.max(0, bb9Plus)).toString();
  next[36] = overallPower == null ? "-" : Math.round(Math.max(0, overallPower)).toString();
  return next;
};

const formatCellValue = (raw: string, colIndex: number) => {
  const value = (raw || "").trim();
  if (!value || value === "-") return "-";
  if (colIndex <= 1) return value; // Player / Team
  const n = Number(value.replace(/[%,$]/g, ""));
  if (!Number.isFinite(n)) return value;
  if (colIndex === 2) return Math.round(n).toString(); // Stuff+
  if (colIndex >= BASE_IMPORT_COLS) return Math.round(n).toString(); // Score columns
  return n.toFixed(1); // Everything else numeric
};

const isLikelyHeaderRow = (values: string[]) => {
  const filled = values.filter((v) => v.trim().length > 0);
  if (filled.length < 3) return false;
  const keyWords = ["player", "team", "name", "hand", "velo", "spin", "whiff", "zone", "usage", "rating"];
  const matches = filled.filter((v) => {
    const n = normalize(v);
    return keyWords.some((k) => n.includes(k));
  }).length;
  return matches >= 2;
};

const getPageWindow = (current: number, total: number) => {
  const maxButtons = 7;
  if (total <= maxButtons) return Array.from({ length: total }, (_, i) => i + 1);
  let start = Math.max(1, current - 3);
  let end = Math.min(total, start + maxButtons - 1);
  start = Math.max(1, end - maxButtons + 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
};

const headerLabelLines = (label: string) => {
  if (label === "Overall PR+") return ["Overall", "PR+"];
  if (label === "ERA PR+") return ["ERA", "PR+"];
  if (label === "FIP PR+") return ["FIP", "PR+"];
  if (label === "WHIP PR+") return ["WHIP", "PR+"];
  if (label === "K/9 PR+") return ["K/9", "PR+"];
  if (label === "HR/9 PR+") return ["HR/9", "PR+"];
  if (label === "BB/9 PR+") return ["BB/9", "PR+"];
  if (label.includes(" Score")) return [label.replace(" Score", ""), "Score"];
  if (label === "Line Drive%") return ["Line Drive%", ""];
  if (label === "Avg Exit Velo") return ["Avg Exit", "Velo"];
  if (label === "LA 10-30%") return ["LA 10-30%", ""];
  return [label, ""];
};

export default function PitchingPowerRatingsStorageTable({ season }: { season: "2025" | "2026" }) {
  const storageKey = `pitching_power_ratings_storage_${season}_v1`;
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [headers, setHeaders] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return [...FIXED_HEADERS];
      const parsed = JSON.parse(raw) as { headers?: string[] };
      if (!Array.isArray(parsed.headers)) return [...FIXED_HEADERS];
      return parsed.headers.slice(0, MAX_COLS);
    } catch {
      return [...FIXED_HEADERS];
    }
  });
  const [rows, setRows] = useState<PowerRow[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as { rows?: PowerRow[] };
      return Array.isArray(parsed.rows) ? parsed.rows : [];
    } catch {
      return [];
    }
  });
  const [syncing, setSyncing] = useState(false);

  const { data: players = [] } = useQuery({
    queryKey: ["pitching-power-player-directory"],
    queryFn: async () => {
      const allPlayers: Array<{ id: string; first_name: string; last_name: string; team: string | null; position: string | null }> = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("players")
          .select("id, first_name, last_name, team, position")
          .order("id", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const batch = data || [];
        allPlayers.push(...batch);
        if (batch.length < pageSize) break;
        from += pageSize;
      }
      return allPlayers;
    },
  });

  const playerLookup = useMemo(() => {
    const byNameTeam = new Map<string, { id: string }>();
    const byName = new Map<string, { id: string }>();
    for (const p of players) {
      if (!isPitcherPosition(p.position)) continue;
      const fullName = `${p.first_name || ""} ${p.last_name || ""}`.trim();
      const nameKey = normalize(fullName);
      const teamKey = normalize(p.team);
      if (!nameKey) continue;
      if (!byName.has(nameKey)) byName.set(nameKey, { id: p.id });
      if (teamKey && !byNameTeam.has(`${nameKey}|${teamKey}`)) byNameTeam.set(`${nameKey}|${teamKey}`, { id: p.id });
    }
    return { byNameTeam, byName };
  }, [players]);

  const resolvePlayerId = (values: string[]): string | null => {
    const playerName = (values[0] || "").trim();
    const teamName = (values[1] || "").trim();
    const key = `${normalize(playerName)}|${normalize(teamName)}`;
    const direct = playerLookup.byNameTeam.get(key);
    if (direct?.id) return direct.id;
    const fallback = playerLookup.byName.get(normalize(playerName));
    return fallback?.id || null;
  };

  const persist = (nextHeaders: string[], nextRows: PowerRow[]) => {
    setHeaders(nextHeaders);
    setRows(nextRows);
    try {
      localStorage.setItem(storageKey, JSON.stringify({ headers: nextHeaders, rows: nextRows }));
    } catch {
      // ignore localStorage errors
    }
  };

  useEffect(() => {
    const isFixed =
      headers.length === FIXED_HEADERS.length &&
      headers.every((h, i) => (h || "").trim().toLowerCase() === FIXED_HEADERS[i].toLowerCase());
    if (isFixed) return;
    persist([...FIXED_HEADERS], rows);
  }, [headers, rows]);

  useEffect(() => {
    const normalizedRows = rows.map((r) => ({
      ...r,
      values: [...Array(MAX_COLS)].map((_, idx) => {
        if (idx < BASE_IMPORT_COLS) return r.values[idx] || "";
        return r.values[idx] && String(r.values[idx]).trim().length > 0 ? r.values[idx] : "";
      }),
    }));
    const withScores = normalizedRows.map((r) => ({ ...r, values: computeScoreColumns(r.values) }));
    const changed = withScores.some((r, i) => {
      const before = rows[i]?.values || [];
      if (before.length !== r.values.length) return true;
      for (let c = 0; c < r.values.length; c++) {
        if ((before[c] || "") !== (r.values[c] || "")) return true;
      }
      return false;
    });
    if (!changed) return;
    persist([...FIXED_HEADERS], withScores);
  }, [rows]);

  const importCsv = async (file: File) => {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length <= START_ROW_INDEX) throw new Error("CSV does not have row 8.");

    const row8 = parseCsvLine(lines[START_ROW_INDEX]).slice(0, BASE_IMPORT_COLS);
    const hasHeaderAtRow8 = isLikelyHeaderRow(row8);
    const nextHeaders = [...FIXED_HEADERS];

    const dataStart = hasHeaderAtRow8 ? START_ROW_INDEX + 1 : START_ROW_INDEX;
    const nextRows: PowerRow[] = [];

    for (let i = dataStart; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]).slice(0, BASE_IMPORT_COLS);
      if (cols.every((c) => !c?.trim())) continue;
      const baseValues = [...Array(MAX_COLS)].map((_, idx) => {
        if (idx < BASE_IMPORT_COLS) return cols[idx] || "";
        return "";
      });
      const values = computeScoreColumns(baseValues);
      nextRows.push({ id: `${season}-${i}`, values });
    }

    persist(nextHeaders, nextRows);
    toast.success(`Imported ${nextRows.length} rows from row 8 (columns A-Q only).`);
  };

  const syncToSupabase = async () => {
    if (rows.length === 0) {
      toast.error("No pitching power rating rows to sync.");
      return;
    }
    setSyncing(true);
    try {
      const seasonNum = Number(season);
      const upserts: Array<Record<string, any>> = [];
      const playerUpdates: Array<{ id: string; team: string | null }> = [];
      const unresolved: string[] = [];

      const byNameTeam = new Map<string, string>();
      const byName = new Map<string, string>();
      for (const p of players) {
        if (!isPitcherPosition((p as any).position)) continue;
        const first = `${p.first_name || ""}`.trim();
        const last = `${p.last_name || ""}`.trim();
        const full = `${first} ${last}`.trim();
        const nk = normalize(full);
        const tk = normalize(p.team);
        if (nk && !byName.has(nk)) byName.set(nk, p.id);
        if (nk && tk && !byNameTeam.has(`${nk}|${tk}`)) byNameTeam.set(`${nk}|${tk}`, p.id);
      }

      const pendingCreate = new Map<string, { playerName: string; team: string | null }>();
      for (const row of rows) {
        const values = computeScoreColumns(row.values || []);
        const playerName = (values[0] || "").trim();
        const team = (values[1] || "").trim() || null;
        if (!playerName) continue;
        const key = `${normalize(playerName)}|${normalize(team)}`;
        const existing = byNameTeam.get(key) || byName.get(normalize(playerName));
        if (!existing) pendingCreate.set(key, { playerName, team });
      }

      if (pendingCreate.size > 0) {
        const inserts = Array.from(pendingCreate.values())
          .map((m) => {
            const parts = splitPlayerName(m.playerName);
            if (!parts.first) return null;
            return {
              first_name: parts.first,
              last_name: parts.last || "Unknown",
              team: m.team,
              position: "RP",
            };
          })
          .filter(Boolean) as Array<Record<string, any>>;
        if (inserts.length > 0) {
          const CHUNK = 200;
          for (let i = 0; i < inserts.length; i += CHUNK) {
            const batch = inserts.slice(i, i + CHUNK);
            const { data, error } = await supabase
              .from("players")
              .insert(batch)
              .select("id, first_name, last_name, team, position");
            if (error) throw error;
            for (const p of data || []) {
              const full = `${p.first_name || ""} ${p.last_name || ""}`.trim();
              const nk = normalize(full);
              const tk = normalize(p.team);
              if (!isPitcherPosition((p as any).position)) continue;
              if (nk && !byName.has(nk)) byName.set(nk, p.id);
              if (nk && tk && !byNameTeam.has(`${nk}|${tk}`)) byNameTeam.set(`${nk}|${tk}`, p.id);
            }
          }
        }
      }

      for (const row of rows) {
        const values = computeScoreColumns(row.values || []);
        const playerName = (values[0] || "").trim() || "Unknown";
        const team = (values[1] || "").trim() || null;
        const nk = normalize(playerName);
        const tk = normalize(team);
        const playerId = byNameTeam.get(`${nk}|${tk}`) || byName.get(nk) || resolvePlayerId(values);
        if (!playerId) {
          unresolved.push(playerName);
          continue;
        }
        playerUpdates.push({ id: playerId, team });

        const num = (idx: number) => parseNumeric(values[idx]);
        const intNum = (idx: number) => {
          const n = parseNumeric(values[idx]);
          return n == null ? null : Math.round(n);
        };
        upserts.push({
          player_id: playerId,
          season: seasonNum,
          player_name: playerName,
          team,
          stuff_plus: num(2),
          whiff_pct: num(3),
          bb_pct: num(4),
          hh_pct: num(5),
          iz_whiff_pct: num(6),
          chase_pct: num(7),
          barrel_pct: num(8),
          ld_pct: num(9),
          avg_exit_velo: num(10),
          gb_pct: num(11),
          iz_pct: num(12),
          ev90: num(13),
          pull_pct: num(14),
          la_10_30_pct: num(15),
          stuff_score: intNum(16),
          whiff_score: intNum(17),
          bb_score: intNum(18),
          hh_score: intNum(19),
          iz_whiff_score: intNum(20),
          chase_score: intNum(21),
          barrel_score: intNum(22),
          ld_score: intNum(23),
          avg_ev_score: intNum(24),
          gb_score: intNum(25),
          iz_score: intNum(26),
          ev90_score: intNum(27),
          pull_score: intNum(28),
          la_10_30_score: intNum(29),
          era_pr_plus: intNum(30),
          fip_pr_plus: intNum(31),
          whip_pr_plus: intNum(32),
          k9_pr_plus: intNum(33),
          hr9_pr_plus: intNum(34),
          bb9_pr_plus: intNum(35),
          overall_pr_plus: intNum(36),
        });
      }

      if (upserts.length === 0) {
        toast.error("No matched players found to sync.");
        return;
      }

      // Avoid ON CONFLICT re-updating same key in one statement (duplicate player rows in CSV).
      const dedupedUpserts = new Map<string, Record<string, any>>();
      for (const row of upserts) {
        const key = `${row.player_id}|${row.season}`;
        dedupedUpserts.set(key, row); // last row wins
      }
      const upsertsUnique = Array.from(dedupedUpserts.values());

      const CHUNK = 250;
      for (let i = 0; i < upsertsUnique.length; i += CHUNK) {
        const batch = upsertsUnique.slice(i, i + CHUNK);
        const { error } = await supabase
          .from("pitching_power_ratings_storage")
          .upsert(batch, { onConflict: "player_id,season" });
        if (error) throw error;
      }

      const uniqueUpdates = new Map<string, { id: string; team: string | null }>();
      for (const u of playerUpdates) uniqueUpdates.set(u.id, u);
      const updates = Array.from(uniqueUpdates.values());
      for (let i = 0; i < updates.length; i += CHUNK) {
        const batch = updates.slice(i, i + CHUNK);
        await Promise.all(
          batch.map(async (u) => {
            if (!u.team) return;
            await supabase.from("players").update({ team: u.team }).eq("id", u.id);
          }),
        );
      }

      if (unresolved.length > 0) {
        toast.success(`Synced ${upsertsUnique.length} rows. Unmatched: ${unresolved.length} (sample: ${unresolved.slice(0, 5).join(", ")})`);
      } else {
        toast.success(`Synced ${upsertsUnique.length} rows to Supabase.`);
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to sync power ratings to Supabase");
    } finally {
      setSyncing(false);
    }
  };

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.values.some((v) => (v || "").toLowerCase().includes(q)));
  }, [rows, search]);

  useEffect(() => {
    setPage(1);
  }, [search, season]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const pagedRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [filteredRows, safePage]);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-base">Pitching Power Ratings Storage ({season})</CardTitle>
          <CardDescription>Imports from row 8 (A-Q) plus computed score columns and PR+ outputs through Overall PR+.</CardDescription>
        </div>
        <div className="flex w-full sm:w-auto items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                await importCsv(file);
              } catch (err: any) {
                toast.error(err?.message || "Failed to import CSV");
              } finally {
                e.currentTarget.value = "";
              }
            }}
          />
          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4 mr-2" />
            Import CSV
          </Button>
          <Button type="button" onClick={syncToSupabase} disabled={syncing || rows.length === 0}>
            {syncing ? "Syncing..." : "Sync to Supabase"}
          </Button>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing {filteredRows.length ? (safePage - 1) * PAGE_SIZE + 1 : 0}-
            {Math.min(safePage * PAGE_SIZE, filteredRows.length)} of {filteredRows.length} rows
          </span>
          <div className="flex items-center gap-1">
            {getPageWindow(safePage, totalPages).map((p) => (
              <Button
                key={`pitching-power-page-${p}`}
                size="sm"
                variant={p === safePage ? "secondary" : "ghost"}
                className="h-7 min-w-7 px-2 text-xs"
                onClick={() => setPage(p)}
              >
                {p}
              </Button>
            ))}
          </div>
        </div>
        <div className="max-h-[620px] overflow-y-auto overflow-x-auto">
          <Table className="table-fixed min-w-[4300px]">
            <TableHeader className="sticky top-0 z-20 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
              <TableRow>
                {Array.from({ length: MAX_COLS }).map((_, i) => (
                  <TableHead
                    key={`h-${i}`}
                    className={
                      i === 0
                        ? "sticky left-0 z-30 bg-background min-w-[220px] w-[220px] whitespace-nowrap"
                        : i === 1
                          ? "min-w-[150px] w-[150px] whitespace-nowrap"
                          : i >= BASE_IMPORT_COLS
                            ? "min-w-[120px] w-[120px] whitespace-normal leading-tight text-right py-1.5"
                            : "min-w-[100px] w-[100px] whitespace-normal leading-tight text-right py-1.5"
                    }
                  >
                    {(() => {
                      const label = headers[i] || FIXED_HEADERS[i];
                      if (i <= 1) return label;
                      const [line1, line2] = headerLabelLines(label);
                      return (
                        <span className="inline-flex flex-col items-end">
                          <span>{line1}</span>
                          {line2 ? <span>{line2}</span> : null}
                        </span>
                      );
                    })()}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedRows.length > 0 ? (
                pagedRows.map((row) => (
                  <TableRow key={row.id}>
                    {Array.from({ length: MAX_COLS }).map((_, i) => (
                      <TableCell
                        key={`${row.id}-${i}`}
                        className={
                          i === 0
                            ? "sticky left-0 z-10 bg-background font-medium whitespace-nowrap"
                            : i === 1
                              ? "whitespace-nowrap"
                              : "font-mono whitespace-nowrap text-right"
                        }
                      >
                        {(() => {
                          if (i !== 0) return formatCellValue(row.values[i] || "", i);
                          const playerName = row.values[0] || "";
                          const teamName = row.values[1] || "";
                          if (!playerName) return "—";
                          const key = `${normalize(playerName)}|${normalize(teamName)}`;
                          const found = playerLookup.byNameTeam.get(key) || playerLookup.byName.get(normalize(playerName));
                          const to = found
                            ? `/dashboard/pitcher/${found.id}`
                            : `/dashboard/pitcher/${STORAGE_PREFIX}${encodeURIComponent(playerName)}__${encodeURIComponent(teamName)}`;
                          return (
                            <Link to={to} className="text-primary underline-offset-4 hover:underline">
                              {playerName}
                            </Link>
                          );
                        })()}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={MAX_COLS} className="py-8 text-center text-muted-foreground">
                    No pitching power rows loaded for {season}. Import a CSV to begin.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
