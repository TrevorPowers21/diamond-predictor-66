import { useState, useEffect, createContext, useContext, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// Deliberately much smaller than the coach app's useAuth.tsx — no
// team/role resolution needed here, just session + whether a
// player_accounts row exists for it.
//
// Accounts are invite-only (staff runs `npm run invite-player`, mirroring
// the coach app's invite-user-to-team flow) — there is no self-serve
// signUp() here. isRecoveringPassword mirrors the same field in the coach
// app's useAuth.tsx: true while the player has clicked an invite/reset link
// and has a session but hasn't set a password yet.
interface PlayerAuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  isRecoveringPassword: boolean;
  hasPlayerProfile: boolean | null; // null while unresolved
  setPassword: (password: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  createOwnPlayerProfile: () => Promise<{ error: Error | null }>;
}

const PlayerAuthContext = createContext<PlayerAuthContextType | undefined>(undefined);

export function PlayerAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasPlayerProfile, setHasPlayerProfile] = useState<boolean | null>(null);
  const [isRecoveringPassword, setIsRecoveringPassword] = useState(false);

  const checkPlayerProfile = async (userId: string) => {
    const { data } = await supabase.from("player_accounts").select("user_id").eq("user_id", userId).maybeSingle();
    setHasPlayerProfile(!!data);
  };

  useEffect(() => {
    // Invite links land with #type=invite in the URL fragment; Supabase
    // fires SIGNED_IN (not PASSWORD_RECOVERY) for those, so check the hash
    // directly at mount too — same reasoning as the coach app's useAuth.
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    if (hash.includes("type=invite")) {
      setIsRecoveringPassword(true);
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (event === "PASSWORD_RECOVERY") {
        setIsRecoveringPassword(true);
      } else if (event === "USER_UPDATED" || event === "SIGNED_OUT") {
        setIsRecoveringPassword(false);
      }
      if (newSession?.user) {
        setTimeout(() => checkPlayerProfile(newSession.user.id), 0);
      } else {
        setHasPlayerProfile(null);
      }
    });

    (async () => {
      // Explicitly establish the session from the invite link's hash
      // tokens — detectSessionInUrl is disabled on this client (see
      // integrations/supabase/client.ts) specifically so this is the only
      // consumer of these tokens. Refresh tokens are single-use/rotating,
      // so having two consumers race for the same hash intermittently left
      // this call with no session at all ("Auth session missing!").
      const params = new URLSearchParams(hash.replace(/^#/, ""));
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      if (accessToken && refreshToken) {
        await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }

      const { data: { session: existing } } = await supabase.auth.getSession();
      setSession(existing);
      setUser(existing?.user ?? null);
      if (existing?.user) await checkPlayerProfile(existing.user.id);
      setLoading(false);
    })();

    return () => subscription.unsubscribe();
  }, []);

  // Called from /set-password after an invite link. Same underlying call as
  // the coach app's SetNewPasswordForm.
  const setPassword = async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (!error) setIsRecoveringPassword(false);
    return { error: error as Error | null };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  // Edge case: an existing coach account (same auth.users pool) visiting
  // the player app has no player_accounts row, since the trigger only
  // fires for app: 'player' invites. Let them self-create one — this
  // grants no coach-side data access either way, RLS on coach tables is
  // independent of this table.
  const createOwnPlayerProfile = async () => {
    if (!user) return { error: new Error("Not signed in") };
    const { error } = await supabase
      .from("player_accounts")
      .insert({ user_id: user.id, email: user.email });
    if (!error) setHasPlayerProfile(true);
    return { error: error as Error | null };
  };

  return (
    <PlayerAuthContext.Provider
      value={{
        session,
        user,
        loading,
        isRecoveringPassword,
        hasPlayerProfile,
        setPassword,
        signIn,
        signOut,
        createOwnPlayerProfile,
      }}
    >
      {children}
    </PlayerAuthContext.Provider>
  );
}

export function usePlayerAuth() {
  const context = useContext(PlayerAuthContext);
  if (!context) throw new Error("usePlayerAuth must be used within PlayerAuthProvider");
  return context;
}
