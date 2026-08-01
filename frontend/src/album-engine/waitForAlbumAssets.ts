/**
 * PDF 생성·화면 렌더 전 폰트·이미지 준비 대기.
 *
 * 이미지 한 장이 안 열리거나 요청이 pending 이어도 상한 시간 뒤 진행한다.
 * 어떤 경우에도 무한 대기하지 않는다. CSS·React 의존이 없어 단위 테스트가 가능하다.
 */

/** 자산 대기 타임아웃 (ms). PDF 생성이 어떤 경우에도 멈추지 않도록 상한을 둔다. */
export const ALBUM_ASSET_OVERALL_TIMEOUT_MS = 15_000;
export const ALBUM_ASSET_IMAGE_TIMEOUT_MS = 6_000;
export const ALBUM_ASSET_FONTS_TIMEOUT_MS = 4_000;

export interface WaitForAlbumAssetsOptions {
  overallTimeoutMs?: number;
  imageTimeoutMs?: number;
  fontsTimeoutMs?: number;
}

/** promise 가 정해진 시간 안에 끝나지 않으면 자체 타이머로 진행한다. 타이머는 항상 정리한다. */
function raceWithTimeout(promise: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return Promise.race([
    promise.then(
      () => {
        if (timer) clearTimeout(timer);
      },
      () => {
        // 개별 자산 실패는 PDF 생성을 막지 않는다.
        if (timer) clearTimeout(timer);
      },
    ),
    timeout,
  ]);
}

/** 이미지 한 장을 기다린다. 로드 실패·미응답이면 타임아웃 후 건너뛴다. 절대 reject 하지 않는다. */
async function settleImage(img: HTMLImageElement, imageTimeoutMs: number): Promise<void> {
  if (!(img.complete && img.naturalWidth > 0)) {
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, imageTimeoutMs);
      img.addEventListener("load", finish, { once: true });
      // 실패한 이미지는 건너뛴다 (reject 하지 않는다).
      img.addEventListener("error", finish, { once: true });
    });
  }
  await img.decode?.().catch(() => undefined);
}

/**
 * PDF 생성 전 폰트·이미지 준비. 화면 렌더러(onReady)도 사용한다.
 * 이미지 한 장이 안 열리거나 요청이 pending 이어도 상한 시간 뒤 진행한다. 무한 대기는 없다.
 */
export async function waitForAlbumAssets(root: ParentNode, options: WaitForAlbumAssetsOptions = {}): Promise<void> {
  const overallTimeoutMs = options.overallTimeoutMs ?? ALBUM_ASSET_OVERALL_TIMEOUT_MS;
  const imageTimeoutMs = options.imageTimeoutMs ?? ALBUM_ASSET_IMAGE_TIMEOUT_MS;
  const fontsTimeoutMs = options.fontsTimeoutMs ?? ALBUM_ASSET_FONTS_TIMEOUT_MS;

  const work = (async () => {
    const fontsReady =
      typeof document !== "undefined" && document.fonts ? document.fonts.ready : Promise.resolve();
    await raceWithTimeout(fontsReady, fontsTimeoutMs);
    const images = Array.from(root.querySelectorAll("img"));
    await Promise.all(images.map((img) => settleImage(img, imageTimeoutMs)));
  })();

  await raceWithTimeout(work, overallTimeoutMs);
}
