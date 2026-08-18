import type { AlbumResult, WithdrawalSummary } from "../types";
import { getAccessToken, getSession, refreshSession } from "../services/authService";
import { getGuestAlbumToken, saveGuestAlbumToken } from "./guestAlbum";
import { authDebug } from "./authDebug";
import { COLLAB_SESSION_KEY } from "./contributionAttribution";
import { getVisitorToken } from "./visitorToken";

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

// Post-deploy smoke signal: an empty API_BASE on a real deployment means uploads
// go through the 4.5MB-capped Vercel proxy instead of directly to the backend,
// so any album with several photos (~5+) fails. Exposed read-only for the smoke
// test to assert; no behavior depends on it.
if (typeof window !== "undefined") {
  (window as unknown as { __woorialbumApiBase?: string }).__woorialbumApiBase = API_BASE;
}

const inFlightRequests = new Map<string, Promise<unknown>>();

function dedupeRequest<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = inFlightRequests.get(key);
  if (existing) return existing as Promise<T>;
  const request = load().finally(() => {
    if (inFlightRequests.get(key) === request) inFlightRequests.delete(key);
  });
  inFlightRequests.set(key, request);
  return request;
}

export function resetInFlightRequestsForTest(): void {
  inFlightRequests.clear();
}

export async function authenticatedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const request = async (token: string) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(`${API_BASE}${path}`, { ...init, headers });
  };
  const response = await request(await getAccessToken());
  if (response.status !== 401) return response;
  authDebug("API_401", { source: "authenticatedFetch", endpoint: path });
  const refreshed = await refreshSession();
  if (!refreshed) return response;
  const retried = await request(refreshed.accessToken);
  authDebug(retried.ok ? "API_RETRY_SUCCESS" : "API_RETRY_FAILED", { source: "authenticatedFetch", endpoint: path });
  return retried;
}

/**
 * Fetch an album route as either the logged-in owner OR the guest that created
 * it. A logged-in user always goes through the normal bearer path (with 401
 * refresh-retry). Only when there is no session AND we hold a guest token for
 * this album do we send it as the guest-album header (backend verifies it).
 */
async function albumOwnerFetch(albumId: string, path: string, init: RequestInit = {}): Promise<Response> {
  const guestToken = getGuestAlbumToken(albumId);
  const session = await getSession();
  if (session?.accessToken || !guestToken) {
    return authenticatedFetch(path, init);
  }
  const headers = new Headers(init.headers);
  headers.set("X-Woorialbum-Guest-Album-Token", guestToken);
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

/**
 * Create an album. Works logged-in (bearer) or as a guest (no bearer); a guest
 * response carries a one-time token which we persist so the browser can view,
 * edit, and later claim the album.
 */
export async function uploadAlbum(
  formData: FormData,
  options: { operationId: string; signal?: AbortSignal },
): Promise<{ album_id: string; generation_job_id?: string | null; guest_token?: string | null }> {
  const headers = { "X-Woorialbum-Operation-Id": options.operationId };
  const session = await getSession();
  const response = session?.accessToken
    ? await authenticatedFetch("/api/upload-album", { method: "POST", body: formData, signal: options.signal, headers })
    : await fetch(`${API_BASE}/api/upload-album`, { method: "POST", body: formData, signal: options.signal, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.detail === "string" ? body.detail : "앨범을 만들지 못했습니다. 다시 시도해주세요.");
  }
  const created = (await response.json()) as { album_id: string; generation_job_id?: string | null; guest_token?: string | null };
  if (created.guest_token && created.album_id) saveGuestAlbumToken(created.album_id, created.guest_token);
  return created;
}

/** Transfer a guest album to the now-logged-in account. Requires a session. */
export async function claimGuestAlbum(guestToken: string): Promise<{ album_id: string }> {
  const response = await authenticatedFetch("/api/guest-albums/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guest_token: guestToken }),
  });
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as { album_id: string };
}

async function parseError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  const detail = body?.detail;
  if (Array.isArray(detail) || response.status === 422) return "입력 내용을 확인해주세요.";
  if (response.status >= 500) return "잠시 후 다시 시도해주세요.";
  if (typeof detail === "string") {
    const looksTechnical = /validationerror|validation error|field required|input should|type_error|pydantic/i.test(detail);
    return looksTechnical ? "입력 내용을 확인해주세요." : detail;
  }
  return "잠시 후 다시 시도해주세요.";
}

