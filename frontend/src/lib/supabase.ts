import { createClient } from "@supabase/supabase-js";

// `tsx --test` does not populate Vite's import.meta.env. Keep the auth
// boundary importable there while Vite still receives the same values at run
// time.
const viteEnv = import.meta.env;
const supabaseUrl = viteEnv?.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = viteEnv?.VITE_SUPABASE_ANON_KEY?.trim();

export const isSupabaseAuthConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseAuthConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : null;
