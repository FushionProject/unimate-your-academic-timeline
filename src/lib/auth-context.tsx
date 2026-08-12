import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

interface AuthResult {
  error: string | null;
  errorCode?: string;
  needsConfirmation?: boolean;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signUp: (email: string, password: string) => Promise<AuthResult>;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  requestPasswordReset: (email: string) => Promise<AuthResult>;
  updatePassword: (password: string) => Promise<AuthResult>;
  recoveryMode: boolean;
  signOut: () => Promise<void>;
}

const NOT_CONFIGURED_ERROR = "Auth isn't configured yet — add your Supabase keys to .env.local.";
const UNIMATE_AUTH_SIGNED_OUT_EVENT = "unimate-auth-signed-out";
const RECOVERY_SESSION_KEY = "unimate-password-recovery";
export const NEW_ACCOUNT_SETUP_KEY = "unimate-new-account-setup";

function unavailableAuthResult(): AuthResult {
  return {
    error: "We couldn't reach UniMate authentication. Check your connection and try again.",
    errorCode: "network_error",
  };
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recoveryMode, setRecoveryMode] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .catch(() => setSession(null))
      .finally(() => setLoading(false));

    setRecoveryMode(sessionStorage.getItem(RECOVERY_SESSION_KEY) === "active");

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      if (event === "PASSWORD_RECOVERY") {
        sessionStorage.setItem(RECOVERY_SESSION_KEY, "active");
        setRecoveryMode(true);
      } else if (event === "SIGNED_OUT") {
        sessionStorage.removeItem(RECOVERY_SESSION_KEY);
        setRecoveryMode(false);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (loading) return;
    document.documentElement.dataset.unimateAuthState = session ? "signed-in" : "signed-out";
    return () => {
      delete document.documentElement.dataset.unimateAuthState;
    };
  }, [loading, session]);

  const signUp = async (email: string, password: string): Promise<AuthResult> => {
    if (!supabase) return { error: NOT_CONFIGURED_ERROR };
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/companion-setup?welcome=1` },
      });
      if (error) return { error: error.message, errorCode: error.code };
      localStorage.setItem(NEW_ACCOUNT_SETUP_KEY, "pending");
      return { error: null, needsConfirmation: !data.session };
    } catch {
      return unavailableAuthResult();
    }
  };

  const signIn = async (email: string, password: string): Promise<AuthResult> => {
    if (!supabase) return { error: NOT_CONFIGURED_ERROR };
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error?.message ?? null, errorCode: error?.code };
    } catch {
      return unavailableAuthResult();
    }
  };

  const requestPasswordReset = async (email: string): Promise<AuthResult> => {
    if (!supabase) return { error: NOT_CONFIGURED_ERROR };
    const redirectTo = `${window.location.origin}/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    return { error: error?.message ?? null };
  };

  const updatePassword = async (password: string): Promise<AuthResult> => {
    if (!supabase) return { error: NOT_CONFIGURED_ERROR };
    if (!recoveryMode) return { error: "This password reset link is no longer valid." };
    const { error } = await supabase.auth.updateUser({ password });
    if (!error) {
      sessionStorage.removeItem(RECOVERY_SESSION_KEY);
      setRecoveryMode(false);
    }
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    // The extension has its own isolated Supabase session. This event carries
    // no token or account data; it only asks the installed Companion to clear
    // its local session after the website has successfully signed out.
    document.dispatchEvent(new CustomEvent(UNIMATE_AUTH_SIGNED_OUT_EVENT));
  };

  return (
    <AuthContext.Provider
      value={{
        user: session?.user ?? null,
        session,
        loading,
        recoveryMode,
        signUp,
        signIn,
        requestPasswordReset,
        updatePassword,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
