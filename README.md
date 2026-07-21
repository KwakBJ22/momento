# Momento MVP

카카오톡 웹뷰 기반 모임 사진·스토리 앨범 생성 서비스

## 구조

- **Frontend**: React (Vite + TypeScript) → Vercel (`https://momento-ashen-rho.vercel.app`)
- **Backend**: FastAPI (Python) → Railway
- **Database/Storage**: Supabase
- **AI**: OpenAI `gpt-4o-mini`

## 로컬 실행

### 1. Supabase

`supabase/schema.sql`을 SQL Editor에서 실행

### 2. Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
# .env: Supabase, OpenAI, CORS_ORIGINS, FRONTEND_BASE_URL
uvicorn app.main:app --reload --port 8000
```

### 3. Frontend

```powershell
cd frontend
npm install
copy .env.example .env
# .env: VITE_API_BASE_URL=http://localhost:8000
npm run dev
```

http://localhost:5173

---

## 배포 & 환경변수

### 환경변수 요약

| 위치 | 변수 | 값 (예시) |
|------|------|-----------|
| **frontend `.env`** (로컬) | `VITE_API_BASE_URL` | `http://localhost:8000` |
| **frontend `.env`** (로컬/배포) | `VITE_SUPABASE_URL` | Supabase Project URL |
| **frontend `.env`** (로컬/배포) | `VITE_SUPABASE_ANON_KEY` | Supabase anon publishable key |
| **frontend `.env`** (로컬) | `VITE_KAKAO_JS_KEY` | 카카오 JS 키 |
| **Vercel** (프로덕션) | `MOMENTO_API_URL` | `https://xxx.up.railway.app` |
| **Vercel** (프로덕션) | `VITE_KAKAO_JS_KEY` | 카카오 JS 키 |
| **Railway** (백엔드) | `CORS_ORIGINS` | `http://localhost:5173,https://momento-ashen-rho.vercel.app` |
| **Railway** (백엔드) | `FRONTEND_BASE_URL` | `https://momento-ashen-rho.vercel.app` |

### API 연결 방식

- **로컬**: `VITE_API_BASE_URL=http://localhost:8000` → 백엔드 직접 호출
- **Vercel 프로덕션**: `VITE_API_BASE_URL` 비움 → 같은 origin `/api/*` → Vercel 서버리스 프록시 → `MOMENTO_API_URL`

공유 링크 `https://momento-ashen-rho.vercel.app/album/{id}` 가 동작하려면 **Vercel에 `MOMENTO_API_URL`이 Railway 백엔드 URL로 설정**되어 있어야 합니다.

### Supabase Auth

- 프런트는 이메일 매직링크 로그인에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`가 필요하다. 예시는 `frontend/.env.example`을 참고한다.
- Supabase Dashboard → Authentication → URL Configuration의 Redirect URLs에 로컬 주소와 배포 주소(예: `http://localhost:5173`, `https://momento-ashen-rho.vercel.app`)를 등록한다.
- DB migration 적용 후 새 로그인 사용자는 `profiles`, 기본 `families`, `family_members(owner)`가 자동으로 생성된다.

### Private Storage

- `20260712180000_private_storage_album_photos.sql` 적용 후 새 원본과 썸네일은 private `momento-private` 버킷에 저장된다.
- `momento-private`에는 브라우저 직접 접근 정책을 추가하지 않는다. 원본/썸네일은 인증된 소유자에게 백엔드가 짧은 만료 signed URL로만 제공한다.
- 기존 public `albums` 버킷은 기존 공유 앨범 결과 이미지 호환을 위해 유지한다.

### Railway 백엔드 배포

1. [Railway](https://railway.app)에서 New Project → Deploy from GitHub (또는 CLI)
2. Root Directory: `backend`
3. 환경변수 설정 (`backend/.env.example` 참고)
4. 배포 후 공개 URL 확인 (예: `https://momento-production.up.railway.app`)

### Vercel 프론트 연결 (Railway 배포 후)

```powershell
cd frontend
.\scripts\setup-vercel-backend.ps1 -BackendUrl "https://YOUR-APP.up.railway.app"
vercel --prod
```

또는 Vercel Dashboard → Settings → Environment Variables:

- `MOMENTO_API_URL` = Railway 백엔드 URL (Production, Preview)
- `VITE_KAKAO_JS_KEY` = 카카오 JS 키 (이미 설정됨)

### 카카오

[카카오 개발자](https://developers.kakao.com) → 플랫폼(Web)에 `https://momento-ashen-rho.vercel.app` 등록

---

## API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/upload-album` | 앨범 생성 |
| GET | `/api/albums/{id}` | 앨범 조회 (공유 페이지) |
| PATCH | `/api/albums/{id}` | 이야기 수정 |
