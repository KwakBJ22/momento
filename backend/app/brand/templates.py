"""Template-based brand candidate generation (quality-first, low suffix dependency)."""

from __future__ import annotations

from dataclasses import dataclass
from itertools import combinations

from app.brand.data.context_map import extract_root_weights
from app.brand.naturalness import GLUE_RISK_ROOTS, is_quality_candidate, junction_score

# --- Template type constants ---
TEMPLATE_STANDALONE = "standalone"
TEMPLATE_COMPACT_FUSION = "compact_fusion"
TEMPLATE_NAMELIKE = "namelike"
TEMPLATE_SYMBOLIC = "symbolic"
TEMPLATE_BILINGUAL = "bilingual"
TEMPLATE_EVOCATIVE = "evocative"
TEMPLATE_ROOT_FUSION = "root_fusion"
TEMPLATE_ROOT_VARIANT = "root_variant"
TEMPLATE_NEOLOGISM = "neologism"
TEMPLATE_TRIPLE = "triple_combo"

# A. Short standalone words (5–8 chars, unified brand feel)
STANDALONE_WORDS: tuple[str, ...] = (
    # RDAP-verified premium .com candidates (quality-first)
    "belaon", "korfaro", "relsaro", "lanfaro", "solfaro", "ralilo", "welido",
    "nolalo", "lanulo", "tarulo", "norfaro", "morfaro", "borfaro", "haraon",
    "rovaon", "noraon", "reldian", "rovdian",
    # Curated aspirational forms
    "relivo", "sereno", "rivaro", "nelumo", "tarimo", "velaro", "melino",
    "korivo", "lanero", "soleno", "harino", "belaro", "renivo", "talero",
    "verilo", "domero", "kaliro", "novilo", "lumero", "kinero", "harelo",
    "sorino", "telaro", "melaro", "renalo", "volero", "nerilo", "salero",
    "pelino", "morino", "delaro", "lenaro", "miralo", "sorano", "velino",
    "marino", "nelaro", "kerilo", "rovilo", "lunero", "senaro", "harimo",
    "toleno", "rilano", "melora", "serila", "navilo", "lorien",
)

# C. Name-like forms (soft, 2–3 syllables)
NAMELIKE_WORDS: tuple[str, ...] = (
    "miren", "solira", "lenaro", "marilo", "rilano", "senaro", "toleno",
    "denlo", "marlo", "senro", "rilan", "tolen", "neria", "valen", "lorin",
    "melia", "serin", "tarin", "belin", "renia", "kalin", "novin", "harin",
)

# D. Symbolic sound forms (warm phonetics, meaning not spelled out)
SYMBOLIC_WORDS: tuple[str, ...] = (
    "lumero", "solara", "harimo", "velino", "renalo", "melora", "serila",
    "navilo", "lorien", "kinero", "harelo", "toleno", "rilano", "sorano",
    "belaro", "nelumo", "rivaro", "relivo", "verilo", "domero",
)

# E. Bilingual-friendly (clear EN pronunciation, 2–4 KR syllables)
BILINGUAL_WORDS: tuple[str, ...] = (
    "belaon", "relivo", "sereno", "lanero", "melino", "tarimo", "velaro",
    "korivo", "soleno", "harino", "renivo", "talero", "novilo", "lumero",
    "kinero", "lenaro", "miralo", "rovilo", "lunero", "senaro",
)

# Semantic hints for symbolic tags (not spelled in name)
_SYMBOLIC_HINTS: dict[str, tuple[str, ...]] = {
    "together": ("lanero", "soleno", "kinero", "belaro"),
    "memory": ("nelumo", "relivo", "miralo"),
    "story": ("tarimo", "serila", "rilano"),
    "home": ("harino", "harelo", "lenaro"),
    "bond": ("belaro", "belaon", "belin"),
    "keep": ("renivo", "renalo"),
    "time": ("toleno", "melino"),
    "echo": ("sereno", "serila"),
    "kin": ("kinero", "kalin"),
    "weave": ("rivaro", "rilano"),
    "gather": ("salero", "sorano"),
}

# Compact fusion pairs: (word_a, word_b) -> curated blends only
_COMPACT_BLENDS: dict[tuple[str, str], tuple[str, ...]] = {
    ("home", "bond"): ("haron", "belaro", "homel"),
    ("story", "kin"): ("storin", "kinaro", "skilar"),
    ("time", "echo"): ("telero", "serimo", "temaro"),
    ("keep", "nest"): ("kenaro", "nestel", "kerilo"),
    ("bond", "kin"): ("belkin", "bonkar", "bekino"),
    ("weave", "loom"): ("wevaro", "lovaro", "welomo"),
    ("gather", "share"): ("sorilo", "sharol", "gathro"),
    ("memory", "story"): ("melora", "storim", "merilo"),
}

