import type { AlbumResult } from "../types";
import { getAccessToken } from "./supabase";
import type { GuestAlbumClaimInput } from "./guestAlbumClaim";

/**
 * API 베이스 URL 해석 우선순위:
 * 1) VITE_API_BASE_URL (명시적 설정) — 단, 모바일 LAN에서는 localhost 우회
 * 2) 그 외 → '' (Vite/Vercel /api 프록시)
 *
 * 폰이 http://192.168.x.x:5173 으로 접속할 때 API를 localhost:8000으로 보내면
 * 폰 자기 자신을 호출해 업로드가 실패합니다. 이 경우 Vite 프록시를 씁니다.
 */
export function resolveApiBase(): string {
  const configured = (import.meta.env.VITE_API_BASE_URL?.trim() || "").replace(/\/$/, "");
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    const onLanDevice = host !== "localhost" && host !== "127.0.0.1";
    const pointsAtLoopback = !configured || /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configured);
    if (onLanDevice && pointsAtLoopback) {
      return "";
    }
  }
  return configured;
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

export async function getAlbum(albumId: string, edition?: number | null): Promise<AlbumResult> {
  const suffix = Number.isInteger(edition) ? `?edition=${encodeURIComponent(String(edition))}` : "";
  const response = await fetch(`${API_BASE}/api/albums/${albumId}${suffix}`, { cache: "no-store" });
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as AlbumResult;
}

export type MyAlbum = {
  album_id: string;
  title: string;
  created_at: string;
  updated_at?: string | null;
  image_url: string;
  cover_photo_id?: string | null;
  cover_image_url?: string | null;
  photo_count: number;
  new_memory_count: number;
  is_latest_edition?: boolean;
};

export async function getMyAlbums(): Promise<MyAlbum[]> {
  const response = await authenticatedFetch("/api/albums/mine", { cache: "no-store" });
  if (!response.ok) throw new Error(await parseError(response));
  return ((await response.json()) as { albums: MyAlbum[] }).albums;
}

