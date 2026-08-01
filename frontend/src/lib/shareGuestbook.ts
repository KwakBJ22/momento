// Participation design §3: album guestbook client helpers.
// Ownership for self-delete is a per-browser session key (reused from reactions —
// one anonymous public identity per browser). We also remember which entry ids
// this browser created so only those show a delete control.
import { getReactionSessionKey } from "./shareReactions";

export const GUESTBOOK_NAME_MAX = 40;
export const GUESTBOOK_MESSAGE_MAX = 200;

export function getGuestbookSessionKey(): string {
  return getReactionSessionKey();
}

const mineKey = (albumId: string) => `momento-guestbook-mine:${albumId}`;

export function readMyGuestbookIds(albumId: string): Set<string> {
  try {
    const raw = localStorage.getItem(mineKey(albumId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (Array.isArray(parsed)) return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    // Private WebViews can reject storage.
  }
  return new Set();
}

export function addMyGuestbookId(albumId: string, id: string): void {
  const next = readMyGuestbookIds(albumId);
  next.add(id);
  try { localStorage.setItem(mineKey(albumId), JSON.stringify([...next])); } catch { /* best effort */ }
}

export function removeMyGuestbookId(albumId: string, id: string): void {
  const next = readMyGuestbookIds(albumId);
  next.delete(id);
  try { localStorage.setItem(mineKey(albumId), JSON.stringify([...next])); } catch { /* best effort */ }
}
