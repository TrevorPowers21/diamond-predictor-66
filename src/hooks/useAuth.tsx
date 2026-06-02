import { useState, useEffect, createContext, useContext, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// Legacy global roles. 'superadmin' is the only one that matters going
// forward — it grants cross-team (NewtForce-internal) access. Team-level
// roles ('team_admin', 'general_user') live in user_team_access.
type AppRole = "admin" | "staff" | "scout" | "external" | "superadmin";
type TeamRole = "team_admin" | "general_user";

export interface CustomerTeam {
  id: string;
  name: string;
  school_team_id: string | null;
  savant_enabled: boolean;
  active: boolean;
  // Branding (optional). When all five are present the SchoolBanner renders
  // the styled two-line layout (display_name + mascot in team colors).
  // Set per-team in AdminTeams; replaces the old hardcoded SCHOOL_BRANDING.
  logo_url: string | null;
  display_name: string | null;
  mascot: string | null;
  primary_color: string | null;
  secondary_color: string | null;
}

interface AuthContextType {
  // Core auth state
  session: Session | null;
  user: User | null;
  loading: boolean;

  // Password recovery — true while the user has a recovery session
  // (clicked an email link) but has not yet set a new password.
  isRecoveringPassword: boolean;

  // Global roles
  roles: AppRole[];
  hasRole: (role: AppRole) => boolean;
  isSuperadmin: boolean;

  // Team membership
  userTeamId: string | null;
  userTeamRole: TeamRole | null;
  availableTeams: CustomerTeam[];
  // Re-pulls availableTeams from Supabase. Call this after any write that
  // changes a customer_teams row (branding, savant toggle, etc.) so the
  // banner / school dropdown reflect the change without a hard refresh.
  refreshTeams: () => Promise<void>;

  // Superadmin impersonation
  impersonatedTeamId: string | null;
  impersonateTeam: (teamId: string | null) => void;
  effectiveTeamId: string | null;

  // Auth actions
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;

  // Dev bypass — only operational in development builds
  isDevBypassAllowed: boolean;
  devBypassed: boolean;
  enableDevBypass: () => void;
  disableDevBypass: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const IMPERSONATION_KEY = "rstr_iq_impersonated_team";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [userTeamId, setUserTeamId] = useState<string | null>(null);
  const [userTeamRole, setUserTeamRole] = useState<TeamRole | null>(null);
  const [availableTeams, setAvailableTeams] = useState<CustomerTeam[]>([]);
  const [impersonatedTeamId, setImpersonatedTeamIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.sessionStorage.getItem(IMPERSONATION_KEY);
  });
  const [loading, setLoading] = useState(true);
  const [devBypassed, setDevBypassed] = useState(false);
  const [isRecoveringPassword, setIsRecoveringPassword] = useState(false);

  const isDevBypassAllowed = import.meta.env.DEV;
  const isSuperadmin = roles.includes("superadmin");

  const fetchUserContext = async (userId: string) => {
    // Queries 1 + 2 are independent — run in parallel to save one round trip.
    const [{ data: roleRows }, { data: accessRow }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("user_team_access").select("customer_team_id, role").eq("user_id", userId).maybeSingle(),
    ]);

    const fetchedRoles = (roleRows || []).map((r) => r.role as AppRole);
    setRoles(fetchedRoles);
    const isSuper = fetchedRoles.includes("superadmin");

    if (accessRow) {
      setUserTeamId(accessRow.customer_team_id);
      setUserTeamRole(accessRow.role as TeamRole);
    } else {
      setUserTeamId(null);
      setUserTeamRole(null);
    }

    // 3. Available teams: superadmins see all active, others see their own.
    if (isSuper) {
      const { data: allTeams } = await supabase
        .from("customer_teams")
        .select("id, name, school_team_id, savant_enabled, active, logo_url, display_name, mascot, primary_color, secondary_color")
        .eq("active", true)
        .order("name");
      setAvailableTeams(allTeams ?? []);
    } else if (accessRow) {
      const { data: oneTeam } = await supabase
        .from("customer_teams")
        .select("id, name, school_team_id, savant_enabled, active, logo_url, display_name, mascot, primary_color, secondary_color")
        .eq("id", accessRow.customer_team_id)
        .maybeSingle();
      setAvailableTeams(oneTeam ? [oneTeam] : []);
    } else {
      setAvailableTeams([]);
    }
  };

  const clearUserContext = () => {
    setRoles([]);
    setUserTeamId(null);
    setUserTeamRole(null);
    setAvailableTeams([]);
    clearImpersonation();
  };

  const clearImpersonation = () => {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(IMPERSONATION_KEY);
    }
    setImpersonatedTeamIdState(null);
  };

  useEffect(() => {
    if (devBypassed) {
      setLoading(false);
      return;
    }

    // Supabase invite links land with `#type=invite` in the URL fragment.
    // Supabase fires SIGNED_IN (not PASSWORD_RECOVERY) for invites, so the
    // event-only check below would miss them and the user would slip into
    // /dashboard without ever setting a password. Detect at mount so the
    // recovery form takes over before any redirect logic runs.
    if (typeof window !== "undefined" && window.location.hash.includes("type=invite")) {
      setIsRecoveringPassword(true);
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);
        if (event === "PASSWORD_RECOVERY") {
          setIsRecoveringPassword(true);
        } else if (event === "USER_UPDATED" || event === "SIGNED_OUT") {
          setIsRecoveringPassword(false);
        }
        if (newSession?.user) {
          // Defer the fetch out of the synchronous auth handler scope (Supabase
          // recommendation — avoids deadlocking the auth subsystem), then flip
          // loading=false ONLY after fetchUserContext completes. Critical: this
          // setLoading must run inside the deferred async — if it ran on the
          // synchronous path below, RoleGuard would render with loading=false
          // but userTeamRole=null and bounce team_admins to /dashboard.
          setTimeout(async () => {
            try { await fetchUserContext(newSession.user.id); }
            finally { setLoading(false); }
          }, 0);
        } else {
          clearUserContext();
          setLoading(false);
        }
      }
    );

    // Await fetchUserContext before flipping loading=false. Otherwise role
    // guards (RoleGuard) can fire while `userTeamRole` is still null and
    // bounce the user back to /dashboard on every page refresh.
    supabase.auth.getSession()
      .then(async ({ data: { session: existing } }) => {
        setSession(existing);
        setUser(existing?.user ?? null);
        if (existing?.user) {
          await fetchUserContext(existing.user.id);
        }
      })
      .catch(() => {
        setSession(null);
        setUser(null);
        clearUserContext();
      })
      .finally(() => {
        setLoading(false);
      });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devBypassed]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    clearImpersonation();
    try {
      await supabase.auth.signOut();
    } catch (e) {
      if (e instanceof Error && e.name !== "AbortError") throw e;
    }
  };

  const hasRole = (role: AppRole) => {
    if (roles.includes(role)) return true;
    // Superadmins implicitly satisfy any global-role check (admin, staff, etc.)
    // so existing hasRole("admin") gates work for them without per-callsite changes.
    if (isSuperadmin) return true;
    return false;
  };

  const refreshTeams = async () => {
    if (!user) return;
    if (isSuperadmin) {
      const { data: allTeams } = await supabase
        .from("customer_teams")
        .select("id, name, school_team_id, savant_enabled, active, logo_url, display_name, mascot, primary_color, secondary_color")
        .eq("active", true)
        .order("name");
      setAvailableTeams(allTeams ?? []);
    } else if (userTeamId) {
      const { data: oneTeam } = await supabase
        .from("customer_teams")
        .select("id, name, school_team_id, savant_enabled, active, logo_url, display_name, mascot, primary_color, secondary_color")
        .eq("id", userTeamId)
        .maybeSingle();
      setAvailableTeams(oneTeam ? [oneTeam] : []);
    }
  };

  const impersonateTeam = (teamId: string | null) => {
    if (!isSuperadmin) return;
    if (teamId) {
      window.sessionStorage.setItem(IMPERSONATION_KEY, teamId);
    } else {
      window.sessionStorage.removeItem(IMPERSONATION_KEY);
    }
    setImpersonatedTeamIdState(teamId);
  };

  const effectiveTeamId = isSuperadmin
    ? impersonatedTeamId
    : userTeamId;

  const enableDevBypass = () => {
    // Silently no-op in production. The UI that triggers this is gated by
    // isDevBypassAllowed, but defense-in-depth here keeps prod consoles clean
    // if any code path slips through.
    if (!isDevBypassAllowed) return;
    setDevBypassed(true);
  };

  const disableDevBypass = () => {
    setDevBypassed(false);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        loading,
        isRecoveringPassword,
        roles,
        hasRole,
        isSuperadmin,
        userTeamId,
        userTeamRole,
        availableTeams,
        refreshTeams,
        impersonatedTeamId,
        impersonateTeam,
        effectiveTeamId,
        signIn,
        signOut,
        isDevBypassAllowed,
        devBypassed,
        enableDevBypass,
        disableDevBypass,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
