# Momento 작업 인수인계 (2026-08-01)

Codex → Claude Code 이관 세션 기록. 이어서 작업하는 세션은 이 문서부터 읽는다.
개발 원칙은 저장소 루트의 `CLAUDE.md`를 따른다.

## 최신 세션 요약 (2026-08-01, PDF 출력 품질 수정)

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
   - PDF 저장 (멈춤 없이 완료되는지 + 뒤/아래 사진이 선명하고 비율이 맞는지)
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
