from dataclasses import dataclass


@dataclass(frozen=True)
class CurrentUser:
    """Provider-neutral identity passed from auth adapters into API handlers."""

    id: str
    provider: str | None = None
    email: str | None = None
    phone: str | None = None
