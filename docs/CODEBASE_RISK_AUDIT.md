# Momento 코드베이스 위험 점검

## 전체 요약

점검 범위는 `frontend/src` 115개 파일, `backend/app` 94개 파일, `backend/tests` 71개 파일, Supabase 마이그레이션과 Vercel/Railway 설정이다. 이 문서는 정적 코드 및 테스트를 기준으로 한 감사 결과이며, 운영 DB·Storage 버킷 정책값·Vercel/Railway의 실제 환경 변수는 열람하지 않았다.

현재 MVP는 앨범 생성·공개 공유·협업의 기본 경로는 존재하지만, 다음 네 가지는 출시 전에 바로 막아야 하는 실제 구조적 위험이다.

1. 공개 링크 또는 album ID만으로 아직 claim되지 않은 게스트 앨범을 다른 로그인 사용자가 소유할 수 있다.
2. 공개 공유 화면의 `sessionStorage` 캐시가 링크 비활성화/만료 응답을 최대 10분간 숨긴다.
3. 결과 이미지와 PDF가 public Storage 버킷의 예측 가능한 경로에 저장된다.
4. 일반 참여자가 다른 사람의 사진 위치·사진 코멘트·`album_media`를 수정 또는 삭제할 수 있다.

기존의 `AlbumResult`, `AlbumView`, `PublicShareView`는 런타임에서 `AlbumScreen`을 사용하지만, 세 파일 끝에는 이전 화면 JSX가 주석으로 남아 있다. 현재 즉시 실행되는 문제는 아니지만 다음 UI 변경에서 다시 분기될 위험이 있다.

## 핵심 사용자 흐름 지도

### A. 비로그인 앨범 생성 → claim

| 단계 | 진입/화면 | API·서비스 | 데이터·Storage | 캐시/성공 갱신 | 실패 처리 |
| --- | --- | --- | --- | --- | --- |
| 사진 선택 | `UploadForm.tsx` + `imageFile.ts` | `optimizeImageFile`, EXIF 사전 추출 | 브라우저 `File[]` | React state | `AbortController`, 폼 오류 |
| 게스트 생성 | `UploadForm.tsx` | `POST /api/guest/upload-album`, `guest.upload_guest_album` | `albums`, `album_photos`, `album_media`, `guest_album_sessions`, `share_links`; private originals/thumbnails, public result image | `App.tsx`의 `result`; `guestAlbumClaim.ts` localStorage | 업로드 자산 best-effort 삭제 후 오류 |
| 결과 표시 | `AlbumResult.tsx` → `AlbumScreen` → `AlbumRenderer(screen)` | 필요 시 `GET /api/albums/{id}/photos` | private signed URL, `chapter_stories`, epilogue | 컴포넌트 state | stage 재시도 UI |
| Magic Link claim | `App.tsx` | `POST /api/guest-albums/claim`, `guest_service.claim_guest_album*` | `guest_album_sessions`, `albums`, `album_members`, `family_members` | claim 성공 시 localStorage 삭제 후 `/my-albums` | 실제 `detail` 표시 및 재시도 |
| 내 앨범 | `MyAlbums.tsx` | `GET /api/albums/mine` | `albums`, `album_members`, `album_photos`, guest memory count | in-flight Promise만 공유 | 오류/빈 목록 분리 |

### B. 소유자 앨범 사용

| 단계 | 진입/화면 | API·서비스 | 데이터·Storage | 성공 갱신 | 실패 처리 |
| --- | --- | --- | --- | --- | --- |
| 상세 열기 | `AlbumView.tsx` → `AlbumScreen` | `GET /api/albums/{id}`, `GET /photos`, `GET /living-append-pages` | `albums`, `album_photos`, `photo_memories`; private signed URL | 세 React state를 병렬 갱신 | detail/photos 오류 화면 |
| 제목/에필로그 | `AlbumScreenHeader`, `AlbumView`/`AlbumResult` | `PATCH /title`, `PATCH /epilogue` | `albums.title`, `epilogue`, `narrative` | 응답으로 local state 갱신 | 입력 유지 + 오류 |
| 사진 코멘트 | `PhotoMemoryLines` | `PATCH /photos/{photo_id}/comment` | `album_photos.comment`와 `caption` 동시 기록 | 응답으로 사진 state 갱신 | 인라인 오류 |
| 표지 | `CollaborationPanel` | `PATCH /cover-photo` | `albums.cover_photo_id` | 부모 콜백으로 cover URL 갱신 | 패널 오류 |
| 협업 반영 | `CollaborationPanel` | `GET /collaboration`, `/pending-contributions`; `POST /apply-contributions` | `albums.album_json`, Living pages/history, applied ID 배열 | 앨범 재조회 | 패널 오류/재시도 |
| PDF | `exportPdf.tsx` | `GET/PUT /pdf` | public `albums/{album_id}/pdf/...`; `albums.pdf_cache` | 브라우저 다운로드 | 서버 업로드 실패를 무시하고 로컬 다운로드 |

