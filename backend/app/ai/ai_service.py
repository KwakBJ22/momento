from __future__ import annotations

import time
from typing import Any

from fastapi import HTTPException
from openai import OpenAI, OpenAIError
from supabase import Client

from app.ai.model_router import AIFeature, ModelRouter
from app.ai.types import AICompletionResult
from app.ai.usage_repository import _estimate_cost, log_ai_usage
from app.config import Settings, get_settings


class AIService:
    """Central gateway for OpenAI chat and vision calls."""

    def __init__(self, settings: Settings | None = None, client: Client | None = None) -> None:
        self._settings = settings or get_settings()
        self._client = client
        self._openai = OpenAI(api_key=self._settings.openai_api_key)
        self._router = ModelRouter(self._settings)

    def _build_result(
        self,
        *,
        completion: Any,
        model: str,
        prompt_name: str,
        prompt_version: str,
        latency_ms: int,
    ) -> AICompletionResult:
        usage = getattr(completion, "usage", None)
        input_tokens = getattr(usage, "prompt_tokens", None) if usage else None
        output_tokens = getattr(usage, "completion_tokens", None) if usage else None
        estimated_cost = _estimate_cost(model, input_tokens, output_tokens)
        content = (completion.choices[0].message.content or "").strip()
        return AICompletionResult(
            content=content,
            model=model,
            prompt_name=prompt_name,
            prompt_version=prompt_version,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            estimated_cost=estimated_cost,
            latency_ms=latency_ms,
            raw=completion,
        )

    async def chat_completion(
        self,
        *,
        feature: AIFeature,
        messages: list[dict[str, Any]],
        prompt_name: str,
        prompt_version: str,
        max_tokens: int = 500,
        temperature: float = 0.7,
        operation: str,
        family_id: str | None = None,
        album_id: str | None = None,
        actor_profile_id: str | None = None,
    ) -> AICompletionResult:
        model = self._router.resolve(feature)
        started = time.perf_counter()
        try:
            completion = self._openai.chat.completions.create(
                model=model,
                max_tokens=max_tokens,
                temperature=temperature,
                messages=messages,
            )
        except OpenAIError as exc:
            raise HTTPException(status_code=502, detail=f"OpenAI API 호출 실패: {exc}") from exc

        result = self._build_result(
            completion=completion,
            model=model,
            prompt_name=prompt_name,
            prompt_version=prompt_version,
            latency_ms=int((time.perf_counter() - started) * 1000),
        )
        if self._client is not None:
            log_ai_usage(
                self._client,
                operation=operation,
                result=result,
                family_id=family_id,
                album_id=album_id,
                actor_profile_id=actor_profile_id,
            )
        if not result.content:
            raise HTTPException(status_code=502, detail="OpenAI API가 빈 응답을 반환했습니다.")
        return result

    async def vision_completion(
        self,
        *,
        messages: list[dict[str, Any]],
        system_prompt_name: str,
        system_prompt_version: str,
        user_prompt_name: str,
        user_prompt_version: str,
        max_tokens: int = 500,
        temperature: float = 0.4,
        operation: str = "vision_analysis",
        family_id: str | None = None,
        album_id: str | None = None,
        actor_profile_id: str | None = None,
    ) -> AICompletionResult:
        model = self._router.resolve("vision")
        started = time.perf_counter()
        try:
            completion = self._openai.chat.completions.create(
                model=model,
                max_tokens=max_tokens,
                temperature=temperature,
                messages=messages,
            )
        except OpenAIError as exc:
            raise HTTPException(status_code=502, detail=f"OpenAI Vision API 호출 실패: {exc}") from exc

        result = self._build_result(
            completion=completion,
            model=model,
            prompt_name=f"{system_prompt_name}+{user_prompt_name}",
            prompt_version=f"{system_prompt_version}+{user_prompt_version}",
            latency_ms=int((time.perf_counter() - started) * 1000),
        )
        if self._client is not None:
            log_ai_usage(
                self._client,
                operation=operation,
                result=result,
                family_id=family_id,
                album_id=album_id,
                actor_profile_id=actor_profile_id,
            )
        if not result.content:
            raise HTTPException(status_code=502, detail="OpenAI Vision API가 빈 응답을 반환했습니다.")
        return result
