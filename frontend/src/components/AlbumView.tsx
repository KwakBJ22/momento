import { useEffect, useState } from "react";

import { AlbumRenderer } from "../album-engine";

import { getAlbum, getAlbumPhotos, saveAlbumPhotoComment, updateAlbumPhotoLocation } from "../lib/api";

import AlbumPhotoComments from "./AlbumPhotoComments";

import { downloadAlbumPdf } from "../lib/exportPdf";

import { useKakaoSdk } from "../hooks/useKakaoSdk";

import type { AlbumPhoto, AlbumResult } from "../types";

import { coverLineForCategory, normalizeTemplateType } from "../types";

import "./AlbumResult.css";



interface AlbumViewProps {

  albumId: string;

}
export default function AlbumView({ albumId }: AlbumViewProps) {

  const [album, setAlbum] = useState<AlbumResult | null>(null);

  const [photos, setPhotos] = useState<AlbumPhoto[]>([]);

  const [error, setError] = useState<string | null>(null);

  const [isExportingPdf, setIsExportingPdf] = useState(false);
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

      });

    } catch {

      /* noop */

    } finally {

      setIsExportingPdf(false);

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

      <div className="album-page">

        <div className="album-page__layout">

          <article className="album-page__book album-result">

            <h2 className="album-result__title">앨범을 찾을 수 없어요</h2>

            <p className="album-result__subtitle">{error}</p>

            <a className="btn btn--secondary" href="/">

              새 앨범 만들기

            </a>

          </article>

        </div>

      </div>

    );

  }



  if (!album) {

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

              fallbackImageUrl={album.image_url}

              coverDateLabel={album.date}
              chapterStories={album.chapter_stories}

              category={album.category}

              templateType={album.template_type}

              albumId={album.album_id}

              mode="screen"

            />

          </div>



          {photos.length > 0 && (

            <AlbumPhotoComments

              photos={photos}

              onSave={async (photoId, comment) => {

                await saveAlbumPhotoComment(albumId, photoId, comment);

                setPhotos((previous) =>

                  previous.map((photo) => (photo.id === photoId ? { ...photo, comment: comment.trim() || null } : photo)),

                );

              }}

              onSaveLocation={async (photoId, locationName) => {

                const updated = await updateAlbumPhotoLocation(albumId, photoId, {

                  location_name: locationName.trim() || null,

                  location_source: locationName.trim() ? "user" : "unknown",

                });

                setPhotos((previous) =>

                  previous.map((photo) =>

                    photo.id === photoId

                      ? {

                          ...photo,

                          location_name: updated.location_name ?? null,

                          location_source: updated.location_source ?? "unknown",

                          latitude: updated.latitude ?? photo.latitude,

                          longitude: updated.longitude ?? photo.longitude,

                        }

                      : photo,

                  ),

                );

              }}

            />

          )}



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

              onClick={() =>

                shareAlbum({

                  imageUrl: album.image_url,

                  linkUrl: album.share_url,

                  description: epilogue,

                  title: album.title,

                })

              }

            >

              <span className="btn__icon">💬</span>

              카카오톡으로 공유하기

            </button>

            <button type="button" className="btn btn--secondary" onClick={() => void handlePdf()} disabled={isExportingPdf}>

              {isExportingPdf ? "PDF 만드는 중..." : "PDF 저장"}

            </button>

            <button type="button" className="btn btn--ghost" onClick={handleCopyLink}>

              {copied ? "링크가 복사됐어요 ✓" : "이 페이지 링크 복사"}

            </button>

            <a className="btn btn--ghost" href="/">

              나도 앨범 만들기

            </a>

          </div>

        </aside>

      </div>

    </div>

  );

}
