import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * "방명록" 이라는 이름을 쓰지 않는다 (CLAUDE.md §6).
 *
 * 방명록은 **방문한 사람이 쓰는 말**이라, 주최자가 자기 앨범에 쓸 때 말이 맞지 않는다.
 * 구역 이름은 `우리가 남긴 말` 하나이고, 누르는 버튼은 `한마디 남기기` 다
 * — 버튼은 행동을, 구역은 무엇인지 말한다. 역할에 따라 다르게 부르지 않는다.
 *
 * ★ 열거하지 않는다. 규칙으로 전수한다: **주석을 걷어낸 소스**에 이 단어가 없어야 한다.
 *   컴포넌트·클래스·변수·DB 컬럼(guestbook, album_guestbook_entries)은 식별자이므로
 *   그대로 둔다 — 화면에 보이는 말만 바꾼다.
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

/** ★ 예외는 여기에만 적는다. 다음에 또 열거하지 않기 위한 자리다(지금은 없다). */
const ALLOWED: Array<{ file: string; why: string }> = [];

function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(tsx?|css)$/.test(entry) ? [full] : [];
  });
}

/** 주석은 개발자에게 하는 말이라 화면 문자열이 아니다 — 판단에서 제외한다. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

test("화면 문자열에 `방명록` 이 없다", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    const relative = file.replace(SRC, "").replace(/\\/g, "/");
    if (ALLOWED.some((item) => item.file === relative)) continue;
    if (withoutComments(readFileSync(file, "utf8")).includes("방명록")) offenders.push(relative);
  }
  assert.deepEqual(offenders, []);
});

test("구역은 `우리가 남긴 말`, 버튼은 `여기에 남기기`", () => {
  const guestbook = readFileSync(new URL("../src/components/AlbumGuestbook.tsx", import.meta.url), "utf8");
  assert.match(guestbook, /<h3 className="public-share__guestbook-title">우리가 남긴 말<\/h3>/);
  assert.match(guestbook, /aria-label="우리가 남긴 말"/);
  // 버튼은 행동을 말한다 — 구역 이름을 버튼에 다시 적지 않는다.
  // ★ 사진에 다는 `이 사진에 한마디` 와 성격이 달라 이름을 나눴다(§4·§7).
  assert.match(guestbook, /"여기에 남기기"/);
  assert.doesNotMatch(guestbook, /우리가 남긴 말 남기기/);
});

test("식별자는 그대로 둔다 (보이는 말만 바꿨다)", () => {
  const guestbook = readFileSync(new URL("../src/components/AlbumGuestbook.tsx", import.meta.url), "utf8");
  // 컴포넌트·클래스 이름을 함께 바꾸면 CSS·API·DB 까지 번져 위험만 커진다.
  assert.match(guestbook, /className="public-share__guestbook"/);
  assert.match(guestbook, /getGuestbookEntries|submitGuestbookEntry/);
});
