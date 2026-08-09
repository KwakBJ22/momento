# K그룹 작업 큐 — 데이터가 0인 지금만 할 수 있는 것

작성 2026-08-09. **앨범·사진·참여자가 전부 0건인 상태에서 시작한다.**

**규칙** — J-QUEUE 와 같다.

1. **위에서 아래로 한 건씩.** 한 건이 끝나면 커밋·푸시·보고하고 **멈춘다.**
2. 시작 전에 `docs/SCREEN_SPEC.md`(**19차**)를 읽는다. 보고에 **§몇**을 적는다.
3. 문서와 다르게 해야 한다고 판단되면 고치지 말고 **보고**한다.
4. 제목 옆에 `[완료 <커밋해시>]` 를 적는다.
5. ★ **브라우저에서 치수를 재지 않는다.** 값은 큐가 준다. (시간·개수는 재도 된다)
6. ★ 항목 크기 — **작음**(테스트 없음) / **보통**(테스트 한 건) / **큼**(조사 먼저)

---

## ★★ 이 큐를 하는 동안 지킬 것

- ★ **앨범을 만들지 않는다.** PO 도 만들지 않는다.
  중간 상태에서 만든 앨범은 옛 버킷·옛 키에 남아 창이 닫힌다.
- ★ **K-1 은 세 커밋으로 나눈다.** 한 번에 몰지 않는다. 깨지면 어디서 깨졌는지 알아야 한다.
- ★ **되돌리기 어려운 작업이다.** 각 커밋 뒤에 실제로 앨범 하나를 만들어 보고
  사진 업로드 → PDF → 카카오 로그인까지 확인하고 다음으로 간다.
  (확인용 앨범은 다음 커밋 전에 지운다)

---

## K-1. 🔴 `Momento` 이름을 전부 바꾼다 (J-14 전면판) — **크기: 큼**

데이터가 0건이라 지금은 **바꿔도 아무도 잃지 않는다.**
사진이 한 장이라도 쌓이면 버킷은 **영원히 못 바꾼다.**

### K-1-a. DB 트리거 기본 이름 + 개발자 문자열 [완료 005e189]

- `Momento 사용자` → **`우리앨범 사용자`**
  네 개 migration 에 흩어져 있다. **새 migration 하나로 덮는다.** 옛 파일은 고치지 않는다.
- `console.debug("[Momento] …")` · `console.warn` 15곳 → `[우리앨범]`
- 주석의 `Momento` (예: `tokens.css` 의 `Momento 디자인 토큰`)

### K-1-b. localStorage 키 + HTTP 헤더 [완료 80b9ca7]

```
momento-*  · momento_*   →  woorialbum-* · woorialbum_*
X-Momento-*              →  X-Woorialbum-*
```

- ★ **빠짐없이 한 커밋에서.** 프런트와 백엔드가 같은 커밋이어야 한다(§11).
  하나라도 남으면 요청이 조용히 실패한다.
- ★ **옛 키를 읽어 옮기는 코드를 만들지 않는다.** 남은 사용자가 없다.
  그런 코드는 영원히 안 지워진다.
- 배포 사이 몇 분간 요청이 깨질 수 있다. **그 시간에 아무도 쓰지 않는다.**

### K-1-c. Storage 버킷 — **마지막에 따로**

- 새 버킷 **`woorialbum-private`** (비공개) 생성
- Storage 접근 정책을 옛 버킷과 **같게** 만든다
- Railway 환경변수 **`SUPABASE_STORAGE_BUCKET`** 교체
- 옛 버킷 **둘 다** 삭제 — `momento-private`(파일 218개, 전부 고아) · `albums`(빈 껍데기)
- ★ 코드에 버킷 이름이 박힌 곳이 있는지 확인한다. 기본값
  (`config.py:20 supabase_private_storage_bucket`)도 새 이름으로.

### 회귀 테스트

- ★ 소스 어디에도 `momento` 가 남지 않을 것 (대소문자 무시, 주석 포함)
  단 옛 migration 파일은 예외 — **이력이라 고치지 않는다**
- 새 계정의 기본 표시 이름이 `우리앨범 사용자` 일 것

### 끝나고 확인 (PO)

앨범 하나 만들기 → 사진 5장 → 캡션 → PDF → 카카오 로그아웃/로그인 → 앨범 지우기

---

## K-2. 🔴 FK 를 `CASCADE` 로 — **크기: 큼**

`albums` 를 가리키는 자식 17개 중 **8개가 `RESTRICT`** 이고 의존이 **두 겹**이다.

```
memory_answers → memory_questions → album_media → albums
guest_memory_submissions → share_links → albums
```

그래서 삭제 RPC 가 **순서를 손으로 알고 있어야 한다.**
2026-08-09 에 PO 가 앨범을 지우려다 두 번 막혔고, 나(문서 쪽)도 순서를 두 번 틀렸다.

★ **DB 가 알려주지 않으면 사람은 반드시 틀린다.**
새 자식 테이블이 하나 얹히고 RPC 에 안 들어가면, **그 순간부터 프로덕션에서
앨범 삭제가 조용히 실패한다.** 테스트로도 안 잡힌다.

### 고칠 것

- `albums` 를 가리키는 `RESTRICT` 여덟을 **`ON DELETE CASCADE`** 로.
  `album_media` · `album_members` · `album_photos` · `album_story_inputs` ·
  `guest_album_sessions` · `guest_memory_submissions` · `memory_questions` · `share_links`
- 자식들끼리의 `RESTRICT` 도 같이 — `memory_answers → memory_questions`,
  `memory_questions → album_media`, `guest_memory_submissions → share_links`,
  `photo_memories → album_contributors`
