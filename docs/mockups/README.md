# Handoff: 앨범 화면 개편 — 소유자 확정안 2a + 참여자 3a

## Overview

Woorialbum(코드베이스명 Momento)의 **앨범 화면 = 완성된 앨범 보기 화면** 개편안이다. 소유자 시점과 참여자(초대받아 사진·한마디를 더한 사람) 시점 둘을 담았다.
가장 큰 변경은 **하단 고정 메뉴를 4칸 → 3칸으로 줄이고, "앨범 만들기"를 헤더의 "더보기" 시트로 옮긴 것**이다.
그 외에 (a) 미완성 상태(한마디 없는 사진)를 제목 아래 안내로 드러내고, (b) 흩어져 있던 공유/함께 만들기/PDF/삭제 동작을 두 개의 바텀시트(공유하기 · 더보기)로 정리했다.
참여자 화면은 소유자에서 버튼을 빼는 대신 **"나는 지금 무엇에 참여하고 있나"** 를 알려주는 요소 3개(초대 띠 · 내가 더한 것 · 나도 한마디 남기기)로 그 자리를 채운다.

대상 사용자는 **40대 이후, 카카오톡 웹뷰, 390px 세로 화면**이다. 노안을 전제하므로 라벨 14px 하한, 터치 영역 44px 하한을 반드시 지킨다.

## About the Design Files

이 폴더의 HTML 두 개는 **HTML로 만든 디자인 참고물(design reference)** 이다. 프로덕션 코드가 아니다.
목표는 이 HTML을 그대로 복붙하는 것이 아니라, **기존 코드베이스(React + Vite + TypeScript, CSS 파일 per 컴포넌트)의 패턴대로 다시 구현**하는 것이다.

- `album-detail-owner.html` — 소유자: 앨범 화면 / 공유하기 시트 / 더보기 시트
- `album-detail-participant.html` — 참여자: 앨범 화면 / 더보기 시트 / 초대 문구 3갈래 규칙 카드

두 파일은 **같은 클래스·토큰 체계**를 쓴다. 참여자 파일에만 있는 클래스는 `.whoami`(초대 띠), `.mine`(내가 더한 것), `.addmine`(나도 한마디), `.list__row--off`(비활성 행), `.absent`(여기에 없는 것), `.spec`(문서용 규칙 카드 — 구현 대상 아님)이다.

- 색·간격·둥글기·그림자·글자 크기는 **반드시 `frontend/src/styles/tokens.css` 의 CSS 변수로** 쓴다. HTML 안의 `:root` 블록은 그 토큰을 그대로 복사해 넣은 것이며(참고용), **CSS에 hex를 직접 쓰지 않는다** (DESIGN_SYSTEM.md §8).
- 아이콘은 `lucide-react`만 쓴다. HTML의 아이콘은 사각형/선 플레이스홀더이며, 주석에 대응 lucide 이름을 적어 두었다.
- 사진은 그라데이션 플레이스홀더다. 실제 사진(signed URL)로 교체한다.
- 390px 프레임(`.frame`)은 시안용 껍데기다. 구현에는 없다.

## Fidelity

**High-fidelity (hifi).** 색·글자 크기·간격·터치 영역·문구가 모두 확정값이다. 픽셀 단위로 맞춘다.
단, 정적 시안이므로 애니메이션·전환은 정의되어 있지 않다 (아래 "Interactions" 참조 — 기본적으로 넣지 않는다).

## Screens / Views

### 1. 앨범 화면 (소유자) — `data-screen-label="앨범 화면 (소유자)"`

**Purpose**: 완성된 앨범을 보고, 부족한 부분을 채우고, 가족에게 공유한다.

**Layout**: 세로 flex 3단. `헤더(고정) / 본문(스크롤) / 하단 메뉴(고정)`. 본문 좌우 패딩 20px.

**Components**

