import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Agent representation directory.
 *
 * Two scopes live side by side here, and the split is the whole point:
 *
 *   GLOBAL  — agencies, agents, player_agents. Representation is fact, not
 *             opinion, so every program reads the same rows. Writes go through
 *             SECURITY DEFINER RPCs (resolve_or_create_*, link_player_agent)
 *             so dedupe is not optional and no client can skip it.
 *
 *   PROGRAM — gm_agent_notes and agent_contacts with visibility='program'.
 *             Same protection class as player evaluation notes; RLS scopes them
 *             by customer_team_id.
 *
 * Deliberately absent: any "who added this link" field. Provenance lives in
 * player_agents_provenance, which is superadmin-read-only, because a link must
 * look identical no matter which program authored it. RLS is row-level, so a
 * created_by column on a globally-readable row would be readable by everyone.
 */

export type ContactKind = "email" | "phone" | "cell" | "x" | "instagram" | "linkedin" | "website" | "other";
export type ContactVisibility = "global" | "program";
export type NoteKind = "note" | "call" | "email" | "text" | "meeting" | "other";

export interface Agency { id: string; name: string; website: string | null; city: string | null; state: string | null }
export interface Agent {
  id: string;
  first_name: string;
  last_name: string;
  title: string | null;
  agency_id: string | null;
}
export interface AgentContact {
  id: string; agent_id: string; kind: ContactKind; value: string; label: string | null;
  visibility: ContactVisibility; source: string; customer_team_id: string | null;
}
export interface AgentNote {
  id: string; agent_id: string; player_id: string | null; kind: NoteKind;
  body: string | null; occurred_at: string;
}
export interface AgentClient {
  link_id: string; agent_id: string; player_id: string;
  name: string; team: string | null; position: string | null; started_at: string | null;
}

