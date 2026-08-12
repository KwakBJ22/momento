/**
 * `lib/api` 의 테스트 대역. 실제 네트워크를 타지 않는다.
 *
 * 로더(cssStub.mjs)가 `../lib/api` import 를 이 파일로 돌린다. 진짜 api.ts 는
 * `import.meta.env`(Vite 전용)를 읽어 node 에서 그대로 불러올 수 없고, 마운트 테스트가
 * 보려는 것은 네트워크가 아니라 **렌더가 성립하는가**이므로 대역으로 충분하다.
 *
 * 응답 데이터는 globalThis.__albumStub 으로 테스트가 정한다.
 */
import type { AlbumPhoto, AlbumResult } from "../../src/types";

export interface AlbumStubData {
  album: AlbumResult;
  photos: AlbumPhoto[];
  /** 앨범 조회를 실패시키고 싶을 때(오류 화면 렌더 경로). */
  albumError?: { message: string; status?: number };
}

function stub(): AlbumStubData {
  const data = (globalThis as unknown as { __albumStub?: AlbumStubData }).__albumStub;
  if (!data) throw new Error("테스트가 globalThis.__albumStub 을 먼저 채워야 한다");
  return data;
}

export type CollabSession = { albumId: string; contributorId: string; guestId: string | null; displayName: string };

export async function getAlbum(): Promise<AlbumResult> {
  const { album, albumError } = stub();
  if (albumError) {
    const error = new Error(albumError.message) as Error & { status?: number };
    error.status = albumError.status;
    throw error;
  }
  return album;
}

export async function getAlbumPhotos(): Promise<AlbumPhoto[]> {
  return stub().photos;
}

// ★ 같은 참조를 돌려준다. 호출마다 새 배열·새 객체를 주면 그것을 상태에 넣는 화면이
// 무한 갱신에 빠진다(테스트가 만든 가짜 상황이라 진짜 결함이 가려진다).
const EMPTY_PAGES: unknown[] = [];
const COLLAB_STATUS = { contributor_count: 0 };

export async function getAlbumLivingAppendPages(): Promise<unknown[]> {
  return EMPTY_PAGES;
}

export async function getCollaborationStatus(): Promise<{ contributor_count: number } | null> {
  return COLLAB_STATUS;
}

export async function createAlbumShareLink(): Promise<{ share_url: string }> {
  return { share_url: "https://test.local/s/token" };
}

export async function deleteAlbum(): Promise<void> {}
export async function patchAlbumTitle(): Promise<void> {}
export async function patchChapterStory(): Promise<void> {}
export async function patchEpilogue(): Promise<void> {}
export async function saveAlbumPhotoCaption(): Promise<void> {}
export async function startPublicContribution(): Promise<CollabSession> {
  return { albumId: "album", contributorId: "contributor", guestId: null, displayName: "테스트" };
}
export function isPublicShareUrl(value: string | null | undefined): boolean {
  return Boolean(value && value.includes("/s/"));
}
export function loadCollabSession(): CollabSession | null {
  return null;
}
export function saveCollabSession(): void {}
export async function getGuestbookEntries(): Promise<unknown[]> {
  return [];
}
export async function submitGuestbookEntry(): Promise<unknown> {
  return {};
}
export async function deleteGuestbookEntry(): Promise<void> {}
export async function getAlbumPdfUrl(): Promise<{ url: string | null; album_version: number; cached: boolean }> {
  return { url: null, album_version: 0, cached: false };
}
export async function uploadAlbumPdf(): Promise<{ url: string | null; album_version: number; cached: boolean }> {
  return { url: null, album_version: 0, cached: false };
}
export const API_BASE = "";

/* 연락처(선택)는 **요청 모양 그대로** fetch 를 탄다 — 테스트가 세운 서버 대역이 받는다.
   무엇을 보내는지(보낸 항목만 바뀌는지)가 이 화면의 핵심이라 값을 고정하면 안 된다. */
export type ProfileContact = { phone: string | null; email: string | null };

function toProfileContact(data: unknown): ProfileContact {
  const record = (data || {}) as { phone?: string | null; email?: string | null };
  return { phone: record.phone ?? null, email: record.email ?? null };
}

export async function getProfileContact(): Promise<ProfileContact> {
  const response = await fetch("/api/auth/contact");
  if (!response.ok) throw new Error("연락처를 불러오지 못했어요.");
  return toProfileContact(await response.json());
}