### C. 참여자 흐름

| 단계 | 진입/화면 | API·서비스 | 데이터·Storage | 성공 갱신 | 실패 처리 |
| --- | --- | --- | --- | --- | --- |
| 공유 초대 입장 | `JoinPage.tsx` | `GET/POST /api/join/{token}` | `album_invites`, `album_contributors` | `momento-collab-session:{albumId}` localStorage | API detail |
| 공개 공유 내 즉시 참여 | `PublicShareView.tsx` | `POST /api/public/shares/{token}/contribute` | `album_contributors`; global guest id localStorage | 세션 저장 뒤 `ContributeWorkspace` 표시 | 이름 입력/오류 |
| 사진 추가 | `ContributeWorkspace.tsx` | `POST /api/albums/{id}/contribute/photos` | private `album_photos`, Storage originals/thumbnails | optimistic 카드 → 응답 사진을 workspace 및 pending state에 추가 | 실패 카드 재시도 |
| 기억 남기기 | `ContributeWorkspace.tsx` | `POST /photos/{photo}/memories` | `photo_memories` | optimistic memory를 응답으로 치환 | rollback + 오류 |
| 재방문 | `ContributeWorkspace`/`PublicShareView` | workspace 또는 public share 조회 | localStorage contributor session, public session cache | state 복원 | 세션 없으면 참여 불가 |

### D. 공개 앨범 흐름

| 단계 | 진입/화면 | API·서비스 | 데이터·Storage | 렌더러 | 실패 처리 |
| --- | --- | --- | --- | --- | --- |
| 링크 열기 | `App.tsx` `/s/{token}` → `PublicShareView.tsx` | `GET /api/public/shares/{token}` | `share_links`, `albums`, photos/memories; private asset signed URLs | `AlbumScreen` → `AlbumRenderer(screen)` | API 오류면 재시도; 단, 캐시가 있으면 오류를 숨김 |
| 화면 복귀 캐시 | `publicShareFlow.ts` | 백그라운드 동일 GET | `sessionStorage:momento-public-share:{token}`, 최대 10분 | 캐시 앨범을 즉시 렌더 | 무효 링크 응답을 캐시가 있으면 표시하지 않음 |
| 공유/새 앨범 | `AlbumBottomNavigation` | Kakao SDK 또는 clipboard | 없음 | 동일 화면 | SDK 실패 시 copy fallback |

## P0 즉시 수정

### P0-1. 공개 share token 또는 album ID로 게스트 앨범 소유권 탈취 가능

- **문제**: claim API가 `guest_token`이 없어도 `album_id`, `share_token`만으로 claim을 허용한다. 공개 공유 응답에는 `album_id`가 포함되고, share token은 링크 자체에 있다.
- **사용자 영향**: 원래 게스트 생성자가 로그인하기 전에 다른 로그인 사용자가 해당 앨범을 claim할 수 있다. 같은 시점 요청은 `_claim_session`이 상태 조건 없이 `albums.owner_id/created_by`를 update하므로 마지막 요청이 소유자를 덮어쓸 수 있다.
- **관련 파일/함수**: `backend/app/api/guest.py:claim_guest_album_after_login`, `backend/app/services/guest_service.py:claim_guest_album_by_id`, `claim_guest_album_by_share_token`, `_claim_session`; `frontend/src/lib/guestAlbumClaim.ts`.
- **재현 조건**: 아직 active 상태인 게스트 앨범의 `/s/{share_token}` 또는 `album_id`를 가진 제3자가 로그인 후 `POST /api/guest-albums/claim`에 `share_token` 또는 `album_id`만 전송한다.
- **최소 수정안**: 정상 claim은 `guest_token`만 허용한다. Magic Link 복구는 URL에 넣은 복구용 1회성 claim nonce를 서버 세션과 해시로 비교하고, `status='active'` 조건을 포함한 원자적 update/RPC로 claim한다. `album_id`와 public share token은 복구 식별자가 아니라 힌트로만 사용한다.
- **예상 수정 범위**: `guest.py`, `guest_service.py`, guest session migration/RPC 1개, `guestAlbumClaim.ts`, claim 테스트.
- **필요한 테스트**: public token만으로 403, 다른 사용자 동시 claim에서 한 명만 성공, 동일 사용자의 재시도는 idempotent 성공, guest token 성공.

### P0-2. 링크 비활성화·만료 뒤에도 공개 앨범 캐시가 최대 10분 노출됨

