# Momento 소셜 로그인 설정

Momento는 Supabase Auth 세션을 사용하며, 프런트는 항상 `{origin}/auth/callback`으로 돌아옵니다. 이메일 Magic Link와 OTP는 사용하지 않습니다.

## 공통 Supabase 설정

1. Supabase Authentication URL Configuration의 Site URL을 운영 URL로 설정합니다.
2. Redirect URLs에 다음을 추가합니다.
   - `https://momento-ashen-rho.vercel.app/auth/callback`
   - `http://localhost:5173/auth/callback`
3. Vercel 환경 변수에 기존 Supabase 공개 설정을 넣습니다.
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

`redirectTo`는 클라이언트에서 현재 origin의 `/auth/callback`으로 고정합니다. OAuth client secret은 Vercel이나 Railway 환경 변수에 넣지 않고 Supabase Provider 설정에만 저장합니다.

## 카카오

1. Kakao Developers에서 웹 플랫폼 도메인에 운영 URL과 로컬 개발 URL을 등록합니다.
2. Redirect URI에는 Supabase가 제공하는 `https://<project-ref>.supabase.co/auth/v1/callback`을 등록합니다.
3. Supabase Dashboard의 Authentication > Providers > Kakao를 켜고 Kakao REST API Key와 Client Secret을 입력합니다.
4. 앱에서 `signIn("kakao")`을 호출하면 Supabase Kakao OAuth가 시작됩니다.

## 네이버

Supabase의 Custom OAuth Provider를 사용합니다. Authentication > Providers에서 Custom OAuth Provider를 만들고 identifier를 `naver`로 설정합니다. 프런트는 `custom:naver` provider로 로그인합니다.

1. Naver Developers에 Supabase가 표시하는 callback URI를 등록합니다.
2. Supabase Custom OAuth Provider에 Naver Client ID/Secret과 OAuth endpoints를 설정합니다.
   - Authorization: `https://nid.naver.com/oauth2.0/authorize`
   - Token: `https://nid.naver.com/oauth2.0/token`
   - User info: `https://openapi.naver.com/v1/nid/me`
3. 사용자 정보 매핑에 id, nickname 또는 name, profile_image, email, mobile을 연결합니다.
4. 앱에서 `signIn("naver")`을 호출하면 Supabase Custom OAuth가 시작됩니다.

## 프로필과 배포

`20260727090000_social_auth_profiles.sql` migration을 OAuth Provider 활성화 전에 적용합니다. 신규 계정은 auth user metadata로 profiles 초기값을 만들고, 이미 사용자가 정한 표시 이름은 다음 로그인에서 덮어쓰지 않습니다.

KakaoTalk 인앱 브라우저도 동일한 callback URL을 사용합니다. 실제 기기에서는 Kakao/Naver 개발자 콘솔의 웹 도메인, Supabase Redirect URL, Vercel 운영 도메인이 모두 정확히 일치하는지 확인합니다.

## 인증 경계

화면 컴포넌트는 `frontend/src/services/authService.ts`의 `signIn`, `signOut`, `getCurrentUser`, `getSession`, `onAuthStateChange`만 사용합니다. `AppUser`는 `id`, `displayName`, `avatarUrl`, `email`, `phone`, `provider`만 노출합니다.

- `signIn("kakao")` → Supabase `kakao`
- `signIn("naver")` → Supabase Custom OAuth `custom:naver`

`custom:naver`, Supabase `User`, `Session`, metadata, identities 해석은 모두 authService 내부에만 있습니다. 백엔드는 `backend/app/services/auth.py`에서 JWT를 검증해 `CurrentUser`로 바꾼 뒤, 앨범·공유·PDF 업무 서비스에는 `user_id`만 전달합니다.

## Supabase 직접 의존 파일

### 인증·연결 경계

- `frontend/src/lib/supabase.ts` — 브라우저 Supabase client 생성
- `frontend/src/services/authService.ts` — OAuth, 세션, AppUser 변환
- `backend/app/config.py` — Supabase URL/service-role/bucket 설정
- `backend/app/services/auth.py` — Bearer JWT 검증과 CurrentUser 변환
- `backend/app/services/supabase.py` — 서버 client 생성, 앨범 DB/Storage 공통 접근
- `backend/app/services/storage_service.py` — Supabase Storage provider

### PostgreSQL·Storage 계약을 사용하는 업무 코드

- API: `backend/app/api/album.py`, `collaboration.py`, `family.py`, `memory.py`, `share.py`, `admin.py`
- 서비스: `membership.py`, `authorization.py`, `collaboration_service.py`, `share_service.py`, `question_service.py`, `event_logger.py`, `operations_service.py`, `analytics_service.py`, `media_analysis_service.py`, admin 서비스
- AI 기록: `backend/app/ai/ai_service.py`, `question_service.py`, `story_service.py`, `usage_repository.py`, `vision_service.py`
- 운영: `backend/app/main.py`, `backend/app/operations_cli.py`
- 스키마: `supabase/schema.sql`, `supabase/migrations/*.sql`

