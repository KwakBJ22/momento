/** True for cancellation outcomes that are not user-visible API failures. */
export function isRequestAborted(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof Error && error.name === "AbortError") return true;
  return error instanceof Error && /signal is aborted|aborted without reason/i.test(error.message);
}
