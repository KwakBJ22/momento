import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { splitSentences } from "../src/album-engine/storyOverlap";
import { normalizeMemoryText } from "../src/album-engine/memoryCaption";
import { createId } from "../src/lib/id";

/**
 * 🔴 오래된 아이폰에서 앱이 통째로 죽던 자리 두 곳 (2026-08-18).
 *
 * 빌드 목표는 **사파리 14**(Vite 기본값)인데 코드가 그보다 새 문법·API 를 요구했다.
 *   ① 정규식 뒤돌아보기 `(?<=...)`  — iOS **16.4** 부터. 파일을 읽는 순간 문법 오류가
 *      나고, `album-engine/index.ts` 가 그 파일을 내보내므로 **엔진이 통째로** 죽었다.
 *   ② `crypto.randomUUID`          — iOS **15.4** 부터. 앨범 만들기가 그 자리에서 죽었다.
 *
 * 우리 사용자는 기기를 오래 쓰는 층이라 3~4년 된 아이폰이 흔하다.
 *
 * ★ CSS 는 없어도 죽지 않고 모양만 달라진다 — 고치지 않는다(아래 마지막 검사가
 *   그것을 **기록**해 둔다. 막는 검사가 아니다).
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.(ts|tsx)$/.test(entry)) found.push(full);
  }
  return found;
}

const FILES = sourceFiles(SRC);
const read = (path: string) => readFileSync(path, "utf8");

/**
 * 주석을 걷어낸 **코드만** 본다.
 *
 * ★ 왜 그렇게 고쳤는지는 주석에 적어 두는 것이 맞다 — `(?<=...)` 나 `crypto.randomUUID`
 *   라고 **쓰기만 한** 설명이 검사에 걸리면, 설명을 지우게 만드는 검사가 된다.
 *   찾는 것은 실제로 도는 코드다.
 */
function codeOf(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*/g, "$1 ");
}

/* ---------------------------------------------------------------- *
 * ① 뒤돌아보기 없이, 결과는 예전과 똑같이
 * ---------------------------------------------------------------- */

/** 고치기 **전**의 구현 그대로. 이것과 결과가 같아야 한다(Node 는 뒤돌아보기를 지원한다). */
function splitSentencesBefore(text: string): string[] {
  return normalizeMemoryText(text)
    .split(/(?<=[.!?。！？]|다\.|요\.|죠\.|네\.)\s+|\n+/)
    .map((s) => normalizeMemoryText(s))
    .filter(Boolean);
}

const CORPUS = [
  "",
  "   ",
  "한 문장뿐이다",
  "한 문장뿐이다.",
  // ★ 프롬프트가 콕 집은 갈래 — `다. / 요. / 죠. / 네.`
  "바다에 갔다. 셋이서 놀았다. 비가 왔다.",
  "우산을 하나만 챙겼어요. 결국 다 젖었어요. 그래도 웃었어요.",
  "그때가 좋았죠. 다시 가고 싶죠. 그렇죠.",
  "사진이 참 곱네. 다들 젊었네. 세월이 빠르네.",
  "다. 요. 죠. 네.",
  "끝났다.바로붙은다음문장",           // 공백이 없으면 자르지 않는다
  "느낌표! 물음표? 둘 다!?  섞어서.",
  "일본어 마침표。 이어서！ 그리고？ 끝.",
  "줄바꿈으로\n나눈다\n\n두 번도",
  "마침표 뒤 줄바꿈.\n다음 문장.",
  "공백이   여러   개.   그 뒤 문장.",
  "  앞뒤 공백이 있다.  ",
  "점만 여러 개... 그 뒤.",
  "숫자 3.14 는 자르지 않는다",           // 숫자 뒤에 공백이 없다
  "숫자 3. 14 는 자른다",                 // 공백이 있으면 예전에도 잘랐다
  "영문 Hello. World. Done.",
  "혼합 문장이다. Mixed sentence. 끝났어요!",
  "이모지도 있다 🙂. 그 뒤 문장.",
];

test("★ 뒤돌아보기를 없애도 나누는 결과가 예전과 같다", () => {
  for (const text of CORPUS) {
    assert.deepEqual(
      splitSentences(text),
      splitSentencesBefore(text),
      `달라졌다: ${JSON.stringify(text)}`,
    );
  }
});

test("★ `다. / 요. / 죠. / 네.` 로 끝나는 문장이 제대로 갈린다", () => {
  assert.deepEqual(splitSentences("바다에 갔다. 셋이서 놀았다."), ["바다에 갔다.", "셋이서 놀았다."]);
  assert.deepEqual(splitSentences("우산을 챙겼어요. 다 젖었어요."), ["우산을 챙겼어요.", "다 젖었어요."]);
  assert.deepEqual(splitSentences("그때가 좋았죠. 다시 가고 싶죠."), ["그때가 좋았죠.", "다시 가고 싶죠."]);
  assert.deepEqual(splitSentences("사진이 곱네. 다들 젊었네."), ["사진이 곱네.", "다들 젊었네."]);
  // ★ 끝 부호가 앞 문장에 **남는다**. 이것이 이번 고침의 핵심이다.
  for (const sentence of splitSentences("갔다. 왔다. 놀았다.")) {
    assert.match(sentence, /\.$/, `부호가 떨어졌다: ${sentence}`);
  }
});

