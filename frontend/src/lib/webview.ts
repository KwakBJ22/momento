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

/** 아이폰·아이패드(WebKit) 판정.
 *
 * ★ 왜 필요한가: PDF 저장이 blob + a[download] 로 끝나는 길이 하나 남아 있다. iOS 는
 *   버전·기기에 따라 이 길에서 파일 이름을 잃거나 새 탭에서 미리보기로 열고 끝난다 —
 *   실패해도 예외가 없어 화면에는 "저장했어요"만 남는다. 서버에 이미 올려 둔 주소가
 *   있으면 그쪽이 확실하므로, 아이폰에서는 그 주소를 먼저 쓴다(exportPdf.tsx).
 * ★ iPadOS 13+ 는 UA 를 데스크톱 사파리로 위장한다 — Macintosh + 터치 지원으로 가른다.
 */
const IOS_DEVICE = /iPhone|iPad|iPod/i;

export function isIosWebKit(userAgent: string): boolean {
  const ua = userAgent || "";
  if (IOS_DEVICE.test(ua)) return true;
  const touchPoints = typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints || 0;
  return /Macintosh/i.test(ua) && touchPoints > 1;
}

/** 브라우저에서 읽은 UA. 서버 렌더·테스트 환경에서도 안전하게 빈 문자열이 된다. */
export function currentUserAgent(): string {
  return typeof navigator === "undefined" ? "" : navigator.userAgent || "";
}
