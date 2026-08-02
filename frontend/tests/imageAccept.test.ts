import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { IMAGE_ACCEPT } from "../src/lib/imageFile";

// Regression (fe297f2): dropping `image/*` from the accept list makes Android
// Chrome exclude the gallery from the picker, leaving only camera/file pickers
// where multi-select is impossible. Assert the real constant, not its source text.

test("IMAGE_ACCEPT leads with image/* so Android keeps the gallery in the picker", () => {
  const tokens = IMAGE_ACCEPT.split(",").map((token) => token.trim());
  assert.ok(tokens.includes("image/*"), `expected image/* in ${IMAGE_ACCEPT}`);
  // Explicit types remain for other platforms; filtering itself is done in code.
  for (const mime of ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]) {
    assert.ok(tokens.includes(mime), `expected ${mime}`);
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
