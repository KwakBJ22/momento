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

/** 앨범 본문·PDF 마지막의 브랜드 푸터 문구.
 *  무료 PDF 전용이라는 결정은 그대로 유지한다(docs/PRINT_LAYOUT.md §8). */
export const BRAND_PDF_FOOTER = `이 추억은 ${BRAND_NAME_KO}에서 함께 만들었습니다.`;

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
export const BRAND_BUSINESS_INFO = [
  { label: "상호", value: "인사이트네트" },
  { label: "대표자", value: "곽병준" },
  { label: "사업자등록번호", value: "206-30-85579" },
  { label: "주소", value: "경기도 화성시 동탄구 동탄대로 646-2, A동 9층 916호(영천동, 메가비즈타워)" },
  { label: "문의", value: "futuregram7@gmail.com" },
] as const;

/** 법적 고지 정적 페이지 — React 밖이라 상수를 못 읽는다(위 주석 목록 참고). */
export const LEGAL_LINKS = [
  { href: "/terms.html", label: "이용약관" },
  { href: "/privacy.html", label: "개인정보처리방침" },
] as const;
