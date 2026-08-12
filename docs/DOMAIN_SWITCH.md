# 도메인 연결 (woorialbum.com)

작성 2026-08-09 · **개정 2026-08-10 (3차 — 이전 완료. 실제로 걸렸던 것을 기록)**
**PO 작업.** 시범운영 전에 끝낸다.

도메인은 확보됨. 네임서버는 `ns.gabia.co.kr`(가비아).
2026-08-10 확인: `woorialbum.com` 은 **아직 안 뜬다**(이름 풀이 실패).

★ **네임서버는 가비아에 그대로 둔다.** Vercel 네임서버로 옮기면 전파가 오래 걸리고,
가비아에 있는 다른 레코드(메일 등)까지 함께 옮겨야 한다. **레코드만 추가한다.**

---

## ★ 정본 주소는 `woorialbum.com` (www 없음)

둘 다 열리게 하되 **하나로 모은다.** 주소가 둘이면 공유 링크가 갈리고,
카카오·Supabase 에 등록할 것도 두 배가 된다.

```
woorialbum.com          ← 정본. 모든 링크가 이 주소로 나간다
www.woorialbum.com      → woorialbum.com 으로 넘긴다 (Vercel 이 해준다)
```

J-13(PDF 주소에서 `www` 빼기)이 같은 결정이다. `frontend/src/lib/brand.ts` 의
`BRAND_SITE_URL` 도 `www.woorialbum.com` → `woorialbum.com` 으로 바꾼다.

---

## ★ 순서를 지킨다 — 이 순서가 아니면 링크가 죽는다

```
1  Vercel 에 도메인 추가
2  가비아 DNS 레코드 추가
3  Vercel 이 Valid 로 바뀔 때까지 기다린다        ← 여기까지는 아무것도 안 깨진다
─────────────────────────────────────────────
4  카카오 · Supabase 에 새 주소 등록
5  Railway CORS_ORIGINS 에 새 주소 추가
6  Railway FRONTEND_BASE_URL 을 새 주소로 바꾼다   ← 반드시 3·4·5 다음
```

★ **6번을 먼저 하면 안 된다.** `FRONTEND_BASE_URL` 이 공유 링크·초대 링크를 만드는
자리라, 아직 안 뜨는 주소로 바꾸면 **그 사이에 보낸 링크가 전부 죽은 링크가 된다.**

---

## 1. Vercel 에 도메인 추가

프로젝트 → Settings → Domains

- `woorialbum.com` 추가
- `www.woorialbum.com` 추가 → **Redirect to `woorialbum.com`** 으로 지정

Vercel 이 **넣어야 할 값을 화면에 보여준다.** ★ **그 값을 그대로 쓴다.**
IP 를 인터넷에서 찾아 넣지 않는다. Vercel 이 대역을 바꾼 적이 있다.

## 2. 가비아 DNS 에 레코드 추가

DNS 관리 → 레코드 추가

| 호스트 | 타입 | 값 |
| --- | --- | --- |
| `@` | **A** | **Vercel 화면이 알려준 IP** |
| `www` | **CNAME** | **Vercel 화면이 알려준 값** (보통 `cname.vercel-dns.com`) |

★ apex(`@`)에는 CNAME 을 넣을 수 없다. A 레코드를 쓴다.
★ 가비아는 CNAME 값 끝에 `.` 을 요구할 수 있다. 화면 안내를 따른다.

Vercel 화면에서 **Valid** 로 바뀔 때까지 기다린다(보통 10분 ~ 2시간).
**Valid 가 되기 전에는 4번 이후로 넘어가지 않는다.**

---

## 3. 카카오 개발자 콘솔 — 안 하면 로그인이 깨진다

- 앱 설정 → 플랫폼 → Web → **사이트 도메인**에 `https://woorialbum.com` 추가
- 카카오 로그인 → **Redirect URI** 에도 추가
  (지금 등록돼 있는 것과 **같은 모양**으로 쓴다. 경로까지 똑같이.)

★ **앱을 새로 만들지 않는다.** 카카오 회원번호는 앱마다 달라서, 앱을 바꾸면
**기존 사용자 전원의 연결이 끊긴다.** 2026-08-06 에 실제로 일어났고,
지금도 한 계정에 회원번호가 둘 붙어 있다(`5025495165` · `5010497815`).
이메일이 같아서 합쳐진 것이고, **이메일 없는 카카오 계정은 안 합쳐진다.**

