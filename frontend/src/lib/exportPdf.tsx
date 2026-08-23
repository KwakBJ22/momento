import { getAlbumPdfUrl } from "./api";
import { currentUserAgent, isInAppWebView } from "./webview";
import { PDF_GENERIC_MESSAGE, PDF_TIMEOUT_MESSAGE, pdfFailureMessage, type PdfDelivery } from "./pdfNotice";
import { withPdfTimeout } from "./pdfTimeout";
import { pdfDownloadFilename } from "./pdfFilename";

/**
 * PDF 는 **서버가 그린다** (PO 승인 2026-08-22 · 구조 변경).
 *
 * 예전에는 여기서 AlbumRenderer 를 화면 밖에 마운트하고 html2canvas 로 앨범 전체를 한
 * 캔버스에 구운 뒤 쪽마다 JPEG 한 장을 넣었다 — 폰이 원본 30장(≈90MB)을 전부 내려받아
 * 메모리에 올리는 길이라 아이폰이 멈췄고, 글자도 사진도 192 DPI 그림이었다.
 * 원본은 서버에 있다. **원본을 쓰려면 원본이 있는 곳에서 만들어야 한다.**
 *
 * 이제 이 파일이 하는 일은 둘이다.
 *   1) GET /albums/{id}/pdf 를 부른다 — 캐시가 없으면 서버가 만들어 그 주소를 준다.
 *   2) 그 주소로 파일을 받게 한다(같은 창 이동 — 웹뷰·아이폰·데스크톱 모두 같은 길).
 * 굽는 경로(html2pdf · 캔버스 상한 · 30장 가드)는 **지웠다.** 되살리지 않는다.
 */
export interface AlbumPdfInput {
  albumId: string;
  albumVersion: number;
  title: string;
}

/** 원인이 검색되도록 event 이름을 붙여 남긴다(조용히 삼키지 않는다). */
function logPdf(event: string, detail: Record<string, unknown> = {}): void {
  const parts = Object.entries(detail).map(([key, value]) => `${key}=${value}`).join(" ");
  console.warn(`[pdf] event=${event}${parts ? ` ${parts}` : ""}`);
}

/**
 * 서버에 앨범 PDF 를 청해 받는다. 캐시가 있으면 바로, 없으면 서버가 만든 뒤 준다.
 *
 * ★ **끝나지 않으면 끝나지 않았다고 말한다** (PO 실측 2026-08-21). 서버가 오래 걸리거나
 *   응답이 없으면 시간 제한이 실패로 끝맺어 화면이 `만들고 있어요` 에서 빠져나온다.
 */
export async function downloadAlbumPdf(input: AlbumPdfInput): Promise<PdfDelivery> {
  let url: string | null = null;
  try {
    url = (await withPdfTimeout(getAlbumPdfUrl(input.albumId, input.albumVersion), PDF_TIMEOUT_MESSAGE)).url;
  } catch (error) {
    const status = (error as { status?: number } | null)?.status;
    logPdf("pdf_request_failed", {
      album: input.albumId,
      version: input.albumVersion,
      // 401 = 로그인 없음 / 404 = 앨범 없음 / 5xx = 서버가 못 만듦.
      status: status ?? "none",
      reason: pdfFailureMessage(error),
    });
    throw error;
  }
  if (!url) {
    // 서버가 만들지 않는 경우(옛 판을 물었을 때) — 여기서는 더 할 것이 없다.
    logPdf("pdf_url_missing", { album: input.albumId, version: input.albumVersion, webview: isInAppWebView(currentUserAgent()) });
    throw new Error(PDF_GENERIC_MESSAGE);
  }
  // 서버 주소는 https 라 인앱 브라우저(카카오톡 등)에서도 받아진다 — 기기를 가리지 않고 같은 길이다.
  return deliverStoredPdf(url, pdfDownloadFilename(input.title));
}

/** 저장된 PDF 주소로 파일을 받게 한다.
 *
 *  ★ 새 창(window.open / target=_blank)을 쓰지 않는다. 안드로이드 웹뷰는 첨부 파일 주소를
 *  다운로드 관리자로 넘기면서 그 창에는 아무것도 그리지 않는다 — 그래서 "빈 새 창"이 남았다.
 *  같은 창에서 이동하면 창이 새로 생기지 않고, 첨부(download) 표시 때문에 화면이 바뀌지도
 *  않는다. 브라우저는 그 자리에서 파일만 받는다. */
function deliverStoredPdf(url: string, filename: string): PdfDelivery {
  window.location.assign(withDownloadName(url, filename));
  return { via: "browser-url", url };
}

/** 서명 URL 에 download 표시를 붙인다 — 웹뷰가 화면에 열지 않고 파일로 받게 한다.
 *  Supabase 서명 URL 은 추가 쿼리를 허용하므로 서명이 깨지지 않는다. */
function withDownloadName(url: string, filename: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(filename)}`;
}
