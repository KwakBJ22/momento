"""Transient Storage connection failures are retried (2x, 0.5s/1.5s) at the
StorageService funnel. RemoteProtocolError was observed three times in production
(8/2, 8/4, 8/5), always as processing_images started — an idle HTTP/2 connection
dropped by the server kills every multiplexed in-flight request at once."""
from __future__ import annotations

import unittest
from typing import Any
from unittest.mock import patch

import httpx

from app.services import storage_service
from app.services.storage_service import StorageService, clear_signed_url_cache


class DuplicateError(Exception):
    """Shape of storage3's StorageApiError for a 409."""

    def __init__(self) -> None:
        super().__init__("Duplicate")
        self.status = 409
        self.code = "Duplicate"


class FlakyProvider:
    """Raises scripted exceptions for the first N calls, then succeeds."""

    def __init__(self, failures: list[Exception]) -> None:
        self.failures = list(failures)
        self.calls = 0

    def _maybe_fail(self) -> None:
        self.calls += 1
        if self.failures:
            raise self.failures.pop(0)

    def upload(self, bucket: str, path: str, content: bytes, *, content_type: str, upsert: bool = False, cache_control: str = "") -> None:
        self._maybe_fail()

    def download(self, bucket: str, path: str) -> bytes:
        self._maybe_fail()
        return b"bytes"

    def delete(self, bucket: str, paths: list[str]) -> None:
        pass

    def signed_url(self, bucket: str, path: str, expires_in: int) -> str:
        return "https://cdn/x"

    def signed_urls(self, bucket: str, paths: list[str], expires_in: int) -> list[dict[str, Any]]:
        return []


def _service(provider: FlakyProvider) -> StorageService:
    return StorageService(provider, 3600)  # type: ignore[arg-type]


class StorageRetryTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_signed_url_cache()
        # No real sleeping in tests.
        patcher = patch.object(storage_service.time, "sleep")
        self.sleep = patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(clear_signed_url_cache)

    def test_download_retries_then_succeeds(self) -> None:
        provider = FlakyProvider([httpx.RemoteProtocolError("h2 conn dropped")])
        self.assertEqual(_service(provider).download("albums", "a/1.jpg"), b"bytes")
        self.assertEqual(provider.calls, 2)
        self.assertEqual(self.sleep.call_count, 1)

    def test_upload_retries_then_succeeds(self) -> None:
        provider = FlakyProvider([httpx.ConnectError("refused")])
        _service(provider).upload("albums", "a/1.jpg", b"x", content_type="image/jpeg")
        self.assertEqual(provider.calls, 2)

    def test_exhausted_retries_raise_the_last_error(self) -> None:
        provider = FlakyProvider([
            httpx.RemoteProtocolError("1"), httpx.ReadError("2"), httpx.RemoteProtocolError("3"),
        ])
        with self.assertRaises(httpx.RemoteProtocolError):
            _service(provider).download("albums", "a/1.jpg")
        # 1 initial + 2 retries, backoff slept twice (0.5s then 1.5s).
        self.assertEqual(provider.calls, 3)
        self.assertEqual([call.args[0] for call in self.sleep.call_args_list], [0.5, 1.5])

    def test_non_target_exceptions_propagate_immediately(self) -> None:
        provider = FlakyProvider([ValueError("broken")])
        with self.assertRaises(ValueError):
            _service(provider).download("albums", "a/1.jpg")
        self.assertEqual(provider.calls, 1)
        self.assertEqual(self.sleep.call_count, 0)

    def test_duplicate_on_retry_counts_as_success(self) -> None:
        # The first upload DID create the object; only the response died with the
        # connection. The retry's 409 therefore means success — and must be logged
        # under its own event name (the only signal separating the two failure modes).
        provider = FlakyProvider([httpx.RemoteProtocolError("resp lost"), DuplicateError()])
        with self.assertLogs("app.services.storage_service", level="WARNING") as logs:
            _service(provider).upload("albums", "a/original.jpg", b"x", content_type="image/jpeg")
        self.assertEqual(provider.calls, 2)
        self.assertTrue(any("event=storage_retry " in line for line in logs.output))
        self.assertTrue(any("event=storage_retry_duplicate" in line for line in logs.output))

    def test_first_attempt_duplicate_still_raises(self) -> None:
        # No connection error happened: a straight 409 keeps the original-upload
        # no-overwrite contract.
        provider = FlakyProvider([DuplicateError()])
        with self.assertRaises(DuplicateError):
            _service(provider).upload("albums", "a/original.jpg", b"x", content_type="image/jpeg")
        self.assertEqual(provider.calls, 1)

    def test_duplicate_on_download_retry_is_not_swallowed(self) -> None:
        # duplicate_means_success is an upload-only rule.
        provider = FlakyProvider([httpx.RemoteProtocolError("x"), DuplicateError()])
        with self.assertRaises(DuplicateError):
            _service(provider).download("albums", "a/1.jpg")


if __name__ == "__main__":
    unittest.main()
