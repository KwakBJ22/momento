import { useCallback, useEffect, useRef, useState } from "react";
import { getAlbum, getAlbumGenerationPreview, getAlbumGenerationStatus, retryAlbumGeneration, type AlbumGenerationStatus } from "../lib/api";
import { albumCreationTiming, getAlbumCreationPreview, releaseAlbumCreationPreview } from "../lib/albumCreation";
import { CREATION_PROGRESS_TICK_MS, initialCreationProgress, nextCreationProgress } from "../lib/creationProgress";
import "./AlbumCreating.css";

const STEP_COPY: Record<string, string> = {
  upload_completed: "사진을 안전하게 보관했어요",
  processing_images: "사진을 보기 좋게 정리하고 있어요",
  arranging_photos: "추억의 순서를 맞추고 있어요",
  building_story: "이야기를 자연스럽게 엮고 있어요",
  building_album: "앨범을 완성하고 있어요",
  completed: "앨범이 완성되었어요",
};

const shortId = (value: string) => value.slice(0, 8);

export default function AlbumCreating({ albumId }: { albumId: string }) {
  const [job, setJob] = useState<AlbumGenerationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<string[]>(() => getAlbumCreationPreview(albumId)?.previewUrls ?? []);
  const [failedPreviews, setFailedPreviews] = useState<Set<string>>(() => new Set());
  // Smoothly-eased display value; the server progress is only a target it moves toward.
  const [displayProgress, setDisplayProgress] = useState(() => initialCreationProgress());
  const targetProgress = useRef(initialCreationProgress());
  const startedAt = useRef(Date.now());
  const firstStatusAt = useRef<number | null>(null);
  const completedAt = useRef<number | null>(null);
  const requestFailures = useRef(0);
  const polling = useRef(false);
  const finishing = useRef(false);
  const failedRef = useRef(false);
  const timer = useRef<number | null>(null);
  const mounted = useRef(true);

  const delayForNextPoll = useCallback(() => {
    if (document.hidden) return 5000;
    if (requestFailures.current > 0) return Math.min(10_000, 1000 * (2 ** requestFailures.current));
    const elapsed = Date.now() - startedAt.current;
    return elapsed < 10_000 ? 1000 : elapsed < 60_000 ? 2000 : 3000;
  }, []);

  const confirmAlbumReady = useCallback(async () => {
    if (finishing.current) return;
    finishing.current = true;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await getAlbum(albumId);
        const completedAtValue = completedAt.current;
        albumCreationTiming("ALBUM_SCREEN_NAVIGATE", {
          album_id: shortId(albumId),
          completed_to_album_screen_ms: completedAtValue ? Math.round(performance.now() - completedAtValue) : undefined,
          detail_attempt: attempt + 1,
        });
        releaseAlbumCreationPreview(albumId);
        window.location.replace(`/album/${albumId}`);
        return;
      } catch {
        await new Promise((resolve) => window.setTimeout(resolve, 750));
      }
    }
    finishing.current = false;
    if (mounted.current) setError("앨범을 여는 데 시간이 조금 더 필요해요. 잠시 후 다시 확인할게요.");
  }, [albumId]);

  const poll = useCallback(async (immediate = false) => {
    if (polling.current || finishing.current || !mounted.current) return;
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
    polling.current = true;
    try {
      const next = await getAlbumGenerationStatus(albumId);
      if (!mounted.current) return;
      requestFailures.current = 0;
      failedRef.current = next.status === "failed";
      setJob(next);
      setError(null);
      if (firstStatusAt.current === null) {
        firstStatusAt.current = performance.now();
        const state = getAlbumCreationPreview(albumId);
        albumCreationTiming("FIRST_STATUS", {
          album_id: shortId(albumId),
          creating_screen_to_first_status_ms: state ? Math.round(firstStatusAt.current - state.responseAt) : undefined,
        });
      }
      if (next.ready || next.status === "completed") {
        completedAt.current = performance.now();
        albumCreationTiming("COMPLETED_DETECTED", { album_id: shortId(albumId), creating_screen_to_completed_ms: Date.now() - startedAt.current });
        void confirmAlbumReady();
        return;
      }
      if (next.status === "failed") return;
    } catch (cause) {
      requestFailures.current += 1;
      if (mounted.current && requestFailures.current >= 3) {
        setError(cause instanceof Error ? cause.message : "연결 상태를 다시 확인하고 있어요.");
      }
    } finally {
      polling.current = false;
      if (mounted.current && !finishing.current && !failedRef.current) {
        timer.current = window.setTimeout(() => void poll(), immediate ? 0 : delayForNextPoll());
      }
    }
  }, [albumId, confirmAlbumReady, delayForNextPoll]);

  useEffect(() => {
    mounted.current = true;
    const initial = getAlbumCreationPreview(albumId);
    if (initial) {
      albumCreationTiming("CREATING_SCREEN_ENTERED", {
        album_id: shortId(albumId),
        response_to_creating_screen_ms: Math.round(performance.now() - initial.responseAt),
      });
    } else {
      void getAlbumGenerationPreview(albumId)
        .then((items) => mounted.current && setPreviewUrls(items.map((item) => item.url).filter((url): url is string => Boolean(url)).slice(0, 5)))
        .catch(() => undefined);
    }
    void poll(true);
    const onVisibility = () => { if (!document.hidden) void poll(true); };
    const releaseOnPageHide = () => releaseAlbumCreationPreview(albumId);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", releaseOnPageHide);
    return () => {
      mounted.current = false;
      if (timer.current !== null) window.clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", releaseOnPageHide);
    };
  }, [albumId, poll]);

  // The server progress is the target the bar eases toward; completion targets 100.
  useEffect(() => {
    if (job?.ready || job?.status === "completed") targetProgress.current = 100;
    else if (job) targetProgress.current = Math.max(20, Math.min(100, job.progress));
  }, [job]);

  // Crawl the display value toward the target so a long server step never looks
  // frozen. Runs whenever generation is not failed (the bar is hidden on failure).
  useEffect(() => {
    if (job?.status === "failed") return;
    const id = window.setInterval(() => {
      setDisplayProgress((current) => nextCreationProgress(current, targetProgress.current));
    }, CREATION_PROGRESS_TICK_MS);
    return () => window.clearInterval(id);
  }, [job?.status]);

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      const next = await retryAlbumGeneration(albumId);
      setJob(next);
      setError(null);
      startedAt.current = Date.now();
      requestFailures.current = 0;
      failedRef.current = false;
      void poll(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "다시 시작하지 못했어요.");
    } finally {
      setRetrying(false);
    }
  };

  const failed = job?.status === "failed";
  const progress = Math.round(displayProgress);
  const visiblePreviews = previewUrls.filter((url) => !failedPreviews.has(url)).slice(0, 5);
  return (
    <section className="album-creating" aria-live="polite">
      <div className="album-creating__card">
        <p className="album-creating__eyebrow">Momento</p>
        <h2>{failed ? "앨범을 완성하지 못했습니다" : "앨범을 만들고 있어요"}</h2>
        <div className="album-creating__previews" aria-label="선택한 사진 미리보기">
          {(visiblePreviews.length ? visiblePreviews : ["", "", ""]).map((url, index) => url ? (
            <img key={url} src={url} alt="" decoding="async" onError={() => setFailedPreviews((current) => new Set(current).add(url))} />
          ) : <span key={`placeholder-${index}`} aria-hidden="true" />)}
        </div>
        <p>{failed ? "사진은 안전하게 보관되어 있어요. 다시 시도해 주세요." : STEP_COPY[job?.current_step ?? "upload_completed"] ?? "앨범을 만들고 있어요"}</p>
        {!failed && <><div className="album-creating__progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div><span className="album-creating__working" aria-hidden="true">···</span><small>페이지를 닫아도 앨범은 계속 만들어져요.</small></>}
        {error ? <p className="album-creating__error">{error}</p> : null}
        {failed ? <div className="album-creating__actions"><button type="button" onClick={() => void retry()} disabled={retrying}>{retrying ? "다시 준비하고 있어요" : "다시 시도"}</button><a href="/my-albums">내 앨범으로 이동</a></div> : null}
      </div>
    </section>
  );
}
