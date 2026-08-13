/**
 * 링크 복사 — **아이폰에서 되게** 한다 (2026-08-12).
 *
 * 실기기 조사: 지금 코드는 이렇게 부른다.
 *
 *     await navigator.clipboard.writeText(await url());
 *                                          ↑ 여기서 사용자 제스처가 끊긴다
 *
 * iOS Safari 는 `writeText` 가 **탭의 동기 연장선**에 있을 때만 허용한다. 앞에 네트워크
 * 호출이 오면 제스처가 만료돼 `NotAllowedError` 가 난다. 안드로이드·데스크톱은 관대해서
 * 되고, **아이폰에서만 안 된다.**
 *
 * ★ 이건 카카오 공유가 실패했을 때의 마지막 대비책이다. 그것마저 아이폰에서 실패하면
 *   사용자는 링크를 얻을 방법이 없다.
 *
 * 해법은 `ClipboardItem` 에 **Promise 를 그대로 넘기는 것**이다. 그러면 브라우저가
 * 제스처 안에서 기다려 준다(Safari 가 이 형태를 위해 만든 길이다).
 * 지원하지 않는 곳에서는 지금까지 하던 방식으로 떨어진다.
 *
 * ★ 부르는 쪽은 **클릭 핸들러에서 곧바로** 불러야 한다. 앞에 await 를 두면 이 함수도
 *   소용이 없다.
 */
export async function copyTextFromPromise(getText: () => Promise<string>): Promise<void> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (!clipboard) throw new Error("clipboard unavailable");

  const ClipboardItemCtor = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
  if (ClipboardItemCtor && typeof clipboard.write === "function") {
    // Promise 를 그대로 넘긴다 — 주소를 만드는 동안에도 제스처가 살아 있다.
    const blob = getText().then((text) => new Blob([text], { type: "text/plain" }));
    await clipboard.write([new ClipboardItemCtor({ "text/plain": blob })]);
    return;
  }
  await clipboard.writeText(await getText());
}
