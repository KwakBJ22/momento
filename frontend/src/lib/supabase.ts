import { createClient } from "@supabase/supabase-js";
import { authDebug } from "./authDebug";

// `tsx --test` does not populate Vite's import.meta.env. Keep the auth
// boundary importable there while Vite still receives the same values at run
// time.
const viteEnv = import.meta.env;
const supabaseUrl = viteEnv?.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = viteEnv?.VITE_SUPABASE_ANON_KEY?.trim();

export const isSupabaseAuthConfigured = Boolean(supabaseUrl && supabaseAnonKey);
authDebug("CLIENT_INITIALIZED", { source: "supabase", hasSession: false });

// Kakao's in-app WebView can reject storage access transiently. Keep the
// persisted session when possible and fall back to this tab's memory instead
// of letting an auth bootstrap exception blank the app.
const memoryStorage = new Map<string, string>();
const isAuthStorageKey = (key: string) => key.includes("-auth-token");
const safeAuthStorage = {
  getItem(key: string): string | null {
    try {
      const value = window.localStorage.getItem(key);
      if (value && isAuthStorageKey(key)) {
        try { JSON.parse(value); } catch {
          window.localStorage.removeItem(key);
          memoryStorage.delete(key);
          authDebug("STORAGE_CORRUPTED_SESSION", { source: "storage" });
          authDebug("STORAGE_FALLBACK", { source: "storage" });
          return null;
        }
      }
      if (value !== null) memoryStorage.set(key, value);
      return value ?? memoryStorage.get(key) ?? null;
    } catch {
      authDebug("STORAGE_READ_FAILED", { source: "storage" });
      authDebug("STORAGE_FALLBACK", { source: "storage" });
      return memoryStorage.get(key) ?? null;
    }
  },
  setItem(key: string, value: string): void {
    memoryStorage.set(key, value);
    try { window.localStorage.setItem(key, value); } catch {
      authDebug("STORAGE_WRITE_FAILED", { source: "storage" });
      authDebug("STORAGE_FALLBACK", { source: "storage" });
    }
  },
  removeItem(key: string): void {
    memoryStorage.delete(key);
    try { window.localStorage.removeItem(key); } catch {
      authDebug("STORAGE_REMOVE_FAILED", { source: "storage" });
      authDebug("STORAGE_FALLBACK", { source: "storage" });
    }
  },
};

export const supabase = isSupabaseAuthConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        storage: safeAuthStorage,
      },
    })
  : null;
