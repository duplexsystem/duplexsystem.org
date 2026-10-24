import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { parseTableMeta, remarkTableMeta } from './remark-table-meta.mjs';

function tables(md) {
  const proc = unified().use(remarkParse).use(remarkGfm).use(remarkTableMeta);
  const tree = proc.runSync(proc.parse(md), md);
  return tree.children.filter((n) => n.type === 'table');
}

describe('parseTableMeta', () => {
  it('reads a caption alongside title and dir', () => {
    expect(parseTableMeta('Table: title="t" caption="a `note` on 10^19^"')).toEqual({
      title: 't',
      caption: 'a `note` on 10^19^',
    });
  });
  it('reads title and dir like a code fence', () => {
    expect(parseTableMeta('Table: title="[e](https://x.org)" dir="gcc -O2"')).toEqual({
      title: '[e](https://x.org)',
      dir: 'gcc -O2',
    });
    expect(parseTableMeta('| a | b |')).toBe(null);
  });
});

describe('remarkTableMeta', () => {
  const table = '| a | b |\n| --- | --- |\n| 1 | 2 |';

  it('takes a Table: line straight under the table off it, as its bar', () => {
    const [t] = tables(`${table}\nTable: title="C to asm" dir="gcc"\n`);
    expect(t.children).toHaveLength(2);
    expect(t.data.hProperties).toEqual({ dataTitle: 'C to asm', dataDir: 'gcc' });
  });

  it('also takes one after a blank line', () => {
    const md = `${table}\n\nTable: title="x"\n\nAfter.\n`;
    const proc = unified().use(remarkParse).use(remarkGfm).use(remarkTableMeta);
    const tree = proc.runSync(proc.parse(md), md);
    expect(tree.children.map((n) => n.type)).toEqual(['table', 'paragraph']);
    expect(tree.children[0].data.hProperties.dataTitle).toBe('x');
  });

  it('leaves a table without one alone', () => {
    const [t] = tables(`${table}\n`);
    expect(t.children).toHaveLength(2);
    expect(t.data).toBeUndefined();
  });
});

describe('prose that merely starts with "Table:"', () => {
  const table = '| a |\n| - |\n| 1 |';

  it('is not taken for a bar', () => {
    expect(parseTableMeta('Table: 1 shows the totals.')).toBe(null);
    expect(parseTableMeta('Table:')).toBe(null);
    expect(parseTableMeta('Table: title="x" and more')).toBe(null);
    const md = `${table}\n\nTable: 1 shows the totals.\n`;
    const proc = unified().use(remarkParse).use(remarkGfm).use(remarkTableMeta);
    const tree = proc.runSync(proc.parse(md), md);
    expect(tree.children.map((n) => n.type)).toEqual(['table', 'paragraph']);
  });
});
