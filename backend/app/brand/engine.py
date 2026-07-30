"""Brand generation orchestration (no AI at runtime)."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

from app.brand.brand_quality import fails_premium_gate, has_formulaic_shape
from app.brand.data.context_map import extract_root_weights
from app.brand.dedup import get_recommendation_history
from app.brand.diversity import select_for_rdap, select_premium_final
from app.brand.pronunciation import to_korean
from app.brand.rdap import get_rdap_service
from app.brand.reason import build_reason
from app.brand.scorer import MIN_TOTAL_SCORE, ScoreBreakdown, rank_candidates, score_brand
from app.brand.templates import CURATED_BRAND_NAMES, STANDALONE_WORDS, generate_template_candidates

logger = logging.getLogger(__name__)

MAX_RESULTS = 20
DOMAIN_CHECK_MULTIPLIER = 30
MIN_TARGET_RESULTS = 8
_CURATED_SET = frozenset(name.lower() for name in CURATED_BRAND_NAMES)
_PREMIUM_ORDER = {name: index for index, name in enumerate(STANDALONE_WORDS)}

_TEMPLATE_SORT = {
    "standalone": 0,
    "namelike": 1,
    "symbolic": 2,
    "bilingual": 3,
    "compact_fusion": 4,
    "evocative": 5,
    "neologism": 6,
    "root_variant": 7,
    "root_fusion": 8,
}


@dataclass(frozen=True, slots=True)
class BrandResult:
    brand: str
    score: int
    domain: bool
    pronunciation: str
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "brand": self.brand,
            "score": self.score,
            "domain": self.domain,
            "pronunciation": self.pronunciation,
            "reason": self.reason,
        }


ProgressCallback = Callable[[int, str], None]


class BrandEngine:
    """End-to-end brand finder: templates → score → diversity → RDAP."""

    async def generate(
        self,
        description: str,
        *,
        on_progress: ProgressCallback | None = None,
    ) -> list[BrandResult]:
        def progress(step: int, message: str) -> None:
            if on_progress:
                on_progress(step, message)

        progress(1, "브랜드 생성중...")

        template_candidates = generate_template_candidates(description)
        root_weights = extract_root_weights(description)
        logger.info(
            "brand_templates description_len=%s candidates=%s",
            len(description),
            len(template_candidates),
        )

        progress(2, "브랜드 점수 계산중...")

        candidate_tuples = [(c.name, c.template, c.meaning_tags) for c in template_candidates]
        scored_lookup = {
            name: score_brand(
                name,
                root_weights,
                segments=tags if len(tags) >= 2 else None,
                template=template,
            )
            for name, template, tags in candidate_tuples
        }

        ranked = rank_candidates(
            candidate_tuples,
            min_score=MIN_TOTAL_SCORE,
            root_weights=root_weights,
            limit=800,
        )

        rdap_ranked: list[tuple[str, str, tuple[str, ...], float]] = []
        for name, template, tags in candidate_tuples:
            breakdown = scored_lookup.get(name)
            if breakdown is None or not breakdown.passes_gate:
                continue
            rdap_ranked.append((name, template, tags, float(breakdown.total)))

        rdap_ranked.sort(
            key=lambda item: (
                _TEMPLATE_SORT.get(item[1], 9),
                -item[3],
            ),
        )
        diverse = select_for_rdap(rdap_ranked, max_count=600)

        progress(3, ".com 검사중...")

        history = get_recommendation_history()
        diverse_scored = sorted(
            diverse,
            key=lambda item: (
                has_formulaic_shape(item[0]),
                item[0].lower() not in _CURATED_SET,
                -scored_lookup[item[0]].standalone_integrity,
                -scored_lookup[item[0]].pronunciation_unity,
                -scored_lookup[item[0]].total,
            ),
        )
        brand_order = history.filter_new([name for name, _, _ in diverse_scored])

        curated_order = [name for name in brand_order if name.lower() in _CURATED_SET]
        other_order = [
            name for name in brand_order
            if name.lower() not in _CURATED_SET and not has_formulaic_shape(name)
        ]

        check_limit = min(len(brand_order), MAX_RESULTS * DOMAIN_CHECK_MULTIPLIER)
        rdap = get_rdap_service()

        curated_limit = min(len(curated_order), 120)
        checked_curated = await rdap.find_available(
            curated_order[:curated_limit],
            target_count=curated_limit,
        )
        seen_checked = {brand for brand, _ in checked_curated}
        other_limit = max(0, check_limit - len(checked_curated))
        checked_other = await rdap.find_available(
            other_order[:other_limit],
            target_count=max(check_limit - curated_limit, MIN_TARGET_RESULTS * 6),
        )
        checked = checked_curated + [
            (brand, available)
            for brand, available in checked_other
            if brand not in seen_checked
        ]
        rdap_queries = len(checked)

        score_map: dict[str, ScoreBreakdown] = dict(scored_lookup)
        meta_map: dict[str, tuple[str, tuple[str, ...]]] = {
            name: (template, tags) for name, template, tags in candidate_tuples
        }

        progress(4, "최종 결과")

        available_ranked: list[tuple[str, str, tuple[str, ...], float]] = []
        for brand, is_available in checked:
            if not is_available:
                continue
            if has_formulaic_shape(brand) or fails_premium_gate(brand):
                continue
            breakdown = score_map.get(brand)
            if breakdown is None or not breakdown.passes_gate:
                continue
            template, tags = meta_map.get(brand, ("", ()))
            available_ranked.append((brand, template, tags, float(breakdown.total)))

        available_ranked.sort(
            key=lambda item: (
                _PREMIUM_ORDER.get(item[0].lower(), 1000),
                item[0].lower() not in _CURATED_SET,
                -score_map[item[0]].standalone_integrity,
                -score_map[item[0]].pronunciation_unity,
                -item[3],
            ),
        )
        final_selected = select_premium_final(
            available_ranked,
            max_count=MAX_RESULTS,
            min_count=MIN_TARGET_RESULTS,
        )

        results: list[BrandResult] = []
        for brand, template, tags in final_selected:
            breakdown = score_map[brand]
            results.append(
                BrandResult(
                    brand=brand,
                    score=breakdown.total,
                    domain=True,
                    pronunciation=to_korean(brand),
                    reason=build_reason(brand, breakdown),
                )
            )

        results.sort(key=lambda item: item.score, reverse=True)
        history.add([item.brand for item in results])
        logger.info(
            "brand_results count=%s rdap_queries=%s templates=%s",
            len(results),
            rdap_queries,
            {meta_map.get(r.brand, ("",))[0] for r in results},
        )
        return results

    async def generate_stream(self, description: str) -> AsyncIterator[dict[str, Any]]:
        events: list[dict[str, Any]] = []

        def on_progress(step: int, message: str) -> None:
            events.append({"type": "progress", "step": step, "message": message})

        results = await self.generate(description, on_progress=on_progress)

        for event in events:
            yield event
        yield {"type": "result", "results": [item.to_dict() for item in results]}


_engine: BrandEngine | None = None


def get_brand_engine() -> BrandEngine:
    global _engine
    if _engine is None:
        _engine = BrandEngine()
    return _engine
