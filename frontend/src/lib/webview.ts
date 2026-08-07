/** 인앱 웹뷰(카카오톡 등) 판정 — 한 곳에서만 정의한다.
 *
 * 인앱 브라우저는 두 가지를 다르게 처리한다:
 *  1) 파일 선택창을 앱이 직접 만든다 → accept 가 여러 값이면 인텐트 타입을 모든 파일로
 *     넓혀, image 로 등록된 갤러리 앱이 후보에서 빠진다 (imageFile.ts 의 imageAcceptFor).
 *  2) blob URL + a[download] 를 무시한다 → 눌러도 아무 일도 안 나고 예외도 없다
 *     (exportPdf.tsx 의 저장 경로).
 * 두 대응이 같은 판정을 써야 하므로 여기에 둔다. 새 웹뷰 대응도 이 함수를 쓴다.
 */
const IN_APP_WEBVIEW = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\//i;
const KAKAO_WEBVIEW = /KAKAOTALK/i;

/** True inside an in-app browser rather than a real browser (Chrome·Safari 등). */
export function isInAppWebView(userAgent: string): boolean {
  return IN_APP_WEBVIEW.test(userAgent || "");
}

/** 카카오톡 인앱 브라우저 — 안내 문구에서 앱 이름을 정확히 부르기 위해 따로 판정한다. */
export function isKakaoWebView(userAgent: string): boolean {
  return KAKAO_WEBVIEW.test(userAgent || "");
}

/** 브라우저에서 읽은 UA. 서버 렌더·테스트 환경에서도 안전하게 빈 문자열이 된다. */
export function currentUserAgent(): string {
  return typeof navigator === "undefined" ? "" : navigator.userAgent || "";
}
