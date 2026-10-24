import { describe, expect, it } from 'vitest';
import { buildRunnable, buildSharedLibc, findSysroot, kindOf, libraryCalls } from './runnable.mjs';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let toolchain = true;
try {
  findSysroot();
} catch {
  toolchain = false;
}

async function trace(source, call, args) {
  const { spec, bytes } = buildRunnable(source, call);
  const events = [];
  const name = (i) => (i < 0 ? 'return' : spec.names[i]);
  const rt = {
    line: (l) => events.push(`L${l}`),
    u64: (l, i, v) => events.push(`${name(i)}=${BigInt.asUintN(64, v)}`),
    i64: (l, i, v) => events.push(`${name(i)}=${v}`),
    f64: (l, i, v) => events.push(`${name(i)}=${v}`),
  };
  const { instance } = await WebAssembly.instantiate(bytes, { rt });
  const result = instance.exports[spec.fn](...args);
  return { spec, events, result };
}

describe('kindOf', () => {
  it('maps C types to wasm value kinds on wasm32', () => {
    expect(kindOf('unsigned long long')).toBe('u64');
    expect(kindOf('long long')).toBe('i64');
    expect(kindOf('unsigned long')).toBe('u32');
    expect(kindOf('const int')).toBe('i32');
    expect(kindOf('double')).toBe('f64');
    expect(kindOf('struct foo')).toBe(null);
  });
});

describe.skipIf(!toolchain)('<stdbit.h> (scripts/include, for a WASI without it)', () => {
  it('runs the folded ilog10 written with stdc_leading_zeros, 0 included', async () => {
    const src = `#include <stdbit.h>
#include <stdint.h>
static const uint64_t pow10_rev[21] = {
    10000000000000000000ULL, 1000000000000000000, 100000000000000000, 10000000000000000,
    1000000000000000, 100000000000000, 10000000000000, 1000000000000, 100000000000,
    10000000000, 1000000000, 100000000, 10000000, 1000000, 100000, 10000, 1000, 100, 10, 1, 0
};
uint64_t ilog10(uint64_t x)
{
    uint64_t e = (stdc_leading_zeros(x) * 5) >> 4;
    return (19 - e) - (x < pow10_rev[e]);
}`;
    const cases = [
      [1n, 0n],
      [9n, 0n],
      [10n, 1n],
      [1233n, 3n],
      [10n ** 19n - 1n, 18n],
      [10n ** 19n, 19n],
      [2n ** 64n - 1n, 19n],
      [0n, 2n ** 64n - 1n],
    ];
    for (const [x, want] of cases) {
      const { result } = await trace(src, 'ilog10(1233)', [x]);
      expect(BigInt.asUintN(64, result)).toBe(want);
    }
  }, 120_000);

  it('gives the C23 answers, by the width of the type, for 0 too', async () => {
    const src = `#include <stdbit.h>
#include <stdint.h>
uint64_t probe(uint64_t k)
{
    switch (k) {
    case 0: return stdc_leading_zeros((uint64_t)0);
    case 1: return stdc_leading_zeros((uint8_t)0);
    case 2: return stdc_leading_zeros((uint8_t)1);
    case 3: return stdc_leading_ones((uint8_t)0xf0);
    case 4: return stdc_trailing_zeros((uint32_t)0);
    case 5: return stdc_trailing_zeros(8ull);
    case 6: return stdc_trailing_ones((uint16_t)0x00ff);
    case 7: return stdc_count_ones(0xffull);
    case 8: return stdc_count_zeros((uint8_t)0x0f);
    case 9: return stdc_bit_width(0ull);
    case 10: return stdc_bit_width(1233ull);
    case 11: return stdc_has_single_bit(64u);
    case 12: return stdc_leading_zeros_ui(1u);
    default: return 999;
    }
}`;
    const want = [64n, 8n, 7n, 4n, 32n, 3n, 8n, 8n, 4n, 0n, 11n, 1n, 31n];
    for (const [k, w] of want.entries()) {
      const { result } = await trace(src, 'probe(0)', [BigInt(k)]);
      expect(BigInt.asUintN(64, result), `case ${k}`).toBe(w);
    }
  }, 120_000);
});

