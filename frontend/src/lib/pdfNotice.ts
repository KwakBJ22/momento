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

/** 끝났을 때의 첫 마디 — 시스템 알림을 유일한 신호로 두지 않는다(I-3 · §11).
 *  파일이 만들어진 것은 두 경로 모두 확실한 사실이므로 여기까지는 단정한다.
 *  그 다음 문장이 경로별로 갈린다 — 어디서 찾는지가 다르기 때문이다. */
export const PDF_READY_MESSAGE = "앨범 파일이 준비됐어요.";

/** 결과 문구. "저장했다"고 단정하지 않고 실제로 일어난 일을 말한다. */
export function pdfSuccessMessage(delivery: PdfDelivery): string {
  return delivery.via === "browser-url"
    ? `${PDF_READY_MESSAGE} 휴대전화 알림을 누르면 열려요. 알림이 지나갔다면 파일 앱의 ‘다운로드’ 폴더에 있어요.`
    : `${PDF_READY_MESSAGE} 기기의 다운로드에서 확인해 주세요.`;
}

/** 화면에 그대로 띄울 실패 문구. 원인이 있으면 원인을, 없으면 기본 문구를 준다. */
export function pdfFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return message || PDF_GENERIC_MESSAGE;
}
