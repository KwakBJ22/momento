import { useEffect, useState } from "react";
import { getAlbum, getAlbumPhotos, saveAlbumPhotoComment } from "../lib/api";
import AlbumPhotoComments from "./AlbumPhotoComments";
import { composeAlbumWithStory, triggerDownload } from "../lib/composeAlbum";
import { useKakaoSdk } from "../hooks/useKakaoSdk";
import type { AlbumPhoto, AlbumResult } from "../types";
import "./AlbumResult.css";

interface AlbumViewProps {
  albumId: string;
}

export default function AlbumView({ albumId }: AlbumViewProps) {
  const [album, setAlbum] = useState<AlbumResult | null>(null);
  const [photos, setPhotos] = useState<AlbumPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const { shareAlbum } = useKakaoSdk();

  useEffect(() => {
    let active = true;
    getAlbum(albumId)
      .then((data) => active && setAlbum(data))
      .catch((err) => active && setError(err instanceof Error ? err.message : "앨범을 불러오지 못했어요."));
    getAlbumPhotos(albumId).then((data) => active && setPhotos(data)).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [albumId]);

  const handleDownload = async () => {
    if (!album) return;
    setIsSaving(true);
    try {
      const blob = await composeAlbumWithStory(album.image_url, album.narrative, album.title);
      triggerDownload(blob, `momento-${album.album_id}.png`);
    } catch {
      window.open(album.image_url, "_blank");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* noop */
    }
  };

  if (error) {
    return (
      <div className="album-result">
        <h2 className="album-result__title">앨범을 찾을 수 없어요</h2>
        <p className="album-result__subtitle">{error}</p>
        <a className="btn btn--secondary" href="/">
          새 앨범 만들기
        </a>
      </div>
    );
  }

  if (!album) {
    return (
      <div className="album-result">
        <p className="album-result__subtitle">앨범을 불러오는 중...</p>
      </div>
    );
  }

  return (
    <div className="album-result">
      <h2 className="album-result__title">{album.title}</h2>
      <p className="album-result__subtitle">우리 모임의 추억 앨범</p>

      <img src={album.image_url} alt={`${album.title} 앨범`} className="album-result__image" />

      <section className="album-result__narrative">
        <div className="album-result__narrative-head">
          <h3>우리의 이야기</h3>
        </div>
        <p>{album.narrative}</p>
      </section>

      {photos.length > 0 && <AlbumPhotoComments photos={photos} onSave={async (photoId, comment) => {
        await saveAlbumPhotoComment(albumId, photoId, comment);
        setPhotos((previous) => previous.map((photo) => (photo.id === photoId ? { ...photo, comment: comment.trim() || null } : photo)));
      }} />}

      {album.media.some((media) => media.media_type !== "image" && media.media_type !== "gif") && (
        <section className="album-result__narrative">
          <div className="album-result__narrative-head">
            <h3>함께 담긴 미디어</h3>
          </div>
          <ul className="media-placeholder-list">
            {album.media
              .filter((media) => media.media_type !== "image" && media.media_type !== "gif")
              .map((media) => (
                <li key={media.id} className="media-placeholder">
                  <span aria-hidden="true">{media.media_type === "video" ? "🎬" : media.media_type === "audio" ? "🎵" : "📄"}</span>
                  <span>{media.original_filename || media.mime_type}</span>
                  <small>{media.processing_status === "pending" ? "미리보기 준비 중" : "미디어 준비됨"}</small>
                </li>
              ))}
          </ul>
        </section>
      )}

      <div className="album-result__actions">
        <button
          type="button"
          className="btn btn--kakao"
          onClick={() =>
            shareAlbum({
              imageUrl: album.image_url,
              linkUrl: album.share_url,
              description: album.narrative,
              title: album.title,
            })
          }
        >
          <span className="btn__icon">💬</span>
          카카오톡으로 공유하기
        </button>
        <button type="button" className="btn btn--secondary" onClick={handleDownload} disabled={isSaving}>
          {isSaving ? "이미지 만드는 중..." : "이미지 저장하기 (이야기 포함)"}
        </button>
        <button type="button" className="btn btn--ghost" onClick={handleCopyLink}>
          {copied ? "링크가 복사됐어요 ✓" : "이 페이지 링크 복사"}
        </button>
        <a className="btn btn--ghost" href="/">
          나도 앨범 만들기
        </a>
      </div>
    </div>
  );
}
