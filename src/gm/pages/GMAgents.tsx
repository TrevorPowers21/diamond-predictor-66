import { useMemo, useState } from "react";
import { useGmAgents, type Agent } from "@/gm/hooks/useGmAgents";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { AgentDetailDialog } from "@/gm/components/AgentDetailDialog";
import { Briefcase, Plus, Search, Building2, ChevronDown } from "lucide-react";

const OSWALD = { fontFamily: "Oswald, sans-serif" } as const;

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={cn("space-y-1", full && "col-span-2")}>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

/* ─────────────────────────── Add dialogs ─────────────────────────── */

function AddAgencyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { addAgency } = useGmAgents();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const id = await addAgency(name);
    setBusy(false);
    if (id) { setName(""); onOpenChange(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setName(""); onOpenChange(o); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle style={OSWALD}>Add Agency</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Field label="Agency name" full>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Boras Corporation" className="h-9 text-sm" />
          </Field>
          <p className="text-[11px] text-muted-foreground">
            Agencies are shared across every program. Typing one that already exists recognizes it
            instead of creating a duplicate.
          </p>
        </div>
        <DialogFooter>
          <Button size="sm" disabled={!name.trim() || busy} onClick={save}>{busy ? "Saving…" : "Save Agency"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddAgentDialog({ open, onOpenChange, defaultAgencyId }: {
  open: boolean; onOpenChange: (o: boolean) => void; defaultAgencyId?: string | null;
}) {
  const { agencies, addAgent } = useGmAgents();
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [title, setTitle] = useState("");
  // "__none" = unaffiliated. College baseball has plenty of solo operators, so an
  // agency is genuinely optional rather than a field left blank by accident.
  // ⚠ Sentinel, not "": Radix throws if a SelectItem value is the empty string,
  // which it reserves internally for "nothing selected".
  const [agencyId, setAgencyId] = useState<string>(defaultAgencyId ?? "__none");
  const [newAgency, setNewAgency] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => { setFirst(""); setLast(""); setTitle(""); setAgencyId(defaultAgencyId ?? "__none"); setNewAgency(""); };

  const save = async () => {
    setBusy(true);
    const id = await addAgent({
      first, last, title,
      agencyId: agencyId === "__new" || agencyId === "__none" ? null : agencyId,
      agencyName: agencyId === "__new" ? newAgency : null,
    });
    setBusy(false);
    if (id) { reset(); onOpenChange(false); }
  };

  const ready = first.trim() && last.trim() && (agencyId !== "__new" || newAgency.trim());

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle style={OSWALD}>Add Agent</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name"><Input value={first} onChange={(e) => setFirst(e.target.value)} className="h-9 text-sm" /></Field>
          <Field label="Last name"><Input value={last} onChange={(e) => setLast(e.target.value)} className="h-9 text-sm" /></Field>
          <Field label="Agency" full>
            <Select value={agencyId} onValueChange={setAgencyId}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Independent — no agency" /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="__none" className="text-sm">Independent — no agency</SelectItem>
                {agencies.map((a) => <SelectItem key={a.id} value={a.id} className="text-sm">{a.name}</SelectItem>)}
                <SelectItem value="__new" className="text-sm text-[#D4AF37]">+ New agency…</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {agencyId === "__new" && (
            <Field label="New agency name" full>
              <Input value={newAgency} onChange={(e) => setNewAgency(e.target.value)} placeholder="Agency name" className="h-9 text-sm" />
            </Field>
          )}
          <Field label="Title" full>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Partner, Baseball Division" className="h-9 text-sm" />
          </Field>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Agents are shared across every program — add contact details and notes after saving.
        </p>
        <DialogFooter>
          <Button size="sm" disabled={!ready || busy} onClick={save}>{busy ? "Saving…" : "Save Agent"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────── Agent tile ─────────────────────────── */

function AgentRow({ agent, agencyName }: { agent: Agent; agencyName: string | null }) {
  const { clients } = useGmAgents();
  const [open, setOpen] = useState(false);

  const myClients = useMemo(() => clients.filter((c) => c.agent_id === agent.id), [clients, agent.id]);
  const fullName = `${agent.first_name} ${agent.last_name}`;
  const sub = [agencyName ?? "Independent", agent.title].filter(Boolean).join(" · ");

  return (
    <>
    <div className="overflow-hidden rounded-lg border border-border/60">
      <div onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-muted/20">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold" style={OSWALD}>{fullName}</div>
          <div className="truncate text-xs text-muted-foreground">{sub}</div>
        </div>
        <span className="shrink-0 rounded border border-[#D4AF37]/30 bg-[#D4AF37]/12 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#D4AF37]">
          {myClients.length} {myClients.length === 1 ? "client" : "clients"}
        </span>
      </div>

    </div>

    <AgentDetailDialog agent={agent} agencyName={agencyName} open={open} onOpenChange={setOpen} />
    </>
  );
}

/* ─────────────────────────── Page ─────────────────────────── */

export default function GMAgents() {
  const { agents, agencies, clients, isLoading } = useGmAgents();
  const [query, setQuery] = useState("");
  const [agencyOpen, setAgencyOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);

  const agencyById = useMemo(() => new Map(agencies.map((a) => [a.id, a.name])), [agencies]);

  // Search spans agent name AND agency, so "Boras" finds every agent there.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...agents].sort((a, b) =>
      a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name));
    if (!q) return sorted;
    return sorted.filter((a) =>
      `${a.first_name} ${a.last_name}`.toLowerCase().includes(q) ||
      (a.agency_id ? (agencyById.get(a.agency_id) ?? "") : "independent").toLowerCase().includes(q));
  }, [agents, query, agencyById]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-[#D4AF37]" />
          <h2 className="text-2xl font-bold leading-tight" style={OSWALD}>Agents</h2>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="h-8 cursor-pointer gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" /> Add <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="cursor-pointer text-sm" onClick={() => setAgentOpen(true)}>
              <Briefcase className="mr-2 h-3.5 w-3.5" /> Add Agent
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer text-sm" onClick={() => setAgencyOpen(true)}>
              <Building2 className="mr-2 h-3.5 w-3.5" /> Add Agency
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <p className="-mt-1 text-xs text-muted-foreground">
        Agents and their clients are shared across every program — representation is fact, not opinion.
        Your contact log and private notes are not.
        {agents.length > 0 && (
          <span className="font-medium text-foreground/80">
            {" "}{agents.length} {agents.length === 1 ? "agent" : "agents"} · {agencies.length} {agencies.length === 1 ? "agency" : "agencies"} · {clients.length} linked {clients.length === 1 ? "player" : "players"}.
          </span>
        )}
      </p>

      {agents.length > 0 && (
        <div className="relative max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search agent or agency…" className="h-8 pl-8 text-sm" />
        </div>
      )}

      {isLoading ? (
        <Card className="border-border/60"><CardContent className="py-16 text-center text-sm text-muted-foreground">Loading…</CardContent></Card>
      ) : agents.length === 0 ? (
        <Card className="border-border/60"><CardContent className="py-16 text-center text-sm text-muted-foreground">No agents yet. Add one to start tracking representation.</CardContent></Card>
      ) : filtered.length === 0 ? (
        <Card className="border-border/60"><CardContent className="py-16 text-center text-sm text-muted-foreground">No agents match "{query}".</CardContent></Card>
      ) : (
        <div className="grid items-start gap-3 lg:grid-cols-2">
          {filtered.map((a) => (
            <AgentRow key={a.id} agent={a} agencyName={a.agency_id ? agencyById.get(a.agency_id) ?? null : null} />
          ))}
        </div>
      )}

      <AddAgencyDialog open={agencyOpen} onOpenChange={setAgencyOpen} />
      <AddAgentDialog open={agentOpen} onOpenChange={setAgentOpen} />
    </div>
  );
}
