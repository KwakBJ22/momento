import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

// SCREEN_SPEC §7 — 사진을 눌러 캡션에 닿는 경로가 있어야 한다. 없으면 §7 전체가
// 화면에서 작동하지 않는다(참여자는 권한이 있어도 쓸 길이 없었다).
test("캡션 권한은 사진마다 백엔드 값으로 판정한다 — 역할로 추측하지 않는다", () => {
  const view = read("components/AlbumView.tsx");
  assert.match(view, /canEditPhoto: \(photoId: string\) => photoById\.get\(photoId\)\?\.can_edit_caption === true/);
  // 예전처럼 "주최자면 전부 편집" 로 뭉뚱그리지 않는다(주석 처리된 legacy shell 제외 —
  // 그 블록은 렌더링되지 않는다).
  const live = view.slice(0, view.indexOf("/* Legacy shell intentionally disabled"));
  assert.doesNotMatch(live, /photoCommentEdit=\{canEdit \?/);
  const frame = read("album-engine/components/PhotoWithMemories.tsx");
  assert.match(frame, /edit\?\.canEditPhoto\(photo\.id\)/);
  assert.doesNotMatch(frame, /edit\?\.canEdit\b/);
});

test("참여자에게도 캡션 진입점이 열린다 — 새 페이지를 만들지 않았다", () => {
  const view = read("components/AlbumView.tsx");
  // photoCommentEdit 를 항상 넘긴다(사진별 플래그가 판정한다). null 로 통째로 끄지 않는다.
  assert.match(view, /photoCommentEdit=\{\{ \.\.\.captionEdit,/);
  // 캡션은 기존 사진 프레임 안에서 인라인으로 연다(라우트 추가 없음).
  assert.doesNotMatch(view, /\/caption|captionPage/);
});

// §7 — 주최자가 남의 캡션을 열 때 한 번 묻는다. 경고색·window.confirm 을 쓰지 않는다.
test("남의 사진 캡션은 확인 한 단계를 거친다", () => {
  const lines = read("album-engine/components/PhotoMemoryLines.tsx");
  assert.match(lines, /님이 쓴 글이에요\. 고칠까요\?/);
  assert.match(lines, /confirmEdit\?\.\(photoId\)/);
  assert.match(lines, /cancelConfirm\?\.\(\)/);
  assert.doesNotMatch(lines, /window\.confirm/);
  // 경고색을 쓰지 않는다 — 잘못을 지적하는 말이 아니다.
  const css = read("album-engine/components/PhotoMemoryLines.css");
  const block = css.slice(css.indexOf(".photo-memory-lines__confirm-text"));
  assert.match(block, /var\(--c-text-soft\)/);
  assert.doesNotMatch(block, /--c-danger|--c-warning|red/);
});

test("내 사진에는 확인이 뜨지 않는다", () => {
  const view = read("components/AlbumView.tsx");
  const request = view.slice(view.indexOf("requestEdit: (photoId: string"), view.indexOf("confirmingPhotoId:"));
  // 이름이 있을 때(= 남의 사진)만 확인 단계로 간다. 내 사진은 바로 편집기가 열린다.
  assert.match(request, /if \(photoById\.get\(photoId\)\?\.caption_author_name\)/);
  assert.match(request, /handleStartPhotoCommentEdit\(photoId, text\)/);
});