export async function getMyAlbumCoverUrls(albums: Array<Pick<MyAlbum, "album_id" | "cover_photo_id">>): Promise<Record<string, string>> {
  const targets = albums.filter((album) => Boolean(album.cover_photo_id));
  if (!targets.length) return {};
  const params = new URLSearchParams();
  for (const album of targets) {
    params.append("album_ids", album.album_id);
    params.append("cover_photo_ids", album.cover_photo_id!);
  }
  const response = await authenticatedFetch(`/api/albums/mine/covers?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(await parseError(response));
  return ((await response.json()) as { covers?: Record<string, string> }).covers ?? {};
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

export async function patchEpilogue(albumId: string, epilogue: string): Promise<AlbumResult> {
  const response = await authenticatedFetch(`/api/albums/${albumId}/epilogue`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ epilogue }),
  });
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as AlbumResult;
}

export async function generateEpilogue(
  albumId: string,
): Promise<{ epilogue: string; chapter_stories: Record<string, string>; warning: string | null; rejected: boolean }> {
  const response = await authenticatedFetch(`/api/albums/${albumId}/epilogue/generate`, {
    method: "POST",
  });
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as { epilogue: string; chapter_stories: Record<string, string>; warning: string | null; rejected: boolean };
}

export async function regenerateStory(albumId: string): Promise<{ narrative: string }> {
  const generated = await generateEpilogue(albumId);
  if (generated.rejected) {
    throw new Error(generated.warning || "이야기를 만들지 못했어요.");
  }
  return { narrative: generated.epilogue };
}

export async function getAlbumPhotos(albumId: string, edition?: number | null): Promise<import("../types").AlbumPhoto[]> {
  const suffix = Number.isInteger(edition) ? `?edition=${encodeURIComponent(String(edition))}` : "";
  const response = await authenticatedFetch(`/api/albums/${albumId}/photos${suffix}`, { cache: "no-store" });
  if (!response.ok) throw new Error(await parseError(response));
  const body = (await response.json()) as { photos: import("../types").AlbumPhoto[] };
  return body.photos;
}

export async function saveAlbumPhotoComment(albumId: string, photoId: string, comment: string): Promise<void> {
  const response = await authenticatedFetch(`/api/albums/${albumId}/photos/${photoId}/comment`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ comment: comment.trim() || null }) });
  if (!response.ok) throw new Error(await parseError(response));
}

export async function getAlbumPdfUrl(
  albumId: string,
  albumVersion: number,
): Promise<{ url: string | null; album_version: number; cached: boolean }> {
  const response = await authenticatedFetch(
    `/api/albums/${albumId}/pdf?version=${encodeURIComponent(String(albumVersion))}`,
  );
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as { url: string | null; album_version: number; cached: boolean };
}

export async function uploadAlbumPdf(albumId: string, albumVersion: number, blob: Blob): Promise<void> {
  const form = new FormData();
  form.append("file", blob, `momento-${albumId}-v${albumVersion}.pdf`);
  const response = await authenticatedFetch(
    `/api/albums/${albumId}/pdf?version=${encodeURIComponent(String(albumVersion))}`,
    { method: "PUT", body: form },
  );
  if (!response.ok) throw new Error(await parseError(response));
}

export async function updateAlbumPhotoLocation(
  albumId: string,
  photoId: string,
  payload: {
    location_name?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    location_source?: "exif" | "user" | "ai_estimated" | "unknown";
  },
): Promise<import("../types").AlbumPhoto> {
  const response = await authenticatedFetch(`/api/albums/${albumId}/photos/${photoId}/location`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      location_name: payload.location_name ?? null,
      latitude: payload.latitude ?? null,
      longitude: payload.longitude ?? null,
      location_source: payload.location_source ?? "user",
    }),
  });
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as import("../types").AlbumPhoto;
}

export async function getPublicShare(token: string, edition?: number | null): Promise<import("../types").PublicShareAlbum> {
  const params = edition ? `?edition=${encodeURIComponent(String(edition))}` : "";
  const response = await fetch(`${API_BASE}/api/public/shares/${encodeURIComponent(token)}${params}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as import("../types").PublicShareAlbum;
}

export async function updateAlbumCoverPhoto(albumId: string, photoId: string): Promise<{ cover_photo_id: string | null; cover_image_url: string | null }> {
  const response = await authenticatedFetch(`/api/albums/${albumId}/cover-photo`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photo_id: photoId }),
  });
  if (!response.ok) throw new Error(await parseError(response));
  return response.json() as Promise<{ cover_photo_id: string | null; cover_image_url: string | null }>;
}

