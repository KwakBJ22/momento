import type { AlbumResult } from "../types";
import { getAccessToken } from "./supabase";

/**
 * API 베이스 URL 해석 우선순위:
 * 1) VITE_API_BASE_URL (명시적 설정)
 * 2) 개발 모드 → localhost:8000
 * 3) 프로덕션 → '' (같은 origin, Vercel /api 프록시 경유)
 */
export function resolveApiBase(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (import.meta.env.DEV) return "http://localhost:8000";
  return "";
}

export const API_BASE = resolveApiBase();

export async function authenticatedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

async function parseError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  const detail = body?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((d: { msg?: string }) => d.msg).join(", ");
  return "요청을 처리하지 못했어요.";
}

export async function getAlbum(albumId: string): Promise<AlbumResult> {
  const response = await fetch(`${API_BASE}/api/albums/${albumId}`);
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as AlbumResult;
}

export async function patchNarrative(albumId: string, narrative: string): Promise<AlbumResult> {
  const response = await authenticatedFetch(`/api/albums/${albumId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ narrative }),
  });
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as AlbumResult;
}

export async function regenerateStory(albumId: string): Promise<{ narrative: string }> {
  const response = await authenticatedFetch(`/api/albums/${albumId}/story/regenerate`, { method: "POST" });
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as { narrative: string };
}

export async function getPublicShare(token: string): Promise<import("../types").PublicShareAlbum> {
  const response = await fetch(`${API_BASE}/api/public/shares/${encodeURIComponent(token)}`);
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as import("../types").PublicShareAlbum;
}

export async function submitGuestMemory(token: string, body: { name: string; memory: string; website: string }): Promise<{ claim_token: string }> {
  const response = await fetch(`${API_BASE}/api/public/shares/${encodeURIComponent(token)}/guest-memories`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as { claim_token: string };
}

export async function submitShareReaction(token: string, reaction: string, sessionKey: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/public/shares/${encodeURIComponent(token)}/reactions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reaction, session_key: sessionKey }) });
  if (!response.ok) throw new Error(await parseError(response));
}

export async function claimGuestMemory(claimToken: string): Promise<void> {
  const response = await authenticatedFetch("/api/guest-memories/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ claim_token: claimToken }) });
  if (!response.ok) throw new Error(await parseError(response));
}

export async function claimGuestAlbum(guestToken: string): Promise<{ album_id: string }> {
  const response = await authenticatedFetch("/api/guest-albums/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ guest_token: guestToken }) });
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as { album_id: string };
}

export function trackGuestEvent(eventName: "landing_viewed" | "primary_cta_clicked" | "preview_viewed" | "save_cta_clicked" | "login_started" | "enrichment_started"): void {
  void fetch(`${API_BASE}/api/guest-analytics`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_name: eventName }) }).catch(() => undefined);
}

export async function createAlbumShareLink(albumId: string, expiresAt?: string): Promise<{ share_url: string }> {
  const response = await authenticatedFetch(`/api/albums/${albumId}/share-links`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expires_at: expiresAt || null }) });
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as { share_url: string };
}

export async function getMyFamily(): Promise<import("../types").FamilySummary> {
  const response = await authenticatedFetch("/api/families/me");
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as import("../types").FamilySummary;
}

export async function getFamilyMembers(familyId: string): Promise<import("../types").FamilyMemberItem[]> {
  const response = await authenticatedFetch(`/api/families/${familyId}/members`);
  if (!response.ok) throw new Error(await parseError(response));
  const body = (await response.json()) as { members: import("../types").FamilyMemberItem[] };
  return body.members;
}

export async function getFamilyInvitations(familyId: string): Promise<import("../types").FamilyInvitationItem[]> {
  const response = await authenticatedFetch(`/api/families/${familyId}/invitations`);
  if (!response.ok) throw new Error(await parseError(response));
  const body = (await response.json()) as { invitations: import("../types").FamilyInvitationItem[] };
  return body.invitations;
}

export async function createFamilyInvitation(
  familyId: string,
  inviteeEmail: string,
  role: import("../types").InvitableFamilyRole,
): Promise<{ invite_url: string; invite_token: string }> {
  const response = await authenticatedFetch(`/api/families/${familyId}/invitations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invitee_email: inviteeEmail, role }),
  });
  if (!response.ok) throw new Error(await parseError(response));
  const body = (await response.json()) as { invite_url: string; invite_token: string };
  return body;
}

