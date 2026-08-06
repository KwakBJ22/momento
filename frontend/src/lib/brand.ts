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
