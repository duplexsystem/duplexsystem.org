import { availableParallelism } from 'node:os';

export const CONCURRENCY = Math.min(8, availableParallelism());

export async function mapPool(items, fn, limit = CONCURRENCY) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (; next < items.length;) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
