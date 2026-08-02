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
  setPendingGuestClaim, takePendingGuestClaim,
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

test("a pending claim is consumed exactly once", () => {
  setPendingGuestClaim("album-c");
  assert.equal(takePendingGuestClaim(), "album-c");
  assert.equal(takePendingGuestClaim(), null); // second read is empty
});
