/** PDF 저장 결과 문구 — exportPdf(React·CSS 의존) 밖의 순수 모듈이라 그대로 테스트한다.
 *  AlbumView 와 AlbumResult 가 이 두 함수를 함께 쓰므로 두 화면의 처리가 갈라지지 않는다. */

/** 저장이 실제로 어떤 경로로 끝났는지 — Promise 가 resolve 됐다는 것은 "저장됐다"가 아니라
 *  "저장을 시작했다"는 뜻뿐이다(예전에 둘을 같게 취급해 실패해도 "저장했어요"가 떴다). */
import { isKakaoWebView } from "./webview";

export type PdfDelivery =
  | { via: "download" }                  // a[download] 로 파일 저장이 시작됨
  | { via: "browser-url"; url: string }; // 인앱 브라우저: 서버에 올린 주소를 열어 줌

/** 파일 주소조차 없을 때의 마지막 안내. 사실만 말하고("막혀 있다"), 사용자가 실제로 찾을 수
 *  있게 메뉴 이름을 그대로 적는다. 없는 기능을 약속하지 않는다(§8). */
export function webviewSaveMessage(userAgent: string): string {
  const appName = isKakaoWebView(userAgent) ? "카카오톡" : "지금 쓰는 앱";
  return `${appName} 안에서는 파일 저장이 막혀 있어요. 메뉴(⋯)에서 ‘다른 브라우저로 열기’를 눌러 크롬이나 사파리에서 저장해 주세요.`;
}
export const PDF_GENERIC_MESSAGE = "PDF를 만들지 못했어요. 잠시 후 다시 시도해 주세요.";

/** 결과 문구. "저장했다"고 단정하지 않고 실제로 일어난 일을 말한다. */
export function pdfSuccessMessage(delivery: PdfDelivery): string {
  return delivery.via === "browser-url"
    ? "PDF 파일을 열었어요. 저장이 시작되지 않으면 메뉴(⋯)에서 ‘다른 브라우저로 열기’로 다시 열어 주세요."
    : "PDF를 내려받고 있어요. 기기의 다운로드에서 확인해 주세요.";
}

/** 화면에 그대로 띄울 실패 문구. 원인이 있으면 원인을, 없으면 기본 문구를 준다. */
export function pdfFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return message || PDF_GENERIC_MESSAGE;
}
