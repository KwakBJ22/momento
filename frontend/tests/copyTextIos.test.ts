import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const read = (p: string) => readFileSync(path.join(SRC, p), "utf8");

/**
 * 🔴 아이폰에서 링크 복사가 실패한다 (2026-08-12 · iOS 전수 조사).
 *
 *     await navigator.clipboard.writeText(await url());
 *                                          ↑ 사용자 제스처가 끊긴다
 *
 * iOS Safari 는 writeText 가 탭의 동기 연장선에 있을 때만 허용한다.
 * 앞에 네트워크 호출이 오면 NotAllowedError 다. 안드로이드·데스크톱은 되고 아이폰만 안 된다.
 * ★ 이건 카카오 공유가 실패했을 때의 마지막 대비책이라, 여기서 또 막히면 길이 없다.
 */
test("링크를 복사할 때 주소를 먼저 await 하지 않는다", () => {
  const sheet = read("components/AlbumShareSheet.tsx");
  assert.equal(
    /clipboard\.writeText\(await /.test(sheet),
    false,
    "await 뒤에 writeText 를 부르면 아이폰에서 거부된다",
  );
  assert.match(sheet, /copyTextFromPromise\(url\)/);
  assert.match(sheet, /copyTextFromPromise\(resolveViewUrl\)/);
});

test("복사 도구는 ClipboardItem 에 Promise 를 그대로 넘긴다", () => {
  const lib = read("lib/copyText.ts");
  // Safari 가 이 형태를 위해 만든 길 — 주소를 만드는 동안에도 제스처가 살아 있다.
  assert.match(lib, /new ClipboardItemCtor\(\{ "text\/plain": blob \}\)/);
  // 지원하지 않는 곳에서는 지금까지 하던 방식으로 떨어진다.
  assert.match(lib, /clipboard\.writeText\(await getText\(\)\)/);
});
