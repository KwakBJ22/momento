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
  // 새 앨범 entry stays a real button in the app/participant variants (default nav
  // moved it to the header 더보기 sheet).
  assert.match(source, /onCreateAlbum/);
  assert.match(source, /onClick=\{createAlbum\}/);
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
  // 표지는 전폭이 아니라 196×140 상자다(목업) — 전폭이면 세로 사진의 양옆이 크게 잘린다.
  assert.match(css, /\.join-page__cover \{[\s\S]*width: 196px;[\s\S]*height: 140px;[\s\S]*object-fit: cover;/);
  assert.match(css, /\.join-page__cta \{[\s\S]*width: 100%;[\s\S]*height: 56px;/);
});

test("collaboration validation details stay hidden (관계 칩은 화면에서 뺐다)", () => {
  const joinPage = component("JoinPage");
  const api = readFileSync(new URL("../src/lib/api.ts", import.meta.url), "utf8");
  // 관계는 초대한 사람이 이미 아는 것이라 다시 묻지 않는다. 컬럼·API 는 그대로 두고
  // 화면에서만 뺐다 — 요청에는 relationship: null 로 보낸다.
  assert.doesNotMatch(joinPage, /RELATIONSHIPS/);
  assert.match(joinPage, /relationship: null/);
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

test("embedded 사진 추가 sheet opens the picker and hides the album's existing photos", () => {
  const source = component("ContributeWorkspace");
  // The sheet's job is ADDING photos: the file dialog opens immediately, and the grid
  // shows only this session's additions — not the whole album (which read as a
  // "comment on every photo" screen).
  assert.match(source, /isEmbeddedPhotoAdd = embedded && requestedAction === "photo"/);
  // 자동 열기는 제거됐다(SCREEN_SPEC §11): effect 는 사용자 제스처와 다른 tick 이라
  // iOS 사파리·카카오 웹뷰에서 조용히 실패한다. label htmlFor 가 유일·확실한 경로다.
  assert.doesNotMatch(source, /requestAnimationFrame\([^)]*click/);
  assert.match(source, /htmlFor=\{PHOTO_INPUT_ID\}/);
  assert.match(source, /!isEmbeddedPhotoAdd \|\| newItemIds\.includes\(photo\.id\)/);
  // Auto-open is best-effort only: the always-visible upload label is the guaranteed
  // path, and an empty sheet shows a hint instead of a blank grid.
  assert.match(source, /contribute__empty">위의 ‘사진 추가하기’를 눌러 사진을 골라 주세요\./);
  // 기억 추가 keeps the full grid to pick from, and the textarea stays bound to ONE
  // selected photo only.
  assert.match(source, /draftPhotoId === photo\.id \? \(/);
});

test("a full album (30/30) blocks the picker up front and says why on screen", () => {
  const source = component("ContributeWorkspace");
  // The production incident: at 30/30, limitSelectedPhotos silently cut the pick to
  // zero and no request ever left the client. The limit must be visible, the input
  // disabled, and the auto-open skipped — never a quiet no-op.
  assert.match(source, /photoLimitReached = Boolean\(/);
  assert.match(source, /disabled=\{isUploading \|\| photoLimitReached\}/);
  assert.match(source, /앨범이 가득 찼어요\. 사진은 한 앨범에 최대/);
  // 가득 찬 앨범에서는 input 자체가 disabled 라 label 을 눌러도 선택창이 열리지 않는다
  // (예전에는 자동 열기를 건너뛰는 것으로 막았다 — 이제 열 방법 자체가 막힌다).
  assert.match(source, /ALBUM_PHOTO_CAPACITY\),\s*\);/);
});

test("closing the contribution sheet refreshes the album behind it without a remount", () => {
  const source = component("AlbumView");
  const fn = source.slice(source.indexOf("const closeContribution"), source.indexOf("useEffect(() =>", source.indexOf("const closeContribution")));
  // Saved contributions must appear behind the sheet: photos + album are refetched
  // through setState (props reconcile — AlbumRenderer is NOT remounted, §9), and the
  // CollaborationPanel alone is remounted so its "새로운 추억" summary refreshes.
  assert.match(fn, /getAlbumPhotos\(albumId, requestedEdition\)/);
  assert.match(fn, /getAlbum\(albumId, requestedEdition\)/);
  assert.match(fn, /setCollabRefreshKey/);
  // No full reload path: closing must not toggle photosReady or retryKey.
  assert.doesNotMatch(fn, /setPhotosReady|setRetryKey/);
  assert.match(source, /key=\{`collab-\$\{collabRefreshKey\}`\}/);
});

test("open sheet pins the body and unlock restores the exact scroll offset", () => {
  const source = component("AlbumView");
  const lock = source.slice(source.indexOf("const sheetOpen"), source.indexOf("}, [sheetOpen]"));
  // iOS Safari ignores overflow:hidden for touch scroll — the lock must be the
  // position:fixed + top:-scrollY pattern, and unlock must window.scrollTo back.
  assert.match(lock, /style\.position = "fixed"/);
  assert.match(lock, /style\.top = `-\$\{scrollY\}px`/);
  assert.match(lock, /window\.scrollTo\(0, scrollY\)/);
  // The sheet's own CSS stays untouched (structure guarded elsewhere).
  assert.doesNotMatch(lock, /album-inline-action/);
});

test("owner-only actions hide behind server capability flags; PDF stays for participants", () => {
  const source = component("AlbumView");
  // §10: the frontend never guesses — it renders from can_edit/can_delete that the
  // backend derived from AlbumAccess. Backend checks stay (2중 방어). The actions now
  // live in the 공유하기/더보기 sheets (목업 2a), not in a bottom button row.
  assert.match(source, /requestedEdition === null && displayAlbum\?\.can_edit \? <CollaborationPanel/);
  // 시트는 공용 컴포넌트(AlbumMoreSheet)로 옮겼다 — 앨범 상세와 공유 앨범이 같은 것을
  // 쓴다(§5). 호출자는 서버 플래그를 그대로 넘기기만 한다.
  assert.match(source, /canEdit=\{Boolean\(displayAlbum\?\.can_edit\)\}/);
  assert.match(source, /canDelete=\{Boolean\(displayAlbum\?\.can_delete\)\}/);
  const moreSheet = readFileSync(new URL("../src/components/AlbumMoreSheet.tsx", import.meta.url), "utf8");
  assert.match(moreSheet, /canEdit && photoCount && onChangeCover[\s\S]{0,200}표지 사진 바꾸기/);
  assert.match(moreSheet, /canDelete && onDeleteAlbum[\s\S]{0,240}이 앨범 지우기/);
  // PDF row is NOT gated by can_edit/can_delete — participants keep it.
  assert.doesNotMatch(moreSheet, /canEdit[^\n]*파일로 저장하기/);
  const shareSheet = source.split('className="album-inline-action album-share-sheet"')[1].split("</section>")[0];
  // 초대 카드(함께 만들기)는 소유자(can_edit)만.
  assert.match(shareSheet, /displayAlbum\?\.can_edit \? <>/);
});

test("permission errors speak Korean and never offer 다시 시도", () => {
  const albumView = component("AlbumView");
  assert.match(albumView, /errorStatus === 403 \? "이 앨범을 볼 수 없어요"/);
  assert.match(albumView, /권한이 없어요\. 앨범 주인이 보내 준 링크로 다시 열어 주세요\./);
  // Retry renders ONLY for non-403 (transient) failures.
  assert.match(albumView, /errorStatus === 403 \? null : <button[\s\S]{0,220}다시 시도/);
  // The API layer carries the HTTP status so the view can distinguish the two.
  const api = readFileSync(new URL("../src/lib/api.ts", import.meta.url), "utf8");
  assert.match(api, /error\.status = response\.status/);
});

test("missing-caption notice renders only above zero and opens the memory sheet", () => {
  const source = component("AlbumView");
  // Count = photos whose comment is empty/whitespace; zero renders NOTHING.
  assert.match(source, /missingCaptionCount = photos\.filter\(\(photo\) => !\(photo\.caption \|\| ""\)\.trim\(\)\)\.length/);
  assert.match(source, /missingCaptionCount > 0 && !guestOwner && requestedEdition === null \? \(/);
  assert.match(source, /사진 \{missingCaptionCount\}장에 아직 한마디가 없어요\./);
  // "채우러 가기" opens the existing 한마디 쓰기 sheet (memory) — no new screens.
  assert.match(source, /채우러 가기<\/button>/);
  assert.match(source, /album-caption-notice__link" onClick=\{\(\) => void openContribution\("memory"\)\}/);
  // Additive only: the notice rides the existing headerSupplement extension point.
  assert.match(source, /headerSupplement=\{headerExtras\}/);
});

test("re-opening contribution with a stored session stays synchronous (gesture survives)", () => {
  const source = component("AlbumView");
  // With a stored session no share-token fetch is needed: the sheet opens with no
  // await between the tap and setActiveAction, so iOS Safari keeps the user gesture
  // alive for the photo sheet's auto file-picker click.
  const fn = source.slice(source.indexOf("const openContribution"), source.indexOf("const closeContribution"));
  const syncPath = fn.slice(0, fn.indexOf("setActionLoading(true)"));
  assert.match(syncPath, /loadCollabSession\(albumId\)/);
  assert.match(syncPath, /activateContribution\(action\)/);
  // No actual `await <expr>` in the sync path (the comment may mention the word).
  assert.equal(/await\s+\w/.test(syncPath), false);
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
  assert.match(app, /<ShareEntryRouter token=\{shareToken\} user=\{user\}[^>]*authReady=\{authReady\}/);
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
  // accept 값은 환경별로 정해진 PHOTO_ACCEPT 하나(imageAccept.test 참고). capture 는 없다.
  assert.match(source, /type="file" accept=\{PHOTO_ACCEPT\} multiple onChange=\{handlePickerChange\}/);
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
  // The step initializes from persisted create-state (restored after a tab restart).
  assert.match(app, /const \[isPhotoSelectionStep, setIsPhotoSelectionStep\] = useState\(initialCreateStep\.photoStep\)/);
  // Guest-first policy: the CTA proceeds to photo selection for everyone (no login wall).
  assert.match(app, /category && isPhotoSelectionStep \? <UploadForm/);
  assert.match(app, /onStart=\{\(selected\) => \{ setCategory\(selected\); setIsPhotoSelectionStep\(true\); \}\}/);
});

test("creating screen reuses at most five local previews, falls back after refresh, and eases progress toward the server target", () => {
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
  // The progress bar is time-driven (so the ~1min story step never freezes it) with the
  // real server job.progress passed in only as an upward correction (nextCreationProgress).
  assert.match(creating, /nextCreationProgress\(\{/);
  assert.match(creating, /serverProgress: job \? job\.progress : null/);
  assert.match(creating, /elapsedMs: Date\.now\(\) - startedAt\.current/);
  assert.match(creating, /estimateTotalMs\(getAlbumCreationPreview\(albumId\)\?\.photoCount\)/);
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
  // Result-named wording (동사 대신 결과로 이름): 초대 = "사진·한마디 받기", 복사 = "링크 복사".
  // 이름은 §7 대로 "한마디" 하나다(옛 이름 "기억"에서 바뀌었다).
  assert.match(source, /사진·한마디 받기/);
  assert.match(source, /링크 복사/);
  assert.match(source, /상대가 자기 사진을 더할 수 있어요/);
  assert.doesNotMatch(source, /함께 만들도록 초대/);
});

test("share buttons are named for the view-only result, not the '공유' verb", () => {
  // AlbumView(앨범 화면)는 목업 2a의 공유하기 시트로 대체됐다: 버튼 대신 시트의
  // "받은 사람은 보기만 할 수 있어요" 힌트가 같은 구분을 담당한다.
  const albumView = component("AlbumView");
  assert.match(albumView, /받은 사람은 보기만 할 수 있어요/);
  assert.doesNotMatch(albumView, />앨범 공유하기<\/button>/);
  for (const name of ["AlbumResult", "PublicShareView"]) {
    const source = component(name);
    assert.match(source, /구경하라고 보내기/);
    assert.match(source, /보기만 할 수 있어요/);
    assert.doesNotMatch(source, />앨범 공유하기<\/button>/);
  }
});

test("Kakao failures copy the matching viewing link instead of silently failing", () => {
  const albumView = component("AlbumView");
  const albumResult = component("AlbumResult");
  assert.match(albumView, /navigator\.clipboard\.writeText\(shareUrl \|\| await resolvePublicShareUrl\(\)\)/);
  assert.match(albumResult, /navigator\.clipboard\.writeText\(await resolveShareUrl\(\)\)/);
  assert.match(albumView, /링크를 복사했습니다\./);
  assert.match(albumResult, /링크를 복사했습니다\./);
});
