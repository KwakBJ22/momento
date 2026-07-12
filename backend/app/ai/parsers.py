from __future__ import annotations

import json
import re
from typing import Any

from fastapi import HTTPException


MIN_QUESTIONS = 3
MAX_QUESTIONS = 5


def parse_questions_json(raw: str) -> list[str]:
    text = raw.strip()
    match = re.search(r"\[[\s\S]*\]", text)
    if not match:
        raise HTTPException(status_code=502, detail="AI가 유효한 질문 목록을 반환하지 않았습니다.")
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="AI 질문 JSON 파싱에 실패했습니다.") from exc
    if not isinstance(parsed, list):
        raise HTTPException(status_code=502, detail="AI 질문 응답 형식이 올바르지 않습니다.")
    questions = [str(item).strip() for item in parsed if str(item).strip()]
    if len(questions) < MIN_QUESTIONS:
        raise HTTPException(status_code=502, detail="AI가 충분한 질문을 생성하지 못했습니다.")
    return questions[:MAX_QUESTIONS]


def parse_analysis_json(raw: str) -> dict[str, Any]:
    text = raw.strip()
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        raise HTTPException(status_code=502, detail="AI가 유효한 분석 JSON을 반환하지 않았습니다.")
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="AI 분석 JSON 파싱에 실패했습니다.") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=502, detail="AI 분석 응답 형식이 올바르지 않습니다.")
    return parsed
