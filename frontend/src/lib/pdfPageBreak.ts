// Pure A4 page-break math for the PDF export, kept free of React/CSS imports so it
// is unit-testable. See exportPdf.tsx `alignBlocksToPrintPages` for how it is used.

export const PRINT_PAGE_EPS = 2; // px tolerance so a block sitting exactly on the line is not falsely pushed

/**
 * If a block at `top` with `height` (px, relative to the page-0 origin) straddles an
 * A4 page boundary, return the margin needed to push it onto the next page; else null.
 * Blocks taller than a page cannot avoid a split, so they return null.
 */
export function printPageStraddleGap(
  top: number,
  height: number,
  pageHeightPx: number,
  eps = PRINT_PAGE_EPS,
): number | null {
  if (!(pageHeightPx > 0) || height >= pageHeightPx - eps) return null;
  const startPage = Math.floor((top + eps) / pageHeightPx);
  const endPage = Math.floor((top + height - eps) / pageHeightPx);
  return endPage > startPage ? (startPage + 1) * pageHeightPx - top : null;
}

/** html2canvas 배율. exportPdf 의 html2canvas.scale 과 같아야 한다. */
export const PDF_CANVAS_SCALE = 2;

/**
 * 마지막에 **완전히 빈 페이지**가 한 장 더 붙는 것을 막는다 (I-4-1 · §9).
 *
 * html2pdf 는 캔버스를 한 장 높이씩 잘라 페이지를 만드는데, 그 한 장 높이를
 * **내림**으로 쓴다(`dist/html2pdf.js`):
 *
 *   pxPageHeight = Math.floor(canvas.width * ratio)   // 2245  (참값 2245.885)
 *   nPages       = Math.ceil(canvas.height / pxPageHeight)
 *
 * 그래서 한 장마다 0.885px 씩 모자라고, 장수가 늘면 그 부족분이 쌓인다.
 * A4 7장짜리 문서에서는 캔버스가 15716px 인데 7장이 15715px 이라 **1px 이 남고**,
 * `ceil` 이 그 1px 을 위해 8번째 페이지를 만든다 — 그것이 아무것도 없는 마지막 쪽이다.
 * (6장에서는 우연히 딱 맞아 안 보였다. 그래서 장수에 따라 나왔다 안 나왔다 했다.)
 *
 * 캡처 높이를 **N 장에 딱 맞춰** 돌려준다. 깎이는 것은 장당 1px 미만이고 그 자리는
 * 각 장의 아래 여백(12mm) 안이라 글자·사진이 잘리지 않는다.
 */
export function wholePagesCaptureHeightPx(
  contentHeightPx: number,
  widthPx: number,
  scale: number = PDF_CANVAS_SCALE,
  /** 반올림으로 생긴 1px 남짓은 새 장으로 치지 않는다(한 장의 2%). */
  eps = 0.02,
): { pages: number; heightPx: number } | null {
  const truePageHeight = widthPx * (297 / 210);
  if (!(truePageHeight > 0) || !(contentHeightPx > 0) || !(scale > 0)) return null;
  const pages = Math.max(1, Math.ceil(contentHeightPx / truePageHeight - eps));
  // html2pdf 가 실제로 쓸 한 장 높이(내림). 이 값의 배수여야 빈 장이 생기지 않는다.
  const canvasPageHeight = Math.floor(widthPx * scale * (297 / 210));
  // ★ **정수 px** 로 돌려준다. 브라우저는 요소 높이를 정수로 반올림해서 캡처하므로
  //   1122.5px 로 두면 1123px 로 올라가 다시 1px 이 넘친다 — 소수점이 남으면 안 고쳐진다.
  return { pages, heightPx: Math.floor((pages * canvasPageHeight) / scale) };
}


/**
 * 브랜드 블록을 `우리의 이야기` 쪽 **아래**에 넣어 본다 (I-4f-1).
 *
 * 로고와 몇 줄뿐인데 종이 한 장을 쓰던 자리다. **먼저 같은 쪽에 넣어 보고, 자리가
 * 모자라면 제 쪽으로 되돌린다** — 판정 기준은 자리가 있느냐 하나다.
 * 되돌린 모양은 지금 그대로다(쪽 가운데).
 *
 * 값을 재서 정하는 것이 아니라 **들어가는지 안 들어가는지**만 본다.
 */
/**
 * 그 쪽에 내용이 다 들어가는가.
 *
 * ★ 그냥 재면 안 된다. `.print-closing` 은 `overflow: hidden` 이라 넘쳐도 안 넘친
 *   것처럼 보이고, flex 자식은 기본으로 **줄어들 수 있어**(flex-shrink: 1) 넘치는
 *   대신 눌린다. 둘 다 잠깐 풀고 재야 진짜 높이가 나온다.
 */
function measureFits(page: HTMLElement): boolean {
  const overflow = page.style.overflow;
  const children = Array.from(page.children) as HTMLElement[];
  const shrink = children.map((child) => child.style.flexShrink);
  page.style.overflow = "visible";
  for (const child of children) child.style.flexShrink = "0";
  const fits = page.scrollHeight <= page.clientHeight + 1;
  page.style.overflow = overflow;
  children.forEach((child, index) => { child.style.flexShrink = shrink[index]; });
  return fits;
}

export function placeBrandOnClosingPage(element: HTMLElement): "closing" | "own-page" {
  const closing = element.querySelector<HTMLElement>(".print-closing");
  const brand = element.querySelector<HTMLElement>(".album-renderer__brand-page");
  if (!closing || !brand || closing.contains(brand)) return "own-page";
  const parent = brand.parentElement;
  const nextSibling = brand.nextSibling;
  if (!parent) return "own-page";

  brand.dataset.printBrandInline = "1";
  closing.appendChild(brand);
  const fits = measureFits(closing);
  if (fits) return "closing";

  // 안 들어간다 — 제 쪽으로 되돌린다.
  delete brand.dataset.printBrandInline;
  parent.insertBefore(brand, nextSibling);
  return "own-page";
}
