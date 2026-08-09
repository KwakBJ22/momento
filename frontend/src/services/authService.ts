import type { AuthChangeEvent, Provider, Session, User } from "@supabase/supabase-js";
import { BRAND_DEFAULT_USER_NAME } from "../lib/brand";
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

const RETURN_TO_KEY = "woorialbum-auth-return-to";
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
    displayName: metadataName(metadata) || text(user.email)?.split("@")[0] || BRAND_DEFAULT_USER_NAME,
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

/**
 * OAuth must always return to the browser that initiated it.  Do not use an
 * environment-provided site URL here: a local Vite session must not be sent to
 * the production host.
 */
export function oauthCallbackRedirectUrl(returnTo: string): string {
  const callback = new URL("/auth/callback", window.location.origin);
  callback.searchParams.set("returnTo", safeReturnTo(returnTo));
  return callback.toString();
}

export async function signIn(provider: AuthProvider, returnTo?: string): Promise<void> {
  if (!supabase || !isSupabaseAuthConfigured) throw new Error("로그인 설정이 필요합니다.");
  persistReturnTo(returnTo);
  const oauthProvider = oauthProviderFor(provider);
  const callbackReturnTo = safeReturnTo(returnTo || `${window.location.pathname}${window.location.search}${window.location.hash}`);
  const { error } = await supabase.auth.signInWithOAuth({
    provider: oauthProvider,
    options: {
      redirectTo: oauthCallbackRedirectUrl(callbackReturnTo),
      // 카카오 콘솔의 동의항목과 정확히 일치해야 한다(콘솔과 이 값은 반드시 같이
      // 움직인다): 카카오 식별자=필수, 닉네임=선택, 프로필사진=이용 중,
      // 이메일=사용 안 함. Supabase 기본 scope는 account_email 을 포함하는데
      // 콘솔에서 이메일이 꺼져 있으면 카카오가 KOE205 로 거부한다.
      ...(oauthProvider === "kakao" ? { scopes: "profile_nickname profile_image" } : {}),
    },
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

function oauthCallbackError(params: URLSearchParams): Error | null {
  const error = params.get("error");
  if (!error) return null;
  const description = params.get("error_description");
  return new Error(description ? `${error}: ${description}` : error);
}

export async function completeOAuthCallback(): Promise<AppSession> {
  if (!supabase) throw new Error("로그인 설정이 필요합니다.");
  authDebug("CALLBACK_START", { source: "callback" });
  const params = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const callbackError = oauthCallbackError(params) || oauthCallbackError(hashParams);
  if (callbackError) throw callbackError;
  // Implicit OAuth is parsed once by the singleton client's
  // detectSessionInUrl initialization. getSession waits for that initialization
  // before returning the persisted session, including under StrictMode.
  const hasImplicitTokens = Boolean(hashParams.get("access_token"));
  const session = await getSession(hasImplicitTokens ? "callback_implicit" : "callback_without_tokens");
  if (!session) throw new Error("로그인 세션을 찾지 못했어요.");
  authDebug("SESSION_CONFIRMED", { source: "callback", hasSession: true });
  return session;
}
