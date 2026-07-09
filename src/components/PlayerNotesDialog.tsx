import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { CalendarDays, StickyNote, X } from "lucide-react";

const OSWALD = { fontFamily: "'Oswald', sans-serif" } as const;

/** A single authored, dated note. Shared shape across GM + coach surfaces. */
export interface DatedNote {
  id: string;
  author: string | null;
  note_date: string; // YYYY-MM-DD
  body: string | null;
}

/** "Jul 9, 2026" — the date the note was stamped with. */
const fmtDate = (d: string) => {
  const dt = new Date(`${d}T00:00:00`);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

/**
 * Shared player-notes dialog — an authored, DATED log. One designed component
 * used on BOTH the GM Roster Management surface and the coach Team Builder so a
 * note reads identically in both places (each entry stamped with its date +
 * author). Presentational: the parent owns the data + mutations.
 *
 * Design: navy/gold per design-system/rstr-iq/MASTER.md — Oswald gold uppercase
 * header, dense dated entries, the date carried in a gold chip so it's always
 * attached to the note.
 */
export default function PlayerNotesDialog({
  open,
  onOpenChange,
  playerName,
  notes,
  onAdd,
  onRemove,
  busy = false,
  subtitle = "Each note is stamped with the date and who wrote it. Visible to your whole staff.",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  playerName: string;
  notes: DatedNote[];
  onAdd: (body: string) => void;
  onRemove: (id: string) => void;
  busy?: boolean;
  subtitle?: string;
}) {
  const [draft, setDraft] = useState("");
  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    onAdd(body);
    setDraft("");
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setDraft(""); onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex items-center gap-2 text-[15px] font-bold uppercase tracking-[0.14em] text-[#D4AF37]" style={OSWALD}>
            <StickyNote className="h-4 w-4" />
            Notes — {playerName}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </DialogHeader>

        {/* Add a note */}
        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit(); }}
            placeholder="e.g. Wants to play SS, open to $350K; family close to campus…"
            className="min-h-[80px] text-sm"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">⌘↵ to add</span>
            <Button size="sm" disabled={!draft.trim() || busy} onClick={submit}>Add Note</Button>
          </div>
        </div>

        {/* Existing notes, newest first — each led by its date */}
        <div className="mt-1 max-h-[46vh] space-y-2 overflow-y-auto">
          {notes.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">No notes yet.</p>
          ) : (
            notes.map((n) => (
              <div key={n.id} className="group rounded-md border border-border/60 bg-muted/20 px-3 py-2 transition-colors hover:bg-muted/30">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded bg-[#D4AF37]/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#D4AF37] ring-1 ring-[#D4AF37]/20">
                    <CalendarDays className="h-3 w-3" />
                    {fmtDate(n.note_date)}
                  </span>
                  {n.author && <span className="text-[11px] text-muted-foreground">{n.author.split("@")[0]}</span>}
                  <button
                    onClick={() => onRemove(n.id)}
                    className="ml-auto text-muted-foreground/40 opacity-0 transition hover:text-destructive group-hover:opacity-100"
                    title="Delete note"
                    aria-label="Delete note"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground/90">{n.body}</p>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
