from __future__ import annotations

from typing import Any

from supabase import Client

from app.ai.types import AICompletionResult


def _estimate_cost(model: str, input_tokens: int | None, output_tokens: int | None) -> float | None:
    if input_tokens is None and output_tokens is None:
        return None
    in_tokens = input_tokens or 0
    out_tokens = output_tokens or 0
    if "gpt-4o-mini" in model:
        return round((in_tokens * 0.15 + out_tokens * 0.60) / 1_000_000, 6)
    return round((in_tokens + out_tokens) * 0.50 / 1_000_000, 6)


def log_ai_usage(
    client: Client,
    *,
    operation: str,
    result: AICompletionResult,
    family_id: str | None = None,
    album_id: str | None = None,
    actor_profile_id: str | None = None,
    status: str = "succeeded",
    metadata: dict[str, Any] | None = None,
) -> None:
    record = {
        "family_id": family_id,
        "album_id": album_id,
        "actor_profile_id": actor_profile_id,
        "operation": operation,
        "provider": "openai",
        "model": result.model,
        "prompt_name": result.prompt_name,
        "prompt_version": result.prompt_version,
        "input_tokens": result.input_tokens,
        "output_tokens": result.output_tokens,
        "estimated_cost": result.estimated_cost,
        "latency_ms": result.latency_ms,
        "status": status,
        "metadata": metadata or {},
    }
    try:
        client.table("ai_usage_logs").insert(record).execute()
    except Exception:
        # Usage logging must not break primary AI flows.
        pass
