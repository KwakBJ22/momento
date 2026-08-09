import assert from "node:assert/strict";
import test from "node:test";

// Minimal in-memory Web Storage so the module's real read/write path runs in node.
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
(globalThis as unknown as { sessionStorage: MemoryStorage }).sessionStorage = new MemoryStorage();

const {
  saveGuestAlbumToken, getGuestAlbumToken, clearGuestAlbumToken, hasGuestAlbumToken,
  clearPendingGuestClaim, readPendingGuestClaim, setPendingGuestClaim,
} = await import("../src/lib/guestAlbum");

test("a guest album token round-trips per album and is scoped by id", () => {
  saveGuestAlbumToken("album-a", "tok-a");
  saveGuestAlbumToken("album-b", "tok-b");
  assert.equal(getGuestAlbumToken("album-a"), "tok-a");
  assert.equal(getGuestAlbumToken("album-b"), "tok-b");
  assert.equal(hasGuestAlbumToken("album-a"), true);
  assert.equal(hasGuestAlbumToken("album-unknown"), false);
});

test("clearing one token leaves the others intact", () => {
  saveGuestAlbumToken("album-a", "tok-a");
  saveGuestAlbumToken("album-b", "tok-b");
  clearGuestAlbumToken("album-a");
  assert.equal(getGuestAlbumToken("album-a"), null);
  assert.equal(getGuestAlbumToken("album-b"), "tok-b");
});

/**
 * ★ 이 테스트는 K-9 에서 **뒤집혔다.** 예전에는 "의도는 한 번만 읽힌다"였다.
 *   그 한 번이 가져오기가 **끝나기 전에** 소모되는 바람에, 로그인 왕복 직후 요청이
 *   끊기면(프로덕션 로그의 499) 다시 시도할 방법이 없었고 앨범이 주인 없이 남았다.
 *   이제는 **성공했을 때** 지운다. 자세한 것은 `guestAlbumClaim.test.ts`.
 */
test("a pending claim survives until it is explicitly cleared", () => {
  setPendingGuestClaim("album-c");
  assert.equal(readPendingGuestClaim(), "album-c");
  assert.equal(readPendingGuestClaim(), "album-c"); // 끝날 때까지 남아 있는다
  clearPendingGuestClaim();
  assert.equal(readPendingGuestClaim(), null);
});