| 요소 | 값 |
| --- | --- |
| 헤더 | `padding:14px 20px 12px`, 하단 1px 구분선(옅은 선 `#f0e4e1` — `--c-border`보다 약함), 배경 `--c-bg` |
| 로고 락업 | "우리" `#1a1f2b` + "앨범" `--c-brand` / 19px / 800 / letter-spacing -.02em. 아래 "woorialbum" 11px / 600 / letter-spacing .08em / `#8a8f98`. **실제 심볼 SVG가 있으면 텍스트 대신 심볼+워드마크로 교체** |
| 헤더 우측 | "내 앨범" 텍스트 버튼(14px/600/`--c-brand-text`, min-height 44px) + **"더보기"** 버튼(1px `--c-border`, radius `--r-md`, 14px/600/`--c-text`, 44×44 이상, 좌우 패딩 12px) |
| 앨범 제목 블록 | 패딩 `24px 0 8px`, 중앙 정렬, gap 8px. 제목 행은 `flex-wrap:wrap` + `min-width:0` + `word-break:keep-all` (웹폰트 실패 시 줄바꿈 허용) |
| 앨범 제목 | 32px(`--t-2xl`) / 800 / line-height 1.3 / letter-spacing -.03em / `--c-text` |
| 제목 수정 버튼 | 44×44 원형, 1px `--c-border`, 라벨 "수정" 14px/600/`--c-brand-text`. **제목 편집은 여기서만** (더보기 시트에 중복 항목을 만들지 않는다) |
| 앨범 메타 | "사진 12장 · 함께 만든 사람 3명" 16px / 400 / 1.6 / `--c-text-muted` |
| **미완성 안내** | `margin-top:12px`, `padding:12px 14px`, 1px `--c-border`, radius `--r-md`, 배경 `--c-bg-soft`. 좌측 22×22 원(2px `--c-warning` 테두리, 아이콘 자리 — lucide 사용 시 `CircleAlert` 22 권장), 텍스트 15px/500/1.5/`--c-text-soft`, "채우러 가기"만 `--c-brand-text` 700. 한마디 없는 사진이 **0장이면 렌더하지 않는다** |
| 섹션 구분선 | 1px `--c-border-strong`, `margin-top:20px` |
| 월/날짜 헤더 | 패딩 `22px 0 12px`, 중앙. 월 19px/800/1.3/`--c-text`, 날짜줄 14px/600/1.4/`--c-text-muted`, 형식 `2018.07.08 · 사진 2장` |
| 사진 | 가로 full-width, radius `--r-sm`(8px), `overflow:hidden`. 비율은 원본 유지(세로/가로/정사각 섞임). 사진 위 오버레이·그라데이션 금지 |
| 캡션 | 사진 아래 `margin-top:12px`. 16px/500/1.6/`--c-text`. 작성자 이름은 앞에 `--c-text-subtle` 500으로. **최대 2줄, 넘치면 `-webkit-line-clamp:2`**. **카드·테두리·그림자·배경색 금지** |
| 사진 블록 간격 | `.photoblock + .photoblock { margin-top:26px }` |
| **하단 메뉴 (3칸)** | `display:grid; grid-template-columns:repeat(3,1fr)`, 상단 1px `--c-border`, 배경 `rgba(255,253,251,.98)`, 칸 높이 76px(최소). 라벨 **15px/600**, 아이콘 24px, gap 5px |
| 하단 메뉴 항목 | ① 사진 추가 (lucide `ImagePlus` 24) ② 한마디 쓰기 (`PencilLine` 24) ③ **공유하기** (`Share2` 24) — ③만 배경 `--c-brand-soft` + 글자 `--c-brand-text` + 800 |

> 390px에서 3칸 = 칸당 130px. 기존 4칸(97px)에서 라벨이 잘리거나 15px로 못 올렸던 문제가 해소된다.
> 기존 코드의 `--c-brand-soft` 강조는 "앨범 만들기"에 붙어 있었다 → **공유하기로 이동**한다.

### 2. 공유하기 시트 (소유자만) — `data-screen-label="공유하기 시트"`

**Purpose**: 보기 전용으로 보내기 / 함께 만들기로 초대 / 링크 복사.

