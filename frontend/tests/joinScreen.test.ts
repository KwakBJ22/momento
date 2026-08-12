import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const page = read("components/JoinPage.tsx");
const css = read("components/JoinPage.css");
const rule = (selector: string) => css.slice(css.indexOf(`${selector} {`), css.indexOf("}", css.indexOf(`${selector} {`)));

// 목업: docs/mockups/album-detail-invite.html
// 이 화면을 보는 사람은 서비스를 모르고 불려 온 사람이다 — 첫 줄이 초대한 사람의 이름이다.
test("초대 한 줄이 맨 위, 이름도 본문과 같은 검정", () => {
  assert.match(page, /님이 함께 만들자고 초대했어요/);
  const invite = rule(".join-page__invite");
  assert.match(invite, /font-size: 24px/);
  assert.match(invite, /font-weight: 800/);
  assert.match(invite, /line-height: 1\.4/);
  assert.match(invite, /color: var\(--c-text\)/); // 빨간 이름을 쓰지 않는다
  // 초대 문구가 화면의 첫 요소다(카드보다 앞).
  assert.ok(page.indexOf("join-page__invite") < page.indexOf("join-page__card"));
});

test("★ 표지 사진이 곧 카드다 — 폭을 꽉 채우고, 카드에 테두리가 없다", () => {
  // ★ 뒤집힌 항목(UI 정리 3단계 A). 예전에는 테두리가 있고 그 안쪽 여백에 사진이
  //   눌려 196×140 로 작게 들어갔다. 초대장에서 가장 먼저 보여야 할 것은 사진이다.
  //   가로세로 비는 그 상자의 값을 그대로 물려받아(196/140) 잘리는 결은 같다.
  const cover = rule(".join-page__cover");
  assert.match(cover, /width: 100%/);
  // ★ 4:3 으로 바꿨다(4단계 A9) — 196/140 은 가로로 길어서 세로 인물 사진의
  //   머리나 발이 잘렸다. 폰 사진은 대개 세로다.
  assert.match(cover, /aspect-ratio: 4 \/ 3/);
  assert.match(cover, /object-fit: cover/); // 원본 비율 유지, 넘치는 부분만 잘린다
  const card = rule(".join-page__card");
  assert.doesNotMatch(card, /border: /); // 사진이 카드다 — 테두리를 두르지 않는다
  assert.match(card, /border-radius: var\(--r-lg\)/);
  assert.match(card, /overflow: hidden/); // 카드가 사진 윗모서리를 함께 깎는다
  assert.doesNotMatch(rule(".join-page__cover-box"), /padding: /); // 사진을 눌러 넣지 않는다
});

test("★ 안내 문구는 본문 무게다 — 경고문처럼 보이지 않는다", () => {
  // 이 자리는 원래 브랜드 강조용이었는데 지금은 안내문이 들어와 있다.
  // 강조는 첫 줄(초대한 사람 이름)이 이미 한다. 문구 자체는 바뀌지 않았다.
  const motto = rule(".join-page__motto");
  assert.doesNotMatch(motto, /--c-brand-text/);
  assert.match(motto, /color: var\(--c-text-muted\)/);
  assert.match(motto, /font-weight: var\(--w-normal\)/);
  // ★ 가운데로 되돌렸다(4단계 A8) — 초대장은 카드 한 장처럼 읽히는 화면이고
  //   제목·부제가 이미 가운데라 이 줄만 왼쪽이면 어긋나 보였다.
  //   무게를 낮춘 것(색·굵기)은 그대로다 — 정렬만 바뀌었다.
  assert.match(motto, /text-align: center/);
});

test("관계 칩이 화면에 없다 — 컬럼·API 는 그대로", () => {
  // 주석은 제외한다(왜 뺐는지 적어 두는 것은 화면 문구가 아니다).
  const code = page
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
    })
    .join("\n");
  assert.doesNotMatch(code, /관계|RELATIONSHIPS|relationship-chips/);
  // 요청에는 필드를 계속 보낸다(계약 유지).
  assert.match(page, /relationship: null/);
  assert.doesNotMatch(css, /relationship/);
});

