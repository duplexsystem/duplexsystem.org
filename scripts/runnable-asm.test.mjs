import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAsmRunnable, buildSharedX86, parseAsm, parseRun, x86Calls } from './runnable-asm.mjs';
import { findSysroot } from './runnable.mjs';

let toolchain = true;
try {
  findSysroot();
} catch {
  toolchain = false;
}

const TABLE = `static const uint64_t pow10[20] = { 1, 10, 100, 1000, 10000, 100000, 1000000,
  10000000, 100000000, 1000000000, 10000000000, 100000000000, 1000000000000,
  10000000000000, 100000000000000, 1000000000000000, 10000000000000000,
  100000000000000000, 1000000000000000000, 10000000000000000000ULL };`;

const GCC = `xor     edx, edx
mov     eax, 64
lzcnt   rdx, rdi
sub     eax, edx
imul    eax, eax, 1233
sar     eax, 12
cmp     rdi, QWORD PTR "pow10"[0+rax*8]
sbb     rax, 0
ret`;

const DIGITS = `lzcnt   rax, rdi   # the bit length, less 64
or      rax, -64
imul    rax, rax, -1233
shr     rax, 12
cmp     rdi, qword ptr [8*rax + pow10]
sbb     rax, -1`;

async function run(source, args, cSources = [TABLE], call = `f(${args.join(', ')})`) {
  const cacheDir = mkdtempSync(join(tmpdir(), 'asm-test-'));
  try {
    const built = buildAsmRunnable(source, call, { cacheDir, cSources });
    const lib = buildSharedX86(built.spec.x86, { cacheDir });
    const libBytes = lib && readFileSync(lib.path);
    const x86 = lib ? (await WebAssembly.instantiate(libBytes, {})).instance.exports : {};
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
    const { instance } = await WebAssembly.instantiate(readFileSync(built.wasmPath), { rt, x86 });
    const result = BigInt.asUintN(64, instance.exports[built.spec.fn](...args.map(BigInt)));
    return { built, events, result, libBytes };
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
}

describe('parseAsm', () => {
  it('reads GCC and Clang Intel syntax, skipping comments, labels and directives', () => {
    const insns = parseAsm(`ilog10:\n\t.cfi_startproc\n${DIGITS}\n`);
    expect(insns.map((i) => i.op)).toEqual(['lzcnt', 'or', 'imul', 'shr', 'cmp', 'sbb']);
    expect(insns[0].line).toBe(3);
    const [, mem] = insns[4].operands;
    expect(mem).toMatchObject({ kind: 'mem', size: 8, symbol: 'pow10', index: 0, scale: 8n });
    const [, gccMem] = parseAsm(GCC)[6].operands;
    expect(gccMem).toMatchObject({ symbol: 'pow10', index: 0, scale: 8n, disp: 0n });
  });

  it('names the instruction it has no implementation of', () => {
    expect(() => parseAsm('popcnt rax, rdi')).toThrow(/no x86 implementation of popcnt/);
  });

  it('lists the library functions a listing calls', () => {
    expect(x86Calls(DIGITS)).toEqual(['imul', 'lzcnt', 'or', 'sbb', 'shr', 'sub']);
  });
});

describe('parseRun', () => {
  it('reads registers, as an assembly reader would write them', () => {
    expect(parseRun('rdi=1233')).toEqual({
      fn: 'run',
      inputs: [{ reg: 7, default: '1233' }],
      registers: true,
    });
    expect(parseRun('rsi = 2, rdi = 10^3').inputs).toEqual([
      { reg: 6, default: '2' },
      { reg: 7, default: '10^3' },
    ]);
  });

  it('reads a call, the arguments going into rdi, rsi, ... in order', () => {
    expect(parseRun('ilog10(42, 7)')).toEqual({
      fn: 'ilog10',
      inputs: [
        { reg: 7, default: '42' },
        { reg: 6, default: '7' },
      ],
      registers: false,
    });
  });

  it('takes only argument registers, each once', () => {
    expect(() => parseRun('rax=1')).toThrow(/argument register/);
    expect(() => parseRun('edi=1')).toThrow(/argument register/);
    expect(() => parseRun('rdi=1, rdi=2')).toThrow(/twice/);
  });
});

describe.skipIf(!toolchain)('buildAsmRunnable', () => {
  it('runs in register form, reporting the result as rax', async () => {
    const { built, events, result } = await run(DIGITS, [8675309], [TABLE], 'rdi=8675309');
    expect(result).toBe(7n);
    expect(built.spec).toMatchObject({
      registers: true,
      params: [{ name: 'rdi', default: '8675309' }],
      ret: { name: 'rax' },
    });
    expect(events.slice(-2)).toEqual(['rax=7', 'return=7']);
  });

  it('checks a listing reading a register other than rdi against the CPU', async () => {
    const { result } = await run('mov rax, rsi\nadd rax, rdx\nret', [5, 9], [], 'rdx=9, rsi=5');
    expect(result).toBe(14n);
  });

  it('runs a listing with its table from a C block, reporting registers as written', async () => {
    const { events, result } = await run(GCC, [42]);
    expect(result).toBe(1n);
    expect(events).toEqual([
      'L1',
      'edx=0',
      'L2',
      'eax=64',
      'L3',
      'rdx=58',
      'L4',
      'eax=6',
      'L5',
      'eax=7398',
      'L6',
      'eax=1',
      'L7',
      'CF=0',
      'L8',
      'rax=1',
      'L9',
      'return=1',
    ]);
  });

  it('gets the edges right, and returns from the last line without a ret', async () => {
    for (const [x, digits] of [
      [9n, 1n],
      [10n, 2n],
      [9999999999999999n, 16n],
      [2n ** 64n - 1n, 20n],
    ]) {
      expect((await run(DIGITS, [x])).result).toBe(digits);
    }
    const { events } = await run(DIGITS, [42]);
    expect(events.slice(-3)).toEqual(['L6', 'rax=2', 'return=2']);
  });

  it('shares one module holding only the instructions used', async () => {
    const { built, libBytes } = await run(DIGITS, [42]);
    expect(built.spec.x86).toEqual(['imul', 'lzcnt', 'or', 'sbb', 'shr', 'sub']);
    const exports = WebAssembly.Module.exports(new WebAssembly.Module(libBytes))
      .map((e) => e.name)
      .filter((n) => n.startsWith('x86_'));
    expect(exports.sort()).toEqual(
      ['flags', 'imul', 'lzcnt', 'or', 'sbb', 'shr', 'sub'].map((n) => `x86_${n}`).sort(),
    );
  });

  it('runs lea as address arithmetic, with and without a table', async () => {
    const tables = `static const uint64_t pow10_rev[21] = {
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
    const fold = `xor eax, eax
lzcnt rax, rdi
lea rdx, [rax+rax*4]
mov eax, 19
shr rdx, 4
sub rax, rdx
cmp rdi, QWORD PTR "pow10_rev"[0+rdx*8]
sbb rax, 0
ret`;
    const hybrid = `xor edx, edx
mov eax, 19
lzcnt rdx, rdi
lea rcx, [rdx+rdx*4]
shr rcx, 4
sub rax, rcx
cmp rdi, QWORD PTR "pow10_lz"[0+rdx*8]
sbb rax, 0
ret`;
    const ilog10 = (x) => BigInt(x.toString().length - 1);
    const xs = [
      1n,
      9n,
      10n,
      99n,
      100n,
      1233n,
      2n ** 63n,
      10n ** 19n - 1n,
      10n ** 19n,
      2n ** 64n - 1n,
    ];
    for (const src of [fold, hybrid]) {
      for (const x of xs) expect((await run(src, [x], [tables])).result).toBe(ilog10(x));
      expect((await run(src, [0n], [tables])).result).toBe(2n ** 64n - 1n);
    }
    expect(
      (await run('lea ecx, [rdi+rdi*4]\nmov rax, rcx\nret', [2n ** 32n + 1n], [])).result,
    ).toBe(5n);
  }, 120_000);

  it('stops at a read outside the table', async () => {
    await expect(run('mov rax, qword ptr [8*rdi + pow10]\nret', [20])).rejects.toThrow(
      /fault on line 1/,
    );
  });

  it('needs the table defined in a C block', () => {
    expect(() => buildAsmRunnable(GCC, 'f(1)', { cSources: [] })).toThrow(
      /reads pow10, which no C or C\+\+ block in this post defines/,
    );
  });
});
