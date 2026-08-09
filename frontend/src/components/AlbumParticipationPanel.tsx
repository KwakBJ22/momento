import { useEffect, useState } from "react";
import { applyContributions, getAlbumParticipation, getPendingContributions } from "../lib/api";
import "./FamilyManagement.css";

export default function AlbumParticipationPanel({ albumId }: { albumId: string }) {
  const [data, setData] = useState<any>(null);
  const [pending, setPending] = useState<any[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  /** 알림 한 줄 — 진행·성공·실패가 한 자리에 온다. 성격을 함께 들어야 색과 읽힘이 갈린다(I-5b). */
  const [notice, setNotice] = useState<{ text: string; kind: "progress" | "success" | "error" } | null>(null);

  const refresh = () => void getAlbumParticipation(albumId).then(setData).catch(() => undefined);
  useEffect(refresh, [albumId]);

  const openPending = async () => {
    try {
      const result = await getPendingContributions(albumId);
      setPending(result.items);
      setSelected(new Set(result.items.map((item: any) => item.id)));
    } catch { setNotice({ text: "새로 더해진 사진과 한마디를 불러오지 못했어요.", kind: "error" }); }
  };
  const apply = async () => {
    if (!pending) return;
    setBusy(true); setNotice({ text: "새로 더해진 사진과 한마디를 앨범에 담고 있어요.", kind: "progress" });
    try {
      await applyContributions(albumId, pending.filter((item) => selected.has(item.id) && item.type === "photo").map((item) => item.id), pending.filter((item) => selected.has(item.id) && item.type === "memory").map((item) => item.id));
      setPending(null); setSelected(new Set()); setNotice({ text: "새로 더해진 사진과 한마디를 앨범에 담았어요.", kind: "success" }); refresh();
    } catch { setNotice({ text: "앨범에 반영하지 못했습니다. 잠시 후 다시 시도해 주세요.", kind: "error" }); }
    finally { setBusy(false); }
  };
  if (!data) return null;
  return <section className="family-panel__section">
    <h3>함께 만드는 사람들</h3>
    <button type="button" className="link-btn" disabled={data.new_memory_count === 0} onClick={() => void openPending()}>새로 더해진 사진과 한마디 {data.new_memory_count}개</button>
    <ul className="member-list">{data.participants.map((person: any) => <li className="member-card" key={person.id}><div><strong>{person.name}</strong><span className="member-card__role">{person.role === "host" ? "주최자" : "참여자"} · 사진 {person.photo_count}장 · 한마디 {person.memory_count}개</span></div></li>)}</ul>
    {pending ? <div className="family-panel__section"><h3>새로 더해진 사진과 한마디</h3>{pending.length ? <><label><input type="checkbox" checked={selected.size === pending.length} onChange={(event) => setSelected(event.target.checked ? new Set(pending.map((item) => item.id)) : new Set())} /> 전체 선택</label><ul className="member-list">{pending.map((item) => <li className="member-card" key={item.id}><input type="checkbox" checked={selected.has(item.id)} onChange={() => setSelected((current) => { const next = new Set(current); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; })} /><div>{item.type === "photo" && item.thumbnail_url ? <img src={item.thumbnail_url} alt="" width="48" height="48" /> : null}<strong>{item.actor_name}님이 {item.type === "photo" ? "사진을 추가했습니다." : "한 줄을 남겼습니다."}</strong><span className="member-card__role">{item.content || item.comment || new Date(item.created_at).toLocaleString("ko-KR")}</span></div></li>)}</ul><button type="button" className="upload-form__submit" disabled={busy || selected.size === 0} onClick={() => void apply()}>앨범에 반영하기</button></> : <p className="family-panel__notice">아직 새로 더해진 것이 없어요.</p>}</div> : null}
    {notice ? <p className={`notice notice--${notice.kind} family-panel__notice`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p> : null}
  </section>;
}
