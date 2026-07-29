import { useEffect, useRef, useState } from "react";
import { getAlbumGenerationStatus, retryAlbumGeneration, type AlbumGenerationStatus } from "../lib/api";
import "./AlbumCreating.css";

const STEP_COPY: Record<string, string> = {
  upload_completed: "사진을 정리하고 있어요",
  processing_images: "사진을 정리하고 있어요",
  arranging_photos: "추억의 순서를 맞추고 있어요",
  building_story: "이야기를 엮고 있어요",
  building_album: "앨범을 완성하고 있어요",
  completed: "앨범이 완성되었어요",
};

export default function AlbumCreating({ albumId }: { albumId: string }) {
  const [job, setJob] = useState<AlbumGenerationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      try {
        const next = await getAlbumGenerationStatus(albumId);
        if (cancelled) return;
        setJob(next);
        setError(null);
        if (next.ready || next.status === "completed") {
          window.location.replace(`/album/${albumId}`);
          return;
        }
        if (next.status === "failed") return;
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "진행 상태를 확인하지 못했어요.");
      }
      const elapsed = Date.now() - startedAt.current;
      const interval = document.hidden ? 5000 : elapsed < 10_000 ? 1000 : 2500;
      timer = window.setTimeout(() => void poll(), interval);
    };
    void poll();
    return () => { cancelled = true; if (timer !== null) window.clearTimeout(timer); };
  }, [albumId]);

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      const next = await retryAlbumGeneration(albumId);
      setJob(next);
      setError(null);
      startedAt.current = Date.now();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "다시 시작하지 못했어요.");
    } finally {
      setRetrying(false);
    }
  };

  const failed = job?.status === "failed";
  const progress = Math.max(20, Math.min(100, job?.progress ?? 20));
  return (
    <section className="album-creating" aria-live="polite">
      <div className="album-creating__card">
        <p className="album-creating__eyebrow">Momento</p>
        <h2>{failed ? "앨범을 완성하지 못했습니다" : "앨범을 만들고 있어요"}</h2>
        <p>{failed ? "사진은 안전하게 보관되어 있어요. 다시 시도해 주세요." : STEP_COPY[job?.current_step ?? "upload_completed"] ?? "앨범을 완성하고 있어요"}</p>
        {!failed && <div className="album-creating__progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>}
        {error ? <p className="album-creating__error">{error}</p> : null}
        {failed ? <div className="album-creating__actions"><button type="button" onClick={() => void retry()} disabled={retrying}>{retrying ? "다시 준비하고 있어요" : "다시 시도"}</button><a href="/my-albums">내 앨범으로 이동</a></div> : null}
      </div>
    </section>
  );
}
