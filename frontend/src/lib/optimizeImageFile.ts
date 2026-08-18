const MAX_EDGE = 2560;
// The on-screen preview spans the full width, so 480px looks blurry; 800px stays
// sharp while its decode memory (~1.9MB) is ~1/10 of the 2560px upload file's,
// which is what was exhausting the Android tab's decode budget.
const PREVIEW_MAX_EDGE = 800;
const PREVIEW_QUALITY = 0.75;
// Must match the private Supabase Storage bucket's per-object limit.
export const MAX_ORIGINAL_IMAGE_BYTES = 10 * 1024 * 1024;
// Realistic mobile total: 100MB effectively meant "no cap" and uploads died with
// an opaque "네트워크 연결을 확인해주세요". 40MB is what a phone can actually send.
export const MAX_TOTAL_UPLOAD_BYTES = 40 * 1024 * 1024;

/** True if adding `addedBytes` keeps the whole selection within the upload cap. */
export function fitsWithinUploadTotal(currentTotalBytes: number, addedBytes: number): boolean {
  return currentTotalBytes + addedBytes <= MAX_TOTAL_UPLOAD_BYTES;
}

function isGif(file: File): boolean {
  return file.type.toLowerCase() === "image/gif" || /\.gif$/i.test(file.name);
}

function renamedFile(file: File, blob: Blob, extension: "jpg" | "png", type: string): File {
  const stem = file.name.replace(/\.[^.]+$/, "") || "photo";
  return new File([blob], `${stem}.${extension}`, { type, lastModified: file.lastModified });
}

