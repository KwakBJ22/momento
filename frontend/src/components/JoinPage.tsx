import { useEffect, useState } from "react";
import { getJoinPreview, joinCollaboration, saveCollabSession } from "../lib/api";
import { signIn } from "../services/authService";
import { BRAND_NAME_KO_PARTS } from "../lib/brand";
import "./JoinPage.css";

interface JoinPageProps {
  token: string;
}

/**
 * 초대 링크(/join/<token>)를 받은 사람이 처음 보는 화면.
 * 목업: docs/mockups/album-detail-invite.html
 *
 * 이 사람은 서비스를 모르고, 찾아온 게 아니라 **불려 온 사람**이다. 그래서 서비스 소개가
 * 아니라 **초대한 사람의 이름**이 첫 줄이다.
 *
 * 관계(선택) 칩은 두지 않는다 — 초대한 사람이 이미 아는 것을 다시 묻는 셈이다.
 * `album_contributors.relationship` 컬럼과 API 는 그대로 두고 화면에서만 뺐다
 * (§8 참여 정체성 띠는 관계가 비어 있는 갈래를 이미 갖고 있다).
 */
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
      // 가입 없이 참여한다 — 이름 하나만 받고 바로 앨범으로 간다.
      const result = await joinCollaboration(token, { display_name: name.trim(), relationship: null });
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

  // 로그인 뒤 **이 초대 화면으로 되돌아온다**(authService 가 현재 경로를 저장하고
  // AuthCallback 이 그 경로로 replace 한다). 랜딩으로 떨어지면 초대받은 사람이 길을 잃는다.
  const onKakao = async () => {
    setError(null);
    try {
      await signIn("kakao", `${window.location.pathname}${window.location.search}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인을 시작하지 못했어요.");
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
      {/* 첫 줄은 초대한 사람의 이름이다. 이름도 본문과 같은 검정 — 빨간 이름을 쓰지 않는다. */}
      <p className="join-page__invite">
        {preview.owner_name ? `${preview.owner_name}님이 함께 만들자고 초대했어요` : "함께 만들자고 초대했어요"}
      </p>

      {/* 표지 카드: 사진 + 제목 + 참여 수 + 모토를 한 덩어리로. 그림자 없이 색차로만 뜬다. */}
      <div className="join-page__card">
        <div className="join-page__cover-box">
          {preview.cover_image_url ? (
            // 전폭으로 깔지 않는다 — 세로·정사각 사진의 양옆이 크게 잘린다.
            <img className="join-page__cover" src={preview.cover_image_url} alt={`${preview.title} 대표사진`} loading="eager" decoding="async" fetchPriority="high" />
          ) : (
            <div className="join-page__cover join-page__cover--empty" aria-hidden="true" />
          )}
        </div>
        <div className="join-page__card-body">
          <h2 className="join-page__album">{preview.title}</h2>
          <p className="join-page__meta">사진 {preview.photo_count}장 · 함께한 사람 {preview.contributor_count}명</p>
          <div className="join-page__rule" aria-hidden="true" />
          <p className="join-page__motto">각자의 사진을 모아<br />하나의 앨범으로 남겨요.</p>
        </div>
      </div>

      <label className="join-page__label" htmlFor="join-participant-name">참여자명</label>
      <input
        id="join-participant-name"
        className="join-page__input"
        value={name}
        maxLength={40}
        autoComplete="name"
        onChange={(event) => setName(event.target.value)}
        placeholder="앨범에서 이 이름으로 불려요"
      />

      {error ? <p className="join-page__error" role="alert">{error}</p> : null}

      <button type="button" className="join-page__cta" disabled={busy} onClick={() => void onJoin()}>
        {busy ? "참여 중…" : "앨범에 참여하기"}
      </button>

      {/* 위계는 색이 아니라 순서·크기로 준다: 참여 버튼은 입력창에 붙고, 카카오는 구분선
          뒤로 떨어지며 설명 두 줄을 먼저 읽게 한다(56 vs 52, 18/800 vs 17/600). */}
      <div className="join-page__rule join-page__rule--section" aria-hidden="true" />
      <p className="join-page__account-copy">
        <span className="join-page__logo">
          <b>{BRAND_NAME_KO_PARTS.lead}</b><i>{BRAND_NAME_KO_PARTS.tail}</i>
        </span>
        {" "}계정으로 함께하면<br />내가 올린 사진과 글을 언제든 다시 찾을 수 있어요.
      </p>
      <button type="button" className="join-page__kakao" onClick={() => void onKakao()}>카카오로 시작하기</button>
    </section>
  );
}
