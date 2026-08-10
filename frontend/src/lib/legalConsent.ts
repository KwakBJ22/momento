/**
 * 약관 동의 — **기기에 남는 값은 힌트일 뿐이다** (K-14 · SCREEN_SPEC §11).
 *
 * 진짜 기록은 서버(`profiles.legal_agreed_at` · `legal_agreed_version`)에 있다.
 * 여기 있는 값은 오직 하나를 위한 것이다 — **이 기기에서 다시 묻지 않기.**
 * 지울 수도 고칠 수도 있으므로 근거로 쓰지 않는다. 판정은 서버가 한다(§10).
 *
 * ★ **왜 로그인 전에 이 값이 필요한가** — 체크박스는 로그인 화면에 있고, 그때는 아직
 *   그 사람이 누구인지 모른다. 서버 기록만으로는 "이미 동의했으니 숨긴다" 를 로그인
 *   전에 판단할 수 없다. 그래서 이 기기가 이 버전에 동의한 적이 있으면 안 묻는다.
 * ★ **sessionStorage 를 쓰지 않는다**(24차 §11). 카카오 로그인은 앱 밖으로 나갔다
 *   돌아오는 길이라 그 사이 웹뷰가 새로 뜨면 통째로 사라진다 — K-9 에서 배운 것이다.
 */

/** 지금 받고 있는 문서 버전. 백엔드 `services/legal_consent.py` 와 **같은 값**이다. */
export const LEGAL_DOCUMENT_VERSION = "2026-08-09";

const DEVICE_CONSENT_KEY = "woorialbum-legal-consent";

export interface DeviceConsent {
  userId: string;
  version: string;
}

/** 동의를 마쳤다는 사실을 이 기기에 남긴다 — 누가·어느 버전에 했는지까지. */
export function rememberDeviceConsent(userId: string, version: string = LEGAL_DOCUMENT_VERSION): void {
  try {
    localStorage.setItem(DEVICE_CONSENT_KEY, JSON.stringify({ userId, version }));
  } catch {
    /* 남기지 못해도 동의 자체는 서버에 있다 — 다음에 한 번 더 물을 뿐이다. */
  }
}

export function readDeviceConsent(): DeviceConsent | null {
  try {
    const raw = localStorage.getItem(DEVICE_CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DeviceConsent>;
    if (!parsed || typeof parsed.userId !== "string" || typeof parsed.version !== "string") return null;
    return { userId: parsed.userId, version: parsed.version };
  } catch {
    return null;
  }
}

export function clearDeviceConsent(): void {
  try { localStorage.removeItem(DEVICE_CONSENT_KEY); } catch { /* no-op */ }
}

/**
 * 로그인 화면에서 **동의 체크를 보일 것인가.**
 *
 * ★ 안 보이거나, 보이면 **비어 있다.** 미리 체크된 상태로 보여주지 않는다 —
 *   켜져 있는 동의는 동의가 아니다.
 */
export function showsConsentCheckbox(stored: DeviceConsent | null, version: string = LEGAL_DOCUMENT_VERSION): boolean {
  return !stored || stored.version !== version;
}

/** 동의를 남기지 못했을 때 화면에 낼 말 (K-14 · §11). 화면이 직접 쓰지 않는다. */
export function legalConsentTroubleMessage(): string {
  return "동의를 기록하지 못했어요. 잠시 후 다시 시도해 주세요.";
}
