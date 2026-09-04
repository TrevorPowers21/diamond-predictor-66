import { useMemo, useState } from "react";
import { useGmAgents } from "@/gm/hooks/useGmAgents";
import { AgentDetailDialog, PickAgentDialog } from "@/gm/components/AgentDetailDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Briefcase, Plus } from "lucide-react";

const OSWALD = { fontFamily: "Oswald, sans-serif" } as const;

/**
 * The agent block on a player's profile.
 *
 * WHO represents a player is global — every program sees the same answer, and
 * anyone can set it. What sits BEHIND the agent popup (your contact log, your
 * private numbers) is program-scoped by RLS. So this card is safe to render for
 * any viewer; the popup handles its own scoping.
 *
 * playerId must be the players.id UUID. The hub's route param can be a legacy
 * source_player_id, which would not satisfy the player_agents foreign key.
 */
export function RepresentationCard({ playerId, playerName }: { playerId: string | null; playerName: string }) {
  const { agents, agencies, clients } = useGmAgents();
  const [pickOpen, setPickOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  const link = useMemo(
    () => (playerId ? clients.find((c) => c.player_id === playerId) ?? null : null),
    [clients, playerId],
  );
  const agent = useMemo(
    () => (link ? agents.find((a) => a.id === link.agent_id) ?? null : null),
    [agents, link],
  );
  const agencyName = agent?.agency_id ? agencies.find((g) => g.id === agent.agency_id)?.name ?? null : null;

  return (
    <>
      <Card className="border-border/60">
        <CardContent className="space-y-2 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>Representation</h3>
            {agent ? (
              <Button size="sm" variant="ghost" className="h-7 cursor-pointer text-[11px]" onClick={() => setPickOpen(true)}>Change</Button>
            ) : (
              <Button size="sm" variant="ghost" className="h-7 cursor-pointer gap-1 text-[11px]"
                disabled={!playerId} onClick={() => setPickOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Add Agent
              </Button>
            )}
          </div>

          {agent ? (
            <button onClick={() => setDetailOpen(true)}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-md border border-border/60 px-3 py-2 text-left transition-colors duration-150 hover:border-[#D4AF37]/60 hover:bg-muted/10">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#D4AF37]/12 text-[11px] font-bold text-[#D4AF37]" style={OSWALD}>
                {(agent.first_name[0] ?? "") + (agent.last_name[0] ?? "")}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{agent.first_name} {agent.last_name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {[agencyName ?? "Independent", agent.title].filter(Boolean).join(" · ")}
                </span>
              </span>
              <Briefcase className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          ) : (
            <p className="text-xs text-muted-foreground">
              {playerId ? "No agent on file." : "Representation is unavailable for this player record."}
            </p>
          )}
        </CardContent>
      </Card>

      {playerId && (
        <PickAgentDialog open={pickOpen} onOpenChange={setPickOpen} playerId={playerId} playerName={playerName} />
      )}
      <AgentDetailDialog agent={agent} agencyName={agencyName} open={detailOpen} onOpenChange={setDetailOpen} />
    </>
  );
}
