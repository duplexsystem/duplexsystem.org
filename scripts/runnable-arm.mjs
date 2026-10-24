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
  parseNumber as parseNum,
  parseRun,
  runCheck,
  splitOperands,
  tableSet,
  writeCheckSources,
} from './runnable-asm-common.mjs';

const LIBRARY = join(dirname(fileURLToPath(import.meta.url)), 'arm64', 'arm64.c');
const VERSION = 3;
const ZR = 31;

const REG = new Map();
for (let n = 0; n <= 30; n++) {
  REG.set(`x${n}`, { reg: n, w: 8, name: `x${n}` });
  REG.set(`w${n}`, { reg: n, w: 4, name: `w${n}` });
}
REG.set('xzr', { reg: ZR, w: 8, name: 'xzr' });
REG.set('wzr', { reg: ZR, w: 4, name: 'wzr' });
REG.set('lr', { reg: 30, w: 8, name: 'x30' });
const ARGS = [0, 1, 2, 3, 4, 5, 6, 7];

const COND = {
  eq: ['Z'],
  ne: ['Z'],
  cs: ['C'],
  hs: ['C'],
  cc: ['C'],
  lo: ['C'],
  mi: ['N'],
  pl: ['N'],
  vs: ['V'],
  vc: ['V'],
  hi: ['C', 'Z'],
  ls: ['C', 'Z'],
  ge: ['N', 'V'],
  lt: ['N', 'V'],
  gt: ['Z', 'N', 'V'],
  le: ['Z', 'N', 'V'],
  al: [],
};
const COND_C = {
  eq: 'Z_',
  ne: '!Z_',
  cs: 'C_',
  hs: 'C_',
  cc: '!C_',
  lo: '!C_',
  mi: 'N_',
  pl: '!N_',
  vs: 'V_',
  vc: '!V_',
  hi: '(C_ && !Z_)',
  ls: '(!C_ || Z_)',
  ge: '(N_ == V_)',
  lt: '(N_ != V_)',
  gt: '(!Z_ && N_ == V_)',
  le: '(Z_ || N_ != V_)',
  al: '1',
};
const FLAG_BIT = { N: 8, Z: 4, C: 2, V: 1 };

const OPS = {
  mov: { kind: 'mov' },
  movz: { kind: 'movz' },
  movk: { kind: 'movk' },
  movn: { kind: 'movn' },
  add: { kind: 'arith', op: 'add' },
  adds: { kind: 'arith', op: 'add', flags: true },
  sub: { kind: 'arith', op: 'sub' },
  subs: { kind: 'arith', op: 'sub', flags: true },
  cmp: { kind: 'cmp', op: 'sub' },
  cmn: { kind: 'cmp', op: 'add' },
  adc: { kind: 'carry', op: 'add', reads: ['C'] },
  adcs: { kind: 'carry', op: 'add', flags: true, reads: ['C'] },
  sbc: { kind: 'carry', op: 'sub', reads: ['C'] },
  sbcs: { kind: 'carry', op: 'sub', flags: true, reads: ['C'] },
  neg: { kind: 'neg' },
  negs: { kind: 'neg', flags: true },
  and: { kind: 'logic', op: '&' },
  ands: { kind: 'logic', op: '&', flags: true },
  tst: { kind: 'tst' },
  orr: { kind: 'logic', op: '|' },
  eor: { kind: 'logic', op: '^' },
  bic: { kind: 'logic', op: '&~' },
  orn: { kind: 'logic', op: '|~' },
  eon: { kind: 'logic', op: '^~' },
  mvn: { kind: 'mvn' },
  lsl: { kind: 'shift', op: 'lsl' },
  lsr: { kind: 'shift', op: 'lsr' },
  asr: { kind: 'shift', op: 'asr' },
  ror: { kind: 'shift', op: 'ror' },
  mul: { kind: 'mul' },
  madd: { kind: 'madd' },
  msub: { kind: 'msub' },
  mneg: { kind: 'mneg' },
  umulh: { kind: 'mulh', signed: false },
  smulh: { kind: 'mulh', signed: true },
  udiv: { kind: 'div', signed: false },
  sdiv: { kind: 'div', signed: true },
  clz: { kind: 'clz' },
  cset: { kind: 'cset' },
  csetm: { kind: 'csetm' },
  cinc: { kind: 'cinc' },
  cinv: { kind: 'cinv' },
  cneg: { kind: 'cneg' },
  csel: { kind: 'csel' },
  csinc: { kind: 'csinc' },
  csinv: { kind: 'csinv' },
  csneg: { kind: 'csneg' },
  sxtw: { kind: 'ext', bits: 32, signed: true },
  sxth: { kind: 'ext', bits: 16, signed: true },
  sxtb: { kind: 'ext', bits: 8, signed: true },
  uxth: { kind: 'ext', bits: 16, signed: false },
  uxtb: { kind: 'ext', bits: 8, signed: false },
  ldr: { kind: 'load' },
  ldrb: { kind: 'load', size: 1 },
  ldrh: { kind: 'load', size: 2 },
  ldrsb: { kind: 'load', size: 1, signed: true },
  ldrsh: { kind: 'load', size: 2, signed: true },
  ldrsw: { kind: 'load', size: 4, signed: true },
  adrp: { kind: 'adrp' },
  adr: { kind: 'adrp' },
  nop: { kind: 'nop' },
  ret: { kind: 'ret' },
};

