import { createRoot } from "react-dom/client";
import AlbumRenderer, { waitForAlbumAssets } from "../album-engine/AlbumRenderer";
import type { AlbumPhoto, AlbumTemplateType, LivingAppendPage } from "../types";
import { getAlbumPdfUrl, uploadAlbumPdf } from "./api";
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
}

/**
 * AlbumRenderer(print) DOM을 A4 PDF로 변환한다.
 * album_version 캐시가 있으면 서버 URL을 우선 반환한다.
 */
export async function downloadAlbumPdf(input: AlbumPdfInput): Promise<void> {
  const cached = await getAlbumPdfUrl(input.albumId, input.albumVersion).catch(() => null);
  if (cached?.url) {
    triggerFileDownload(cached.url, pdfFilename(input));
    return;
  }

  const blob = await renderAlbumPdfBlob(input);
  await uploadAlbumPdf(input.albumId, input.albumVersion, blob).catch(() => undefined);
  triggerBlobDownload(blob, pdfFilename(input));
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
  const selector = ".album-cover, .album-renderer__block, .album-epilogue, .album-living-page, .album-renderer__brand-footer";
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

function triggerFileDownload(url: string, filename: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
