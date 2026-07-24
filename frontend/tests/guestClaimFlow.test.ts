import assert from "node:assert/strict";
import test from "node:test";

import { buildGuestAlbumClaimRedirect, getGuestAlbumClaimQuery } from "../src/lib/guestAlbumClaim";

const albumId = "11111111-1111-1111-1111-111111111111";

test("Magic Link redirect keeps the guest album and public share recovery context", () => {
  const redirect = buildGuestAlbumClaimRedirect("https://momento.example", albumId, "https://momento.example/s/share-token");
  const url = new URL(redirect);

  assert.deepEqual(getGuestAlbumClaimQuery(url.search), { albumId, shareToken: "share-token" });
});

test("invalid guest claim query values are ignored", () => {
  assert.deepEqual(getGuestAlbumClaimQuery("?claim_album_id=not-an-id&claim_share_token="), { albumId: null, shareToken: null });
});
