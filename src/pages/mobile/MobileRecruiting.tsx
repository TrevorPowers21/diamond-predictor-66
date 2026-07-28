/**
 * Mobile Recruiting Board — a phone-first, condensed view of the GM recruiting
 * board (`gm_recruits`) for freshman/HS + JUCO recruits, built for a coach on
 * the road: pick a class YEAR + a POSITION group (Hitters/Pitchers/Two-Way
 * toggle), scan recruits by name, add a recruit, and — the MAIN purpose —
 * consolidate **dated scouting reports** (`gm_recruit_reports`) plus a **dated
 * contact timeline** (`gm_recruit_events`) on a player. Both are the same logs
 * the desktop board uses. Portal / target board is a SEPARATE surface — not here.
 *
 * Add-recruit POSITION is captured as the desktop board's GROUPS (Catcher /
 * Corner IF / Middle IF / OF / Pitcher / TWP — exact spot isn't needed); a
 * representative position is stored so the desktop board groups it with zero
 * changes. The board's own 3-way toggle is unchanged.
 *
 * Styled with the app's semantic theme tokens + the real /rstr-iq-logo.png so it
 * matches the website. Reuses `useGmRecruits` wholesale.
 */
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import {
  useGmRecruits, RECRUIT_LEVELS, RECRUIT_STAGES, RECRUIT_TIERS, recruitTypeForPosition,
  type GmRecruit, type NewRecruit, type RecruitType, type RecruitLevel, type RecruitTier,
} from "@/gm/hooks/useGmRecruits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, CalendarDays, ClipboardList, MessageSquarePlus, ChevronRight } from "lucide-react";

const OSWALD = { fontFamily: "'Oswald', sans-serif" } as const;
const GOLD = "#D4AF37";
const SIDEBAR = "#070e1f";

// Board toggle — the 3-way grouping (unchanged from the original main design).
const GROUPS: { key: RecruitType; label: string }[] = [
  { key: "hitter", label: "Hitters" },
  { key: "pitcher", label: "Pitchers" },
  { key: "twp", label: "Two-Way" },
];

