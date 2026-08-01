import type { CSSProperties, ReactNode } from "react";
import { useAlbumRenderMode } from "../AlbumRenderModeContext";
import { resolveImageFetchPriority, resolveImageLoading } from "./imageLoadingMode";
import "./AlbumPhotoFrame.css";

interface AlbumPhotoFrameProps {
  src: string;
  alt?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  width?: number;
  height?: number;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "auto";
}

/**
 * 공통 사진 프레임.
 * 모든 Block은 이 컴포넌트를 사용한다. crop 금지(contain).
 */
export default function AlbumPhotoFrame({
  src,
  alt = "",
  className = "",
  style,
  children,
  width,
  height,
  loading = "lazy",
  fetchPriority = "auto",
}: AlbumPhotoFrameProps) {
  const mode = useAlbumRenderMode();
  const effectiveLoading = resolveImageLoading(mode, loading);
  const effectiveFetchPriority = resolveImageFetchPriority(mode, fetchPriority);
  // PDF: html2canvas does not resolve height:auto to an image's intrinsic height in
  // flex cells, so without a height cue the photo box collapsed to 0 (blank page).
  // Reserve the box height from the real ratio (DB width/height), independent of load.
  const imgStyle: CSSProperties | undefined =
    mode === "print" && width && height ? { aspectRatio: `${width} / ${height}` } : undefined;
  return (
    <figure className={`album-photo-frame ${className}`.trim()} style={style}>
      <img
        src={src}
        alt={alt}
        className="album-photo-frame__img"
        width={width}
        height={height}
        style={imgStyle}
        loading={effectiveLoading}
        decoding="async"
        fetchPriority={effectiveFetchPriority}
      />
      {children}
    </figure>
  );
}
