import assert from "node:assert/strict";
import test from "node:test";

// In-memory sessionStorage so the module's real read/write path runs in node.
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
const store = new MemoryStorage();
(globalThis as unknown as { sessionStorage: MemoryStorage }).sessionStorage = store;

const { readCreateStep, saveCreateStep, PENDING_CATEGORY_KEY } = await import("../src/lib/createStep");

test("a photo step round-trips through storage (survives a restart)", () => {
  store.clear();
  saveCreateStep("family", true);
  const restored = readCreateStep();
  assert.equal(restored.category, "family");
  assert.equal(restored.photoStep, true);
});

test("no step is stored until photo selection is reached", () => {
  store.clear();
  saveCreateStep("friend", false); // category picked but not yet in photo step
  assert.equal(store.getItem(PENDING_CATEGORY_KEY), null);
  assert.deepEqual(readCreateStep(), { category: null, photoStep: false });
});

test("resetting (null category) clears the persisted step", () => {
  store.clear();
  saveCreateStep("couple", true);
  saveCreateStep(null, false);
  assert.equal(store.getItem(PENDING_CATEGORY_KEY), null);
});

test("a legacy plain-string value does not crash and reads as no step", () => {
  store.clear();
  store.setItem(PENDING_CATEGORY_KEY, "family"); // old format before JSON
  assert.deepEqual(readCreateStep(), { category: null, photoStep: false });
});
