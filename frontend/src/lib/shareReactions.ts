import { createId } from "./id";

// Participation design §2: album-level reactions. 3 codes, anonymous aggregate.
export type ReactionCode = "love" | "moved" | "smile";

export const REACTIONS: Array<{ code: ReactionCode; emoji: string; label: string }> = [
  { code: "love", emoji: "❤️", label: "좋아요" },
  { code: "moved", emoji: "🥹", label: "뭉클해요" },
  { code: "smile", emoji: "😊", label: "웃음이 나요" },
];

const SESSION_KEY = "woorialbum-reaction-session";
const pressedKey = (albumId: string) => `woorialbum-reactions:${albumId}`;

/** A stable per-browser session key so re-pressing dedupes by session_hash on the server. */
export function getReactionSessionKey(): string {
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing && existing.length >= 16) return existing;
  } catch {
    // Private WebViews can reject storage; fall through to an ephemeral key.
  }
  // ★ 여기는 옵셔널 체이닝이라 죽지는 않았지만, 옛 아이폰에서는 두 값이 다 빈 문자열이
  //   되어 **모두가 같은 열쇠**를 쓰게 됐다. 감싸는 일은 `lib/id` 하나가 한다.
  const created = `${createId()}${createId()}`;
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
