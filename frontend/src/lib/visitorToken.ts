import { createId } from "./id";

/**
 * 이 브라우저를 가리키는 **무작위 문자열 하나**. 방문자를 사람 단위로 세기 위한 것이다.
 *
 * ★ 개인정보가 아니다. 이름도 이메일도 아닌 무작위 값이고, 서버는 이 값을 그대로 두지
 *   않고 **해시만** 저장한다(album_guestbook_entries.session_hash 와 같은 방식).
 *   서버는 IP·User-Agent 를 쓰지 않는다.
 * ★ 이 값으로 사람을 알아낼 수 없고, 브라우저 데이터를 지우면 새 값이 된다
 *   (그러면 다음부터 다른 사람으로 세어질 뿐, 잃는 것이 없다).
 *
 * 로그인한 사람은 서버가 계정으로 센다 — 그 판정은 서버 한 곳(visitor_key)에 있다.
 */
const STORAGE_KEY = "woorialbum-visitor";

export function getVisitorToken(): string | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored.length >= 16) return stored;
    const created = createId();
    localStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    // 저장소를 못 쓰는 브라우저(카카오 웹뷰의 일부 상태)에서는 세지 않는다.
    // 조용히 넘어간다 — 숫자 하나 때문에 화면이 막히면 안 된다.
    return null;
  }
}
