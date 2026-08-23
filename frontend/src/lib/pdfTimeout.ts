/**
 * PDF 만들기의 **시간 제한** (PO 실측 2026-08-21).
 *
 * 아이폰에서 `앨범을 파일로 만들고 있어요` 에서 멈춘 채로 끝나지 않았다. 콘솔 오류도
 * 거부된 약속도 없다 — 그때는 html2canvas 가 한계를 넘으면 예외 없이 **돌아오지 않았다.**
 *
 * `AlbumPdfStatus` 는 만드는 동안 닫기 버튼을 두지 않는다(의도된 것이다). 그래서 끝나지
 * 않으면 사용자는 그 문구를 영원히 본다. 같은 파일 주석의 규칙
 *   ★ 실패하면 실패라고 말한다. 조용히 끝나지 않는다.
 * 에서 **끝나지 않는 경우가 빠져 있었다.** 여기서 그것을 메운다 —
 * 시간이 넘으면 실패로 보고, 화면은 만드는 중 상태를 푼다.
 *
 * ★ 2026-08-22 — PDF 는 이제 **서버가 그린다**(exportPdf.tsx). 기다리는 것은 캔버스가
 *   아니라 서버 응답이다. 기기가 캔버스를 만들 수 있는지 재보던 `canvasFits` 는 잴 캔버스가
 *   없어졌으므로 지웠다. 시간 제한은 남는다 — 서버가 오래 걸리거나 응답이 없을 때의 그물이다.
 * ★ 가짜 진행률을 만들지 않는다(F-3). 몇 %인지 모르므로 말하지 않는다.
 * ★ 이 파일은 React·CSS 를 부르지 않는다 — 검사에서 그대로 돌려 시간 제한이 실제로
 *   도는지 본다.
 */

/**
 * 이 시간이 지나면 **끝나지 않은 것으로 본다**.
 *
 * 근거(실측 2026-08-21 · 데스크톱 크롬): 사진 9장 앨범이 **3초**에 끝났다. 사진 수에 거의
 *   비례하므로 30장이면 10초 남짓, 오래된 휴대전화는 서너 배로 봐서 40초 안팎이다.
 *   서버가 그리는 지금(2026-08-22 실측)은 사진 한 장에 1초 안쪽이라 30장이 30초 안이다.
 *   60초는 그 위로 넉넉하면서, 사람이 `멈췄다` 고 느끼기 전이다(그보다 길면 기다림이
 *   아니라 고장으로 읽힌다).
 * ★ 이 값을 늘려 문제를 덮지 않는다. 늘려야 한다면 그건 만드는 방식을 고칠 때다.
 */
export const PDF_TIMEOUT_MS = 60_000;

/** 시간이 넘었을 때 던지는 것 — 부르는 쪽이 다른 실패와 갈라 볼 수 있게 이름을 준다. */
export class PdfTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfTimeoutError";
  }
}

/**
 * `work` 가 제 시간 안에 끝나지 않으면 **실패로 끝낸다**.
 *
 * ★ 하던 일을 멈추지는 못한다(서버는 제 할 일을 마저 하고 캐시에 넣는다 — 다음에 누르면
 *   바로 받는다). 대신 **약속을 끝맺어** 화면이 만드는 중 상태에서 빠져나오게 한다.
 * ★ 제 시간에 끝나면 타이머를 반드시 거둔다. 남겨 두면 탭이 그만큼 깨어 있는다.
 */
export function withPdfTimeout<T>(
  work: Promise<T>,
  message: string,
  timeoutMs: number = PDF_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new PdfTimeoutError(message)), timeoutMs);
  });
  return Promise.race([work, limit]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  }) as Promise<T>;
}