export function useGmAgents() {
  const { user, effectiveTeamId } = useAuth();
  const qc = useQueryClient();

  // Global identity: not keyed on the team, because it is the same for everyone.
  const agenciesKey = ["agents-agencies"];
  const agentsKey = ["agents-agents"];
  const clientsKey = ["agents-clients"];
  // Program-scoped: keyed on the team so switching programs cannot show stale rows.
  const contactsKey = ["agents-contacts", effectiveTeamId ?? null];
  const notesKey = ["agents-notes", effectiveTeamId ?? null];

  const enabled = !!user?.id;

  const { data: agencies = [], isLoading: loadingAgencies } = useQuery({
    queryKey: agenciesKey,
    enabled,
    queryFn: async (): Promise<Agency[]> => {
      const { data, error } = await (supabase as any).from("agencies")
        .select("id, name, website, city, state").order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Agency[];
    },
  });

  const { data: agents = [], isLoading: loadingAgents } = useQuery({
    queryKey: agentsKey,
    enabled,
    queryFn: async (): Promise<Agent[]> => {
      const { data, error } = await (supabase as any).from("agents")
        .select("id, first_name, last_name, title, agency_id")
        .order("last_name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Agent[];
    },
  });

  // Active clients only (ended_at is null). Two queries rather than an embedded
  // select: player_agents has two FKs into different tables and PostgREST
  // relationship naming is easy to get wrong silently.
  const { data: clients = [] } = useQuery({
    queryKey: clientsKey,
    enabled,
    queryFn: async (): Promise<AgentClient[]> => {
      const { data: links, error } = await (supabase as any).from("player_agents")
        .select("id, player_id, agent_id, started_at").is("ended_at", null);
      if (error) throw error;
      const rows = (links ?? []) as any[];
      if (rows.length === 0) return [];
      const { data: players } = await (supabase as any).from("players")
        .select("id, first_name, last_name, team, position")
        .in("id", rows.map((r) => r.player_id));
      const byId = new Map((players ?? []).map((p: any) => [p.id, p]));
      return rows.map((r) => {
        const p: any = byId.get(r.player_id);
        return {
          link_id: r.id, agent_id: r.agent_id, player_id: r.player_id,
          name: p ? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() : "Unknown player",
          team: p?.team ?? null, position: p?.position ?? null, started_at: r.started_at,
        };
      });
    },
  });

  // RLS returns global rows plus this program's own; no client-side filter needed.
  const { data: contacts = [] } = useQuery({
    queryKey: contactsKey,
    enabled,
    queryFn: async (): Promise<AgentContact[]> => {
      const { data, error } = await (supabase as any).from("agent_contacts")
        .select("id, agent_id, kind, value, label, visibility, source, customer_team_id");
      if (error) throw error;
      return (data ?? []) as AgentContact[];
    },
  });

  const { data: notes = [] } = useQuery({
    queryKey: notesKey,
    enabled: enabled && !!effectiveTeamId,
    queryFn: async (): Promise<AgentNote[]> => {
      const { data, error } = await (supabase as any).from("gm_agent_notes")
        .select("id, agent_id, player_id, kind, body, occurred_at")
        .eq("customer_team_id", effectiveTeamId)
        .order("occurred_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AgentNote[];
    },
  });

  const refetchGlobal = () => {
    qc.invalidateQueries({ queryKey: agenciesKey });
    qc.invalidateQueries({ queryKey: agentsKey });
    qc.invalidateQueries({ queryKey: clientsKey });
  };

  // ─── Mutations. Identity goes through the RPCs; nothing here inserts into
  //     agencies/agents directly, because only the RPC dedupes. ───

  const addAgency = async (name: string): Promise<string | null> => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const { data, error } = await (supabase as any).rpc("resolve_or_create_agency", { p_name: trimmed });
    if (error) { toast.error(`Agency save failed: ${error.message}`); return null; }
    refetchGlobal();
    return data as string;
  };

  const addAgent = async (a: {
    first: string; last: string; agencyId?: string | null; agencyName?: string | null; title?: string | null;
  }): Promise<string | null> => {
    if (!a.first.trim() || !a.last.trim()) return null;
    const { data, error } = await (supabase as any).rpc("resolve_or_create_agent", {
      p_first: a.first.trim(),
      p_last: a.last.trim(),
      p_agency_id: a.agencyId ?? null,
      p_agency_name: a.agencyName?.trim() || null,
      p_title: a.title?.trim() || null,
    });
    if (error) { toast.error(`Agent save failed: ${error.message}`); return null; }
    refetchGlobal();
    return data as string;
  };

  /**
   * Link a player to an agent. `replace: false` (the default) fails when the
   * player already has a DIFFERENT active agent, so the caller can prompt
   * instead of silently overwriting another program's entry. Re-linking the
   * same agent is a no-op that keeps the original started_at.
   * Returns "conflict" so the UI can offer the replace path.
   */
  const linkPlayer = async (playerId: string, agentId: string, replace = false): Promise<"ok" | "conflict" | "error"> => {
    const { error } = await (supabase as any).rpc("link_player_agent", {
      p_player_id: playerId, p_agent_id: agentId, p_replace: replace, p_started_at: null,
    });
    if (error) {
      if (/already represented/i.test(error.message)) return "conflict";
      toast.error(`Link failed: ${error.message}`);
      return "error";
    }
    refetchGlobal();
    return "ok";
  };

  const unlinkPlayer = async (playerId: string) => {
    const { error } = await (supabase as any).rpc("unlink_player_agent", { p_player_id: playerId });
    if (error) { toast.error(`Unlink failed: ${error.message}`); return; }
    refetchGlobal();
  };

  // visibility='global' rows carry no team by DB constraint; 'program' rows require one.
  const addContact = async (c: {
    agentId: string; kind: ContactKind; value: string; label?: string | null; visibility: ContactVisibility;
  }) => {
    if (!c.value.trim()) return;
    if (c.visibility === "program" && !effectiveTeamId) { toast.error("No team selected."); return; }
    const { error } = await (supabase as any).from("agent_contacts").insert({
      agent_id: c.agentId, kind: c.kind, value: c.value.trim(), label: c.label?.trim() || null,
      visibility: c.visibility, source: "coach_entered",
      customer_team_id: c.visibility === "program" ? effectiveTeamId : null,
    });
    if (error) { toast.error(`Contact save failed: ${error.message}`); return; }
    qc.invalidateQueries({ queryKey: contactsKey });
  };

  const removeContact = async (id: string) => {
    const { error } = await (supabase as any).from("agent_contacts").delete().eq("id", id);
    // A coach deleting a GLOBAL row is blocked by RLS, which returns success with
    // zero rows affected rather than an error — so say what actually happened.
    if (error) { toast.error(`Delete failed: ${error.message}`); return; }
    qc.invalidateQueries({ queryKey: contactsKey });
  };

  const addNote = async (n: { agentId: string; playerId?: string | null; kind: NoteKind; body: string }) => {
    if (!n.body.trim() || !effectiveTeamId) return;
    const { error } = await (supabase as any).from("gm_agent_notes").insert({
      customer_team_id: effectiveTeamId, agent_id: n.agentId, player_id: n.playerId ?? null,
      kind: n.kind, body: n.body.trim(), created_by_user_id: user?.id ?? null,
    });
    if (error) { toast.error(`Note save failed: ${error.message}`); return; }
    qc.invalidateQueries({ queryKey: notesKey });
  };

  const removeNote = async (id: string) => {
    const { error } = await (supabase as any).from("gm_agent_notes").delete().eq("id", id);
    if (error) { toast.error(`Delete failed: ${error.message}`); return; }
    qc.invalidateQueries({ queryKey: notesKey });
  };

  return {
    agencies, agents, clients, contacts, notes,
    isLoading: loadingAgencies || loadingAgents,
    addAgency, addAgent, linkPlayer, unlinkPlayer,
    addContact, removeContact, addNote, removeNote,
  };
}
