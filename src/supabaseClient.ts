// Supabase auth client — initialized once and reused across the app.
// Auth events propagate via AuthProvider in AuthContext.tsx.

import { createClient } from "@supabase/supabase-js";

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
        detectSessionInUrl: true,
      },
    })
  : null;
