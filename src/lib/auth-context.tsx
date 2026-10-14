import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { authDestinationPath, type AuthDestination } from "./auth-destination";
import { readBrowserStorage, removeBrowserStorage, writeBrowserStorage } from "./browser-storage";

interface AuthResult {
  error: string | null;
  errorCode?: string;
  needsConfirmation?: boolean;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signUp: (email: string, password: string, destination?: AuthDestination) => Promise<AuthResult>;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  requestPasswordReset: (email: string) => Promise<AuthResult>;
  updatePassword: (password: string) => Promise<AuthResult>;
  recoveryMode: boolean;
  signOut: () => Promise<AuthResult>;
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
  const recoveryIdentity = useRef({ generation: 0, userId: null as string | null });

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

    setRecoveryMode(readBrowserStorage(() => sessionStorage, RECOVERY_SESSION_KEY) === "active");

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      const nextUserId = newSession?.user.id ?? null;
      const accountChanged = recoveryIdentity.current.userId !== nextUserId;
      if (accountChanged || event === "PASSWORD_RECOVERY" || event === "SIGNED_OUT") {
        recoveryIdentity.current = {
          generation: recoveryIdentity.current.generation + 1,
          userId: nextUserId,
        };
      }
      setSession(newSession);
      if (event === "PASSWORD_RECOVERY") {
        setRecoveryMode(writeBrowserStorage(() => sessionStorage, RECOVERY_SESSION_KEY, "active"));
      } else if (event === "SIGNED_OUT" || (accountChanged && event !== "INITIAL_SESSION")) {
        removeBrowserStorage(() => sessionStorage, RECOVERY_SESSION_KEY);
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

  const signUp = async (
    email: string,
    password: string,
    destination: AuthDestination = "dashboard",
  ): Promise<AuthResult> => {
    if (!supabase) return { error: NOT_CONFIGURED_ERROR };
    try {
      const response = await fetch("/api/signup-status", { cache: "no-store" });
      if (!response.ok) return unavailableAuthResult();
      const signupStatus = (await response.json()) as { enabled?: boolean };
      if (signupStatus.enabled !== true) {
        return {
          error: "New accounts are temporarily paused while we make room for more students.",
          errorCode: "signup_disabled",
        };
      }
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}${authDestinationPath(destination)}`,
        },
      });
      if (error) return { error: error.message, errorCode: error.code };
      writeBrowserStorage(() => localStorage, NEW_ACCOUNT_SETUP_KEY, "pending");
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
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      return { error: error?.message ?? null, errorCode: error?.code };
    } catch {
      return unavailableAuthResult();
    }
  };

  const updatePassword = async (password: string): Promise<AuthResult> => {
    if (!supabase) return { error: NOT_CONFIGURED_ERROR };
    if (
      !recoveryMode ||
      readBrowserStorage(() => sessionStorage, RECOVERY_SESSION_KEY) !== "active"
    ) {
      return {
        error:
          "This password reset link is no longer valid. Request a new link and allow browser storage to continue.",
      };
    }
    const identity = recoveryIdentity.current;
    const sessionChangedResult = (): AuthResult => ({
      error: "Your password recovery session changed. Use the latest reset link to continue.",
      errorCode: "auth_session_changed",
    });
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (recoveryIdentity.current !== identity) return sessionChangedResult();
      if (!error) {
        recoveryIdentity.current = { ...identity, generation: identity.generation + 1 };
        removeBrowserStorage(() => sessionStorage, RECOVERY_SESSION_KEY);
        setRecoveryMode(false);
      }
      return { error: error?.message ?? null, errorCode: error?.code };
    } catch {
      if (recoveryIdentity.current !== identity) return sessionChangedResult();
      return unavailableAuthResult();
    }
  };

  const signOut = async (): Promise<AuthResult> => {
    if (!supabase) return { error: null };
    try {
      const { error } = await supabase.auth.signOut();
      if (error) return { error: error.message, errorCode: error.code };
    } catch {
      return unavailableAuthResult();
    }
    // The extension has its own isolated Supabase session. This event carries
    // no token or account data; it only asks the installed Companion to clear
    // its local session after the website has successfully signed out.
    document.dispatchEvent(new CustomEvent(UNIMATE_AUTH_SIGNED_OUT_EVENT));
    return { error: null };
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
