"""Request and maintenance-operation correlation helpers.

The operation ID is intentionally transport-agnostic: HTTP middleware binds it
for API requests and maintenance commands bind it explicitly.  It is carried
into the central event logger and emitted with application logs without adding
any database columns.
"""
from __future__ import annotations

import logging
import time
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Iterator

logger = logging.getLogger(__name__)

_operation_id: ContextVar[str | None] = ContextVar("woorialbum_operation_id", default=None)
_operation_name: ContextVar[str | None] = ContextVar("woorialbum_operation_name", default=None)
_operation_stage: ContextVar[str | None] = ContextVar("woorialbum_operation_stage", default=None)


def new_operation_id() -> str:
    return str(uuid.uuid4())


def get_operation_id() -> str | None:
    return _operation_id.get()


def get_operation_name() -> str | None:
    return _operation_name.get()


def get_operation_stage() -> str | None:
    """Return the current safe processing stage for request diagnostics."""
    return _operation_stage.get()


def set_operation_stage(stage: str | None) -> None:
    """Attach a coarse, non-sensitive stage name to the active operation."""
    _operation_stage.set(stage)


@contextmanager
def operation_context(name: str, *, operation_id: str | None = None, **details: Any) -> Iterator[str]:
    """Bind a stable ID to one HTTP request or one maintenance execution."""
    current_id = operation_id or new_operation_id()
    id_token = _operation_id.set(current_id)
    name_token = _operation_name.set(name)
    stage_token = _operation_stage.set(None)
    started = time.perf_counter()
    logger.info("operation_started operation_id=%s operation=%s details=%s", current_id, name, details or None)
    try:
        yield current_id
    except Exception:
        duration_ms = round((time.perf_counter() - started) * 1000)
        logger.exception("operation_failed operation_id=%s operation=%s duration_ms=%s", current_id, name, duration_ms)
        raise
    else:
        duration_ms = round((time.perf_counter() - started) * 1000)
        logger.info("operation_completed operation_id=%s operation=%s duration_ms=%s", current_id, name, duration_ms)
    finally:
        _operation_stage.reset(stage_token)
        _operation_name.reset(name_token)
        _operation_id.reset(id_token)
