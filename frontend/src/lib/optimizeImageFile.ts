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

/** Upload file + small preview blob from ONE decode (avoids a second full decode). */
async function optimizeWithPreview(file: File): Promise<{ file: File; previewBlob: Blob | null }> {
  // GIF is kept as-is (animation); its own file is used as the preview.
  if (isGif(file)) return { file, previewBlob: null };
  let image: CanvasImageSource;
  try {
    image = await decodeImage(file);
  } catch (error) {
    // HEIC decode unsupported → original goes to the server path, no preview.
    if (/\.(heic|heif)$/i.test(file.name) || /image\/hei[cf]/i.test(file.type)) return { file, previewBlob: null };
    throw error;
  }
  try {
    const { width, height } = imageSize(image);
    if (!width || !height) throw new Error("Image dimensions are unavailable.");
    // Upload first, then preview — each canvas is released before the next.
    const uploadFile = await encodeUploadFromImage(image, width, height, file);
    let previewBlob: Blob | null = null;
    try {
      previewBlob = await encodePreviewFromImage(image, width, height);
    } catch {
      previewBlob = null; // preview is best-effort; the upload file already succeeded
    }
    return { file: uploadFile, previewBlob };
  } finally {
    if (image instanceof ImageBitmap) image.close();
  }
}

/**
 * Like prepareForUpload, but also returns a small preview blob decoded from the
 * SAME bitmap. Never drops a photo: on any failure the original file is used for
 * upload and previewBlob is null (caller falls back to the upload file for preview).
 */
export async function prepareUploadAndPreview(file: File): Promise<{ file: File; previewBlob: Blob | null }> {
  try {
    return await optimizeWithPreview(file);
  } catch (cause) {
    if (file.size <= MAX_ORIGINAL_IMAGE_BYTES) return { file, previewBlob: null };
    throw cause;
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
