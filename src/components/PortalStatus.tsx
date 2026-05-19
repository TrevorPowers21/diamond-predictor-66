import { Phone, Mail, GraduationCap, BadgeDollarSign, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type PortalStatus = "NOT IN PORTAL" | "WATCHING" | "IN PORTAL" | "COMMITTED" | "WITHDRAWN";

const STATUS_CONFIG: Record<PortalStatus, { bg: string; text: string; label: string; dot: string }> = {
  "NOT IN PORTAL": { bg: "bg-muted", text: "text-muted-foreground", label: "Not In Portal", dot: "bg-muted-foreground/40" },
  "WATCHING":      { bg: "bg-[#D4AF37]/10", text: "text-[#D4AF37]", label: "Watching",     dot: "bg-[#D4AF37]" },
  "IN PORTAL":     { bg: "bg-emerald-500/10", text: "text-emerald-600", label: "In Portal", dot: "bg-emerald-500" },
  "COMMITTED":     { bg: "bg-blue-500/10", text: "text-blue-600", label: "Committed",      dot: "bg-blue-500" },
  "WITHDRAWN":     { bg: "bg-slate-500/10", text: "text-slate-500", label: "Withdrawn",    dot: "bg-slate-500" },
};

function formatDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface PortalPlayer {
  portal_status?: string | null;
  portal_entry_date?: string | null;
  commit_school?: string | null;
  commit_date?: string | null;
  athletic_aid?: string | null;
  contact_cell?: string | null;
  contact_email?: string | null;
  gpa?: number | null;
  va_roster_link?: string | null;
}

interface PortalStatusBadgeProps {
  player: PortalPlayer;
  isAdmin?: boolean;
  onChange?: (value: PortalStatus) => void;
}

export function PortalStatusBadge({ player, isAdmin, onChange }: PortalStatusBadgeProps) {
  const ps = ((player.portal_status as PortalStatus) || "NOT IN PORTAL");
  const c = STATUS_CONFIG[ps] || STATUS_CONFIG["NOT IN PORTAL"];

  if (isAdmin && onChange) {
    return (
      <Select value={ps} onValueChange={(v) => onChange(v as PortalStatus)}>
        <SelectTrigger className={`h-auto w-auto gap-1 border-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${c.bg} ${c.text} focus:ring-0 focus:ring-offset-0`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start" className="min-w-[140px]">
          {(["NOT IN PORTAL", "WATCHING", "IN PORTAL", "COMMITTED", "WITHDRAWN"] as PortalStatus[]).map((s) => (
            <SelectItem key={s} value={s}>
              <span className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${STATUS_CONFIG[s].dot}`} />
                {STATUS_CONFIG[s].label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (ps === "NOT IN PORTAL") return null;

  // Read-only badge with date / commit info appended
  const entryDate = formatDate(player.portal_entry_date);
  const commitDate = formatDate(player.commit_date);
  const detail = (() => {
    if (ps === "COMMITTED" && player.commit_school) return ` → ${player.commit_school}${commitDate ? ` · ${commitDate}` : ""}`;
    if (ps === "IN PORTAL" && entryDate) return ` · ${entryDate}`;
    if (ps === "WITHDRAWN" && entryDate) return ` · entered ${entryDate}`;
    return "";
  })();

  return <Badge className={`${c.bg} ${c.text} border-0`}>{c.label}{detail}</Badge>;
}

interface PortalContactButtonProps {
  player: PortalPlayer;
}

/**
 * Compact "Contact" button — opens a popover with cell, email, athletic aid,
 * GPA, and Verified Athletics roster link. Only renders when player has at
 * least one contact field populated.
 */
export function PortalContactButton({ player }: PortalContactButtonProps) {
  const hasAny =
    player.contact_cell ||
    player.contact_email ||
    player.athletic_aid ||
    player.gpa != null ||
    player.va_roster_link;
  if (!hasAny) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-[#D4AF37]/10 text-[#D4AF37] ring-1 ring-[#D4AF37]/30 hover:bg-[#D4AF37]/20 hover:ring-[#D4AF37]/50 transition-colors duration-200 cursor-pointer text-[10px] font-semibold uppercase tracking-[0.08em]"
          style={{ fontFamily: "Oswald, sans-serif" }}
        >
          <Phone className="w-3 h-3" />
          Contact
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[300px] p-0 overflow-hidden border-l-[3px] border-l-[#D4AF37]"
      >
        {/* Header — matches "Today's Briefing" strip pattern */}
        <div className="bg-[#0D1B3E] px-4 py-2.5 flex items-center gap-2">
          <Phone className="w-3 h-3 text-[#D4AF37]" />
          <span
            className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#D4AF37]"
            style={{ fontFamily: "Oswald, sans-serif" }}
          >
            Portal Contact
          </span>
        </div>
        {/* Body */}
        <div className="px-4 py-3 space-y-2">
          {player.contact_cell && (
            <a
              href={`tel:${player.contact_cell}`}
              className="flex items-center gap-2.5 text-[13px] text-foreground hover:text-[#D4AF37] transition-colors cursor-pointer py-1"
            >
              <Phone className="w-3.5 h-3.5 text-muted-foreground shrink-0 group-hover:text-[#D4AF37]" />
              <span className="font-medium">{player.contact_cell}</span>
            </a>
          )}
          {player.contact_email && (
            <a
              href={`mailto:${player.contact_email}`}
              className="flex items-center gap-2.5 text-[13px] text-foreground hover:text-[#D4AF37] transition-colors cursor-pointer py-1"
            >
              <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="font-medium break-all">{player.contact_email}</span>
            </a>
          )}
          {(player.athletic_aid || player.gpa != null) && (
            <div className="flex items-center gap-4 pt-2 mt-1 border-t border-border/60">
              {player.athletic_aid && (
                <div className="flex items-center gap-1.5">
                  <BadgeDollarSign className="w-3.5 h-3.5 text-muted-foreground" />
                  <div className="leading-tight">
                    <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground" style={{ fontFamily: "Oswald, sans-serif" }}>Aid</p>
                    <p className="text-[12px] text-foreground font-medium">{player.athletic_aid}</p>
                  </div>
                </div>
              )}
              {player.gpa != null && (
                <div className="flex items-center gap-1.5">
                  <GraduationCap className="w-3.5 h-3.5 text-muted-foreground" />
                  <div className="leading-tight">
                    <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground" style={{ fontFamily: "Oswald, sans-serif" }}>GPA</p>
                    <p className="text-[12px] text-foreground font-medium">{player.gpa.toFixed(2)}</p>
                  </div>
                </div>
              )}
            </div>
          )}
          {player.va_roster_link && (
            <a
              href={player.va_roster_link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-[#D4AF37] transition-colors cursor-pointer pt-2 border-t border-border/60 mt-1"
            >
              <ExternalLink className="w-3 h-3" />
              <span className="uppercase tracking-[0.08em] font-semibold" style={{ fontFamily: "Oswald, sans-serif" }}>
                View Roster Page
              </span>
            </a>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
