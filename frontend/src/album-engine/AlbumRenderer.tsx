import { useEffect, useMemo, useState } from "react";
import type { AlbumCategory, AlbumPhoto, AlbumTemplateType } from "../types";
import AlbumCover from "./components/AlbumCover";
import AlbumEpilogue from "./components/AlbumEpilogue";
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
  mode?: AlbumRendererMode;
  fallbackImageUrl?: string;
  participants?: string[];
  onReady?: () => void;
  onEditEpilogue?: () => void;
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
    try {
      await loadImageDecode(photo.src);
    } catch {
      /* keep declared dimensions */
    }
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

function loadImageDecode(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      void (image.decode?.() ?? Promise.resolve())
        .then(() => resolve())
        .catch(() => resolve());
    };
    image.onerror = () => reject(new Error("image load failed"));
    image.src = src;
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
  mode = "screen",
  fallbackImageUrl,
  participants = [],
  onReady,
  onEditEpilogue,
  className = "",
}: AlbumRendererProps) {
  const [album, setAlbum] = useState<BuiltAlbum | null>(null);
  const preferOriginal = mode === "print";
  const epilogueText = (epilogue ?? "").trim();

  useEffect(() => {
    let active = true;
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

  const heroSrc = useMemo(() => {
    if (!photos.length) return fallbackImageUrl ?? null;
    const hero = photos.find((p) => p.original_url) ?? photos[0];
    return hero.original_url || hero.thumbnail_url || fallbackImageUrl || null;
  }, [photos, fallbackImageUrl]);

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

      <div className="album-renderer__body">
        <div className="album-renderer__blocks">
          {album.elements.map((element, index) => (
            <div key={`album-block-${index}`} className="album-renderer__block">
              {element}
            </div>
          ))}
        </div>

        <AlbumEpilogue epilogue={epilogueText} templateType={templateType} onEdit={onEditEpilogue} />
      </div>
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
