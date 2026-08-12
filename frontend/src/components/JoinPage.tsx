import { useEffect, useState } from "react";
import { getJoinPreview, joinCollaboration, saveCollabSession } from "../lib/api";
import { signIn, type AppUser } from "../services/authService";
import { BRAND_NAME_KO_PARTS } from "../lib/brand";
import LinkUnavailable from "./LinkUnavailable";
import "./JoinPage.css";
import { userFacingError } from "../lib/userFacingError";

/**
 * 초대장의 한 줄 — **지금 여기서 할 수 있는 일** (SCREEN_SPEC §7).
 *
 * 예전 문구("각자의 사진을 모아 하나의 앨범으로 남겨요")는 서비스가 무엇인지에 대한
 * 말이었고, 사진을 올려야 참여하는 것처럼 읽혔다. 실제 참여는 한마디 11건 : 사진 2건이다.
 * 대부분이 하는 쉬운 쪽을 먼저 말하고, 사진은 그 다음에 둔다.
 * 첫 줄(초대한 사람 이름)은 그대로다.
 */
const JOIN_LEAD = "사진을 보고 한마디를 남겨 주세요. 사진도 더할 수 있어요.";

interface JoinPageProps {
  token: string;
  /** 지금 로그인한 사람. 아직 확인 중이면 `undefined` 다(§1 — 판정은 App 한 곳). */
  user?: AppUser | null;
  /** 로그인 상태를 다 읽었는가. 읽기 전에는 카카오 버튼을 누를 수 없다. */
  authReady?: boolean;
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
export default function JoinPage({ token, user, authReady = true }: JoinPageProps) {
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
  // 사용자가 이름을 직접 고쳤는가 — 고쳤으면 프로필 이름으로 덮지 않는다.
  const [nameTouched, setNameTouched] = useState(false);
  const signedIn = Boolean(user);

  /**
   * ★ 로그인하면 이 화면이 **따라간다** (K-7 · §11).
   *
   * 예전에는 이 화면이 로그인 상태를 아예 읽지 않았다. 카카오 왕복은 제대로 돌고
   * 세션도 만들어졌는데(실측: `auth.users.last_sign_in_at` 이 그 시각으로 찍힌다),
   * 돌아온 화면이 그대로라 **아무 일도 안 일어난 것처럼 보였다.**
   *
   * ★ 자동으로 참여시키지 않는다(§1 — 참여는 이름을 적고 시작하는 일이다).
   *   이름만 채워 주고, 시작하는 것은 그 사람이 한다.
   */
  useEffect(() => {
    if (!user || nameTouched) return;
    const profileName = (user.displayName || "").trim();
    if (profileName) setName((current) => current.trim() ? current : profileName);
  }, [user, nameTouched]);

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
      setError(userFacingError(err, "참여하지 못했어요."));
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
      setError(userFacingError(err, "로그인을 시작하지 못했어요."));
    }
  };

  // ★ 초대장을 아직 한 번도 못 연 상태의 실패는 **링크가 안 열리는 것**이다(J-9).
  // 오류 화면이 아니라 안내 화면이고, 다음에 할 일이 함께 있다.
  // 문구는 서버가 준다 — 왜 안 열리는지는 서버만 안다.
  if (error && !preview) {
    return <section className="join-page"><LinkUnavailable message={error} /></section>;
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
          <p className="join-page__motto">{JOIN_LEAD}</p>
        </div>
      </div>

      <label className="join-page__label" htmlFor="join-participant-name">참여자명</label>
      <input
        id="join-participant-name"
        className="join-page__input"
        value={name}
        maxLength={40}
        autoComplete="name"
        onChange={(event) => { setNameTouched(true); setName(event.target.value); }}
        placeholder="앨범에서 이 이름으로 불려요"
      />

      {error ? <p className="notice notice--error join-page__error" role="alert">{error}</p> : null}

      <button type="button" className="join-page__cta" disabled={busy} onClick={() => void onJoin()}>
        {busy ? "참여 중…" : "앨범에 참여하기"}
      </button>

      {/* ★ 이미 로그인한 사람에게는 이 구역을 통째로 보여주지 않는다(K-7).
          할 일이 없는 버튼이 남아 있으면 눌러 보게 되고, 눌러도 아무 일이 없다.
          위계는 색이 아니라 순서·크기로 준다: 참여 버튼은 입력창에 붙고, 카카오는
          구분선 뒤로 떨어지며 설명 두 줄을 먼저 읽게 한다(56 vs 52, 18/800 vs 17/600). */}
      {signedIn ? null : (
        <>
          <div className="join-page__rule join-page__rule--section" aria-hidden="true" />
          <p className="join-page__account-copy">
            <span className="join-page__logo">
              <b>{BRAND_NAME_KO_PARTS.lead}</b><i>{BRAND_NAME_KO_PARTS.tail}</i>
            </span>
            {" "}계정으로 함께하면<br />내가 올린 사진과 글을 언제든 다시 찾을 수 있어요.
          </p>
          {/* ★ 로그인 상태를 다 읽기 전에는 누를 수 없다(§11). 눌러도 아무 일이 없는
              것보다 **못 누르는 것이 낫다** — 왜 그런지 라벨이 말한다.
              ★ `시작하기` 가 아니라 **`계속하기`** 다(K-8). `시작하기` 는 처음 오는
                사람에게만 맞는 말이라, 이미 회원인 사람에게는 **가입처럼 읽힌다** —
                PO 가 실기기에서 실제로 그렇게 느꼈다. 로그인 대화상자(AuthPanel)와
                같은 말을 쓴다. 같은 행동에 말이 둘이면 다른 일처럼 보인다. */}
          <button type="button" className="join-page__kakao" disabled={!authReady} onClick={() => void onKakao()}>
            {authReady ? "카카오로 계속하기" : "잠시만 기다려 주세요"}
          </button>
        </>
      )}
    </section>
  );
}