- 배경막 `rgba(61,53,48,.5)`. 시트: `--c-surface`, radius `18px 18px 0 0`, 그림자 `--sh-lg`, 화면 하단 고정.
- 시트 헤더: `padding:18px 20px`, 하단 1px `--c-border-strong`. 제목 19px/800. 우측 "닫기" 16px/600/`--c-brand-text`, min-height 44px.
- 시트 본문: `padding:16px 20px 24px`, flex column, gap 12px.
  1. **카카오톡으로 보내기** — 배경 `--c-kakao`, 글자 `--c-kakao-text`, 56px, radius `--r-md`, 17px/800
  2. 보조 문구 "받은 사람은 보기만 할 수 있어요" 14px/400/`--c-text-muted`, 중앙
  3. 옅은 구분선 1px `#f0e4e1`
  4. **함께 만들기 카드** — 1px `--c-border`, radius `--r-lg`, 패딩 16px, gap 10px. 제목 17px/800 / 설명 15px/400/1.6/`--c-text-soft` / 버튼 "사진·한마디 받기" 배경 `--c-brand-action`, 흰 글자, 56px, hover `--c-brand-action-hover` / 하단 "지금 N명이 함께 만들고 있어요" 14px/`--c-text-muted`
  5. **링크 복사** — secondary(흰 배경 + 1px `--c-border`), 52px, 16px/600
- **"종이 앨범으로 주문하기"는 넣지 않는다** (아직 상품이 없음). PDF도 이 시트에 없다 → 더보기 시트로.
- 한 시트에 primary는 하나. 카카오 버튼은 브랜드 규정 예외.

### 3. 더보기 시트 (소유자) — `data-screen-label="더보기 시트"`

**Purpose**: 자주 쓰지 않는 앨범 단위 동작.

목록 행: min-height 60px, 좌측 라벨 17px/600/`--c-text`, 우측 현재값 14px/400/`--c-text-muted`, 행 사이 1px `#f0e4e1`(마지막 행 없음).

| 순서 | 라벨 | 우측 보조값 |
| --- | --- | --- |
| 1 | 표지 사진 바꾸기 | 지금 <표지 사진 설명> |
| 2 | 함께 만든 사람 | N명 |
| 3 | 파일로 저장하기 (PDF) | — (가드 시 비활성 — §PDF 가드) |
| 4 | 새 앨범 만들기 | 이 앨범은 그대로 있어요 |
| 5 | 이 앨범 지우기 | — (라벨색 `--c-danger`, 배경 채우지 않음) |

그 아래 안전 문구: "지우기 전에 한 번 더 물어봐요. 실수로 지워지지 않아요." 14px/400/1.6/`--c-text-soft`.

- **"제목 고치기" 항목은 없다.** 제목 옆 "수정" 버튼과 중복되므로 의도적으로 제외했다.
- "새 앨범 만들기"는 기존 하단 메뉴 4번째 칸에서 여기로 이동. 이 앨범이 사라지지 않는다는 문구를 반드시 함께 표시.

---

### 4. 앨범 화면 (참여자) — `data-screen-label="앨범 화면 (참여자)"`

**Purpose**: 초대받아 참여한 사람이 앨범을 보고, 자기 사진과 한마디를 더한다.

**소유자와 다른 점**

| 항목 | 참여자 |
| --- | --- |
| 공유하기 | **없음** |
| 앨범 지우기 | **없음** (내가 더한 사진·한마디는 내가 지울 수 있다) |
| 표지 바꾸기 · 제목 고치기 | **없음** (제목 옆 "수정" 버튼도 렌더하지 않는다) |
| "내 앨범" 헤더 링크 | 없음. 헤더 우측은 "더보기" 하나 |
| 사진 추가 · 한마디 쓰기 | 있음 |
| 파일로 저장하기 (PDF) | 있음 (가드 조건은 소유자와 동일) |
| 하단 메뉴 3번째 칸 | 공유하기 → **앨범 처음으로**(맨 위로, lucide `ArrowUp` 24) |
| 하단 메뉴 강조 | ①**사진 추가**에 `--c-brand-soft` + `--c-brand-text` + 800 (참여자의 주 동작) |

> 칸 수와 위치는 소유자와 같게 유지한다. 같은 자리에 다른 개수가 나오면 다시 배우게 된다.

**빈 자리를 채우는 요소 3개** (버튼을 빼면 화면이 휑해지는 문제의 해법)

