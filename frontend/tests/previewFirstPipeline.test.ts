import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 고르자마자 사진이 뜬다 — **무거운 변환은 만들 때로 미룬다** (2026-08-16).
 *
 * 예전 순서: 원본 디코드 → 2560 축소 → 인코딩(올릴 파일) → 800 축소 → 인코딩 → 화면.
 * 화면에 필요 없는 일을 먼저 끝냈다. 카메라 원본이면 거기서 대부분의 시간이 갔다.
 *
 * 이제: 800 기준으로 **작게 디코드** → 800 인코딩 → 화면. 2560 은 제출할 때.
 *
 * ★ **원본을 화면에 그대로 띄우지 않는다** — K-10(안드로이드 탭이 죽던 것)의 원인이다.
 *   미리보기는 언제나 긴 변 800 이다. 순서만 바꾼 것이지 규칙을 깨는 것이 아니다.
 * ★ 올라가는 파일의 긴 변은 여전히 2560 이다.
 * ★ createImageBitmap 이 없어도 동작한다(그 갈래를 지우지 않았다).
 */

const SRC_W = 4000;
const SRC_H = 3000;

class FakeImageBitmap {
  width: number; height: number; closed = false;
  constructor(w: number, h: number) { this.width = w; this.height = h; }
  close() { this.closed = true; }
}
class FakeHTMLImageElement {
  naturalWidth = SRC_W; naturalHeight = SRC_H;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) { queueMicrotask(() => this.onload?.()); }
}

const REAL_URL = globalThis.URL;

interface FakeCanvas { peakW: number; peakH: number }
const canvases: FakeCanvas[] = [];
/** createImageBitmap 에 실제로 넘어간 옵션 — 크게 디코드하지 않는지 본다. */
const decodeCalls: Array<Record<string, unknown>> = [];

/** 4000×3000 JPEG 의 앞부분: SOI + SOF0(높이 3000 · 폭 4000). */
function jpegHead(width: number, height: number): ArrayBuffer {
  const bytes = new Uint8Array(20);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0xffd8);        // SOI
  view.setUint16(2, 0xffc0);        // SOF0
  view.setUint16(4, 11);            // length
  bytes[6] = 8;                     // precision
  view.setUint16(7, height);
  view.setUint16(9, width);
  return bytes.buffer;
}

function fakeFile(head: ArrayBuffer, name = "photo.jpg", type = "image/jpeg"): File {
  return {
    name, type, size: 9_000_000,
    slice: () => ({ arrayBuffer: async () => head }),
  } as unknown as File;
}

function installDom(options: { bitmap: boolean }): void {
  const g = globalThis as Record<string, unknown>;
  g.ImageBitmap = FakeImageBitmap;
  g.HTMLImageElement = FakeHTMLImageElement;
  g.Image = FakeHTMLImageElement;
  // ★ node 의 진짜 URL 을 지우지 않는다 — import 가 그것을 쓴다. 두 함수만 얹는다.
  g.URL = Object.assign(Object.create(REAL_URL), { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
  const decode = async (_file: unknown, opts: Record<string, unknown> = {}) => {
    decodeCalls.push(opts);
    // 브라우저가 하는 일을 흉내 낸다: 준 쪽 변에 맞춰 비율을 지켜 줄여 준다.
    const scale = opts.resizeWidth
      ? (opts.resizeWidth as number) / SRC_W
      : opts.resizeHeight
        ? (opts.resizeHeight as number) / SRC_H
        : 1;
    return new FakeImageBitmap(Math.round(SRC_W * scale), Math.round(SRC_H * scale));
  };
  g.window = options.bitmap ? { createImageBitmap: decode } : {};
  if (options.bitmap) g.createImageBitmap = decode;
  else delete g.createImageBitmap;
  g.document = {
    createElement(tag: string) {
      if (tag !== "canvas") throw new Error("unexpected element " + tag);
      const canvas = {
        _w: 0, _h: 0, peakW: 0, peakH: 0,
        get width() { return this._w; },
        set width(v: number) { this._w = v; if (v > this.peakW) this.peakW = v; },
        get height() { return this._h; },
        set height(v: number) { this._h = v; if (v > this.peakH) this.peakH = v; },
        getContext: () => ({
          drawImage() {},
          getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }),
        }),
        toBlob: (cb: (b: unknown) => void, type: string) => cb({ size: 40_000, type }),
      };
      canvases.push(canvas);
      return canvas;
    },
  };
  g.File = g.File || class {
    name: string; type: string; size: number;
    constructor(bits: Array<{ size?: number }>, name: string, opts: { type?: string }) {
      this.name = name; this.type = opts?.type ?? ""; this.size = bits[0]?.size ?? 0;
    }
  };
}

function uninstallDom(): void {
  const g = globalThis as Record<string, unknown>;
  delete g.window; delete g.document; delete g.createImageBitmap;
  delete g.ImageBitmap; delete g.HTMLImageElement; delete g.Image;
  g.URL = REAL_URL;
}

const uploadForm = readFileSync(new URL("../src/components/UploadForm.tsx", import.meta.url), "utf8");
const optimizerSource = readFileSync(new URL("../src/lib/optimizeImageFile.ts", import.meta.url), "utf8");

const { makePreviewBlob, optimizeImageFile } = await import("../src/lib/optimizeImageFile");

function reset(): void {
  canvases.length = 0;
  decodeCalls.length = 0;
}

