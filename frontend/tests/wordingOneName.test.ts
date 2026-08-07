import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

/**
 * SCREEN_SPEC §7 — 사용자에게 보이는 텍스트 계층의 이름은 `한마디` 하나다.
 * `기억`은 옛 이름이므로 화면·문구·숫자 표시 어디에도 남기지 않는다.
 *
 * ★ 제외 목록(보이지 않는 자리 + 제품 서사):
 *  - 주석·JSDoc — 사람이 읽는 설명이지 화면 문구가 아니다
 *  - 변수·필드·API 이름: memory_count, photo_memories, memories, memoryCount 등
 *  - "추억" 중 **제품 서사와 앨범 제목**: CLAUDE.md §1 의 어휘("추억을 만드는 서비스"),
 *    기본 앨범 제목 "우리의 추억"(DB 에 실제 값으로 들어 있다), "함께 만든 추억 앨범".
 *    이것들은 텍스트 계층의 이름이 아니라 서비스가 무엇인지를 말하는 말이다.
 */
const VISIBLE_STRING = /(["'`>])([^"'`<>{}]*기억[^"'`<>{}]*)/g;

test("사용자에게 보이는 문자열에 옛 이름 `기억`이 없다", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    if (file.endsWith("wordingOneName.test.ts")) continue;
    const code = readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((line) => {
        const trimmed = line.trim();
        return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
      })
      .join("\n");
    for (const match of code.matchAll(VISIBLE_STRING)) {
      offenders.push(`${file.replace(SRC, "")}: ${match[2].trim().slice(0, 40)}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("숫자 표시는 `사진 N장 · 한마디 N개` 하나로 통일됐다", () => {
  const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
  // 예전에는 같은 값을 화면마다 기억/추억/한마디로 다르게 불렀다.
  assert.match(read("components/CollaborationPanel.tsx"), /한마디 \{status\.memory_count\}개/);
  assert.match(read("components/AlbumParticipationPanel.tsx"), /한마디 \{person\.memory_count\}개/);
  assert.match(read("components/AlbumView.tsx"), /한마디 \{participation\.memory_count\}개/);
});

test("변수·필드 이름은 그대로 둔다 (보이지 않는 자리)", () => {
  const view = readFileSync(new URL("../src/components/AlbumView.tsx", import.meta.url), "utf8");
  // 이름을 바꾸는 작업이 아니다 — 문자열만 바꿨다는 것을 못 박는다.
  assert.match(view, /memory_count/);
});