| 요소 | 값 |
| --- | --- |
| **초대 띠** `.whoami` | `margin-top:16px`, `padding:12px 14px`, **1px `--c-brand`** + 배경 `--c-brand-soft`, radius `--r-md`. 좌측 36×36 원형 아바타(1px `--c-border`), 텍스트 15px/500/1.5/`--c-text`, 강조어만 800. 문안은 §"초대 문구 — 앞칸 × 뒤칸". 앞칸은 `.whoami__lead`로 1줄 ellipsis |
| **내가 더한 것** `.mine` | `margin-top:8px`, `padding:14px`, 1px `--c-border`, radius `--r-md`. 제목 "내가 더한 것" 16px/800, 수치 "사진 4장 · 한마디 3개" 15px/400/`--c-text-soft`. **버튼 없음 — 숫자만** (모아보기 화면이 아직 없어 죽은 버튼을 만들지 않는다) |
| **나도 한마디 남기기** `.addmine` | 캡션 아래 `margin-top:8px`. 15px/600/`--c-brand-text`, 배경·테두리 없는 텍스트 버튼. 내가 아직 한마디를 안 쓴 사진에만 렌더 |

앨범 제목 블록은 소유자와 같으나 **수정 버튼이 없고** 패딩은 `20px 0 8px`(초대 띠가 위에 오므로 소폭 축소). 메타는 "사진 34장 · 함께한 사람 4명".

### 5. 더보기 시트 (참여자) — `data-screen-label="더보기 시트 (참여자)"`

| 순서 | 라벨 | 우측 보조값 |
| --- | --- | --- |
| 1 | 함께한 사람 | N명 |
| 2 | 파일로 저장하기 (PDF) | 가드 시 비활성 (§PDF 가드) |
| 3 | 내 앨범 만들기 | 이 앨범은 그대로 있어요 |

그 아래 **"여기에 없는 것"** 블록(`.absent`, `padding:14px`, 1px `--c-border`, radius `--r-md`, 배경 `--c-bg-soft`):
제목 15px/800, 본문 15px/400/1.6/`--c-text-soft` —
"제목·표지 바꾸기, 공유하기, 앨범 지우기는 **앨범을 만든 사람**만 할 수 있어요. 내가 더한 사진과 한마디는 내가 지울 수 있어요."

> 없는 기능을 조용히 감추지 않는다. 참여자가 "내 화면이 고장 났나" 의심하지 않게 이유를 적고, **내 것만은 되돌릴 수 있음**을 함께 알린다.
> **"내가 부른 이름 바꾸기" 항목은 넣지 않는다** — 해당 API가 없고 백엔드 신규 작업이 필요하다.

### 초대 문구 — 앞칸 × 뒤칸

프로덕션 실측: `relationship`은 참여자 4명 중 1명만 채워져 있고, 소유자 `display_name`이 `kbjkwak`.

문장은 **서로 독립인 두 칸**으로 만든다. 하나의 조건으로 묶으면 “관계는 있는데 소유자 이름만 아이디”인 경우에 이미 갖고 있는 관계 정보(“가족”)가 버려진다. 두 칸을 따로 판정하면 화면 종류는 그대로인데 모든 조합이 맞는다.

| 칸 | 조건 | 문안 |
| --- | --- | --- |
| **앞** | 소유자 이름을 쓸 수 있음 | `{소유자}님이 만든 앨범에` |
| **앞** | 쓸 수 없음(아이디 판정) 또는 값 없음 | `'{앨범 제목}'에` |
| **뒤** | relationship 있음 | `{관계} {내 이름}로 함께하고 있어요` |
| **뒤** | relationship 없음 | `{내 이름}로 함께하고 있어요` |
| **뒤** | 내 이름도 없음 | `함께하고 있어요` |

실측 최빈 조합(= 시안 프레임): 앞칸 없음 × 뒤칸 이름만 → `'우리의 추억'에 / 영희로 함께하고 있어요`

