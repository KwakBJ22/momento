import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { uploadAlbum } from "../lib/api";
import { albumCreationTiming } from "../lib/albumCreation";
import { CREATION_PROGRESS_TICK_MS, easeTowardTarget } from "../lib/creationProgress";
import { createId } from "../lib/id";
import { dedupeSelectedPhotos, FILE_INPUT_CLASS, filterImageFiles, imageAcceptFor, limitSelectedPhotos, snapshotSelectedFiles } from "../lib/imageFile";
import { currentUserAgent } from "../lib/webview";
import { fitsWithinUploadTotal, makePreviewBlob, MAX_ORIGINAL_IMAGE_BYTES, prepareForUpload } from "../lib/optimizeImageFile";
import { runOrderedPool } from "../lib/orderedPool";
import { extractOriginalCaptureDate, extractOriginalGps, toUploadFileMeta, type ExifGps } from "../lib/exifCaptureDate";
import { yieldToPaint } from "../lib/yieldToPaint";
import type { AlbumCategory, PhotoItem, StoryPayload } from "../types";
import { recommendedTemplateType, TEMPLATE_TYPE_TO_LAYOUT } from "../types";
import PhotoCommentList from "./PhotoCommentList";
import AlbumAppearancePicker from "./AlbumAppearancePicker";
import { resolveAlbumSkin, type AlbumPaper, type AlbumSkin } from "../lib/albumSkin";
import { asksAppearanceBeforeCreate, droppedFileNotices, noPhotosAddedNotice, pickButtonLabel, preparingLabel, showsEmptyState, showsSelectionCount, showsSubmitButton, TOTAL_OVER_NOTICE, uploadingLabel } from "../lib/uploadFormView";
import "./UploadForm.css";
import { userFacingError } from "../lib/userFacingError";

const MAX_PHOTOS = 30;
const UPLOAD_TIMEOUT_MS = 600_000;
// How many photos are decoded/encoded at once during preparation.
// ⚠️ MEMORY-REGRESSION DANGER ZONE (fbedc19: many concurrent decodes restarted the
// Android tab). 2 is safe because the preview is only 800px; DO NOT raise this.
const PREPARE_CONCURRENCY = 2;

interface UploadFormProps {
  category: AlbumCategory;
  /** Set when the create step was restored after a tab restart: chosen files are
   *  gone, so prompt a re-pick through the existing error slot. */
  photosNeedReselect?: boolean;
  /** 고른 장수를 부모에게 알린다 — 홈으로 나갈 때 물을지 정하는 데 쓴다(K-20).
   *  세는 곳은 여기 하나다. 부모가 따로 세지 않는다. */
  onPhotoCountChange?: (count: number) => void;
  onSuccess: (result: { albumId: string; generationJobId: string | null; previewUrls: string[]; submittedAt: number; responseAt: number; photoCount: number }) => void;
  onCancel?: () => void;
}

// 파일 선택창의 accept — 환경에 따라 한 번만 정한다(imageFile.ts 주석 참고).
const PHOTO_ACCEPT = imageAcceptFor(currentUserAgent());

/**
 * 고른 사진 한 장. **`file` 은 원본이다** (2026-08-16).
 *
 * 예전에는 여기 들어오는 것이 이미 2560 으로 줄인 파일이었다 — 그래서 고르는 자리에서
 * 기다렸다. 이제 원본을 그대로 들고 있다가 `앨범 만들기` 를 누를 때 변환한다.
 * 화면에 붙는 것은 여전히 800 미리보기다(K-10).
 */
function createPhotoItem(file: File, previewBlob: Blob | null, capturedAt: string | null, gps: ExifGps | null): PhotoItem {
  // Prefer the small 800px preview; fall back to the original when it is null
  // (GIF / HEIC / decode failure), preserving the current behavior.
  const previewSource = previewBlob ?? file;
  // ★ 덩어리를 함께 들고 있는다 — 주소가 죽었을 때 파일을 다시 읽지 않고 되살리려고다(K-10).
  return { id: createId(), file, previewUrl: URL.createObjectURL(previewSource), previewSource, story: "", capturedAt, gps };
}

