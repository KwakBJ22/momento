import "./AppChrome.css";

/**
 * `⋯` 시트 최상단 계정 행(SCREEN_SPEC §5).
 *
 *   [프로필 사진]  곽병준
 *                  kbjkwak@gmail.com
 *
 * ★ 이 행은 눌러도 아무 일이 없다. 정보다 — 버튼처럼 보이게 하지 않는다.
 * 그 아래 구분선, 그다음 기존 항목이 온다. 게스트는 이 자리가 `로그인`이다.
 *
 * 앨범 상세 시트와 전역 시트가 **이 컴포넌트 하나**를 쓴다. 두 벌로 만들지 않는다.
 */
interface AccountSheetRowProps {
  user: { displayName: string; email?: string | null; avatarUrl?: string | null } | null;
  /** ★ 계정 동작(로그아웃·회원 탈퇴)은 여기 두지 않는다 — §5 순서상 시트 아래쪽,
   *  되돌릴 수 없는 것 옆이다. 이 행은 정보만 보여준다. */
  /** 게스트가 누르는 로그인. */
  onLogin?: () => void;
}

export default function AccountSheetRow({ user, onLogin }: AccountSheetRowProps) {
  if (!user) {
    return (
      <div className="account-row--guest">
        <button type="button" className="album-more-sheet__row" onClick={onLogin}><span>로그인</span></button>
      </div>
    );
  }
  return (
    <div className="account-row">
      <div className="account-row__head">
        {user.avatarUrl
          ? <img className="account-row__avatar" src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
          : <span className="account-row__avatar" aria-hidden="true">{user.displayName.slice(0, 1)}</span>}
        <div>
          <p className="account-row__name">{user.displayName}</p>
          {/* 이메일이 없으면 그 줄을 비운다(빈 줄을 만들지 않는다). */}
          {user.email ? <p className="account-row__email">{user.email}</p> : null}
        </div>
      </div>
    </div>
  );
}
