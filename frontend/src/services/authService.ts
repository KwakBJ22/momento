import type { AuthChangeEvent, Provider, Session, User } from "@supabase/supabase-js";
import { isSupabaseAuthConfigured, supabase } from "../lib/supabase";
import { authDebug } from "../lib/authDebug";

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

export interface AuthInitialization {
  session: AppSession | null;
  user: AppUser | null;
  error: string | null;
}

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
    return safeReturnTo(value || new URLSearchParams(window.location.search).get("returnTo"));
  } catch {
    return safeReturnTo(new URLSearchParams(window.location.search).get("returnTo"));
  }
}

export async function signIn(provider: AuthProvider, returnTo?: string): Promise<void> {
  if (!supabase || !isSupabaseAuthConfigured) throw new Error("로그인 설정이 필요합니다.");
  persistReturnTo(returnTo);
  const oauthProvider = oauthProviderFor(provider);
  const callbackReturnTo = safeReturnTo(returnTo || `${window.location.pathname}${window.location.search}${window.location.hash}`);
  const { error } = await supabase.auth.signInWithOAuth({
    provider: oauthProvider,
    options: { redirectTo: `${window.location.origin}/auth/callback?returnTo=${encodeURIComponent(callbackReturnTo)}` },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  authDebug("SIGN_OUT_START", { source: "authService" });
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  authDebug("SIGN_OUT_SUCCESS", { source: "authService" });
  authDebug("SESSION_CLEARED", { source: "authService", hasSession: false });
}

export async function getSession(source?: string): Promise<AppSession | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const session = toAppSession(data.session);
  if (source) authDebug(session ? "SESSION_FOUND" : "SESSION_EMPTY", { source, hasSession: Boolean(session), hasUser: Boolean(session?.user) });
  return session;
}

/** Complete the initial restore before a route decides that a visitor is a guest. */
export async function initializeAuth(): Promise<AuthInitialization> {
  authDebug("INIT_START", { source: "getSession", authReady: false });
  authDebug("SESSION_RESTORE_START", { source: "getSession" });
  try {
    const session = await getSession("getSession");
    authDebug("AUTH_READY", { source: "getSession", authReady: true, hasSession: Boolean(session), hasUser: Boolean(session?.user) });
    return { session, user: session?.user ?? null, error: null };
  } catch (cause) {
    authDebug("AUTH_READY", { source: "getSession", authReady: true, hasSession: false, hasUser: false, errorName: cause instanceof Error ? cause.name : "Error" });
    return {
      session: null,
      user: null,
      error: cause instanceof Error ? cause.message : "로그인 상태를 복원하지 못했어요.",
    };
  }
}

/** Retry an expired bearer once without changing a public route into a guest route. */
export async function refreshSession(): Promise<AppSession | null> {
  if (!supabase) return null;
  authDebug("TOKEN_REFRESH_START", { source: "refreshSession" });
  const { data, error } = await supabase.auth.refreshSession();
  if (error) {
    authDebug("TOKEN_REFRESH_FAILED", { source: "refreshSession", errorName: error.name });
    return null;
  }
  const session = toAppSession(data.session);
  authDebug(session ? "TOKEN_REFRESH_SUCCESS" : "TOKEN_REFRESH_FAILED", { source: "refreshSession", hasSession: Boolean(session) });
  return session;
}

export async function getCurrentUser(): Promise<AppUser | null> { return (await getSession())?.user ?? null; }

export async function getAccessToken(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("로그인이 필요합니다.");
  return session.accessToken;
}

export function onAuthStateChange(listener: (user: AppUser | null, event: AuthChangeEvent) => void): () => void {
  if (!supabase) return () => undefined;
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    const appSession = toAppSession(session);
    authDebug(event === "INITIAL_SESSION" ? "INITIAL_SESSION" : "AUTH_STATE_CHANGE", {
      source: event,
      event,
      hasSession: Boolean(appSession),
      hasUser: Boolean(appSession?.user),
    });
    listener(appSession?.user ?? null, event);
  });
  return () => data.subscription.unsubscribe();
}

export async function completeOAuthCallback(): Promise<void> {
  if (!supabase) throw new Error("로그인 설정이 필요합니다.");
  authDebug("CALLBACK_START", { source: "callback" });
  const code = new URLSearchParams(window.location.search).get("code");
  if (!code) {
    const session = await getSession();
    if (!session) throw new Error("로그인 세션을 찾지 못했어요.");
    authDebug("SESSION_CONFIRMED", { source: "callback", hasSession: true });
    return;
  }
  try {
    if (sessionStorage.getItem(CALLBACK_CODE_KEY) === code) return;
    sessionStorage.setItem(CALLBACK_CODE_KEY, code);
  } catch { /* duplicate guard is best effort only */ }
  authDebug("CODE_EXCHANGE_START", { source: "callback" });
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  // detectSessionInUrl may finish the same exchange first in some WebViews.
  // In that case only accept the error when there still is no persisted session.
  if (error) {
    const existing = await getSession();
    if (!existing) {
      authDebug("CALLBACK_FAILED", { source: "callback", errorName: error.name });
      throw error;
    }
    authDebug("SESSION_CONFIRMED", { source: "callback", hasSession: true });
    return;
  }
  // Do not navigate away until Supabase has written and re-read the session.
  const session = await getSession();
  if (!session) throw new Error("로그인 세션을 저장하지 못했어요.");
  authDebug("SESSION_CONFIRMED", { source: "callback", hasSession: true });
}
