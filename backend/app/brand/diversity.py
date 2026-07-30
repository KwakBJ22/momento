"""Diversity-aware selection and rhythm similarity."""

from __future__ import annotations

from dataclasses import dataclass, field

from app.brand.brand_quality import detect_aro_rhythm_family, detect_ending_family, has_formulaic_shape
from app.brand.dedup import is_too_similar, jaro_winkler
from app.brand.naturalness import has_mechanical_ending, vowel_skeleton
from app.brand.phonetics import to_cv_pattern
from app.brand.templates import CURATED_BRAND_NAMES, STANDALONE_WORDS

# Root families — treat as one group for diversity limits
ROOT_FAMILIES: dict[str, frozenset[str]] = {
    "mem_family": frozenset({"mem", "memo", "mim", "mi", "mimo", "memi", "mimi", "memor", "memora"}),
    "frame_family": frozenset({"frame", "fram", "fra"}),
    "photo_family": frozenset({"photo", "foto", "phota", "snap", "pix"}),
    "home_family": frozenset({"home", "hom", "homa", "homu", "homio", "homly", "hearth"}),
    "bond_family": frozenset({"bond", "bonda", "bondu", "bondi", "bonva"}),
    "story_family": frozenset({"story", "stori", "stor", "storio", "tale"}),
}

MAX_PER_ROOT = 2
MAX_PER_PREFIX = 2
MAX_PER_SUFFIX = 4
MAX_PER_FIRST_SYLLABLE = 2
MAX_PER_LAST_SYLLABLE = 4
MAX_PER_CV_PATTERN = 2
MAX_PER_TEMPLATE = 2
MAX_PER_VOWEL_SKELETON = 2
MAX_PER_ARO_RHYTHM = 2
MAX_MEM_FAMILY = 2
RHYTHM_SIMILARITY_THRESHOLD = 0.76

PREMIUM_TEMPLATE_ORDER = (
    "standalone",
    "namelike",
    "symbolic",
    "bilingual",
    "compact_fusion",
    "evocative",
    "neologism",
    "root_variant",
    "root_fusion",
)

_CURATED_SET = frozenset(name.lower() for name in CURATED_BRAND_NAMES)
_PREMIUM_ORDER = {name: index for index, name in enumerate(STANDALONE_WORDS)}


@dataclass
class DiversityTracker:
    root_counts: dict[str, int] = field(default_factory=dict)
    prefix_counts: dict[str, int] = field(default_factory=dict)
    suffix_counts: dict[str, int] = field(default_factory=dict)
    first_syl_counts: dict[str, int] = field(default_factory=dict)
    last_syl_counts: dict[str, int] = field(default_factory=dict)
    cv_pattern_counts: dict[str, int] = field(default_factory=dict)
    family_counts: dict[str, int] = field(default_factory=dict)
    template_counts: dict[str, int] = field(default_factory=dict)
    ending_family_counts: dict[str, int] = field(default_factory=dict)
    aro_rhythm_counts: dict[str, int] = field(default_factory=dict)
    vowel_skeleton_counts: dict[str, int] = field(default_factory=dict)
    selected: list[str] = field(default_factory=list)


def _first_syllable(name: str) -> str:
    lower = name.lower()
    for i, ch in enumerate(lower):
        if i > 0 and ch in "aeiou" and lower[i - 1] not in "aeiou":
            return lower[: i + 1]
    return lower[:2]


def _last_syllable(name: str) -> str:
    lower = name.lower()
    for i in range(len(lower) - 1, 0, -1):
        if lower[i] in "aeiou":
            start = i
            while start > 0 and lower[start - 1] not in "aeiou":
                start -= 1
            return lower[start:]
    return lower[-2:]


def detect_root_key(name: str, tags: tuple[str, ...]) -> str:
    lower = name.lower()
    generic_tags = frozenset({
        "standalone", "namelike", "symbolic", "bilingual", "neologism",
    })
    for tag in tags:
        if len(tag) >= 3 and tag in lower:
            return tag
    if tags and tags[0] not in generic_tags:
        return tags[0]
    return lower[:3]


def detect_prefix_key(name: str, tags: tuple[str, ...], template: str) -> str:
    if template == "triple_combo" and tags:
        return tags[0]
    return _first_syllable(name)


