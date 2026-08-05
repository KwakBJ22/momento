// 앨범 한도 상수 — 백엔드 app/models/schemas.py 의 DEFAULT_ALBUM_PHOTO_CAPACITY,
// DB(albums.photo_limit DEFAULT)와 같이 움직인다.

/** 앨범이 담을 수 있는 사진 총량. "한 번에 올리는 상한"(업로드 화면의 30장)과는
 *  별개다 — 30은 1회 업로드 성공률·40MB 가드 때문에 유지된다. */
export const ALBUM_PHOTO_CAPACITY = 100;

/**
 * PDF 저장을 허용하는 사진 수 상한.
 *
 * 근거(캔버스 한계 계산): exportPdf 는 html2canvas 가 앨범 전체를 캔버스 1장으로
 * 래스터화한 뒤 A4 높이로 잘라낸다. 호스트 폭 210mm ≈ 794px → A4 1페이지
 * ≈ 794 × 297/210 ≈ 1,123px(소스). Chrome 캔버스 최대 치수 65,535px, scale:2 이므로
 * 소스 높이 실질 한계는 32,767px ≈ 29페이지. 30장(약 32페이지)은 이미 한계에
 * 근접하지만 현재 프로덕션에서 동작이 확인된 최대 크기다. 그보다 큰 앨범은
 * 수학적으로 한계를 넘어 빈/잘린 PDF가 나오므로 누르기 전에 막는다.
 * 보수적 기준(실측 최대 = 30). 근본 해결은 200x200mm 판형 구현과 함께
 * exportPdf 를 구간 분할 렌더링으로 다시 쓸 때 처리한다 (KNOWN_ISSUES 참고).
 */
export const PDF_PHOTO_SAFE_LIMIT = 30;

/** 가드 발동 시 버튼 아래 표시할 문구 — 사실만 말한다(§8: "곧 지원" 약속 금지). */
export const PDF_BLOCKED_MESSAGE = "사진이 많은 앨범은 지금 PDF로 저장할 수 없어요.";
