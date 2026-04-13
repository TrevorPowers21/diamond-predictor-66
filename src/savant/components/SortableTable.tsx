import { useMemo, useState } from "react";
import { GOLD } from "@/savant/lib/theme";

type SortKey = string;
type SortDir = "asc" | "desc";

export function useSortable<T>(data: T[], defaultKey: SortKey, defaultDir: SortDir = "desc") {
  const [sortKey, setSortKey] = useState<SortKey>(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      const av = (a as any)[sortKey];
      const bv = (b as any)[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [data, sortKey, sortDir]);

  return { sorted, sortKey, sortDir, toggleSort };
}

export function SortHeader({ label, field, sortKey, sortDir, onSort, align = "right" }: {
  label: string;
  field: string;
  sortKey: string;
  sortDir: string;
  onSort: (f: string) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === field;
  return (
    <th
      className={`cursor-pointer select-none px-3 py-2 transition-colors hover:text-[#D4AF37] ${align === "left" ? "text-left" : "text-right"}`}
      onClick={() => onSort(field)}
    >
      <span className={active ? "text-[#D4AF37]" : ""}>{label}</span>
      {active && <span className="ml-0.5 text-[9px]">{sortDir === "asc" ? "▲" : "▼"}</span>}
    </th>
  );
}

export function tierColor(value: number | null, avg: number, sd: number, invert = false): string {
  if (value == null) return "";
  const z = (value - avg) / sd;
  const adj = invert ? -z : z;
  if (adj >= 1.5) return "#22c55e";
  if (adj >= 0.75) return "#3b82f6";
  if (adj >= -0.75) return "#ffffff";
  if (adj >= -1.5) return "#eab308";
  return "#ef4444";
}
