# Momento 작업 인수인계 (2026-08-01)

Codex → Claude Code 이관 세션 기록. 이어서 작업하는 세션은 이 문서부터 읽는다.
개발 원칙은 저장소 루트의 `CLAUDE.md`를 따른다.

## 저장소

- 경로: `D:\Momento` (Windows), 브랜치 `main`
- 이관 시점 최신 커밋: `df7b27c fix(auth): stabilize local OAuth flow and restore login callback`
- **미커밋 작업은 아래 4개 커밋으로 정리됨 (2026-08-01, 로컬 main, 아직 push 안 함):**
  - `ebcc050 chore: remove brand name generator tool (backend)`
  - `7e01b32 feat(account): 회원 탈퇴 및 데이터 삭제 (백엔드)`
  - `a1fdb5a fix(album): job 없는 legacy creating 앨범 무한 폴링 해소`
  - `9e584c5 feat(frontend): 전역 네비·인라인 참여·회원 탈퇴·번들 코드 분할`

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

**Migration 필요**: `supabase/migrations/20260801090000_account_withdrawal.sql` 을 Supabase SQL Editor에서 실행.
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

# 검증 결과 (2026-08-01)

| 항목 | 결과 |
| --- | --- |
| `npm run test:frontend` | **59 passed / 0 failed** |
| `npm run build` | 통과, 첫 화면 gzip 166KB |
| `python -m pytest -q` | **228 passed / 2 failed** (brand 테스트 파일만, 삭제 대기) |

# 다음 할 일

1. ~~brand 파일 `git rm` → pytest 재실행~~ ✅ 완료 (`ebcc050`, backend 210 passed)
   - 프론트 `BrandFinder.tsx/.css` 삭제는 App.tsx `/brand` 라우트 제거와 함께 `9e584c5`에 포함.
2. ~~미커밋 변경을 의미 단위로 나눠 커밋~~ ✅ 완료 (위 4개 커밋). App.tsx가 A/B/D를
   동시에 건드려 프론트는 파일 단위 분리가 불가능해 하나의 프론트 커밋으로 묶음. **아직 push 안 함.**
3. Supabase에서 `20260801090000_account_withdrawal.sql` 실행
4. **수동 QA** — 자동 테스트가 못 잡는 것들
   - 회원 탈퇴 (migration 적용 후, 실제 Supabase에서)
   - PDF 저장 (html2pdf 지연 로딩 후 첫 클릭)
   - `/admin` 진입 (lazy + Suspense)
   - 하단 네비게이션, 앨범 내 인라인 사진·기억 추가
5. `docs/LAUNCH_CHECKLIST.md` P0: migration `20260727090000_social_auth_profiles.sql`,
   Kakao/Naver Provider 콘솔 설정 + Redirect URL, Vercel/Railway 환경변수, 실기기 검증
6. 약관 `{{ }}` 채우고 법무 검토 → 프런트에 링크 노출
7. (출시 직후) `.gitattributes` 도입

# 출시 후로 미룬 리팩터링

- `backend/app/api/album.py` 2,108줄 분할
- `frontend/src/lib/api.ts` 780줄, `AlbumView.tsx` 689줄
- `App.tsx`의 1,000자짜리 한 줄 JSX

# 참고 문서 (`docs/`)

`PRODUCT_BACKLOG.md`(무엇을 만들지) / `LAUNCH_CHECKLIST.md`(배포 설정 완료 여부) /
`KNOWN_ISSUES.md` / `BUG_LOG.md` / `OPERATIONS.md` / `SOCIAL_AUTH_SETUP.md` /
`STORAGE_ARCHITECTURE.md` / `CODEBASE_RISK_AUDIT.md`
