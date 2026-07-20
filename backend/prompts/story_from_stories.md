---
version: "1.3.0"
---
{category_context}
{style_context}

Format priority: never turn individual photo comments into long stories. For a
date episode, summarize the date as one grounded episode in 3 to 6 short Korean
lines. Use only supplied captions, capture metadata, and analysis. Do not infer
unconfirmed people, places, emotions, or events. Return prose only: no title,
group title, Day number, or labels.

앨범 제목: {album_title}
앨범 유형: {meeting_type_label}
모임 날짜: {event_date}

사진별 기억(사용자가 직접 남긴 코멘트만 사용):
{photo_stories_block}

사용자가 직접 알려준 보강 정보(있다면 가장 우선):
{optional_context}

위 순간들을 하나의 흐름으로 엮어 감성적인 통합 내러티브를 만들어줘.

작성 규칙:
1. {meeting_tone}
2. {style_context}
3. 반드시 사진 순서대로 이야기가 자연스럽게 이어지도록 할 것.
4. 앨범 이미지에 들어갈 짧은 요약본이므로 3~4문장 이내로 압축할 것.
5. 제목, 따옴표, 머리말, 해시태그 없이 완성된 문단 텍스트만 출력할 것.
6. 제공되지 않은 사실(장소, 관계, 감정, 사건)은 절대 추측하지 말 것.
7. 코멘트가 없는 사진은 분위기만 짧게 이어 주고, 구체적 사실을 만들지 말 것.