# Legacy short forms — kept minimal
EVOCATIVE_FORMS: dict[str, tuple[str, ...]] = {
    "bond": ("belaro", "bonaro"),
    "kin": ("kinero", "kalin"),
    "nest": ("nestel", "nerilo"),
    "warm": ("harimo", "harino"),
    "share": ("sharol", "sorilo"),
    "love": ("lovino", "velaro"),
    "care": ("carino", "kerilo"),
}

SEMANTIC_ROOTS: tuple[str, ...] = (
    "home", "bond", "kin", "nest", "story", "tale", "echo", "keep",
    "gather", "weave", "luma", "nova", "sol", "warm", "moment", "legacy",
)

CURATED_BRAND_NAMES: tuple[str, ...] = tuple(
    dict.fromkeys(
        STANDALONE_WORDS
        + NAMELIKE_WORDS
        + SYMBOLIC_WORDS
        + BILINGUAL_WORDS
        + tuple(blend for blends in _COMPACT_BLENDS.values() for blend in blends)
    )
)


@dataclass(frozen=True, slots=True)
class BrandCandidate:
    name: str
    template: str
    meaning_tags: tuple[str, ...]
    segments: tuple[str, ...] = ()


def _cap(name: str) -> str:
    return name[0].upper() + name[1:].lower()


def _add_candidate(
    seen: set[str],
    results: list[BrandCandidate],
    name: str,
    template: str,
    tags: tuple[str, ...],
    segments: tuple[str, ...] = (),
) -> None:
    key = name.lower()
    if key in seen:
        return
    if not is_quality_candidate(name, segments=segments if segments else None):
        return
    seen.add(key)
    results.append(BrandCandidate(_cap(name), template, tags, segments))


def _top_roots(description: str, limit: int = 12) -> list[tuple[str, float]]:
    weights = extract_root_weights(description)
    ranked = sorted(weights.items(), key=lambda item: item[1], reverse=True)
    if ranked:
        return ranked[:limit]
    return [(r, 1.0) for r in SEMANTIC_ROOTS[:limit]]


def _standalone_templates(seen: set[str], out: list[BrandCandidate]) -> None:
    for name in STANDALONE_WORDS:
        _add_candidate(seen, out, name, TEMPLATE_STANDALONE, ("standalone",))


def _namelike_templates(seen: set[str], out: list[BrandCandidate]) -> None:
    for name in NAMELIKE_WORDS:
        _add_candidate(seen, out, name, TEMPLATE_NAMELIKE, ("namelike",))


def _symbolic_templates(
    roots: list[tuple[str, float]],
    seen: set[str],
    out: list[BrandCandidate],
) -> None:
    active = {r for r, _ in roots}
    for hint, forms in _SYMBOLIC_HINTS.items():
        if hint in active or any(hint[:4] in r or hint[:3] in r for r in active):
            for form in forms:
                _add_candidate(seen, out, form, TEMPLATE_SYMBOLIC, (hint,))
    for name in SYMBOLIC_WORDS:
        _add_candidate(seen, out, name, TEMPLATE_SYMBOLIC, ("symbolic",))


def _bilingual_templates(seen: set[str], out: list[BrandCandidate]) -> None:
    for name in BILINGUAL_WORDS:
        _add_candidate(seen, out, name, TEMPLATE_BILINGUAL, ("bilingual",))


def _compact_fusion_templates(
    roots: list[tuple[str, float]],
    seen: set[str],
    out: list[BrandCandidate],
) -> None:
    root_set = {r for r, _ in roots}
    for (a, b), blends in _COMPACT_BLENDS.items():
        if a not in root_set and b not in root_set:
            continue
        for name in blends:
            if 5 <= len(name) <= 7:
                _add_candidate(seen, out, name, TEMPLATE_COMPACT_FUSION, (a, b))


def _subtle_blend(a: str, b: str) -> list[str]:
    """Take 2–3 chars from each word; reject if seam visible."""
    results: list[str] = []
    for i in (2, 3):
        for j in (1, 2):
            if i >= len(a) or j >= len(b):
                continue
            candidate = a[:i] + b[j : j + 3]
            if 5 <= len(candidate) <= 7:
                if junction_score(a[:i], b[j : j + 3]) >= 0.8:
                    results.append(candidate)
    return results