★ **기존 등록을 지우지 않는다.** 옛 주소로 들어오는 사람이 아직 있다.

## 4. Supabase — Authentication → URL Configuration

- **Site URL** — `https://woorialbum.com`
- **Redirect URLs** — `https://woorialbum.com/**` 추가
  ★ 기존 `momento-ashen-rho.vercel.app` 줄을 **지우지 않는다.**

---

## 5. Railway (`momento` 프로젝트 → `momento-api`) — ★ 여기가 제일 중요하다

Variables 에서 둘을 만진다. 2026-08-10 에 이름을 확인했다.

| 변수 | 지금 | 바꿀 것 |
| --- | --- | --- |
| `CORS_ORIGINS` | 옛 주소 | **새 주소를 추가한다** (옛 주소를 지우지 않는다) |
| `FRONTEND_BASE_URL` | `https://momento-ashen-rho.vercel.app` | `https://woorialbum.com` |

### `FRONTEND_BASE_URL` 이 무엇을 만드는가

서버가 **모든 링크를 이 값으로 만든다.** 코드에서 확인한 자리 다섯이다.

```
album.py:786 · 1008     공유 링크        /s/<token>
share.py:119            공유 링크        /s/<token>
collaboration.py:104    함께 만들기 초대  /join/<token>
family.py:180           가족 초대        /invite/<token>
```

★ **이걸 안 바꾸면**, 새 주소에서 공유해도 카카오톡으로 나가는 링크는 **옛 주소**다.
★ **이미 나간 링크는 안 바뀐다.** 그래서 옛 주소를 계속 살려 둬야 한다.

### `CORS_ORIGINS`

코드에 기본값 셋이 박혀 있다(`config.py`). 이건 그대로 두고 **환경변수로 더한다.**

```
http://localhost:5173 · http://127.0.0.1:5173 · https://momento-ashen-rho.vercel.app
```

여기에 `https://woorialbum.com` 을 더한다.
`www` 는 Vercel 이 넘겨주므로 브라우저에 남는 주소는 정본 하나다 — 안 넣어도 된다.
넣어서 나쁠 것은 없다.

## 6. Vercel 환경변수 확인

- `WOORIALBUM_API_URL` 이 **Production · Preview · Development 셋 다**에 있는지 본다.
  `frontend/api/[...path].ts` 가 이 이름을 읽는다(K-1 에서 개명했다).
- 옛 `MOMENTO_API_URL` 세 줄은 **새 주소가 확인된 뒤에** 지운다.

---

## 7. 기존 주소를 지우지 않는다

★ `momento-ashen-rho.vercel.app` 을 **지우지 않는다.** 그 주소로 들어오는 사람이 있고,
카카오톡 대화방에 그 주소로 된 링크가 남아 있다. **대화방 메시지는 지워지지 않는다.**

둘 다 열리게 두고, 시범운영이 안정된 뒤에 정리한다.
지운 링크가 어떻게 보이는지는 J-9 문구가 맡는다.

---

## 8. 확인 (순서대로)

```
□ woorialbum.com 이 열린다
□ www.woorialbum.com 이 woorialbum.com 으로 넘어간다
□ 새 주소에서 카카오 로그인이 된다              ← 가장 중요
□ 새 주소에서 앨범을 만들 수 있다 (CORS)
□ 새 주소에서 만든 공유 링크가 woorialbum.com 으로 나온다
□ 그 링크를 카카오톡으로 보내 다른 폰에서 열린다
□ 새 주소에서 만든 초대 링크로 참여가 된다
□ 기존 vercel.app 주소가 여전히 열린다
□ 기존 vercel.app 에서 로그인도 여전히 된다
```

★ 마지막 둘을 꼭 본다. **옛 주소를 깨뜨리면 이미 나간 링크가 전부 죽는다.**

---

## 9. 코드에서 바꿀 것 (J-13 과 함께)

```
frontend/src/lib/brand.ts   BRAND_SITE_URL
  "www.woorialbum.com"  →  "woorialbum.com"
```

