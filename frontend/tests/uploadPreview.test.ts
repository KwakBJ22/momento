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

const { prepareUploadAndPreview } = await import("../src/lib/optimizeImageFile");

test("one decode yields a 2560px upload file and an 800px preview blob", async () => {
  canvases.length = 0;
  installDom();
  try {
    const file = { size: 4_000_000, name: "photo.jpg", type: "image/jpeg" } as unknown as File;
    const { file: uploadFile, previewBlob } = await prepareUploadAndPreview(file);

    assert.ok(previewBlob, "a preview blob is produced");
    assert.equal(canvases.length, 2, "exactly two canvases: upload then preview");
    // Upload canvas long edge = 2560, preview canvas long edge = 800.
    assert.equal(Math.max(canvases[0].peakW, canvases[0].peakH), 2560);
    assert.equal(Math.max(canvases[1].peakW, canvases[1].peakH), 800);
    assert.ok(uploadFile);
  } finally {
    uninstallDom();
  }
});

test("decode failure falls back to the original file with no preview (no photo dropped)", async () => {
  uninstallDom(); // no DOM → decode throws
  const file = { size: 3_000_000, name: "weird.jpg", type: "image/jpeg" } as unknown as File;
  const { file: out, previewBlob } = await prepareUploadAndPreview(file);
  assert.equal(out, file);
  assert.equal(previewBlob, null);
});

test("HEIC and GIF pass through as the original with no preview", async () => {
  uninstallDom();
  for (const [name, type] of [["IMG_0001.heic", "image/heic"], ["anim.gif", "image/gif"]] as const) {
    const file = { size: 2_000_000, name, type } as unknown as File;
    const { file: out, previewBlob } = await prepareUploadAndPreview(file);
    assert.equal(out, file, `${name} returned unchanged`);
    assert.equal(previewBlob, null, `${name} has no preview`);
  }
});

// Binding: UploadForm must actually use the preview blob (falling back to the
// upload file), and PhotoCommentList must decode previews lazily/asynchronously.
const uploadForm = readFileSync(new URL("../src/components/UploadForm.tsx", import.meta.url), "utf8");
const photoList = readFileSync(new URL("../src/components/PhotoCommentList.tsx", import.meta.url), "utf8");

test("UploadForm builds previewUrl from previewBlob, falling back to the upload file", () => {
  assert.match(uploadForm, /prepareUploadAndPreview\(file\)/);
  assert.match(uploadForm, /createObjectURL\(previewBlob \?\? file\)/);
  assert.match(uploadForm, /createPhotoItem\(prepared, previewBlob, capturedAt\)/);
});

test("PhotoCommentList decodes previews lazily and asynchronously", () => {
  assert.match(photoList, /loading="lazy"/);
  assert.match(photoList, /decoding="async"/);
});