export async function saveProfileContact(input: Partial<ProfileContact>): Promise<ProfileContact> {
  const response = await fetch("/api/auth/contact", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("저장하지 못했어요.");
  return toProfileContact(await response.json());
}

/* 아래는 AlbumView 가 직접 쓰지는 않지만 같은 모듈에서 함께 import 되는 것들이다.
   named export 가 하나라도 빠지면 모듈 해석 단계에서 실패하므로 전부 채운다. */
export async function acceptFamilyInvitation(): Promise<any> { return undefined as any; }
export async function addAlbumMember(): Promise<any> { return undefined as any; }
export async function analyzeAlbumMedia(): Promise<any> { return undefined as any; }
export async function applyContributions(): Promise<any> { return undefined as any; }
export async function authenticatedFetch(): Promise<any> { return undefined as any; }
export async function bootstrapAccount(): Promise<any> { return undefined as any; }
export async function cancelFamilyInvitation(): Promise<any> { return undefined as any; }
export async function claimGuestAlbum(): Promise<any> { return undefined as any; }
export async function closeCollaborationAlbum(): Promise<any> { return undefined as any; }
export async function createFamilyInvitation(): Promise<any> { return undefined as any; }
export async function createPhotoMemory(): Promise<any> { return undefined as any; }
export async function deactivateAlbumShareLink(): Promise<any> { return undefined as any; }
export async function deactivateCollaborationInvite(): Promise<any> { return undefined as any; }
export async function deleteAccount(): Promise<any> { return undefined as any; }
export async function deletePhotoMemory(): Promise<any> { return undefined as any; }
export async function generateEpilogue(): Promise<any> { return undefined as any; }
export async function generateMemoryQuestions(): Promise<any> { return undefined as any; }
export async function getAlbumGenerationPreview(): Promise<any> { return undefined as any; }
export async function getAlbumGenerationStatus(): Promise<any> { return undefined as any; }
export async function getAlbumMembers(): Promise<any> { return undefined as any; }
export async function getAlbumParticipation(): Promise<any> { return undefined as any; }
export async function getAlbumShareLinks(): Promise<any> { return undefined as any; }
export async function getContributeWorkspace(): Promise<any> { return undefined as any; }
export async function getFamilyInvitations(): Promise<any> { return undefined as any; }
export async function getFamilyMembers(): Promise<any> { return undefined as any; }
export async function getJoinPreview(): Promise<any> { return undefined as any; }
export async function getMemoryQuestions(): Promise<any> { return undefined as any; }
export async function getMyAlbumCoverUrls(): Promise<any> { return undefined as any; }
/** 내 앨범 목록 — 화면이 목록을 실제로 그리는지 보는 검사가 있어 값을 갈아 끼울 수 있다. */
let myAlbums: any = { albums: [], participating: [], bookmarked: [] };
export function setMyAlbums(value: any): void { myAlbums = value; }
export async function getMyAlbums(): Promise<any> { return myAlbums; }
export async function getMyFamily(): Promise<any> { return undefined as any; }
export async function getParticipantStats(): Promise<any> { return undefined as any; }
export async function getPendingContributions(): Promise<any> { return undefined as any; }
export async function getPublicShare(): Promise<any> { return undefined as any; }
export async function joinCollaboration(): Promise<any> { return undefined as any; }
export async function publishCollaborationAlbum(): Promise<any> { return undefined as any; }
export async function rebuildCollaborationAlbum(): Promise<any> { return undefined as any; }
export async function regenerateMemoryQuestions(): Promise<any> { return undefined as any; }
export async function regenerateStory(): Promise<any> { return undefined as any; }
export async function removeAlbumMember(): Promise<any> { return undefined as any; }
export async function removeFamilyMember(): Promise<any> { return undefined as any; }
export async function resetInFlightRequestsForTest(): Promise<any> { return undefined as any; }
export async function resolveApiBase(): Promise<any> { return undefined as any; }
export async function retryAlbumGeneration(): Promise<any> { return undefined as any; }
export async function rotateCollaborationInvite(): Promise<any> { return undefined as any; }
export async function saveMemoryAnswer(): Promise<any> { return undefined as any; }
export async function startCollaboration(): Promise<any> { return undefined as any; }
export async function submitShareReaction(): Promise<any> { return undefined as any; }
/** 대표사진 저장 — 무엇이 서버로 나갔는지 보는 검사가 있어 호출을 기록한다.
 *  진짜 응답과 같은 모양을 돌려준다(부르는 쪽이 응답 필드를 읽는다). */
export const updateAlbumCoverPhotoCalls: Array<{ albumId: string; photoId: string }> = [];
export async function updateAlbumCoverPhoto(albumId: string, photoId: string): Promise<any> {
  updateAlbumCoverPhotoCalls.push({ albumId, photoId });
  return { cover_photo_id: photoId, cover_image_url: `https://cdn.test/${photoId}.jpg` };
}
export async function updateAlbumMemberRole(): Promise<any> { return undefined as any; }
export async function updateAlbumPhotoLocation(): Promise<any> { return undefined as any; }
export async function updateFamilyMemberRole(): Promise<any> { return undefined as any; }
export async function updatePhotoMemory(): Promise<any> { return undefined as any; }
export async function uploadAlbum(): Promise<any> { return undefined as any; }
export async function uploadContributePhotos(): Promise<any> { return undefined as any; }
export type AlbumGenerationStatus = any;
export type AlbumShareLink = any;
export type MyAlbum = any;
export type PendingContributionItem = any;
