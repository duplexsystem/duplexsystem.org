import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  armCalls,
  buildArmRunnable,
  buildSharedArm,
  parseArm,
  parseArmRun,
} from './runnable-arm.mjs';
import { findSysroot } from './runnable.mjs';

let toolchain = true;
try {
  findSysroot();
} catch {
  toolchain = false;
}

const TABLES = `static const uint64_t pow10_rev[21] = {
    10000000000000000000ULL, 1000000000000000000, 100000000000000000, 10000000000000000,
    1000000000000000, 100000000000000, 10000000000000, 1000000000000, 100000000000,
    10000000000, 1000000000, 100000000, 10000000, 1000000, 100000, 10000, 1000, 100, 10, 1, 0
};

static const uint64_t pow10_lz[65] = {
    10000000000000000000ULL, 10000000000000000000ULL, 10000000000000000000ULL,
    10000000000000000000ULL, 1000000000000000000, 1000000000000000000, 1000000000000000000,
    100000000000000000, 100000000000000000, 100000000000000000, 10000000000000000,
    10000000000000000, 10000000000000000, 1000000000000000, 1000000000000000, 1000000000000000,
    100000000000000, 100000000000000, 100000000000000, 100000000000000, 10000000000000,
    10000000000000, 10000000000000, 1000000000000, 1000000000000, 1000000000000, 100000000000,
    100000000000, 100000000000, 10000000000, 10000000000, 10000000000, 1000000000, 1000000000,
    1000000000, 1000000000, 100000000, 100000000, 100000000, 10000000, 10000000, 10000000,
    1000000, 1000000, 1000000, 100000, 100000, 100000, 10000, 10000, 10000, 10000, 1000, 1000,
    1000, 100, 100, 100, 10, 10, 10, 1, 1, 1, 0
};`;
const LEMIRE_TABLES = `static const int digits[65] = {19, 19, 19, 19, 18, 18, 18, 17, 17, 17, 16, 16, 16, 16, 15, 15, 15, 14, 14, 14, 13, 13, 13, 13, 12, 12, 12, 11, 11, 11, 10, 10, 10, 10, 9, 9, 9, 8, 8, 8, 7, 7, 7, 7, 6, 6, 6, 5, 5, 5, 4, 4, 4, 4, 3, 3, 3, 2, 2, 2, 1, 1, 1, 1, 1};
static const uint64_t table[65] = {9999999999999999999ULL, 9999999999999999999ULL, 9999999999999999999ULL, 9999999999999999999ULL, 999999999999999999ULL, 999999999999999999ULL, 999999999999999999ULL, 99999999999999999ULL, 99999999999999999ULL, 99999999999999999ULL, 9999999999999999ULL, 9999999999999999ULL, 9999999999999999ULL, 9999999999999999ULL, 999999999999999ULL, 999999999999999ULL, 999999999999999ULL, 99999999999999ULL, 99999999999999ULL, 99999999999999ULL, 9999999999999ULL, 9999999999999ULL, 9999999999999ULL, 9999999999999ULL, 999999999999ULL, 999999999999ULL, 999999999999ULL, 99999999999ULL, 99999999999ULL, 99999999999ULL, 9999999999ULL, 9999999999ULL, 9999999999ULL, 9999999999ULL, 999999999ULL, 999999999ULL, 999999999ULL, 99999999ULL, 99999999ULL, 99999999ULL, 9999999ULL, 9999999ULL, 9999999ULL, 9999999ULL, 999999ULL, 999999ULL, 999999ULL, 99999ULL, 99999ULL, 99999ULL, 9999ULL, 9999ULL, 9999ULL, 9999ULL, 999ULL, 999ULL, 999ULL, 99ULL, 99ULL, 99ULL, 9ULL, 9ULL, 9ULL, 9ULL, 9ULL};`;