test("★ 제어문자를 넣어도 그것으로 문장을 쪼갤 수 없다", () => {
  // 자르는 표시로 쓰는 글자다. 글에 섞여 들어와도 문장이 갈라지면 안 된다.
  const sneaky = `앞${"\u0000"}뒤`;
  assert.deepEqual(splitSentences(sneaky), ["앞뒤"]);
});

test("★ 소스에 뒤돌아보기가 하나도 없다 (iOS 16.4 미만에서 문법 오류)", () => {
  const offenders = FILES.filter((file) => /\(\?<[=!]/.test(codeOf(file)));
  assert.deepEqual(offenders.map((f) => f.replace(SRC, "")), [], "뒤돌아보기가 남아 있다");
});

/* ---------------------------------------------------------------- *
 * ② crypto.randomUUID — 없으면 죽는다
 * ---------------------------------------------------------------- */

test("★ `crypto.randomUUID` 를 직접 부르는 자리가 lib/id 하나뿐이다", () => {
  const offenders = FILES
    .filter((file) => !file.endsWith(join("lib", "id.ts")))
    .filter((file) => /crypto\s*(\.|\?\.)\s*randomUUID/.test(codeOf(file)));
  assert.deepEqual(offenders.map((f) => f.replace(SRC, "")), [], "감싸지 않고 바로 부른다");
});

test("★ 대비값도 UUID 모양이다 — 서버가 이 값을 UUID 로 읽는다", () => {
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  // 지금 자리(Node)에서는 randomUUID 가 있다 — 그것도 같은 모양이어야 한다.
  assert.match(createId(), UUID_V4);

  // randomUUID 가 **없는** 옛 아이폰을 흉내낸다.
  const original = globalThis.crypto;
  try {
    Object.defineProperty(globalThis, "crypto", {
      value: { getRandomValues: original.getRandomValues.bind(original) },
      configurable: true,
    });
    const made = Array.from({ length: 50 }, () => createId());
    for (const id of made) assert.match(id, UUID_V4, `UUID 모양이 아니다: ${id}`);
    assert.equal(new Set(made).size, made.length, "같은 값이 나왔다");
  } finally {
    Object.defineProperty(globalThis, "crypto", { value: original, configurable: true });
  }
});

test("★ getRandomValues 마저 없어도 죽지 않는다", () => {
  const original = globalThis.crypto;
  try {
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    const made = Array.from({ length: 20 }, () => createId());
    for (const id of made) {
      assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    assert.equal(new Set(made).size, made.length);
  } finally {
    Object.defineProperty(globalThis, "crypto", { value: original, configurable: true });
  }
});

/* ---------------------------------------------------------------- *
 * 같이 훑은 것 — 무엇을 찾았고 무엇을 그냥 뒀는지
 * ---------------------------------------------------------------- */

test("★ iOS 15.4 이상을 요구하는 JS 가 남아 있지 않다", () => {
  // 없으면 **죽는** 것들이다. CSS 와 달리 대비가 있어야 한다.
  const banned: Array<[string, RegExp]> = [
    ["Object.hasOwn (15.4)", /\bObject\s*\.\s*hasOwn\b/],
    ["structuredClone (15.4)", /\bstructuredClone\s*\(/],
    ["Array.prototype.at (15.4)", /\.\s*at\(\s*-?\d/],
    ["findLast (15.4)", /\.\s*findLast(Index)?\s*\(/],
    ["AbortSignal.timeout (16)", /\bAbortSignal\s*\.\s*timeout\b/],
    ["Object.groupBy (17.4)", /\bObject\s*\.\s*groupBy\b/],
    ["toSorted·toReversed (16.4)", /\.\s*(toSorted|toReversed|toSpliced)\s*\(/],
  ];
  for (const [label, pattern] of banned) {
    const offenders = FILES.filter((file) => pattern.test(codeOf(file)));
    assert.deepEqual(offenders.map((f) => f.replace(SRC, "")), [], `${label} 를 쓴다`);
  }
});

test("CSS 는 고치지 않았다 — 없어도 죽지 않고 모양만 달라진다 (기록)", () => {
  // ★ 막는 검사가 아니다. 무엇이 옛 기기에서 다르게 보이는지 **적어 두는** 자리다.
  //   지우거나 고치지 않는다(프롬프트 지시). 수가 변하면 여기서 눈에 띈다.
  const cssFiles = readdirSyncDeepCss(SRC);
  const count = (pattern: RegExp) => cssFiles.filter((file) => pattern.test(read(file))).length;
  // 셋 다 iOS 15.4~15.0 부터다. 그 아래에서는 그냥 적용이 안 될 뿐 앱은 돈다.
  assert.ok(count(/:has\(/) > 0, ":has() 가 사라졌다 — 기록을 갱신할 것");
  assert.ok(count(/100dvh/) > 0, "100dvh 가 사라졌다 — 기록을 갱신할 것");
  assert.ok(count(/aspect-ratio/) > 0, "aspect-ratio 가 사라졌다 — 기록을 갱신할 것");
});

function readdirSyncDeepCss(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) readdirSyncDeepCss(full, found);
    else if (entry.endsWith(".css")) found.push(full);
  }
  return found;
}
