import { createRoot } from "react-dom/client";
import html2pdf from "html2pdf.js";
import AlbumRenderer, { waitForAlbumAssets } from "../album-engine/AlbumRenderer";
import type { AlbumPhoto, AlbumTemplateType } from "../types";
import { getAlbumPdfUrl, uploadAlbumPdf } from "./api";

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
      mode="print"
    />,
  );

  try {
    const element = await waitForRenderer(host);
    await waitForAlbumAssets(element);
    await document.fonts.ready;
    if (!element) throw new Error("PDF 렌더 영역을 찾지 못했어요.");

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
        pagebreak: { mode: ["css", "legacy"], avoid: [".photo-block", ".date-header", ".album-epilogue", ".album-cover"] },
      } as Record<string, unknown>)
      .from(element)
      .outputPdf("blob");

    return blob as Blob;
  } finally {
    root.unmount();
    host.remove();
  }
}

function pdfFilename(input: AlbumPdfInput): string {
  return `momento-${input.albumId}-v${input.albumVersion}.pdf`;
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