- ★ **`SET NULL` 은 그대로 둔다** — `analytics_events` · `ai_usage_logs`.
  통계는 앨범이 사라져도 남아야 한다.
- ★ **RPC 의 손 열거를 지운다.** DB 가 하는 일을 코드가 또 하지 않는다.

### ★ 확인해서 보고할 것

- 지금 RPC(`delete_album_cascade`)가 위 여덟을 **다 지우는가?** 하나라도 빠져 있으면
  그것이 이미 결함이다.
- CASCADE 로 바꾼 뒤 **RPC 가 하는 일이 남아 있는가?** 없으면 RPC 를 지울지 보고한다.
  (권한 검사는 API 가 이미 한다)

### 회귀 테스트

- ★ 앨범 하나를 지우면 **자식이 전부 사라질 것** — 여덟 테이블 모두
- ★ `analytics_events` · `ai_usage_logs` 는 **남고 `album_id` 만 비워질 것**
- ★ 코드에 삭제 순서를 손으로 적은 곳이 없을 것

---

## K-3. Storage 파일이 DB 와 따로 논다 — **크기: 큼**

삭제 RPC 주석에 이렇게 적혀 있다.

> Storage objects are deliberately not handled here: the API collects their
> paths before this transaction, then removes them as a best-effort cleanup.

그래서 **API 를 타지 않는 삭제는 파일을 남긴다.** 주인 없는 게스트 앨범이 정확히 그 경우다.
2026-08-09 현재 옛 버킷에 **고아 파일 218개**가 있다(K-1-c 에서 버킷째 지운다).

### ★ 먼저 확인해서 보고할 것

- Storage 와 DB 를 **한 트랜잭션으로 묶을 수 있는가?**
  ★ 아마 못 묶는다(Storage 는 별도 서비스다). 못 묶으면 **묶으려 하지 말고**
  "지우고 남으면 나중에 줍는다"로 간다. 그게 현실적이다.

### 고칠 것

- **고아 파일을 찾는 조회**를 `docs/DATA_CHECKS.md` 에 넣는다
  (`storage.objects` 에는 있는데 `album_photos` 에는 없는 경로).
- **줍는 작업**을 이미 있는 운영 스크립트(`app/operations_cli.py` · `docs/OPERATIONS.md`)에
  얹는다. 새 구조를 만들지 않는다.
- ★ **처음에는 지우지 말고 세기만 한다.** 며칠 숫자를 보고 나서 삭제를 켠다.
  조건이 틀리면 **지우고 나서** 안다(§9).

---

## K-4. `album_bookmarks.album_id` 에 인덱스 — **크기: 작음**

`담아둔 앨범`은 `내 앨범`을 열 때마다 조회한다. 인덱스가 없다.

- FK 인덱스가 없는 컬럼이 16개인데 **나머지 15개는 죽은 테이블이거나
  `created_by`·`invited_by` 같은 저빈도**다. 이 하나만 넣는다.
- ★ **회귀 테스트를 만들지 않는다.**

---

## K-5. 남은 옛 설계를 기록만 한다 — **크기: 작음**

★ **고치지 않는다.** 전부 동작하는 코드다(§4 — 동작하는 코드를 다시 쓰지 않는다).
지금 걷으면 출시가 밀리고 새 결함이 난다. **시범운영에서 무엇을 실제로 쓰는지 본 뒤**가 싸다.

`docs/DB_NOTES.md` 를 만들어 아래를 적는다. 다음 사람이 "이거 왜 둘이지"에서
시간을 안 쓰게 하는 것이 목적이다.

### 같은 개념이 두 벌

| 옛 것 | 지금 쓰는 것 | 비고 |
| --- | --- | --- |
| `album_members` (참조 10곳) | `album_contributors` (26곳) | §1 이 "`album_members` 의 owner 행은 판정에 쓰지 않는다"고 이미 우회 중 |
| `album_media` (9곳) | `album_photos` (36곳) | |
| `families` · `family_members` · `family_invitations` | §1 의 역할 셋 | `authorization.py` 에 `family_role` 과 `album_role` 이 나란히 있다 |

★ **판정 근거가 여럿인 것이 이 제품의 반복 결함 원인**이다(H-1 · J-8 이 모두 여기서 났다).
새 기능을 얹을 때 **옛 쪽에 넣지 않는다.**

### 죽은 것으로 보이는 테이블

`guest_memory_submissions`(코드 참조 0) · `families`(0) ·
`memory_questions` · `memory_answers`(초기 질문 흐름의 잔재)

★ **지우지 않는다.** 지우려면 먼저 정말 안 쓰는지 확인해야 하고, 그건 지금 할 일이 아니다.

### 괜찮은 것 (확인함 2026-08-09)

- **RLS 가 전 테이블에 켜져 있고 대부분 정책이 0개** = 아무도 직접 못 읽는다.
  백엔드(service role)만 통과한다. §10 과 일치한다. **문이 하나다.**
- 핵심 일곱 테이블의 모델은 §7 의 세 계층을 그대로 담고 있다.
- 인덱스는 K-4 하나 말고는 문제 없다.

---

## 이 큐가 끝난 뒤 — J-QUEUE 로 돌아간다

```
J-10  내 앨범 썸네일이 느리다            보통
J-11  앨범 아래 빈 박스                  보통
J-12  🔴 참여자가 더한 것을 담는 규칙      큼
J-13  PDF 주소 www 제거                  작음
J-15  🔴 게스트 앨범 수명 (14일)          큼
```

★ **J-15 는 K-3 이 끝난 뒤에 한다.** 게스트 앨범을 지우려면 파일도 지워야 하는데,
그 방법이 K-3 에서 정해진다.
