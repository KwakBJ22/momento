import json
from typing import Any

from fastapi import HTTPException
from openai import OpenAI, OpenAIError

from app.config import Settings, get_settings
from app.models.schemas import MEETING_TYPE_LABELS

# 모임 유형별 감성 톤앤매너
MEETING_TONE: dict[str, str] = {
    "family": (
        "50대 부모님도 감동할 만큼 따뜻하고 정겨운 말투로 작성해줘. "
        "가족의 사랑과 세대를 잇는 추억이 느껴지도록 표현해줘."
    ),
    "friend": (
        "오랜 친구 사이의 편안하고 다정한 말투로 작성해줘. "
        "함께한 시간의 소중함과 우정이 묻어나도록 표현해줘."
    ),
    "work": (
        "깔끔하고 담백하면서도 서로를 격려하는 말투로 작성해줘. "
        "동료로서의 유대감과 응원의 메시지가 담기도록 표현해줘."
    ),
    "university": (
        "젊고 활기찬 말투로 작성해줘. "
        "청춘의 설렘과 생동감, 유쾌한 에너지가 느껴지도록 표현해줘."
    ),
}


def parse_stories_json(stories_raw: str) -> list[dict[str, Any]]:
    """프론트에서 전달된 사진별 스토리 JSON을 파싱. 형식: [{"order":0,"user":"","text":"..."}]"""
    try:
        parsed = json.loads(stories_raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="stories 필드는 유효한 JSON 배열이어야 합니다.") from exc

    if not isinstance(parsed, list):
        raise HTTPException(status_code=400, detail="stories 필드는 JSON 배열이어야 합니다.")

    result: list[dict[str, Any]] = []
    for item in parsed:
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail="각 story 항목은 객체여야 합니다.")
        if "order" not in item:
            raise HTTPException(status_code=400, detail="각 story 항목에 order가 필요합니다.")
        text = str(item.get("text", item.get("story", ""))).strip()
        result.append(
            {
                "order": int(item["order"]),
                "user": str(item.get("user", "")).strip(),
                "text": text,
            }
        )
    return result


def build_narrative_prompt(photo_stories: list[dict[str, Any]], meeting_type: str, title: str) -> str:
    """업로드(타임라인) 순서의 사진 설명을 gpt-4o-mini 프롬프트로 변환."""
    ordered = sorted(photo_stories, key=lambda x: int(x.get("order", 0)))
    lines: list[str] = []
    for idx, item in enumerate(ordered, start=1):
        user = item.get("user") or ""
        text = item.get("text", "")
        prefix = f"{user}: " if user else ""
        lines.append(f'[사진 {idx}] {prefix}"{text}"')

    photo_block = "\n".join(lines)
    label = MEETING_TYPE_LABELS.get(meeting_type, "모임")
    tone = MEETING_TONE.get(meeting_type, MEETING_TONE["friend"])

    return f"""다음은 '{title}'({label} 모임)의 사진 설명이야. 사진은 시간순(타임라인)으로 정렬되어 있어:

{photo_block}

위 순간들을 하나의 흐름으로 엮어 감성적인 통합 내러티브를 만들어줘.

작성 규칙:
1. {tone}
2. 반드시 타임라인(시간) 순서대로 이야기가 자연스럽게 이어지도록 할 것.
3. 앨범 이미지에 들어갈 짧은 요약본이므로 3~4문장 이내로 압축할 것.
4. 제목, 따옴표, 머리말, 해시태그 없이 완성된 문단 텍스트만 출력할 것."""


async def generate_narrative(
    photo_stories: list[dict[str, Any]],
    meeting_type: str,
    title: str = "우리의 모임",
    settings: Settings | None = None,
) -> str:
    settings = settings or get_settings()
    client = OpenAI(api_key=settings.openai_api_key)
    prompt = build_narrative_prompt(photo_stories, meeting_type, title)

    try:
        completion = client.chat.completions.create(
            model=settings.openai_model,
            max_tokens=500,
            temperature=0.8,
            messages=[
                {
                    "role": "system",
                    "content": "너는 모임의 추억을 감성적인 한 편의 짧은 이야기로 엮어주는 한국어 카피라이터야.",
                },
                {"role": "user", "content": prompt},
            ],
        )
    except OpenAIError as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI API 호출 실패: {exc}") from exc

    narrative = (completion.choices[0].message.content or "").strip()
    if not narrative:
        raise HTTPException(status_code=502, detail="OpenAI API가 빈 응답을 반환했습니다.")

    return narrative