test("참여자명 하나만 받고 참여가 된다 — 가입 없이 바로 앨범으로", () => {
  assert.match(page, /참여자명/);
  assert.match(page, /placeholder="앨범에서 이 이름으로 불려요"/);
  assert.match(page, /if \(!name\.trim\(\)\)/);
  assert.match(page, /joinCollaboration\(token, \{ display_name: name\.trim\(\), relationship: null \}\)/);
  assert.match(page, /window\.location\.href = `\/album\/\$\{result\.album_id\}\/contribute`/);
  // 없애기로 한 것들.
  assert.doesNotMatch(page, /어떻게 불러드릴까요|함께 만드는 앨범/);
});

test("화면 문자열에 옛 이름 `기억`이 없다 (§7)", () => {
  assert.doesNotMatch(page, /기억/);
});

// 위계는 색이 아니라 순서·크기로 준다.
test("버튼 위계: 참여 56/18/800이 입력창에 붙고, 카카오 52/17/600은 구분선 뒤", () => {
  const cta = rule(".join-page__cta");
  assert.match(cta, /height: 56px/);
  assert.match(cta, /font-size: 18px/);
  assert.match(cta, /font-weight: 800/);
  assert.match(cta, /background: var\(--c-brand-action\)/); // 검은 버튼이 아니다
  const kakao = rule(".join-page__kakao");
  assert.match(kakao, /height: 52px/);
  assert.match(kakao, /font-size: 17px/);
  assert.match(kakao, /font-weight: 600/);
  assert.match(kakao, /background: var\(--c-kakao\)/);
  assert.match(kakao, /color: var\(--c-kakao-text\)/); // 숫자를 직접 적지 않는다
  // 순서: 참여 → 구분선 → 설명 두 줄 → 카카오.
  assert.ok(page.indexOf("join-page__cta") < page.indexOf("join-page__rule--section"));
  assert.ok(page.indexOf("join-page__rule--section") < page.indexOf("join-page__account-copy"));
  assert.ok(page.indexOf("join-page__account-copy") < page.indexOf("join-page__kakao"));
  assert.match(rule(".join-page__rule--section"), /margin: 38px 0 14px/);
});

test("계정 안내의 로고는 기존 브랜드 색 조합 — 새 색을 만들지 않는다", () => {
  assert.match(page, /BRAND_NAME_KO_PARTS\.lead/);
  assert.match(rule(".join-page__logo b"), /color: var\(--c-text\)/);
  assert.match(rule(".join-page__logo i"), /color: var\(--c-brand\)/);
  assert.match(page, /계정으로 함께하면/);
  assert.match(page, /내가 올린 사진과 글을 언제든 다시 찾을 수 있어요/);
});

test("색은 전부 tokens.css 변수에서 나온다 — hex 직접 기입 0건", () => {
  const hexes = css.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(hexes, []);
});

test("14px 미만 없음 / 누르는 영역 44px 이상", () => {
  const sizes = (css.match(/font-size: (\d+)px/g) || []).map((s) => Number(s.replace(/\D/g, "")));
  assert.ok(sizes.length > 0);
  assert.equal(sizes.filter((size) => size < 14).length, 0, `14px 미만: ${sizes.filter((s) => s < 14)}`);
  assert.match(rule(".join-page__input"), /height: 56px/);
});

test("카카오 로그인은 이 초대 화면으로 되돌아온다 (★ 길을 잃지 않게)", () => {
  // 현재 경로를 returnTo 로 넘긴다 — authService 가 저장하고 AuthCallback 이 그리로 replace 한다.
  assert.match(page, /signIn\("kakao", `\$\{window\.location\.pathname\}\$\{window\.location\.search\}`\)/);
  const auth = read("services/authService.ts");
  assert.match(auth, /persistReturnTo\(returnTo\)/);
  assert.match(auth, /redirectTo: oauthCallbackRedirectUrl\(callbackReturnTo\)/);
  assert.match(read("components/AuthCallback.tsx"), /window\.location\.replace\(returnPath\)/);
});

test("목업 기준 폭(390px)에서는 줄이지 않는다 — 더 좁은 기기에서만", () => {
  // 390px 은 목업의 기기 폭이다. 여기서 22px 로 줄면 목업과 다른 화면이 된다.
  assert.match(css, /@media \(max-width: 360px\)/);
  assert.doesNotMatch(css, /@media \(max-width: 390px\)/);
});

test("장식 없음 — 애니메이션·그림자를 쓰지 않는다", () => {
  assert.doesNotMatch(css, /animation|@keyframes|box-shadow/);
});
