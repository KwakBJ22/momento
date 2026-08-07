import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const view = read("components/AlbumView.tsx");

// SCREEN_SPEC §1 — 저장 안내는 명령이 아니라 물음이다. 사용자는 로그인을 하고 싶은 게
// 아니라 앨범을 잃고 싶지 않은 것이다. 얻는 것을 말한다.
test("저장 안내 문구는 §1 그대로 — 로그인·가입을 요구하지 않는다", () => {
  assert.match(view, /이 앨범을 내 앨범으로 저장할까요\?/);
  assert.match(view, /저장해 두면 다음에도 이 앨범을 찾을 수 있어요\./);
  assert.match(view, /className="btn btn--primary" onClick=\{\(\) => onGuestSave\?\.\(\)\}>저장하기</);
  const card = view.slice(view.indexOf("const guestSaveCard"), view.indexOf("const whoamiBand"));
  for (const forbidden of ["로그인하세요", "가입하세요", "회원가입", "곧", "준비 중"]) {
    assert.equal(card.includes(forbidden), false, `쓰지 않는 표현: ${forbidden}`);
  }
});

test("앨범이 막 만들어진 직후 제목 위에 크게 보인다", () => {
  // preHeader = 제목보다 위. 참여자 띠와 같은 자리이며 둘은 동시에 성립하지 않는다.
  assert.match(view, /preHeader=\{whoamiBand \?\? guestSaveCard\}/);
  assert.match(view, /guestOwner && !guestSaveHidden/);
});

test("닫아도 사라지지 않는다 — 하단 CTA 로 다시 찾을 수 있다 (★ 잃으면 앨범을 잃는다)", () => {
  // 큰 안내는 닫히지만, 액션 바의 저장 진입점은 guestOwner 인 한 항상 남는다.
  assert.match(view, /const albumActions = guestOwner \? \(/);
  assert.match(view, /내 앨범으로 저장하기/);
  // 닫기는 이 화면 세션에만 기억한다(계정에 저장하지 않는다).
  assert.match(view, /sessionStorage\.setItem\(`momento-guest-save-dismissed:\$\{albumId\}`/);
});

test("저장하지 않아도 앨범을 계속 볼 수 있다 — 막지 않는다", () => {
  const card = view.slice(view.indexOf("const guestSaveCard"), view.indexOf("const whoamiBand"));
  // 딤·모달·차단이 아니라 본문 위 카드다.
  assert.doesNotMatch(card, /album-sheet-dim|role="dialog"|aria-modal/);
  assert.match(card, /className="album-guest-save"/);
});
