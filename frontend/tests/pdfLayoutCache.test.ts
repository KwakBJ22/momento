import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 🔴 PDF 캐시가 8월 16일 A4 파일을 그대로 내줬다 (PO 실측 2026-08-21).
 *
 * 캐시 열쇠가 album_version 뿐이라, 내용이 그대로인 앨범은 판형(정사각 206×206)을
 * 올린 뒤에도 **옛 파일**을 받았다. 3초 만에 끝난 것도 빨라서가 아니라
 * 아무것도 안 만들어서다.
 *
 * ★ 판형 판(PRINT_LAYOUT_VERSION)을 GET/PUT 에 함께 보낸다 — 판이 다르면 캐시가 안 쓰인다.
 * ★ 찾을 때와 올릴 때 **같은 열쇠**여야 한다. 한쪽만 보내면 올린 파일을 못 찾는다.
 */

// 진짜 api.ts 를 쓴다 — **무엇이 서버로 나가는가**를 보는 검사다.
registerCssStub({ realApi: true });
setupDom("https://test.local/album/album-1");

/** 나간 요청을 적어 두는 서버 대역. */
function server() {
  const calls: Array<{ url: string; method: string }> = [];
  (globalThis as unknown as Record<string, unknown>).fetch = async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(typeof input === "string" ? input : (input as { url?: string }).url), method: init?.method || "GET" });
    return {
      ok: true, status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ url: null, album_version: 7, cached: false }),
      text: async () => "",
    } as unknown as Response;
  };
  return calls;
}

test("★ 찾을 때와 올릴 때 **같은 판형 판**을 보낸다 — 이것이 이번 수정이다", async () => {
  const calls = server();
  const { getAlbumPdfUrl, uploadAlbumPdf } = await import("../src/lib/api");
  const { PRINT_LAYOUT_VERSION } = await import("../src/lib/pdfPageBreak");

  await getAlbumPdfUrl("album-1", 7);
  await uploadAlbumPdf("album-1", 7, new Blob(["%PDF-1.4"], { type: "application/pdf" }));

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.match(call.url, /\/api\/albums\/album-1\/pdf\?version=7/, call.method);
    // 판이 없으면 서버가 예전 열쇠(A4 캐시)로 찾는다 — 그것이 이 결함이었다.
    assert.match(call.url, new RegExp(`layout=${PRINT_LAYOUT_VERSION}(&|$)`), `${call.method}: 판형 판이 안 실렸다`);
  }
});

test("★ 판형 판은 2 이상이고, 왜 올렸는지가 적혀 있다", async () => {
  const { PRINT_LAYOUT_VERSION } = await import("../src/lib/pdfPageBreak");
  // 1 = A4(~08-16). 정사각 판형이 올라간 지금은 반드시 그보다 크다 —
  // 1 로 되돌리면 모든 앨범이 다시 8월 16일 파일을 받는다.
  assert.ok(PRINT_LAYOUT_VERSION >= 2, "판이 A4 시절로 되돌아갔다");
  const source = readFileSync(new URL("../src/lib/pdfPageBreak.ts", import.meta.url), "utf8");
  // 숫자만 있으면 다음 사람이 못 올린다 — 판마다 한 줄씩 내력이 있어야 한다.
  assert.match(source, /1 = A4/);
  assert.match(source, /2 = 정사각/);
});

test("★ 받는 파일 이름은 그대로다 — pdfFilename 에 손대지 않았다", async () => {
  const { pdfDownloadFilename } = await import("../src/lib/pdfFilename");
  // 판형 판이 사용자에게 보이는 이름에 섞이면 안 된다.
  assert.equal(pdfDownloadFilename("우리의 추억").includes("l2"), false);
  assert.match(pdfDownloadFilename("우리의 추억"), /^우리의 추억/);
});
