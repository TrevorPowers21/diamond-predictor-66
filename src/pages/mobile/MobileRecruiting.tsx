/**
 * Mobile Recruiting Board — a phone-first, condensed view of the GM recruiting
 * board (`gm_recruits`) for freshman/HS + JUCO recruits, built for a coach to
 * use from the car: pick a class YEAR + a POSITION group (toggle, not the
 * desktop 3-column layout — "it just needs to fit"), scan recruits by name,
 * add a new recruit, and — the point — drop DATED timeline notes ("contact
 * made", etc.) against a recruit for compliance. Timeline = `gm_recruit_events`
 * (event_date + note), the same log the desktop board uses.
 *
 * Portal / target board is a SEPARATE surface — not here (Trevor, 2026-07-28).
 * Styled with the app's SEMANTIC THEME TOKENS (bg-background/bg-card/border-border/
 * text-muted-foreground) + the real /rstr-iq-logo.png, so it matches the website
 * exactly rather than approximating with raw hex. Reuses `useGmRecruits` wholesale.
 */
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import {
  useGmRecruits, RECRUIT_LEVELS, RECRUIT_STAGES, recruitTypeForPosition,
  type GmRecruit, type NewRecruit, type RecruitType, type RecruitLevel,
} from "@/gm/hooks/useGmRecruits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, CalendarDays, MessageSquarePlus, ChevronRight } from "lucide-react";

const OSWALD = { fontFamily: "'Oswald', sans-serif" } as const;
const GOLD = "#D4AF37";
const SIDEBAR = "#070e1f"; // app sidebar/header navy (matches GMLayout)

const GROUPS: { key: RecruitType; label: string }[] = [
  { key: "hitter", label: "Hitters" },
  { key: "pitcher", label: "Pitchers" },
  { key: "twp", label: "Two-Way" },
];
const POS_OPTIONS = ["C", "1B", "2B", "3B", "SS", "OF", "LF", "CF", "RF", "DH", "UT", "SP", "RP", "CL", "LHP", "RHP", "P", "TWP"];

