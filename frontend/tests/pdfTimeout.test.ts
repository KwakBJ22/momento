import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PDF_TIMEOUT_MS, PdfTimeoutError, withPdfTimeout } from "../src/lib/pdfTimeout";
import { PDF_TIMEOUT_MESSAGE } from "../src/lib/pdfNotice";

/**
 * 🔴 PDF 가 **끝나지 않는다** (PO 실측 2026-08-21 · 아이폰).
 *
 * 데스크톱 크롬에서는 사진 9장이 3초에 끝나고 콘솔 오류도 0건이다. 아이폰에서만
 * `앨범을 파일로 만들고 있어요` 에서 멈춘다 — html2canvas 가 캔버스 한계를 넘으면
 * 예외도 거부도 없이 **돌아오지 않는다.**
 *
 * `AlbumPdfStatus` 는 만드는 동안 닫기 버튼을 두지 않는다(의도된 것이다). 그래서 끝나지
 * 않으면 사용자는 그 문구를 영원히 본다. 같은 파일의 규칙
 *   ★ 실패하면 실패라고 말한다. 조용히 끝나지 않는다.
 * 에서 **끝나지 않는 경우가 빠져 있었다.**
 *
 * ★ 가짜 진행률을 만들지 않는다(F-3). 여기서 더하는 것은 **끝맺음**뿐이다.
 */

test("★ 제 시간에 끝나면 그대로 돌려준다 — 평소에는 아무 일도 하지 않는다", async () => {
  const value = await withPdfTimeout(Promise.resolve("ok"), PDF_TIMEOUT_MESSAGE, 50);
  assert.equal(value, "ok");
});

test("★ 끝나지 않으면 **실패로 끝난다** — 이것이 이번 수정이다", async () => {
  // 영원히 끝나지 않는 일(html2canvas 가 멈춘 그 모양이다).
  const never = new Promise<string>(() => {});
  await assert.rejects(
    () => withPdfTimeout(never, PDF_TIMEOUT_MESSAGE, 20),
    (error: unknown) => {
      assert.ok(error instanceof PdfTimeoutError, "다른 실패와 갈라 볼 이름이 없다");
      assert.equal((error as Error).message, PDF_TIMEOUT_MESSAGE);
      return true;
    },
  );
});

test("★ 원래 실패는 그대로 전해진다 — 시간 제한이 이유를 덮지 않는다", async () => {
  await assert.rejects(
    () => withPdfTimeout(Promise.reject(new Error("사진이 많아요")), PDF_TIMEOUT_MESSAGE, 50),
    /사진이 많아요/,
  );
});

test("★ 제 시간에 끝나면 타이머를 거둔다 — 탭을 깨워 두지 않는다", async () => {
  const timers: unknown[] = [];
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  (globalThis as unknown as Record<string, unknown>).setTimeout = ((fn: () => void, ms?: number) => {
    const id = realSetTimeout(fn, ms);
    timers.push(id);
    return id;
  }) as typeof setTimeout;
  let cleared = 0;
  (globalThis as unknown as Record<string, unknown>).clearTimeout = ((id: never) => {
    cleared += 1;
    return realClearTimeout(id);
  }) as typeof clearTimeout;
  try {
    await withPdfTimeout(Promise.resolve(1), PDF_TIMEOUT_MESSAGE, 10_000);
  } finally {
    (globalThis as unknown as Record<string, unknown>).setTimeout = realSetTimeout;
    (globalThis as unknown as Record<string, unknown>).clearTimeout = realClearTimeout;
  }
  assert.equal(timers.length, 1);
  assert.equal(cleared, 1, "타이머가 남았다");
});

test("★ 시간 값은 사람이 `멈췄다` 고 느끼기 전이다 — 근거가 주석에 있다", () => {
  // 실측 9장 3초 · 30장이면 10초 남짓 · 오래된 폰은 서너 배.
  assert.ok(PDF_TIMEOUT_MS >= 30_000, "너무 짧으면 정상인 앨범도 막는다");
  assert.ok(PDF_TIMEOUT_MS <= 90_000, "그보다 길면 기다림이 아니라 고장으로 읽힌다");
  const source = readFileSync(new URL("../src/lib/pdfTimeout.ts", import.meta.url), "utf8");
  assert.match(source, /실측/, "왜 그 값인지가 적혀 있지 않다");
});

// ★ 2026-08-22 — PDF 는 서버가 그린다. 기기가 캔버스를 만들 수 있는지 재보던 `canvasFits` 와
//   30장 상한은 잴 캔버스가 없어져 지웠다(albumLimits.test 가 되살아나지 않는지 본다).
//   시간 제한은 남는다 — 기다리는 것이 캔버스에서 **서버 응답**으로 바뀌었을 뿐이다.
test("★ 기기 재보기는 없다 — 잴 캔버스가 없다", () => {
  const source = readFileSync(new URL("../src/lib/pdfTimeout.ts", import.meta.url), "utf8");
  assert.equal(source.includes("export function canvasFits"), false, "canvasFits 가 되살아났다");
  assert.equal(source.includes('createElement("canvas")'), false);
  // 왜 없어졌는지가 적혀 있다.
  assert.match(source, /서버가 그린다/);
});

test("★ 청하는 자리에 시간 제한이 실제로 걸려 있다 — 서버를 기다리는 그물", () => {
  const source = readFileSync(new URL("../src/lib/exportPdf.tsx", import.meta.url), "utf8");
  assert.match(source, /await withPdfTimeout\(getAlbumPdfUrl\(input\.albumId, input\.albumVersion\), PDF_TIMEOUT_MESSAGE\)/);
  // 굽는 자리는 없다(설명 주석은 빼고 본다).
  const code = source.split(/\r?\n/).filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");
  assert.equal(code.includes("html2pdf"), false);
});

test("★ 문구에 기술 용어를 쓰지 않는다 (§8)", () => {
  for (const banned of ["렌더", "캔버스", "AI", "canvas"]) {
    assert.equal(PDF_TIMEOUT_MESSAGE.includes(banned), false, `문구에 \`${banned}\` 가 들어갔다`);
  }
  // 사실 한 줄 + 무엇을 하면 되는지 한 줄.
  assert.match(PDF_TIMEOUT_MESSAGE, /만들지 못했어요/);
  assert.match(PDF_TIMEOUT_MESSAGE, /사진이 많으면/);
});