export default function UploadForm({ category, photosNeedReselect = false, onPhotoCountChange, onSuccess }: UploadFormProps) {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [coverPhotoId, setCoverPhotoId] = useState<string | null>(null);
  // 앨범 모양 · 종이 색 — **시트가 뜨는 순간 이미 골라져 있다.** 추천 규칙은
  // lib/albumSkin 하나다(여기서 새로 정하지 않는다). 아무것도 안 고르고
  // `이대로 만들기` 를 눌러도 이 값이 그대로 실려 간다.
  const [appearance, setAppearance] = useState<{ skin: AlbumSkin; paper: AlbumPaper }>(() => resolveAlbumSkin({ category }));
  // 물어본 적이 있는가 — `이대로 만들기` 를 누른 때만 참이다(닫기는 취소다).
  const [appearanceAsked, setAppearanceAsked] = useState(false);
  const [showsAppearanceSheet, setShowsAppearanceSheet] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  // Progress of the current preparation batch, shown in the existing count slot.
  const [preparingProgress, setPreparingProgress] = useState<{ done: number; total: number } | null>(null);
  // Eased 0–100 value for the thin prepare bar. The count text stays exact; the bar
  // glides between the coarse (2-at-a-time) completion counts so it doesn't jump.
  const [prepareDisplay, setPrepareDisplay] = useState(0);
  // Two distinct slots: `notice` is neutral information (동영상 제외·중복 제외·장수 초과·
  // 재선택 안내) — no "다시 시도". `error` is a genuine upload failure where retry is
  // meaningful. Keeping them separate stops an informational message from rendering the
  // retry button (which would (re)start an album upload the user never asked for).
  const [notice, setNotice] = useState<string | null>(photosNeedReselect ? "사진을 다시 골라주세요." : null);
  const [error, setError] = useState<string | null>(null);
  const [progressStep, setProgressStep] = useState<number | null>(null);
  // `앨범 만들기` 를 누른 뒤 사진을 변환하는 동안의 진행(만드는 중 화면에 한 줄).
  const [uploadPrepare, setUploadPrepare] = useState<{ done: number; total: number } | null>(null);
  // 이미 변환한 파일. `다시 시도` 에서 같은 일을 두 번 하지 않는다.
  const preparedFilesRef = useRef<Map<string, File>>(new Map());
  const abortRef = useRef<AbortController | null>(null);
  const operationIdRef = useRef<string | null>(null);
  const photosRef = useRef<PhotoItem[]>([]);
  const previewsTransferredRef = useRef(false);
  // Records whether the tab was ever backgrounded — the suspected root of the
  // "네트워크 연결을 확인해주세요" TypeError (backgrounded tab kills the in-flight fetch).
  const wasHiddenRef = useRef(false);

  useEffect(() => { photosRef.current = photos; }, [photos]);
  // 장수가 바뀔 때만 알린다. 부모는 이 값으로 "나가면 사라진다"를 물을지 정한다(K-20).
  useEffect(() => { onPhotoCountChange?.(photos.length); }, [photos.length, onPhotoCountChange]);
  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === "hidden") wasHiddenRef.current = true; };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  // Glide the prepare bar toward done/total (no server polling here — the target is just
  // the completion ratio). Reuses the album-creation easing so there's one implementation.
  useEffect(() => {
    if (!isPreparing) { setPrepareDisplay(0); return; }
    const target = preparingProgress && preparingProgress.total > 0
      ? (preparingProgress.done / preparingProgress.total) * 100
      : 0;
    const id = window.setInterval(() => {
      setPrepareDisplay((current) => easeTowardTarget(current, target));
    }, CREATION_PROGRESS_TICK_MS);
    return () => window.clearInterval(id);
  }, [isPreparing, preparingProgress]);
  useEffect(() => () => {
    if (!previewsTransferredRef.current) {
      for (const photo of photosRef.current) URL.revokeObjectURL(photo.previewUrl);
    }
  }, []);

  useEffect(() => {
    setCoverPhotoId((current) => (
      current && photos.some((photo) => photo.id === current)
        ? current
        : photos[0]?.id || null
    ));
  }, [photos]);
  const uploadInFlightRef = useRef(false);
  // Videos are filtered out (not supported yet). Count how many the user tried to add
  // across all picks; the total rides along on the upload request as a demand signal
  // (there is no other frontend->backend event path). See createAlbum.
  const droppedVideoCountRef = useRef(0);
  const templateType = recommendedTemplateType(category);

  const addFiles = useCallback(async (files: FileList | File[] | null) => {
    if (isPreparing) return;
    const { accepted, rejectedVideos, rejectedOther } = filterImageFiles(files);
    if (!accepted.length) {
      droppedVideoCountRef.current += rejectedVideos;
      setNotice(noPhotosAddedNotice(rejectedVideos, rejectedOther > 0));
      return;
    }
    const { accepted: unique, duplicates } = dedupeSelectedPhotos(accepted, photos.map((photo) => photo.file));
    const { accepted: limited, skipped } = limitSelectedPhotos(unique, MAX_PHOTOS, photos.length);
    if (!limited.length) {
      setNotice(`사진은 한 번에 최대 ${MAX_PHOTOS}장까지 올릴 수 있어요. 앨범을 만든 뒤에 더 추가할 수 있어요.`);
      return;
    }

    setIsPreparing(true);
    setError(null);
    setNotice(null);
    setPreparingProgress({ done: 0, total: limited.length });
    const failures: string[] = [];
    let settledCount = 0;
    try {
      // Prepare up to PREPARE_CONCURRENCY photos at once for speed, but deliver the
      // results in the user's selected order (runOrderedPool) so the album order is
      // preserved. A photo that fails preparation is delivered as a failure and does
      // NOT block the rest.
      await runOrderedPool(
        limited,
        PREPARE_CONCURRENCY,
        async (file) => {
          if (file.size > MAX_ORIGINAL_IMAGE_BYTES) {
            throw { tooBig: true, name: file.name };
          }
          // EXIF failure must not drop the photo — capture date is optional.
          let capturedAt: string | null = null;
          try {
            capturedAt = await extractOriginalCaptureDate(file);
          } catch (cause) {
            console.warn("Capture date extraction failed", { cause, fileName: file.name });
          }
          // ★ 장소도 **여기서** 읽는다. 바로 아래 미리보기를 만들 때 canvas 가
          //   다시 그리면서 EXIF 를 통째로 지우기 때문이다 — 촬영일과 같은 이유다.
          //   서버는 이 좌표를 시·군 이름으로 바꾼 뒤 버린다(좌표는 저장하지 않는다).
          //   실패해도 사진을 버리지 않는다. 장소가 안 붙을 뿐이다.
          let gps: ExifGps | null = null;
          try {
            gps = await extractOriginalGps(file);
          } catch (cause) {
            console.warn("Location extraction failed", { cause, fileName: file.name });
          }
          // ★ 여기서는 **미리보기 하나만** 만든다(2026-08-16). 올릴 파일(2560)은
          //   `앨범 만들기` 를 누를 때 만든다 — 기다림을 없애는 게 아니라 기다려도
          //   되는 자리로 옮기는 것이다. 실패해도 사진을 잃지 않는다(미리보기만 없다).
          const previewBlob = await makePreviewBlob(file);
          // Yield a frame so decode/canvas buffers can be reclaimed AND the counter
          // paints before the next one starts — relieves the memory spike that
          // restarts the Android tab and keeps the progress visible without a scroll.
          // ★ 그리기를 기다리되 무한정은 아니다: 화면이 숨겨지면 프레임이 오지 않아
          // 여기서 준비가 통째로 멈춘다(F-3). lib/yieldToPaint 참고.
          await yieldToPaint();
          return { file, previewBlob, capturedAt, gps };
        },
        (result) => {
          // Input order: append photos so the album keeps the user's selected order.
          if (!result.ok) {
            const error = result.error as { tooBig?: boolean; name?: string } | undefined;
            if (error?.tooBig) {
              failures.push(`${error.name}: 이 사진은 용량이 너무 큽니다. 10MB 이하의 사진을 선택해주세요.`);
            }
            return;
          }
          const { file: original, previewBlob, capturedAt, gps } = result.value;
          // ★ 총 용량 판정은 **제출할 때** 한다(2026-08-16). 여기서는 아직 변환 전이라
          //   잴 것이 원본 크기뿐이고, 그것으로 막으면 실제로는 담기는 사진을 막는다.
          //   고르는 화면의 숫자는 원본 크기로 어림잡은 값이다.
          const item = createPhotoItem(original, previewBlob, capturedAt, gps);
          setPhotos((previous) => [...previous, item]);
          setCoverPhotoId((current) => current || item.id);
        },
        () => {
          // Completion order: advance the counter the instant a photo finishes, so it
          // climbs smoothly instead of jumping in chunks when an early photo is slow.
          settledCount += 1;
          setPreparingProgress({ done: settledCount, total: limited.length });
        },
        // ★ 첫 한 장은 혼자 준비한다(J-1b-2). 처음부터 둘이 붙으면 서로 경합해 둘 다
        // 늦게 끝나고, 첫 숫자가 뜨기까지 두 장 몫을 기다린다. 동시 장수 2 는 그대로다.
        { soloFirst: true },
      );
      if (duplicates > 0) failures.push(`사진 ${duplicates}장은 이미 선택되어 추가하지 않았습니다.`);
      if (skipped > 0) failures.push(`사진 ${skipped}장은 추가되지 않았습니다. 한 번에 최대 ${MAX_PHOTOS}장까지 올릴 수 있어요.`);
      droppedVideoCountRef.current += rejectedVideos;
      failures.push(...droppedFileNotices(rejectedVideos, rejectedOther));
      setNotice(failures.length ? failures.join(" ") : null);
    } finally {
      setIsPreparing(false);
      setPreparingProgress(null);
    }
  }, [isPreparing, photos.length]);

  const removePhoto = (id: string) => {
    setPhotos((previous) => {
      const photo = previous.find((item) => item.id === id);
      if (photo) URL.revokeObjectURL(photo.previewUrl);
      return previous.filter((item) => item.id !== id);
    });
  };

  /**
   * 미리보기 주소가 죽었을 때 **그 사진 것만** 한 번 다시 만든다 (K-10).
   *
   * 실기기에서 3장을 고르면 앞쪽 미리보기가 빈 분홍 박스가 됐다(노트20 · 카카오톡 웹뷰).
   * 파일 자체는 멀쩡하다 — 그대로 만든 앨범에는 세 장 다 나온다. 주소만 죽는 것이다.
   *
   * ★ 주소는 사진 한 장에 하나다. 여기서도 **다시 그릴 때가 아니라 깨졌을 때만** 만든다.
   *   죽은 주소는 그 자리에서 거두고, 두 번째로 깨지면 회색 자리를 둔다(더 시도하면
   *   깨짐→다시 만듦 이 끝없이 돈다).
   */
  const repairPreview = (id: string) => {
    // ★ K-10 계측 (2026-08-15) — 고치는 것이 아니라 **재는** 줄이다. 화면에는 아무것도
    //   내지 않는다. 세는 자리는 여기 하나이므로 상태 갱신 **밖**에서 남긴다
    //   (updater 안에 두면 React 가 두 번 부를 때 두 번 찍힌다).
    console.warn("[K-10] repair", { index: photosRef.current.findIndex((photo) => photo.id === id) });
    setPhotos((previous) => previous.map((photo) => {
      if (photo.id !== id || photo.previewRetried) return photo;
      URL.revokeObjectURL(photo.previewUrl);
      return { ...photo, previewUrl: URL.createObjectURL(photo.previewSource), previewRetried: true };
    }));
  };

  const updatePhotoComment = (id: string, story: string) => {
    setPhotos((previous) => previous.map((photo) => (photo.id === id ? { ...photo, story } : photo)));
  };

  const handlePickerChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = snapshotSelectedFiles(event.currentTarget.files);
    if (import.meta.env.DEV) console.debug("[우리앨범] Album picker files selected", { count: selected.length });
    // Reset only after taking a stable copy so the same files can be selected again.
    event.currentTarget.value = "";
    void addFiles(selected);
  };

  /**
   * 고른 사진을 올릴 파일로 바꾼다 — 긴 변 2560(§9 · MAX_EDGE 는 바꾸지 않는다).
   *
   * ★ 실패해도 사진을 잃지 않는다: 변환이 안 되면 원본을 올린다(서버가 다시 굽는다).
   * ★ 한 번 바꾼 것은 기억한다 — `다시 시도` 가 같은 일을 반복하지 않는다.
   */
  const prepareChosenPhotos = async (chosen: PhotoItem[]): Promise<File[]> => {
    setUploadPrepare({ done: 0, total: chosen.length });
    let done = 0;
    const results: File[] = [];
    await runOrderedPool(
      chosen,
      PREPARE_CONCURRENCY,
      async (photo) => {
        const cached = preparedFilesRef.current.get(photo.id);
        if (cached) return cached;
        let prepared: File;
        try {
          prepared = await prepareForUpload(photo.file);
        } catch {
          prepared = photo.file; // 사진을 버리지 않는다.
        }
        preparedFilesRef.current.set(photo.id, prepared);
        // 숫자가 화면에 닿게 한 프레임 내준다(고르는 자리와 같은 이유).
        await yieldToPaint();
        return prepared;
      },
      (result) => {
        const photo = chosen[results.length];
        results.push(result.ok ? result.value : photo.file);
      },
      () => {
        done += 1;
        setUploadPrepare({ done, total: chosen.length });
      },
    );
    return results;
  };

  const createAlbum = async () => {
    if (isPreparing || isSubmitting || uploadInFlightRef.current) return;
    if (!photos.length) {
      setNotice("사진을 한 장 이상 선택해주세요.");
      return;
    }
    uploadInFlightRef.current = true;
    const submittedAt = performance.now();
    albumCreationTiming("SUBMIT", { photo_count: photos.length });
    setIsSubmitting(true);
    setError(null);
    setNotice(null);
    setProgressStep(0);
    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutTimer = window.setTimeout(() => controller.abort("timeout"), UPLOAD_TIMEOUT_MS);
    try {
      // ★ 무거운 변환(긴 변 2560)이 **여기**로 옮겨 왔다(2026-08-16). 고르는 자리에서는
      //   미리보기만 만든다. 이 자리에는 이미 `만드는 중` 화면이 있어 사용자가 기다림을
      //   예상한다 — 기다림을 없앤 것이 아니라 기다려도 되는 자리로 옮긴 것이다.
      //   동시 2장 상한은 그대로다(메모리 회귀 위험 구간).
      const uploadFiles = await prepareChosenPhotos(photos);
      // 총 용량 판정은 **변환한 뒤**다. 넘치면 그 자리에서 우리 말로 알린다(§11).
      const totalBytes = uploadFiles.reduce((sum, file) => sum + file.size, 0);
      if (!fitsWithinUploadTotal(0, totalBytes)) {
        setNotice(TOTAL_OVER_NOTICE);
        return;
      }
      const formData = new FormData();
      uploadFiles.forEach((file) => formData.append("photos", file, file.name || "photo.jpg"));
      const stories: StoryPayload[] = photos.map((photo, order) => ({ order, user: "", text: photo.story.trim() }));
      formData.append("stories", JSON.stringify(stories));
      formData.append("category", category);
      formData.append("template_type", templateType);
      formData.append("template", TEMPLATE_TYPE_TO_LAYOUT[templateType]);
      formData.append("title", "우리의 추억");
      formData.append("description", "");
      // 모양은 사진을 더할 때와 **같은 함수**가 만든다 — 두 자리가 갈리지 않게.
      formData.append("file_meta", JSON.stringify(photos.map((photo) => toUploadFileMeta(photo.capturedAt, photo.gps))));
      formData.append("cover_photo_order", String(Math.max(0, photos.findIndex((photo) => photo.id === coverPhotoId))));
      // 만들기 전에 고른 모양. 서버가 목록으로 한 번 더 거른다 — 밖이면 빈 값이다(§10).
      formData.append("skin", appearance.skin);
      formData.append("paper", appearance.paper);
      // Demand signal only: how many videos the user tried to add (all filtered out).
      formData.append("dropped_video_count", String(droppedVideoCountRef.current));
      const operationId = operationIdRef.current || crypto.randomUUID();
      operationIdRef.current = operationId;
      albumCreationTiming("UPLOAD_REQUEST_STARTED", { photo_count: photos.length });
      // Works logged-in or as a guest; a guest response's token is persisted by uploadAlbum.
      const created = await uploadAlbum(formData, { operationId, signal: controller.signal });
      const responseAt = performance.now();
      operationIdRef.current = null;
      previewsTransferredRef.current = true;
      onSuccess({
        albumId: created.album_id,
        generationJobId: created.generation_job_id ?? null,
        previewUrls: photos.slice(0, 5).map((photo) => photo.previewUrl),
        submittedAt,
        responseAt,
        photoCount: photos.length,
      });
    } catch (cause: unknown) {
      // Visibility diagnostics: a TypeError here is likely a fetch killed by the
      // tab being backgrounded/restarted, not a real network fault. User copy unchanged.
      console.error("Album upload failed", {
        cause,
        photoCount: photos.length,
        visibilityState: document.visibilityState,
        wasHiddenDuringSession: wasHiddenRef.current,
      });
      const reason = cause instanceof DOMException && cause.name === "AbortError"
        ? "요청 시간이 오래 걸리고 있습니다. 네트워크를 확인한 뒤 다시 시도해주세요."
        : cause instanceof TypeError
          ? "네트워크 연결을 확인해주세요."
          : userFacingError(cause, "알 수 없는 오류가 발생했습니다.");
      setError(`업로드에 실패했습니다. ${reason}`);
    } finally {
      window.clearTimeout(timeoutTimer);
      abortRef.current = null;
      uploadInFlightRef.current = false;
      setIsSubmitting(false);
      setProgressStep(null);
      setUploadPrepare(null);
    }
  };

  const cancelUpload = () => abortRef.current?.abort();

  /**
   * `앨범 만들기` 를 눌렀을 때 — **모양을 한 번 묻고** 만든다(2026-08-18 PO).
   *
   * ★ 새 페이지를 만들지 않는다(§7). 이미 있는 시트 껍데기 안에서 끝난다.
   * ★ 닫기로 닫으면 만들기가 **진행되지 않는다.** 취소한 것이므로 물어본 것으로도
   *   치지 않는다 — 다시 누르면 또 뜬다.
   */
  const requestCreate = () => {
    if (asksAppearanceBeforeCreate(appearanceAsked)) {
      setShowsAppearanceSheet(true);
      return;
    }
    void createAlbum();
  };

  const closeAppearanceSheet = () => setShowsAppearanceSheet(false);

  const confirmAppearance = () => {
    setAppearanceAsked(true);
    setShowsAppearanceSheet(false);
    void createAlbum();
  };

  const hasPhotos = photos.length > 0;

  return (
    <div className="upload-form story-first-upload">
      <header className="upload-form__intro">
        <h1 className="upload-form__title">어떤 사진을 담을까요?</h1>
        <p className="upload-form__subtitle">한 번에 {MAX_PHOTOS}장까지 담을 수 있어요. 다 담지 못했다면 앨범을 만든 뒤에 더 추가할 수 있어요.<br />고른 순서가 아니라 찍은 날짜로 정리돼요.</p>
      </header>
      <section className="upload-form__picker" aria-label="사진 선택">
        {/* Primary until photos exist; once chosen it steps down to secondary and the
            "앨범 만들기" below becomes the single primary (DESIGN_SYSTEM §7). */}
        <label className={hasPhotos ? "gallery-btn gallery-btn--secondary" : "gallery-btn"}>
          {pickButtonLabel(photos.length)}
          <input className={FILE_INPUT_CLASS} type="file" accept={PHOTO_ACCEPT} multiple onChange={handlePickerChange} />
        </label>
        <label className="upload-form__camera-link">
          바로 촬영하기
          <input className={FILE_INPUT_CLASS} type="file" accept="image/*" capture="environment" multiple onChange={handlePickerChange} />
        </label>
        {showsEmptyState(photos.length, isPreparing) ? (
          <div className="drop-zone" role="button" tabIndex={0} onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("drop-zone--active"); }} onDragLeave={(event) => event.currentTarget.classList.remove("drop-zone--active")} onDrop={(event) => { event.preventDefault(); event.currentTarget.classList.remove("drop-zone--active"); void addFiles(event.dataTransfer.files); }}>
            <p className="drop-zone__title">고른 사진이 여기에 모여요</p>
            <p className="notice notice--info drop-zone__hint">한 번에 {MAX_PHOTOS}장까지 담을 수 있어요. 앨범을 만든 뒤에 더 추가할 수 있어요.</p>
          </div>
        ) : null}
        {/* ★ 용량을 쓰지 않는다 (PO 결정 2026-08-18). 무거운 변환을 `앨범 만들기` 로
            미루면서 이 숫자가 **원본 합계**가 됐다 — 실제로 올라가는 것은 긴 변 2560 으로
            줄인 파일이라 한참 작은데, 화면에는 상한(40MB)보다 큰 수가 뜰 수 있었다.
            장수는 사용자가 쓰는 값이고, 용량은 그렇지 않다. */}
        {showsSelectionCount(photos.length) && !isPreparing ? (
          <p className="upload-form__count" aria-live="polite">{MAX_PHOTOS}장 중 <strong className="upload-form__count-strong">{photos.length}장</strong></p>
        ) : null}
      </section>
      {/* Direct child of .upload-form (not the picker section) so position:sticky stays
          pinned while the user scrolls through the photo list below. */}
      {/* ★ 아래에 목록이 없으면 구분선을 긋지 않는다(K-18 2차). 그 선은 스티키 바와
          사진 목록을 가르려고 있는 것인데, 아직 한 장도 안 끝났으면 가를 것이 없어
          줄만 남는다 — 실기기에서 푸터 위 선과 함께 `빈 줄 두 개`로 보였다
          (08-08 04:50 · 08-10 00:50 사진). */}
      {isPreparing ? (
        <div className={`upload-form__preparing${photos.length ? "" : " upload-form__preparing--alone"}`} aria-live="polite">
          <p className="upload-form__count upload-form__preparing-text">{preparingLabel(preparingProgress)}</p>
          <div className="upload-form__preparing-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(prepareDisplay)}>
            <span style={{ width: `${prepareDisplay.toFixed(1)}%` }} />
          </div>
        </div>
      ) : null}
      <PhotoCommentList photos={photos} onCommentChange={updatePhotoComment} onRemove={removePhoto} onPreviewBroken={repairPreview} coverPhotoId={coverPhotoId} onCoverChange={setCoverPhotoId} />
      {showsSubmitButton(photos.length) ? (
        <button type="button" className="upload-form__submit" disabled={isSubmitting || isPreparing || !photos.length} onClick={requestCreate}>
          {isSubmitting ? "앨범 만드는 중..." : "앨범 만들기"}
        </button>
      ) : null}
      {notice && <p className="notice notice--info upload-form__notice" aria-live="polite">{notice}</p>}
      {error && <p className="notice notice--error upload-form__error" role="alert">{error}</p>}
      {error && photos.length > 0 && <button type="button" className="upload-form__retry" onClick={() => void createAlbum()}>다시 시도</button>}
      {/* 앨범 모양을 한 번 고르는 자리. 껍데기(album-sheet-dim · album-inline-action)와
          몸(AlbumAppearancePicker)은 **이미 있는 것을 그대로** 쓴다 — 새로 만든 것은
          부르는 자리뿐이다. `저장` 버튼을 두지 않는다: 고르면 바로 반영된다(§7). */}
      {showsAppearanceSheet ? (
        <>
          <div className="album-sheet-dim" aria-hidden="true" onClick={closeAppearanceSheet} />
          <section className="album-inline-action" role="dialog" aria-modal="true" aria-label="어떤 모양으로 만들까요?">
            <div className="album-inline-action__header">
              <h2>어떤 모양으로 만들까요?</h2>
              <button type="button" onClick={closeAppearanceSheet}>닫기</button>
            </div>
            <div className="album-inline-action__body">
              <AlbumAppearancePicker
                skin={appearance.skin}
                paper={appearance.paper}
                category={category}
                onPick={(next) => setAppearance((current) => ({ ...current, ...next }))}
              />
            </div>
            {/* 손가락이 가는 자리 — **접힌 아래로 내려가면 안 된다.** 고를 것이 아홉 개라
                몸 안에 두면 넓은 화면에서 시트 밖으로 밀려났다(실측). 머리와 같이
                스크롤 밖에 붙인다. */}
            <div className="album-inline-action__footer">
              <button type="button" className="gallery-btn" onClick={confirmAppearance}>이대로 만들기</button>
            </div>
          </section>
        </>
      ) : null}
      {progressStep !== null && (
        <div className="upload-progress" role="dialog" aria-modal="true" aria-live="polite" aria-labelledby="upload-progress-title" aria-describedby="upload-progress-copy">
          <section className="upload-progress__card">
            <div className="upload-progress__character" aria-hidden="true"><span className="upload-progress__glow" /><span className="upload-progress__star" /><span className="upload-progress__spark upload-progress__spark--a" /><span className="upload-progress__spark upload-progress__spark--b" /><span className="upload-progress__spark upload-progress__spark--c" /></div>
            <h2 id="upload-progress-title">우리의 이야기를 만들고 있어요</h2>
            <p id="upload-progress-copy">사진에 남긴 한 줄을 차곡차곡 모으는 중이에요.</p>
            {/* ★ 시간이 이쪽으로 옮겨 왔다 — 지금 무슨 일이 도는지 말해 준다. */}
            {uploadPrepare ? <p className="upload-progress__photos" aria-live="polite">{uploadingLabel(uploadPrepare)}</p> : null}
            <div className="upload-progress__bar" role="progressbar" aria-label="앨범 생성 중" aria-valuetext="진행 중"><span /></div>
            <button type="button" className="upload-progress__cancel" onClick={cancelUpload}>그만하기</button>
          </section>
        </div>
      )}
    </div>
  );
}
