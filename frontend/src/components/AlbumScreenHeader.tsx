import { Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import "./AlbumScreenHeader.css";

interface AlbumScreenHeaderProps {
  title: string;
  subtitle?: string | null;
  canEdit?: boolean;
  onSaveTitle?: (title: string) => Promise<string>;
}

/** Shared, screen-only title header for result, private and public album views. */
export default function AlbumScreenHeader({ title, subtitle, canEdit = false, onSaveTitle }: AlbumScreenHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setDraft(title);
  }, [editing, title]);

  const save = async () => {
    const next = draft.trim();
    if (!next || next === title || !onSaveTitle) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSaveTitle(next);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "제목을 저장하지 못했어요.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <header className="album-screen-header">
      <p className="album-screen-header__brand">Momento</p>
      {editing ? (
        <div className="album-screen-header__editor">
          <input aria-label="앨범 제목" value={draft} maxLength={120} onChange={(event) => setDraft(event.target.value)} autoFocus />
          <button type="button" onClick={() => void save()} disabled={saving}>{saving ? "저장 중..." : "저장"}</button>
          <button type="button" onClick={() => { setDraft(title); setEditing(false); }} disabled={saving}>취소</button>
        </div>
      ) : (
        <div className="album-screen-header__title-row">
          <h1>{title}</h1>
          {canEdit ? <button type="button" className="album-screen-header__edit" aria-label="앨범 제목 수정" onClick={() => setEditing(true)}><Pencil size={15} /></button> : null}
        </div>
      )}
      {subtitle && !editing ? <p className="album-screen-header__subtitle">{subtitle}</p> : null}
      {error ? <p className="album-screen-header__error" role="alert">{error}</p> : null}
    </header>
  );
}
