/**
 * RSTR IQ Scouting Report — Selection & Download Components
 *
 * Provides:
 *  - ScoutingReportProvider — context that holds selected player state
 *  - PlayerSelectCheckbox — per-row checkbox
 *  - SelectAllToggle — bulk select/deselect
 *  - DownloadReportBar — fixed bottom bar with player chips + download button
 */

import React, { createContext, useContext, useState, useCallback, useRef } from "react";
import { X, Download, FileText, Plus, Check, Star } from "lucide-react";
import { generateReportPdf } from "@/lib/pdfGenerator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ── Types ───────────────────────────────────────────────────────────

export interface ReportPlayer {
  id: string;
  player_type: "hitter" | "pitcher";
  name: string;
  school?: string | null;
  position?: string | null;
  class_year?: string | null;
  bats_throws?: string | null;
  // Bio
  sport?: string | null;
  season?: string | null;
  conference?: string | null;
  height?: string | null;
  weight?: number | string | null;
  hometown?: string | null;
  draft_year?: number | string | null;
  // Hitter projected
  p_avg?: number | null;
  p_obp?: number | null;
  p_slg?: number | null;
  p_ops?: number | null;
  p_iso?: number | null;
  p_wrc_plus?: number | null;
  owar?: number | null;
  proj_hr?: number | null;
  proj_rbi?: number | null;
  proj_bb?: number | null;
  proj_k?: number | null;
  // Pitcher projected
  p_era?: number | null;
  p_fip?: number | null;
  p_whip?: number | null;
  p_k9?: number | null;
  p_bb9?: number | null;
  p_hr9?: number | null;
  p_war?: number | null;
  // Shared valuation
  nil_value?: number | null;
  nil_tier?: string | null;
  market_value?: number | null;
  power_rating_plus?: number | null;
  overall_pr_plus?: number | null;
  // Hitter scouting scores (used in tables)
  barrel_score?: number | null;
  ev_score?: number | null;
  contact_score?: number | null;
  chase_score?: number | null;
  // Pitcher scouting scores (used in tables)
  stuff_plus?: number | null;
  whiff_pct?: number | null;
  stuff_score?: number | null;
  whiff_score?: number | null;
  bb_score?: number | null;
  // Scouting grades (20-80 scale for PDF)
  grade_hit?: number | null;
  grade_power?: number | null;
  grade_speed?: number | null;
  grade_field?: number | null;
  grade_arm?: number | null;
  grade_ofp?: number | null;
  grade_fb?: number | null;
  grade_ctrl?: number | null;
  grade_cmd?: number | null;
  grade_del?: number | null;
  grade_proj?: number | null;
  // Data
  career_seasons?: any[];
  pitches?: any[];
  scouting_notes?: string | null;
  // Risk assessment
  risk_grade?: string | null;
  risk_score?: number | null;
  risk_trajectory?: string | null;
  risk_summary?: string | null;
  risk_factors?: { label: string; score: number | null; detail: string }[];
}

interface ScoutingReportContextType {
  selected: Map<string, ReportPlayer>;
  toggle: (player: ReportPlayer) => void;
  isSelected: (id: string) => boolean;
  remove: (id: string) => void;
  clear: () => void;
  selectAll: (players: ReportPlayer[]) => void;
  deselectAll: (ids: string[]) => void;
  count: number;
}

const ScoutingReportContext = createContext<ScoutingReportContextType | null>(null);

function useScoutingReport() {
  const ctx = useContext(ScoutingReportContext);
  if (!ctx) throw new Error("useScoutingReport must be inside ScoutingReportProvider");
  return ctx;
}

// ── Provider ────────────────────────────────────────────────────────

export function ScoutingReportProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Map<string, ReportPlayer>>(new Map());

  const toggle = useCallback((player: ReportPlayer) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(player.id)) {
        next.delete(player.id);
      } else if (next.size < 30) {
        next.set(player.id, player);
      }
      return next;
    });
  }, []);

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);
  const remove = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);
  const clear = useCallback(() => setSelected(new Map()), []);

  const selectAll = useCallback((players: ReportPlayer[]) => {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const p of players) {
        if (next.size >= 30) break;
        next.set(p.id, p);
      }
      return next;
    });
  }, []);

  const deselectAll = useCallback((ids: string[]) => {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  return (
    <ScoutingReportContext.Provider
      value={{ selected, toggle, isSelected, remove, clear, selectAll, deselectAll, count: selected.size }}
    >
      {children}
    </ScoutingReportContext.Provider>
  );
}

// ── Checkbox ────────────────────────────────────────────────────────

export function PlayerSelectCheckbox({ player }: { player: ReportPlayer }) {
  const { toggle, isSelected } = useScoutingReport();
  const checked = isSelected(player.id);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggle(player);
      }}
      className={cn(
        "inline-flex h-5 w-5 items-center justify-center rounded border transition-colors duration-150 cursor-pointer",
        checked
          ? "bg-[#D4AF37] border-[#D4AF37] text-[#040810]"
          : "border-[#162241] bg-[#0a1428] hover:border-[#D4AF37]/50 text-transparent"
      )}
      title={checked ? "Deselect for report" : "Select for report"}
    >
      <Check className="h-3 w-3" strokeWidth={3} />
    </button>
  );
}