프런트의 앨범·프로필 업무는 모두 백엔드 API를 통해서만 접근하며, 프런트에서 Supabase DB 테이블을 직접 조회하지 않습니다.

## 향후 교체 범위

인증 서비스를 교체할 때는 `frontend/src/lib/supabase.ts`, `frontend/src/services/authService.ts`, `AuthCallback.tsx`, `backend/app/services/auth.py`, `backend/app/models/current_user.py`를 우선 수정합니다. UI와 앨범 업무 서비스는 `AppUser`/`CurrentUser.id` 계약을 유지합니다.

DB를 PostgreSQL/MySQL 등으로 교체할 때는 `backend/app/services/supabase.py`, Storage provider, 위 업무 서비스의 DB 호출, `backend/app/config.py`, migration/운영 명령을 교체합니다. API 응답 계약과 프런트 호출은 유지합니다. 범용 Repository 계층은 도입하지 않습니다.

## 계정 연결 정책

카카오와 네이버가 같은 이메일을 반환해도 이메일만으로 계정을 자동 병합하지 않습니다. Supabase Auth identity가 다르면 별도 계정이며, 자동 연결은 계정 탈취 위험 때문에 제공하지 않습니다. 기존 앨범은 `albums.owner_id = auth user id` 기준으로만 조회됩니다.

## URL과 callback 구분

아래 두 URL은 역할이 다르므로 서로 바꾸어 등록하지 않습니다.

| 등록 위치 | 값 | 용도 |
| --- | --- | --- |
| Supabase Authentication > URL Configuration > Redirect URLs | `https://momento-ashen-rho.vercel.app/auth/callback` | 운영 브라우저가 OAuth 완료 후 돌아오는 프런트 주소 |
| Supabase Authentication > URL Configuration > Redirect URLs | `http://localhost:5173/auth/callback` | 로컬 개발 프런트 주소 |
| Kakao Developers > Redirect URI | `https://<project-ref>.supabase.co/auth/v1/callback` | Kakao가 Supabase OAuth 처리기로 돌아오는 주소 |
| Naver Developers > Callback URL | `https://<project-ref>.supabase.co/auth/v1/callback` | Naver가 Supabase Custom OAuth 처리기로 돌아오는 주소 |

`<project-ref>`는 추정하지 말고 Supabase Dashboard의 해당 Provider 화면에서 표시되는 callback URI를 그대로 복사합니다. 앱은 `window.location.origin/auth/callback`을 `redirectTo`로 사용합니다.

## Provider 콘솔 입력 위치

### Kakao

1. Kakao Developers에서 REST API Key와 Client Secret을 발급합니다.
2. 값을 **Supabase Dashboard > Authentication > Providers > Kakao**의 Client ID/Client Secret 입력란에 넣습니다.
3. Kakao Developers에는 웹 플랫폼 도메인과 Supabase Provider callback만 등록합니다. Client Secret을 프런트 환경 변수에 넣지 않습니다.

### Naver

1. Naver Developers에서 Client ID와 Client Secret을 발급합니다.
2. **Supabase Dashboard > Authentication > Providers > Custom OAuth Provider**를 열어 identifier가 정확히 `naver`인지 확인합니다.
3. 같은 화면의 Client ID/Client Secret 및 Naver OAuth endpoints/user-info mapping을 입력합니다.
4. 앱은 `signIn("naver")`만 사용하며, authService가 내부적으로 `custom:naver`로 변환합니다.

## 로그인 실패 점검 순서

1. 브라우저 주소가 운영 또는 로컬 `/auth/callback`으로 끝나는지 확인합니다.
2. 해당 프런트 callback URL이 Supabase Redirect URLs에 등록되어 있는지 확인합니다.
3. Kakao/Naver Developers에 등록한 값이 **Supabase Provider callback**인지 확인합니다.
4. Kakao Provider가 활성화되어 있고, Naver Custom Provider identifier가 `naver`인지 확인합니다.
5. Provider client secret이 Supabase에만 저장되어 있고 만료·오입력이 없는지 확인합니다.
6. Vercel의 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`와 Railway의 `SUPABASE_URL`이 같은 Supabase 프로젝트를 가리키는지 확인합니다.
7. KakaoTalk 인앱브라우저에서는 등록된 운영 도메인으로 재시도하고, 브라우저 콘솔·Supabase Auth 로그의 redirect 오류를 확인합니다.
