import type { CSSProperties, ReactNode } from "react";
import "./AlbumPhotoFrame.css";

interface AlbumPhotoFrameProps {
  src: string;
  alt?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
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
}: AlbumPhotoFrameProps) {
  return (
    <figure className={`album-photo-frame ${className}`.trim()} style={style}>
      <img src={src} alt={alt} className="album-photo-frame__img" />
      {children}
    </figure>
  );
}
