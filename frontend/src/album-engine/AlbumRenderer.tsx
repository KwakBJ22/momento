import { useEffect, useMemo, useRef, useState } from "react";
import type { AlbumCategory, AlbumPhoto, AlbumTemplateType, LivingAppendPage } from "../types";
import AlbumCover from "./components/AlbumCover";
import AlbumEpilogue from "./components/AlbumEpilogue";
import { PhotoCommentEditProvider, type PhotoCommentEditState } from "./components/PhotoCommentEditContext";
import { buildAlbum, ensureOrientation, type BuiltAlbum } from "./buildAlbum";
import type { EnginePhoto, LocationSource } from "./types";
import "./AlbumRenderer.css";

export type AlbumRendererMode = "screen" | "print";

export interface AlbumRendererProps {
  photos: AlbumPhoto[];
  title: string;
  epilogue?: string | null;
  coverDateLabel?: string | null;
  chapterStories?: Record<string, string> | null;
  category?: AlbumCategory | string | null;
  templateType?: AlbumTemplateType | string | null;
  albumId?: string | null;
  coverPhotoId?: string | null;
  mode?: AlbumRendererMode;
  fallbackImageUrl?: string;
  participants?: string[];
  onReady?: () => void;
  onEditEpilogue?: () => void;
  photoCommentEdit?: PhotoCommentEditState | null;
  livingAppendPages?: LivingAppendPage[];
  className?: string;
}

function toEnginePhoto(photo: AlbumPhoto, preferOriginal: boolean): EnginePhoto {
  const width = photo.width ?? null;
  const height = photo.height ?? null;
  const src = preferOriginal
    ? photo.original_url || photo.thumbnail_url
    : photo.original_url || photo.thumbnail_url;
  return {
    id: photo.id,
    src,
    alt: photo.comment || undefined,
    width,
    height,
    orientation: ensureOrientation(width, height, photo.orientation),
    comment: photo.comment,
    comments: photo.comments ?? undefined,
    authorLabel: photo.author_label ?? null,
    sortOrder: photo.sort_order,
    takenAt: photo.taken_at ?? null,
    latitude: photo.latitude ?? null,
    longitude: photo.longitude ?? null,
    locationName: photo.location_name ?? null,
    locationSource: (photo.location_source as LocationSource | null) ?? null,
  };
}

async function resolveDimensions(photo: EnginePhoto): Promise<EnginePhoto> {
  if (photo.width && photo.height) {
    return photo;
  }
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const width = image.naturalWidth || null;
      const height = image.naturalHeight || null;
      resolve({
        ...photo,
        width,
        height,
        orientation: ensureOrientation(width, height, photo.orientation),
      });
    };
    image.onerror = () => resolve(photo);
    image.src = photo.src;
  });
}

/**
 * 앨범 결과 / 공유 / PDF 공통 렌더러
 */