// Add-recruit POSITION groups (Trevor: match the desktop board, exact spot not
// needed). Mirrors GMRecruits POSITION_GROUPS but collapses RHP/LHP into one
// "Pitcher". `addPos` = the representative position stored so the desktop board
// groups the recruit correctly with no desktop changes.
const POS_GROUPS = [
  { key: "c", label: "Catcher", addPos: "C" },
  { key: "cif", label: "Corner Infield", addPos: "1B" },
  { key: "mif", label: "Middle Infield", addPos: "SS" },
  { key: "of", label: "OF", addPos: "OF" },
  { key: "p", label: "Pitcher", addPos: "P" },
  { key: "twp", label: "TWP", addPos: "TWP" },
] as const;
type GroupKey = (typeof POS_GROUPS)[number]["key"];

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
const tierMeta = (v?: string | null) => RECRUIT_TIERS.find((t) => t.value === v);
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
  const { recruits, years, isLoading, addRecruit, eventsByRecruit, addEvent, reportsByRecruit, addReport } = useGmRecruits();
  const teamName = availableTeams.find((t) => t.id === effectiveTeamId)?.name ?? "Your Team";

  const yearOptions = useMemo(() => {
    const base = new Date().getFullYear() + 1;
    const set = new Set<number>(years);
    for (let y = base; y < base + 4; y++) set.add(y);
    return [...set].sort((a, b) => a - b);
  }, [years]);
  const [year, setYear] = useState<number | null>(null);
  const activeYear = year ?? (years.length ? years[0] : yearOptions[0]);
  const [group, setGroup] = useState<RecruitType>("hitter");

  const list = useMemo(
    () => recruits
      .filter((r) => r.class_year === activeYear && recruitTypeForPosition(r.position || "") === group)
      .sort((a, b) => a.sort_order - b.sort_order),
    [recruits, activeYear, group],
  );

  const [addOpen, setAddOpen] = useState(false);
  const [openRecruit, setOpenRecruit] = useState<GmRecruit | null>(null);

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border/60 px-4 py-2.5" style={{ backgroundColor: SIDEBAR }}>
        <img src="/rstr-iq-logo.png" alt="RSTR IQ" className="h-8 w-auto" />
        <span className="truncate pl-3 text-[12px] text-muted-foreground">{teamName}</span>
      </header>

      <div className="px-4 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[13px] font-bold uppercase tracking-[0.18em] text-[#D4AF37]" style={OSWALD}>Recruiting</span>
          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Team-shared</span>
        </div>

        <div className="flex items-center gap-2">
          <Select value={String(activeYear)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="h-9 w-[92px] bg-card border-border/60 font-bold uppercase tracking-wide" style={OSWALD}><SelectValue /></SelectTrigger>
            <SelectContent>{yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>

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
              const reps = reportsByRecruit.get(r.id) ?? [];
              const s = stageMeta(r.stage);
              return (
                <li key={r.id}>
                  <button onClick={() => setOpenRecruit(r)}
                    className="flex w-full items-center gap-3 rounded-md border border-border/60 bg-card/40 px-3 py-3 text-left transition-colors duration-150 hover:border-[#D4AF37]/40">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#D4AF37]/10 text-[13px] font-bold text-[#D4AF37] ring-1 ring-[#D4AF37]/20" style={OSWALD}>{initials(r)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-foreground" style={OSWALD}>
                        {`${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "Unnamed"}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 truncate text-[12px] text-muted-foreground">
                        {r.position && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold">{r.position}</span>}
                        {isJuco(r.level) && <span className="shrink-0 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-400">{levelLabel(r.level)}</span>}
                        <span className="truncate">{r.high_school || ""}</span>
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider", toneClass(s.tone))} style={OSWALD}>{s.label}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {reps.length ? `${reps.length} report${reps.length > 1 ? "s" : ""}` : (evs.length ? `${evs.length} note${evs.length > 1 ? "s" : ""}` : "no reports")}
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

      <button onClick={() => setAddOpen(true)}
        className="fixed bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full px-6 py-3 text-[14px] font-bold uppercase tracking-wide shadow-lg transition-opacity duration-150 hover:opacity-90"
        style={{ ...OSWALD, backgroundColor: GOLD, color: SIDEBAR }}>
        <Plus className="h-4 w-4" /> Add Recruit
      </button>

      <AddRecruitDialog open={addOpen} onOpenChange={setAddOpen} defaultYear={activeYear}
        onAdd={(r, rpt) => { addRecruit(r, rpt); setAddOpen(false); }} />
      <RecruitSheet
        recruit={openRecruit} onOpenChange={(o) => !o && setOpenRecruit(null)}
        reports={openRecruit ? reportsByRecruit.get(openRecruit.id) ?? [] : []}
        events={openRecruit ? eventsByRecruit.get(openRecruit.id) ?? [] : []}
        onAddReport={(date, body, tier) => { if (openRecruit) addReport(openRecruit.id, date, body, tier); }}
        onAddEvent={(date, note) => { if (openRecruit) addEvent(openRecruit.id, date, note); }}
      />
    </div>
  );
}

// ---------- Add Recruit (matches the desktop board's Dialog; position = groups) ----------
function AddRecruitDialog({ open, onOpenChange, defaultYear, onAdd }: {
  open: boolean; onOpenChange: (o: boolean) => void; defaultYear: number;
  onAdd: (r: NewRecruit, initialReport?: { report_date: string; body: string; tier?: RecruitTier | null }) => void;
}) {
  const [first, setFirst] = useState(""); const [last, setLast] = useState("");
  const [groupKey, setGroupKey] = useState<GroupKey>("c"); const [hs, setHs] = useState("");
  const [level, setLevel] = useState<RecruitLevel>("hs"); const [link, setLink] = useState("");
  const [rptDate, setRptDate] = useState(today()); const [rptTier, setRptTier] = useState(""); const [rptBody, setRptBody] = useState("");
  const canSave = first.trim() && last.trim();

  const reset = () => { setFirst(""); setLast(""); setGroupKey("c"); setHs(""); setLevel("hs"); setLink(""); setRptDate(today()); setRptTier(""); setRptBody(""); };
  const save = () => {
    const grp = POS_GROUPS.find((g) => g.key === groupKey)!;
    const r: NewRecruit = {
      class_year: defaultYear, player_type: recruitTypeForPosition(grp.addPos),
      first_name: first.trim(), last_name: last.trim(), high_school: hs.trim() || null,
      state: null, travel_org: null, position: grp.addPos, notes: null, scouting_report_date: null,
      projection_tier: null, asking_price: null, target_offer: null, scholarship_pct: null,
      level, link: link.trim() || null, stage: "evaluating",
      phone: null, email: null, guardian_name: null, guardian_phone: null,
      coach_name: null, coach_phone: null, extra_contacts: null,
    };
    const initialReport = rptBody.trim() ? { report_date: rptDate, body: rptBody.trim(), tier: (rptTier || null) as RecruitTier | null } : undefined;
    onAdd(r, initialReport); reset();
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
              <Select value={groupKey} onValueChange={(v) => setGroupKey(v as GroupKey)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{POS_GROUPS.map((g) => <SelectItem key={g.key} value={g.key} className="text-xs">{g.label}</SelectItem>)}</SelectContent>
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
          <Field label="PBR / PG Profile Link" hint="optional"><Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" className="h-9 text-sm" /></Field>

          {/* Optional first scouting report — consolidate notes at add time */}
          <div className="mt-1 border-t border-border/60 pt-3">
            <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.15em] text-[#D4AF37]" style={OSWALD}>
              <ClipboardList className="h-4 w-4" /> Scouting Report <span className="lowercase tracking-normal opacity-70">(optional)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-md border border-input bg-card px-2 py-1.5">
                <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input type="date" value={rptDate} max={today()} onChange={(e) => setRptDate(e.target.value)} className="bg-transparent text-[13px] text-foreground outline-none" style={{ colorScheme: "dark" }} />
              </div>
              <Select value={rptTier} onValueChange={setRptTier}>
                <SelectTrigger className="h-9 flex-1 text-sm"><SelectValue placeholder="Grade (optional)" /></SelectTrigger>
                <SelectContent>{RECRUIT_TIERS.map((t) => <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Textarea value={rptBody} onChange={(e) => setRptBody(e.target.value)} rows={4} placeholder="Consolidate your notes now, or leave blank and add later…" className="mt-2 bg-card" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={!canSave} style={OSWALD} className="uppercase tracking-wide">Add to Recruiting Board</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Recruit detail: condensed reports + contact timeline; add via popups ----------
function RecruitSheet({ recruit, onOpenChange, reports, events, onAddReport, onAddEvent }: {
  recruit: GmRecruit | null; onOpenChange: (o: boolean) => void;
  reports: { id: string; report_date: string; body: string | null; projection_tier: RecruitTier | null; author: string | null }[];
  events: { id: string; event_date: string; note: string | null }[];
  onAddReport: (date: string, body: string, tier?: RecruitTier | null) => void;
  onAddEvent: (date: string, note: string) => void;
}) {
  const [reportOpen, setReportOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [expR, setExpR] = useState<Set<string>>(new Set());
  const [expE, setExpE] = useState<Set<string>>(new Set());
  const toggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) => (id: string) =>
    setter((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <>
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

          {/* SCOUTING REPORTS */}
          <section className="mt-4">
            <SectionHead icon={<ClipboardList className="h-4 w-4" />} title="Scouting Reports" count={reports.length}
              accent onAdd={() => setReportOpen(true)} />
            {reports.length === 0 ? (
              <p className="py-3 text-center text-[12px] text-muted-foreground">No reports yet — tap Add.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1.5">
                {reports.map((r) => {
                  const tm = tierMeta(r.projection_tier); const open = expR.has(r.id);
                  return (
                    <li key={r.id}>
                      <button onClick={() => toggle(setExpR)(r.id)} className="w-full rounded-md border-l-2 border-[#D4AF37]/40 bg-card/40 px-3 py-2 text-left">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-semibold text-[#D4AF37]" style={OSWALD}>{fmtDate(r.report_date)}</span>
                          {tm && <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider", toneClass(tm.tone))} style={OSWALD}>{tm.label}</span>}
                          <span className="ml-auto text-[10px] text-muted-foreground">{open ? "collapse" : "read"}</span>
                        </div>
                        <p className={cn("mt-0.5 text-[13px] leading-snug text-foreground", !open && "line-clamp-1")}>{r.body}</p>
                        {open && r.author && <p className="mt-1 text-[10px] text-muted-foreground">— {r.author}</p>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* CONTACT TIMELINE */}
          <section className="mt-5 mb-6">
            <SectionHead icon={<MessageSquarePlus className="h-4 w-4" />} title="Contact Timeline" count={events.length}
              onAdd={() => setContactOpen(true)} />
            {events.length === 0 ? (
              <p className="py-3 text-center text-[12px] text-muted-foreground">No contact logged — tap Add.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1.5">
                {events.map((e) => {
                  const open = expE.has(e.id);
                  return (
                    <li key={e.id}>
                      <button onClick={() => toggle(setExpE)(e.id)} className="flex w-full gap-3 border-l-2 border-border pl-3 text-left">
                        <span className="w-14 shrink-0 py-0.5 text-[12px] font-semibold text-muted-foreground" style={OSWALD}>{fmtDate(e.event_date)}</span>
                        <span className={cn("py-0.5 text-[13px] leading-snug text-foreground", !open && "line-clamp-1")}>{e.note}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </SheetContent>
      </Sheet>

      {/* composer popups */}
      <EntryComposer open={reportOpen} onOpenChange={setReportOpen} title="New Scouting Report" withTier
        rows={7} placeholder="Full write-up — mechanics, tools, makeup, projection…"
        onSave={(date, body, tier) => onAddReport(date, body, (tier || null) as RecruitTier | null)} />
      <EntryComposer open={contactOpen} onOpenChange={setContactOpen} title="Log Contact"
        rows={5} placeholder="Who you talked to and what was said — keep it detailed for compliance…"
        onSave={(date, body) => onAddEvent(date, body)} />
    </>
  );
}

function SectionHead({ icon, title, count, accent, onAdd }: { icon: React.ReactNode; title: string; count: number; accent?: boolean; onAdd: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <div className={cn("flex items-center gap-2 text-[11px] uppercase tracking-[0.15em]", accent ? "text-[#D4AF37]" : "text-muted-foreground")} style={OSWALD}>
        {icon} {title}{count ? <span className="opacity-70">({count})</span> : null}
      </div>
      <button onClick={onAdd} className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-[#D4AF37]" style={OSWALD}>
        <Plus className="h-3.5 w-3.5" /> Add
      </button>
    </div>
  );
}

// A popup composer: date + (optional tier) + a roomy textarea, so a coach can
// write something detailed and review the whole excerpt before saving.
function EntryComposer({ open, onOpenChange, title, withTier, rows, placeholder, onSave }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; withTier?: boolean; rows: number; placeholder: string;
  onSave: (date: string, body: string, tier?: string) => void;
}) {
  const [date, setDate] = useState(today()); const [body, setBody] = useState(""); const [tier, setTier] = useState("");
  const reset = () => { setDate(today()); setBody(""); setTier(""); };
  const save = () => { if (body.trim()) { onSave(date, body.trim(), tier || undefined); reset(); onOpenChange(false); } };
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-md max-h-[88vh] overflow-y-auto">
        <DialogHeader><DialogTitle style={OSWALD}>{title}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-md border border-input bg-card px-2 py-1.5">
              <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} className="bg-transparent text-[13px] text-foreground outline-none" style={{ colorScheme: "dark" }} />
            </div>
            {withTier && (
              <Select value={tier} onValueChange={setTier}>
                <SelectTrigger className="h-9 flex-1 text-sm"><SelectValue placeholder="Grade (optional)" /></SelectTrigger>
                <SelectContent>{RECRUIT_TIERS.map((t) => <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </div>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={rows} placeholder={placeholder} className="bg-card" autoFocus />
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={!body.trim()} style={OSWALD} className="uppercase tracking-wide">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
