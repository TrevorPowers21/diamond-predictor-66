import { useMemo, useState } from "react";
import { useGmRoster, type GmRow, type RowMoney } from "@/gm/hooks/useGmRoster";
import { useGmContracts, type GmContract } from "@/gm/hooks/useGmContracts";
import PlayerCompensationDialog from "@/gm/components/PlayerCompensationDialog";
import { useGmPlayerInfo } from "@/gm/hooks/useGmPlayerInfo";
import { useMarketability } from "@/gm/hooks/useMarketability";
import { marketabilityTierColor } from "@/gm/lib/marketability";
import { AddContractDialog, BUCKET_LABEL } from "@/gm/pages/GMContracts";
import PlayerNotesDialog from "@/components/PlayerNotesDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { StickyNote, ListChecks, Plus, Check, Pencil, Trash2, ExternalLink } from "lucide-react";

const OSWALD = { fontFamily: "Oswald, sans-serif" } as const;
const money = (n: number | null | undefined) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));

export function playerComp(r: GmRow) {
  const rev = r.rev_share ?? 0;
  const nil = (r.nil_amount ?? 0) + r.nil_vendor;
  const other = (r.other_amount ?? 0) + r.other_vendor;
  return { rev, nil, other, total: r.actual_pay ?? r.nil_value ?? rev + nil + other };
}

/**
 * The Financials tab of the universal player hub: compensation summary,
 * contracts + PDFs + obligations, and internal dated notes. Contracts are
 * team-level (shown for any player); comp + notes come from the current build's
 * roster row when the player is on it.
 */
const PROGRAM_TIER_LABEL: Record<number, string> = { 5: "Elite", 4: "Strong", 3: "Solid", 2: "Modest", 1: "Minimal" };
const PROGRAM_TIER_COLOR: Record<number, string> = { 5: "#22d3ee", 4: "#34d399", 3: "#fbbf24", 2: "#94a3b8", 1: "#94a3b8" };
const CONN_LABEL: Record<string, string> = { family_notable: "Legacy athlete", family_alum: "Immediate family alum", local: "In-state / local hometown" };
const CONN_COLOR: Record<string, string> = { family_notable: "#22d3ee", family_alum: "#34d399", local: "#fbbf24" };

