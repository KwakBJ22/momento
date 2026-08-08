import type { PhotoItem } from "../types";
import "./PhotoCommentList.css";

interface PhotoCommentListProps {
  photos: PhotoItem[];
  onCommentChange: (id: string, comment: string) => void;
  onRemove: (id: string) => void;
  coverPhotoId: string | null;
  onCoverChange: (id: string) => void;
}

const COMMENT_PLACEHOLDER = "한마디를 남겨보세요...";

export default function PhotoCommentList({ photos, onCommentChange, onRemove, coverPhotoId, onCoverChange }: PhotoCommentListProps) {
  if (!photos.length) return null;

  return (
    <section className="photo-comments" aria-label="선택한 사진">
      <p className="photo-comments__guide">
        사진마다 짧은 한마디를 남기면 더욱 생생하고 풍성한 앨범이 완성됩니다. (선택)
      </p>
      <p className="photo-comments__cover-guide">
        앨범을 대표할 사진을 골라보세요. 선택하지 않으면 첫 번째 사진이 대표사진으로 사용됩니다.
      </p>
      <ul className="photo-comments__list">
        {photos.map((photo, index) => (
          <li key={photo.id} className="photo-comments__item">
            <div className="photo-comments__image-wrap">
              <img
                src={photo.previewUrl}
                alt={`선택한 사진 ${index + 1}`}
                className="photo-comments__image"
                loading="lazy"
                decoding="async"
              />
              <button
                type="button"
                className="photo-comments__remove"
                onClick={() => onRemove(photo.id)}
                aria-label={`사진 ${index + 1} 삭제`}
              >
                ✕
              </button>
              <button
                type="button"
                className={`photo-comments__cover${coverPhotoId === photo.id ? " is-selected" : ""}`}
                onClick={() => onCoverChange(photo.id)}
                aria-pressed={coverPhotoId === photo.id}
              >
                {coverPhotoId === photo.id ? "대표사진" : "대표사진으로 선택"}
              </button>
            </div>
            <textarea
              className="photo-comments__input"
              rows={3}
              maxLength={300}
              value={photo.story}
              placeholder={COMMENT_PLACEHOLDER}
              aria-label={`사진 ${index + 1} 한마디`}
              onChange={(event) => onCommentChange(photo.id, event.target.value)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
