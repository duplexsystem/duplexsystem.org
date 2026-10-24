import { describe, expect, it } from 'vitest';
import { runnableBlocks } from './remark-runnable.mjs';

describe('runnableBlocks', () => {
  it('finds C and asm fences that have run="..."', () => {
    const post = [
      '```c run="f(1)"',
      'int f(int x) { return x; }',
      '```',
      '```c',
      'int plain;',
      '```',
      '```asm run="rdi=1"',
      'mov rax, rdi',
      '```',
      '',
    ].join('\n');
    expect(runnableBlocks(post)).toEqual([
      { lang: 'c', source: 'int f(int x) { return x; }' },
      { lang: 'asm', source: 'mov rax, rdi' },
    ]);
  });

  it('copes with CRLF', () => {
    const post = '```c run="f(1)"\r\nint f(int x) { return x; }\r\n```\r\n';
    expect(runnableBlocks(post)).toHaveLength(1);
  });
});
