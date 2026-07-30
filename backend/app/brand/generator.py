"""Candidate pool (legacy) and template-driven generation entry point."""

from __future__ import annotations

from app.brand.naturalness import is_quality_candidate
from app.brand.phonetics import is_valid_candidate
from app.brand.templates import generate_template_candidates

# Re-export for backward compatibility in tests
__all__ = ["CandidateGenerator", "get_generator", "is_valid_candidate", "is_quality_candidate"]


class CandidateGenerator:
    """Template-first candidate generation."""

    def __init__(self) -> None:
        self._pool_size: int | None = None

    def ensure_built(self) -> None:
        if self._pool_size is None:
            self._pool_size = len(generate_template_candidates(""))

    @property
    def pool_size(self) -> int:
        self.ensure_built()
        return self._pool_size or 0

    def generate(self, description: str = "") -> list[str]:
        return [c.name for c in generate_template_candidates(description)]


_generator: CandidateGenerator | None = None


def get_generator() -> CandidateGenerator:
    global _generator
    if _generator is None:
        _generator = CandidateGenerator()
    return _generator
