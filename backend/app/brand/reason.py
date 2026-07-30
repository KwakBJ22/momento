"""Template-based recommendation reasons (no AI)."""

from __future__ import annotations

from app.brand.scorer import ScoreBreakdown


def build_reason(name: str, breakdown: ScoreBreakdown) -> str:
    traits: list[str] = []
    length = len(name)

    if length <= 6:
        traits.append("짧고 기억하기 쉬우며")
    elif length <= 8:
        traits.append("적당한 길이로 발음이 자연스럽고")
    else:
        traits.append("독특한 느낌을 주며")

    if breakdown.naturalness >= 14:
        traits.append("자연스럽게 읽히고")
    if breakdown.memorability >= 11:
        traits.append("인상이 오래 남고")
    if breakdown.context_relevance >= 5:
        traits.append("서비스 성격과 잘 맞으며")
    if breakdown.spelling >= 7:
        traits.append("철자가 단순하고")
    if breakdown.pronunciation_unity >= 11:
        traits.append("발음이 매끄럽고")
    if breakdown.standalone_integrity >= 11:
        traits.append("하나의 브랜드명으로 완결되고")
    if breakdown.global_fit >= 4:
        traits.append("글로벌 서비스에도 어울리고")

    body = " ".join(traits) if traits else "균형 잡힌 발음과 철자로"
    return f"{body} .com 도메인 등록에 적합합니다."
