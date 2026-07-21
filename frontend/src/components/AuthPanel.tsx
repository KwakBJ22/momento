import { useState } from "react";
import { isSupabaseAuthConfigured, supabase } from "../lib/supabase";

interface AuthPanelProps {
  purpose?: "default" | "album-storage";
}

export default function AuthPanel({ purpose = "default" }: AuthPanelProps) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const storingAlbum = purpose === "album-storage";

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
    setMessage(error ? error.message : storingAlbum ? "보관 링크를 이메일로 보냈어요. 이메일을 확인해 주세요." : "이메일로 받은 링크를 확인해 주세요.");
  };

  if (!isSupabaseAuthConfigured) {
    return <p className="auth-panel__notice">이메일 연결을 준비하고 있어요.</p>;
  }

  return (
    <form className="auth-panel" onSubmit={sendMagicLink}>
      <h2>{storingAlbum ? "내 앨범 보관하기" : "추억을 이어서 보관하세요"}</h2>
      <p>{storingAlbum ? "이메일을 연결하면 지금 만든 앨범을 언제든 다시 볼 수 있어요." : "이메일로 받은 링크를 열어 내 앨범을 다시 볼 수 있어요."}</p>
      <label className="field">
        <span className="field__label">이메일</span>
        <input className="field__input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" required />
      </label>
      {message && <p className="auth-panel__notice">{message}</p>}
      <button className="upload-form__submit" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "보내는 중..." : storingAlbum ? "보관 링크 받기" : "이메일 링크 받기"}
      </button>
    </form>
  );
}
