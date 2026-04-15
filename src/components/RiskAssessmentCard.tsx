/**
 * RSTR IQ — Risk Assessment Card
 * Shared component used on both RSTR IQ and Savant player profiles.
 * Renders risk grade, trajectory, factor bars, and summary.
 */

import type { RiskAssessment, RiskGrade } from "@/lib/playerRisk";
import { cn } from "@/lib/utils";
import { ShieldAlert } from "lucide-react";

// ── Grade colors — text + border + bg ───────────────────────────────
const GRADE_STYLES: Record<RiskGrade, { badge: string; text: string; icon: string }> = {
  Low: {
    badge: "bg-[hsl(142,71%,45%,0.12)] text-[hsl(142,71%,35%)] border-[hsl(142,71%,45%,0.3)]",
    text: "text-[hsl(142,71%,35%)]",
    icon: "text-[hsl(142,71%,45%)]",
  },
  Moderate: {
    badge: "bg-[hsl(200,80%,50%,0.12)] text-[hsl(200,80%,35%)] border-[hsl(200,80%,50%,0.3)]",
    text: "text-[hsl(200,80%,35%)]",
    icon: "text-[hsl(200,80%,50%)]",
  },
  Elevated: {
    badge: "bg-[hsl(40,90%,50%,0.12)] text-[hsl(40,90%,38%)] border-[hsl(40,90%,50%,0.3)]",
    text: "text-[hsl(40,90%,38%)]",
    icon: "text-[hsl(40,90%,50%)]",
  },
  High: {
    badge: "bg-[hsl(0,72%,51%,0.12)] text-[hsl(0,72%,41%)] border-[hsl(0,72%,51%,0.3)]",
    text: "text-[hsl(0,72%,41%)]",
    icon: "text-[hsl(0,72%,51%)]",
  },
};

const TRAJ_STYLES: Record<string, string> = {
  Progressing: "text-[hsl(142,71%,35%)]",
  Plateau: "text-[hsl(40,90%,38%)]",
  Regressing: "text-[hsl(0,72%,41%)]",
  Unknown: "text-[#8a94a6]",
};

const BAR_COLORS: Record<string, string> = {
  low: "bg-[hsl(142,71%,45%)]",
  moderate: "bg-[hsl(200,80%,50%)]",
  elevated: "bg-[hsl(40,90%,50%)]",
  high: "bg-[hsl(0,72%,51%)]",
};

function barColor(score: number): string {
  if (score <= 25) return BAR_COLORS.low;
  if (score <= 50) return BAR_COLORS.moderate;
  if (score <= 75) return BAR_COLORS.elevated;
  return BAR_COLORS.high;
}

function scoreLabel(score: number): string {
  if (score <= 25) return "Low";
  if (score <= 50) return "Mod";
  if (score <= 75) return "Elev";
  return "High";
}

// ── RSTR IQ variant (Card-based) ────────────────────────────────────

export function RiskAssessmentCardRSTR({ risk }: { risk: RiskAssessment }) {
  const gs = GRADE_STYLES[risk.grade];
  return (
    <div className="border-[#162241] bg-[#0a1428] rounded-lg border">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <h3 className="text-sm font-semibold tracking-wide uppercase text-[#D4AF37] flex items-center gap-2" style={{ fontFamily: "Oswald, sans-serif" }}>
          <ShieldAlert className={cn("h-4 w-4", gs.icon)} />
          Risk Assessment
        </h3>
        <div className="flex items-center gap-2">
          <span className={cn("text-xs font-bold", TRAJ_STYLES[risk.trajectory] || TRAJ_STYLES.Unknown)}>
            {risk.trajectory}
          </span>
          <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border", gs.badge)}>
            {risk.grade} Risk
          </span>
        </div>
      </div>

      {/* Summary */}
      <div className="px-4 pb-2">
        <p className="text-xs text-slate-300 leading-relaxed">{risk.summary}</p>
      </div>

      {/* Factor bars — compact, no detail notes */}
      <div className="px-4 pb-3 space-y-1.5">
        {risk.factors.map((f) => (
          <div key={f.label} className="flex items-center gap-2">
            <div className="w-[72px] text-[10px] uppercase tracking-wider font-semibold text-[#8a94a6] shrink-0">{f.label}</div>
            <div className="flex-1 h-2 rounded-full bg-[#162241] overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all duration-300", barColor(f.score))}
                style={{ width: `${f.score}%` }}
              />
            </div>
            <div className="w-7 text-right text-[10px] tabular-nums text-slate-400 font-semibold">{f.score}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Savant variant (section-based, matches Savant card pattern) ─────

export function RiskAssessmentCardSavant({
  risk,
  navyCard = "#0a1428",
  navyBorder = "#1f2d52",
}: {
  risk: RiskAssessment;
  navyCard?: string;
  navyBorder?: string;
}) {
  const gs = GRADE_STYLES[risk.grade];

  return (
    <section className="border px-5 py-4" style={{ backgroundColor: navyCard, borderColor: navyBorder }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-bold uppercase tracking-[0.22em] text-[#D4AF37] flex items-center gap-2" style={{ fontFamily: "'Oswald', sans-serif" }}>
          <ShieldAlert className={cn("h-3.5 w-3.5", gs.icon)} />
          Risk Assessment
        </h2>
        <div className="flex items-center gap-2">
          <span className={cn("text-[10px] font-bold", TRAJ_STYLES[risk.trajectory] || TRAJ_STYLES.Unknown)}>
            {risk.trajectory}
          </span>
          <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border", gs.badge)}>
            {risk.grade}
          </span>
        </div>
      </div>

      {/* Summary */}
      <p className="text-[11px] text-[#8a94a6] leading-relaxed mb-3">{risk.summary}</p>

      {/* Factor bars */}
      <div className="space-y-1.5">
        {risk.factors.map((f) => (
          <div key={f.label} className="flex items-center gap-2">
            <div className="w-[65px] text-[9px] uppercase tracking-wider font-semibold text-[#8a94a6] shrink-0">{f.label}</div>
            <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all duration-300", barColor(f.score))}
                style={{ width: `${f.score}%` }}
              />
            </div>
            <div className="w-6 text-right text-[9px] tabular-nums text-[#8a94a6]">{f.score}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
