// Participation design §2: album-level reactions. 3 codes, anonymous aggregate.
export type ReactionCode = "love" | "moved" | "smile";

export const REACTIONS: Array<{ code: ReactionCode; emoji: string; label: string }> = [
  { code: "love", emoji: "❤️", label: "좋아요" },
  { code: "moved", emoji: "🥹", label: "뭉클해요" },
  { code: "smile", emoji: "😊", label: "웃음이 나요" },
];

const SESSION_KEY = "momento-reaction-session";
const pressedKey = (albumId: string) => `momento-reactions:${albumId}`;

/** A stable per-browser session key so re-pressing dedupes by session_hash on the server. */
export function getReactionSessionKey(): string {
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing && existing.length >= 16) return existing;
  } catch {
    // Private WebViews can reject storage; fall through to an ephemeral key.
  }
  const created =
    (globalThis.crypto?.randomUUID?.() ?? "") + (globalThis.crypto?.randomUUID?.() ?? "");
  const key = created.replace(/-/g, "").slice(0, 32) || `reaction-${Date.now()}-fallbackkey`;
  try { localStorage.setItem(SESSION_KEY, key); } catch { /* best effort */ }
  return key;
}

/** Which reactions this session already pressed for an album (drives the pressed UI state). */
export function readPressedReactions(albumId: string): Set<ReactionCode> {
  try {
    const raw = localStorage.getItem(pressedKey(albumId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((code): code is ReactionCode => REACTIONS.some((r) => r.code === code)));
    }
  } catch {
    // Ignore malformed/unavailable storage.
  }
  return new Set();
}

export function markReactionPressed(albumId: string, code: ReactionCode): void {
  const next = readPressedReactions(albumId);
  next.add(code);
  try { localStorage.setItem(pressedKey(albumId), JSON.stringify([...next])); } catch { /* best effort */ }
}
