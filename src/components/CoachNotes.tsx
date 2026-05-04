import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCoachNotes, type CoachNote } from "@/hooks/useCoachNotes";
import { useAuth } from "@/hooks/useAuth";
import { Pencil, Trash2, FileText, X, Check, ChevronDown, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";

export type CoachNotesExportFormat = "notes" | "full";
export type CoachNotesExportMode = "download" | "preview";

interface CoachNotesProps {
  playerId: string;
  playerName: string;
  onExportPdf?: (notes: CoachNote[], format: CoachNotesExportFormat, mode?: CoachNotesExportMode) => void;
  /** When true, render as an inline action button instead of a full card (default: true) */
  buttonSize?: "sm" | "default";
}

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

export default function CoachNotes({ playerId, playerName, onExportPdf, buttonSize = "sm" }: CoachNotesProps) {
  const { user } = useAuth();
  const { notes, isLoading, addNote, updateNote, deleteNote, isAdding } = useCoachNotes(playerId);
  const [open, setOpen] = useState(false);

  const [newContent, setNewContent] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  const handleAdd = () => {
    if (!newContent.trim()) return;
    addNote({ content: newContent });
    setNewContent("");
  };

  const handleStartEdit = (note: CoachNote) => {
    setEditingId(note.id);
    setEditContent(note.content);
  };

  const handleSaveEdit = () => {
    if (!editingId || !editContent.trim()) return;
    updateNote({ id: editingId, content: editContent });
    setEditingId(null);
    setEditContent("");
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditContent("");
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size={buttonSize} className="cursor-pointer gap-2">
          <StickyNote className="h-3.5 w-3.5" />
          Coach Notes
          {notes.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-[#D4AF37]/15 text-[#D4AF37] text-[10px] font-bold tabular-nums">
              {notes.length}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[560px] overflow-y-auto p-0 gap-0"
      >
        <SheetHeader className="px-4 pt-4 pb-3 border-b border-border/40">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col items-start gap-0.5">
              <SheetTitle
                className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37] text-left"
                style={{ fontFamily: "'Oswald', sans-serif" }}
              >
                Coach Notes
              </SheetTitle>
              <span className="text-xs text-muted-foreground">{playerName}</span>
            </div>
            {onExportPdf && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[10px] font-bold uppercase tracking-wider gap-1.5 cursor-pointer mr-6"
                  >
                    <FileText className="h-3 w-3" />
                    Export PDF
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => onExportPdf(notes, "notes", "preview")}
                    className="cursor-pointer"
                    disabled={notes.length === 0}
                  >
                    <FileText className="h-3.5 w-3.5 mr-2" />
                    <div className="flex flex-col">
                      <span className="text-sm">Preview Coach Notes</span>
                      <span className="text-[10px] text-muted-foreground">Open snapshot stats + notes in new tab</span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => onExportPdf(notes, "full", "preview")}
                    className="cursor-pointer"
                  >
                    <FileText className="h-3.5 w-3.5 mr-2" />
                    <div className="flex flex-col">
                      <span className="text-sm">Preview Full Report</span>
                      <span className="text-[10px] text-muted-foreground">Open full profile + notes in new tab</span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => onExportPdf(notes, "notes", "download")}
                    className="cursor-pointer"
                    disabled={notes.length === 0}
                  >
                    <FileText className="h-3.5 w-3.5 mr-2" />
                    <div className="flex flex-col">
                      <span className="text-sm">Download Coach Notes</span>
                      <span className="text-[10px] text-muted-foreground">Snapshot stats + all notes</span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => onExportPdf(notes, "full", "download")}
                    className="cursor-pointer"
                  >
                    <FileText className="h-3.5 w-3.5 mr-2" />
                    <div className="flex flex-col">
                      <span className="text-sm">Download Full Report</span>
                      <span className="text-[10px] text-muted-foreground">Full profile + notes</span>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </SheetHeader>

        {/* Add note form — always visible at top */}
        <div className="border-b border-border/30 p-4 space-y-2 bg-muted/10">
          <Textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder={`Add a note on ${playerName}…`}
            className="min-h-[100px] text-sm resize-y"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleAdd();
              }
            }}
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground font-mono">⌘ + Enter to save</span>
            <Button
              size="sm"
              className="h-7 text-xs cursor-pointer"
              onClick={handleAdd}
              disabled={!newContent.trim() || isAdding}
            >
              {isAdding ? "Saving…" : "Save Note"}
            </Button>
          </div>
        </div>

        {/* Notes list */}
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading notes…</div>
        ) : notes.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No notes yet. Add one above to start tracking evaluation.
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {notes.map((note) => {
              const isEditing = editingId === note.id;
              const isMine = user?.id === note.user_id;
              return (
                <div
                  key={note.id}
                  className={cn(
                    "p-4 hover:bg-muted/20 transition-colors group",
                    isEditing && "bg-muted/20",
                  )}
                >
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="font-mono tabular-nums">{fmtDate(note.created_at)}</span>
                      {note.updated_at !== note.created_at && (
                        <span className="text-[9px] italic">edited</span>
                      )}
                      {note.tag && (
                        <span className="text-[9px] font-bold uppercase tracking-wider text-[#D4AF37] bg-[#D4AF37]/10 px-1.5 py-px rounded">
                          {note.tag}
                        </span>
                      )}
                    </div>
                    {isMine && !isEditing && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleStartEdit(note)}
                          className="text-muted-foreground/60 hover:text-foreground p-1 rounded cursor-pointer"
                          aria-label="Edit note"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm("Delete this note?")) deleteNote(note.id);
                          }}
                          className="text-muted-foreground/60 hover:text-destructive p-1 rounded cursor-pointer"
                          aria-label="Delete note"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                  {isEditing ? (
                    <div className="space-y-2">
                      <Textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="min-h-[80px] text-sm resize-y"
                        autoFocus
                      />
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs cursor-pointer gap-1"
                          onClick={handleCancelEdit}
                        >
                          <X className="h-3 w-3" />
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          className="h-7 text-xs cursor-pointer gap-1"
                          onClick={handleSaveEdit}
                          disabled={!editContent.trim()}
                        >
                          <Check className="h-3 w-3" />
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                      {note.content}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
