// Pure download-filename logic, kept free of component/CSS imports so it is
// unit-testable in node (same pattern as uploadFormView.ts).

const PDF_TITLE_FALLBACK = "우리의 추억";
const PDF_TITLE_MAX_CHARS = 50;

/** 다운로드 파일명: `앨범제목_YYYY-MM-DD.pdf`.
 *
 * 앨범 식별자는 뺀다 — 같은 이름 파일은 모든 주요 브라우저/OS가 "이름 (1).pdf" 로
 * 자동 구분 저장하므로 덮어쓰기가 일어나지 않고, 사용자에게는 제목+날짜가
 * albumId 해시보다 훨씬 알아보기 쉽다. (서버 저장용 객체 이름은 별개로
 * momento-{albumId}-v{version}.pdf 를 유지한다 — uploadAlbumPdf 참고.)
 */
export function pdfDownloadFilename(title: string | null | undefined, date: Date = new Date()): string {
  const cleaned = (title || "")
    .replace(/[\\/:*?"<>|]/g, " ") // Windows 금지 문자는 공백으로 대체
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const base = cleaned || PDF_TITLE_FALLBACK;
  // 상한 50자: 말줄임표 없이 조용히 자르고 끝 공백만 정리(잘린 티가 안 나게).
  const limited = base.length > PDF_TITLE_MAX_CHARS ? base.slice(0, PDF_TITLE_MAX_CHARS).trimEnd() : base;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${limited}_${year}-${month}-${day}.pdf`;
}
