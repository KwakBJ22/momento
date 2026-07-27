# Momento 출시 체크리스트

이 문서는 **실제 환경에서 완료 여부**를 체크한다. 빈 체크박스는 아직 확인되지 않은 항목이며, 코드·자동 테스트 완료와 운영 설정 완료를 혼동하지 않는다.

## 배포 정보

| 항목 | 값/기록 |
| --- | --- |
| 운영 웹 URL | `https://momento-ashen-rho.vercel.app` |
| 로컬 웹 URL | `http://localhost:5173` |
| OAuth 프런트 콜백 | `{origin}/auth/callback` |
| Supabase Provider callback | `https://<project-ref>.supabase.co/auth/v1/callback` |
| 배포 일시·커밋 |  |
| 검증 담당자 |  |

## 개발 완료 확인

- [x] 프런트 `npm run test:frontend` 통과
- [x] 프런트 `npm run build` 통과
- [x] 백엔드 `python -m pytest -q` 통과
- [x] 백엔드 `python -m compileall -q app` 통과
- [x] `git diff --check` 통과
- [x] 카카오·네이버 OAuth UI와 `/auth/callback` 코드 구현
- [x] 로그인한 사용자 기준 앨범 생성·내 앨범 조회 구현
- [x] 공개 앨범 열람·익명 참여 회귀 테스트 통과

## Supabase

- [ ] `20260727090000_social_auth_profiles.sql` migration 적용
- [ ] Authentication > URL Configuration Site URL을 운영 웹 URL로 설정
- [ ] Redirect URLs에 `https://momento-ashen-rho.vercel.app/auth/callback` 추가
- [ ] Redirect URLs에 `http://localhost:5173/auth/callback` 추가
- [ ] Authentication > Providers > Kakao 활성화
- [ ] Authentication > Providers에서 Custom OAuth Provider identifier가 정확히 `naver`인지 확인
- [ ] Kakao/Naver provider 저장 후 callback URI가 표시되는지 확인

## Kakao Developers

- [ ] 웹 플랫폼 도메인에 `https://momento-ashen-rho.vercel.app` 등록
- [ ] 개발 도메인에 `http://localhost:5173` 등록(개발 시)
- [ ] Redirect URI에 **Supabase Provider callback** `https://<project-ref>.supabase.co/auth/v1/callback` 등록
- [ ] Kakao REST API Key와 Client Secret을 **Supabase > Authentication > Providers > Kakao**에 입력
- [ ] REST API Key/Client Secret 실제 값이 Git·Vercel·Railway에 기록되지 않았는지 확인

## Naver Developers

- [ ] Naver 로그인 Callback URL에 **Supabase Provider callback** `https://<project-ref>.supabase.co/auth/v1/callback` 등록
- [ ] Naver Client ID와 Client Secret을 **Supabase > Authentication > Providers > Custom OAuth Provider (`naver`)**에 입력
- [ ] Supabase Custom Provider authorization/token/user-info endpoint와 사용자 정보 매핑을 확인
- [ ] identifier가 `naver`이고 앱 코드의 내부 provider가 `custom:naver`로 시작되는지 확인

## Vercel

- [ ] Root Directory가 `frontend`인지 확인
- [ ] `VITE_SUPABASE_URL` 설정
- [ ] `VITE_SUPABASE_ANON_KEY` 설정
- [ ] 필요 시 `VITE_API_BASE_URL`이 운영 API를 가리키는지 확인
- [ ] `/auth/callback`이 SPA rewrite로 정상 열리는지 확인

## Railway

- [ ] Root Directory가 `backend`인지 확인
- [ ] `SUPABASE_URL` 설정
- [ ] `SUPABASE_SERVICE_ROLE_KEY` 설정
- [ ] `SUPABASE_STORAGE_BUCKET=albums` 확인
- [ ] `SUPABASE_PRIVATE_STORAGE_BUCKET=momento-private` 확인
- [ ] `CORS_ORIGINS`에 로컬·운영 웹 URL 포함
- [ ] `FRONTEND_BASE_URL=https://momento-ashen-rho.vercel.app` 확인
- [ ] `ENABLE_VISION_ANALYSIS=false` 확인
- [ ] `GET /health`, `GET /health/storage` 확인

## 실기기·브라우저 검증

- [ ] Chrome: 카카오 로그인 → 원래 화면 복귀 → 앨범 생성 → 내 앨범 확인
- [ ] Safari: 네이버 로그인 → 새로고침 후 세션 유지 → 로그아웃 확인
- [ ] KakaoTalk 인앱브라우저: 카카오 로그인과 `/auth/callback` 복귀 확인
- [ ] 로그인 취소·실패 시 원래 화면으로 정상 복귀
- [ ] 로그아웃 후 `/my-albums` 직접 접근이 차단되는지 확인
- [ ] 공개 공유 링크가 로그인 없이 열리는지 확인
- [ ] 익명 참여 사진·기억 추가가 유지되는지 확인
- [ ] PDF 생성·다운로드와 공개 공유 확인

## 공개 전 법무·운영

- [ ] 개인정보처리방침 공개
- [ ] 이용약관 공개
- [ ] 계정 탈퇴·데이터 삭제 정책과 지원 경로 확정
- [ ] 장애 대응 담당자·롤백 커밋 기록

소셜 로그인과 콘솔 설정은 실기기에서 성공하기 전까지 완료로 표시하지 않는다. 설정 방법은 `SOCIAL_AUTH_SETUP.md`, 향후 기능은 `PRODUCT_BACKLOG.md`에서 관리한다.