export async function getAlbum(albumId: string, edition?: number | null, signal?: AbortSignal): Promise<AlbumResult> {
  const suffix = Number.isInteger(edition) ? `?edition=${encodeURIComponent(String(edition))}` : "";
  const key = `album:${albumId}:${edition ?? "latest"}`;
  return dedupeRequest(key, async () => {
    const response = await albumOwnerFetch(albumId, `/api/albums/${albumId}${suffix}`, { cache: "no-store", signal });
    if (!response.ok) {
      // Carry the HTTP status so the view can tell a permission error (403 — retry is
      // pointless, needs Korean copy) apart from a transient failure (retry helps).
      const error = new Error(await parseError(response)) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return (await response.json()) as AlbumResult;
  });
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
  status?: "processing" | "active" | "failed" | string;
  /** 담아둔 앨범을 **열 때 쓸 구경용 링크**(K-7b). 담아둔 칸에서만 온다.
   *  구경꾼은 멤버가 아니라 `/album/{id}` 로 열면 403 이다. */
  share_token?: string | null;
};

export async function getMyAlbums(): Promise<{ albums: MyAlbum[]; participating: MyAlbum[]; bookmarked: MyAlbum[]; archived: MyAlbum[] }> {
  const response = await authenticatedFetch("/api/albums/mine", { cache: "no-store" });
  if (!response.ok) throw new Error(await parseError(response));
  const data = (await response.json()) as { albums: MyAlbum[]; participating?: MyAlbum[]; bookmarked?: MyAlbum[]; archived?: MyAlbum[] };
  return {
    albums: data.albums ?? [],
    participating: data.participating ?? [],
    bookmarked: data.bookmarked ?? [],
    // 보관함(2026-08-17). 옛 응답에는 없다 — 없으면 빈 목록이고 화면은 그 줄을 안 그린다.
    archived: data.archived ?? [],
  };
}

/**
 * 지우지 않고 **감춰 둔다** (2026-08-17 · 시안 delete-sheet 1b 의 되돌릴 길).
 *
 * ★ 바뀌는 것은 앨범의 상태 한 칸이다. 사진·한마디는 그대로 있다 —
 *   그래야 `언제든 다시 꺼낼 수 있어요` 가 참말이 된다. 판정은 서버가 한다(주최자만).
 */
export async function archiveAlbum(albumId: string): Promise<void> {
  const response = await authenticatedFetch(`/api/albums/${albumId}/archive`, { method: "POST" });
  if (!response.ok) throw new Error(await parseError(response));
}

export async function unarchiveAlbum(albumId: string): Promise<void> {
  const response = await authenticatedFetch(`/api/albums/${albumId}/unarchive`, { method: "POST" });
  if (!response.ok) throw new Error(await parseError(response));
}

/**
 * 담아두기 (§1 9차) — ★ 권한을 주지 않는다. 목록에 남을 뿐 여전히 보기만 한다.
 *
 * ★ **담을 때는 공유 링크로 담는다**(K-7b). 담아두기는 구경꾼의 행동인데, 예전 경로
 *   (`PUT /albums/{id}/bookmark`)는 앨범 읽기 권한을 요구해서 **구경꾼은 로그인해도
 *   403** 이었다. 실측(2026-08-09): 세 번 눌러 세 번 다 403, `album_bookmarks` 0건.
 *   서버는 담을 때 그 링크를 함께 저장한다 — 목록에서 `/s/{token}` 으로 열기 위해서다.
 * ★ **뺄 때는 앨범 id 로 뺀다.** 자기 목록에서 자기 것을 빼는 일이라 링크가 필요 없다
 *   (링크가 죽은 뒤에도 뺄 수 있어야 한다).
 */
export async function saveSharedAlbumBookmark(shareToken: string): Promise<void> {
  const response = await authenticatedFetch(`/api/public/shares/${encodeURIComponent(shareToken)}/bookmark`, {
    method: "PUT",
  });
  if (!response.ok) throw new Error(await parseError(response));
}

export async function removeAlbumBookmark(albumId: string): Promise<void> {
  const response = await authenticatedFetch(`/api/albums/${albumId}/bookmark`, { method: "DELETE" });
  if (!response.ok) throw new Error(await parseError(response));
}

/** 지우기 전에 **무엇이 사라지는지** — 지우려고 누른 그 순간에만 부른다(목록에 넣지 않는다). */
export interface AlbumDeletePreview {
  photo_count: number;
  memory_count: number;
  contributor_count: number;
  /** display(WebP) 자산 최대 3장. 원본이 아니다(§9). */
  preview_photo_urls: string[];
}

export async function getAlbumDeletePreview(albumId: string): Promise<AlbumDeletePreview> {
  const response = await authenticatedFetch(`/api/albums/${albumId}/delete-preview`, { cache: "no-store" });
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as AlbumDeletePreview;
}

export async function deleteAlbum(albumId: string): Promise<void> {
  const response = await authenticatedFetch(`/api/albums/${albumId}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await parseError(response));
}

/**
 * 앨범에서 사진 한 장을 뺀다 — **이미 있던 주소**를 부른다(§10 · 새 API 를 만들지 않는다).
 *
 * ★ 권한 검사도 Storage 파일 정리도 서버가 한다. 화면은 보여줄지만 정한다.
 * ★ 앨범을 다시 만들지 않는다. 그 사진만 빠지고 캡션·한마디·이야기는 그대로다.
 */
export async function removeAlbumPhoto(albumId: string, photoId: string): Promise<void> {
  const response = await authenticatedFetch(`/api/albums/${albumId}/media/${photoId}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await parseError(response));
}

/**
 * 탈퇴하면 무엇이 얼마나 사라지는지 (K-17 · SCREEN_SPEC §5 27차).
 *
 * ★ 세는 것은 **서버 한 곳**이다. 화면은 받아서 보여주기만 하고, 지울 때 이 값을
 *   되돌려 보내지 않는다 — 프런트가 보내는 숫자를 서버가 믿지 않는다(§10).
 */
export async function getWithdrawalSummary(): Promise<WithdrawalSummary> {
  const response = await authenticatedFetch("/api/auth/account/summary", { cache: "no-store" });
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as WithdrawalSummary;
}

export async function deleteAccount(): Promise<void> {
  const response = await authenticatedFetch("/api/auth/account", { method: "DELETE" });
  if (!response.ok) throw new Error(await parseError(response));
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

export async function patchAlbumTitle(albumId: string, title: string): Promise<AlbumResult> {
  const response = await albumOwnerFetch(albumId, `/api/albums/${albumId}/title`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as AlbumResult;
}

/**
 * 앨범 모양 · 종이 색을 고친다 — **기존 PATCH 를 넓혀 쓴다**(§10 · 새 주소를 만들지 않는다).
 *
 * ★ 넘긴 것만 고친다. 맺음말(narrative)은 넣지 않으므로 건드리지 않는다.
 * ★ 허용값 검사와 권한 판정은 **백엔드**가 한다. 여기서 다시 막지 않는다.
 */
export async function patchAlbumAppearance(
  albumId: string,
  next: { skin?: string; paper?: string },
): Promise<AlbumResult> {
  const response = await albumOwnerFetch(albumId, `/api/albums/${albumId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(next),
  });
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as AlbumResult;
}

export async function patchEpilogue(albumId: string, epilogue: string): Promise<AlbumResult> {
  const response = await albumOwnerFetch(albumId, `/api/albums/${albumId}/epilogue`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ epilogue }),
  });
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as AlbumResult;
}

export async function patchChapterStory(
  albumId: string,
  date: string,
  story: string,
): Promise<AlbumResult> {
  const response = await albumOwnerFetch(albumId, `/api/albums/${albumId}/chapter-story`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date, story }),
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

export async function getAlbumLivingAppendPages(
  albumId: string,
  edition?: number | null,
  signal?: AbortSignal,
): Promise<import("../types").LivingAppendPage[]> {
  const suffix = Number.isInteger(edition) ? `?edition=${encodeURIComponent(String(edition))}` : "";
  const key = `album-living:${albumId}:${edition ?? "latest"}`;
  return dedupeRequest(key, async () => {
    const response = await authenticatedFetch(`/api/albums/${albumId}/living-append-pages${suffix}`, {
      cache: "no-store",
      signal,
    });
    if (!response.ok) throw new Error(await parseError(response));
    const body = (await response.json()) as { living_append_pages?: import("../types").LivingAppendPage[] };
    return body.living_append_pages ?? [];
  });
}

export async function getAlbumPhotos(albumId: string, edition?: number | null, signal?: AbortSignal): Promise<import("../types").AlbumPhoto[]> {
  const suffix = Number.isInteger(edition) ? `?edition=${encodeURIComponent(String(edition))}` : "";
  const key = `album-photos:${albumId}:${edition ?? "latest"}`;
  return dedupeRequest(key, async () => {
    const response = await albumOwnerFetch(albumId, `/api/albums/${albumId}/photos${suffix}`, { cache: "no-store", signal });
    if (!response.ok) throw new Error(await parseError(response));
    const body = (await response.json()) as { photos: import("../types").AlbumPhoto[] };
    return body.photos;
  });
}

/** 캡션(①) 저장 — album_photos.caption. 인쇄까지 가는 유일한 글이다(§7).
 *
 *  ★ 이름을 서버와 **똑같이** 쓴다. 예전에는 프런트가 `comment` 로 보내고 서버는
 *  `caption` 을 읽어서, 요청은 200 인데 **빈 값이 저장**됐다(적은 글이 사라졌다).
 *  Pydantic 은 모르는 키를 조용히 버리고 빠진 키를 기본값 None 으로 채운다 —
 *  그래서 오류도 나지 않았다. 이름 하나가 어긋나면 조용히 지운다. */
export async function saveAlbumPhotoCaption(albumId: string, photoId: string, caption: string): Promise<{ id: string; caption: string | null; album_version?: number }> {
  const response = await albumOwnerFetch(albumId, `/api/albums/${albumId}/photos/${photoId}/comment`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caption: caption.trim() || null }) });
  if (!response.ok) throw new Error(await parseError(response));
  // ★ 캡션을 저장해도 앨범 버전이 올라간다 — 그 값을 화면이 받아 둬야 PDF 가 409 를
  //   안 맞는다(K-6 · lib/albumVersion).
  return (await response.json()) as { id: string; caption: string | null; album_version?: number };
}

export type AlbumGenerationStatus = {
  album_id: string;
  generation_job_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  current_step: string;
  ready: boolean;
  error_code?: string | null;
};

export async function getAlbumGenerationStatus(albumId: string, signal?: AbortSignal): Promise<AlbumGenerationStatus> {
  const response = await albumOwnerFetch(albumId, `/api/albums/${albumId}/generation-status`, { cache: "no-store", signal });
  if (!response.ok) throw new Error(await parseError(response));
  return response.json() as Promise<AlbumGenerationStatus>;
}

export async function getAlbumGenerationPreview(albumId: string): Promise<Array<{ photo_id: string; url: string | null }>> {
  const response = await albumOwnerFetch(albumId, `/api/albums/${albumId}/generation-preview`, { cache: "no-store" });
  if (!response.ok) throw new Error(await parseError(response));
  return ((await response.json()) as { previews?: Array<{ photo_id: string; url: string | null }> }).previews ?? [];
}

export async function retryAlbumGeneration(albumId: string): Promise<AlbumGenerationStatus> {
  const response = await albumOwnerFetch(albumId, `/api/albums/${albumId}/generation-retry`, { method: "POST" });
  if (!response.ok) throw new Error(await parseError(response));
  return response.json() as Promise<AlbumGenerationStatus>;
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

/** 업로드 응답은 저장된 PDF 의 서명 URL 을 그대로 돌려준다 — 인앱 브라우저는 blob 저장이
 *  막혀 있어 이 주소가 유일한 전달 경로다. 버리지 않고 반환한다(추가 요청 없음). */
export async function uploadAlbumPdf(albumId: string, albumVersion: number, blob: Blob): Promise<{ url: string | null; album_version: number; cached: boolean }> {
  const form = new FormData();
  form.append("file", blob, `woorialbum-${albumId}-v${albumVersion}.pdf`);
  const response = await authenticatedFetch(
    `/api/albums/${albumId}/pdf?version=${encodeURIComponent(String(albumVersion))}`,
    { method: "PUT", body: form },
  );
  if (!response.ok) {
    // ★ 어느 단계에서 막혔는지 알 수 있게 상태를 붙인다. 저장이 막히면 인앱 브라우저에
    // 넘길 주소가 없어 "파일 저장이 막혀 있어요" 만 뜨고, 그때 원인을 알 길이 없었다.
    const error = new Error(await parseError(response)) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return (await response.json()) as { url: string | null; album_version: number; cached: boolean };
}

export async function updateAlbumPhotoLocation(
  albumId: string,
  photoId: string,
  payload: {
    location_name?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    location_source?: "exif" | "user" | "ai_estimated" | "unknown";
    /** 촬영일 — **넣은 것만** 고친다. 날짜는 주최자만 고칠 수 있고 서버가 그것을 본다. */
    taken_at?: string;
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
      // 안 넣으면 아예 보내지 않는다 — 서버가 `없으면 건드리지 않는다` 로 읽는다.
      ...(payload.taken_at ? { taken_at: payload.taken_at } : {}),
    }),
  });
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as import("../types").AlbumPhoto;
}

/**
 * `실물 앨범으로 받아보기` 를 누른 사람을 센다 — **파는 것이 아니라 재는 것**이다.
 *
 * ★ 결제도 배송지도 연락처도 없다. 여기서 연락처를 받지 않는다(§5) — 그 자리는
 *   `다른 곳에는 쓰지 않아요` 라고 적어 둔 자리다.
 * ★ 같은 사람이 두 번 눌러도 **한 번만** 센다. 그 판정은 서버가 한다(§10) —
 *   화면은 눌렸다는 사실만 기억해서 다시 묻지 않는다.
 * ★ 실패해도 화면을 되돌리지 않는다. 재는 값 하나 때문에 방금 남긴 마음을
 *   `안 됐어요` 로 만들지 않는다 — 부르는 쪽이 조용히 삼킨다.
 */
export async function recordPrintIntent(albumId: string): Promise<void> {
  // 로그인하지 않은 참여자도 사람 단위로 세려면 방문자 토큰이 필요하다(getPublicShare 와 같다).
  const headers: Record<string, string> = {};
  const visitor = getVisitorToken();
  if (visitor) headers["X-Woorialbum-Visitor"] = visitor;
  const response = await albumOwnerFetch(albumId, `/api/albums/${albumId}/print-intent`, {
    method: "POST",
    headers,
  });
  if (!response.ok) throw new Error(await parseError(response));
}

export async function getPublicShare(token: string, edition?: number | null): Promise<import("../types").PublicShareAlbum> {
  const params = edition ? `?edition=${encodeURIComponent(String(edition))}` : "";
  // 방문자를 **사람 단위**로 세기 위한 값(§1). 무작위 토큰이고 서버는 해시만 저장한다.
  // 로그인했으면 서버가 계정으로 세므로 토큰보다 계정이 우선한다(판정은 서버 한 곳).
  const headers: Record<string, string> = {};
  const visitor = getVisitorToken();
  if (visitor) headers["X-Woorialbum-Visitor"] = visitor;
  const session = await getSession();
  if (session?.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;
  const response = await fetch(`${API_BASE}/api/public/shares/${encodeURIComponent(token)}${params}`, {
    cache: "no-store",
    headers,
  });
  if (!response.ok) {
    const error = new Error(await parseError(response)) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return (await response.json()) as import("../types").PublicShareAlbum;
}

export async function updateAlbumCoverPhoto(albumId: string, photoId: string): Promise<{ cover_photo_id: string | null; cover_image_url: string | null }> {
  // 게스트 주최자도 자기 앨범의 표지를 고른다(§1) — 토큰을 함께 보내는 길로 부른다.
  const response = await albumOwnerFetch(albumId, `/api/albums/${albumId}/cover-photo`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photo_id: photoId }),
  });
  if (!response.ok) throw new Error(await parseError(response));
  return response.json() as Promise<{ cover_photo_id: string | null; cover_image_url: string | null }>;
}

/**
 * 이름을 적고 참여 세션을 만든다.
 *
 * ★ `intent` 는 **무엇을 하려고 이름을 적는가**다(PO 2026-08-16 · `인쇄되는 것만 잠근다`).
 *   `memory` 면 감상 링크에서도, 확정된 앨범에서도 받아 준다 — 한마디는 인쇄되지 않는다.
 *   그때 서버는 그 사람을 **참여자로 만들지 않는다**(이름만 받는다 · 화면_기준 §1).
 *   넘기지 않으면 예전 그대로 사진이다.
 */
export async function startPublicContribution(token: string, guestId: string | null, displayName: string, intent: "photo" | "memory" = "photo") {
  const session = await getSession();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session?.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;
  const response = await fetch(`${API_BASE}/api/public/shares/${encodeURIComponent(token)}/contribute`, {
    method: "POST",
    headers,
    body: JSON.stringify({ guest_id: guestId, display_name: displayName, intent }),
  });
  if (!response.ok) throw new Error(await parseError(response));
  return response.json() as Promise<{ album_id: string; contributor_id: string; guest_id: string | null; display_name: string }>;
}

export async function submitShareReaction(token: string, reaction: string, sessionKey: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/public/shares/${encodeURIComponent(token)}/reactions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reaction, session_key: sessionKey }) });
  if (!response.ok) throw new Error(await parseError(response));
}

export async function submitGuestbookEntry(token: string, body: { author_name: string; message: string; session_key: string }): Promise<import("../types").GuestbookItem> {
  const response = await fetch(`${API_BASE}/api/public/shares/${encodeURIComponent(token)}/guestbook`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as import("../types").GuestbookItem;
}

export async function deleteGuestbookEntry(token: string, entryId: string, sessionKey: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/public/shares/${encodeURIComponent(token)}/guestbook/${encodeURIComponent(entryId)}/delete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_key: sessionKey }) });
  if (!response.ok) throw new Error(await parseError(response));
}

/** 공유 링크를 발급한다. kind 는 링크의 성격이며 발급 시점에 정해진다(SCREEN_SPEC §1):
 *  "view" = 구경하라고 보내기(읽기·반응·방명록), "contribute" = 함께 만들자고 보내기. */
export async function createAlbumShareLink(albumId: string, kind: "view" | "contribute" = "contribute", expiresAt?: string): Promise<{ share_url: string }> {
  const response = await authenticatedFetch(`/api/albums/${albumId}/share-links`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expires_at: expiresAt || null, kind }) });
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
    const origin = typeof window === "undefined" ? "https://woorialbum.invalid" : window.location.origin;
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

/**
 * 이용자가 직접 넣어 둔 연락처(선택) — 계정 분실 시 본인 확인 전용.
 *
 * ★ 서버는 **본인에게 원본을** 내려준다. 가리는 일은 **화면이** 한다 —
 *   전화번호는 010-****-5678 로 보여주고(lib/phoneFormat 의 maskPhone),
 *   `수정` 을 누르면 그 원본이 칸에 들어간다. 예전에는 서버가 가린 값만 줘서
 *   뒷자리 하나 고치려고 11자리를 다시 쳐야 했다.
 * ★ **이메일은 가리지 않는다**(J-5-2). 같은 시트 바로 위에 로그인 이메일이 가려지지
 *   않고 그대로 나온다 — 한 화면에서 같은 종류를 한쪽만 가리면 규칙이 없는 것이다.
 * ★ PUT 은 **보낸 항목만** 바꾼다. 그래서 화면은 고치는 줄만 보낸다 —
 *   손대지 않은 항목은 건드리지 않는다.
 *   알림·마케팅에 쓰지 않는다("다른 곳에는 쓰지 않아요").
 */
export type ProfileContact = { phone: string | null; email: string | null };

function toProfileContact(data: unknown): ProfileContact {
  const record = (data || {}) as { phone?: string | null; email?: string | null };
  return { phone: record.phone ?? null, email: record.email ?? null };
}

export async function getProfileContact(): Promise<ProfileContact> {
  const response = await authenticatedFetch("/api/auth/contact");
  if (!response.ok) throw new Error("연락처를 불러오지 못했어요.");
  return toProfileContact(await response.json().catch(() => null));
}

export async function saveProfileContact(input: ProfileContact): Promise<ProfileContact> {
  const response = await authenticatedFetch("/api/auth/contact", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await parseError(response));
  return toProfileContact(await response.json().catch(() => null));
}

export async function bootstrapAccount(
  contributorGuestIds: string[],
  legalAgreed = false,
): Promise<{ album_count?: number; max_albums?: number; claimed_guest_ids: string[]; legal_agreed: boolean }> {
  const response = await authenticatedFetch("/api/auth/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // 동의는 **받았을 때만** 싣는다. 안 실어도 서버는 그냥 통과한다(K-14).
    // 무엇에 동의한 것인지(버전)는 서버가 붙인다 — 문자열을 두 곳에 두지 않는다.
    body: JSON.stringify(
      legalAgreed
        ? { contributor_guest_ids: contributorGuestIds, legal_agreed: true }
        : { contributor_guest_ids: contributorGuestIds },
    ),
  });
  if (!response.ok) throw new Error("계정을 준비하지 못했어요.");
  const data = (await response.json().catch(() => null)) as
    | { album_count?: number; max_albums?: number; claimed_guest_ids?: string[]; legal_agreed?: boolean }
    | null;
  return {
    album_count: data?.album_count,
    max_albums: data?.max_albums,
    claimed_guest_ids: data?.claimed_guest_ids ?? [],
    // 옛 서버(이 필드를 모르는)에서는 true 로 본다 — 없다고 다시 묻지 않는다.
    legal_agreed: data?.legal_agreed !== false,
  };
}

function collabHeaders(session: CollabSession | null): HeadersInit {
  const headers: Record<string, string> = {};
  if (session?.guestId) headers["X-Woorialbum-Guest-Id"] = session.guestId;
  if (session?.contributorId) headers["X-Woorialbum-Contributor-Id"] = session.contributorId;
  return headers;
}

/** Keeps contributor identity and the signed-in identity together for collaboration calls. */
async function collaborationFetch(path: string, init: RequestInit, session: CollabSession | null): Promise<Response> {
  const request = async (accessToken?: string) => {
    const headers = new Headers(init.headers);
    for (const [key, value] of Object.entries(collabHeaders(session))) headers.set(key, value);
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    return fetch(`${API_BASE}${path}`, { ...init, headers });
  };
  const authSession = await getSession();
  const response = await request(authSession?.accessToken);
  if (response.status !== 401 || !authSession) return response;
  authDebug("API_401", { source: "collaborationFetch", endpoint: path });
  const refreshed = await refreshSession();
  if (!refreshed) return response;
  const retried = await request(refreshed.accessToken);
  authDebug(retried.ok ? "API_RETRY_SUCCESS" : "API_RETRY_FAILED", { source: "collaborationFetch", endpoint: path });
  return retried;
}

export async function getJoinPreview(token: string) {
  // Attach the bearer when signed in so the server can tell if the viewer already
  // owns/belongs to this album (viewer_is_member). Anonymous viewers send no token.
  const session = await getSession();
  const response = session?.accessToken
    ? await authenticatedFetch(`/api/join/${encodeURIComponent(token)}`)
    : await fetch(`${API_BASE}/api/join/${encodeURIComponent(token)}`);
  if (!response.ok) throw new Error(await parseError(response));
  return response.json() as Promise<{
    album_id: string;
    title: string;
    owner_name: string | null;
    cover_image_url: string | null;
    contributor_count: number;
    photo_count: number;
    photo_limit: number;
    viewer_is_member?: boolean;
  }>;
}

/**
 * 초대 링크로 참여한다.
 *
 * ★ 로그인해 있으면 **그 사실을 함께 보낸다** (K-7 · §1). 서버는 이 요청에서
 *   `optional_authenticated_user` 로 로그인 여부를 읽어 참여를 **계정에 붙인다**.
 *   예전에는 맨 `fetch` 라 토큰이 안 갔고, 로그인한 사람도 게스트로 참여했다 —
 *   그러면 `내 앨범`·`함께 만드는 앨범` 에서 자기가 참여한 앨범을 못 찾는다.
 * ★ 로그인하지 않은 사람도 그대로 참여한다. 토큰이 없으면 안 보낼 뿐이다.
 */
export async function joinCollaboration(
  token: string,
  body: { display_name: string; relationship?: string | null; guest_id?: string | null },
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const session = await getSession();
    if (session?.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;
  } catch {
    // 로그인 상태를 못 읽어도 참여는 된다 — 게스트로 진행한다.
  }
  const response = await fetch(`${API_BASE}/api/join/${encodeURIComponent(token)}`, {
    method: "POST",
    headers,
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

export async function getCollaborationStatus(albumId: string, signal?: AbortSignal) {
  const load = async () => {
    const response = await authenticatedFetch(`/api/albums/${albumId}/collaboration`, { cache: "no-store", signal });
    if (!response.ok) throw new Error(await parseError(response));
    return response.json() as Promise<{
      can_edit_settings: boolean;
      collaboration_enabled: boolean;
      collaboration_status: string;
      photo_count: number;
      photo_limit: number;
      contributor_count: number;
      memory_count: number;
      visitor_count?: number;
      participation?: Awaited<ReturnType<typeof getAlbumParticipation>>;
    }>;
  };
  // A lifecycle-bound request cannot share a promise with another lifecycle:
  // StrictMode cleanup may abort the first signal while the next mount needs a
  // fresh request. Signal-free user-triggered reads can still be deduplicated.
  return signal ? load() : dedupeRequest(`collaboration:${albumId}`, load);
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
  const response = await collaborationFetch(`/api/albums/${albumId}/contribute/workspace`, {}, session);
  if (!response.ok) throw new Error(await parseError(response));
  return response.json();
}

/**
 * 사진을 **더할 때**의 통로. 주최자의 `사진 추가`와 참여자가 더하는 자리가 같은 것을 쓴다.
 *
 * ★ 촬영일·좌표를 함께 보낸다(2026-08-18). 모양은 앨범을 만들 때와 **같은 `file_meta`**
 *   다 — 서버가 두 가지 모양을 알게 하지 않는다. 순서는 `photos` 와 같다.
 * ★ 못 읽었으면 그 자리를 null 로 둔다. **사진은 그대로 올라간다** — 지명이 안 붙을 뿐이다.
 */
export async function uploadContributePhotos(
  albumId: string,
  session: CollabSession,
  files: File[],
  fileMeta?: Array<{ captured_at: string | null; latitude: number | null; longitude: number | null }>,
) {
  const form = new FormData();
  for (const file of files) {
    form.append("photos", file, file.name || "photo.jpg");
    form.append("file_created_ats", String(file.lastModified));
  }
  form.append("file_meta", JSON.stringify(fileMeta ?? files.map(() => ({ captured_at: null, latitude: null, longitude: null }))));
  const response = await collaborationFetch(`/api/albums/${albumId}/contribute/photos`, {
    method: "POST",
    body: form,
  }, session);
  if (!response.ok) throw new Error(await parseError(response));
  return response.json();
}

export async function createPhotoMemory(
  albumId: string,
  photoId: string,
  session: CollabSession,
  comment: string,
) {
  const response = await collaborationFetch(`/api/albums/${albumId}/photos/${photoId}/memories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      comment,
      guest_id: session.guestId,
      contributor_id: session.contributorId,
    }),
  }, session);
  if (!response.ok) throw new Error(await parseError(response));
  return response.json();
}

export async function updatePhotoMemory(
  albumId: string,
  memoryId: string,
  session: CollabSession,
  comment: string,
) {
  const response = await collaborationFetch(`/api/albums/${albumId}/memories/${memoryId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      comment,
      guest_id: session.guestId,
      contributor_id: session.contributorId,
    }),
  }, session);
  if (!response.ok) throw new Error(await parseError(response));
  return response.json();
}

export async function deletePhotoMemory(albumId: string, memoryId: string, session: CollabSession) {
  const params = new URLSearchParams();
  if (session.guestId) params.set("guest_id", session.guestId);
  params.set("contributor_id", session.contributorId);
  const response = await collaborationFetch(`/api/albums/${albumId}/memories/${memoryId}?${params}`, {
    method: "DELETE",
  }, session);
  if (!response.ok) throw new Error(await parseError(response));
}
