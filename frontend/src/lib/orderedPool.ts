// Run async work over a list with bounded concurrency, delivering results to the
// caller in the ORIGINAL input order (not completion order). A worker that rejects
// does not block the rest: its slot is delivered as a failure and later items keep
// flowing. Kept pure (no React) so ordering/failure behaviour is unit-testable.

export type PoolResult<R> = { ok: true; value: R } | { ok: false; error: unknown };

/**
 * @param items       input items
 * @param concurrency max workers in flight (>= 1)
 * @param worker      async work for one item
 * @param onReady     called once per item, in input-index order, as soon as that
 *                    index AND all earlier indexes have finished
 * @param onSettled   optional: called once per item the moment IT finishes (completion
 *                    order, not input order). Ordering/results are unaffected — this is
 *                    purely for progress, which must reflect real completions rather
 *                    than waiting for the in-order flush (else the counter jumps in
 *                    chunks when an early item is slow).
 * @param options     soloFirst: 첫 항목만 혼자 처리하고, 끝난 뒤에 나머지가 붙는다.
 *                    첫 결과가 **빨리 나오는 것이 중요할 때**만 켠다(J-1b-2).
 */
export async function runOrderedPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onReady: (result: PoolResult<R>, index: number) => void,
  onSettled?: (index: number) => void,
  options: { soloFirst?: boolean } = {},
): Promise<void> {
  const results: (PoolResult<R> | undefined)[] = new Array(items.length);
  let nextFlush = 0;
  let cursor = 0;

  const flush = () => {
    while (nextFlush < results.length && results[nextFlush] !== undefined) {
      onReady(results[nextFlush] as PoolResult<R>, nextFlush);
      nextFlush += 1;
    }
  };

  const runWorker = async (limit = Infinity) => {
    let handled = 0;
    while (cursor < items.length && handled < limit) {
      handled += 1;
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { ok: true, value: await worker(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
      onSettled?.(index);
      flush();
    }
  };

  const workers = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length));
  if (!options.soloFirst || workers === 1) {
    await Promise.all(Array.from({ length: workers }, () => runWorker()));
    return;
  }

  // ★ 첫 한 장은 혼자 한다 (J-1b-2). 처음부터 여럿이 붙으면 그 둘이 서로 경합해
  // **둘 다 늦게** 끝나고, 첫 숫자가 뜨기까지 한 장이 아니라 두 장 몫을 기다린다
  // (실측: 한 장 289~330ms 인데 첫 숫자는 569~762ms 에 떴다).
  // 첫 장이 끝난 뒤에 나머지가 붙는다 — 전체 시간은 거의 그대로다.
  await runWorker(1);
  if (cursor >= items.length) return;
  await Promise.all(Array.from({ length: workers }, () => runWorker()));
}
