/**
 * Pure — no DB, no network. Everything ZohoPullService's speedup rests on
 * depends on this doing exactly three things right: never exceeding the
 * concurrency cap, preserving input order regardless of finish order, and
 * not swallowing a worker's error.
 */
import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './concurrency.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('mapWithConcurrency', () => {
  it('preserves result order regardless of which item finishes first', async () => {
    const items = [30, 10, 20, 5];
    const results = await mapWithConcurrency(items, 4, async (ms) => {
      await delay(ms);
      return ms;
    });
    expect(results).toEqual([30, 10, 20, 5]);
  });

  it('never runs more than `limit` workers at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);

    await mapWithConcurrency(items, 3, async (item) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(5);
      inFlight--;
      return item;
    });

    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it('runs every item exactly once', async () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const seen: number[] = [];
    await mapWithConcurrency(items, 6, async (item) => {
      seen.push(item);
      return item;
    });
    expect(seen.slice().sort((a, b) => a - b)).toEqual(items);
  });

  it('propagates a worker error rather than swallowing it', async () => {
    const items = [1, 2, 3];
    await expect(
      mapWithConcurrency(items, 2, async (item) => {
        if (item === 2) throw new Error('boom');
        return item;
      }),
    ).rejects.toThrow('boom');
  });

  it('handles an empty list, and a limit larger than the list', async () => {
    expect(await mapWithConcurrency([], 4, async (x) => x)).toEqual([]);
    expect(await mapWithConcurrency([1, 2], 10, async (x) => x * 2)).toEqual([2, 4]);
  });
});