- **문제**: `PublicShareView`는 캐시가 존재할 때 `getPublicShare` 실패 후 `error`를 설정하지 않는다. `publicShareFlow.ts` 캐시 TTL은 10분이다.
- **사용자 영향**: 소유자가 링크를 비활성화해도 같은 브라우저/탭은 캐시된 사진·코멘트·signed URL을 계속 본다. 링크 해제의 즉시성 약속이 깨진다.
- **관련 파일/함수**: `frontend/src/components/PublicShareView.tsx`의 load effect catch, `frontend/src/lib/publicShareFlow.ts:readPublicShareCache`, `savePublicShareCache`; `backend/app/api/share.py:get_public_share`.
- **재현 조건**: 공개 링크를 열어 캐시한 뒤 소유자가 해당 link를 deactivate하고, 같은 탭에서 새로고침 또는 WebView 복귀를 한다.
- **최소 수정안**: 404/410/비활성 링크 응답이면 token 캐시를 즉시 삭제하고 무효 링크 화면을 표시한다. 캐시는 네트워크 확인 전의 짧은 표시용으로만 유지하고, signed URL TTL보다 긴 캐시를 유지하지 않는다.
- **예상 수정 범위**: `publicShareFlow.ts`, `PublicShareView.tsx`, `publicShareFlow.test.ts`.
- **필요한 테스트**: cached 상태에서 404가 오면 화면·캐시 모두 제거, 네트워크 오류일 때만 stale UI 유지 여부 명시, deactivate/expired 각각.

### P0-3. 참여자가 다른 사람의 사진/미디어를 수정 또는 삭제할 수 있음

- **문제**: 사진 코멘트와 위치 수정은 `require_album_contribute`만 확인하며 사진의 업로더를 검사하지 않는다. `DELETE /albums/{id}/media/{media_id}`도 같은 권한으로 private Storage 원본·미리보기·썸네일을 제거한다.
- **사용자 영향**: album contributor 또는 family contributor가 다른 참여자/주최자의 `photo_id`·`media_id`를 사용해 코멘트/위치를 바꾸거나 파일을 삭제할 수 있다. 이는 데이터 훼손 및 협업 신뢰 문제다.
- **관련 파일/함수**: `backend/app/api/album.py:save_photo_comment`, `update_photo_location`, `delete_media`; `backend/app/services/authorization.py:require_album_contribute`; `backend/app/services/supabase.py:update_album_photo_comment`.
- **재현 조건**: contributor 권한의 인증 사용자가 같은 앨범의 다른 사용자가 올린 `photo_id` 또는 `media_id`로 PATCH/DELETE 요청을 보낸다.
- **최소 수정안**: photo/media 레코드의 `contributor_profile_id` 또는 `uploader_id`를 현재 사용자와 비교한다. 소유자/editor만 모든 항목을 관리하고, contributor는 본인 레코드만 수정·삭제하도록 공용 `require_owned_or_album_editor` helper 하나를 추가한다. collaboration guest 경로는 기존 `contributor_id` 검사를 유지한다.
- **예상 수정 범위**: `album.py`, `authorization.py` 또는 작은 ownership helper, API 권한 테스트.
- **필요한 테스트**: 다른 contributor의 comment/location/media delete는 403, 자기 항목은 성공, owner/editor는 성공, 다른 album ID는 404/403.

### P0-4. private 앨범 결과 이미지와 PDF가 public 버킷의 예측 가능한 경로에 저장됨

- **문제**: `upload_result_image`은 public legacy bucket(`SUPABASE_STORAGE_BUCKET`, 기본 `albums`)에 `{album_id}/result/album.png`를 저장한다. PDF도 `{album_id}/pdf/v{version}-r{renderer}.pdf`에 같은 버킷으로 저장하고 `get_public_url`을 반환한다. private storage migration도 legacy `albums` bucket이 public임을 명시한다.
- **사용자 영향**: UUID를 알고 있거나 URL을 받은 사람은 share link 권한과 별개로 결과 이미지/PDF를 직접 접근할 수 있다. 링크 비활성화도 이 public URL을 회수하지 못한다.
- **관련 파일/함수**: `backend/app/services/supabase.py:upload_result_image`, `get_public_url`; `backend/app/api/album.py:upload_album_pdf`, `get_album_pdf`; `supabase/migrations/20260712180000_private_storage_album_photos.sql`.
- **재현 조건**: public bucket이 migration 설명대로 public이고 album ID/버전을 알 때 deterministic object URL을 요청한다.
- **최소 수정안**: 신규 result/PDF를 `momento-private`로 이동하고 인증/유효 share token별 signed URL만 발급한다. 이미 저장된 public 객체는 호환 기간을 정한 뒤 일괄 이동 또는 접근 차단한다. 최소한 PDF부터 private bucket으로 분리한다.
- **예상 수정 범위**: `supabase.py`, `album.py`, PDF 조회/공유 DTO, Storage migration 및 기존 객체 이전 계획.
- **필요한 테스트**: 인증 없는 direct object URL 실패, owner와 active share token만 signed URL 수신, 링크 비활성화 후 public result/PDF 접근 불가.

