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
    require_album_delete,
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
        # The DELETE /albums/{id} endpoint calls require_album_delete — 403 for
        # contributors even if the (hidden) button were somehow clicked.
        with self.assertRaises(HTTPException) as ctx:
            require_album_delete(access)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_detail_response_exposes_capability_flags(self) -> None:
        # The frontend hides buttons ONLY from these server-derived flags (§10) —
        # additive fields, default False.
        from app.models.schemas import AlbumDetailResponse

        for field in ("can_edit", "can_contribute", "can_delete"):
            self.assertIn(field, AlbumDetailResponse.model_fields)
            self.assertFalse(AlbumDetailResponse.model_fields[field].default)


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

    def test_fallback_result_is_never_used_for_members_or_family(self) -> None:
        """★ 뒤집힌 항목 (2026-08-13). 예전에는 "부르지도 않는다"를 고정했다.

        이제 세 조회를 **나란히** 보내므로 참여자 조회도 늘 나간다(왕복 3 → 1).
        하지만 **판정은 그대로다** — 앞의 둘 중 하나라도 있으면 그 결과를 쓰지 않는다.
        그래서 "부르지 않는가" 가 아니라 **"쓰지 않는가"** 를 본다.

        contributors 행이 settings/delete 권한을 주면 안 된다는 원래 경고가 여기 걸려
        있다. 아래는 참여자 행이 `owner` 를 들고 있어도 덮어쓰지 못하는지 본다.
        """
        loud = {"id": "c1", "status": "active", "role": "owner"}
        access, fallback = self._access(member={"role": "editor"}, contributor=loud)
        self.assertEqual(access.album_role, "editor", "참여자 행이 앨범 권한을 덮어썼다")
        access, _ = self._access(family={"role": "member"}, contributor=loud)
        self.assertEqual(access.album_role, None, "참여자 행이 가족 권한 갈래를 덮어썼다")
        self.assertEqual(access.family_role, "member")

    def test_lookups_go_out_together(self) -> None:
        """세 조회가 모두 나간다 — 이것이 왕복을 하나로 줄인 방법이다."""
        with patch.object(membership, "get_family_membership", return_value=None) as fam, \
             patch.object(membership, "get_album_membership", return_value={"role": "owner"}) as alb, \
             patch.object(membership, "get_album_contributor_membership", return_value=None) as con:
            membership.get_album_access(MagicMock(), dict(ALBUM, family_id="fam-1"), CONTRIBUTOR_ID)
        for call in (fam, alb, con):
            self.assertEqual(call.call_count, 1)

    def test_four_cases_decide_exactly_as_before(self) -> None:
        """★ 판정이 예전과 같은지 네 경우를 값으로 고정한다."""
        family_only, _ = self._access(family={"role": "member"})
        self.assertEqual((family_only.family_role, family_only.album_role), ("member", None))

        album_only, _ = self._access(member={"role": "editor"})
        self.assertEqual((album_only.family_role, album_only.album_role), (None, "editor"))

        contributor_only, _ = self._access(contributor={"id": "c1", "status": "active"})
        self.assertEqual((contributor_only.family_role, contributor_only.album_role), (None, "contributor"))
        self.assertTrue(contributor_only.can_read_private)

        nothing, _ = self._access()
        self.assertEqual((nothing.family_role, nothing.album_role), (None, None))
        self.assertFalse(nothing.can_read_private)

    def test_a_broken_contributor_lookup_does_not_fail_a_request_that_used_to_work(self) -> None:
        """★ 예전에는 아예 보내지 않던 조회다. 그것이 터졌다고 요청이 죽으면 안 된다.

        이 처리를 빼면 **예전에 되던 요청이 새로 실패한다.**
        """
        with patch.object(membership, "get_family_membership", return_value=None), \
             patch.object(membership, "get_album_membership", return_value={"role": "owner"}), \
             patch.object(membership, "get_album_contributor_membership", side_effect=RuntimeError("db down")):
            access = membership.get_album_access(MagicMock(), dict(ALBUM, family_id="fam-1"), CONTRIBUTOR_ID)
        self.assertEqual(access.album_role, "owner")
        self.assertTrue(access.can_read_private)

    def test_but_a_broken_lookup_still_surfaces_when_it_decides(self) -> None:
        """앞의 둘이 비면 그 결과가 **판정에 쓰인다** — 그때는 삼키지 않는다."""
        with patch.object(membership, "get_family_membership", return_value=None), \
             patch.object(membership, "get_album_membership", return_value=None), \
             patch.object(membership, "get_album_contributor_membership", side_effect=RuntimeError("db down")):
            with self.assertRaises(RuntimeError):
                membership.get_album_access(MagicMock(), dict(ALBUM, family_id="fam-1"), CONTRIBUTOR_ID)

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