- 관계 자리를 임의로 "가족"으로 채워 넣지 않는다.
- **앞칸의 앨범 제목은 한 줄로 자르고 `…` 처리**한다(`overflow:hidden; text-overflow:ellipsis; white-space:nowrap`, 부모에 `min-width:0`). 제목이 길면 띠가 두 줄 넘게 번진다.
- 표기: **"함께하고"** — 참여한다는 뜻이므로 붙여 쓴다. ("함께 하고" 아님)
- 뒤칸만 남는 경우에도 띠 자체는 그대로 렌더한다(문장만 짧아진다).

**"아이디" 판정**

- **주 조건**: `display_name`이 계정 이메일의 `@` 앞부분과 같으면 아이디로 본다. 실측 `kbjkwak` = `kbjkwak@gmail.com`의 앞부분 — 진짜 원인이 이것이다.
- **보조 조건**: 값에 `@`가 있거나, 숫자만으로 되어 있으면 아이디.
- **"한글이 없으면 아이디"로 보지 않는다** — Jenny·Minji 같은 실제 영문 이름이 걸린다.
- 아이디로 판정되면 앞칸만 앨범 제목으로 바뀐다. 뒤칸(관계·내 이름)은 그대로 유지한다.

### PDF 가드 (소유자·참여자 공통)

`lib/albumLimits.ts` 의 `PDF_PHOTO_SAFE_LIMIT = 30` 을 넘으면 더보기 시트의 PDF 행을 **비활성**으로 렌더한다.

- 행을 **감추지 않는다.** 왜 못 하는지 그 자리에서 말한다 (DESIGN_SYSTEM 원칙: 실패는 실패라고 말한다).
- **`opacity`로 흐리게 하지 않는다.** 흰 배경 위 `--c-text-subtle`에 `opacity:.55`를 걸면 실측 ≈2.1:1로 떨어져 노안 사용자가 이유를 읽지 못한다.
- 라벨만 `--c-text-subtle`(4.58:1), **이유 문구는 `--c-warning` `#8a6212`(5.47:1) 풀 알파** 14px/400/1.5.
- 문구: `PDF_BLOCKED_MESSAGE`("사진이 많은 앨범은 지금 PDF로 저장할 수 없어요.") + 현재/상한 수치 "(34장 / 30장까지)".
- "곧 지원" 같은 약속을 하지 않는다.

## Interactions & Behavior

- **불필요한 애니메이션·전환을 넣지 않는다** (DESIGN_SYSTEM.md §8). 시트 등장은 기존 앱과 동일하게 처리하되 새 효과를 추가하지 않는다.
- 바텀시트: ESC로 닫힘, 포커스 트랩, 닫으면 포커스가 원래 트리거로 복귀. **스크롤 잠금과 시트 렌더는 반드시 함께 토글**한다 (기존 이슈).
  기존 `AlbumScreen.css`의 `.album-inline-action` 패턴(헤더 고정 + 본문만 스크롤)을 따르면 "닫기"가 스크롤에 가려지지 않는다.
- 하단 메뉴가 3칸으로 줄었으므로 `.album-inline-action`, `.album-screen__scroll-top`의 `bottom: calc(82px + …)` / `calc(68px + …)` 계산값을 **새 nav 높이(76px, 640px 이하 68px)** 로 맞춘다. 안 맞추면 시트가 nav에 겹치거나 뜬다.
- "채우러 가기"(소유자) → 한마디가 없는 사진만 모아 순서대로 입력하는 흐름으로 이동. **이 화면은 아직 없다** — 만들기 전에는 안내 블록의 링크를 렌더하지 않거나, 첫 대상 사진으로 스크롤 + 입력창 포커스로 대체한다.
- "나도 한마디 남기기"(참여자) → 해당 사진의 한마디 입력 인라인 패널을 연다. 새 페이지로 가지 않는다.
- "이 앨범 지우기"(소유자) → 확인 모달로 한 번 더 확인. 확인 없이 즉시 삭제하지 않는다.
- 실패는 조용히 넘기지 않는다. 저장/공유/삭제 실패 시 `--c-danger` 문구를 해당 자리 인라인으로 노출.
- Hover는 데스크톱 보조: 목록 행/버튼 hover 배경 `--c-brand-soft`, primary 버튼 hover `--c-brand-action-hover`. 비활성 행은 hover 없음.

## State Management

새로 필요한 값:

