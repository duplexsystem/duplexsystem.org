import { describe, expect, it } from 'vitest';
import {
  findTable,
  flagShows,
  inputRows,
  parseNumber,
  parseRun,
  splitOperands,
} from './runnable-asm-common.mjs';

describe('findTable', () => {
  const src = 'static const int tab[4] = { 1, 2, 3, 4 };\nint xtab[2] = { 9, 9 };';
  it('finds a table by exact name', () => {
    expect(findTable('tab', [src])).toBe('const int tab[4] = { 1, 2, 3, 4 };');
    expect(findTable('xtab', [src])).toBe('int xtab[2] = { 9, 9 };');
  });
  it('treats regex metacharacters in a symbol literally', () => {
    expect(findTable('t.b', [src])).toBeNull();
    expect(findTable('a$', [src])).toBeNull();
    expect(findTable('(', [src])).toBeNull();
  });
  it('skips a table shown in part, for the full one in an earlier block', () => {
    const full = 'int f(void) {\n  static int d[3] = {19, 19, 18};\n  return 0;\n}';
    const part = 'static int d[3] = {19, /* ... */};';
    expect(findTable('d', [full, part])).toBe('int d[3] = {19, 19, 18};');
    expect(findTable('d', [part])).toBeNull();
  });
});

describe('parseNumber', () => {
  it('reads decimal and 0x, with a sign', () => {
    expect(parseNumber('42')).toBe(42n);
    expect(parseNumber('-0x10')).toBe(-16n);
    expect(parseNumber('+7')).toBe(7n);
    expect(parseNumber('rax')).toBeNull();
  });
  it('reads a trailing h (Intel) or a leading # (AArch64) only when asked', () => {
    expect(parseNumber('1ah', { suffix: true })).toBe(26n);
    expect(parseNumber('1ah')).toBeNull();
    expect(parseNumber('#-5', { hash: true })).toBe(-5n);
    expect(parseNumber('#5')).toBeNull();
  });
});

describe('splitOperands', () => {
  it('splits on commas outside brackets', () => {
    expect(splitOperands('x2, [x2, w3, sxtw 3]')).toEqual(['x2', '[x2, w3, sxtw 3]']);
    expect(splitOperands('')).toEqual([]);
  });
});

describe('flagShows', () => {
  it('puts a flag on the nearest earlier instruction that sets flags', () => {
    const insns = [{ sets: true }, { sets: true }, { sets: false }, { reads: ['CF', 'ZF'] }];
    const shows = flagShows(
      insns,
      (i) => i.reads ?? [],
      (i) => i.sets,
    );
    expect([...shows]).toEqual([[1, ['CF', 'ZF']]]);
  });
});

describe('inputRows and parseRun', () => {
  it('gives one row per edge case, or pairs of the first few', () => {
    expect(inputRows(0, false)).toEqual([[]]);
    expect(inputRows(1, true).every((r) => r.length === 1 && r[0] !== 0n)).toBe(true);
    expect(inputRows(2, false)).toHaveLength(3600);
  });
  it('names the ISA in its messages', () => {
    const isa = {
      lang: 'arm64',
      regs: new Map([['x0', { reg: 0, w: 8 }]]),
      args: [0],
      argNames: 'x0',
      example: 'x0=1',
    };
    expect(() => parseRun('f(1, 2)', isa)).toThrow(/runnable arm64: at most 1 arguments/);
    expect(() => parseRun('nonsense', isa)).toThrow(/run="x0=1"/);
  });
});
