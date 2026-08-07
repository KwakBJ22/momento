import { useEffect, useState } from "react";
import { getJoinPreview, joinCollaboration, saveCollabSession } from "../lib/api";
import "./JoinPage.css";

const RELATIONSHIPS = ["가족", "친구", "연인", "지인", "기타"] as const;

interface JoinPageProps {
  token: string;
}

export default function JoinPage({ token }: JoinPageProps) {
  const [preview, setPreview] = useState<{
    album_id: string;
    title: string;
    owner_name: string | null;
    cover_image_url: string | null;
    contributor_count: number;
    photo_count: number;
    photo_limit: number;
  } | null>(null);
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void getJoinPreview(token)
      .then((data) => {
        if (!active) return;
        // Opening your own invite link: the owner/member lands on the album, not the
        // participant join form. Membership is decided by the server (viewer_is_member).
        if (data.viewer_is_member) {
          window.location.replace(`/album/${data.album_id}`);
          return;
        }
        setPreview(data);
      })
      .catch((err: Error) => active && setError(err.message));
    return () => { active = false; };
  }, [token]);

  const onJoin = async () => {
    if (!name.trim()) {
      setError("이름을 입력해 주세요.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await joinCollaboration(token, {
        display_name: name.trim(),
        relationship: relationship || null,
      });
      saveCollabSession({
        albumId: result.album_id,
        contributorId: result.contributor_id,
        guestId: result.guest_id,
        displayName: result.display_name,
      });
      window.location.href = `/album/${result.album_id}/contribute`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "참여하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  if (error && !preview) {
    return <section className="join-page"><p className="join-page__error">{error}</p></section>;
  }

  if (!preview) {
    return <section className="join-page"><p className="join-page__loading">초대장을 확인하고 있어요.</p></section>;
  }

  return (
    <section className="join-page">
      <p className="join-page__eyebrow">함께 만드는 앨범</p>
      {preview.cover_image_url ? (
        <img className="join-page__cover" src={preview.cover_image_url} alt={`${preview.title} 대표사진`} loading="eager" decoding="async" fetchPriority="high" />
      ) : (
        <div className="join-page__cover join-page__cover--empty" aria-hidden="true" />
      )}

      <div className="join-page__album-info">
        <h2 className="join-page__album">{preview.title}</h2>
        <p className="join-page__invite-copy">{preview.owner_name ? `${preview.owner_name}님이 함께 만들자고 초대했어요.` : "함께 만들자고 초대했어요."}</p>
        <p className="join-page__meta">사진 {preview.photo_count}장 · 함께한 사람 {preview.contributor_count}명</p>
        <p className="join-page__notice">사진과 한마디를 함께 남길 수 있어요.</p>
      </div>

      <label className="join-page__label">
        어떻게 불러드릴까요?
        <input
          className="join-page__input"
          value={name}
          maxLength={40}
          autoComplete="name"
          onChange={(event) => setName(event.target.value)}
          placeholder="이름을 입력해 주세요"
        />
      </label>

      <fieldset className="join-page__relationship">
        <legend>관계 (선택)</legend>
        <div className="join-page__relationship-chips" role="group" aria-label="관계 선택">
          {RELATIONSHIPS.map((item) => (
            <button key={item} type="button" className={relationship === item ? "is-selected" : ""} onClick={() => setRelationship((current) => current === item ? "" : item)}>{item}</button>
          ))}
        </div>
      </fieldset>

      {error ? <p className="join-page__error" role="alert">{error}</p> : null}

      <button type="button" className="join-page__cta" disabled={busy} onClick={() => void onJoin()}>
        {busy ? "참여 중…" : "앨범에 참여하기"}
      </button>
    </section>
  );
}