// ── Select All Toggle ───────────────────────────────────────────────

export function SelectAllToggle({
  players,
  label = "Select all for report",
}: {
  players: ReportPlayer[];
  label?: string;
}) {
  const { selectAll, deselectAll, isSelected } = useScoutingReport();
  const allSelected = players.length > 0 && players.every((p) => isSelected(p.id));
  return (
    <button
      type="button"
      onClick={() => {
        if (allSelected) {
          deselectAll(players.map((p) => p.id));
        } else {
          selectAll(players);
        }
      }}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium transition-colors duration-150 cursor-pointer px-2 py-1 rounded",
        allSelected
          ? "text-[#D4AF37] hover:text-[#D4AF37]/80"
          : "text-[#8a94a6] hover:text-slate-200"
      )}
    >
      <div
        className={cn(
          "h-3.5 w-3.5 rounded-sm border flex items-center justify-center transition-colors duration-150",
          allSelected
            ? "bg-[#D4AF37] border-[#D4AF37] text-[#040810]"
            : "border-[#162241] bg-[#0a1428]"
        )}
      >
        {allSelected && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
      </div>
      {label}
    </button>
  );
}

// ── Download Bar ────────────────────────────────────────────────────

export function DownloadReportBar({
  onAddToHighFollow,
}: {
  onAddToHighFollow?: (players: ReportPlayer[]) => void;
}) {
  const { selected, remove, clear, count } = useScoutingReport();
  const [showTitle, setShowTitle] = useState(false);
  const [title, setTitle] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  if (count === 0) return null;

  const handlePreview = () => {
    const players = Array.from(selected.values());
    const url = generateReportPdf(players, title || null);
    window.open(url as string, "_blank");
  };

  const players = Array.from(selected.values());

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-[#D4AF37]/30 bg-[#0a1428]/95 backdrop-blur-sm">
      <div className="max-w-[1600px] mx-auto px-4 py-3">
        <div className="flex items-center gap-3">
          {/* Player chips */}
          <div className="flex-1 flex items-center gap-1.5 overflow-x-auto scrollbar-none">
            <FileText className="h-4 w-4 text-[#D4AF37] shrink-0" />
            {players.slice(0, 10).map((p) => (
              <span
                key={p.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#162241] text-slate-200 whitespace-nowrap shrink-0"
              >
                {p.name}
                <button
                  type="button"
                  onClick={() => remove(p.id)}
                  className="hover:text-[#D4AF37] transition-colors cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {players.length > 10 && (
              <span className="text-[11px] text-[#8a94a6] whitespace-nowrap">
                +{players.length - 10} more
              </span>
            )}
          </div>

          {/* Title input */}
          {showTitle ? (
            <Input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Report title..."
              className="h-8 w-48 text-xs border-[#162241] bg-[#0d1a30] text-slate-200 placeholder:text-[#5a6478]"
              onKeyDown={(e) => {
                if (e.key === "Enter") setShowTitle(false);
              }}
            />
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-[#8a94a6] hover:text-[#D4AF37] cursor-pointer"
              onClick={() => {
                setShowTitle(true);
                setTimeout(() => titleRef.current?.focus(), 50);
              }}
            >
              <Plus className="h-3 w-3 mr-1" />
              TITLE
            </Button>
          )}

          {/* Add to High Follow */}
          {onAddToHighFollow && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-[#8a94a6] hover:text-[#D4AF37] cursor-pointer"
              onClick={() => onAddToHighFollow(players)}
            >
              <Star className="h-3 w-3 mr-1" />
              HIGH FOLLOW
            </Button>
          )}

          {/* Clear */}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-[#8a94a6] hover:text-red-400 cursor-pointer"
            onClick={clear}
          >
            CLEAR
          </Button>

          {/* Preview */}
          <Button
            size="sm"
            className="h-8 text-xs font-semibold bg-[#D4AF37] text-[#040810] hover:bg-[#c49e2e] cursor-pointer"
            onClick={handlePreview}
          >
            <FileText className="h-3.5 w-3.5 mr-1.5" />
            {`Preview Report (${count})`}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Single player export helper (for profile pages) ─────────────────

export function downloadSinglePlayerReport(player: ReportPlayer) {
  const url = generateReportPdf([player]);
  window.open(url as string, "_blank");
}
