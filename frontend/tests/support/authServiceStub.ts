/**
 * `services/authService` 의 테스트 대역.
 *
 * 로더(cssStub.mjs)가 import 를 이 파일로 돌린다. 진짜 authService 는 Vite 전용
 * `import.meta.env` 로 Supabase 설정 여부를 판정하는데, node 에는 그 값이 없어
 * `isAuthenticationConfigured` 가 false 가 된다. 그러면 AuthPanel 이 "로그인 설정을
 * 준비하고 있어요" 한 줄만 그리고 끝나서 **동의·로그인 화면 자체를 볼 수 없다.**
 *
 * 실제 로그인은 이 테스트의 관심사가 아니다(외부 OAuth). 화면이 그려지게만 한다.
 */

export type AuthProvider = "kakao" | "naver";
export interface AppUser { id: string; displayName: string; avatarUrl: string | null; email: string | null; phone: string | null; provider: AuthProvider | null }
export interface AppSession { user: AppUser; accessToken: string }
export interface AuthInitialization { session: AppSession | null; user: AppUser | null; error: string | null }

export const isAuthenticationConfigured = true;

/** 테스트가 "무엇으로 로그인을 시작했는가" 를 확인할 수 있게 기록만 남긴다. */
export const signInCalls: AuthProvider[] = [];

export async function signIn(provider: AuthProvider): Promise<void> {
  signInCalls.push(provider);
}

/** 동의 기록 대역 (K-14) — 진짜와 같은 규칙으로, 저장소 대신 여기에 남긴다. */
let legalConsentRemembered = false;
export function rememberLegalConsent(): void { legalConsentRemembered = true; }
export function readLegalConsent(): boolean { return legalConsentRemembered; }
export function forgetLegalConsent(): void { legalConsentRemembered = false; }

export function oauthProviderFor(provider: AuthProvider): string {
  return provider === "naver" ? "custom:naver" : "kakao";
}
export function consumeReturnTo(): string { return "/"; }
export function oauthCallbackRedirectUrl(): string { return "https://test.local/auth/callback"; }
export async function signOut(): Promise<void> {}
export async function getSession(): Promise<AppSession | null> { return null; }
export async function initializeAuth(): Promise<AuthInitialization> { return { session: null, user: null, error: null }; }
export async function refreshSession(): Promise<AppSession | null> { return null; }
export async function getCurrentUser(): Promise<AppUser | null> { return null; }
export async function getAccessToken(): Promise<string> { return ""; }
export function onAuthStateChange(): () => void { return () => {}; }
export async function completeOAuthCallback(): Promise<AppSession> { throw new Error("테스트 대역"); }
export function toAppUser(): AppUser {
  return { id: "user", displayName: "테스트", avatarUrl: null, email: null, phone: null, provider: "kakao" };
}
