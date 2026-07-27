import type { AuthChangeEvent, Provider, Session, User } from "@supabase/supabase-js";
import { isSupabaseAuthConfigured, supabase } from "../lib/supabase";

export type AuthProvider = "kakao" | "naver";

export interface AppUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  email: string | null;
  phone: string | null;
  provider: AuthProvider | null;
}

export interface AppSession { user: AppUser; accessToken: string; }

/** Provider-neutral availability check for UI routes. */
export const isAuthenticationConfigured = isSupabaseAuthConfigured;

const RETURN_TO_KEY = "momento-auth-return-to";
const CALLBACK_CODE_KEY = "momento-auth-callback-code";

function text(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function metadataName(metadata: Record<string, unknown>): string | null {
  return text(metadata.display_name) || text(metadata.name) || text(metadata.full_name)
    || text(metadata.nickname) || text(metadata.preferred_username);
}

function providerFromUser(user: User): AuthProvider | null {
  const provider = text(user.app_metadata?.provider)
    || (Array.isArray(user.identities) ? text(user.identities[0]?.provider) : null);
  if (provider === "kakao") return "kakao";
  if (provider === "custom:naver" || provider === "naver") return "naver";
  return null;
}

/** The only provider-name translation used by the application. */
export function oauthProviderFor(provider: AuthProvider): Provider {
  return (provider === "naver" ? "custom:naver" : "kakao") as Provider;
}

/** The only place that interprets Supabase identity metadata for the UI. */
export function toAppUser(user: User): AppUser {
  const metadata = (user.user_metadata || {}) as Record<string, unknown>;
  return {
    id: user.id,
    displayName: metadataName(metadata) || text(user.email)?.split("@")[0] || "Momento 사용자",
    avatarUrl: text(metadata.avatar_url) || text(metadata.picture) || text(metadata.profile_image),
    email: text(user.email),
    phone: text(user.phone),
    provider: providerFromUser(user),
  };
}

function toAppSession(session: Session | null): AppSession | null {
  return session?.access_token ? { user: toAppUser(session.user), accessToken: session.access_token } : null;
}

function safeReturnTo(value: string | null | undefined): string {
  if (!value || typeof window === "undefined") return "/";
  try {
    const target = new URL(value, window.location.origin);
    return target.origin === window.location.origin && target.pathname !== "/auth/callback"
      ? `${target.pathname}${target.search}${target.hash}` : "/";
  } catch { return "/"; }
}

function persistReturnTo(value?: string): void {
  try {
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    sessionStorage.setItem(RETURN_TO_KEY, safeReturnTo(value || current));
  } catch { /* WebView storage can be unavailable. */ }
}

export function consumeReturnTo(): string {
  try {
    const value = sessionStorage.getItem(RETURN_TO_KEY);
    sessionStorage.removeItem(RETURN_TO_KEY);
    return safeReturnTo(value);
  } catch { return "/"; }
}

export async function signIn(provider: AuthProvider, returnTo?: string): Promise<void> {
  if (!supabase || !isSupabaseAuthConfigured) throw new Error("로그인 설정이 필요합니다.");
  persistReturnTo(returnTo);
  const oauthProvider = oauthProviderFor(provider);
  const { error } = await supabase.auth.signInWithOAuth({
    provider: oauthProvider,
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession(): Promise<AppSession | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return toAppSession(data.session);
}

export async function getCurrentUser(): Promise<AppUser | null> { return (await getSession())?.user ?? null; }

export async function getAccessToken(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("로그인이 필요합니다.");
  return session.accessToken;
}

export function onAuthStateChange(listener: (user: AppUser | null, event: AuthChangeEvent) => void): () => void {
  if (!supabase) return () => undefined;
  const { data } = supabase.auth.onAuthStateChange((event, session) => listener(toAppSession(session)?.user ?? null, event));
  return () => data.subscription.unsubscribe();
}

export async function completeOAuthCallback(): Promise<void> {
  if (!supabase) throw new Error("로그인 설정이 필요합니다.");
  const code = new URLSearchParams(window.location.search).get("code");
  if (!code) return;
  try {
    if (sessionStorage.getItem(CALLBACK_CODE_KEY) === code) return;
    sessionStorage.setItem(CALLBACK_CODE_KEY, code);
  } catch { /* duplicate guard is best effort only */ }
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw error;
}