| 상태 | 화면 | 설명 |
| --- | --- | --- |
| `openSheet: null \| "share" \| "more"` | 공통 | 하단 "공유하기"와 헤더 "더보기"가 각각 연다. 동시에 하나만. 참여자는 `"share"`를 쓰지 않는다 |
| `missingCaptionCount: number` | 소유자 | 캡션(한마디)이 없는 사진 수. 0이면 안내 블록 미렌더 |
| `contributorCount: number` | 공통 | "함께 만든 사람 N명" / "함께한 사람 N명" |
| `photoCount: number` | 공통 | 앨범 메타, 날짜별 "사진 N장", **PDF 가드 판정** |
| `coverPhotoLabel: string` | 소유자 | 더보기 "표지 사진 바꾸기" 우측 현재값 |
| `myPhotoCount` / `myMemoryCount` | 참여자 | "내가 더한 것" 수치. 기존 기여자 귀속 로직(`lib/contributionAttribution.ts`)에서 파생 |
| `inviteCopyLead: "owner" \| "title"` | 참여자 | 앞칸 판정. `ownerDisplayName` + 계정 이메일 local-part 비교에서 파생 |
| `inviteCopyTail: "rel" \| "name" \| "bare"` | 참여자 | 뒤칸 판정. `relationship`, `myDisplayName`에서 파생. **앞칸과 독립** |

`missingCaptionCount`, `myPhotoCount`, `myMemoryCount`, `inviteCopyLead`/`inviteCopyTail` 모두 **이미 있는 앨범/참여 데이터에서 파생 계산**한다. 새 API는 필요 없다.
기존 제목 편집 상태(`AlbumScreenHeader`의 `editing/draft/saving/error`)는 그대로 재사용한다.

## Design Tokens

전부 `frontend/src/styles/tokens.css`에 이미 존재한다. 새 토큰은 추가하지 않았다.

- 색: `--c-bg #fffdfb` / `--c-surface #ffffff` / `--c-bg-soft #fdf7f5` / `--c-border #e0caca` / `--c-border-strong #c9a9a9` / `--c-text #2d2d2d` / `--c-text-soft #5a5150` / `--c-text-muted #7d716f` / `--c-text-subtle #7e726f` / `--c-brand #ff6b6b` / `--c-brand-action #b34a46` / `--c-brand-action-hover #993d3a` / `--c-brand-text #8a2c2c` / `--c-brand-soft #fff0f0` / `--c-danger #a3231f` / `--c-warning #8a6212` / `--c-kakao #fee500` / `--c-kakao-text #191600`
- 간격: 4 8 12 16 24 32 48 (`--s-1`…`--s-12`)
- 둥글기: `--r-sm 8` / `--r-md 12` / `--r-lg 16` / `--r-full 999`
- 그림자: `--sh-sm` / `--sh-md` / `--sh-lg`
- 글자: Pretendard(`--font`). 14 / 16 / 1.15rem / 1.5rem / 2rem. 굵기 400·600·800. 행간 1.3(제목) · 1.6(본문)
- 터치: `--tap-min 44px`

**시안에서 쓴 토큰 아닌 값 3개** (구현 시 판단 필요):
1. `#f0e4e1` — 시트 내부/헤더의 아주 옅은 구분선. `--c-border`보다 약한 선이 필요했다. 토큰으로 승격하거나 `--c-border`로 통일할지 결정 필요.
2. `#1a1f2b`, `#8a8f98` — **로고 브랜드 가이드의 잉크/그레이**(로고 시트 기재값). 로고 락업 전용이며 UI에 쓰지 않는다.
3. 15px, 17px, 19px, 32px — 토큰(14/16/18.4/24/32)과 어긋나는 중간 크기. 라벨 15px·시트 제목 19px은 40대 가독성을 위해 올린 값이다. 타입 스케일에 반영하거나 가까운 토큰으로 맞출지 결정 필요.

## Assets

