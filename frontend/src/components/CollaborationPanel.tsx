import { useEffect, useState } from "react";
import {
  closeCollaborationAlbum,
  deactivateCollaborationInvite,
  getCollaborationStatus,
  publishCollaborationAlbum,
  rebuildCollaborationAlbum,
  rotateCollaborationInvite,
  startCollaboration,
} from "../lib/api";
import "./CollaborationPanel.css";

interface CollaborationPanelProps {
  albumId: string;
}

export default function CollaborationPanel({ albumId }: CollaborationPanelProps) {
  const [status, setStatus] = useState<any>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    const data = await getCollaborationStatus(albumId);
    setStatus(data);
  };

  useEffect(() => {
    void reload().catch((err: Error) => setError(err.message));
  }, [albumId]);

  if (!status) {
    return error ? <p className="collab-panel__error">{error}</p> : null;
  }

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await startCollaboration(albumId);
      setInviteUrl(result.invite_url);
      setMessage("가족과 친구를 초대해 같은 순간의 서로 다른 기억을 모아보세요.");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "시작에 실패했어요.");
    } finally {
      setBusy(false);
    }
  };

  const rebuild = async () => {
    if (!status.dirty) {
      setMessage("새롭게 반영할 내용이 없습니다.");
      return;
    }
    setBusy(true);
    setMessage("앨범을 정리하고 있습니다…");
    try {
      await rebuildCollaborationAlbum(albumId);
      setMessage("새롭게 모인 사진과 기억을 앨범에 자연스럽게 반영했습니다.");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "업데이트에 실패했어요.");
      setMessage(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="collab-panel">
      <h3 className="collab-panel__title">함께 만들기</h3>
      <p className="collab-panel__copy">
        가족과 친구를 초대해 같은 순간의 서로 다른 기억을 모아보세요.
      </p>

      <div className={`collab-panel__banner ${status.dirty ? "is-dirty" : "is-clean"}`}>
        {status.dirty
          ? "새로운 사진이나 기억이 추가되었습니다."
          : "앨범이 최신 상태입니다."}
      </div>

      <dl className="collab-panel__stats">
        <div>
          <dt>참여자</dt>
          <dd>
            {status.contributor_count}/{status.contributor_limit}
          </dd>
        </div>
        <div>
          <dt>사진</dt>
          <dd>
            {status.photo_count}/{status.photo_limit}
          </dd>
        </div>
        <div>
          <dt>기억</dt>
          <dd>{status.memory_count}</dd>
        </div>
        <div>
          <dt>버전</dt>
          <dd>v{status.album_version}</dd>
        </div>
      </dl>

      {inviteUrl ? (
        <div className="collab-panel__invite">
          <input readOnly value={inviteUrl} />
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(inviteUrl);
              setMessage("링크를 복사했어요.");
            }}
          >
            링크 복사
          </button>
        </div>
      ) : null}

      <div className="collab-panel__actions">
        {!status.collaboration_enabled || status.collaboration_status === "draft" ? (
          <button type="button" disabled={busy} onClick={() => void start()}>
            함께 만들기 시작
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void rotateCollaborationInvite(albumId)
                  .then((result) => {
                    setInviteUrl(result.invite_url);
                    setMessage("새 초대 링크를 만들었어요.");
                  })
                  .catch((err: Error) => setError(err.message))
              }
            >
              링크 새로 만들기
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void deactivateCollaborationInvite(albumId)
                  .then(() => {
                    setInviteUrl(null);
                    setMessage("초대 링크를 비활성화했어요.");
                    return reload();
                  })
                  .catch((err: Error) => setError(err.message))
              }
            >
              링크 비활성화
            </button>
          </>
        )}

        <button type="button" className="is-primary" disabled={busy} onClick={() => void rebuild()}>
          {busy ? "앨범을 정리하고 있습니다…" : "앨범 업데이트"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void publishCollaborationAlbum(albumId)
              .then(() => {
                setMessage("앨범을 공개했어요.");
                return reload();
              })
              .catch((err: Error) => setError(err.message))
          }
        >
          앨범 공개
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!window.confirm("이제 이 앨범에는 새로운 사진과 기억을 추가할 수 없습니다. 종료할까요?")) return;
            void closeCollaborationAlbum(albumId)
              .then(() => {
                setMessage("함께 만들기를 종료했어요.");
                return reload();
              })
              .catch((err: Error) => setError(err.message));
          }}
        >
          함께 만들기 종료
        </button>
      </div>

      {message ? <p className="collab-panel__message">{message}</p> : null}
      {error ? <p className="collab-panel__error">{error}</p> : null}

      <ul className="collab-panel__people">
        {(status.contributors || []).map((person: any) => (
          <li key={person.id}>
            <span className="collab-panel__avatar">{(person.display_name || "?").slice(0, 1)}</span>
            {person.display_name}
            {person.relationship ? ` · ${person.relationship}` : ""}
          </li>
        ))}
      </ul>
    </section>
  );
}