export async function startPublicContribution(token: string, guestId: string | null, displayName: string) {
  const response = await fetch(`${API_BASE}/api/public/shares/${encodeURIComponent(token)}/contribute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guest_id: guestId, display_name: displayName }),
  });
  if (!response.ok) throw new Error(await parseError(response));
  return response.json() as Promise<{ album_id: string; contributor_id: string; guest_id: string | null; display_name: string }>;
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

export async function claimGuestAlbum(input: GuestAlbumClaimInput): Promise<{ album_id: string }> {
  const response = await authenticatedFetch("/api/guest-albums/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ guest_token: input.guestToken || null, album_id: input.albumId || null, share_token: input.shareToken || null }) });
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

export type AlbumShareLink = {
  id: string;
  status: "active" | "inactive" | "expired";
};

export async function getAlbumShareLinks(albumId: string): Promise<AlbumShareLink[]> {
  const response = await authenticatedFetch(`/api/albums/${albumId}/share-links`, { cache: "no-store" });
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as AlbumShareLink[];
}

export async function deactivateAlbumShareLink(albumId: string, shareId: string): Promise<void> {
  const response = await authenticatedFetch(`/api/albums/${albumId}/share-links/${shareId}/deactivate`, { method: "POST" });
  if (!response.ok) throw new Error(await parseError(response));
}

export function isPublicShareUrl(value: string | null | undefined): boolean {
  const candidate = value?.trim();
  if (!candidate) return false;
  try {
    const origin = typeof window === "undefined" ? "https://momento.invalid" : window.location.origin;
    return /^\/s\/[^/]+\/?$/.test(new URL(candidate, origin).pathname);
  } catch {
    return false;
  }
}

export async function getMyFamily(): Promise<import("../types").FamilySummary> {
  const response = await authenticatedFetch("/api/families/me");
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as import("../types").FamilySummary;
}

export async function getParticipantStats(): Promise<{ participants: Array<{ id: string; display_name: string; photo_count: number; memory_count: number }> }> {
  const response = await authenticatedFetch("/api/families/me/participants");
  if (!response.ok) throw new Error(await parseError(response));
  return response.json();
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

// --- Collaborative album MVP ---

const COLLAB_SESSION_KEY = "momento-collab-session";

export type CollabSession = {
  albumId: string;
  contributorId: string;
  guestId: string | null;
  displayName: string;
};

export function loadCollabSession(albumId: string): CollabSession | null {
  try {
    const raw = localStorage.getItem(`${COLLAB_SESSION_KEY}:${albumId}`);
    if (!raw) return null;
    return JSON.parse(raw) as CollabSession;
  } catch {
    return null;
  }
}

export function saveCollabSession(session: CollabSession): void {
  localStorage.setItem(`${COLLAB_SESSION_KEY}:${session.albumId}`, JSON.stringify(session));
}

function collabHeaders(session: CollabSession | null): HeadersInit {
  const headers: Record<string, string> = {};
  if (session?.guestId) headers["X-Momento-Guest-Id"] = session.guestId;
  if (session?.contributorId) headers["X-Momento-Contributor-Id"] = session.contributorId;
  return headers;
}

export async function getJoinPreview(token: string) {
  const response = await fetch(`${API_BASE}/api/join/${encodeURIComponent(token)}`);
  if (!response.ok) throw new Error(await parseError(response));
  return response.json();
}

export async function joinCollaboration(
  token: string,
  body: { display_name: string; relationship?: string | null; guest_id?: string | null },
) {
  const response = await fetch(`${API_BASE}/api/join/${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await parseError(response));
  return response.json() as Promise<{
    album_id: string;
    contributor_id: string;
    guest_id: string | null;
    display_name: string;
    relationship: string | null;
    role: string;
  }>;
}

export async function startCollaboration(albumId: string) {
  const response = await authenticatedFetch(`/api/albums/${albumId}/collaboration/start`, { method: "POST" });
  if (!response.ok) throw new Error(await parseError(response));
  return response.json() as Promise<{ invite_url: string; invite_token: string; collaboration_status: string }>;
}

export async function rotateCollaborationInvite(albumId: string) {
  const response = await authenticatedFetch(`/api/albums/${albumId}/collaboration/rotate-invite`, { method: "POST" });
  if (!response.ok) throw new Error(await parseError(response));
  return response.json() as Promise<{ invite_url: string; invite_token: string }>;
}

export async function deactivateCollaborationInvite(albumId: string) {
  const response = await authenticatedFetch(`/api/albums/${albumId}/collaboration/deactivate-invite`, { method: "POST" });
  if (!response.ok) throw new Error(await parseError(response));
}

export async function getCollaborationStatus(albumId: string) {
  const response = await authenticatedFetch(`/api/albums/${albumId}/collaboration`);
  if (!response.ok) throw new Error(await parseError(response));
  return response.json();
}

export async function getAlbumParticipation(albumId: string) {
  const response = await authenticatedFetch(`/api/albums/${albumId}/participation`);
  if (!response.ok) throw new Error(await parseError(response));
  return response.json() as Promise<{
    participants: Array<{
      id: string;
      name: string;
      role: "host" | "participant";
      photo_count: number;
      memory_count: number;
      last_active_at?: string | null;
    }>;
    recent_activities: any[];
    new_photo_count: number;
    new_memory_count: number;
    new_contribution_count: number;
    recommended_mode?: "append_page" | "edition";
  }>;
}

export type PendingContributionItem = {
  id: string;
  type: "photo" | "memory";
  actor_name: string;
  created_at: string;
  thumbnail_url?: string | null;
  comment?: string | null;
  content?: string | null;
};

export async function getPendingContributions(albumId: string) {
  const response = await authenticatedFetch(`/api/albums/${albumId}/pending-contributions`);
  if (!response.ok) throw new Error(await parseError(response));
  return response.json() as Promise<{
    count: number; items: PendingContributionItem[]; last_applied_at: string | null;
    recommended_mode: "append_page" | "edition";
    append_photo_threshold: number; append_memory_threshold: number;
  }>;
}

export async function applyContributions(
  albumId: string,
  photoIds: string[],
  memoryIds: string[],
  mode: "auto" | "append_page" | "edition" = "auto",
) {
  const response = await authenticatedFetch(`/api/albums/${albumId}/apply-contributions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ photo_ids: photoIds, memory_ids: memoryIds, mode }) });
  if (!response.ok) throw new Error(await parseError(response));
  return response.json() as Promise<{
    status: string; applied_count: number; last_applied_at: string; album_version: number;
    mode: "append_page" | "edition"; append_page_id?: string | null; previous_edition?: number | null;
  }>;
}

export async function rebuildCollaborationAlbum(
  albumId: string,
  options?: { album_json?: unknown; regenerate_story?: boolean; force?: boolean },
) {
  const response = await authenticatedFetch(`/api/albums/${albumId}/collaboration/rebuild`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      album_json: options?.album_json ?? null,
      regenerate_story: options?.regenerate_story ?? false,
      force: options?.force ?? false,
    }),
  });
  if (!response.ok) throw new Error(await parseError(response));
  return response.json();
}

export async function publishCollaborationAlbum(albumId: string) {
  const response = await authenticatedFetch(`/api/albums/${albumId}/collaboration/publish`, { method: "POST" });
  if (!response.ok) throw new Error(await parseError(response));
}

export async function closeCollaborationAlbum(albumId: string) {
  const response = await authenticatedFetch(`/api/albums/${albumId}/collaboration/close`, { method: "POST" });
  if (!response.ok) throw new Error(await parseError(response));
}

export async function getContributeWorkspace(albumId: string, session: CollabSession) {
  const response = await fetch(`${API_BASE}/api/albums/${albumId}/contribute/workspace`, {
    headers: collabHeaders(session),
  });
  if (!response.ok) throw new Error(await parseError(response));
  return response.json();
}

export async function uploadContributePhotos(albumId: string, session: CollabSession, files: File[]) {
  const form = new FormData();
  for (const file of files) {
    form.append("photos", file, file.name || "photo.jpg");
    form.append("file_created_ats", String(file.lastModified));
  }
  const response = await fetch(`${API_BASE}/api/albums/${albumId}/contribute/photos`, {
    method: "POST",
    headers: collabHeaders(session),
    body: form,
  });
  if (!response.ok) throw new Error(await parseError(response));
  return response.json();
}

export async function createPhotoMemory(
  albumId: string,
  photoId: string,
  session: CollabSession,
  comment: string,
) {
  const response = await fetch(`${API_BASE}/api/albums/${albumId}/photos/${photoId}/memories`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...collabHeaders(session) },
    body: JSON.stringify({
      comment,
      guest_id: session.guestId,
      contributor_id: session.contributorId,
    }),
  });
  if (!response.ok) throw new Error(await parseError(response));
  return response.json();
}

export async function updatePhotoMemory(
  albumId: string,
  memoryId: string,
  session: CollabSession,
  comment: string,
) {
  const response = await fetch(`${API_BASE}/api/albums/${albumId}/memories/${memoryId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...collabHeaders(session) },
    body: JSON.stringify({
      comment,
      guest_id: session.guestId,
      contributor_id: session.contributorId,
    }),
  });
  if (!response.ok) throw new Error(await parseError(response));
  return response.json();
}

export async function deletePhotoMemory(albumId: string, memoryId: string, session: CollabSession) {
  const params = new URLSearchParams();
  if (session.guestId) params.set("guest_id", session.guestId);
  params.set("contributor_id", session.contributorId);
  const response = await fetch(`${API_BASE}/api/albums/${albumId}/memories/${memoryId}?${params}`, {
    method: "DELETE",
    headers: collabHeaders(session),
  });
  if (!response.ok) throw new Error(await parseError(response));
}
