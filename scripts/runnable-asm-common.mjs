import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  clangVersion,
  findSysroot,
  foreignImports,
  hashKey,
  inWorkDir,
  linkWasm,
  shrink,
  wasmOpt,
} from './runnable.mjs';

export const failer = (lang) => (line, msg) => {
  throw new Error(`runnable ${lang}: line ${line}: ${msg}`);
};

export const hex = (v) => `0x${BigInt.asUintN(64, v).toString(16)}ull`;

export function parseNumber(t, { hash = false, suffix = false } = {}) {
  const m = new RegExp(
    `^${hash ? '#?' : ''}([+-]?)(0x[0-9a-f]+${suffix ? '|[0-9a-f]+h' : ''}|\\d+)$`,
    'i',
  ).exec(t.trim());
  if (!m) return null;
  const digits = m[2].toLowerCase();
  const v = BigInt(
    digits.endsWith('h') && !digits.startsWith('0x') ? `0x${digits.slice(0, -1)}` : digits,
  );
  return m[1] === '-' ? -v : v;
}

export function splitOperands(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '[') depth++;
    if (ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function parseRun(call, { lang, regs, args, argNames, example }) {
  if (/^\s*[a-z0-9]+\s*=/i.test(call)) {
    const inputs = call.split(',').map((part) => {
      const m = /^\s*([a-z0-9]+)\s*=\s*(.+?)\s*$/i.exec(part);
      const reg = m && regs.get(m[1].toLowerCase());
      if (!reg || reg.w !== 8 || !args.includes(reg.reg)) {
        throw new Error(
          `runnable ${lang}: run="${call}": "${part.trim()}" should set an argument register (${argNames}), like ${example}`,
        );
      }
      return { reg: reg.reg, default: m[2] };
    });
    if (new Set(inputs.map((i) => i.reg)).size !== inputs.length) {
      throw new Error(`runnable ${lang}: run="${call}" sets a register twice`);
    }
    return { fn: 'run', inputs, registers: true };
  }
  const m = /^\s*([A-Za-z_]\w*)\s*\((.*)\)\s*$/.exec(call);
  if (!m) throw new Error(`runnable ${lang}: run="${call}" should look like run="${example}"`);
  const defaults = m[2].trim() ? m[2].split(',').map((a) => a.trim()) : [];
  if (defaults.length > args.length) {
    throw new Error(`runnable ${lang}: at most ${args.length} arguments`);
  }
  return {
    fn: m[1],
    inputs: defaults.map((d, i) => ({ reg: args[i], default: d })),
    registers: false,
  };
}

export function findTable(name, cSources) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    String.raw`(?:^|[;}\n])\s*((?:static\s+)?(?:const\s+)?[A-Za-z_][\w\s]*?(?<![\w.$])${escaped}\s*\[[^\]]*\]\s*=\s*\{([^}]*)\}\s*;)`,
    'g',
  );
  for (const src of [...cSources].reverse()) {
    for (const m of src.matchAll(re)) {
      if (/\/\*|\.\.\./.test(m[2])) continue;
      return m[1].replace(/^static\s+/, '');
    }
  }
  return null;
}

export function nameTable() {
  const names = [];
  const id = (n) => {
    let i = names.indexOf(n);
    if (i < 0) i = names.push(n) - 1;
    return i;
  };
  return { names, id };
}

export function tableSet(cSources, fail) {
  const decls = new Map();
  return {
    decls,
    use(name, line) {
      if (decls.has(name)) return;
      const decl = findTable(name, cSources);
      if (!decl) fail(line, `reads ${name}, which no C or C++ block in this post defines`);
      decls.set(name, decl);
    },
  };
}

export function flagShows(insns, readsOf, setsFlags) {
  const shows = new Map();
  insns.forEach((ins, j) => {
    for (const f of readsOf(ins)) {
      for (let i = j - 1; i >= 0; i--) {
        if (!setsFlags(insns[i])) continue;
        shows.set(i, new Set([...(shows.get(i) ?? []), f]));
        break;
      }
    }
  });
  return new Map([...shows].map(([i, set]) => [i, [...set].sort()]));
}

const RT_IMPORTS = `#include <stdint.h>
#define IMPORT(m, n) __attribute__((import_module(m), import_name(n)))
IMPORT("rt", "line") void __rt_line(int);
IMPORT("rt", "u64") void __rt_u64(int, int, uint64_t);
IMPORT("rt", "r64") void __rt_r64(int, int, uint64_t);
IMPORT("rt", "r32") void __rt_r32(int, int, uint64_t);
IMPORT("rt", "fault") void __rt_fault(int);`;

export const RT_STUBS = `void __rt_line(int l) { (void)l; }
void __rt_u64(int l, int i, uint64_t v) { (void)l; (void)i; (void)v; }
void __rt_r64(int l, int i, uint64_t v) { (void)l; (void)i; (void)v; }
void __rt_r32(int l, int i, uint64_t v) { (void)l; (void)i; (void)v; }`;

