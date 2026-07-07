import { useState } from "react";
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useGmRecruits, recruitTypeForPosition, RECRUIT_STAGES, RECRUIT_TIERS, type GmRecruit, type GmRecruitReport, type RecruitStage, type RecruitTier, type RecruitType } from "@/gm/hooks/useGmRecruits";
import { PROJECTION_SEASON } from "@/lib/seasonConstants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, GripVertical, ExternalLink, X, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

const OSWALD = { fontFamily: "'Oswald', sans-serif" } as const;
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const POSITIONS = ["C", "1B", "2B", "SS", "3B", "LF", "CF", "RF", "DH", "TWP", "RHP", "LHP"] as const;
const YEARS = [PROJECTION_SEASON, PROJECTION_SEASON + 1, PROJECTION_SEASON + 2, PROJECTION_SEASON + 3];
const SECTIONS: { type: RecruitType; title: string }[] = [
  { type: "hitter", title: "Position Players" },
  { type: "pitcher", title: "Pitchers" },
  { type: "twp", title: "Two-Way" },
];

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

/** Stage badge that's also the editor — coaches advance the funnel here. */
function StageSelect({ value, onChange }: { value: RecruitStage; onChange: (s: RecruitStage) => void }) {
  const info = RECRUIT_STAGES.find((s) => s.value === value) ?? RECRUIT_STAGES[0];
  return (
    <Select value={value} onValueChange={(v) => onChange(v as RecruitStage)}>
      <SelectTrigger className={cn("h-6 w-auto gap-1 rounded border-0 px-2 text-[10px] font-bold uppercase tracking-wider", toneClass(info.tone))} style={OSWALD}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {RECRUIT_STAGES.map((s) => <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function TierSelect({ value, onChange }: { value: RecruitTier | null; onChange: (t: RecruitTier) => void }) {
  const info = RECRUIT_TIERS.find((t) => t.value === value);
  return (
    <Select value={value ?? undefined} onValueChange={(v) => onChange(v as RecruitTier)}>
      <SelectTrigger className={cn("h-6 w-auto gap-1 rounded border-0 px-2 text-[10px] font-bold uppercase tracking-wider", info ? toneClass(info.tone) : "bg-muted text-muted-foreground")} style={OSWALD}>
        <SelectValue placeholder="Set Tier" />
      </SelectTrigger>
      <SelectContent>{RECRUIT_TIERS.map((t) => <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function SortableRecruitCard({ recruit, onRemove, onStageChange, onTierChange, eventCount, onTimeline, reports, onReports }: { recruit: GmRecruit; onRemove: () => void; onStageChange: (s: RecruitStage) => void; onTierChange: (t: RecruitTier) => void; eventCount: number; onTimeline: () => void; reports: GmRecruitReport[]; onReports: () => void }) {
  const { setNodeRef, listeners, attributes, transform, transition, isDragging } = useSortable({ id: recruit.id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.55 : 1, zIndex: isDragging ? 10 : "auto", position: "relative" };
  const name = `${recruit.first_name ?? ""} ${recruit.last_name ?? ""}`.trim() || "Unnamed";
  const locale = recruit.high_school ? `${recruit.high_school}${recruit.state ? ` (${recruit.state})` : ""}` : (recruit.state ?? "");
  return (
    <div ref={setNodeRef} style={style} className="flex items-start gap-2 rounded-md border border-border/60 bg-card/40 p-2.5">
      <button {...attributes} {...listeners} className="mt-0.5 cursor-grab text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing" title="Drag to reorder">
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{name}</span>
          {recruit.position && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{recruit.position}</span>}
        </div>
        {(locale || recruit.travel_org) && (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{locale}{locale && recruit.travel_org ? " · " : ""}{recruit.travel_org}</div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <TierSelect value={recruit.projection_tier} onChange={onTierChange} />
          <StageSelect value={recruit.stage} onChange={onStageChange} />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {recruit.link && (
            <a href={recruit.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              <ExternalLink className="h-3 w-3" /> Profile
            </a>
          )}
          <button onClick={onReports} className="inline-flex items-center gap-1 text-xs text-primary hover:underline" title="Scouting reports">
            <FileText className="h-3 w-3" /> Reports{reports.length > 0 && <span className="tabular-nums">({reports.length})</span>}
          </button>
          <button onClick={onTimeline} className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" title="Timeline">
            <Plus className="h-3.5 w-3.5" />{eventCount > 0 && <span className="tabular-nums">{eventCount}</span>}
          </button>
        </div>
      </div>
      <button onClick={onRemove} title="Remove" className="text-muted-foreground/40 hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
    </div>
  );
}

export default function GMRecruits() {
  const gm = useGmRecruits();
  const [year, setYear] = useState<number>(YEARS[0]);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ first_name: "", last_name: "", position: "", high_school: "", state: "", travel_org: "", notes: "", link: "", class_year: YEARS[0], stage: "evaluating" as RecruitStage, projection_tier: "" as RecruitTier | "" });
  const [timelineRecruit, setTimelineRecruit] = useState<GmRecruit | null>(null);
  const [eventDate, setEventDate] = useState<string>(today);
  const [eventNote, setEventNote] = useState("");
  const [reportsRecruit, setReportsRecruit] = useState<GmRecruit | null>(null);
  const [reportDate, setReportDate] = useState<string>(today);
  const [reportBody, setReportBody] = useState("");
  const openReports = (r: GmRecruit) => { setReportBody(""); setReportDate(today()); setReportsRecruit(r); };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const listFor = (t: RecruitType) => gm.recruits.filter((r) => r.class_year === year && r.player_type === t).sort((a, b) => a.sort_order - b.sort_order);

  const onDragEnd = (list: GmRecruit[]) => (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldI = list.findIndex((r) => r.id === active.id);
    const newI = list.findIndex((r) => r.id === over.id);
    if (oldI === -1 || newI === -1) return;
    gm.reorder(arrayMove(list, oldI, newI).map((r) => r.id));
  };

  const openAdd = () => { setForm({ first_name: "", last_name: "", position: "", high_school: "", state: "", travel_org: "", notes: "", link: "", class_year: year, stage: "evaluating", projection_tier: "" }); setAddOpen(true); };
  const submit = () => {
    gm.addRecruit({
      class_year: form.class_year,
      player_type: recruitTypeForPosition(form.position),
      stage: form.stage,
      projection_tier: form.projection_tier || null,
      first_name: form.first_name.trim() || null,
      last_name: form.last_name.trim() || null,
      high_school: form.high_school.trim() || null,
      state: form.state.trim() || null,
      travel_org: form.travel_org.trim() || null,
      position: form.position || null,
      notes: null,
      scouting_report_date: null,
      link: form.link.trim() || null,
    }, form.notes.trim() ? { report_date: today(), body: form.notes.trim() } : undefined);
    setAddOpen(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold leading-tight" style={OSWALD}>Recruiting Board</h2>
          <p className="text-sm text-muted-foreground">Future classes · HS &amp; JUCO prospects</p>
        </div>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={openAdd}><Plus className="h-3.5 w-3.5" /> Add Player</Button>
      </div>

      {/* Class year tabs */}
      <div className="flex flex-wrap gap-2">
        {YEARS.map((y) => (
          <button
            key={y}
            onClick={() => setYear(y)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors",
              year === y ? "bg-[#D4AF37]/15 text-[#D4AF37] ring-1 ring-[#D4AF37]/40" : "text-muted-foreground hover:bg-muted",
            )}
            style={OSWALD}
          >
            {y} Class
          </button>
        ))}
      </div>

      {/* Three sortable sections */}
      <div className="grid gap-4 lg:grid-cols-3">
        {SECTIONS.map(({ type, title }) => {
          const list = listFor(type);
          return (
            <Card key={type} className="border-border/60">
              <CardHeader className="pb-2 pt-3 px-4 border-b border-border/40">
                <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>{title} ({list.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 p-3">
                {list.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">No recruits in this group.</p>
                ) : (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd(list)}>
                    <SortableContext items={list.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                      <div className="space-y-2">
                        {list.map((r) => <SortableRecruitCard key={r.id} recruit={r} onRemove={() => gm.removeRecruit(r.id)} onStageChange={(s) => gm.updateRecruit(r.id, { stage: s })} onTierChange={(t) => gm.updateRecruit(r.id, { projection_tier: t })} eventCount={gm.eventsByRecruit.get(r.id)?.length ?? 0} onTimeline={() => { setEventNote(""); setEventDate(today()); setTimelineRecruit(r); }} reports={gm.reportsByRecruit.get(r.id) ?? []} onReports={() => openReports(r)} />)}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Add recruit */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle style={OSWALD}>Add Recruit</DialogTitle></DialogHeader>
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground" style={OSWALD}>First Name</span>
                <Input value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} className="h-9 text-sm" />
              </div>
              <div>
                <span className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground" style={OSWALD}>Last Name</span>
                <Input value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} className="h-9 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground" style={OSWALD}>Position</span>
                <Select value={form.position} onValueChange={(v) => setForm((f) => ({ ...f, position: v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{POSITIONS.map((p) => <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <span className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground" style={OSWALD}>Class Year</span>
                <Select value={String(form.class_year)} onValueChange={(v) => setForm((f) => ({ ...f, class_year: Number(v) }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>{YEARS.map((y) => <SelectItem key={y} value={String(y)} className="text-xs">{y}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground" style={OSWALD}>Stage</span>
                <Select value={form.stage} onValueChange={(v) => setForm((f) => ({ ...f, stage: v as RecruitStage }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>{RECRUIT_STAGES.map((s) => <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <span className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground" style={OSWALD}>Projection Tier</span>
                <Select value={form.projection_tier || undefined} onValueChange={(v) => setForm((f) => ({ ...f, projection_tier: v as RecruitTier }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Set tier" /></SelectTrigger>
                  <SelectContent>{RECRUIT_TIERS.map((t) => <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground" style={OSWALD}>High School</span>
                <Input value={form.high_school} onChange={(e) => setForm((f) => ({ ...f, high_school: e.target.value }))} className="h-9 text-sm" />
              </div>
              <div>
                <span className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground" style={OSWALD}>State</span>
                <Input value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))} placeholder="e.g. TX" className="h-9 text-sm" />
              </div>
            </div>
            <div>
              <span className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground" style={OSWALD}>Travel Organization</span>
              <Input value={form.travel_org} onChange={(e) => setForm((f) => ({ ...f, travel_org: e.target.value }))} className="h-9 text-sm" />
            </div>
            <div>
              <span className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground" style={OSWALD}>Link (PBR / PG)</span>
              <Input value={form.link} onChange={(e) => setForm((f) => ({ ...f, link: e.target.value }))} placeholder="https://…" className="h-9 text-sm" />
            </div>
            <div>
              <span className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground" style={OSWALD}>Scouting Report</span>
              <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Tools, projection, makeup…" className="min-h-[60px] text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button size="sm" disabled={!form.first_name.trim() && !form.last_name.trim()} onClick={submit}>Add To Board</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Recruit timeline — scouting report + dated event log */}
      <Dialog open={!!timelineRecruit} onOpenChange={(o) => { if (!o) setTimelineRecruit(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle style={OSWALD}>{`${timelineRecruit?.first_name ?? ""} ${timelineRecruit?.last_name ?? ""}`.trim() || "Recruit"} — Timeline</DialogTitle>
          </DialogHeader>
          {/* Add event */}
          <div className="space-y-2 rounded-md border border-border/60 p-2.5">
            <Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className="h-8 w-auto text-xs" />
            <Textarea value={eventNote} onChange={(e) => setEventNote(e.target.value)} placeholder="What happened — call, visit, camp, note…" className="min-h-[50px] text-sm" />
            <Button size="sm" className="w-full" disabled={!eventNote.trim()} onClick={() => { if (timelineRecruit) { gm.addEvent(timelineRecruit.id, eventDate, eventNote.trim()); setEventNote(""); } }}>Add Event</Button>
          </div>
          {/* Timeline */}
          <div className="max-h-[40vh] space-y-2.5 overflow-y-auto">
            {(gm.eventsByRecruit.get(timelineRecruit?.id ?? "") ?? []).map((ev) => (
              <div key={ev.id} className="flex gap-3 border-l-2 border-[#D4AF37]/40 pl-3">
                <div className="w-20 shrink-0 pt-0.5 text-[11px] tabular-nums text-muted-foreground">{new Date(ev.event_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
                <div className="flex-1 whitespace-pre-wrap text-sm">{ev.note}</div>
                <button onClick={() => gm.removeEvent(ev.id)} className="text-muted-foreground/40 hover:text-destructive" title="Delete"><X className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            {(gm.eventsByRecruit.get(timelineRecruit?.id ?? "") ?? []).length === 0 && (
              <p className="py-3 text-center text-xs text-muted-foreground">No events logged yet.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Scouting reports — multiple, authored + dated, independent */}
      <Dialog open={!!reportsRecruit} onOpenChange={(o) => { if (!o) setReportsRecruit(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle style={OSWALD} className="flex items-center gap-2">
              <span>{`${reportsRecruit?.first_name ?? ""} ${reportsRecruit?.last_name ?? ""}`.trim() || "Recruit"} — Scouting Reports</span>
              {(() => { const info = RECRUIT_TIERS.find((t) => t.value === reportsRecruit?.projection_tier); return info ? <span className={cn("rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", toneClass(info.tone))} style={OSWALD}>{info.label}</span> : null; })()}
            </DialogTitle>
          </DialogHeader>
          {/* New report */}
          <div className="space-y-2 rounded-md border border-border/60 p-2.5">
            <Input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} className="h-8 w-auto text-xs" />
            <Textarea value={reportBody} onChange={(e) => setReportBody(e.target.value)} placeholder="Tools, projection, makeup…" className="min-h-[70px] text-sm" />
            <Button size="sm" className="w-full" disabled={!reportBody.trim()} onClick={() => { if (reportsRecruit) { gm.addReport(reportsRecruit.id, reportDate, reportBody.trim()); setReportBody(""); } }}>Add Report</Button>
          </div>
          {/* Report list — each independent */}
          <div className="max-h-[45vh] space-y-2.5 overflow-y-auto">
            {(gm.reportsByRecruit.get(reportsRecruit?.id ?? "") ?? []).map((r) => (
              <div key={r.id} className="rounded-md border border-border/60 bg-muted/20 p-2.5">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] text-muted-foreground">{r.author ? `${r.author.split("@")[0]} · ` : ""}{fmtDate(r.report_date)}</div>
                  <button onClick={() => gm.removeReport(r.id)} className="text-muted-foreground/40 hover:text-destructive" title="Delete"><X className="h-3.5 w-3.5" /></button>
                </div>
                <div className="mt-1 whitespace-pre-wrap text-sm text-foreground/90">{r.body}</div>
              </div>
            ))}
            {(gm.reportsByRecruit.get(reportsRecruit?.id ?? "") ?? []).length === 0 && (
              <p className="py-3 text-center text-xs text-muted-foreground">No reports yet.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
