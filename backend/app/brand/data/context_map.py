"""Map service-description keywords to weighted roots (no AI)."""

from __future__ import annotations

import re

# keyword (lowercase) -> (root, weight) pairs
KEYWORD_ROOT_WEIGHTS: dict[str, tuple[tuple[str, float], ...]] = {
    # family / friends
    "가족": (
        ("fam", 3.0), ("kin", 2.8), ("bond", 2.5), ("home", 2.5), ("nest", 2.0),
        ("hearth", 2.0), ("clan", 1.8), ("love", 2.2), ("care", 2.0), ("cher", 1.8),
        ("together", 2.0), ("children", 1.8), ("mem", 1.5),
    ),
    "친구": (
        ("bond", 2.8), ("friend", 2.5), ("gather", 2.2), ("share", 2.0), ("kin", 2.0),
        ("together", 2.0), ("meet", 1.8), ("group", 1.8),
    ),
    "friend": (
        ("bond", 2.5), ("friend", 2.8), ("gather", 2.2), ("share", 2.0), ("kin", 2.0),
        ("together", 2.0),
    ),
    "family": (
        ("fam", 3.0), ("kin", 2.8), ("bond", 2.5), ("home", 2.5), ("nest", 2.0),
        ("hearth", 2.0), ("clan", 1.8), ("love", 2.2), ("care", 2.0),
        ("together", 2.0), ("children", 1.8), ("mem", 1.5),
    ),
    "아이": (("children", 2.5), ("kin", 2.0), ("nest", 1.8), ("care", 1.8)),
    "children": (("children", 2.5), ("kin", 2.0), ("nest", 1.8), ("care", 1.8)),
    "육아": (("care", 2.5), ("nest", 2.0), ("home", 2.0), ("cher", 1.8)),
    # album / photo
    "앨범": (
        ("mem", 2.8), ("stor", 2.5), ("album", 3.0), ("archive", 2.0), ("keep", 2.0),
        ("save", 1.8), ("frame", 2.2), ("photo", 2.5), ("pic", 2.0),
    ),
    "album": (
        ("mem", 2.8), ("stor", 2.5), ("album", 3.0), ("archive", 2.0), ("keep", 2.0),
        ("save", 1.8), ("frame", 2.2), ("photo", 2.5), ("pic", 2.0),
    ),
    "사진": (
        ("snap", 2.8), ("pix", 2.5), ("lens", 2.5), ("frame", 2.2), ("photo", 3.0),
        ("pic", 2.5), ("shot", 2.0), ("view", 1.8), ("sight", 1.8),
    ),
    "photo": (
        ("snap", 2.8), ("pix", 2.5), ("lens", 2.5), ("frame", 2.2), ("photo", 3.0),
        ("pic", 2.5), ("shot", 2.0), ("view", 1.8),
    ),
    "picture": (
        ("snap", 2.5), ("pix", 2.5), ("lens", 2.2), ("frame", 2.0), ("photo", 2.8), ("pic", 2.5),
    ),
    # travel
    "여행": (
        ("voy", 3.0), ("path", 2.5), ("roam", 2.5), ("trek", 2.2), ("jour", 2.8),
        ("trail", 2.0), ("route", 2.2), ("wander", 2.0), ("drift", 1.8), ("sail", 1.8),
        ("travel", 2.5), ("trip", 2.2), ("world", 2.0), ("road", 2.0), ("map", 1.8),
    ),
    "travel": (
        ("voy", 3.0), ("path", 2.5), ("roam", 2.5), ("trek", 2.2), ("jour", 2.8),
        ("trail", 2.0), ("route", 2.2), ("wander", 2.0), ("travel", 2.5), ("world", 2.0),
        ("road", 2.0), ("map", 1.8), ("photo", 1.5),
    ),
    "trip": (
        ("voy", 2.5), ("path", 2.2), ("roam", 2.0), ("trek", 2.0), ("jour", 2.5),
        ("trail", 1.8), ("route", 2.0), ("trip", 2.8),
    ),
    "journey": (
        ("voy", 2.5), ("path", 2.2), ("jour", 3.0), ("trail", 2.0), ("route", 2.0),
        ("wander", 2.0), ("drift", 1.8),
    ),
    "world": (("world", 2.8), ("voy", 2.0), ("globe", 2.0), ("path", 1.8)),
    "road": (("road", 2.8), ("path", 2.5), ("route", 2.5), ("trail", 2.0)),
    "map": (("map", 2.8), ("path", 2.0), ("route", 2.0), ("trail", 1.8)),
    # memory / record
    "기록": (
        ("log", 2.5), ("chron", 2.2), ("memo", 2.5), ("record", 2.8), ("archive", 2.2),
        ("keep", 2.0), ("stor", 2.5), ("mem", 2.5),
    ),
    "record": (
        ("log", 2.5), ("chron", 2.2), ("memo", 2.5), ("record", 2.8), ("archive", 2.2),
        ("keep", 2.0), ("stor", 2.5),
    ),
    "memory": (
        ("mem", 3.0), ("stor", 2.5), ("memo", 2.5), ("keep", 2.0), ("save", 2.0),
        ("archive", 2.0), ("moment", 2.2),
    ),
    "추억": (
        ("moment", 2.8), ("story", 2.5), ("cher", 2.2), ("dear", 2.0), ("mem", 1.2),
        ("stor", 2.0), ("tale", 2.0), ("echo", 1.8),
    ),
    "moment": (
        ("moment", 3.0), ("momento", 2.8), ("instant", 2.0), ("flash", 1.8), ("mem", 2.0),
    ),
    "momento": (
        ("moment", 2.8), ("momento", 3.0), ("instant", 2.0), ("mem", 2.0), ("stor", 2.0),
    ),
    # story
    "스토리": (
        ("story", 3.0), ("tale", 2.5), ("narr", 2.2), ("saga", 2.0), ("verse", 1.8), ("note", 1.8),
    ),
    "story": (
        ("story", 3.0), ("tale", 2.5), ("narr", 2.2), ("saga", 2.0), ("verse", 1.8), ("note", 1.8),
    ),
    "이야기": (
        ("story", 2.8), ("tale", 2.5), ("narr", 2.2), ("saga", 2.0), ("verse", 1.8),
        ("echo", 1.8),
    ),
    "살아있는": (
        ("live", 2.5), ("vivid", 2.2), ("pulse", 2.0), ("spark", 1.8), ("glow", 1.8),
    ),
    "living": (
        ("live", 2.5), ("vivid", 2.2), ("pulse", 2.0), ("spark", 1.8),
    ),
    # social
    "공유": (
        ("share", 2.8), ("link", 2.2), ("bond", 2.0), ("join", 1.8), ("unite", 1.8),
        ("gather", 1.8), ("meet", 1.8),
    ),
    "share": (
        ("share", 2.8), ("link", 2.2), ("bond", 2.0), ("join", 1.8), ("unite", 1.8),
        ("gather", 1.8),
    ),
    "모임": (
        ("meet", 2.5), ("gather", 2.5), ("group", 2.2), ("circle", 2.0), ("crew", 1.8),
        ("bond", 2.0),
    ),
    "meeting": (
        ("meet", 2.5), ("gather", 2.5), ("group", 2.2), ("circle", 2.0), ("bond", 2.0),
    ),
    "together": (("together", 2.8), ("bond", 2.2), ("unite", 2.0), ("join", 1.8)),
    "love": (("love", 3.0), ("cher", 2.2), ("dear", 2.0), ("care", 2.0)),
    "home": (("home", 3.0), ("nest", 2.5), ("hearth", 2.2), ("bond", 2.0)),
    # wellness / lifestyle
    "건강": (("vita", 2.5), ("life", 2.2), ("live", 2.0), ("pure", 1.8), ("fresh", 1.8)),
    "health": (("vita", 2.5), ("life", 2.2), ("live", 2.0), ("pure", 1.8), ("fresh", 1.8)),
    "food": (("taste", 2.5), ("sweet", 2.0), ("fresh", 2.0), ("bite", 1.8)),
    "음식": (("taste", 2.5), ("sweet", 2.0), ("fresh", 2.0), ("bite", 1.8)),
    # tech
    "앱": (("app", 2.5), ("sync", 2.0), ("link", 1.8), ("net", 1.8), ("data", 1.8)),
    "app": (("app", 2.5), ("sync", 2.0), ("link", 1.8), ("net", 1.8), ("data", 1.8)),
    "서비스": (("serve", 2.0), ("link", 1.8), ("sync", 1.8), ("flow", 1.8), ("hub", 2.0)),
    "service": (("serve", 2.0), ("link", 1.8), ("sync", 1.8), ("flow", 1.8), ("hub", 2.0)),
    "platform": (("base", 2.0), ("core", 2.2), ("hub", 2.5), ("link", 1.8), ("net", 1.8)),
    # nature
    "자연": (
        ("tree", 2.0), ("leaf", 2.0), ("garden", 2.0), ("meadow", 1.8), ("sky", 2.0), ("cloud", 1.8),
    ),
    "nature": (
        ("tree", 2.0), ("leaf", 2.0), ("garden", 2.0), ("meadow", 1.8), ("sky", 2.0), ("cloud", 1.8),
    ),
    "calm": (("calm", 2.5), ("peace", 2.5), ("quiet", 2.0), ("serene", 1.8), ("ease", 1.8)),
    "peace": (("calm", 2.5), ("peace", 2.5), ("quiet", 2.0), ("serene", 1.8)),
}

