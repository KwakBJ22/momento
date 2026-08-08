import { useEffect, useState } from "react";
import { deleteGuestbookEntry, submitGuestbookEntry } from "../lib/api";
import {
  GUESTBOOK_MESSAGE_MAX,
  GUESTBOOK_NAME_MAX,
  addMyGuestbookId,
  getGuestbookSessionKey,
  readMyGuestbookIds,
  removeMyGuestbookId,
} from "../lib/shareGuestbook";
import type { GuestbookItem } from "../types";

/**
 * ③ 방명록 — 앨범 전체에 남기는 인사. 주최자·참여자·구경꾼 전원이 쓸 수 있다.
 *
 * 공유 화면(PublicShareView)의 기존 구현을 그대로 옮긴 것이다 — 클래스·문구·동작을
 * 바꾸지 않았다. 앨범 상세(AlbumView)도 같은 컴포넌트를 쓴다.
 * ★ 앨범 본문(AlbumRenderer) 밖의 별도 구역이다: PDF·인쇄에 들어가지 않는다.
 */
interface AlbumGuestbookProps {
  /** 공유 토큰(/s/<token>) — 방명록 API는 이 토큰으로 앨범을 찾는다. */
  token: string;
  albumId: string;
  initialEntries?: GuestbookItem[];
  /** 이름 입력 초기값(참여자는 자기 표시 이름이 들어온다). */
  defaultAuthorName?: string;
}

function formatEntryTime(value: string | null | undefined): string {
  if (!value) return "방금 전";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "방금 전";
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

export default function AlbumGuestbook({ token, albumId, initialEntries = [], defaultAuthorName = "" }: AlbumGuestbookProps) {
  const [entries, setEntries] = useState<GuestbookItem[]>(initialEntries);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [authorName, setAuthorName] = useState(defaultAuthorName);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setEntries(initialEntries); }, [initialEntries]);
  useEffect(() => { setMine(readMyGuestbookIds(albumId)); }, [albumId]);

  const submit = async () => {
    if (submitting) return;
    const name = authorName.trim();
    const text = message.trim();
    if (!name) { setError("이름을 입력해 주세요."); return; }
    if (!text) { setError("남기고 싶은 말을 적어 주세요."); return; }
    setSubmitting(true);
    setError(null);
    try {
      const entry = await submitGuestbookEntry(token, { author_name: name, message: text, session_key: getGuestbookSessionKey() });
      setEntries((prev) => [entry, ...prev]);
      setMine((prev) => new Set(prev).add(entry.id));
      addMyGuestbookId(albumId, entry.id);
      setMessage("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "한마디를 남기지 못했어요. 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (entryId: string) => {
    const previous = entries;
    setEntries((prev) => prev.filter((entry) => entry.id !== entryId));
    try {
      await deleteGuestbookEntry(token, entryId, getGuestbookSessionKey());
      setMine((prev) => { const next = new Set(prev); next.delete(entryId); return next; });
      removeMyGuestbookId(albumId, entryId);
    } catch {
      setEntries(previous); // restore on failure
    }
  };

  return (
    <section className="public-share__guestbook" aria-label="우리가 남긴 말">
      <h3 className="public-share__guestbook-title">우리가 남긴 말</h3>
      <p className="public-share__guestbook-hint">앨범 전체에 짧은 인사를 남겨보세요.</p>
      <form className="public-share__guestbook-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <input className="public-share__guestbook-name" value={authorName} maxLength={GUESTBOOK_NAME_MAX} autoComplete="name" placeholder="이름" aria-label="이름" onChange={(event) => setAuthorName(event.target.value)} />
        <textarea className="public-share__guestbook-message" value={message} maxLength={GUESTBOOK_MESSAGE_MAX} rows={2} placeholder="남기고 싶은 말을 적어 주세요." aria-label="남길 말" onChange={(event) => setMessage(event.target.value)} />
        <div className="public-share__guestbook-actions">
          <span className="public-share__guestbook-count">{message.length}/{GUESTBOOK_MESSAGE_MAX}</span>
          <button type="submit" className="upload-form__submit" disabled={submitting}>{submitting ? "남기는 중..." : "여기에 남기기"}</button>
        </div>
        {error ? <p className="public-share__guestbook-error" role="alert">{error}</p> : null}
      </form>
      {entries.length ? (
        <ul className="public-share__guestbook-list">
          {entries.map((entry) => (
            <li key={entry.id} className="public-share__guestbook-item">
              <div className="public-share__guestbook-item-head">
                <span className="public-share__guestbook-author">{entry.author_name}</span>
                <span className="public-share__guestbook-time">{formatEntryTime(entry.created_at)}</span>
                {mine.has(entry.id) ? <button type="button" className="public-share__guestbook-delete" onClick={() => void remove(entry.id)}>삭제</button> : null}
              </div>
              <p className="public-share__guestbook-text">{entry.message}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
