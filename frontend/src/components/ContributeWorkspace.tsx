import { useCallback, useEffect, useState } from "react";
import {
  createPhotoMemory,
  deletePhotoMemory,
  getContributeWorkspace,
  loadCollabSession,
  type CollabSession,
  updatePhotoMemory,
  uploadContributePhotos,
} from "../lib/api";
import { FILE_INPUT_CLASS, filterImageFiles, IMAGE_ACCEPT } from "../lib/imageFile";
import "./ContributeWorkspace.css";

interface ContributeWorkspaceProps {
  albumId: string;
}

type Tab = "photos" | "memories" | "preview";

export default function ContributeWorkspace({ albumId }: ContributeWorkspaceProps) {
  const [session, setSession] = useState<CollabSession | null>(() => loadCollabSession(albumId));
  const [workspace, setWorkspace] = useState<any>(null);
  const [tab, setTab] = useState<Tab>("photos");
  const [error, setError] = useState<string | null>(null);
  const [draftPhotoId, setDraftPhotoId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const current = loadCollabSession(albumId);
    if (!current) {
      setError("참여 세션이 없어요. 초대 링크로 다시 들어와 주세요.");
      return;
    }
    setSession(current);
    const data = await getContributeWorkspace(albumId, current);
    setWorkspace(data);
  }, [albumId]);

  useEffect(() => {
    void reload().catch((err: Error) => setError(err.message));
  }, [reload]);

  if (error && !workspace) {
    return (
      <section className="contribute">
        <p className="contribute__error">{error}</p>
      </section>
    );
  }

  if (!workspace || !session) {
    return (
      <section className="contribute">
        <p className="contribute__loading">앨범을 불러오는 중…</p>
      </section>
    );
  }

  const onUpload = async (files: FileList | null) => {
    const { accepted, rejected } = filterImageFiles(files);
    if (!accepted.length) {
      setError(
        rejected
          ? "선택한 파일을 사진으로 인식하지 못했어요. JPG, PNG, WEBP, HEIC를 골라주세요."
          : "사진을 선택해 주세요.",
      );
      return;
    }
    if (rejected > 0) {
      setError(`${rejected}개 파일은 지원하지 않아 제외했어요.`);
    } else {
      setError(null);
    }
    setBusy(true);
    try {
      await uploadContributePhotos(albumId, session, accepted.slice(0, 10));
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "업로드에 실패했어요.");
    } finally {
      setBusy(false);
    }
  };

  const saveMemory = async (photoId: string) => {
    if (!draftText.trim()) return;
    setBusy(true);
    try {
      await createPhotoMemory(albumId, photoId, session, draftText.trim());
      setDraftPhotoId(null);
      setDraftText("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "기억을 저장하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="contribute">
      <header className="contribute__header">
        <div>
          <p className="contribute__badge">함께 만드는 중</p>
          <h2 className="contribute__title">{workspace.title}</h2>
          <p className="contribute__meta">
            {session.displayName} · 사진 {workspace.photo_count}/{workspace.photo_limit}
          </p>
        </div>
      </header>

      {workspace.notice ? <p className="contribute__notice">{workspace.notice}</p> : null}
      {error ? <p className="contribute__error">{error}</p> : null}

      <div className="contribute__people">
        <p className="contribute__people-label">함께한 사람 {workspace.contributors?.length || 0}명</p>
        <div className="contribute__avatars">
          {(workspace.contributors || []).map((person: { id: string; display_name: string }) => (
            <span key={person.id} className="contribute__avatar" title={person.display_name}>
              {(person.display_name || "?").slice(0, 1)}
            </span>
          ))}
        </div>
      </div>

      <nav className="contribute__tabs">
        {(["photos", "memories", "preview"] as Tab[]).map((item) => (
          <button
            key={item}
            type="button"
            className={tab === item ? "is-active" : ""}
            onClick={() => setTab(item)}
          >
            {item === "photos" ? "사진" : item === "memories" ? "기억" : "미리보기"}
          </button>
        ))}
      </nav>

      {tab === "photos" ? (
        <div className="contribute__panel">
          <label className="contribute__upload">
            사진 추가
            <input
              className={FILE_INPUT_CLASS}
              type="file"
              accept={IMAGE_ACCEPT}
              multiple
              disabled={busy}
              onChange={(event) => {
                void onUpload(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
          <div className="contribute__grid">
            {(workspace.photos || []).map((photo: any) => (
              <article key={photo.id} className="contribute__card">
                <img src={photo.thumbnail_url || photo.original_url} alt="" />
                <button
                  type="button"
                  className="contribute__memory-btn"
                  onClick={() => {
                    setDraftPhotoId(photo.id);
                    setDraftText("");
                  }}
                >
                  이 사진의 기억 남기기
                </button>
                {draftPhotoId === photo.id ? (
                  <div className="contribute__draft">
                    <textarea
                      maxLength={500}
                      value={draftText}
                      onChange={(event) => setDraftText(event.target.value)}
                      placeholder="이 사진을 보며 떠오르는 순간을 적어주세요."
                    />
                    <p className="contribute__count">{draftText.length}/500</p>
                    <div className="contribute__draft-actions">
                      <button type="button" disabled={busy} onClick={() => void saveMemory(photo.id)}>
                        저장
                      </button>
                      <button type="button" onClick={() => setDraftPhotoId(null)}>
                        취소
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {tab === "memories" ? (
        <div className="contribute__panel">
          {(workspace.photos || []).flatMap((photo: any) =>
            (photo.memories || []).map((memory: any) => (
              <article key={memory.id} className="contribute__memory">
                <img src={photo.thumbnail_url} alt="" />
                <div>
                  <p className="contribute__memory-author">{memory.author_name}</p>
                  <p className="contribute__memory-text">{memory.comment}</p>
                  {memory.mine ? (
                    <div className="contribute__draft-actions">
                      <button
                        type="button"
                        onClick={() => {
                          const next = window.prompt("기억 수정", memory.comment);
                          if (!next?.trim()) return;
                          void updatePhotoMemory(albumId, memory.id, session, next.trim())
                            .then(() => reload())
                            .catch((err: Error) => setError(err.message));
                        }}
                      >
                        수정
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!window.confirm("이 기억을 삭제할까요?")) return;
                          void deletePhotoMemory(albumId, memory.id, session)
                            .then(() => reload())
                            .catch((err: Error) => setError(err.message));
                        }}
                      >
                        삭제
                      </button>
                    </div>
                  ) : null}
                </div>
              </article>
            )),
          )}
        </div>
      ) : null}

      {tab === "preview" ? (
        <div className="contribute__panel">
          <p className="contribute__notice">
            {workspace.notice ||
              "저장된 앨범 미리보기입니다. 새로 남긴 내용은 생성자가 업데이트하면 반영됩니다."}
          </p>
          {workspace.album_json ? (
            <pre className="contribute__json">{JSON.stringify(workspace.album_json, null, 2)}</pre>
          ) : (
            <div className="contribute__added">
              <h3>추가된 사진</h3>
              <div className="contribute__grid">
                {(workspace.photos || [])
                  .filter((photo: any) => photo.mine)
                  .map((photo: any) => (
                    <img key={photo.id} src={photo.thumbnail_url} alt="" />
                  ))}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
