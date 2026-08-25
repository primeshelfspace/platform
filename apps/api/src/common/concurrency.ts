/**
 * Bounded-concurrency map — runs `worker` over `items` with at most `limit`
 * in flight at once, result order matching `items`' order regardless of
 * finish order.
 *
 * `Promise.all(items.map(worker))` fires every call at once, which is exactly
 * wrong for a rate-limited external API (Zoho, most notably): it just makes
 * every call queue up behind the same limiter instead of overlapping usefully.
 * A plain `for (const item of items) await worker(item)` never overlaps
 * network latency at all — one round trip fully blocks the next, so wall
 * time is round-trip-count × round-trip-latency even though the calls don't
 * depend on each other. `limit` in flight is the middle ground: enough
 * overlap that latency isn't the bottleneck, low enough that a shared rate
 * limiter (see ZohoBooksAdapter.request) still has real work arbitrating
 * rather than everything arriving in one burst.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function runOne(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runOne));
  return results;
}
