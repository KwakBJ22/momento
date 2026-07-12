const BG_COLOR = "#fbf6f0";
const ACCENT_COLOR = "#b48c6e";
const TEXT_COLOR = "#4a423c";
const FONT_FAMILY = "'Apple SD Gothic Neo','Malgun Gothic','Nanum Gothic',sans-serif";

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const char of paragraph) {
      const trial = current + char;
      if (ctx.measureText(trial).width <= maxWidth || !current) {
        current = trial;
      } else {
        lines.push(current);
        current = char;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

async function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  // blob 경유로 로드해 canvas taint(오염)를 방지
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) throw new Error("이미지를 불러오지 못했습니다.");
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("이미지 디코딩에 실패했습니다."));
      img.src = objectUrl;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  }
}

/**
 * 앨범 이미지 하단에 "우리의 이야기"(편집된 내러티브)를 합성한 PNG Blob을 만든다.
 * 모든 템플릿에서 동일하게 스토리가 저장 이미지에 포함되도록 한다.
 */
export async function composeAlbumWithStory(
  imageUrl: string,
  narrative: string,
  title: string,
): Promise<Blob> {
  const img = await loadImageFromUrl(imageUrl);
  const width = img.naturalWidth || img.width;
  const scale = width / 1080;

  const padding = Math.round(64 * scale);
  const titleSize = Math.round(46 * scale);
  const bodySize = Math.round(34 * scale);
  const bodyLineHeight = Math.round(bodySize * 1.6);
  const titleGap = Math.round(30 * scale);

  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) throw new Error("캔버스를 생성할 수 없습니다.");
  measure.font = `${bodySize}px ${FONT_FAMILY}`;
  const story = narrative.trim() || "우리의 이야기";
  const lines = wrapLines(measure, story, width - padding * 2);

  const panelHeight =
    padding + titleSize + titleGap + lines.length * bodyLineHeight + padding;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = (img.naturalHeight || img.height) + panelHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 생성할 수 없습니다.");

  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);

  const panelTop = img.naturalHeight || img.height;

  ctx.strokeStyle = "#e3d8cd";
  ctx.lineWidth = Math.max(2 * scale, 1);
  ctx.beginPath();
  ctx.moveTo(padding, panelTop + padding * 0.5);
  ctx.lineTo(width - padding, panelTop + padding * 0.5);
  ctx.stroke();

  ctx.textBaseline = "top";
  ctx.fillStyle = ACCENT_COLOR;
  ctx.font = `700 ${titleSize}px ${FONT_FAMILY}`;
  ctx.fillText(`${title} — 우리의 이야기`, padding, panelTop + padding);

  ctx.fillStyle = TEXT_COLOR;
  ctx.font = `${bodySize}px ${FONT_FAMILY}`;
  let y = panelTop + padding + titleSize + titleGap;
  for (const line of lines) {
    ctx.fillText(line, padding, y);
    y += bodyLineHeight;
  }

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("이미지 생성에 실패했습니다."))),
      "image/png",
    );
  });
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
