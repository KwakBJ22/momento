"""Participants (album_contributors) can OPEN the albums they contribute to.

The "함께 만드는 앨범" list reads album_contributors, but get_album_access only read
family_members/album_members — so participants saw albums they could not open (403).
The fallback maps an active contributor row to album_role="contributor": read + own
contributions, and NOTHING above that."""
from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from app.services import membership
from app.services.authorization import (
    require_album_edit_settings,
    require_album_read,
    resolve_album_access,
)

ALBUM = {"id": "album-1", "owner_id": "owner-1", "family_id": None}
CONTRIBUTOR_ID = "user-contrib"


def _contributor_access():
    return resolve_album_access(ALBUM, CONTRIBUTOR_ID, None, "contributor")


class ContributorCapabilityTests(unittest.TestCase):
    """★ 핵심: 참여자는 읽기 + 자기 기여까지만. 그 위는 전부 불가."""

    def test_contributor_can_read(self) -> None:
        require_album_read(_contributor_access())  # no raise

    def test_contributor_can_contribute(self) -> None:
        self.assertTrue(_contributor_access().can_contribute)

    def test_contributor_cannot_edit_settings(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            require_album_edit_settings(_contributor_access())
        self.assertEqual(ctx.exception.status_code, 403)

    def test_contributor_cannot_delete_or_manage_members(self) -> None:
        access = _contributor_access()
        self.assertFalse(access.can_delete_album)
        self.assertFalse(access.can_manage_album_members)
        self.assertFalse(access.is_album_owner)


class ContributorFallbackWiringTests(unittest.TestCase):
    def _access(self, *, family=None, member=None, contributor=None, album=None):
        with patch.object(membership, "get_family_membership", return_value=family), \
             patch.object(membership, "get_album_membership", return_value=member), \
             patch.object(membership, "get_album_contributor_membership", return_value=contributor) as fallback:
            access = membership.get_album_access(MagicMock(), album or dict(ALBUM, family_id="fam-1"), CONTRIBUTOR_ID)
        return access, fallback

    def test_active_contributor_row_grants_contributor_role(self) -> None:
        access, _ = self._access(contributor={"id": "c1", "status": "active"})
        self.assertEqual(access.album_role, "contributor")
        self.assertTrue(access.can_read_private)

    def test_no_relationship_stays_403(self) -> None:
        access, _ = self._access(contributor=None)
        self.assertFalse(access.can_read_private)
        with self.assertRaises(HTTPException):
            require_album_read(access)

    def test_fallback_never_runs_for_members_or_family(self) -> None:
        # Owner/family/album-member paths are untouched — the contributors table is
        # only consulted when BOTH role lookups came back empty.
        _, fallback = self._access(member={"role": "owner"})
        fallback.assert_not_called()
        _, fallback = self._access(family={"role": "member"})
        fallback.assert_not_called()

    def test_legacy_owner_unchanged(self) -> None:
        access, _ = self._access(album=dict(ALBUM), contributor=None)
        self.assertFalse(access.can_read_private)  # OTHER user on legacy album
        with patch.object(membership, "get_album_membership", return_value=None), \
             patch.object(membership, "get_album_contributor_membership", return_value=None):
            owner_access = membership.get_album_access(MagicMock(), dict(ALBUM), "owner-1")
        self.assertTrue(owner_access.is_album_owner)


class ContributorQueryShapeTests(unittest.TestCase):
    def test_query_requires_user_id_and_active_status(self) -> None:
        # Guests (user_id NULL) can never match, and remove_contributor sets
        # status="removed" → the row drops out here → access is revoked (내보내기).
        client = MagicMock()
        chain = client.table.return_value.select.return_value
        chain.eq.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
        result = membership.get_album_contributor_membership(client, "album-1", CONTRIBUTOR_ID)
        self.assertIsNone(result)
        client.table.assert_called_with("album_contributors")
        eq_calls = [chain.eq.call_args] + [chain.eq.return_value.eq.call_args, chain.eq.return_value.eq.return_value.eq.call_args]
        flat = [call.args for call in eq_calls if call]
        self.assertIn(("album_id", "album-1"), flat)
        self.assertIn(("user_id", CONTRIBUTOR_ID), flat)
        self.assertIn(("status", "active"), flat)


if __name__ == "__main__":
    unittest.main()
