import { describe, expect, it } from 'vitest';
import { pageAll } from '../src/paging';

// an ordered table of `n` rows, read through the same page builder the loaders use
const table = (n: number) => {
  const calls: number[] = [];
  const build = async (from: number, to: number) => {
    calls.push(from);
    const rows = Array.from(
      { length: Math.max(0, Math.min(to, n - 1) - from + 1) },
      (_, i) => from + i,
    );
    return { data: rows, error: null };
  };
  return { build, calls };
};

describe('reading in pages', () => {
  it('reads a small table with one request', async () => {
    const t = table(10);
    expect(await pageAll<number>(t.build, 100)).toHaveLength(10);
    expect(t.calls).toEqual([0]);
  });

  it('reads a large table in order, several pages at a time, and stops at the last', async () => {
    const t = table(1050);
    const rows = await pageAll<number>(t.build, 100, 200_000, 4);
    expect(rows).toEqual(Array.from({ length: 1050 }, (_, i) => i));
    // the first page alone, then batches of four: 100–400, 500–800, 900–1200 (the last batch ends the read)
    expect(t.calls).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200]);
  });

  it('a table of exactly full pages ends on the empty page after it', async () => {
    const t = table(200);
    expect(await pageAll<number>(t.build, 100, 200_000, 2)).toHaveLength(200);
  });

  it('a failed page fails the read', async () => {
    await expect(
      pageAll(async () => ({ data: null, error: { message: 'boom' } }), 100),
    ).rejects.toThrow('boom');
  });
});
