// 참여자 whoami 띠(목업 album-detail-participant.html, 3a)의 문구 조립.
// 앞칸(누가 만든 앨범인가)과 뒷칸(나는 누구로 있나)은 서로 독립으로 판정한다 —
// 하나로 묶으면 "관계는 있는데 소유자 이름만 아이디"일 때 관계 정보가 버려진다.
// ownerName 은 서버가 usable_owner_display_name 판정을 통과시킨 값만 온다
// (이메일 앞부분 차단은 계정 이메일이 필요해 백엔드에서 한다).

export interface ParticipantBannerInput {
  ownerName?: string | null;
  albumTitle: string;
  relationship?: string | null;
  myName?: string | null;
}

/** 이름 뒤 조사: 받침 없음·ㄹ받침 → "로", 그 외 받침 → "으로". 비한글은 "로". */
export function roParticle(name: string): string {
  const last = name.charCodeAt(name.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return "로";
  const jong = (last - 0xac00) % 28;
  return jong === 0 || jong === 8 ? "로" : "으로";
}

/** 말 뒤 조사: 받침 있음 → "을", 없음 → "를". 비한글은 "를"(`기본형를` 이 아니라 `기본형을`
 *  같은 어색함을 막는 자리는 여기 하나다 — 화면마다 따로 적지 않는다). */
export function eulParticle(word: string): string {
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return "를";
  return (last - 0xac00) % 28 === 0 ? "를" : "을";
}

/** 앞칸: 소유자 이름을 쓸 수 있으면 "○○님이 만든 앨범에", 아니면 "'제목'에". */
export function participantBannerLead(input: ParticipantBannerInput): string {
  const owner = (input.ownerName || "").trim();
  return owner ? `${owner}님이 만든 앨범에` : `‘${input.albumTitle}’에`;
}

/** 뒷칸: 관계 유무 → 이름 유무 순. "함께하고"는 붙여 쓴다(참여의 뜻). */
export function participantBannerTail(input: ParticipantBannerInput): string {
  const name = (input.myName || "").trim();
  if (!name) return "함께하고 있어요";
  const relationship = (input.relationship || "").trim();
  const prefix = relationship ? `${relationship} ` : "";
  return `${prefix}${name}${roParticle(name)} 함께하고 있어요`;
}

export function participantBannerText(input: ParticipantBannerInput): string {
  return `${participantBannerLead(input)} ${participantBannerTail(input)}`;
}