async function decodeImage(file: File): Promise<CanvasImageSource> {
  if ("createImageBitmap" in window) return createImageBitmap(file, { imageOrientation: "from-image" });
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Image decode failed."));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 파일 **앞부분만** 읽어 원본 크기를 알아낸다 — 미리보기를 작게 디코드하기 위해서다.
 *
 * ★ 왜 필요한가: createImageBitmap 에 resize 를 주면 4000×3000 비트맵(48MB)을
 *   아예 만들지 않는다. 그런데 비율을 지키려면 **어느 변이 긴지**를 먼저 알아야 한다.
 *   그것 때문에 원본을 통째로 디코드하면 아낀 것이 없다.
 * ★ 파일 전체를 읽지 않는다(EXIF 를 읽는 자리와 같은 이유 — exifCaptureDate.ts).
 * ★ 모르면 null 이다. 그러면 부르는 쪽이 **지금 경로 그대로** 돈다. 짐작하지 않는다.
 */
const SIZE_HEAD_BYTES = 128 * 1024;

function readJpegSize(view: DataView): { width: number; height: number } | null {
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    // 0xFF 채움 바이트는 건너뛴다.
    if (view.getUint8(offset) !== 0xff) return null;
    let marker = view.getUint8(offset + 1);
    while (marker === 0xff && offset + 2 < view.byteLength) {
      offset += 1;
      marker = view.getUint8(offset + 1);
    }
    // 길이가 없는 표식(재시작·EOI 따위)은 두 바이트만 차지한다.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const length = view.getUint16(offset + 2);
    // SOF0~SOF15 (0xC4 DHT · 0xC8 JPG · 0xCC DAC 는 크기가 아니다).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (offset + 9 > view.byteLength) return null;
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

function readPngSize(view: DataView): { width: number; height: number } | null {
  if (view.byteLength < 24) return null;
  if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) return null;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function probeImageSize(file: File): Promise<{ width: number; height: number } | null> {
  try {
    const head = file.slice(0, Math.min(SIZE_HEAD_BYTES, file.size));
    const view = new DataView(await head.arrayBuffer());
    const size = readJpegSize(view) || readPngSize(view);
    return size && size.width > 0 && size.height > 0 ? size : null;
  } catch {
    return null;
  }
}

/**
 * 미리보기용 **작은** 디코드. 800 기준으로 바로 줄여서 받는다.
 *
 * ★ 한쪽 변만 준다 — 둘 다 주면 늘어난 비율로 찌그러진다. 한쪽만 주면 브라우저가
 *   비율을 지키고, EXIF 회전이 어느 순서로 적용되든 찌그러지지 않는다.
 * ★ 원본이 이미 작으면 늘리지 않는다(scale ≥ 1 이면 그냥 디코드한다).
 * ★ createImageBitmap 이 없거나 크기를 못 읽으면 null 이다 — 부르는 쪽이 지금 경로로 간다.
 */
async function decodeSmallForPreview(file: File): Promise<CanvasImageSource | null> {
  if (!("createImageBitmap" in window)) return null;
  const size = await probeImageSize(file);
  if (!size) return null;
  const longEdge = Math.max(size.width, size.height);
  const options: ImageBitmapOptions = { imageOrientation: "from-image", resizeQuality: "high" };
  if (longEdge > PREVIEW_MAX_EDGE) {
    if (size.width >= size.height) options.resizeWidth = PREVIEW_MAX_EDGE;
    else options.resizeHeight = PREVIEW_MAX_EDGE;
  }
  return createImageBitmap(file, options);
}

function imageSize(image: CanvasImageSource): { width: number; height: number } {
  if (image instanceof HTMLImageElement) return { width: image.naturalWidth, height: image.naturalHeight };
  const sizedImage = image as ImageBitmap;
  return { width: sizedImage.width, height: sizedImage.height };
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Image encode failed."))), type, quality));
}

function hasTransparency(context: CanvasRenderingContext2D, width: number, height: number): boolean {
  const pixels = context.getImageData(0, 0, width, height).data;
  for (let index = 3; index < pixels.length; index += 4) if (pixels[index] !== 255) return true;
  return false;
}

/** Draw an already-decoded image onto a canvas scaled so its long edge ≤ maxEdge. */
function drawScaled(image: CanvasImageSource, srcWidth: number, srcHeight: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(srcWidth, srcHeight));
  const width = Math.max(1, Math.round(srcWidth * scale));
  const height = Math.max(1, Math.round(srcHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  // No willReadFrequently: it forces a software canvas (worse memory/speed on
  // Android). getImageData is used only on the PNG-transparency path below.
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable.");
  context.drawImage(image, 0, 0, width, height);
  return { canvas, context, width, height };
}

/** Release the canvas backing buffer immediately so peak memory doesn't stack up. */
function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/** Encode the 2560px upload file from an already-decoded image (shared core). */
async function encodeUploadFromImage(image: CanvasImageSource, srcWidth: number, srcHeight: number, file: File): Promise<File> {
  const { canvas, context, width, height } = drawScaled(image, srcWidth, srcHeight, MAX_EDGE);
  const isPng = file.type.toLowerCase() === "image/png" || /\.png$/i.test(file.name);
  const keepTransparency = isPng && hasTransparency(context, width, height);
  const blob = keepTransparency ? await canvasBlob(canvas, "image/png") : await canvasBlob(canvas, "image/jpeg", 0.85);
  releaseCanvas(canvas);
  const optimized = renamedFile(file, blob, keepTransparency ? "png" : "jpg", keepTransparency ? "image/png" : "image/jpeg");
  return optimized.size < file.size ? optimized : file;
}

/** Encode a small 800px JPEG preview from the same decoded image. */
async function encodePreviewFromImage(image: CanvasImageSource, srcWidth: number, srcHeight: number): Promise<Blob> {
  const { canvas } = drawScaled(image, srcWidth, srcHeight, PREVIEW_MAX_EDGE);
  const blob = await canvasBlob(canvas, "image/jpeg", PREVIEW_QUALITY);
  releaseCanvas(canvas);
  return blob;
}

/** Prepares images sequentially in the browser while retaining GIF animation and file timestamps. */
export async function optimizeImageFile(file: File): Promise<File> {
  if (isGif(file)) return file;
  let image: CanvasImageSource;
  try {
    image = await decodeImage(file);
  } catch (error) {
    // Some browsers cannot decode HEIC. Preserve the existing server-side HEIC path in that case.
    if (/\.(heic|heif)$/i.test(file.name) || /image\/hei[cf]/i.test(file.type)) return file;
    throw error;
  }
  try {
    const { width, height } = imageSize(image);
    if (!width || !height) throw new Error("Image dimensions are unavailable.");
    return await encodeUploadFromImage(image, width, height, file);
  } finally {
    if (image instanceof ImageBitmap) image.close();
  }
}

/**
 * 고르는 순간 화면에 붙일 **미리보기 하나**만 만든다 — 올릴 파일은 만들지 않는다.
 *
 * 예전에는 고르는 자리에서 `2560 축소 → 인코딩(올릴 파일) → 800 축소 → 인코딩` 을
 * 다 끝낸 뒤에야 사진이 떴다. 화면에 필요 없는 일을 먼저 끝낸 것이다 —
 * 카메라 원본이면 거기서 대부분의 시간이 갔다. 무거운 쪽은 `앨범 만들기` 로 미룬다.
 *
 * ★ **원본을 화면에 그대로 띄우지 않는다**(K-10 — 안드로이드 탭이 죽던 원인).
 *   여기서 만드는 것은 언제나 긴 변 800 이다. 순서만 바꾼 것이지 규칙은 그대로다.
 * ★ 못 만들면 null 이다. 사진을 버리지 않는다 — 미리보기만 없다(GIF·HEIC·디코드 실패).
 */
export async function makePreviewBlob(file: File): Promise<Blob | null> {
  // GIF 는 움직임을 지키려고 그대로 둔다(부르는 쪽이 파일 자체를 미리보기로 쓴다).
  if (isGif(file)) return null;
  let image: CanvasImageSource;
  try {
    image = (await decodeSmallForPreview(file)) ?? (await decodeImage(file));
  } catch {
    return null;
  }
  try {
    const { width, height } = imageSize(image);
    if (!width || !height) return null;
    return await encodePreviewFromImage(image, width, height);
  } catch {
    return null;
  } finally {
    if (image instanceof ImageBitmap) image.close();
  }
}

/**
 * Prepares a file for upload, never dropping a usable photo.
 * If in-browser optimization fails (HEIC decode, canvas limits, encode null, ...),
 * fall back to the original file — the backend re-encodes it (including HEIC).
 * Only rethrows when the original itself is unusable (over the per-object limit).
 */
export async function prepareForUpload(
  file: File,
  optimize: (input: File) => Promise<File> = optimizeImageFile,
): Promise<File> {
  try {
    return await optimize(file);
  } catch (cause) {
    if (file.size <= MAX_ORIGINAL_IMAGE_BYTES) return file;
    throw cause;
  }
}

export function formatUploadSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
