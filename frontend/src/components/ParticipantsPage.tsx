import { useEffect, useState } from "react";
import { getAlbumParticipation } from "../lib/api";
import "./FamilyManagement.css";

type Participant = { id: string; name: string; role: "host" | "participant"; photo_count: number; memory_count: number };

export default function ParticipantsPage({ albumId }: { albumId: string }) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void getAlbumParticipation(albumId)
      .then((data) => active && setParticipants(data.participants))
      .catch((cause) => active && setError(cause instanceof Error ? cause.message : "참여자를 불러오지 못했어요."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [albumId]);

  return <section className="family-panel">
    <header className="family-panel__header"><h2>참여자</h2><p>이 앨범을 함께 만들고 있는 사람들이에요.</p></header>
    {error ? <p className="family-panel__error">{error}</p> : null}
    <section className="family-panel__section">
      <ul className="member-list">
        {participants.map((participant) => <li key={participant.id} className="member-card"><div><strong>{participant.name}</strong><span className="member-card__role">{participant.role === "host" ? "주최자" : "참여자"} · 사진 {participant.photo_count}장 · 한마디 {participant.memory_count}개</span></div></li>)}
      </ul>
      {!loading && !error && participants.length === 0 ? <p className="family-panel__notice">아직 참여자가 없습니다.</p> : null}
      {loading ? <p className="family-panel__notice">참여자를 불러오는 중...</p> : null}
    </section>
  </section>;
}
