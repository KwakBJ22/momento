from __future__ import annotations

import re
import time
from pathlib import Path

import yaml

from app.ai.types import PromptDocument
from app.config import Settings, get_settings

PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts"
_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def _parse_frontmatter(raw: str) -> tuple[dict[str, str], str]:
    match = _FRONTMATTER_RE.match(raw)
    if not match:
        return {}, raw.strip()
    metadata = yaml.safe_load(match.group(1)) or {}
    body = raw[match.end() :].strip()
    if not isinstance(metadata, dict):
        metadata = {}
    return {str(key): str(value) for key, value in metadata.items()}, body


class PromptManager:
    """Load and cache markdown prompts with optional hot reload."""

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._cache: dict[str, PromptDocument] = {}

    @property
    def hot_reload_enabled(self) -> bool:
        return self._settings.should_hot_reload_prompts

    def _resolve_path(self, name: str) -> Path:
        filename = name if name.endswith(".md") else f"{name}.md"
        return PROMPTS_DIR / filename

    def load_prompt(self, name: str) -> PromptDocument:
        path = self._resolve_path(name)
        if not path.exists():
            raise FileNotFoundError(f"Prompt file not found: {path}")

        mtime = path.stat().st_mtime
        cached = self._cache.get(name)
        if cached and not self.hot_reload_enabled:
            return cached
        if cached and cached.mtime == mtime:
            return cached

        raw = path.read_text(encoding="utf-8")
        metadata, body = _parse_frontmatter(raw)
        document = PromptDocument(
            name=name,
            version=str(metadata.get("version") or "0.0.0"),
            content=body,
            mtime=mtime,
        )
        self._cache[name] = document
        return document

    loadPrompt = load_prompt

    def render_prompt(self, name: str, **values: str) -> tuple[str, str]:
        document = self.load_prompt(name)
        return document.content.format(**values), document.version

    def clear_cache(self) -> None:
        self._cache.clear()


_prompt_manager: PromptManager | None = None


def get_prompt_manager(settings: Settings | None = None) -> PromptManager:
    global _prompt_manager
    if _prompt_manager is None or settings is not None:
        _prompt_manager = PromptManager(settings)
    return _prompt_manager
