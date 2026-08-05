"""Shared pytest fixtures."""
from __future__ import annotations

import pytest

from app.services.storage_service import clear_signed_url_cache


@pytest.fixture(autouse=True)
def _reset_signed_url_cache():
    """The signed-URL cache is process-wide; leaking entries between tests would make
    unrelated tests see cached URLs instead of their own mocked signing calls."""
    clear_signed_url_cache()
    yield
    clear_signed_url_cache()
