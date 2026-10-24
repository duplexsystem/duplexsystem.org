import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildShared, linkWasm } from './runnable.mjs';
import {
  RT_STUBS,
  buildAssembly,
  failer,
  flagShows,
  generateC,
  hex,
  inputRows,
  nameTable,
  parseNumber,
  parseRun as parseRunWith,
  runCheck,
  splitOperands,
  tableSet,
  writeCheckSources,
} from './runnable-asm-common.mjs';

const LIBRARY = join(dirname(fileURLToPath(import.meta.url)), 'x86', 'x86.c');
const VERSION = 2;

const REGS = [
  ['rax', 'eax', 'ax', 'al'],
  ['rcx', 'ecx', 'cx', 'cl'],
  ['rdx', 'edx', 'dx', 'dl'],
  ['rbx', 'ebx', 'bx', 'bl'],
  ['rsp', 'esp', 'sp', 'spl'],
  ['rbp', 'ebp', 'bp', 'bpl'],
  ['rsi', 'esi', 'si', 'sil'],
  ['rdi', 'edi', 'di', 'dil'],
  ...[8, 9, 10, 11, 12, 13, 14, 15].map((n) => [`r${n}`, `r${n}d`, `r${n}w`, `r${n}b`]),
];
const REG = new Map();
REGS.forEach((names, i) =>
  names.forEach((n, k) => REG.set(n, { reg: i, w: [8, 4, 2, 1][k], name: n })),
);
const ARGS = [7, 6, 2, 1, 8, 9];
const SIZES = { byte: 1, word: 2, dword: 4, qword: 8 };

const OPS = {
  mov: { fn: null, writes: true },
  lea: { fn: null, writes: true },
  add: { fn: 'add', writes: true },
  adc: { fn: 'adc', writes: true, reads: ['CF'] },
  sub: { fn: 'sub', writes: true },
  sbb: { fn: 'sbb', writes: true, reads: ['CF'] },
  cmp: { fn: 'sub', writes: false },
  and: { fn: 'and', writes: true },
  test: { fn: 'and', writes: false },
  or: { fn: 'or', writes: true },
  xor: { fn: 'xor', writes: true },
  imul: { fn: 'imul', writes: true },
  shl: { fn: 'shl', writes: true },
  sal: { fn: 'shl', writes: true },
  shr: { fn: 'shr', writes: true },
  sar: { fn: 'sar', writes: true },
  lzcnt: { fn: 'lzcnt', writes: true, unary: true },
  bsr: { fn: 'bsr', writes: true, unary: true },
  ret: { fn: null, writes: false },
};
const FLAG_BIT = { CF: 1, ZF: 2, SF: 4, OF: 8 };
const CPU_FEATURE = { lzcnt: 'abm' };

const fail = failer('asm');

const symbolName = (t) => t.replace(/^"(.*)"$/, '$1');

