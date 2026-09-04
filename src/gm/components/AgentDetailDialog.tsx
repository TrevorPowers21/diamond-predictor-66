import { useEffect, useMemo, useState } from "react";
import { useGmAgents, type Agent, type ContactKind, type ContactVisibility, type NoteKind } from "@/gm/hooks/useGmAgents";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { PlayerLink } from "@/gm/components/PlayerLink";
import { toast } from "sonner";
import { Globe, Lock, Trash2, Search, Plus, X } from "lucide-react";

const OSWALD = { fontFamily: "Oswald, sans-serif" } as const;
const CONTACT_KINDS: ContactKind[] = ["email", "phone", "cell", "x", "instagram", "linkedin", "website", "other"];
const NOTE_KINDS: NoteKind[] = ["note", "call", "email", "text", "meeting", "other"];
const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

type Found = { id: string; name: string; team: string | null; position: string | null };

/** Search all players by name to link one to this agent. */
function AddClient({ agentId, onDone }: { agentId: string; onDone: () => void }) {
  const { linkPlayer } = useGmAgents();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [searching, setSearching] = useState(false);
  const [pending, setPending] = useState<Found | null>(null); // awaiting replace confirmation

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); return; }
    // PostgREST .or() takes a comma-separated filter string, so strip the
    // characters that would break out of it rather than escaping them.
    const safe = term.replace(/[,()*%]/g, " ").trim();
    if (!safe) { setResults([]); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const { data } = await (supabase as any).from("players")
        .select("id, first_name, last_name, team, position")
        .or(`first_name.ilike.%${safe}%,last_name.ilike.%${safe}%`)
        .limit(25);
      if (cancelled) return;
      setResults((data ?? []).map((p: any) => ({
        id: p.id, name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
        team: p.team ?? null, position: p.position ?? null,
      })));
      setSearching(false);
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  const link = async (p: Found, replace: boolean) => {
    const r = await linkPlayer(p.id, agentId, replace);
    if (r === "conflict") { setPending(p); return; }
    if (r === "ok") {
      toast.success(`${p.name} linked${replace ? " — previous agent ended" : ""}.`);
      setPending(null); setQ(""); setResults([]); onDone();
    }
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any player by name…" className="h-8 pl-8 text-xs" />
      </div>

      {pending && (
        <div className="space-y-2 rounded-md border border-[#D4AF37]/40 bg-[#D4AF37]/[0.06] p-2.5 text-xs">
          <p><span className="font-semibold">{pending.name}</span> already has a different agent. Replacing ends that link and keeps it as history.</p>
          <div className="flex gap-1.5">
            <Button size="sm" className="h-7 text-xs" onClick={() => link(pending, true)}>Replace</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPending(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {q.trim().length >= 2 && !searching && results.length === 0 && (
        <p className="text-[11px] text-muted-foreground">No players match "{q}".</p>
      )}
      {results.length > 0 && (
        <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-md border border-border/60 p-1">
          {results.map((p) => (
            <button key={p.id} onClick={() => link(p, false)}
              className="flex w-full cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-muted/30">
              <span className="truncate font-medium">{p.name}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{[p.position, p.team].filter(Boolean).join(" · ") || "—"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The agent popup. Opened from the Agents page and from a player's profile, so
 * both routes show one identical view of an agent rather than two drifting ones.
 */
export function AgentDetailDialog({ agent, agencyName, open, onOpenChange }: {
  agent: Agent | null; agencyName: string | null; open: boolean; onOpenChange: (o: boolean) => void;
}) {
  const { clients, contacts, notes, addContact, removeContact, addNote, removeNote, unlinkPlayer } = useGmAgents();
  const [adding, setAdding] = useState(false);
  const [cKind, setCKind] = useState<ContactKind>("email");
  const [cValue, setCValue] = useState("");
  const [cVis, setCVis] = useState<ContactVisibility>("global");
  const [nKind, setNKind] = useState<NoteKind>("note");
  const [nBody, setNBody] = useState("");

  const id = agent?.id ?? "";
  const myClients = useMemo(() => clients.filter((c) => c.agent_id === id), [clients, id]);
  const myContacts = useMemo(() => contacts.filter((c) => c.agent_id === id), [contacts, id]);
  const myNotes = useMemo(() => notes.filter((n) => n.agent_id === id), [notes, id]);

  if (!agent) return null;
  const fullName = `${agent.first_name} ${agent.last_name}`;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setAdding(false); setCValue(""); setNBody(""); } onOpenChange(o); }}>
      <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle style={OSWALD}>{fullName}</DialogTitle>
          <p className="text-xs text-muted-foreground">
            {[agencyName ?? "Independent", agent.title].filter(Boolean).join(" · ")}
          </p>
        </DialogHeader>

        <div className="space-y-3">
          {/* Clients */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" style={OSWALD}>
                Clients ({myClients.length})
              </span>
              <Button size="sm" variant="ghost" className="h-7 cursor-pointer gap-1 text-xs" onClick={() => setAdding((a) => !a)}>
                {adding ? <><X className="h-3.5 w-3.5" /> Close</> : <><Plus className="h-3.5 w-3.5" /> Add Player</>}
              </Button>
            </div>
            {adding && <AddClient agentId={agent.id} onDone={() => setAdding(false)} />}
            {myClients.length === 0 && !adding && <p className="text-[11px] text-muted-foreground">No players linked yet.</p>}
            {myClients.map((c) => (
              <div key={c.link_id} className="flex items-center justify-between gap-2 text-xs">
                <PlayerLink playerId={c.player_id} name={c.name} className="truncate font-medium" />
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">{[c.position, c.team].filter(Boolean).join(" · ") || "—"}</span>
                  <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-rose-400"
                    title="Unlink" onClick={() => unlinkPlayer(c.player_id)}><Trash2 className="h-3 w-3" /></Button>
                </div>
              </div>
            ))}
          </div>

          {/* Contact — shared vs private is marked on every row */}
          <div className="space-y-1.5 border-t border-border/50 pt-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" style={OSWALD}>Contact</span>
            {myContacts.length === 0 && <p className="text-[11px] text-muted-foreground">No contact details yet.</p>}
            {myContacts.map((c) => (
              <div key={c.id} className="flex items-center gap-2 text-xs">
                {c.visibility === "global"
                  ? <Globe className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Shared with every program" />
                  : <Lock className="h-3 w-3 shrink-0 text-[#D4AF37]" aria-label="Private to your program" />}
                <span className="w-16 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">{c.kind}</span>
                <span className="min-w-0 flex-1 truncate">{c.value}</span>
                <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-rose-400"
                  title="Remove" onClick={() => removeContact(c.id)}><Trash2 className="h-3 w-3" /></Button>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <Select value={cKind} onValueChange={(v) => setCKind(v as ContactKind)}>
                <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{CONTACT_KINDS.map((k) => <SelectItem key={k} value={k} className="text-xs capitalize">{k}</SelectItem>)}</SelectContent>
              </Select>
              <Input value={cValue} onChange={(e) => setCValue(e.target.value)} placeholder="Add contact…" className="h-8 flex-1 text-xs" />
              <Select value={cVis} onValueChange={(v) => setCVis(v as ContactVisibility)}>
                <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="global" className="text-xs">Shared</SelectItem>
                  <SelectItem value="program" className="text-xs">Private</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" variant="ghost" className="h-8 shrink-0 cursor-pointer text-xs" disabled={!cValue.trim()}
                onClick={async () => { await addContact({ agentId: agent.id, kind: cKind, value: cValue, visibility: cVis }); setCValue(""); }}>Add</Button>
            </div>
          </div>

          {/* Notes + contact log — always program-private */}
          <div className="space-y-1.5 border-t border-border/50 pt-2.5">
            <div className="flex items-center gap-1.5">
              <Lock className="h-3 w-3 text-[#D4AF37]" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" style={OSWALD}>Notes &amp; Contact Log</span>
              <span className="text-[10px] text-muted-foreground">— private to your program</span>
            </div>
            {myNotes.length === 0 && <p className="text-[11px] text-muted-foreground">Nothing logged yet.</p>}
            {myNotes.map((n) => (
              <div key={n.id} className="flex items-start gap-2 text-xs">
                <span className="w-14 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">{n.kind}</span>
                <span className="min-w-0 flex-1">{n.body}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{fmtDate(n.occurred_at)}</span>
                <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-rose-400"
                  title="Remove" onClick={() => removeNote(n.id)}><Trash2 className="h-3 w-3" /></Button>
              </div>
            ))}
            <div className="flex items-start gap-1.5">
              <Select value={nKind} onValueChange={(v) => setNKind(v as NoteKind)}>
                <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{NOTE_KINDS.map((k) => <SelectItem key={k} value={k} className="text-xs capitalize">{k}</SelectItem>)}</SelectContent>
              </Select>
              <Textarea value={nBody} onChange={(e) => setNBody(e.target.value)} placeholder="Log a call, email or note…" className="min-h-[32px] flex-1 text-xs" />
              <Button size="sm" variant="ghost" className="h-8 shrink-0 cursor-pointer text-xs" disabled={!nBody.trim()}
                onClick={async () => { await addNote({ agentId: agent.id, kind: nKind, body: nBody }); setNBody(""); }}>Log</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Pick an agent to represent a player. Used from the player profile. */
export function PickAgentDialog({ open, onOpenChange, playerId, playerName }: {
  open: boolean; onOpenChange: (o: boolean) => void; playerId: string; playerName: string;
}) {
  const { agents, agencies, linkPlayer } = useGmAgents();
  const [q, setQ] = useState("");
  const [pending, setPending] = useState<Agent | null>(null);
  const agencyById = useMemo(() => new Map(agencies.map((a) => [a.id, a.name])), [agencies]);

  // Agents are already loaded in full (a few hundred at most), so this filters
  // in memory rather than round-tripping per keystroke.
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const sorted = [...agents].sort((a, b) => a.last_name.localeCompare(b.last_name));
    if (!term) return sorted.slice(0, 40);
    return sorted.filter((a) =>
      `${a.first_name} ${a.last_name}`.toLowerCase().includes(term) ||
      (a.agency_id ? (agencyById.get(a.agency_id) ?? "") : "independent").toLowerCase().includes(term)).slice(0, 40);
  }, [agents, q, agencyById]);

  const link = async (a: Agent, replace: boolean) => {
    const r = await linkPlayer(playerId, a.id, replace);
    if (r === "conflict") { setPending(a); return; }
    if (r === "ok") {
      toast.success(`${playerName} linked to ${a.first_name} ${a.last_name}.`);
      setPending(null); setQ(""); onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setQ(""); setPending(null); } onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle style={OSWALD}>Add Agent</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search agent or agency…" className="h-8 pl-8 text-sm" />
          </div>

          {pending && (
            <div className="space-y-2 rounded-md border border-[#D4AF37]/40 bg-[#D4AF37]/[0.06] p-2.5 text-xs">
              <p><span className="font-semibold">{playerName}</span> already has a different agent. Replacing ends that link and keeps it as history.</p>
              <div className="flex gap-1.5">
                <Button size="sm" className="h-7 text-xs" onClick={() => link(pending, true)}>Replace</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPending(null)}>Cancel</Button>
              </div>
            </div>
          )}

          <div className="max-h-72 space-y-0.5 overflow-y-auto rounded-md border border-border/60 p-1">
            {filtered.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">No agents match "{q}".</p>}
            {filtered.map((a) => (
              <button key={a.id} onClick={() => link(a, false)}
                className="flex w-full cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-muted/30">
                <span className="truncate font-medium">{a.first_name} {a.last_name}</span>
                <span className={cn("shrink-0 text-[10px]", a.agency_id ? "text-muted-foreground" : "italic text-muted-foreground/70")}>
                  {a.agency_id ? agencyById.get(a.agency_id) : "Independent"}
                </span>
              </button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
