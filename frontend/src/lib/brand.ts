// 서비스 이름은 아직 최종 확정 전이다. 사용자에게 보이는 브랜드 문자열은 전부 여기서
// 읽는다 — 이름이 바뀔 때 이 파일 하나만 고치면 되도록, 화면 코드에 문자열을 직접
// 적지 않는다. (보이지 않는 자리 — 패키지명·저장소 경로·환경변수·DB 컬럼 — 는
// 이름과 무관한 식별자이므로 여기서 다루지 않는다.)
//
// ⚠️ 상수를 쓸 수 없어 문자열을 직접 적어 둔 자리 — 이름을 바꿀 때 함께 고칠 것:
//   - frontend/index.html <title> (빌드 전 정적 HTML)
//   - frontend/public/terms.html, privacy.html <title>·본문 (정적 법적 고지)

/** 한글 서비스명. 화면에 이름이 나오는 모든 자리의 기본값. */
export const BRAND_NAME_KO = "우리앨범";

/** 로고에서 앞·뒤를 다른 색으로 칠하기 위한 분해형("우리" + "앨범"). */
export const BRAND_NAME_KO_PARTS = { lead: "우리", tail: "앨범" } as const;

/** 영문 표기(로고 하단 소문자). */
export const BRAND_NAME_EN = "woorialbum";

/** 웹 주소 — 인쇄물에는 **글자로만** 쓴다(링크로 만들지 않는다).
 *  ★ 화면·PDF 가 같은 값을 본다. 주소가 바뀌면 고칠 자리는 여기 하나다(§3 · I-4f-2).
 *  ★ **정본은 `www` 없는 쪽이다** (J-13 — 도메인 이전 완료 2026-08-10).
 *    `www` 로 들어와도 Vercel 이 apex 로 넘긴다. 둘 다 열리지만 **찍히는 것은 하나**여야
 *    한다 — 종이는 고칠 수 없다. 결정과 이전 기록은 `docs/DOMAIN_SWITCH.md`. */
export const BRAND_SITE_URL = "woorialbum.com";

/** 앨범 본문·PDF 마지막의 브랜드 푸터 문구.
 *  무료 PDF 전용이라는 결정은 그대로 유지한다(docs/PRINT_LAYOUT.md §8). */
export const BRAND_PDF_FOOTER = `이 추억은 ${BRAND_NAME_KO}에서 함께 만들었습니다.`;

/** PDF·화면 마지막 줄, 브랜드 표시 아래 한 줄. docs/PRINT_LAYOUT.md §8 의 "우리도
 *  만들어볼까?" 방향 — 읽는 사람이 자기도 만들 수 있다는 것을 알게 하되, 없는 것을
 *  약속하지 않는다("곧"·"준비 중"·"가입하면" 금지). 주소는 적지 않는다(도메인 미확정). */
export const BRAND_PDF_INVITE = "우리 가족의 앨범도 이렇게 만들 수 있어요.";

/** 카카오 공유 카드 제목 등, 앨범 제목이 없을 때 쓰는 기본 이름. */
export const BRAND_SHARE_FALLBACK_TITLE = BRAND_NAME_KO;

/** 표시 이름을 알 수 없는 로그인 사용자의 기본 호칭. */
export const BRAND_DEFAULT_USER_NAME = `${BRAND_NAME_KO} 사용자`;

/** document.title 접미사 — "앨범 제목 | 우리앨범". */
export const BRAND_TITLE_SUFFIX = BRAND_NAME_KO;

/** 사업자 정보 — docs/TERMS_OF_SERVICE.md "회사 정보"의 값을 그대로 옮긴 것이다.
 *  ★ 문서에 없는 항목(통신판매업 신고번호·개인정보보호책임자 전화·호스팅 제공자)은
 *  넣지 않는다. 지어내지 않는다. 통신판매업 신고는 유료 인쇄 판매를 열 때 필요하며
 *  그때 이 목록에 한 줄이 추가된다(docs/PRODUCT_BACKLOG.md 참고). */
/** `우리앨범이란` — 가치 소개. **세 자리가 이 한 곳을 읽는다**
 *  (첫 화면 · 공유 화면 맨 아래 · 푸터의 브랜드 이름 시트). 단어를 바꿀 때 한 곳만 고친다.
 *
 * ★ **메뉴로 만들지 않는다** (2026-08-13 PO 판단). 이유 둘:
 *   1) 전역 네비는 2칸이다 — 행동(`앨범 만들기`) 옆에 읽을거리를 같은 무게로 두지 않는다.
 *   2) `인스타랑 뭐가 다르냐` 고 묻는 사람은 **초대 링크로 공유 화면에 바로 떨어진다.**
 *      로그인 전이라 네비가 아예 안 보인다. 그래서 공유 화면 맨 아래가 진짜 자리다.
 * ★ 제목에 부정어(`…이 아니에요`)를 쓰지 않는다. `피드` 같은 업계 말도 쓰지 않는다.
 * ★ 첫 칸은 **겪은 일**로 연다(사진이 쌓였는데 못 찾는다). 그 다음 칸에서 곧바로
 *   `같이 있었던 사람들과` 로 넘어가 저장 서비스와 갈라진다 — 이 순서가 핵심이다.
 * ★ 뒤의 두 칸은 **누가 왜 쓰는지**를 그림으로 보여 준다. 기능 설명이 아니라
 *   "아, 저건 내 얘기다" 가 되어야 한다.
 * ★ 아이콘은 브랜드 아이콘 시트에서 잘라 쓴 것이다(자리 잡기용). 디자인에서 다시
 *   만들면 파일만 갈아 끼우면 된다 — 경로가 여기 한 곳에만 있다.
 */