def detect_suffix_key(name: str, tags: tuple[str, ...], template: str) -> str:
    if template == "triple_combo" and len(tags) >= 3:
        return tags[-1]
    return _last_syllable(name)


def detect_family(name: str) -> str | None:
    lower = name.lower()
    for family, stems in ROOT_FAMILIES.items():
        for stem in stems:
            if stem in lower:
                return family
    return None


def rhythm_signature(name: str) -> tuple[str, str, str, int, str]:
    """Signature for rhythm comparison: first syl, last syl, vowels, syllables, CV."""
    lower = name.lower()
    vowels = vowel_skeleton(lower)
    cv = to_cv_pattern(lower)
    syllables = max(1, len(vowels))
    return (_first_syllable(lower), _last_syllable(lower), vowels, syllables, cv)


def rhythm_similarity(a: str, b: str) -> float:
    """Combined rhythm + spelling similarity (0–1)."""
    sig_a = rhythm_signature(a)
    sig_b = rhythm_signature(b)

    matches = 0
    total = 5
    if sig_a[0] == sig_b[0]:
        matches += 1
    if sig_a[1] == sig_b[1]:
        matches += 1
    if sig_a[2] == sig_b[2]:
        matches += 1.5
    elif sig_a[2][:2] == sig_b[2][:2]:
        matches += 0.75
    if sig_a[3] == sig_b[3]:
        matches += 0.5
    if sig_a[4] == sig_b[4]:
        matches += 1

    rhythm_score = matches / total
    spelling_score = jaro_winkler(a, b)
    return rhythm_score * 0.55 + spelling_score * 0.45


def is_rhythm_too_similar(a: str, b: str, threshold: float = RHYTHM_SIMILARITY_THRESHOLD) -> bool:
    sim = rhythm_similarity(a, b)
    if sim < threshold:
        return False
    # Same ending rhythm is acceptable when the lead syllable differs
    if a[:2].lower() != b[:2].lower():
        return sim >= 0.9
    return True


def would_violate_diversity(
    name: str,
    *,
    template: str,
    tags: tuple[str, ...],
    tracker: DiversityTracker,
) -> bool:
    root_key = detect_root_key(name, tags)
    prefix_key = detect_prefix_key(name, tags, template)
    suffix_key = detect_suffix_key(name, tags, template)
    first_syl = _first_syllable(name)
    last_syl = _last_syllable(name)
    cv = to_cv_pattern(name)
    family = detect_family(name)
    ending_family = detect_ending_family(name)
    aro_rhythm = detect_aro_rhythm_family(name)
    vowel_sk = vowel_skeleton(name)

    if tracker.root_counts.get(root_key, 0) >= MAX_PER_ROOT:
        return True
    if tracker.prefix_counts.get(prefix_key, 0) >= MAX_PER_PREFIX:
        return True
    if tracker.suffix_counts.get(suffix_key, 0) >= MAX_PER_SUFFIX:
        return True
    if tracker.first_syl_counts.get(first_syl, 0) >= MAX_PER_FIRST_SYLLABLE:
        return True
    if tracker.last_syl_counts.get(last_syl, 0) >= MAX_PER_LAST_SYLLABLE:
        return True
    if tracker.cv_pattern_counts.get(cv, 0) >= MAX_PER_CV_PATTERN:
        return True
    if tracker.template_counts.get(template, 0) >= MAX_PER_TEMPLATE:
        return True
    if vowel_sk and tracker.vowel_skeleton_counts.get(vowel_sk, 0) >= MAX_PER_VOWEL_SKELETON:
        return True
    if ending_family and tracker.ending_family_counts.get(ending_family, 0) >= 1:
        return True
    if aro_rhythm and tracker.aro_rhythm_counts.get(aro_rhythm, 0) >= MAX_PER_ARO_RHYTHM:
        return True
    family_limit = MAX_MEM_FAMILY if family == "mem_family" else 2
    if family and tracker.family_counts.get(family, 0) >= family_limit:
        return True

    for existing in tracker.selected:
        if is_rhythm_too_similar(name, existing):
            return True
        if is_too_similar(name, existing):
            return True
        if detect_root_key(name, tags) == detect_root_key(existing, tags) and jaro_winkler(name, existing) >= 0.8:
            return True

    return False