export default function AlbumRenderer({
  photos,
  title,
  epilogue,
  coverDateLabel,
  chapterStories,
  category,
  templateType,
  albumId,
  coverPhotoId,
  mode = "screen",
  fallbackImageUrl,
  participants = [],
  onReady,
  onEditEpilogue,
  photoCommentEdit = null,
  livingAppendPages = [],
  className = "",
}: AlbumRendererProps) {
  const [album, setAlbum] = useState<BuiltAlbum | null>(null);
  const blockRefs = useRef<Array<HTMLElement | null>>([]);
  const preferOriginal = mode === "print";
  const epilogueText = (epilogue ?? "").trim();
  const [newAppendPageIds, setNewAppendPageIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    setAlbum(null);
    if (!photos.length) {
      return () => {
        active = false;
      };
    }
    const base = photos.map((photo) => toEnginePhoto(photo, preferOriginal));
    void Promise.all(base.map(resolveDimensions)).then((resolved) => {
      if (!active) return;
      const built = buildAlbum(resolved, {
        title,
        epilogue: epilogueText || null,
        category,
        coverDateLabel,
        chapterStories,
        albumId,
      });
      setAlbum(built);
    });
    return () => {
      active = false;
    };
  }, [photos, category, title, epilogueText, coverDateLabel, chapterStories, albumId, preferOriginal]);

  useEffect(() => {
    if (!album || !onReady) return;
    const root = document.querySelector(".album-renderer");
    if (!root) return;
    void waitForAlbumAssets(root).then(() => onReady()).catch(() => onReady());
  }, [album, onReady]);

  useEffect(() => {
    if (mode !== "screen" || !livingAppendPages.length || !albumId) return;
    const unseen = new Set<string>();
    for (const page of livingAppendPages) {
      try {
        if (!sessionStorage.getItem(`momento-living-page-seen:${albumId}:${page.id}`)) unseen.add(page.id);
      } catch {
        // Rendering the page must not depend on WebView storage availability.
      }
    }
    setNewAppendPageIds(unseen);
    const focusKey = `momento-living-focus:${albumId}`;
    let focusId: string | null = null;
    try {
      focusId = sessionStorage.getItem(focusKey);
      if (focusId) sessionStorage.removeItem(focusKey);
    } catch {
      // Best-effort enhancement only.
    }
    if (focusId) {
      const index = livingAppendPages.findIndex((page) => page.id === focusId);
      const target = blockRefs.current[(album?.elements.length ?? 0) + index];
      requestAnimationFrame(() => target?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
    const timeout = window.setTimeout(() => {
      for (const page of livingAppendPages) {
        try { sessionStorage.setItem(`momento-living-page-seen:${albumId}:${page.id}`, "1"); } catch { /* noop */ }
      }
      setNewAppendPageIds(new Set());
    }, 1400);
    return () => window.clearTimeout(timeout);
  }, [album?.elements.length, albumId, livingAppendPages, mode]);

  useEffect(() => {
    const pageCount = (album?.elements.length ?? 0) + livingAppendPages.length;
    if (mode !== "screen" || !pageCount) return;

    const readPage = () => {
      const value = Number(new URLSearchParams(window.location.search).get("page"));
      return Number.isInteger(value) && value >= 1 && value <= pageCount ? value : 1;
    };
    const scrollToPage = (page: number) => {
      const target = blockRefs.current[page - 1];
      target?.scrollIntoView({ block: "start" });
    };
    const replacePage = (page: number) => {
      const url = new URL(window.location.href);
      if (page <= 1) url.searchParams.delete("page");
      else url.searchParams.set("page", String(page));
      window.history.replaceState(window.history.state, "", url);
    };

    const initialPage = readPage();
    if (initialPage === 1 && new URLSearchParams(window.location.search).has("page")) replacePage(1);
    requestAnimationFrame(() => scrollToPage(initialPage));

    let currentPage = initialPage;
    const onScroll = () => {
      const page = blockRefs.current.reduce((closest, block, index) => {
        if (!block) return closest;
        const distance = Math.abs(block.getBoundingClientRect().top);
        const closestDistance = Math.abs((blockRefs.current[closest - 1]?.getBoundingClientRect().top ?? 0));
        return distance < closestDistance ? index + 1 : closest;
      }, 1);
      if (page !== currentPage) {
        currentPage = page;
        replacePage(page);
      }
    };
    const onPopState = () => {
      currentPage = readPage();
      scrollToPage(currentPage);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("popstate", onPopState);
    };
  }, [album, livingAppendPages.length, mode]);

  const heroSrc = useMemo(() => {
    if (!photos.length) return fallbackImageUrl ?? null;
    const hero = photos.find((photo) => photo.id === coverPhotoId) ?? photos.find((p) => p.original_url) ?? photos[0];
    return hero.original_url || hero.thumbnail_url || fallbackImageUrl || null;
  }, [photos, fallbackImageUrl, coverPhotoId]);

  if (!photos.length) {
    if (!fallbackImageUrl) return null;
    return (
      <div className={`album-renderer album-renderer--${mode} ${className}`.trim()}>
        <img src={fallbackImageUrl} alt={title || "앨범"} className="album-renderer__fallback-image" />
      </div>
    );
  }

  if (!album) {
    return <div className={`album-renderer album-renderer--${mode} album-renderer--loading ${className}`.trim()} aria-busy="true" />;
  }

  return (
    <div
      className={`album-renderer album-renderer--${mode} album-renderer--${album.layout.kind.toLowerCase()} ${className}`.trim()}
      data-layout-engine={album.layout.layoutEngineVersion}
      data-template-type={album.layout.templateType}
      data-chapter-count={album.chapters.length}
      data-album-renderer=""
    >
      {mode === "print" ? (
        <AlbumCover
          title={title}
          coverDateLabel={album.coverDateLabel}
          heroSrc={heroSrc}
          heroAlt={title}
          participants={participants}
        />
      ) : null}

      <PhotoCommentEditProvider value={photoCommentEdit ?? null}>
        <div className="album-renderer__body">
          <div className="album-renderer__blocks">
            {album.elements.map((element, index) => (
              <div
                key={`album-block-${index}`}
                className="album-renderer__block"
                ref={(node) => { blockRefs.current[index] = node; }}
              >
                {element}
              </div>
            ))}
          </div>

          <AlbumEpilogue epilogue={epilogueText} templateType={templateType} onEdit={onEditEpilogue} />
          {livingAppendPages.map((page, index) => (
            <section
              key={page.id}
              className="album-living-page"
              data-living-append-page={page.id}
              ref={(node) => { blockRefs.current[album.elements.length + index] = node; }}
            >
              <header className="album-living-page__header">
                <div>
                  <p>함께 자라는 앨범</p>
                  <h2>새롭게 더해진 추억</h2>
                </div>
                {newAppendPageIds.has(page.id) ? <span className="album-living-page__new">NEW</span> : null}
              </header>
              {page.photos.length ? (
                <div className="album-living-page__photos">
                  {page.photos.map((photo) => (
                    <figure key={photo.id}>
                      <img src={photo.thumbnail_url || photo.original_url} alt="새롭게 더해진 추억" loading="lazy" />
                      {photo.comment?.trim() ? <figcaption>{photo.comment.trim()}</figcaption> : null}
                    </figure>
                  ))}
                </div>
              ) : null}
              {page.memories.length ? (
                <ul className="album-living-page__memories">
                  {page.memories.map((memory) => (
                    <li key={memory.id}>
                      <p>{memory.content}</p>
                      <small>{memory.author_name || "참여자"}</small>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
          <footer className="album-renderer__brand-footer">
            <p>이 추억은 Momento에서 함께 만들었습니다.</p>
            <a href="/">가족과 함께 추억을 이어가 보세요.</a>
          </footer>
        </div>
      </PhotoCommentEditProvider>
    </div>
  );
}

/** PDF 생성 전 폰트·이미지 준비 */
export async function waitForAlbumAssets(root: ParentNode): Promise<void> {
  await document.fonts.ready;
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    images.map(async (img) => {
      if (img.complete && img.naturalWidth > 0) {
        await img.decode?.().catch(() => undefined);
        return;
      }
      await new Promise<void>((resolve, reject) => {
        img.addEventListener("load", () => resolve(), { once: true });
        img.addEventListener("error", () => reject(new Error("image failed")), { once: true });
      });
      await img.decode?.().catch(() => undefined);
    }),
  );
}
