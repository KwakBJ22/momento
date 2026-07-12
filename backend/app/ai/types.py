from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class PromptDocument:
    name: str
    version: str
    content: str
    mtime: float


@dataclass(frozen=True)
class AICompletionResult:
    content: str
    model: str
    prompt_name: str
    prompt_version: str
    input_tokens: int | None
    output_tokens: int | None
    estimated_cost: float | None
    latency_ms: int
    raw: Any | None = None