_TOKEN_RE = re.compile(r"[a-zA-Z가-힣]+")


def extract_root_weights(description: str) -> dict[str, float]:
    """Accumulate root weights from description keywords."""
    if not description.strip():
        return {}

    text = description.lower()
    weights: dict[str, float] = {}

    def add_weight(root: str, amount: float) -> None:
        weights[root] = weights.get(root, 0.0) + amount

    for keyword, pairs in KEYWORD_ROOT_WEIGHTS.items():
        if keyword in text:
            for root, weight in pairs:
                add_weight(root, weight)

    for token in _TOKEN_RE.findall(text):
        token_lower = token.lower()
        if token_lower in KEYWORD_ROOT_WEIGHTS:
            for root, weight in KEYWORD_ROOT_WEIGHTS[token_lower]:
                add_weight(root, weight)

    return weights


def extract_preferred_roots(description: str) -> frozenset[str]:
    """Backward-compatible helper returning roots with any positive weight."""
    return frozenset(extract_root_weights(description))


def brand_context_weight(brand: str, root_weights: dict[str, float]) -> float:
    """Sum weights of roots found inside a brand name."""
    if not root_weights:
        return 0.0
    lower = brand.lower()
    total = 0.0
    for root, weight in root_weights.items():
        if root in lower:
            total += weight
    return total
