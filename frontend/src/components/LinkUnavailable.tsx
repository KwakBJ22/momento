import "./LinkUnavailable.css";

/**
 * 열리지 않는 링크 화면 (J-9 · SCREEN_SPEC §8·§10·§11).
 *
 * 카카오톡 대화방의 메시지는 지워지지 않고 계속 남는다. 몇 달 뒤에도 눌린다 —
 * 죽은 링크를 누르는 일은 예외가 아니라 **정기적으로 일어나는 일**이다.
 *
 * ★ 이 화면은 **오류가 아니라 안내**다. 받는 사람이 무엇을 잘못한 것이 아니다.
 *   그래서 안내 껍데기(배경 없음·글머리 없음)를 쓰고 `role="alert"` 를 붙이지 않는다.
 * ★ **문구는 백엔드가 준다.** 왜 안 열리는지는 서버만 안다 — 화면이 추측하지 않는다(§11).
 *   두 줄이고 줄바꿈이 그대로 보여야 한다(`white-space: pre-line`).
 * ★ **막다른 골목을 만들지 않는다.** 어느 경우에도 다음에 할 일이 있다.
 * ★ 브랜드 푸터는 남긴다 — 이 사람이 이 서비스를 확인할 유일한 화면일 수 있다(§6).
 *   푸터는 앱 껍데기(AppChrome)가 그리므로 여기서 지우지만 않으면 된다.
 */

export const LINK_UNAVAILABLE_ACTION = "내 앨범 만들기";

export default function LinkUnavailable({ message }: { message: string }) {
  return (
    <section className="link-unavailable" aria-label="열리지 않는 링크">
      <p className="notice notice--info link-unavailable__message">{message}</p>
      <a className="link-unavailable__action" href="/">{LINK_UNAVAILABLE_ACTION}</a>
    </section>
  );
}
