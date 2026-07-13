import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useGmRoster } from "@/gm/hooks/useGmRoster";
import { useGmContracts } from "@/gm/hooks/useGmContracts";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { IdCard, ChevronRight, Search } from "lucide-react";

const OSWALD = { fontFamily: "Oswald, sans-serif" } as const;
const money = (n: number | null | undefined) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));

/** Internal player roster → click through to each player's front-office profile. */
export default function GMPlayers() {
  const gm = useGmRoster();
  const { allContracts } = useGmContracts();
  const [q, setQ] = useState("");

  const contractsByPlayer = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of allContracts) m.set(c.player_id, (m.get(c.player_id) ?? 0) + 1);
    return m;
  }, [allContracts]);

  const players = useMemo(() => {
    const rows = [...gm.hitters, ...gm.pitchers].filter((r) => r.player_id);
    const seen = new Set<string>();
    const uniq = rows.filter((r) => { if (seen.has(r.player_id!)) return false; seen.add(r.player_id!); return true; });
    const needle = q.trim().toLowerCase();
    return uniq
      .filter((r) => !needle || r.name.toLowerCase().includes(needle))
      .sort((a, b) => (b.actual_pay ?? 0) - (a.actual_pay ?? 0));
  }, [gm.hitters, gm.pitchers, q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <IdCard className="h-5 w-5 text-[#D4AF37]" />
          <h2 className="text-2xl font-bold leading-tight" style={OSWALD}>Player Profiles</h2>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search players" className="h-8 w-56 pl-8 text-xs" />
        </div>
      </div>

      {gm.isLoading ? (
        <Card className="border-border/60"><CardContent className="py-16 text-center text-sm text-muted-foreground">Loading…</CardContent></Card>
      ) : players.length === 0 ? (
        <Card className="border-border/60"><CardContent className="py-16 text-center text-sm text-muted-foreground">No players on this build.</CardContent></Card>
      ) : (
        <Card className="border-border/60">
          <CardContent className="p-0">
            {players.map((r) => (
              <Link key={r.player_id} to={`/gm/players/${r.player_id}`}
                className="flex items-center gap-3 border-b border-border/40 px-4 py-2.5 transition-colors last:border-0 hover:bg-muted/40">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#D4AF37]/15 text-[11px] font-bold text-[#D4AF37]">{r.name[0]}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.name}</div>
                  <div className="text-[11px] text-muted-foreground">{[r.position, r.eligibility_class || r.class_year].filter(Boolean).join(" · ")}</div>
                </div>
                {contractsByPlayer.get(r.player_id!) ? (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{contractsByPlayer.get(r.player_id!)} contract{contractsByPlayer.get(r.player_id!)! > 1 ? "s" : ""}</span>
                ) : null}
                <span className="w-20 text-right font-mono text-sm font-semibold tabular-nums text-[#D4AF37]">{money(r.actual_pay ?? r.nil_value)}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
