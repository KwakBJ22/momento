import { createRoot } from "react-dom/client";
import AlbumRenderer, { waitForAlbumAssets } from "../album-engine/AlbumRenderer";
import type { AlbumPhoto, AlbumTemplateType, LivingAppendPage } from "../types";
import { getAlbumPdfUrl, uploadAlbumPdf } from "./api";
import { PDF_BLOCKED_REASON, PDF_PHOTO_SAFE_LIMIT } from "./albumLimits";
import { currentUserAgent, isInAppWebView } from "./webview";
import { PDF_GENERIC_MESSAGE, pdfFailureMessage, webviewSaveMessage, type PdfDelivery } from "./pdfNotice";
import { pdfDownloadFilename } from "./pdfFilename";
import { printPageStraddleGap } from "./pdfPageBreak";

export interface AlbumPdfInput {
  albumId: string;
  albumVersion: number;
  title: string;
  photos: AlbumPhoto[];
  epilogue: string;
  coverDateLabel?: string | null;
  category?: string | null;
  templateType?: AlbumTemplateType | string | null;
  chapterStories?: Record<string, string> | null;
  coverPhotoId?: string | null;
  livingAppendPages?: LivingAppendPage[];
  /** "함께 만든 사람" 한 줄 — PDF 에 들어간다(CLAUDE.md §6). ★ 넘기지 않으면 그 줄이
   *  통째로 빠진다. 실제로 그렇게 빠져 있었다: PDF 는 화면과 다른 AlbumRenderer 인스턴스를
   *  새로 마운트하는데, 이 값을 넘기지 않아 화면에만 있고 인쇄물에는 없었다. */
  contributorNames?: string[];
}

/** html2canvas 는 앨범 전체를 캔버스 한 장으로 만든다. 크롬의 캔버스 한 변 상한(65,535px)을
 *  넘으면 예외 없이 빈/잘린 결과가 나와 "오래 기다렸는데 빈 PDF"가 된다. 미리 잡아 던진다. */
const CANVAS_SCALE = 2;
const CANVAS_MAX_PX = 65_500;
/** 이보다 작은 결과물은 정상 PDF 가 아니다(빈 캔버스). */
const PDF_MIN_BLOB_BYTES = 1024;

/** 원인이 검색되도록 event 이름을 붙여 남긴다(조용히 삼키지 않는다). */
function logPdf(event: string, detail: Record<string, unknown> = {}): void {
  const parts = Object.entries(detail).map(([key, value]) => `${key}=${value}`).join(" ");
  console.warn(`[pdf] event=${event}${parts ? ` ${parts}` : ""}`);
}

/**
 * AlbumRenderer(print) DOM을 A4 PDF로 변환한다.
 * album_version 캐시가 있으면 서버 URL을 우선 반환한다.
 */
export async function downloadAlbumPdf(input: AlbumPdfInput): Promise<PdfDelivery> {
  const cached = await getAlbumPdfUrl(input.albumId, input.albumVersion).catch((error) => {
    logPdf("pdf_cache_lookup_failed", { album: input.albumId, reason: pdfFailureMessage(error) });
    return null;
  });
  // 서버 주소는 https 라 인앱 브라우저에서도 받아진다 — 그대로 쓴다.
  if (cached?.url) {
    return deliverStoredPdf(cached.url, pdfFilename(input));
  }

  const blob = await renderAlbumPdfBlob(input);
  if (!blob || blob.size < PDF_MIN_BLOB_BYTES) {
    logPdf("pdf_blob_empty", { album: input.albumId, photos: input.photos.length, bytes: blob?.size ?? 0 });
    throw new Error(input.photos.length > PDF_PHOTO_SAFE_LIMIT ? PDF_BLOCKED_REASON : PDF_GENERIC_MESSAGE);
  }

  // 저장 경로는 이미 있다: PUT /albums/{id}/pdf 가 momento-private 에 올리고 서명 URL 을
  // 돌려준다(새 API 를 만들지 않는다). 인앱 브라우저에서는 이 주소가 유일한 전달 경로다.
  let storedUrl: string | null = null;
  try {
    storedUrl = (await uploadAlbumPdf(input.albumId, input.albumVersion, blob)).url;
  } catch (error) {
    logPdf("pdf_upload_failed", { album: input.albumId, reason: pdfFailureMessage(error) });
  }

  // 인앱 브라우저(카카오톡 등)는 blob URL + a[download] 를 무시한다: 눌러도 아무 일도
  // 일어나지 않고 예외도 없다 — 예전에 "저장했어요"만 뜨던 원인이다. blob 을 아예 쓰지
  // 않고 저장된 파일 주소로 이동시키면 웹뷰의 다운로드 처리기가 받는다.
  if (isInAppWebView(currentUserAgent())) {
    if (storedUrl) {
      return deliverStoredPdf(storedUrl, pdfFilename(input));
    }
    logPdf("pdf_download_unsupported", { album: input.albumId, reason: "no_stored_url" });
    throw new Error(webviewSaveMessage(currentUserAgent()));
  }

  triggerBlobDownload(blob, pdfFilename(input));
  return { via: "download" };
}