- 로고: 브랜드 가이드 시트(로고 락업·앱 아이콘·색·아이콘 의미)만 있고 **심볼 SVG는 아직 없어서 시안에서는 텍스트 락업으로 대체**했다. SVG를 받으면 헤더 로고를 교체한다.
- 사진: 없음. 모두 CSS 그라데이션 플레이스홀더(`.ph-a`, `.ph-b`).
- 아이콘: `lucide-react`(이미 의존성). 시안의 사각형/선은 플레이스홀더이며 CSS 주석에 대응 이름이 있다.

## Files

**이 폴더**
- `album-detail-owner.html` — 소유자 3화면 (앨범 화면 / 공유하기 시트 / 더보기 시트)
- `album-detail-participant.html` — 참여자 2화면 (앨범 화면 / 더보기 시트) + 초대 문구 앞칸×뒤칸 규칙 카드(`.spec` — 문서용, 구현 대상 아님)

**코드베이스에서 손대야 할 파일** (경로 기준 `frontend/src/`)
- `components/AlbumBottomNavigation.tsx` + `.css` — `default` variant를 4칸 → 3칸(사진 추가 / 한마디 쓰기 / 공유하기), `participant` variant도 3칸(사진 추가 / 한마디 쓰기 / 앨범 처음으로)으로. 라벨 15px, 아이콘 24, `__new-album` 강조 제거 → default는 공유 버튼, participant는 사진 추가 버튼에 `--c-brand-soft`. `participant`의 4번째 "내 앨범 만들기"는 더보기 시트로 이동. `app` variant는 건드리지 않는다.
- `components/AlbumScreenHeader.tsx` + `.css` — 브랜드 락업을 "우리앨범 / woorialbum"으로. 우측: 소유자는 "내 앨범" + "더보기", 참여자는 "더보기"만. 제목 수정 버튼은 `canEdit`일 때만(기존 prop 유지). 제목 행 wrap 허용.
- `components/AlbumScreen.tsx` + `.css` — 미완성 안내 블록(소유자), 초대 띠·내가 더한 것(참여자), 시트 상태(`openSheet`) 관리, nav 높이 변경에 맞춘 `.album-inline-action`·`.album-screen__scroll-top` bottom 오프셋 수정.
- `components/AlbumActionPanel.tsx` — 기존 액션 패널을 공유하기 시트 / 더보기 시트로 분리. 역할별 항목 분기. 종이 앨범 주문 항목 없음.
- `components/AlbumParticipationPanel.tsx` / `ContributeWorkspace.tsx` — 참여 진입에서 받은 이름·관계 값을 앨범 화면 초대 띠로 이어서 전달.
- `lib/albumLimits.ts` — 값 변경 없음. `PDF_PHOTO_SAFE_LIMIT`, `PDF_BLOCKED_MESSAGE`를 더보기 시트에서 그대로 소비.
- `lib/contributionAttribution.ts` — "내가 더한 것" 수치 파생.
- `album-engine/components/PhotoMemoryLines.css` — 캡션 규칙(2줄 clamp, 카드/배경 없음)은 이미 이 방향. 시안의 16px/500/1.6와 대조해 확인. 참여자 "나도 한마디 남기기" 트리거 위치도 여기.
- `album-engine/blocks/ChapterHeader.css` — 월/날짜 헤더 크기(19px/14px)와 대조.
- `styles/tokens.css` — 변경 없음(위 "토큰 아닌 값 3개" 결정에 따라서만).

## 지키지 말아야 할 것 (원칙 재확인)

- 화면에 "AI", "인공지능", "자동 생성" 같은 말을 쓰지 않는다.
- "업로드", "싱크", "클라우드" 같은 기술 용어를 쓰지 않는다.
- "Day 1", "여행의 시작" 같은 임의 제목을 만들지 않는다.
- 앨범 본문에 배경색을 쓰지 않는다 (인쇄 시 잉크로 찍힌다).
- `--c-brand #ff6b6b` 위에 흰 글자를 올리지 않는다. 흰 글자는 `--c-brand-action`.
- 팔로우·추천·공개 탐색 UI를 만들지 않는다.
- **화면이 없는 동작에 버튼을 만들지 않는다.** (모아보기·이름 바꾸기를 뺀 이유)
- **없는 기능을 조용히 감추지 않는다.** 이유를 적고, 대비 4.5:1 이상으로 읽히게 한다.
