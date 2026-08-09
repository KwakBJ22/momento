import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

/**
 * 열리지 않는 링크가 이유를 말한다 (J-9 · SCREEN_SPEC §8·§10·§11).
 *
 * 카카오톡 대화방의 메시지는 지워지지 않고 계속 남는다 — 죽은 링크를 누르는 일은
 * 예외가 아니라 정기적으로 일어나는 일이다.
 *
 * ★ 이 화면은 **오류가 아니라 안내**다. 받는 사람이 무엇을 잘못한 것이 아니다.
 * ★ 문구는 **백엔드가 준다.** 왜 안 열리는지는 서버만 안다 — 화면이 추측하지 않는다.
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const screen = readFileSync(path.join(SRC, "components/LinkUnavailable.tsx"), "utf8");
const screenCss = readFileSync(path.join(SRC, "components/LinkUnavailable.css"), "utf8");
const join = readFileSync(path.join(SRC, "components/JoinPage.tsx"), "utf8");
const router = readFileSync(path.join(SRC, "components/ShareEntryRouter.tsx"), "utf8");
const view = readFileSync(path.join(SRC, "components/AlbumView.tsx"), "utf8");

test("★ 두 경로가 같은 화면을 쓴다 — 초대 링크와 구경용 링크", () => {
  assert.match(join, /<LinkUnavailable message=\{error\} \/>/);
  assert.match(router, /<LinkUnavailable message=\{state\.message\} \/>/);
  // 예전에는 각자 다른 것을 그렸다.
  assert.equal(join.includes('notice--error join-page__error" role="alert">{error}</p></section>'), false);
  assert.equal(router.includes("앨범을 열지 못했어요.</h2>"), false, "우리가 못 했다는 제목이 남아 있다");
});

test("★ 오류가 아니라 안내다 — 껍데기도 읽힘도 안내다", () => {
  assert.match(screen, /className="notice notice--info link-unavailable__message"/);
  // 주석은 뺀다 — 설명에서 그 속성을 안 쓴다고 말하는 것은 정상이다.
  const code = screen.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(code.includes('role="alert"'), false, "오류로 읽힌다");
  // 배경·테두리를 새로 만들지 않는다(껍데기는 styles/notice.css 의 것을 쓴다).
  const message = screenCss.slice(
    screenCss.indexOf(".link-unavailable__message {"),
    screenCss.indexOf("}", screenCss.indexOf(".link-unavailable__message {")),
  );
  assert.equal(/(^|[\s;])(background|border)\s*:/.test(message), false);
});

test("★ 문구를 화면이 만들지 않는다 — 서버가 준 것을 그대로 그린다", () => {
  assert.match(screen, /\{message\}/);
  for (const sentence of ["지워졌", "기간이 지났", "다 모았어요"]) {
    assert.equal(screen.includes(sentence), false, `화면이 문구를 갖고 있다: ${sentence}`);
  }
});

test("★ 두 줄이 두 줄로 보인다", () => {
  assert.match(screenCss, /\.link-unavailable__message \{[\s\S]*?white-space: pre-line;/);
});

test("★ 막다른 골목을 만들지 않는다 — 어느 경우에도 다음에 할 일이 있다", () => {
  assert.match(screen, /LINK_UNAVAILABLE_ACTION = "내 앨범 만들기"/);
  assert.match(screen, /<a className="link-unavailable__action" href="\/">/);
});

test("★ 브랜드 푸터를 지우지 않는다 — 이 서비스를 확인할 유일한 화면일 수 있다", () => {
  // 앱 껍데기가 그리는 푸터를 이 화면이 감추지 않는다.
  assert.equal(/display:\s*none/.test(screenCss), false);
  assert.equal(screen.includes("AppFooter"), false, "화면이 푸터를 따로 만든다");
});

test("★ 지우기 확인에 링크 안내가 있다 — 지우기 동작 자체는 그대로다", () => {
  assert.match(view, /이미 보낸 링크도 함께 사라져요\. 받은 분들은 더 이상 앨범을 볼 수 없어요\./);
  assert.match(view, /description=\{DELETE_ALBUM_WARNING\}/);
  // 두 줄이 두 줄로 보인다.
  const screenCssShared = readFileSync(path.join(SRC, "components/AlbumScreen.css"), "utf8");
  assert.match(screenCssShared, /\.album-confirm-sheet__text \{[^}]*white-space: pre-line/);
});
