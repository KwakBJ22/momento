import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { IMAGE_ACCEPT } from "../src/lib/imageFile";

// Android picker regression: with `image/*` PLUS explicit MIME/extensions, Chrome
// broadens the intent and offers the document picker ("내 파일"), which cannot
// multi-select. The accept attribute must therefore be `image/*` and nothing
// else — acceptance breadth is preserved by isAcceptedImageFile/filterImageFiles.

test("IMAGE_ACCEPT is image/* only (no explicit MIME/extension tokens)", () => {
  assert.equal(IMAGE_ACCEPT, "image/*");
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
