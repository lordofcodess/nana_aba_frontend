// Auth context: tracks the current Supabase session + provides sign-in / sign-out.
//
// Use `useAuth()` anywhere in the tree:
//   const { user, accessToken, signInWithGoogle, signOut, isReady } = useAuth();
//
// `accessToken` is what the API client puts in the Authorization header.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "./supabaseClient";
import { setAuthToken } from "./api";

type AuthCtx = {
  /** True once we've checked localStorage for a session. */
  isReady: boolean;
  /** True if env vars are present so auth UI can render at all. */
  configured: boolean;
  user: User | null;
  accessToken: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthCtx | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setIsReady(true);
      return;
    }
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) {
        setSession(data.session);
        setAuthToken(data.session?.access_token ?? null);
        setIsReady(true);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      setSession(sess);
      setAuthToken(sess?.access_token ?? null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) throw new Error("Supabase is not configured");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      isReady,
      configured: isSupabaseConfigured,
      user: session?.user ?? null,
      accessToken: session?.access_token ?? null,
      signInWithGoogle,
      signOut,
    }),
    [isReady, session, signInWithGoogle, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
