import { useEffect, useState } from "react";
import { getJoinPreview, joinCollaboration, saveCollabSession } from "../lib/api";
import "./JoinPage.css";

const RELATIONSHIPS = ["아빠", "엄마", "딸", "아들", "친구", "동료", "기타"] as const;

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
      .then((data) => active && setPreview(data))
      .catch((err: Error) => active && setError(err.message));
    return () => {
      active = false;
    };
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
      setError(err instanceof Error ? err.message : "참여에 실패했어요.");
    } finally {
      setBusy(false);
    }
  };

  if (error && !preview) {
    return (
      <section className="join-page">
        <p className="join-page__error">{error}</p>
      </section>
    );
  }

  if (!preview) {
    return (
      <section className="join-page">
        <p className="join-page__loading">초대장을 확인하고 있어요…</p>
      </section>
    );
  }

  return (
    <section className="join-page">
      <p className="join-page__eyebrow">함께 만드는 앨범</p>
      <h2 className="join-page__title">함께 기억을 남겨주세요</h2>
      {preview.cover_image_url ? (
        <img className="join-page__cover" src={preview.cover_image_url} alt="" />
      ) : (
        <div className="join-page__cover join-page__cover--empty" />
      )}
      <h3 className="join-page__album">{preview.title}</h3>
      {preview.owner_name ? <p className="join-page__owner">만든 사람 · {preview.owner_name}</p> : null}
      <p className="join-page__meta">
        참여 {preview.contributor_count}명 · 사진 {preview.photo_count}/{preview.photo_limit}
      </p>

      <label className="join-page__label">
        이름
        <input
          className="join-page__input"
          value={name}
          maxLength={40}
          onChange={(event) => setName(event.target.value)}
          placeholder="어떻게 불러드릴까요?"
        />
      </label>

      <label className="join-page__label">
        관계 (선택)
        <select
          className="join-page__input"
          value={relationship}
          onChange={(event) => setRelationship(event.target.value)}
        >
          <option value="">선택 안 함</option>
          {RELATIONSHIPS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>

      {error ? <p className="join-page__error">{error}</p> : null}

      <button type="button" className="join-page__cta" disabled={busy} onClick={() => void onJoin()}>
        {busy ? "참여 중…" : "참여하기"}
      </button>
    </section>
  );
}