export default function PlayerFinancials({ playerName, playerId, onEditMarketability }: { playerName: string; playerId: string; onEditMarketability?: () => void }) {
  const gm = useGmRoster();
  const { contracts, toggleObligation, removeContract, viewPdf } = useGmContracts(playerId);
  const fmtDate = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  // How a contract reads in the table / tracker: Rev Share shows "Revenue Share";
  // NIL & Other show the vendor category they fall under.
  const contractLabel = (ct: { bucket: string; vendor_name: string | null }) =>
    ct.bucket === "rev" ? "Revenue Share" : (ct.vendor_name || BUCKET_LABEL[ct.bucket as keyof typeof BUCKET_LABEL]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<GmContract | null>(null);
  const [compOpen, setCompOpen] = useState(false);
  const [savingComp, setSavingComp] = useState(false);

  const row = useMemo(
    () => [...gm.hitters, ...gm.pitchers].find((r) => r.player_id === playerId) ?? null,
    [gm.hitters, gm.pitchers, playerId],
  );
  const c = row ? playerComp(row) : null;
  const schMode = gm.budget?.scholarship_mode ?? "pct";
  const schDisplay = row?.scholarship_amount == null ? "—" : (schMode === "dollar" ? money(row.scholarship_amount) : `${Math.round(row.scholarship_amount)}%`);
  const submitComp = (mny: RowMoney, finalize: boolean, onDone: () => void) => {
    if (!row) return;
    setSavingComp(true);
    gm.finalizePlayer(row, mny, finalize, () => { setSavingComp(false); onDone(); });
  };

  // Marketability buckets — each a clickable half-card showing a tier (not raw
  // points). Empty buckets ("Add") open the questionnaire to fill them.
  const { info: pInfo } = useGmPlayerInfo(playerId);
  const { breakdown, programTier, draftRank } = useMarketability(playerId);
  const socialTotal = (pInfo?.instagram_followers ?? 0) + (pInfo?.twitter_followers ?? 0) + (pInfo?.tiktok_followers ?? 0) + (pInfo?.youtube_followers ?? 0);
  const connTier = pInfo?.university_connection_tier ?? null;
  const compactNum = (n: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  const socialLabel = socialTotal >= 150000 ? "Massive" : socialTotal >= 50000 ? "Large" : socialTotal >= 10000 ? "Established" : socialTotal >= 2500 ? "Growing" : socialTotal >= 1000 ? "Small" : "Minimal";
  const socialColor = socialTotal >= 50000 ? "#22d3ee" : socialTotal >= 10000 ? "#34d399" : socialTotal >= 2500 ? "#fbbf24" : "#94a3b8";
  const buckets = [
    { title: "Program & Community", isEmpty: !programTier, tier: programTier ? PROGRAM_TIER_LABEL[programTier] : "", color: programTier ? (PROGRAM_TIER_COLOR[programTier] ?? "#94a3b8") : "", detail: programTier ? "Fanbase & community pull" : "Set your program tier" },
    { title: "Social Following", isEmpty: socialTotal === 0, tier: socialLabel, color: socialColor, detail: socialTotal === 0 ? "Add follower counts" : `${compactNum(socialTotal)} across platforms` },
    { title: "University Connection", isEmpty: !connTier, tier: connTier ? (CONN_LABEL[connTier] ?? connTier) : "", color: connTier ? (CONN_COLOR[connTier] ?? "#94a3b8") : "", detail: connTier ? (pInfo?.university_connection_note || "Legacy / family ties") : "Legacy or family ties add value" },
    { title: "Draft Context", isEmpty: false, tier: draftRank == null ? "Unranked" : draftRank <= 100 ? "Top-100" : "Ranked", color: draftRank == null ? "#94a3b8" : draftRank <= 100 ? "#22d3ee" : "#34d399", detail: draftRank == null ? "Not on the draft board" : `#${draftRank} on the draft board` },
  ];

  const openObligations = contracts.flatMap((ct) => ct.obligations).filter((o) => !o.fulfilled).length;
  const totalObligations = contracts.reduce((s, ct) => s + ct.obligations.length, 0);
  const notes = row ? gm.notesByBuildPlayer.get(row.build_player_id) ?? [] : [];

  const stat = (label: string, value: string, accent?: boolean) => (
    <div className="flex flex-col gap-0.5 px-4 py-3">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("font-mono text-lg font-bold tabular-nums", accent ? "text-[#D4AF37]" : "text-foreground")} style={OSWALD}>{value}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      {c && row ? (
        <Card className="border-border/60">
          <CardContent className="p-0">
            <div className="flex items-center justify-between px-4 pb-1 pt-3">
              <h3 className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>Compensation{row.finalized && <span className="ml-2 text-[10px] font-semibold text-[#D4AF37]">FINALIZED</span>}</h3>
              <button onClick={() => setCompOpen(true)} className="text-[11px] text-muted-foreground hover:text-foreground">Edit →</button>
            </div>
            <div className="grid grid-cols-2 divide-x divide-y divide-border/50 sm:grid-cols-5 sm:divide-y-0">
              {stat("Scholarship", schDisplay)}
              {stat("Revenue Share", money(c.rev))}
              {stat("NIL", money(c.nil))}
              {stat("Other", money(c.other))}
              {stat("Total Pay", money(c.total), true)}
            </div>
          </CardContent>
        </Card>
      ) : (
        <p className="text-xs text-muted-foreground">No compensation record on the current build — contracts are still tracked below.</p>
      )}

      {/* Marketability | Contracts half-tables */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card
          onClick={onEditMarketability}
          className={cn("border-border/60", onEditMarketability && "cursor-pointer transition-colors hover:border-[#D4AF37]/50")}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>Marketability</h3>
              <span className="text-base font-bold uppercase tracking-wide" style={{ ...OSWALD, color: marketabilityTierColor(breakdown.tier) }}>{breakdown.tier}</span>
            </div>
            <div className="mt-2.5 space-y-2">
              {buckets.map((b) => (
                <div key={b.title} className="flex items-center justify-between gap-3 border-b border-border/40 pb-2 last:border-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">{b.title}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{b.detail}</div>
                  </div>
                  <span className={cn("shrink-0 text-sm font-bold uppercase tracking-wide", b.isEmpty && "text-foreground")} style={b.isEmpty ? OSWALD : { ...OSWALD, color: b.color }}>{b.isEmpty ? "Add" : b.tier}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>Contracts</h3>
              <Button size="sm" className="h-6 gap-1 px-2 text-[11px]" onClick={() => setAddOpen(true)}><Plus className="h-3 w-3" /> Add Contract</Button>
            </div>
            {contracts.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">No contracts yet. Adding one flows to the Contracts tab and funding sources.</p>
            ) : (
              <div className="mt-2.5 space-y-2">
                {contracts.map((ct) => (
                  <div key={ct.id} className="flex items-center justify-between gap-3 border-b border-border/40 pb-2 last:border-0 last:pb-0">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{contractLabel(ct)}</div>
                      {ct.bucket !== "rev" && <div className="truncate text-[11px] text-muted-foreground">{BUCKET_LABEL[ct.bucket]}</div>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="mr-1 font-mono text-sm font-semibold text-[#D4AF37]">{money(ct.total_value)}</span>
                      {ct.pdf_path && <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" title="Open PDF" onClick={() => viewPdf(ct.pdf_path!)}><ExternalLink className="h-3.5 w-3.5" /></Button>}
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" title="Edit" onClick={() => setEditing(ct)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-rose-400" title="Remove" onClick={() => removeContract(ct)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {totalObligations > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}><ListChecks className="h-4 w-4" /> Obligation Tracker</h3>
            <span className="text-[11px] text-muted-foreground">{totalObligations - openObligations}/{totalObligations} complete</span>
          </div>
          <Card className="border-border/60">
            <CardContent className="space-y-0.5 p-2">
              {contracts.flatMap((ct) => ct.obligations.map((o) => ({ o, ct }))).map(({ o, ct }) => (
                <button
                  key={o.id}
                  onClick={() => toggleObligation(o.id, !o.fulfilled)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/30"
                >
                  <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border", o.fulfilled ? "border-emerald-500 bg-emerald-500/20 text-emerald-400" : "border-muted-foreground/40 text-transparent")}><Check className="h-3 w-3" /></span>
                  <span className={cn("min-w-0 flex-1 truncate", o.fulfilled && "text-muted-foreground line-through")}>{o.description}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{contractLabel(ct)}{o.due_date ? ` · ${fmtDate(o.due_date)}` : ""}</span>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>Internal Notes</h3>
          {row && <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => setNotesOpen(true)}><StickyNote className="h-3.5 w-3.5" /> {notes.length ? `${notes.length} note${notes.length > 1 ? "s" : ""}` : "Add note"}</Button>}
        </div>
        {!row ? (
          <p className="text-xs text-muted-foreground">Notes are available once the player is on a roster build.</p>
        ) : notes.length === 0 ? (
          <p className="text-xs text-muted-foreground">No notes yet — shared with your staff and the coach's Team Builder.</p>
        ) : (
          <div className="space-y-1.5">
            {notes.slice(0, 4).map((n) => (
              <div key={n.id} className="rounded-md border border-border/50 px-3 py-2 text-xs">
                <div className="text-foreground/90">{n.body}</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">{n.note_date ? new Date(n.note_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}{n.author ? ` · ${n.author}` : ""}</div>
              </div>
            ))}
            {notes.length > 4 && <button onClick={() => setNotesOpen(true)} className="text-xs text-muted-foreground hover:text-foreground">View all {notes.length} notes</button>}
          </div>
        )}
      </div>

      {row && (
        <PlayerNotesDialog
          open={notesOpen}
          onOpenChange={setNotesOpen}
          playerName={playerName}
          notes={notes}
          onAdd={(body) => gm.addNote(row, body)}
          onRemove={(id) => gm.removeNote(id)}
          subtitle="Scouting or negotiation context. Each note is stamped with the date and who wrote it. Shared with your staff and the coach's Team Builder."
        />
      )}

      <AddContractDialog open={addOpen} onOpenChange={setAddOpen} players={[{ id: playerId, name: playerName }]} defaultPlayerId={playerId} />
      <AddContractDialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }} players={[{ id: playerId, name: playerName }]} defaultPlayerId={playerId} editing={editing} />

      {row && (
        <PlayerCompensationDialog
          open={compOpen}
          onOpenChange={setCompOpen}
          row={row}
          schMode={schMode}
          finalized={!!row.finalized}
          onSubmit={submitComp}
          isSaving={savingComp}
        />
      )}
    </div>
  );
}
