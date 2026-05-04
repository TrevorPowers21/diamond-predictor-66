// Wrapper around the invite-user-to-team Supabase Edge Function. The
// function (a) sends a magic-link invite to a brand-new email or (b)
// attaches an already-registered user to the team without sending email.

import { supabase } from "@/integrations/supabase/client";

export interface InviteUserParams {
  email: string;
  customerTeamId: string;
  role: "team_admin" | "general_user";
}

export interface InviteUserResult {
  success: boolean;
  error?: string;
  pending?: boolean;       // Edge Function not deployed yet
  isExisting?: boolean;    // Email matched an existing auth.users row → no email sent
  alreadyMember?: boolean; // User was already on this team → no-op
  invitedUserId?: string;
}

async function readErrorBody(error: unknown): Promise<string | null> {
  const ctx = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = await ctx.json();
      const msg = (body as { error?: string } | null)?.error;
      if (msg) return msg;
    } catch {
      /* fall through */
    }
  }
  return null;
}

export async function inviteUserToTeam(params: InviteUserParams): Promise<InviteUserResult> {
  try {
    const { data, error } = await supabase.functions.invoke("invite-user-to-team", {
      body: params,
    });
    if (error) {
      const fallbackMsg = (error as { message?: string }).message ?? String(error);
      // Edge Function not deployed yet
      if (/not found|404/i.test(fallbackMsg)) {
        return { success: false, pending: true, error: "Invite delivery is not wired up yet." };
      }
      const serverMsg = await readErrorBody(error);
      return { success: false, error: serverMsg ?? fallbackMsg };
    }
    return { success: true, ...(data ?? {}) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: msg };
  }
}
