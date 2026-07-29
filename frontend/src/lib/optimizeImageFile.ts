const MAX_EDGE = 2560;
// Must match the private Supabase Storage bucket's per-object limit.
export const MAX_ORIGINAL_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_UPLOAD_BYTES = 100 * 1024 * 1024;

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
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas is unavailable.");
    context.drawImage(image, 0, 0, targetWidth, targetHeight);
    const isPng = file.type.toLowerCase() === "image/png" || /\.png$/i.test(file.name);
    const keepTransparency = isPng && hasTransparency(context, targetWidth, targetHeight);
    const blob = keepTransparency ? await canvasBlob(canvas, "image/png") : await canvasBlob(canvas, "image/jpeg", 0.85);
    const optimized = renamedFile(file, blob, keepTransparency ? "png" : "jpg", keepTransparency ? "image/png" : "image/jpeg");
    return optimized.size < file.size ? optimized : file;
  } finally {
    if (image instanceof ImageBitmap) image.close();
  }
}

export function formatUploadSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