## P1 출시 전 수정

### P1-1. 앨범 생성 저장이 DB/Storage 단위로 원자적이지 않음

- **문제**: `upload_album`/`upload_guest_album`은 Storage 업로드 → `albums` insert → `album_photos` insert → `album_media` insert 순서다. 중간 실패 시 `delete_album_record`는 FK `ON DELETE RESTRICT` 때문에 photo row가 이미 있으면 실패할 수 있고 예외는 무시된다.
- **사용자 영향**: 실패한 생성이 private Storage가 삭제된 ghost album/사진 DB row로 남아 이후 목록·재시도·Storage 비용에 영향을 줄 수 있다.
- **관련 파일/함수**: `backend/app/api/album.py:upload_album`, `backend/app/api/guest.py:upload_guest_album`, `backend/app/services/supabase.py:delete_album_record`, migrations의 `album_photos.album_id ON DELETE RESTRICT`.
- **재현 조건**: `save_album_photo_records` 성공 뒤 `save_album_media_records` 또는 이후 질문 생성에서 예외가 난다.
- **최소 수정안**: 실패 보상에서 child rows를 먼저 soft-delete/delete한 뒤 album을 처리하거나, 생성 전용 RPC/transaction으로 DB 3개 insert를 묶는다. Storage cleanup 성공/실패는 로그·재처리 대상에 기록한다.
- **예상 수정 범위**: 두 upload route와 저장 helper; migration은 transaction/RPC를 선택할 때만.
- **필요한 테스트**: 각 insert 단계 실패 주입 후 album/photo/media row와 Storage cleanup 결과 검증.

### P1-2. 앨범 생성 응답이 사진별 질문 생성 외부 호출을 기다림

- **문제**: `upload_album`은 저장 후 `generate_album_questions`를 await한다. 이 함수는 각 media마다 `QuestionAIService`의 외부 chat completion을 호출한다. catch는 `HTTPException`만 무시한다.
- **사용자 영향**: 사진 수에 비례해 핵심 생성 응답이 느려지고, SDK/네트워크 예외 유형에 따라 이미 저장된 생성 전체가 실패 경로로 갈 수 있다. 이는 사용자에게 생성 실패로 보일 수 있다.
- **관련 파일/함수**: `backend/app/api/album.py:upload_album`, `backend/app/services/question_service.py:generate_album_questions`, `backend/app/ai/question_service.py:generate_for_media`.
- **재현 조건**: 여러 사진 업로드 중 질문 AI 요청이 느리거나 `HTTPException` 이외 예외를 던진다.
- **최소 수정안**: MVP 생성 응답에서 자동 질문 생성 호출을 제거하지 말고, 현재 질문 UI가 사용된다면 저장 성공 뒤 best-effort 작업으로 분리하고 모든 예외를 기록만 하도록 한다. 결과 앨범 저장 성공과 질문 생성 실패를 분리한다.
- **예상 수정 범위**: `album.py`, 관련 테스트 1개.
- **필요한 테스트**: 질문 생성 timeout/SDK exception에도 album·photo·share link 생성이 성공하며 재시도 API는 정상 동작.

### P1-3. 공개 공유 캐시 TTL과 signed URL TTL이 불일치

- **문제**: public album 캐시는 10분, backend signed URL 기본 TTL은 300초다.
- **사용자 영향**: WebView 복귀 시 앨범 텍스트는 즉시 보이지만 이전 signed 이미지가 먼저 깨질 수 있다. 현재 백그라운드 갱신이 실패하면 개별 이미지 복구 경로가 없다.
- **관련 파일/함수**: `frontend/src/lib/publicShareFlow.ts`, `PublicShareView.tsx`, `backend/app/config.py:signed_url_ttl_seconds`.
- **최소 수정안**: public cache TTL을 signed URL보다 짧게 하거나 URL 만료 시각을 캐시에 저장해 만료된 이미지만 새 GET 후 교체한다.
- **필요한 테스트**: 만료된 cached URL에서 재조회 성공/실패, 이미지 카드만 placeholder 처리.

### P1-4. 날짜 정보 전달 계약이 협업 업로드에서 끊김

