import { useState } from "react";
import { isSupabaseAuthConfigured, supabase } from "../lib/supabase";

export default function AuthPanel() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const sendMagicLink = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setMessage(null);
    setIsSubmitting(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setIsSubmitting(false);
    setMessage(error ? error.message : "로그인 링크를 이메일로 보냈어요. 메일함을 확인해주세요.");
  };

  if (!isSupabaseAuthConfigured) {
    return <p className="auth-panel__notice">로그인 설정을 준비 중이에요.</p>;
  }

  return (
    <form className="auth-panel" onSubmit={sendMagicLink}>
      <h2>내 가족의 추억 공간</h2>
      <p>이메일로 받은 로그인 링크를 열면 내 가족 앨범을 만들 수 있어요.</p>
      <label className="field">
        <span className="field__label">이메일</span>
        <input
          className="field__input"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          required
        />
      </label>
      {message && <p className="auth-panel__notice">{message}</p>}
      <button className="upload-form__submit" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "보내는 중..." : "이메일로 로그인 링크 받기"}
      </button>
    </form>
  );
}