def record_selection(
    name: str,
    *,
    template: str,
    tags: tuple[str, ...],
    tracker: DiversityTracker,
) -> None:
    root_key = detect_root_key(name, tags)
    prefix_key = detect_prefix_key(name, tags, template)
    suffix_key = detect_suffix_key(name, tags, template)
    first_syl = _first_syllable(name)
    last_syl = _last_syllable(name)
    cv = to_cv_pattern(name)
    family = detect_family(name)
    ending_family = detect_ending_family(name)
    aro_rhythm = detect_aro_rhythm_family(name)
    vowel_sk = vowel_skeleton(name)

    tracker.root_counts[root_key] = tracker.root_counts.get(root_key, 0) + 1
    tracker.prefix_counts[prefix_key] = tracker.prefix_counts.get(prefix_key, 0) + 1
    tracker.suffix_counts[suffix_key] = tracker.suffix_counts.get(suffix_key, 0) + 1
    tracker.first_syl_counts[first_syl] = tracker.first_syl_counts.get(first_syl, 0) + 1
    tracker.last_syl_counts[last_syl] = tracker.last_syl_counts.get(last_syl, 0) + 1
    tracker.cv_pattern_counts[cv] = tracker.cv_pattern_counts.get(cv, 0) + 1
    tracker.template_counts[template] = tracker.template_counts.get(template, 0) + 1
    if vowel_sk:
        tracker.vowel_skeleton_counts[vowel_sk] = tracker.vowel_skeleton_counts.get(vowel_sk, 0) + 1
    if ending_family:
        tracker.ending_family_counts[ending_family] = tracker.ending_family_counts.get(ending_family, 0) + 1
    if aro_rhythm:
        tracker.aro_rhythm_counts[aro_rhythm] = tracker.aro_rhythm_counts.get(aro_rhythm, 0) + 1
    if family:
        tracker.family_counts[family] = tracker.family_counts.get(family, 0) + 1
    tracker.selected.append(name)