describe.skipIf(!toolchain)('buildRunnable', () => {
  it('reports each line and each variable, with the block’s own line numbers', async () => {
    const src = [
      '#include <stdint.h>',
      'uint64_t f(uint64_t x)',
      '{',
      '    uint64_t y = x * 2;',
      '    y += 1;',
      '    return y;',
      '}',
    ].join('\n');
    const { events, result, spec } = await trace(src, 'f(5)', [5n]);
    expect(result).toBe(11n);
    expect(events.join(' ')).toBe('L2 x=5 L4 y=10 L5 y=11 L6 return=11');
    expect(spec.params).toEqual([{ name: 'x', type: 'uint64_t', kind: 'u64', default: '5' }]);
    expect(spec.ret.kind).toBe('u64');
  });

  it('steps into loops and branches', async () => {
    const src =
      'int g(int n)\n{\n    int s = 0;\n    for (int i = 0; i < n; i++) {\n        s += i;\n    }\n    if (s > 2) {\n        s = -s;\n    }\n    return s;\n}';
    const { events, result } = await trace(src, 'g(3)', [3]);
    expect(result).toBe(-3);
    expect(events.join(' ')).toBe('L1 n=3 L3 s=0 L4 L5 s=0 L5 s=1 L5 s=3 L7 L8 s=-3 L10 return=-3');
  });

  it('links libm from wasi-libc', async () => {
    const src =
      '#define _GNU_SOURCE\n#include <math.h>\ndouble h(double x)\n{\n    return exp10(x);\n}';
    const { result } = await trace(src, 'h(2)', [2]);
    expect(result).toBe(100);
  });

  it('rejects blocks that need I/O, and mismatched defaults', () => {
    const io = '#include <stdio.h>\nint p(int x)\n{\n    printf("%d", x);\n    return x;\n}';
    expect(() => buildRunnable(io, 'p(1)')).toThrow(/cannot provide/);
    expect(() => buildRunnable('int q(int a, int b)\n{\n    return a + b;\n}', 'q(1)')).toThrow(
      /takes 2/,
    );
    expect(() => buildRunnable('int q(int a)\n{\n    return a;\n}', 'nope(1)')).toThrow(
      /does not define/,
    );
  });

  it('shares numeric libm calls through one module, links the rest itself', async () => {
    const src =
      '#define _GNU_SOURCE\n#include <math.h>\n#include <string.h>\ndouble k(double x)\n{\n    char b[8];\n    memset(b, 1, sizeof b);\n    return exp10(x) + sqrt(x * x) + b[3];\n}';
    const calls = libraryCalls(src);
    const cacheDir = mkdtempSync(join(tmpdir(), 'runnable-calls-'));
    try {
      expect(libraryCalls(src, { cacheDir })).toEqual(calls);
      expect(readdirSync(cacheDir).filter((f) => f.startsWith('calls.'))).toHaveLength(1);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
    expect(calls.map((c) => c.name)).toEqual(['exp10', 'sqrt']);
    const dir = mkdtempSync(join(tmpdir(), 'runnable-test-'));
    try {
      const lib = buildSharedLibc(
        calls.map((c) => c.name),
        { cacheDir: dir },
      );
      const libExports = WebAssembly.Module.exports(
        new WebAssembly.Module(readFileSync(lib.path)),
      ).map((e) => e.name);
      expect(libExports).toEqual(expect.arrayContaining(['exp10', 'sqrt']));
      const { bytes, spec } = buildRunnable(src, 'k(2)', { shared: calls });
      expect(spec.libc).toBe(true);
      const imports = WebAssembly.Module.imports(new WebAssembly.Module(bytes));
      expect(
        imports
          .filter((i) => i.module === 'libc')
          .map((i) => i.name)
          .sort(),
      ).toEqual(['exp10', 'sqrt']);
      const libc = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(lib.path)), {})
        .exports;
      const noop = () => {};
      const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
        rt: { line: noop, u64: noop, i64: noop, f64: noop },
        libc,
      });
      expect(inst.exports.k(2)).toBe(100 + 2 + 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