- **문제**: frontend `uploadContributePhotos`는 `file_created_ats`를 보내지만 backend `contribute_upload_photos`는 이를 parse하거나 `process_upload(..., captured_at=...)`에 전달하지 않는다. 초기 업로드는 `file_meta.captured_at` 계약을 사용한다.
- **사용자 영향**: 참여자 사진은 EXIF가 없는 경우 촬영일 없음 처리만 되고, 기존의 사용자 지정 capture-date 경로를 재사용하지 못한다. 초기 업로드와 참여 업로드의 날짜 계약이 다르다.
- **관련 파일/함수**: `frontend/src/lib/api.ts:uploadContributePhotos`, `backend/app/api/collaboration.py:contribute_upload_photos`, `backend/app/services/image_upload_service.py:parse_captured_at`.
- **최소 수정안**: 협업 API도 `captured_at` 배열만 받아 `process_upload(captured_at=...)`로 전달하거나, 쓰지 않는 `file_created_ats` 전송을 제거하고 날짜 입력 흐름을 명시한다. `lastModified`를 촬영일 fallback으로 되살리면 안 된다.
- **필요한 테스트**: EXIF 없는 협업 업로드는 임의 날짜가 저장되지 않고, 명시 날짜만 보존.

### P1-5. 상세 앨범은 서로 다른 시점의 세 API 응답을 조합함

- **문제**: `AlbumView`가 detail, photos, living append pages를 독립 요청한다. 협업 반영/편집 중에 세 응답의 album version이 달라질 수 있으며 응답에 공통 snapshot/version 검증이 없다.
- **사용자 영향**: 제목·사진·Living page가 잠깐 서로 다른 에디션으로 렌더될 수 있고 PDF/공유와 다른 화면을 볼 수 있다.
- **관련 파일/함수**: `frontend/src/components/AlbumView.tsx` load effect; `frontend/src/lib/api.ts:getAlbum/getAlbumPhotos/getAlbumLivingAppendPages`; `backend/app/api/album.py` detail/photo/living endpoints.
- **최소 수정안**: detail의 `album_version`을 기준으로 photos/living 요청에 같은 version을 전달하거나, 요청 완료 후 version 불일치만 한 번 재조회한다. 새 대형 endpoint는 필요 없다.
- **필요한 테스트**: detail version과 photo version이 바뀌는 mock에서 stale 조합을 렌더하지 않음.

### P1-6. 배포 fallback API 경로가 Railway를 직접 가리키지 않음

- **문제**: `resolveApiBase()`의 기본값은 빈 문자열이고 `frontend/vercel.json`의 `/api/(.*)` rewrite destination도 `/api/$1`이다. 이 설정만으로는 Railway origin을 명시하지 않는다.
- **사용자 영향**: `VITE_API_BASE_URL`이 Vercel build 환경에 없거나 잘못되면 모든 API 요청이 frontend origin의 동일 경로로 향한다.
- **관련 파일/함수**: `frontend/src/lib/api.ts:resolveApiBase`, `frontend/vercel.json`, `backend/railway.toml`, `.env.example`들.
- **최소 수정안**: 운영에서는 `VITE_API_BASE_URL`을 Railway HTTPS origin으로 필수화하고 release checklist에서 build-time 값을 확인한다. 또는 Vercel rewrite를 실제 backend origin으로 바꾸되 CORS/배포 순서를 함께 검증한다.
- **필요한 테스트**: production build env가 없을 때 경고/차단, production env가 있을 때 URL 단위 assertion.

### P1-7. Living Album 적용 잠금은 서버 실행 중복만 막고 결과 검증이 부족함

- **문제**: `rebuild_album`은 `last_rebuild_started_at is null` update의 반환 data가 빈 배열인지로 lock 충돌을 판단한다. 적용 ID/페이지 update는 rebuild 뒤 별도 update라 중간 실패 시 version/document와 applied ID 상태가 분리될 수 있다.
- **사용자 영향**: 드문 DB 실패에서 새 edition/page는 만들어졌지만 pending으로 다시 보이거나, 반대로 반영 표시만 되고 페이지가 없는 상태가 가능하다.
- **관련 파일/함수**: `backend/app/services/collaboration_service.py:rebuild_album`, `apply_selected_contributions`; `backend/app/api/collaboration.py:apply_contributions`.
- **최소 수정안**: lock 획득과 document/history/applied-ID update를 하나의 RPC/transaction에 넣거나, 최소한 update의 affected row를 확인하고 실패 시 명시적 복구 상태를 남긴다.
- **필요한 테스트**: two-request concurrency, rebuild 후 final update 실패, 실패 뒤 재시도.

### P1-8. 앨범 삭제는 dependent DB row와 Storage 객체를 함께 처리하지 않음

