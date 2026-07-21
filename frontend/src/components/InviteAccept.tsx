import { useEffect, useState } from "react";
import { acceptFamilyInvitation } from "../lib/api";
import "./FamilyManagement.css";

interface InviteAcceptProps {
  token: string;
  isLoggedIn: boolean;
}

export default function InviteAccept({ token, isLoggedIn }: InviteAcceptProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isLoggedIn || !token) return;
    let active = true;
    setLoading(true);
    void acceptFamilyInvitation(token)
      .then(() => {
        if (!active) return;
        setMessage("가족 초대를 수락했어요. 이제 함께 앨범을 만들 수 있어요.");
      })
      .catch((err) => active && setError(err instanceof Error ? err.message : "초대를 수락하지 못했어요."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [isLoggedIn, token]);

  if (!isLoggedIn) {
    return (
      <div className="family-panel">
        <h2>가족 초대</h2>
        <p className="family-panel__notice">초대를 수락하려면 먼저 로그인해주세요. 로그인 후 이 페이지로 다시 돌아오면 자동으로 수락됩니다.</p>
        <a className="btn btn--secondary" href="/">
          로그인하러 가기
        </a>
      </div>
    );
  }

  if (loading) {
    return <p className="family-panel__notice">초대를 확인하고 있어요...</p>;
  }

  return (
    <div className="family-panel">
      <h2>가족 초대</h2>
      {message && <p className="family-panel__notice">{message}</p>}
      {error && <p className="family-panel__error">{error}</p>}
      <a className="btn btn--secondary" href="/family">
        가족 관리로 이동
      </a>
      <a className="btn btn--ghost" href="/">
        홈으로
      </a>
    </div>
  );
}