export async function cancelFamilyInvitation(familyId: string, invitationId: string): Promise<void> {
  const response = await authenticatedFetch(`/api/families/${familyId}/invitations/${invitationId}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(await parseError(response));
}

export async function updateFamilyMemberRole(
  familyId: string,
  memberId: string,
  role: import("../types").InvitableFamilyRole,
): Promise<void> {
  const response = await authenticatedFetch(`/api/families/${familyId}/members/${memberId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!response.ok) throw new Error(await parseError(response));
}

export async function removeFamilyMember(familyId: string, memberId: string): Promise<void> {
  const response = await authenticatedFetch(`/api/families/${familyId}/members/${memberId}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(await parseError(response));
}

export async function acceptFamilyInvitation(token: string): Promise<string> {
  const response = await authenticatedFetch("/api/family-invitations/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!response.ok) throw new Error(await parseError(response));
  const body = (await response.json()) as { family_id: string };
  return body.family_id;
}

export async function getAlbumMembers(albumId: string): Promise<import("../types").AlbumMemberItem[]> {
  const response = await authenticatedFetch(`/api/albums/${albumId}/members`);
  if (!response.ok) throw new Error(await parseError(response));
  const body = (await response.json()) as { members: import("../types").AlbumMemberItem[] };
  return body.members;
}

export async function addAlbumMember(
  albumId: string,
  profileId: string,
  role: import("../types").AlbumMemberRole,
): Promise<void> {
  const response = await authenticatedFetch(`/api/albums/${albumId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile_id: profileId, role }),
  });
  if (!response.ok) throw new Error(await parseError(response));
}

export async function updateAlbumMemberRole(
  albumId: string,
  memberId: string,
  role: import("../types").AlbumMemberRole,
): Promise<void> {
  const response = await authenticatedFetch(`/api/albums/${albumId}/members/${memberId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!response.ok) throw new Error(await parseError(response));
}

export async function removeAlbumMember(albumId: string, memberId: string): Promise<void> {
  const response = await authenticatedFetch(`/api/albums/${albumId}/members/${memberId}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(await parseError(response));
}

export async function getMemoryQuestions(
  albumId: string,
): Promise<{ questions: import("../types").MemoryQuestion[]; can_regenerate: boolean; can_analyze_media: boolean }> {
  const response = await authenticatedFetch(`/api/albums/${albumId}/memory/questions`);
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as {
    questions: import("../types").MemoryQuestion[];
    can_regenerate: boolean;
    can_analyze_media: boolean;
  };
}

export async function generateMemoryQuestions(
  albumId: string,
  options?: { mediaId?: string; force?: boolean },
): Promise<void> {
  const response = await authenticatedFetch(`/api/albums/${albumId}/memory/questions/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_id: options?.mediaId ?? null,
      force: options?.force ?? false,
    }),
  });
  if (!response.ok) throw new Error(await parseError(response));
}

export async function regenerateMemoryQuestions(albumId: string, mediaId?: string): Promise<void> {
  const response = await authenticatedFetch(`/api/albums/${albumId}/memory/questions/regenerate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_id: mediaId ?? null, force: true }),
  });
  if (!response.ok) throw new Error(await parseError(response));
}

export async function saveMemoryAnswer(questionId: string, answer: string): Promise<void> {
  const response = await authenticatedFetch(`/api/memory/questions/${questionId}/answers`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer, answer_type: "text" }),
  });
  if (!response.ok) throw new Error(await parseError(response));
}

export async function analyzeAlbumMedia(albumId: string, mediaId?: string): Promise<void> {
  const response = await authenticatedFetch(`/api/albums/${albumId}/media/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_id: mediaId ?? null }),
  });
  if (!response.ok) throw new Error(await parseError(response));
}