function parseOperand(text, line, address = false) {
  let t = text.trim();
  const reg = REG.get(t.toLowerCase());
  if (reg) return { kind: 'reg', ...reg };
  const num = parseNumber(t, { suffix: true });
  if (num !== null) return { kind: 'imm', value: num };

  let size = null;
  const sm = /^(byte|word|dword|qword)\s+ptr\s+/i.exec(t);
  if (sm) {
    size = SIZES[sm[1].toLowerCase()];
    t = t.slice(sm[0].length).trim();
  }
  const mm = /^([^[]*)\[(.*)\]$/.exec(t);
  if (!mm) fail(line, `can't read the operand "${text.trim()}"`);
  const mem = { kind: 'mem', size, symbol: null, base: null, index: null, scale: 1n, disp: 0n };
  const terms = [];
  if (mm[1].trim()) terms.push(['+', mm[1].trim()]);
  for (const m of `+${mm[2]}`.replace(/\s+/g, '').matchAll(/([+-])([^+-]+)/g))
    terms.push([m[1], m[2]]);
  for (const [sign, term] of terms) {
    const n = parseNumber(term, { suffix: true });
    if (n !== null) {
      mem.disp += sign === '-' ? -n : n;
      continue;
    }
    const scaled = /^(?:(\d+)\*([a-z0-9]+)|([a-z0-9]+)\*(\d+))$/i.exec(term);
    if (scaled) {
      const r = REG.get((scaled[2] ?? scaled[3]).toLowerCase());
      if (!r || r.w !== 8 || sign === '-' || mem.index) fail(line, `can't read "${text.trim()}"`);
      mem.index = r.reg;
      mem.scale = BigInt(scaled[1] ?? scaled[4]);
      continue;
    }
    const r = REG.get(term.toLowerCase());
    if (r) {
      if (term.toLowerCase() === 'rip') continue;
      if (r.w !== 8 || sign === '-') fail(line, `can't read "${text.trim()}"`);
      if (mem.base === null) mem.base = r.reg;
      else if (mem.index === null) mem.index = r.reg;
      else fail(line, `too many registers in "${text.trim()}"`);
      continue;
    }
    if (term.toLowerCase() === 'rip') continue;
    if (/^"?[A-Za-z_.$][\w.$]*"?$/.test(term) && sign === '+' && !mem.symbol) {
      mem.symbol = symbolName(term);
      continue;
    }
    fail(line, `can't read "${text.trim()}"`);
  }
  if (!mem.symbol && !address) fail(line, `"${text.trim()}" reads memory outside any named table`);
  return mem;
}

export function parseAsm(source) {
  const insns = [];
  source.split('\n').forEach((raw, i) => {
    const line = i + 1;
    let s = raw.replace(/(\/\/|#|;).*$/, '').trim();
    s = s.replace(/^"?[\w.$]+"?:\s*/, '');
    if (!s || s.startsWith('.')) return;
    const m = /^([a-z][a-z0-9]*)\b\s*(.*)$/i.exec(s);
    if (!m) fail(line, `can't read "${raw.trim()}"`);
    const op = m[1].toLowerCase();
    if (!OPS[op]) {
      fail(
        line,
        `there is no x86 implementation of ${op} yet; add it to scripts/x86/x86.c and scripts/runnable-asm.mjs`,
      );
    }
    const operands = splitOperands(m[2]).map((o) => parseOperand(o, line, op === 'lea'));
    insns.push({ line, op, operands, text: s });
  });
  if (!insns.length) throw new Error('runnable asm: the block has no instructions');
  return insns;
}

export function x86Calls(source) {
  return [
    ...new Set(
      parseAsm(source)
        .map((i) => OPS[i.op].fn)
        .filter(Boolean),
    ),
  ].sort();
}

export function buildSharedX86(names, { cacheDir }) {
  return buildShared('x86', names, {
    cacheDir,
    keyParts: () => [readFileSync(LIBRARY, 'utf8'), VERSION],
    link: (out, sys, list) =>
      linkWasm(sys, out, {
        flags: ['-Oz'],
        exports: ['x86_flags', ...list.map((n) => `x86_${n}`)],
        inputs: [LIBRARY],
      }),
  });
}

const maskOf = (w) => (w === 8 ? '' : `0x${((1n << BigInt(w * 8)) - 1n).toString(16)}ull`);

function translate(insns, fnName, inputs, cSources) {
  const { names, id: nameId } = nameTable();
  const used = new Set();
  const shows = flagShows(
    insns,
    (ins) => OPS[ins.op].reads ?? [],
    (ins) => !!OPS[ins.op].fn,
  );
  const tables = tableSet(cSources, fail);

  const get = (o, w, line) => {
    if (o.kind === 'reg') return o.w === 8 ? `r[${o.reg}]` : `(r[${o.reg}] & ${maskOf(o.w)})`;
    if (o.kind === 'imm') return hex(BigInt.asUintN(w * 8, o.value));
    tables.use(o.symbol, line);
    return `ld(${address(o)}, ${o.size ?? w}, ${line})`;
  };
  const address = (o) => {
    const parts = o.symbol ? [`(uint64_t)(uintptr_t)${o.symbol}`] : [];
    if (o.base !== null) parts.push(`r[${o.base}]`);
    if (o.index !== null) parts.push(`r[${o.index}] * ${o.scale}`);
    if (o.disp) parts.push(hex(o.disp));
    return parts.length ? `(${parts.join(' + ')})` : '0';
  };
  const set = (o, v) => {
    if (o.w === 8 || o.w === 4) return `r[${o.reg}] = ${v};`;
    const m = maskOf(o.w);
    return `r[${o.reg}] = (r[${o.reg}] & ~${m}) | ((${v}) & ${m});`;
  };

  const body = [];
  let returned = false;
  for (const [k, ins] of insns.entries()) {
    const { line, op, operands: ops } = ins;
    const spec = OPS[op];
    const report = [];
    body.push(`    __rt_line(${line});`);
    if (op === 'ret') {
      if (ops.length) fail(line, 'ret with an operand is not supported');
      body.push(`    __rt_r64(${line}, -1, r[0]);`, '    return r[0];');
      returned = true;
      break;
    }
    const dst = ops[0];
    if (!dst || (spec.writes && dst.kind !== 'reg')) {
      fail(line, `${op} needs a register to write to here (writing memory is not supported)`);
    }
    const w = dst.kind === 'reg' ? dst.w : dst.size;
    if (!w) fail(line, `${op} needs an operand size (QWORD PTR, ...)`);
    let value;
    if (op === 'mov') {
      if (ops.length !== 2) fail(line, 'mov takes two operands');
      value = get(ops[1], w, line);
    } else if (op === 'lea') {
      if (ops.length !== 2 || ops[1].kind !== 'mem')
        fail(line, 'lea takes a register and an address');
      if (ops[1].symbol) tables.use(ops[1].symbol, line);
      value = w === 8 ? address(ops[1]) : `(${address(ops[1])} & ${maskOf(w)})`;
    } else {
      used.add(spec.fn);
      let a;
      let b;
      if (spec.unary) {
        if (ops.length !== 2) fail(line, `${op} takes two operands`);
        a = get(ops[1], w, line);
        b = op === 'bsr' ? get(dst, w, line) : '0';
      } else if (op === 'imul' && ops.length === 3) {
        a = get(ops[1], w, line);
        b = get(ops[2], w, line);
      } else {
        if (ops.length !== 2) fail(line, `${op} takes two operands`);
        a = get(dst, w, line);
        b = get(ops[1], ['shl', 'sal', 'shr', 'sar'].includes(op) ? 1 : w, line);
      }
      value = `x86_${spec.fn}(${a}, ${b}, ${w}, fl)`;
    }
    if (spec.writes) {
      body.push(`    { uint64_t v = ${value}; ${set(dst, 'v')} }`);
      const kind = w === 8 ? 'r64' : w === 4 ? 'r32' : 'u64';
      report.push(
        `__rt_${kind}(${line}, ${nameId(dst.name)}, r[${dst.reg}] & ${maskOf(w) || '~0ull'});`,
      );
    } else {
      body.push(`    (void)${value};`);
    }
    if (spec.fn) {
      body.push('    fl = x86_flags();');
      for (const f of shows.get(k) ?? []) {
        report.push(`__rt_u64(${line}, ${nameId(f)}, (fl & ${FLAG_BIT[f]}u) != 0);`);
      }
    }
    if (report.length) body.push(`    ${report.join(' ')}`);
  }
  if (!returned) {
    const last = insns.at(-1).line;
    body.push(`    __rt_r64(${last}, -1, r[0]);`, '    return r[0];');
  }

  const imports = [
    'IMPORT("x86", "x86_flags") unsigned x86_flags(void);',
    ...[...used]
      .sort()
      .map(
        (f) => `IMPORT("x86", "x86_${f}") uint64_t x86_${f}(uint64_t, uint64_t, int, unsigned);`,
      ),
  ].join('\n');
  const c = generateC({ fnName, inputs, nRegs: 16, tables: tables.decls, imports, body });
  return { c, names, used: [...used].sort(), tables: [...tables.decls.keys()] };
}

function cpuHas(features) {
  if (process.arch !== 'x64') return false;
  try {
    const flags = new Set(
      (/^flags\s*:(.*)$/m.exec(readFileSync('/proc/cpuinfo', 'utf8'))?.[1] ?? '')
        .trim()
        .split(/\s+/),
    );
    return features.every((f) => flags.has(f));
  } catch {
    return false;
  }
}

function checkNative(insns, translated, fnName, inputs, work) {
  const needs = [...new Set(insns.map((i) => CPU_FEATURE[i.op]).filter(Boolean))];
  if (!cpuHas(needs) || inputs.length > 2) return false;
  const nArgs = inputs.length;
  const { params, call, asmCall } = writeCheckSources(work, {
    insns,
    header: '\t.intel_syntax noprefix\n\t.text\n',
    c: translated,
    fnName,
    inputs,
    argRegs: ARGS,
    input: (i) => `v[${i}]`,
  });
  const fmt = '%llu '.repeat(nArgs);
  const cast = Array.from({ length: nArgs }, (_, i) => `(unsigned long long)v[${i}], `).join('');
  const scan = nArgs
    ? `scanf("${fmt.trim()}", ${Array.from({ length: nArgs }, (_, i) => `(unsigned long long *)&v[${i}]`).join(', ')}) == ${nArgs}`
    : 'bad < 1';
  writeFileSync(
    join(work, 'harness.c'),
    `#include <setjmp.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
static jmp_buf out;
${RT_STUBS}
void __rt_fault(int l) { (void)l; longjmp(out, 1); }
uint64_t __asm_fn(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t);
uint64_t __c_fn(${params});
int main(void)
{
    uint64_t v[2];
    int bad = 0;
    while (${scan}) {
        if (setjmp(out)) continue;
        uint64_t c = __c_fn(${call});
        uint64_t a = __asm_fn(${asmCall});
        if (a != c) {
            printf("${fmt}cpu %llu translated %llu\\n", ${cast}(unsigned long long)a, (unsigned long long)c);
            if (++bad >= 5) break;
        }
        ${nArgs ? '' : 'break;'}
    }
    return bad != 0;
}
`,
  );
  const exe = join(work, 'check');
  execFileSync(
    'clang',
    [
      '-O1',
      '-no-pie',
      '-w',
      '-o',
      exe,
      join(work, 'listing.s'),
      join(work, 'translated.c'),
      join(work, 'harness.c'),
      LIBRARY,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const rows = inputRows(
    nArgs,
    insns.some((i) => i.op === 'bsr'),
  ).map((r) => r.join(' '));
  runCheck('asm', fnName, 'scripts/x86/x86.c or scripts/runnable-asm.mjs', () =>
    execFileSync(exe, { input: rows.join('\n') + '\n', stdio: ['pipe', 'pipe', 'pipe'] }),
  );
  return true;
}

export const parseRun = (call) =>
  parseRunWith(call, {
    lang: 'asm',
    regs: REG,
    args: ARGS,
    argNames: 'rdi, rsi, rdx, rcx, r8, r9',
    example: 'rdi=1233',
  });

export function buildAsmRunnable(source, call, { cacheDir, cSources = [] } = {}) {
  const run = parseRun(call);
  const regs = run.inputs.map((i) => i.reg);
  const insns = parseAsm(source);
  const translated = translate(insns, run.fn, regs, cSources);
  return buildAssembly({
    lang: 'asm',
    run,
    paramName: (reg) => REGS[reg][0],
    retName: 'rax',
    translated,
    keyParts: [readFileSync(LIBRARY, 'utf8'), VERSION],
    imports: ['x86'],
    x86: translated.used,
    check: (work) => checkNative(insns, translated.c, run.fn, regs, work),
    notChecked: 'the CPU (needs an x86-64 machine with its instructions)',
    cacheDir,
  });
}
