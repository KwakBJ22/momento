"""Config contract: signed URLs must live long enough to view a fresh album AND stay
stable long enough for browser caching to work across revisits.

History: 300s (5min) let trailing photos of a just-created album expire to 403.
3600 (1h) fixed that, but the URL-reuse cache (50% rule) then rotated URLs every
30min, so browser cache-control (30 days) only helped within a session. 86400 (24h)
pins the URL for 12h — revisits hit the browser/CDN cache. Deleting a photo also
deletes the Storage object, so a live signed URL cannot show deleted content.
"""
from unittest import TestCase

from app.config import Settings


class SignedUrlTtlDefaultTest(TestCase):
    def test_default_signed_url_ttl_is_24_hours(self) -> None:
        # Assert the field DEFAULT (independent of any .env override).
        self.assertEqual(Settings.model_fields["signed_url_ttl_seconds"].default, 86400)
