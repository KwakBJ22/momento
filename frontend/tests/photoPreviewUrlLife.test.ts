import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

/**
 * 🔴 사진 고르기 화면에서 **앞쪽 미리보기가 깨진다** (K-10 · SCREEN_SPEC §8).
 *
 * 실기기(2026-08-09, 노트20 · 카카오톡 웹뷰, 3회 재현): 3장을 고르면 1번(때로는
 * 2번까지) 미리보기가 빈 분홍 박스가 되고 깨진 그림 아이콘과 `선택한 사진 1` 이라는
 * **개발용 대체 문구**가 보였다. 3번은 정상. 그대로 만든 앨범에는 세 장 다 멀쩡했다.
 * 즉 **파일은 멀쩡하고 미리보기 주소만 죽는다.**
 *
 * ★ 처음 짚은 원인(`revokeObjectURL` 이 아직 쓰이는 주소를 거둔다)은 **코드에 없었다.**
 *   UploadForm 은 주소를 사진마다 한 번 만들고, 거두는 자리는 두 곳뿐이다 —
 *   그 사진을 목록에서 뺄 때(removePhoto)와 화면을 떠날 때(unmount). 목록이 바뀔 때
 *   전부 거두는 자리는 없다. 그래서 **그 규칙을 여기서 잠근다**(다시 생기지 않게).
 *
 * 그리고 무엇이 주소를 죽였든 화면이 할 일을 고쳤다:
 *   · 주소를 만든 덩어리를 함께 들고 있다가 깨지면 **한 번만** 다시 만든다
 *   · 그래도 안 뜨면 **회색 자리**를 둔다. 개발용 문구가 화면에 나오지 않는다(§8)
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const form = readFileSync(path.join(SRC, "components/UploadForm.tsx"), "utf8");
const list = readFileSync(path.join(SRC, "components/PhotoCommentList.tsx"), "utf8");
const types = readFileSync(path.join(SRC, "types.ts"), "utf8");

// --- 주소의 수명 ---

test("★ 주소를 거두는 자리는 셋뿐이다 — 목록이 바뀔 때 전부 거두지 않는다", () => {
  const revokes = [...form.matchAll(/URL\.revokeObjectURL\([^)]*\)/g)];
  assert.equal(revokes.length, 3, "거두는 자리가 늘었다 — 어디서 거두는지 확인해야 한다");
  // ① 화면을 떠날 때 (그때까지 남은 것 전부)
  assert.match(form, /if \(!previewsTransferredRef\.current\) \{\s*\n\s*for \(const photo of photosRef\.current\) URL\.revokeObjectURL\(photo\.previewUrl\);/);
  // ② 그 사진을 목록에서 뺄 때 — **찾은 그 한 장만** 거둔다
  const remove = form.slice(form.indexOf("const removePhoto ="), form.indexOf("const updatePhotoComment"));
  assert.match(remove, /const photo = previous\.find\(\(item\) => item\.id === id\);/);
  assert.match(remove, /if \(photo\) URL\.revokeObjectURL\(photo\.previewUrl\);/);
  // ③ 죽은 주소를 다시 만들 때 — 그 자리에서 옛 주소를 거둔다(새 주소로 바로 바뀐다)
  const repair = form.slice(form.indexOf("const repairPreview ="), form.indexOf("const updatePhotoComment"));
  assert.match(repair, /URL\.revokeObjectURL\(photo\.previewUrl\);/);
});

test("★ 주소는 사진 한 장에 하나다 — 다시 그릴 때 새로 만들지 않는다", () => {
  const creates = [...form.matchAll(/URL\.createObjectURL\(/g)];
  // 사진을 만들 때 한 번, 깨졌을 때 다시 한 번. 그 둘뿐이다.
  assert.equal(creates.length, 2);
  assert.match(form, /return \{ id: createId\(\), file, previewUrl: URL\.createObjectURL\(previewSource\), previewSource, story: "", capturedAt \};/);
  // 그리는 쪽(PhotoCommentList)은 주소를 만들지 않는다 — 들고 있는 것을 쓸 뿐이다.
  assert.equal(list.includes("createObjectURL"), false);
});

test("★ 주소를 만든 덩어리를 함께 들고 있는다", () => {
  // 파일을 다시 읽지 않고 되살리려면 이것이 있어야 한다.
  assert.match(types, /previewSource: Blob;/);
  assert.match(types, /previewRetried\?: boolean;/);
});

test("★ 다시 만드는 것은 **한 번뿐**이다 — 끝없이 돌지 않는다", () => {
  const repair = form.slice(form.indexOf("const repairPreview ="), form.indexOf("const updatePhotoComment"));
  // 이미 한 번 만들었으면 그대로 둔다.
  assert.match(repair, /if \(photo\.id !== id \|\| photo\.previewRetried\) return photo;/);
  assert.match(repair, /previewRetried: true/);
  // 다른 사진은 건드리지 않는다.
  assert.match(repair, /previous\.map\(\(photo\) =>/);
});

// --- 화면에 보이는 것 (§8) ---

test("★ 개발용 대체 문구가 화면에 나오지 않는다", () => {
  // 실기기에서 보인 바로 그 문구다.
  assert.equal(/alt=\{`선택한 사진 \$\{index \+ 1\}`\}/.test(list), false);
  assert.match(list, /<img\s+src=\{photo\.previewUrl\}\s+alt=""/);
  // 삭제·대표사진 버튼이 이미 `사진 N` 이라고 말한다 — 같은 말이 두 번 가지 않는다.
  assert.match(list, /aria-label=\{`사진 \$\{index \+ 1\} 삭제`\}/);
});

test("★ 주소가 죽었으면 회색 자리를 둔다", () => {
  assert.match(list, /\{brokenIds\.includes\(photo\.id\) \? \(\s*\n\s*<div className="photo-comments__image photo-comments__image--blank" \/>/);
  // 첫 번째 실패는 다시 만들어 보고, 두 번째 실패에서만 회색 자리로 간다.
  assert.match(list, /if \(photo\.previewRetried\) setBrokenIds\(/);
  assert.match(list, /else onPreviewBroken\(photo\.id\);/);
  const css = readFileSync(path.join(SRC, "components/PhotoCommentList.css"), "utf8");
  assert.match(css, /\.photo-comments__image--blank \{[\s\S]*?background: var\(--c-border\);/);
});

test("고르기 화면 자체는 그대로다 — 주소 수명만 고쳤다", () => {
  // 업로드·압축·리사이즈 경로는 건드리지 않는다(정상 동작 중이다).
  const optimize = readFileSync(path.join(SRC, "lib/optimizeImageFile.ts"), "utf8");
  assert.match(optimize, /const MAX_EDGE = 2560;/);
  assert.match(optimize, /const PREVIEW_MAX_EDGE = 800;/);
  assert.match(optimize, /const PREVIEW_QUALITY = 0\.75;/);
  // 미리보기는 여전히 작은 800px 것을 먼저 쓰고, 없으면 올릴 파일로 떨어진다.
  assert.match(form, /const previewSource = previewBlob \?\? file;/);
});
