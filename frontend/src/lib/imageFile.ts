/** Mobile-safe image file helpers (iOS/Android often omit or mangle MIME). */

import { isInAppWebView } from "./webview";

// Full accept list (image/* + explicit MIME types + extensions). Verified on a
// real Android device:
//   - full list      → 카메라 / 내 파일 / 사진 및 동영상  (gallery IS offered)
//   - `image/*` only  → 카메라 / 파일                    (gallery MISSING)
// So `image/*` alone drops the gallery from the Android intent chooser entirely —
// far worse than the gallery merely appearing last. We cannot control the ORDER of
// the chooser entries: that is decided by the Android intent resolver, not the web
// page. Keep the full list so the gallery is always present.
// This does NOT narrow what is accepted: real validation (empty MIME,
// octet-stream, extension fallback) is done by isAcceptedImageFile /
// filterImageFiles, which stay unchanged.
export const IMAGE_ACCEPT =
  "image/*,image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif";

// 인앱 웹뷰(카카오톡 등)는 파일 선택창을 브라우저가 아니라 앱이 직접 만든다. acceptTypes
// 가 여러 값이면 인텐트 타입을 */* 로 넓혀 버려서, image/* 로 등록된 갤러리 앱이 선택
// 후보에서 통째로 빠진다(= "작업 선택창은 뜨는데 갤러리가 없다"). 그래서 웹뷰에서만
// 단일 값 image/* 를 준다. 크롬은 accept 가 전부 이미지 타입이면 갤러리를 붙여 주므로
// 실기기에서 검증된 위 전체 목록을 그대로 쓴다(499d69d) — 어느 쪽도 되돌리지 않는다.
// 판정 자체는 webview.ts 한 곳에 있다(PDF 저장 경로도 같은 판정을 쓴다).

/** accept value for the gallery multi-select input, chosen per environment (위 주석). */
export function imageAcceptFor(userAgent: string): string {
  return isInAppWebView(userAgent) ? "image/*" : IMAGE_ACCEPT;
}

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

// Video is not supported yet (no client-side compression + the 40MB total guard; needs
// per-photo upload first). We only DETECT it so the user is told instead of it vanishing.
const VIDEO_EXT = new Set(["mp4", "mov", "m4v", "avi", "3gp"]);

/** True for a video file. Extension fallback is required: Android often sends an empty
 *  MIME or application/octet-stream, same reason isAcceptedImageFile falls back to ext. */
export function isVideoFile(file: File): boolean {
  const mime = (file.type || "").toLowerCase().trim();
  if (mime.startsWith("video/")) return true;
  return VIDEO_EXT.has(extensionOf(file));
}

export function filterImageFiles(files: FileList | File[] | null | undefined): {
  accepted: File[];
  rejected: number;
  rejectedVideos: number;
  rejectedOther: number;
} {
  const list = files ? Array.from(files) : [];
  const accepted: File[] = [];
  let rejectedVideos = 0;
  let rejectedOther = 0;
  for (const file of list) {
    if (isAcceptedImageFile(file)) {
      accepted.push(file);
    } else if (isVideoFile(file)) {
      rejectedVideos += 1;
    } else {
      rejectedOther += 1;
    }
  }
  return { accepted, rejected: rejectedVideos + rejectedOther, rejectedVideos, rejectedOther };
}

/**
 * Copy a picker FileList before the input is reset.
 * Some mobile WebViews expose a live FileList which becomes empty after
 * `input.value = ""`, even when the async preparation work has started.
 */
export function snapshotSelectedFiles(files: FileList | null | undefined): File[] {
  return files ? Array.from(files) : [];
}

function photoIdentity(file: File): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

/** Keep the first selected copy of a gallery asset across repeated picks. */
export function dedupeSelectedPhotos(files: File[], existing: File[] = []): { accepted: File[]; duplicates: number } {
  const seen = new Set(existing.map(photoIdentity));
  const accepted: File[] = [];
  let duplicates = 0;
  for (const file of files) {
    const identity = photoIdentity(file);
    if (seen.has(identity)) {
      duplicates += 1;
      continue;
    }
    seen.add(identity);
    accepted.push(file);
  }
  return { accepted, duplicates };
}

/** Keep picker order while reporting photo-limit overflow to the caller. */
export function limitSelectedPhotos(
  files: File[],
  maxPhotos: number,
  existingCount = 0,
): { accepted: File[]; skipped: number } {
  const remaining = Math.max(0, maxPhotos - existingCount);
  return {
    accepted: files.slice(0, remaining),
    skipped: Math.max(0, files.length - remaining),
  };
}

/**
 * Visually hide file input without `hidden`/`display:none`,
 * which can break programmatic .click() on some iOS WebViews.
 */
export const FILE_INPUT_CLASS = "file-input-mobile";
