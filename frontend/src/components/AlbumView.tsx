import { useEffect, useState } from "react";

import { AlbumRenderer } from "../album-engine";

import { createAlbumShareLink, getAlbum, getAlbumPhotos, isPublicShareUrl } from "../lib/api";

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
  const [isLoading, setIsLoading] = useState(true);
  const [loadedAlbumId, setLoadedAlbumId] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [publicShareUrl, setPublicShareUrl] = useState("");

  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [copied, setCopied] = useState(false);

  const { shareAlbum } = useKakaoSdk();



  useEffect(() => {

    let active = true;

    setIsLoading(true);
    setError(null);
    setLoadedAlbumId(null);
    setPublicShareUrl("");

    getAlbum(albumId, requestedEdition)

      .then((data) => active && setAlbum(data))

      .catch((err) => active && setError(err instanceof Error ? err.message : "앨범을 불러오지 못했어요."));

    getAlbumPhotos(albumId, requestedEdition)
      .then((data) => {
        if (!active) return;
        if (!data.length) {
          setError("앨범 사진을 불러오지 못했습니다.");
          return;
        }
        setPhotos(data);
        setLoadedAlbumId(loadedKey);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "앨범 사진을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {

      active = false;

    };

  }, [albumId, loadedKey, requestedEdition, retryKey]);



  const handlePdf = async () => {

    if (!album) return;

    setIsExportingPdf(true);

    try {

      await downloadAlbumPdf({

        albumId: album.album_id,

        albumVersion: album.album_version ?? 0,

        title: album.title,

        photos,

        epilogue: album.epilogue ?? album.narrative ?? "",

        coverDateLabel: album.date,

        category: album.category,

        templateType: album.template_type,
        chapterStories: album.chapter_stories,
        coverPhotoId: album.cover_photo_id,
        livingAppendPages: album.living_append_pages,

      });

    } catch {

      /* noop */

    } finally {

      setIsExportingPdf(false);

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



  if (isLoading || loadedAlbumId !== loadedKey || !album) {

    return (

      <div className="album-page">

        <div className="album-page__layout">

          <article className="album-page__book album-result">

            <p className="album-result__subtitle">앨범을 불러오는 중...</p>

          </article>

        </div>

      </div>

    );

  }



  const epilogue = (album.epilogue ?? album.narrative ?? "").trim();



  return (

    <div className={`album-page album-result--${normalizeTemplateType(album.template_type)}`}>

      <div className="album-page__layout">

        <article className="album-page__book album-result">

          <header className="album-result__intro">
            {requestedEdition !== null ? <p className="album-result__subtitle"><a href={`/album/${albumId}`}>최근 앨범 보기</a></p> : null}
            {requestedEdition === null && album.edition_is_latest && album.edition_previous !== null && album.edition_previous !== undefined ? (
              <p className="album-result__subtitle">새로운 추억을 반영한 최신 앨범입니다. <a href={`/album/${albumId}?edition=${album.edition_previous}`}>이전 앨범 보기</a></p>
            ) : null}
            <p className="album-result__memory-placeholder">새로운 추억 0개</p>

            <p className="album-result__cover">{coverLineForCategory(album.category)}</p>

            <h2 className="album-result__title">{album.title}</h2>

            <p className="album-result__subtitle">우리 모임의 추억 앨범</p>

          </header>



          <div className="album-result__stage album-result__stage--web">

            <AlbumRenderer

              photos={photos}

              title={album.title}

              epilogue={epilogue}

              coverDateLabel={album.date}
              chapterStories={album.chapter_stories}

              category={album.category}

              templateType={album.template_type}

              albumId={album.album_id}
              coverPhotoId={album.cover_photo_id}
              livingAppendPages={album.living_append_pages}

              mode="screen"

            />

          </div>

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

                      <span aria-hidden="true">

                        {media.media_type === "video" ? "🎬" : media.media_type === "audio" ? "🎵" : "📄"}

                      </span>

                      <span>{media.original_filename || media.mime_type}</span>

                      <small>{media.processing_status === "pending" ? "미리보기 준비 중" : "미디어 준비됨"}</small>

                    </li>

                  ))}

              </ul>

            </section>

          )}

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

            <button type="button" className="btn btn--secondary" onClick={() => void handlePdf()} disabled={isExportingPdf}>

              {isExportingPdf ? "PDF 만드는 중..." : "PDF 저장"}

            </button>

            <button type="button" className="btn btn--ghost" onClick={handleCopyLink} hidden>

              {copied ? "링크가 복사됐어요 ✓" : "이 페이지 링크 복사"}

            </button>

            <a className="btn btn--ghost" href="/">

              나도 앨범 만들기

            </a>

          </div>

          {requestedEdition === null ? <CollaborationPanel
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
