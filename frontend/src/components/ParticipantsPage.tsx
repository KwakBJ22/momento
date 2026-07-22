import { useEffect, useState } from "react";
import { getParticipantStats } from "../lib/api";
import "./FamilyManagement.css";

type Participant = { id: string; display_name: string; photo_count: number; memory_count: number };

export default function ParticipantsPage() {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getParticipantStats().then((data) => setParticipants(data.participants)).catch((cause) => setError(cause instanceof Error ? cause.message : "참여자를 불러오지 못했어요."));
  }, []);

  const invite = async () => {
    const url = window.location.href;
    if (navigator.share) await navigator.share({ title: "Momento 함께 만들기", url });
    else await navigator.clipboard.writeText(url);
  };

  return <section className="family-panel">
    <header className="family-panel__header"><h2>참여자</h2><p>함께 사진과 추억을 모으고 있어요.</p></header>
    {error ? <p className="family-panel__error">{error}</p> : null}
    <section className="family-panel__section">
      <ul className="member-list">
        {participants.map((participant) => <li key={participant.id} className="member-card"><div><strong>{participant.display_name}</strong><span className="member-card__role">사진 {participant.photo_count}장 · 추억 {participant.memory_count}개</span></div></li>)}
      </ul>
    </section>
    <button type="button" className="upload-form__submit" onClick={() => void invite()}>카카오톡으로 초대</button>
  </section>;
}