def select_for_rdap(
    ranked: list[tuple[str, str, tuple[str, ...], float]],
    *,
    max_count: int = 300,
) -> list[tuple[str, str, tuple[str, ...]]]:
    """Build a broad pre-RDAP pool with balanced template representation."""
    from collections import defaultdict

    def _try_add(
        name: str,
        template: str,
        tags: tuple[str, ...],
        *,
        selected: list[tuple[str, str, tuple[str, ...]]],
        seen: set[str],
        family_counts: dict[str, int],
        template_counts: dict[str, int],
    ) -> bool:
        if has_mechanical_ending(name) or has_formulaic_shape(name):
            return False
        key = name.lower()
        if key in seen:
            return False
        if any(jaro_winkler(name, existing) >= 0.96 for existing in seen):
            return False
        family = detect_family(name)
        if family:
            limit = MAX_MEM_FAMILY if family == "mem_family" else 4
            if family_counts.get(family, 0) >= limit:
                return False
            family_counts[family] = family_counts.get(family, 0) + 1
        seen.add(key)
        selected.append((name, template, tags))
        template_counts[template] = template_counts.get(template, 0) + 1
        return True

    buckets: dict[str, list[tuple[str, str, tuple[str, ...], float]]] = defaultdict(list)
    for item in ranked:
        if item[1] == "triple_combo":
            continue
        buckets[item[1]].append(item)

    for template, items in buckets.items():
        items.sort(
            key=lambda row: (
                row[0].lower() not in _CURATED_SET,
                -row[3],
            ),
        )

    template_order = PREMIUM_TEMPLATE_ORDER
    per_template_cap = {
        "standalone": min(80, max_count // 4),
        "namelike": min(60, max_count // 5),
        "symbolic": min(60, max_count // 5),
        "bilingual": min(60, max_count // 5),
        "compact_fusion": min(80, max_count // 4),
        "evocative": min(40, max_count // 6),
        "neologism": min(80, max_count // 4),
        "root_variant": min(40, max_count // 6),
        "root_fusion": min(30, max_count // 8),
    }

    selected: list[tuple[str, str, tuple[str, ...]]] = []
    seen: set[str] = set()
    family_counts: dict[str, int] = {}
    template_counts: dict[str, int] = defaultdict(int)

    curated_ranked = sorted(
        (item for item in ranked if item[0].lower() in _CURATED_SET and item[1] != "triple_combo"),
        key=lambda row: (
            _PREMIUM_ORDER.get(row[0].lower(), 1000),
            -row[3],
            _TEMPLATE_SORT_KEY.get(row[1], 9),
        ),
    )
    for name, template, tags, _score in curated_ranked:
        if len(selected) >= max_count:
            break
        _try_add(
            name, template, tags,
            selected=selected, seen=seen, family_counts=family_counts, template_counts=template_counts,
        )

    pointers = {template: 0 for template in template_order}
    while len(selected) < max_count:
        added = False
        for template in template_order:
            if template_counts[template] >= per_template_cap.get(template, max_count):
                continue
            bucket = buckets.get(template, [])
            pointer = pointers[template]
            while pointer < len(bucket):
                name, tmpl, tags, _score = bucket[pointer]
                pointers[template] = pointer + 1
                pointer += 1
                if _try_add(
                    name, tmpl, tags,
                    selected=selected, seen=seen, family_counts=family_counts, template_counts=template_counts,
                ):
                    added = True
                    break
        if not added:
            break

    return selected


_TEMPLATE_SORT_KEY = {
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


def select_diverse(
    ranked: list[tuple[str, str, tuple[str, ...], float]],
    *,
    max_count: int = 20,
) -> list[tuple[str, str, tuple[str, ...]]]:
    """
    Diversity-aware selection from (name, template, tags, score) tuples.
    Returns selected (name, template, tags).
    """
    tracker = DiversityTracker()
    selected: list[tuple[str, str, tuple[str, ...]]] = []

    for name, template, tags, _score in ranked:
        if would_violate_diversity(name, template=template, tags=tags, tracker=tracker):
            continue
        record_selection(name, template=template, tags=tags, tracker=tracker)
        selected.append((name, template, tags))
        if len(selected) >= max_count:
            break

    return selected


def select_final_results(
    ranked: list[tuple[str, str, tuple[str, ...], float]],
    *,
    max_count: int = 20,
) -> list[tuple[str, str, tuple[str, ...]]]:
    """Final diversity pass for RDAP-confirmed available names."""
    tracker = DiversityTracker()
    selected: list[tuple[str, str, tuple[str, ...]]] = []

    for name, template, tags, _score in ranked:
        last_two = name[-2:].lower() if len(name) >= 2 else name.lower()
        if tracker.last_syl_counts.get(last_two, 0) >= 2:
            continue
        if family := detect_family(name):
            limit = MAX_MEM_FAMILY if family == "mem_family" else 2
            if tracker.family_counts.get(family, 0) >= limit:
                continue
        if any(is_too_similar(name, existing) for existing in tracker.selected):
            continue
        if any(is_rhythm_too_similar(name, existing, threshold=0.88) for existing in tracker.selected):
            continue

        record_selection(name, template=template, tags=tags, tracker=tracker)
        selected.append((name, template, tags))
        if len(selected) >= max_count:
            break

    return selected


def _select_premium_greedy(
    ranked: list[tuple[str, str, tuple[str, ...], float]],
    *,
    max_count: int,
    cv_limit: int,
    template_limit: int,
) -> list[tuple[str, str, tuple[str, ...]]]:
    tracker = DiversityTracker()
    selected: list[tuple[str, str, tuple[str, ...]]] = []
    remaining = list(ranked)

    while len(selected) < max_count and remaining:
        best_index: int | None = None
        best_effective = -1.0

        for index, (name, template, tags, score) in enumerate(remaining):
            if not (5 <= len(name) <= 8):
                continue

            root_key = detect_root_key(name, tags)
            prefix_key = detect_prefix_key(name, tags, template)
            suffix_key = detect_suffix_key(name, tags, template)
            first_syl = _first_syllable(name)
            last_syl = _last_syllable(name)
            cv = to_cv_pattern(name)
            family = detect_family(name)
            ending_family = detect_ending_family(name)
            aro_rhythm = detect_aro_rhythm_family(name)
            vowel_sk = vowel_skeleton(name)

            if tracker.root_counts.get(root_key, 0) >= MAX_PER_ROOT:
                continue
            if tracker.prefix_counts.get(prefix_key, 0) >= MAX_PER_PREFIX:
                continue
            if tracker.suffix_counts.get(suffix_key, 0) >= MAX_PER_SUFFIX:
                continue
            if tracker.first_syl_counts.get(first_syl, 0) >= MAX_PER_FIRST_SYLLABLE:
                continue
            if tracker.last_syl_counts.get(last_syl, 0) >= MAX_PER_LAST_SYLLABLE:
                continue
            if tracker.cv_pattern_counts.get(cv, 0) >= cv_limit:
                continue
            if tracker.template_counts.get(template, 0) >= template_limit:
                continue
            if vowel_sk and tracker.vowel_skeleton_counts.get(vowel_sk, 0) >= MAX_PER_VOWEL_SKELETON:
                continue
            if ending_family and tracker.ending_family_counts.get(ending_family, 0) >= 1:
                continue
            if aro_rhythm and tracker.aro_rhythm_counts.get(aro_rhythm, 0) >= MAX_PER_ARO_RHYTHM:
                continue
            family_limit = MAX_MEM_FAMILY if family == "mem_family" else 2
            if family and tracker.family_counts.get(family, 0) >= family_limit:
                continue
            if any(is_rhythm_too_similar(name, existing) for existing in tracker.selected):
                continue
            if any(is_too_similar(name, existing) for existing in tracker.selected):
                continue

            bonus = 0.0
            if tracker.cv_pattern_counts.get(cv, 0) == 0:
                bonus += 6.0
            if ending_family and tracker.ending_family_counts.get(ending_family, 0) == 0:
                bonus += 4.0
            if aro_rhythm and tracker.aro_rhythm_counts.get(aro_rhythm, 0) == 0:
                bonus += 3.0
            if tracker.template_counts.get(template, 0) == 0:
                bonus += 3.0
            if vowel_sk and tracker.vowel_skeleton_counts.get(vowel_sk, 0) == 0:
                bonus += 2.0

            premium_rank = _PREMIUM_ORDER.get(name.lower(), 1000)
            if premium_rank < 18:
                bonus += 12.0 - premium_rank * 0.25

            effective = score + bonus
            if effective > best_effective:
                best_effective = effective
                best_index = index

        if best_index is None:
            break

        name, template, tags, _score = remaining.pop(best_index)
        record_selection(name, template=template, tags=tags, tracker=tracker)
        selected.append((name, template, tags))

    return selected


def select_premium_final(
    ranked: list[tuple[str, str, tuple[str, ...], float]],
    *,
    max_count: int = 20,
    min_count: int = 8,
) -> list[tuple[str, str, tuple[str, ...]]]:
    """Greedy diversity-maximizing final selection for Momento-grade brands."""
    if not ranked:
        return []

    unique_templates = {template for _, template, _, _ in ranked}
    template_limit = max_count if len(unique_templates) == 1 else MAX_PER_TEMPLATE

    cv_limits = (MAX_PER_CV_PATTERN, 4, 6, max_count)
    if len(ranked) < min_count * 2:
        cv_limits = (4, 6, max_count)

    for cv_limit in cv_limits:
        selected = _select_premium_greedy(
            ranked,
            max_count=max_count,
            cv_limit=cv_limit,
            template_limit=template_limit,
        )
        if len(selected) >= min_count:
            return selected[:max_count]

    return selected[:max_count]


def analyze_diversity(names: list[str]) -> dict[str, float]:
    """Compute diversity ratios for testing."""
    if not names:
        return {}

    n = len(names)
    families = [detect_family(name) or "none" for name in names]
    mem_count = sum(1 for f in families if f == "mem_family")
    first_two = [name[:2].lower() for name in names if len(name) >= 2]
    last_two = [name[-2:].lower() for name in names if len(name) >= 2]
    cv_patterns = [to_cv_pattern(name) for name in names]
    ending_families = [detect_ending_family(name) or "none" for name in names]
    templates_count = len({detect_ending_family(n) for n in names})

    def max_ratio(items: list[str]) -> float:
        if not items:
            return 0.0
        from collections import Counter
        counts = Counter(items)
        return max(counts.values()) / n

    return {
        "mem_family_ratio": mem_count / n,
        "first_two_ratio": max_ratio(first_two),
        "last_two_ratio": max_ratio(last_two),
        "cv_pattern_ratio": max_ratio(cv_patterns),
        "ending_family_duplicates": sum(1 for f in ending_families if f != "none") - len(set(ending_families)),
    }