export const BRAND_VALUE_TITLE = "휴대폰에 쌓인 사진, 앨범으로 남기세요";

/** 소개 구역의 라벨 — 로고 조합이다(§9). `우리`+`앨범` 이 색으로 갈린다. */
export const BRAND_VALUE_LABEL = "소개";
/** 뒤 2칸 위의 작은 라벨. */
export const BRAND_USE_LABEL = "이런 앨범을 많이 만들어요";

export interface BrandValueCard {
  /** 제목 — `
` 에서 줄을 바꾼다(시안이 두 줄이다). */
  title: string;
  /** 제목 안에서 브랜드색으로 쓸 조각. 없으면 전부 본문색이다. */
  titleBrand?: string;
  body: string;
}

/**
 * 앞 2칸 — **왜 쓰나**. 흰 카드에 제목 · 그림 · 본문 순이다.
 *
 * ★ 그림은 사진이 아니라 **선과 면으로 그린 모양**이다(BrandValue.tsx). 두 칸이
 *   말하는 것이 다르므로 그림도 다르다: 흩어진 더미 → 묶인 앨범 / 사진 + 두 사람의 말.
 */
export const BRAND_VALUE_CARDS: readonly BrandValueCard[] = [
  {
    title: "휴대폰에 쌓인 사진,\n날짜와 위치대로 알아서 한 권이 돼요",
    body:
      "수천 장 중에 작년 여행 사진 찾아 헤매지 않아도 돼요. " +
      "올리면 찍은 날짜대로 묶여 펼쳐 보기만 하면 됩니다.",
  },
  {
    title: "나만의 앨범이 아닌,\n우리앨범",
    titleBrand: "앨범",
    body:
      "그날 같이 있었던 사람들과 사진을 한자리에. " +
      "한마디씩 남기면 나란히 붙어 한 권이 됩니다.",
  },
];

export interface BrandUseCase {
  icon: string;
  title: string;
  body: string;
}

/**
 * 뒤 2칸 — **누가 쓰나**. 2열 그리드에 작은 아이콘 + 제목 + 한 줄.
 *
 * ★ 앞 2칸과 무게가 달라야 한다. 넷이 같은 크기로 놓이면 전부 같게 읽히고
 *   스크롤로 지나간다(2026-08-16 PO).
 */
export const BRAND_USE_CASES: readonly BrandUseCase[] = [
  {
    icon: "/use-parents.webp",
    title: "부모님 회고 앨범",
    body: "과거~현재까지 기간별로 묶어 소중한 한 권으로 드려요.",
  },
  {
    icon: "/use-child.webp",
    title: "아이 성장 앨범",
    body: "탄생의 순간부터 지금까지 언제든 꺼내 보여줘요.",
  },
];

/** 짧은 판 — 공유 화면 맨 아래처럼 이미 앨범을 다 본 사람에게는 두 줄이면 된다. */
export const BRAND_VALUE_SHORT =
  "그날 같이 있었던 사람들과 사진을 모으고 한마디씩 남기면, 몇 년 뒤에 다시 꺼내 보는 한 권이 됩니다.";

export const BRAND_BUSINESS_INFO = [
  { label: "상호", value: "인사이트네트" },
  { label: "대표자", value: "곽병준" },
  { label: "사업자등록번호", value: "206-30-85579" },
  { label: "주소", value: "경기도 화성시 동탄구 동탄대로 646-2, A동 9층 916호(영천동, 메가비즈타워)" },
  { label: "문의", value: "futuregram7@gmail.com" },
] as const;

/** 회사 홈페이지 — 회사 정보 시트에 **한 줄 더하는** 것이다.
 *  ★ 사업자 정보를 홈페이지로 옮기지 않는다. 전자상거래법은 사이버몰 자체에 표시할 것을
 *  요구하므로 링크로 대체할 수 없다. 위 BRAND_BUSINESS_INFO 는 그대로 둔다. */
export const BRAND_COMPANY_HOMEPAGE = {
  label: "회사 홈페이지",
  href: "https://insightnet.co.kr",
  display: "insightnet.co.kr",
} as const;

/** 법적 고지 정적 페이지 — React 밖이라 상수를 못 읽는다(위 주석 목록 참고). */
export const LEGAL_LINKS = [
  { href: "/terms.html", label: "이용약관" },
  { href: "/privacy.html", label: "개인정보처리방침" },
] as const;
