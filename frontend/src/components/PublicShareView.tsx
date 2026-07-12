import { useEffect, useState } from "react";
import { getPublicShare, submitGuestMemory, submitShareReaction } from "../lib/api";
import type { PublicShareAlbum } from "../types";
import "./AlbumResult.css";

interface PublicShareViewProps { token: string }

function guestSessionKey(): string {
  const key = "momento-guest-session";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID() + crypto.randomUUID();
  localStorage.setItem(key, created);
  return created;
}

export default function PublicShareView({ token }: PublicShareViewProps) {
  const [album, setAlbum] = useState<PublicShareAlbum | null>(null);
  const [name, setName] = useState("");
  const [memory, setMemory] = useState("");
  const [website, setWebsite] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getPublicShare(token).then((data) => {
      setAlbum(data);
      document.title = `${data.og_title} | Momento`;
      const description = document.querySelector('meta[name="description"]');
      if (description) description.setAttribute("content", data.og_description);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "앨범을 불러오지 못했어요."));
  }, [token]);

  const share = async () => {
    if (!album) return;
    const url = window.location.href;
    if (navigator.share) await navigator.share({ title: album.title, text: album.og_description, url });
    else await navigator.clipboard.writeText(url);
    setNotice("가족에게 앨범 링크를 전했어요.");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const result = await submitGuestMemory(token, { name, memory, website });
      localStorage.setItem("momento-guest-memory-claim", result.claim_token);
      setNotice("기억을 안전하게 보관했어요. 로그인하면 내 기억으로 연결할 수 있어요.");
      setMemory("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "기억을 보관하지 못했어요.");
    }
  };

  if (error) return <div className="album-result"><h2 className="album-result__title">공유 앨범을 열 수 없어요</h2><p>{error}</p></div>;
  if (!album) return <p className="auth-panel__notice">앨범을 불러오는 중...</p>;

  return <div className="album-result public-share">
    <h2 className="album-result__title">{album.title}</h2>
    <p className="album-result__subtitle">함께 만든 추억 앨범</p>
    <img src={album.image_url} alt={`${album.title} 대표 이미지`} className="album-result__image" />
    <section className="album-result__narrative"><h3>우리의 이야기</h3><p>{album.narrative}</p></section>
    {album.media.some((media) => media.media_type !== "image" && media.media_type !== "gif") && <section className="album-result__narrative"><h3>함께 담긴 미디어</h3><ul className="media-placeholder-list">{album.media.filter((media) => media.media_type !== "image" && media.media_type !== "gif").map((media, index) => <li className="media-placeholder" key={`${media.media_type}-${index}`}><span>{media.media_type === "video" ? "🎬" : media.media_type === "audio" ? "🎵" : "📄"}</span><span>{media.original_filename || media.mime_type}</span><small>앨범에 담겨 있어요</small></li>)}</ul></section>}
    <form className="public-share__memory" onSubmit={submit}>
      <h3>이날의 기억을 한 줄 남겨주세요</h3>
      <input className="field__input" value={name} onChange={(event) => setName(event.target.value)} placeholder="이름" maxLength={50} required />
      <textarea className="field__input field__textarea" value={memory} onChange={(event) => setMemory(event.target.value)} placeholder="떠오르는 기억 한 줄" maxLength={300} rows={3} required />
      <input className="public-share__honeypot" value={website} onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" />
      <button className="upload-form__submit" type="submit">내 기억 남기기</button>
    </form>
    <div className="public-share__secondary-actions"><button type="button" className="btn btn--ghost" onClick={() => void share()}>가족에게 공유하기</button><a className="btn btn--ghost" href="/">새 앨범 만들기</a></div>
    <div className="public-share__reactions">{[["remember", "기억나요"], ["warm", "따뜻해요"], ["smile", "웃음나요"]].map(([reaction, label]) => <button key={reaction} type="button" className="link-btn" onClick={() => void submitShareReaction(token, reaction, guestSessionKey()).catch(() => undefined)}>{label}</button>)}</div>
    {notice && <p className="album-result__notice">{notice}</p>}
  </div>;
}
