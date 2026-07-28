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
 * Reuses `useGmRecruits` wholesale (no forked plumbing).
 */
import { useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  useGmRecruits, RECRUIT_LEVELS, RECRUIT_STAGES, recruitTypeForPosition,
  recruitEntryClass, type GmRecruit, type NewRecruit, type RecruitType, type RecruitLevel,
} from "@/gm/hooks/useGmRecruits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Plus, CalendarDays, MessageSquarePlus, ChevronRight, Link2 } from "lucide-react";

// --- design tokens (design-system/rstr-iq/MASTER.md) ---
const NAVY_BG = "#040810", NAVY_CARD = "#0a1428", NAVY_BORDER = "#1f2d52";
const GOLD = "#D4AF37", GOLD_DK = "#A08820", SIDEBAR = "#070e1f";
const INK = "#F2F0EA", MUTE = "#9A9890";

const GROUPS: { key: RecruitType; label: string }[] = [
  { key: "hitter", label: "Hitters" },
  { key: "pitcher", label: "Pitchers" },
  { key: "twp", label: "Two-Way" },
];
const HITTER_POS = ["C", "1B", "2B", "3B", "SS", "OF", "LF", "CF", "RF", "DH", "UT"];
const PITCHER_POS = ["SP", "RP", "CL", "LHP", "RHP", "P"];

