import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logGmActivity, deleteGmActivityByRef } from "@/gm/lib/logGmActivity";
import { toast } from "sonner";
import type { ScoutGrades } from "@/gm/lib/scoutTemplate";

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

/** Projection tier for a recruit, high → low. `tone` drives the badge color. */
export const RECRUIT_TIERS = [
  { value: "draft_prospect", label: "Draft Prospect", tone: "gold" },
  { value: "immediate_impact", label: "Immediate Impact", tone: "green" },
  { value: "contributor", label: "Contributor", tone: "blue" },
  { value: "role_player", label: "Role Player", tone: "amber" },
  { value: "developmental", label: "Developmental", tone: "muted" },
] as const;
export type RecruitTier = (typeof RECRUIT_TIERS)[number]["value"];

/** Where the recruit is coming from + their CURRENT eligibility class. A JUCO
 *  arrival enters D1 the season after, at current class + 1 (FR JUCO → SO,
 *  SO JUCO → JR). */
export const RECRUIT_LEVELS = [
  { value: "hs", label: "High School" },
  { value: "juco_fr", label: "FR JUCO" },
  { value: "juco_so", label: "SO JUCO" },
] as const;
export type RecruitLevel = (typeof RECRUIT_LEVELS)[number]["value"];
/** Class a recruit ENTERS D1 as (first season): HS → FR, and JUCO is current+1. */
export const recruitEntryClass = (level: RecruitLevel): string =>
  level === "juco_fr" ? "SO" : level === "juco_so" ? "JR" : "FR";

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
  notes: string | null; // legacy single scouting report (superseded by gm_recruit_reports)
  scouting_report_date: string | null;
  projection_tier: RecruitTier | null; // mirror of the latest report's tier — stable card badge
  asking_price: number | null; // what the recruit / his camp is asking
  target_offer: number | null; // "Willing to Pay" — what we want to pay
  scholarship_pct: number | null; // % of one scholarship offered
  level: RecruitLevel; // 'hs' | 'juco_fr' | 'juco_so'
  link: string | null;
  stage: RecruitStage;
  // Contact — team-wide, any coach on staff can pull these up.
  phone: string | null;
  email: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  coach_name: string | null;
  coach_phone: string | null;
  extra_contacts: ExtraContact[] | null; // additional numbers (family, 2nd coach, agent…)
  sort_order: number;
}

/** An ad-hoc extra contact number for a recruit. */
export interface ExtraContact { label: string; value: string }

export type NewRecruit = Omit<GmRecruit, "id" | "sort_order">;

/** A dated timeline entry logged against a recruit. */
export interface GmRecruitEvent {
  id: string;
  recruit_id: string;
  event_date: string; // YYYY-MM-DD
  note: string | null;
}

/** One authored scouting report — recruits can have many, independent. */
export interface GmRecruitReport {
  id: string;
  recruit_id: string;
  author: string | null;
  report_date: string; // YYYY-MM-DD
  body: string | null;
  projection_tier: RecruitTier | null; // the tier this coach assigned in this report
  grades: ScoutGrades | null; // per-look grades (stable key → ordinal/text)
}

/** Position → recruit section. TWP is its own group. */
export function recruitTypeForPosition(position: string): RecruitType {
  const p = (position || "").toUpperCase();
  if (p === "TWP") return "twp";
  if (["SP", "RP", "CL", "RHP", "LHP", "P"].includes(p)) return "pitcher";
  return "hitter";
}

