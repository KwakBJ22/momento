# 우리앨범 Storage Architecture

## Scope

Authentication, database ownership, and RLS are not part of this layer. The
storage layer receives an already-authorized request and stores object paths;
it never persists signed or public URLs.

## Buckets

| Bucket | Visibility | Current content | Status |
| --- | --- | --- | --- |
| `woorialbum-private` | private | Album photos, thumbnails, media previews, generated results, PDFs | Active — the only bucket |

버킷은 **하나뿐이다** (K-1-c, 2026-08-09). 예전에는 `woorialbum-private` 와 빈 껍데기
`albums` 둘이었고, 브랜드 이름을 바꾸면서 데이터가 0건인 동안 새 버킷으로 옮겼다.
사진이 한 장이라도 쌓이면 못 바꾼다 — `album_photos.storage_bucket` 과
`albums.result_bucket` 이 **행마다** 버킷 이름을 들고 있기 때문이다.

★ 설정이 둘(`supabase_storage_bucket` · `supabase_private_storage_bucket`)이지만
**같은 값**을 가리킨다. 하나로 줄이지 않은 이유는 버킷 목록을 훑는 코드
(`operations_service.check_storage` · `guest_album_cleanup.find_orphan_storage_albums`)가
두 설정을 읽어 중복을 지우는 구조라, 값만 맞추면 동작이 같고 바꿀 코드가 없어서다.

No `thumbnails`, `results`, `pdf`, or `temp` buckets are provisioned.
They are folders in `woorialbum-private`, not separate buckets.

## Canonical folder structure

New writes use these paths in `woorialbum-private`:

```
albums/{albumId}/photos/{photoId}/original.{extension}
albums/{albumId}/photos/{photoId}/thumbnail.webp
albums/{albumId}/media/{mediaId}/original
albums/{albumId}/media/{mediaId}/preview
albums/{albumId}/media/{mediaId}/thumbnail.webp
albums/{albumId}/results/{assetId}.png
albums/{albumId}/pdf/{assetId}.pdf
albums/{albumId}/temp/...
```

Older paths such as `families/{familyId}/albums/...`, `.../derived/thumbnail.webp`,
and `{albumId}/result/album.png` remain valid because every read uses the
bucket/path stored in the database. No URL transformation is required.

## StorageService

`backend/app/services/storage_service.py` owns the provider contract:

- `upload`, `delete`, `download`
- `create_signed_url`, `create_signed_urls`
- `list`, `move`, `copy`

`SupabaseStorageProvider` is the sole class that calls `client.storage`.
`StorageService.for_supabase()` is used by album upload, PDF, result images,
media analysis, and deletion paths. An S3 migration adds an S3 provider that
implements the same `StorageProvider` protocol; caller code should not change.

## Signed URL policy

- The DB stores `bucket` + `path`, never signed URLs.
- URLs are generated only after owner/member/public-token authorization.
- The central TTL is `Settings.signed_url_ttl_seconds` (currently 300 seconds).
- Legacy result rows without `result_bucket` default to `albums`; new rows
  persist `woorialbum-private` in `result_bucket`.

## Upload and rollback

1. Upload assets through `StorageService`.
2. Insert album/photo/media records.
3. Mark album `active` only after all DB writes succeed.
4. On failure, remove uploaded paths and perform child-first DB compensation.

The request carries `X-Woorialbum-Operation-Id`; a repeated create request cannot
create another album record.

## Cleanup policy

No cleanup is scheduled automatically and no existing object is deleted by this
change. The following idempotent helpers are available for an authenticated
operations job:

- `cleanup_album_files(..., dry_run=True)` identifies all DB-referenced assets
  for an album and deletes them only when `dry_run=False`.
- `cleanup_temporary_album_uploads(...)` identifies/removes `temp` files.
- `cleanup_album_orphans(...)` compares an explicit known-path set with an
  album prefix. Supabase listing is non-recursive, so production jobs should
  invoke it per album subfolder.

Album deletion builds an asset cleanup plan, deletes the album record, then
attempts storage cleanup. A storage failure is logged and can be retried with
the same cleanup helper.

## AWS S3 migration

Only these files should need provider work:

1. Add `S3StorageProvider` in `storage_service.py` implementing
   `StorageProvider`.
2. Change the provider factory selected by configuration.
3. Run a path-preserving object copy from Supabase to S3.
4. Switch the configured provider after copy verification.

Album APIs, sharing, PDFs, and database records remain path-based and do not
need URL or authorization changes.
