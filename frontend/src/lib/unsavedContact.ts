/**
 * 연락처를 적다 만 상태인가 — 시트를 닫으려 할 때 묻기 위한 표식 하나.
 *
 * 계정 행은 세 곳(전역 ⋯ 시트 · 앨범 상세 시트 · 공유 앨범 시트)에서 열린다. 셋 다
 * "적다 만 것을 조용히 버리지 않는다" 는 같은 약속을 지켜야 하므로, 표식과 묻는 화면을
 * 한 벌로 둔다(useContactCloseGuard). 세 곳이 각자 만들면 한 곳만 고쳐지고 어긋난다.
 *
 * 상태가 하나뿐인 이유: 계정 행은 화면에 동시에 하나만 열린다.
 */

let unsaved = false;

export function setContactUnsaved(next: boolean): void {
  unsaved = next;
}

export function hasUnsavedContact(): boolean {
  return unsaved;
}