export async function renderAlbumPdfBlob(input: AlbumPdfInput): Promise<Blob> {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = "210mm";
  host.style.background = "#faf7f4";
  host.setAttribute("aria-hidden", "true");
  document.body.appendChild(host);

  const mount = document.createElement("div");
  host.appendChild(mount);

  const root = createRoot(mount);
  root.render(
    <AlbumRenderer
      photos={input.photos}
      title={input.title}
      epilogue={input.epilogue}
      coverDateLabel={input.coverDateLabel}
      category={input.category}
      templateType={input.templateType}
      chapterStories={input.chapterStories}
      albumId={input.albumId}
      coverPhotoId={input.coverPhotoId}
      livingAppendPages={input.livingAppendPages}
      contributorNames={input.contributorNames ?? []}
      mode="print"
    />,
  );

  try {
    const element = await waitForRenderer(host);
    // 폰트·이미지 대기는 waitForAlbumAssets 가 상한 시간과 함께 처리한다 (무한 대기 방지).
    // 이미지 로드가 끝나 높이가 확정된 뒤에 페이지 나눔을 계산해야 한다.
    await waitForAlbumAssets(element);
    if (!element) throw new Error("PDF 렌더 영역을 찾지 못했어요.");
    alignBlocksToPrintPages(element);

    // 캔버스 상한을 넘으면 html2canvas 는 예외 대신 빈 결과를 준다 — 먼저 잡아 이유를 말한다.
    const sourceHeightPx = element.scrollHeight * CANVAS_SCALE;
    if (sourceHeightPx > CANVAS_MAX_PX) {
      logPdf("pdf_canvas_overflow", { photos: input.photos.length, height: Math.round(sourceHeightPx), max: CANVAS_MAX_PX });
      throw new Error(PDF_BLOCKED_REASON);
    }

    const { default: html2pdf } = await import("html2pdf.js");
    const blob = await html2pdf()
      .set({
        margin: [0, 0, 0, 0],
        filename: pdfFilename(input),
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          allowTaint: false,
          backgroundColor: "#faf7f4",
          logging: false,
        },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        // html2pdf 의 pagebreak.avoid 는 이 레이아웃에서 안 통한다: getBoundingClientRect 가
        // 컨테이너 오프셋만큼 어긋나고(소스에 // TODO 로 남아있음), grid 아이템 앞에 패딩 div 를
        // 끼우면 grid 가 깨진다. 그래서 위에서 우리가 직접 margin 으로 페이지에 맞춰 두고,
        // 여기서는 html2pdf 의 자동 나눔만 쓴다.
        pagebreak: { mode: [] },
      } as Record<string, unknown>)
      .from(element)
      .outputPdf("blob");

    return blob as Blob;
  } catch (error) {
    logPdf("pdf_render_failed", { album: input.albumId, photos: input.photos.length, reason: pdfFailureMessage(error) });
    throw error;
  } finally {
    root.unmount();
    host.remove();
  }
}

/**
 * Push any top-level block that would straddle an A4 page boundary down to the next
 * page, so a photo + its caption never gets sliced in half.
 *
 * html2canvas rasterizes the whole page into one canvas and slices it every page
 * height, ignoring CSS break rules; html2pdf's own `avoid` is unreliable here
 * (viewport-offset bug + it breaks the CSS grid). We instead measure on our own
 * host — where the top is at y=0 — and add margin-top to straddling blocks. A grid
 * item's margin-top pushes its following siblings down, so this works inside the
 * blocks grid too.
 */
export function alignBlocksToPrintPages(element: HTMLElement): void {
  // Margin [0,0,0,0] + a 210mm-wide host: one page is (297/210) × width in source px.
  const pageHeightPx = element.getBoundingClientRect().width * (297 / 210);
  if (!(pageHeightPx > 0)) return;
  // 열람용 PDF 의 페이지 단위(§9). 표지·본문 한 장·끝 글·브랜드 페이지가 각각 정확히
    // A4 한 장(aspect-ratio 210/297)이라, 이 보정은 반올림으로 생기는 어긋남만 밀어 준다.
    const selector = ".album-cover, .print-page, .print-closing, .album-living-page, .album-renderer__brand-page";
  for (let guard = 0; guard < 500; guard += 1) {
    const hostTop = element.getBoundingClientRect().top;
    const units = Array.from(element.querySelectorAll<HTMLElement>(selector));
    let pushed = false;
    for (const unit of units) {
      if (unit.dataset.pdfPaged === "1") continue;
      unit.dataset.pdfPaged = "1";
      const rect = unit.getBoundingClientRect();
      const gap = printPageStraddleGap(rect.top - hostTop, rect.height, pageHeightPx);
      if (gap !== null) {
        const current = parseFloat(getComputedStyle(unit).marginTop) || 0;
        unit.style.marginTop = `${current + gap}px`;
        pushed = true;
        break; // re-measure after every change (a push shifts everything below)
      }
    }
    if (!pushed) break;
  }
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

function pdfFilename(input: AlbumPdfInput): string {
  return pdfDownloadFilename(input.title);
}

async function waitForRenderer(host: HTMLElement): Promise<HTMLElement> {
  const timeoutAt = Date.now() + 10_000;
  while (Date.now() < timeoutAt) {
    const element = host.querySelector("[data-album-renderer]") as HTMLElement | null;
    if (element) return element;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("PDF rendering area was not ready.");
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

