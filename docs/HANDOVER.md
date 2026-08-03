# Momento 작업 인수인계 (2026-08-01)

Codex → Claude Code 이관 세션 기록. 이어서 작업하는 세션은 이 문서부터 읽는다.
개발 원칙은 저장소 루트의 `CLAUDE.md`를 따른다.

## 최신 세션 요약 (2026-08-03, 앨범 첫 진입 사진 프레임만 보이는 문제 = 서명 URL 만료)

원인: 비공개 버킷 서명 URL TTL 300s(5분)인데 생성 흐름이 ~3분30초 걸려, 완성 직후 30장 순차
로드 중 뒤쪽 URL이 만료돼 403 → 프레임만. 나갔다 오면 새 URL로 정상(실기기 확인).

- **[1] TTL 상향(근본)**. `config.signed_url_ttl_seconds` 기본 300→**3600(1시간)**. 서명 URL은 권한
  검사 통과 후 발급되는 임시 링크라 5분은 과도하게 짧음(주석). env `SIGNED_URL_TTL_SECONDS` 유지.
- **[2] 만료 이미지 자동 복구(방어)**. `lib/signedUrlRefresh.ts`(순수: `mergeRefreshedPhotoUrls`
  =id 매칭 URL만 교체·순서 보존, `isAlbumPhotoImageError`, `createSignedUrlRefresher`=앨범 단위 1회
  게이트) + `lib/useSignedUrlRefresh.ts`(훅: 컨테이너에 capture-phase error 리스너 — img error는
  버블 안 함). AlbumView가 stage div에 ref + 훅. **첫 사진 로드 에러 시 사진목록 1회 재요청→새 URL로
  교체, setPhotos로 URL만 갱신해 AlbumRenderer 재마운트 안 함(§9)**. 2번째 실패는 무시(루프/스탬피드 방지).
- 테스트: backend `test_signed_url_config`(기본 3600 계약), frontend `signedUrlRefresh.test`
  (URL만 교체·id/순서 보존, 앨범 img만 감지, 정확히 1회 재요청·2번째 무시, 비앨범 img 무반응).
  권한 검사·비공개 버킷·imageUrls 폴백(display→original→thumbnail) 불변.
  **backend 253 / frontend 145 / build / smoke(5·1skip).** ⚠️ **30장 완성 직후 전부 보이는지 실기기 확인 요청.**

## 이전 세션 요약 (2026-08-03, 앨범 생성 체감 개선 3건 — 처리 로직 불변)

측정: 와이파이 30장 = 준비 약 2분 + 생성 약 1분30초, 실패 없음. 속도·체감 문제.

- **[1] 진행바 멈춤 체감 제거**. AlbumCreating이 서버 `job.progress`를 그대로 렌더 → 긴 단계에서 고정.
  `lib/creationProgress.ts`(순수): 서버값을 **목표치**로 두고 표시값이 100ms마다 목표로 이징, 따라잡으면
  목표+여유(≤+6)까지 아주 느리게 기어감(정지 안 함), **단조 증가**(서버가 낮은 값 줘도 뒤로 안 감),
  완료 전 상한 99, 완료 시 100. AlbumCreating이 displayProgress state + targetProgress ref + setInterval로
  이징. aria-valuenow=표시값. 실패 시 진행바 숨김 유지.
- **[2] 준비 2분 무정보 해소**. UploadForm addFiles가 처리 장수를 state로 노출, 준비 문구를
  "사진을 준비하고 있어요 · 30장 중 12장"으로(기존 upload-form__count 슬롯 재사용, aria-live polite 유지,
  갱신은 장 단위=초 간격).
- **[3] 준비시간 단축(보수적)**. addFiles 순차→**동시 2개**(`PREPARE_CONCURRENCY=2`, ⚠️ fbedc19 메모리
  회귀 위험 영역, 올리지 말 것 주석). 순서 보존은 `lib/orderedPool.ts`(순수: 입력 순서대로 flush,
  실패 건이 나머지 안 막음). 장당 setTimeout(0) 양보 유지. MAX_EDGE/미리보기800/업로드 API/서버
  파이프라인/MAX_PHOTOS/40MB 가드 불변.
- 테스트: `creationProgress.test`(이징·단조·상한·완료), `orderedPool.test`(입력순 delivery·실패 비차단·
  동시성≤2). urgentRegression/uploadTotalGuard 바인딩 갱신. **frontend 141 / build / smoke(5·1skip).**
  ⚠️ **[3] 안드로이드 30장 실기기 재확인 필요**(커밋 후 사용자 요청).

## 이전 세션 요약 (2026-08-03, 회귀 복원 + 무료 한도 정책 변경 + 문구 정정)

