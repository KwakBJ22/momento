const KEY_PREFIX = "woorialbum-bootstrap:";
/** 이 시간 안에 이미 성공했으면 다시 부르지 않는다. */
const FRESH_MS = 5 * 60 * 1000;

export interface BootstrapCache {
  at: number;
  album_count?: number;
  max_albums?: number;
  /** 이 계정에 동의 기록이 있는가. 없으면 캐시가 싱싱해도 다시 물어야 한다. */
  legal_agreed?: boolean;
}

/**
 * `/api/auth/bootstrap` 를 화면을 옮길 때마다 다시 부르지 않게 한다.
 *
 * ★ 왜 여러 번 불렸나: 이 앱은 화면을 옮길 때 `window.location.assign` 으로 **페이지를
 *   통째로 다시 연다.** 그때마다 App 이 새로 마운트되고 이 요청이 또 나갔다.
 *   운영 로그 08-13 08:54 에 20초 사이 세 번(234ms · 160ms · 94ms) 찍혔다.
 * ★ 그런데 bootstrap 이 실제로 **할 일이 있는 경우**는 정해져 있다:
 *     · 게스트로 남긴 것을 계정에 붙일 때 (contributor_guest_ids)
 *     · 약관 동의를 아직 못 실어 보냈을 때 (legal_agreed)
 *   둘 다 없으면 서버가 하는 일은 앨범 수·한도를 세어 돌려주는 것뿐이다.
 *   그 숫자는 만들기 전 경고용이고 **진짜 한도는 백엔드가 막는다** — 몇 분 묵어도 된다.
 * ★ 그래서 할 일이 없고 최근에 성공했으면 건너뛰고, 저장해 둔 숫자를 그대로 쓴다.
 *
 * 저장은 localStorage 다 — sessionStorage 는 카카오 로그인 왕복에서 사라진다.
 */
export function readBootstrapCache(userId: string, now: number): BootstrapCache | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(KEY_PREFIX + userId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BootstrapCache | null;
    if (!parsed || typeof parsed.at !== "number") return null;
    // 시계가 뒤로 갔거나(기기 시간 변경) 너무 오래됐으면 없는 것으로 본다.
    if (now - parsed.at < 0 || now - parsed.at > FRESH_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeBootstrapCache(userId: string, value: BootstrapCache): void {
  if (!userId) return;
  try {
    localStorage.setItem(KEY_PREFIX + userId, JSON.stringify(value));
  } catch {
    /* 저장이 막혀 있어도 동작은 같다 — 매번 부를 뿐이다. */
  }
}

/** 앨범을 만들거나 지운 뒤처럼 **숫자가 달라졌을 때** 지운다. */
export function forgetBootstrapCache(userId: string): void {
  if (!userId) return;
  try {
    localStorage.removeItem(KEY_PREFIX + userId);
  } catch {
    /* noop */
  }
}

/**
 * 지금 bootstrap 을 불러야 하는가.
 *
 * 할 일이 하나라도 있으면 **무조건 부른다** — 게스트가 남긴 것과 약관 동의는
 * 늦추면 안 된다(K-14). 할 일이 없을 때만 최근 성공을 믿는다.
 */
export function shouldCallBootstrap(input: {
  guestIds: string[];
  legalAgreed: boolean;
  cache: BootstrapCache | null;
}): boolean {
  if (input.guestIds.length > 0) return true;
  if (input.legalAgreed) return true;
  // 아직 동의를 안 받은 계정이면 건너뛰지 않는다 — 건너뛰면 물을 기회를 잃는다.
  if (input.cache?.legal_agreed === false) return true;
  return input.cache === null;
}
