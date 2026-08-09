import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

/**
 * 회원 탈퇴 확인 시트 — **무엇이 사라지는지 숫자로 보여준다** (K-17 · SCREEN_SPEC §5 27차).
 *
 * ★ 되돌릴 수 없는 일이다. 무엇이 사라지는지 모르는 채로 누르게 하지 않는다.
 *
 * 정한 것(PO 2026-08-10):
 *   내가 만든 앨범            → 앨범 · 사진 · 파일까지 전부 지운다
 *   남의 앨범에 남긴 사진·한 줄 → 그대로 두고 **이름만** 지운다
 *
 * ★ 남의 앨범을 깨뜨리지 않는다. 그 앨범은 다른 사람의 추억이고 그 사람은 잘못이 없다.
 * ★ 숨기지 않는다 — 두 갈래를 다 적는다.
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const app = readFileSync(path.join(SRC, "App.tsx"), "utf8");
const api = readFileSync(path.join(SRC, "lib/api.ts"), "utf8");

/** 탈퇴 시트만 잘라 본다 — 다른 화면의 문구가 이 검사를 통과시키면 안 된다. */
const sheet = (() => {
  const at = app.indexOf('<SheetDialog open={withdrawOpen}');
  assert.notEqual(at, -1, "탈퇴 시트를 못 찾았다");
  return app.slice(at, app.indexOf("</SheetDialog>", at));
})();

test("★ 제목과 두 갈래 문구가 §5 그대로다", () => {
  assert.match(sheet, /정말 탈퇴하시겠어요\?/);
  assert.match(sheet, /내가 만든 앨범 \{withdrawSummary\.owned_albums\}개 · 사진 \{withdrawSummary\.owned_photos\}장/);
  assert.match(sheet, /탈퇴하면 앨범과 사진이 모두 지워지고 되돌릴 수 없어요\./);
  assert.match(sheet, /함께 만든 분들도 더 이상 볼 수 없어요\./);
  assert.match(sheet, /다른 분의 앨범에 남긴 사진 \{withdrawSummary\.other_album_photos\}장은/);
  assert.match(sheet, /그 앨범이 비어 보이지 않도록 이름만 지워져요\./);
});

test("★ `영구 복구 불가능` 같이 쓰지 않는다 (§10)", () => {
  // 주석은 사람에게 하는 설명이지 화면에 나가는 말이 아니다 — 빼고 본다
  // (그 주석에 "쓰지 않는다"며 그 말을 적어 두기 때문이다).
  const shown = sheet.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  for (const banned of ["영구", "복구 불가", "삭제됩니다", "경고"]) {
    assert.equal(shown.includes(banned), false, `겁주는 말이 남았다: ${banned}`);
  }
  assert.match(shown, /되돌릴 수 없어요/);
});

test("★ 해당 없는 줄은 안 보인다", () => {
  // 내가 만든 앨범이 없으면 그 문단이 통째로 없다.
  assert.match(sheet, /\{withdrawSummary && withdrawSummary\.owned_albums > 0 \? \(/);
  // 남의 앨범에 남긴 것이 없으면 그 문단이 없다.
  assert.match(sheet, /\{withdrawSummary && withdrawSummary\.other_album_photos > 0 \? \([\s\S]{0,400}\) : null\}/);
});

test("★ `그만두기` 가 왼쪽이고 `탈퇴하기` 가 오른쪽이다", () => {
  const actions = sheet.slice(sheet.indexOf('className="app__withdraw-actions"'));
  const cancelAt = actions.indexOf(">그만두기<");
  const confirmAt = actions.indexOf('"탈퇴하기"');
  assert.notEqual(cancelAt, -1, "그만두기 버튼이 없다");
  assert.notEqual(confirmAt, -1, "탈퇴하기 버튼이 없다");
  assert.ok(cancelAt < confirmAt, "되돌릴 수 없는 쪽이 먼저 온다 — 실수로 눌린다");
  // 그만두기는 그냥 닫는다. 되돌릴 수 없는 일을 하지 않는다.
  assert.match(actions, /onClick=\{\(\) => setWithdrawOpen\(false\)\}>그만두기</);
});

test("★ 한 번만 묻는다 — 두 번 묻거나 다시 입력받지 않는다", () => {
  assert.equal((sheet.match(/정말/g) || []).length, 1);
  for (const banned of ["<input", "비밀번호", "이메일을 입력", "다시 입력"]) {
    assert.equal(sheet.includes(banned), false, `한 번 더 묻는다: ${banned}`);
  }
  // window.confirm 을 쓰지 않는다(§5 — 카카오 웹뷰에서 막힌다).
  assert.equal(app.includes("window.confirm"), false);
});

test("★ 새 페이지를 만들지 않는다 — 이미 있는 시트를 쓴다 (§11)", () => {
  assert.match(sheet, /^<SheetDialog open=\{withdrawOpen\} labelledBy="withdraw-title"/);
  assert.match(sheet, /locked=\{withdrawing\}/);
});

// --- 숫자는 어디서 오는가 ---

test("★ 숫자는 서버가 센다 — 화면이 세지 않는다 (§10)", () => {
  // 열 때 물어본다. `000개` 같은 빈칸을 두지 않으려는 자리다.
  const open = app.slice(app.indexOf("const openWithdraw"), app.indexOf("const withdraw ="));
  assert.match(open, /void getWithdrawalSummary\(\)/);
  assert.match(open, /\.then\(setWithdrawSummary\)/);
  // 화면 안에서 세는 식이 없다.
  assert.equal(/withdrawSummary[^;]{0,80}(length|reduce|filter)/.test(app), false, "화면이 따로 센다");
});

test("★ 지울 때 그 숫자를 되돌려 보내지 않는다", () => {
  const fn = api.slice(api.indexOf("export async function deleteAccount"), api.indexOf("export async function", api.indexOf("export async function deleteAccount") + 10));
  assert.match(fn, /authenticatedFetch\("\/api\/auth\/account", \{ method: "DELETE" \}\)/);
  assert.equal(fn.includes("body"), false, "화면이 센 값을 함께 보낸다");
});

test("못 세어도 무엇이 사라지는지는 말한다 (§11)", () => {
  // 숫자를 못 받아도 시트가 비어 보이면 안 된다 — 갈래 없는 한 줄이 남는다.
  assert.match(sheet, /탈퇴하면 계정과 내가 만든 것이 모두 지워지고 되돌릴 수 없어요\./);
});
