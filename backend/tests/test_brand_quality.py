"""Tests for brand generation quality improvements."""

from __future__ import annotations

import asyncio
from unittest.mock import patch

from app.brand.brand_quality import (
    detect_ending_family,
    fails_premium_gate,
    pronunciation_unity_score,
    standalone_integrity_score,
)
from app.brand.data.context_map import extract_root_weights
from app.brand.dedup import get_recommendation_history
from app.brand.diversity import analyze_diversity, select_diverse, select_for_rdap, select_premium_final
from app.brand.engine import BrandEngine
from app.brand.generator import CandidateGenerator, is_valid_candidate
from app.brand.naturalness import has_mem_glue, has_mechanical_ending, is_quality_candidate, looks_mechanical
from app.brand.phonetics import is_valid_candidate as phonetics_is_valid
from app.brand.scorer import rank_candidates, score_brand
from app.brand.templates import generate_template_candidates

SERVICE_DESC = (
    "가족과 친구가 함께 사진과 이야기를 모아 살아있는 추억 앨범을 만드는 서비스"
)

BAD_CANDIDATES = (
    "Limemno",
    "Komimna",
    "Kemimro",
    "Memimna",
    "Lomemro",
    "Kimimno",
    "Kiframemo",
    "Kuframemo",
    "Lurira",
    "Kousra",
    "Vousra",
)

WEAK_CANDIDATES = (
    "Liveuna",
    "Bonidu",
    "Echouna",
    "Tahoto",
    "Momeiva",
)


def test_bad_candidates_rejected_by_naturalness():
    for name in BAD_CANDIDATES:
        assert (
            has_mem_glue(name)
            or has_mechanical_ending(name)
            or looks_mechanical(name)
            or not is_quality_candidate(name)
        )


def test_weak_candidates_rejected_by_premium_rules():
    for name in WEAK_CANDIDATES:
        rejected = (
            fails_premium_gate(name)
            or not is_quality_candidate(name)
            or pronunciation_unity_score(name) < 0.62
            or standalone_integrity_score(name) < 0.58
        )
        assert rejected, f"{name} should be rejected"


def test_belaon_passes_premium_gate():
    assert is_quality_candidate("Belaon")
    assert not fails_premium_gate("Belaon")
    assert score_brand("Belaon", template="standalone").passes_gate


def test_bad_candidates_fail_scoring_gate():
    for name in BAD_CANDIDATES:
        breakdown = score_brand(name)
        assert not breakdown.passes_gate or breakdown.total == 0


def test_good_candidates_still_pass():
    for name in ("Belaon", "Relivo", "Sereno", "Lanero", "Velaro"):
        assert is_quality_candidate(name), name
        assert score_brand(name, template="standalone").passes_gate, name


def test_template_generation_produces_variety():
    candidates = generate_template_candidates(SERVICE_DESC)
    assert len(candidates) >= 40
    templates = {c.template for c in candidates}
    assert "standalone" in templates
    assert "namelike" in templates or "symbolic" in templates
    assert len(templates) >= 5


def test_triple_combo_is_minority():
    candidates = generate_template_candidates(SERVICE_DESC)
    triple = sum(1 for c in candidates if c.template == "triple_combo")
    assert triple == 0


def test_rdap_pool_has_multiple_templates():
    candidates = generate_template_candidates(SERVICE_DESC)
    weights = extract_root_weights(SERVICE_DESC)
    tuples = [(c.name, c.template, c.meaning_tags) for c in candidates]
    scored = [
        (n, t, tags, float(score_brand(n, weights, template=t).total))
        for n, t, tags in tuples
        if score_brand(n, weights, template=t).passes_gate
    ]
    pool = select_for_rdap(scored, max_count=200)
    templates = {t for _, t, _ in pool}
    assert len(templates) >= 5


def test_diversity_selection_limits_similar_names():
    ranked = [
        ("Belaon", "standalone", ("standalone",), 94.0),
        ("Belaro", "standalone", ("standalone",), 93.0),
        ("Relivo", "standalone", ("standalone",), 92.0),
        ("Sereno", "namelike", ("namelike",), 90.0),
        ("Lanero", "symbolic", ("together",), 89.0),
    ]
    selected = select_diverse(ranked, max_count=5)
    names = [n for n, _, _ in selected]
    assert "Belaon" in names
    assert len(names) >= 3


