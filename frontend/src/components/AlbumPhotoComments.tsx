import { useState } from "react";
import type { AlbumPhoto } from "../types";
import "./AlbumPhotoComments.css";

interface AlbumPhotoCommentsProps {
  photos: AlbumPhoto[];
  onSave: (photoId: string, comment: string) => Promise<void>;
}

export default function AlbumPhotoComments({ photos, onSave }: AlbumPhotoCommentsProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(photos.map((photo) => [photo.id, photo.comment ?? ""])));
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = async (photoId: string) => { setSavingId(photoId); setError(null); try { await onSave(photoId, drafts[photoId] ?? ""); } catch (cause) { setError(cause instanceof Error ? cause.message : "코멘트를 저장하지 못했어요."); } finally { setSavingId(null); } };
  return <section className="album-photo-comments" aria-label="사진별 코멘트"><p>사진마다 남긴 기억은 AI 이야기를 다시 만들 때도 반영돼요.</p>{error && <p className="album-photo-comments__error" role="alert">{error}</p>}<ul>{photos.map((photo, index) => <li key={photo.id}><img src={photo.thumbnail_url} alt={`사진 ${index + 1}`} /><label htmlFor={`saved-photo-comment-${photo.id}`}>이 사진에 담긴 사람, 장소, 상황을 짧게 적어주세요.</label><textarea id={`saved-photo-comment-${photo.id}`} value={drafts[photo.id] ?? ""} rows={3} maxLength={300} onChange={(event) => setDrafts((previous) => ({ ...previous, [photo.id]: event.target.value }))} onBlur={() => void save(photo.id)} placeholder="선택 입력" /><small>{savingId === photo.id ? "저장 중…" : "입력 후 다른 곳을 누르면 저장돼요."}</small></li>)}</ul></section>;
}
