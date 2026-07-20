import type { PhotoItem } from "../types";
import "./PhotoCommentList.css";

interface PhotoCommentListProps {
  photos: PhotoItem[];
  onCommentChange: (id: string, comment: string) => void;
  onRemove: (id: string) => void;
}

const COMMENT_PLACEHOLDER = "기억을 남겨보세요...";

export default function PhotoCommentList({ photos, onCommentChange, onRemove }: PhotoCommentListProps) {
  if (!photos.length) return null;

  return (
    <section className="photo-comments" aria-label="선택한 사진">
      <ul className="photo-comments__list">
        {photos.map((photo, index) => (
          <li key={photo.id} className="photo-comments__item">
            <div className="photo-comments__image-wrap">
              <img
                src={photo.previewUrl}
                alt={`선택한 사진 ${index + 1}`}
                className="photo-comments__image"
              />
              <button
                type="button"
                className="photo-comments__remove"
                onClick={() => onRemove(photo.id)}
                aria-label={`사진 ${index + 1} 삭제`}
              >
                ✕
              </button>
            </div>
            <textarea
              className="photo-comments__input"
              rows={3}
              maxLength={300}
              value={photo.story}
              placeholder={COMMENT_PLACEHOLDER}
              aria-label={`사진 ${index + 1} 코멘트`}
              onChange={(event) => onCommentChange(photo.id, event.target.value)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