- **문제**: `DELETE /albums/{album_id}`는 `delete_album_record`만 호출한다. 현재 migration의 `album_photos.album_id` FK는 `ON DELETE RESTRICT`이고, private photo objects·public result image·PDF·share links를 정리하는 경로가 없다.
- **사용자 영향**: 실제 FK가 migration과 같으면 일반 앨범 삭제가 500으로 끝날 수 있다. 다른 환경에서 cascade가 설정되어 있더라도 Storage object와 public result/PDF가 남아 비용·공개 노출을 만든다.
- **관련 파일/함수**: `backend/app/api/album.py:delete_album`, `backend/app/services/supabase.py:delete_album_record`, `supabase/migrations/20260712180000_private_storage_album_photos.sql`.
- **재현 조건**: 사진이 한 장 이상인 앨범을 일반 사용자 화면에서 삭제한다.
- **최소 수정안**: DB에서는 album/photo/media/memory/share 관계를 명확한 soft-delete 또는 transaction 순서로 처리하고, Storage 삭제는 수집한 path로 best-effort 실행 후 실패를 운영 로그/재처리 대상으로 남긴다. public result/PDF 이전은 P0-4와 함께 처리한다.
- **필요한 테스트**: album photo/media/memory/share가 있는 삭제 성공, Storage remove 실패 시 DB 결과와 재처리 기록, 권한 없는 삭제 403.

## P2 출시 후 정리

### P2-1. 세 화면에 주석 처리된 이전 JSX 셸이 남아 있음

- **문제**: `AlbumResult.tsx`, `AlbumView.tsx`, `PublicShareView.tsx` 각각에 `Legacy shell intentionally disabled` 이후 과거 Header/Renderer/BottomNavigation JSX가 큰 주석 블록으로 남아 있다.
- **사용자 영향**: 현재 런타임 영향은 없지만 공통 `AlbumScreen` 변경이 주석 복원 시 다시 분기될 위험이 있다.
- **관련 파일**: 세 화면 컴포넌트.
- **최소 수정안**: 공통화 안정화 후 주석 블록만 삭제하고 `AlbumScreen` 구조 테스트를 유지한다.

### P2-2. screen/print가 같은 build model에서 의도적으로 다른 블록 경로를 사용

- **문제**: `AlbumRenderer(screen)`은 `chapters`로 새 카드 grid를 렌더하고, `print`는 `buildAlbum.elements`의 Hero/Polaroid3/Grid6 block을 렌더한다.
- **사용자 영향**: 화면과 PDF의 사진 순서/그룹은 공유하지만 카드 배치는 다르다. 이는 현재 의도지만 데이터 모델을 UI block으로 저장·복원하는 변경 시 회귀 지점이다.
- **관련 파일**: `AlbumRenderer.tsx`, `buildAlbum.tsx`, `exportPdf.tsx`, block CSS.
- **최소 수정안**: `BuiltAlbum`의 사진 ID/장 구조 계약만 테스트로 고정하고, PDF 전용 블록은 유지한다. UI를 강제로 동일하게 만들 필요는 없다.

### P2-3. deprecated 렌더러와 중복 컴포넌트 파일

- **문제**: `AlbumStage.tsx`는 deprecated지만 export되고 자체 `buildAlbum` effect를 실행한 뒤 `AlbumRenderer`를 다시 렌더한다. `components/album/*`와 `album-engine/components/album/*` 등 유사 이름도 공존한다.
- **사용자 영향**: 현재 direct 사용은 확인되지 않았지만 잘못 import하면 이중 build나 서로 다른 카드가 다시 생길 수 있다.
- **최소 수정안**: 사용처가 없는지 확인한 뒤 deprecated export와 중복 파일을 단계적으로 제거한다.

### P2-4. comment/caption/narrative/epilogue의 호환 필드 이중 기록

- **문제**: photo comment는 `comment`와 `caption`에 동시 기록되고, album ending은 `epilogue`와 `narrative`에 동시 기록된다. `photo_meta[].text`와 `chapter_stories`도 문서/DB에 공존한다.
- **사용자 영향**: 현재 renderer는 `comment`와 `comments`를 우선하지만, 오래된 endpoint나 향후 fallback이 `caption`/`narrative`를 다시 쓰면 미입력 문구 노출 회귀 가능성이 있다.
- **최소 수정안**: 새 코드의 canonical read/write를 `comment`, `epilogue`, `photo_memories.comment`, `cover_photo_id`로 문서화하고 compatibility write만 유지한다. 대량 migration은 필요 없다.

### P2-5. 목록 cover helper가 현재 화면에서 사용되지 않음