- **[1] 안드로이드 picker 갤러리 회귀 복원**. 5f65cd5(`image/*` 단독)이 실기기에서 오히려 **갤러리를
  누락**(카메라/파일만)시켰다. `IMAGE_ACCEPT`를 fe297f2 전체 목록(image/* + 명시 MIME + 확장자)으로 복원.
  주석은 실기기 결과로 재작성(순서는 안드로이드 인텐트 선택기가 정함, 웹 제어 불가). imageAccept 테스트도
  전체 목록 계약으로 복원(image/* 포함 + Upload/Contribute 바인딩 유지). isAcceptedImageFile/filter 불변.
- **[2] 무료 한도 정책 변경(PO)**: 앨범 개수 제한 사실상 해제. `max_albums_per_user 3→50`(유료화 한도 아님,
  **어뷰징 방어 상한**). Landing 사전 안내 게이트 제거(`lib/albumLimit.ts`·`albumLimit.test.ts` 삭제,
  `.landing__limit-notice` CSS 제거). App은 bootstrap album_count/max_albums를 계속 state에 보관(유료 플랜용).
  백엔드 403 문구를 어뷰징 방어 문구로 변경("앨범을 너무 많이 만들었어요. 잠시 후 다시 시도해 주세요.",
  숫자·유료 유도 없음) — 생성·claim 양쪽. **`album_limit_reached` 이벤트 의미 변경: 유료화 근거 아님 →
  어뷰징 탐지 신호.** plan_limits 구조(get_user_limits/count_owned_albums)는 유지. 무료 경계는 결과물
  (고해상도 PDF·원본·인쇄)로 이동 — PRODUCT_BACKLOG 갱신.
- **[3] 사진 장수 문구 정정**(숫자 30 불변). max_photos 30은 "한 번의 업로드" 제한이지 앨범 총량이 아님.
  UploadForm 부제 "최대 30장까지 고를 수 있어요"→"한 번에 30장까지 담을 수 있어요. 다 담지 못했다면 앨범을
  만든 뒤에 더 추가할 수 있어요." + 드롭존 문구도 동일 취지 정정. MAX_PHOTOS·백엔드 max_photos 불변.
- **[4] 함께 커밋**: Cowork가 수정한 CLAUDE.md(§1 관계 기반 결과물, §9 온디바이스 얼굴 인식)와
  docs/PRIVACY_POLICY.md(§1.4 얼굴정보 미수집)를 내용 변경 없이 커밋. `*.bak.*` 백업은 커밋 제외.
- 검증: backend pytest / frontend test / build / smoke. **[1] 안드로이드 실기기 재확인은 사용자 몫**(커밋 후 요청).

## 이전 세션 요약 (2026-08-02, 업로드 총량 가드 40MB 현실화)

`MAX_TOTAL_UPLOAD_BYTES` 100MB는 모바일에서 성공 불가라 사실상 무한 → 실패가 "네트워크 연결을
확인해주세요"로 원인 불명. **40MB로 하향**(`optimizeImageFile.ts`, 상수 그대로 사용). 순수 함수
`fitsWithinUploadTotal(currentBytes, addedBytes)` 추가 → UploadForm.addFiles가 사진별로 검사,
초과 시 **그 사진만 막고(continue) 기존 선택 보존**, 기존 error 슬롯에
"사진이 많아 한 번에 담기 어려워요. 20장 정도로 나눠서 앨범을 만들어 보세요."(기술 용어 없음).
MAX_PHOTOS 30·업로드 API 불변. 실동작 테스트 `uploadTotalGuard.test`(40MB 값, 미만 허용/초과 차단/경계,
UploadForm 바인딩·기존 선택 미초기화). **frontend 137 / build 통과.**

## 이전 세션 요약 (2026-08-02, 무료 한도: 사용자당 앨범 3개)

목적: 한도를 코드 한 곳에 모으고, 한도에 닿은 사용자를 계측. 결제·유료 문구는 범위 밖. 마이그레이션 없음.

- **한도 단일 출처**: `config.max_albums_per_user=3`(env `MAX_ALBUMS_PER_USER`) + `services/plan_limits.py`(신규):
  `get_user_limits(user_id)`(다른 곳에서 직접 안 읽음, 유료 플랜은 여기서만 분기), `count_owned_albums`
  (**살아있는 앨범만** — `deleted_at IS NULL`, owner/created_by. `list_all_owned_album_ids`는 삭제분 포함이라 재사용 안 함).
- **생성 검사**(`album.py upload_album`): 로그인 사용자만, **사진 처리·Storage 업로드보다 먼저**. 초과 시 403
  "앨범은 N개까지…"(숫자는 한도값). 게스트(비로그인)는 소유자 없어 미적용.
- **claim 검사**(`album.py claim_guest_album`): 초과 시 **앨범 삭제 안 함** — 게스트 세션 7일 연장 후 403
  "앨범 N개를 이미 가지고 계세요…"(자리 비운 뒤 재저장 가능). 이미 자기 것이면 idempotent 통과.
  `guest_album_service`에 `get_guest_session`/`extend_guest_session` 추가.
- **계측**: 새 이벤트명은 CHECK 제약(마이그레이션)이 필요해 금지 → **허용 이벤트 `upload_failed` + metadata
  `error_code`("album_limit_reached"/"photo_limit_reached")** 재사용(parity 테스트 그린, 스키마 무변경).
  album_limit=생성/claim 거절, photo_limit=사진 30장 초과 백엔드 400.
- **bootstrap 확장**(additive): `POST /api/auth/bootstrap` 응답에 `album_count`/`max_albums` 추가(profile_id/family_id 유지).
- **프런트**: App이 bootstrap에서 `{count,max}` 보관 → `lib/albumLimit`(신규, 순수) `isAlbumLimitReached`.
  Landing이 `createActionFor`로 게이트: 한도 도달 시 사진 선택 단계로 안 넘어가고 인라인 안내(`landing__limit-notice`,
  새 페이지·모달 없음). 비로그인은 통과. 업로드 중 403은 기존 error 슬롯이 서버 detail 표시.
- 테스트(실동작): backend `test_plan_limits`(count 삭제제외, 생성 403+Storage 미호출, 2개 통과 게이트,
  claim 초과 403+미삭제+세션연장, claim 통과). frontend `albumLimit.test`(경계·게스트·미로드, blocked/start, 바인딩).
  **backend 252 / frontend 134 / build / smoke 5+1skip.** ⚠️ 한도 배너 실기기/실계정 확인은 사용자.

## 이전 세션 요약 (2026-08-02, 안드로이드 미리보기 깨짐/업로드 실패: 미리보기 전용 축소본)

원인 확정: 미리보기가 업로드용 2560px 파일을 그대로 `<img>`에 물려 탭 디코드 메모리 고갈
(2560×1920×4≈19.6MB/장, 7장≈137MB). 6~7장부터 새 사진이 깨진 아이콘, 비결정적(=자원 고갈).
그 상태로 생성 누르면 FormData 읽는 중 fetch가 전송 단계에서 죽어 TypeError(서버 도달 0).

- **[1] `optimizeImageFile.ts`**: `prepareUploadAndPreview(file) → {file, previewBlob}` 추가.
  **같은 디코드에서** (a) 2560px 업로드본(기존 로직 그대로) → (b) 800px JPEG 0.75 미리보기본을
  순서대로 인코딩, 각 캔버스는 인코딩 직후 w/h=0 해제. 디코드 실패·HEIC·GIF는 previewBlob=null +
  원본 File(사진 안 떨어뜨림). `optimizeImageFile`/`prepareForUpload` 시그니처·동작 불변(공유 코어
  `encodeUploadFromImage` 재사용, 중복 없음). MAX_EDGE 2560·품질 0.85·HEIC 서버경로 불변.
- **[2] `UploadForm.tsx`**: `createPhotoItem`의 previewUrl을 previewBlob 기준(null이면 업로드 파일 폴백).
  addFiles가 prepareUploadAndPreview 사용. revoke·setTimeout(0) 양보 유지.
- **[3] `PhotoCommentList.tsx`**: 미리보기 img에 `loading="lazy" decoding="async"` → 화면 밖은 디코드
  안 함(디코드 메모리를 보이는 장수로 제한). 레이아웃·디자인 불변(aspect-ratio 기존).
- 회귀 테스트(실호출): `uploadPreview.test`가 DOM 스텁으로 실제 경로 실행 → 업로드 캔버스 long edge
  2560·미리보기 800 확인, 디코드 실패/HEIC/GIF 폴백(원본+null), UploadForm 바인딩, img lazy/async.
  기존 uploadPreparation 테스트 유지. **frontend 129 / build / smoke(로컬 5 pass·1 skip).**
  ⚠️ 안드로이드 실기기(10장+ 추가 시 미리보기 유지 + 생성 성공)는 사용자 검증.

## 이전 세션 요약 (2026-08-02, 안드로이드 picker 갤러리 우선 + 업로드 4.5MB 프록시 한도 규명)

- **[1] 갤러리를 picker 첫 번째로** (`imageFile.ts` `IMAGE_ACCEPT`). `image/*` + 명시 MIME/확장자를
  같이 두면 안드로이드 Chrome이 인텐트를 넓게 구성해 문서 선택기("내 파일", 다중선택 불가)를
  같이 띄우고 사용자가 그걸 먼저 누른다. → **`IMAGE_ACCEPT = "image/*"` 단독**으로 축소해 갤러리 우선.
  허용 범위는 그대로(실검증은 `isAcceptedImageFile`/`filterImageFiles`, 불변). `imageAccept.test` 를
  image/* 단독 계약으로 갱신, 바인딩 검증 유지.
- **[2] 프로덕션 업로드 실패 = Vercel 프록시 4.5MB 한도** (코드 수정 없음, 문서만). `frontend/api/[...path].ts`
  프록시가 요청 본문 4.5MB 플랫폼 한도 → 사진 ~5장 이상 앨범 생성이 전부 실패(Railway 로그에 도달 없음).
  근거: 성공 앨범 최대 6장 4.91MB, 그 이상 전무. **해결: Vercel 환경변수 `VITE_API_BASE_URL` 를 Railway
  공개 도메인으로 지정**(사용자가 콘솔에서 설정)해 프록시 우회·백엔드 직접 호출. KNOWN_ISSUES·프록시 상단
  주석에 기록(프록시 코드는 작은 요청용으로 유지, 미변경).
- **[3] 회귀 방지 스모크 1개 추가**. `api.ts` 가 `window.__momentoApiBase = API_BASE`(진단 전용, 동작 무관)
  노출 → `smoke.spec.ts` 가 배포 대상에서 **API_BASE 비어있지 않은지** 검사(localhost는 설계상 skip).
  이 설정 누락 배포를 스모크가 잡는다. **frontend 124 / build / smoke(로컬 preview: API_BASE 항목 skip, 나머지 pass).**
  ⚠️ 프로덕션 스모크의 API_BASE 항목은 `VITE_API_BASE_URL` 설정 전까지는(현재 미설정 추정) 실패해야 정상 — 그게 목적.

## 이전 세션 요약 (2026-08-02, 안드로이드 회귀 2건: 갤러리 다중선택 / 단계 유실)

실기기(안드로이드) 재현으로 원인 확정. 최소 수정.

- **[1] 갤러리 다중 선택 불가** (`imageFile.ts` `IMAGE_ACCEPT`). fe297f2에서 `image/*`가 빠져
  안드로이드 Chrome picker 인텐트에서 갤러리 앱이 제외됨(문서 선택기는 다중선택 불가).
  → fe297f2 이전 값(`image/*` 선두 + 명시 타입/확장자)으로 복원. 실제 필터는 `isAcceptedImageFile`.
- **[2] 다중 선택 후 첫 화면으로 튐**. 안드로이드에서 풀해상도 디코드+2560px 캔버스가 사진 수만큼
  반복 → 탭/렌더러 재시작 → App 메모리 state(category·step) 유실.
  - **2-1 단계 유실 방지**: `lib/createStep.ts`(신규, 순수)로 기존 키 하나에 `{category, photoStep}`
    저장·복원. 마운트 시 복원(파일은 복원 불가 → UploadForm이 기존 error 슬롯에 "사진을 다시 골라주세요.").
    복원 시 `authDebug("CREATE_STEP_RESTORED")` 1줄(렌더러 재시작 유일 증거). onSuccess/resetToStart에서 정리.
  - **2-2 메모리 피크 축소**: `optimizeImageFile` willReadFrequently 제거 + 인코딩 후 canvas w/h=0 해제,
    `addFiles` 사진별 루프에 setTimeout(0) 한 틱 양보(순차 유지). MAX_EDGE/품질/HEIC 폴백 불변.
- **[3] 업로드 실패 진단**: UploadForm TypeError console.error에 `visibilityState`+`wasHiddenDuringSession`
  추가(탭 백그라운드로 fetch 죽는지 확인용). 사용자 문구 불변.
- 회귀 테스트: `imageAccept.test`(IMAGE_ACCEPT 실값 image/* 포함 + UploadForm/Contribute 바인딩),
  `createStep.test`(단계 저장/복원/미저장/레거시값 라운드트립). **frontend 124 / build / smoke 5/5.**
  로컬 preview 실측: 갤러리 input accept=image/*·multiple·camera capture 유지, 리로드 시 UploadForm 복원+재선택 안내.

## 이전 세션 요약 (2026-08-02, 사진 고르기 화면(UploadForm) 재구성)

PO 승인 UI 변경. 한 화면 primary 하나(DESIGN_SYSTEM §7) 원칙으로 위계 정리. **업로드 로직/파일 처리/생성 API 불변.**

- `UploadForm.tsx`/`UploadForm.css`: 상단 제목("어떤 사진을 담을까요?")+설명(찍은 날짜로 정리 안내) 추가.
  "사진 고르기"는 primary(＋), 사진 있으면 secondary+"＋ 사진 더 고르기". "바로 촬영하기"는 텍스트 링크로 강등
  (배경·테두리 제거, `--tap-min` 유지, `capture="environment"` 유지). 0장: 빈 상태 "고른 사진이 여기에 모여요",
  **생성 버튼·선택 수 미렌더**. 1장+: "30장 중 N장 · size"(N만 강조), 목록 아래 "앨범 만들기" primary. 토큰 변수만 사용.
- 회귀: 사진 수 분기를 순수 모듈 `lib/uploadFormView.ts`(pickButtonLabel/showsSubmitButton/showsEmptyState/
  showsSelectionCount)로 분리 → UploadForm이 실제로 호출. `uploadFormRender.test.ts`가 0/N 분기 실동작 +
  JSX 바인딩 + capture 유지 확인. **frontend 118 / build / smoke(로컬 preview 5/5) 통과. 0장 화면 프로덕션 빌드 실측 확인.**

## 이전 세션 요약 (2026-08-02, 비로그인(게스트) 앨범 생성 + 저장(claim))

**정책(PO 확정)**: 로그인 없이 앨범을 만들 수 있어야 한다. 저장 시점에 가입을 유도한다.
소셜 로그인 전환 때 빠졌던 게스트 경로를 재도입했다(DB 인프라·claim RPC는 이미 존재 —
`guest_album_sessions`, `claim_guest_album_ownership`, `albums.owner_id` nullable. **마이그레이션 없음**).

- **백엔드** (`app/api/album.py`, `app/services/guest_album_service.py`(신규), `authorization.py`, `auth.py`):
  - `optional_strict_authenticated_user`: **Authorization 헤더가 없으면 익명(게스트), 있는데 무효면 그대로 401.**
    → 로그인 사용자의 401→refresh 흐름을 보존하면서 게스트를 허용(기존 흐름 안 깨짐).
  - `guest_album_owner_access()`(album_role=owner) + `_actor_album_access(user|guest_token)`: 게스트 토큰은
    항상 `guest_album_sessions`에서 hash로 서버 검증(active·미만료·album_id 일치)해야 소유자 권한.
  - `upload-album`: 비로그인이면 `owner_id/family_id=NULL`, 멤버십·가족 provisioning 생략, **게스트 세션 생성 후
    raw 토큰을 응답**(`guest_token`), `guest_album_generated` 이벤트. 로그인 경로는 불변.
  - 게스트 토큰을 받는 라우트: 상세·사진·생성상태·미리보기·재시도·제목·에필로그·사진코멘트(모두 `X-Momento-Guest-Album-Token`).
  - `POST /api/guest-albums/claim`(로그인 필요): `ensure_default_family`→`claim_guest_album_ownership` RPC로 소유 이전,
    `guest_album_claimed` 이벤트. 같은 사용자 idempotent, 타인 claim은 403.
  - `/media`(영상)는 family 필요 → 게스트 대상 아님(게스트는 생성 시 사진 업로드). 정책 변화로 **미인증 생성은 이제 401 아님**,
    미인증 상세조회는 401→**403**(no-access)로 바뀜(관련 기존 테스트 갱신).
- **프런트** (`App.tsx`, `lib/api.ts`, `lib/guestAlbum.ts`(신규), `UploadForm.tsx`, `AlbumView.tsx`):
  - 첫 화면 로그인 벽 제거: 카테고리+"앨범 만들기"→바로 사진 선택(게스트 포함).
  - `uploadAlbum`(세션 있으면 bearer, 없으면 게스트) + 응답 `guest_token`을 `localStorage momento-guest-album-token:<id>`에 저장.
  - `albumOwnerFetch`: 세션 있으면 bearer, 없고 게스트 토큰 있으면 헤더로 전송. get/photos/status/preview/retry/title/epilogue/comment 적용.
  - 게스트는 `requiresLogin` 우회(토큰 보유 시) → 자기 앨범 조회·수정. AlbumView guestOwner: "내 앨범으로 저장하기" CTA
    → `setPendingGuestClaim`+로그인 → 로그인 후 `claimGuestAlbum`→토큰 삭제→`/album/:id` 재로딩(소유자).
- **테스트/문서**: backend `test_guest_album_flow.py`(생성·조회·타세션 거부·만료·claim·idempotent·타인 403, stateful fake+claim RPC),
  `_fake_supabase`에 claim RPC·insert 기본값 추가, `test_album_authorization`/`test_family_membership` 정책 갱신.
  frontend `guestAlbum.test.ts`(토큰 저장 스코프·pending 1회 소비), `urgentRegression` 게스트-우선 갱신.
  KNOWN_ISSUES 비회원 앨범·PRODUCT_BACKLOG 갱신. **backend 246 / frontend 114 / build 통과.**
  ⚠️ 실제 카카오 로그인 왕복+claim은 배포 후 실측 필요(정규식으로 못 봄).

## 검증 방법 (변경 유형별 필수 검증) — 회귀 재발 방지

> 이 저장소의 상당수 테스트는 **소스 구조를 정규식으로 볼 뿐 코드를 실행하지 않는다.**
> 그래서 로그인 모달 미렌더 / PDF 사진 사라짐 / 초대 링크 죽음 / 참여 422 / tokens.css 미배포
> 같은 회귀가 전부 "테스트 통과" 상태로 새어 나갔다. **변경하면 아래 방식으로 실제로 실행해 확인한다.**

| 변경 유형 | 필수 검증 |
| --- | --- |
| 백엔드 로직·API | `python -m pytest`. **실동작 테스트 우선** — `tests/test_core_flows.py` 처럼 stateful fake DB(`tests/_fake_supabase.py`)로 *만들고 → 실제 호출 → 조회*. MagicMock 스크립트 응답은 구조 버그를 통과시킨다. |
| 삭제·탈퇴·정합성 | stateful fake 로 **남아야 할 것과 사라져야 할 것을 양쪽 다 assert**(예: 내 앨범/프로필 제거 + 타인 앨범 기여는 익명화되어 잔존). |
| 프런트 순수 로직 | `npm run test:frontend`(tsx). 순수 함수는 CSS-free 모듈로 분리해 단위 테스트(예: `lib/pdfPageBreak.ts`). |
| CSS·레이아웃·렌더(PDF/앨범/화면) | `npm run build` + **브라우저 실측**(computed style·`getBoundingClientRect`). 정규식 테스트로는 절대 못 본다. |
| 배포 후 프로덕션 | **`npm run test:smoke`**(Playwright, `tests-e2e/`). 빈 화면·CSS 죽음·라우트 크래시를 잡는 유일한 수단. 타깃은 `SMOKE_BASE_URL`(기본 프로덕션). CI 없음 → 배포 후 수동 실행. |
| DB 스키마·마이그레이션 | 프로덕션 적용 후 FK/NULL/CASCADE 제약 실측 + cascade 테스트. |

**배포 검증**: `git push` ≠ 배포 완료. origin 해시 · Vercel 배포 해시 · alias · 실제 URL 반영을 모두 확인(CLAUDE.md §11).

## 이전 세션 요약 (2026-08-02, 실동작 테스트 + 스모크 테스트 + 검증 절)

회귀 방지 인프라. **소스 정규식 테스트가 실제 동작을 안 봐서 회귀가 샌 문제**에 대응.

- **[1] 백엔드 실동작 테스트** (`tests/test_core_flows.py`, `tests/_fake_supabase.py`). 공유 stateful
  fake Supabase(insert/update/delete/upsert/eq/is_/in_/or_/order/limit/count/rpc) + `test_invite_flow`의
  검증된 방식으로 핵심 흐름을 *만들고→호출→조회*: **앨범 생성→조회→삭제**(권한 없는 삭제 거부),
  **초대 생성→링크 접근→참여자 사진 저장**, **view 공유 링크 사진 추가 거부(실 엔드포인트+TestClient)**,
  **회원 탈퇴→내 앨범·프로필 제거·타인 앨범 기여 익명 잔존**, **반응 세션별 dedupe·방명록 작성/본인만 삭제**.
  backend **239 passed**(+9).
- **[2] Playwright 스모크 5종** (`frontend/tests-e2e/smoke.spec.ts`, `playwright.config.ts`,
  `npm run test:smoke`). 랜딩 렌더+CTA / 콘솔 uncaught 오류 0 / **`--c-brand`=`#ff6b6b` 실적용** /
  공유 링크 라우트 비-백지 / `/admin` 비-백지. `@playwright/test` devDependency 추가(회귀 비용>도입 비용).
  현재 빌드(로컬 preview) 대상 **5/5 통과**.
- **[3] HANDOVER "검증 방법" 절**(위) 추가.
- ⚠️ **스모크가 실제 프로덕션 결함을 잡음**: 프로덕션은 `--c-brand` 등 **디자인 토큰이 미적용**
  (버튼이 의도한 코랄이 아니라 탁한 탄색 `#b48c6e`). 원인 — `frontend/src/styles/tokens.css`가
  **git 미추적(`??`)**, `main.tsx`의 `import "./styles/tokens.css"`가 **미커밋(HEAD에 없음)**.
  즉 **워밍코랄 토큰 리디자인 전체가 로컬 워킹트리에만 있고 배포된 적이 없다.** 스모크는 프로덕션에서
  이 항목이 (정당하게) 실패한다. **이 미커밋 리디자인 배포는 이번 작업 범위 밖**(대규모 디자인 변경 —
  사용자 결정 필요). 이 세션 커밋에는 tokens.css/main.tsx 등 워킹트리 변경을 포함하지 않았다.

## 이전 세션 요약 (2026-08-02, PDF 페이지 경계 사진 잘림 + 문서 정합)

- **PDF 페이지 하단 사진 잘림 수정** (`954f320`). html2canvas 는 전체를 한 캔버스로
  래스터화 후 페이지 높이로 잘라 CSS break-inside 를 못 지킨다. html2pdf `pagebreak.avoid`
  도 이 레이아웃엔 무력(getBoundingClientRect 컨테이너 오프셋 버그 — 소스에 `// TODO` 존재 +
  grid 아이템 앞 패딩 div 가 grid 를 깸).
  → `exportPdf.alignBlocksToPrintPages`: html2pdf 직전 우리 host(top:0)에서 최상위 블록 위치를
  재고 페이지 경계 넘는 블록에 `margin-top` 을 더해 다음 페이지로 내림(grid 아이템 margin-top 이
  뒤 형제 밀어내는 것 브라우저 실측 확인). html2pdf `pagebreak: { mode: [] }` 로 버그 avoid 끔.
  페이지 계산은 순수 함수 `lib/pdfPageBreak.printPageStraddleGap` 로 분리 → 단위 테스트.
  pageH = hostWidth × 297/210(margin 0, 210mm host). **프로덕션 실렌더 실측 완료**(앨범
  `3ea35987`, 사진 6장): 정렬 후 host(pageH 1123px) 11개 블록 **straddler 0**, 각 블록이
  다음 페이지 top(1123·2245·3368…)으로 밀려 페이지 안에 온전히 들어감.
- **문서 정합** (`ee46ff3`). CLAUDE.md §9 "원본 항상 보존"을 실제(업로드 시 긴 변 2560px 축소,
  `optimizeImageFile.MAX_EDGE`, 의도된 정책·A4 300DPI 커버)에 맞게 수정. KNOWN_ISSUES 에
  "A4 초과 대형 인쇄 화질 부족" 추가. **MAX_EDGE·±2° 회전·html2canvas scale 은 안 건드림.**

## 이전 세션 요약 (2026-08-02, 회귀 3건 수정: 참여/PDF/제목아이콘)

프로덕션 DB·PDF 직접 조사로 회귀 규명. **정규식 테스트가 실제 동작을 못 봐서 놓친 것 → 백엔드에 실동작 테스트 추가.**

- **[회귀 A] 참여(사진/기억) 무반응** (`f3b273a`). `start_public_contribution` body 가
  `dict[str, str]` 이라 로그인 사용자의 `{"guest_id": null}` 이 **422 → "입력 내용을 확인해주세요."**로
  실제 원인을 가림. → body `dict[str, Any]`(null 허용), **소유자는 자기 앨범에 view/closed 무관하게 추가 가능**,
  closed 안내 한국어, 패널 열 때 scrollIntoView.
  - **실동작 테스트**(stateful fake DB): 초대 생성→그 링크 조회 성공, enabled/status/is_active 셋 동시 ON,
    closed 앨범 재초대 시 재개방. `start_collaboration` 자체는 정상(테스트로 증명) — 죽은 초대의
    closed 는 "참여 중단" 기능에서 온 것.
- **[회귀 B] PDF 사진 사라짐** (`e575e73`). PDF print 레이아웃 수정 때 aspect-ratio:1·overflow·
  max-height 제거로 높이 근거 소실 → html2canvas 가 flex 셀 이미지 `height:auto` 를 0 으로 붕괴.
  → `AlbumPhotoFrame` print 이미지에 **DB width/height 로 `aspect-ratio` 인라인**(정사각 아님, 실제 비율)
  → 로드 무관 자리 확보. eager 로딩·waitForAlbumAssets 유지.
  ⚠️ **html2canvas 실렌더는 배포 후 실제 PDF 로 육안/파일크기 검증 필요**(정규식으로 못 봄).
- **[회귀 3] 제목 편집 연필 찌그러짐** (`717863f`). `.album-screen-header__edit` 가 inline-flex 에서
  긴 제목에 밀려 축소 → `flex: 0 0 32px`.

## 이전 세션 요약 (2026-08-02, 참여 설계 §10: 다녀간 사람 수)

기존 `share_links.view_count` 를 표시만 함(새 테이블·API 없음).

- **`album_visitor_count()`** (`f9c431b`): 앨범의 모든 share_links(비활성 포함) view_count 합 →
  링크 재발급으로 카운트 안 갈라짐.
- `get_collaboration_status` 응답에 `visitor_count` 추가, **소유자(`can_edit_settings`)만** 계산·노출
  (비소유자 0). `CollaborationPanel` 은 소유자 & `visitor_count>0` 일 때만
  "✨ 지금까지 N명이 다녀갔어요." 표시. **0이면 숨김**(상처 방지), "조회수" 안 씀, 숫자만(익명).
- AlbumRenderer 미변경 → **PDF 제외.** 마이그레이션 없음.
- 회귀 테스트: 합산·null 처리, 소유자 게이트·0 숨김·따뜻한 카피·PDF 렌더러 청정.

## 이전 세션 요약 (2026-08-02, 참여 설계 §3: 방명록)

앨범 전체에 남기는 짧은 글(사진별 기억과 별개 테이블).

- **테이블·API** (`ababfb3`). `album_guestbook_entries`(album_id CASCADE, contributor_id
  nullable SET NULL, author_name 40자, message 200자, session_hash, deleted_at).
  **프로덕션 적용 완료.** FK 확인: album_id=CASCADE, contributor_id=SET NULL.
  - `delete_album_cascade` 에 방명록 삭제 추가(+album_id CASCADE backstop) → 앨범 삭제·회원
    탈퇴가 RESTRICT 로 안 막힘. `delete_profile_cascade` 는 방명록이 profiles 참조 안 해 무변경(점검 완료).
  - **소유권=세션 해시**(반응과 동일). 감상 링크 방문자도 작성 가능(contributor 시스템 미사용 →
    contributor_limit 10·협업 종료에 안 막힘). 본인 글만 삭제.
  - API: `POST /public/shares/{token}/guestbook`, `POST .../{id}/delete`(body에 session_key),
    get_public_share 응답에 익명 guestbook 목록.
- **UI** (`22439f9`). PublicShareView: "우리의 이야기" → 반응 → **방명록**. 이름(participantName
  재사용, 필수)+메시지 폼, 목록, 본인 글 삭제. **AlbumRenderer 미변경 → PDF 제외.**
  `CLAUDE.md §6` 앨범 구조에 반응·방명록(웹/공유 전용, PDF 제외) 추가.
- 회귀 테스트: 작성/본인만 삭제/타인 403, delete_album_cascade에 방명록 삭제 존재, FK CASCADE/SET NULL,
  방명록이 반응 다음 렌더, PDF 렌더러에 guestbook/reaction 없음.

## 이전 세션 요약 (2026-08-01, 참여 설계 §9: 측정)

출시 판단 5개 지표를 하나도 못 계산하던 문제 해결. 원인은 스키마가 아니라 `log_event` 부재.

- **최소 이벤트 계측** (`3934f65`). `EventLogger`(best-effort, 실패해도 기능 안 깨짐) +
  `ALLOWED_METADATA_KEYS`(PII 차단) 정책 그대로 사용.
  - `upload_started`(upload_album) / `album_created`(생성 job 완료 `run_initial_album_generation`)
    → 완료율. **기존 album_created 호출은 line 655 이후 dead code라 안 찍혔음.**
  - `invitation_opened`(신규, /join GET) / `invitation_accepted`(/join POST) → 초대 참여율.
  - `photo_added`/`memory_added`(참여자 contribute 경로) → 협업 비율.
  - `album_revisited`(신규, get_album 소유자·최신본) → D7 재방문율.
  - 공유는 기존 `share_link_created` 로 계산(신규 없음).
  - CHECK 확장 migration `20260801120000_analytics_metric_events.sql`(+rollback):
    `invitation_opened`·`album_revisited` **2개만** 추가(나머진 이미 허용). **프로덕션 적용 완료.**
  - 회귀 테스트: 참여자 photo/memory 이벤트 발화, **코드가 쓰는 모든 이벤트명이 CHECK 허용 목록에 있음**
    (`test_analytics_event_names.py` — §9의 이름 불일치 버그 재발 방지).
- **지표 SQL·이름 통일** (`db07aa1`). `docs/METRICS.md`(신규, 5개 지표 계산 SQL),
  `docs/TODO.md` 이벤트 이름을 DB 허용 목록 기준으로 통일, `.gitignore` METRICS 예외.

## 이전 세션 요약 (2026-08-01, 참여 설계 §2: 반응)

`docs/PARTICIPATION_DESIGN.md` §2(반응)만 구현. 방명록(§3)은 다음 단계.

- **앨범 단위 반응 스키마·집계** (`b347a61`). 반응이 재발급 가능한 공유 링크에 묶여
  집계가 흩어지던 문제 해소.
  - migration `20260801110000_share_reactions_album.sql`(+rollback): `album_id`(NOT NULL,
    albums, **ON DELETE CASCADE**), `share_link_id` nullable(SET NULL, 유입 경로 기록용),
    유니크 `(album_id, session_hash, reaction)`, 코드 remember→love·warm→moved(smile 유지).
    0행이라 backfill 없음. **프로덕션 적용 완료**(album_id NOT NULL/share_link_id nullable 확인).
    album_id CASCADE 라 `delete_album_cascade` 는 안 건드림(앨범 삭제 시 자동 정리).
  - `add_reaction(album_id, share_id, ...)` album 기준 upsert, `reaction_counts()` 추가,
    `get_public_share` 응답에 `reaction_counts`(익명 집계) 포함. `ShareReactionRequest` Literal
    love/moved/smile.
- **반응 UI 연결** (`6d770f7`). 앨범 마지막 "우리의 이야기" 다음에 ❤️좋아요/🥹뭉클해요/😊웃음이 나요
  3종 바. 익명 집계만, 누가 눌렀는지 미표시. 이미 누른 건 눌린 상태(session_hash 기준).
  감상 링크 방문자도 반응 가능(반응은 kind 게이트 아님). **AlbumRenderer 미변경 → PDF 제외.**
  `lib/shareReactions`: 3종 상수 + 브라우저 고정 session key + 앨범별 눌림 상태(localStorage).
  360px 웹뷰 대응(flex:1 1 0 + min-width:0 + 라벨 ellipsis).
- 회귀 테스트: backend(새 코드 love/album_id, 폐기 remember 422), frontend(3종/이모지, PDF 렌더러에 reaction 없음).

## 이전 세션 요약 (2026-08-01, 참여 설계 §1: 역할 규칙)

`docs/PARTICIPATION_DESIGN.md` §1(역할 규칙)만 구현. 반응·방명록(§2·§3)은 다음 단계.

- **share_links.kind 로 백엔드가 링크 권한 판단** (`60dbfbf`). 기존엔 프런트가 URL 패턴
  (`isContributionInviteUrl`, /join/ vs /s/)으로 추측 → 권한 판단이 프런트에 있었음.
  - migration `20260801100000_share_link_kind.sql`(+`_rollback`): `kind`('view'|'contribute')
    추가, DEFAULT 'contribute', 기존 backfill 'contribute'. **프로덕션 적용 완료**(기존 14행 contribute 확인).
  - `start_public_contribution`(/s/ 참여 세션 생성)에서 `kind='view'` → **403 거부**. view=열람만.
    tolerant 기본값(`share.get("kind") or "contribute"`)이라 컬럼 없거나 값 없어도 안전.
  - `create_share_link` 은 kind 를 **DB DEFAULT 에 위임**(insert 에 안 씀) → 마이그레이션
    적용 전/후 모두 링크 생성 안 깨짐. view 링크 생성은 감상-링크 UX(반응/방명록 단계)에서 추가.
  - 회귀 테스트: view 링크 참여 403, contribute 허용(`test_share_api.py`, backend 212).
- **"함께 만들기 시작" 버튼 제거·초대 시 자동 활성화·참여 중단 유지** (`5ba0783`).
  `CollaborationPanel` 에서 앞단계 버튼 삭제. 초대 링크 요청(`ensureInviteUrl`→rotate-invite)이
  collaboration 을 자동 활성화(+refresh). **"참여 중단" 버튼 추가**(`closeCollaborationAlbum`) —
  링크 오배포 시 되돌릴 수단 유지.
- 주의: /s/ 공유 링크는 현재도 kind='contribute'(기존 동작 유지). 설계상 /s/=감상(view)로의
  전환은 반응/방명록 UX 와 함께 하는 게 맞아 이번엔 안 함(참여 capability 회귀 방지).

## 이전 세션 요약 (2026-08-01, 제목 편집 UI 크기 축소)

- **제목 편집 UI 모바일 과대 크기 수정** (`f130624`). 카톡 웹뷰에서 편집 UI가 화면
  세로 ~1/3 차지(저장/취소가 `flex:1 1 auto` grow 로 각 ~45% 폭). 브라우저 실측으로 검증:
  - 저장/취소 `flex:0 0 auto`(내용 폭, grow 없음, min-height 40px 유지).
  - 입력창 `flex:1 1 7rem` 로 버튼과 **한 줄** 배치 → 편집 UI 높이 **93px→46px**(절반↓).
  - 편집 중 `subtitle` 숨김(`subtitle && !editing`), 입력 글자 `clamp(1.5rem,4vw,2.1rem)`(제목급).
  - **헤더 grid 열 `minmax(0,1fr)` clamp** — 기본 `auto` 열이 버튼 min-content 로 부풀어
    좁은 웹뷰에서 카드를 뚫던 오버플로의 근본 원인이었음(이전 세션 `73d28a7` 로도 안 잡힘).
  - 편집 플로우·비편집 모양·타 화면(AlbumResult/PublicShareView) 공유 불변. 회귀 테스트 갱신.

## 이전 세션 요약 (2026-08-01, 제목수정 레이아웃·성능 연구)

- **제목 수정 버튼 화면 밖 넘침 수정** (`73d28a7`). `AlbumScreenHeader` 편집기 입력창이
  `flex: 1 1 220px` 로 커지며 좁은 화면(카톡 웹뷰)에서 저장 버튼이 화면 밖으로 넘치고
  취소만 다음 줄에 놓였다. → 입력창을 한 줄 전체(`flex: 1 1 100%`)로, editor 에
  `max-width:100%` 추가해 저장·취소가 항상 다음 줄에 함께. 회귀 테스트 추가.
- **앨범 이미지/인증 지연 단축 (1차)** (`7bd5e8a`). Supabase origin preconnect 를
  `index.html` 에 추가(사진 서명 URL·토큰 갱신 커넥션 사전 워밍).

### 성능 — 진짜 원인은 리전 불일치였음 (해결 완료)

브라우저 실측(프로덕션, 한국)으로 원인 규명:
- 프로덕션은 Vercel 프록시가 아니라 **Railway(`momento-api-production.up.railway.app`)를 직접 호출.**
- Railway 는 슬립 안 함(상시 가동). **콜드스타트 아님.**
- `/health`(Korea→Railway)=205ms, `/health/storage`(→Supabase 왕복)=600ms →
  **Railway→Supabase 왕복이 ~400ms.** Railway=미국(iad), Supabase=싱가포르(ap-southeast-1) 라
  엔드포인트마다 Supabase 순차 왕복 5~6회 × 400ms ≈ `/albums/mine` 2.2초의 정체.

**조치: Railway 리전을 미국(iad) → 싱가포르(southeast-asia)로 이동** (Supabase 와 동일 리전).
`scale_service` 로 `{southeast-asia:1}` 설정 후 `{iad:0}` 로 미국 replica 제거.
주의: `scale_service` 는 map 을 **병합**한다(미지정 리전 유지). 미국 제거하려면 `{iad:0}` 명시 필요.
(중간에 잠깐 2 replica 상태였고, `us-east` 친화명은 iad 와 **다른** 리전이라 안 먹혔음 → `iad` 로 지정.)

**실측 결과(warm):** Railway→Supabase 왕복 400ms→~50ms, `/albums/mine` 2.2s→~0.5s(앱 첫 로드 3.7s→0.9s),
앨범 열기(getAlbum+photos 병렬) ~0.5~0.66s. **약 4~5배.** 단일 replica 유지라 추가 비용 없음.

남은 (선택) 최적화 — 급하지 않음:
- 각 엔드포인트가 Supabase 를 여전히 순차 5~6회 호출(now ~50ms 라 총 ~300ms). 병렬/배치로 더 줄일 여지.
- **#4 클라이언트 캐시(stale-while-revalidate)는 보류 결정.** 리전 이동으로 첫 열기가 이미 ~0.5s 라,
  협업 앨범 staleness·사용자별 캐시키 복잡성(단점)이 장점보다 커짐. 재방문이 여전히 느끼면 그때 재검토.
- `signed_url_ttl_seconds=300`(`app/config.py:51`)·preconnect(`index.html`, `7bd5e8a`)는 그대로.

## 이전 세션 요약 (2026-08-01, 실사용 테스트 4건 수정)

- **[1] 사진 선택 갯수 0장 표시** (`76e022e`). `UploadForm.addFiles` 가 리사이즈를
  다 끝낸 뒤 `setPhotos` 를 한 번만 호출해 준비 중엔 "30장 중 0장"으로 남았다.
  → 사진을 한 장씩 증분 `setPhotos` 해 선택 직후부터 실제 장수가 보인다.
- **[3] '이 사진을 준비하지 못했습니다' 누락** (`76e022e`). `optimizeImageFile` 이
  던지면 사진을 버렸다(안드로이드 갤러리 JPEG 등). `prepareForUpload` 추가 —
  최적화 실패 시 원본 파일로 폴백(10MB 이하면 그대로, 백엔드가 HEIC 포함 재인코딩),
  원본이 per-object 한도 초과일 때만 rethrow. EXIF 추출 실패도 사진 안 버리고
  `capturedAt=null` 로 진행. **사용자 데이터 손실 없음.**
- **[2] 로그인 참여자 사진/기억 클릭 무반응** (`44ac72e`, 최우선). `PublicShareView`
  `openContribution` 이 `if (authenticatedUser && !contributionSession) return;` 로
  클릭을 삼켰고, 세션 생성 effect 는 `토큰:사용자ID` 키로 한 번만 시도해 실패 시
  ref 가 설정된 채 재시도 경로가 없었다. → 클릭 의도를 `pendingContributionActionRef`
  에 기록+세션 (재)시작, 조용히 무시하는 경로 제거. 세션 키에 `contributionRetry`
  포함해 재시도 가능(영구 잠금 없음, 자동 루프 없음). 준비 중 상태 + 실패 시
  오류·"다시 시도" 노출. **게스트 경로 불변.**
- **[4] 미완성 앨범이 목록에 그대로 노출** (`19eccf0`). 확인 결과: `MyAlbums` 카드가
  이미 `status` 로 `/creating`(이어서 생성) 라우팅을 하므로 목록 포함은 **의도된 동작**
  (job 재개용). 다만 완성본과 시각 구분이 없어 혼란 소지 → 목록 쿼리·라우팅은 두고
  카드 제목 옆 상태 배지("생성 중"/"생성 실패")만 최소 추가.
- 회귀 테스트: `uploadPreparation.test.ts`, `publicShareContribution.test.ts`.

## 이전 세션 요약 (2026-08-01, 공유 페이지 로그인 모달 수정)

- **공유 페이지에서 로그인 모달이 안 뜨던 버그 수정 완료** (`58a5166`).
  공유 페이지(`/s/:token`, shareToken)에서 "로그인"을 누르면 body 스크롤만 잠기고
  모달은 안 뜨던 문제. 로그인 모달 JSX 가 마지막 Landing 분기 안에만 있었는데,
  스크롤 잠금 effect 는 `showLogin` 이면 어느 화면에서든 걸려 `ShareEntryRouter`
  분기에선 잠금만 되고 모달은 렌더 안 돼 화면이 멈춘 듯 보였다(ESC 로만 탈출).
  - 모달을 `loginModal` const 로 꺼내 앱 root(회원 탈퇴 모달 옆)에서 렌더 →
    `showLogin` 이면 어느 분기에서든 모달과 스크롤 잠금이 항상 함께 움직인다.
  - `.auth-modal` 은 `position:fixed; inset:0` 이라 위치 이동해도 모양 동일.
    접근성(ESC·포커스 트랩·포커스 복귀·스크롤 잠금 복원)·Landing 동작/모양 불변.
  - 회귀 테스트 `frontend/tests/shareLoginModal.test.ts` 추가. `App.tsx` blob 은
    깨끗한 LF 라 EOL 정규화 이슈 없음.

## 이전 세션 요약 (2026-08-01, PDF print 레이아웃 수정)

- **PDF print 레이아웃 수정 완료** (`349e0af`). lazy 로딩 수정 이후에도 남은
  "작게 배치·비율 왜곡·캡션 누락"을 **print 스코프**로 고침. 실제 PDF 픽셀 측정 기반.
  - **정사각 강제 제거**: `Grid6Block.css` print 셀의 `aspect-ratio:1`+`overflow:hidden`
    이 원인. html2canvas 는 object-fit 을 무시해 정사각 셀이 비정사각 사진을 찌그러뜨렸다
    (0.563/0.75 사진이 ~1.0 으로 측정됨). 박스를 사진 실제 비율(`width:100%; height:auto`)로
    두어 object-fit 을 no-op 화.
  - **캡션 노출**: 사진 아래 캡션이 정사각 `overflow:hidden` 셀에 잘려 PDF 에 안 나오던 것도
    같은 수정으로 해소(셀을 자연 높이로).
  - **1장 열 수 보정**: 날짜별 1장이 3열 그리드 왼쪽에 놓여 오른쪽 2/3 가 비던 문제.
    `grid6-block--n{count}` modifier 로 print 열 수 조정(n1=1열, n2=2열). n1 은 폭 제한
    (135mm)+가운데 정렬로 날짜 헤더와 맞추고 페이지 넘침 방지.
  - **페이지 잘림 대비**: `exportPdf` pagebreak.avoid 에 `.grid6-block__cell` 추가.
    기존 셀렉터(`.photo-block`/`.date-header`/`.album-epilogue`/`.album-cover`)는 실제 클래스와
    일치함을 확인(오탐 아님).
  - `layoutSelector`/`deterministicLayout` 은 print 전용 분기가 없고(회전만) 정상 — 미변경.
    screen/공유 레이아웃·html2canvas scale 미변경. 회귀 테스트 `albumPrintGridLayout.test.ts` 추가.
  - ⚠️ CRLF 주의: `Grid6Block.tsx` 원본 blob 이 깨진 `\r\r\n` EOL 이라 표준 EOL 로 정규화됨.
    실제 로직 변경은 `grid6-block--n{count}` 한 줄. (`git add -A` 아니라 파일 명시 커밋.)

## 이전 세션 요약 (2026-08-01, PDF 출력 품질 수정)

- **PDF 사진 왜곡·흐림 버그 수정 완료.**
  - (B) 뒤/아래 사진이 작고 흐리게 나오던 원인: 본문 사진(`AlbumPhotoFrame`)이
    `loading="lazy"` 기본값이라, PDF host(`left:-10000px`, 뷰포트 밖)에서는 브라우저가
    이미지 요청 자체를 안 해 html2canvas 가 빈 이미지를 캡처했다.
    → 렌더 모드 컨텍스트(`AlbumRenderModeContext`) 도입, print 에서는 `AlbumPhotoFrame`·
    Living Album 이미지를 모두 `eager`+`fetchPriority high` 로 강제. **화면(screen)은 lazy 유지.**
  - (A) 사진 비율 왜곡 원인: html2canvas 가 `object-fit` 을 무시하고 박스에 늘려 그린다.
    특히 Living Album 의 `aspect-ratio:1/1; object-fit:cover`(정사각 crop)가 찌그러졌다.
    → `.album-renderer--print .album-living-page__photos img` 에서 박스를 사진 실제 비율로
    두어(`aspect-ratio:auto; height:auto; object-fit:contain`) crop 대신 letterbox. **print 전용 스코프.**
  - 본문 프레임(`.album-photo-frame__img`)은 `height:auto; object-fit:contain` 이라 박스가 이미
    사진 비율과 같아 object-fit no-op → 왜곡 없음(변경 없이 확인만).
  - 로딩 정책은 순수 함수 `imageLoadingMode.ts`(`resolveImageLoading`/`resolveImageFetchPriority`)로
    분리해 단위 테스트. 회귀 테스트 `frontend/tests/albumPrintImageLoading.test.ts`(print eager / screen lazy).
  - 변경 파일: `AlbumPhotoFrame.tsx`, `AlbumRenderer.tsx`, `AlbumRenderer.css`,
    신규 `components/AlbumRenderModeContext.tsx`·`components/album/imageLoadingMode.ts`.
    **screen/공유 레이아웃은 불변.** print 경로에만 영향.

## 이전 세션 요약 (2026-08-01, PDF 저장 멈춤 수정)

- **PDF 저장 무한 멈춤 버그 수정 완료** (`8350b48`). "PDF 만드는 중..."에서 영구히
  멈추던 원인은 `waitForAlbumAssets`가 `document.fonts.ready`·이미지 load/error 를
  타임아웃 없이 무한 대기한 것. 이미지 요청이 pending 이면 promise 가 영원히
  resolve 안 돼 `handlePdf`의 `finally`도 안 돌아 버튼이 박혔다.
  - `waitForAlbumAssets`를 CSS·React 의존 없는 `src/album-engine/waitForAlbumAssets.ts`로
    분리(단위 테스트 가능), `AlbumRenderer`에서 재export 해 기존 import 경로 호환.
  - 전체 타임아웃(15s) + 이미지별 타임아웃(6s) + `fonts.ready` race(4s) 추가.
    이미지 한 장이 실패·미응답이어도 건너뛰고 PDF 생성을 계속한다. 무한 대기 없음.
  - `exportPdf.tsx`의 중복 `await document.fonts.ready`(상한 없음) 제거.
  - 회귀 테스트 `frontend/tests/albumAssetTimeout.test.ts` 추가.
  - **html2pdf 동적 import 는 원인이 아니라고 판단해 정적으로 되돌리지 않음**(코드 분할 유지,
    html2pdf 985KB 별도 청크). 화면 렌더러(onReady) 경로는 그대로 동작 확인.
- **로컬 main 을 origin/main 에 push 함** (`d278acc..8350b48`, 8커밋). 이전 세션의
  push 보류를 사용자 지시로 해제. Vercel(프론트)·Railway(백엔드) 자동 배포 트리거됨.
- ✅ **`20260801090000_account_withdrawal.sql` migration 은 프로덕션에 적용 완료.**
  프로덕션 Supabase 에서 `delete_profile_cascade` 함수 존재와 nullable+`ON DELETE SET NULL`
  컬럼 4/4 를 직접 확인함(2026-08-01). 회원 탈퇴 정상 동작 전제 충족.

## 저장소

- 경로: `D:\Momento` (Windows), 브랜치 `main`
- 이관 시점 최신 커밋: `df7b27c fix(auth): stabilize local OAuth flow and restore login callback`
- **로컬 main 커밋 정리 완료 (2026-08-01). `df7b27c` 포함 아래 커밋은 origin에 미반영:**
  - `ebcc050 chore: remove brand name generator tool (backend)`
  - `7e01b32 feat(account): 회원 탈퇴 및 데이터 삭제 (백엔드)`
  - `a1fdb5a fix(album): job 없는 legacy creating 앨범 무한 폴링 해소`
  - `9e584c5 feat(frontend): 전역 네비·인라인 참여·회원 탈퇴·번들 코드 분할`
  - `f237186 docs: track CLAUDE.md, HANDOVER, 약관 2종 (gitignore 예외 추가)`
- **`feature/withdrawal-and-nav` 브랜치를 origin에 push함** (`f237186`까지 포함).
  Vercel Preview용.
- brand 폴더(`backend/app/brand/`)의 추적 안 되던 `__pycache__`·`data/pool_cache.txt`
  잔여물까지 삭제 완료.
- **main 은 2026-08-01 세션에서 `8350b48`까지 origin 에 push 완료** (위 최신 세션 요약 참고).

### (해소됨) main push 보류 사유 — 배포 후 남은 위험

아래 두 가지 때문에 이전 세션은 main push 를 보류했으나, 사용자 지시로 push 를 진행했다.
push 후에도 다음 위험은 남아 있으니 반드시 챙긴다.

- 전역 하단 네비게이션·인라인 참여는 **화면 구조를 바꾸는 변경**인데
  카카오톡 인앱 웹뷰 QA 가 아직 안 됐다. → 실기기에서 확인.
- ~~`20260801090000_account_withdrawal.sql` migration 미적용~~ → **프로덕션 적용 완료 확인됨**
  (`delete_profile_cascade` + nullable/SET NULL 4/4). 회원 탈퇴 위험 해소.

## 스택 / 명령어

| 영역 | 스택 | 배포 |
| --- | --- | --- |
| Frontend | React 19 + Vite + TypeScript | Vercel (`momento-ashen-rho.vercel.app`) |
| Backend | FastAPI (Python) | Railway |
| DB/Storage | Supabase | - |
| AI | OpenAI `gpt-4o-mini` (내부 전용, Vision 기본 비활성) | - |

```
frontend:  npm run test:frontend   npm run build   npm run dev
backend:   python -m pytest -q     python -m compileall -q app
```

`pytest`는 `requirements.txt`에 없다. 새 환경에서는 `pip install pytest` 별도 실행.
(운영 배포에도 쓰이는 파일이라 의도적으로 추가하지 않음.)

## CRLF 주의

`core.autocrlf`가 설정돼 있지 않다. 리눅스 환경에서 `git status`를 보면 245개 파일이
수정된 것처럼 보이지만 전부 **CRLF/LF 줄바꿈 차이**다.

- 실제 변경 확인: `git diff --ignore-cr-at-eol --stat`
- **`git add -A` 금지.** 245개 파일이 줄바꿈만 바뀐 채로 커밋된다. 파일을 명시해서 add 한다.
- `.gitattributes` 도입(`* text=auto eol=lf`)은 245파일이 한 번에 바뀌므로 **출시 직후**에 한다.

---

# 미커밋 작업 목록

수정 17개 + 신규 6개.

## A. Codex에서 넘어온 진행 중 작업

1. **전역 하단 네비게이션** — `AlbumBottomNavigation`에 `variant="app"` 추가(처음으로/내 앨범/새 앨범/내 설정), 헤더 계정 메뉴를 전역 플로팅으로 이동, 외부 클릭·ESC 닫기
2. **앨범 화면 내 인라인 참여** — 사진/기억 추가 시 페이지 이동 대신 `ContributeWorkspace`를 그 자리에서 열고 `?action=photo|memory`로 history 관리. `momento:album-action` CustomEvent로 App ↔ AlbumView 연결
3. **CollaborationPanel 안정화** — `lib/requestAbort.ts`(신규)로 AbortError를 오류로 표시하지 않음, `refreshRequestId`로 응답 경쟁 방지, 대표사진 모달 접근성(ESC/포커스/스크롤 잠금)
4. **`api.ts` StrictMode dedupe 버그** — `getCollaborationStatus`에서 `signal`이 있으면 `dedupeRequest` 우회. StrictMode cleanup이 첫 signal을 abort하면 재마운트 시 죽은 promise를 공유하기 때문
5. **`AlbumStage.tsx`** — `selectAlbumPhotoUrl(photo, "screen")` 사용으로 display 파생본 우선
6. **backend `album.py`** — job 없는 legacy `creating` 앨범 무한 폴링 수정, retry가 job 새로 생성

### 되돌린 변경 (재발 금지)

`frontend/src/lib/imageUrls.ts` — 미커밋이던 fallback 순서 변경을 HEAD로 복구했다.

`screen`을 `display || thumbnail || original`로 바꾸면 display 파생본이 없는 레거시 사진이
원본 대신 **썸네일로 전체화면 렌더링**되어 화질이 저하된다. `albumRenderingRegression.test.ts`가
이 계약을 지킨다. `"thumbnail"` purpose는 `frontend/src` 어디에서도 쓰이지 않는다.

**원칙**: `screen = display → original → thumbnail` / `print = original 우선` / `thumbnail = thumbnail 우선`

## B. 계정 탈퇴·데이터 삭제 (P0, 신규)

**Migration**: `supabase/migrations/20260801090000_account_withdrawal.sql` — **프로덕션 적용 완료(2026-08-01 확인).**
`_rollback.sql`은 되돌릴 때만 쓰는 비상용 — 지금 실행하면 안 된다.

migration 내용: `album_story_inputs.author_profile_id`, `memory_answers.profile_id`,
`share_links.created_by`, `families.created_by` 를 nullable + `ON DELETE SET NULL` 로 변경하고
`delete_profile_cascade(uuid)` RPC 추가. 이 네 컬럼이 `NOT NULL + RESTRICT` 라 `profiles` 행을
지울 수 없었고, 그래서 `auth.users`(이메일·소셜 식별자) hard delete가 불가능했다.

탈퇴 순서 (`app/services/account_service.py`):

```
소유 앨범 삭제(Storage 포함) → 이름 텍스트 익명화 → 프로필 삭제 → auth.users hard delete
```

- 이름 익명화가 프로필 삭제보다 **먼저**인 이유: `album_contributors.display_name`,
  `photo_memories.author_name`은 참조가 아니라 이름 **복사본**이라 프로필을 지워도 남고,
  지운 뒤에는 profile id로 찾을 수도 없다.
- 소프트 삭제된 앨범도 포함해 조회한다 (`albums.created_by`가 RESTRICT라 하나라도 남으면 탈퇴가 영구히 막힘).
- 프로필 삭제 실패 시 auth 유저를 건드리지 않고 409. 재시도 가능.
- 타인 앨범에 남긴 사진·기억은 **작성자 표시만 제거하고 앨범에 남긴다.**

신규/수정: `backend/app/services/account_service.py`, `backend/app/api/auth.py`,
`backend/tests/test_account_deletion.py`, `frontend/src/lib/api.ts`(`deleteAccount`),
`frontend/src/App.tsx`+`App.css`(계정 메뉴 "회원 탈퇴" + 확인 모달)

## C. 약관 2종 (P0, 신규)

`docs/PRIVACY_POLICY.md`, `docs/TERMS_OF_SERVICE.md` — 코드 기준으로 작성한 **초안**. 공개 전 법무 검토 필수.

- EXIF **GPS 좌표를 저장**하므로 위치정보 수집 고지를 포함했다.
- OpenAI에는 **사진 이미지가 아니라 코멘트 텍스트 + 촬영일만** 전송된다
  (`enable_vision_analysis` 기본 False). Vision을 켜면 방침 개정 필요.
- `{{ }}` 항목(상호·대표자·주소·보호책임자·Supabase 리전 등)은 사업자 정보 확정 후 채운다.

## D. 번들 코드 분할 + 테스트 스크립트

- `html2pdf.js` → PDF 저장 클릭 시 `await import()`
- `AdminConsole` → `React.lazy` + `Suspense`. `parseAdminRoute`는 매 렌더 호출되므로
  `components/admin/adminRoute.ts`(신규)로 분리하고 AdminConsole에서 re-export(기존 import 호환)
- `package.json` → `"test:frontend": "tsx --test \"tests/**/*.test.ts\""`.
  이전에는 파일을 손으로 나열해 새 테스트가 조용히 누락됐다.

**결과**: 첫 화면 JS **1,594KB → 583KB (gzip 459KB → 166KB, 64% 감소)**.
html2pdf 985KB·AdminConsole 16KB는 별도 청크. 빌드 경고는 lazy 청크 때문이므로 무시해도 된다.

## E. brand 코드 제거 (파일 삭제 미완료)

브랜드 이름 생성기는 Momento 기능이 아니라 브랜드명을 찾으려고 임시로 만든 도구다. 별도 저장소로 분리한다.

코드 참조는 이미 제거됨(`main.py`의 router·`warm_brand_pool` startup hook, `App.tsx`의 `/brand` 경로).
**파일 삭제만 남았다.**

```powershell
git rm -r --quiet backend/app/brand
git rm --quiet backend/app/api/brand.py backend/app/models/brand_schemas.py `
              backend/tests/test_brand_api.py backend/tests/test_brand_quality.py `
              frontend/src/components/BrandFinder.tsx frontend/src/components/BrandFinder.css
```

`tests/test_brand_api.py` 2건 실패는 라우터가 이미 빠졌는데 테스트 파일이 남아서 나는 404다. 삭제되면 사라진다.

주의: `AlbumRenderer`의 `album-renderer__brand-footer`, `AlbumScreenHeader`의
`album-screen-header__brand`, `media_upload_service._bmff_brand`(MP4 포맷 brand)는
**무관하다. 건드리지 말 것.**

---

# 검증 결과 (2026-08-01, 최신 재확인)

`8350b48` 기준. 백엔드는 `backend/.venv` python으로 실행(시스템 `C:\Python313` 혼용 방지).

| 항목 | 결과 |
| --- | --- |
| `npm run test:frontend` | **62 passed / 0 failed** (PDF 타임아웃 회귀 3건 추가) |
| `npm run build` | 통과, 첫 화면 gzip 166KB, html2pdf 985KB 별도 청크 유지 |
| `.venv python -m pytest -q` | **210 passed / 0 failed** |

PDF 출력 품질 수정 세션 재확인: frontend **66 passed**, build 통과, backend **210 passed**.
PDF print 레이아웃 수정 세션 재확인: frontend **71 passed**, build 통과, backend **210 passed**.
공유 페이지 로그인 모달 수정 세션 재확인: frontend **75 passed**, build 통과, backend **210 passed**.
실사용 테스트 4건 수정 세션 재확인: frontend **84 passed**, build 통과, backend **210 passed**.
제목수정 레이아웃·성능 연구 세션 재확인: frontend **86 passed**, build 통과, backend **210 passed**.
제목 편집 UI 크기 축소 세션 재확인: frontend **90 passed**, build 통과, backend **210 passed**.
참여 설계 §1 세션 재확인: frontend **90 passed**, build 통과, backend **212 passed**(share kind 회귀 2건 추가).
참여 설계 §2(반응) 세션 재확인: frontend **95 passed**, build 통과, backend **214 passed**(반응 회귀 2건 추가).
참여 설계 §9(측정) 세션 재확인: frontend **95 passed**, build 통과, backend **217 passed**(계측 회귀 3건 추가).
참여 설계 §3(방명록) 세션 재확인: frontend **100 passed**, build 통과, backend **223 passed**(방명록 회귀 6건 추가).
참여 설계 §10(다녀간 사람 수) 세션 재확인: frontend **103 passed**, build 통과, backend **226 passed**(방문자 회귀 3건 추가).
회귀 3건(참여/PDF/아이콘) 세션 재확인: frontend **106 passed**, build 통과, backend **230 passed**(참여 실동작 회귀 추가).
PDF 페이지 경계 수정 세션 재확인: frontend **111 passed**, build 통과(백엔드 변경 없음). PDF 실렌더 프로덕션 실측 완료(straddler 0).

# 다음 할 일

1. ~~brand 파일 `git rm` → pytest 재실행~~ ✅ 완료 (`ebcc050`, backend 210 passed)
   - 프론트 `BrandFinder.tsx/.css` 삭제는 App.tsx `/brand` 라우트 제거와 함께 `9e584c5`에 포함.
2. ~~미커밋 변경을 의미 단위로 나눠 커밋~~ ✅ 완료 (5개 커밋). App.tsx가 A/B/D를
   동시에 건드려 프론트는 파일 단위 분리가 불가능해 하나의 프론트 커밋으로 묶음.
   문서 5종(gitignore 예외 + CLAUDE.md·HANDOVER·약관 2종)은 `f237186`로 별도 커밋.
3. ~~`feature/withdrawal-and-nav` push~~ ✅ 완료 (Vercel Preview용).
   ~~**main은 미push.**~~ → **main push 완료** (`8350b48`, 2026-08-01).
4. ~~Supabase에서 `20260801090000_account_withdrawal.sql` 실행~~ ✅ 프로덕션 적용 완료 확인(2026-08-01).
5. **수동 QA** — 자동 테스트가 못 잡는 것들 (프로덕션에서)
   - 회원 탈퇴 (실제 Supabase에서)
   - PDF 저장 (멈춤 없이 완료 + 사진 비율 정상 + 1장 날짜가 폭을 채우는지 + 사진 아래 캡션 노출 + 페이지 경계 안 잘림)
   - `/admin` 진입 (lazy + Suspense)
   - **카카오톡 인앱 웹뷰**에서 하단 네비게이션·앨범 내 인라인 사진·기억 추가
7. `docs/LAUNCH_CHECKLIST.md` P0: migration `20260727090000_social_auth_profiles.sql`,
   Kakao/Naver Provider 콘솔 설정 + Redirect URL, Vercel/Railway 환경변수, 실기기 검증
8. 약관 `{{ }}` 채우고 법무 검토 → 프런트에 링크 노출
9. (출시 직후) `.gitattributes` 도입

# 출시 후로 미룬 리팩터링

- `backend/app/api/album.py` 2,108줄 분할
- `frontend/src/lib/api.ts` 780줄, `AlbumView.tsx` 689줄
- `App.tsx`의 1,000자짜리 한 줄 JSX

# 참고 문서 (`docs/`)

`PRODUCT_BACKLOG.md`(무엇을 만들지) / `LAUNCH_CHECKLIST.md`(배포 설정 완료 여부) /
`KNOWN_ISSUES.md` / `BUG_LOG.md` / `OPERATIONS.md` / `SOCIAL_AUTH_SETUP.md` /
`STORAGE_ARCHITECTURE.md` / `CODEBASE_RISK_AUDIT.md`
