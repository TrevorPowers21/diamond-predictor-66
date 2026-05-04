// Edge Function: invite-user-to-team
//
// Attaches a user (existing or new) to a customer_team in user_team_access.
// If the email is not yet registered, sends a magic-link invite. If the
// email already exists, attaches the existing user without sending email.
//
// Authorization:
//   - Superadmins can invite anyone, with any role, to any team.
//   - Team admins can invite ONLY general_user to their own team.
//   - Anyone else: 403.
//
// Required env vars (auto-provided in the Supabase Edge runtime):
//   - SUPABASE_URL
//   - SUPABASE_ANON_KEY
//   - SUPABASE_SERVICE_ROLE_KEY
//
// Deploy:
//   supabase functions deploy invite-user-to-team

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface InviteBody {
  email: string;
  customerTeamId: string;
  role: "team_admin" | "general_user";
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isAlreadyRegisteredError(err: { status?: number; message?: string } | null): boolean {
  if (!err) return false;
  if (err.status === 422) return true;
  const msg = (err.message ?? "").toLowerCase();
  return msg.includes("already") && (msg.includes("registered") || msg.includes("exists"));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return json({ error: "Server is misconfigured (missing env vars)" }, 500);
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user: caller },
    error: callerErr,
  } = await callerClient.auth.getUser();
  if (callerErr || !caller) return json({ error: "Invalid or expired token" }, 401);

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  let body: InviteBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const { email, customerTeamId, role } = body ?? {};
  if (!email || !customerTeamId || !role) {
    return json({ error: "email, customerTeamId, role are required" }, 400);
  }
  if (role !== "team_admin" && role !== "general_user") {
    return json({ error: "role must be 'team_admin' or 'general_user'" }, 400);
  }

  const { data: roleRows } = await adminClient
    .from("user_roles")
    .select("role")
    .eq("user_id", caller.id);
  const isSuperadmin = (roleRows ?? []).some((r: { role: string }) => r.role === "superadmin");

  let isTeamAdminOf = false;
  if (!isSuperadmin) {
    const { data: accessRow } = await adminClient
      .from("user_team_access")
      .select("role")
      .eq("user_id", caller.id)
      .eq("customer_team_id", customerTeamId)
      .maybeSingle();
    isTeamAdminOf = (accessRow as { role?: string } | null)?.role === "team_admin";
  }

  if (!isSuperadmin) {
    if (!isTeamAdminOf) {
      return json({ error: "Forbidden: caller is not a superadmin or team_admin of this team" }, 403);
    }
    if (role === "team_admin") {
      return json({ error: "Forbidden: team_admins can only invite general_users" }, 403);
    }
  }

  const { data: team, error: teamErr } = await adminClient
    .from("customer_teams")
    .select("id, active")
    .eq("id", customerTeamId)
    .maybeSingle();
  if (teamErr || !team) return json({ error: "Customer team not found" }, 404);
  if (!(team as { active: boolean }).active) {
    return json({ error: "Customer team is inactive" }, 400);
  }

  // Try the magic-link invite first.
  let invitedUserId: string;
  let isExisting = false;
  const { data: invited, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(email);

  if (inviteErr) {
    if (!isAlreadyRegisteredError(inviteErr)) {
      return json({ error: `Invite failed: ${inviteErr.message ?? "unknown error"}` }, 500);
    }

    // Email is already registered — look up the existing user_id and attach
    // them to the team without sending another invite email.
    const { data: foundId, error: findErr } = await adminClient.rpc(
      "find_user_id_by_email",
      { _email: email },
    );
    if (findErr || !foundId) {
      return json({ error: `User exists but lookup failed: ${findErr?.message ?? "no id returned"}` }, 500);
    }
    invitedUserId = foundId as string;
    isExisting = true;

    // v1 rule: one user, one team. Reject if they're already on a different team.
    const { data: existingAccess } = await adminClient
      .from("user_team_access")
      .select("customer_team_id, role")
      .eq("user_id", invitedUserId);
    const accessRows = (existingAccess ?? []) as Array<{ customer_team_id: string; role: string }>;

    const onThisTeam = accessRows.find((r) => r.customer_team_id === customerTeamId);
    const onAnotherTeam = accessRows.find((r) => r.customer_team_id !== customerTeamId);

    if (onAnotherTeam) {
      return json(
        { error: "User is already a member of another customer team. Remove them from that team before adding here." },
        409,
      );
    }
    if (onThisTeam) {
      return json({ success: true, alreadyMember: true, invitedUserId, isExisting: true });
    }
  } else if (!invited?.user) {
    return json({ error: "Invite returned no user" }, 500);
  } else {
    invitedUserId = invited.user.id;
  }

  // Attach to the team. Upsert so re-invites don't blow up on the PK.
  const { error: accessErr } = await adminClient
    .from("user_team_access")
    .upsert(
      {
        user_id: invitedUserId,
        customer_team_id: customerTeamId,
        role,
        created_by: caller.id,
      },
      { onConflict: "user_id,customer_team_id" },
    );
  if (accessErr) {
    return json({ error: `Could not assign team access: ${accessErr.message}` }, 500);
  }

  return json({ success: true, invitedUserId, isExisting });
});
