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
import { readPitchingWeights } from "@/lib/pitchingEquations";

type PitchingStorageRow = {
  id: string;
  values: string[];
};

const MAX_COLS = 13; // Core A-I + G, GS, IP, Role
const FIXED_HEADERS = ["Player Name", "Team", "Handedness", "Role", "IP", "G", "GS", "ERA", "FIP", "WHIP", "K/9", "BB/9", "HR/9"];
const NCAA_BASELINES = {
  era: 6.14,
  fip: 5.07,
  whip: 1.62,
  k9: 8.22,
  bb9: 4.58,
  hr9: 1.1,
};

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

const normalizeHandedness = (value: string) => {
  const v = value.trim().toUpperCase();
  if (v === "R" || v === "RH" || v === "RHP") return "RHP";
  if (v === "L" || v === "LH" || v === "LHP") return "LHP";
  return value;
};

const normalize = (v: string | null | undefined) =>
  (v || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const isPitcherPosition = (v: string | null | undefined) => /^(SP|RP|CL|P|RHP|LHP)/i.test((v || "").trim());

const toNum = (v: string | null | undefined) => {
  if (v == null) return null;
  const n = Number(String(v).replace(/[%,$]/g, "").trim());
  return Number.isFinite(n) ? n : null;
};

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

const calcPlus = (baseline: number, value: number | null, invert = false) => {
  if (value == null || value === 0) return null;
  const raw = invert ? (value / baseline) * 100 : (baseline / value) * 100;
  return Number.isFinite(raw) ? Math.round(raw) : null;
};

const calcEraPlus = (era: number | null, ncaaAvgEra: number, ncaaEraSd: number, scale: number) => {
  if (era == null || ncaaEraSd === 0) return null;
  const raw = 100 + (((ncaaAvgEra - era) / ncaaEraSd) * scale);
  return Number.isFinite(raw) ? Math.round(raw) : null;
};

const calcFipPlus = (fip: number | null, ncaaAvgFip: number, ncaaFipSd: number, scale: number) => {
  if (fip == null || ncaaFipSd === 0) return null;
  const raw = 100 + (((ncaaAvgFip - fip) / ncaaFipSd) * scale);
  return Number.isFinite(raw) ? Math.round(raw) : null;
};

const calcWhipPlus = (whip: number | null, ncaaAvgWhip: number, ncaaWhipSd: number, scale: number) => {
  if (whip == null || ncaaWhipSd === 0) return null;
  const raw = 100 + (((ncaaAvgWhip - whip) / ncaaWhipSd) * scale);
  return Number.isFinite(raw) ? Math.round(raw) : null;
};

const calcK9Plus = (k9: number | null, ncaaAvgK9: number, ncaaK9Sd: number, scale: number) => {
  if (k9 == null || ncaaK9Sd === 0) return null;
  const raw = 100 + (((k9 - ncaaAvgK9) / ncaaK9Sd) * scale);
  return Number.isFinite(raw) ? Math.round(raw) : null;
};

const calcBb9Plus = (bb9: number | null, ncaaAvgBb9: number, ncaaBb9Sd: number, scale: number) => {
  if (bb9 == null || ncaaBb9Sd === 0) return null;
  const raw = 100 + (((ncaaAvgBb9 - bb9) / ncaaBb9Sd) * scale);
  return Number.isFinite(raw) ? Math.round(raw) : null;
};

const calcHr9Plus = (hr9: number | null, ncaaAvgHr9: number, ncaaHr9Sd: number, scale: number) => {
  if (hr9 == null || ncaaHr9Sd === 0) return null;
  const raw = 100 + (((ncaaAvgHr9 - hr9) / ncaaHr9Sd) * scale);
  return Number.isFinite(raw) ? Math.round(raw) : null;
};

const isEmbeddedHeaderRow = (values: string[]) => {
  const v0 = (values[0] || "").trim().toLowerCase();
  const v1 = (values[1] || "").trim().toLowerCase();
  const v2 = (values[2] || "").trim().toLowerCase();
  return v0 === "player name" && v1 === "team" && v2 === "handedness";
};

const findHeaderIndex = (headers: string[], aliases: string[]) => {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const target = new Set(aliases.map(norm));
  return headers.findIndex((h) => target.has(norm(h || "")));
};

const PAGE_SIZE = 100;
const getPageWindow = (currentPage: number, totalPages: number) => {
  const maxButtons = 7;
  if (totalPages <= maxButtons) return Array.from({ length: totalPages }, (_, i) => i + 1);
  let start = Math.max(1, currentPage - 3);
  let end = Math.min(totalPages, start + maxButtons - 1);
  start = Math.max(1, end - maxButtons + 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
};

const legacyIndexForNewCol = (newCol: number): number | null => {
  // Legacy layout:
  // [0 Name,1 Team,2 Hand,3 ERA,4 FIP,5 WHIP,6 K9,7 BB9,8 HR9,9 G,10 GS,11 IP,12 Role]
  // New layout:
  // [0 Name,1 Team,2 Hand,3 Role,4 IP,5 G,6 GS,7 ERA,8 FIP,9 WHIP,10 K9,11 BB9,12 HR9]
  if (newCol === 3) return 12;
  if (newCol === 4) return 11;
  if (newCol === 5) return 9;
  if (newCol === 6) return 10;
  if (newCol === 7) return 3;
  if (newCol === 8) return 4;
  if (newCol === 9) return 5;
  if (newCol === 10) return 6;
  if (newCol === 11) return 7;
  if (newCol === 12) return 8;
  return null;
};

const resolveStatsView = (values: string[]) => {
  // Legacy rows have numeric ERA in column 3.
  const legacyEra = toNum(values[3]);
  const isLegacy = legacyEra != null;
  if (isLegacy) {
    return {
      era: values[3] || "",
      fip: values[4] || "",
      whip: values[5] || "",
      k9: values[6] || "",
      bb9: values[7] || "",
      hr9: values[8] || "",
    };
  }
  return {
    era: values[7] || "",
    fip: values[8] || "",
    whip: values[9] || "",
    k9: values[10] || "",
    bb9: values[11] || "",
    hr9: values[12] || "",
  };
};

const displayValueForCol = (values: string[], newCol: number) => {
  if (newCol >= 7 && newCol <= 12) {
    const stats = resolveStatsView(values);
    if (newCol === 7) return stats.era;
    if (newCol === 8) return stats.fip;
    if (newCol === 9) return stats.whip;
    if (newCol === 10) return stats.k9;
    if (newCol === 11) return stats.bb9;
    return stats.hr9;
  }
  const direct = values[newCol] || "";
  if (direct.trim()) return direct;
  const legacyIdx = legacyIndexForNewCol(newCol);
  if (legacyIdx == null) return direct;
  return values[legacyIdx] || "";
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

export default function PitchingStatsStorageTable({ season }: { season: "2025" | "2026" }) {
  const storageKey = `pitching_stats_storage_${season}_v1`;
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
  const [rows, setRows] = useState<PitchingStorageRow[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as { rows?: PitchingStorageRow[] };
      return Array.isArray(parsed.rows) ? parsed.rows : [];
    } catch {
      return [];
    }
  });
  const [weights] = useState(() => readPitchingWeights());
  const [syncing, setSyncing] = useState(false);

  const { data: players = [] } = useQuery({
    queryKey: ["pitching-storage-player-directory"],
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
    const byLastFirstInitial = new Map<string, { id: string }>();
    for (const p of players) {
      if (!isPitcherPosition(p.position)) continue;
      const first = `${p.first_name || ""}`.trim();
      const last = `${p.last_name || ""}`.trim();
      const fullName = `${first} ${last}`.trim();
      const reversedName = `${last} ${first}`.trim();
      const nameKey = normalize(fullName);
      const reversedNameKey = normalize(reversedName);
      const teamKey = normalize(p.team);
      const key = `${nameKey}|${teamKey}`;
      if (nameKey && !byName.has(nameKey)) byName.set(nameKey, { id: p.id });
      if (reversedNameKey && !byName.has(reversedNameKey)) byName.set(reversedNameKey, { id: p.id });
      if (nameKey && teamKey && !byNameTeam.has(key)) byNameTeam.set(key, { id: p.id });
      if (last) {
        const firstInitial = first.slice(0, 1).toLowerCase();
        const lfKey = normalize(`${last} ${firstInitial}`);
        if (lfKey && !byLastFirstInitial.has(lfKey)) byLastFirstInitial.set(lfKey, { id: p.id });
      }
    }
    return { byNameTeam, byName, byLastFirstInitial };
  }, [players]);

  const resolvePlayerId = (values: string[]): string | null => {
    const playerName = (values[0] || "").trim();
    const teamName = (values[1] || "").trim();
    const normalizedName = normalize(playerName);
    const key = `${normalizedName}|${normalize(teamName)}`;
    const direct = playerLookup.byNameTeam.get(key);
    const fallback = playerLookup.byName.get(normalizedName);
    const swapped =
      playerName.includes(",")
        ? normalize(
            playerName
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
              .reverse()
              .join(" "),
          )
        : null;
    const swappedMatch = swapped ? playerLookup.byName.get(swapped) : null;
    const parts = playerName.trim().split(/\s+/).filter(Boolean);
    const firstInitial = parts[0]?.[0] ? parts[0][0].toLowerCase() : "";
    const lastToken = parts.length > 1 ? parts[parts.length - 1] : "";
    const lastFirstInitialKey = normalize(`${lastToken} ${firstInitial}`);
    const lastFirstInitialMatch = playerLookup.byLastFirstInitial.get(lastFirstInitialKey);
    const found = direct || fallback || swappedMatch || lastFirstInitialMatch;
    return found?.id || null;
  };

  const syncToSupabase = async () => {
    if (rows.length === 0) {
      toast.error("No pitching rows to sync.");
      return;
    }
    setSyncing(true);
    try {
      const seasonNum = Number(season);
      const upserts: Array<Record<string, any>> = [];
      const playerUpdates: Array<{ id: string; team: string | null; handedness: string | null }> = [];
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

      const pendingCreate = new Map<string, { playerName: string; team: string | null; handedness: string | null; role: string | null }>();
      for (const row of rows) {
        const v = row.values || [];
        const playerName = (v[0] || "").trim();
        const team = (v[1] || "").trim() || null;
        const handedness = normalizeHandedness((v[2] || "").trim()) || null;
        const role = (v[3] || "").trim().toUpperCase() || null;
        if (!playerName) continue;
        const key = `${normalize(playerName)}|${normalize(team)}`;
        const existing = byNameTeam.get(key) || byName.get(normalize(playerName));
        if (!existing) pendingCreate.set(key, { playerName, team, handedness, role });
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
              handedness: m.handedness,
              position: m.role === "SP" || m.role === "RP" ? m.role : "RP",
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
        const values = row.values || [];
        const playerName = (values[0] || "").trim() || "Unknown";
        const team = (values[1] || "").trim() || null;
        const nk = normalize(playerName);
        const tk = normalize(team);
        const playerId = byNameTeam.get(`${nk}|${tk}`) || byName.get(nk) || resolvePlayerId(values);
        if (!playerId) {
          unresolved.push(playerName);
          continue;
        }

        const stats = resolveStatsView(values);
        const era = toNum(stats.era);
        const whip = toNum(stats.whip);
        const innings = parseBaseballInnings(displayValueForCol(values, 4));
        const k9 = toNum(stats.k9);
        const bb9 = toNum(stats.bb9);
        const pitchStrikeouts = innings != null && k9 != null ? Math.round((k9 * innings) / 9) : null;
        const pitchWalks = innings != null && bb9 != null ? Math.round((bb9 * innings) / 9) : null;

        upserts.push({
          player_id: playerId,
          season: seasonNum,
          era,
          whip,
          innings_pitched: innings,
          pitch_strikeouts: pitchStrikeouts,
          pitch_walks: pitchWalks,
        });

        const handedness = normalizeHandedness((values[2] || "").trim()) || null;
        playerUpdates.push({ id: playerId, team, handedness });
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
          .from("season_stats")
          .upsert(batch, { onConflict: "player_id,season" });
        if (error) throw error;
      }

      // Update team + handedness on players (best-effort, chunked).
      const uniqueUpdates = new Map<string, { id: string; team: string | null; handedness: string | null }>();
      for (const u of playerUpdates) uniqueUpdates.set(u.id, u);
      const updates = Array.from(uniqueUpdates.values());
      for (let i = 0; i < updates.length; i += CHUNK) {
        const batch = updates.slice(i, i + CHUNK);
        await Promise.all(
          batch.map(async (u) => {
            const payload: Record<string, any> = {};
            if (u.team != null) payload.team = u.team;
            if (u.handedness != null) payload.handedness = u.handedness;
            if (Object.keys(payload).length === 0) return;
            await supabase.from("players").update(payload).eq("id", u.id);
          }),
        );
      }

      if (unresolved.length > 0) {
        toast.success(`Synced ${upsertsUnique.length} rows. Unmatched: ${unresolved.length} (sample: ${unresolved.slice(0, 5).join(", ")})`);
      } else {
        toast.success(`Synced ${upsertsUnique.length} rows to Supabase.`);
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to sync to Supabase");
    } finally {
      setSyncing(false);
    }
  };

  // Keep headers fixed to the required schema and heal any stale local storage.
  useEffect(() => {
    const isFixed =
      headers.length === FIXED_HEADERS.length &&
      headers.every((h, i) => (h || "").trim().toLowerCase() === FIXED_HEADERS[i].toLowerCase());
    if (isFixed) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ headers: FIXED_HEADERS, rows }));
    } catch {
      // ignore localStorage errors
    }
    setHeaders([...FIXED_HEADERS]);
  }, [headers, rows, storageKey]);

  // Remove any accidental embedded header row from existing stored data.
  useEffect(() => {
    const cleaned = rows.filter((r) => !isEmbeddedHeaderRow(r.values));
    if (cleaned.length === rows.length) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ headers: FIXED_HEADERS, rows: cleaned }));
    } catch {
      // ignore localStorage errors
    }
    setRows(cleaned);
  }, [rows, storageKey]);

  const persist = (nextHeaders: string[], nextRows: PitchingStorageRow[]) => {
    setHeaders(nextHeaders);
    setRows(nextRows);
    try {
      localStorage.setItem(storageKey, JSON.stringify({ headers: nextHeaders, rows: nextRows }));
    } catch {
      // ignore localStorage errors
    }
  };

  const importCsv = async (file: File) => {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) throw new Error("CSV has no data rows.");

    const headerLineIndex = 0;
    const headerCols = parseCsvLine(lines[headerLineIndex]);
    const nextHeaders = [...FIXED_HEADERS];
    const playerIdx = findHeaderIndex(headerCols, ["player", "player name", "name", "playerfullname", "abbrevname"]);
    const teamIdx = findHeaderIndex(headerCols, ["team", "school", "newestteamname", "newestteamabbrevname"]);
    const handednessIdx = findHeaderIndex(headerCols, ["handedness", "throws", "throwshand"]);
    const eraIdx = findHeaderIndex(headerCols, ["era"]);
    const fipIdx = findHeaderIndex(headerCols, ["fip"]);
    const whipIdx = findHeaderIndex(headerCols, ["whip"]);
    const k9Idx = findHeaderIndex(headerCols, ["k/9", "k9", "k per 9"]);
    const bb9Idx = findHeaderIndex(headerCols, ["bb/9", "bb9", "bb per 9"]);
    const hr9Idx = findHeaderIndex(headerCols, ["hr/9", "hr9", "hr per 9"]);
    const gIdx = findHeaderIndex(headerCols, ["g", "games"]);
    const gsIdx = findHeaderIndex(headerCols, ["gs", "games started"]);
    const ipIdx = findHeaderIndex(headerCols, ["ip", "innings pitched"]);

    // Identity fallback only (when column names are non-standard).
    const playerCol = playerIdx >= 0 ? playerIdx : 0;
    const teamCol = teamIdx >= 0 ? teamIdx : 1;
    const handCol = handednessIdx >= 0 ? handednessIdx : 2;

    const existingByNameTeam = new Map<string, PitchingStorageRow>();
    const existingByName = new Map<string, PitchingStorageRow[]>();
    for (const row of rows) {
      const v = row.values || [];
      const name = (v[0] || "").trim();
      const team = (v[1] || "").trim();
      if (!name) continue;
      existingByNameTeam.set(`${normalize(name)}|${normalize(team)}`, row);
      const key = normalize(name);
      const bucket = existingByName.get(key) || [];
      bucket.push(row);
      existingByName.set(key, bucket);
    }

    const nextRows: PitchingStorageRow[] = [];
    for (let i = headerLineIndex + 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      if (cols.every((c) => !c?.trim())) continue;
      const pick = (idx: number) => (idx >= 0 ? (cols[idx] || "").trim() : "");
      const values = [...Array(MAX_COLS)].map(() => "");
      values[0] = pick(playerCol);
      values[1] = pick(teamCol);
      values[2] = pick(handCol);
      values[4] = pick(ipIdx);
      values[5] = pick(gIdx);
      values[6] = pick(gsIdx);
      values[7] = pick(eraIdx);
      values[8] = pick(fipIdx);
      values[9] = pick(whipIdx);
      values[10] = pick(k9Idx);
      values[11] = pick(bb9Idx);
      values[12] = pick(hr9Idx);
      if (isEmbeddedHeaderRow(values)) continue;
      if (!/[a-zA-Z]/.test(values[0] || "")) continue;
      values[2] = normalizeHandedness(values[2] || "");
      const g = toNum(values[5]);
      const gs = toNum(values[6]);
      values[3] = g != null && g > 0 && gs != null
        ? (gs / g < 0.5 ? "RP" : "SP")
        : "";

      const existing = (() => {
        const direct = existingByNameTeam.get(`${normalize(values[0])}|${normalize(values[1])}`);
        if (direct) return direct;
        const bucket = existingByName.get(normalize(values[0])) || [];
        return bucket.length === 1 ? bucket[0] : null;
      })();
      if (existing?.values) {
        for (let c = 0; c < MAX_COLS; c++) {
          if (!(values[c] || "").trim()) values[c] = existing.values[c] || "";
        }
      }

      nextRows.push({
        id: `${season}-${i}`,
        values,
      });
    }

    persist(nextHeaders, nextRows);
    toast.success(`Imported ${nextRows.length} pitching rows with G, GS, IP, and role tags.`);
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
          <CardTitle className="text-base">Pitching Stats Storage ({season})</CardTitle>
          <CardDescription>
            Imports pitcher stats and maps G, GS, IP. Role is auto-tagged: GS/G &lt; 50% = Reliever.
          </CardDescription>
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
            {Math.min(safePage * PAGE_SIZE, filteredRows.length)} of {filteredRows.length} players
          </span>
          <div className="flex items-center gap-1">
            {getPageWindow(safePage, totalPages).map((p) => (
              <Button
                key={`pitching-stats-page-${p}`}
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
        <div className="max-h-[620px] overflow-auto">
          <Table className="table-fixed">
            <TableHeader className="sticky top-0 z-20 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
              <TableRow>
                {Array.from({ length: MAX_COLS }).map((_, i) => (
                  <TableHead
                    key={`h-${i}`}
                    className={
                      i === 0
                        ? "px-2 w-[170px]"
                        : i === 1
                          ? "px-2 w-[145px]"
                            : i === 2
                              ? "px-2 w-[86px] text-center"
                            : i === 3
                              ? "px-2 w-[86px] text-center"
                              : "px-2 w-[70px] text-right"
                    }
                  >
                    {FIXED_HEADERS[i]}
                  </TableHead>
                ))}
                <TableHead className="px-2 w-[72px] text-right">ERA+</TableHead>
                <TableHead className="px-2 w-[72px] text-right">FIP+</TableHead>
                <TableHead className="px-2 w-[72px] text-right">WHIP+</TableHead>
                <TableHead className="px-2 w-[72px] text-right">K/9+</TableHead>
                <TableHead className="px-2 w-[72px] text-right">BB/9+</TableHead>
                <TableHead className="px-2 w-[72px] text-right">HR/9+</TableHead>
                <TableHead className="px-2 w-[72px] text-right">pRV+</TableHead>
                <TableHead className="px-2 w-[72px] text-right">pWAR</TableHead>
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
                            ? "font-medium px-2"
                            : i === 1
                              ? "px-2"
                              : i === 2 || i === 3
                                ? "px-2 text-center"
                              : "px-2 text-right font-mono"
                        }
                      >
                        {(() => {
                          if (i !== 0) return displayValueForCol(row.values, i) || "—";
                          const playerName = row.values[0] || "";
                          const teamName = row.values[1] || "";
                          const normalizedName = normalize(playerName);
                          const key = `${normalizedName}|${normalize(teamName)}`;
                          const direct = playerLookup.byNameTeam.get(key);
                          const fallback = playerLookup.byName.get(normalizedName);
                          // Support CSV names in "Last, First" format.
                          const swapped =
                            playerName.includes(",")
                              ? normalize(
                                  playerName
                                    .split(",")
                                    .map((s) => s.trim())
                                    .filter(Boolean)
                                    .reverse()
                                    .join(" "),
                                )
                              : null;
                          const swappedMatch = swapped ? playerLookup.byName.get(swapped) : null;
                          const parts = playerName.trim().split(/\s+/).filter(Boolean);
                          const firstInitial = parts[0]?.[0] ? parts[0][0].toLowerCase() : "";
                          const lastToken = parts.length > 1 ? parts[parts.length - 1] : "";
                          const lastFirstInitialKey = normalize(`${lastToken} ${firstInitial}`);
                          const lastFirstInitialMatch = playerLookup.byLastFirstInitial.get(lastFirstInitialKey);
                          const found = direct || fallback || swappedMatch || lastFirstInitialMatch;
                          if (!playerName) return "—";
                          const to = found
                            ? `/dashboard/pitcher/${found.id}`
                            : `/dashboard/pitcher/storage__${encodeURIComponent(playerName)}__${encodeURIComponent(teamName || "")}`;
                          return (
                            <Link
                              to={to}
                              className="text-primary underline underline-offset-4 hover:opacity-80"
                            >
                              {playerName}
                            </Link>
                          );
                        })()}
                      </TableCell>
                    ))}
                    {(() => {
                      const stats = resolveStatsView(row.values);
                      const era = toNum(stats.era);
                      const fip = toNum(stats.fip);
                      const whip = toNum(stats.whip);
                      const k9 = toNum(stats.k9);
                      const bb9 = toNum(stats.bb9);
                      const hr9 = toNum(stats.hr9);
                      const eraPlus = calcEraPlus(era, weights.era_plus_ncaa_avg, weights.era_plus_ncaa_sd, weights.era_plus_scale);
                      const fipPlus = calcFipPlus(fip, weights.fip_plus_ncaa_avg, weights.fip_plus_ncaa_sd, weights.fip_plus_scale);
                      const whipPlus = calcWhipPlus(whip, weights.whip_plus_ncaa_avg, weights.whip_plus_ncaa_sd, weights.whip_plus_scale);
                      const k9Plus = calcK9Plus(k9, weights.k9_plus_ncaa_avg, weights.k9_plus_ncaa_sd, weights.k9_plus_scale);
                      const bb9Plus = calcBb9Plus(bb9, weights.bb9_plus_ncaa_avg, weights.bb9_plus_ncaa_sd, weights.bb9_plus_scale);
                      const hr9Plus = calcHr9Plus(hr9, weights.hr9_plus_ncaa_avg, weights.hr9_plus_ncaa_sd, weights.hr9_plus_scale);
                      const pRVRaw =
                        [fipPlus, eraPlus, whipPlus, k9Plus, bb9Plus, hr9Plus].some((v) => v == null)
                          ? null
                          : (
                              (weights.fip_plus_weight * Number(fipPlus)) +
                              (weights.era_plus_weight * Number(eraPlus)) +
                              (weights.whip_plus_weight * Number(whipPlus)) +
                              (weights.k9_plus_weight * Number(k9Plus)) +
                              (weights.bb9_plus_weight * Number(bb9Plus)) +
                              (weights.hr9_plus_weight * Number(hr9Plus))
                            );
                      const pRV = pRVRaw == null ? null : Math.round(pRVRaw);
                      const innings = parseBaseballInnings(displayValueForCol(row.values, 4));
                      const pWar = pRVRaw == null || innings == null || weights.pwar_runs_per_win === 0
                        ? null
                        : (((((pRVRaw - 100) / 100) * (innings / 9) * weights.pwar_r_per_9) + ((innings / 9) * weights.pwar_replacement_runs_per_9)) / weights.pwar_runs_per_win);
                      return (
                        <>
                          <TableCell className="px-2 text-right font-mono">{eraPlus ?? "—"}</TableCell>
                          <TableCell className="px-2 text-right font-mono">{fipPlus ?? "—"}</TableCell>
                          <TableCell className="px-2 text-right font-mono">{whipPlus ?? "—"}</TableCell>
                          <TableCell className="px-2 text-right font-mono">{k9Plus ?? "—"}</TableCell>
                          <TableCell className="px-2 text-right font-mono">{bb9Plus ?? "—"}</TableCell>
                          <TableCell className="px-2 text-right font-mono">{hr9Plus ?? "—"}</TableCell>
                          <TableCell className="px-2 text-right font-mono font-semibold">{pRV ?? "—"}</TableCell>
                          <TableCell className="px-2 text-right font-mono font-semibold">{pWar == null ? "—" : pWar.toFixed(2)}</TableCell>
                        </>
                      );
                    })()}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={MAX_COLS + 8} className="py-8 text-center text-muted-foreground">
                    No pitching rows loaded for {season}. Import a CSV to begin.
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
