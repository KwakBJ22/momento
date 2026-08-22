/**
 * PDF 만들기의 **시간 제한** (PO 실측 2026-08-21).
 *
 * 아이폰에서 `앨범을 파일로 만들고 있어요` 에서 멈춘 채로 끝나지 않았다. 콘솔 오류도
 * 거부된 약속도 없다 — html2canvas 가 캔버스 한계를 넘으면 예외 없이 **돌아오지 않는다.**
 *
 * `AlbumPdfStatus` 는 만드는 동안 닫기 버튼을 두지 않는다(의도된 것이다). 그래서 끝나지
 * 않으면 사용자는 그 문구를 영원히 본다. 같은 파일 주석의 규칙
 *   ★ 실패하면 실패라고 말한다. 조용히 끝나지 않는다.
 * 에서 **끝나지 않는 경우가 빠져 있었다.** 여기서 그것을 메운다 —
 * 시간이 넘으면 실패로 보고, 화면은 만드는 중 상태를 푼다.
 *
 * ★ 가짜 진행률을 만들지 않는다(F-3). 몇 %인지 모르므로 말하지 않는다.
 * ★ 이 파일은 React·CSS 를 부르지 않는다 — 검사에서 그대로 돌려 시간 제한이 실제로
 *   도는지 본다.
 */

/**
 * 이 시간이 지나면 **끝나지 않은 것으로 본다**.
 *
 * 근거(실측 2026-08-21 · 데스크톱 크롬):
 *   사진 9장 앨범이 **3초**에 끝났다. 사진 수에 거의 비례하므로 30장이면 10초 남짓,
 *   오래된 휴대전화는 서너 배로 봐서 40초 안팎이다. 60초는 그 위로 넉넉하면서,
 *   사람이 `멈췄다` 고 느끼기 전이다(그보다 길면 기다림이 아니라 고장으로 읽힌다).
 * ★ 이 값을 늘려 문제를 덮지 않는다. 늘려야 한다면 그건 만드는 방식을 고칠 때다
 *   (구간 분할 렌더 — 판형 작업과 함께 갈 큰 건이다. KNOWN_ISSUES 참고).
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
 * ★ 하던 일을 멈추지는 못한다(html2canvas 에는 취소가 없다). 대신 **약속을 끝맺어**
 *   화면이 만드는 중 상태에서 빠져나오게 한다 — 끝나지 않는 것보다 낫다.
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

/**
 * 이 기기가 그 크기의 캔버스를 **실제로 만들 수 있는지 재본다** (2026-08-21).
 *
 * 30장 상한(PDF_PHOTO_SAFE_LIMIT)은 **크롬 기준**으로 계산된 값이다 —
 * `크롬 캔버스 최대 치수 65,535px` 이 근거다. 그런데 **사파리의 한계는 치수가 아니라
 * 넓이**고 크롬보다 훨씬 낮다. 그래서 크롬에서 안전한 크기가 아이폰에서는 한계를 넘고,
 * 넘으면 빈 캔버스가 나오거나 아예 끝나지 않는다.
 *
 * ★ 기기별 숫자를 박아 넣지 않는다. **만들어 보고 판단한다** — 기기가 늘어도 안 낡는다.
 * ★ 사파리는 한계를 넘으면 조용히 비운다. 그래서 크기만 보지 않고 **한 점을 찍어 되읽는다.**
 * ★ 시험용 캔버스는 바로 버린다(width/height = 0). 남기면 그 메모리를 들고 있는다.
 * ★ 잴 수 없는 환경(캔버스가 아예 없는 곳)에서는 **막지 않는다** — 모른다고 못 하게
 *   하지 않는다. 그때는 아래 시간 제한이 그물이 된다.
 */
export function canvasFits(widthPx: number, heightPx: number): boolean {
  const width = Math.ceil(widthPx);
  const height = Math.ceil(heightPx);
  if (!(width > 0) || !(height > 0)) return true;
  if (typeof document === "undefined" || !document.createElement) return true;
  const canvas = document.createElement("canvas");
  try {
    canvas.width = width;
    canvas.height = height;
    // 한계를 넘으면 크기 자체가 잡히지 않는다(브라우저가 줄이거나 0 으로 둔다).
    if (canvas.width !== width || canvas.height !== height) return false;
    const context = canvas.getContext("2d");
    if (!context) return false;
    // 크기는 잡혔는데 그림이 안 그려지는 경우가 사파리의 실패 모양이다 — 찍어서 되읽는다.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 1, 1);
    return context.getImageData(0, 0, 1, 1).data[3] === 255;
  } catch {
    return false;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
