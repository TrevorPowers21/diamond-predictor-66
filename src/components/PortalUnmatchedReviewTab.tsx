import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, X, Users, ExternalLink, Mail, Phone, Link2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { profileRouteFor } from "@/lib/profileRoutes";

type Reason = "ambiguous" | "no_match" | "no_stats";

interface UnmatchedRow {
  id: string;
  first_name: string;
  last_name: string;
  year_class: string | null;
  division: string | null;
  current_school: string | null;
  position: string | null;
  high_school: string | null;
  home_state: string | null;
  conference: string | null;
  portal_entry_date: string | null;
  commit_school: string | null;
  commit_date: string | null;
  athletic_aid: string | null;
  contact_cell: string | null;
  contact_email: string | null;
  gpa: number | null;
  va_roster_link: string | null;
  reason: Reason;
  candidate_player_ids: string[] | null;
  ingested_at: string;
  gp: number | null;
  ab: number | null;
  ip: number | null;
}

interface CandidatePlayer {
  id: string;
  first_name: string;
  last_name: string;
  team: string | null;
  position: string | null;
  class_year: string | null;
}

const REASON_CONFIG: Record<Reason, { label: string; color: string; bg: string; description: string }> = {
  ambiguous:  { label: "Ambiguous",  color: "text-amber-600",   bg: "bg-amber-500/10",  description: "Multiple players match — pick the right one" },
  no_match:   { label: "No Match",   color: "text-rose-600",    bg: "bg-rose-500/10",   description: "Not found in RSTR IQ — likely a roster gap" },
  no_stats:   { label: "No Stats",   color: "text-slate-500",   bg: "bg-slate-500/10",  description: "Portal player without 2026 stats — informational only" },
};

/**
 * Search-and-link popover for an unmatched row.
 *
 * Two-tier strategy to catch name variations (Chris vs Christopher etc.):
 *
 *  1. Pre-load the full D1 roster of the unmatched row's `current_school`
 *     on open. Coach scans the list and spots the canonical-name variant.
 *  2. As the coach types, fall back to a server-side ilike search across
 *     all D1 — for cases where the school name itself didn't fuzzy-match
 *     (Long Island vs Long Island University, etc.).
 *
 * Used on no_match / no_stats rows (ambiguous rows have their own
 * candidate-button UI above).
 */
