import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export type RecruitType = "hitter" | "pitcher" | "twp";

/** Recruiting funnel, in order. `tone` drives the stage badge color. */
export const RECRUIT_STAGES = [
  { value: "evaluating", label: "Evaluating", tone: "muted" },
  { value: "contacted", label: "Contacted", tone: "blue" },
  { value: "offered", label: "Offered", tone: "amber" },
  { value: "unofficial", label: "Unofficial Visit", tone: "amber" },
  { value: "official", label: "Official Visit", tone: "gold" },
  { value: "committed", label: "Committed", tone: "green" },
  { value: "signed", label: "Signed", tone: "green" },
  { value: "committed_elsewhere", label: "Committed Elsewhere", tone: "red" },
  { value: "passed", label: "Passed", tone: "muted" },
] as const;
export type RecruitStage = (typeof RECRUIT_STAGES)[number]["value"];

export interface GmRecruit {
  id: string;
  class_year: number;
  player_type: RecruitType;
  first_name: string | null;
  last_name: string | null;
  high_school: string | null;
  state: string | null;
  travel_org: string | null;
  position: string | null;
  notes: string | null; // scouting report
  scouting_report_date: string | null; // YYYY-MM-DD
  link: string | null;
  stage: RecruitStage;
  sort_order: number;
}

export type NewRecruit = Omit<GmRecruit, "id" | "sort_order">;

/** A dated timeline entry logged against a recruit. */
export interface GmRecruitEvent {
  id: string;
  recruit_id: string;
  event_date: string; // YYYY-MM-DD
  note: string | null;
}

/** Position → recruit section. TWP is its own group. */
export function recruitTypeForPosition(position: string): RecruitType {
  const p = (position || "").toUpperCase();
  if (p === "TWP") return "twp";
  if (["SP", "RP", "CL", "RHP", "LHP", "P"].includes(p)) return "pitcher";
  return "hitter";
}

export function useGmRecruits() {
  const { user, effectiveTeamId } = useAuth();
  const qc = useQueryClient();
  const key = ["gm-recruits", effectiveTeamId ?? null];

  const { data: recruits = [], isLoading } = useQuery({
    queryKey: key,
    enabled: !!user?.id && !!effectiveTeamId,
    queryFn: async (): Promise<GmRecruit[]> => {
      const { data } = await (supabase as any)
        .from("gm_recruits").select("*").eq("customer_team_id", effectiveTeamId).order("sort_order", { ascending: true });
      return (data || []) as GmRecruit[];
    },
  });

  const years = useMemo(() => [...new Set(recruits.map((r) => r.class_year))].sort((a, b) => a - b), [recruits]);

  // Timeline events for all this team's recruits, newest first.
  const eventsKey = ["gm-recruit-events", effectiveTeamId ?? null];
  const { data: events = [] } = useQuery({
    queryKey: eventsKey,
    enabled: !!user?.id && !!effectiveTeamId,
    queryFn: async (): Promise<GmRecruitEvent[]> => {
      const { data } = await (supabase as any)
        .from("gm_recruit_events").select("id, recruit_id, event_date, note")
        .eq("customer_team_id", effectiveTeamId)
        .order("event_date", { ascending: false }).order("created_at", { ascending: false });
      return (data || []) as GmRecruitEvent[];
    },
  });
  const eventsByRecruit = useMemo(() => {
    const m = new Map<string, GmRecruitEvent[]>();
    for (const e of events) { const a = m.get(e.recruit_id) ?? []; a.push(e); m.set(e.recruit_id, a); }
    return m;
  }, [events]);

  const addEvent = useMutation({
    mutationFn: async ({ recruitId, eventDate, note }: { recruitId: string; eventDate: string; note: string }) => {
      if (!effectiveTeamId) throw new Error("No team in scope");
      const { error } = await (supabase as any).from("gm_recruit_events").insert({ recruit_id: recruitId, customer_team_id: effectiveTeamId, event_date: eventDate, note, created_by_user_id: user?.id ?? null });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: eventsKey }); toast.success("Event logged"); },
    onError: (e: any) => toast.error(`Add event failed: ${e.message}`),
  });

  const removeEvent = useMutation({
    mutationFn: async (id: string) => { const { error } = await (supabase as any).from("gm_recruit_events").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: eventsKey }),
    onError: (e: any) => toast.error(`Remove event failed: ${e.message}`),
  });

  const addRecruit = useMutation({
    mutationFn: async (r: NewRecruit) => {
      if (!effectiveTeamId) throw new Error("No team in scope");
      const peers = recruits.filter((x) => x.class_year === r.class_year && x.player_type === r.player_type);
      const nextOrder = peers.length ? Math.max(...peers.map((x) => x.sort_order)) + 1 : 0;
      const { error } = await (supabase as any).from("gm_recruits").insert({ ...r, customer_team_id: effectiveTeamId, sort_order: nextOrder, created_by_user_id: user?.id ?? null });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast.success("Recruit added"); },
    onError: (e: any) => toast.error(`Add failed: ${e.message}`),
  });

  const updateRecruit = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<NewRecruit> }) => {
      const { error } = await (supabase as any).from("gm_recruits").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: any) => toast.error(`Update failed: ${e.message}`),
  });

  const removeRecruit = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("gm_recruits").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast.success("Recruit removed"); },
    onError: (e: any) => toast.error(`Remove failed: ${e.message}`),
  });

  // Persist a new order for one (year, type) list.
  const reorder = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      await Promise.all(orderedIds.map((id, i) => (supabase as any).from("gm_recruits").update({ sort_order: i }).eq("id", id)));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: any) => toast.error(`Reorder failed: ${e.message}`),
  });

  return {
    recruits,
    years,
    isLoading,
    addRecruit: (r: NewRecruit) => addRecruit.mutate(r),
    updateRecruit: (id: string, patch: Partial<NewRecruit>) => updateRecruit.mutate({ id, patch }),
    removeRecruit: (id: string) => removeRecruit.mutate(id),
    reorder: (orderedIds: string[]) => reorder.mutate(orderedIds),
    eventsByRecruit,
    addEvent: (recruitId: string, eventDate: string, note: string) => addEvent.mutate({ recruitId, eventDate, note }),
    removeEvent: (id: string) => removeEvent.mutate(id),
  };
}
