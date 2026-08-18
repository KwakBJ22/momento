import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// A minimal canvas/decode stub so the REAL prepareUploadAndPreview path runs in
// node and we can observe the canvas sizes it produces (not a source regex).
const SRC_W = 4000;
const SRC_H = 3000;

class FakeImageBitmap {
  width: number; height: number; closed = false;
  constructor(w: number, h: number) { this.width = w; this.height = h; }
  close() { this.closed = true; }
}
class FakeHTMLImageElement {}

interface FakeCanvas { peakW: number; peakH: number; }
const canvases: FakeCanvas[] = [];

function installDom(): void {
  const g = globalThis as Record<string, unknown>;
  g.ImageBitmap = FakeImageBitmap;
  g.HTMLImageElement = FakeHTMLImageElement;
  g.window = { createImageBitmap: async () => new FakeImageBitmap(SRC_W, SRC_H) };
  g.createImageBitmap = async () => new FakeImageBitmap(SRC_W, SRC_H);
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
        toBlob: (cb: (b: unknown) => void, type: string) => cb({ size: 1234, type }),
      };
      canvases.push(canvas);
      return canvas;
    },
  };
  g.File = g.File || class {
    name: string; type: string; size: number; lastModified?: number;
    constructor(bits: Array<{ size?: number }>, name: string, opts: { type?: string; lastModified?: number }) {
      this.name = name; this.type = opts?.type ?? ""; this.size = bits[0]?.size ?? 0; this.lastModified = opts?.lastModified;
    }
  };
}

function uninstallDom(): void {
  const g = globalThis as Record<string, unknown>;
  delete g.window; delete g.document; delete g.createImageBitmap;
  delete g.ImageBitmap; delete g.HTMLImageElement;
}

const { makePreviewBlob, optimizeImageFile } = await import("../src/lib/optimizeImageFile");

/**
 * ★ 2026-08-16 — 한 번 디코드해서 **둘 다** 만들던 길(prepareUploadAndPreview)이 없어졌다.
 *   고르는 자리는 미리보기만, 제출하는 자리는 올릴 파일만 만든다. 두 자리가 갈렸으므로
 *   함수도 갈렸다 — 쓰지 않는 옛 길을 남겨 두면 다음 사람이 그것을 고친다.
 *   여기서 지키던 것(800 미리보기 · 2560 업로드 파일 · 사진을 잃지 않는다)은 그대로다.
 */
test("고르는 자리는 800 미리보기 하나, 제출하는 자리는 2560 파일 하나", async () => {
  canvases.length = 0;
  installDom();
  try {
    const file = { size: 4_000_000, name: "photo.jpg", type: "image/jpeg" } as unknown as File;
    const previewBlob = await makePreviewBlob(file);
    assert.ok(previewBlob, "a preview blob is produced");
    assert.equal(canvases.length, 1, "고르는 자리에서 캔버스는 하나다");
    assert.equal(Math.max(canvases[0].peakW, canvases[0].peakH), 800);

    const uploadFile = await optimizeImageFile(file);
    assert.ok(uploadFile);
    assert.equal(canvases.length, 2);
    assert.equal(Math.max(canvases[1].peakW, canvases[1].peakH), 2560);
  } finally {
    uninstallDom();
  }
});

test("decode failure loses no photo — no preview, and the original is uploaded", async () => {
  uninstallDom(); // no DOM → decode throws
  const file = { size: 3_000_000, name: "weird.jpg", type: "image/jpeg" } as unknown as File;
  assert.equal(await makePreviewBlob(file), null);
  const { prepareForUpload } = await import("../src/lib/optimizeImageFile");
  assert.equal(await prepareForUpload(file), file);
});

test("HEIC and GIF pass through as the original with no preview", async () => {
  uninstallDom();
  const { prepareForUpload } = await import("../src/lib/optimizeImageFile");
  for (const [name, type] of [["IMG_0001.heic", "image/heic"], ["anim.gif", "image/gif"]] as const) {
    const file = { size: 2_000_000, name, type } as unknown as File;
    assert.equal(await prepareForUpload(file), file, `${name} returned unchanged`);
    assert.equal(await makePreviewBlob(file), null, `${name} has no preview`);
  }
});

// Binding: UploadForm must actually use the preview blob (falling back to the
// upload file), and PhotoCommentList must decode previews lazily/asynchronously.
const uploadForm = readFileSync(new URL("../src/components/UploadForm.tsx", import.meta.url), "utf8");
const photoList = readFileSync(new URL("../src/components/PhotoCommentList.tsx", import.meta.url), "utf8");

test("UploadForm builds previewUrl from previewBlob, falling back to the original file", () => {
  // ★ 2026-08-16 — 고르는 자리에서는 **미리보기 하나만** 만든다. 올릴 파일(2560)은
  //   `앨범 만들기` 로 미뤘다. 화면에 붙는 것이 800 이라는 규칙(K-10)은 그대로이고,
  //   못 만들었을 때 원본으로 되돌아가는 갈래도 그대로다(GIF·HEIC·디코드 실패).
  assert.match(uploadForm, /const previewBlob = await makePreviewBlob\(file\);/);
  assert.equal(uploadForm.includes("prepareUploadAndPreview"), false, "무거운 변환이 고르는 자리에 남았다");
  // ★ K-10 에서 한 단계 늘었다 — 만든 덩어리를 `previewSource` 로 함께 들고 있는다.
  //   깨진 주소를 파일을 다시 읽지 않고 한 번 되살리려는 것이다. 고르는 규칙은 그대로다.
  assert.match(uploadForm, /const previewSource = previewBlob \?\? file;/);
  assert.match(uploadForm, /previewUrl: URL\.createObjectURL\(previewSource\), previewSource,/);
  // ★ 인자가 하나 늘었다 (2026-08-13): EXIF 위치(gps). 미리보기를 만드는 규칙
  //   (previewBlob 우선, 없으면 업로드 파일)은 그대로다.
  assert.match(uploadForm, /createPhotoItem\(original, previewBlob, capturedAt, gps\)/);
});

test("PhotoCommentList decodes previews lazily and asynchronously", () => {
  assert.match(photoList, /loading="lazy"/);
  assert.match(photoList, /decoding="async"/);
});
