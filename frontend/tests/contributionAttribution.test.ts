import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

// Minimal in-memory localStorage so the real functions run (node has none).
class MemoryStorage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

const {
  collectContributorGuestIds,
  markContributionsAttributed,
  COLLAB_SESSION_KEY,
  MAX_CONTRIBUTION_ATTRIBUTIONS,
} = await import("../src/lib/contributionAttribution");

function saveSession(albumId: string, guestId: string | null, attributed = false) {
  localStorage.setItem(`${COLLAB_SESSION_KEY}:${albumId}`, JSON.stringify({ albumId, guestId, attributed }));
}

beforeEach(() => localStorage.clear());

test("collects deduped guest ids from unattributed contributor sessions", () => {
  saveSession("A1", "G1");
  saveSession("A2", "G2");
  saveSession("A3", "G1"); // duplicate guest id across albums
  saveSession("A4", null); // no guest id (signed-in contribution)
  const ids = collectContributorGuestIds().sort();
  assert.deepEqual(ids, ["G1", "G2"]);
});

test("attributed sessions are not re-collected (no unbounded payload)", () => {
  saveSession("A1", "G1");
  saveSession("A2", "G2");
  markContributionsAttributed(["G1"]);
  assert.deepEqual(collectContributorGuestIds(), ["G2"]);
});

test("markContributionsAttributed flags the session but keeps it (headers not dropped)", () => {
  saveSession("A1", "G1");
  markContributionsAttributed(["G1"]);
  const raw = localStorage.getItem(`${COLLAB_SESSION_KEY}:A1`);
  assert.ok(raw, "session must still exist after attribution");
  const session = JSON.parse(raw!);
  assert.equal(session.attributed, true);
  assert.equal(session.guestId, "G1"); // identity preserved for contribution calls
});

test("collection is capped so a login never sends an unbounded payload", () => {
  for (let i = 0; i < MAX_CONTRIBUTION_ATTRIBUTIONS + 10; i += 1) saveSession(`A${i}`, `G${i}`);
  assert.equal(collectContributorGuestIds().length, MAX_CONTRIBUTION_ATTRIBUTIONS);
});

test("ignores non-collab localStorage keys", () => {
  localStorage.setItem("woorialbum-guest-album-token:X", "some-token");
  saveSession("A1", "G1");
  assert.deepEqual(collectContributorGuestIds(), ["G1"]);
});
