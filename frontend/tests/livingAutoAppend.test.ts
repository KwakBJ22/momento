import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

/**
 * 새로 더해진 것은 **자동으로** 붙는다 — 고르게 하지 않는다 (PO 결정 2026-08-13).
 *
 * 예전 화면은 `마지막 페이지에 추가하기` 를 누르라고 시키고, 라디오 2개 + 전체 선택 +
 * 체크박스 목록 시트를 띄웠다. 그런데 그 기본값(`append_page`)은 **앨범을 다시 만들지
 * 않는다** — base_document 를 그대로 두고 페이지 한 장을 더할 뿐이다.
 * 고를 이유가 없는 것을 고르라고 시키고 있었다.
 *
 * 남은 것은 하나다: 주최자가 원할 때 누르는 `앨범 다시 구성하기`(edition).
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const read = (p: string) => readFileSync(path.join(SRC, p), "utf8");

/** 주석을 걷어내고 코드만 본다 — 이 규칙을 설명하는 주석이 스스로 걸리지 않게. */
const codeOnly = (source: string) =>
  source.split(/\r?\n/).filter((line) => {
    const t = line.trim();
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("{/*");
  }).join("\n");

test("★ 고르는 시트가 사라졌다 — LivingPicker 가 없다", () => {
  const panel = read("components/CollaborationPanel.tsx");
  assert.equal(panel.includes("LivingPicker"), false, "고르는 시트가 남아 있다");
  const code = codeOnly(panel);
  for (const gone of ["전체 선택", "collab-panel__pending-list", "collab-panel__living-modes", 'name="living-mode"']) {
    assert.equal(code.includes(gone), false, `시트 조각이 남았다: ${gone}`);
  }
});

test("★ `마지막 페이지에 추가하기` 버튼이 사라졌다 — 누를 것이 없다", () => {
  const code = codeOnly(read("components/CollaborationPanel.tsx"));
  assert.equal(code.includes("마지막 페이지에 추가하기"), false);
  assert.equal(code.includes("새로운 에디션 만들기"), false, "이 자리에는 없다 — 더보기 시트로 옮겼다");
});

test("★ `새로 더해진 것 N개` 알림이 사라졌다 — 이미 반영됐으므로 셀 이유가 없다", () => {
  const code = codeOnly(read("components/CollaborationPanel.tsx"));
  assert.equal(code.includes("collab-panel__new-summary"), false);
  assert.equal(code.includes("new_photo_count"), false, "세는 값을 아직 읽고 있다");
  // 참여 패널에도 같은 성격의 목록이 한 벌 더 있었다.
  const participation = codeOnly(read("components/AlbumParticipationPanel.tsx"));
  assert.equal(participation.includes("새로 더해진 사진과 한마디"), false, "참여 패널에 목록이 남았다");
  assert.equal(participation.includes("checkbox"), false, "참여 패널에 체크박스가 남았다");
  assert.equal(participation.includes("applyContributions"), false, "참여 패널이 아직 반영을 부른다");
});

test("★ `앨범 다시 구성하기` 는 더보기 시트에 한 줄로, 주최자에게만", () => {
  const sheet = read("components/AlbumMoreSheet.tsx");
  assert.match(sheet, /canEdit && onRebuildEdition \?/, "주최자 조건이 없다");
  assert.match(sheet, /앨범 다시 구성하기/);
  assert.match(sheet, /className="album-more-sheet__row"/);
});

test("★ 새 API 를 만들지 않았다 — 기존 apply-contributions(edition) 를 그대로 부른다", () => {
  const view = read("components/AlbumView.tsx");
  assert.match(view, /await applyContributions\(/);
  assert.match(view, /"edition",/);
  assert.match(view, /getPendingContributions\(albumId\)/);
  // lib/api 에 새 함수가 생기지 않았다.
  const api = read("lib/api.ts");
  assert.equal((api.match(/apply-contributions/g) || []).length, 1, "반영을 부르는 자리가 늘었다");
  assert.equal(api.includes("rebuild-edition"), false, "새 주소가 생겼다");
});

test("★ 다시 구성하다 실패해도 화면이 조용하지 않다 (§11)", () => {
  const view = read("components/AlbumView.tsx");
  const fn = view.slice(view.indexOf("const rebuildEdition"), view.indexOf("const handlePdf"));
  assert.match(fn, /userFacingError\(cause,/, "서버 문구를 그대로 내거나 조용히 끝난다");
  assert.match(fn, /finally \{\s*\n\s*setIsRebuilding\(false\);/, "실패하면 버튼이 잠긴 채 남는다");
});

test("★ 앨범 끝 안내는 웹·공유에만, 마지막 페이지에만", () => {
  const renderer = read("album-engine/AlbumRenderer.tsx");
  assert.match(renderer, /앨범을 만든 분이 나중에 한 번에 정리해서 앨범을 다시 만들어요\./);
  // 인쇄물에는 넣지 않는다 — 종이에는 `나중에` 가 없다(§6 · 앨범 구조).
  assert.match(renderer, /mode === "screen" && index === livingAppendPages\.length - 1/);
});

test("★ `새로 더해진` 자리는 사진도 그린다 — 글만 뜨면 사진이 어디에도 안 보인다", () => {
  // OPEN_ITEMS §2-1. 서버가 그 페이지에 사진을 실어 보내도, 화면이 memories 만
  // 그리면 사라진 채로 남는다. 화면(웹)과 인쇄 두 갈래 모두 그려야 한다.
  const renderer = read("album-engine/AlbumRenderer.tsx");
  const drawn = renderer.match(/page\.photos\.length \? \(/g) || [];
  assert.equal(drawn.length, 2, `사진을 그리는 갈래가 ${drawn.length} 개다 — 웹·인쇄 둘이어야 한다`);
  assert.equal((renderer.match(/page\.photos\.map\(/g) || []).length, 2);
});

test("주최자 화면과 참여자 화면이 같은 것을 본다 — 붙는 자리가 하나다", () => {
  // 둘 다 같은 AlbumRenderer 의 livingAppendPages 를 그린다(§9 · 같은 렌더러).
  for (const file of ["components/AlbumView.tsx", "components/AlbumResult.tsx"]) {
    assert.match(read(file), /livingAppendPages=\{/, `${file} 가 append 페이지를 넘기지 않는다`);
  }
  assert.match(read("components/PublicShareView.tsx"), /livingAppendPages|living_append_pages/);
});
