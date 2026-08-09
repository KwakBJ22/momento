import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 🔴 캡션 저장 (G-1 · SCREEN_SPEC §7).
 *
 * 캡션은 이 제품에서 **인쇄까지 가는 유일한 글**이다. 저장이 안 되면 앨범이 만들어지지 않는다.
 *
 * 결함: 프런트가 `{ comment: … }` 로 보내고 서버는 `caption` 을 읽었다. Pydantic 은
 * 모르는 키를 조용히 버리고 빠진 키를 기본값 None 으로 채우므로 — 요청은 **200 인데
 * 빈 값이 저장**됐다. 오류도 나지 않았다. 게다가 화면은 응답의 `comment` 를 읽어
 * (서버는 `caption` 을 준다) 상태도 갱신되지 않았다.
 *
 * ★ 문자열 검사만으로는 다시 못 잡는다. **실제로 요청을 보내 무엇이 실리는지** 본다.
 */

// ★ 진짜 lib/api 를 쓴다 — 대역은 요청 본문을 만들지 않으므로 이 결함을 못 잡는다.
registerCssStub({ realApi: true });
setupDom("https://test.local/");

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

/** 요청을 받아 적는 서버 대역 — 서버와 같은 규칙(caption 키만 읽는다)으로 답한다. */
function server() {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const stored: Record<string, string | null> = {};
  (globalThis as unknown as Record<string, unknown>).fetch = async (input: unknown, init?: RequestInit) => {
    const url = String(typeof input === "string" ? input : (input as { url?: string }).url);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    requests.push({ url, body });
    const photoId = url.split("/photos/")[1]?.split("/")[0] ?? "";
    // ★ 서버와 같다: caption 키만 읽는다. 다른 이름으로 오면 빈 값이 저장된다.
    const caption = typeof body.caption === "string" ? body.caption : null;
    stored[photoId] = caption;
    return {
      ok: true, status: 200, headers: { get: () => "application/json" },
      json: async () => ({ id: photoId, caption }),
      text: async () => JSON.stringify({ id: photoId, caption }),
    } as unknown as Response;
  };
  return { requests, stored };
}

test("★ 캡션을 적고 저장하면 그 글이 실제로 실려 나간다", async () => {
  const api = server();
  const { saveAlbumPhotoCaption } = await import("../src/lib/api");
  const saved = await saveAlbumPhotoCaption("album-1", "photo-1", "  그날 바람이 좋았다.  ");

  assert.equal(api.requests.length, 1);
  assert.match(api.requests[0].url, /\/api\/albums\/album-1\/photos\/photo-1\/comment$/);
  // 예전에는 여기에 `comment` 가 실렸고, 서버는 그것을 버리고 빈 값을 저장했다.
  assert.deepEqual(api.requests[0].body, { caption: "그날 바람이 좋았다." });
  assert.equal(api.stored["photo-1"], "그날 바람이 좋았다.", "서버에 그 글이 저장된다");
  // 응답도 같은 이름으로 받는다 — 화면이 방금 적은 글을 그릴 수 있어야 한다.
  assert.deepEqual(saved, { id: "photo-1", caption: "그날 바람이 좋았다." });
});

test("빈 캡션은 지우는 뜻이다 (조용히 null 이 되는 것과 다르다)", async () => {
  const api = server();
  const { saveAlbumPhotoCaption } = await import("../src/lib/api");
  await saveAlbumPhotoCaption("album-1", "photo-2", "   ");
  assert.deepEqual(api.requests[0].body, { caption: null });
});

test("★ 저장한 뒤 화면이 읽는 필드에 넣는다", () => {
  // 화면(AlbumRenderer)은 photo.caption 을 읽는다 — comment 에 넣으면 방금 적은 글이
  // 화면에 나타나지 않는다(같은 결함의 두 번째 얼굴).
  const renderer = read("album-engine/AlbumRenderer.tsx");
  assert.match(renderer, /comment: photo\.caption/);
  for (const file of ["components/AlbumView.tsx", "components/AlbumResult.tsx"]) {
    const source = read(file);
    assert.match(source, /item\.id === saved\.id \? \{ \.\.\.item, caption: saved\.caption \}/, file);
    assert.doesNotMatch(source, /\{ \.\.\.item, comment: saved\.comment \}/, file);
  }
});

test("요청·응답 이름이 서버와 같다 (이름 하나가 어긋나면 조용히 지운다)", () => {
  const api = read("lib/api.ts");
  const fn = api.slice(api.indexOf("export async function saveAlbumPhotoCaption"), api.indexOf("export type AlbumGenerationStatus"));
  assert.match(fn, /JSON\.stringify\(\{ caption: caption\.trim\(\) \|\| null \}\)/);
  // ★ K-6 으로 `album_version` 이 한 자리 늘었다 — 저장하면 앨범 버전이 올라가고,
  //   그 값을 화면이 받아 둬야 PDF 가 409 를 안 맞는다. 이름 셋이 그대로인지 본다.
  assert.match(fn, /\{ id: string; caption: string \| null; album_version\?: number \}/);
  assert.doesNotMatch(fn, /comment:/);

  // 서버가 읽는 이름도 caption 하나다.
  const schemas = readFileSync(new URL("../../backend/app/models/schemas.py", import.meta.url), "utf8");
  const model = schemas.slice(schemas.indexOf("class PhotoCaptionUpdate"), schemas.indexOf("class PhotoCaptionResponse"));
  assert.match(model, /caption: str \| None/);
  assert.doesNotMatch(model, /comment:/);
});

test("실패를 숨기지 않는다 (§11)", async () => {
  (globalThis as unknown as Record<string, unknown>).fetch = async () => ({
    ok: false, status: 403, headers: { get: () => "application/json" },
    json: async () => ({ detail: "이 사진의 캡션은 올린 사람만 쓸 수 있어요." }),
    text: async () => "",
  } as unknown as Response);
  const { saveAlbumPhotoCaption } = await import("../src/lib/api");
  await assert.rejects(() => saveAlbumPhotoCaption("album-1", "photo-3", "글"), /올린 사람만/);
  // 화면도 그 오류를 그대로 보여준다(조용히 삼키지 않는다).
  const view = read("components/AlbumView.tsx");
  assert.match(view, /setPhotoCommentSaveError\(cause instanceof Error \? cause\.message :/);
  assert.match(view, /error: photoCommentSaveError/);
});
