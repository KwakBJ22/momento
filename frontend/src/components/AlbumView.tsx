import { useEffect, useState } from "react";

import { AlbumRenderer } from "../album-engine";

import { createAlbumShareLink, deleteAlbum, getAlbum, getAlbumPhotos, isPublicShareUrl } from "../lib/api";

import { downloadAlbumPdf } from "../lib/exportPdf";

import { useKakaoSdk } from "../hooks/useKakaoSdk";

import CollaborationPanel from "./CollaborationPanel";

import type { AlbumPhoto, AlbumResult } from "../types";

import { coverLineForCategory, normalizeTemplateType } from "../types";

import "./AlbumResult.css";



interface AlbumViewProps {

  albumId: string;

}
export default function AlbumView({ albumId }: AlbumViewProps) {

  const editionValue = new URLSearchParams(window.location.search).get("edition");
  const requestedEdition = editionValue && /^\d+$/.test(editionValue) ? Number(editionValue) : null;
  const loadedKey = `${albumId}:${requestedEdition ?? "latest"}`;

  const [album, setAlbum] = useState<AlbumResult | null>(null);

  const [photos, setPhotos] = useState<AlbumPhoto[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [photosReady, setPhotosReady] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [loadedAlbumId, setLoadedAlbumId] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [publicShareUrl, setPublicShareUrl] = useState("");

  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [copied, setCopied] = useState(false);

  const { shareAlbum } = useKakaoSdk();



  useEffect(() => {

    let active = true;

    setPhotosReady(false);
    setError(null);
    setLoadedAlbumId(null);
    setPublicShareUrl("");

    getAlbum(albumId, requestedEdition)

      .then((data) => active && setAlbum(data))

      .catch((err) => active && setError(err instanceof Error ? err.message : "앨범을 불러오지 못했어요."));

    getAlbumPhotos(albumId, requestedEdition)
      .then((data) => {
        if (!active) return;
        // An empty album is a valid legacy/Living Album state; only reject an invalid response.
        if (!Array.isArray(data)) {
          setError("앨범 사진을 불러오지 못했습니다.");
          return;
        }
        setPhotos(data);
        setLoadedAlbumId(loadedKey);
        setPhotosReady(true);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "앨범 사진을 불러오지 못했습니다.");
      });

    return () => {

      active = false;

    };

  }, [albumId, loadedKey, requestedEdition, retryKey]);



  const handlePdf = async () => {

    if (!displayAlbum && !album) return;
    const source = displayAlbum ?? album;
    if (!source) return;

    setIsExportingPdf(true);

    try {

      await downloadAlbumPdf({

        albumId: source.album_id,

        albumVersion: source.album_version ?? 0,

        title: source.title,

        photos,

        epilogue: source.epilogue ?? source.narrative ?? "",

        coverDateLabel: source.date,

        category: source.category,

        templateType: source.template_type,
        chapterStories: source.chapter_stories,
        coverPhotoId: source.cover_photo_id,
        livingAppendPages: source.living_append_pages,

      });

    } catch {

      /* noop */

    } finally {

      setIsExportingPdf(false);

    }

  };



  const handleDeleteAlbum = async () => {
    if (!window.confirm("이 앨범을 삭제할까요? 삭제한 앨범은 복구할 수 없습니다.")) return;
    setIsDeleting(true);
    try {
      await deleteAlbum(albumId);
      window.location.assign("/my-albums");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "앨범을 삭제하지 못했어요.");
      setIsDeleting(false);
    }
  };



  const handleCopyLink = async () => {

    try {

      await navigator.clipboard.writeText(await resolvePublicShareUrl());

      setCopied(true);

      setTimeout(() => setCopied(false), 2000);

    } catch (cause) {

      setError(cause instanceof Error ? cause.message : "공유 링크를 준비하지 못했습니다.");

    }

  };

  const resolvePublicShareUrl = async (): Promise<string> => {

    if (!album) throw new Error("앨범을 불러오는 중입니다.");

    if (isPublicShareUrl(publicShareUrl)) return publicShareUrl;

    if (isPublicShareUrl(album.share_url)) {

      setPublicShareUrl(album.share_url);

      return album.share_url;

    }

    const share = await createAlbumShareLink(album.album_id);

    setPublicShareUrl(share.share_url);

    return share.share_url;

  };

  const handleKakaoShare = async () => {

    if (!album) return;

    try {

      shareAlbum({

        imageUrl: album.image_url,

        linkUrl: await resolvePublicShareUrl(),

        description: (album.epilogue ?? album.narrative ?? "").trim(),

        title: album.title,

      });

    } catch (cause) {

      setError(cause instanceof Error ? cause.message : "카카오톡 공유를 시작하지 못했습니다.");

    }

  };



  if (error) {

    return (

      <div className="album-page">

        <div className="album-page__layout">

          <article className="album-page__book album-result">

            <h2 className="album-result__title">앨범을 찾을 수 없어요</h2>

            <p className="album-result__subtitle">{error}</p>

            <button type="button" className="btn btn--secondary" onClick={() => setRetryKey((value) => value + 1)}>

              다시 시도

            </button>

            <a className="btn btn--secondary" href="/">

              새 앨범 만들기

            </a>

          </article>

        </div>

      </div>

    );

  }



  if (!photosReady || loadedAlbumId !== loadedKey) {

    return (

      <div className="album-page">

        <div className="album-page__layout">

          <article className="album-page__book album-result album-result--skeleton">

            <p className="album-result__subtitle">앨범을 불러오는 중...</p>

            <div className="album-result__skeleton-stage" aria-hidden="true" />

          </article>

        </div>

      </div>

    );

  }



  const displayAlbum = album;
  const displayTitle = displayAlbum?.title ?? "우리의 추억";
  const epilogue = (displayAlbum?.epilogue ?? displayAlbum?.narrative ?? "").trim();
  const templateType = displayAlbum?.template_type;
  const category = displayAlbum?.category;

  return (

    <div className={`album-page album-result--${normalizeTemplateType(templateType)}`}>

      <div className="album-page__layout">

        <article className="album-page__book album-result">

          <header className="album-result__intro">
            <p className="album-result__back">
              <a className="album-result__back-link" href="/my-albums">← 내 앨범</a>
            </p>
            {requestedEdition !== null ? (
              <p className="album-result__subtitle">
                <a href={`/album/${albumId}`}>최신 앨범 보기</a>
                {displayAlbum?.edition_previous !== null && displayAlbum?.edition_previous !== undefined ? <> · <a href={`/album/${albumId}?edition=${displayAlbum.edition_previous}`}>더 이전 앨범 보기</a></> : null}
              </p>
            ) : null}
            {requestedEdition === null && displayAlbum?.edition_is_latest && displayAlbum?.edition_previous !== null && displayAlbum?.edition_previous !== undefined ? (
              <p className="album-result__subtitle">새로운 추억을 반영한 최신 앨범입니다. <a href={`/album/${albumId}?edition=${displayAlbum.edition_previous}`}>이전 앨범 보기</a></p>
            ) : null}

            <p className="album-result__cover">{coverLineForCategory(category)}</p>

            <h2 className="album-result__title">{displayTitle}</h2>

            <p className="album-result__subtitle">우리 모임의 추억 앨범</p>

          </header>



          <div className="album-result__stage album-result__stage--web">

            <AlbumRenderer

              photos={photos}

              title={displayTitle}

              epilogue={epilogue}

              coverDateLabel={displayAlbum?.date}
              chapterStories={displayAlbum?.chapter_stories}

              category={category}

              templateType={templateType}

              albumId={displayAlbum?.album_id ?? albumId}
              coverPhotoId={displayAlbum?.cover_photo_id}
              livingAppendPages={displayAlbum?.living_append_pages}

              mode="screen"

            />

          </div>

          {displayAlbum?.media?.some((media) => media.media_type !== "image" && media.media_type !== "gif") ? (

            <section className="album-result__narrative">

              <div className="album-result__narrative-head">

                <h3>함께 담긴 미디어</h3>

              </div>

              <ul className="media-placeholder-list">

                {displayAlbum.media

                  .filter((media) => media.media_type !== "image" && media.media_type !== "gif")

                  .map((media) => (

                    <li key={media.id} className="media-placeholder">

                      <span aria-hidden="true">

                        {media.media_type === "video" ? "🎬" : media.media_type === "audio" ? "🎵" : "📄"}

                      </span>

                      <span>{media.original_filename || media.mime_type}</span>

                      <small>{media.processing_status === "pending" ? "미리보기 준비 중" : "미디어 준비됨"}</small>

                    </li>

                  ))}

              </ul>

            </section>

          ) : null}

        </article>



        <aside className="album-page__manage" aria-label="앨범 공유">

          <div className="album-result__actions">

            <button

              type="button"

              className="btn btn--kakao"

              hidden

              onClick={() => void handleKakaoShare()}

            >

              <span className="btn__icon">💬</span>

              카카오톡으로 공유하기

            </button>

            <button type="button" className="btn btn--secondary" onClick={() => void handlePdf()} disabled={isExportingPdf || !album}>

              {isExportingPdf ? "PDF 만드는 중..." : "PDF 저장"}

            </button>

            <button type="button" className="btn btn--ghost btn--danger" onClick={() => void handleDeleteAlbum()} disabled={isDeleting}>

              {isDeleting ? "삭제하는 중..." : "앨범 삭제"}

            </button>

            <button type="button" className="btn btn--ghost" onClick={handleCopyLink} hidden>

              {copied ? "링크가 복사됐어요 ✓" : "이 페이지 링크 복사"}

            </button>

            <a className="btn btn--ghost" href="/">

              나도 앨범 만들기

            </a>

          </div>

          {requestedEdition === null && album ? <CollaborationPanel
            albumId={album.album_id}
            imageUrl={album.cover_image_url || album.image_url}
            title={album.title}
            photos={photos}
            coverPhotoId={album.cover_photo_id}
            onOpenParticipants={() => {
              window.location.assign(`/album/${album.album_id}/participants`);
            }}
            onAlbumUpdated={() => setRetryKey((value) => value + 1)}
            onCoverUpdated={(coverPhotoId, coverImageUrl) => {
              setAlbum((current) => current ? { ...current, cover_photo_id: coverPhotoId, cover_image_url: coverImageUrl, image_url: coverImageUrl || current.image_url } : current);
            }}
          /> : null}

        </aside>

      </div>

    </div>

  );

}