- **문제**: `getMyAlbumCoverUrls`, `requestMyAlbumCovers`, `mergeMyAlbumCoverUrls`는 존재하지만 `MyAlbums.tsx`는 목록 응답 내 cover URL만 사용한다.
- **사용자 영향**: 즉시 기능 오류는 없으나 목록 cover 전략이 두 개로 남아 성능 수정 시 혼란을 준다.
- **최소 수정안**: 현재 백엔드 batch cover 정책을 기준으로 helper를 제거하거나 실제 non-blocking path에 연결한다. 둘 다 동시에 유지하지 않는다.

### P2-6. CSS override 밀도가 높고 모바일 기준이 분산됨

- **문제**: `AlbumResult.css`, `AlbumRenderer.css`, block CSS, `AlbumBottomNavigation.css`에 `.album-page`, screen/print 조건, 다수 `!important`, 640/768/1024px media query가 분산되어 있다.
- **사용자 영향**: 현재 screen/print scope는 존재하지만 새 selector 하나가 PDF 또는 모바일을 덮을 위험이 있다.
- **최소 수정안**: 기능 변경 없이 album screen/print selector 목록과 breakpoint를 한 문서에 고정하고, 다음 UI bug 때 충돌 selector만 제거한다.

## 중복 렌더링 지도

| 대상 | 현재 경로 | 차이/위험 | 최소 정리 |
| --- | --- | --- | --- |
| AlbumResult / AlbumView / PublicShareView | 모두 `AlbumScreen` → `AlbumRenderer(screen)` | 각 파일은 body/action slot·API state가 다르고, 주석 legacy shell이 남음 | legacy comment 제거, common shell test 유지 |
| Screen / PDF | `AlbumRenderer(screen)` chapters/card grid vs `AlbumRenderer(print)` legacy `elements` blocks | 카드 레이아웃 의도적 차이; source photo ID/순서 회귀 위험 | 사진/날짜/epilogue/Living page ID 계약 테스트 |
| AlbumStage | deprecated wrapper + `AlbumRenderer` | 자체 build effect로 이중 계산 가능 | unused 확인 뒤 export 제거 |
| 사진 코멘트 | `AlbumPhoto.comment`, `comments[]`, `photo_memories`, `caption` | renderer는 comment + participant memory를 합쳐 표시 | canonical field 문서화 및 fallback 금지 유지 |
| 제목 UI | `AlbumScreenHeader` runtime 공통, legacy JSX에 옛 title UI 잔존 | 현재 영향 없음, 복원 위험 | commented JSX 삭제 |

## API 및 데이터 흐름 지도

| 개념 | 단일 기준 권장 | 현재 혼재 | 위험/최소 수정 |
| --- | --- | --- | --- |
| 소유자 | `album_members(role=owner)` + atomic guest session claim | `owner_id`, `created_by`, family owner, album member owner | P0-1 해결 후 읽기 helper는 유지하되 claim write 기준을 하나로 |
| 사진 comment | `album_photos.comment` | `caption` mirror, `photo_meta.text`, `comments[]` render collection | 새 write/read는 comment만; caption은 legacy mirror |
| 참여 기억 | `photo_memories.comment` + `contributor_id` | public guest memory submission은 별도 table | contributor item은 photo memory, share CTA text는 별도 보존 |
| cover | `albums.cover_photo_id` | `image_url`, `cover_image_url`, `result_path` | display URL은 ID에서 signed thumbnail으로만 만들기 |
| 앨범 document | `albums.album_json` + `living_append_pages` | `album_version_history` raw document 또는 snapshot wrapper | `unpack_edition_snapshot` 호환 test 유지 |
| 사진 ID | `album_photos.id` | `album_media.id`를 초기 upload에서 같은 UUID로 생성 | owner check에는 uploader fields/table을 명시적으로 선택 |
| share | token hash in `share_links` | guest album token, invite token, guest memory claim token | 용도별 token은 교차 claim에 사용하지 않기 |

## 캐시 지도

| 위치/키 | 유효 시간 | 관련 화면 | 무효화 | 위험 |
| --- | --- | --- | --- | --- |
| in-memory `inFlightRequests` `album:{id}:{edition}` | 요청 중 | AlbumView/StrictMode | finally | 정상; Abort signal이 첫 요청에 묶이면 subscriber 모두 영향 가능 |
| in-memory my album list | 요청 중 | MyAlbums | finally | 정상 |
| sessionStorage `momento-public-share:{token}` | 10분 | PublicShareView | 현재 명시적 삭제 없음 | P0-2, signed URL TTL 불일치 |
| localStorage `momento-collab-session:{albumId}` | 명시적 만료 없음 | contribution workspace | logout에서 정리하지 않음 | 같은 기기 재방문에 guest capability 잔존; shared-device 정책 필요 |
| localStorage guest claim 4 keys | claim 성공 시 삭제 | App Magic Link | `clearGuestAlbumClaim` | P0-1의 album/share fallback이 문제 |
| sessionStorage `momento-living-page-seen:{albumId}:{pageId}` | 세션 | AlbumRenderer | 첫 렌더 1.4초 후 set | 사용자별 서버 read receipt는 아니며 local user 기준 |
| browser asset cache | Vercel assets immutable, API no-store | 모든 화면 | asset hash | service worker 등록은 source에서 확인되지 않음 |