def _dynamic_compact_fusion(
    roots: list[tuple[str, float]],
    seen: set[str],
    out: list[BrandCandidate],
) -> None:
    names = [r for r, _ in roots[:8] if r not in GLUE_RISK_ROOTS and len(r) >= 4]
    for a, b in combinations(names, 2):
        for blend in _subtle_blend(a, b):
            _add_candidate(seen, out, blend, TEMPLATE_COMPACT_FUSION, (a, b))
        for blend in _subtle_blend(b, a):
            _add_candidate(seen, out, blend, TEMPLATE_COMPACT_FUSION, (b, a))


def _evocative_templates(
    roots: list[tuple[str, float]],
    seen: set[str],
    out: list[BrandCandidate],
) -> None:
    active = {r for r, _ in roots}
    for word, forms in EVOCATIVE_FORMS.items():
        if word in active:
            for form in forms:
                _add_candidate(seen, out, form, TEMPLATE_EVOCATIVE, (word,))


def _minimal_root_variant(
    roots: list[tuple[str, float]],
    seen: set[str],
    out: list[BrandCandidate],
) -> None:
    """Only whole roots 5–7 chars — no suffix gluing."""
    for root, _ in roots[:6]:
        if root in GLUE_RISK_ROOTS:
            continue
        if 5 <= len(root) <= 7:
            _add_candidate(seen, out, root, TEMPLATE_ROOT_VARIANT, (root,))


def _generated_standalone(seen: set[str], out: list[BrandCandidate]) -> None:
    """Programmatic names with premium tail rhythms (aon/faro/saro/ilo), not -luno/-lori."""
    first_parts = (
        "bel", "rel", "ser", "lan", "vel", "mel", "kor", "nel", "tar", "har",
        "sol", "rov", "mar", "nor", "del", "fen", "ken", "sen", "ten", "ven",
        "bor", "dor", "for", "gor", "cal", "dal", "fal", "gal", "hal", "kal",
        "mal", "pal", "ral", "sal", "val", "wel", "nol", "pol", "tol", "vol",
        "col", "fol", "hol", "mol", "sul", "tul", "vul", "ril", "sil", "til",
    )
    premium_tails = (
        "aon", "faro", "saro", "daro", "naro", "laro", "maro", "veno", "leno",
        "weno", "bero", "dero", "fero", "gero", "hero", "jero", "mero", "pero",
        "tero", "vero", "wero", "yero", "belo", "delo", "felo", "gelo", "helo",
        "kelo", "melo", "nelo", "pelo", "selo", "telo", "velo", "relo", "sero",
        "lero", "nero", "ido", "ado", "alo", "ilo", "olo", "ulo", "elo",
    )
    for head in first_parts:
        for tail in premium_tails:
            if head[-1] == tail[0] or head[-2:] == tail[:2]:
                continue
            name = head + tail
            if 6 <= len(name) <= 8:
                _add_candidate(seen, out, name, TEMPLATE_STANDALONE, ("standalone",))

    quality_cvcvc = (
        "belmar", "selnor", "tarmel", "harlen", "melnor", "kerlan", "serlan",
        "delmar", "belnor", "selmar", "tarmon", "harmel", "solmar", "rovlen",
        "nelmar", "korlen", "tarlen", "velmar", "melran", "fenlan", "senlan",
        "venlor", "borlan", "dorlen", "forlan", "gorlen", "horlan", "morlen",
    )
    for name in quality_cvcvc:
        _add_candidate(seen, out, name, TEMPLATE_STANDALONE, ("standalone",))


def generate_template_candidates(description: str) -> list[BrandCandidate]:
    """Generate quality-first candidates from multiple premium templates."""
    seen: set[str] = set()
    results: list[BrandCandidate] = []
    roots = _top_roots(description)

    _standalone_templates(seen, results)
    _generated_standalone(seen, results)
    _namelike_templates(seen, results)
    _symbolic_templates(roots, seen, results)
    _bilingual_templates(seen, results)
    _compact_fusion_templates(roots, seen, results)
    _dynamic_compact_fusion(roots, seen, results)
    _evocative_templates(roots, seen, results)
    _minimal_root_variant(roots, seen, results)

    weights = extract_root_weights(description)

    def relevance(c: BrandCandidate) -> float:
        score = 0.0
        priority = {
            TEMPLATE_STANDALONE: 5.0,
            TEMPLATE_NAMELIKE: 4.0,
            TEMPLATE_SYMBOLIC: 4.0,
            TEMPLATE_BILINGUAL: 4.0,
            TEMPLATE_COMPACT_FUSION: 3.0,
            TEMPLATE_EVOCATIVE: 2.0,
        }
        score += priority.get(c.template, 0.0)
        for tag in c.meaning_tags:
            if tag in weights:
                score += weights[tag]
        return score

    results.sort(key=relevance, reverse=True)
    return results
