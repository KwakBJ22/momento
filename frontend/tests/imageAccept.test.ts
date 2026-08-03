import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { IMAGE_ACCEPT } from "../src/lib/imageFile";

// Android picker regression (verified on a real device): `image/*` ALONE drops the
// gallery from the intent chooser (only 카메라/파일 appear). The full list — image/*
// PLUS explicit MIME types and extensions — keeps the gallery present. So the accept
// attribute must include image/* AND the explicit tokens.

test("IMAGE_ACCEPT includes image/* and the explicit MIME/extension tokens", () => {
  const tokens = IMAGE_ACCEPT.split(",").map((t) => t.trim());
  assert.ok(tokens.includes("image/*"), `image/* must be present in ${IMAGE_ACCEPT}`);
  for (const mime of ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]) {
    assert.ok(tokens.includes(mime), `expected ${mime}`);
  }
  for (const ext of [".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"]) {
    assert.ok(tokens.includes(ext), `expected ${ext}`);
  }
});

// The two multi-select photo inputs must bind the shared constant (not a
// hardcoded accept string that could drift) together with `multiple`.
const uploadForm = readFileSync(new URL("../src/components/UploadForm.tsx", import.meta.url), "utf8");
const contribute = readFileSync(new URL("../src/components/ContributeWorkspace.tsx", import.meta.url), "utf8");

test("the gallery multi-select inputs bind IMAGE_ACCEPT + multiple", () => {
  for (const [name, source] of [["UploadForm", uploadForm], ["ContributeWorkspace", contribute]] as const) {
    assert.match(source, /import \{[^}]*IMAGE_ACCEPT[^}]*\} from "\.\.\/lib\/imageFile"/, `${name} imports IMAGE_ACCEPT`);
    // accept={IMAGE_ACCEPT} and multiple on the same file input (tolerate line breaks).
    assert.match(source, /accept=\{IMAGE_ACCEPT\}[\s\S]{0,80}multiple/, `${name} binds IMAGE_ACCEPT + multiple`);
  }
});
