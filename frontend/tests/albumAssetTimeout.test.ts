import assert from "node:assert/strict";
import test from "node:test";

import { waitForAlbumAssets } from "../src/album-engine/waitForAlbumAssets";

type Listener = () => void;

/** load 도 error 도 절대 발생하지 않는 pending 이미지 (PDF 저장 무한 멈춤을 재현). */
function stuckImage(): unknown {
  return {
    complete: false,
    naturalWidth: 0,
    addEventListener: (_type: string, _listener: Listener) => {
      /* 이벤트를 영원히 발생시키지 않는다 */
    },
    decode: () => Promise.resolve(),
  };
}

/** 이미 로드된 정상 이미지. */
function loadedImage(): unknown {
  return {
    complete: true,
    naturalWidth: 1200,
    addEventListener: () => {},
    decode: () => Promise.resolve(),
  };
}

function rootWith(images: unknown[]): ParentNode {
  return { querySelectorAll: () => images } as unknown as ParentNode;
}

test("waitForAlbumAssets proceeds after the per-image timeout when an image never loads or errors", async () => {
  const started = Date.now();
  await waitForAlbumAssets(rootWith([stuckImage()]), {
    overallTimeoutMs: 1_000,
    imageTimeoutMs: 30,
    fontsTimeoutMs: 30,
  });
  const elapsed = Date.now() - started;
  // 무한 대기 없이 이미지 타임아웃 직후 진행해야 한다.
  assert.ok(elapsed < 500, `expected resolution well under the overall timeout, took ${elapsed}ms`);
});

test("waitForAlbumAssets falls back to the overall timeout even if every image stalls", async () => {
  const started = Date.now();
  await waitForAlbumAssets(rootWith([stuckImage(), stuckImage()]), {
    overallTimeoutMs: 40,
    imageTimeoutMs: 300,
    fontsTimeoutMs: 300,
  });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 500, `overall timeout backstop should fire, took ${elapsed}ms`);
});

test("waitForAlbumAssets resolves immediately for already-loaded images", async () => {
  await waitForAlbumAssets(rootWith([loadedImage(), loadedImage()]), {
    overallTimeoutMs: 1_000,
    imageTimeoutMs: 1_000,
    fontsTimeoutMs: 1_000,
  });
  // reject 없이 완료되면 성공 (여기 도달하면 통과).
  assert.ok(true);
});