const STAGE_TONE: Record<string, { bg: string; fg: string }> = {
  muted: { bg: "rgba(154,152,144,0.14)", fg: MUTE },
  blue: { bg: "rgba(59,130,246,0.14)", fg: "#93b8f5" },
  amber: { bg: "rgba(212,175,55,0.10)", fg: "#e0c46b" },
  gold: { bg: "rgba(212,175,55,0.16)", fg: GOLD },
  green: { bg: "rgba(26,107,53,0.30)", fg: "#5fce8b" },
  red: { bg: "rgba(220,68,68,0.16)", fg: "#f0a0a0" },
};
const stageMeta = (v: string) => RECRUIT_STAGES.find((s) => s.value === v) ?? RECRUIT_STAGES[0];
const levelLabel = (v: RecruitLevel) => RECRUIT_LEVELS.find((l) => l.value === v)?.label ?? v;
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

  // Year options = classes that have recruits ∪ the next few upcoming classes.
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
    <div className="min-h-screen w-full" style={{ backgroundColor: NAVY_BG, color: INK }}>
      {/* top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between px-4 py-3"
        style={{ backgroundColor: SIDEBAR, borderBottom: `1px solid ${NAVY_BORDER}` }}>
        <span className="font-[Oswald] text-[15px] font-bold uppercase tracking-[0.18em]" style={{ color: GOLD }}>
          RSTR IQ
        </span>
        <span className="truncate pl-3 text-[12px]" style={{ color: MUTE }}>{teamName}</span>
      </header>

      {/* board label + controls */}
      <div className="px-4 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-[Oswald] text-[13px] font-bold uppercase tracking-[0.22em]" style={{ color: GOLD }}>
            Recruiting
          </span>
          <span className="text-[10px] uppercase tracking-[0.15em]" style={{ color: MUTE }}>Team-shared</span>
        </div>

        <div className="flex items-center gap-2">
          <Select value={String(activeYear)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="h-9 w-[104px] border-0 font-[Oswald] uppercase tracking-wide"
              style={{ backgroundColor: NAVY_CARD, color: INK }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent style={{ backgroundColor: NAVY_CARD, color: INK, borderColor: NAVY_BORDER }}>
              {yearOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>Class {y}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* position group toggle (replaces desktop 3 columns) */}
          <div className="flex flex-1 overflow-hidden rounded-md" style={{ border: `1px solid ${NAVY_BORDER}` }}>
            {GROUPS.map((g) => {
              const on = group === g.key;
              return (
                <button key={g.key} onClick={() => setGroup(g.key)}
                  className="flex-1 cursor-pointer py-2 font-[Oswald] text-[12px] font-semibold uppercase tracking-wide transition-colors duration-150"
                  style={{ backgroundColor: on ? GOLD : "transparent", color: on ? SIDEBAR : MUTE }}>
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
          <p className="pt-10 text-center text-[13px]" style={{ color: MUTE }}>Loading recruits…</p>
        ) : !effectiveTeamId ? (
          <p className="pt-10 text-center text-[13px]" style={{ color: MUTE }}>No team in scope — pick a team first.</p>
        ) : list.length === 0 ? (
          <p className="pt-10 text-center text-[13px]" style={{ color: MUTE }}>
            No {GROUPS.find((g) => g.key === group)?.label.toLowerCase()} in the Class of {activeYear} yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {list.map((r) => {
              const evs = eventsByRecruit.get(r.id) ?? [];
              const s = stageMeta(r.stage);
              const tone = STAGE_TONE[s.tone] ?? STAGE_TONE.muted;
              return (
                <li key={r.id}>
                  <button onClick={() => setTimeline(r)}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-3 text-left transition-colors duration-150"
                    style={{ backgroundColor: NAVY_CARD, border: `1px solid ${NAVY_BORDER}` }}>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-[Oswald] text-[13px] font-bold"
                      style={{ backgroundColor: GOLD_DK, color: SIDEBAR }}>{initials(r)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-[Oswald] text-[15px] font-semibold" style={{ color: INK }}>
                        {`${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "Unnamed"}
                      </span>
                      <span className="block truncate text-[12px]" style={{ color: MUTE }}>
                        {[r.position, r.high_school, levelLabel(r.level)].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                        style={{ backgroundColor: tone.bg, color: tone.fg }}>{s.label}</span>
                      <span className="text-[10px]" style={{ color: MUTE }}>
                        {evs.length ? `${evs.length} note${evs.length > 1 ? "s" : ""} · ${fmtDate(evs[0].event_date)}` : "no notes"}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0" style={{ color: MUTE }} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      {/* add FAB */}
      <button onClick={() => setAddOpen(true)}
        className="fixed bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full px-6 py-3 font-[Oswald] text-[14px] font-bold uppercase tracking-wide shadow-lg transition-colors duration-150"
        style={{ backgroundColor: GOLD, color: SIDEBAR }}>
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
  const posOptions = position === "TWP" ? [...HITTER_POS, ...PITCHER_POS, "TWP"]
    : [...HITTER_POS, ...PITCHER_POS, "TWP"];

  return (
    <Sheet open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto border-0"
        style={{ backgroundColor: NAVY_CARD, color: INK }}>
        <SheetHeader>
          <SheetTitle className="font-[Oswald] uppercase tracking-[0.15em]" style={{ color: GOLD }}>Add Recruit</SheetTitle>
        </SheetHeader>
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex gap-2">
            <Field label="First"><Input value={first} onChange={(e) => setFirst(e.target.value)} className="border-0" style={{ backgroundColor: NAVY_BG, color: INK }} /></Field>
            <Field label="Last"><Input value={last} onChange={(e) => setLast(e.target.value)} className="border-0" style={{ backgroundColor: NAVY_BG, color: INK }} /></Field>
          </div>
          <div className="flex gap-2">
            <Field label="Position">
              <Select value={position} onValueChange={setPosition}>
                <SelectTrigger className="border-0" style={{ backgroundColor: NAVY_BG, color: INK }}><SelectValue placeholder="Pos" /></SelectTrigger>
                <SelectContent style={{ backgroundColor: NAVY_CARD, color: INK }}>
                  {posOptions.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Level">
              <Select value={level} onValueChange={(v) => setLevel(v as RecruitLevel)}>
                <SelectTrigger className="border-0" style={{ backgroundColor: NAVY_BG, color: INK }}><SelectValue /></SelectTrigger>
                <SelectContent style={{ backgroundColor: NAVY_CARD, color: INK }}>
                  {RECRUIT_LEVELS.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="High School / Team"><Input value={hs} onChange={(e) => setHs(e.target.value)} className="border-0" style={{ backgroundColor: NAVY_BG, color: INK }} /></Field>
          <Field label="PBR / PG profile link" hint="optional">
            <div className="flex items-center gap-2 rounded-md px-2" style={{ backgroundColor: NAVY_BG }}>
              <Link2 className="h-4 w-4 shrink-0" style={{ color: MUTE }} />
              <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" className="border-0 bg-transparent px-0" style={{ color: INK }} />
            </div>
          </Field>
          <p className="text-[11px]" style={{ color: MUTE }}>
            Enters D1 as <b style={{ color: INK }}>{recruitEntryClass(level)}</b> · Class of {defaultYear} · stage starts Evaluating. Add contact notes after saving.
          </p>
          <Button onClick={save} disabled={!canSave}
            className="mt-1 h-11 w-full font-[Oswald] font-bold uppercase tracking-wide disabled:opacity-40"
            style={{ backgroundColor: GOLD, color: SIDEBAR }}>Add to Recruiting Board</Button>
        </div>
      </SheetContent>
    </Sheet>
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
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto border-0" style={{ backgroundColor: NAVY_CARD, color: INK }}>
        <SheetHeader>
          <SheetTitle className="font-[Oswald] uppercase tracking-[0.12em]" style={{ color: INK }}>
            {recruit ? `${recruit.first_name ?? ""} ${recruit.last_name ?? ""}`.trim() : ""}
          </SheetTitle>
          {recruit && (
            <p className="text-[12px]" style={{ color: MUTE }}>
              {[recruit.position, recruit.high_school, levelLabel(recruit.level)].filter(Boolean).join(" · ")}
            </p>
          )}
        </SheetHeader>

        {/* add note composer */}
        <div className="mt-3 rounded-md p-3" style={{ backgroundColor: NAVY_BG }}>
          <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.15em]" style={{ color: GOLD }}>
            <MessageSquarePlus className="h-4 w-4" /> Log contact / note
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-md px-2 py-1.5" style={{ backgroundColor: NAVY_CARD }}>
              <CalendarDays className="h-4 w-4 shrink-0" style={{ color: MUTE }} />
              <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)}
                className="bg-transparent text-[13px] outline-none" style={{ color: INK, colorScheme: "dark" }} />
            </div>
          </div>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
            placeholder="Called his coach, strong interest…" className="mt-2 border-0"
            style={{ backgroundColor: NAVY_CARD, color: INK }} />
          <Button onClick={submit} disabled={!note.trim()}
            className="mt-2 h-9 w-full font-[Oswald] font-semibold uppercase tracking-wide disabled:opacity-40"
            style={{ backgroundColor: GOLD, color: SIDEBAR }}>Add to Timeline</Button>
        </div>

        {/* dated timeline, newest first */}
        <div className="mt-4">
          <div className="mb-2 font-[Oswald] text-[11px] uppercase tracking-[0.18em]" style={{ color: MUTE }}>Timeline</div>
          {events.length === 0 ? (
            <p className="py-4 text-center text-[12px]" style={{ color: MUTE }}>No contact logged yet.</p>
          ) : (
            <ul className="flex flex-col gap-2 pb-6">
              {events.map((e) => (
                <li key={e.id} className="flex gap-3 rounded-md px-3 py-2" style={{ backgroundColor: NAVY_BG }}>
                  <span className="w-14 shrink-0 font-[Oswald] text-[12px] font-semibold" style={{ color: GOLD }}>{fmtDate(e.event_date)}</span>
                  <span className="text-[13px] leading-snug" style={{ color: INK }}>{e.note}</span>
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
    <label className="flex flex-1 flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.15em]" style={{ color: MUTE }}>
        {label}{hint ? <span className="ml-1 lowercase tracking-normal opacity-70">({hint})</span> : null}
      </span>
      {children}
    </label>
  );
}
