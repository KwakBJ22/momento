/**
 * 무작위 식별자 — **늘 UUID 모양**이다.
 *
 * 🔴 `crypto.randomUUID` 는 **iOS 15.4 부터** 있다. 그 아래 아이폰에서는 그것을 바로
 *    부르던 자리가 그 순간 죽었다(앨범 만들기가 거기서 멈췄다). 기기를 오래 쓰는 층이
 *    우리 사용자라 3~4년 된 아이폰이 흔하다.
 *
 * ★ 대비값도 **반드시 UUID 모양**이어야 한다. 이 값은 헤더로 서버에 가고, 서버는
 *   `UUID(...)` 로 읽는다 — 모양이 다르면 400 이다. 예전 대비값(`id-...`)은 그
 *   조건을 못 맞췄다: 죽는 대신 만들기가 실패했을 뿐이다.
 * ★ 부르는 자리는 이 함수만 쓴다. 자리마다 각자 `randomUUID` 를 감싸면 한쪽만 고쳐진다.
 * ★ 안전하지 않은 자리(http://LAN-IP)에서도 `randomUUID` 가 없거나 던진다 — 예전부터
 *   보던 갈래이고 그대로 둔다.
 */

/** 무작위 바이트 16개. `crypto.getRandomValues` 는 아주 오래된 사파리에도 있다. */
function randomBytes(): Uint8Array {
  const bytes = new Uint8Array(16);
  try {
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      crypto.getRandomValues(bytes);
      return bytes;
    }
  } catch {
    // 아주 드물게 막힌다 — 그때는 아래로 내려간다.
  }
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

/** RFC 4122 v4 모양으로 맞춘다(버전·변형 자리). */
function uuidFromBytes(bytes: Uint8Array): string {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex: string[] = [];
  for (let index = 0; index < bytes.length; index += 1) {
    hex.push(bytes[index].toString(16).padStart(2, "0"));
  }
  const joined = hex.join("");
  return [
    joined.slice(0, 8), joined.slice(8, 12), joined.slice(12, 16),
    joined.slice(16, 20), joined.slice(20, 32),
  ].join("-");
}

export function createId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Non-secure contexts (HTTP over LAN) throw or omit randomUUID on mobile Safari/Chrome.
  }
  return uuidFromBytes(randomBytes());
}
