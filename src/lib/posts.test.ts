import { describe, it, expect } from 'vitest';
import { collectTags, formatDate, countLabel } from './posts';

const post = (tags: string[]) => ({ data: { tags } }) as never;

describe('collectTags', () => {
  it('counts occurrences across posts', () => {
    const result = collectTags([post(['linux', 'perf']), post(['linux'])]);
    expect(result).toEqual([
      { tag: 'linux', count: 2 },
      { tag: 'perf', count: 1 },
    ]);
  });

  it('sorts by count desc then tag asc', () => {
    const result = collectTags([post(['b', 'a']), post(['c']), post(['c'])]);
    expect(result.map((t) => t.tag)).toEqual(['c', 'a', 'b']);
  });

  it('returns an empty array for no posts', () => {
    expect(collectTags([])).toEqual([]);
  });
});

describe('formatDate', () => {
  it('renders the middot format used across the chrome', () => {
    expect(formatDate(new Date('2026-07-12T00:00:00Z'))).toBe('2026·07·12');
  });

  it('zero-pads single-digit months and days', () => {
    expect(formatDate(new Date('2026-01-05T00:00:00Z'))).toBe('2026·01·05');
  });
});

describe('countLabel', () => {
  it('singular case', () => {
    expect(countLabel(1, 'post')).toBe('1 post');
  });

  it('plural case', () => {
    expect(countLabel(3, 'post')).toBe('3 posts');
  });

  it('zero case', () => {
    expect(countLabel(0, 'post')).toBe('0 posts');
  });

  it('works with different nouns', () => {
    expect(countLabel(1, 'tag')).toBe('1 tag');
  });
});
