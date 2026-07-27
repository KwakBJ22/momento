import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = (name: string) => readFileSync(
  new URL(`../src/components/${name}.tsx`, import.meta.url),
  "utf8",
);

test("bottom navigation uses executable button actions and guards disabled contribution actions", () => {
  const source = component("AlbumBottomNavigation");
  assert.match(source, /runIfEnabled\(canAddPhoto, onAddPhoto\)/);
  assert.match(source, /runIfEnabled\(canAddMemory, onAddMemory\)/);
  assert.match(source, /onCreateAlbum/);
  assert.match(source, /<button type="button" className="album-bottom-navigation__new-album"/);
  assert.doesNotMatch(source, /<a href=\{newAlbumHref\}/);
});

test("album navigation opens the existing contribution experience instead of only scrolling a panel", () => {
  const source = component("AlbumView");
  assert.match(source, /target\.searchParams\.set\("contribute", action\)/);
  assert.match(source, /onAddPhoto: \(\) => \{ void openContribution\("photo"\); \}/);
  assert.match(source, /onAddMemory: \(\) => \{ void openContribution\("memory"\); \}/);
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
