/**
 * 함께 만들기 초대 링크(/join/…) — 읽거나 없으면 발급한다.
 *
 * ★ 원래 `components/CollaborationPanel.tsx` 안에 있었고 거기서 export 하고 있었다.
 *   공유 시트를 공용 컴포넌트로 뽑으면서(I-2) 시트와 패널이 서로를 import 하는
 *   고리가 생기므로, **둘 다 여기서 가져다 쓴다.** 로직은 그대로다 —
 *   같은 저장 키를 쓰므로 중복 발급이 생기지 않는다.
 *
 * 구경용(/s/) 링크와는 다른 링크다. 무엇을 보내는지가 다르기 때문이다(§5).
 */

import { rotateCollaborationInvite } from "./api";

const inviteUrlStorageKey = (albumId: string) => `momento-collaboration-invite-url:${albumId}`;

export function isContributionInviteUrl(value: string | null | undefined): boolean {
  try {
    return new URL(value || "", window.location.origin).pathname.startsWith("/join/");
  } catch {
    return false;
  }
}

export function readStoredInviteUrl(albumId: string): string | null {
  try {
    const key = inviteUrlStorageKey(albumId);
    const durable = localStorage.getItem(key);
    if (isContributionInviteUrl(durable)) return durable;
    const temporary = sessionStorage.getItem(key);
    return isContributionInviteUrl(temporary) ? temporary : null;
  } catch {
    return null;
  }
}

export function storeInviteUrl(albumId: string, inviteUrl: string): void {
  try {
    localStorage.setItem(inviteUrlStorageKey(albumId), inviteUrl);
  } catch {
    try { sessionStorage.setItem(inviteUrlStorageKey(albumId), inviteUrl); } catch { /* 저장 실패해도 링크는 유효 */ }
  }
}

export function forgetInviteUrl(albumId: string): void {
  const key = inviteUrlStorageKey(albumId);
  try { localStorage.removeItem(key); } catch { /* 무시 */ }
  try { sessionStorage.removeItem(key); } catch { /* 무시 */ }
}

/** 저장된 초대 링크가 있으면 그것을, 없으면 새로 발급해서 돌려준다. */
export async function ensureAlbumInviteUrl(albumId: string): Promise<string> {
  const stored = readStoredInviteUrl(albumId);
  if (stored) return stored;
  const created = await rotateCollaborationInvite(albumId);
  storeInviteUrl(albumId, created.invite_url);
  return created.invite_url;
}
