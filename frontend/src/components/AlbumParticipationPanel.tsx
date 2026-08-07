import { useEffect, useState } from "react";
import { applyContributions, getAlbumParticipation, getPendingContributions } from "../lib/api";
import "./FamilyManagement.css";

export default function AlbumParticipationPanel({ albumId }: { albumId: string }) {
  const [data, setData] = useState<any>(null);
  const [pending, setPending] = useState<any[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () => void getAlbumParticipation(albumId).then(setData).catch(() => undefined);
  useEffect(refresh, [albumId]);

  const openPending = async () => {
    try {
      const result = await getPendingContributions(albumId);
      setPending(result.items);
      setSelected(new Set(result.items.map((item: any) => item.id)));
    } catch { setNotice("새로 추가된 추억을 불러오지 못했습니다."); }
  };
  const apply = async () => {
    if (!pending) return;
    setBusy(true); setNotice("새로운 추억을 앨범에 담고 있습니다.");
    try {
      await applyContributions(albumId, pending.filter((item) => selected.has(item.id) && item.type === "photo").map((item) => item.id), pending.filter((item) => selected.has(item.id) && item.type === "memory").map((item) => item.id));
      setPending(null); setSelected(new Set()); setNotice("새로운 추억이 앨범에 반영되었습니다."); refresh();
    } catch { setNotice("앨범에 반영하지 못했습니다. 잠시 후 다시 시도해 주세요."); }
    finally { setBusy(false); }
  };
  if (!data) return null;
  return <section className="family-panel__section">
    <h3>함께 만드는 사람들</h3>
    <button type="button" className="link-btn" disabled={data.new_memory_count === 0} onClick={() => void openPending()}>새로운 추억 {data.new_memory_count}개</button>
    <ul className="member-list">{data.participants.map((person: any) => <li className="member-card" key={person.id}><div><strong>{person.name}</strong><span className="member-card__role">{person.role === "host" ? "주최자" : "참여자"} · 사진 {person.photo_count}장 · 한마디 {person.memory_count}개</span></div></li>)}</ul>
    {pending ? <div className="family-panel__section"><h3>새로 모인 추억</h3>{pending.length ? <><label><input type="checkbox" checked={selected.size === pending.length} onChange={(event) => setSelected(event.target.checked ? new Set(pending.map((item) => item.id)) : new Set())} /> 전체 선택</label><ul className="member-list">{pending.map((item) => <li className="member-card" key={item.id}><input type="checkbox" checked={selected.has(item.id)} onChange={() => setSelected((current) => { const next = new Set(current); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; })} /><div>{item.type === "photo" && item.thumbnail_url ? <img src={item.thumbnail_url} alt="" width="48" height="48" /> : null}<strong>{item.actor_name}님이 {item.type === "photo" ? "사진을 추가했습니다." : "한 줄을 남겼습니다."}</strong><span className="member-card__role">{item.content || item.comment || new Date(item.created_at).toLocaleString("ko-KR")}</span></div></li>)}</ul><button type="button" className="upload-form__submit" disabled={busy || selected.size === 0} onClick={() => void apply()}>앨범에 반영하기</button></> : <p className="family-panel__notice">아직 새로 추가된 추억이 없습니다.</p>}</div> : null}
    {notice ? <p className="family-panel__notice">{notice}</p> : null}
  </section>;
}
