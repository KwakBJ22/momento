import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  GUESTBOOK_MESSAGE_MAX,
  GUESTBOOK_NAME_MAX,
  getGuestbookSessionKey,
  readMyGuestbookIds,
} from "../src/lib/shareGuestbook";

test("guestbook limits match the design (name 40, message 200)", () => {
  assert.equal(GUESTBOOK_NAME_MAX, 40);
  assert.equal(GUESTBOOK_MESSAGE_MAX, 200);
});

test("guestbook session key is long enough for the server (>=16)", () => {
  assert.ok(getGuestbookSessionKey().length >= 16);
});

test("own-entry set is empty when storage is unavailable", () => {
  assert.equal(readMyGuestbookIds("album-1").size, 0);
});

test("방명록은 공용 컴포넌트로, 공유 화면에서는 반응 뒤에 온다", () => {
  const share = readFileSync(new URL("../src/components/PublicShareView.tsx", import.meta.url), "utf8");
  // 공유 화면은 공용 컴포넌트를 렌더링한다(구현 중복 없음).
  assert.match(share, /<AlbumGuestbook /);
  const reactionsIdx = share.indexOf('public-share__reactions"');
  const guestbookIdx = share.indexOf("<AlbumGuestbook ");
  assert.ok(reactionsIdx >= 0 && guestbookIdx > reactionsIdx, "guestbook must come after reactions");

  const component = readFileSync(new URL("../src/components/AlbumGuestbook.tsx", import.meta.url), "utf8");
  // 이름 입력·본인 글 삭제 컨트롤은 컴포넌트가 그대로 들고 있다.
  assert.match(component, /public-share__guestbook-name[\s\S]*?value=\{authorName\}/);
  assert.match(component, /mine\.has\(entry\.id\)/);
  // ③ 방명록은 앨범 상세에도 붙는다 — 본문(AlbumRenderer) 밖 별도 구역.
  const view = readFileSync(new URL("../src/components/AlbumView.tsx", import.meta.url), "utf8");
  assert.match(view, /<AlbumGuestbook token=\{guestbookToken\}/);
  // ★ J-7 로 뒤집힌 항목 — 하단 네비 `한마디 쓰기` 는 이 구역을 열지 않는다.
  // §4: 그것이 여는 것은 **사진에 다는 한마디**다. `우리가 남긴 말` 은 본문 맨 아래에서
  // 스크롤로 만난다 — 네비 칸을 쓰지 않는다.
  assert.match(view, /onAddMemory: \(\) => void openContribution\("memory"\)/);
  assert.equal(view.includes("guestbookRef"), false, "네비가 다시 이 구역을 연다");
});

test("guestbook and reactions live outside AlbumRenderer, so neither appears in the PDF", () => {
  const renderer = readFileSync(new URL("../src/album-engine/AlbumRenderer.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(renderer, /guestbook/i);
  assert.doesNotMatch(renderer, /reaction/i);
});
