/**
 * 무거운 작업 사이에서 브라우저에게 한 번 자리를 내준다 — 진행 숫자가 화면에 닿게,
 * 그리고 디코드 버퍼가 회수되게.
 *
 * ★ **그리기를 기다리되, 무한정 기다리지 않는다.**
 *   `requestAnimationFrame` 은 화면을 그릴 때만 부른다. 페이지가 숨겨지면
 *   (다른 앱으로 갔다가 온다 · 화면이 꺼진다 · 카카오톡이 웹뷰를 뒤로 보낸다)
 *   브라우저는 **다음 프레임을 영원히 그리지 않고**, rAF 만 기다리던 준비 작업은
 *   그 자리에서 멈춘다. 사진 30장을 고르고 잠깐 다른 앱을 봤다가 돌아오면
 *   `12장 중 0장` 그대로 서 있는 것이 그 때문이다(실측: 숨긴 채로 1.5초 안에
 *   rAF 가 한 번도 오지 않고, 준비된 사진 0장).
 *
 *   그래서 rAF 와 시간 제한을 **경쟁시킨다.** 화면이 보이면 다음 프레임(≈16ms)에
 *   풀리고, 보이지 않으면 아래 시간이 지난 뒤 스스로 풀려 작업이 계속된다.
 *   숨겨진 동안에는 어차피 그릴 것이 없으므로 기다릴 이유가 없다.
 */

/** 그리기를 포기하고 그냥 진행하는 시점. 한 프레임(≈16ms)보다 넉넉히 길어야
 *  보이는 화면에서 rAF 를 앞질러 버리지 않는다. */
export const PAINT_WAIT_LIMIT_MS = 100;

export interface YieldToPaintOptions {
  /** 테스트에서 프레임이 오는/오지 않는 상황을 만들기 위한 자리. */
  requestFrame?: (callback: () => void) => void;
  timeoutMs?: number;
}

function defaultRequestFrame(callback: () => void): void {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => callback());
  // rAF 가 없는 환경(오래된 웹뷰·테스트)에서는 아래 시간 제한이 그대로 역할을 한다.
}

export function yieldToPaint(options: YieldToPaintOptions = {}): Promise<void> {
  const requestFrame = options.requestFrame ?? defaultRequestFrame;
  const timeoutMs = options.timeoutMs ?? PAINT_WAIT_LIMIT_MS;
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    requestFrame(finish);
    setTimeout(finish, timeoutMs);
  });
}
