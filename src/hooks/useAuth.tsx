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
}

interface AuthContextType {
  // Core auth state
  session: Session | null;
  user: User | null;
  loading: boolean;

  // Global roles
  roles: AppRole[];
  hasRole: (role: AppRole) => boolean;
  isSuperadmin: boolean;

  // Team membership
  userTeamId: string | null;
  userTeamRole: TeamRole | null;
  availableTeams: CustomerTeam[];

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

  const isDevBypassAllowed = import.meta.env.DEV;
  const isSuperadmin = roles.includes("superadmin");

  const fetchUserContext = async (userId: string) => {
    // 1. Global roles
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const fetchedRoles = (roleRows || []).map((r) => r.role as AppRole);
    setRoles(fetchedRoles);
    const isSuper = fetchedRoles.includes("superadmin");

    // 2. Team membership (one row per user in v1)
    const { data: accessRow } = await (supabase
      .from("user_team_access" as any)
      .select("customer_team_id, role")
      .eq("user_id", userId)
      .maybeSingle() as any);

    if (accessRow) {
      setUserTeamId(accessRow.customer_team_id as string);
      setUserTeamRole(accessRow.role as TeamRole);
    } else {
      setUserTeamId(null);
      setUserTeamRole(null);
    }

    // 3. Available teams: superadmins see all active, others see their own.
    if (isSuper) {
      const { data: allTeams } = await (supabase
        .from("customer_teams" as any)
        .select("id, name, school_team_id, savant_enabled, active")
        .eq("active", true)
        .order("name") as any);
      setAvailableTeams((allTeams || []) as CustomerTeam[]);
    } else if (accessRow) {
      const { data: oneTeam } = await (supabase
        .from("customer_teams" as any)
        .select("id, name, school_team_id, savant_enabled, active")
        .eq("id", accessRow.customer_team_id)
        .maybeSingle() as any);
      setAvailableTeams(oneTeam ? [oneTeam as CustomerTeam] : []);
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

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);
        if (newSession?.user) {
          setTimeout(() => fetchUserContext(newSession.user.id), 0);
        } else {
          clearUserContext();
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession()
      .then(({ data: { session: existing } }) => {
        setSession(existing);
        setUser(existing?.user ?? null);
        if (existing?.user) {
          fetchUserContext(existing.user.id);
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
    await supabase.auth.signOut();
  };

  const hasRole = (role: AppRole) => {
    if (roles.includes(role)) return true;
    // Superadmins implicitly satisfy any global-role check (admin, staff, etc.)
    // so existing hasRole("admin") gates work for them without per-callsite changes.
    if (isSuperadmin) return true;
    return false;
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
    if (!isDevBypassAllowed) {
      console.warn("[useAuth] Dev bypass is only available in development builds.");
      return;
    }
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
        roles,
        hasRole,
        isSuperadmin,
        userTeamId,
        userTeamRole,
        availableTeams,
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