test("★ 미리보기는 800px 이고, 4000×3000 비트맵을 아예 만들지 않는다 (K-10)", async () => {
  reset();
  installDom({ bitmap: true });
  try {
    const blob = await makePreviewBlob(fakeFile(jpegHead(SRC_W, SRC_H)));
    assert.ok(blob, "미리보기를 만들지 못했다");
    // 디코드 자체를 800 기준으로 시켰다 — 긴 변이 가로라 resizeWidth 를 준다.
    assert.equal(decodeCalls.length, 1);
    assert.equal(decodeCalls[0].resizeWidth, 800);
    assert.equal(decodeCalls[0].resizeHeight, undefined, "두 변을 다 주면 찌그러진다");
    assert.equal(decodeCalls[0].imageOrientation, "from-image");
    // 캔버스는 하나뿐이고 800 을 넘지 않는다 — 2560 캔버스가 서지 않는다.
    assert.equal(canvases.length, 1, "고르는 자리에서 캔버스가 둘 이상 섰다");
    assert.equal(Math.max(canvases[0].peakW, canvases[0].peakH), 800);
  } finally {
    uninstallDom();
  }
});

test("★ 세로 사진은 짧은 변이 아니라 긴 변을 800 에 맞춘다", async () => {
  reset();
  installDom({ bitmap: true });
  try {
    await makePreviewBlob(fakeFile(jpegHead(3000, 4000)));
    assert.equal(decodeCalls[0].resizeHeight, 800);
    assert.equal(decodeCalls[0].resizeWidth, undefined);
  } finally {
    uninstallDom();
  }
});

test("★ 원본이 이미 작으면 늘리지 않는다", async () => {
  reset();
  installDom({ bitmap: true });
  try {
    await makePreviewBlob(fakeFile(jpegHead(600, 400)));
    assert.equal(decodeCalls[0].resizeWidth, undefined);
    assert.equal(decodeCalls[0].resizeHeight, undefined);
  } finally {
    uninstallDom();
  }
});

test("★ 올라가는 파일의 긴 변은 여전히 2560 이다", async () => {
  reset();
  installDom({ bitmap: true });
  try {
    await optimizeImageFile(fakeFile(jpegHead(SRC_W, SRC_H)));
    assert.equal(canvases.length, 1);
    assert.equal(Math.max(canvases[0].peakW, canvases[0].peakH), 2560);
    // 올릴 파일을 만들 때는 줄여서 디코드하지 않는다 — 화질을 잃는다.
    assert.equal(decodeCalls[0].resizeWidth, undefined);
    assert.equal(decodeCalls[0].resizeHeight, undefined);
  } finally {
    uninstallDom();
  }
});

test("★ createImageBitmap 이 없어도 동작한다 — 그 갈래를 지우지 않았다", async () => {
  reset();
  installDom({ bitmap: false });
  try {
    const blob = await makePreviewBlob(fakeFile(jpegHead(SRC_W, SRC_H)));
    assert.ok(blob, "옛 브라우저에서 미리보기가 사라졌다");
    // 이 갈래는 원본을 통째로 디코드한다(지금과 같다). 그래도 화면에 붙는 것은 800 이다.
    assert.equal(Math.max(canvases[0].peakW, canvases[0].peakH), 800);
  } finally {
    uninstallDom();
  }
});

test("★ 크기를 못 읽는 파일도 미리보기를 만든다 — 짐작하지 않고 옛 경로로 간다", async () => {
  reset();
  installDom({ bitmap: true });
  try {
    // 앞부분이 JPEG/PNG 머리가 아니면 크기를 모른다 → resize 없이 디코드한다.
    const blob = await makePreviewBlob(fakeFile(new Uint8Array([1, 2, 3, 4]).buffer, "x.heic", "image/heic"));
    assert.ok(blob);
    assert.equal(decodeCalls[0].resizeWidth, undefined);
    assert.equal(Math.max(canvases[0].peakW, canvases[0].peakH), 800);
  } finally {
    uninstallDom();
  }
});

test("★ 촬영일·좌표는 여전히 **원본에서** 읽는다 — 비트맵에서 읽지 않는다", () => {
  const form = uploadForm;
  const worker = form.slice(form.indexOf("async (file) => {"), form.indexOf("return { file, previewBlob"));
  assert.match(worker, /extractOriginalCaptureDate\(file\)/);
  assert.match(worker, /extractOriginalGps\(file\)/);
  // 고르는 시점에 그대로 읽는다 — 미리보기를 만들기 **전**이다(캔버스가 EXIF 를 지운다).
  assert.ok(worker.indexOf("extractOriginalGps") < worker.indexOf("makePreviewBlob"), "EXIF 를 미리보기 뒤로 미뤘다");
});

test("★ 동시 처리 2장 상한은 그대로다", () => {
  const form = uploadForm;
  assert.match(form, /const PREPARE_CONCURRENCY = 2;/);
  assert.match(form, /DO NOT raise this/);
  // 제출할 때 도는 변환도 같은 상한을 쓴다 — 두 자리가 갈리지 않는다.
  assert.equal((form.match(/PREPARE_CONCURRENCY,/g) || []).length, 2);
});

test("★ 800·2560·품질 값은 바꾸지 않았다", () => {
  const src = optimizerSource;
  assert.match(src, /const MAX_EDGE = 2560;/);
  assert.match(src, /const PREVIEW_MAX_EDGE = 800;/);
  assert.match(src, /const PREVIEW_QUALITY = 0\.75;/);
  assert.match(src, /canvasBlob\(canvas, "image\/jpeg", 0\.85\)/);
});
