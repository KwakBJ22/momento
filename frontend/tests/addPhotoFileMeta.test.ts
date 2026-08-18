import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { toUploadFileMeta } from "../src/lib/exifCaptureDate";

/**
 * 사진을 **더할 때도** 촬영일·좌표를 함께 보낸다 (2026-08-18).
 *
 * 좌표를 보내는 통로(`file_meta`)가 앱 전체에서 `UploadForm` 한 곳뿐이었다. 사진을
 * 더하는 자리(주최자 `사진 추가` · 참여자 더하기)는 둘 다 `uploadContributePhotos`
 * 하나를 거치는데, 거기에는 그 통로가 없었다.
 *
 * ★ 새 파서를 만들지 않는다 — `extractOriginalCaptureDate` · `extractOriginalGps` 그대로다.
 * ★ 보내는 **모양**도 하나다. 두 자리가 각자 적으면 갈린다(그것이 이 결함이었다).
 * ★ DOM 요소를 assert 에 넘기지 않는다(2026-08-15 규칙).
 */

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const api = read("lib/api.ts");
const workspace = read("components/ContributeWorkspace.tsx");
const uploadForm = read("components/UploadForm.tsx");

test("★ 모양은 하나다 — 칸 이름이 서버 파서와 맞는다", () => {
  const meta = toUploadFileMeta("2024-05-18T10:11:12.000Z", { latitude: 37.55, longitude: 126.97 });
  assert.deepEqual(Object.keys(meta).sort(), ["captured_at", "latitude", "longitude"]);
  assert.equal(meta.captured_at, "2024-05-18T10:11:12.000Z");
  assert.equal(meta.latitude, 37.55);
  assert.equal(meta.longitude, 126.97);
  // 두 자리가 **같은 함수**로 모양을 만든다 — 각자 적지 않는다.
  assert.match(uploadForm, /toUploadFileMeta\(photo\.capturedAt, photo\.gps\)/);
  assert.match(workspace, /readUploadFileMeta\(item\.file\)/);
});

test("★ 못 읽어도 사진은 올라간다 — 그 칸만 null 이다 (회귀)", () => {
  assert.deepEqual(toUploadFileMeta(null, null), { captured_at: null, latitude: null, longitude: null });
  // 좌표만 없을 수도, 촬영일만 없을 수도 있다. 한쪽이 없다고 다른 쪽을 버리지 않는다.
  assert.deepEqual(toUploadFileMeta("2024-05-18T00:00:00.000Z", null),
    { captured_at: "2024-05-18T00:00:00.000Z", latitude: null, longitude: null });
  assert.deepEqual(toUploadFileMeta(null, { latitude: 1.5, longitude: 2.5 }),
    { captured_at: null, latitude: 1.5, longitude: 2.5 });
});

test("★ 사진 추가 요청에 file_meta 가 실린다 — 사진 수와 같은 길이로", () => {
  assert.match(api, /form\.append\("file_meta", JSON\.stringify\(/);
  // 안 넘겨도 사진 수만큼 빈 칸을 만든다 — 서버가 순서로 짝짓기 때문이다.
  assert.match(api, /files\.map\(\(\) => \(\{ captured_at: null, latitude: null, longitude: null \}\)\)/);
  // 예전 칸(file_created_ats)은 그대로 둔다 — 계약을 깨지 않는다(§10).
  assert.match(api, /form\.append\("file_created_ats", String\(file\.lastModified\)\)/);
});

test("★ 사진을 더하는 자리는 하나다 — 주최자·참여자가 같은 통로를 쓴다", () => {
  // 통로가 갈리면 한쪽만 고치게 된다. 부르는 곳이 한 자리인지 세어 둔다.
  const callers = [read("components/ContributeWorkspace.tsx"), read("components/AlbumView.tsx"), read("components/PublicShareView.tsx")]
    .filter((source) => source.includes("uploadContributePhotos("));
  assert.equal(callers.length, 1, "사진을 더하는 통로가 둘 이상이다");
});

test("★ 새 파서를 만들지 않았다 — 앨범을 만들 때와 같은 함수다", () => {
  const lib = read("lib/exifCaptureDate.ts");
  assert.match(lib, /export async function readUploadFileMeta/);
  // 읽는 일은 이미 있던 두 함수가 한다.
  const reader = lib.slice(lib.indexOf("export async function readUploadFileMeta"));
  assert.match(reader, /extractOriginalCaptureDate\(file\)/);
  assert.match(reader, /extractOriginalGps\(file\)/);
  // 더하는 자리가 EXIF 를 스스로 다시 파싱하지 않는다.
  assert.equal(workspace.includes("DataView"), false);
});