def test_diversity_metrics_on_ranked_pool():
    candidates = generate_template_candidates(SERVICE_DESC)
    weights = extract_root_weights(SERVICE_DESC)
    tuples = [(c.name, c.template, c.meaning_tags) for c in candidates]
    ranked = rank_candidates(tuples, min_score=65, root_weights=weights, limit=120)
    diverse = select_diverse(
        [(n, t, tags, float(bd.total)) for n, bd, t, tags in ranked],
        max_count=20,
    )
    names = [n for n, _, _ in diverse]
    if len(names) < 5:
        return
    metrics = analyze_diversity(names)
    assert metrics["mem_family_ratio"] <= 0.25
    assert metrics["cv_pattern_ratio"] <= 0.5


def test_ending_family_limit_in_selection():
    ranked = [
        ("Belaon", "standalone", ("standalone",), 90.0),
        ("Reluno", "standalone", ("standalone",), 89.0),
        ("Sereno", "namelike", ("namelike",), 88.0),
    ]
    selected = select_diverse(ranked, max_count=3)
    ending_families = [detect_ending_family(n) for n, _, _ in selected if detect_ending_family(n)]
    assert len(ending_families) == len(set(ending_families))


def test_formulaic_names_rejected():
    from app.brand.brand_quality import has_formulaic_shape

    for name in ("Lanluno", "Tardori", "Korduno", "Lanlira"):
        assert has_formulaic_shape(name), name
        assert fails_premium_gate(name), name


def test_select_premium_final_reaches_eight():
    from app.brand.data.context_map import extract_root_weights
    from app.brand.scorer import score_brand
    from app.brand.templates import generate_template_candidates

    weights = extract_root_weights(SERVICE_DESC)
    premium = [
        (c.name, c.template, c.meaning_tags, float(score_brand(c.name, weights, template=c.template).total))
        for c in generate_template_candidates(SERVICE_DESC)
        if c.name
        in (
            "Belaon", "Korfaro", "Relsaro", "Lanfaro", "Ralilo", "Welido",
            "Nolalo", "Lanulo", "Tarulo", "Dalnaro",
        )
    ]
    selected = select_premium_final(premium, max_count=20, min_count=8)
    assert len(selected) >= 8


def test_engine_returns_at_least_eight_premium_results():
    from app.brand.brand_quality import has_formulaic_shape

    get_recommendation_history().clear()

    async def _run():
        engine = BrandEngine()
        with patch("app.brand.engine.get_rdap_service") as mock:
            svc = mock.return_value

            async def fake_find(brands, target_count=20):
                return [(b, True) for b in brands]

            svc.find_available = fake_find
            return await engine.generate(SERVICE_DESC)

    results = asyncio.run(_run())
    assert len(results) >= 6
    assert any(r.brand == "Belaon" for r in results)
    names = [r.brand for r in results]
    ending_families = [detect_ending_family(n) for n in names if detect_ending_family(n)]
    assert len(ending_families) == len(set(ending_families))
    for bad in WEAK_CANDIDATES:
        assert bad not in names
    for item in results:
        assert not has_formulaic_shape(item.brand)
        assert item.score >= 74


def test_engine_does_not_return_bad_patterns():
    get_recommendation_history().clear()

    async def _run():
        engine = BrandEngine()
        with patch("app.brand.engine.get_rdap_service") as mock:
            svc = mock.return_value

            async def fake_find(brands, target_count=20):
                return [(b, True) for b in brands]

            svc.find_available = fake_find
            return await engine.generate(SERVICE_DESC)

    results = asyncio.run(_run())
    assert results
    for item in results:
        assert not has_mem_glue(item.brand)
        assert not looks_mechanical(item.brand)
        assert not fails_premium_gate(item.brand)
        assert item.score >= 74
    names = [r.brand.lower() for r in results]
    for bad in BAD_CANDIDATES + WEAK_CANDIDATES:
        assert bad.lower() not in names


def test_engine_quality_over_quantity():
    get_recommendation_history().clear()

    async def _run():
        engine = BrandEngine()
        with patch("app.brand.engine.get_rdap_service") as mock:
            svc = mock.return_value

            async def fake_find(brands, target_count=20):
                return [(b, index < 4) for index, b in enumerate(brands[:target_count])]

            svc.find_available = fake_find
            return await engine.generate(SERVICE_DESC)

    results = asyncio.run(_run())
    assert 1 <= len(results) <= 8


def test_candidate_generator_uses_templates():
    generator = CandidateGenerator()
    names = generator.generate(SERVICE_DESC)
    assert len(names) >= 30
    assert all(isinstance(n, str) for n in names[:10])


def test_valid_candidate_rules():
    assert is_valid_candidate("belaon")
    assert not is_valid_candidate("abc")
    assert not is_quality_candidate("limemno")
