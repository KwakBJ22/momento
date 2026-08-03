"""Config contract: signed URLs must live long enough to view a fresh album.

Album creation takes ~3.5min and 300s (5min) let trailing photos of a just-created
album expire to 403 (only the frame showed). The default is 1 hour; env can still override.
"""
from unittest import TestCase

from app.config import Settings


class SignedUrlTtlDefaultTest(TestCase):
    def test_default_signed_url_ttl_is_one_hour(self) -> None:
        # Assert the field DEFAULT (independent of any .env override).
        self.assertEqual(Settings.model_fields["signed_url_ttl_seconds"].default, 3600)
