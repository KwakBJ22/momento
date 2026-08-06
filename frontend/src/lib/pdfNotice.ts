/** PDF 저장 결과 문구 — exportPdf(React·CSS 의존) 밖의 순수 모듈이라 그대로 테스트한다.
 *  AlbumView 와 AlbumResult 가 이 두 함수를 함께 쓰므로 두 화면의 처리가 갈라지지 않는다. */

/** 저장이 실제로 어떤 경로로 끝났는지 — Promise 가 resolve 됐다는 것은 "저장됐다"가 아니라
 *  "저장을 시작했다"는 뜻뿐이다(예전에 둘을 같게 취급해 실패해도 "저장했어요"가 떴다). */
export type PdfDelivery =
  | { via: "download" }                  // a[download] 로 파일 저장이 시작됨
  | { via: "browser-url"; url: string }; // 인앱 브라우저: 서버에 올린 주소를 열어 줌

export const PDF_WEBVIEW_MESSAGE =
  "앱 안에 있는 브라우저에서는 파일로 저장할 수 없어요. 크롬이나 사파리에서 이 앨범을 열어 주세요.";
export const PDF_GENERIC_MESSAGE = "PDF를 만들지 못했어요. 잠시 후 다시 시도해 주세요.";

/** 결과 문구. "저장했다"고 단정하지 않고 실제로 일어난 일을 말한다. */
export function pdfSuccessMessage(delivery: PdfDelivery): string {
  return delivery.via === "browser-url"
    ? "새 창에서 PDF를 열었어요. 그 화면에서 저장해 주세요."
    : "PDF를 내려받고 있어요. 기기의 다운로드에서 확인해 주세요.";
}

/** 화면에 그대로 띄울 실패 문구. 원인이 있으면 원인을, 없으면 기본 문구를 준다. */
export function pdfFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return message || PDF_GENERIC_MESSAGE;
}