const HYBRID = `adrp	x1, pow10_lz
clz	x3, x0
add	x2, x1, :lo12:pow10_lz
add	x1, x3, x3, lsl 2
ldr	x2, [x2, w3, sxtw 3]
mov	x3, 19
sub	x1, x3, x1, lsr 4
cmp	x2, x0
cset	x0, hi
sub	x0, x1, x0
ret`;
const FOLD = `adrp	x1, pow10_rev
mov	x2, 19
add	x3, x1, :lo12:pow10_rev
clz	x1, x0
add	x1, x1, x1, lsl 2
lsr	x1, x1, 4
ldr	x3, [x3, x1, lsl 3]
sub	x1, x2, x1
cmp	x3, x0
cset	x0, hi
sub	x0, x1, x0
ret`;
const LEMIRE = `adrp	x1, table
clz	x3, x0
add	x2, x1, :lo12:table
adrp	x1, digits
ldr	x2, [x2, w3, sxtw 3]
add	x1, x1, :lo12:digits
ldr	w1, [x1, w3, sxtw 2]
cmp	x0, x2
cinc	w0, w1, hi
ret`;
const CLANG_HYBRID = `clz	x8, x0
add	x9, x8, x8, lsl #2
adrp	x10, pow10_lz
add	x10, x10, :lo12:pow10_lz
ldr	x8, [x10, x8, lsl #3]
cmp	x0, x8
csetm	x8, lo
sub	x8, x8, x9, lsr #4
add	x0, x8, #19
ret`;

async function shared(built, cacheDir) {
  const lib = buildSharedArm(built.spec.arm64, { cacheDir });
  return lib ? (await WebAssembly.instantiate(readFileSync(lib.path), {})).instance.exports : {};
}