const fail = failer('arm64');
const parseNumber = (t) => parseNum(t, { hash: true });

const LO12 = /^#?:(got_)?lo12:"?([A-Za-z_.$][\w.$]*)"?$/;

const SHIFTS = new Set(['lsl', 'lsr', 'asr', 'ror']);
const EXTENDS = new Set(['uxtb', 'uxth', 'uxtw', 'uxtx', 'sxtb', 'sxth', 'sxtw', 'sxtx']);

function parseModifier(t) {
  const m = /^([a-z]+)(?:\s+#?(\d+))?$/i.exec(t.trim());
  if (!m) return null;
  const kind = m[1].toLowerCase();
  if (!SHIFTS.has(kind) && !EXTENDS.has(kind)) return null;
  return { kind, amount: m[2] ? Number(m[2]) : 0 };
}

function parseOperand(text, line) {
  const t = text.trim();
  const reg = REG.get(t.toLowerCase());
  if (reg) return { kind: 'reg', ...reg };
  const num = parseNumber(t);
  if (num !== null) return { kind: 'imm', value: num };
  const lo12 = LO12.exec(t);
  if (lo12) return { kind: 'lo12', symbol: lo12[2] };
  const sym = /^(?::got:)?"?([A-Za-z_.$][\w.$]*)"?$/.exec(t);
  if (sym && !SHIFTS.has(sym[1]) && !EXTENDS.has(sym[1])) return { kind: 'sym', symbol: sym[1] };
  const mem = /^\[(.*)\](!?)$/.exec(t);
  if (mem) {
    if (mem[2]) fail(line, `pre-indexed addressing ("${t}") is not supported`);
    const parts = splitOperands(mem[1]);
    const base = REG.get(parts[0]?.toLowerCase());
    if (!base || base.w !== 8) fail(line, `can't read the address "${t}"`);
    const out = {
      kind: 'mem',
      base: base.reg,
      index: null,
      scale: 0,
      ext: null,
      disp: 0n,
      lo12: null,
      got: false,
    };
    if (parts[1]) {
      const idx = REG.get(parts[1].toLowerCase());
      const imm = parseNumber(parts[1]);
      const l = LO12.exec(parts[1]);
      if (idx) {
        out.index = idx;
        if (parts[2]) {
          const mod = parseModifier(parts[2]);
          if (!mod) fail(line, `can't read "${parts[2]}" in "${t}"`);
          out.ext = mod.kind;
          out.scale = mod.amount;
        }
      } else if (imm !== null) out.disp = imm;
      else if (l) [out.got, out.lo12] = [!!l[1], l[2]];
      else fail(line, `can't read "${parts[1]}" in "${t}"`);
    }
    return out;
  }
  fail(line, `can't read the operand "${t}"`);
}

export function parseArm(source) {
  const insns = [];
  source.split('\n').forEach((raw, i) => {
    const line = i + 1;
    let s = raw.replace(/(\/\/|;|@).*$/, '').trim();
    s = s.replace(/^"?[\w.$]+"?:\s*/, '');
    if (!s || s.startsWith('.')) return;
    const m = /^([a-z][a-z0-9.]*)\b\s*(.*)$/i.exec(s);
    if (!m) fail(line, `can't read "${raw.trim()}"`);
    const op = m[1].toLowerCase();
    if (!OPS[op]) {
      fail(
        line,
        `there is no AArch64 implementation of ${op} yet; add it to scripts/runnable-arm.mjs`,
      );
    }
    const parts = splitOperands(m[2]);
    const operands = [];
    for (const p of parts) {
      const mod = parseModifier(p);
      if (mod && operands.length && ['reg', 'imm'].includes(operands.at(-1).kind)) {
        operands.at(-1).mod = mod;
      } else operands.push(parseOperand(p, line));
    }
    insns.push({ line, op, operands, text: s });
  });
  if (!insns.length) throw new Error('runnable arm64: the block has no instructions');
  return insns;
}

const HELPERS = `// Flags: N 8, Z 4, C 2, V 1. On AArch64 C after a subtraction means no borrow.
#define N_ ((fl >> 3) & 1)
#define Z_ ((fl >> 2) & 1)
#define C_ ((fl >> 1) & 1)
#define V_ (fl & 1)
static inline int64_t sx(uint64_t v, int bits)
{
    uint64_t top = 1ull << (bits - 1);
    return bits == 64 ? (int64_t)v : (int64_t)(((v & (2 * top - 1)) ^ top) - top);
}
`;

function libraryFn(ins) {
  const spec = OPS[ins.op];
  switch (spec.kind) {
    case 'arith':
    case 'cmp':
      return spec.op;
    case 'carry':
      return spec.op === 'add' ? 'adc' : 'sbc';
    case 'neg':
      return 'sub';
    case 'logic':
      return spec.flags ? 'and' : null;
    case 'tst':
      return 'and';
    case 'shift':
      return spec.op === 'ror' ? 'ror' : null;
    case 'mulh':
      return spec.signed ? 'smulh' : 'umulh';
    case 'clz':
      return 'clz';
    default:
      return null;
  }
}

export function armCalls(source) {
  const fns = new Set();
  for (const ins of parseArm(source)) {
    const fn = libraryFn(ins);
    if (fn) fns.add(fn);
    if (ins.operands.some((o) => o.kind === 'reg' && o.mod?.kind === 'ror')) fns.add('ror');
  }
  return [...fns].sort();
}

export function buildSharedArm(names, { cacheDir }) {
  return buildShared('arm64', names, {
    cacheDir,
    keyParts: () => [readFileSync(LIBRARY, 'utf8'), VERSION],
    link: (out, sys, list) =>
      linkWasm(sys, out, {
        flags: ['-Oz'],
        exports: ['arm64_flags', ...list.map((n) => `arm64_${n}`)],
        inputs: [LIBRARY],
      }),
  });
}

function translate(insns, fnName, inputs, cSources) {
  const { names, id: nameId } = nameTable();
  const used = new Set();
  const lib = (fn, a, b, w) => {
    used.add(fn);
    return `arm64_${fn}(${a}, ${b}, ${w}, fl)`;
  };
  const tables = tableSet(cSources, fail);
  const table = (name, line) => {
    tables.use(name, line);
    return `(uint64_t)(uintptr_t)${name}`;
  };
  const shows = flagShows(
    insns,
    (ins) => {
      const cond = ins.operands.find((o) => o.kind === 'sym' && COND[o.symbol]);
      return [...(OPS[ins.op].reads ?? []), ...(cond ? COND[cond.symbol] : [])];
    },
    (ins) => {
      const k = OPS[ins.op];
      return k.flags || k.kind === 'cmp' || k.kind === 'tst';
    },
  );

  const W = (w) => (w === 8 ? '' : ' & 0xffffffffull');
  const reg = (o) => (o.reg === ZR ? '0ull' : `(r[${o.reg}]${W(o.w)})`);
  const shifted = (o, w) => {
    let v = reg(o);
    if (!o.mod) return v;
    const { kind, amount } = o.mod;
    const bits = w * 8;
    if (kind === 'lsl') return `((${v} << ${amount})${W(w)})`;
    if (kind === 'lsr') return `(${v} >> ${amount})`;
    if (kind === 'asr') return `((uint64_t)(sx(${v}, ${bits}) >> ${amount})${W(w)})`;
    if (kind === 'ror') return lib('ror', v, amount, w);
    const from = { b: 8, h: 16, w: 32, x: 64 }[kind[3]];
    v =
      kind[0] === 's'
        ? `(uint64_t)sx(${v}, ${from})`
        : from === 64
          ? v
          : `(${v} & ${hex((1n << BigInt(from)) - 1n)})`;
    return `((${v} << ${amount})${W(w)})`;
  };
  const value = (o, w, line) => {
    if (o.kind === 'reg') return shifted(o, w);
    if (o.kind === 'imm') return hex(BigInt.asUintN(w * 8, o.value << BigInt(o.mod?.amount ?? 0)));
    if (o.kind === 'lo12') return '0ull';
    fail(line, 'expected a register or a number');
  };
  const cond = (o, line) => {
    if (!o || o.kind !== 'sym' || !COND[o.symbol])
      fail(line, 'expected a condition (eq, hi, lo, ...)');
    return COND_C[o.symbol];
  };
  const address = (o, line) => {
    const parts = [`r[${o.base}]`];
    if (o.index) {
      let idx = reg(o.index);
      if (o.ext === 'sxtw') idx = `(uint64_t)sx(${idx}, 32)`;
      else if (o.ext === 'uxtw') idx = `(${idx} & 0xffffffffull)`;
      parts.push(o.scale ? `(${idx} << ${o.scale})` : idx);
    }
    if (o.disp) parts.push(hex(o.disp));
    return parts.join(' + ');
  };

  const body = [];
  let returned = false;
  for (const [k, ins] of insns.entries()) {
    const { line, op, operands: ops } = ins;
    const spec = OPS[op];
    body.push(`    __rt_line(${line});`);
    if (spec.kind === 'ret') {
      body.push(`    __rt_r64(${line}, -1, r[0]);`, '    return r[0];');
      returned = true;
      break;
    }
    if (spec.kind === 'nop') continue;
    const dst = ops[0];
    const w = dst?.kind === 'reg' ? dst.w : 8;
    let v = null;
    let flags = false;
    const a = (i) => value(ops[i], w, line);
    switch (spec.kind) {
      case 'mov':
        v = ops[1].kind === 'imm' ? hex(BigInt.asUintN(w * 8, ops[1].value)) : a(1);
        break;
      case 'movz':
      case 'movn': {
        const sh = ops[1].mod?.amount ?? 0;
        const imm = BigInt.asUintN(w * 8, ops[1].value << BigInt(sh));
        v = hex(spec.kind === 'movn' ? BigInt.asUintN(w * 8, ~imm) : imm);
        break;
      }
      case 'movk': {
        const sh = BigInt(ops[1].mod?.amount ?? 0);
        v = `((${reg(dst)} & ~${hex(0xffffn << sh)}) | ${hex(ops[1].value << sh)})`;
        break;
      }
      case 'arith':
        if (ops.length !== 3) fail(line, `${op} takes three operands`);
        v = lib(spec.op, a(1), a(2), w);
        flags = spec.flags;
        break;
      case 'cmp': {
        const cw = ops[0].w;
        body.push(
          `    (void)${lib(spec.op, value(ops[0], cw, line), value(ops[1], cw, line), cw)}; fl = arm64_flags();`,
        );
        break;
      }
      case 'carry':
        v = lib(spec.op === 'add' ? 'adc' : 'sbc', a(1), a(2), w);
        flags = spec.flags;
        break;
      case 'neg':
        v = lib('sub', '0ull', a(1), w);
        flags = spec.flags;
        break;
      case 'logic': {
        const [o, inv] = [spec.op[0], spec.op.length > 1];
        if (spec.flags) {
          v = lib('and', a(1), inv ? `~${a(2)}` : a(2), w);
          flags = true;
        } else {
          v = `((${a(1)} ${o} ${inv ? '~' : ''}${a(2)})${W(w)})`;
        }
        break;
      }
      case 'tst': {
        const tw = ops[0].w;
        body.push(
          `    (void)${lib('and', value(ops[0], tw, line), value(ops[1], tw, line), tw)}; fl = arm64_flags();`,
        );
        break;
      }
      case 'mvn':
        v = `(~${a(1)}${W(w)})`;
        break;
      case 'shift': {
        const amt = ops[2].kind === 'imm' ? String(ops[2].value) : `(${reg(ops[2])} % ${w * 8})`;
        const x = reg(ops[1]);
        v = {
          lsl: () => `((${x} << ${amt})${W(w)})`,
          lsr: () => `(${x} >> ${amt})`,
          asr: () => `((uint64_t)(sx(${x}, ${w * 8}) >> ${amt})${W(w)})`,
          ror: () => lib('ror', x, amt, w),
        }[spec.op]();
        break;
      }
      case 'mul':
        v = `((${a(1)} * ${a(2)})${W(w)})`;
        break;
      case 'madd':
        v = `((${a(1)} * ${a(2)} + ${a(3)})${W(w)})`;
        break;
      case 'msub':
        v = `((${a(3)} - ${a(1)} * ${a(2)})${W(w)})`;
        break;
      case 'mneg':
        v = `((0 - ${a(1)} * ${a(2)})${W(w)})`;
        break;
      case 'mulh':
        v = lib(spec.signed ? 'smulh' : 'umulh', a(1), a(2), w);
        break;
      case 'div':
        v = spec.signed
          ? `(${a(2)} == 0 ? 0 : ${a(2)} == ${hex(BigInt.asUintN(w * 8, -1n))} ? (0 - ${a(1)})${W(w)} : (uint64_t)(sx(${a(1)}, ${w * 8}) / sx(${a(2)}, ${w * 8}))${W(w)})`
          : `(${a(2)} == 0 ? 0 : ${a(1)} / ${a(2)})`;
        break;
      case 'clz':
        v = lib('clz', reg(ops[1]), '0', w);
        break;
      case 'cset':
        v = `(${cond(ops[1], line)} ? 1ull : 0ull)`;
        break;
      case 'csetm':
        v = `(${cond(ops[1], line)} ? ${hex(w === 8 ? -1n : 0xffffffffn)} : 0ull)`;
        break;
      case 'cinc':
        v = `(${cond(ops[2], line)} ? (${reg(ops[1])} + 1)${W(w)} : ${reg(ops[1])})`;
        break;
      case 'cinv':
        v = `(${cond(ops[2], line)} ? (~${reg(ops[1])})${W(w)} : ${reg(ops[1])})`;
        break;
      case 'cneg':
        v = `(${cond(ops[2], line)} ? (0 - ${reg(ops[1])})${W(w)} : ${reg(ops[1])})`;
        break;
      case 'csel':
        v = `(${cond(ops[3], line)} ? ${reg(ops[1])} : ${reg(ops[2])})`;
        break;
      case 'csinc':
        v = `(${cond(ops[3], line)} ? ${reg(ops[1])} : (${reg(ops[2])} + 1)${W(w)})`;
        break;
      case 'csinv':
        v = `(${cond(ops[3], line)} ? ${reg(ops[1])} : (~${reg(ops[2])})${W(w)})`;
        break;
      case 'csneg':
        v = `(${cond(ops[3], line)} ? ${reg(ops[1])} : (0 - ${reg(ops[2])})${W(w)})`;
        break;
      case 'ext':
        v = spec.signed
          ? `((uint64_t)sx(${reg(ops[1])}, ${spec.bits})${W(w)})`
          : `(${reg(ops[1])} & ${hex((1n << BigInt(spec.bits)) - 1n)})`;
        break;
      case 'load': {
        const m = ops[1];
        if (m?.kind !== 'mem') fail(line, `${op} needs an address`);
        if (ops.length > 2) fail(line, `post-indexed addressing is not supported`);
        if (m.got) {
          if (op !== 'ldr' || w !== 8 || m.index)
            fail(line, ':got_lo12: is for ldr xN, [xM, :got_lo12:sym]');
          v = table(m.lo12, line);
          break;
        }
        const size = spec.size ?? w;
        const ld = `ld(${address(m, line)}, ${size}, ${line})`;
        v = spec.signed ? `((uint64_t)sx(${ld}, ${size * 8})${W(w)})` : ld;
        break;
      }
      case 'adrp':
        if (ops[1]?.kind !== 'sym') fail(line, `${op} needs a symbol`);
        v = table(ops[1].symbol, line);
        break;
      default:
        fail(line, `${op} is not supported`);
    }
    if (v !== null && dst) {
      if (dst.kind !== 'reg') fail(line, `${op} needs a register to write to`);
      const assign = dst.reg === ZR ? `(void)(${v});` : `r[${dst.reg}] = (${v})${W(dst.w)};`;
      body.push(`    { ${assign}${flags ? ' fl = arm64_flags();' : ''} }`);
      if (dst.reg !== ZR) {
        body.push(
          `    __rt_${dst.w === 8 ? 'r64' : 'r32'}(${line}, ${nameId(dst.name)}, r[${dst.reg}]);`,
        );
      }
    }
    const shown = shows.get(k);
    if (shown) {
      body.push(
        `    ${shown.map((f) => `__rt_u64(${line}, ${nameId(f)}, (fl & ${FLAG_BIT[f]}u) != 0);`).join(' ')}`,
      );
    }
  }
  if (!returned) {
    const last = insns.at(-1).line;
    body.push(`    __rt_r64(${last}, -1, r[0]);`, '    return r[0];');
  }

  const imports = [
    'IMPORT("arm64", "arm64_flags") unsigned arm64_flags(void);',
    ...[...used]
      .sort()
      .map(
        (f) =>
          `IMPORT("arm64", "arm64_${f}") uint64_t arm64_${f}(uint64_t, uint64_t, int, unsigned);`,
      ),
  ].join('\n');
  const c = generateC({
    fnName,
    inputs,
    nRegs: 32,
    tables: tables.decls,
    imports,
    helpers: HELPERS,
    body,
  });
  return { c, names, used: [...used].sort(), tables: [...tables.decls.keys()] };
}

function aarch64Runner() {
  if (process.arch === 'arm64') return [];
  for (const q of ['qemu-aarch64-static', 'qemu-aarch64']) {
    try {
      execFileSync('which', [q], { stdio: 'ignore' });
      return [q];
    } catch {
    }
  }
  return null;
}

function checkNative(insns, translated, fnName, inputs, work) {
  const runner = aarch64Runner();
  if (!runner || inputs.length > 2) return false;
  const nArgs = inputs.length;
  const { params, call, asmCall } = writeCheckSources(work, {
    insns,
    header: '\t.text\n',
    c: translated,
    fnName,
    inputs,
    argRegs: ARGS,
    input: (i) => `IN[i][${i}]`,
  });
  const rows = inputRows(nArgs, false);
  writeFileSync(
    join(work, 'harness.c'),
    `#include <stdint.h>
static int faulted;
${RT_STUBS}
void __rt_fault(int l) { (void)l; faulted = 1; }
uint64_t __asm_fn(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t);
uint64_t __c_fn(${params});
static const uint64_t IN[][${Math.max(1, nArgs)}] = {${rows.map((r) => `{${(r.length ? r : [0n]).map((v) => `${v}ull`).join(', ')}}`).join(',\n')}};
static long sys(long n, long a, long b, long c)
{
    register long x8 __asm__("x8") = n, x0 __asm__("x0") = a, x1 __asm__("x1") = b, x2 __asm__("x2") = c;
    __asm__ volatile("svc 0" : "+r"(x0) : "r"(x8), "r"(x1), "r"(x2) : "memory");
    return x0;
}
static void put(uint64_t v) { char b[21]; int n = 20; b[20] = ' '; do b[--n] = '0' + v % 10; while (v /= 10); sys(64, 1, (long)(b + n), 21 - n); }
void _start(void)
{
    int bad = 0;
    for (unsigned long i = 0; i < sizeof IN / sizeof IN[0]; i++) {
        faulted = 0;
        uint64_t c = __c_fn(${call});
        if (faulted) continue;
        uint64_t a = __asm_fn(${asmCall});
        if (a != c) { for (int k = 0; k < ${nArgs}; k++) put(IN[i][k]); sys(64, 1, (long)"cpu ", 4); put(a); sys(64, 1, (long)"translated ", 11); put(c); sys(64, 1, (long)"\\n", 1); if (++bad >= 5) break; }
    }
    sys(93, bad != 0, 0, 0);
    for (;;) {}
}
`,
  );
  const exe = join(work, 'check');
  execFileSync(
    'clang',
    [
      '--target=aarch64-linux-gnu',
      '-march=armv8.2-a',
      '-O1',
      '-ffreestanding',
      '-fno-pic',
      '-nostdlib',
      '-static',
      '-fuse-ld=lld',
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
  runCheck('arm64', fnName, 'scripts/runnable-arm.mjs', () =>
    execFileSync(runner[0] ?? exe, runner.length ? [exe] : [], {
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  return true;
}

export const parseArmRun = (call) =>
  parseRun(call, {
    lang: 'arm64',
    regs: REG,
    args: ARGS,
    argNames: 'x0 to x7',
    example: 'x0=1233',
  });

export function buildArmRunnable(source, call, { cacheDir, cSources = [] } = {}) {
  const run = parseArmRun(call);
  const regs = run.inputs.map((i) => i.reg);
  const insns = parseArm(source);
  const translated = translate(insns, run.fn, regs, cSources);
  return buildAssembly({
    lang: 'arm64',
    run,
    paramName: (reg) => `x${reg}`,
    retName: 'x0',
    translated,
    keyParts: [readFileSync(LIBRARY, 'utf8'), VERSION, 'arm64'],
    imports: ['arm64'],
    arm64: translated.used,
    check: (work) => checkNative(insns, translated.c, run.fn, regs, work),
    notChecked: 'a CPU (needs AArch64, or qemu-aarch64 with clang and lld)',
    cacheDir,
  });
}
