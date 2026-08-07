import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

// SCREEN_SPEC §11 — window.confirm·alert 은 카카오 웹뷰에서 막힐 수 있다. 막히면
// 삭제·제거를 아예 못 하고, "한 번 더 물어봐요"라는 화면의 말이 거짓이 된다.
test("소스에 window.confirm / alert 이 없다 (주석 제외)", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    const code = readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n");
    if (/window\.confirm\s*\(/.test(code)) offenders.push(`${file}: confirm`);
    if (/window\.alert\s*\(|(?<![\w.])alert\s*\(/.test(code)) offenders.push(`${file}: alert`);
  }
  assert.deepEqual(offenders, []);
});

test("여섯 곳이 모두 공용 확인 시트를 쓴다 — 새 컴포넌트를 여섯 벌 만들지 않았다", () => {
  const users = [
    "components/AlbumView.tsx",            // 앨범 지우기(되돌릴 수 없음 — 먼저 바꿨다)
    "components/MyAlbums.tsx",             // 목록에서 앨범 지우기
    "components/ContributeWorkspace.tsx",  // 기억 지우기
    "components/AlbumMembersPanel.tsx",    // 참여자 내보내기
    "components/FamilyManagement.tsx",     // 가족 구성원 내보내기
    "components/admin/AdminConsole.tsx",   // 운영자 앨범 삭제
  ];
  for (const file of users) {
    assert.match(read(file), /import ConfirmSheet from "\.\.?\/(\.\.\/)?ConfirmSheet"/, `${file}: 공용 시트 import`);
    assert.match(read(file), /<ConfirmSheet\b/, `${file}: 시트 렌더링`);
  }
});

test("확인 시트는 기존 시트 틀을 쓰고, 되돌릴 수 없는 것은 빨간 글자만", () => {
  const sheet = read("components/ConfirmSheet.tsx");
  // 새 화면·새 틀을 만들지 않는다 — 이미 쓰는 album-inline-action + 딤.
  assert.match(sheet, /className="album-inline-action album-confirm-sheet"/);
  assert.match(sheet, /className="album-sheet-dim"/);
  // 실행 버튼 라벨은 무엇이 일어나는지 그대로 적는다(호출자가 넘긴다).
  assert.match(sheet, /\{busy \? "처리 중\.\.\." : confirmLabel\}/);
  const css = read("components/AlbumScreen.css");
  const danger = css.slice(css.indexOf(".album-confirm-sheet__confirm--danger"));
  assert.match(danger.split("}")[0], /color: var\(--c-danger\)/); // 글자색만
  assert.doesNotMatch(danger.split("}")[0], /background/);        // 배경을 채우지 않는다(§5)
});
