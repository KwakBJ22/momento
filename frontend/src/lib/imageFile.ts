/** Mobile-safe image file helpers (iOS/Android often omit or mangle MIME). */

export const IMAGE_ACCEPT =
  "image/*,image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif";

const EXT_OK = new Set(["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"]);

const MIME_OK = new Set([
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

function extensionOf(file: File): string {
  const name = file.name || "";
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "";
  return name.slice(dot + 1).toLowerCase();
}

/** Accept gallery/camera files even when type is empty or non-standard. */
export function isAcceptedImageFile(file: File): boolean {
  const mime = (file.type || "").toLowerCase().trim();
  if (mime && MIME_OK.has(mime)) return true;
  if (mime.startsWith("image/")) return true;

  const ext = extensionOf(file);
  if (ext && EXT_OK.has(ext)) return true;

  // Some Android cameras send octet-stream with a real image name
  if ((!mime || mime === "application/octet-stream") && ext && EXT_OK.has(ext)) {
    return true;
  }
  return false;
}

export function filterImageFiles(files: FileList | File[] | null | undefined): {
  accepted: File[];
  rejected: number;
} {
  const list = files ? Array.from(files) : [];
  const accepted = list.filter(isAcceptedImageFile);
  return { accepted, rejected: list.length - accepted.length };
}

/**
 * Visually hide file input without `hidden`/`display:none`,
 * which can break programmatic .click() on some iOS WebViews.
 */
export const FILE_INPUT_CLASS = "file-input-mobile";