PDF 마지막 장에 찍히는 주소다. **도메인이 Valid 된 뒤에** 바꾼다.

---

## 10. 안 하는 것

- 네임서버를 Vercel 로 옮기지 않는다.
- 카카오 앱을 새로 만들지 않는다.
- 옛 주소·옛 등록을 지우지 않는다.
- 이메일(MX) 레코드를 건드리지 않는다. 가비아에 있는 것을 그대로 둔다.

---

## 11. ★ 이전 완료 (2026-08-10) — 실제로 걸렸던 것 셋

DNS·Vercel·Supabase 는 안내대로 한 번에 됐다. **막힌 것은 아래 셋이고, 셋 다 안내에 없었다.**

### ① Railway 는 변수를 저장해도 **배포가 따로다**

`FRONTEND_BASE_URL` · `CORS_ORIGINS` 를 화면에서 고쳤는데 값이 그대로였다.
Railway 는 변경을 **staged** 상태로 두고 `Deploy` 를 눌러야 반영한다.

증상은 이렇게 보인다 — 앨범 만들기에서 `업로드 실패했습니다`.

```
Railway 로그
  OPTIONS /api/upload-album  400   ← 허용 목록에 없는 주소라 미리 거절
  (변수 반영 뒤)
  OPTIONS /api/upload-album  200
```

★ **Deployments 목록에 새 줄이 생겼는지로 확인한다.** 변수 화면만 보면 속는다.
★ 이때 "PC 에서는 되고 폰에서는 안 된다"로 오해하기 쉽다. 기기와 무관하다.

### ② 카카오 공유는 **JavaScript 키가 가리키는 앱**을 본다

공유를 누르면 `요청 실패 · Error Code 4019`.

앱이 둘 있었고(`Momento` 비즈앱 · `Momento-TEST`), 도메인을 **다른 앱에** 넣고 있었다.
공유가 검사하는 것은 `VITE_KAKAO_JS_KEY` 가 가리키는 앱의
**[플랫폼] → [Web] → 사이트 도메인** 목록이다.

```
살아 있는 앱 찾는 법
  Supabase → Authentication → Providers → Kakao → Client ID (= REST API 키)
  이 값과 일치하는 앱이 계정이 붙어 있는 앱이다
  그 앱의 JavaScript 키가 VITE_KAKAO_JS_KEY 와 같아야 한다
```

★ **`www` 도 따로 넣는다.** 카카오는 `www` 를 다른 주소로 본다.
★ 끝에 `/` 를 붙이지 않는다. `https://` 를 빼지 않는다.
★ **Supabase 의 Client ID 는 절대 바꾸지 않는다** — 기존 계정이 전부 끊긴다.
★ 안 쓰는 앱(`Momento-TEST`)을 **지우지 않았다.** BJ 계정에 카카오 회원번호가
  둘 붙어 있어(`5025495165` · `5010497815`) 어느 쪽이 무엇에 쓰였는지 확실하지 않다.

### ③ 카카오톡 메시지 아래 이름은 **앱 이름**이다

공유 카드 하단에 `Momento` 가 그대로 나왔다. 우리 코드가 보내는 값이 아니다.

```
[앱] → [일반] → [앱 기본 정보]
  앱 아이콘 · 앱 이름 · 회사명 · 카테고리 · 앱 대표 도메인
```

이 이름은 **카카오 로그인 동의 화면 · 연결된 서비스 관리 · 카카오톡 메시지** 세 곳에 나온다.
하나 바꾸면 셋이 같이 바뀐다. 비즈앱이어도 수정에 제약이 없다.

### 최종 상태

```
✓ woorialbum.com → Vercel (216.198.79.1) · www 는 apex 로 넘김
✓ Supabase Site URL / Redirect URLs
✓ Railway FRONTEND_BASE_URL = https://woorialbum.com
✓ Railway CORS_ORIGINS = woorialbum.com · www · 옛 vercel.app · localhost
✓ 카카오 사이트 도메인 · 앱 이름(우리앨범) · 앱 대표 도메인
✓ 초대 링크가 woorialbum.com/join/... 으로 나오는 것 확인
```

옛 `momento-ashen-rho.vercel.app` 은 살아 있다. 되돌릴 자리가 필요해서 남겨 둔다.
