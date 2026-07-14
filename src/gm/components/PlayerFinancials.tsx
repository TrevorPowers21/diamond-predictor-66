import { useMemo, useState } from "react";
import { useGmRoster, type GmRow } from "@/gm/hooks/useGmRoster";
import { useGmContracts } from "@/gm/hooks/useGmContracts";
import { useGmPlayerInfo } from "@/gm/hooks/useGmPlayerInfo";
import { useMarketability } from "@/gm/hooks/useMarketability";
import { marketabilityTierColor } from "@/gm/lib/marketability";
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
const PROGRAM_TIER_LABEL: Record<number, string> = { 5: "Elite", 4: "Strong", 3: "Solid", 2: "Modest", 1: "Minimal" };
const CONN_LABEL: Record<string, string> = { family_notable: "Legacy athlete", family_alum: "Immediate family alum", local: "In-state / local hometown" };

export default function PlayerFinancials({ playerName, playerId, onEditMarketability }: { playerName: string; playerId: string; onEditMarketability?: () => void }) {
  const gm = useGmRoster();
  const { contracts } = useGmContracts(playerId);
  const [notesOpen, setNotesOpen] = useState(false);

  const row = useMemo(
    () => [...gm.hitters, ...gm.pitchers].find((r) => r.player_id === playerId) ?? null,
    [gm.hitters, gm.pitchers, playerId],
  );
  const c = row ? playerComp(row) : null;

  // Marketability scorecard: the components that roll up into the Overview score.
  const { info: pInfo } = useGmPlayerInfo(playerId);
  const { breakdown, programTier, draftRank } = useMarketability(playerId);
  const platforms = [
    { key: "Instagram", n: pInfo?.instagram_followers ?? null, handle: pInfo?.instagram_handle ?? null },
    { key: "X / Twitter", n: pInfo?.twitter_followers ?? null, handle: pInfo?.twitter_handle ?? null },
    { key: "TikTok", n: pInfo?.tiktok_followers ?? null, handle: pInfo?.tiktok_handle ?? null },
    { key: "YouTube", n: pInfo?.youtube_followers ?? null, handle: pInfo?.youtube_handle ?? null },
  ];
  const socialTotal = platforms.reduce((a, p) => a + (p.n ?? 0), 0);
  const connTier = pInfo?.university_connection_tier ?? null;
  const compactNum = (n: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  const scoreRow = (label: string, detail: string, pts: number, max: number, muted?: boolean) => (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="truncate text-[11px] text-muted-foreground">{detail}</div>
      </div>
      <span className={cn("shrink-0 font-mono text-sm font-semibold tabular-nums", muted ? "text-muted-foreground" : "text-[#D4AF37]")}>+{pts}<span className="text-[10px] text-muted-foreground">/{max}</span></span>
    </div>
  );

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
            <div className="flex items-center gap-2">
              <h3 className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>Marketability</h3>
              <button onClick={onEditMarketability} disabled={!onEditMarketability} className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50">Edit →</button>
            </div>
            <span className="text-xl font-bold uppercase tracking-wide" style={{ ...OSWALD, color: marketabilityTierColor(breakdown.tier) }}>{breakdown.tier}</span>
          </div>

          <div className="mt-3 space-y-2.5">
            {scoreRow(
              "Program & Community",
              programTier ? `${PROGRAM_TIER_LABEL[programTier]} program` : "Program tier not set — using neutral",
              breakdown.program, 45, breakdown.programWasDefaulted,
            )}

            {scoreRow(
              "Social Following",
              socialTotal > 0 ? `${compactNum(socialTotal)} total across platforms` : "Add follower counts in Player Info",
              breakdown.social, 45, socialTotal === 0,
            )}
            {socialTotal > 0 && (
              <div className="flex flex-wrap gap-x-5 gap-y-1 pl-0.5">
                {platforms.filter((p) => p.n != null).map((p) => (
                  <span key={p.key} className="text-[11px] text-muted-foreground">
                    <span className="font-mono font-semibold text-foreground">{compactNum(p.n as number)}</span> {p.key}{p.handle ? ` · ${p.handle.startsWith("@") ? p.handle : "@" + p.handle}` : ""}
                  </span>
                ))}
              </div>
            )}

            {/* University Connection — the nudge: when unscored, prompt to add. */}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">University Connection</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {connTier ? `${CONN_LABEL[connTier] ?? connTier}${pInfo?.university_connection_note ? ` · ${pInfo.university_connection_note}` : ""}` : "Not scored — legacy or family ties add value"}
                </div>
              </div>
              {connTier ? (
                <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-[#D4AF37]">+{breakdown.connection}<span className="text-[10px] text-muted-foreground">/20</span></span>
              ) : (
                <button onClick={onEditMarketability} disabled={!onEditMarketability} className="shrink-0 text-[11px] font-semibold text-[#D4AF37] hover:underline disabled:opacity-50">Add →</button>
              )}
            </div>

            {scoreRow(
              "Draft Context",
              draftRank != null ? `#${draftRank} on the draft board` : "Not on the draft board",
              breakdown.draft, 15, draftRank == null,
            )}
          </div>
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
