import { describe, expect, it } from 'vitest';
import { includeDrafts, isDraft } from './drafts';

describe('includeDrafts', () => {
  it('accepts explicit opt-ins', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', ' 1 ']) expect(includeDrafts(v)).toBe(true);
  });

  it('treats unset, empty and negative values as off', () => {
    for (const v of [undefined, '', '0', 'false', 'no', 'off', '2']) {
      expect(includeDrafts(v)).toBe(false);
    }
  });
});

describe('isDraft', () => {
  it('ignores a draft: true quoted in the body', () => {
    const post = '---\ntitle: x\n---\nSet:\n\n```yaml\ndraft: true\n---\n```\n';
    expect(isDraft(post)).toBe(false);
  });

  it('reads only the frontmatter block', () => {
    expect(isDraft('---\ntitle: x\ndraft: true\n---\nbody')).toBe(true);
    expect(isDraft('---\r\ndraft: true\r\n---\r\nbody')).toBe(true);
    expect(isDraft('---\ndraft: false\n---\nwrites about\ndraft: true\n')).toBe(false);
    expect(isDraft('no frontmatter\ndraft: true')).toBe(false);
  });
});