function LinkPlayerPopover({
  row,
  defaultQuery,
  onLink,
  isPending,
}: {
  row: UnmatchedRow;
  defaultQuery: string;
  onLink: (playerId: string) => void;
  isPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Pre-load the unmatched row's school roster on open
  const schoolKey = (row.current_school || "").trim();
  const { data: schoolRoster = [] } = useQuery<CandidatePlayer[]>({
    queryKey: ["link-school-roster", schoolKey],
    enabled: open && !!schoolKey,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      // ilike against the full school name + a normalized variant (strip "University", "of", etc.)
      const norm = schoolKey.replace(/\buniversity\b/gi, "").replace(/\bof\b/gi, "").replace(/\bthe\b/gi, "").trim();
      const { data } = await (supabase as any)
        .from("players")
        .select("id, first_name, last_name, team, position, class_year")
        .eq("division", "D1")
        .or(`team.ilike.%${schoolKey}%,team.ilike.%${norm}%`)
        .limit(60);
      return (data as CandidatePlayer[]) ?? [];
    },
  });

  // Server search across all D1 when coach starts typing
  const { data: serverResults = [], isFetching: serverLoading } = useQuery<CandidatePlayer[]>({
    queryKey: ["link-player-search", query],
    enabled: open && query.trim().length >= 2,
    staleTime: 30_000,
    queryFn: async () => {
      const terms = query.trim().split(/\s+/);
      let q = (supabase as any)
        .from("players")
        .select("id, first_name, last_name, team, position, class_year")
        .eq("division", "D1");
      if (terms.length >= 2) {
        q = q.ilike("first_name", `%${terms[0]}%`).ilike("last_name", `%${terms.slice(1).join(" ")}%`);
      } else {
        q = q.or(`first_name.ilike.%${terms[0]}%,last_name.ilike.%${terms[0]}%`);
      }
      const { data } = await q.limit(20);
      return (data as CandidatePlayer[]) ?? [];
    },
  });

  // Client-side filter the school roster against the typed query so the
  // coach can narrow Monmouth's 30 players down to "Walsh" in one keystroke.
  const filterRoster = (list: CandidatePlayer[]) => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) =>
      `${p.first_name ?? ""} ${p.last_name ?? ""}`.toLowerCase().includes(q),
    );
  };
  const filteredRoster = filterRoster(schoolRoster);
  // Merge: school roster first (deduped), then server matches not already in roster.
  const seen = new Set(filteredRoster.map((p) => p.id));
  const extra = serverResults.filter((p) => !seen.has(p.id));
  const isFetching = serverLoading;

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (v) setQuery(""); }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-[11px] cursor-pointer"
          title="Search and link to a player profile"
        >
          <Link2 className="w-3.5 h-3.5 mr-1" />
          Link
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-[380px] p-0 overflow-hidden border-l-[3px] border-l-[#D4AF37]">
        <div className="bg-[#0D1B3E] px-4 py-2.5 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Search className="w-3 h-3 text-[#D4AF37]" />
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#D4AF37]" style={{ fontFamily: "Oswald, sans-serif" }}>
              Find Player
            </span>
          </span>
          {row.current_school && (
            <span className="text-[9px] text-[#D4AF37]/70 truncate max-w-[180px]">{row.current_school}</span>
          )}
        </div>
        <div className="px-3 py-3 space-y-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Filter ${schoolKey || "D1 players"}…`}
            className="h-8 text-xs"
          />
          <div className="max-h-[280px] overflow-y-auto space-y-1">
            {filteredRoster.length === 0 && extra.length === 0 ? (
              query.trim().length === 0 && schoolRoster.length === 0 ? (
                <p className="text-[11px] text-muted-foreground px-1 py-2">Loading school roster…</p>
              ) : query.trim().length >= 2 && isFetching ? (
                <p className="text-[11px] text-muted-foreground px-1 py-2">Searching…</p>
              ) : (
                <p className="text-[11px] text-muted-foreground px-1 py-2">No matches. Try a different name or check the search box for typos.</p>
              )
            ) : (
              <>
                {filteredRoster.length > 0 && (
                  <>
                    <p className="text-[9px] uppercase tracking-wider text-muted-foreground px-1 pt-1 pb-1">
                      {schoolKey ? `${schoolKey} roster` : "Roster"} ({filteredRoster.length})
                    </p>
                    {filteredRoster.map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-muted/60 transition-colors">
                        <div className="text-[11px] min-w-0 flex-1">
                          <div className="font-medium text-foreground truncate">{p.first_name} {p.last_name}</div>
                          <div className="text-muted-foreground text-[10px] truncate">
                            {[p.team, p.position, p.class_year].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => { onLink(p.id); setOpen(false); }}
                          disabled={isPending}
                          className="h-7 text-[10px] bg-[#D4AF37] text-black hover:bg-[#A08820] font-semibold uppercase tracking-wider cursor-pointer"
                        >
                          Link
                        </Button>
                      </div>
                    ))}
                  </>
                )}
                {extra.length > 0 && (
                  <>
                    <p className="text-[9px] uppercase tracking-wider text-muted-foreground px-1 pt-2 pb-1">
                      Other D1 ({extra.length})
                    </p>
                    {extra.map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-muted/60 transition-colors">
                        <div className="text-[11px] min-w-0 flex-1">
                          <div className="font-medium text-foreground truncate">{p.first_name} {p.last_name}</div>
                          <div className="text-muted-foreground text-[10px] truncate">
                            {[p.team, p.position, p.class_year].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => { onLink(p.id); setOpen(false); }}
                          disabled={isPending}
                          className="h-7 text-[10px] bg-[#D4AF37] text-black hover:bg-[#A08820] font-semibold uppercase tracking-wider cursor-pointer"
                        >
                          Link
                        </Button>
                      </div>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function PortalUnmatchedReviewTab() {
  const queryClient = useQueryClient();
  const [activeReason, setActiveReason] = useState<Reason>("ambiguous");

  const { data: rows = [], isLoading } = useQuery<UnmatchedRow[]>({
    queryKey: ["portal_unmatched"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("portal_entries_unmatched")
        .select("*")
        .eq("resolved", false)
        .order("ingested_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Pre-fetch candidate players for ambiguous rows
  const allCandidateIds = Array.from(new Set(rows.flatMap((r) => r.candidate_player_ids ?? [])));
  const { data: candidates = [] } = useQuery<CandidatePlayer[]>({
    queryKey: ["portal_unmatched_candidates", allCandidateIds.sort().join(",")],
    queryFn: async () => {
      if (allCandidateIds.length === 0) return [];
      const { data, error } = await (supabase as any)
        .from("players")
        .select("id, first_name, last_name, team, position, class_year")
        .in("id", allCandidateIds);
      if (error) throw error;
      return data ?? [];
    },
    enabled: allCandidateIds.length > 0,
  });

  const candidateMap = new Map(candidates.map((c) => [c.id, c]));

  const linkMutation = useMutation({
    mutationFn: async ({ unmatched, playerId }: { unmatched: UnmatchedRow; playerId: string }) => {
      const isCommitted = !!unmatched.commit_school;
      const status = isCommitted ? "COMMITTED" : "IN PORTAL";

      // Apply VA fields to selected player
      const { error: updErr } = await (supabase as any)
        .from("players")
        .update({
          portal_status: status,
          transfer_portal: true,
          portal_entry_date: unmatched.portal_entry_date,
          portal_last_seen_at: new Date().toISOString(),
          commit_school: unmatched.commit_school,
          commit_date: unmatched.commit_date,
          athletic_aid: unmatched.athletic_aid,
          contact_cell: unmatched.contact_cell,
          contact_email: unmatched.contact_email,
          gpa: unmatched.gpa,
          va_roster_link: unmatched.va_roster_link,
        })
        .eq("id", playerId);
      if (updErr) throw updErr;

      // Mark unmatched row resolved
      const { error: resErr } = await (supabase as any)
        .from("portal_entries_unmatched")
        .update({ resolved: true, resolved_player_id: playerId })
        .eq("id", unmatched.id);
      if (resErr) throw resErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal_unmatched"] });
      toast.success("Linked & resolved");
    },
    onError: (e: any) => toast.error(`Failed: ${e.message ?? e}`),
  });

  const dismissMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("portal_entries_unmatched")
        .update({ resolved: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal_unmatched"] });
      toast.success("Dismissed");
    },
    onError: (e: any) => toast.error(`Failed: ${e.message ?? e}`),
  });

  // Sort by sample size first — IP for pitchers, AB for hitters. Bigger sample = more
  // useful to triage. Pitchers identified by position regex.
  const isPitcherPos = (p: string | null) => !!p && /^(SP|RP|CL|P|LHP|RHP)$/i.test(p);
  const sampleVal = (r: UnmatchedRow) => (isPitcherPos(r.position) ? r.ip : r.ab) ?? -1;
  const sortBySample = (a: UnmatchedRow, b: UnmatchedRow) => sampleVal(b) - sampleVal(a);
  const grouped = {
    ambiguous: rows.filter((r) => r.reason === "ambiguous").sort(sortBySample),
    no_match:  rows.filter((r) => r.reason === "no_match").sort(sortBySample),
    no_stats:  rows.filter((r) => r.reason === "no_stats").sort(sortBySample),
  };
  const active = grouped[activeReason];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-1">
        <AlertTriangle className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground">Portal Unmatched Review</h3>
        <span className="text-[11px] text-muted-foreground">— Verified Athletics rows that didn't auto-link to a RSTR IQ player</span>
      </div>

      <div className="flex gap-2">
        {(Object.keys(grouped) as Reason[]).map((r) => {
          const cfg = REASON_CONFIG[r];
          const count = grouped[r].length;
          return (
            <button
              key={r}
              onClick={() => setActiveReason(r)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider cursor-pointer transition-colors duration-200 ${
                activeReason === r ? `${cfg.bg} ${cfg.color} ring-1 ring-current/30` : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {cfg.label} <span className="ml-1.5 opacity-70">({count})</span>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground px-1">{REASON_CONFIG[activeReason].description}</p>

      {isLoading ? (
        <p className="text-sm text-muted-foreground px-1">Loading…</p>
      ) : active.length === 0 ? (
        <Card className="p-6 text-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Nothing to review under {REASON_CONFIG[activeReason].label.toLowerCase()}.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {active.map((row) => (
            <Card key={row.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <h4 className="text-sm font-semibold text-foreground">
                      {row.first_name} {row.last_name}
                    </h4>
                    {row.position && <Badge variant="outline" className="text-[10px]">{row.position}</Badge>}
                    {row.year_class && <Badge variant="outline" className="text-[10px]">{row.year_class}</Badge>}
                    {row.division && <Badge variant="outline" className="text-[10px]">{row.division}</Badge>}
                    {row.commit_school && (
                      <Badge className="bg-blue-500/10 text-blue-600 border-0 text-[10px]">
                        → {row.commit_school}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-wrap text-[12px] text-muted-foreground">
                    {row.current_school && <span>{row.current_school}</span>}
                    {row.conference && <span>· {row.conference}</span>}
                    {(() => {
                      const isPitcher = !!row.position && /^(SP|RP|CL|P|LHP|RHP)$/i.test(row.position);
                      const sample = isPitcher ? row.ip : row.ab;
                      const unit = isPitcher ? "IP" : "AB";
                      if (sample == null) return null;
                      return <span className="font-mono tabular-nums">· {sample} {unit}</span>;
                    })()}
                    {row.portal_entry_date && <span>· entered {row.portal_entry_date}</span>}
                  </div>
                  {(row.contact_cell || row.contact_email || row.va_roster_link) && (
                    <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground mt-1.5">
                      {row.contact_cell && (
                        <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{row.contact_cell}</span>
                      )}
                      {row.contact_email && (
                        <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{row.contact_email}</span>
                      )}
                      {row.va_roster_link && (
                        <a
                          href={row.va_roster_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 hover:text-[#D4AF37] cursor-pointer transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" /> Roster
                        </a>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <LinkPlayerPopover
                    row={row}
                    defaultQuery={`${row.first_name} ${row.last_name}`.trim()}
                    onLink={(playerId) => linkMutation.mutate({ unmatched: row, playerId })}
                    isPending={linkMutation.isPending}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => dismissMutation.mutate(row.id)}
                    disabled={dismissMutation.isPending}
                    className="h-8 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                    title="Mark resolved without linking"
                  >
                    <X className="w-3.5 h-3.5 mr-1" />
                    Dismiss
                  </Button>
                </div>
              </div>

              {row.reason === "ambiguous" && row.candidate_player_ids && row.candidate_player_ids.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border/50">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Users className="w-3 h-3" /> Candidates
                  </p>
                  <div className="space-y-1.5">
                    {row.candidate_player_ids.map((cid) => {
                      const cand = candidateMap.get(cid);
                      if (!cand) return null;
                      return (
                        <div key={cid} className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-muted/40 hover:bg-muted transition-colors">
                          <a
                            href={profileRouteFor(cand.id, cand.position)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[12px] text-foreground hover:text-[#D4AF37] cursor-pointer flex items-center gap-1.5 min-w-0 flex-1"
                            title="Open profile in new tab to verify"
                          >
                            <span className="font-medium truncate">{cand.first_name} {cand.last_name}</span>
                            <span className="text-muted-foreground truncate">
                              {cand.team ? ` · ${cand.team}` : ""}
                              {cand.position ? ` · ${cand.position}` : ""}
                              {cand.class_year ? ` · ${cand.class_year}` : ""}
                            </span>
                            <ExternalLink className="w-3 h-3 shrink-0 opacity-60" />
                          </a>
                          <Button
                            size="sm"
                            onClick={() => linkMutation.mutate({ unmatched: row, playerId: cid })}
                            disabled={linkMutation.isPending}
                            className="h-7 text-[11px] bg-[#D4AF37] text-black hover:bg-[#A08820] font-semibold uppercase tracking-wider cursor-pointer shrink-0"
                          >
                            Link
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
