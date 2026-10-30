// Supabase auth client — initialized once and reused across the app.
// Auth events propagate via AuthProvider in AuthContext.tsx.

import { Capacitor } from "@capacitor/core";
import { createClient } from "@supabase/supabase-js";

/** Running inside the iOS/Android app (Capacitor), not a browser. */
export const isNativeApp = Capacitor.isNativePlatform();

/** Deep link Google sign-in returns to in the native app (add it to Supabase's redirect URLs). */
export const NATIVE_AUTH_REDIRECT = "com.nanaaba.app://auth-callback";

const env = import.meta.env as Record<string, string | undefined>;

const SUPABASE_URL = (env.VITE_SUPABASE_URL ?? "").trim();
const SUPABASE_ANON_KEY = (env.VITE_SUPABASE_ANON_KEY ?? "").trim();

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        // Persist session across reloads, refresh tokens silently.
        persistSession: true,
        autoRefreshToken: true,
        // The native app receives the sign-in code through a deep link instead
        // (AuthContext), using PKCE so no tokens travel in the URL.
        detectSessionInUrl: !isNativeApp,
        ...(isNativeApp ? { flowType: "pkce" as const } : {}),
      },
    })
  : null;
