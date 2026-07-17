import { supabase } from "@/integrations/supabase/client";

/**
 * Append one row to the front-office activity feed. Fire-and-forget: never
 * blocks or fails the mutation that triggered it. `action` is the human phrase
 * minus the actor (e.g. "added a note on Nolan Traeger"); the UI prepends who.
 */
export async function logGmActivity(
  teamId: string | null | undefined,
  actor: string | null | undefined,
  userId: string | null | undefined,
  action: string,
  link?: string | null,
  refId?: string | null,
): Promise<void> {
  if (!teamId) return;
  try {
    await (supabase as any).from("gm_activity").insert({
      customer_team_id: teamId,
      actor: actor ?? null,
      action,
      link: link ?? null,
      ref_id: refId ?? null,
      created_by_user_id: userId ?? null,
    });
  } catch {
    /* activity logging is best-effort */
  }
}

/** Remove any activity entries about a deleted record, so the feed stays honest. */
export async function deleteGmActivityByRef(teamId: string | null | undefined, refId: string): Promise<void> {
  if (!teamId || !refId) return;
  try {
    await (supabase as any).from("gm_activity").delete().eq("customer_team_id", teamId).eq("ref_id", refId);
  } catch {
    /* best-effort */
  }
}
