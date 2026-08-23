// 인쇄 지면의 값 — React/CSS 를 부르지 않는다(검사에서 그대로 읽는다).
//
// ★ 2026-08-22 — PDF 를 서버가 그린다(backend/app/services/album_pdf_service.py).
//   쪽 나눔 계산(printPageStraddleGap · wholePagesCaptureHeightPx · placeBrandOnClosingPage)은
//   html2canvas 로 굽던 시절의 것이라 **지웠다.** 서버는 쪽을 하나씩 그리므로 자를 것이 없다.
//   여기 남은 것은 화면 CSS 와 서버가 **같은 판형**을 쓰는지 맞춰 보는 값뿐이다.

/**
 * 지면 한 장의 세로 ÷ 가로 — **정사각이라 1이다** (2026-08-16 · 인쇄 판형).
 *
 * ★ mm 크기(206)는 CSS 토큰(--pr-page)이 갖고 있다. 여기 필요한 것은 **비율**뿐이다.
 */
export const PRINT_PAGE_ASPECT = 1;

/**
 * 지면 한 장의 mm 크기 — **작업 규격 206mm**(재단 200 + bleed 3 × 2).
 *
 * CSS 는 `--pr-page`(tokens.css)에서 읽고, 서버는 album_pdf_service.PAGE_MM 이 갖는다.
 * 값이 어긋나면 지면이 통째로 어긋난다 — 바꿀 때 **셋 다** 바꾼다.
 */
export const PRINT_PAGE_MM = 206;

/**
 * 인쇄 판형 판(版) — **인쇄 결과가 달라지는 변경마다 올린다.** 올리면 옛 캐시가 안 쓰인다.
 *
 * ★ 왜 필요한가(PO 실측 2026-08-21): 캐시 열쇠가 album_version 뿐이라, 내용이 그대로인
 *   앨범은 판형을 아무리 고쳐도 **8월 16일 A4 파일**을 그대로 받았다. 오늘 누른 PDF 가
 *   만들어진 적이 없었다 — 3초 만에 끝난 것도 빨라서가 아니라 아무것도 안 만들어서다.
 * ★ 이 값은 GET `/albums/{id}/pdf` 의 `layout` 인자로 실려 가 저장 열쇠에 함께
 *   들어간다(백엔드 _pdf_cache_key). 옛 파일은 지우지 않는다 — 안 쓰일 뿐이다.
 * ★ 올릴 때는 **왜 올리는지 한 줄**을 남긴다. 숫자만 있으면 다음 사람이 못 올린다.
 *
 *   1 = A4 세로 (~2026-08-16)
 *   2 = 정사각 206×206 · 표지 6종 · 본문 배치 · 날짜 머리 B안 · 펼침면 (2026-08-21)
 *   3 = 서버에서 그린다 · 벡터 글자 · 300 DPI · 한 쪽 1장 (2026-08-22)
 */
export const PRINT_LAYOUT_VERSION = 3;
