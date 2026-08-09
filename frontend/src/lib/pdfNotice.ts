/** PDF 저장 결과 문구 — exportPdf(React·CSS 의존) 밖의 순수 모듈이라 그대로 테스트한다.
 *  AlbumView 와 AlbumResult 가 이 두 함수를 함께 쓰므로 두 화면의 처리가 갈라지지 않는다. */

/** 저장이 실제로 어떤 경로로 끝났는지 — Promise 가 resolve 됐다는 것은 "저장됐다"가 아니라
 *  "저장을 시작했다"는 뜻뿐이다(예전에 둘을 같게 취급해 실패해도 "저장했어요"가 떴다). */
import { isKakaoWebView } from "./webview";

/** 끝났을 때의 첫 마디이자 시트의 제목 (K-8). 진실이 하나여야 두 자리가 어긋나지 않는다. */
export const PDF_READY_TITLE = "앨범 파일이 준비됐어요";
/** 제목과 본문을 가르는 줄바꿈. 이 한 글자가 "할 일이 남았다"는 표시이기도 하다(K-8). */
const NEWLINE = String.fromCharCode(10);

export type PdfDelivery =
  | { via: "download" }                  // a[download] 로 파일 저장이 시작됨
  | { via: "browser-url"; url: string }; // 인앱 브라우저: 서버에 올린 주소를 열어 줌

/**
 * 파일 주소조차 없을 때의 마지막 안내 — **끝났는데 사용자가 할 일이 남은** 경우다 (K-8).
 *
 * ★ **좋은 소식이 먼저다.** 파일은 실제로 만들어져 있다. 그것부터 말한다.
 *   예전에는 `막혀 있어요` 로 나쁜 소식부터 말했고, 어디를 눌러야 하는지가 없었다.
 * ★ **`크롬`·`사파리` 라는 이름을 대지 않는다.** `다른 브라우저로 열기` 를 고르면
 *   알아서 열린다. 이름을 대면 그것을 찾아 헤맨다.
 * ★ 아이콘을 **둘 다** 보여준다(`⋮` · `···`) — 기기·버전마다 다르다.
 * ★ 누구 탓도 아니다. 오류가 아니라 **안내**다(I-5b — danger 색을 쓰지 않는다).
 *
 * 첫 줄이 제목이고 나머지가 본문이다. 이 줄바꿈이 **"할 일이 남았다"는 표시**이기도
 * 하다 — 아래 `isPdfActionNotice` 가 그것을 보고 딤 위 시트로 띄운다.
 */
export function webviewSaveMessage(userAgent: string): string {
  const appName = isKakaoWebView(userAgent) ? "카카오톡" : "지금 쓰는 앱";
  return [
    PDF_READY_TITLE,
    `${appName}에서는 바로 저장되지 않아요.`,
    "브라우저 메뉴(⋮ 또는 ···)에서 ‘다른 브라우저로 열기’를 고르면 저장할 수 있어요.",
  ].join(NEWLINE);
}

/**
 * 이 결과에 **사용자가 할 일이 남았는가** (K-8).
 *
 * 남았으면 하단에 지나가듯 두지 않는다 — 놓치면 무엇을 해야 할지 모른다.
 * 끝났고 할 일이 없는 결과(성공·단순 실패)는 지금처럼 하단 고정 그대로다.
 */
export function isPdfActionNotice(notice: string | null): boolean {
  return Boolean(notice && notice.startsWith(PDF_READY_TITLE + NEWLINE));
}

/** 제목 한 줄과 나머지 본문으로 가른다. 시트가 제목만 굵게 보이려면 필요하다. */
export function splitPdfActionNotice(notice: string): { title: string; body: string } {
  const lineBreak = notice.indexOf(NEWLINE);
  if (lineBreak < 0) return { title: notice, body: "" };
  return { title: notice.slice(0, lineBreak), body: notice.slice(lineBreak + 1) };
}

export const PDF_GENERIC_MESSAGE = "PDF를 만들지 못했어요. 잠시 후 다시 시도해 주세요.";

/** 끝났을 때의 첫 마디 — 시스템 알림을 유일한 신호로 두지 않는다(I-3 · §11).
 *  파일이 만들어진 것은 두 경로 모두 확실한 사실이므로 여기까지는 단정한다.
 *  그 다음 문장이 경로별로 갈린다 — 어디서 찾는지가 다르기 때문이다. */
export const PDF_READY_MESSAGE = `${PDF_READY_TITLE}.`;

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
