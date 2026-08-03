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
 */
export async function runOrderedPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onReady: (result: PoolResult<R>, index: number) => void,
  onSettled?: (index: number) => void,
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

  const runWorker = async () => {
    while (cursor < items.length) {
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
  await Promise.all(Array.from({ length: workers }, () => runWorker()));
}
