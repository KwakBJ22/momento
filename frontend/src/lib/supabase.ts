import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

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

export async function getAccessToken(): Promise<string> {
  if (!supabase) throw new Error("Supabase Auth 설정이 필요합니다.");
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session?.access_token) throw new Error("로그인이 필요합니다.");
  return data.session.access_token;
}
