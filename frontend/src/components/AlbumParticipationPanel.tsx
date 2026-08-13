import { useEffect, useState } from "react";
import { getAlbumParticipation } from "../lib/api";
import "./FamilyManagement.css";

/**
 * 함께 만드는 사람들 — **보여주기만 한다.**
 *
 * ★ `새로 더해진 사진과 한마디 N개` 버튼과 그 아래 체크박스 목록을 걷어냈다
 *   (2026-08-13 PO 결정). 새로 올라온 것은 **올라오는 즉시 서버가** 마지막
 *   페이지에 붙이므로, 셀 이유도 고를 이유도 없다.
 * ★ 앨범을 다시 짜는 것(`앨범 다시 구성하기`)은 헤더 `더보기` 시트에 한 줄로
 *   있고 주최자만 볼 수 있다. 같은 일을 하는 자리를 두 벌 두지 않는다.
 */
export default function AlbumParticipationPanel({ albumId }: { albumId: string }) {
  const [data, setData] = useState<any>(null);

  const refresh = () => void getAlbumParticipation(albumId).then(setData).catch(() => undefined);
  useEffect(refresh, [albumId]);

  if (!data) return null;
  return <section className="family-panel__section">
    <h3>함께 만드는 사람들</h3>
    <ul className="member-list">{data.participants.map((person: any) => <li className="member-card" key={person.id}><div><strong>{person.name}</strong><span className="member-card__role">{person.role === "host" ? "주최자" : "참여자"} · 사진 {person.photo_count}장 · 한마디 {person.memory_count}개</span></div></li>)}</ul>
  </section>;
}
