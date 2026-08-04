// localStorage bookkeeping for attributing pre-login guest contributions to an account.
// Kept free of network/env imports so it is unit-testable with a localStorage stub.
//
// A participant's contributor identity is stored per album as `momento-collab-session:<id>`
// (see api.ts CollabSession). After login we send the guest ids to /auth/bootstrap; the
// ones the backend attributes get FLAGGED (not deleted) so they aren't resent — deleting
// would drop an in-progress participant session's contribution headers.

export const COLLAB_SESSION_KEY = "momento-collab-session";
// A single login attributes at most this many contributions — bounds the bootstrap payload.
export const MAX_CONTRIBUTION_ATTRIBUTIONS = 50;

type StoredCollabSession = { guestId?: string | null; attributed?: boolean };

function collabSessionKeys(): string[] {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key && key.startsWith(`${COLLAB_SESSION_KEY}:`)) keys.push(key);
  }
  return keys;
}

/** Guest ids from local contributor sessions not yet attributed, deduped and capped. */
export function collectContributorGuestIds(): string[] {
  try {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const key of collabSessionKeys()) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const session = JSON.parse(raw) as StoredCollabSession;
      if (session.attributed || !session.guestId || seen.has(session.guestId)) continue;
      seen.add(session.guestId);
      ids.push(session.guestId);
      if (ids.length >= MAX_CONTRIBUTION_ATTRIBUTIONS) break;
    }
    return ids;
  } catch {
    return [];
  }
}

/** Flag attributed sessions so they aren't resent. We keep the session (not delete it) so
 *  an in-progress participant session's contribution headers are never dropped. */
export function markContributionsAttributed(guestIds: string[]): void {
  if (!guestIds.length) return;
  const claimed = new Set(guestIds);
  try {
    for (const key of collabSessionKeys()) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const session = JSON.parse(raw) as StoredCollabSession;
      if (session.guestId && claimed.has(session.guestId) && !session.attributed) {
        localStorage.setItem(key, JSON.stringify({ ...session, attributed: true }));
      }
    }
  } catch {
    /* best-effort */
  }
}
