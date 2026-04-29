// Wrapper around the (forthcoming) Supabase Edge Function that handles
// invite-by-email + user_team_access seeding.
//
// The Edge Function is required because supabase.auth.admin.inviteUserByEmail
// needs the service role key, which cannot be exposed to the browser.
//
// Until the function is deployed, this is a stub that surfaces the intent
// to the caller without performing any side effects.

import { supabase } from "@/integrations/supabase/client";

export interface InviteUserParams {
  email: string;
  customerTeamId: string;
  role: "team_admin" | "general_user";
}

export interface InviteUserResult {
  success: boolean;
  error?: string;
  pending?: boolean; // true when the stub no-ops (Edge Function not deployed yet)
}

export async function inviteUserToTeam(params: InviteUserParams): Promise<InviteUserResult> {
  try {
    const { data, error } = await supabase.functions.invoke("invite-user-to-team", {
      body: params,
    });
    if (error) {
      // The function is not deployed yet — fall through to stub behavior so the
      // UI flow can be tested locally without backend wiring.
      const msg = (error as any)?.message ?? String(error);
      const notDeployed = /not found|404|FunctionsHttpError/i.test(msg);
      if (notDeployed) {
        console.warn("[inviteUserToTeam] Edge Function not deployed — invite is a no-op", params);
        return { success: false, pending: true, error: "Invite delivery is not wired up yet (Step 5b)." };
      }
      return { success: false, error: msg };
    }
    return { success: true, ...(data ?? {}) };
  } catch (err: any) {
    return { success: false, error: err?.message ?? "Unknown error" };
  }
}
