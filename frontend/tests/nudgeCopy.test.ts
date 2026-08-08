import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * 유도 문구 두 가지 (SCREEN_SPEC §9).
 *
 * ① 아직 아무 말도 적지 않은 사진이 N장 있어요. / 한 줄만 적어도 앨범이 훨씬 풍성해져요.
 *    ★ 이 안내는 **캡션**에 대한 것이다. `한마디`(§7 의 다른 계층)도 `캡션`(외래어)도
 *      문구에 쓰지 않는다.
 *    ★ **내가 올린 사진 중 빈 것만** 센다. 캡션은 자기가 올린 사진에만 쓰므로,
 *      남의 사진까지 세면 채울 수 없는 것을 채우라고 하는 셈이다.
 * ② 아직 아무것도 안 한 사람에게만: 마음에 드는 사진에 한마디만 남겨도 좋아요.
 *
 * 두 안내 모두 경고색을 쓰지 않는다 — 잘못한 것이 아니라 더 좋아질 수 있다는 말이다.
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const view = read("components/AlbumView.tsx");

function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

const notice = view.slice(view.indexOf("const myEmptyCaptionPhotos"), view.indexOf("const guestSaveCard"));

test("① 문구가 §9 그대로다", () => {
  assert.match(notice, /아직 아무 말도 적지 않은 사진이 \{myEmptyCaptionPhotos\.length\}장 있어요\./);
  assert.match(notice, /한 줄만 적어도 앨범이 훨씬 풍성해져요\./);
  assert.match(notice, />채우러 가기</);
  // 옛 문구가 남아 있지 않다.
  assert.doesNotMatch(view, /장에 아직 한마디가 없어요/);
});

test("① `한마디`·`캡션` 이라는 말을 안내 문구에 쓰지 않는다", () => {
  // 화면에 그려지는 부분(따옴표·태그 안 문자열)만 본다 — 변수 이름은 그대로 둔다.
  for (const match of notice.matchAll(/>([^<>{}]*[가-힣][^<>{}]*)</g)) {
    const text = match[1];
    assert.equal(text.includes("한마디"), false, `안내 문구: ${text}`);
    assert.equal(text.includes("캡션"), false, `안내 문구: ${text}`);
  }
});

test("★ ① 은 내가 올린 사진만 센다", () => {
  // 판정은 백엔드가 내려준 is_mine 이다(프런트가 추측하지 않는다).
  assert.match(notice, /photos\.filter\(\(photo\) => photo\.is_mine && !\(photo\.caption \|\| ""\)\.trim\(\)\)/);
  // 앨범 전체를 세던 옛 식이 남아 있지 않다.
  assert.doesNotMatch(view, /photos\.filter\(\(photo\) => !\(photo\.caption/);
  // is_mine 은 can_edit_caption 과 다른 값이다 — 주최자는 남의 캡션도 고칠 수 있다.
  const backend = readFileSync(new URL("../../backend/app/api/album.py", import.meta.url), "utf8");
  const state = backend.slice(backend.indexOf("def _caption_edit_state"), backend.indexOf("def _album_photo_response"));
  assert.match(state, /if mine:\s*\n\s*return True, None, True/);
  assert.match(state, /return viewer_is_owner, author, False/);
});

test("빈 사진이 없으면 안내가 없다", () => {
  assert.match(notice, /myEmptyCaptionPhotos\.length > 0 && !guestOwner && requestedEdition === null \?/);
});

test("`채우러 가기` 는 내가 올린 빈 사진 중 첫 장으로 간다", () => {
  assert.match(notice, /const target = myEmptyCaptionPhotos\[0\]/);
  assert.match(notice, /\[data-photo-id="\$\{target\.id\}"\][\s\S]{0,60}scrollIntoView/);
  // 그 자리에서 바로 적게 한다(다른 화면으로 보내지 않는다).
  assert.match(notice, /handleStartPhotoCommentEdit\(target\.id, ""\)/);
});

test("② 아무것도 안 한 사람에게만 보이고, 하나라도 남기면 사라진다", () => {
  const mine = view.slice(view.indexOf("const mineCard"), view.indexOf("const headerExtras"));
  assert.match(mine, /participation\.photo_count === 0 && participation\.memory_count === 0 \?/);
  assert.match(mine, /마음에 드는 사진에 한마디만 남겨도 좋아요\./);
  // `남겨주세요` 가 아니다 — 부탁이 아니라 권유다(주석의 설명은 빼고 코드만 본다).
  const code = mine.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  assert.doesNotMatch(code, /남겨주세요|남겨 주세요/);
});

test("두 안내 모두 경고색을 쓰지 않는다", () => {
  const css = read("components/AlbumScreen.css");
  for (const selector of [".album-caption-notice__dot", ".album-caption-notice__sub", ".album-mine__nudge"]) {
    const rule = css.slice(css.indexOf(`${selector} {`), css.indexOf("}", css.indexOf(`${selector} {`)));
    assert.doesNotMatch(rule, /--c-warning|--c-danger/, `${selector} 에 경고색`);
  }
});

test("주최자가 참여자에게 부탁하는 기능을 만들지 않았다", () => {
  // 공유 시트에 항목을 추가하지 않는다. 카카오 카드도 만들지 않는다.
  for (const file of sourceFiles()) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /한마디를 (써|적어)\s*달라|한마디 요청|부탁하기/, file.replace(SRC, ""));
  }
  assert.doesNotMatch(read("components/AlbumMoreSheet.tsx"), /요청|부탁/);
});

// E-1 (§4·§7) — 성격이 다른 두 버튼은 이름이 달라야 한다.
//   사진 옆              → `이 사진에 한마디`
//   `우리가 남긴 말` 구역 → `여기에 남기기`
//   하단 네비 가운데      → `한마디 쓰기` (사진에 한마디 다는 흐름을 연다)
test("한마디 버튼 세 자리의 이름이 서로 다르다", () => {
  const workspace = read("components/ContributeWorkspace.tsx");
  const guestbook = read("components/AlbumGuestbook.tsx");
  const nav = read("components/AlbumBottomNavigation.tsx");
  assert.match(workspace, /이 사진에 한마디/);
  assert.match(guestbook, /"여기에 남기기"/);
  assert.match(nav, /<span>한마디 쓰기<\/span>/);
  // 세 자리 어디에도 옛 이름(`한마디 남기기`)이 남지 않는다 — 성격이 다른데 같은 이름이었다.
  for (const source of [workspace, guestbook, nav]) {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").split("\n")
      .filter((line) => !line.trim().startsWith("//")).join("\n");
    assert.doesNotMatch(code, /한마디 남기기/);
  }
});
