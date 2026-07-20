import AlbumPhotoFrame from "./album/AlbumPhotoFrame";
import "./PolaroidFrame.css";

interface PolaroidFrameProps {
  src: string;
  alt?: string;
  caption?: string | null;
  className?: string;
}

/** AlbumPhotoFrame + Caption (선택). Polaroid3Block V1은 AlbumPhotoFrame을 직접 사용한다. */
export default function PolaroidFrame({
  src,
  alt = "",
  caption,
  className = "",
}: PolaroidFrameProps) {
  return (
    <AlbumPhotoFrame src={src} alt={alt} className={`polaroid-frame ${className}`.trim()}>
      <figcaption className="polaroid-frame__caption">{caption?.trim() || "\u00a0"}</figcaption>
    </AlbumPhotoFrame>
  );
}
