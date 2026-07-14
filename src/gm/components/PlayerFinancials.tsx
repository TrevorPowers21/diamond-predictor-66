import { useMemo, useState } from "react";
import { useGmRoster, type GmRow } from "@/gm/hooks/useGmRoster";
import { useGmContracts } from "@/gm/hooks/useGmContracts";
import { useGmPlayerInfo } from "@/gm/hooks/useGmPlayerInfo";
import { marketabilityScore, marketabilityTier } from "@/gm/lib/marketability";
import { ContractCard } from "@/gm/pages/GMContracts";
import PlayerNotesDialog from "@/components/PlayerNotesDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { StickyNote, ListChecks } from "lucide-react";

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
export default function PlayerFinancials({ playerName, playerId }: { playerName: string; playerId: string }) {
  const gm = useGmRoster();
  const { contracts } = useGmContracts(playerId);
  const [notesOpen, setNotesOpen] = useState(false);

  const row = useMemo(
    () => [...gm.hitters, ...gm.pitchers].find((r) => r.player_id === playerId) ?? null,
    [gm.hitters, gm.pitchers, playerId],
  );
  const c = row ? playerComp(row) : null;

  // Marketability detail: the per-platform following that rolls up into the
  // Overview's single marketability score.
  const { info: pInfo } = useGmPlayerInfo(playerId);
  const platforms = [
    { key: "Instagram", n: pInfo?.instagram_followers ?? null },
    { key: "X / Twitter", n: pInfo?.twitter_followers ?? null },
    { key: "TikTok", n: pInfo?.tiktok_followers ?? null },
  ];
  const socialTotal = platforms.reduce((a, p) => a + (p.n ?? 0), 0);
  const marketScore = marketabilityScore(socialTotal > 0 ? socialTotal : null);
  const compactNum = (n: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);

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
      {c ? (
        <Card className="border-border/60">
          <CardContent className="grid grid-cols-2 divide-x divide-y divide-border/50 p-0 sm:grid-cols-4 sm:divide-y-0">
            {stat("Revenue Share", money(c.rev))}
            {stat("NIL", money(c.nil))}
            {stat("Other", money(c.other))}
            {stat("Total Pay", money(c.total), true)}
          </CardContent>
        </Card>
      ) : (
        <p className="text-xs text-muted-foreground">No compensation record on the current build — contracts below are still tracked.</p>
      )}

      <Card className="border-border/60">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>Marketability</h3>
            <span className="text-[11px] text-muted-foreground">from social following</span>
          </div>
          {socialTotal > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-3">
              <div className="flex flex-col">
                <span className="font-mono text-3xl font-bold leading-none text-[#D4AF37]" style={OSWALD}>{marketScore}</span>
                <span className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">Score · {marketabilityTier(marketScore)}</span>
              </div>
              <div className="flex flex-col">
                <span className="font-mono text-lg font-semibold leading-none text-foreground">{compactNum(socialTotal)}</span>
                <span className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">Total Followers</span>
              </div>
              {platforms.filter((p) => p.n != null).map((p) => (
                <div key={p.key} className="flex flex-col">
                  <span className="font-mono text-lg font-semibold leading-none text-foreground">{compactNum(p.n as number)}</span>
                  <span className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{p.key}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">No social following entered yet — add Instagram, X, or TikTok in the ⋯ Player Info panel to generate a marketability score.</p>
          )}
        </CardContent>
      </Card>

      {totalObligations > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-4 py-2.5 text-sm">
          <ListChecks className="h-4 w-4 text-[#D4AF37]" />
          <span className="font-medium">{openObligations}</span>
          <span className="text-muted-foreground">open obligation{openObligations === 1 ? "" : "s"} of {totalObligations} across {contracts.length} contract{contracts.length === 1 ? "" : "s"} — check them off below.</span>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>Contracts</h3>
          <span className="text-[11px] text-muted-foreground">add contracts on the Contracts tab</span>
        </div>
        {contracts.length === 0 ? (
          <Card className="border-border/60"><CardContent className="py-10 text-center text-sm text-muted-foreground">No contracts on file for this player.</CardContent></Card>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">{contracts.map((ct) => <ContractCard key={ct.id} c={ct} playerName={playerName} />)}</div>
        )}
      </div>

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
    </div>
  );
}