export function generateC({ fnName, inputs, nRegs, tables, imports = '', helpers = '', body }) {
  const params = inputs.map((_, i) => `uint64_t a${i}`).join(', ') || 'void';
  const argInit = inputs.map((reg, i) => `r[${reg}] = a${i};`).join(' ');
  const bounds = [...tables.keys()]
    .map(
      (t) =>
        `    if (addr >= (uintptr_t)${t} && addr + w <= (uintptr_t)${t} + sizeof ${t}) goto ok;`,
    )
    .join('\n');
  return `${RT_IMPORTS}
${imports ? `${imports}\n` : ''}${[...tables.values()].join('\n')}
${helpers}
// Reads w bytes, little-endian, from inside one of the listing's tables.
static uint64_t ld(uint64_t addr, int w, int line)
{
${bounds || ''}
    __rt_fault(line);
    return 0;
ok:
    switch (w) {
    case 1: return *(const uint8_t *)(uintptr_t)addr;
    case 2: return *(const uint16_t *)(uintptr_t)addr;
    case 4: return *(const uint32_t *)(uintptr_t)addr;
    default: return *(const uint64_t *)(uintptr_t)addr;
    }
}

uint64_t ${fnName}(${params})
{
    uint64_t r[${nRegs}] = {0};
    unsigned fl = 0;
    ${argInit}
${body.join('\n')}
}
`;
}

export function sampleInputs(skipZero) {
  const s = new Set();
  for (let i = 0n; i <= 20n; i++) s.add(i);
  for (let k = 1n; k <= 19n; k++) for (const d of [-1n, 0n, 1n]) s.add(10n ** k + d);
  for (let k = 1n; k <= 63n; k++) for (const d of [-1n, 0n, 1n]) s.add(2n ** k + d);
  s.add(2n ** 64n - 1n);
  let x = 0x9e3779b97f4a7c15n;
  for (let i = 0; i < 400; i++) {
    x = BigInt.asUintN(64, x * 6364136223846793005n + 1442695040888963407n);
    s.add(x >> BigInt(i % 64));
  }
  if (skipZero) s.delete(0n);
  return [...s].filter((v) => v >= 0n && v < 2n ** 64n);
}

export function inputRows(nArgs, skipZero) {
  const singles = sampleInputs(skipZero);
  if (nArgs === 0) return [[]];
  if (nArgs === 1) return singles.map((v) => [v]);
  return singles.slice(0, 60).flatMap((a) => singles.slice(0, 60).map((b) => [a, b]));
}

export function writeCheckSources(work, { insns, header, c, fnName, inputs, argRegs, input }) {
  const last = insns.at(-1).op === 'ret' ? '' : '\tret\n';
  writeFileSync(
    join(work, 'listing.s'),
    `${header}\t.globl __asm_fn\n__asm_fn:\n${insns.map((i) => `\t${i.text}`).join('\n')}\n${last}`,
  );
  writeFileSync(
    join(work, 'translated.c'),
    c
      .replace(/^#define IMPORT\(m, n\).*$/m, '#define IMPORT(m, n)')
      .replace(`uint64_t ${fnName}(`, 'uint64_t __c_fn('),
  );
  return {
    params: inputs.map((_, i) => `uint64_t a${i}`).join(', ') || 'void',
    call: inputs.map((_, i) => input(i)).join(', '),
    asmCall: argRegs
      .map((reg) => (inputs.includes(reg) ? input(inputs.indexOf(reg)) : '0'))
      .join(', '),
  };
}

export function runCheck(lang, fnName, fixFile, run) {
  try {
    run();
  } catch (err) {
    throw new Error(
      `runnable ${lang}: the translation of ${fnName} disagrees with the CPU:\n${err.stdout?.toString() ?? err.message}Fix ${fixFile}.`,
    );
  }
}

export function buildAssembly({
  lang,
  run,
  paramName,
  retName,
  translated,
  keyParts,
  imports = [],
  x86 = [],
  arm64 = [],
  check,
  notChecked,
  cacheDir,
}) {
  const fnName = run.fn;
  const { c, names, tables } = translated;
  const key = hashKey([c, clangVersion(), wasmOpt(), ...keyParts]);
  const spec = {
    fn: fnName,
    params: run.inputs.map((input) => ({
      name: paramName(input.reg),
      type: 'uint64_t',
      kind: 'u64',
      default: input.default,
    })),
    registers: run.registers,
    ret: { type: 'uint64_t', kind: 'r64', ...(run.registers ? { name: retName } : {}) },
    names,
    libc: false,
    x86,
    arm64,
  };
  const cached = cacheDir && join(cacheDir, `${key}.wasm`);
  if (cached && existsSync(cached)) return { key, spec, wasmPath: cached, tables };

  const sys = findSysroot();
  return inWorkDir(`runnable-${lang}-`, (work) => {
    const checked = check(work);
    if (!checked) console.warn(`runnable ${lang}: ${fnName} not checked against ${notChecked}`);
    const src = join(work, 'block.c');
    writeFileSync(src, c);
    const wasm = join(work, 'out.wasm');
    try {
      linkWasm(sys, wasm, {
        flags: ['-O2', '-Wl,--allow-undefined'],
        exports: [fnName],
        inputs: [src],
      });
    } catch (err) {
      throw new Error(
        `runnable ${lang}: the translation of ${fnName} did not compile:\n${err.stderr ?? err.message}`,
      );
    }
    shrink(wasm);
    const bytes = readFileSync(wasm);
    const foreign = foreignImports(bytes, ['rt', ...imports]);
    if (foreign.length) throw new Error(`runnable ${lang}: ${fnName} needs ${foreign.join(', ')}`);
    const result = { key, spec, bytes, tables, checked };
    if (cacheDir) {
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(cached, bytes);
      result.wasmPath = cached;
    }
    return result;
  });
}
