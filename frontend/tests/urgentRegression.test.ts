import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isRequestAborted } from "../src/lib/requestAbort";

const component = (name: string) => readFileSync(
  new URL(`../src/components/${name}.tsx`, import.meta.url),
  "utf8",
);

test("collaboration request cancellations stay silent and isolated from the next request", () => {
  const panel = component("CollaborationPanel");
  const api = readFileSync(new URL("../src/lib/api.ts", import.meta.url), "utf8");
  const abortedController = new AbortController();
  abortedController.abort();

  assert.equal(isRequestAborted(new DOMException("Aborted", "AbortError")), true);
  assert.equal(isRequestAborted(new Error("signal is aborted without reason")), true);
  assert.equal(isRequestAborted(new Error("network aborted"), abortedController.signal), true);
  assert.equal(isRequestAborted(new Error("server error")), false);
  assert.match(panel, /requestId !== refreshRequestId\.current/);
  assert.match(panel, /isRequestAborted\(cause, signal\)/);
  assert.match(panel, /함께 만들기 정보를 불러오지 못했어요\. 다시 시도해 주세요\./);
  assert.match(panel, /const controller = new AbortController\(\);\s*void refresh\(controller\.signal\)/);
  assert.match(panel, /retryControllerRef\.current\?\.abort\(\);\s*const controller = new AbortController\(\);/);
  assert.match(api, /return signal \? load\(\) : dedupeRequest\(`collaboration:\$\{albumId\}`, load\)/);
});

test("bottom navigation uses executable button actions and guards disabled contribution actions", () => {
  const source = component("AlbumBottomNavigation");
  assert.match(source, /runIfEnabled\(canAddPhoto, onAddPhoto\)/);
  assert.match(source, /runIfEnabled\(canAddMemory, onAddMemory\)/);
  assert.match(source, /onCreateAlbum/);
  assert.match(source, /<button type="button" className="album-bottom-navigation__new-album"/);
  assert.doesNotMatch(source, /<a href=\{newAlbumHref\}/);
});

test("album deletion is guarded in the list and detail views", () => {
  const myAlbums = component("MyAlbums");
  const albumView = component("AlbumView");
  assert.match(myAlbums, /const deletingIdsRef = useRef<Set<string>>\(new Set\(\)\)/);
  assert.match(myAlbums, /if \(deletingIdsRef\.current\.has\(album\.album_id\)\) return/);
  assert.match(myAlbums, /await deleteAlbum\(album\.album_id\);\s*setAlbums/);
  assert.match(albumView, /const deletingRef = useRef\(false\)/);
  assert.match(albumView, /if \(deletingRef\.current\) return/);
  assert.match(albumView, /await deleteAlbum\(albumId\);\s*window\.location\.assign/);
});