/** Per-class-year recruiting config: budget target + scholarships available. */
export interface GmClassConfig { class_year: number; budget: number | null; scholarships: number | null }

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
      const { data, error } = await (supabase as any).from("gm_recruit_events").insert({ recruit_id: recruitId, customer_team_id: effectiveTeamId, event_date: eventDate, note, created_by_user_id: user?.id ?? null }).select("id").single();
      if (error) throw error;
      return (data?.id ?? null) as string | null;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: eventsKey }); toast.success("Event logged"); },
    onError: (e: any) => toast.error(`Add event failed: ${e.message}`),
  });

  const removeEvent = useMutation({
    mutationFn: async (id: string) => { const { error } = await (supabase as any).from("gm_recruit_events").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: eventsKey }),
    onError: (e: any) => toast.error(`Remove event failed: ${e.message}`),
  });

  const updateEvent = useMutation({
    mutationFn: async ({ id, eventDate, note }: { id: string; eventDate: string; note: string }) => {
      const { error } = await (supabase as any).from("gm_recruit_events").update({ event_date: eventDate, note: note.trim() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: eventsKey }); toast.success("Note updated"); },
    onError: (e: any) => toast.error(`Update note failed: ${e.message}`),
  });

  // Scouting reports — multiple per recruit, authored + dated, newest first.
  const reportsKey = ["gm-recruit-reports", effectiveTeamId ?? null];
  const { data: reports = [] } = useQuery({
    queryKey: reportsKey,
    enabled: !!user?.id && !!effectiveTeamId,
    queryFn: async (): Promise<GmRecruitReport[]> => {
      const { data } = await (supabase as any)
        .from("gm_recruit_reports").select("id, recruit_id, author, report_date, body, projection_tier, grades")
        .eq("customer_team_id", effectiveTeamId)
        .order("report_date", { ascending: false }).order("created_at", { ascending: false });
      return (data || []) as GmRecruitReport[];
    },
  });
  const reportsByRecruit = useMemo(() => {
    const m = new Map<string, GmRecruitReport[]>();
    for (const r of reports) { const a = m.get(r.recruit_id) ?? []; a.push(r); m.set(r.recruit_id, a); }
    return m;
  }, [reports]);

  const addReport = useMutation({
    mutationFn: async ({ recruitId, reportDate, body, tier, grades }: { recruitId: string; reportDate: string; body: string; tier?: RecruitTier | null; grades?: ScoutGrades | null }) => {
      if (!effectiveTeamId) throw new Error("No team in scope");
      const { data: inserted, error } = await (supabase as any).from("gm_recruit_reports").insert({ recruit_id: recruitId, customer_team_id: effectiveTeamId, author: user?.email ?? null, report_date: reportDate, body: body.trim(), projection_tier: tier ?? null, grades: grades ?? null, created_by_user_id: user?.id ?? null }).select("id").single();
      if (error) throw error;
      // A report authors the projection tier — mirror the latest onto the recruit for its stable badge.
      if (tier) await (supabase as any).from("gm_recruits").update({ projection_tier: tier, updated_at: new Date().toISOString() }).eq("id", recruitId);
      const rec = recruits.find((x) => x.id === recruitId);
      const nm = rec ? `${rec.first_name ?? ""} ${rec.last_name ?? ""}`.trim() || "a recruit" : "a recruit";
      await logGmActivity(effectiveTeamId, user?.email ?? null, user?.id ?? null, `added a scouting report on ${nm}`, `/gm/recruiting?reports=${recruitId}`, inserted?.id ?? null);
      return (inserted?.id ?? null) as string | null;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: reportsKey }); qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["gm-activity"] }); toast.success("Report added"); },
    onError: (e: any) => toast.error(`Add report failed: ${e.message}`),
  });
  const updateReport = useMutation({
    mutationFn: async ({ id, reportDate, body, tier, grades }: { id: string; reportDate: string; body: string; tier?: RecruitTier | null; grades?: ScoutGrades | null }) => {
      const { error } = await (supabase as any).from("gm_recruit_reports").update({ report_date: reportDate, body: body.trim(), projection_tier: tier ?? null, grades: grades ?? null }).eq("id", id);
      if (error) throw error;
      // Keep the recruit's tier badge in sync when this edit sets a tier.
      if (tier) { const { data: row } = await (supabase as any).from("gm_recruit_reports").select("recruit_id").eq("id", id).single(); if (row?.recruit_id) await (supabase as any).from("gm_recruits").update({ projection_tier: tier, updated_at: new Date().toISOString() }).eq("id", row.recruit_id); }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: reportsKey }); qc.invalidateQueries({ queryKey: key }); toast.success("Report updated"); },
    onError: (e: any) => toast.error(`Update report failed: ${e.message}`),
  });
  const removeReport = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("gm_recruit_reports").delete().eq("id", id);
      if (error) throw error;
      await deleteGmActivityByRef(effectiveTeamId, id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: reportsKey }); qc.invalidateQueries({ queryKey: ["gm-activity"] }); },
    onError: (e: any) => toast.error(`Remove report failed: ${e.message}`),
  });

  const addRecruit = useMutation({
    mutationFn: async ({ recruit: r, initialReports, initialEvents }: { recruit: NewRecruit; initialReports?: { report_date: string; body: string; tier?: RecruitTier | null; grades?: ScoutGrades | null }[]; initialEvents?: { event_date: string; note: string }[] }) => {
      if (!effectiveTeamId) throw new Error("No team in scope");
      const peers = recruits.filter((x) => x.class_year === r.class_year && x.player_type === r.player_type);
      const nextOrder = peers.length ? Math.max(...peers.map((x) => x.sort_order)) + 1 : 0;
      // The tier is authored on a scouting report; mirror one onto the recruit for its badge.
      const tier = (initialReports ?? []).find((x) => x.tier)?.tier ?? r.projection_tier ?? null;
      // Identity spine: mint / attach a canonical (global) RSTR IQ identity so a
      // recruit tracked now deterministically links to their college data later
      // (via the shared PBR/PG key), not a fuzzy backfill. Needs a full name;
      // never blocks the add if identity minting fails.
      let playerId: string | null = null;
      const pf = (r.first_name ?? "").trim(), pl = (r.last_name ?? "").trim();
      if (pf && pl) {
        const link = (r.link ?? "").trim();
        const extSource = link ? (/prepbaseballreport|pbr/i.test(link) ? "pbr" : /perfectgame/i.test(link) ? "pg" : "profile") : null;
        const { data: pid, error: idErr } = await (supabase as any).rpc("resolve_or_create_prospect", {
          p_first: pf, p_last: pl, p_position: r.position ?? null,
          p_team: r.high_school ?? null, p_team_id: null, p_class_year: String(r.class_year),
          p_ext_source: extSource, p_ext_id: link || null,
        });
        if (idErr) console.warn("resolve_or_create_prospect failed", idErr);
        else if (pid) playerId = pid as string;
      }
      const { data: inserted, error } = await (supabase as any).from("gm_recruits").insert({ ...r, projection_tier: tier, player_id: playerId, customer_team_id: effectiveTeamId, sort_order: nextOrder, created_by_user_id: user?.id ?? null }).select("id").single();
      if (error) throw error;
      for (const rep of (initialReports ?? [])) {
        if (!rep.body.trim()) continue;
        await (supabase as any).from("gm_recruit_reports").insert({ recruit_id: inserted.id, customer_team_id: effectiveTeamId, author: user?.email ?? null, report_date: rep.report_date, body: rep.body.trim(), projection_tier: rep.tier ?? null, grades: rep.grades ?? null, created_by_user_id: user?.id ?? null });
      }
      for (const ev of (initialEvents ?? [])) {
        if (!ev.note.trim()) continue;
        await (supabase as any).from("gm_recruit_events").insert({ recruit_id: inserted.id, customer_team_id: effectiveTeamId, event_date: ev.event_date, note: ev.note.trim(), created_by_user_id: user?.id ?? null });
      }
      const nm = `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "a recruit";
      await logGmActivity(effectiveTeamId, user?.email ?? null, user?.id ?? null, `added ${nm} to the recruiting board`, `/gm/recruiting?reports=${inserted.id}`, inserted.id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: reportsKey }); qc.invalidateQueries({ queryKey: eventsKey }); qc.invalidateQueries({ queryKey: ["gm-activity"] }); toast.success("Recruit added"); },
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
      // Also clear activity for the recruit + its scouting reports (report rows
      // cascade-delete in the DB, but their activity entries don't).
      const { data: reportRows } = await (supabase as any).from("gm_recruit_reports").select("id").eq("recruit_id", id);
      const rec = recruits.find((x) => x.id === id);
      const nm = rec ? `${rec.first_name ?? ""} ${rec.last_name ?? ""}`.trim() : "";
      const { error } = await (supabase as any).from("gm_recruits").delete().eq("id", id);
      if (error) throw error;
      await deleteGmActivityByRef(effectiveTeamId, id);
      for (const rr of reportRows || []) await deleteGmActivityByRef(effectiveTeamId, rr.id);
      // Legacy (pre-ref_id) entries: match by the recruit's name in the phrase.
      if (nm && effectiveTeamId) {
        try {
          await (supabase as any).from("gm_activity").delete().eq("customer_team_id", effectiveTeamId).ilike("action", `%${nm} to the recruiting board`);
          await (supabase as any).from("gm_activity").delete().eq("customer_team_id", effectiveTeamId).ilike("action", `%scouting report on ${nm}`);
        } catch { /* best-effort */ }
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["gm-activity"] }); toast.success("Recruit removed"); },
    onError: (e: any) => toast.error(`Remove failed: ${e.message}`),
  });

  // Persist a new order for one (year, type) list. Optimistically rewrite the
  // cached sort_order so the card stays where it was dropped — without this the
  // list re-renders in the old order until the writes land, which reads as the
  // card snapping back then jumping forward.
  const reorder = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      await Promise.all(orderedIds.map((id, i) => (supabase as any).from("gm_recruits").update({ sort_order: i }).eq("id", id)));
    },
    onMutate: async (orderedIds: string[]) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<GmRecruit[]>(key);
      const rank = new Map(orderedIds.map((id, i) => [id, i]));
      qc.setQueryData<GmRecruit[]>(key, (old) => (old ?? []).map((r) => (rank.has(r.id) ? { ...r, sort_order: rank.get(r.id)! } : r)));
      return { prev };
    },
    onError: (e: any, _vars, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(`Reorder failed: ${e.message}`); },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  // Per-class-year budget + scholarships config.
  const configKey = ["gm-class-config", effectiveTeamId ?? null];
  const { data: classConfigs = [] } = useQuery({
    queryKey: configKey,
    enabled: !!user?.id && !!effectiveTeamId,
    queryFn: async (): Promise<GmClassConfig[]> => {
      const { data } = await (supabase as any)
        .from("gm_class_config").select("class_year, budget, scholarships").eq("customer_team_id", effectiveTeamId);
      return (data || []) as GmClassConfig[];
    },
  });
  const configByYear = useMemo(() => {
    const m = new Map<number, GmClassConfig>();
    for (const c of classConfigs) m.set(c.class_year, c);
    return m;
  }, [classConfigs]);

  const saveClassConfig = useMutation({
    mutationFn: async ({ class_year, budget, scholarships }: GmClassConfig) => {
      if (!effectiveTeamId) throw new Error("No team in scope");
      const { error } = await (supabase as any).from("gm_class_config").upsert(
        { customer_team_id: effectiveTeamId, class_year, budget, scholarships, updated_by_user_id: user?.id ?? null, updated_at: new Date().toISOString() },
        { onConflict: "customer_team_id,class_year" },
      );
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: configKey }); toast.success("Class budget saved"); },
    onError: (e: any) => toast.error(`Save failed: ${e.message}`),
  });

  return {
    recruits,
    years,
    isLoading,
    addRecruit: (recruit: NewRecruit, initialReports?: { report_date: string; body: string; tier?: RecruitTier | null; grades?: ScoutGrades | null }[], initialEvents?: { event_date: string; note: string }[]) => addRecruit.mutate({ recruit, initialReports, initialEvents }),
    updateRecruit: (id: string, patch: Partial<NewRecruit>) => updateRecruit.mutate({ id, patch }),
    removeRecruit: (id: string) => removeRecruit.mutate(id),
    reorder: (orderedIds: string[]) => reorder.mutate(orderedIds),
    configByYear,
    saveClassConfig: (cfg: GmClassConfig) => saveClassConfig.mutate(cfg),
    eventsByRecruit,
    addEvent: (recruitId: string, eventDate: string, note: string) => addEvent.mutateAsync({ recruitId, eventDate, note }).catch(() => null),
    updateEvent: (id: string, eventDate: string, note: string) => updateEvent.mutate({ id, eventDate, note }),
    removeEvent: (id: string) => removeEvent.mutate(id),
    reportsByRecruit,
    addReport: (recruitId: string, reportDate: string, body: string, tier?: RecruitTier | null, grades?: ScoutGrades | null) => addReport.mutateAsync({ recruitId, reportDate, body, tier, grades }).catch(() => null),
    updateReport: (id: string, reportDate: string, body: string, tier?: RecruitTier | null, grades?: ScoutGrades | null) => updateReport.mutate({ id, reportDate, body, tier, grades }),
    removeReport: (id: string) => removeReport.mutate(id),
  };
}