async function run(source, args, cSources = [TABLES], call = `f(${args.join(', ')})`) {
  const cacheDir = mkdtempSync(join(tmpdir(), 'asm-test-'));
  try {
    const built = buildArmRunnable(source, call, { cacheDir, cSources });
    const events = [];
    const name = (i) => (i < 0 ? 'return' : built.spec.names[i]);
    const rec = (l, i, v) => events.push(`${name(i)}=${v}`);
    const rt = {
      line: (l) => events.push(`L${l}`),
      u64: rec,
      r64: rec,
      r32: rec,
      fault: (l) => {
        throw new Error(`fault on line ${l}`);
      },
    };
    const arm64 = await shared(built, cacheDir);
    const { instance } = await WebAssembly.instantiate(readFileSync(built.wasmPath), { rt, arm64 });
    const result = BigInt.asUintN(64, instance.exports[built.spec.fn](...args.map(BigInt)));
    return { built, events, result };
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
}

async function runRows(source, rows) {
  const cacheDir = mkdtempSync(join(tmpdir(), 'asm-test-'));
  try {
    const built = buildArmRunnable(source, 'f(0, 0)', { cacheDir, cSources: [] });
    const rt = { line() {}, u64() {}, r64() {}, r32() {}, fault() {} };
    const arm64 = await shared(built, cacheDir);
    const { instance } = await WebAssembly.instantiate(readFileSync(built.wasmPath), { rt, arm64 });
    return rows.map((r) => BigInt.asUintN(64, instance.exports.f(...r)));
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
}

const ilog10 = (x) => BigInt(x.toString().length - 1);
const EDGES = [
  1n,
  9n,
  10n,
  99n,
  100n,
  1233n,
  2n ** 32n,
  2n ** 63n,
  10n ** 19n - 1n,
  10n ** 19n,
  2n ** 64n - 1n,
];

describe('parseArm', () => {
  it('reads GCC and Clang syntax: shifted and extended operands, :lo12:, # or not', () => {
    const insns = parseArm(HYBRID);
    expect(insns.map((i) => i.op)).toEqual([
      'adrp',
      'clz',
      'add',
      'add',
      'ldr',
      'mov',
      'sub',
      'cmp',
      'cset',
      'sub',
      'ret',
    ]);
    expect(insns[3].operands[2].mod).toEqual({ kind: 'lsl', amount: 2 });
    expect(insns[4].operands[1]).toMatchObject({ kind: 'mem', base: 2, ext: 'sxtw', scale: 3 });
    expect(parseArm(CLANG_HYBRID)[7].operands[2].mod).toEqual({ kind: 'lsr', amount: 4 });
  });
  it('names the instruction it has no implementation of', () => {
    expect(() => parseArm('fmadd d0, d1, d2, d3')).toThrow(/no AArch64 implementation of fmadd/);
  });
});

describe('parseArmRun', () => {
  it('reads x0 to x7, or a call', () => {
    expect(parseArmRun('x0=1233, x1=2').inputs.map((i) => i.reg)).toEqual([0, 1]);
    expect(parseArmRun('ilog10(5)')).toMatchObject({ fn: 'ilog10', registers: false });
    expect(() => parseArmRun('x9=1')).toThrow(/x0 to x7/);
  });
});

describe.skipIf(!toolchain)('buildArmRunnable', () => {
  it("runs the hybrid, the fold and Clang's hybrid, matching ilog10 at the edges", async () => {
    for (const src of [HYBRID, FOLD, CLANG_HYBRID]) {
      for (const x of EDGES) expect((await run(src, [x])).result).toBe(ilog10(x));
      expect((await run(src, [0n])).result).toBe(2n ** 64n - 1n);
    }
  }, 300_000);

  it("runs Lemire's listing (a digit count, from two tables, w registers)", async () => {
    for (const x of EDGES) {
      expect((await run(LEMIRE, [x], [LEMIRE_TABLES])).result).toBe(ilog10(x) + 1n);
    }
  }, 300_000);

  it('reports registers as written and the flags a condition reads', async () => {
    const { events, built } = await run(HYBRID, [1233n], [TABLES], 'x0=1233');
    expect(built.spec.ret.name).toBe('x0');
    expect(events).toContain('x3=53');
    expect(events).toContain('C=0');
    expect(events).toContain('Z=0');
    expect(events.at(-1)).toBe('return=3');
  }, 120_000);

  it('borrows the AArch64 way: sbc subtracts NOT carry, csel and cinc pick', async () => {
    const sbc = 'mov x1, 10\nmov x2, 3\nmov x3, 5\ncmp x3, 7\nsbc x0, x1, x2\nret';
    expect((await run(sbc, [], [])).result).toBe(6n);
    const csel = 'cmp x0, x1\ncsel x0, x0, x1, hi\ncinc x0, x0, ls\nret';
    expect((await run(csel, [9n, 4n], [])).result).toBe(9n);
    expect((await run(csel, [3n, 4n], [])).result).toBe(5n);
  }, 120_000);

  it('keeps w registers to 32 bits, and builds constants with movz/movk', async () => {
    const w = 'add w0, w0, w1\nret';
    expect((await run(w, [0xffffffffn, 2n], [])).result).toBe(1n);
    const k = 'movz x0, 0x1234, lsl 16\nmovk x0, 0x5678\nret';
    expect((await run(k, [], [])).result).toBe(0x12345678n);
  }, 120_000);

  it('stops at a read outside the table', async () => {
    await expect(
      run('adrp x1, pow10_rev\nadd x1, x1, :lo12:pow10_rev\nldr x0, [x1, x0, lsl 3]\nret', [21n]),
    ).rejects.toThrow(/fault on line 3/);
  }, 120_000);

  it('sign-extends from the low bits, whatever is above them', async () => {
    const r = (src, x) => run(src, [x], []).then((v) => v.result);
    expect(await r('sxtb x0, w0\nret', 0x12345681n)).toBe(2n ** 64n - 127n);
    expect(await r('sxth x0, w0\nret', 0x12348001n)).toBe(2n ** 64n - 0x7fffn);
    expect(await r('sxtw x0, w0\nret', 0x1_8000_0000n)).toBe(2n ** 64n - 2n ** 31n);
    expect(await r('sxtb w0, w0\nret', 0x1ffn)).toBe(0xffffffffn);
  }, 120_000);

  it('shifts an immediate: add x0, x1, #1, lsl 12', async () => {
    expect((await run('add x0, x0, #1, lsl 12\nret', [5n], [])).result).toBe(4101n);
    expect((await run('sub x0, x0, #1, lsl #12\nret', [5000n], [])).result).toBe(904n);
  }, 120_000);

  it('sdiv of the most negative number by -1 gives the most negative number', async () => {
    const min = 2n ** 63n;
    expect((await run('sdiv x0, x0, x1\nret', [min, 2n ** 64n - 1n], [])).result).toBe(min);
    expect((await run('sdiv w0, w0, w1\nret', [2n ** 31n, 2n ** 32n - 1n], [])).result).toBe(
      2n ** 31n,
    );
  }, 120_000);

  it('loads from [x, :lo12:table]; only :got_lo12: gives the table its address', async () => {
    const load = 'adrp x1, pow10_rev\nldr x0, [x1, :lo12:pow10_rev]\nret';
    expect((await run(load, [], [TABLES])).result).toBe(10n ** 19n);
    const got = 'adrp x1, :got:pow10_rev\nldr x1, [x1, :got_lo12:pow10_rev]\nldr x0, [x1, 8]\nret';
    expect((await run(got, [], [TABLES])).result).toBe(10n ** 18n);
  }, 120_000);

  it('refuses post-indexed addressing, which would silently not move the base', () => {
    expect(() =>
      buildArmRunnable('adrp x1, pow10_rev\nldr x0, [x1], 8\nret', 'f()', { cSources: [TABLES] }),
    ).toThrow(/post-indexed/);
  });

  it('loads every size, sign- or zero-extending, with immediate, register and extended offsets', async () => {
    const t = 'static const int tab[4] = { -2, 0x7f80ff81, 3, -0x80000000 };';
    const ld = async (insn, base = '') =>
      (await run(`adrp x1, tab\nadd x1, x1, :lo12:tab\n${base}${insn}\nret`, [2n, 0n], [t])).result;
    const u = (v) => BigInt.asUintN(64, v);
    const w = (v) => BigInt.asUintN(32, v);
    expect(await ld('ldr w0, [x1, 4]')).toBe(0x7f80ff81n);
    expect(await ld('ldr x0, [x1, 8]')).toBe(0x8000_0000_0000_0003n);
    expect(await ld('ldrb w0, [x1, 5]')).toBe(0xffn);
    expect(await ld('ldrh w0, [x1, 6]')).toBe(0x7f80n);
    expect(await ld('ldrsb x0, [x1, 5]')).toBe(u(-1n));
    expect(await ld('ldrsb w0, [x1, 4]')).toBe(w(-127n));
    expect(await ld('ldrsh x0, [x1, 4]')).toBe(u(-127n));
    expect(await ld('ldrsh w0, [x1, 6]')).toBe(0x7f80n);
    expect(await ld('ldrsw x0, [x1, 12]')).toBe(u(-0x80000000n));
    expect(await ld('ldr w0, [x1, x0, lsl 2]')).toBe(3n);
    expect(await ld('ldrsw x0, [x1, w0, sxtw 2]')).toBe(3n);
    expect(await ld('ldr w0, [x1, w0, uxtw 2]')).toBe(3n);
    expect(await ld('ldr w0, [x1, x0, lsl 2]', 'add x1, x1, 8\nsub x0, x0, 2\n')).toBe(3n);
    expect(await ld('ldr w0, [x1, -4]', 'add x1, x1, 8\n')).toBe(0x7f80ff81n);
  }, 120_000);

  const u = (v) => BigInt.asUintN(64, v);
  const w = (v) => BigInt.asUintN(32, v);
  const sg = (v) => BigInt.asIntN(64, v);
  const sw = (v) => BigInt.asIntN(32, v);
  const clz = (v, bits) => BigInt(bits - (v === 0n ? 0 : v.toString(2).length));
  const ror = (v, n, bits) => {
    const m = (1n << BigInt(bits)) - 1n;
    n = BigInt(n) % BigInt(bits);
    return n ? ((v >> n) | (v << (BigInt(bits) - n))) & m : v;
  };
  const BIG = 0x8000_0000_dead_beefn;
  const INPUTS = [
    [0n, 0n],
    [1n, 2n],
    [5n, 3n],
    [0x80n, 0xffn],
    [0x1234_5678n, 31n],
    [0xffff_ffffn, 1n],
    [0x8000_0000n, u(-1n)],
    [BIG, 67n],
    [u(-5n), 3n],
    [2n ** 63n, 1n],
    [2n ** 64n - 1n, 2n ** 64n - 1n],
  ];
  const FAMILIES = {
    'shifts by register, 32 and 64 bits': [
      ['lsl x0, x0, x1\nret', (a, b) => u(a << (b % 64n))],
      ['lsr x0, x0, x1\nret', (a, b) => a >> (b % 64n)],
      ['asr x0, x0, x1\nret', (a, b) => u(sg(a) >> (b % 64n))],
      ['ror x0, x0, x1\nret', (a, b) => ror(a, b, 64)],
      ['lsl w0, w0, w1\nret', (a, b) => w(a << (b % 32n))],
      ['lsr w0, w0, w1\nret', (a, b) => w(a) >> (b % 32n)],
      ['asr w0, w0, w1\nret', (a, b) => w(sw(a) >> (b % 32n))],
      ['ror w0, w0, w1\nret', (a, b) => ror(w(a), b, 32)],
      ['asr x0, x0, 63\nret', (a) => u(sg(a) >> 63n)],
      ['ror w0, w0, 5\nret', (a) => ror(w(a), 5, 32)],
      ['lsl w0, w0, 31\nret', (a) => w(a << 31n)],
    ],
    'shifted and extended operands': [
      ['add x0, x0, x1, lsl 3\nret', (a, b) => u(a + (b << 3n))],
      ['sub x0, x0, x1, lsr 3\nret', (a, b) => u(a - (b >> 3n))],
      ['sub x0, x0, x1, asr 3\nret', (a, b) => u(a - (sg(b) >> 3n))],
      ['orr x0, x0, x1, ror 8\nret', (a, b) => a | ror(b, 8, 64)],
      ['eor w0, w0, w1, ror 8\nret', (a, b) => w(a) ^ ror(w(b), 8, 32)],
      ['add x0, x0, w1, sxtw\nret', (a, b) => u(a + sw(b))],
      ['add x0, x0, w1, sxtw 2\nret', (a, b) => u(a + (sw(b) << 2n))],
      ['add x0, x0, w1, uxtw 2\nret', (a, b) => u(a + (w(b) << 2n))],
      ['add x0, x0, w1, uxtb\nret', (a, b) => u(a + (b & 0xffn))],
      ['add x0, x0, w1, sxtb 1\nret', (a, b) => u(a + (BigInt.asIntN(8, b) << 1n))],
      ['sub x0, x0, w1, sxth\nret', (a, b) => u(a - BigInt.asIntN(16, b))],
      ['add w0, w0, w1, uxth 1\nret', (a, b) => w(a + ((b & 0xffffn) << 1n))],
      ['cmp x0, w1, sxtw\ncset x0, lt\nret', (a, b) => (sg(a) < sw(b) ? 1n : 0n)],
    ],
    'flags of 32- and 64-bit arithmetic': [
      ...[
        'eq',
        'ne',
        'cs',
        'cc',
        'mi',
        'pl',
        'vs',
        'vc',
        'hi',
        'ls',
        'ge',
        'lt',
        'gt',
        'le',
      ].flatMap((c) => {
        const model = {
          eq: (a, b) => a === b,
          ne: (a, b) => a !== b,
          cs: (a, b) => a >= b,
          cc: (a, b) => a < b,
          hi: (a, b) => a > b,
          ls: (a, b) => a <= b,
          ge: (a, b, s) => s(a) >= s(b),
          lt: (a, b, s) => s(a) < s(b),
          gt: (a, b, s) => s(a) > s(b),
          le: (a, b, s) => s(a) <= s(b),
          mi: (a, b, s) => s(a - b) < 0n,
          pl: (a, b, s) => s(a - b) >= 0n,
          vs: (a, b, s) => s(a) - s(b) !== s(a - b),
          vc: (a, b, s) => s(a) - s(b) === s(a - b),
        }[c];
        return [
          [`cmp x0, x1\ncset x0, ${c}\nret`, (a, b) => (model(a, b, sg) ? 1n : 0n)],
          [`cmp w0, w1\ncset w0, ${c}\nret`, (a, b) => (model(w(a), w(b), sw) ? 1n : 0n)],
        ];
      }),
      ['cmn x0, x1\ncset x0, cs\nret', (a, b) => ((a + b) >> 64n ? 1n : 0n)],
      ['cmn w0, w1\ncset w0, cs\nret', (a, b) => ((w(a) + w(b)) >> 32n ? 1n : 0n)],
      ['cmp w0, 0\ncset w0, mi\nret', (a) => (w(a) >> 31n ? 1n : 0n)],
      ['tst x0, x1\ncset x0, eq\nret', (a, b) => ((a & b) === 0n ? 1n : 0n)],
      ['tst w0, 0x80000000\ncset w0, ne\nret', (a) => (w(a) >> 31n ? 1n : 0n)],
      [
        'ands x0, x0, x1\ncset x2, mi\nadd x0, x0, x2\nret',
        (a, b) => u((a & b) + ((a & b) >> 63n)),
      ],
      [
        'adds w0, w0, w1\ncset w2, cs\nadd w0, w0, w2, lsl 1\nret',
        (a, b) => w(w(a) + w(b) + (((w(a) + w(b)) >> 32n) << 1n)),
      ],
      [
        'subs x0, x0, x1\ncset x2, vs\nadd x0, x0, x2\nret',
        (a, b) => u(a - b + (sg(a) - sg(b) !== sg(a - b) ? 1n : 0n)),
      ],
      ['negs x0, x0\ncset x1, cc\nadd x0, x0, x1\nret', (a) => u(-a + (a === 0n ? 0n : 1n))],
      [
        'negs w0, w0\ncset w1, vs\nadd w0, w0, w1\nret',
        (a) => w(-w(a) + (w(a) === 0x8000_0000n ? 1n : 0n)),
      ],
    ],
    'add and subtract with carry': [
      ['adds x2, x0, x1\nadc x0, xzr, xzr\nret', (a, b) => (a + b) >> 64n],
      ['subs x2, x0, x1\nsbc x0, xzr, xzr\nret', (a, b) => (a >= b ? 0n : u(-1n))],
      ['adds w2, w0, w1\nadc w0, wzr, wzr\nret', (a, b) => (w(a) + w(b)) >> 32n],
      [
        'subs w2, w0, w1\nsbcs w0, w0, w1\nret',
        (a, b) => w(w(a) - w(b) - (w(a) >= w(b) ? 0n : 1n)),
      ],
      [
        'cmp x0, x1\nadcs x0, x0, x1\ncset x1, cs\nadd x0, x0, x1\nret',
        (a, b) => u(a + b + (a >= b ? 1n : 0n) + ((a + b + (a >= b ? 1n : 0n)) >> 64n)),
      ],
    ],
    moves: [
      [
        'movz x0, 0xbeef, lsl 16\nmovk x0, 0xdead, lsl 32\nmovk x0, 0x8000, lsl 48\nmovk x0, 0xbeef\nret',
        () => 0x8000_dead_beef_beefn,
      ],
      ['movn x0, 0x1234, lsl 16\nret', () => u(~(0x1234n << 16n))],
      ['movn w0, 0x1234\nret', () => w(~0x1234n)],
      ['movz w0, 0xffff, lsl 16\nmovk w0, 0x5, lsl 0\nret', () => 0xffff_0005n],
      ['mov w0, w1\nret', (a, b) => w(b)],
      ['mov x0, -2\nret', () => u(-2n)],
      ['mov w0, -2\nret', () => w(-2n)],
      ['mvn x0, x1\nret', (a, b) => u(~b)],
      ['mvn w0, w1, lsl 4\nret', (a, b) => w(~(w(b) << 4n))],
    ],
    logic: [
      ['and x0, x0, x1\nret', (a, b) => a & b],
      ['bic x0, x0, x1\nret', (a, b) => a & u(~b)],
      ['orn x0, x0, x1\nret', (a, b) => a | u(~b)],
      ['eon x0, x0, x1\nret', (a, b) => a ^ u(~b)],
      ['bic w0, w0, w1\nret', (a, b) => w(a) & w(~b)],
      ['orn w0, w0, w1\nret', (a, b) => w(w(a) | w(~b))],
      ['and w0, w0, 0xff00ff\nret', (a) => w(a) & 0xff00ffn],
      ['eor x0, x0, 0xaaaaaaaaaaaaaaaa\nret', (a) => a ^ 0xaaaa_aaaa_aaaa_aaaan],
      ['neg x0, x0\nret', (a) => u(-a)],
      ['neg w0, w0, lsl 2\nret', (a) => w(-(w(a) << 2n))],
    ],
    'multiply and divide': [
      ['mul x0, x0, x1\nret', (a, b) => u(a * b)],
      ['mul w0, w0, w1\nret', (a, b) => w(w(a) * w(b))],
      ['mneg x0, x0, x1\nret', (a, b) => u(-a * b)],
      ['madd x0, x0, x1, x0\nret', (a, b) => u(a * b + a)],
      ['msub x0, x0, x1, x0\nret', (a, b) => u(a - a * b)],
      ['msub w0, w0, w1, w1\nret', (a, b) => w(w(b) - w(a) * w(b))],
      ['umulh x0, x0, x1\nret', (a, b) => (a * b) >> 64n],
      ['smulh x0, x0, x1\nret', (a, b) => u((sg(a) * sg(b)) >> 64n)],
      ['udiv x0, x0, x1\nret', (a, b) => (b ? a / b : 0n)],
      ['udiv w0, w0, w1\nret', (a, b) => (w(b) ? w(a) / w(b) : 0n)],
      ['sdiv x0, x0, x1\nret', (a, b) => (b ? u(sg(a) / sg(b)) : 0n)],
      ['sdiv w0, w0, w1\nret', (a, b) => (w(b) ? w(sw(a) / sw(b)) : 0n)],
    ],
    'conditional select': [
      ['cmp x0, x1\ncsel x0, x0, x1, lo\nret', (a, b) => (a < b ? a : b)],
      ['cmp w0, w1\ncsel w0, w0, w1, gt\nret', (a, b) => (sw(a) > sw(b) ? w(a) : w(b))],
      ['cmp x0, x1\ncsinc x0, x0, x1, hi\nret', (a, b) => (a > b ? a : u(b + 1n))],
      ['cmp w0, w1\ncsinc w0, w0, w1, hi\nret', (a, b) => (w(a) > w(b) ? w(a) : w(w(b) + 1n))],
      ['cmp x0, x1\ncsinv x0, x0, x1, hi\nret', (a, b) => (a > b ? a : u(~b))],
      ['cmp w0, w1\ncsinv w0, w0, w1, hi\nret', (a, b) => (w(a) > w(b) ? w(a) : w(~b))],
      ['cmp x0, x1\ncsneg x0, x0, x1, hi\nret', (a, b) => (a > b ? a : u(-b))],
      ['cmp w0, w1\ncsneg w0, w0, w1, hi\nret', (a, b) => (w(a) > w(b) ? w(a) : w(-b))],
      ['cmp x0, x1\ncinc x0, x0, hi\nret', (a, b) => (a > b ? u(a + 1n) : a)],
      ['cmp w0, w1\ncinv w0, w0, hi\nret', (a, b) => (w(a) > w(b) ? w(~a) : w(a))],
      ['cmp x0, x1\ncneg x0, x0, hi\nret', (a, b) => (a > b ? u(-a) : a)],
      ['cmp w0, w1\ncneg w0, w0, hi\nret', (a, b) => (w(a) > w(b) ? w(-a) : w(a))],
      ['cmp x0, x1\ncsetm x0, lo\nret', (a, b) => (a < b ? u(-1n) : 0n)],
      ['cmp w0, w1\ncsetm w0, lo\nret', (a, b) => (w(a) < w(b) ? w(-1n) : 0n)],
      ['cmp x0, 0\ncsel x0, xzr, x1, eq\nret', (a, b) => (a === 0n ? 0n : b)],
    ],
    'extension and counting': [
      ['sxtb x0, w0\nret', (a) => u(BigInt.asIntN(8, a))],
      ['sxth x0, w0\nret', (a) => u(BigInt.asIntN(16, a))],
      ['sxtw x0, w0\nret', (a) => u(sw(a))],
      ['sxtb w0, w0\nret', (a) => w(BigInt.asIntN(8, a))],
      ['sxth w0, w0\nret', (a) => w(BigInt.asIntN(16, a))],
      ['uxtb w0, w0\nret', (a) => a & 0xffn],
      ['uxth w0, w0\nret', (a) => a & 0xffffn],
      ['clz x0, x0\nret', (a) => clz(a, 64)],
      ['clz w0, w0\nret', (a) => clz(w(a), 32)],
    ],
  };
  for (const [family, cases] of Object.entries(FAMILIES)) {
    it(`matches the model and qemu: ${family}`, async () => {
      for (const [src, model] of cases) {
        const got = await runRows(src, INPUTS);
        INPUTS.forEach(([a, b], i) => {
          expect(got[i], `${src.replaceAll('\n', '; ')} with x0=${a}, x1=${b}`).toBe(model(a, b));
        });
      }
    }, 600_000);
  }
});

describe('armCalls', () => {
  it('finds exactly the library functions the translation calls', () => {
    const listings = [
      'adds x0, x0, x1\nsbcs x2, x0, x1\ncmn x0, #1\nret',
      'negs x0, x1\ntst x0, #1\nands w2, w0, w1\nret',
      'orr x0, x1, x2, ror 3\nror x0, x0, x1\nclz w3, w0\nret',
      'umulh x0, x0, x1\nsmulh x1, x0, x1\ncmp x0, x1\nadc x0, x0, x1\nret',
      'lsl x0, x0, 2\nand x0, x0, x1\ncsel x0, x0, x1, hi\nret',
    ];
    const cacheDir = mkdtempSync(join(tmpdir(), 'asm-test-'));
    try {
      for (const src of listings) {
        const built = buildArmRunnable(src, 'f(0, 0)', { cacheDir, cSources: [] });
        expect(armCalls(src)).toEqual(built.spec.arm64);
      }
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});