test("mobile collaboration invitation constrains its contents and keeps the cover reserved", () => {
  const joinPage = component("JoinPage");
  const css = readFileSync(new URL("../src/components/JoinPage.css", import.meta.url), "utf8");
  assert.match(joinPage, /loading="eager" decoding="async" fetchPriority="high"/);
  assert.match(css, /\.join-page \{[\s\S]*width: 100%;[\s\S]*max-width: 420px;[\s\S]*min-width: 0;[\s\S]*box-sizing: border-box;/);
  assert.match(css, /\.join-page > \* \{[\s\S]*max-width: 100%;/);
  assert.match(css, /\.join-page__cover \{[\s\S]*aspect-ratio: 3 \/ 2;[\s\S]*max-height: 240px;/);
  assert.match(css, /\.join-page__relationship-chips \{[\s\S]*flex-wrap: wrap;/);
  assert.match(css, /\.join-page__cta \{[\s\S]*width: 100%;[\s\S]*min-height: 56px;/);
});

test("collaboration relationship chips match the backend contract and validation details stay hidden", () => {
  const joinPage = component("JoinPage");
  const api = readFileSync(new URL("../src/lib/api.ts", import.meta.url), "utf8");
  assert.match(joinPage, /RELATIONSHIPS = \["가족", "친구", "연인", "지인", "기타"\]/);
  assert.match(api, /Array\.isArray\(detail\) \|\| response\.status === 422/);
  assert.match(api, /"입력 내용을 확인해주세요\."/);
  assert.doesNotMatch(api, /detail\.map\(\(d/);
});

test("login dialog uses one visual container with focus and scroll handling", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");
  assert.match(app, /className="auth-modal"/);
  assert.match(app, /className="auth-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="auth-dialog-title"/);
  assert.match(app, /document\.body\.style\.overflow = "hidden"/);
  assert.match(app, /event\.key === "Escape"/);
  assert.match(app, /loginReturnFocusRef\.current\?\.focus\(\)/);
  assert.match(app, /<AuthPanel titleId="auth-dialog-title" \/>/);
  assert.match(css, /\.auth-modal \.auth-panel \{[\s\S]*padding: 0;[\s\S]*border: 0;/);
  assert.match(css, /\.auth-modal__later \{[\s\S]*width: auto;[\s\S]*border: 0;/);
});

test("album navigation opens the contribution panel without replacing the album route", () => {
  const source = component("AlbumView");
  assert.match(source, /setActiveAction\(action\)/);
  assert.match(source, /window\.history\.pushState/);
  assert.match(source, /<ContributeWorkspace albumId=\{albumId\} embedded/);
  assert.doesNotMatch(source, /window\.location\.assign\(target\.toString\(\)\)/);
});

test("public album reads a requested contribution action without a second route or album reload", () => {
  const source = component("PublicShareView");
  assert.match(source, /get\("contribute"\)/);
  assert.match(source, /requestedContribution/);
  assert.match(source, /onCreateAlbum: \(\) => window\.location\.assign\("\/"\)/);
});

test("the share entry router decides owner versus public participation before rendering a view", () => {
  const entry = component("ShareEntryRouter");
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /<ShareEntryRouter token=\{shareToken\} user=\{user\}/);
  assert.match(entry, /getPublicShare\(token, edition\)/);
  assert.match(entry, /getAlbum\(album\.album_id, edition\)/);
  assert.match(entry, /privateAlbum\.can_edit/);
  assert.match(entry, /<AlbumView albumId=\{state\.albumId\}/);
  assert.match(entry, /<PublicShareView token=\{token\} initialAlbum=\{state\.album\} authenticatedUser=\{user \?\? null\}/);
  assert.match(entry, /if \(!authReady\)/);
  assert.match(entry, /authTimedOut/);
});

test("authenticated share visitors use an account-backed contributor session instead of the name form", () => {
  const source = component("PublicShareView");
  assert.match(source, /authenticatedUser\?\.displayName/);
  assert.match(source, /startPublicContribution\(token, null, authenticatedUser\.displayName\)/);
  assert.match(source, /if \(authenticatedUser && !contributionSession\) return/);
});

test("app authentication bootstrap completes before the share entry router can select Guest", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /const \[authReady, setAuthReady\] = useState\(false\)/);
  assert.match(app, /initializeAuth\(\)\.then/);
  assert.match(app, /event === "INITIAL_SESSION" && !initialSessionChecked/);
  assert.match(app, /<ShareEntryRouter token=\{shareToken\} user=\{user\} authReady=\{authReady\}/);
  assert.match(app, /if \(shareToken\)\s*\{/);
  const entry = component("ShareEntryRouter");
  assert.match(entry, /state\.kind === "owner" && !user/);
});

test("authenticated requests refresh a rejected bearer once instead of falling back to Guest", () => {
  const api = readFileSync(new URL("../src/lib/api.ts", import.meta.url), "utf8");
  assert.match(api, /response\.status !== 401/);
  assert.match(api, /refreshSession\(\)/);
  assert.match(api, /authDebug\("API_401"/);
  assert.match(api, /API_RETRY_SUCCESS/);
  assert.match(api, /API_RETRY_FAILED/);
});

test("share entry and callback keep authentication diagnostics scoped to safe route metadata", () => {
  const entry = component("ShareEntryRouter");
  const callback = component("AuthCallback");
  const authService = readFileSync(new URL("../src/services/authService.ts", import.meta.url), "utf8");
  assert.match(entry, /logOnce\("ROUTE_OWNER"/);
  assert.match(entry, /logOnce\("ROUTE_ACCOUNT_PARTICIPANT"/);
  assert.match(entry, /logOnce\("ROUTE_GUEST"/);
  assert.match(entry, /logOnce\("AUTH_TIMEOUT"/);
  assert.match(authService, /authDebug\("SESSION_CONFIRMED"/);
  assert.match(callback, /authDebug\("CALLBACK_SUCCESS"/);
});

test("new album gallery picker permits multiple supported images without capture mode", () => {
  const source = component("UploadForm");
  assert.match(source, /type="file" accept=\{IMAGE_ACCEPT\} multiple onChange=\{handlePickerChange\}/);
  assert.match(source, /snapshotSelectedFiles\(event\.currentTarget\.files\)/);
  assert.match(source, /event\.currentTarget\.value = ""/);
  assert.match(source, /dedupeSelectedPhotos\(accepted, photos\.map\(\(photo\) => photo\.file\)\)/);
});

test("initial album creation moves to the persisted progress screen instead of waiting for a final album payload", () => {
  const upload = component("UploadForm");
  const creating = component("AlbumCreating");
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(upload, /generation_job_id/);
  assert.match(upload, /onSuccess\(\{\s*albumId: created\.album_id/);
  assert.match(app, /getCreatingAlbumIdFromPath/);
  assert.match(app, /<AlbumCreating albumId=\{creatingAlbumId\}/);
  assert.match(app, /\/creating/);
  assert.match(creating, /getAlbumGenerationStatus/);
  assert.match(creating, /window\.location\.replace\(`\/album\/\$\{albumId\}`\)/);
});

test("landing category selection stays on the landing screen until the album CTA is pressed", () => {
  const landing = component("Landing");
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(landing, /onClick=\{\(\) => onSelectCategory\?\.\(option\.value\)\}/);
  assert.match(landing, /앨범 만들기/);
  assert.match(landing, /disabled=\{!category\}/);
  assert.match(app, /const \[isPhotoSelectionStep, setIsPhotoSelectionStep\] = useState\(false\)/);
  assert.match(app, /user && category && isPhotoSelectionStep \? <UploadForm/);
  assert.match(app, /onStart=\{\(selected\) => user \? setIsPhotoSelectionStep\(true\)/);
});

test("creating screen reuses at most five local previews, falls back after refresh, and polls without a fake progress timer", () => {
  const creating = component("AlbumCreating");
  const upload = component("UploadForm");
  const api = readFileSync(new URL("../src/lib/api.ts", import.meta.url), "utf8");
  assert.match(upload, /previewUrls: photos\.slice\(0, 5\)\.map/);
  assert.match(creating, /getAlbumCreationPreview\(albumId\)/);
  assert.match(creating, /getAlbumGenerationPreview\(albumId\)/);
  assert.match(creating, /\.slice\(0, 5\)/);
  assert.match(creating, /document\.hidden\) return 5000/);
  assert.match(creating, /visibilitychange/);
  assert.match(creating, /await getAlbum\(albumId\)/);
  assert.match(creating, /releaseAlbumCreationPreview\(albumId\)/);
  assert.match(api, /generation-preview/);
  assert.doesNotMatch(creating, /setInterval\(/);
});

test("creation timing keeps object URLs in memory only and logs no file paths or signed urls", () => {
  const timing = readFileSync(new URL("../src/lib/albumCreation.ts", import.meta.url), "utf8");
  assert.match(timing, /const previewState = new Map/);
  assert.match(timing, /previewUrls\.slice\(0, 5\)/);
  assert.match(timing, /URL\.revokeObjectURL/);
  assert.doesNotMatch(timing, /sessionStorage/);
  assert.doesNotMatch(timing, /storage_path/);
  assert.doesNotMatch(timing, /signedUrl/);
});

test("album viewing and collaboration invitation use distinct URLs and Kakao payloads", () => {
  const source = component("CollaborationPanel");
  assert.match(source, /rotateCollaborationInvite/);
  assert.match(source, /isContributionInviteUrl/);
  assert.match(source, /pathname\.startsWith\("\/join\/"\)/);
  assert.match(source, /title: "우리 앨범에 추억을 더해주세요"/);
  assert.match(source, /buttonTitle: "추억 추가하기"/);
  assert.match(source, /함께 만들도록 초대/);
});

test("Kakao failures copy the matching viewing link instead of silently failing", () => {
  const albumView = component("AlbumView");
  const albumResult = component("AlbumResult");
  assert.match(albumView, /navigator\.clipboard\.writeText\(shareUrl \|\| await resolvePublicShareUrl\(\)\)/);
  assert.match(albumResult, /navigator\.clipboard\.writeText\(await resolveShareUrl\(\)\)/);
  assert.match(albumView, /링크를 복사했습니다\./);
  assert.match(albumResult, /링크를 복사했습니다\./);
});
