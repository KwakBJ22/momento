import { useState } from "react";
import type { AlbumPhoto } from "../types";
import "./AlbumPhotoComments.css";

interface AlbumPhotoCommentsProps {
  photos: AlbumPhoto[];
  onSave: (photoId: string, comment: string) => Promise<void>;
  onSaveLocation?: (photoId: string, locationName: string) => Promise<void>;
}

const COMMENT_PLACEHOLDER = "기억을 남겨보세요...";

export default function AlbumPhotoComments({
  photos,
  onSave,
  onSaveLocation,
}: AlbumPhotoCommentsProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(photos.map((photo) => [photo.id, photo.caption ?? ""])),
  );
  const [places, setPlaces] = useState<Record<string, string>>(() =>
    Object.fromEntries(photos.map((photo) => [photo.id, photo.location_name ?? ""])),
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (photoId: string) => {
    setSavingId(photoId);
    setError(null);
    try {
      await onSave(photoId, drafts[photoId] ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "코멘트를 저장하지 못했어요.");
    } finally {
      setSavingId(null);
    }
  };

  const savePlace = async (photoId: string) => {
    if (!onSaveLocation) return;
    setSavingId(photoId);
    setError(null);
    try {
      await onSaveLocation(photoId, places[photoId] ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "장소를 저장하지 못했어요.");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="album-photo-comments" aria-label="사진별 코멘트">
      {error && (
        <p className="album-photo-comments__error" role="alert">
          {error}
        </p>
      )}
      <ul className="album-photo-comments__list">
        {photos.map((photo, index) => {
          const source = photo.location_source ?? "unknown";
          return (
            <li key={photo.id} className="album-photo-comments__item">
              <img src={photo.thumbnail_url || photo.display_url || photo.original_url} alt={`사진 ${index + 1}`} loading="lazy" decoding="async" />
              {onSaveLocation ? (
                <label className="album-photo-comments__place">
                  <span>
                    장소
                    {source === "ai_estimated" ? (
                      <span className="album-photo-comments__badge">추정</span>
                    ) : null}
                  </span>
                  <input
                    type="text"
                    value={places[photo.id] ?? ""}
                    maxLength={120}
                    placeholder="장소를 입력하세요"
                    aria-label={`사진 ${index + 1} 장소`}
                    onChange={(event) =>
                      setPlaces((previous) => ({ ...previous, [photo.id]: event.target.value }))
                    }
                    onBlur={() => void savePlace(photo.id)}
                  />
                </label>
              ) : null}
              <textarea
                id={`saved-photo-comment-${photo.id}`}
                value={drafts[photo.id] ?? ""}
                rows={3}
                maxLength={300}
                placeholder={COMMENT_PLACEHOLDER}
                aria-label={`사진 ${index + 1} 코멘트`}
                aria-busy={savingId === photo.id}
                onChange={(event) =>
                  setDrafts((previous) => ({ ...previous, [photo.id]: event.target.value }))
                }
                onBlur={() => void save(photo.id)}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
