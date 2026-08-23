import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CATEGORY_DEFAULT_SKIN, resolveAlbumSkin } from "../src/lib/albumSkin";
import { asksAppearanceBeforeCreate } from "../src/lib/uploadFormView";
import { ALBUM_CATEGORY_OPTIONS } from "../src/types";

/**
 * 앨범을 **만들기 전에** 모양을 한 번 고르게 한다 (2026-08-18 PO).
 *
 * > `앨범 만들기 전에 앨범 스킨 고르는 화면을 하나 띄워줘. 대부분 스킨 있는 것도
 * > 모르고 지나갈테니.`
 *
 * ★ 새로 만든 것이 거의 없다. `AlbumAppearancePicker` 는 이미 완성돼 있었고, 더보기
 *   시트 **안**에만 있어서 앨범을 다 만든 뒤에야 발견됐다. 부르는 자리만 하나 늘렸다.
 * ★ DOM 요소를 assert 에 넘기지 않는다(2026-08-15 규칙) — 불리언·문자열로 잰다.
 */

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const form = read("components/UploadForm.tsx");

test("★ 시트가 뜨면 추천 모양이 이미 골라져 있다 — 카테고리마다", () => {
  for (const option of ALBUM_CATEGORY_OPTIONS) {
    const chosen = resolveAlbumSkin({ category: option.value });
    assert.equal(chosen.skin, CATEGORY_DEFAULT_SKIN[option.value], `${option.value} 추천이 다르다`);
    // 종이는 추천이 없다 — 늘 흰 종이에서 시작한다.
    assert.equal(chosen.paper, "white", `${option.value} 종이 색이 다르다`);
  }
  // 화면이 추천을 따로 계산하지 않는다. 규칙은 lib/albumSkin 하나다.
  assert.match(form, /useState<\{ skin: AlbumSkin; paper: AlbumPaper \}>\(\(\) => resolveAlbumSkin\(\{ category \}\)\)/);
});

test("★ 아무것도 안 고르고 `이대로 만들기` 를 눌러도 그 값이 그대로 실려 간다", () => {
  // 고른 값은 `appearance` 하나이고, 만들 때 그것을 그대로 보낸다.
  assert.match(form, /formData\.append\("skin", appearance\.skin\)/);
  assert.match(form, /formData\.append\("paper", appearance\.paper\)/);
  // 초깃값이 곧 추천이므로(위 검사), 아무것도 안 골라도 추천이 실린다.
  assert.equal(resolveAlbumSkin({ category: "travel" }).skin, "magazine");
});

test("★ 시트는 한 번만 뜬다 — 실패해서 다시 눌러도 또 묻지 않는다", () => {
  assert.equal(asksAppearanceBeforeCreate(false), true, "처음에는 묻는다");
  assert.equal(asksAppearanceBeforeCreate(true), false, "한 번 물었으면 다시 묻지 않는다");
  // `앨범 만들기` 는 이 판정을 거쳐 간다 — 곧장 만들지 않는다.
  assert.match(form, /onClick=\{requestCreate\}/);
  assert.match(form, /if \(asksAppearanceBeforeCreate\(appearanceAsked\)\) \{\s*setShowsAppearanceSheet\(true\);\s*return;/);
});

test("★ 시트를 닫으면 만들기가 진행되지 않는다 — 뒤로 가는 길을 막지 않는다", () => {
  // 닫기는 시트만 내린다. createAlbum 을 부르지 않고, 물어본 것으로도 치지 않는다
  // (그래서 다시 누르면 또 뜬다).
  assert.match(form, /const closeAppearanceSheet = \(\) => setShowsAppearanceSheet\(false\);/);
  const close = form.slice(form.indexOf("const closeAppearanceSheet"), form.indexOf("const confirmAppearance"));
  assert.equal(close.includes("createAlbum"), false, "닫기가 만들기를 부른다");
  assert.equal(close.includes("setAppearanceAsked"), false, "닫기를 물어본 것으로 친다");
  // 누른 쪽만 만든다.
  assert.match(form, /const confirmAppearance = \(\) => \{\s*setAppearanceAsked\(true\);\s*setShowsAppearanceSheet\(false\);\s*void createAlbum\(\);/);
});

test("★ 새 컴포넌트·새 껍데기를 만들지 않았다 — 있는 것을 부르기만 한다", () => {
  // 몸은 이미 있던 고르는 자리 그대로다(고치지 않았다).
  assert.match(form, /import AlbumAppearancePicker from "\.\/AlbumAppearancePicker";/);
  // 껍데기도 다른 시트와 같은 것이다(§7 — 새 페이지를 만들지 않는다).
  assert.match(form, /className="album-sheet-dim"/);
  assert.match(form, /className="album-inline-action"/);
  assert.equal(form.includes("어떤 모양으로 만들까요?"), true);
  assert.equal(form.includes("이대로 만들기"), true);
  // `저장` 버튼을 새로 두지 않는다 — 고르면 바로 반영되는 지금 동작 그대로다.
  const sheet = form.slice(form.indexOf("showsAppearanceSheet ? ("));
  assert.equal(/>\s*저장\s*</.test(sheet), false, "저장 버튼이 생겼다");
  // 화면에 `스킨` 이라 쓰지 않는다(§8).
  assert.equal(form.includes("스킨"), false);
});

/**
 * 실측에서 나온 것 — 1280×720 에서 `이대로 만들기` 가 시트 **밖**(아래로 25px)에 있었다.
 * 고를 것이 아홉 개라 몸이 스크롤되는데 버튼이 그 몸 안에 있었기 때문이다.
 * 머리(닫기)와 같은 이유로 스크롤 밖에 붙인다 — 다 고르고도 어디를 눌러야 할지
 * 안 보이면 안 된다.
 */
test("★ `이대로 만들기` 는 스크롤 밖에 붙는다 — 접힌 아래로 내려가지 않는다", () => {
  const sheet = form.slice(form.indexOf("showsAppearanceSheet ? ("), form.indexOf("{progressStep !== null"));
  const bodyStart = sheet.indexOf('album-inline-action__body');
  const footStart = sheet.indexOf('album-inline-action__footer');
  assert.equal(footStart !== -1, true, "붙박이 바닥이 없다");
  assert.equal(footStart > bodyStart, true, "바닥이 몸보다 먼저 온다");
  // 버튼은 몸이 아니라 바닥 안이다.
  assert.equal(sheet.indexOf("이대로 만들기") > footStart, true, "버튼이 스크롤되는 몸 안에 있다");

  // 껍데기 규칙도 같이 본다 — 바닥은 줄어들지도 스크롤되지도 않는다.
  const css = read("components/AlbumScreen.css");
  const rule = css.slice(css.indexOf(".album-inline-action__footer"));
  assert.match(rule.slice(0, rule.indexOf("}")), /flex: 0 0 auto/);
});
