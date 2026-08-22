import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 🔴 카카오톡에서 PDF 를 받는 길 (G-2 · SCREEN_SPEC §9).
 *
 * `카카오톡에서는 파일 저장이 막혀 있어요…` 는 **모든 전달 경로가 실패했을 때만** 나오는
 * 마지막 안내다. 그런데 공유 화면에서는 늘 이 문구가 떴다.
 *
 * 원인: 인앱 브라우저에는 blob 이 통하지 않아 **서버에 올린 파일의 주소**로 보내야 하는데,
 * 공유 화면이 저장 요청에 `albumVersion: 0` 을 실어 보냈다. 서버는 보낸 버전이 앨범의
 * 현재 버전과 다르면 409 로 막는다 — 그래서 저장이 **늘** 실패했고, 넘길 주소가 없어
 * 마지막 안내만 남았다.
 */

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const back = (p: string) => readFileSync(new URL(`../../backend/app/${p}`, import.meta.url), "utf8");

test("★ 공유 화면이 앨범의 실제 버전을 보낸다 (0 을 보내면 늘 409 다)", () => {
  const view = read("components/PublicShareView.tsx");
  assert.match(view, /albumVersion: album\.album_version \?\? 0,/);
  assert.doesNotMatch(view, /albumVersion: 0,/);

  // 서버가 그 값을 실어 보내야 화면이 알 수 있다(공유 응답은 원래 버전을 몰랐다).
  const schemas = back("models/schemas.py");
  const model = schemas.slice(schemas.indexOf("class PublicShareAlbumResponse"), schemas.indexOf("class ShareViewerContributor"));
  assert.match(model, /album_version: int = 0/);
  assert.match(back("api/share.py"), /album_version=int\(album\.get\("album_version"\) or 0\)/);
});

test("저장 버전이 맞아야 받아 주는 규칙은 그대로다", () => {
  const album = back("api/album.py");
  const put = album.slice(album.indexOf('@router.put("/albums/{album_id}/pdf")'), album.indexOf('@router.delete("/albums/{album_id}"'));
  assert.match(put, /if version != int\(record\.get\("album_version"\) or 0\):/);
  assert.match(put, /status_code=409/);
  // 저장 경로 자체는 살아 있다 — 올리고, 캐시 키에 적고, 서명 URL 을 돌려준다.
  assert.match(put, /StorageService\.for_supabase\(client, settings\)\.upload\(/);
  // ★ 2026-08-21 — 열쇠에 판형 판(layout)이 더해져 _pdf_cache_key 하나로 모였다.
  //   지키는 것은 그대로다: 저장과 조회가 **같은 열쇠**를 쓴다. 판형이 다르면 캐시가 안 쓰인다.
  assert.match(put, /set_cached_pdf_path\(client, record, _pdf_cache_key\(version, renderer_version, layout\)/);
  assert.match(put, /url = get_signed_url\(/);
});

// ★ 2026-08-22 — PDF 는 서버가 그린다. 화면이 굽고 올리던(uploadAlbumPdf) 길이 없어졌으니
//   `올린 주소` 도 없다. 인앱 브라우저가 받는 길은 그대로다: **서버 파일의 https 주소로 같은
//   창에서 이동한다.** 그 주소는 이제 GET 한 번으로 온다(캐시가 없으면 서버가 만들어 준다).
test("★ 인앱 브라우저는 서버 파일의 주소로 받는다 — blob 을 쓰지 않는다", () => {
  const pdf = read("lib/exportPdf.tsx");
  const flow = pdf.slice(pdf.indexOf("export async function downloadAlbumPdf"));
  assert.match(flow, /await withPdfTimeout\(getAlbumPdfUrl\(input\.albumId, input\.albumVersion\), PDF_TIMEOUT_MESSAGE\)/);
  assert.match(flow, /return deliverStoredPdf\(url, pdfDownloadFilename\(input\.title\)\);/);
  assert.equal(pdf.includes("createObjectURL"), false, "blob 길이 되살아났다 — 인앱 브라우저는 blob 을 무시한다");
  // 저장된 주소로는 같은 창에서 이동한다(새 창을 열면 빈 창이 남는다).
  assert.match(pdf, /window\.location\.assign\(withDownloadName\(url, filename\)\)/);
});

test("저장·조회가 같은 캐시 키를 쓴다 (렌더러 버전 포함)", () => {
  const album = back("api/album.py");
  // ★ 2026-08-21 — 열쇠에 판형 판(layout)이 더해져 _pdf_cache_key 하나로 모였다.
  //   지키는 것은 그대로다: 저장과 조회가 **같은 열쇠**를 쓴다. 판형이 다르면 캐시가 안 쓰인다.
  assert.match(album, /cache_key = _pdf_cache_key\(target_version, renderer_version, layout\)/);
  assert.match(album, /set_cached_pdf_path\(client, record, _pdf_cache_key\(version, renderer_version, layout\)/);
  // 판형 판도 두 경로가 같은 기본값(1)을 쓴다 — 한쪽만 바뀌면 저장한 것을 못 찾는다.
  assert.equal((album.match(/layout: int = Query\(default=1, ge=1\)/g) || []).length, 2);
  // 두 경로 모두 같은 기본값을 쓴다 — 한쪽만 바뀌면 저장한 것을 못 찾는다.
  assert.equal((album.match(/renderer_version: int = Query\(default=PDF_RENDERER_VERSION\)/g) || []).length, 2);
});

test("어느 단계에서 막혔는지 로그로 알 수 있다", () => {
  const pdf = read("lib/exportPdf.tsx");
  // ★ 2026-08-22 — 올리는 단계가 없어져 `pdf_upload_failed` 는 `pdf_request_failed` 가 됐다.
  assert.match(pdf, /logPdf\("pdf_request_failed", \{[\s\S]*?status: status \?\? "none"/);
  assert.match(pdf, /version: input\.albumVersion/);
  // 상태를 실어 보내려면 api 가 그것을 오류에 붙여야 한다.
  const api = read("lib/api.ts");
  const upload = api.slice(api.indexOf("export async function uploadAlbumPdf"), api.indexOf("export async function updateAlbumPhotoLocation"));
  assert.match(upload, /error\.status = response\.status;/);
});
