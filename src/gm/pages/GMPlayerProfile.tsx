import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useGmRoster, type GmRow } from "@/gm/hooks/useGmRoster";
import { useGmContracts } from "@/gm/hooks/useGmContracts";
import { ContractCard } from "@/gm/pages/GMContracts";
import PlayerNotesDialog from "@/components/PlayerNotesDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { profileRouteFor } from "@/lib/profileRoutes";
import { ArrowLeft, StickyNote, LineChart, ExternalLink, ListChecks } from "lucide-react";

const OSWALD = { fontFamily: "Oswald, sans-serif" } as const;
const money = (n: number | null | undefined) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));
const num = (n: number | null | undefined, d = 1) => (n == null ? "—" : n.toFixed(d));

function comp(r: GmRow) {
  const rev = r.rev_share ?? 0;
  const nil = (r.nil_amount ?? 0) + r.nil_vendor;
  const other = (r.other_amount ?? 0) + r.other_vendor;
  return { rev, nil, other, total: r.actual_pay ?? r.nil_value ?? rev + nil + other };
}

export default function GMPlayerProfile() {
  const { playerId = "" } = useParams();
  const gm = useGmRoster();
  const { contracts } = useGmContracts(playerId);
  const [notesOpen, setNotesOpen] = useState(false);

  const row = useMemo(
    () => [...gm.hitters, ...gm.pitchers].find((r) => r.player_id === playerId) ?? null,
    [gm.hitters, gm.pitchers, playerId],
  );

  const openObligations = contracts.flatMap((c) => c.obligations).filter((o) => !o.fulfilled).length;
  const totalObligations = contracts.reduce((s, c) => s + c.obligations.length, 0);
  const notes = row ? gm.notesByBuildPlayer.get(row.build_player_id) ?? [] : [];

  if (gm.isLoading && !row) {
    return <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>;
  }
  if (!row) {
    return (
      <div className="space-y-4">
        <Link to="/gm/players" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Player Profiles</Link>
        <Card className="border-border/60"><CardContent className="py-16 text-center text-sm text-muted-foreground">This player isn't on the current build.</CardContent></Card>
      </div>
    );
  }

  const c = comp(row);
  const stat = (label: string, value: string, accent?: boolean) => (
    <div className="flex flex-col gap-0.5 px-4 py-3">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("font-mono text-lg font-bold tabular-nums", accent ? "text-[#D4AF37]" : "text-foreground")} style={OSWALD}>{value}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <Link to="/gm/players" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Player Profiles</Link>

      {/* Header + bio */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#D4AF37]/15 text-lg font-bold text-[#D4AF37]" style={OSWALD}>{row.name[0]}</div>
        <div className="min-w-0">
          <h2 className="text-2xl font-bold leading-tight" style={OSWALD}>{row.name}</h2>
          <div className="text-xs text-muted-foreground">
            {[row.position, row.eligibility_class || row.class_year, row.is_pitcher ? "Pitcher" : "Position"].filter(Boolean).join(" · ")}
            <span className={cn("ml-1.5 font-medium", row.finalized ? "text-emerald-400" : "text-amber-400")}>· {row.finalized ? "Finalized" : "Draft"}</span>
          </div>
        </div>
        <div className="ml-auto">
          <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
            <Link to={profileRouteFor(row.player_id!, row.position, row.is_pitcher ? "rhp" : null)}><LineChart className="h-3.5 w-3.5" /> Full scouting & projections <ExternalLink className="h-3 w-3" /></Link>
          </Button>
        </div>
      </div>

      {/* Compensation summary */}
      <Card className="border-border/60">
        <CardContent className="grid grid-cols-2 divide-x divide-y divide-border/50 p-0 sm:grid-cols-4 sm:divide-y-0">
          {stat("Revenue Share", money(c.rev))}
          {stat("NIL", money(c.nil))}
          {stat("Other", money(c.other))}
          {stat("Total Pay", money(c.total), true)}
        </CardContent>
      </Card>

      {/* Projections / stats snapshot (deep analysis on the scouting profile) */}
      <Card className="border-border/60">
        <CardContent className="grid grid-cols-3 divide-x divide-border/50 p-0">
          {stat("Projected WAR", num(row.war))}
          {stat("Market Value", money(row.market_value))}
          {stat("Value vs. Pay", c.total > 0 && row.market_value != null ? `${(row.market_value / c.total).toFixed(2)}×` : "—")}
        </CardContent>
      </Card>

      {/* Obligations rollup */}
      {totalObligations > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-4 py-2.5 text-sm">
          <ListChecks className="h-4 w-4 text-[#D4AF37]" />
          <span className="font-medium">{openObligations}</span>
          <span className="text-muted-foreground">open obligation{openObligations === 1 ? "" : "s"} of {totalObligations} across {contracts.length} contract{contracts.length === 1 ? "" : "s"} — check them off below.</span>
        </div>
      )}

      {/* Contracts */}
      <div className="space-y-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>Contracts</h3>
          <span className="text-[11px] text-muted-foreground">add contracts on the Contracts tab</span>
        </div>
        {contracts.length === 0 ? (
          <Card className="border-border/60"><CardContent className="py-10 text-center text-sm text-muted-foreground">No contracts on file for this player.</CardContent></Card>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">{contracts.map((ct) => <ContractCard key={ct.id} c={ct} playerName={row.name} />)}</div>
        )}
      </div>

      {/* Internal notes */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>Internal Notes</h3>
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => setNotesOpen(true)}><StickyNote className="h-3.5 w-3.5" /> {notes.length ? `${notes.length} note${notes.length > 1 ? "s" : ""}` : "Add note"}</Button>
        </div>
        {notes.length === 0 ? (
          <p className="text-xs text-muted-foreground">No notes yet — shared with your staff and the coach's Team Builder.</p>
        ) : (
          <div className="space-y-1.5">
            {notes.slice(0, 3).map((n) => (
              <div key={n.id} className="rounded-md border border-border/50 px-3 py-2 text-xs">
                <div className="text-foreground/90">{n.body}</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">{n.note_date ? new Date(n.note_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}{n.author ? ` · ${n.author}` : ""}</div>
              </div>
            ))}
            {notes.length > 3 && <button onClick={() => setNotesOpen(true)} className="text-xs text-muted-foreground hover:text-foreground">View all {notes.length} notes</button>}
          </div>
        )}
      </div>

      <PlayerNotesDialog
        open={notesOpen}
        onOpenChange={setNotesOpen}
        playerName={row.name}
        notes={notes}
        onAdd={(body) => gm.addNote(row, body)}
        onRemove={(id) => gm.removeNote(id)}
        subtitle="Scouting or negotiation context. Each note is stamped with the date and who wrote it. Shared with your staff and the coach's Team Builder."
      />
    </div>
  );
}
