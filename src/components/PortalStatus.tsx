import { useEffect, useState } from "react";
import { Phone, Mail, GraduationCap, BadgeDollarSign, ExternalLink, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type PortalStatus = "NOT IN PORTAL" | "WATCHING" | "IN PORTAL" | "COMMITTED" | "WITHDRAWN";

export interface PortalFields {
  portal_status: PortalStatus;
  portal_entry_date: string | null;
  commit_school: string | null;
  commit_date: string | null;
}

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

interface PortalStatusEditorProps {
  player: PortalPlayer;
  onSave: (fields: PortalFields) => void | Promise<void>;
}

export function PortalStatusEditor({ player, onSave }: PortalStatusEditorProps) {
  const initialStatus = ((player.portal_status as PortalStatus) || "NOT IN PORTAL");
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<PortalStatus>(initialStatus);
  const [entryDate, setEntryDate] = useState(toDateInput(player.portal_entry_date));
  const [commitSchool, setCommitSchool] = useState(player.commit_school ?? "");
  const [commitDate, setCommitDate] = useState(toDateInput(player.commit_date));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStatus(initialStatus);
    setEntryDate(toDateInput(player.portal_entry_date));
    setCommitSchool(player.commit_school ?? "");
    setCommitDate(toDateInput(player.commit_date));
  }, [open, initialStatus, player.portal_entry_date, player.commit_school, player.commit_date]);

  const c = STATUS_CONFIG[initialStatus] || STATUS_CONFIG["NOT IN PORTAL"];
  const showEntryDate = status === "IN PORTAL" || status === "WITHDRAWN" || status === "COMMITTED";
  const showCommit = status === "COMMITTED";

  const handleSave = async () => {
    setSaving(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const fields: PortalFields = {
        portal_status: status,
        portal_entry_date: showEntryDate
          ? (entryDate || (status === "IN PORTAL" ? today : null))
          : null,
        commit_school: showCommit ? (commitSchool.trim() || null) : null,
        commit_date: showCommit
          ? (commitDate || (status === "COMMITTED" ? today : null))
          : null,
      };
      await onSave(fields);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider cursor-pointer transition-colors duration-200 ${c.bg} ${c.text} hover:brightness-110`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
          {c.label}
          <Pencil className="w-2.5 h-2.5 opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[280px] p-0 overflow-hidden border-l-[3px] border-l-[#D4AF37]">
        <div className="bg-[#0D1B3E] px-4 py-2.5">
          <span
            className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#D4AF37]"
            style={{ fontFamily: "Oswald, sans-serif" }}
          >
            Portal Override
          </span>
        </div>
        <div className="px-4 py-3 space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as PortalStatus)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
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
          </div>

          {showEntryDate && (
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Entry date</Label>
              <Input
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          )}

          {showCommit && (
            <>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Commit school</Label>
                <Input
                  value={commitSchool}
                  onChange={(e) => setCommitSchool(e.target.value)}
                  placeholder="e.g. Tennessee"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Commit date</Label>
                <Input
                  type="date"
                  value={commitDate}
                  onChange={(e) => setCommitDate(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} className="h-7 text-xs">Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={saving} className="h-7 text-xs bg-[#D4AF37] text-[#070e1f] hover:bg-[#A08820]">
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface PortalStatusBadgeProps {
  player: PortalPlayer;
  isAdmin?: boolean;
  /**
   * Legacy single-field handler. When `onSave` is provided it takes precedence
   * and gives the admin the full editor (status + entry date + commit info).
   */
  onChange?: (value: PortalStatus) => void;
  onSave?: (fields: PortalFields) => void | Promise<void>;
}

function toDateInput(d: string | null | undefined): string {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toISOString().slice(0, 10);
}

export function PortalStatusBadge({ player, isAdmin, onChange, onSave }: PortalStatusBadgeProps) {
  const ps = ((player.portal_status as PortalStatus) || "NOT IN PORTAL");
  const c = STATUS_CONFIG[ps] || STATUS_CONFIG["NOT IN PORTAL"];

  if (isAdmin && onSave) {
    return <PortalStatusEditor player={player} onSave={onSave} />;
  }

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