## 권한 판정 지도

| 행위 | 현재 서버 기준 | 감사 결과 |
| --- | --- | --- |
| private read | `get_album_access` + `require_album_read` | owner/family/member compatibility는 중앙 helper 사용 |
| settings/cover/rebuild | `require_album_edit_settings` | owner/editor에 제한됨 |
| epilogue/title | `require_album_owner_story` | owner에 제한됨 |
| participant photo memory | `require_contributor` + contributor match | create/update/delete memory는 photo album ID 및 own contributor 검증을 수행 |
| photo comment/location/media delete | `require_album_contribute`만 | P0-3: own item 검증 없음 |
| guest claim | guest token 또는 public album/share identifier | P0-1: public identifier로 ownership 부여 |
| public read | active `share_links` token | P0-2 cache와 P0-4 public Storage가 server revocation을 우회 |

## Storage 생명주기

- 초기/게스트/협업 사진은 `momento-private/families/{family-or-guest}/albums/{album}/photos/{photo}/...`에 original·thumbnail을 저장한다.
- upload asset 단계 실패 시 `upload_album_photo_assets`는 같은 요청의 이미 업로드 경로를 best-effort 삭제한다.
- DB insert 이후 실패 보상은 P1-1처럼 FK 순서 때문에 완전하지 않다.
- `DELETE /albums/{id}/media/{mediaId}`는 private object를 지운 뒤 DB row를 soft delete하지만 P0-3 권한이 과도하다.
- `DELETE /albums/{id}`는 album DB record만 delete하며 photo Storage/legacy public result/PDF cleanup을 하지 않는다. 실제 FK 정의에 따라 delete 자체가 막히거나, cascade 환경이면 object orphan 비용이 남을 수 있으므로 P1-1과 함께 검증해야 한다.
- 화면 목록은 thumbnail을 사용하고 detail/PDF는 original URL을 사용한다. `AlbumRenderer.toEnginePhoto`의 `preferOriginal` 양쪽 분기가 동일하게 `original_url || thumbnail_url`인 것은 표현상 중복이며, screen까지 고용량 original을 우선 사용한다. 이는 P1 성능 검증 대상으로 남긴다.

## 테스트 사각지대

현재 backend는 권한/guest/collaboration/EXIF API 단위 테스트가 비교적 많고 frontend는 7개 Node source/helper 테스트가 있다. 그러나 아래 회귀는 현재 테스트만으로 막히지 않는다.

### P0 우선 테스트

1. guest album ID/share token 단독 claim 거부 및 동시 claim 원자성.
2. active public cache 뒤 link deactivate/expire 시 cache purge와 접근 차단.
3. contributor가 타인의 comment/location/media를 수정·삭제하려 할 때 403.
4. public bucket direct URL로 result/PDF를 anonymous fetch할 수 없는지 integration test.

### P1 우선 테스트

1. album/photo/media 저장 단계별 실패 후 DB/Storage cleanup.
2. AI question failure가 album generation을 실패시키지 않음.
3. public cache signed URL 만료와 background refresh.
4. detail/photos/living version mismatch에서 화면이 single snapshot으로 수렴.
5. 협업 upload의 explicit capture date/EXIF 없음 계약.

### P2 테스트

1. 실제 React render test로 AlbumScreen 세 화면의 header/action/nav slot 확인. 현재 `albumScreenComposition.test.ts`는 source 문자열 검증이다.
2. screen/print 각 사진 ID 순서, chapter story, epilogue, Living page 포함 범위.
3. 390/768/1440 viewport의 visual regression. 현재 CSS 문자열 테스트만으로는 flex/grid 충돌을 잡지 못한다.

## 권장 수정 순서

1. P0-1 게스트 claim을 one-time guest capability로 제한하고 원자화한다.
2. P0-3 item ownership 검사를 모든 사진/media mutation에 적용한다.
3. P0-2 공개 캐시가 revoke/expire를 숨기지 않게 한다.
4. P0-4 public result/PDF object의 접근 경로를 private signed URL로 전환한다.
5. P1-1 생성 보상/삭제 생명주기를 정리하고 실패 주입 테스트를 추가한다.
6. P1-2 생성 응답과 자동 질문 생성의 실패·지연을 분리한다.
7. P1-3~P1-7 cache/version/deploy/lock 계약을 작은 단위로 보완한다.