// Mirror of GMRecruits.toneClass so stage badges look identical to the desktop board.
function toneClass(tone: string): string {
  switch (tone) {
    case "blue": return "bg-blue-500/15 text-blue-400";
    case "amber": return "bg-amber-500/15 text-amber-500";
    case "gold": return "bg-[#D4AF37]/15 text-[#D4AF37]";
    case "green": return "bg-emerald-500/15 text-emerald-500";
    case "red": return "bg-red-500/15 text-red-400";
    default: return "bg-muted text-muted-foreground";
  }
}
const stageMeta = (v: string) => RECRUIT_STAGES.find((s) => s.value === v) ?? RECRUIT_STAGES[0];
const levelLabel = (v: RecruitLevel) => RECRUIT_LEVELS.find((l) => l.value === v)?.label ?? v;
const isJuco = (v: RecruitLevel) => v === "juco_fr" || v === "juco_so";
const initials = (r: GmRecruit) => `${(r.first_name || "?")[0] ?? ""}${(r.last_name || "")[0] ?? ""}`.toUpperCase();
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d?: string | null) => {
  if (!d) return "";
  const dt = new Date(d + "T00:00:00");
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export default function MobileRecruiting() {
  const { effectiveTeamId, availableTeams } = useAuth();
  const { recruits, years, isLoading, addRecruit, eventsByRecruit, addEvent } = useGmRecruits();
  const teamName = availableTeams.find((t) => t.id === effectiveTeamId)?.name ?? "Your Team";

  const yearOptions = useMemo(() => {
    const base = new Date().getFullYear() + 1;
    const set = new Set<number>(years);
    for (let y = base; y < base + 4; y++) set.add(y);
    return [...set].sort((a, b) => a - b);
  }, [years]);
  const [year, setYear] = useState<number | null>(null);
  const activeYear = year ?? (years.length ? years[years.length - 1] : yearOptions[0]);
  const [group, setGroup] = useState<RecruitType>("hitter");

  const list = useMemo(
    () => recruits
      .filter((r) => r.class_year === activeYear && recruitTypeForPosition(r.position || "") === group)
      .sort((a, b) => a.sort_order - b.sort_order),
    [recruits, activeYear, group],
  );

  const [addOpen, setAddOpen] = useState(false);
  const [timeline, setTimeline] = useState<GmRecruit | null>(null);

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      {/* top bar — real logo, sidebar navy */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border/60 px-4 py-2.5"
        style={{ backgroundColor: SIDEBAR }}>
        <img src="/rstr-iq-logo.png" alt="RSTR IQ" className="h-8 w-auto" />
        <span className="truncate pl-3 text-[12px] text-muted-foreground">{teamName}</span>
      </header>

      {/* board label + controls */}
      <div className="px-4 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[13px] font-bold uppercase tracking-[0.18em] text-[#D4AF37]" style={OSWALD}>Recruiting</span>
          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Team-shared</span>
        </div>

        <div className="flex items-center gap-2">
          <Select value={String(activeYear)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="h-9 w-[92px] bg-card border-border/60 font-bold uppercase tracking-wide" style={OSWALD}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>

          {/* position-group toggle (replaces desktop 3 columns) */}
          <div className="flex flex-1 overflow-hidden rounded-md border border-border/60">
            {GROUPS.map((g) => {
              const on = group === g.key;
              return (
                <button key={g.key} onClick={() => setGroup(g.key)}
                  className={cn(
                    "flex-1 cursor-pointer py-2 text-[12px] font-semibold uppercase tracking-wide transition-colors duration-150",
                    on ? "bg-[#D4AF37]/15 text-[#D4AF37]" : "text-muted-foreground hover:bg-muted/60",
                  )}
                  style={OSWALD}>
                  {g.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* list */}
      <main className="px-4 pb-28 pt-3">
        {isLoading ? (
          <p className="pt-10 text-center text-[13px] text-muted-foreground">Loading recruits…</p>
        ) : !effectiveTeamId ? (
          <p className="pt-10 text-center text-[13px] text-muted-foreground">No team in scope — pick a team first.</p>
        ) : list.length === 0 ? (
          <p className="pt-10 text-center text-[13px] text-muted-foreground">
            No {GROUPS.find((g) => g.key === group)?.label.toLowerCase()} in the {activeYear} class yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {list.map((r) => {
              const evs = eventsByRecruit.get(r.id) ?? [];
              const s = stageMeta(r.stage);
              return (
                <li key={r.id}>
                  <button onClick={() => setTimeline(r)}
                    className="flex w-full items-center gap-3 rounded-md border border-border/60 bg-card/40 px-3 py-3 text-left transition-colors duration-150 hover:border-[#D4AF37]/40">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#D4AF37]/10 text-[13px] font-bold text-[#D4AF37] ring-1 ring-[#D4AF37]/20" style={OSWALD}>{initials(r)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-foreground" style={OSWALD}>
                        {`${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "Unnamed"}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 truncate text-[12px] text-muted-foreground">
                        {r.position && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold">{r.position}</span>}
                        {isJuco(r.level) && <span className="shrink-0 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-400">{levelLabel(r.level)}</span>}
                        <span className="truncate">{r.high_school || (isJuco(r.level) ? "" : "High School")}</span>
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider", toneClass(s.tone))} style={OSWALD}>{s.label}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {evs.length ? `${evs.length} note${evs.length > 1 ? "s" : ""} · ${fmtDate(evs[0].event_date)}` : "no notes"}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      {/* add FAB */}
      <button onClick={() => setAddOpen(true)}
        className="fixed bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full px-6 py-3 text-[14px] font-bold uppercase tracking-wide shadow-lg transition-opacity duration-150 hover:opacity-90"
        style={{ ...OSWALD, backgroundColor: GOLD, color: SIDEBAR }}>
        <Plus className="h-4 w-4" /> Add Recruit
      </button>

      <AddRecruitSheet open={addOpen} onOpenChange={setAddOpen} defaultYear={activeYear}
        onAdd={(r) => { addRecruit(r); setAddOpen(false); }} />
      <TimelineSheet recruit={timeline} onOpenChange={(o) => !o && setTimeline(null)}
        events={timeline ? eventsByRecruit.get(timeline.id) ?? [] : []}
        onAddNote={(date, note) => { if (timeline) addEvent(timeline.id, date, note); }} />
    </div>
  );
}

// ---------- Add Recruit (condensed) ----------
function AddRecruitSheet({ open, onOpenChange, defaultYear, onAdd }: {
  open: boolean; onOpenChange: (o: boolean) => void; defaultYear: number; onAdd: (r: NewRecruit) => void;
}) {
  const [first, setFirst] = useState(""); const [last, setLast] = useState("");
  const [position, setPosition] = useState(""); const [hs, setHs] = useState("");
  const [level, setLevel] = useState<RecruitLevel>("hs"); const [link, setLink] = useState("");
  const canSave = first.trim() && last.trim() && position;

  const reset = () => { setFirst(""); setLast(""); setPosition(""); setHs(""); setLevel("hs"); setLink(""); };
  const save = () => {
    const r: NewRecruit = {
      class_year: defaultYear, player_type: recruitTypeForPosition(position),
      first_name: first.trim(), last_name: last.trim(), high_school: hs.trim() || null,
      state: null, travel_org: null, position, notes: null, scouting_report_date: null,
      projection_tier: null, asking_price: null, target_offer: null, scholarship_pct: null,
      level, link: link.trim() || null, stage: "evaluating",
      phone: null, email: null, guardian_name: null, guardian_phone: null,
      coach_name: null, coach_phone: null, extra_contacts: null,
    };
    onAdd(r); reset();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-md max-h-[88vh] overflow-y-auto">
        <DialogHeader><DialogTitle style={OSWALD}>Add Recruit</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First Name"><Input value={first} onChange={(e) => setFirst(e.target.value)} className="h-9 text-sm" /></Field>
            <Field label="Last Name"><Input value={last} onChange={(e) => setLast(e.target.value)} className="h-9 text-sm" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Position">
              <Select value={position} onValueChange={setPosition}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{POS_OPTIONS.map((p) => <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Level">
              <Select value={level} onValueChange={(v) => setLevel(v as RecruitLevel)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{RECRUIT_LEVELS.map((l) => <SelectItem key={l.value} value={l.value} className="text-xs">{l.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="High School / Team"><Input value={hs} onChange={(e) => setHs(e.target.value)} className="h-9 text-sm" /></Field>
          <Field label="PBR / PG Profile Link" hint="optional">
            <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" className="h-9 text-sm" />
          </Field>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={!canSave} style={OSWALD} className="uppercase tracking-wide">Add to Recruiting Board</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Timeline (dated contact/notes log — compliance) ----------
function TimelineSheet({ recruit, onOpenChange, events, onAddNote }: {
  recruit: GmRecruit | null; onOpenChange: (o: boolean) => void;
  events: { id: string; event_date: string; note: string | null }[];
  onAddNote: (date: string, note: string) => void;
}) {
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const submit = () => { if (note.trim()) { onAddNote(date, note.trim()); setNote(""); setDate(today()); } };

  return (
    <Sheet open={!!recruit} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto bg-background">
        <SheetHeader>
          <SheetTitle className="uppercase tracking-[0.12em] text-foreground" style={OSWALD}>
            {recruit ? `${recruit.first_name ?? ""} ${recruit.last_name ?? ""}`.trim() : ""}
          </SheetTitle>
          {recruit && (
            <p className="text-[12px] text-muted-foreground">
              {[recruit.position, recruit.high_school, levelLabel(recruit.level)].filter(Boolean).join(" · ")}
            </p>
          )}
        </SheetHeader>

        {/* add note composer */}
        <div className="mt-3 rounded-md border border-border/60 bg-card/40 p-3">
          <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.15em] text-[#D4AF37]">
            <MessageSquarePlus className="h-4 w-4" /> Log contact / note
          </div>
          <div className="flex items-center gap-1.5 rounded-md border border-input bg-card px-2 py-1.5 w-fit">
            <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)}
              className="bg-transparent text-[13px] text-foreground outline-none" style={{ colorScheme: "dark" }} />
          </div>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
            placeholder="Called his coach, strong interest…" className="mt-2 bg-card" />
          <Button onClick={submit} disabled={!note.trim()}
            className="mt-2 h-9 w-full font-semibold uppercase tracking-wide disabled:opacity-40"
            style={{ ...OSWALD, backgroundColor: GOLD, color: SIDEBAR }}>Add to Timeline</Button>
        </div>

        {/* dated timeline, newest first */}
        <div className="mt-4">
          <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground" style={OSWALD}>Timeline</div>
          {events.length === 0 ? (
            <p className="py-4 text-center text-[12px] text-muted-foreground">No contact logged yet.</p>
          ) : (
            <ul className="flex flex-col gap-2 pb-6">
              {events.map((e) => (
                <li key={e.id} className="flex gap-3 border-l-2 border-[#D4AF37]/40 pl-3">
                  <span className="w-14 shrink-0 text-[12px] font-semibold text-[#D4AF37]" style={OSWALD}>{fmtDate(e.event_date)}</span>
                  <span className="text-[13px] leading-snug text-foreground">{e.note}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground" style={OSWALD}>
        {label}{hint ? <span className="ml-1 lowercase tracking-normal opacity-70">({hint})</span> : null}
      </span>
      {children}
    </label>
  );
}
