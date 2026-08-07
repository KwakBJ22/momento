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
test("소스에 window.confirm / alert / prompt 가 없다 (주석 제외)", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    const code = readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n");
    if (/window\.confirm\s*\(/.test(code)) offenders.push(`${file}: confirm`);
    if (/window\.alert\s*\(|(?<![\w.])alert\s*\(/.test(code)) offenders.push(`${file}: alert`);
    // prompt 도 같은 이유로 금지한다 — 디자인이 없고 웹뷰에서 막힐 수 있다(§11).
    if (/window\.prompt\s*\(|(?<![\w.])prompt\s*\(/.test(code)) offenders.push(`${file}: prompt`);
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

// 한마디 수정은 대화상자가 아니라 **그 자리에서 고치는 인라인 편집**이다.
test("한마디 수정은 글이 있던 자리에서 열린다 — 새 편집기를 만들지 않았다", () => {
  const workspace = read("components/ContributeWorkspace.tsx");
  // 주석은 제외한다("prompt 를 쓰지 않는다"는 설명은 화면 동작이 아니다).
  const code = workspace.split(new RegExp("\\r?\\n")).filter((line) => {
    const trimmed = line.trim();
    return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
  }).join(String.fromCharCode(10));
  assert.doesNotMatch(code, /window\.prompt\s*\(/);
  // 새로 남길 때와 같은 편집기(draftText·draftInputRef)를 그대로 쓴다.
  assert.match(workspace, /const \[editingMemoryId, setEditingMemoryId\] = useState<string \| null>\(null\)/);
  assert.match(workspace, /setDraftText\(memory\.comment \|\| ""\)/);
  assert.match(workspace, /editingMemoryId === memory\.id \? \(/);
  assert.match(workspace, /className="contribute__draft">[\s\S]{0,200}aria-label="한마디 수정"/);
  // 저장·취소가 그 자리에 함께 있다.
  assert.match(workspace, /onClick=\{\(\) => void saveEditedMemory\(memory\)\}/);
  assert.match(workspace, /onClick=\{cancelEditMemory\}/);
});

// B-7 (§11) — 로그인·회원 탈퇴 모달을 시트 계열로. 딤·Esc·스크롤 잠금이 제각각이라
// 카카오 웹뷰에서 갇히는 사고가 났던 유형이다.
test("두 모달이 공용 딤을 쓴다 — 딤을 누르면 닫힌다", () => {
  const dialog = read("components/SheetDialog.tsx");
  // 딤은 대화상자 컴포넌트 한 곳에만 있다(둘이 각자 만들지 않는다).
  assert.match(dialog, /className="album-sheet-dim" aria-hidden="true" onClick=\{close\}/);
  // 처리 중에는 닫히지 않는다 — 탈퇴가 이 상태를 쓴다.
  assert.match(dialog, /const close = \(\) => \{ if \(!locked\) onClose\(\); \}/);
  assert.match(read("App.tsx"), /locked=\{withdrawing\}/);
  // 딤 위의 가운데 정렬 층은 이벤트를 받지 않아 딤 클릭을 막지 않는다.
  const css = read("App.css");
  const start = css.indexOf(".sheet-dialog {");
  assert.match(css.slice(start, css.indexOf("}", start)), /pointer-events: none/);
});

test("두 모달이 같은 잠금·Esc·포커스 복원 동작을 쓴다", () => {
  const dialog = read("components/SheetDialog.tsx");
  const hook = read("lib/useSheetDialog.ts");
  // 동작이 실제로 걸리는지는 tests/sheetDialogBehavior.test.ts 가 렌더해서 본다.
  // 여기서는 "한 벌만 있다"는 사실만 잠근다 — 구현 위치·클래스는 잠그지 않는다.
  assert.match(dialog, /useSheetDialog\(open, dialogRef, close, returnFocusRef\)/);
  for (const behavior of [/document\.body\.style\.overflow = "hidden"/, /event\.key === "Escape"/, /returnFocusRef\?\.current\?\.focus\(\)/]) {
    assert.match(hook, behavior);
  }
  assert.doesNotMatch(read("App.tsx"), /document\.body\.style\.overflow/);
});
