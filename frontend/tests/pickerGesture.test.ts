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

// SCREEN_SPEC §11 — 파일 선택창(.click())을 rAF·setTimeout·await 뒤에서 부르면
// 사용자 제스처 체인이 끊겨 iOS 사파리·카카오 웹뷰에서 조용히 실패한다.
// 데스크톱에서는 되므로 자동 테스트로 안 걸린다 → 소스 계약으로 막는다.
test("파일 선택창은 제스처와 같은 tick 에서만 연다", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    const text = readFileSync(file, "utf8");
    // rAF / setTimeout 콜백 안의 .click(), 그리고 await 뒤 같은 블록의 .click()
    if (/requestAnimationFrame\([^)]*=>[^;]*\.click\(\)/.test(text)) offenders.push(`${file}: rAF`);
    if (/setTimeout\([^)]*=>[^;]*\.click\(\)/.test(text)) offenders.push(`${file}: setTimeout`);
    if (/await [^\n]*\n[^\n]*\.click\(\)/.test(text)) offenders.push(`${file}: await`);
  }
  assert.deepEqual(offenders, []);
});

test("사진 추가는 label htmlFor 로 연다 — JS 호출 자체가 없다", () => {
  const workspace = read("components/ContributeWorkspace.tsx");
  // input 은 화면에 하나, 탭·완료 화면과 무관하게 항상 존재한다(label 이 가리킬 대상).
  assert.match(workspace, /const PHOTO_INPUT_ID = "contribute-photo-input";/);
  assert.equal((workspace.match(/id=\{PHOTO_INPUT_ID\}/g) || []).length, 1);
  // 완료 안내 상자를 없앤 뒤(§11) 남는 label 은 시트의 "사진 추가하기" 하나다.
  assert.equal((workspace.match(/htmlFor=\{PHOTO_INPUT_ID\}/g) || []).length, 1);
  // 시트가 열릴 때 자동으로 여는 코드가 없다.
  assert.doesNotMatch(workspace, /requestAnimationFrame\([^)]*click/);
});

test("label 로 만들 수 없는 자리(하단 네비)는 같은 tick 호출을 유지한다", () => {
  const workspace = read("components/ContributeWorkspace.tsx");
  const fn = workspace.slice(workspace.indexOf("const openPhotoPicker = ()"), workspace.indexOf("const openMemoryEditor"));
  assert.match(fn, /uploadInputRef\.current\?\.click\(\)/);
  assert.doesNotMatch(fn, /requestAnimationFrame|setTimeout|await/);
});
