import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

registerCssStub();
setupDom("https://test.local/");

import {
  forgetBootstrapCache,
  readBootstrapCache,
  shouldCallBootstrap,
  writeBootstrapCache,
} from "../src/lib/bootstrapOnce";

/**
 * 화면을 옮길 때마다 `bootstrap` 을 다시 부르지 않는다.
 *
 * 이 앱은 화면 이동이 `window.location.assign` 이라 페이지가 통째로 다시 열린다.
 * App 이 매번 새로 마운트되며 요청이 또 나갔다 — 운영 로그 08-13 08:54 에
 * 20초 사이 **세 번**(234 · 160 · 94ms).
 *
 * ★ 그렇다고 무조건 건너뛰면 안 된다. bootstrap 이 실제로 할 일이 둘 있다:
 *   게스트 귀속(contributor_guest_ids)과 약관 동의(legal_agreed).
 *   **둘 중 하나라도 있으면 무조건 부른다** — 늦추면 K-14 가 다시 난다.
 */

const FIVE_MIN = 5 * 60 * 1000;
const NOW = 1_700_000_000_000;

// --- 부를지 말지: 순수 판단만 본다 ---------------------------------------------

test("★ 게스트 id 가 있으면 캐시가 싱싱해도 부른다", () => {
  assert.equal(
    shouldCallBootstrap({ guestIds: ["guest-1"], legalAgreed: false, cache: { at: NOW } }),
    true,
    "게스트가 남긴 것을 붙이는 일을 미뤘다",
  );
});

test("★ 약관 동의가 남아 있으면 캐시가 싱싱해도 부른다 (K-14)", () => {
  assert.equal(
    shouldCallBootstrap({ guestIds: [], legalAgreed: true, cache: { at: NOW } }),
    true,
    "동의 기록을 미뤘다",
  );
});

test("★ 둘 다 없고 캐시가 싱싱하면 안 부른다 — 이것이 이번 수정이다", () => {
  assert.equal(shouldCallBootstrap({ guestIds: [], legalAgreed: false, cache: { at: NOW } }), false);
});

test("둘 다 없고 캐시가 없으면 부른다", () => {
  assert.equal(shouldCallBootstrap({ guestIds: [], legalAgreed: false, cache: null }), true);
});

test("할 일이 둘 다 있으면 당연히 부른다", () => {
  assert.equal(
    shouldCallBootstrap({ guestIds: ["g"], legalAgreed: true, cache: { at: NOW } }),
    true,
  );
});

// --- 얼마나 믿을 것인가: 시간을 흘려보내지 않고 값으로 고정한다 ------------------

test("★ 5분 경계 — 시간을 실제로 흘려보내지 않는다", () => {
  writeBootstrapCache("u1", { at: NOW, album_count: 2, max_albums: 5 });
  // 갓 저장한 것
  assert.notEqual(readBootstrapCache("u1", NOW), null);
  // 4분 59초 — 아직 믿는다
  assert.notEqual(readBootstrapCache("u1", NOW + FIVE_MIN - 1000), null);
  // 5분 정각 — 아직 믿는다(경계는 포함)
  assert.notEqual(readBootstrapCache("u1", NOW + FIVE_MIN), null);
  // 5분 1밀리초 — 버린다
  assert.equal(readBootstrapCache("u1", NOW + FIVE_MIN + 1), null);
});

test("★ 시계가 뒤로 가면 믿지 않는다 (기기 시간 변경)", () => {
  writeBootstrapCache("u2", { at: NOW, album_count: 1, max_albums: 5 });
  assert.equal(readBootstrapCache("u2", NOW - 1), null, "미래에 저장된 것을 믿었다");
});

test("저장한 숫자를 그대로 돌려준다", () => {
  writeBootstrapCache("u3", { at: NOW, album_count: 3, max_albums: 7 });
  const cached = readBootstrapCache("u3", NOW);
  assert.equal(cached?.album_count, 3);
  assert.equal(cached?.max_albums, 7);
});

test("사람마다 따로 저장한다 — 남의 숫자를 읽지 않는다", () => {
  writeBootstrapCache("u4", { at: NOW, album_count: 9, max_albums: 9 });
  assert.equal(readBootstrapCache("u5", NOW), null);
});

test("망가진 값·빈 사용자에는 조용히 없는 것으로 본다", () => {
  localStorage.setItem("woorialbum-bootstrap:u6", "{이건 JSON 이 아니다");
  assert.equal(readBootstrapCache("u6", NOW), null);
  localStorage.setItem("woorialbum-bootstrap:u7", JSON.stringify({ album_count: 1 })); // at 없음
  assert.equal(readBootstrapCache("u7", NOW), null);
  assert.equal(readBootstrapCache("", NOW), null);
});

test("지우면 없는 것이 된다 — 숫자가 달라졌을 때 쓰는 자리다", () => {
  writeBootstrapCache("u8", { at: NOW, album_count: 1, max_albums: 5 });
  forgetBootstrapCache("u8");
  assert.equal(readBootstrapCache("u8", NOW), null);
});

// --- 왜 이 캐시가 안전한가 -------------------------------------------------------

test("★ 캐시가 낡아도 문제가 없는 근거 — 앨범 수·한도를 화면이 쓰지 않는다", () => {
  // 이 사실이 이 캐시의 안전 근거다. 나중에 그 값을 화면에 쓰게 되면
  // 이 검사가 깨지고, 그때 캐시 판단을 다시 봐야 한다.
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(
    app,
    /const \[, setAlbumLimit\] = useState/,
    "앨범 수·한도를 화면이 읽기 시작했다 — bootstrap 캐시 판단을 다시 봐야 한다",
  );
  // 진짜 한도는 백엔드가 막는다(프런트 숫자는 만들기 전 경고용일 뿐이다).
});

test("localStorage 를 쓴다 — sessionStorage 는 카카오 로그인 왕복에서 사라진다", () => {
  const source = readFileSync(new URL("../src/lib/bootstrapOnce.ts", import.meta.url), "utf8");
  // 주석을 걷어내고 코드만 본다 — 이 규칙을 설명하는 주석이 스스로 걸리지 않게.
  const code = source.split(/\r?\n/).filter((line) => {
    const t = line.trim();
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  }).join("\n");
  assert.match(code, /localStorage\.getItem/);
  assert.equal(code.includes("sessionStorage"), false, "왕복에서 사라지는 저장소를 썼다");
});

test("★ App 이 할 일을 먼저 보고 나서 건너뛴다 — 순서가 뒤바뀌면 K-14 가 돌아온다", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const block = app.slice(app.indexOf("const guestIds = collectContributorGuestIds()"), app.indexOf("void bootstrapAccount("));
  assert.match(block, /const legalAgreed = readLegalConsent\(\);/);
  assert.match(block, /shouldCallBootstrap\(\{ guestIds, legalAgreed, cache: cached \}\)/);
});
